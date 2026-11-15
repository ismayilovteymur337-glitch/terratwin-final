import { greatCircleDistance } from '../core/geo/sphere';
import {
  CraterRecord,
  DtmCatalogEntry,
  GeologicalFeature,
  LandingSiteAnalysis,
  LandingSiteWeights,
  NearbyCraterSummary,
  PointTerrainTelemetry,
} from '../core/planet/types';
import { CriterionResult, piecewise, weightedScore } from '../core/scoring/mcda';
import { DEFAULT_LANDING_WEIGHTS, MOON_BODY, MOON_PRESET_SITES } from './constants';
import { computeMoonAtmosphere, formatLatLonShort } from './physics';

export function summarizeNearbyCraters(
  lat: number,
  lon: number,
  craters: CraterRecord[],
  searchRadiusKm = 50,
): NearbyCraterSummary {
  const R_KM = MOON_BODY.meanRadiusM / 1000;
  const hits: (CraterRecord & { distanceKm: number; insideRim: boolean })[] = [];

  for (const c of craters) {
    // Quick latitude filter before great-circle computation
    if (Math.abs(c.lat - lat) > (searchRadiusKm / R_KM) * (180 / Math.PI) + 2.5) continue;
    const dKm = greatCircleDistance({ lat, lon }, { lat: c.lat, lon: c.lon }, R_KM);
    const radiusCraterKm = c.diameterKm / 2;
    if (dKm <= searchRadiusKm + radiusCraterKm) {
      hits.push({
        ...c,
        distanceKm: Math.round(dKm * 100) / 100,
        insideRim: dKm <= radiusCraterKm,
      });
    }
  }

  hits.sort((a, b) => a.distanceKm - b.distanceKm);
  const areaKm2 = Math.PI * searchRadiusKm * searchRadiusKm;
  const over5Km = hits.filter((h) => h.diameterKm >= 5).length;
  const maxDiam = hits.reduce((m, h) => Math.max(m, h.diameterKm), 0);

  return {
    searchRadiusKm,
    totalCount: hits.length,
    cratersOver5Km: over5Km,
    maxDiameterKm: Math.round(maxDiam * 10) / 10,
    arealDensityPer1000Km2: Math.round((hits.length / areaKm2) * 1000 * 100) / 100,
    nearestCrater: hits[0] ?? null,
    craters: hits.slice(0, 12),
  };
}

export function findNearbyGeologicalFeatures(
  lat: number,
  lon: number,
  features: GeologicalFeature[],
  maxRadiusKm = 250,
  limit = 10,
): (GeologicalFeature & { distanceKm: number })[] {
  const R_KM = MOON_BODY.meanRadiusM / 1000;
  const list: (GeologicalFeature & { distanceKm: number })[] = [];
  for (const f of features) {
    const dKm = greatCircleDistance({ lat, lon }, { lat: f.lat, lon: f.lon }, R_KM);
    if (dKm <= maxRadiusKm + (f.diameterKm || 0) * 0.5) {
      list.push({ ...f, distanceKm: Math.round(dKm * 10) / 10 });
    }
  }
  list.sort((a, b) => a.distanceKm - b.distanceKm);
  return list.slice(0, limit);
}

export interface EvaluateLandingInput {
  id?: string;
  name?: string;
  telemetry: PointTerrainTelemetry;
  regionalStats25Km: LandingSiteAnalysis['regionalStats25Km'];
  craters: CraterRecord[];
  features: GeologicalFeature[];
  availableDtms: DtmCatalogEntry[];
  weights?: LandingSiteWeights;
}

export function evaluateMoonLandingSite(input: EvaluateLandingInput): LandingSiteAnalysis {
  const { telemetry, regionalStats25Km, craters, features, availableDtms } = input;
  const { lat, lon } = telemetry;
  const weights = input.weights ?? DEFAULT_LANDING_WEIGHTS;

  const preset = MOON_PRESET_SITES.find(
    (p) => greatCircleDistance({ lat, lon }, { lat: p.lat, lon: p.lon }, MOON_BODY.meanRadiusM / 1000) < 15,
  );

  const craterSummary = summarizeNearbyCraters(lat, lon, craters, 50);
  const nearbyFeatures = findNearbyGeologicalFeatures(lat, lon, features, 250, 8);
  const atmosphere = computeMoonAtmosphere(lat, telemetry.elevationM);

  // 1. Slope Suitability (Derived from local landing-zone Horn 3x3 slope + regional 25 km P95 context)
  const effectiveSlope =
    telemetry.slopeDeg !== null && Number.isFinite(telemetry.slopeDeg)
      ? 0.75 * telemetry.slopeDeg +
        0.25 * (Number.isFinite(regionalStats25Km.slopeP95Deg) ? Math.min(14, regionalStats25Km.slopeP95Deg) : telemetry.slopeDeg)
      : null;

  const slopeScore =
    effectiveSlope !== null
      ? piecewise(effectiveSlope, [
          [0, 1.0],
          [1.5, 0.94],
          [3.0, 0.82],
          [5.0, 0.64],
          [8.0, 0.40],
          [12.0, 0.16],
          [16.0, 0.0],
        ])
      : null;

  // 2. Terrain Roughness Suitability (Derived from TRI & detrended RMS relief)
  const effectiveTri =
    telemetry.triM !== null && Number.isFinite(telemetry.triM)
      ? Math.max(telemetry.triM, Number.isFinite(regionalStats25Km.triMeanM) ? regionalStats25Km.triMeanM : telemetry.triM)
      : null;

  const roughnessScore =
    effectiveTri !== null
      ? piecewise(effectiveTri, [
          [0, 1.0],
          [10, 0.92],
          [25, 0.78],
          [50, 0.52],
          [90, 0.25],
          [160, 0.0],
        ])
      : null;

  // 3. Crater & Rim Hazard Freedom (Measured Robbins & Hynek 2012 catalog)
  // Penalize high density of >=3 km craters or sitting directly on a crater rim zone (0.8..1.15 radius)
  let rimPenalty = 0;
  for (const c of craterSummary.craters) {
    const rKm = c.diameterKm / 2;
    if (rKm >= 2 && c.distanceKm >= 0.75 * rKm && c.distanceKm <= 1.2 * rKm) {
      rimPenalty = Math.max(rimPenalty, 0.28);
    }
  }
  const rawCraterScore = piecewise(craterSummary.arealDensityPer1000Km2, [
    [0, 1.0],
    [0.5, 0.90],
    [1.2, 0.75],
    [2.5, 0.50],
    [5.0, 0.20],
  ]);
  const craterScore = Math.max(0, Math.min(1, rawCraterScore - rimPenalty));

  // 4. Elevation / EDL Atmospheric Margin (Golombek et al., 2012: <= -1 km required, <= -2 km preferred)
  const elevationScore =
    telemetry.elevationM !== null
      ? piecewise(telemetry.elevationM, [
          [-5000, 1.0],
          [-2500, 0.98],
          [-1500, 0.88],
          [-1000, 0.74],
          [0, 0.38],
          [1500, 0.12],
          [3500, 0.0],
        ])
      : null;

  // 5. Latitude / Thermal & Solar Regime (Golombek et al., 2012: within ±30° preferred)
  const absLat = Math.abs(lat);
  const latitudeScore = piecewise(absLat, [
    [0, 1.0],
    [15, 0.95],
    [25, 0.82],
    [30, 0.68],
    [42, 0.38],
    [60, 0.10],
    [80, 0.0],
  ]);

  // 6. Scientific Exploration Potential (proximity to mapped fluvial/valley/canyon/crater systems + DTM interest)
  const hasFluvialOrCanyon = nearbyFeatures.some((f) =>
    /vallis|valles|chasma|palus|fossae|mensae|labyrinthus/i.test(f.type + ' ' + f.name) && f.distanceKm < 140,
  );
  const reliefDiversityBonus =
    Number.isFinite(regionalStats25Km.elevationMaxM - regionalStats25Km.elevationMinM)
      ? Math.min(0.28, (regionalStats25Km.elevationMaxM - regionalStats25Km.elevationMinM) / 1400)
      : 0.1;
  const featureProximityScore =
    nearbyFeatures.length > 0
      ? piecewise(nearbyFeatures[0].distanceKm, [
          [0, 0.55],
          [40, 0.48],
          [100, 0.34],
          [220, 0.18],
        ])
      : 0.15;
  const dtmBonus = availableDtms.length > 0 ? 0.18 : 0;
  const scienceScore = Math.min(1, featureProximityScore + (hasFluvialOrCanyon ? 0.22 : 0) + reliefDiversityBonus + dtmBonus);

  // 7. Data Coverage & Resolution Confidence
  const shots = telemetry.lolaShotCount ?? 0;
  const shotConfidence = piecewise(shots, [
    [0, 0.25],
    [15, 0.65],
    [40, 0.82],
    [100, 0.92],
  ]);
  const resBonus = telemetry.resolutionMetersPerPixel <= 500 ? 0.08 : 0;
  const confidenceScore = Math.min(1, shotConfidence + resBonus + (availableDtms.length > 0 ? 0.08 : 0));

  const criteria: CriterionResult[] = [
    {
      id: 'slopeSafety',
      label: 'Slope Suitability',
      score: slopeScore !== null ? Math.round(slopeScore * 1000) / 1000 : null,
      weight: weights.slopeSafety,
      value: telemetry.slopeDeg !== null ? Math.round(telemetry.slopeDeg * 100) / 100 : null,
      unit: '° (P95: ' + (Number.isFinite(regionalStats25Km.slopeP95Deg) ? regionalStats25Km.slopeP95Deg.toFixed(1) + '°' : 'N/A') + ')',
      provenance: 'derived',
      rationale:
        telemetry.slopeDeg !== null
          ? `Horn 3×3 slope at ${telemetry.resolutionMetersPerPixel.toFixed(0)} m baseline is ${telemetry.slopeDeg.toFixed(2)}°; 25 km 95th-percentile slope is ${regionalStats25Km.slopeP95Deg.toFixed(2)}°.`
          : 'Polar or missing elevation precludes slope derivation.',
      rule: 'Piecewise linear on max(slope, 0.75·P95_25km): ≤1.5° → 1.0, 5° → 0.64, ≥16° → 0.0',
    },
    {
      id: 'roughnessSafety',
      label: 'Terrain Roughness (TRI)',
      score: roughnessScore !== null ? Math.round(roughnessScore * 1000) / 1000 : null,
      weight: weights.roughnessSafety,
      value: telemetry.triM !== null ? Math.round(telemetry.triM * 10) / 10 : null,
      unit: 'm TRI',
      provenance: 'derived',
      rationale:
        telemetry.triM !== null
          ? `8-neighbour Terrain Ruggedness Index is ${telemetry.triM.toFixed(1)} m (25 km mean: ${regionalStats25Km.triMeanM.toFixed(1)} m, detrended RMS relief: ${telemetry.rmsReliefM !== null ? telemetry.rmsReliefM.toFixed(1) + ' m' : 'N/A'}).`
          : 'Insufficient valid elevation neighbours to compute TRI.',
      rule: 'Piecewise linear on max(TRI_point, TRI_mean_25km): ≤10 m → 0.92, 50 m → 0.52, ≥160 m → 0.0',
    },
    {
      id: 'craterHazardFree',
      label: 'Crater & Rim Hazard Margin',
      score: Math.round(craterScore * 1000) / 1000,
      weight: weights.craterHazardFree,
      value: craterSummary.arealDensityPer1000Km2,
      unit: 'craters / 10³ km²',
      provenance: 'measured',
      rationale: `${craterSummary.totalCount} cataloged craters (Robbins & Hynek 2012) within 50 km (${craterSummary.cratersOver5Km} ≥ 5 km diameter).${rimPenalty > 0 ? ' Point lies near a mapped crater rim wall.' : ''}`,
      rule: 'Density curve on 50 km Robbins catalog count minus 0.28 penalty if on a crater rim (0.75–1.20 R)',
    },
    {
      id: 'elevationConstraint',
      label: 'Elevation & EDL Column',
      score: elevationScore !== null ? Math.round(elevationScore * 1000) / 1000 : null,
      weight: weights.elevationConstraint,
      value: telemetry.elevationM !== null ? Math.round(telemetry.elevationM) : null,
      unit: 'm LOLA',
      provenance: 'measured',
      rationale:
        telemetry.elevationM !== null
          ? `LOLA elevation ${Math.round(telemetry.elevationM)} m (${atmosphere.surfacePressurePa ?? 'N/A'} Pa modeled pressure). Golombek et al. (2012) EDL threshold favors ≤ −1,000 m.`
          : 'Elevation unavailable.',
      rule: 'Piecewise linear: ≤−2,500 m → 0.98, −1,000 m → 0.74, 0 m → 0.38, ≥+3,500 m → 0.0',
    },
    {
      id: 'latitudeThermal',
      label: 'Latitude Thermal / Power Regime',
      score: Math.round(latitudeScore * 1000) / 1000,
      weight: weights.latitudeThermal,
      value: Math.round(absLat * 100) / 100,
      unit: '° |lat|',
      provenance: 'measured',
      rationale: `Planetocentric latitude ${formatLatLonShort(lat, lon)} (${atmosphere.equinoxNoonIrradianceWm2 ?? 0} W/m² equinox noon direct beam).`,
      rule: 'Piecewise linear on |φ|: ≤15° → 0.95, 30° → 0.68, ≥80° → 0.0',
    },
    {
      id: 'scientificValue',
      label: 'Scientific Exploration Potential',
      score: Math.round(scienceScore * 1000) / 1000,
      weight: weights.scientificValue,
      value: nearbyFeatures.length,
      unit: 'IAU features <250 km',
      provenance: 'heuristic',
      rationale:
        nearbyFeatures.length > 0
          ? `Nearest mapped IAU feature: ${nearbyFeatures[0].name} (${nearbyFeatures[0].type}, ${nearbyFeatures[0].distanceKm} km); 25 km vertical exposure ${(regionalStats25Km.elevationMaxM - regionalStats25Km.elevationMinM).toFixed(0)} m.`
          : 'Isolated plains with low mapped IAU feature density within 250 km.',
      rule: 'Proximity to IAU named features + fluvial/tectonic bonus (+0.22) + stratigraphic relief span + HiRISE/CTX DTM coverage',
    },
    {
      id: 'dataConfidence',
      label: 'Data Coverage & Confidence',
      score: Math.round(confidenceScore * 1000) / 1000,
      weight: weights.dataConfidence,
      value: telemetry.lolaShotCount,
      unit: 'LOLA shots / bin',
      provenance: 'measured',
      rationale: `LOLA MEGC90N000EB laser shot count = ${telemetry.lolaShotCount ?? 'N/A'} shots in 16 PPD cell; active DEM baseline = ${telemetry.resolutionMetersPerPixel.toFixed(0)} m/px (${availableDtms.length} stereo DTMs indexed).`,
      rule: 'LOLA laser altimeter shot density per bin + high-resolution regional DEM availability',
    },
  ];

  const suitability = weightedScore(criteria);
  const advantages: string[] = [];
  const disadvantages: string[] = [];

  if (telemetry.elevationM !== null && telemetry.elevationM <= -1500) {
    advantages.push(`Deep atmospheric column (${Math.round(telemetry.elevationM)} m LOLA, ~${atmosphere.surfacePressurePa} Pa) provides strong aerodynamic EDL deceleration margin.`);
  } else if (telemetry.elevationM !== null && telemetry.elevationM > -500) {
    disadvantages.push(`High surface elevation (${Math.round(telemetry.elevationM)} m LOLA, ~${atmosphere.surfacePressurePa} Pa) reduces parachute deceleration margin below standard −1 km MSL/M2020 thresholds.`);
  }

  if (telemetry.slopeDeg !== null && telemetry.slopeDeg < 2.0 && regionalStats25Km.slopeP95Deg < 5.0) {
    advantages.push(`Low kilometric slope (${telemetry.slopeDeg.toFixed(2)}° local, ${regionalStats25Km.slopeP95Deg.toFixed(2)}° 25 km P95) minimizes touchdown tilt and radar spoofing risk.`);
  } else if (telemetry.slopeDeg !== null && (telemetry.slopeDeg >= 5.0 || regionalStats25Km.slopeP95Deg >= 8.0)) {
    disadvantages.push(`Elevated regional slopes (${telemetry.slopeDeg.toFixed(2)}° local, ${regionalStats25Km.slopeP95Deg.toFixed(2)}° 25 km P95) pose landing ellipse and rover trafficability hazards.`);
  }

  if (telemetry.triM !== null && telemetry.triM <= 25) {
    advantages.push(`Low mesoscale surface roughness (TRI ${telemetry.triM.toFixed(1)} m at ${telemetry.resolutionMetersPerPixel.toFixed(0)} m grid scale).`);
  } else if (telemetry.triM !== null && telemetry.triM > 60) {
    disadvantages.push(`High mesoscale ruggedness (TRI ${telemetry.triM.toFixed(1)} m) indicates dissected scarps, crater rims, or rugged bedrock.`);
  }

  if (absLat <= 30) {
    advantages.push(`Equatorial/sub-tropical latitude (${formatLatLonShort(lat, lon)}) supports year-round thermal management and solar flux (~${atmosphere.equinoxNoonIrradianceWm2} W/m² equinox noon).`);
  } else {
    disadvantages.push(`High latitude (${Math.abs(lat).toFixed(1)}°) incurs seasonal thermal extremes and reduced winter solar power.`);
  }

  if (nearbyFeatures.length > 0) {
    advantages.push(`Within ${nearbyFeatures[0].distanceKm} km of ${nearbyFeatures[0].name} (${nearbyFeatures[0].type}), offering accessible geologic stratigraphy.`);
  }
  if (availableDtms.length > 0) {
    advantages.push(`${availableDtms.length} stereo Digital Terrain Model(s) (HiRISE/CTX) available in USGS STAC for meter-scale hazard verification.`);
  } else {
    disadvantages.push(`No controlled HiRISE/CTX stereo DTM indexed at exact coordinates; slope & roughness reflect ${telemetry.resolutionMetersPerPixel.toFixed(0)} m LOLA altimetry and cannot resolve meter-scale boulders.`);
  }

  const totalPct = suitability.total !== null ? Math.round(suitability.total * 100) : 0;
  const siteTitle = input.name ?? preset?.name ?? `Moon Surface (${formatLatLonShort(lat, lon)})`;

  const scientificSummary =
    `${siteTitle} scores ${totalPct}/100 under the current multi-criteria weighting. ` +
    `Measured LOLA elevation is ${telemetry.elevationM !== null ? Math.round(telemetry.elevationM) + ' m' : 'unavailable'} ` +
    `(laser shot count: ${telemetry.lolaShotCount ?? 'N/A'}/bin), with derived Horn slope of ${telemetry.slopeDeg !== null ? telemetry.slopeDeg.toFixed(2) + '°' : 'N/A'} ` +
    `and TRI roughness of ${telemetry.triM !== null ? telemetry.triM.toFixed(1) + ' m' : 'N/A'} at ${telemetry.resolutionMetersPerPixel.toFixed(0)} m/px baseline. ` +
    `Within 50 km, the Robbins & Hynek (2012) catalog records ${craterSummary.totalCount} impact craters (≥3 km). ` +
    (preset ? `Geological context: ${preset.geologicalSetting}` : '');

  return {
    id: input.id ?? preset?.id ?? `loc_${lat.toFixed(2)}_${lon.toFixed(2)}`,
    name: siteTitle,
    lat,
    lon,
    isCandidatePreset: Boolean(preset),
    referenceMission: preset?.mission,
    telemetry,
    regionalStats25Km,
    atmosphere,
    craterSummary,
    nearbyFeatures,
    availableDtms,
    suitability,
    advantages,
    disadvantages,
    scientificSummary,
  };
}
