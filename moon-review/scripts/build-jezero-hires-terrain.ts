import * as fs from 'node:fs';
import * as path from 'node:path';
import { fetchCogOverviewGrid, DecodedCogOverview } from '../server/cog-dtm-reader.ts';

function sampleDecodedCogBilinear(cog: DecodedCogOverview, lat: number, lon: number): number {
  if (lat > cog.north || lat < cog.south || lon < cog.west || lon > cog.east) return NaN;
  const r = (cog.north - lat) / cog.dLat - 0.5;
  const c = (lon - cog.west) / cog.dLon - 0.5;
  const r0 = Math.max(0, Math.min(cog.height - 1, Math.floor(r)));
  const c0 = Math.max(0, Math.min(cog.width - 1, Math.floor(c)));
  const r1 = Math.min(cog.height - 1, r0 + 1);
  const c1 = Math.min(cog.width - 1, c0 + 1);
  const fr = Math.max(0, Math.min(1, r - r0));
  const fc = Math.max(0, Math.min(1, c - c0));

  const v00 = cog.elevation[r0 * cog.width + c0];
  const v01 = cog.elevation[r0 * cog.width + c1];
  const v10 = cog.elevation[r1 * cog.width + c0];
  const v11 = cog.elevation[r1 * cog.width + c1];

  if (Number.isFinite(v00) && Number.isFinite(v01) && Number.isFinite(v10) && Number.isFinite(v11)) {
    const top = v00 * (1 - fc) + v01 * fc;
    const bot = v10 * (1 - fc) + v11 * fc;
    return top * (1 - fr) + bot * fr;
  }
  // Nearest valid neighbour if on strip boundary
  for (const v of [v00, v01, v10, v11]) {
    if (Number.isFinite(v)) return v;
  }
  return NaN;
}

async function main() {
  const regDir = path.join(process.cwd(), 'public', 'data', 'regional');
  const lolaMeta = JSON.parse(fs.readFileSync(path.join(regDir, 'jezero_nesyrtis_128ppd.json'), 'utf8'));
  const lolaRaw = fs.readFileSync(path.join(regDir, 'jezero_nesyrtis_128ppd.bin'));
  const lolaElev = new Float32Array(lolaMeta.width * lolaMeta.height);
  for (let i = 0; i < lolaElev.length; i++) {
    lolaElev[i] = lolaRaw.readInt16BE(i * 2);
  }
  const lolaCog: DecodedCogOverview = {
    width: lolaMeta.width,
    height: lolaMeta.height,
    north: lolaMeta.north,
    south: lolaMeta.north - lolaMeta.height * lolaMeta.dLat,
    west: lolaMeta.west,
    east: lolaMeta.west + lolaMeta.width * lolaMeta.dLon,
    dLat: lolaMeta.dLat,
    dLon: lolaMeta.dLon,
    nativeGsdMeters: 463,
    overviewGsdMeters: 463,
    crsCode: 'PDS_LOLA_EQUIRECT',
    noDataValue: -32768,
    validSampleCount: lolaElev.length,
    totalSampleCount: lolaElev.length,
    noDataFraction: 0,
    elevation: lolaElev,
  };

  console.log('1. Streaming CTX 20 m Stereo DTM (P18_007925_1987_XN_18N282W__P19_008650_1987_XI_18N282W) IFD[2]...');
  const ctxCog = await fetchCogOverviewGrid({
    url: 'https://astrogeo-ard.s3-us-west-2.amazonaws.com/moon/mro/ctx/controlled/usgs/P18_007925_1987_XN_18N282W__P19_008650_1987_XI_18N282W/P18_007925_1987_XN_18N282W__P19_008650_1987_XI_18N282W_dtm.tif',
    bbox: [77.21281144352704, 17.757789235602306, 77.90597708129924, 19.342308862718042],
    nativeGsdMeters: 20.16,
    targetIfdIndex: 2,
  });
  console.log(
    `   CTX decoded: ${ctxCog.width}x${ctxCog.height} (${ctxCog.overviewGsdMeters} m/px), valid=${ctxCog.validSampleCount}/${ctxCog.totalSampleCount} (NoData=${(ctxCog.noDataFraction * 100).toFixed(1)}%)`,
  );

  console.log('2. Streaming HiRISE 1 m Stereo DTM West Delta (DTEEC_045994_1985_046060_1985_U01) IFD[3]...');
  const hiWestCog = await fetchCogOverviewGrid({
    url: 'https://astrogeo-ard.s3-us-west-2.amazonaws.com/moon/mro/hirise/controlled/dtm/ESP_045994_1985_ESP_046060_1985/DTEEC_045994_1985_046060_1985_U01.tif',
    bbox: [77.3834, 18.3055, 77.5008, 18.548],
    nativeGsdMeters: 1.02,
    targetIfdIndex: 3,
  });
  console.log(
    `   HiRISE West decoded: ${hiWestCog.width}x${hiWestCog.height} (${hiWestCog.overviewGsdMeters} m/px), valid=${hiWestCog.validSampleCount}/${hiWestCog.totalSampleCount} (NoData=${(hiWestCog.noDataFraction * 100).toFixed(1)}%)`,
  );

  console.log('3. Streaming HiRISE 1 m Stereo DTM East Floor (DTEEC_048842_1985_048908_1985_U01) IFD[3]...');
  const hiEastCog = await fetchCogOverviewGrid({
    url: 'https://astrogeo-ard.s3-us-west-2.amazonaws.com/moon/mro/hirise/controlled/dtm/ESP_048842_1985_ESP_048908_1985/DTEEC_048842_1985_048908_1985_U01.tif',
    bbox: [77.4615, 18.3372, 77.5841, 18.5883],
    nativeGsdMeters: 1.02,
    targetIfdIndex: 3,
  });
  console.log(
    `   HiRISE East decoded: ${hiEastCog.width}x${hiEastCog.height} (${hiEastCog.overviewGsdMeters} m/px), valid=${hiEastCog.validSampleCount}/${hiEastCog.totalSampleCount} (NoData=${(hiEastCog.noDataFraction * 100).toFixed(1)}%)`,
  );

  // Compute vertical datum tie-in offsets relative to LOLA 128 PPD so co-registered layers have zero vertical step at strip boundaries
  const computeMedianOffset = (highCog: DecodedCogOverview, refCog: DecodedCogOverview) => {
    const diffs: number[] = [];
    for (let r = 0; r < highCog.height; r += 4) {
      const lat = highCog.north - (r + 0.5) * highCog.dLat;
      for (let c = 0; c < highCog.width; c += 4) {
        const vHigh = highCog.elevation[r * highCog.width + c];
        if (!Number.isFinite(vHigh)) continue;
        const lon = highCog.west + (c + 0.5) * highCog.dLon;
        const vRef = sampleDecodedCogBilinear(refCog, lat, lon);
        if (Number.isFinite(vRef)) diffs.push(vRef - vHigh);
      }
    }
    if (diffs.length === 0) return 0;
    diffs.sort((a, b) => a - b);
    return diffs[Math.floor(diffs.length / 2)];
  };

  const ctxToLolaOffset = computeMedianOffset(ctxCog, lolaCog);
  for (let i = 0; i < ctxCog.elevation.length; i++) {
    if (Number.isFinite(ctxCog.elevation[i])) ctxCog.elevation[i] += ctxToLolaOffset;
  }
  const hiWestToCtxOffset = computeMedianOffset(hiWestCog, ctxCog);
  for (let i = 0; i < hiWestCog.elevation.length; i++) {
    if (Number.isFinite(hiWestCog.elevation[i])) hiWestCog.elevation[i] += hiWestToCtxOffset;
  }
  const hiEastToCtxOffset = computeMedianOffset(hiEastCog, ctxCog);
  for (let i = 0; i < hiEastCog.elevation.length; i++) {
    if (Number.isFinite(hiEastCog.elevation[i])) hiEastCog.elevation[i] += hiEastToCtxOffset;
  }
  console.log(
    `   Co-registration vertical tie-in offsets: CTX->LOLA=${ctxToLolaOffset.toFixed(2)}m, HiRISE_W->CTX=${hiWestToCtxOffset.toFixed(2)}m, HiRISE_E->CTX=${hiEastToCtxOffset.toFixed(2)}m`,
  );

  // Build Level 3 Local HiRISE + CTX Co-Registered Grid covering Jezero Western Delta & Landing Site
  // Bounds: 18.32°N .. 18.56°N (span 0.24° = 14.2 km), 77.34°E .. 77.58°E (span 0.24° = 13.5 km)
  // Grid size: 480 x 480 (dLat = 0.0005° = ~29.6 m post spacing)
  const buildFusedGrid = (opts: {
    id: string;
    lodLevel: number;
    north: number;
    south: number;
    west: number;
    east: number;
    width: number;
    height: number;
    source: string;
    dtmId: string;
    nativeGsdMeters: number;
    crsCode: string;
  }) => {
    const dLat = (opts.north - opts.south) / opts.height;
    const dLon = (opts.east - opts.west) / opts.width;
    const elevBuf = Buffer.allocUnsafe(opts.width * opts.height * 4); // Float32LE
    const provBuf = Buffer.allocUnsafe(opts.width * opts.height); // 2=HiRISE, 1=CTX, 0=LOLA128
    let countHi = 0;
    let countCtx = 0;
    let countLola = 0;

    for (let r = 0; r < opts.height; r++) {
      const lat = opts.north - (r + 0.5) * dLat;
      for (let c = 0; c < opts.width; c++) {
        const lon = opts.west + (c + 0.5) * dLon;
        const idx = r * opts.width + c;

        const vHiW = sampleDecodedCogBilinear(hiWestCog, lat, lon);
        const vHiE = sampleDecodedCogBilinear(hiEastCog, lat, lon);
        const vCtx = sampleDecodedCogBilinear(ctxCog, lat, lon);
        const vLola = sampleDecodedCogBilinear(lolaCog, lat, lon);

        let z = vLola;
        let p = 0;
        if (Number.isFinite(vHiW) && Number.isFinite(vHiE)) {
          z = (vHiW + vHiE) * 0.5;
          p = 2;
          countHi++;
        } else if (Number.isFinite(vHiW)) {
          z = vHiW;
          p = 2;
          countHi++;
        } else if (Number.isFinite(vHiE)) {
          z = vHiE;
          p = 2;
          countHi++;
        } else if (Number.isFinite(vCtx)) {
          z = vCtx;
          p = 1;
          countCtx++;
        } else {
          countLola++;
        }

        elevBuf.writeFloatLE(Number.isFinite(z) ? z : -2540, idx * 4);
        provBuf[idx] = p;
      }
    }

    // Smooth 4-pixel transition feathering strictly along provenance strip boundaries so rotated stereo strip edges do not create artificial step scarps
    const floatArr = new Float32Array(opts.width * opts.height);
    for (let i = 0; i < floatArr.length; i++) {
      floatArr[i] = elevBuf.readFloatLE(i * 4);
    }
    const isBoundary = new Uint8Array(opts.width * opts.height);
    for (let r = 2; r < opts.height - 2; r++) {
      for (let c = 2; c < opts.width - 2; c++) {
        const p0 = provBuf[r * opts.width + c];
        let diff = false;
        for (let dr = -2; dr <= 2 && !diff; dr++) {
          for (let dc = -2; dc <= 2; dc++) {
            if (provBuf[(r + dr) * opts.width + (c + dc)] !== p0) {
              diff = true;
              break;
            }
          }
        }
        if (diff) isBoundary[r * opts.width + c] = 1;
      }
    }
    for (let pass = 0; pass < 4; pass++) {
      const next = new Float32Array(floatArr);
      for (let r = 1; r < opts.height - 1; r++) {
        for (let c = 1; c < opts.width - 1; c++) {
          const idx = r * opts.width + c;
          if (!isBoundary[idx]) continue;
          next[idx] =
            0.4 * floatArr[idx] +
            0.15 *
              (floatArr[(r - 1) * opts.width + c] +
                floatArr[(r + 1) * opts.width + c] +
                floatArr[r * opts.width + (c - 1)] +
                floatArr[r * opts.width + (c + 1)]);
        }
      }
      floatArr.set(next);
    }
    for (let i = 0; i < floatArr.length; i++) {
      elevBuf.writeFloatLE(floatArr[i], i * 4);
    }

    const total = opts.width * opts.height;
    const meta = {
      id: opts.id,
      lodLevel: opts.lodLevel,
      source: opts.source,
      dtmId: opts.dtmId,
      crsCode: opts.crsCode,
      nativeGsdMeters: opts.nativeGsdMeters,
      ppd: Math.round(1 / dLat),
      width: opts.width,
      height: opts.height,
      north: opts.north,
      south: opts.south,
      west: opts.west,
      east: opts.east,
      dLat,
      dLon,
      sampleType: 'FLOAT32_LE',
      unit: 'meters_areoid',
      provenanceBreakdown: {
        hirise1mPct: Math.round((countHi / total) * 1000) / 10,
        ctx20mPct: Math.round((countCtx / total) * 1000) / 10,
        lola463mPct: Math.round((countLola / total) * 1000) / 10,
        primaryNoDataPct:
          opts.lodLevel === 3
            ? Math.round(((total - countHi) / total) * 1000) / 10
            : Math.round(((total - countHi - countCtx) / total) * 1000) / 10,
      },
    };

    fs.writeFileSync(path.join(regDir, `${opts.id}_hires.json`), JSON.stringify(meta, null, 2));
    fs.writeFileSync(path.join(regDir, `${opts.id}_hires.bin`), elevBuf);
    fs.writeFileSync(path.join(regDir, `${opts.id}_hires.prov.bin`), provBuf);
    console.log(`   Saved ${opts.id}_hires:`, JSON.stringify(meta.provenanceBreakdown));
  };

  // Level 2 Regional Jezero Crater & Western Delta (CTX 20m + HiRISE 1m + LOLA 128 PPD)
  buildFusedGrid({
    id: 'jezero_crater_ctx20m',
    lodLevel: 2,
    north: 18.85,
    south: 18.05,
    west: 77.15,
    east: 77.95,
    width: 400,
    height: 400,
    source: 'USGS STAC MRO CTX Stereo DTM (P18_007925_1987 / P19_008650_1987, 20.16 m GSD) + HiRISE Stereo DTM',
    dtmId: 'P18_007925_1987_XN_18N282W__P19_008650_1987_XI_18N282W',
    nativeGsdMeters: 20.16,
    crsCode: 'IAU_2015:49910',
  });

  // Level 3 High-Resolution Local Jezero Western Delta & Perseverance Landing Site (HiRISE 1.02m DTMs + CTX 20m)
  buildFusedGrid({
    id: 'jezero_delta_hirise1m',
    lodLevel: 3,
    north: 18.55,
    south: 18.33,
    west: 77.36,
    east: 77.58,
    width: 480,
    height: 480,
    source:
      'USGS STAC MRO HiRISE SOCET Stereo DTMs (DTEEC_045994_1985_046060_1985_U01 & DTEEC_048842_1985_048908_1985_U01, 1.02 m GSD)',
    dtmId: 'DTEEC_045994_1985_046060_1985_U01 + DTEEC_048842_1985_048908_1985_U01',
    nativeGsdMeters: 1.02,
    crsCode: 'IAU_2015:49910',
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
