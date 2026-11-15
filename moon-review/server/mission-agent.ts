import { bboxOf, greatCircleDistance, normLon180, padBBox } from '../src/core/geo/sphere.ts';
import { LandingSiteAnalysis, LandingSiteWeights, RouteModeId } from '../src/core/planet/types.ts';
import { ElevationGrid } from '../src/core/terrain/grid.ts';
import {
  AgentChatMessage,
  AgentChatRequestPayload,
  AgentChatResponsePayload,
  AgentToolCallRecord,
  MapStateUpdateCommand,
  MissionExecutionReport,
  MissionOptimizationPriority,
  MissionSpecification,
  MultiObjectiveRouteScore,
  ScienceDomainFocus,
} from '../src/moon/agent-types.ts';
import {
  DEFAULT_LANDING_WEIGHTS,
  LANDING_WEIGHT_PRESETS,
  MOON_BODY,
  MOON_DATA_SOURCES,
  MOON_PRESET_SITES,
  MOON_ROUTE_PRESETS,
} from '../src/moon/constants.ts';
import { evaluateMoonLandingSite, findNearbyGeologicalFeatures } from '../src/moon/landing.ts';
import { formatLatLonShort } from '../src/moon/physics.ts';
import {
  buildCustomRoverProfile,
  CUSTOM_INSTRUMENT_CATALOG,
  CustomRoverConfig,
  DEFAULT_CUSTOM_ROVER_CONFIG,
   getRoverById,
  NASA_MOON_ROVERS,
  NasaRoverProfile,
  RoverId,
  setGlobalCustomRoverConfig,
} from '../src/moon/rovers.ts';
import { planMoonRoutes } from '../src/moon/routing.ts';
import { scanRegionalCandidates } from './api.ts';
import { llmRouter } from './llm-router.ts';
import { moonStore } from './lola-store.ts';

function downsampleGridForAgent(grid: ElevationGrid, maxDim = 210): ElevationGrid {
  if (grid.width <= maxDim && grid.height <= maxDim) return grid;
  const stepR = Math.ceil(grid.height / maxDim);
  const stepC = Math.ceil(grid.width / maxDim);
  const width = Math.floor(grid.width / stepC);
  const height = Math.floor(grid.height / stepR);
  const elevation = new Float32Array(width * height);
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      elevation[r * width + c] = grid.elevation[r * stepR * grid.width + c * stepC];
    }
  }
  return {
    width,
    height,
    north: grid.north,
    west: grid.west,
    dLat: grid.dLat * stepR,
    dLon: grid.dLon * stepC,
    elevation,
  };
}

interface RegionMatch {
  key: string;
  name: string;
  lat: number;
  lon: number;
}

const REGION_KEYWORDS: Array<{
  pattern: RegExp;
  key: string;
  name: string;
  lat: number;
  lon: number;
}> = [
  {
    pattern: /\b(jezero|octavia|neretva|belva|three\s*forks|perseverance\s*landing|hawksbill|seitah|s[eé][ií]tah)\b/i,
    key: 'jezero',
    name: 'Jezero Crater & Western Fan-Delta',
    lat: 18.4447,
    lon: 77.4508,
  },
  {
    pattern: /\b(gale|mount\s*sharp|aeolis\s*mons|aeolis\s*palus|bradbury|yellowknife|vera\s*rubin)\b/i,
    key: 'gale',
    name: 'Gale Crater & Aeolis Mons (Mount Sharp)',
    lat: -4.5895,
    lon: 137.4417,
  },
  {
    pattern: /\b(syrtis|ne\s*syrtis|northeast\s*syrtis|isidis)\b/i,
    key: 'ne_syrtis',
    name: 'Northeast Syrtis Major',
    lat: 17.89,
    lon: 76.89,
  },
  {
    pattern: /\b(mawrth)\b/i,
    key: 'mawrth',
    name: 'Mawrth Vallis Phyllosilicate Plateau',
    lat: 23.99,
    lon: -18.96,
  },
  {
    pattern: /\b(elysium|homestead\s*hollow|insight)\b/i,
    key: 'elysium',
    name: 'Elysium Planitia (Homestead Hollow)',
    lat: 4.5024,
    lon: 135.6234,
  },
  {
    pattern: /\b(eberswalde)\b/i,
    key: 'eberswalde',
    name: 'Eberswalde Crater Inverted Delta',
    lat: -23.86,
    lon: -33.27,
  },
  {
    pattern: /\b(holden|uzboi)\b/i,
    key: 'holden',
    name: 'Holden Crater Alluvial Bajada',
    lat: -26.38,
    lon: -34.9,
  },
  {
    pattern: /\b(meridiani|endeavour\s*crater|eagle\s*crater|hematite\s*plains)\b/i,
    key: 'meridiani',
    name: 'Meridiani Planum',
    lat: -1.9462,
    lon: -5.5266,
  },
  {
    pattern: /\b(gusev|columbia\s*hills|husband\s*hill|home\s*plate|ma['’]?adim)\b/i,
    key: 'gusev',
    name: 'Gusev Crater & Columbia Hills',
    lat: -14.5684,
    lon: 175.4726,
  },
  {
    pattern: /\b(arcadia)\b/i,
    key: 'arcadia',
    name: 'Arcadia Planitia Ice-Rich Lowlands',
    lat: 39.2,
    lon: -172.0,
  },
  {
    pattern: /\b(melas|valles\s*marineris|chasma|canyon)\b/i,
    key: 'melas',
    name: 'Melas Chasma (Valles Marineris)',
    lat: -9.8,
    lon: -76.4,
  },
  {
    pattern: /\b(olympus\s*mons|olympus)\b/i,
    key: 'olympus_scarp',
    name: 'Olympus Mons Southeast Basal Scarp',
    lat: 18.65,
    lon: -133.8,
  },
  {
    pattern: /\b(ares\s*vallis|pathfinder|carl\s*sagan\s*station|twin\s*peaks)\b/i,
    key: 'ares_vallis',
    name: 'Ares Vallis Outflow Plain',
    lat: 19.13,
    lon: -33.22,
  },
];

function detectRegionFromText(text: string): RegionMatch | null {
  for (const entry of REGION_KEYWORDS) {
    if (entry.pattern.test(text)) {
      return {
        key: entry.key,
        name: entry.name,
        lat: entry.lat,
        lon: entry.lon,
      };
    }
  }

  // Also check explicit coordinates like "18.44°N, 77.45°E" or "lat -4.5 lon 137.4"
  const coordRegex =
    /(-?\d{1,2}(?:\.\d+)?)\s*°?\s*([NS])?\s*[,;/\s]+\s*(-?\d{1,3}(?:\.\d+)?)\s*°?\s*([EW])?/i;
  const match = text.match(coordRegex);
  if (match && (match[2] || match[4] || /\b(lat|lon|coord)/i.test(text))) {
    let lat = parseFloat(match[1]);
    if (match[2]?.toUpperCase() === 'S' && lat > 0) lat = -lat;
    let lon = parseFloat(match[3]);
    if (match[4]?.toUpperCase() === 'W' && lon > 0) lon = -lon;
    if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 88 && Math.abs(lon) <= 360) {
      const normLon = normLon180(lon);
      return {
        key: `custom_${lat.toFixed(2)}_${normLon.toFixed(2)}`,
        name: `Target Sector (${formatLatLonShort(lat, normLon)})`,
        lat,
        lon: normLon,
      };
    }
  }

  return null;
}

function parseCustomRoverFromNaturalLanguage(
  text: string,
  baseConfig: CustomRoverConfig,
): CustomRoverConfig {
  const lower = text.toLowerCase();
  const next: CustomRoverConfig = {
    ...baseConfig,
    instrumentIds: [...(baseConfig.instrumentIds || DEFAULT_CUSTOM_ROVER_CONFIG.instrumentIds)],
  };

  // Name extraction e.g. "named Valkyrie" or "called Pathfinder-X"
  const nameMatch = text.match(/\b(?:named|called)\s+["']?([A-Za-z0-9\s\-_]{3,28})["']?/i);
  if (nameMatch) {
    next.name = nameMatch[1].trim();
  } else if (next.name === DEFAULT_CUSTOM_ROVER_CONFIG.name) {
    next.name = 'Ares Custom Mission Rover';
  }

  // Wheel count
  if (/\b(8[-\s]*wheel|eight[-\s]*wheel|octo)/i.test(lower)) {
    next.wheelCount = 8;
  } else if (/\b(4[-\s]*wheel|four[-\s]*wheel|quad)/i.test(lower)) {
    next.wheelCount = 4;
  } else if (/\b(6[-\s]*wheel|six[-\s]*wheel)/i.test(lower)) {
    next.wheelCount = 6;
  }

  // Wheel diameter
  const diamMatch = text.match(/(\d{2})\s*cm\s*wheel/i);
  if (diamMatch) {
    next.wheelDiameterCm = Math.max(18, Math.min(60, parseInt(diamMatch[1], 10)));
  } else if (/\b(large\s*wheel|big\s*wheel|heavy[-\s]*duty\s*wheel)/i.test(lower)) {
    next.wheelDiameterCm = 58;
  } else if (/\b(small\s*wheel|compact\s*wheel|micro)/i.test(lower)) {
    next.wheelDiameterCm = 26;
  }

  // Grouser type
  if (/\b(chevron|zig[-\s]*zag)/i.test(lower)) {
    next.grouserType = 'chevron';
  } else if (/\b(straight\s*cleat|straight\s*grouser)/i.test(lower)) {
    next.grouserType = 'straight';
  } else if (/\b(curved|wavy|titanium\s*grouser|puncture[-\s]*resistant)/i.test(lower)) {
    next.grouserType = 'curved';
  }

  // Suspension
  if (/\b(independent\s*strut|wishbone)/i.test(lower)) {
    next.suspensionType = 'independent_strut';
  } else if (/\b(twin[-\s]*bogie)/i.test(lower)) {
    next.suspensionType = 'twin_bogie';
  } else if (/\b(rocker[-\s]*bogie)/i.test(lower)) {
    next.suspensionType = 'rocker_bogie';
  }

  // Chassis size
  if (/\b(compact|small|lightweight|mini|micro)/i.test(lower)) {
    next.chassisSize = 'compact';
  } else if (/\b(mid[-\s]*size|medium)/i.test(lower)) {
    next.chassisSize = 'midsize';
  } else if (/\b(flagship|heavy|large|nuclear\s*cruiser)/i.test(lower)) {
    next.chassisSize = 'flagship';
  }

  // Power source
  if (/\b(solar|photovoltaic|sun[-\s]*powered)/i.test(lower)) {
    next.powerSource = 'solar';
  } else if (/\b(mmrtg|nuclear|radioisotope|plutonium|rtg)/i.test(lower)) {
    next.powerSource = 'mmrtg';
  }

  // Instruments
  const matchedInst = new Set<string>(['mastcam_stereo']);
  if (/\b(laser|spectrometer|libs|raman|chemistry|mineral)/i.test(lower)) {
    matchedInst.add('libs_laser');
  }
  if (/\b(radar|gpr|subsurface|underground|ice)/i.test(lower)) {
    matchedInst.add('gpr_radar');
  }
  if (/\b(drill|cor(?:e|ing)|sample|cache|rock\s*sample)/i.test(lower)) {
    matchedInst.add('core_drill');
  }
  if (/\b(weather|radiation|dosimeter|wind|env)/i.test(lower)) {
    matchedInst.add('weather_rad');
  }
  if (/\b(oxygen|moxie|isru|in[-\s]*situ)/i.test(lower)) {
    matchedInst.add('isru_moxie');
  }
  if (matchedInst.size > 1) {
    next.instrumentIds = Array.from(matchedInst);
  }

  return next;
}

/**
 * Extracts and merges structured mission parameters from the user's latest prompt and
 * the ongoing conversation state (`currentSpec`).
 */
export function extractAndMergeMissionSpec(
  payload: AgentChatRequestPayload,
): {
  spec: MissionSpecification;
  isRevisionTurn: boolean;
  revisionNotes: string[];
} {
  const userMessages = payload.messages.filter((m) => m.role === 'user');
  const latestUserText = userMessages[userMessages.length - 1]?.content || '';
  const allUserText = userMessages.map((m) => m.content).join(' \n ');
  const prev = payload.currentSpec || {};

  const revisionNotes: string[] = [];
  const hadPreviousReadySpec = prev.completeness === 'ready_to_execute' && Boolean(prev.regionKey);

  // 1. Region detection (latest message overrides previous region if a new region is named)
  const latestRegion = detectRegionFromText(latestUserText);
  const historicalRegion = detectRegionFromText(allUserText);

  let regionKey = prev.regionKey || '';
  let regionName = prev.regionName || '';
  let targetCenter = prev.targetCenter || payload.currentLocation || { lat: 18.4447, lon: 77.4508 };

  if (latestRegion) {
    if (prev.regionKey && prev.regionKey !== latestRegion.key) {
      revisionNotes.push(`Updated target region to ${latestRegion.name}`);
    }
    regionKey = latestRegion.key;
    regionName = latestRegion.name;
    targetCenter = { lat: latestRegion.lat, lon: latestRegion.lon };
  } else if (!regionKey && historicalRegion) {
    regionKey = historicalRegion.key;
    regionName = historicalRegion.name;
    targetCenter = { lat: historicalRegion.lat, lon: historicalRegion.lon };
  } else if (
    !regionKey &&
    /\b(you\s*choose|best\s*region|recommend\s*a\s*region|surprise\s*me|default\s*region|go\s*ahead|plan\s*it\s*now)\b/i.test(
      latestUserText,
    )
  ) {
    regionKey = 'jezero';
    regionName = 'Jezero Crater & Western Fan-Delta';
    targetCenter = { lat: 18.4447, lon: 77.4508 };
  }

  // 2. Science objective detection
  let scienceObjective: ScienceDomainFocus = prev.scienceObjective || 'ancient_water_biosignatures';
  let scienceObjectiveSummary =
    prev.scienceObjectiveSummary ||
    'Investigate Noachian–Hesperian lacustrine deposits, collect rock core samples, and map habitable mineralogical units.';

  if (/\b(water|lake|delta|biosignature|life|microb\w*|sample\w*|cor(?:e|ing)|habitable|organic\w*)\b/i.test(latestUserText)) {
    scienceObjective = 'ancient_water_biosignatures';
    scienceObjectiveSummary =
      'Investigate ancient aqueous environments, deltaic stratigraphy, and biosignature preservation while collecting rock core samples.';
  } else if (/\b(sediment\w*|layer\w*|stratigraph\w*|clay\w*|sulfate\w*|hematite|mineral\w*|crater\s*wall\w*)\b/i.test(latestUserText)) {
    scienceObjective = 'sedimentary_stratigraphy';
    scienceObjectiveSummary =
      'Analyze sedimentary stratigraphy, clay-to-sulfate transitions, and exposed crater/mound rock formations.';
  } else if (/\b(ice|glacier\w*|subsurface\s*water|isru|oxygen|human\s*landing)\b/i.test(latestUserText)) {
    scienceObjective = 'subsurface_ice_isru';
    scienceObjectiveSummary =
      'Map shallow subsurface water ice with ground-penetrating radar and evaluate In-Situ Resource Utilization (ISRU).';
  } else if (/\b(volcan\w*|lava|basalt\w*|tectonic\w*|fault\w*|scarp\w*|canyon\w*)\b/i.test(latestUserText)) {
    scienceObjective = 'volcanic_tectonic';
    scienceObjectiveSummary =
      'Examine volcanic plains, basaltic flows, and tectonic fault scarps.';
  } else if (!prev.scienceObjective && /\b(geolog\w*|formation\w*|rock\w*|outcrop\w*)\b/i.test(latestUserText)) {
    scienceObjective = 'sedimentary_stratigraphy';
    scienceObjectiveSummary =
      'Examine lunar geological formations, bedrock outcrops, and impact crater stratigraphy.';
  }

  // 3. Required capabilities
  const capSet = new Set<string>(prev.requiredCapabilities || []);
  if (/\b(sample|cor(?:e|ing)|drill|cache)\b/i.test(allUserText)) capSet.add('Rock Coring & Sample Caching');
  if (/\b(radar|subsurface|underground|gpr|rimfax)\b/i.test(allUserText)) capSet.add('Subsurface Ground-Penetrating Radar');
  if (/\b(laser|spectrometer|mineral|chemical|libs|raman)\b/i.test(allUserText)) capSet.add('Laser & X-Ray Mineral Spectroscopy');
  if (/\b(camera|stereo|photo|3d\s*imag|panoram)\b/i.test(allUserText)) capSet.add('High-Resolution Stereo Geological Imaging');
  if (/\b(oxygen|moxie|isru)\b/i.test(allUserText)) capSet.add('Atmospheric O₂ ISRU Synthesis');
  if (/\b(radiation|weather|dosimet)\b/i.test(allUserText)) capSet.add('Surface Radiation & Meteorology Monitoring');
  if (capSet.size === 0) {
    capSet.add('High-Resolution Stereo Geological Imaging');
    capSet.add('Laser & X-Ray Mineral Spectroscopy');
  }

  // 4. Rover selection or Custom Rover creation
  let roverSource: MissionSpecification['roverSource'] = prev.roverSource || 'nasa_fleet';
  let roverId: RoverId = prev.roverId || 'perseverance';
  let proposedCustomRover: CustomRoverConfig | undefined = prev.proposedCustomRover;
  let customRoverConfirmed = Boolean(prev.customRoverConfirmed);

  const wantsNewCustomRover =
    /\b(design\s+a\s+custom|create\s+a\s+custom|build\s+a\s+custom|custom\s+\d+[-\s]*wheel|new\s+custom\s+rover|custom\s+robot|design\s+a\s+rover|8[-\s]*wheel|4[-\s]*wheel)\b/i.test(
      latestUserText,
    );

  const wantsConfirmCustomRover =
    /\b(confirm\s+and\s+save\s+custom|save\s+custom\s+rover|apply\s+custom\s+rover)\b/i.test(latestUserText);

  if (wantsConfirmCustomRover && (proposedCustomRover || payload.savedCustomRoverConfig)) {
    roverSource = 'custom_new';
    roverId = 'custom';
    proposedCustomRover = proposedCustomRover || payload.savedCustomRoverConfig;
    customRoverConfirmed = true;
    setGlobalCustomRoverConfig(proposedCustomRover);
    revisionNotes.push(`Confirmed and saved custom rover "${proposedCustomRover.name}"`);
  } else if (wantsNewCustomRover) {
    roverSource = 'custom_new';
    roverId = 'custom';
    proposedCustomRover = parseCustomRoverFromNaturalLanguage(
      latestUserText,
      proposedCustomRover || payload.savedCustomRoverConfig || DEFAULT_CUSTOM_ROVER_CONFIG,
    );
    customRoverConfirmed = false;
    revisionNotes.push(
      `Designed custom ${proposedCustomRover.wheelCount}-wheel rover "${proposedCustomRover.name}" (${proposedCustomRover.wheelDiameterCm} cm wheels, ${proposedCustomRover.powerSource.toUpperCase()})`,
    );
  } else if (/\b(my\s+saved\s+custom|my\s+custom\s+rover|saved\s+custom\s+rover|use\s+custom\s+rover)\b/i.test(latestUserText)) {
    roverSource = 'custom_saved';
    roverId = 'custom';
    proposedCustomRover = payload.savedCustomRoverConfig;
    customRoverConfirmed = true;
    revisionNotes.push(`Selected saved custom rover "${payload.savedCustomRoverConfig.name}"`);
  } else if (/\b(curiosity|msl)\b/i.test(latestUserText)) {
    if (prev.roverId && prev.roverId !== 'curiosity') {
      revisionNotes.push('Switched mission vehicle to NASA Curiosity (MSL)');
    }
    roverSource = 'nasa_fleet';
    roverId = 'curiosity';
  } else if (/\b(perseverance|moon\s*2020|m2020)\b/i.test(latestUserText)) {
    if (prev.roverId && prev.roverId !== 'perseverance') {
      revisionNotes.push('Switched mission vehicle to NASA Perseverance (Moon 2020)');
    }
    roverSource = 'nasa_fleet';
    roverId = 'perseverance';
  } else if (/\b(opportunity|mer[-\s]*b)\b/i.test(latestUserText)) {
    if (prev.roverId && prev.roverId !== 'opportunity') {
      revisionNotes.push('Switched mission vehicle to NASA Opportunity (MER-B)');
    }
    roverSource = 'nasa_fleet';
    roverId = 'opportunity';
  } else if (/\b(spirit|mer[-\s]*a)\b/i.test(latestUserText)) {
    if (prev.roverId && prev.roverId !== 'spirit') {
      revisionNotes.push('Switched mission vehicle to NASA Spirit (MER-A)');
    }
    roverSource = 'nasa_fleet';
    roverId = 'spirit';
  } else if (/\b(sojourner|pathfinder\s*rover)\b/i.test(latestUserText)) {
    if (prev.roverId && prev.roverId !== 'sojourner') {
      revisionNotes.push('Switched mission vehicle to NASA Sojourner (MFEX)');
    }
    roverSource = 'nasa_fleet';
    roverId = 'sojourner';
  } else if (!prev.roverId) {
    // Intelligent automatic selection based on region & mission objectives
    if (regionKey === 'gale') {
      roverId = 'curiosity';
    } else if (regionKey === 'meridiani') {
      roverId = 'opportunity';
    } else if (regionKey === 'gusev') {
      roverId = 'spirit';
    } else if (regionKey === 'ares_vallis') {
      roverId = 'sojourner';
    } else {
      roverId = 'perseverance';
    }
  }

  // Get active rover profile to calibrate slope limits
  const activeProfile: NasaRoverProfile =
    roverId === 'custom' && proposedCustomRover
      ? buildCustomRoverProfile(proposedCustomRover)
      : getRoverById(roverId);

  // 5. Optimization priority & A* cost weights (supports follow-up revisions!)
  let optimizationPriority: MissionOptimizationPriority = prev.optimizationPriority || 'balanced';
  let maxAllowedSlopeDeg = prev.maxAllowedSlopeDeg ?? Math.min(20, activeProfile.mobilityProfile.operationalMaxSlopeDeg);
  let slopeWeight = prev.slopeWeight ?? 1.2;
  let roughnessWeight = prev.roughnessWeight ?? 1.2;
  let scienceWeight = prev.scienceWeight ?? 1.2;
  let maxTraverseDistanceKm = prev.maxTraverseDistanceKm;
  let landingWeights: LandingSiteWeights = prev.landingWeights
    ? { ...prev.landingWeights }
    : { ...DEFAULT_LANDING_WEIGHTS };

  if (
    /\b(less\s+difficult|easier\s+route|safer\s+route|avoid\s+difficult|avoid\s+steep|flatter|low\s+risk|prioritize\s+safety|conservative)\b/i.test(
      latestUserText,
    )
  ) {
    optimizationPriority = 'safety';
    maxAllowedSlopeDeg = Math.max(10, Math.min(15, activeProfile.mobilityProfile.operationalMaxSlopeDeg - 4));
    slopeWeight = 2.4;
    roughnessWeight = 2.2;
    scienceWeight = 0.8;
    landingWeights = { ...LANDING_WEIGHT_PRESETS[1].weights }; // edl_safety
    if (hadPreviousReadySpec) {
      revisionNotes.push(
        `Updated route optimization to Conservative Terrain Safety (max slope ceiling ${maxAllowedSlopeDeg}°, slope weight ${slopeWeight}×, roughness weight ${roughnessWeight}×)`,
      );
    }
  } else if (
    /\b(prioritize\s+scien\w*|more\s+scien\w*|scientific\s+discover\w*|maximize\s+scien\w*|geological\s+value)/i.test(
      latestUserText,
    )
  ) {
    optimizationPriority = 'science';
    maxAllowedSlopeDeg = activeProfile.mobilityProfile.operationalMaxSlopeDeg;
    slopeWeight = 1.0;
    roughnessWeight = 1.0;
    scienceWeight = 2.6;
    landingWeights = { ...LANDING_WEIGHT_PRESETS[2].weights }; // science_sample
    if (hadPreviousReadySpec) {
      revisionNotes.push(
        `Updated mission optimization to Prioritize Scientific Discoveries (science attraction weight ${scienceWeight}×, full ${maxAllowedSlopeDeg}° rover slope envelope)`,
      );
    }
  } else if (/\b(shortest|fastest|direct\s+route|minimum\s+distance|quickest)\b/i.test(latestUserText)) {
    optimizationPriority = 'shortest_distance';
    maxAllowedSlopeDeg = activeProfile.mobilityProfile.operationalMaxSlopeDeg;
    slopeWeight = 0.7;
    roughnessWeight = 0.7;
    scienceWeight = 0.5;
    if (hadPreviousReadySpec) {
      revisionNotes.push('Updated route optimization to Shortest Distance Efficiency');
    }
  }

  // Check if user asked to move the destination closer to the landing site
  if (/\b(closer\s+to\s+(?:the\s+)?landing|move\s+(?:the\s+)?destination\s+closer|shorter\s+traverse|nearby\s+destination|closer\s+target)\b/i.test(latestUserText)) {
    maxTraverseDistanceKm = 3.2;
    revisionNotes.push('Moved target exploration destination closer to the landing zone (≤ 3.2 km local traverse)');
  } else if (/\b(longer\s+route|farther\s+destination|regional\s+traverse|extend\s+route)\b/i.test(latestUserText)) {
    maxTraverseDistanceKm = 25;
    revisionNotes.push('Extended target exploration range to regional scale (~15–25 km)');
  }

  // Adjust landing weights for solar rovers
  if (activeProfile.dimensions.powerSource.toLowerCase().includes('solar')) {
    landingWeights = {
      ...landingWeights,
      latitudeThermal: Math.max(landingWeights.latitudeThermal, 0.18),
    };
  }

  // 6. Determine completeness (Does the agent need to ask follow-up questions first?)
  const missingFields: string[] = [];
  if (!regionKey) {
    missingFields.push('Target lunar Region');
  }

  // If the user hasn't specified a region AND hasn't asked to auto-pick or run on current region,
  // ask concise clarifying questions on the first turn.
  const userExplicitlyWantsImmediateExecution =
    /\b(plan\s+(?:the\s+)?mission|execute|run\s+analysis|use\s+current|anywhere|you\s+pick|best\s+site)\b/i.test(
      latestUserText,
    ) || userMessages.length >= 2;

  if (!regionKey && userExplicitlyWantsImmediateExecution) {
    // Default to Jezero Crater or best match for the objective
    if (scienceObjective === 'sedimentary_stratigraphy' && roverId === 'curiosity') {
      regionKey = 'gale';
      regionName = 'Gale Crater & Aeolis Mons (Mount Sharp)';
      targetCenter = { lat: -4.5895, lon: 137.4417 };
    } else if (scienceObjective === 'subsurface_ice_isru') {
      regionKey = 'arcadia';
      regionName = 'Arcadia Planitia Ice-Rich Lowlands';
      targetCenter = { lat: 39.2, lon: -172.0 };
    } else {
      regionKey = 'jezero';
      regionName = 'Jezero Crater & Western Fan-Delta';
      targetCenter = { lat: 18.4447, lon: 77.4508 };
    }
    missingFields.length = 0;
  }

  const completeness: MissionSpecification['completeness'] =
    missingFields.length === 0 ? 'ready_to_execute' : 'needs_clarification';

  const missionTitle = regionName
    ? `${regionName.split('&')[0].trim()} — ${activeProfile.name} Exploration Campaign`
    : 'Moon Surface Exploration Mission (Awaiting Target Selection)';

  return {
    spec: {
      missionTitle,
      regionKey,
      regionName,
      targetCenter,
      scienceObjective,
      scienceObjectiveSummary,
      roverSource,
      roverId,
      proposedCustomRover,
      customRoverConfirmed,
      requiredCapabilities: Array.from(capSet),
      optimizationPriority,
      maxAllowedSlopeDeg,
      slopeWeight,
      roughnessWeight,
      scienceWeight,
      maxTraverseDistanceKm,
      landingWeights,
      completeness,
      missingFields,
    },
    isRevisionTurn: hadPreviousReadySpec && revisionNotes.length > 0,
    revisionNotes,
  };
}

/**
 * Selects a scientifically grounded destination coordinate for the rover traverse
 * based on the chosen landing site, regional presets, IAU nomenclature features, and distance constraints.
 */
function selectMissionDestination(
  spec: MissionSpecification,
  landingSite: LandingSiteAnalysis,
): {
  name: string;
  type: string;
  lat: number;
  lon: number;
  rationale: string;
} {
  const R_KM = MOON_BODY.meanRadiusM / 1000;
  const startPt = { lat: landingSite.lat, lon: landingSite.lon };

  // 1. If the user asked for a closer destination (or if we are in Jezero and want the high-res 1 m HiRISE delta scarp)
  if (spec.regionKey === 'jezero') {
    if (spec.maxTraverseDistanceKm && spec.maxTraverseDistanceKm <= 5) {
      return {
        name: 'Western Delta Top (Belva Crater Plateau — HiRISE 1 m DTM)',
        type: 'Fluvio-Lacustrine Delta Scarp & Impact Exposure',
        lat: 18.472,
        lon: 77.412,
        rationale:
          'Located ~4.9 km northwest of the landing zone within the 1.02 m/px HiRISE stereo DTM footprint, exposing finely laminated deltaic bottomsets, foresets, and carbonate-bearing marginal benches.',
      };
    }
    // Default Jezero destination: Western Delta Top on HiRISE 1m DTM so the traverse stays inside the ultra-sharp Level 3 HiRISE stereo mesh!
    return {
      name: 'Jezero Western Delta Front & Belva Crater Plateau',
      type: 'Noachian–Hesperian River Delta & Carbonate Margin',
      lat: 18.472,
      lon: 77.412,
      rationale:
        'High-priority astrobiological target on the Western Fan-Delta scarp (~4.9 km traverse across Three Forks and Hawksbill Gap), fully covered by the 1.02 m/px HiRISE SOCET SET stereo DTM and 25 cm orthoimagery.',
    };
  }

  // 2. Check matching regional route presets
  const matchingPreset = MOON_ROUTE_PRESETS.find((p) => {
    const d = greatCircleDistance(startPt, p.start, R_KM);
    return d < 65;
  });

  if (matchingPreset) {
    let destLat = matchingPreset.destination.lat;
    let destLon = matchingPreset.destination.lon;
    let destName = matchingPreset.destination.label;

    const fullDistKm = greatCircleDistance(startPt, { lat: destLat, lon: destLon }, R_KM);
    if (spec.maxTraverseDistanceKm && fullDistKm > spec.maxTraverseDistanceKm) {
      const ratio = Math.max(0.25, spec.maxTraverseDistanceKm / fullDistKm);
      destLat = Number((startPt.lat + (destLat - startPt.lat) * ratio).toFixed(4));
      destLon = Number(normLon180(startPt.lon + (destLon - startPt.lon) * ratio).toFixed(4));
      destName = `${matchingPreset.destination.label} — Proximal Outcrop (${spec.maxTraverseDistanceKm.toFixed(1)} km range)`;
    }

    return {
      name: destName,
      type: 'Primary Regional Stratigraphic Target',
      lat: destLat,
      lon: destLon,
      rationale: `${matchingPreset.description} Selected for ${spec.scienceObjectiveSummary.toLowerCase()}`,
    };
  }

  // 3. Query nearby IAU geological features from moonStore
  const nearbyFeatures = findNearbyGeologicalFeatures(
    landingSite.lat,
    landingSite.lon,
    moonStore.getFeatures(),
    120,
    8,
  );
  const viableFeature = nearbyFeatures.find((f) => f.distanceKm >= 2.5 && f.distanceKm <= 45);
  if (viableFeature) {
    return {
      name: `${viableFeature.name} (${viableFeature.type})`,
      type: viableFeature.type,
      lat: viableFeature.lat,
      lon: viableFeature.lon,
      rationale: `Official IAU geological feature located ${viableFeature.distanceKm.toFixed(1)} km from the landing zone, providing direct exposure for ${spec.scienceObjectiveSummary.toLowerCase()}`,
    };
  }

  // 4. Deterministic offset toward scientifically interesting relief in the ROI
  const offsetLat = Number((landingSite.lat + (spec.maxTraverseDistanceKm ? 0.045 : 0.14)).toFixed(4));
  const offsetLon = Number(normLon180(landingSite.lon - (spec.maxTraverseDistanceKm ? 0.045 : 0.16)).toFixed(4));
  return {
    name: `${spec.regionName} — Primary Science Outcrop`,
    type: 'Regional Geological Contact Zone',
    lat: offsetLat,
    lon: offsetLon,
    rationale: `Target outcrop selected along the regional topographic gradient of ${spec.regionName} to sample bedrock stratigraphy while remaining within rover traverse range.`,
  };
}

/**
 * Computes transparent multi-objective optimization scores (0..100) for all candidate A* routes.
 * Explicitly evaluates:
 *  - Terrain Safety (slope margin & low hazard fraction)
 *  - Rover Mobility Fit (wheel roughness tolerance & climb efficiency)
 *  - Science Value (proximity to IAU features, craters, and science waypoints)
 *  - Distance Efficiency (detour ratio vs great-circle baseline)
 *  - Data Confidence (underlying DEM resolution tier)
 */
function evaluateMultiObjectiveRoutes(
  spec: MissionSpecification,
  rover: NasaRoverProfile,
  routePlan: ReturnType<typeof planMoonRoutes>,
  nativeGsdMeters: number,
): {
  scores: MultiObjectiveRouteScore[];
  recommendedRouteId: RouteModeId;
} {
  const weightsByPriority: Record<
    MissionOptimizationPriority,
    MultiObjectiveRouteScore['weightsUsed']
  > = {
    safety: {
      terrainSafety: 0.42,
      roverMobility: 0.28,
      scienceValue: 0.1,
      distanceEfficiency: 0.1,
      dataConfidence: 0.1,
    },
    balanced: {
      terrainSafety: 0.28,
      roverMobility: 0.24,
      scienceValue: 0.22,
      distanceEfficiency: 0.16,
      dataConfidence: 0.1,
    },
    science: {
      terrainSafety: 0.18,
      roverMobility: 0.18,
      scienceValue: 0.42,
      distanceEfficiency: 0.12,
      dataConfidence: 0.1,
    },
    shortest_distance: {
      terrainSafety: 0.2,
      roverMobility: 0.2,
      scienceValue: 0.12,
      distanceEfficiency: 0.38,
      dataConfidence: 0.1,
    },
  };

  const w = weightsByPriority[spec.optimizationPriority] || weightsByPriority.balanced;
  const dataConfidenceScore =
    nativeGsdMeters <= 2.5
      ? 98
      : nativeGsdMeters <= 25
        ? 91
        : nativeGsdMeters <= 500
          ? 82
          : 68;

  const minDistanceKm = Math.max(
    0.1,
    ...routePlan.routes.map((r) => r.analytics.totalDistanceKm).filter((d) => d > 0),
  );

  const scores: MultiObjectiveRouteScore[] = routePlan.routes.map((route) => {
    const m = route.analytics;
    const slopeLimit = Math.max(10, rover.mobilityProfile.operationalMaxSlopeDeg);

    // 1. Terrain Safety (0..100): penalizes high maxSlope, high P95 slope, and obstacle count
    const slopeRatio = m.maxSlopeDeg / slopeLimit;
    const obstaclePenalty = (m.obstaclesAlongRoute?.length ?? 0) * 6;
    const terrainSafetyScore = Math.round(
      Math.max(
        15,
        Math.min(
          99,
          100 -
            Math.max(0, slopeRatio - 0.35) * 62 -
            m.meanSlopeDeg * 2.2 -
            obstaclePenalty,
        ),
      ),
    );

    // 2. Rover Mobility Fit (0..100): accounts for rover-specific roughness penalty & cumulative climb
    const roughnessImpact =
      (m.meanTriM / 12) * rover.mobilityProfile.roughnessPenaltyFactor * 18;
    const climbPerKm = m.totalElevationGainM / Math.max(0.5, m.totalDistanceKm);
    const climbImpact = (climbPerKm / 35) * rover.mobilityProfile.slopePenaltyFactor * 14;
    const roverMobilityFitScore = Math.round(
      Math.max(18, Math.min(99, 100 - roughnessImpact - climbImpact)),
    );

    // 3. Science Value (0..100): rewards science targets passed and geological diversity along path
    const wpCount = m.scienceTargetsAlongRoute?.length ?? 0;
    const baseSci =
      route.id === 'scientific_exploration' ? 88 : route.id === 'terrain_optimized' ? 79 : 68;
    const scienceValueScore = Math.round(
      Math.max(40, Math.min(99, baseSci + Math.min(11, wpCount * 4))),
    );

    // 4. Distance Efficiency (0..100): compares route length to shortest viable path
    const detourRatio = m.totalDistanceKm / Math.max(0.1, Math.min(minDistanceKm, m.straightLineDistanceKm * 1.05));
    const distanceEfficiencyScore = Math.round(
      Math.max(25, Math.min(99, 100 - Math.max(0, detourRatio - 1.0) * 85)),
    );

    const totalObjectiveScore = Math.round(
      terrainSafetyScore * w.terrainSafety +
        roverMobilityFitScore * w.roverMobility +
        scienceValueScore * w.scienceValue +
        distanceEfficiencyScore * w.distanceEfficiency +
        dataConfidenceScore * w.dataConfidence,
    );

    const formulaText =
      `J(${route.id}) = ${w.terrainSafety.toFixed(2)}·S_safe(${terrainSafetyScore}) + ` +
      `${w.roverMobility.toFixed(2)}·S_mob(${roverMobilityFitScore}) + ` +
      `${w.scienceValue.toFixed(2)}·S_sci(${scienceValueScore}) + ` +
      `${w.distanceEfficiency.toFixed(2)}·S_dist(${distanceEfficiencyScore}) + ` +
      `${w.dataConfidence.toFixed(2)}·S_conf(${dataConfidenceScore}) = ${totalObjectiveScore}/100`;

    const rationale =
      route.id === 'terrain_optimized'
        ? `Minimizes slope exposure (max ${m.maxSlopeDeg.toFixed(1)}°, mean ${m.meanSlopeDeg.toFixed(1)}°) and rock roughness (${m.meanTriM.toFixed(1)} m TRI) across ${m.totalDistanceKm.toFixed(2)} km.`
        : route.id === 'shortest'
          ? `Minimizes total traverse distance (${m.totalDistanceKm.toFixed(2)} km, +${Math.round(m.totalElevationGainM)} m climb, max slope ${m.maxSlopeDeg.toFixed(1)}°).`
          : `Routes near ${wpCount} high-value geological targets (${m.scienceTargetsAlongRoute.slice(0, 2).map((t) => t.name).join(', ') || 'contact outcrops'}) across ${m.totalDistanceKm.toFixed(2)} km.`;

    return {
      routeId: route.id,
      routeName: route.name,
      totalObjectiveScore,
      terrainSafetyScore,
      roverMobilityFitScore,
      scienceValueScore,
      distanceEfficiencyScore,
      dataConfidenceScore,
      weightsUsed: w,
      formulaText,
      rationale,
    };
  });

  // Sort copy to pick winner
  const sorted = [...scores].sort((a, b) => b.totalObjectiveScore - a.totalObjectiveScore);
  let recommendedRouteId: RouteModeId = sorted[0]?.routeId || 'terrain_optimized';

  // Ensure direct alignment when user explicitly prioritizes safety, science, or shortest distance
  if (spec.optimizationPriority === 'safety') {
    recommendedRouteId = 'terrain_optimized';
  } else if (spec.optimizationPriority === 'science') {
    recommendedRouteId = 'scientific_exploration';
  } else if (spec.optimizationPriority === 'shortest_distance') {
    recommendedRouteId = 'shortest';
  }

  return { scores, recommendedRouteId };
}

/**
 * Main entry point for a conversational turn with the TERRATWIN AI Mission Planning Agent.
 */
export async function runMissionAgentTurn(
  payload: AgentChatRequestPayload,
): Promise<AgentChatResponsePayload> {
  const { spec, isRevisionTurn, revisionNotes } = extractAndMergeMissionSpec(payload);

  // CASE A: Underspecified mission -> Ask concise, helpful follow-up questions before running tools
  if (spec.completeness === 'needs_clarification') {
    const activeProfile =
      spec.roverId === 'custom' && spec.proposedCustomRover
        ? buildCustomRoverProfile(spec.proposedCustomRover)
        : getRoverById(spec.roverId);

    const followUpQuestions = [
      {
        question: '1. Which lunar region or geological environment would you like to explore?',
        quickReplies: [
          'Explore Jezero Crater & ancient river delta (Perseverance)',
          'Explore Gale Crater & Mount Sharp sedimentary layers (Curiosity)',
          'Explore Valles Marineris (Melas Chasma) canyon floor',
          'Explore Arcadia Planitia for subsurface water ice',
        ],
      },
      {
        question: '2. What is your primary mission priority and vehicle preference?',
        quickReplies: [
          'Use Perseverance — collect rock cores & prioritize safe driving',
          'Use Curiosity — prioritize scientific discoveries & mineralogy',
          'Design a custom 8-wheel rover with ground radar & core drill',
        ],
      },
    ];

    const fallbackClarification = () =>
      payload.experienceMode === 'beginner'
        ? `I would love to help you plan that Moon mission! Right now, I know your focus is **${spec.scienceObjectiveSummary.toLowerCase()}**\n\nBefore I scan the NASA orbital datasets, score landing zones, and compute your 3D rover routes, could you let me know **which lunar region** you want to target (or ask me to pick the best match), and whether you want to use an existing **NASA rover** (like *${activeProfile.name}*) or **design a custom rover**?`
        : `Mission parameters initialized for **${spec.scienceObjective}** (${spec.requiredCapabilities.join(', ')}). To execute deterministic LOLA/HiRISE terrain analysis, multi-criteria landing evaluation, and vehicle-specific A* pathfinding, please specify your **target region of interest** (or select a recommended geological sector below) and confirm your **rover configuration**.`;

    const { text, decision } = await llmRouter.executeNarrativeOrIntentTask({
      taskCategory: 'conversational_followup',
      systemPrompt:
        'You are the TERRATWIN Aerospace AI Mission Copilot. Ask 1-2 brief, friendly clarifying questions to identify the target Moon region and rover preference before executing mission tools.',
      userPrompt: `User message: "${payload.messages[payload.messages.length - 1]?.content || ''}". Extracted objective: ${spec.scienceObjectiveSummary}. Mode: ${payload.experienceMode}.`,
      deterministicFallback: fallbackClarification,
    });

    const msg: AgentChatMessage = {
      id: `agent_${Date.now()}`,
      role: 'assistant',
      timestamp: new Date().toISOString(),
      content: text,
      followUpQuestions,
      missionSpec: spec,
      routerDecision: decision,
    };

    return {
      message: msg,
      updatedSpec: spec,
      routerStatus: llmRouter.getStatus(),
    };
  }

  // CASE B: Complete mission specification -> Execute Real Agentic Tool Pipeline!
  const toolCalls: AgentToolCallRecord[] = [];
  let stepCounter = 1;

  // --- TOOL 1: Rover Selection / Custom Robot Engineering ---
  const t1Start = performance.now();
  const roverProfile: NasaRoverProfile =
    spec.roverId === 'custom' && spec.proposedCustomRover
      ? buildCustomRoverProfile(spec.proposedCustomRover)
      : getRoverById(spec.roverId);

  toolCalls.push({
    id: `tool_${Date.now()}_1`,
    stepNumber: stepCounter++,
    category: 'rover',
    toolName: spec.roverSource === 'custom_new' ? 'design_custom_rover' : 'get_rover_specifications',
    title:
      spec.roverSource === 'custom_new'
        ? `Engineered Custom Rover: ${roverProfile.name}`
        : `Loaded Vehicle Mobility & Payload Profile: ${roverProfile.name}`,
    inputSummary: `roverId="${spec.roverId}", capabilities=[${spec.requiredCapabilities.join(', ')}]`,
    outputSummary: `${roverProfile.wheels.count} wheels (${roverProfile.wheels.diameterCm} cm, ${roverProfile.wheels.grouserCount} grousers), ${roverProfile.suspension.groundClearanceCm} cm clearance, max slope ${roverProfile.mobilityProfile.operationalMaxSlopeDeg}°, TRI factor ${roverProfile.mobilityProfile.roughnessPenaltyFactor}×`,
    durationMs: Math.max(2, Math.round(performance.now() - t1Start)),
    status: 'completed',
    dataProvenance: roverProfile.model3d.credit,
  });

  // --- TOOL 2: NASA Dataset Search & Regional Telemetry Retrieval ---
  const t2Start = performance.now();
  const { telemetry: centerTelemetry, regionalStats25Km } = moonStore.samplePointTelemetry(
    spec.targetCenter.lat,
    spec.targetCenter.lon,
  );
  const availableDtms = await moonStore.getAvailableDtms(spec.targetCenter.lat, spec.targetCenter.lon);

  toolCalls.push({
    id: `tool_${Date.now()}_2`,
    stepNumber: stepCounter++,
    category: 'nasa_data',
    toolName: 'retrieve_regional_terrain_data',
    title: `Sampled NASA LOLA & Stereo DTM Stack at ${spec.regionName}`,
    inputSummary: `center=(${formatLatLonShort(spec.targetCenter.lat, spec.targetCenter.lon)}), radius=25 km`,
    outputSummary: `Elevation ${centerTelemetry.elevationM !== null ? Math.round(centerTelemetry.elevationM) + ' m' : 'N/A'}, regional slope P95 ${regionalStats25Km.slopeP95Deg.toFixed(2)}°, ${availableDtms.length} stereo HiRISE/CTX DTMs indexed`,
    durationMs: Math.max(4, Math.round(performance.now() - t2Start)),
    status: 'completed',
    dataProvenance: 'NASA PDS MGS LOLA MEGDR + USGS Astrogeology STAC (HiRISE/CTX)',
  });

  // --- TOOL 3: Multi-Criteria Candidate Landing Region Ranking ---
  const t3Start = performance.now();
  const centerSite = evaluateMoonLandingSite({
    id: `mission_center_${spec.regionKey}`,
    name: `${spec.regionName} Primary Reference Zone`,
    telemetry: centerTelemetry,
    regionalStats25Km,
    craters: moonStore.getCraters(),
    features: moonStore.getFeatures(),
    availableDtms,
    weights: spec.landingWeights,
  });

  const scannedCandidates = scanRegionalCandidates(
    spec.targetCenter.lat,
    spec.targetCenter.lon,
    spec.landingWeights,
    0.36,
    availableDtms,
  );

  // Merge center site and scanned candidates, keeping best distinct candidates
  const candidatePool = [centerSite, ...scannedCandidates].sort(
    (a, b) => (b.suitability.total ?? 0) - (a.suitability.total ?? 0),
  );
  const recommendedLandingSite = candidatePool[0];
  const alternativeLandingSites = candidatePool.slice(1, 4);

  const topScorePct = Math.round((recommendedLandingSite.suitability.total ?? 0) * 100);
  toolCalls.push({
    id: `tool_${Date.now()}_3`,
    stepNumber: stepCounter++,
    category: 'analysis',
    toolName: 'rank_candidate_landing_regions',
    title: `Evaluated 25 Regional Landing Zones via 7-Criterion Suitability Model`,
    inputSummary: `ROI=${spec.regionName}, priority=${spec.optimizationPriority}, slopeSafetyW=${spec.landingWeights.slopeSafety}`,
    outputSummary: `Selected #1 Landing Site "${recommendedLandingSite.name}" (${topScorePct}/100) at ${formatLatLonShort(recommendedLandingSite.lat, recommendedLandingSite.lon)} — elev ${Math.round(recommendedLandingSite.telemetry.elevationM ?? 0)} m, slope ${recommendedLandingSite.telemetry.slopeDeg?.toFixed(2) ?? 0}°`,
    durationMs: Math.max(6, Math.round(performance.now() - t3Start)),
    status: 'completed',
    dataProvenance: 'LOLA 16/128 PPD + Robbins & Hynek (2012) Crater DB + IAU Nomenclature',
  });

  // --- TOOL 4: Rover-Specific A* Route Planning & Multi-Objective Optimization ---
  const t4Start = performance.now();
  const destination = selectMissionDestination(spec, recommendedLandingSite);
  const startPt = { lat: recommendedLandingSite.lat, lon: recommendedLandingSite.lon };
  const destPt = { lat: destination.lat, lon: destination.lon };
  const distKm = Math.max(
    0.5,
    greatCircleDistance(startPt, destPt, MOON_BODY.meanRadiusM / 1000),
  );

  const padMeters = Math.max(2_200, Math.min(320_000, distKm * 1000 * 0.42));
  const rawBbox = padBBox(bboxOf([startPt, destPt]), padMeters, MOON_BODY.meanRadiusM, 88.5);
  const bestGridInfo = moonStore.getBestGridForBBox(rawBbox);
  const workGrid = downsampleGridForAgent(bestGridInfo.grid, 210);

  const routePlan = planMoonRoutes({
    grid: workGrid,
    gridSource: bestGridInfo.source,
    start: startPt,
    destination: destPt,
    roverId: spec.roverId,
    customRoverConfig: spec.roverId === 'custom' ? spec.proposedCustomRover : undefined,
    maxAllowedSlopeDeg: spec.maxAllowedSlopeDeg,
    slopeWeight: spec.slopeWeight,
    roughnessWeight: spec.roughnessWeight,
    scienceWeight: spec.scienceWeight,
    craters: moonStore.getCraters(),
    features: moonStore.getFeatures(),
  });

  const { scores: routeObjectiveScores, recommendedRouteId } = evaluateMultiObjectiveRoutes(
    spec,
    roverProfile,
    routePlan,
    bestGridInfo.nativeGsdMeters,
  );

  const winningRoute =
    routePlan.routes.find((r) => r.id === recommendedRouteId) || routePlan.routes[1] || routePlan.routes[0];
  const winningScore =
    routeObjectiveScores.find((s) => s.routeId === recommendedRouteId) || routeObjectiveScores[0];

  toolCalls.push({
    id: `tool_${Date.now()}_4`,
    stepNumber: stepCounter++,
    category: 'mission_planning',
    toolName: 'optimize_rover_mission_routes',
    title: `Computed 3D A* Traverses & Multi-Objective Optimization (${bestGridInfo.source})`,
    inputSummary: `start=(${formatLatLonShort(startPt.lat, startPt.lon)}) → dest="${destination.name}", rover="${roverProfile.name}", maxSlope=${spec.maxAllowedSlopeDeg}°`,
    outputSummary: `Recommended "${winningRoute.name}" (Objective ${winningScore.totalObjectiveScore}/100): ${winningRoute.analytics.totalDistanceKm.toFixed(2)} km, max slope ${winningRoute.analytics.maxSlopeDeg.toFixed(1)}°, +${Math.round(winningRoute.analytics.totalElevationGainM)} m climb`,
    durationMs: Math.max(10, Math.round(performance.now() - t4Start)),
    status: 'completed',
    dataProvenance: `${bestGridInfo.source} (${bestGridInfo.crsCode}, ${bestGridInfo.nativeGsdMeters} m GSD)`,
  });

  // --- TOOL 5: Direct 3D Map & Application State Synchronization ---
  const t5Start = performance.now();
  const regionalSpanDeg = Math.max(0.2, Math.min(4.5, (distKm / 59.2) * 2.2));
  const mapUpdate: MapStateUpdateCommand = {
    focusLocation: { lat: recommendedLandingSite.lat, lon: recommendedLandingSite.lon },
    viewportMode: 'regional_3d',
    regionalSpanDeg: Number(regionalSpanDeg.toFixed(2)),
    selectRoverId:
      spec.roverSource === 'custom_new' && !spec.customRoverConfirmed
        ? spec.roverId
        : spec.roverId,
    stageCustomRoverConfig: spec.proposedCustomRover,
    autoApplyCustomRover: Boolean(spec.customRoverConfirmed),
    routeStart: startPt,
    routeDestination: destPt,
    selectedRouteId: recommendedRouteId,
    maxAllowedSlopeDeg: spec.maxAllowedSlopeDeg,
    slopeWeight: spec.slopeWeight,
    roughnessWeight: spec.roughnessWeight,
    scienceWeight: spec.scienceWeight,
    landingWeights: spec.landingWeights,
    openBottomDrawerTab: 'route_profile',
  };

  toolCalls.push({
    id: `tool_${Date.now()}_5`,
    stepNumber: stepCounter++,
    category: 'map_interaction',
    toolName: 'apply_mission_to_3d_map',
    title: 'Synchronized Mission Plan with Interactive 3D Moon Terrain & Route Planner',
    inputSummary: `mode="regional_3d", span=${mapUpdate.regionalSpanDeg}°, route="${recommendedRouteId}"`,
    outputSummary: `Focused 3D terrain mesh on ${spec.regionName}, placed ${roverProfile.name} at Landing Zone, rendered 3 A* routes to ${destination.name}`,
    durationMs: Math.max(2, Math.round(performance.now() - t5Start)),
    status: 'completed',
    dataProvenance: 'TERRATWIN 3D Scene Graph & Coordinate State Controller',
  });

  // Assemble NASA Data Sources used for transparency
  const dataSourcesUsed = MOON_DATA_SOURCES.filter((ds) =>
    [
      'lola_megdr_16ppd',
      'lola_megdr_128ppd',
      'hirise_socet_dtms',
      'ctx_usgs_dtms',
      'robbins_crater_db',
      'iau_usgs_nomenclature',
    ].includes(ds.id),
  ).map((ds) => ({
    id: ds.id,
    title: ds.title,
    resolution: ds.resolution,
    crs: ds.crs,
    status: ds.status,
  }));

  const overallConfidencePct =
    bestGridInfo.lodLevel === 3 ? 96 : bestGridInfo.nativeGsdMeters <= 30 ? 89 : 78;

  const dtmCoverageNote =
    bestGridInfo.lodLevel === 3
      ? `Full Level 3 Local HiRISE SOCET SET Stereo DTM coverage (${bestGridInfo.nativeGsdMeters} m/px; ${bestGridInfo.verticalUncertaintyMeters}).`
      : bestGridInfo.nativeGsdMeters <= 30
        ? `Regional Level 2 MRO CTX Stereo DTM coverage (${bestGridInfo.nativeGsdMeters} m/px; ${bestGridInfo.verticalUncertaintyMeters}).`
        : `Evaluated on MGS LOLA altimetry (${bestGridInfo.nativeGsdMeters} m/px). Sub-decameter boulders and narrow scarps below grid spacing require HiRISE optical verification prior to operations.`;

  const terrainDifficultyLabel: MissionExecutionReport['beginnerSummary']['terrainDifficultyLabel'] =
    winningRoute.analytics.maxSlopeDeg <= 6 && winningRoute.analytics.meanTriM <= 3.5
      ? 'Easy & Flat'
      : winningRoute.analytics.maxSlopeDeg <= 14
        ? 'Moderate Hills'
        : 'Challenging Terrain';

  const spacecraftVsRoverDisclaimer =
    'Aerospace Engineering Distinction: Spacecraft Entry, Descent, and Landing (EDL) touchdown safety depends on parachute/retro-propulsion atmospheric column density (elevation ≤ −2.0 km LOLA), landing-ellipse regional slope, and boulder/crater-rim avoidance. Rover mobility specifications (wheel diameter, grouser cleats, and rocker-bogie articulation) govern post-landing surface traverse accessibility and do not substitute for EDL touchdown qualification.';

  const missionReport: MissionExecutionReport = {
    missionTitle: spec.missionTitle,
    rover: roverProfile,
    isProposedCustomRover: spec.roverSource === 'custom_new',
    proposedCustomRoverConfig: spec.proposedCustomRover,
    objectiveSummary: spec.scienceObjectiveSummary,
    recommendedLandingSite,
    alternativeLandingSites,
    spacecraftVsRoverDisclaimer,
    selectedDestination: destination,
    routePlan,
    recommendedRouteId,
    routeObjectiveScores,
    dataSourcesUsed,
    confidenceAndLimitations: {
      overallConfidencePct,
      dtmCoverageNote,
      limitations: [
        ...recommendedLandingSite.disadvantages.slice(0, 2),
        'Orbital DEM pathfinding does not model transient aeolian sand ripples or unconsolidated duricrust cohesion; onboard stereo Hazcam/ENav remains mandatory during surface drive execution.',
      ],
    },
    beginnerSummary: {
      whyThisRover: `${roverProfile.name} features ${roverProfile.wheels.count} wheels (${roverProfile.wheels.diameterCm} cm diameter) and ${roverProfile.suspension.groundClearanceCm} cm of ground clearance, giving it a safe ${roverProfile.mobilityProfile.operationalMaxSlopeDeg}° climb capability and the right science tools (${roverProfile.instruments.slice(0, 3).map((i) => i.name).join(', ')}) for your mission.`,
      whyThisLandingSite: `${recommendedLandingSite.name} scored ${topScorePct}/100 because it sits at a low elevation (${Math.round(recommendedLandingSite.telemetry.elevationM ?? 0)} m) with a thick atmosphere to slow the spacecraft down and a gentle ${recommendedLandingSite.telemetry.slopeDeg?.toFixed(1) ?? 0}° surface tilt.`,
      whyThisRoute: `The ${winningRoute.name} covers ${winningRoute.analytics.totalDistanceKm.toFixed(2)} km to ${destination.name} while keeping maximum terrain steepness to ${winningRoute.analytics.maxSlopeDeg.toFixed(1)}°—well within ${roverProfile.name}'s ${roverProfile.mobilityProfile.operationalMaxSlopeDeg}° safety limit.`,
      terrainDifficultyLabel,
    },
  };

  // Generate mode-adapted narrative explanation via Autonomous LLM Router (with guaranteed deterministic fallback)
  const deterministicNarrative = () => {
    const revHeader =
      isRevisionTurn && revisionNotes.length > 0
        ? `**Mission Revision Applied:** ${revisionNotes.join(' · ')}\n\n`
        : '';

    if (payload.experienceMode === 'beginner') {
      return (
        `${revHeader}I have analyzed the NASA orbital terrain data for **${spec.regionName}** and applied your complete mission plan directly to the **3D Moon Map**.\n\n` +
        `- **Selected Rover:** **${roverProfile.name}** (${roverProfile.wheels.count} wheels, ${roverProfile.mobilityProfile.operationalMaxSlopeDeg}° max climb limit)\n` +
        `- **Recommended Landing Zone:** **${recommendedLandingSite.name}** (**${topScorePct}/100** suitability score, ${Math.round(recommendedLandingSite.telemetry.elevationM ?? 0)} m elevation, ${recommendedLandingSite.telemetry.slopeDeg?.toFixed(1) ?? 0}° slope)\n` +
        `- **Science Destination:** **${destination.name}**\n` +
        `- **Recommended 3D Route:** **${winningRoute.name}** — **${winningRoute.analytics.totalDistanceKm.toFixed(2)} km** drive, **${winningRoute.analytics.maxSlopeDeg.toFixed(1)}°** max slope (${terrainDifficultyLabel})\n\n` +
        `Look at the 3D terrain viewport to inspect the landing marker, rover position, and color-coded exploration routes. You can ask me to adjust anything—for example: *"Find a less difficult route"*, *"Move the destination closer"*, or *"Switch to Curiosity"*.`
      );
    }

    return (
      `${revHeader}Executed deterministic multi-criteria mission synthesis for **${spec.missionTitle}** using **${bestGridInfo.source}** (${bestGridInfo.nativeGsdMeters} m GSD, ${bestGridInfo.crsCode}).\n\n` +
      `- **Vehicle & Mobility Matrix:** **${roverProfile.name}** (${roverProfile.wheels.count}× ${roverProfile.wheels.diameterCm} cm wheels, ${roverProfile.suspension.groundClearanceCm} cm clearance, operational ceiling ${roverProfile.mobilityProfile.operationalMaxSlopeDeg}°, slope factor ${roverProfile.mobilityProfile.slopePenaltyFactor}×, TRI factor ${roverProfile.mobilityProfile.roughnessPenaltyFactor}×).\n` +
      `- **EDL Touchdown vs. Surface Accessibility:** Top-ranked landing zone **${recommendedLandingSite.name}** (${formatLatLonShort(recommendedLandingSite.lat, recommendedLandingSite.lon)}) achieved **${topScorePct}/100** (LOLA elevation ${Math.round(recommendedLandingSite.telemetry.elevationM ?? 0)} m, Horn slope ${recommendedLandingSite.telemetry.slopeDeg?.toFixed(2) ?? 0}°, 25 km P95 slope ${recommendedLandingSite.regionalStats25Km.slopeP95Deg.toFixed(2)}°, TRI ${recommendedLandingSite.telemetry.triM?.toFixed(1) ?? 0} m).\n` +
      `- **Multi-Objective A* Route Optimization:** Evaluated 3 Octile A* paths to **${destination.name}** (${formatLatLonShort(destination.lat, destination.lon)}). Selected **${winningRoute.name}** with composite score **${winningScore.totalObjectiveScore}/100** (\`${winningScore.formulaText}\`), traverse length **${winningRoute.analytics.totalDistanceKm.toFixed(2)} km**, max slope **${winningRoute.analytics.maxSlopeDeg.toFixed(2)}°**, cumulative climb **+${Math.round(winningRoute.analytics.totalElevationGainM)} m**.\n\n` +
      `The 3D Moon globe, regional DEM mesh, rover placement, and elevation profile drawer have been synchronized.`
    );
  };

  const { text: narrativeText, decision } = await llmRouter.executeNarrativeOrIntentTask({
    taskCategory: 'mission_reasoning',
    systemPrompt:
      'You are the TERRATWIN Aerospace AI Mission Planning Agent. Summarize the deterministic NASA terrain, landing suitability, and A* route optimization results concisely without inventing any numbers.',
    userPrompt: JSON.stringify({
      mode: payload.experienceMode,
      isRevisionTurn,
      revisionNotes,
      missionTitle: spec.missionTitle,
      rover: roverProfile.name,
      landingSite: recommendedLandingSite.name,
      landingScore: topScorePct,
      destination: destination.name,
      recommendedRoute: winningRoute.name,
      distanceKm: winningRoute.analytics.totalDistanceKm.toFixed(2),
      maxSlopeDeg: winningRoute.analytics.maxSlopeDeg.toFixed(1),
      demSource: bestGridInfo.source,
    }),
    deterministicFallback: deterministicNarrative,
  });

  const assistantMessage: AgentChatMessage = {
    id: `agent_${Date.now()}`,
    role: 'assistant',
    timestamp: new Date().toISOString(),
    content: narrativeText,
    toolCalls,
    missionSpec: spec,
    missionReport,
    mapUpdate,
    routerDecision: decision,
  };

  return {
    message: assistantMessage,
    updatedSpec: spec,
    routerStatus: llmRouter.getStatus(),
  };
}
