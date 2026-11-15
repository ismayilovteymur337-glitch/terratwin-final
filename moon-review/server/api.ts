import type { IncomingMessage, ServerResponse } from 'node:http';
import { bboxOf, DEG, greatCircleDistance, normLon180, padBBox } from '../src/core/geo/sphere.ts';
import { LandingSiteAnalysis, LandingSiteWeights } from '../src/core/planet/types.ts';
import { classHistogram, classifyTerrain } from '../src/core/terrain/classify.ts';
import { computeSlope, computeTRI, ElevationGrid, nominalCellSize } from '../src/core/terrain/grid.ts';
import {
  CURIOSITY_RAD_EXCERPT,
  DEFAULT_LANDING_WEIGHTS,
  MOON_BODY,
  MOON_DATA_SOURCES,
  MOON_PRESET_SITES,
  MOON_ROUTE_PRESETS,
} from '../src/moon/constants.ts';
import { evaluateMoonLandingSite, findNearbyGeologicalFeatures, summarizeNearbyCraters } from '../src/moon/landing.ts';
import { formatLatLonShort } from '../src/moon/physics.ts';
import { DEFAULT_CUSTOM_ROVER_CONFIG, NASA_MOON_ROVERS } from '../src/moon/rovers.ts';
import { planMoonRoutes } from '../src/moon/routing.ts';
import { getEarthAnalogClimate } from './earth-climate.ts';
import { llmRouter } from './llm-router.ts';
import { runMissionAgentTurn } from './mission-agent.ts';
import { moonStore } from './lola-store.ts';

const MAX_BODY_BYTES = 128 * 1024;
const wmtsServerTileCache = new Map<string, { buf: Buffer; contentType: string }>();

function getRemoteWmtsUrl(source: string, z: number, r: number, c: number): { url: string; contentType: string } {
  switch (source) {
    case 'ctx_caltech':
      return {
        url: `https://astro.arcgis.com/arcgis/rest/services/OnMoon/CTX/MapServer/tile/${z}/${r}/${c}`,
        contentType: 'image/png',
      };
    case 'hirise_jezero':
      return {
        url: `https://trek.nasa.gov/tiles/Moon/EQ/JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first_dd/1.0.0/default/default028mm/${z}/${r}/${c}.png`,
        contentType: 'image/png',
      };
    case 'hrsc_lola_blend':
      return {
        url: `https://trek.nasa.gov/tiles/Moon/EQ/Moon_LOLA_blend200ppx_HRSC_ClrShade_clon0dd_200mpp_lzw/1.0.0/default/default028mm/${z}/${r}/${c}.jpg`,
        contentType: 'image/jpeg',
      };
    case 'lola_shaded':
      return {
        url: `https://trek.nasa.gov/tiles/Moon/EQ/Moon_MGS_LOLA_ClrShade_merge_global_463m/1.0.0/default/default028mm/${z}/${r}/${c}.jpg`,
        contentType: 'image/jpeg',
      };
    case 'lola_roughness':
      return {
        url: `https://trek.nasa.gov/tiles/Moon/EQ/lola_roughness/1.0.0/default/default028mm/${z}/${r}/${c}.png`,
        contentType: 'image/png',
      };
    case 'viking_color':
    default:
      return {
        url: `https://trek.nasa.gov/tiles/Moon/EQ/Moon_Viking_MDIM21_ClrMosaic_global_232m/1.0.0/default/default028mm/${z}/${r}/${c}.jpg`,
        contentType: 'image/jpeg',
      };
  }
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(body);
}

async function readJsonBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        reject(new Error('Request body exceeds 32 KiB limit.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error('Invalid JSON payload.'));
      }
    });
    req.on('error', reject);
  });
}

interface CandidateBaseEntry {
  siteId: string;
  name: string;
  telemetry: ReturnType<typeof moonStore.samplePointTelemetry>['telemetry'];
  regionalStats25Km: ReturnType<typeof moonStore.samplePointTelemetry>['regionalStats25Km'];
  dtms: Awaited<ReturnType<typeof moonStore.getAvailableDtms>>;
}

let cachedCandidateBase: CandidateBaseEntry[] | null = null;

async function ensureCandidateBase(): Promise<CandidateBaseEntry[]> {
  if (cachedCandidateBase) return cachedCandidateBase;
  // All preset sites in parallel, each DTM lookup capped (cached presets answer immediately).
  const out: CandidateBaseEntry[] = await Promise.all(
    MOON_PRESET_SITES.map(async (site) => {
      const { telemetry, regionalStats25Km } = moonStore.samplePointTelemetry(site.lat, site.lon);
      const dtms = await moonStore.getAvailableDtmsQuick(site.lat, site.lon, 1500);
      return { siteId: site.id, name: site.name, telemetry, regionalStats25Km, dtms };
    }),
  );
  // Do not freeze an incomplete DTM list forever: rebuild later if some lookups were still pending.
  if (out.every((e) => e.dtms.length > 0)) cachedCandidateBase = out;
  else setTimeout(() => (cachedCandidateBase = null), 60_000);
  cachedCandidateBase = cachedCandidateBase ?? out;
  return out;
}

async function evaluateAllCandidates(weights: LandingSiteWeights): Promise<LandingSiteAnalysis[]> {
  const base = await ensureCandidateBase();
  const craters = moonStore.getCraters();
  const features = moonStore.getFeatures();

  const evaluated = base.map((b) =>
    evaluateMoonLandingSite({
      id: b.siteId,
      name: b.name,
      telemetry: b.telemetry,
      regionalStats25Km: b.regionalStats25Km,
      craters,
      features,
      availableDtms: b.dtms,
      weights,
    }),
  );
  evaluated.sort((a, b) => (b.suitability.total ?? 0) - (a.suitability.total ?? 0));
  return evaluated;
}

/**
 * Scan a 5×5 grid of candidate landing zones across the user's selected Region of Interest (ROI)
 * using real LOLA elevation, slope, TRI, Robbins crater density, and STAC DTM coverage.
 */
export function scanRegionalCandidates(
  centerLat: number,
  centerLon: number,
  weights: LandingSiteWeights,
  roiSpanDeg = 2.4,
  centerDtms: Awaited<ReturnType<typeof moonStore.getAvailableDtms>> = [],
): LandingSiteAnalysis[] {
  const craters = moonStore.getCraters();
  const features = moonStore.getFeatures();
  const halfLat = Math.max(0.4, Math.min(4.0, roiSpanDeg * 0.5));
  const halfLon = halfLat / Math.max(0.2, Math.cos(centerLat * DEG));
  const gridSteps = [-0.85, -0.42, 0, 0.42, 0.85];
  const rawPool: LandingSiteAnalysis[] = [];

  for (const sy of gridSteps) {
    for (const sx of gridSteps) {
      const ptLat = Math.max(-86, Math.min(86, Math.round((centerLat + sy * halfLat) * 10000) / 10000));
      const ptLon = Math.round(normLon180(centerLon + sx * halfLon) * 10000) / 10000;
      const { telemetry, regionalStats25Km } = moonStore.samplePointTelemetry(ptLat, ptLon);
      const dtms = moonStore.getCachedDtmsNear(ptLat, ptLon, centerDtms);
      const evaluated = evaluateMoonLandingSite({
        id: `roi_${ptLat.toFixed(3)}_${ptLon.toFixed(3)}`,
        name: `ROI Candidate (${formatLatLonShort(ptLat, ptLon)})`,
        telemetry,
        regionalStats25Km,
        craters,
        features,
        availableDtms: dtms,
        weights,
      });
      rawPool.push(evaluated);
    }
  }

  rawPool.sort((a, b) => (b.suitability.total ?? 0) - (a.suitability.total ?? 0));
  const distinct: LandingSiteAnalysis[] = [];
  const R_KM = MOON_BODY.meanRadiusM / 1000;

  for (const cand of rawPool) {
    const tooClose = distinct.some(
      (existing) => greatCircleDistance({ lat: existing.lat, lon: existing.lon }, { lat: cand.lat, lon: cand.lon }, R_KM) < 16,
    );
    if (!tooClose) {
      const idx = distinct.length + 1;
      distinct.push({
        ...cand,
        id: `roi_zone_${idx}_${cand.lat.toFixed(2)}_${cand.lon.toFixed(2)}`,
        name: `ROI Zone #${idx} (${formatLatLonShort(cand.lat, cand.lon)})`,
      });
      if (distinct.length >= 5) break;
    }
  }

  return distinct;
}

function downsampleGridIfNeeded(grid: ElevationGrid, maxDim = 150): ElevationGrid {
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

/**
 * Small in-memory caches for the two heaviest endpoints. Switching back to a route, rover or place
 * that was already computed answers instantly instead of re-running A* or re-sampling terrain.
 */
const responseCache = new Map<string, string>();
const RESPONSE_CACHE_MAX = 60;
function cacheGet(key: string): string | undefined {
  const v = responseCache.get(key);
  if (v !== undefined) {
    responseCache.delete(key);
    responseCache.set(key, v); // LRU: mark as recently used
  }
  return v;
}
function cachePut(key: string, payload: unknown): string {
  const body = JSON.stringify(payload);
  responseCache.set(key, body);
  while (responseCache.size > RESPONSE_CACHE_MAX) {
    const oldest = responseCache.keys().next().value;
    if (oldest === undefined) break;
    responseCache.delete(oldest);
  }
  return body;
}
function sendCachedJson(res: ServerResponse, body: string): void {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(body);
}

export async function moonAPI(
  req: IncomingMessage,
  res: ServerResponse,
  next?: (err?: unknown) => void,
): Promise<void> {
  const urlStr = req.url || '/';
  if (!urlStr.startsWith('/api/moon')) {
    if (next) next();
    return;
  }

  try {
    const parsedUrl = new URL(urlStr, 'http://127.0.0.1');
    const pathname = parsedUrl.pathname;

    // 1. GET /api/moon/bootstrap
    if (req.method === 'GET' && pathname === '/api/moon/bootstrap') {
      const candidates = await evaluateAllCandidates(DEFAULT_LANDING_WEIGHTS);
      const allFeatures = moonStore.getFeatures();
      // Select prominent named features for 3D globe markers
      const globeFeatures = allFeatures
        .filter(
          (f) =>
            f.diameterKm >= 35 ||
            /mons|montes|chasma|vallis|valles|planitia|patera|tholus|fossae/i.test(f.type),
        )
        .slice(0, 320);

      sendJson(res, 200, {
        planet: MOON_BODY,
        defaultWeights: DEFAULT_LANDING_WEIGHTS,
        candidates,
        rovers: NASA_MOON_ROVERS,
        routePresets: MOON_ROUTE_PRESETS,
        dataSources: MOON_DATA_SOURCES,
        radExcerpt: CURIOSITY_RAD_EXCERPT,
        globeFeatures,
      });
      return;
    }

    // 1b. GET /api/moon/wmts-tile?source=...&z=...&r=...&c=... (Same-origin CORS-safe WMTS proxy + LRU cache)
    if (req.method === 'GET' && pathname === '/api/moon/wmts-tile') {
      const source = parsedUrl.searchParams.get('source') || 'viking_color';
      const z = parseInt(parsedUrl.searchParams.get('z') || '0', 10);
      const r = parseInt(parsedUrl.searchParams.get('r') || '0', 10);
      const c = parseInt(parsedUrl.searchParams.get('c') || '0', 10);
      if (!Number.isFinite(z) || !Number.isFinite(r) || !Number.isFinite(c) || z < 0 || z > 18) {
        res.statusCode = 400;
        res.end();
        return;
      }
      const cacheKey = `${source}_${z}_${r}_${c}`;
      const cached = wmtsServerTileCache.get(cacheKey);
      if (cached) {
        res.statusCode = 200;
        res.setHeader('Content-Type', cached.contentType);
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        res.end(cached.buf);
        return;
      }
      const { url, contentType } = getRemoteWmtsUrl(source, z, r, c);
      const upstream = await fetch(url);
      if (!upstream.ok) {
        res.statusCode = upstream.status;
        res.end();
        return;
      }
      const arrBuf = await upstream.arrayBuffer();
      const buf = Buffer.from(arrBuf);
      if (wmtsServerTileCache.size >= 400) {
        const oldest = wmtsServerTileCache.keys().next().value;
        if (oldest) wmtsServerTileCache.delete(oldest);
      }
      wmtsServerTileCache.set(cacheKey, { buf, contentType });
      res.statusCode = 200;
      res.setHeader('Content-Type', contentType);
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.end(buf);
      return;
    }

    // 2. GET /api/moon/telemetry?lat=..&lon=..
    if (req.method === 'GET' && pathname === '/api/moon/telemetry') {
      const lat = parseFloat(parsedUrl.searchParams.get('lat') || '');
      const lon = parseFloat(parsedUrl.searchParams.get('lon') || '');
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90) {
        sendJson(res, 400, { error: 'Valid lat (−90..90) and lon required.' });
        return;
      }
      const { telemetry, regionalStats25Km } = moonStore.samplePointTelemetry(lat, lon);
      const dtms = await moonStore.getAvailableDtmsQuick(lat, lon);
      const analysis = evaluateMoonLandingSite({
        telemetry,
        regionalStats25Km,
        craters: moonStore.getCraters(),
        features: moonStore.getFeatures(),
        availableDtms: dtms,
      });
      sendJson(res, 200, analysis);
      return;
    }

    // 3. POST /api/moon/landing (or POST /api/moon/analyze for backwards compatibility)
    if (
      req.method === 'POST' &&
      (pathname === '/api/moon/landing' || pathname === '/api/moon/analyze')
    ) {
      const body = await readJsonBody(req);
      const lat = Number(body.lat);
      const lon = Number(body.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90) {
        sendJson(res, 400, { error: 'Valid lat (−90..90) and lon required.' });
        return;
      }
      const weights: LandingSiteWeights = {
        ...DEFAULT_LANDING_WEIGHTS,
        ...(body.weights || {}),
      };
      const { telemetry, regionalStats25Km } = moonStore.samplePointTelemetry(lat, lon);
      const dtms = await moonStore.getAvailableDtmsQuick(lat, lon);
      const selected = evaluateMoonLandingSite({
        name: typeof body.name === 'string' ? body.name : undefined,
        telemetry,
        regionalStats25Km,
        craters: moonStore.getCraters(),
        features: moonStore.getFeatures(),
        availableDtms: dtms,
        weights,
      });
      const roiSpanDeg = Number.isFinite(Number(body.spanDeg)) ? Number(body.spanDeg) : 2.4;
      const regionalCandidates = scanRegionalCandidates(lat, lon, weights, roiSpanDeg, dtms);
      const rankedCandidates = await evaluateAllCandidates(weights);
      sendJson(res, 200, {
        selected,
        regionalCandidates,
        rankedCandidates,
        weights,
        aiStatus:
          process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY ? 'configured' : 'deterministic_only',
      });
      return;
    }

    // 4. GET /api/moon/terrain-patch?lat=..&lon=..&spanDeg=..
    if (req.method === 'GET' && pathname === '/api/moon/terrain-patch') {
      const lat = parseFloat(parsedUrl.searchParams.get('lat') || '18.4447');
      const lon = parseFloat(parsedUrl.searchParams.get('lon') || '77.4508');
      const spanDeg = Math.max(0.1, Math.min(8.0, parseFloat(parsedUrl.searchParams.get('spanDeg') || '2.0')));
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        sendJson(res, 400, { error: 'Valid lat and lon required.' });
        return;
      }

      const patchKey = `patch|${lat.toFixed(4)}|${lon.toFixed(4)}|${spanDeg.toFixed(3)}`;
      const cachedPatch = cacheGet(patchKey);
      if (cachedPatch) {
        sendCachedJson(res, cachedPatch);
        return;
      }

      const halfLat = spanDeg / 2;
      const halfLon = spanDeg / (2 * Math.max(0.15, Math.cos(lat * DEG)));
      const bbox = {
        south: Math.max(-88.5, lat - halfLat),
        north: Math.min(88.5, lat + halfLat),
        west: normLon180(lon - halfLon),
        east: normLon180(lon + halfLon),
      };

      const best = moonStore.getBestGridForBBox(bbox);
      const grid = downsampleGridIfNeeded(best.grid, 200);
      const slope = computeSlope(grid, MOON_BODY.meanRadiusM);
      const tri = computeTRI(grid);
      const resM = nominalCellSize(grid, MOON_BODY.meanRadiusM);
      const classes = classifyTerrain(slope, tri, {
        flatSlope: 2.0,
        steepSlope: 8.0,
        roughTRI: Math.max(4, resM * 0.012),
      });

      const dtms = await moonStore.getAvailableDtmsQuick(lat, lon);
      const craters = summarizeNearbyCraters(lat, lon, moonStore.getCraters(), Math.max(15, spanDeg * 35));
      const features = findNearbyGeologicalFeatures(lat, lon, moonStore.getFeatures(), Math.max(25, spanDeg * 45), 12);

      const lodLabel =
        best.lodLevel === 3
          ? 'LOD 3 — Local HiRISE Stereo DTM (~1 m GSD)'
          : best.nativeGsdMeters <= 30
            ? 'LOD 2 — Regional CTX Stereo DTM (~20 m GSD)'
            : best.lodLevel === 2
              ? 'LOD 2 — Regional LOLA 128 PPD (463 m/px)'
              : 'LOD 1 — Global LOLA 16 PPD (3.7 km/px)';

      const patchPayload = {
        center: { lat, lon: normLon180(lon) },
        spanDeg,
        source: best.source,
        lodLevel: best.lodLevel,
        lodLabel,
        dtmId: best.dtmId,
        crsCode: best.crsCode,
        nativeGsdMeters: best.nativeGsdMeters,
        provenanceBreakdown: best.provenanceBreakdown,
        verticalUncertaintyMeters: best.verticalUncertaintyMeters,
        resolutionMeters: Math.round(resM * 10) / 10,
        grid: {
          width: grid.width,
          height: grid.height,
          north: grid.north,
          west: grid.west,
          dLat: grid.dLat,
          dLon: grid.dLon,
          elevation: Array.from(grid.elevation, (v) => Math.round(v * 10) / 10),
          slope: Array.from(slope, (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : 0)),
          tri: Array.from(tri, (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : 0)),
          terrainClass: Array.from(classes),
        },
        classHistogram: classHistogram(classes),
        availableDtms: dtms,
        craters: craters.craters,
        features,
      };
      // Only cache once the DTM lookup has answered (an empty list may just mean "not ready yet").
      const body = dtms.length ? cachePut(patchKey, patchPayload) : JSON.stringify(patchPayload);
      sendCachedJson(res, body);
      return;
    }

    // 5. POST /api/moon/route
    if (req.method === 'POST' && pathname === '/api/moon/route') {
      const body = await readJsonBody(req);
      const start = body.start;
      const destination = body.destination;
      if (
        !start ||
        !destination ||
        !Number.isFinite(Number(start.lat)) ||
        !Number.isFinite(Number(start.lon)) ||
        !Number.isFinite(Number(destination.lat)) ||
        !Number.isFinite(Number(destination.lon))
      ) {
        sendJson(res, 400, { error: 'Valid start {lat, lon} and destination {lat, lon} required.' });
        return;
      }

      const sPt = { lat: Math.max(-88, Math.min(88, Number(start.lat))), lon: normLon180(Number(start.lon)) };
      const dPt = { lat: Math.max(-88, Math.min(88, Number(destination.lat))), lon: normLon180(Number(destination.lon)) };
      const distKm = greatCircleDistance(sPt, dPt, MOON_BODY.meanRadiusM / 1000);
      if (distKm < 0.2) {
        sendJson(res, 400, { error: 'Start and destination must be at least 0.2 km apart.' });
        return;
      }
      if (distKm > 3500) {
        sendJson(res, 400, { error: 'Rover traverse planning span exceeds 3,500 km regional limit. Select closer waypoints.' });
        return;
      }

      // Scale padding proportionally so local 2-10 km Jezero Delta traverses stay within the Level 3 HiRISE Stereo DTM bounds
      const padMeters = Math.max(2_200, Math.min(350_000, distKm * 1000 * 0.42));
      const rawBbox = padBBox(bboxOf([sPt, dPt]), padMeters, MOON_BODY.meanRadiusM, 88.5);
      const { grid: rawGrid, source } = moonStore.getBestGridForBBox(rawBbox);
      const workGrid = downsampleGridIfNeeded(rawGrid, 220);

      const plan = planMoonRoutes({
        grid: workGrid,
        gridSource: source,
        start: sPt,
        destination: dPt,
        roverId: typeof body.roverId === 'string' ? body.roverId : 'perseverance',
        customRoverConfig:
          body.customRoverConfig && typeof body.customRoverConfig === 'object'
            ? (body.customRoverConfig as any)
            : undefined,
        maxAllowedSlopeDeg: Number.isFinite(Number(body.maxAllowedSlopeDeg)) ? Number(body.maxAllowedSlopeDeg) : 20,
        slopeWeight: Number.isFinite(Number(body.slopeWeight)) ? Number(body.slopeWeight) : 1.0,
        roughnessWeight: Number.isFinite(Number(body.roughnessWeight)) ? Number(body.roughnessWeight) : 1.0,
        scienceWeight: Number.isFinite(Number(body.scienceWeight)) ? Number(body.scienceWeight) : 1.0,
        craters: moonStore.getCraters(),
        features: moonStore.getFeatures(),
      });

      sendJson(res, 200, plan);
      return;
    }

    // 6. POST /api/moon/chat (Preserved SERVER.md grounded follow-up endpoint)
    if (req.method === 'POST' && pathname === '/api/moon/chat') {
      const body = await readJsonBody(req);
      const lat = Number(body.lat ?? 18.4447);
      const lon = Number(body.lon ?? 77.4508);
      const message = String(body.message || '').slice(0, 2000);
      const { telemetry, regionalStats25Km } = moonStore.samplePointTelemetry(lat, lon);
      const dtms = await moonStore.getAvailableDtmsQuick(lat, lon);
      const analysis = evaluateMoonLandingSite({
        telemetry,
        regionalStats25Km,
        craters: moonStore.getCraters(),
        features: moonStore.getFeatures(),
        availableDtms: dtms,
      });

      const reply =
        `Grounded assessment at ${formatLatLonShort(lat, lon)} (${analysis.name}): ` +
        `Measured LOLA elevation is ${telemetry.elevationM !== null ? Math.round(telemetry.elevationM) + ' m' : 'unavailable'} ` +
        `(${telemetry.lolaShotCount ?? 'N/A'} laser altimeter shots/bin), derived Horn slope is ${telemetry.slopeDeg?.toFixed(2) ?? 'N/A'}° ` +
        `(25 km P95: ${regionalStats25Km.slopeP95Deg.toFixed(2)}°), and TRI roughness is ${telemetry.triM?.toFixed(1) ?? 'N/A'} m ` +
        `at ${telemetry.resolutionMetersPerPixel} m/px baseline. ` +
        `Overall suitability score: ${analysis.suitability.total !== null ? Math.round(analysis.suitability.total * 100) : 'N/A'}/100. ` +
        (message ? `Query noted: "${message.slice(0, 120)}".` : '');

      sendJson(res, 200, {
        lat,
        lon: normLon180(lon),
        reply,
        provenance: 'deterministic_evidence_synthesis',
        analysis,
      });
      return;
    }

    // 7. GET /api/moon/agent/router-status
    // GET /api/moon/earth-climate — NASA POWER measured climate for every Earth analog site
    if (req.method === 'GET' && pathname === '/api/moon/earth-climate') {
      sendJson(res, 200, await getEarthAnalogClimate());
      return;
    }

    if (req.method === 'GET' && pathname === '/api/moon/agent/router-status') {
      sendJson(res, 200, llmRouter.getStatus());
      return;
    }

    // 8. POST /api/moon/agent/router-config
    if (req.method === 'POST' && pathname === '/api/moon/agent/router-config') {
      const body = await readJsonBody(req);
      llmRouter.updateConfig(body || {});
      sendJson(res, 200, llmRouter.getStatus());
      return;
    }

    // 9. POST /api/moon/agent/chat (Agentic AI Mission Planning System)
    if (req.method === 'POST' && pathname === '/api/moon/agent/chat') {
      const body = await readJsonBody(req);
      const messages = Array.isArray(body.messages) ? body.messages : [];
      if (messages.length === 0) {
        sendJson(res, 400, { error: 'At least one chat message is required.' });
        return;
      }

      const responsePayload = await runMissionAgentTurn({
        messages,
        currentSpec: body.currentSpec || null,
        experienceMode: body.experienceMode === 'advanced' ? 'advanced' : 'beginner',
        activeRoverId: typeof body.activeRoverId === 'string' ? body.activeRoverId : 'perseverance',
        savedCustomRoverConfig:
          body.savedCustomRoverConfig && typeof body.savedCustomRoverConfig === 'object'
            ? body.savedCustomRoverConfig
            : DEFAULT_CUSTOM_ROVER_CONFIG,
        currentLocation:
          body.currentLocation && Number.isFinite(Number(body.currentLocation.lat))
            ? { lat: Number(body.currentLocation.lat), lon: Number(body.currentLocation.lon) }
            : { lat: 18.4447, lon: 77.4508 },
        currentRouteStart:
          body.currentRouteStart && Number.isFinite(Number(body.currentRouteStart.lat))
            ? { lat: Number(body.currentRouteStart.lat), lon: Number(body.currentRouteStart.lon) }
            : { lat: 18.4447, lon: 77.4508 },
        currentRouteDestination:
          body.currentRouteDestination && Number.isFinite(Number(body.currentRouteDestination.lat))
            ? { lat: Number(body.currentRouteDestination.lat), lon: Number(body.currentRouteDestination.lon) }
            : { lat: 18.472, lon: 77.412 },
      });

      sendJson(res, 200, responsePayload);
      return;
    }

    sendJson(res, 404, { error: `Unknown Moon API endpoint: ${pathname}` });
  } catch (err) {
    sendJson(res, 500, {
      error: (err as Error).message || 'Internal server error in Moon intelligence engine.',
    });
  }
}
