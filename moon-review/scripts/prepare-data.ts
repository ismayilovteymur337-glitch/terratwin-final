import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { normLon180 } from '../src/core/geo/sphere.ts';
import { CraterRecord, DtmCatalogEntry, GeologicalFeature } from '../src/core/planet/types.ts';
import { MOON_PRESET_SITES } from '../src/moon/constants.ts';

const ROOT = process.cwd();
const RAW_DIR = path.join(ROOT, 'data', 'raw');
const OUT_DIR = path.join(ROOT, 'public', 'data');

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.mkdirSync(path.join(OUT_DIR, 'regional'), { recursive: true });

function sha256File(filePath: string): string {
  const h = crypto.createHash('sha256');
  h.update(fs.readFileSync(filePath));
  return h.digest('hex');
}

function copyIfNeeded(src: string, dest: string) {
  if (!fs.existsSync(src)) {
    throw new Error(`Missing raw file: ${src}`);
  }
  if (!fs.existsSync(dest) || fs.statSync(src).size !== fs.statSync(dest).size) {
    fs.copyFileSync(src, dest);
    console.log(`Copied ${path.basename(src)} -> public/data/`);
  }
}

function parseNomenclatureDbf(dbfPath: string): GeologicalFeature[] {
  const buf = fs.readFileSync(dbfPath);
  const numRecords = buf.readUInt32LE(4);
  const headerLen = buf.readUInt16LE(8);
  const recordLen = buf.readUInt16LE(10);

  interface FieldDesc {
    name: string;
    type: string;
    length: number;
    offset: number;
  }
  const fields: FieldDesc[] = [];
  let fieldOffset = 1; // byte 0 of record is deletion flag
  for (let o = 32; o < headerLen - 1; o += 32) {
    const rawName = buf.subarray(o, o + 11).toString('ascii').replace(/\0.*$/, '');
    const fType = String.fromCharCode(buf[o + 11]);
    const fLen = buf[o + 16];
    fields.push({ name: rawName, type: fType, length: fLen, offset: fieldOffset });
    fieldOffset += fLen;
  }

  const getField = (recStart: number, name: string): string => {
    const f = fields.find((fl) => fl.name === name);
    if (!f) return '';
    return buf
      .subarray(recStart + f.offset, recStart + f.offset + f.length)
      .toString('utf8')
      .trim();
  };

  const features: GeologicalFeature[] = [];
  for (let i = 0; i < numRecords; i++) {
    const recStart = headerLen + i * recordLen;
    if (recStart + recordLen > buf.length) break;
    if (buf[recStart] === 0x2a) continue; // deleted record

    const cleanName = getField(recStart, 'clean_name') || getField(recStart, 'name');
    const type = getField(recStart, 'type');
    const code = getField(recStart, 'code');
    const lat = parseFloat(getField(recStart, 'center_lat'));
    const lon360 = parseFloat(getField(recStart, 'center_lon'));
    const diameterKm = parseFloat(getField(recStart, 'diameter')) || 0;
    const origin = getField(recStart, 'origin');
    const link = getField(recStart, 'link');

    if (!cleanName || !Number.isFinite(lat) || !Number.isFinite(lon360)) continue;
    const id = link.split('/').pop() || `iau_${i}`;

    features.push({
      id,
      name: cleanName,
      type,
      code,
      lat: Math.round(lat * 10000) / 10000,
      lon: Math.round(normLon180(lon360) * 10000) / 10000,
      diameterKm: Math.round(diameterKm * 100) / 100,
      origin: origin ? origin.slice(0, 180) : undefined,
      link: link || undefined,
    });
  }

  return features;
}

function parseRobbinsCraters(tsvPath: string): CraterRecord[] {
  const raw = fs.readFileSync(tsvPath, 'utf8');
  const lines = raw.split(/\r\n|\n|\r/);
  const headers = lines[0].split('\t');

  const idxId = headers.indexOf('CRATER_ID');
  const idxLat = headers.indexOf('LATITUDE_CIRCLE_IMAGE');
  const idxLon = headers.indexOf('LONGITUDE_CIRCLE_IMAGE');
  const idxDiam = headers.indexOf('DIAM_CIRCLE_IMAGE');
  const idxDepth = headers.indexOf('DEPTH_RIMFLOOR_TOPOG');
  const idxMorph1 = headers.indexOf('MORPHOLOGY_CRATER_1');
  const idxMorphEj = headers.indexOf('MORPHOLOGY_EJECTA_1');
  const idxDeg = headers.indexOf('DEGRADATION_STATE');
  const idxName = headers.indexOf('CRATER_NAME');

  const out: CraterRecord[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const cols = line.split('\t');
    const diam = parseFloat(cols[idxDiam]);
    if (!Number.isFinite(diam) || diam < 2.0) continue;

    const lat = parseFloat(cols[idxLat]);
    const lonRaw = parseFloat(cols[idxLon]);
    if (!Number.isFinite(lat) || !Number.isFinite(lonRaw)) continue;
    const lon = normLon180(lonRaw);

    // Keep all craters >= 8 km globally, or >= 2.0 km within 5 degrees of any preset study site
    const nearPreset = MOON_PRESET_SITES.some(
      (p) => Math.abs(p.lat - lat) <= 4.5 && Math.abs(normLon180(p.lon - lon)) <= 4.5,
    );
    if (diam < 8.0 && !nearPreset) continue;

    const depth = parseFloat(cols[idxDepth]);
    const morph = [cols[idxMorph1], cols[idxMorphEj]].filter(Boolean).join(' / ');
    const deg = parseInt(cols[idxDeg], 10);
    const name = cols[idxName]?.trim();

    out.push({
      id: cols[idxId],
      name: name || undefined,
      lat: Math.round(lat * 10000) / 10000,
      lon: Math.round(lon * 10000) / 10000,
      diameterKm: Math.round(diam * 100) / 100,
      depthRimFloorKm: Number.isFinite(depth) && depth > 0 ? Math.round(depth * 1000) / 1000 : null,
      morphology: morph || undefined,
      degradationState: Number.isFinite(deg) ? deg : null,
    });
  }

  return out;
}

/**
 * Fetch a regional LOLA 128 PPD sub-window from NASA PDS via HTTP Range requests
 * so Jezero/NE Syrtis and Gale Crater have cached 463 m/px elevation grids ready offline.
 */
async function fetchLola128SubGrid(params: {
  id: string;
  tileName: string;
  tileNorth: number;
  tileWest360: number;
  south: number;
  north: number;
  west360: number;
  east360: number;
}) {
  const outPath = path.join(OUT_DIR, 'regional', `${params.id}_128ppd.bin`);
  const metaPath = path.join(OUT_DIR, 'regional', `${params.id}_128ppd.json`);
  if (fs.existsSync(outPath) && fs.existsSync(metaPath)) {
    console.log(`Regional 128 PPD cache already present for ${params.id}`);
    return;
  }

  const PPD = 128;
  const LINE_SAMPLES = 11520; // 90 deg * 128 ppd
  const RECORD_BYTES = LINE_SAMPLES * 2; // 23040 bytes per row

  const r0 = Math.max(0, Math.floor((params.tileNorth - params.north) * PPD));
  const r1 = Math.min(5631, Math.ceil((params.tileNorth - params.south) * PPD) - 1);
  const c0 = Math.max(0, Math.floor((params.west360 - params.tileWest360) * PPD));
  const c1 = Math.min(LINE_SAMPLES - 1, Math.ceil((params.east360 - params.tileWest360) * PPD) - 1);

  const height = r1 - r0 + 1;
  const width = c1 - c0 + 1;
  const rowByteLen = width * 2;

  const url = `https://pds-geosciences.wustl.edu/mgs/mgs-m-lola-5-megdr-l3-v1/mgsl_300x/meg128/${params.tileName}.img`;
  console.log(`Fetching LOLA 128 PPD regional window '${params.id}' (${width}x${height} @ 463 m/px) from ${url}...`);

  const outBuf = Buffer.alloc(width * height * 2);
  const CHUNK_ROWS = 64;

  for (let rs = r0; rs <= r1; rs += CHUNK_ROWS) {
    const re = Math.min(r1, rs + CHUNK_ROWS - 1);
    const ranges: string[] = [];
    for (let r = rs; r <= re; r++) {
      const startByte = r * RECORD_BYTES + c0 * 2;
      const endByte = startByte + rowByteLen - 1;
      ranges.push(`${startByte}-${endByte}`);
    }
    const res = await fetch(url, {
      headers: { Range: `bytes=${ranges.join(',')}` },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} fetching 128 PPD range for ${params.id}`);
    }
    const rawBytes = Buffer.from(await res.arrayBuffer());
    const cType = res.headers.get('content-type') || '';
    const boundaryMatch = cType.match(/boundary=(.+)$/i);

    if (!boundaryMatch) {
      // Single range
      rawBytes.copy(outBuf, (rs - r0) * rowByteLen, 0, rowByteLen);
    } else {
      // Parse multipart/byteranges parts in order
      let cursor = 0;
      for (let r = rs; r <= re; r++) {
        const hdrEnd = rawBytes.indexOf('\r\n\r\n', cursor);
        if (hdrEnd === -1) throw new Error('Malformed multipart/byteranges response');
        const dataStart = hdrEnd + 4;
        rawBytes.copy(outBuf, (r - r0) * rowByteLen, dataStart, dataStart + rowByteLen);
        cursor = dataStart + rowByteLen;
      }
    }
  }

  fs.writeFileSync(outPath, outBuf);
  const actualNorth = params.tileNorth - r0 / PPD;
  const actualWest = normLon180(params.tileWest360 + c0 / PPD);
  const meta = {
    id: params.id,
    source: `NASA PDS MGS LOLA MEGDR 128 PPD (${params.tileName.toUpperCase()})`,
    ppd: PPD,
    width,
    height,
    north: actualNorth,
    west: actualWest,
    dLat: 1 / PPD,
    dLon: 1 / PPD,
    sampleType: 'MSB_INTEGER_16',
    unit: 'meters_areoid',
  };
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
  console.log(`Saved ${params.id}_128ppd.bin (${outBuf.length} bytes)`);
}

async function fetchStacDtmCatalog(): Promise<Record<string, DtmCatalogEntry[]>> {
  const out: Record<string, DtmCatalogEntry[]> = {};
  for (const site of MOON_PRESET_SITES) {
    const w = (site.lon - 0.8 + 360) % 360;
    const e = (site.lon + 0.8 + 360) % 360;
    const s = Math.max(-89, site.lat - 0.8);
    const n = Math.min(89, site.lat + 0.8);
    const entries: DtmCatalogEntry[] = [];

    for (const coll of ['mro_hirise_socet_dtms', 'mro_ctx_controlled_usgs_dtms'] as const) {
      try {
        const url = `https://stac.astrogeology.usgs.gov/api/collections/${coll}/items?bbox=${w},${s},${e},${n}&limit=6`;
        const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
        if (!res.ok) continue;
        const data = (await res.json()) as any;
        for (const feat of data.features || []) {
          const dtmAsset = feat.assets?.dtm;
          if (!dtmAsset?.href) continue;
          const rawBbox: [number, number, number, number] = feat.bbox || [w, s, e, n];
          entries.push({
            id: feat.id,
            collection: coll === 'mro_hirise_socet_dtms' ? 'hirise_dtm' : 'ctx_dtm',
            title: feat.properties?.title || feat.id,
            gsdMeters: Math.round((feat.properties?.gsd || (coll === 'mro_hirise_socet_dtms' ? 1.0 : 20.0)) * 100) / 100,
            bbox: [normLon180(rawBbox[0]), rawBbox[1], normLon180(rawBbox[2]), rawBbox[3]],
            dtmUrl: dtmAsset.href,
            hillshadeUrl: feat.assets?.hillshade?.href || feat.assets?.image?.href,
            orthoUrl: feat.assets?.ortho_0?.href || feat.assets?.orthoimage?.href,
            thumbnailUrl: feat.assets?.thumbnail?.href,
            created: feat.properties?.datetime || feat.properties?.created,
          });
        }
      } catch (err) {
        console.warn(`STAC query warning for ${site.id} (${coll}):`, (err as Error).message);
      }
    }
    out[site.id] = entries;
  }
  return out;
}

async function main() {
  console.log('=== Preparing TERRATWIN NASA Planetary Datasets ===');

  // 1. Copy LOLA 4 PPD & 16 PPD rasters and labels
  const filesToCopy = [
    'megt90n000cb.img',
    'megt90n000cb.lbl',
    'megt90n000eb.img',
    'megt90n000eb.lbl',
    'megc90n000eb.img',
    'megc90n000eb.lbl',
  ];
  for (const f of filesToCopy) {
    copyIfNeeded(path.join(RAW_DIR, f), path.join(OUT_DIR, f));
  }

  // 2. Write checksum & metadata manifest
  const manifest = {
    generatedAt: new Date().toISOString(),
    planet: 'moon',
    referenceRadiusMeters: 3396000,
    files: Object.fromEntries(
      filesToCopy.map((f) => {
        const p = path.join(OUT_DIR, f);
        return [
          f,
          {
            bytes: fs.statSync(p).size,
            sha256: sha256File(p),
          },
        ];
      }),
    ),
  };
  fs.writeFileSync(path.join(OUT_DIR, 'lola-manifest.json'), JSON.stringify(manifest, null, 2));
  console.log('Wrote public/data/lola-manifest.json');

  // 3. Parse IAU / USGS Moon Nomenclature
  const nomenFeatures = parseNomenclatureDbf(
    path.join(RAW_DIR, 'nomen', 'MOON_nomenclature_center_pts.dbf'),
  );
  fs.writeFileSync(path.join(OUT_DIR, 'moon_nomenclature.json'), JSON.stringify(nomenFeatures));
  console.log(`Parsed ${nomenFeatures.length} official IAU Moon nomenclature features.`);

  // 4. Parse Robbins & Hynek (2012) Moon Crater Catalog
  const craters = parseRobbinsCraters(
    path.join(RAW_DIR, 'robbins', 'Combined Catalog - 20140830 (v2).txt'),
  );
  fs.writeFileSync(path.join(OUT_DIR, 'moon_craters_robbins.json'), JSON.stringify(craters));
  console.log(`Parsed ${craters.length} Robbins & Hynek (2012) impact craters.`);

  // 5. Pre-fetch 128 PPD (463 m/px) regional LOLA windows for Jezero/NE Syrtis and Gale Crater
  await fetchLola128SubGrid({
    id: 'jezero_nesyrtis',
    tileName: 'megt44n000hb',
    tileNorth: 44,
    tileWest360: 0,
    south: 17.2,
    north: 19.3,
    west360: 76.2,
    east360: 78.4,
  });

  await fetchLola128SubGrid({
    id: 'gale_mount_sharp',
    tileName: 'megt00n090hb',
    tileNorth: 0,
    tileWest360: 90,
    south: -6.2,
    north: -3.8,
    west360: 136.4,
    east360: 138.8,
  });

  // 6. Query USGS Astrogeology STAC for HiRISE & CTX DTMs across preset sites
  const stacCachePath = path.join(OUT_DIR, 'stac_dtm_cache.json');
  if (!fs.existsSync(stacCachePath)) {
    const stacCache = await fetchStacDtmCatalog();
    fs.writeFileSync(stacCachePath, JSON.stringify(stacCache, null, 2));
    console.log('Saved public/data/stac_dtm_cache.json');
  }

  // 7. Cache Zoom-2 (8x4 = 32 tiles, 2048x1024) global NASA Moon Trek base tiles for instant local startup
  for (const layer of [
    { id: 'viking_z2', name: 'Moon_Viking_MDIM21_ClrMosaic_global_232m' },
    { id: 'lola_z2', name: 'Moon_MGS_LOLA_ClrShade_merge_global_463m' },
  ]) {
    const dir = path.join(OUT_DIR, 'tiles', layer.id);
    fs.mkdirSync(dir, { recursive: true });
    const tasks: Promise<void>[] = [];
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 8; col++) {
        const dest = path.join(dir, `${row}_${col}.jpg`);
        if (fs.existsSync(dest) && fs.statSync(dest).size > 500) continue;
        const u = `https://trek.nasa.gov/tiles/Moon/EQ/${layer.name}/1.0.0/default/default028mm/2/${row}/${col}.jpg`;
        tasks.push(
          fetch(u)
            .then(async (r) => {
              if (r.ok) fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
            })
            .catch(() => {}),
        );
      }
    }
    if (tasks.length > 0) {
      await Promise.all(tasks);
      console.log(`Cached ${tasks.length} tiles for ${layer.id}`);
    }
  }

  console.log('=== Data Preparation Complete ===');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
