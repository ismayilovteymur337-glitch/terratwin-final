/**
 * Official NASA Moon Rover Fleet & Vehicle-Specific Mobility Intelligence.
 * All physical dimensions, wheel designs, suspension architectures, and mission
 * histories are sourced from NASA / JPL official mission documentation.
 */
import { LatLon } from '../core/geo/sphere';

export type RoverId = 'perseverance' | 'curiosity' | 'opportunity' | 'spirit' | 'sojourner' | 'custom';

export interface RoverPhoto {
  url: string;
  nasaId: string;
  title: string;
  credit: string;
}

export interface RoverInstrument {
  name: string;
  fullName: string;
  role: string;
}

export interface RoverMobilityProfile {
  /** Operational slope ceiling (°) enforced in A* pathfinding before fallback relaxation. */
  operationalMaxSlopeDeg: number;
  /** Nominal comfortable cruise slope (°) below which slope penalty is minimal. */
  optimalSlopeDeg: number;
  /** Vehicle-specific multiplier applied to slope cost in A* pathfinding. */
  slopePenaltyFactor: number;
  /** Vehicle-specific multiplier applied to TRI roughness cost in A* pathfinding. */
  roughnessPenaltyFactor: number;
  /** Vulnerability of wheel skin/cleats to sharp bedrock & rugged relief. */
  rockPunctureSensitivity: 'low' | 'moderate' | 'high';
  /** Penalty multiplier near steep crater rim walls. */
  craterRimAvoidanceFactor: number;
  /** Keywords of geological features prioritized by this rover's scientific payload in Route C. */
  preferredScienceKeywords: string[];
  /** Engineering explanation of how this rover's hardware shapes route selection. */
  mobilitySummary: string;
}

export interface NasaRoverProfile {
  id: RoverId;
  name: string;
  codeName: string;
  status: 'OPERATIONAL' | 'HISTORICAL_COMPLETED';
  statusBadgeText: string;
  missionName: string;
  agency: string;
  launchDate: string;
  landingDate: string;
  missionDurationDesc: string;
  landingSiteName: string;
  landingCoords: LatLon;
  defaultRouteDest: LatLon & { label: string };
  missionObjectives: string[];
  officialPhotos: RoverPhoto[];
  model3d: {
    glbUrl?: string;
    hasAuthenticNasaGlb: boolean;
    nasa3dResourceUrl: string;
    credit: string;
    rigType: 'm2020' | 'msl' | 'mer' | 'sojourner';
  };
  dimensions: {
    lengthM: number;
    widthM: number;
    heightM: number;
    massKg: number;
    armReachM: number | null;
    powerSource: string;
    powerOutputDesc: string;
  };
  wheels: {
    count: number;
    diameterCm: number;
    widthCm: number;
    skinThicknessMm: number;
    material: string;
    grouserCount: number;
    grouserDesign: string;
  };
  suspension: {
    architecture: string;
    groundClearanceCm: number;
    maxObstacleHeightCm: number;
    staticStabilityTiltDeg: number;
  };
  steeringAndDrive: {
    driveActuators: string;
    steeredWheels: string;
    turningModes: string;
    maxHardSurfaceSpeedCmPerSec: number;
    navigationSystem: string;
  };
  instruments: RoverInstrument[];
  mobilityProfile: RoverMobilityProfile;
  officialLinks: { label: string; url: string }[];
}

export const NASA_MOON_ROVERS: NasaRoverProfile[] = [
  {
    id: 'perseverance',
    name: 'Perseverance',
    codeName: 'MOON 2020 // M2020',
    status: 'OPERATIONAL',
    statusBadgeText: 'OPERATIONAL · JEZERO CRATER',
    missionName: 'Moon 2020 Perseverance Rover',
    agency: 'NASA / Jet Propulsion Laboratory (JPL)',
    launchDate: '2020-07-30',
    landingDate: '2021-02-18',
    missionDurationDesc: 'Active in Jezero Crater & Western Rim (Feb 2021 – Present)',
    landingSiteName: 'Octavia E. Butler Landing, Jezero Crater',
    landingCoords: { lat: 18.4447, lon: 77.4508 },
    defaultRouteDest: { lat: 18.525, lon: 77.265, label: 'Neretva Vallis Western Rim' },
    missionObjectives: [
      'Seek signs of ancient microbial life (biosignatures) in Noachian–Hesperian fluvio-lacustrine environments.',
      'Core, seal, and cache rock and regolith samples for potential Moon Sample Return.',
      'Characterize Jezero Crater delta stratigraphy, volcanic floor units, and hydrothermal carbonate margins.',
      'Demonstrate In-Situ Resource Utilization (MOXIE O₂ production) and aerial scouting (Ingenuity).',
    ],
    officialPhotos: [
      {
        url: './data/rovers/perseverance_photo.jpg',
        nasaId: 'PIA23764',
        title: 'Perseverance Rover on the lunar Surface (NASA/JPL-Caltech)',
        credit: 'NASA / JPL-Caltech',
      },
      {
        url: './data/rovers/perseverance_nasa3d.png',
        nasaId: 'NASA-3D-M2020',
        title: 'Official NASA 3D CAD Model Render — Moon 2020 Perseverance',
        credit: 'NASA Visualization Technology Applications and Development (VTAD)',
      },
    ],
    model3d: {
      glbUrl: './data/rovers/perseverance.glb',
      hasAuthenticNasaGlb: true,
      nasa3dResourceUrl: 'https://science.nasa.gov/3d-resources/moon-2020-perseverance-rover/',
      credit: 'NASA / JPL-Caltech 3D Resources (Official GLB + Articulated Rocker-Bogie Rig)',
      rigType: 'm2020',
    },
    dimensions: {
      lengthM: 3.0,
      widthM: 2.7,
      heightM: 2.2,
      massKg: 1025,
      armReachM: 2.1,
      powerSource: 'MMRTG (Multi-Mission Radioisotope Thermoelectric Generator, 4.8 kg PuO₂)',
      powerOutputDesc: '~110 W electrical at landing + two Li-Ion rechargeable batteries (2 × 43 Ah)',
    },
    wheels: {
      count: 6,
      diameterCm: 52.5,
      widthCm: 33.6,
      skinThicknessMm: 1.65,
      material: 'Machined 7075-T7351 Aluminum drum with curved Titanium spring spokes',
      grouserCount: 48,
      grouserDesign:
        '48 gently curved (wavy) full-width grousers. Engineered after Curiosity wheel damage to eliminate stress-concentrating chevron corners and resist puncture on sharp rocks.',
    },
    suspension: {
      architecture: '6-Wheel Passive Rocker-Bogie with Titanium Tubing & Central Differential Pivot',
      groundClearanceCm: 60,
      maxObstacleHeightCm: 50,
      staticStabilityTiltDeg: 45,
    },
    steeringAndDrive: {
      driveActuators: '6 independent brushless DC in-hub drive motors',
      steeredWheels: '4 corner wheels (FL, FR, RL, RR) with independent ±90° steering actuators',
      turningModes: 'Ackermann arc turns, crabbing lateral motion, and 360° turn-in-place',
      maxHardSurfaceSpeedCmPerSec: 4.2,
      navigationSystem:
        'Enhanced Autonomous Navigation (ENav) with dedicated Vision Compute Element FPGA & Navcam stereo hazard meshes',
    },
    instruments: [
      { name: 'Mastcam-Z', fullName: 'Zoomable Panoramic Stereo Camera System', role: 'Multispectral stereo imaging & mineralogical reconnaissance' },
      { name: 'SuperCam', fullName: 'Laser-Induced Breakdown Spectroscopy (LIBS), Raman & Luminescence', role: 'Remote micro-imaging and elemental/mineral composition up to 7 m' },
      { name: 'PIXL', fullName: 'Planetary Instrument for X-ray Lithochemistry', role: 'Turret-mounted sub-millimeter X-ray fluorescence elemental mapping' },
      { name: 'SHERLOC', fullName: 'Scanning Habitable Environments with Raman & Luminescence for Organics & Chemicals', role: 'Deep-UV Raman & fluorescence detection of organics and astrobiological targets' },
      { name: 'RIMFAX', fullName: 'Radar Imager for Moon Subsurface Experiment', role: '150–1200 MHz ground-penetrating radar sounding stratigraphy to >10 m depth' },
      { name: 'MEDA', fullName: 'Moon Environmental Dynamics Analyzer', role: 'Pressure, temperature, wind, humidity, and radiative dust flux station' },
      { name: 'MOXIE', fullName: 'Moon Oxygen In-Situ Resource Utilization Experiment', role: 'Solid-oxide electrolysis producing O₂ from atmospheric CO₂' },
    ],
    mobilityProfile: {
      operationalMaxSlopeDeg: 24,
      optimalSlopeDeg: 6.0,
      slopePenaltyFactor: 1.0,
      roughnessPenaltyFactor: 0.85,
      rockPunctureSensitivity: 'low',
      craterRimAvoidanceFactor: 1.0,
      preferredScienceKeywords: ['delta', 'vallis', 'valles', 'palus', 'crater', 'carbonate', 'bench'],
      mobilitySummary:
        'Perseverance’s narrower (33.6 cm), larger-diameter (52.5 cm), thicker-skinned (1.65 mm) wheels with 48 curved grousers tolerate rougher bedrock (0.85× TRI penalty) and steeper delta ramps (up to 24° operational ceiling) than earlier rovers.',
    },
    officialLinks: [
      { label: 'NASA Moon 2020 Mission Page', url: 'https://science.nasa.gov/mission/moon-2020-perseverance/' },
      { label: 'NASA 3D Model Resource', url: 'https://science.nasa.gov/3d-resources/moon-2020-perseverance-rover/' },
    ],
  },
  {
    id: 'curiosity',
    name: 'Curiosity',
    codeName: 'MOON SCIENCE LAB // MSL',
    status: 'OPERATIONAL',
    statusBadgeText: 'OPERATIONAL · GALE CRATER',
    missionName: 'Moon Science Laboratory (MSL) Curiosity Rover',
    agency: 'NASA / Jet Propulsion Laboratory (JPL)',
    launchDate: '2011-11-26',
    landingDate: '2012-08-06',
    missionDurationDesc: 'Active ascending Aeolis Mons / Mount Sharp in Gale Crater (Aug 2012 – Present)',
    landingSiteName: 'Bradbury Landing, Aeolis Palus, Gale Crater',
    landingCoords: { lat: -4.5895, lon: 137.4417 },
    defaultRouteDest: { lat: -4.82, lon: 137.38, label: 'Aeolis Mons Sulfate Foothills' },
    missionObjectives: [
      'Assess whether Gale Crater ever offered environmental conditions favorable for microbial life.',
      'Investigate the clay-to-sulfate mineralogical transition ascending the 5.5 km strata of Mount Sharp.',
      'Characterize lunar surface radiation (RAD) and isotopic atmospheric evolution (SAM).',
    ],
    officialPhotos: [
      {
        url: './data/rovers/curiosity_photo.jpg',
        nasaId: 'PIA16239',
        title: 'Curiosity Rover Self-Portrait at "Rocknest" in Gale Crater (MAHLI)',
        credit: 'NASA / JPL-Caltech / MSSS',
      },
      {
        url: './data/rovers/curiosity_nasa3d.png',
        nasaId: 'NASA-3D-MSL',
        title: 'Official NASA 3D CAD Render — Moon Science Laboratory Curiosity',
        credit: 'NASA / JPL-Caltech VTAD',
      },
    ],
    model3d: {
      hasAuthenticNasaGlb: false,
      nasa3dResourceUrl: 'https://science.nasa.gov/3d-resources/curiosity-rover/',
      credit: 'NASA / JPL-Caltech MSL CAD Specification (Articulated 3D Rocker-Bogie Rig)',
      rigType: 'msl',
    },
    dimensions: {
      lengthM: 2.9,
      widthM: 2.7,
      heightM: 2.2,
      massKg: 899,
      armReachM: 2.1,
      powerSource: 'MMRTG (Multi-Mission Radioisotope Thermoelectric Generator, 4.8 kg PuO₂)',
      powerOutputDesc: '~110 W electrical at landing + two Li-Ion rechargeable batteries (2 × 42 Ah)',
    },
    wheels: {
      count: 6,
      diameterCm: 50.0,
      widthCm: 40.0,
      skinThicknessMm: 0.75,
      material: 'Single-billet machined 7075 Aluminum drum with Titanium flexures',
      grouserCount: 19,
      grouserDesign:
        '19 asymmetric chevron (zig-zag) grousers including JPL Morse-code odometry track. Thin 0.75 mm skin and chevron corners experienced fatigue punctures over cemented wind-sharpened rocks (ventifacts), prompting traction-control software updates and smooth-corridor path planning.',
    },
    suspension: {
      architecture: '6-Wheel Passive Rocker-Bogie with Titanium Differential Bar across Warm Electronics Box',
      groundClearanceCm: 66,
      maxObstacleHeightCm: 50,
      staticStabilityTiltDeg: 45,
    },
    steeringAndDrive: {
      driveActuators: '6 independent brushless DC in-wheel drive actuators with traction-control torque modulation',
      steeredWheels: '4 corner wheels (FL, FR, RL, RR) with independent ±90° steering actuators',
      turningModes: 'Ackermann arc turns and 360° turn-in-place',
      maxHardSurfaceSpeedCmPerSec: 4.0,
      navigationSystem: 'Stereo Hazcam/Navcam GESTALT hazard avoidance + Autonomous Traction Control (odometry wheel-rate matching)',
    },
    instruments: [
      { name: 'ChemCam', fullName: 'Chemistry and Camera Complex (LIBS + RMI)', role: 'Laser spectroscopy and telescopy up to 7 m' },
      { name: 'SAM', fullName: 'Sample Analysis at Moon (GCMS, TLS, QMS)', role: 'Internal laboratory analyzing organics, volatiles, and light-element isotopes' },
      { name: 'CheMin', fullName: 'Chemistry and Mineralogy X-Ray Diffraction', role: 'Quantitative mineral phase identification of drilled powders' },
      { name: 'RAD', fullName: 'Radiation Assessment Detector', role: 'High-energy galactic cosmic ray and solar energetic particle dosimetry' },
      { name: 'Mastcam', fullName: 'Mast Camera (34 mm & 100 mm focal lengths)', role: 'True-color stereo geological imaging' },
      { name: 'MAHLI & APXS', fullName: 'Moon Hand Lens Imager & Alpha Particle X-Ray Spectrometer', role: 'Contact micro-imaging and elemental chemistry' },
    ],
    mobilityProfile: {
      operationalMaxSlopeDeg: 21,
      optimalSlopeDeg: 4.5,
      slopePenaltyFactor: 1.25,
      roughnessPenaltyFactor: 1.65,
      rockPunctureSensitivity: 'high',
      craterRimAvoidanceFactor: 1.35,
      preferredScienceKeywords: ['mons', 'montes', 'vallis', 'palus', 'chasma', 'bench', 'stratigraphic'],
      mobilitySummary:
        'Curiosity’s wide (40 cm) but thin-skinned (0.75 mm) chevron wheels are sensitive to sharp bedrock ventifacts; the mobility engine applies a 1.65× TRI roughness penalty and 21° slope ceiling to route along smoother terrain corridors.',
    },
    officialLinks: [
      { label: 'NASA MSL Curiosity Mission Page', url: 'https://science.nasa.gov/mission/msl-curiosity/' },
      { label: 'NASA Curiosity 3D Resources', url: 'https://science.nasa.gov/3d-resources/curiosity-rover/' },
    ],
  },
  {
    id: 'opportunity',
    name: 'Opportunity (MER-B)',
    codeName: 'MOON EXPLORATION ROVER-B',
    status: 'HISTORICAL_COMPLETED',
    statusBadgeText: 'HISTORICAL · 2004–2018 (5,111 SOLS)',
    missionName: 'Moon Exploration Rover – Opportunity (MER-B)',
    agency: 'NASA / Jet Propulsion Laboratory (JPL)',
    launchDate: '2003-07-07',
    landingDate: '2004-01-25',
    missionDurationDesc: 'Operated 5,111 Sols (Jan 2004 – Jun 2018) across 45.16 km in Meridiani Planum',
    landingSiteName: 'Challenger Memorial Station, Eagle Crater, Meridiani Planum',
    landingCoords: { lat: -1.9462, lon: -5.5266 },
    defaultRouteDest: { lat: -2.28, lon: -5.21, label: 'Endeavour Crater Western Rim' },
    missionObjectives: [
      'Search for geological clues to past liquid water activity in the hematite-bearing plains of Meridiani Planum.',
      'Characterize evaporitic sulfate sandstones (Burns formation) and Noachian impact breccias at Endeavour Crater.',
    ],
    officialPhotos: [
      {
        url: './data/rovers/mer_photo.jpg',
        nasaId: 'PIA04413',
        title: 'Moon Exploration Rover (MER) on the lunar Surface',
        credit: 'NASA / JPL-Caltech / Cornell',
      },
      {
        url: './data/rovers/mer_nasa3d.png',
        nasaId: 'NASA-3D-MER',
        title: 'Official NASA 3D CAD Render — Moon Exploration Rover (Spirit & Opportunity)',
        credit: 'NASA / JPL-Caltech VTAD',
      },
    ],
    model3d: {
      glbUrl: './data/rovers/mer_opportunity.glb',
      hasAuthenticNasaGlb: true,
      nasa3dResourceUrl: 'https://science.nasa.gov/3d-resources/moon-exploration-rover-opportunity/',
      credit: 'NASA / JPL-Caltech 3D Resources (Official MER-B GLB + Articulated Rig)',
      rigType: 'mer',
    },
    dimensions: {
      lengthM: 1.6,
      widthM: 2.3,
      heightM: 1.5,
      massKg: 185,
      armReachM: 0.9,
      powerSource: 'Triple-Junction GaInP/GaAs/Ge Solar Array Wing Deck',
      powerOutputDesc: '~140 W peak solar (300–900 Wh/sol depending on atmospheric dust opacity τ)',
    },
    wheels: {
      count: 6,
      diameterCm: 26.0,
      widthCm: 21.5,
      skinThicknessMm: 3.25,
      material: 'Machined Aluminum outer rim with spiral Solimide/Aluminum shock-absorbing flexure spokes',
      grouserCount: 25,
      grouserDesign: '25 straight horizontal traction cleats spanning the 21.5 cm wheel width.',
    },
    suspension: {
      architecture: '6-Wheel Compact Rocker-Bogie (Rear-Bogie Configuration with Central Differential)',
      groundClearanceCm: 30,
      maxObstacleHeightCm: 25,
      staticStabilityTiltDeg: 45,
    },
    steeringAndDrive: {
      driveActuators: '6 brushed DC in-wheel gearmotors',
      steeredWheels: '4 corner wheels (FL, FR, RL, RR) with independent steering actuators',
      turningModes: 'Ackermann arc turns and 360° turn-in-place',
      maxHardSurfaceSpeedCmPerSec: 5.0,
      navigationSystem: 'GESTALT stereo vision + Visual Odometry (VO) slip detection for sand ripples',
    },
    instruments: [
      { name: 'Pancam', fullName: 'Panoramic Camera', role: 'Multispectral stereo imaging of terrain and sky opacity' },
      { name: 'Mini-TES', fullName: 'Miniature Thermal Emission Spectrometer', role: 'Infrared mineralogical identification' },
      { name: 'MB', fullName: 'Mössbauer Spectrometer', role: 'Iron-bearing mineral identification (jarosite, hematite, olivine)' },
      { name: 'APXS', fullName: 'Alpha Particle X-Ray Spectrometer', role: 'Elemental abundance analysis of rocks and soils' },
      { name: 'MI & RAT', fullName: 'Microscopic Imager & Rock Abrasion Tool', role: 'Sub-millimeter texture imaging and fresh rock grinding' },
    ],
    mobilityProfile: {
      operationalMaxSlopeDeg: 17,
      optimalSlopeDeg: 3.0,
      slopePenaltyFactor: 1.55,
      roughnessPenaltyFactor: 1.45,
      rockPunctureSensitivity: 'moderate',
      craterRimAvoidanceFactor: 1.5,
      preferredScienceKeywords: ['planum', 'crater', 'vallis', 'palus', 'bench'],
      mobilitySummary:
        'With 26 cm wheels and 30 cm ground clearance (half of Curiosity/Perseverance), Opportunity requires lower roughness (1.45× TRI penalty) and stricter slope avoidance (17° ceiling) to avoid high wheel slip in loose ripples and maintain solar deck orientation.',
    },
    officialLinks: [
      { label: 'NASA Opportunity (MER-B) Mission Page', url: 'https://science.nasa.gov/mission/mer-opportunity/' },
      { label: 'NASA Opportunity 3D Model', url: 'https://science.nasa.gov/3d-resources/moon-exploration-rover-opportunity/' },
    ],
  },
  {
    id: 'spirit',
    name: 'Spirit (MER-A)',
    codeName: 'MOON EXPLORATION ROVER-A',
    status: 'HISTORICAL_COMPLETED',
    statusBadgeText: 'HISTORICAL · 2004–2010 (2,208 SOLS)',
    missionName: 'Moon Exploration Rover – Spirit (MER-A)',
    agency: 'NASA / Jet Propulsion Laboratory (JPL)',
    launchDate: '2003-06-10',
    landingDate: '2004-01-04',
    missionDurationDesc: 'Operated 2,208 Sols (Jan 2004 – Mar 2010) across 7.73 km in Gusev Crater & Columbia Hills',
    landingSiteName: 'Columbia Memorial Station, Gusev Crater',
    landingCoords: { lat: -14.5684, lon: 175.4726 },
    defaultRouteDest: { lat: -14.82, lon: 175.78, label: 'Columbia Hills / Ma’adim Foothills' },
    missionObjectives: [
      'Investigate the basaltic floor of Gusev Crater and the ancient hydrothermally altered rocks of the Columbia Hills.',
      'Identify opaline silica and carbonate outcrops (Home Plate & Comanche) indicative of past hydrothermal activity.',
    ],
    officialPhotos: [
      {
        url: './data/rovers/spirit_photo.jpg',
        nasaId: 'PIA03253',
        title: 'Spirit Rover on Husband Hill in the Columbia Hills, Gusev Crater',
        credit: 'NASA / JPL-Caltech / Cornell',
      },
      {
        url: './data/rovers/mer_nasa3d.png',
        nasaId: 'NASA-3D-MER-A',
        title: 'Official NASA 3D CAD Render — Moon Exploration Rover (Spirit)',
        credit: 'NASA / JPL-Caltech VTAD',
      },
    ],
    model3d: {
      glbUrl: './data/rovers/mer_opportunity.glb',
      hasAuthenticNasaGlb: true,
      nasa3dResourceUrl: 'https://science.nasa.gov/3d-resources/moon-exploration-rover-spirit-and-opportunity/',
      credit: 'NASA / JPL-Caltech 3D Resources (Official MER GLB + Articulated Rig)',
      rigType: 'mer',
    },
    dimensions: {
      lengthM: 1.6,
      widthM: 2.3,
      heightM: 1.5,
      massKg: 185,
      armReachM: 0.9,
      powerSource: 'Triple-Junction GaInP/GaAs/Ge Solar Array Wing Deck',
      powerOutputDesc: '~140 W peak solar (requires winter north-facing sun tilt at −14.6°S latitude)',
    },
    wheels: {
      count: 6,
      diameterCm: 26.0,
      widthCm: 21.5,
      skinThicknessMm: 3.25,
      material: 'Machined Aluminum outer rim with spiral shock-absorbing flexure spokes',
      grouserCount: 25,
      grouserDesign: '25 straight horizontal cleats spanning 21.5 cm width; climbed Husband Hill (82 m vertical relief).',
    },
    suspension: {
      architecture: '6-Wheel Compact Rocker-Bogie (Front-Bogie / Rear-Rocker Reversible Drive)',
      groundClearanceCm: 30,
      maxObstacleHeightCm: 25,
      staticStabilityTiltDeg: 45,
    },
    steeringAndDrive: {
      driveActuators: '6 brushed DC in-wheel gearmotors',
      steeredWheels: '4 corner wheels (FL, FR, RL, RR)',
      turningModes: 'Ackermann arc turns, turn-in-place, and reverse 5-wheel drive mode',
      maxHardSurfaceSpeedCmPerSec: 5.0,
      navigationSystem: 'GESTALT stereo hazard avoidance + Visual Odometry',
    },
    instruments: [
      { name: 'Pancam', fullName: 'Panoramic Camera', role: 'High-resolution stereo color and mineralogical imaging' },
      { name: 'Mini-TES', fullName: 'Miniature Thermal Emission Spectrometer', role: 'Thermal infrared mineralogy of Gusev basalts and Columbia Hills' },
      { name: 'MB & APXS', fullName: 'Mössbauer & Alpha Particle X-Ray Spectrometers', role: 'Iron mineralogy and elemental composition' },
      { name: 'MI & RAT', fullName: 'Microscopic Imager & Rock Abrasion Tool', role: 'Micro-texture imaging and surface weathering removal' },
    ],
    mobilityProfile: {
      operationalMaxSlopeDeg: 16,
      optimalSlopeDeg: 3.0,
      slopePenaltyFactor: 1.65,
      roughnessPenaltyFactor: 1.5,
      rockPunctureSensitivity: 'moderate',
      craterRimAvoidanceFactor: 1.55,
      preferredScienceKeywords: ['colles', 'mons', 'crater', 'vallis', 'bench'],
      mobilitySummary:
        'Spirit’s 26 cm wheels, 30 cm ground clearance, and solar power constraints require conservative slope penalties (1.65×) and 16° operational slope limits while targeting elevated hydrothermal hills and outcrops.',
    },
    officialLinks: [
      { label: 'NASA Spirit (MER-A) Mission Page', url: 'https://science.nasa.gov/mission/mer-spirit/' },
      { label: 'NASA MER 3D Resources', url: 'https://science.nasa.gov/3d-resources/moon-exploration-rover-spirit-and-opportunity/' },
    ],
  },
  {
    id: 'sojourner',
    name: 'Sojourner',
    codeName: 'MOON PATHFINDER MICROROVER',
    status: 'HISTORICAL_COMPLETED',
    statusBadgeText: 'HISTORICAL · 1997 (83 SOLS · FIRST MOON ROVER)',
    missionName: 'Moon Pathfinder Microrover Flight Experiment (MFEX)',
    agency: 'NASA / Jet Propulsion Laboratory (JPL)',
    launchDate: '1996-12-04',
    landingDate: '1997-07-04',
    missionDurationDesc: 'Operated 83 Sols (Jul 1997 – Sep 1997) in Ares Vallis outwash plain (~100 m odometry)',
    landingSiteName: 'Carl Sagan Memorial Station, Ares Vallis',
    landingCoords: { lat: 19.13, lon: -33.22 },
    defaultRouteDest: { lat: 19.22, lon: -33.12, label: 'Twin Peaks / Ares Vallis Channel' },
    missionObjectives: [
      'Demonstrate the first mobile six-wheel rocker-bogie vehicle on another planet.',
      'Perform Alpha Proton X-Ray Spectrometer (APXS) chemical analyses of Ares Vallis flood boulders ("Barnacle Bill", "Yogi", "Shark").',
      'Characterize lunar soil mechanics, wheel-soil traction, and abrasion using wheel-mount experiments.',
    ],
    officialPhotos: [
      {
        url: './data/rovers/sojourner_photo.jpg',
        nasaId: 'PIA01122',
        title: 'Sojourner Rover Inspecting the "Yogi" Rock in Ares Vallis (IMP Camera)',
        credit: 'NASA / JPL',
      },
    ],
    model3d: {
      hasAuthenticNasaGlb: false,
      nasa3dResourceUrl: 'https://science.nasa.gov/mission/moon-pathfinder/',
      credit: 'NASA / JPL Moon Pathfinder MFEX Engineering Specification (Articulated 3D Microrover Rig)',
      rigType: 'sojourner',
    },
    dimensions: {
      lengthM: 0.65,
      widthM: 0.48,
      heightM: 0.3,
      massKg: 11.5,
      armReachM: null,
      powerSource: '0.22 m² Flat GaAs Solar Panel + Lithium-Thionyl Chloride (LiSOCl₂) Primary Battery',
      powerOutputDesc: '~16 W peak solar at noon (150 Wh primary non-rechargeable reserve)',
    },
    wheels: {
      count: 6,
      diameterCm: 13.0,
      widthCm: 7.9,
      skinThicknessMm: 0.2,
      material: 'Anodized Aluminum drum with 34 rows of spot-welded Stainless Steel cleats',
      grouserCount: 34,
      grouserDesign: '34 rows of aggressive stainless-steel cleats wrapped around compact 13 cm wheels for gripping small cobbles.',
    },
    suspension: {
      architecture: '6-Wheel Passive Rocker-Bogie with Central Differential Turnbuckle Linkage',
      groundClearanceCm: 13,
      maxObstacleHeightCm: 13,
      staticStabilityTiltDeg: 35,
    },
    steeringAndDrive: {
      driveActuators: '6 brushed DC motors with 2000:1 harmonic/planetary gear reduction',
      steeredWheels: '4 corner wheels (FL, FR, RL, RR) with independent steering servos',
      turningModes: 'Ackermann steering and turn-in-place',
      maxHardSurfaceSpeedCmPerSec: 1.0,
      navigationSystem: '5-Stripe Laser Triangulation + CCD Stereo Cameras + Mechanical Contact Bumpers',
    },
    instruments: [
      { name: 'APXS', fullName: 'Alpha Proton X-Ray Spectrometer', role: 'Rear-deployment sensor measuring elemental chemistry of rocks and soil' },
      { name: 'MAE', fullName: 'Materials Adherence Experiment', role: 'Quartz crystal microbalance & solar cell dust accumulation monitor' },
      { name: 'WAE', fullName: 'Wheel Abrasion Experiment', role: 'Thin-film metal strips on middle wheel measuring regolith abrasiveness' },
    ],
    mobilityProfile: {
      operationalMaxSlopeDeg: 12,
      optimalSlopeDeg: 2.0,
      slopePenaltyFactor: 2.4,
      roughnessPenaltyFactor: 2.5,
      rockPunctureSensitivity: 'moderate',
      craterRimAvoidanceFactor: 2.2,
      preferredScienceKeywords: ['vallis', 'valles', 'palus', 'plain', 'bench'],
      mobilitySummary:
        'As a 0.65 m, 11.5 kg microrover with 13 cm wheels and 13 cm ground clearance, Sojourner has a strict 12° operational slope ceiling and 2.5× TRI roughness penalty, strongly favoring flat valley floors and outwash plains.',
    },
    officialLinks: [
      { label: 'NASA Moon Pathfinder / Sojourner Mission Page', url: 'https://science.nasa.gov/mission/moon-pathfinder/' },
    ],
  },
];

export interface CustomRoverConfig {
  name: string;
  wheelCount: 4 | 6 | 8;
  wheelDiameterCm: number; // 18 .. 60 cm
  grouserType: 'curved' | 'chevron' | 'straight';
  suspensionType: 'rocker_bogie' | 'independent_strut' | 'twin_bogie';
  chassisSize: 'compact' | 'midsize' | 'flagship';
  powerSource: 'mmrtg' | 'solar';
  instrumentIds: string[];
}

export const CUSTOM_INSTRUMENT_CATALOG: Array<{
  id: string;
  name: string;
  fullName: string;
  role: string;
  massKg: number;
  beginnerDesc: string;
  scienceKeywords: string[];
}> = [
  {
    id: 'mastcam_stereo',
    name: 'Mastcam-3D',
    fullName: 'High-Resolution Zoomable Stereo Panoramic Camera',
    role: '3D color landscape photography, distant outcrop reconnaissance, and geological mapping',
    massKg: 4.5,
    beginnerDesc: 'Acts as the rover’s "eyes" on a tall mast, taking sharp 3D color photos of distant hills, craters, and layered rocks.',
    scienceKeywords: ['delta', 'crater', 'mons', 'vallis', 'bench'],
  },
  {
    id: 'libs_laser',
    name: 'ChemLaser-UV',
    fullName: 'Laser-Induced Breakdown & Deep-UV Raman Spectrometer',
    role: 'Vaporizes rock targets up to 7 m away to read elemental chemistry and organic biosignatures',
    massKg: 10.6,
    beginnerDesc: 'Fires a focused laser pulse at rocks up to 7 meters away and reads the glowing plasma flash to tell what minerals they are made of.',
    scienceKeywords: ['carbonate', 'vallis', 'delta', 'palus'],
  },
  {
    id: 'gpr_radar',
    name: 'SubSurface-GPR',
    fullName: 'Ground-Penetrating Subsurface Radar Sounder',
    role: 'Maps buried bedrock layers, ice lenses, and ancient channels up to 15 m underground',
    massKg: 3.2,
    beginnerDesc: 'Sends radio waves deep into the ground as the rover drives, revealing hidden rock layers and buried ice beneath the dust.',
    scienceKeywords: ['planum', 'palus', 'vallis', 'delta'],
  },
  {
    id: 'core_drill',
    name: 'CoreDrill-Arm',
    fullName: 'Turret Rotary-Percussive Coring Drill & Sample Cache',
    role: 'Extracts and seals chalk-sized rock cores for astrobiological and mineralogical analysis',
    massKg: 28.0,
    beginnerDesc: 'A strong robotic arm with a rock drill that collects and seals samples from ancient lakebeds so scientists can study them.',
    scienceKeywords: ['delta', 'crater', 'bench', 'stratigraphic'],
  },
  {
    id: 'weather_rad',
    name: 'AtmoRad-Station',
    fullName: 'Moon Environmental & Surface Radiation Dosimeter Suite',
    role: 'Measures wind, dust storms, temperature, pressure, and cosmic radiation safety for future astronauts',
    massKg: 5.5,
    beginnerDesc: 'A complete lunar weather and radiation station that checks wind speeds, temperature swings, and astronaut radiation levels.',
    scienceKeywords: ['mons', 'planum', 'palus'],
  },
  {
    id: 'isru_moxie',
    name: 'OxyGen-ISRU',
    fullName: 'Solid-Oxide Atmospheric CO₂-to-Oxygen Electrolysis Unit',
    role: 'Converts lunar carbon dioxide atmosphere into breathable O₂ and rocket propellant oxidizer',
    massKg: 17.1,
    beginnerDesc: 'Breathes in Moon’s thin carbon-dioxide air and chemically splits it to make pure, breathable oxygen for future human missions.',
    scienceKeywords: ['planum', 'palus', 'crater'],
  },
];

export const DEFAULT_CUSTOM_ROVER_CONFIG: CustomRoverConfig = {
  name: 'Ares Explorer X-1',
  wheelCount: 6,
  wheelDiameterCm: 54,
  grouserType: 'curved',
  suspensionType: 'rocker_bogie',
  chassisSize: 'flagship',
  powerSource: 'mmrtg',
  instrumentIds: ['mastcam_stereo', 'libs_laser', 'gpr_radar', 'core_drill'],
};

let activeCustomRoverConfig: CustomRoverConfig = { ...DEFAULT_CUSTOM_ROVER_CONFIG };

export function setGlobalCustomRoverConfig(cfg: CustomRoverConfig): NasaRoverProfile {
  activeCustomRoverConfig = { ...cfg };
  return buildCustomRoverProfile(activeCustomRoverConfig);
}

export function getGlobalCustomRoverConfig(): CustomRoverConfig {
  return activeCustomRoverConfig;
}

export function buildCustomRoverProfile(config: CustomRoverConfig = activeCustomRoverConfig): NasaRoverProfile {
  const wheelCount = config.wheelCount;
  const diamCm = Math.max(18, Math.min(65, config.wheelDiameterCm));
  const widthCm = Math.round(diamCm * 0.64 * 10) / 10;

  const sizeSpecs =
    config.chassisSize === 'compact'
      ? { lengthM: 1.4, widthM: 1.3, heightM: 1.2, baseMassKg: 145, armReachM: 0.8 }
      : config.chassisSize === 'midsize'
        ? { lengthM: 2.2, widthM: 2.0, heightM: 1.7, baseMassKg: 460, armReachM: 1.5 }
        : { lengthM: 3.1, widthM: 2.8, heightM: 2.2, baseMassKg: 940, armReachM: 2.2 };

  const selectedInstruments = CUSTOM_INSTRUMENT_CATALOG.filter((inst) =>
    config.instrumentIds.includes(inst.id),
  );
  const effectiveInstruments =
    selectedInstruments.length > 0 ? selectedInstruments : [CUSTOM_INSTRUMENT_CATALOG[0]];

  const payloadMassKg = effectiveInstruments.reduce((acc, i) => acc + i.massKg, 0);
  const wheelMassKg = wheelCount * (diamCm * 0.38);
  const powerMassKg = config.powerSource === 'mmrtg' ? 45 : 18;
  const totalMassKg = Math.round(sizeSpecs.baseMassKg + payloadMassKg + wheelMassKg + powerMassKg);

  // Suspension & wheel diameter govern ground clearance, max obstacle height, and slope limit
  const suspMultiplier =
    config.suspensionType === 'rocker_bogie'
      ? 1.12
      : config.suspensionType === 'twin_bogie'
        ? 1.02
        : 0.85;

  const groundClearanceCm = Math.round(diamCm * 1.12 * suspMultiplier);
  const maxObstacleHeightCm = Math.round(
    diamCm * (config.suspensionType === 'rocker_bogie' ? 0.96 : config.suspensionType === 'twin_bogie' ? 0.82 : 0.62),
  );

  // Operational max slope (°): larger wheels + 6/8-wheel rocker-bogie + MMRTG torque increase climb ceiling
  const baseSlope =
    12 +
    ((diamCm - 18) / 42) * 9.5 +
    (wheelCount === 6 ? 2.5 : wheelCount === 8 ? 3.2 : -1.5) +
    (config.suspensionType === 'rocker_bogie' ? 2.2 : config.suspensionType === 'twin_bogie' ? 1.0 : -1.8) +
    (config.powerSource === 'mmrtg' ? 1.2 : -0.8);

  const operationalMaxSlopeDeg = Math.round(Math.max(12, Math.min(27, baseSlope)));
  const optimalSlopeDeg = Math.round((operationalMaxSlopeDeg * 0.25) * 10) / 10;

  // Roughness penalty factor: curved titanium grousers + large wheels + 6/8 wheels reduce roughness penalty
  const grouserFactor =
    config.grouserType === 'curved' ? 0.82 : config.grouserType === 'straight' ? 1.12 : 1.45;
  const wheelSizeRoughFactor = 1.35 - ((diamCm - 18) / 42) * 0.55;
  const wheelCountRoughFactor = wheelCount === 8 ? 0.88 : wheelCount === 6 ? 0.95 : 1.25;
  const roughnessPenaltyFactor =
    Math.round(Math.max(0.65, Math.min(2.4, grouserFactor * wheelSizeRoughFactor * wheelCountRoughFactor)) * 100) / 100;

  const slopePenaltyFactor =
    Math.round(Math.max(0.75, Math.min(2.2, (24 / operationalMaxSlopeDeg) * (config.powerSource === 'solar' ? 1.18 : 0.95))) * 100) / 100;

  const rockPunctureSensitivity: 'low' | 'moderate' | 'high' =
    config.grouserType === 'curved' && diamCm >= 42
      ? 'low'
      : config.grouserType === 'chevron'
        ? 'high'
        : 'moderate';

  const suspName =
    config.suspensionType === 'rocker_bogie'
      ? `${wheelCount}-Wheel Passive Rocker-Bogie Differential Linkage`
      : config.suspensionType === 'twin_bogie'
        ? `${wheelCount}-Wheel Articulated Twin-Bogie Chassis`
        : `${wheelCount}-Wheel Independent Wishbone Strut Suspension`;

  const grouserDesc =
    config.grouserType === 'curved'
      ? '48 curved titanium-flexure grousers engineered to resist sharp bedrock punctures and maximize grip on slopes.'
      : config.grouserType === 'chevron'
        ? '20 high-bite chevron cleats optimized for loose regolith and sand dunes (higher sensitivity on sharp ventifacts).'
        : '28 straight horizontal aluminum cleats providing balanced traction across planar plains and shallow ripples.';

  const scienceKeywords = Array.from(
    new Set(effectiveInstruments.flatMap((i) => i.scienceKeywords)),
  );

  return {
    id: 'custom',
    name: config.name.trim() || 'Custom Moon Rover',
    codeName: `CUSTOM // ${wheelCount}W-${diamCm}CM`,
    status: 'OPERATIONAL',
    statusBadgeText: `CUSTOM DESIGN · ${wheelCount} WHEELS · ${operationalMaxSlopeDeg}° MAX SLOPE`,
    missionName: `${config.name.trim() || 'Custom Rover'} — User-Engineered Moon Architecture`,
    agency: 'TERRATWIN Virtual Rover Engineering Lab',
    launchDate: '2026-CUSTOM',
    landingDate: 'Active Simulation',
    missionDurationDesc: `Custom ${config.chassisSize.toUpperCase()} vehicle (${totalMassKg} kg, ${config.powerSource === 'mmrtg' ? 'MMRTG Nuclear' : 'Solar Wing Array'})`,
    landingSiteName: 'Octavia E. Butler Landing, Jezero Crater (Configurable)',
    landingCoords: { lat: 18.4447, lon: 77.4508 },
    defaultRouteDest: { lat: 18.472, lon: 77.412, label: 'Jezero Western Delta Front' },
    missionObjectives: [
      `Custom-engineered ${wheelCount}-wheel rover with ${diamCm} cm wheels and ${suspName}.`,
      `Configured with ${effectiveInstruments.length} scientific instruments (${effectiveInstruments.map((i) => i.name).join(', ')}).`,
      `Designed for up to ${operationalMaxSlopeDeg}° slopes, ${maxObstacleHeightCm} cm rock obstacles, and ${roughnessPenaltyFactor}× TRI roughness sensitivity.`,
    ],
    officialPhotos: [
      {
        url: './data/rovers/perseverance_nasa3d.png',
        nasaId: 'CUSTOM-ROVER-3D',
        title: `${config.name || 'Custom Rover'} — Parametric 3D Engineering Configuration`,
        credit: 'TERRATWIN Virtual Rover Designer (Grounded on NASA/JPL Mobility Scaling)',
      },
    ],
    model3d: {
      hasAuthenticNasaGlb: false,
      nasa3dResourceUrl: 'https://science.nasa.gov/3d-resources/',
      credit: `TERRATWIN Parametric 3D ${wheelCount}-Wheel Articulated Rig`,
      rigType: config.chassisSize === 'compact' ? 'mer' : 'm2020',
    },
    dimensions: {
      lengthM: sizeSpecs.lengthM,
      widthM: sizeSpecs.widthM,
      heightM: sizeSpecs.heightM,
      massKg: totalMassKg,
      armReachM: sizeSpecs.armReachM,
      powerSource:
        config.powerSource === 'mmrtg'
          ? 'MMRTG Radioisotope Thermoelectric Generator (Continuous Day/Night Power)'
          : 'High-Efficiency Triple-Junction GaAs Solar Array Deck',
      powerOutputDesc:
        config.powerSource === 'mmrtg'
          ? '~115 W continuous day/night electrical output + dual Li-Ion batteries'
          : '~150 W peak midday solar output (dependent on dust factor & latitude)',
    },
    wheels: {
      count: wheelCount,
      diameterCm: diamCm,
      widthCm,
      skinThicknessMm: config.grouserType === 'curved' ? 1.7 : config.grouserType === 'straight' ? 1.4 : 0.85,
      material: 'Machined 7075 Aluminum drum with Titanium spring spokes',
      grouserCount: config.grouserType === 'curved' ? 48 : config.grouserType === 'straight' ? 28 : 20,
      grouserDesign: grouserDesc,
    },
    suspension: {
      architecture: suspName,
      groundClearanceCm,
      maxObstacleHeightCm,
      staticStabilityTiltDeg: config.suspensionType === 'rocker_bogie' ? 45 : 38,
    },
    steeringAndDrive: {
      driveActuators: `${wheelCount} independent brushless DC in-hub drive motors`,
      steeredWheels: '4 outer corner wheels with ±90° independent steering actuators',
      turningModes: 'Ackermann arc turns, crabbing motion, and 360° turn-in-place',
      maxHardSurfaceSpeedCmPerSec: config.chassisSize === 'compact' ? 5.2 : 4.5,
      navigationSystem: 'Stereo Navcam/Hazcam 3D Hazard Mesh + Autonomous Path Tracker',
    },
    instruments: effectiveInstruments.map((i) => ({
      name: i.name,
      fullName: i.fullName,
      role: i.role,
    })),
    mobilityProfile: {
      operationalMaxSlopeDeg,
      optimalSlopeDeg,
      slopePenaltyFactor,
      roughnessPenaltyFactor,
      rockPunctureSensitivity,
      craterRimAvoidanceFactor: Math.round((slopePenaltyFactor * 1.05) * 100) / 100,
      preferredScienceKeywords: scienceKeywords.length > 0 ? scienceKeywords : ['delta', 'crater', 'vallis'],
      mobilitySummary: `${config.name || 'Custom Rover'} combines ${wheelCount} × ${diamCm} cm wheels (${config.grouserType} cleats) with ${suspName}, achieving ${groundClearanceCm} cm clearance, a ${operationalMaxSlopeDeg}° operational slope ceiling, and a ${roughnessPenaltyFactor}× TRI roughness penalty in A* pathfinding.`,
    },
    officialLinks: [
      { label: 'NASA 3D Rover Resources', url: 'https://science.nasa.gov/3d-resources/' },
    ],
  };
}

export interface RoverBeginnerGuide {
  whatDesignedToDo: string;
  howManyWheelsAndWhy: string;
  howItMovesOverRocks: string;
  whatScienceItPerforms: string;
  whatMakesItDifferent: string;
}

export function getRoverBeginnerGuide(rover: NasaRoverProfile): RoverBeginnerGuide {
  if (rover.id === 'perseverance') {
    return {
      whatDesignedToDo:
        'Perseverance is NASA’s newest flagship astrobiology robot. It landed in Jezero Crater—an ancient lakebed—to search for signs of past microbial life and seal rock cores for future return to Earth.',
      howManyWheelsAndWhy:
        'It has 6 large aluminum wheels (52.5 cm diameter). Six wheels spread the rover’s 1,025 kg weight evenly and allow four corner wheels to steer independently so it can spin 360° in place.',
      howItMovesOverRocks:
        'It uses a Rocker-Bogie suspension—a seesaw-like titanium linkage without springs—that keeps all 6 wheels pressed firmly on the ground even when climbing over boulders up to 50 cm tall.',
      whatScienceItPerforms:
        'It carries 7 science instruments, including 3D zoom cameras (Mastcam-Z), a rock-vaporizing laser (SuperCam), ground-penetrating radar (RIMFAX), a sample drill, and an oxygen generator (MOXIE).',
      whatMakesItDifferent:
        'After Curiosity’s wheels were punctured by sharp rocks, engineers gave Perseverance thicker, slightly narrower wheels with 48 wavy cleats—making it the strongest, most rock-resistant rover on Moon.',
    };
  }
  if (rover.id === 'curiosity') {
    return {
      whatDesignedToDo:
        'Curiosity is a car-sized mobile chemistry laboratory exploring Gale Crater and climbing the 5.5 km slopes of Mount Sharp to discover how Moon changed from a wet world into a dry desert.',
      howManyWheelsAndWhy:
        'It has 6 wide aluminum wheels (50 cm diameter, 40 cm wide) driven by individual electric motors inside each wheel hub.',
      howItMovesOverRocks:
        'Its 6-wheel Rocker-Bogie suspension gives it 66 cm of ground clearance and keeps the rover stable up to 45° of tilt, though mission planners keep drives under 21° for safety.',
      whatScienceItPerforms:
        'It carries an internal chemistry lab (SAM & CheMin) that bakes and X-rays drilled rock powder, a laser spectrometer (ChemCam), and a radiation detector (RAD) that helps plan human exploration.',
      whatMakesItDifferent:
        'Curiosity’s zig-zag chevron wheel skins are very thin (0.75 mm) and suffered punctures on sharp wind-carved rocks, so its route planner actively avoids rough terrain in favor of smoother corridors.',
    };
  }
  if (rover.id === 'opportunity') {
    return {
      whatDesignedToDo:
        'Opportunity was a solar-powered geologist robot designed for a 90-day mission in Meridiani Planum—and instead explored Moon for over 14 years (5,111 lunar days) and drove 45 km!',
      howManyWheelsAndWhy:
        'It has 6 medium-sized wheels (26 cm diameter—about half the size of Perseverance’s wheels) with shock-absorbing spiral spokes.',
      howItMovesOverRocks:
        'Its compact Rocker-Bogie suspension can climb rocks up to 25 cm high, but because of its smaller wheels and solar panels, it avoids steep slopes above 17° and deep sand ripples.',
      whatScienceItPerforms:
        'Using panoramic cameras, spectrometers, and a Rock Abrasion Tool (RAT), it discovered "blueberries" (hematite spheres) that proved liquid water once soaked the lunar ground.',
      whatMakesItDifferent:
        'Opportunity holds the off-Earth driving distance marathon record on Moon (45.16 km), relying on sunlight and careful low-slope routing across flat plains.',
    };
  }
  if (rover.id === 'spirit') {
    return {
      whatDesignedToDo:
        'Spirit was Opportunity’s twin solar-powered geologist rover, sent to Gusev Crater where it became the first robot to climb a lunar mountain (Husband Hill in the Columbia Hills).',
      howManyWheelsAndWhy:
        'It has 6 aluminum wheels (26 cm diameter) with 25 straight traction cleats per wheel.',
      howItMovesOverRocks:
        'Its Rocker-Bogie suspension allowed it to climb rocky hills, and when one front wheel motor failed later in the mission, Spirit drove backward dragging the wheel while still making discoveries!',
      whatScienceItPerforms:
        'Spirit discovered pure silica deposits at "Home Plate"—strong evidence of ancient hot springs or steam vents that could have supported microbial life.',
      whatMakesItDifferent:
        'Because Spirit operated in the southern hemisphere and relied on solar wings, it needed careful slope planning (under 16°) and winter parking on north-facing slopes to catch sunlight.',
    };
  }
  if (rover.id === 'sojourner') {
    return {
      whatDesignedToDo:
        'Sojourner was history’s very first Moon rover (1997 Moon Pathfinder mission)—a microwave-oven-sized pioneer that proved six-wheeled robots could rove across another planet.',
      howManyWheelsAndWhy:
        'It has 6 tiny 13 cm wheels studded with stainless-steel cleats, weighing only 11.5 kg in total.',
      howItMovesOverRocks:
        'Even at miniature scale, Sojourner pioneered the 6-wheel Rocker-Bogie suspension, allowing it to crawl over 13 cm cobbles in the ancient Ares Vallis flood plain.',
      whatScienceItPerforms:
        'It pressed an X-ray sensor (APXS) against flood boulders like "Barnacle Bill" and "Yogi" to measure their chemical makeup and tested how lunar dust sticks to solar cells.',
      whatMakesItDifferent:
        'Because it is only 30 cm tall with 13 cm clearance, Sojourner cannot climb steep hills (12° limit) or cross large boulder fields—requiring the gentlest routes of any rover.',
    };
  }
  return {
    whatDesignedToDo: `Your custom-designed ${rover.name} is tailored for lunar surface exploration with ${rover.wheels.count} wheels and ${rover.instruments.length} onboard scientific instruments.`,
    howManyWheelsAndWhy: `Configured with ${rover.wheels.count} wheels (${rover.wheels.diameterCm} cm diameter each). More wheels and larger diameters improve weight distribution and obstacle climbing.`,
    howItMovesOverRocks: `Uses a ${rover.suspension.architecture} providing ${rover.suspension.groundClearanceCm} cm of ground clearance to step over rocks up to ${rover.suspension.maxObstacleHeightCm} cm tall.`,
    whatScienceItPerforms: `Equipped with ${rover.instruments.map((i) => i.name).join(', ')} to analyze lunar geology, subsurface layers, and atmospheric conditions.`,
    whatMakesItDifferent: `Your engineering choices give this rover a ${rover.mobilityProfile.operationalMaxSlopeDeg}° maximum safe slope limit and a ${rover.mobilityProfile.roughnessPenaltyFactor}× rough-terrain sensitivity factor during route calculation.`,
  };
}

export function getRoverById(id: string | undefined, customConfig?: CustomRoverConfig): NasaRoverProfile {
  if (id === 'custom') {
    return buildCustomRoverProfile(customConfig ?? activeCustomRoverConfig);
  }
  return NASA_MOON_ROVERS.find((r) => r.id === id) ?? NASA_MOON_ROVERS[0];
}

export const getRoverProfile = getRoverById;


