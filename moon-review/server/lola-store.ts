import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { BBox, DEG, normLon180, normLon360 } from '../src/core/geo/sphere.ts';
import {
  CraterRecord,
  DtmCatalogEntry,
  GeologicalFeature,
  LandingSiteAnalysis,
  PointTerrainTelemetry,
} from '../src/core/planet/types.ts';
import { TERRAIN_CLASSES } from '../src/core/terrain/classify.ts';
import {
  cellSpacing,
  computeSlope,
  computeTRI,
  detrendedRelief,
  ElevationGrid,
  gridIndexOf,
  nominalCellSize,
  sampleArray,
  sampleElevation,
  stats,
} from '../src/core/terrain/grid.ts';
import { MOON_BODY, MOON_PRESET_SITES } from '../src/moon/constants.ts';

export interface ProvenanceBreakdown {
  hirise1mPct: number;
  ctx20mPct: number;
  lola463mPct: number;
  primaryNoDataPct: number;
}

export interface RegionalCacheMeta {
  id: string;
  lodLevel?: number;
  source: string;
  dtmId?: string;
  crsCode?: string;
  nativeGsdMeters?: number;
  ppd: number;
  width: number;
  height: number;
  north: number;
  south?: number;
  west: number;
  east?: number;
  dLat: number;
  dLon: number;
  sampleType?: string;
  provenanceBreakdown?: ProvenanceBreakdown;
}

interface RegionalCacheEntry {
  meta: RegionalCacheMeta;
  grid: ElevationGrid;
  slope: Float32Array;
  tri: Float32Array;
  prov?: Uint8Array;
}

class MoonDataStore {
  private initialized = false;
  private elev16Buf!: Buffer;
  private count16Buf!: Buffer;
  private craters: CraterRecord[] = [];
  private features: GeologicalFeature[] = [];
  private stacCache: Record<string, DtmCatalogEntry[]> = {};
  private regional128: RegionalCacheEntry[] = [];
  private hiresGrids: RegionalCacheEntry[] = [];
  private dynamicStacCache = new Map<string, { ts: number; items: DtmCatalogEntry[] }>();

  public readonly width16 = 5760;
  public readonly height16 = 2880;
  public readonly ppd16 = 16;

  init(rootDir = process.cwd()): void {
    if (this.initialized) return;
    const dataDir = path.join(rootDir, 'public', 'data');
    const manifestPath = path.join(dataDir, 'lola-manifest.json');
    const elevPath = path.join(dataDir, 'megt90n000eb.img');
    const countPath = path.join(dataDir, 'megc90n000eb.img');

    if (!fs.existsSync(elevPath) || !fs.existsSync(manifestPath)) {
      throw new Error('Missing LOLA 16 PPD dataset in public/data/. Run `npm run data` first.');
    }

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    this.elev16Buf = fs.readFileSync(elevPath);
    if (manifest.files?.['megt90n000eb.img']?.bytes && this.elev16Buf.length !== manifest.files['megt90n000eb.img'].bytes) {
      throw new Error('LOLA MEGT90N000EB byte length mismatch against manifest.');
    }

    if (fs.existsSync(countPath)) {
      this.count16Buf = fs.readFileSync(countPath);
    } else {
      this.count16Buf = Buffer.alloc(0);
    }

    const nomenPath = path.join(dataDir, 'moon_nomenclature.json');
    if (fs.existsSync(nomenPath)) {
      this.features = JSON.parse(fs.readFileSync(nomenPath, 'utf8'));
    }

    const cratersPath = path.join(dataDir, 'moon_craters_robbins.json');
    if (fs.existsSync(cratersPath)) {
      this.craters = JSON.parse(fs.readFileSync(cratersPath, 'utf8'));
    }

    const stacPath = path.join(dataDir, 'stac_dtm_cache.json');
    if (fs.existsSync(stacPath)) {
      this.stacCache = JSON.parse(fs.readFileSync(stacPath, 'utf8'));
    }

    // Load pre-cached 128 PPD regional grids and high-resolution CTX/HiRISE stereo DTM grids
    const regDir = path.join(dataDir, 'regional');
    if (fs.existsSync(regDir)) {
      for (const file of fs.readdirSync(regDir)) {
        if (!file.endsWith('_128ppd.json') && !file.endsWith('_hires.json')) continue;
        const meta: RegionalCacheMeta = JSON.parse(fs.readFileSync(path.join(regDir, file), 'utf8'));
        const binFile = path.join(regDir, file.replace('.json', '.bin'));
        if (!fs.existsSync(binFile)) continue;
        const raw = fs.readFileSync(binFile);
        const elevation = new Float32Array(meta.width * meta.height);
        if (meta.sampleType === 'FLOAT32_LE') {
          for (let i = 0; i < elevation.length; i++) {
            elevation[i] = raw.readFloatLE(i * 4);
          }
        } else {
          for (let i = 0; i < elevation.length; i++) {
            elevation[i] = raw.readInt16BE(i * 2);
          }
        }
        const provFile = path.join(regDir, file.replace('.json', '.prov.bin'));
        const prov = fs.existsSync(provFile) ? new Uint8Array(fs.readFileSync(provFile)) : undefined;

        const grid: ElevationGrid = {
          width: meta.width,
          height: meta.height,
          north: meta.north,
          west: meta.west,
          dLat: meta.dLat,
          dLon: meta.dLon,
          elevation,
        };
        const entry: RegionalCacheEntry = {
          meta,
          grid,
          slope: computeSlope(grid, MOON_BODY.meanRadiusM),
          tri: computeTRI(grid),
          prov,
        };
        if (file.endsWith('_128ppd.json')) {
          this.regional128.push(entry);
        } else {
          this.hiresGrids.push(entry);
        }
      }
      // Sort hiresGrids by finest spatial resolution first (Level 3 HiRISE 1m before Level 2 CTX 20m)
      this.hiresGrids.sort((a, b) => a.grid.dLat - b.grid.dLat);
    }

    this.initialized = true;
  }

  getCraters(): CraterRecord[] {
    this.init();
    return this.craters;
  }

  getFeatures(): GeologicalFeature[] {
    this.init();
    return this.features;
  }

  /** Read a single Int16 elevation from 16 PPD LOLA (row 0 = 90N, col 0 = 0E). */
  readElev16Cell(row: number, col: number): number {
    const r = Math.max(0, Math.min(this.height16 - 1, row));
    const c = ((col % this.width16) + this.width16) % this.width16;
    return this.elev16Buf.readInt16BE((r * this.width16 + c) * 2);
  }

  /** Read LOLA laser shot count for a 16 PPD cell. */
  readShotCount16Cell(lat: number, lon: number): number | null {
    if (!this.count16Buf || this.count16Buf.length === 0) return null;
    const lon360 = normLon360(lon);
    const r = Math.max(0, Math.min(this.height16 - 1, Math.floor((90 - lat) * this.ppd16)));
    const c = Math.max(0, Math.min(this.width16 - 1, Math.floor(lon360 * this.ppd16)));
    return this.count16Buf.readUInt16BE((r * this.width16 + c) * 2);
  }

  /** Extract a sub-grid from the global 16 PPD LOLA raster covering `bbox`. */
  extractSubGrid16Ppd(bbox: BBox): ElevationGrid {
    this.init();
    const ppd = this.ppd16;
    const r0 = Math.max(0, Math.floor((90 - bbox.north) * ppd));
    const r1 = Math.min(this.height16 - 1, Math.ceil((90 - bbox.south) * ppd));
    const spanLon = Math.min(360, Math.max(0.25, bbox.east - bbox.west));
    const width = Math.max(4, Math.ceil(spanLon * ppd));
    const height = Math.max(4, r1 - r0 + 1);

    const north = 90 - r0 / ppd;
    const west = normLon180(bbox.west);
    const west360 = normLon360(west);
    const c0 = Math.floor(west360 * ppd);

    const elevation = new Float32Array(width * height);
    for (let r = 0; r < height; r++) {
      const rr = Math.min(this.height16 - 1, r0 + r);
      for (let c = 0; c < width; c++) {
        const cc = (c0 + c) % this.width16;
        elevation[r * width + c] = this.elev16Buf.readInt16BE((rr * this.width16 + cc) * 2);
      }
    }

    return {
      width,
      height,
      north,
      west: normLon180(c0 / ppd),
      dLat: 1 / ppd,
      dLon: 1 / ppd,
      elevation,
    };
  }

  /** Find a cached 128 PPD regional grid that contains `lat, lon` with margin. */
  findRegional128ForPoint(lat: number, lon: number, marginDeg = 0.08): RegionalCacheEntry | null {
    this.init();
    const l = normLon180(lon);
    for (const reg of this.regional128) {
      const south = reg.grid.north - reg.grid.height * reg.grid.dLat;
      const east = reg.grid.west + reg.grid.width * reg.grid.dLon;
      if (
        lat <= reg.grid.north - marginDeg &&
        lat >= south + marginDeg &&
        l >= reg.grid.west + marginDeg &&
        l <= east - marginDeg
      ) {
        return reg;
      }
    }
    return null;
  }

  /** Find a cached 128 PPD regional grid whose bounds cover the center and majority of `bbox`. */
  findRegional128ForBBox(bbox: BBox): RegionalCacheEntry | null {
    this.init();
    const w = normLon180(bbox.west);
    const e = normLon180(bbox.east);
    if (e < w) return null;
    const centerLat = (bbox.south + bbox.north) * 0.5;
    const centerLon = (w + e) * 0.5;
    for (const reg of this.regional128) {
      const south = reg.grid.north - reg.grid.height * reg.grid.dLat;
      const east = reg.grid.west + reg.grid.width * reg.grid.dLon;
      if (
        bbox.north <= reg.grid.north + 0.02 &&
        bbox.south >= south - 0.02 &&
        w >= reg.grid.west - 0.02 &&
        e <= east + 0.02
      ) {
        return reg;
      }
    }
    return null;
  }

  /**
   * Sample point terrain telemetry (elevation, Horn slope, aspect, TRI,
   * detrended RMS relief, LOLA shot count, and terrain classification).
   */
  samplePointTelemetry(lat: number, lon: number): {
    telemetry: PointTerrainTelemetry;
    regionalStats25Km: LandingSiteAnalysis['regionalStats25Km'];
  } {
    this.init();
    const cleanLat = Math.max(-89.9, Math.min(89.9, lat));
    const cleanLon = normLon180(lon);

    const reg128 = this.findRegional128ForPoint(cleanLat, cleanLon, 0.12);
    let grid: ElevationGrid;
    let slopeArr: Float32Array;
    let triArr: Float32Array;
    let sourceLabel: string;

    if (reg128) {
      grid = reg128.grid;
      slopeArr = reg128.slope;
      triArr = reg128.tri;
      sourceLabel = reg128.meta.source;
    } else {
      const pad = 0.85; // ~50 km radius around point
      grid = this.extractSubGrid16Ppd({
        south: Math.max(-89.8, cleanLat - pad),
        north: Math.min(89.8, cleanLat + pad),
        west: cleanLon - pad / Math.max(0.15, Math.cos(cleanLat * DEG)),
        east: cleanLon + pad / Math.max(0.15, Math.cos(cleanLat * DEG)),
      });
      slopeArr = computeSlope(grid, MOON_BODY.meanRadiusM);
      triArr = computeTRI(grid);
      sourceLabel = 'NASA PDS MGS LOLA MEGDR 16 PPD (MEGT90N000EB v2.0)';
    }

    const resM = nominalCellSize(grid, MOON_BODY.meanRadiusM);
    const elev = sampleElevation(grid, cleanLat, cleanLon);
    const polarLimit = Math.abs(cleanLat) > 85;
    const slope = polarLimit ? NaN : sampleArray(grid, slopeArr, cleanLat, cleanLon);
    const tri = polarLimit ? NaN : sampleArray(grid, triArr, cleanLat, cleanLon);

    // Compute aspect (deg clockwise from north of downslope direction)
    const idx = gridIndexOf(grid, cleanLat, cleanLon);
    const r = Math.max(1, Math.min(grid.height - 2, Math.round(idx.r)));
    const c = Math.max(1, Math.min(grid.width - 2, Math.round(idx.c)));
    const { dx, dy } = cellSpacing(grid, r, MOON_BODY.meanRadiusM);
    const dzdx = (grid.elevation[r * grid.width + (c + 1)] - grid.elevation[r * grid.width + (c - 1)]) / (2 * dx);
    const dzdy = (grid.elevation[(r + 1) * grid.width + c] - grid.elevation[(r - 1) * grid.width + c]) / (2 * dy);
    const aspect = polarLimit ? null : Math.round(((Math.atan2(-dzdx, dzdy) / DEG + 360) % 360) * 10) / 10;

    const detrended = polarLimit
      ? { rms: NaN, n: 0, relief: NaN }
      : detrendedRelief(grid, cleanLat, cleanLon, 15_000, MOON_BODY.meanRadiusM);

    const shotCount = this.readShotCount16Cell(cleanLat, cleanLon);

    // Regional 25 km statistics
    const radius25Km = 25_000;
    const nr = Math.ceil(radius25Km / dy);
    const nc = Math.ceil(radius25Km / dx);
    const elevSamples: number[] = [];
    const slopeSamples: number[] = [];
    const triSamples: number[] = [];

    for (let rr = r - nr; rr <= r + nr; rr++) {
      if (rr < 0 || rr >= grid.height) continue;
      for (let cc = c - nc; cc <= c + nc; cc++) {
        if (cc < 0 || cc >= grid.width) continue;
        const x = (cc - idx.c) * dx;
        const y = (rr - idx.r) * dy;
        if (x * x + y * y > radius25Km * radius25Km) continue;
        const k = rr * grid.width + cc;
        if (Number.isFinite(grid.elevation[k])) elevSamples.push(grid.elevation[k]);
        if (!polarLimit && Number.isFinite(slopeArr[k])) slopeSamples.push(slopeArr[k]);
        if (!polarLimit && Number.isFinite(triArr[k])) triSamples.push(triArr[k]);
      }
    }

    const eSt = stats(elevSamples);
    const sSt = stats(slopeSamples);
    const tSt = stats(triSamples);

    // Terrain classification
    const roughThresh = Math.max(15, resM * 0.012);
    let classCode = 0;
    if (Number.isFinite(slope) && Number.isFinite(tri)) {
      if (slope >= 8.0) classCode = 3;
      else if (tri >= roughThresh) classCode = 4;
      else if (slope < 2.0) classCode = 1;
      else classCode = 2;
    }
    const classMeta = TERRAIN_CLASSES[classCode];

    const telemetry: PointTerrainTelemetry = {
      lat: Math.round(cleanLat * 10000) / 10000,
      lon: Math.round(cleanLon * 10000) / 10000,
      elevationM: Number.isFinite(elev) ? Math.round(elev * 10) / 10 : null,
      slopeDeg: Number.isFinite(slope) ? Math.round(slope * 100) / 100 : null,
      aspectDeg: aspect,
      triM: Number.isFinite(tri) ? Math.round(tri * 10) / 10 : null,
      rmsReliefM: Number.isFinite(detrended.rms) ? Math.round(detrended.rms * 10) / 10 : null,
      reliefSpanM: Number.isFinite(detrended.relief) ? Math.round(detrended.relief * 10) / 10 : null,
      baselineM: Math.round(resM),
      lolaShotCount: shotCount,
      terrainClassCode: classMeta.code,
      terrainClassId: classMeta.id,
      terrainClassLabel: classMeta.label,
      terrainClassRule: classMeta.rule,
      resolutionSource: sourceLabel,
      resolutionMetersPerPixel: Math.round(resM),
    };

    return {
      telemetry,
      regionalStats25Km: {
        elevationMinM: Number.isFinite(eSt.min) ? Math.round(eSt.min) : 0,
        elevationMaxM: Number.isFinite(eSt.max) ? Math.round(eSt.max) : 0,
        elevationMeanM: Number.isFinite(eSt.mean) ? Math.round(eSt.mean) : 0,
        slopeMeanDeg: Number.isFinite(sSt.mean) ? Math.round(sSt.mean * 100) / 100 : 0,
        slopeP95Deg: Number.isFinite(sSt.p95) ? Math.round(sSt.p95 * 100) / 100 : 0,
        slopeMaxDeg: Number.isFinite(sSt.max) ? Math.round(sSt.max * 100) / 100 : 0,
        triMeanM: Number.isFinite(tSt.mean) ? Math.round(tSt.mean * 10) / 10 : 0,
        triP95M: Number.isFinite(tSt.p95) ? Math.round(tSt.p95 * 10) / 10 : 0,
        sampleCount: elevSamples.length,
      },
    };
  }

  /**
   * Return the highest-resolution ElevationGrid covering `bbox` for regional/local 3D
   * terrain rendering or rover route planning (adaptive Level of Detail:
   * LOD 3 HiRISE 1 m Stereo DTM -> LOD 2 CTX 20 m Stereo DTM -> LOD 2 LOLA 128 PPD -> LOD 1 LOLA 16 PPD).
   */
  getBestGridForBBox(bbox: BBox): {
    grid: ElevationGrid;
    source: string;
    lodLevel: 1 | 2 | 3;
    dtmId: string;
    crsCode: string;
    nativeGsdMeters: number;
    provenanceBreakdown: ProvenanceBreakdown;
    verticalUncertaintyMeters: string;
  } {
    this.init();
    const w = normLon180(bbox.west);
    const e = normLon180(bbox.east);
    const centerLat = (bbox.south + bbox.north) * 0.5;
    const centerLon = (w + e) * 0.5;
    const spanLat = bbox.north - bbox.south;
    const spanLon = e - w;

    // 1. Check high-resolution stereo DTM grids (Level 3 HiRISE 1 m & Level 2 CTX 20 m)
    if (e >= w) {
      for (const hr of this.hiresGrids) {
        const south = hr.grid.north - hr.grid.height * hr.grid.dLat;
        const east = hr.grid.west + hr.grid.width * hr.grid.dLon;
        const hrSpanLat = hr.grid.north - south;
        const hrSpanLon = east - hr.grid.west;
        if (
          bbox.north <= hr.grid.north + 0.005 &&
          bbox.south >= south - 0.005 &&
          w >= hr.grid.west - 0.005 &&
          e <= east + 0.005
        ) {
          const g = hr.grid;
          const r0 = Math.max(0, Math.floor((g.north - bbox.north) / g.dLat));
          const r1 = Math.min(g.height - 1, Math.ceil((g.north - bbox.south) / g.dLat));
          const c0 = Math.max(0, Math.floor((w - g.west) / g.dLon));
          const c1 = Math.min(g.width - 1, Math.ceil((e - g.west) / g.dLon));
          const width = Math.max(4, c1 - c0 + 1);
          const height = Math.max(4, r1 - r0 + 1);
          const elevation = new Float32Array(width * height);
          let countHi = 0;
          let countCtx = 0;
          let countLola = 0;
          for (let r = 0; r < height; r++) {
            for (let c = 0; c < width; c++) {
              const srcIdx = (r0 + r) * g.width + (c0 + c);
              elevation[r * width + c] = g.elevation[srcIdx];
              const p = hr.prov ? hr.prov[srcIdx] : 1;
              if (p === 2) countHi++;
              else if (p === 1) countCtx++;
              else countLola++;
            }
          }
          const total = width * height;
          const lodLevel = (hr.meta.lodLevel === 3 && countHi > total * 0.15 ? 3 : 2) as 1 | 2 | 3;
          return {
            grid: {
              width,
              height,
              north: g.north - r0 * g.dLat,
              west: g.west + c0 * g.dLon,
              dLat: g.dLat,
              dLon: g.dLon,
              elevation,
            },
            source: hr.meta.source,
            lodLevel,
            dtmId: hr.meta.dtmId || hr.meta.id,
            crsCode: hr.meta.crsCode || 'IAU_2015:49910',
            nativeGsdMeters: hr.meta.nativeGsdMeters || (lodLevel === 3 ? 1.02 : 20.16),
            provenanceBreakdown: {
              hirise1mPct: Math.round((countHi / total) * 1000) / 10,
              ctx20mPct: Math.round((countCtx / total) * 1000) / 10,
              lola463mPct: Math.round((countLola / total) * 1000) / 10,
              primaryNoDataPct:
                lodLevel === 3
                  ? Math.round(((total - countHi) / total) * 1000) / 10
                  : Math.round((countLola / total) * 1000) / 10,
            },
            verticalUncertaintyMeters:
              lodLevel === 3
                ? '±0.2–0.5 m vertical precision (HiRISE SOCET Stereo DTM, co-registered to LOLA Areoid)'
                : '±3.0–5.0 m vertical precision (CTX Stereo DTM, co-registered to LOLA Areoid)',
          };
        }
      }
    }

    // 2. Check cached 128 PPD LOLA regional grids (Level 2 Regional Fallback)
    const reg = this.findRegional128ForBBox(bbox);
    if (reg) {
      const g = reg.grid;
      const r0 = Math.max(0, Math.floor((g.north - bbox.north) / g.dLat));
      const r1 = Math.min(g.height - 1, Math.ceil((g.north - bbox.south) / g.dLat));
      const c0 = Math.max(0, Math.floor((normLon180(bbox.west) - g.west) / g.dLon));
      const c1 = Math.min(g.width - 1, Math.ceil((normLon180(bbox.east) - g.west) / g.dLon));
      const width = Math.max(4, c1 - c0 + 1);
      const height = Math.max(4, r1 - r0 + 1);
      const elevation = new Float32Array(width * height);
      for (let r = 0; r < height; r++) {
        for (let c = 0; c < width; c++) {
          elevation[r * width + c] = g.elevation[(r0 + r) * g.width + (c0 + c)];
        }
      }
      return {
        grid: {
          width,
          height,
          north: g.north - r0 * g.dLat,
          west: g.west + c0 * g.dLon,
          dLat: g.dLat,
          dLon: g.dLon,
          elevation,
        },
        source: reg.meta.source,
        lodLevel: 2,
        dtmId: reg.meta.id,
        crsCode: 'PDS_LOLA_EQUIRECT (IAU 2000 Sphere R = 3,396,000 m)',
        nativeGsdMeters: 463,
        provenanceBreakdown: {
          hirise1mPct: 0,
          ctx20mPct: 0,
          lola463mPct: 100,
          primaryNoDataPct: 0,
        },
        verticalUncertaintyMeters: '±1.0 m radial orbit accuracy, ~463 m horizontal grid spacing (LOLA 128 PPD)',
      };
    }

    // 3. Global 16 PPD LOLA fallback (Level 1 Global Overview)
    return {
      grid: this.extractSubGrid16Ppd(bbox),
      source: 'NASA PDS MGS LOLA MEGDR 16 PPD (MEGT90N000EB v2.0, ~3.7 km/px)',
      lodLevel: 1,
      dtmId: 'MEGT90N000EB_16PPD',
      crsCode: 'PDS_LOLA_EQUIRECT (IAU 2000 Sphere R = 3,396,000 m)',
      nativeGsdMeters: 3704,
      provenanceBreakdown: {
        hirise1mPct: 0,
        ctx20mPct: 0,
        lola463mPct: 100,
        primaryNoDataPct: 0,
      },
      verticalUncertaintyMeters: '±1.0 m laser altimeter vertical accuracy, ~3,704 m horizontal grid spacing (LOLA 16 PPD)',
    };
  }

  /**
   * Synchronously match cached HiRISE/CTX stereo DTMs near a point without network I/O.
   */
  getCachedDtmsNear(lat: number, lon: number, extraDtms: DtmCatalogEntry[] = []): DtmCatalogEntry[] {
    this.init();
    const l = normLon180(lon);
    const matches = new Map<string, DtmCatalogEntry>();
    const pool: DtmCatalogEntry[] = [...extraDtms];
    for (const list of Object.values(this.stacCache)) {
      if (Array.isArray(list)) pool.push(...list);
    }
    for (const dtm of pool) {
      const [w, s, e, n] = dtm.bbox;
      if (lat >= s - 0.45 && lat <= n + 0.45 && l >= w - 0.45 && l <= e + 0.45) {
        matches.set(dtm.id, dtm);
      }
    }
    return Array.from(matches.values());
  }

  /**
   * Look up available HiRISE (~1 m) and CTX (~20 m) stereo DTMs from cached
   * STAC catalog or live USGS Astrogeology STAC query.
   */
  /**
   * Same as getAvailableDtms, but never makes a page wait for the USGS STAC service: if the answer is
   * not ready within `waitMs`, return an empty list now and let the lookup finish in the background
   * (its result is cached, so the next request at this spot has it).
   */
  async getAvailableDtmsQuick(lat: number, lon: number, waitMs = 600): Promise<DtmCatalogEntry[]> {
    const lookup = this.getAvailableDtms(lat, lon).catch(() => [] as DtmCatalogEntry[]);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<DtmCatalogEntry[]>((resolve) => {
      timer = setTimeout(() => resolve([]), waitMs);
    });
    try {
      return await Promise.race([lookup, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async getAvailableDtms(lat: number, lon: number): Promise<DtmCatalogEntry[]> {
    this.init();
    const l = normLon180(lon);

    // Check preset cache first
    for (const site of MOON_PRESET_SITES) {
      if (Math.abs(site.lat - lat) < 0.75 && Math.abs(normLon180(site.lon - l)) < 0.75) {
        if (this.stacCache[site.id]?.length) {
          return this.stacCache[site.id];
        }
      }
    }

    const key = `${lat.toFixed(1)},${l.toFixed(1)}`;
    const cached = this.dynamicStacCache.get(key);
    if (cached && Date.now() - cached.ts < 3600_000) {
      return cached.items;
    }

    const w = normLon360(l - 0.5);
    const e = normLon360(l + 0.5);
    const s = Math.max(-89, lat - 0.5);
    const n = Math.min(89, lat + 0.5);
    const items: DtmCatalogEntry[] = [];

    // Both collections are queried in parallel (previously one after the other: up to 7 s).
    await Promise.all((['mro_hirise_socet_dtms', 'mro_ctx_controlled_usgs_dtms'] as const).map(async (coll) => {
      try {
        const url = `https://stac.astrogeology.usgs.gov/api/collections/${coll}/items?bbox=${w},${s},${e},${n}&limit=4`;
        const res = await fetch(url, { signal: AbortSignal.timeout(3500) });
        if (!res.ok) return;
        const data = (await res.json()) as any;
        for (const feat of data.features || []) {
          const dtmAsset = feat.assets?.dtm;
          if (!dtmAsset?.href) continue;
          const rawBbox: [number, number, number, number] = feat.bbox || [w, s, e, n];
          items.push({
            id: feat.id,
            collection: coll === 'mro_hirise_socet_dtms' ? 'hirise_dtm' : 'ctx_dtm',
            title: feat.properties?.title || feat.id,
            gsdMeters: Math.round((feat.properties?.gsd || (coll === 'mro_hirise_socet_dtms' ? 1.0 : 20.0)) * 100) / 100,
            bbox: [normLon180(rawBbox[0]), rawBbox[1], normLon180(rawBbox[2]), rawBbox[3]],
            dtmUrl: dtmAsset.href,
            hillshadeUrl: feat.assets?.hillshade?.href || feat.assets?.image?.href,
            orthoUrl: feat.assets?.ortho_0?.href || feat.assets?.orthoimage?.href,
            thumbnailUrl: feat.assets?.thumbnail?.href,
            created: feat.properties?.datetime,
          });
        }
      } catch {
        // Ignore live network timeouts and return whatever was found
      }
    }));
    // Keep a stable order regardless of which request finished first: HiRISE (1 m) before CTX (20 m).
    items.sort((a, b) => (a.collection === b.collection ? 0 : a.collection === 'hirise_dtm' ? -1 : 1));

    if (this.dynamicStacCache.size > 256) {
      const firstKey = this.dynamicStacCache.keys().next().value;
      if (firstKey) this.dynamicStacCache.delete(firstKey);
    }
    this.dynamicStacCache.set(key, { ts: Date.now(), items });
    return items;
  }
}

export const moonStore = new MoonDataStore();
