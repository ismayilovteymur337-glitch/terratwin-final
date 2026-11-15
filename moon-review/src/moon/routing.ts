import {
  bboxOf,
  cumulativeDistances,
  densifyPath,
  greatCircleDistance,
  LatLon,
  padBBox,
} from '../core/geo/sphere';
import {
  CraterRecord,
  GeologicalFeature,
  RouteAnalytics,
  RouteModeId,
  RouteObstacleSegment,
  RoutePlanResponse,
  RouteProfileSample,
  RouteScienceTargetHit,
  RouteWaypoint,
  RoverRoute,
} from '../core/planet/types';
import { astarGrid, nearestPassable, simplifyIndices } from '../core/routing/astar';
import { classifyTerrain, TERRAIN_CLASSES } from '../core/terrain/classify';
import {
  cellCenter,
  cellOf,
  computeSlope,
  computeTRI,
  ElevationGrid,
  nominalCellSize,
  sampleArray,
  sampleElevation,
  stats,
} from '../core/terrain/grid';
import { MOON_BODY } from './constants';
import { CustomRoverConfig, getRoverById, NasaRoverProfile, RoverId } from './rovers';

export interface PlanMoonRoutesInput {
  roverId?: RoverId | string;
  customRoverConfig?: CustomRoverConfig;
  grid: ElevationGrid;
  gridSource: string;
  start: LatLon;
  destination: LatLon;
  maxAllowedSlopeDeg?: number;
  slopeWeight?: number; // user priority multiplier 0.5 .. 2.5
  roughnessWeight?: number; // user priority multiplier 0.5 .. 2.5
  scienceWeight?: number; // user priority multiplier 0.5 .. 2.0
  craters: CraterRecord[];
  features: GeologicalFeature[];
}

interface CandidateScienceTarget {
  id: string;
  name: string;
  type: string;
  lat: number;
  lon: number;
  cellIdx: number;
  diameterKm?: number;
  score: number;
}

export function planMoonRoutes(input: PlanMoonRoutesInput): RoutePlanResponse {
  const {
    grid,
    gridSource,
    start,
    destination,
    craters,
    features,
  } = input;

  const rover = getRoverById(input.roverId, input.customRoverConfig);
  const mob = rover.mobilityProfile;

  const R_M = MOON_BODY.meanRadiusM;
  const R_KM = R_M / 1000;
  const userMaxSlope = input.maxAllowedSlopeDeg ?? mob.operationalMaxSlopeDeg;
  const effectiveMaxSlope = Math.min(userMaxSlope, mob.operationalMaxSlopeDeg);

  const slopePriority = (input.slopeWeight ?? 1.0) * mob.slopePenaltyFactor;
  const roughPriority = (input.roughnessWeight ?? 1.0) * mob.roughnessPenaltyFactor;
  const sciencePriority = input.scienceWeight ?? 1.0;

  const warnings: string[] = [];
  if (userMaxSlope > mob.operationalMaxSlopeDeg) {
    warnings.push(
      `${rover.name} operational slope ceiling (${mob.operationalMaxSlopeDeg}°) is stricter than requested ${userMaxSlope}°; enforcing ${mob.operationalMaxSlopeDeg}° vehicle limit.`,
    );
  }

  const cellResM = nominalCellSize(grid, R_M);

  const slopeGrid = computeSlope(grid, R_M);
  const triGrid = computeTRI(grid);
  const terrainClasses = classifyTerrain(slopeGrid, triGrid, {
    flatSlope: 2.0,
    steepSlope: 8.0,
    roughTRI: Math.max(15, cellResM * 0.012),
  });

  const startCell = cellOf(grid, start.lat, start.lon);
  const destCell = cellOf(grid, destination.lat, destination.lon);
  if (!startCell || !destCell) {
    throw new Error('Start or destination lies outside the loaded terrain analysis grid.');
  }

  const startIdx0 = startCell.row * grid.width + startCell.col;
  const destIdx0 = destCell.row * grid.width + destCell.col;
  const straightKm = greatCircleDistance(start, destination, R_KM);

  // Identify real scientific targets inside the corridor weighted by the selected rover's mission keywords
  const corridorTargets = findCorridorScienceTargets(
    grid,
    slopeGrid,
    triGrid,
    start,
    destination,
    craters,
    features,
    effectiveMaxSlope,
    rover,
  );

  // Build cost multipliers for the 3 route modes adapted to the selected rover
  const N = grid.width * grid.height;
  const costShortest = new Float32Array(N);
  const costTerrain = new Float32Array(N);
  const costScience = new Float32Array(N);

  const scienceBonus = new Float32Array(N);
  if (corridorTargets.length > 0) {
    for (let r = 0; r < grid.height; r++) {
      for (let c = 0; c < grid.width; c++) {
        const pt = cellCenter(grid, r, c);
        let bestBonus = 0;
        for (const t of corridorTargets) {
          const dKm = greatCircleDistance(pt, { lat: t.lat, lon: t.lon }, R_KM);
          const radiusKm = Math.max(4, (t.diameterKm ?? 6) * 0.65);
          if (dKm < radiusKm * 2.5) {
            const b = Math.exp(-(dKm * dKm) / (2 * radiusKm * radiusKm));
            if (b > bestBonus) bestBonus = b;
          }
        }
        scienceBonus[r * grid.width + c] = bestBonus;
      }
    }
  }

  const optSlope = Math.max(1.5, mob.optimalSlopeDeg * 0.45);
  const triBaseline = Math.max(6, cellResM * 0.0055);

  for (let i = 0; i < N; i++) {
    const s = slopeGrid[i];
    const t = triGrid[i];
    const z = grid.elevation[i];
    if (!Number.isFinite(z) || !Number.isFinite(s) || !Number.isFinite(t)) {
      costShortest[i] = Infinity;
      costTerrain[i] = Infinity;
      costScience[i] = Infinity;
      continue;
    }

    // Route A: Shortest Distance (pure geodesic distance priority while respecting rover operational slope ceiling)
    costShortest[i] = s > effectiveMaxSlope ? Infinity : 1.0 + 0.008 * s;

    // Route B: Terrain Optimized (uses vehicle-specific slopePenaltyFactor & roughnessPenaltyFactor)
    const strictSlopeCeiling = Math.max(4.5, effectiveMaxSlope * 0.84);
    costTerrain[i] =
      s > strictSlopeCeiling
        ? Infinity
        : 1.0 +
          slopePriority * 0.52 * Math.pow(s / optSlope, 2.15) +
          roughPriority * 0.26 * Math.pow(t / triBaseline, 1.45);

    // Route C: Scientific Exploration (balances rover mobility safety with mission-specific scientific target attraction)
    const baseSci =
      1.38 +
      slopePriority * 0.24 * Math.pow(s / (optSlope * 1.25), 1.8) +
      roughPriority * 0.12 * (t / (triBaseline * 1.2));
    const discount = 0.36 * Math.min(1.5, sciencePriority) * scienceBonus[i];
    costScience[i] = s > effectiveMaxSlope ? Infinity : Math.max(1.0, baseSci - discount);
  }

  const solveWithFallback = (mult: Float32Array, label: string) => {
    const sIdx = nearestPassable(grid, mult, startIdx0, 30);
    const gIdx = nearestPassable(grid, mult, destIdx0, 30);
    if (sIdx !== null && gIdx !== null) {
      const res = astarGrid(grid, mult, sIdx, gIdx, R_M);
      if (res) return res;
    }
    warnings.push(
      `${label} (${rover.name}): Strict ${effectiveMaxSlope.toFixed(0)}° slope ceiling blocked a continuous corridor; applied high-cost ridge crossing fallback.`,
    );
    const relaxed = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const s = slopeGrid[i];
      const t = triGrid[i];
      relaxed[i] = Number.isFinite(s)
        ? Number.isFinite(mult[i])
          ? mult[i]
          : 1.0 + 2.8 * slopePriority * Math.pow(s / 2.5, 2) + 0.18 * roughPriority * t
        : 50;
    }
    return astarGrid(grid, relaxed, startIdx0, destIdx0, R_M);
  };

  const resA = solveWithFallback(costShortest, 'Route A (Shortest Distance)');
  const resB = solveWithFallback(costTerrain, 'Route B (Terrain Optimized)');

  let resC = solveWithFallback(costScience, 'Route C (Scientific Exploration)');
  if (corridorTargets.length > 0 && resA) {
    const chosen: CandidateScienceTarget[] = [];
    for (const cand of corridorTargets) {
      const wpIdx = nearestPassable(grid, costScience, cand.cellIdx, 12);
      if (wpIdx === null) continue;
      const dStart = greatCircleDistance(start, { lat: cand.lat, lon: cand.lon }, R_KM);
      const dDest = greatCircleDistance(destination, { lat: cand.lat, lon: cand.lon }, R_KM);
      if (dStart < straightKm * 0.08 || dDest < straightKm * 0.08) continue;
      if (chosen.length === 0) {
        chosen.push({ ...cand, cellIdx: wpIdx });
      } else if (chosen.length === 1) {
        const dPrev = greatCircleDistance(
          { lat: chosen[0].lat, lon: chosen[0].lon },
          { lat: cand.lat, lon: cand.lon },
          R_KM,
        );
        if (dPrev > straightKm * 0.22) {
          chosen.push({ ...cand, cellIdx: wpIdx });
          break;
        }
      }
    }

    if (chosen.length > 0) {
      chosen.sort(
        (a, b) =>
          greatCircleDistance(start, { lat: a.lat, lon: a.lon }, R_KM) -
          greatCircleDistance(start, { lat: b.lat, lon: b.lon }, R_KM),
      );
      const sIdx = nearestPassable(grid, costScience, startIdx0, 20) ?? startIdx0;
      const gIdx = nearestPassable(grid, costScience, destIdx0, 20) ?? destIdx0;
      const stops = [sIdx, ...chosen.map((c) => c.cellIdx), gIdx];
      const combinedPath: number[] = [];
      let totalCost = 0;
      let totalExpanded = 0;
      let ok = true;
      for (let k = 0; k < stops.length - 1; k++) {
        const leg = astarGrid(grid, costScience, stops[k], stops[k + 1], R_M);
        if (!leg) {
          ok = false;
          break;
        }
        if (k > 0) combinedPath.pop();
        combinedPath.push(...leg.path);
        totalCost += leg.cost;
        totalExpanded += leg.expanded;
      }
      if (ok && combinedPath.length >= 2) {
        resC = { path: combinedPath, cost: totalCost, expanded: totalExpanded };
      }
    }
  }

  const routes: RoverRoute[] = [];
  if (resA) {
    routes.push(
      buildRouteObject({
        id: 'shortest',
        name: 'Route A — Shortest Distance',
        subtitle: `Minimum Geodesic Path (${rover.name})`,
        accentColor: '#D8794F',
        priorityDescription: `Minimizes total traverse distance while enforcing ${rover.name}'s ${effectiveMaxSlope}° slope limit.`,
        costFormula: `C_A = Δs · (1 + 0.008·θ), θ ≤ ${effectiveMaxSlope}°`,
        astar: resA,
        costGrid: costShortest,
        grid,
        slopeGrid,
        triGrid,
        terrainClasses,
        start,
        destination,
        craters,
        features,
        cellResM,
        rover,
        effectiveMaxSlope,
      }),
    );
  }

  if (resB) {
    routes.push(
      buildRouteObject({
        id: 'terrain_optimized',
        name: 'Route B — Terrain Optimized',
        subtitle: `${rover.name} Mobility-Adapted Corridor`,
        accentColor: '#269B68',
        priorityDescription: `Applies ${rover.name}'s ${mob.slopePenaltyFactor}× slope & ${mob.roughnessPenaltyFactor}× TRI roughness penalties (${rover.wheels.diameterCm} cm wheels, ${rover.wheels.skinThicknessMm} mm skin).`,
        costFormula: `C_B = Δs · (1 + ${(0.52 * slopePriority).toFixed(2)}·(θ/${optSlope.toFixed(1)}°)^2.15 + ${(0.26 * roughPriority).toFixed(2)}·(TRI/${triBaseline.toFixed(0)}m)^1.45)`,
        astar: resB,
        costGrid: costTerrain,
        grid,
        slopeGrid,
        triGrid,
        terrainClasses,
        start,
        destination,
        craters,
        features,
        cellResM,
        rover,
        effectiveMaxSlope,
      }),
    );
  }

  if (resC) {
    routes.push(
      buildRouteObject({
        id: 'scientific_exploration',
        name: 'Route C — Scientific Exploration',
        subtitle: `${rover.name} Payload & Target Traverse`,
        accentColor: '#397EBE',
        priorityDescription: `Balances ${rover.name} mobility constraints with proximity to mission-relevant geological targets (${rover.instruments.slice(0, 3).map((i) => i.name).join(', ')}).`,
        costFormula: `C_C = Δs · max(1, 1.38 + ${(0.24 * slopePriority).toFixed(2)}·(θ/θ₀)^1.8 − ${(0.36 * sciencePriority).toFixed(2)}·Φ_sci)`,
        astar: resC,
        costGrid: costScience,
        grid,
        slopeGrid,
        triGrid,
        terrainClasses,
        start,
        destination,
        craters,
        features,
        cellResM,
        rover,
        effectiveMaxSlope,
      }),
    );
  }

  const bbox = padBBox(bboxOf([start, destination]), Math.max(15_000, straightKm * 250), R_M);

  return {
    roverId: rover.id,
    roverName: rover.name,
    roverCodeName: rover.codeName,
    effectiveMaxSlopeDeg: effectiveMaxSlope,
    start,
    destination,
    bbox,
    gridResolutionMeters: Math.round(cellResM),
    gridSource,
    maxAllowedSlopeDeg: effectiveMaxSlope,
    routes,
    warnings,
  };
}

function findCorridorScienceTargets(
  grid: ElevationGrid,
  slopeGrid: Float32Array,
  triGrid: Float32Array,
  start: LatLon,
  destination: LatLon,
  craters: CraterRecord[],
  features: GeologicalFeature[],
  maxSlope: number,
  rover: NasaRoverProfile,
): CandidateScienceTarget[] {
  const R_KM = MOON_BODY.meanRadiusM / 1000;
  const directKm = Math.max(5, greatCircleDistance(start, destination, R_KM));
  const maxDetourKm = directKm * 1.42;
  const targets: CandidateScienceTarget[] = [];
  const kwRegex = new RegExp(rover.mobilityProfile.preferredScienceKeywords.join('|'), 'i');

  // 1. Official IAU geological features near the corridor
  for (const f of features) {
    const d1 = greatCircleDistance(start, { lat: f.lat, lon: f.lon }, R_KM);
    const d2 = greatCircleDistance({ lat: f.lat, lon: f.lon }, destination, R_KM);
    if (d1 + d2 <= maxDetourKm && d1 + d2 >= directKm * 1.04) {
      const cell = cellOf(grid, f.lat, f.lon);
      if (cell) {
        const idx = cell.row * grid.width + cell.col;
        const kwBonus = kwRegex.test(`${f.name} ${f.type}`) ? 18 : 0;
        targets.push({
          id: `iau_${f.id}`,
          name: f.name,
          type: f.type,
          lat: f.lat,
          lon: f.lon,
          cellIdx: idx,
          diameterKm: f.diameterKm,
          score: 100 + kwBonus - ((d1 + d2 - directKm) / directKm) * 50,
        });
      }
    }
  }

  // 2. Robbins impact craters near the corridor
  for (const c of craters) {
    const d1 = greatCircleDistance(start, { lat: c.lat, lon: c.lon }, R_KM);
    const d2 = greatCircleDistance({ lat: c.lat, lon: c.lon }, destination, R_KM);
    if (
      d1 + d2 <= maxDetourKm &&
      d1 + d2 >= directKm * 1.04 &&
      c.diameterKm >= 2.5 &&
      c.diameterKm <= Math.max(35, directKm * 0.6)
    ) {
      const cell = cellOf(grid, c.lat, c.lon);
      if (cell) {
        const idx = cell.row * grid.width + cell.col;
        targets.push({
          id: `crater_${c.id}`,
          name: c.name ? `${c.name} Crater` : `Crater ${c.id} (Ø ${c.diameterKm.toFixed(1)} km)`,
          type: c.morphology ? `Impact Crater (${c.morphology})` : 'Impact Crater Margin',
          lat: c.lat,
          lon: c.lon,
          cellIdx: idx,
          diameterKm: c.diameterKm,
          score: 75 + Math.min(20, c.diameterKm) - ((d1 + d2 - directKm) / directKm) * 45,
        });
      }
    }
  }

  // 3. Stratigraphic / geomorphic contact benches derived directly from the elevation grid
  const stepR = Math.max(2, Math.floor(grid.height / 18));
  const stepC = Math.max(2, Math.floor(grid.width / 18));
  for (let r = stepR; r < grid.height - stepR; r += stepR) {
    for (let c = stepC; c < grid.width - stepC; c += stepC) {
      const idx = r * grid.width + c;
      const s = slopeGrid[idx];
      const tri = triGrid[idx];
      if (!Number.isFinite(s) || !Number.isFinite(tri) || s > maxSlope * 0.65 || s < 1.2) continue;
      const pt = cellCenter(grid, r, c);
      const d1 = greatCircleDistance(start, pt, R_KM);
      const d2 = greatCircleDistance(pt, destination, R_KM);
      if (d1 + d2 > maxDetourKm * 0.92 || d1 + d2 < directKm * 1.04) continue;
      const score = 45 + Math.min(35, tri * 0.8) - ((d1 + d2 - directKm) / directKm) * 40;
      targets.push({
        id: `bench_${r}_${c}`,
        name: `Stratigraphic Contact Bench (${pt.lat.toFixed(2)}°N, ${pt.lon.toFixed(2)}°E)`,
        type: 'Geomorphic / Bedrock Contact',
        lat: pt.lat,
        lon: pt.lon,
        cellIdx: idx,
        diameterKm: 4,
        score,
      });
    }
  }

  targets.sort((a, b) => b.score - a.score);
  return targets.slice(0, 8);
}

interface BuildRouteParams {
  id: RouteModeId;
  name: string;
  subtitle: string;
  accentColor: string;
  priorityDescription: string;
  costFormula: string;
  astar: { path: number[]; cost: number; expanded: number };
  costGrid: Float32Array;
  grid: ElevationGrid;
  slopeGrid: Float32Array;
  triGrid: Float32Array;
  terrainClasses: Uint8Array;
  start: LatLon;
  destination: LatLon;
  craters: CraterRecord[];
  features: GeologicalFeature[];
  cellResM: number;
  rover: NasaRoverProfile;
  effectiveMaxSlope: number;
}

function buildRouteObject(p: BuildRouteParams): RoverRoute {
  const { grid, slopeGrid, triGrid, terrainClasses, astar, start, destination, cellResM, rover, effectiveMaxSlope } = p;
  const R_M = MOON_BODY.meanRadiusM;
  const R_KM = R_M / 1000;

  const rawLatLons: LatLon[] = [start];
  for (let i = 1; i < astar.path.length - 1; i++) {
    const idx = astar.path[i];
    const r = Math.floor(idx / grid.width), c = idx % grid.width;
    rawLatLons.push(cellCenter(grid, r, c));
  }
  rawLatLons.push(destination);

  const smoothed: LatLon[] = [rawLatLons[0]];
  for (let i = 1; i < rawLatLons.length - 1; i++) {
    smoothed.push({
      lat: 0.22 * rawLatLons[i - 1].lat + 0.56 * rawLatLons[i].lat + 0.22 * rawLatLons[i + 1].lat,
      lon: 0.22 * rawLatLons[i - 1].lon + 0.56 * rawLatLons[i].lon + 0.22 * rawLatLons[i + 1].lon,
    });
  }
  smoothed.push(rawLatLons[rawLatLons.length - 1]);

  const straightM = greatCircleDistance(start, destination, R_M);
  const sampleStepM = Math.max(250, Math.min(2500, straightM / 140));
  const densePath = densifyPath(smoothed, sampleStepM, R_M);
  const cumDistM = cumulativeDistances(densePath, R_M);

  const profile: RouteProfileSample[] = [];
  const slopesAlong: number[] = [];
  const trisAlong: number[] = [];
  const classCounts: Record<string, number> = {};
  TERRAIN_CLASSES.forEach((c) => (classCounts[c.id] = 0));

  let elevMin = Infinity, elevMax = -Infinity;
  let totalGainM = 0, totalLossM = 0;
  let prevElev: number | null = null;

  for (let i = 0; i < densePath.length; i++) {
    const pt = densePath[i];
    const elev = sampleElevation(grid, pt.lat, pt.lon);
    const slp = sampleArray(grid, slopeGrid, pt.lat, pt.lon);
    const tri = sampleArray(grid, triGrid, pt.lat, pt.lon);
    const cCell = cellOf(grid, pt.lat, pt.lon);
    const classCode = cCell ? terrainClasses[cCell.row * grid.width + cCell.col] : 0;
    const classInfo = TERRAIN_CLASSES[classCode] ?? TERRAIN_CLASSES[0];
    classCounts[classInfo.id] = (classCounts[classInfo.id] ?? 0) + 1;

    const cleanElev = Number.isFinite(elev) ? Math.round(elev * 10) / 10 : 0;
    const cleanSlope = Number.isFinite(slp) ? Math.round(slp * 100) / 100 : 0;
    const cleanTri = Number.isFinite(tri) ? Math.round(tri * 10) / 10 : 0;

    if (Number.isFinite(elev)) {
      elevMin = Math.min(elevMin, cleanElev);
      elevMax = Math.max(elevMax, cleanElev);
      if (prevElev !== null) {
        const dz = cleanElev - prevElev;
        if (dz > 0) totalGainM += dz;
        else totalLossM += Math.abs(dz);
      }
      prevElev = cleanElev;
    }

    if (Number.isFinite(slp)) slopesAlong.push(cleanSlope);
    if (Number.isFinite(tri)) trisAlong.push(cleanTri);

    const multVal = cCell ? p.costGrid[cCell.row * grid.width + cCell.col] : 1;
    profile.push({
      distanceKm: Math.round((cumDistM[i] / 1000) * 100) / 100,
      lat: Math.round(pt.lat * 10000) / 10000,
      lon: Math.round(pt.lon * 10000) / 10000,
      elevationM: cleanElev,
      slopeDeg: cleanSlope,
      triM: cleanTri,
      costMultiplier: Number.isFinite(multVal) ? Math.round(multVal * 100) / 100 : 1,
      terrainClassId: classInfo.id,
    });
  }

  // Extract simplified waypoints
  const idxPts = profile.map((s) => ({ x: s.lon, y: s.lat }));
  const spanDeg = Math.hypot(destination.lon - start.lon, destination.lat - start.lat);
  const keptIndices = simplifyIndices(idxPts, Math.max(0.008, spanDeg * 0.035));

  const waypoints: RouteWaypoint[] = [];
  let wpGain = 0, wpLoss = 0;
  for (let k = 0; k < keptIndices.length; k++) {
    const idx = keptIndices[k];
    if (k > 0) {
      for (let j = keptIndices[k - 1] + 1; j <= idx; j++) {
        const dz = profile[j].elevationM - profile[j - 1].elevationM;
        if (dz > 0) wpGain += dz;
        else wpLoss += Math.abs(dz);
      }
    }
    const sample = profile[idx];
    waypoints.push({
      index: k,
      lat: sample.lat,
      lon: sample.lon,
      distanceFromStartKm: sample.distanceKm,
      elevationM: sample.elevationM,
      slopeDeg: sample.slopeDeg,
      triM: sample.triM,
      cumulativeGainM: Math.round(wpGain),
      cumulativeLossM: Math.round(wpLoss),
      label: k === 0 ? 'START' : k === keptIndices.length - 1 ? 'DESTINATION' : `WP-${k}`,
    });
  }

  // Identify terrain obstacles along the route relative to the selected rover's capabilities
  const obstaclesAlongRoute: RouteObstacleSegment[] = [];
  const slopeCautionDeg = Math.max(4.0, rover.mobilityProfile.optimalSlopeDeg);
  const triCautionM = rover.mobilityProfile.rockPunctureSensitivity === 'high' ? 28 : 42;
  let lastObstacleKm = -999;

  for (const s of profile) {
    if (s.distanceKm - lastObstacleKm < 1.2) continue;
    if (s.slopeDeg >= slopeCautionDeg) {
      obstaclesAlongRoute.push({
        type: 'steep_slope',
        alongRouteKm: s.distanceKm,
        lat: s.lat,
        lon: s.lon,
        severity: s.slopeDeg >= effectiveMaxSlope * 0.75 ? 'limit_near' : 'caution',
        valueLabel: `${s.slopeDeg.toFixed(1)}° grade`,
        description:
          s.slopeDeg >= effectiveMaxSlope * 0.75
            ? `Approaches ${rover.name} ${effectiveMaxSlope}° slope ceiling (${rover.suspension.architecture}).`
            : `Exceeds ${rover.name} ${rover.mobilityProfile.optimalSlopeDeg}° nominal cruise grade; wheel slip monitoring required.`,
      });
      lastObstacleKm = s.distanceKm;
    } else if (s.triM >= triCautionM) {
      obstaclesAlongRoute.push({
        type: 'high_roughness_tri',
        alongRouteKm: s.distanceKm,
        lat: s.lat,
        lon: s.lon,
        severity: rover.mobilityProfile.rockPunctureSensitivity === 'high' ? 'limit_near' : 'advisory',
        valueLabel: `TRI ${s.triM.toFixed(1)} m`,
        description:
          rover.mobilityProfile.rockPunctureSensitivity === 'high'
            ? `High roughness zone hazards ${rover.name}'s ${rover.wheels.skinThicknessMm} mm wheel skin (${rover.wheels.grouserCount} chevron grousers).`
            : `Elevated mesoscale roughness relative to ${rover.name}'s ${rover.suspension.groundClearanceCm} cm ground clearance.`,
      });
      lastObstacleKm = s.distanceKm;
    }
  }

  // Find scientific targets approached along the route
  const scienceHits: RouteScienceTargetHit[] = [];
  const proximityLimitKm = Math.max(12, Math.min(45, (cumDistM[cumDistM.length - 1] / 1000) * 0.18));

  for (const f of p.features) {
    let minD = Infinity, bestKm = 0;
    for (const s of profile) {
      const d = greatCircleDistance({ lat: s.lat, lon: s.lon }, { lat: f.lat, lon: f.lon }, R_KM);
      if (d < minD) { minD = d; bestKm = s.distanceKm; }
    }
    if (minD <= proximityLimitKm + (f.diameterKm || 0) * 0.35) {
      scienceHits.push({
        id: f.id,
        name: f.name,
        type: `IAU ${f.type}`,
        lat: f.lat,
        lon: f.lon,
        closestApproachKm: Math.round(minD * 10) / 10,
        alongRouteKm: bestKm,
        diameterKm: f.diameterKm,
      });
    }
  }

  for (const c of p.craters) {
    if (c.diameterKm < 3.5) continue;
    let minD = Infinity, bestKm = 0;
    for (const s of profile) {
      const d = greatCircleDistance({ lat: s.lat, lon: s.lon }, { lat: c.lat, lon: c.lon }, R_KM);
      if (d < minD) { minD = d; bestKm = s.distanceKm; }
    }
    if (minD <= Math.min(25, proximityLimitKm) + c.diameterKm * 0.5) {
      scienceHits.push({
        id: c.id,
        name: c.name ? `${c.name} Crater` : `Crater ${c.id} (Ø ${c.diameterKm.toFixed(1)} km)`,
        type: c.morphology ? `Crater (${c.morphology})` : 'Mapped Impact Crater',
        lat: c.lat,
        lon: c.lon,
        closestApproachKm: Math.round(minD * 10) / 10,
        alongRouteKm: bestKm,
        diameterKm: c.diameterKm,
      });
    }
  }
  scienceHits.sort((a, b) => a.closestApproachKm - b.closestApproachKm);

  const slopeSt = stats(slopesAlong);
  const triSt = stats(trisAlong);
  const totalDistKm = Math.round((cumDistM[cumDistM.length - 1] / 1000) * 100) / 100;
  const straightDistKm = Math.round((straightM / 1000) * 100) / 100;

  const totalSamples = Math.max(1, profile.length);
  const classBreakdown: Record<string, number> = {};
  Object.keys(classCounts).forEach((k) => {
    classBreakdown[k] = Math.round((classCounts[k] / totalSamples) * 1000) / 1000;
  });

  const analytics: RouteAnalytics = {
    totalDistanceKm: totalDistKm,
    straightLineDistanceKm: straightDistKm,
    tortuosityRatio: straightDistKm > 0 ? Math.round((totalDistKm / straightDistKm) * 1000) / 1000 : 1,
    elevationStartM: profile[0]?.elevationM ?? 0,
    elevationEndM: profile[profile.length - 1]?.elevationM ?? 0,
    elevationMinM: Number.isFinite(elevMin) ? elevMin : 0,
    elevationMaxM: Number.isFinite(elevMax) ? elevMax : 0,
    totalElevationGainM: Math.round(totalGainM),
    totalElevationLossM: Math.round(totalLossM),
    maxSlopeDeg: Number.isFinite(slopeSt.max) ? Math.round(slopeSt.max * 100) / 100 : 0,
    meanSlopeDeg: Number.isFinite(slopeSt.mean) ? Math.round(slopeSt.mean * 100) / 100 : 0,
    p95SlopeDeg: Number.isFinite(slopeSt.p95) ? Math.round(slopeSt.p95 * 100) / 100 : 0,
    meanTriM: Number.isFinite(triSt.mean) ? Math.round(triSt.mean * 10) / 10 : 0,
    maxTriM: Number.isFinite(triSt.max) ? Math.round(triSt.max * 10) / 10 : 0,
    traversalCostIndex: Math.round(astar.cost / 100) / 10,
    normalizedCostRatio: totalDistKm > 0 ? Math.round((astar.cost / (totalDistKm * 1000)) * 100) / 100 : 1,
    gridResolutionM: Math.round(cellResM),
    gridDimensions: [grid.width, grid.height],
    expandedNodes: astar.expanded,
    terrainClassBreakdown: classBreakdown,
    scienceTargetsAlongRoute: scienceHits.slice(0, 8),
    obstaclesAlongRoute: obstaclesAlongRoute.slice(0, 8),
  };

  const scientificExplanation =
    `${p.name} (${rover.name}) traverses ${analytics.totalDistanceKm} km (tortuosity ${analytics.tortuosityRatio}× over ${analytics.straightLineDistanceKm} km geodesic) ` +
    `across a ${Math.round(cellResM)} m/px elevation grid (${p.grid.width}×${p.grid.height} cells, ${astar.expanded.toLocaleString()} A* nodes expanded). ` +
    `Mean Horn slope along the trajectory is ${analytics.meanSlopeDeg}° (P95: ${analytics.p95SlopeDeg}°, max: ${analytics.maxSlopeDeg}°), ` +
    `with cumulative elevation gain of +${analytics.totalElevationGainM} m and loss of −${analytics.totalElevationLossM} m. ` +
    (analytics.scienceTargetsAlongRoute.length > 0
      ? `Passes within ${analytics.scienceTargetsAlongRoute[0].closestApproachKm} km of ${analytics.scienceTargetsAlongRoute[0].name}.`
      : 'Follows inter-crater plains with no major cataloged IAU features in immediate proximity.');

  const roverSuitabilityExplanation =
    `Vehicle Assessment for ${rover.name} (${rover.wheels.count} × ${rover.wheels.diameterCm} cm wheels, ${rover.wheels.skinThicknessMm} mm skin, ${rover.suspension.groundClearanceCm} cm ground clearance, ${effectiveMaxSlope}° max operational grade): ` +
    (p.id === 'terrain_optimized'
      ? `Recommended primary mobility corridor for ${rover.name}. Minimizes peak slope (${analytics.maxSlopeDeg}°) and TRI roughness (${analytics.meanTriM} m) using ${rover.name}'s ${rover.mobilityProfile.slopePenaltyFactor}× slope and ${rover.mobilityProfile.roughnessPenaltyFactor}× roughness cost profile.`
      : p.id === 'shortest'
        ? `Minimizes total odometry (${analytics.totalDistanceKm} km) but exposes ${rover.name} to steeper gradients (up to ${analytics.maxSlopeDeg}°) and ${analytics.obstaclesAlongRoute.length} flagged terrain caution segment(s).`
        : `Optimizes scientific return for ${rover.name}'s instrument suite (${rover.instruments.slice(0, 3).map((i) => i.name).join(', ')}) by routing near ${analytics.scienceTargetsAlongRoute.length} geological target(s) while keeping max slope (${analytics.maxSlopeDeg}°) within ${effectiveMaxSlope}° vehicle limits.`);

  return {
    id: p.id,
    name: p.name,
    subtitle: p.subtitle,
    accentColor: p.accentColor,
    priorityDescription: p.priorityDescription,
    costFormula: p.costFormula,
    path: densePath,
    waypoints,
    profile,
    analytics,
    scientificExplanation,
    roverSuitabilityExplanation,
  };
}
