import * as zlib from 'node:zlib';
import { MoonCrsCode, parseMoonWktCrs } from '../src/core/geo/crs.ts';

export interface CogIfdInfo {
  index: number;
  width: number;
  height: number;
  bitsPerSample: number;
  compression: number;
  predictor: number;
  tileWidth: number;
  tileHeight: number;
  tileOffsets: number[];
  tileByteCounts: number[];
  sampleFormat: number;
  noDataValue: number | null;
  pixelScale: [number, number, number] | null;
  tiepoint: number[] | null;
  geoAscii: string;
}

export interface DecodedCogOverview {
  width: number;
  height: number;
  north: number;
  south: number;
  west: number;
  east: number;
  dLat: number;
  dLon: number;
  nativeGsdMeters: number;
  overviewGsdMeters: number;
  crsCode: MoonCrsCode;
  noDataValue: number;
  validSampleCount: number;
  totalSampleCount: number;
  noDataFraction: number;
  elevation: Float32Array; // NaN for NoData pixels
}

const TYPE_SIZES: Record<number, number> = {
  1: 1, // BYTE
  2: 1, // ASCII
  3: 2, // SHORT
  4: 4, // LONG
  5: 8, // RATIONAL
  12: 8, // DOUBLE
  16: 8, // LONG8 (BigTIFF)
};

function readTagNumbers(
  buf: Buffer,
  entryOffset: number,
  isBigTiff: boolean,
  type: number,
  count: number,
): number[] {
  const elemSize = TYPE_SIZES[type] || 4;
  const totalBytes = count * elemSize;
  const inlineLimit = isBigTiff ? 8 : 4;
  const valFieldPos = entryOffset + (isBigTiff ? 12 : 8);
  const dataPos =
    totalBytes <= inlineLimit
      ? valFieldPos
      : isBigTiff
        ? Number(buf.readBigUInt64LE(valFieldPos))
        : buf.readUInt32LE(valFieldPos);

  if (dataPos < 0 || dataPos + totalBytes > buf.length) return [];
  const out: number[] = [];
  for (let k = 0; k < count; k++) {
    const p = dataPos + k * elemSize;
    if (type === 3) out.push(buf.readUInt16LE(p));
    else if (type === 4) out.push(buf.readUInt32LE(p));
    else if (type === 16) out.push(Number(buf.readBigUInt64LE(p)));
    else if (type === 12) out.push(buf.readDoubleLE(p));
    else if (type === 1) out.push(buf.readUInt8(p));
  }
  return out;
}

function readTagAscii(buf: Buffer, entryOffset: number, isBigTiff: boolean, count: number): string {
  const inlineLimit = isBigTiff ? 8 : 4;
  const valFieldPos = entryOffset + (isBigTiff ? 12 : 8);
  const dataPos =
    count <= inlineLimit
      ? valFieldPos
      : isBigTiff
        ? Number(buf.readBigUInt64LE(valFieldPos))
        : buf.readUInt32LE(valFieldPos);
  if (dataPos < 0 || dataPos + count > buf.length) return '';
  return buf.toString('ascii', dataPos, dataPos + Math.max(0, count - 1)).replace(/\0+$/, '');
}

/**
 * Parse all IFDs in the first 128 KB of a TIFF (v42) or BigTIFF (v43) Cloud Optimized GeoTIFF.
 */
export function parseCogHeader(hdrBuf: Buffer): { isBigTiff: boolean; ifds: CogIfdInfo[] } {
  const endian = hdrBuf.toString('ascii', 0, 2);
  if (endian !== 'II') {
    throw new Error(`Unsupported TIFF byte order: ${endian}`);
  }
  const version = hdrBuf.readUInt16LE(2);
  const isBigTiff = version === 43;
  if (version !== 42 && version !== 43) {
    throw new Error(`Unsupported TIFF version: ${version}`);
  }

  let ifdOff = isBigTiff ? Number(hdrBuf.readBigUInt64LE(8)) : hdrBuf.readUInt32LE(4);
  const ifds: CogIfdInfo[] = [];
  let idx = 0;

  while (ifdOff > 0 && ifdOff + (isBigTiff ? 8 : 2) < hdrBuf.length && idx < 12) {
    const numEntries = isBigTiff ? Number(hdrBuf.readBigUInt64LE(ifdOff)) : hdrBuf.readUInt16LE(ifdOff);
    const info: CogIfdInfo = {
      index: idx,
      width: 0,
      height: 0,
      bitsPerSample: 32,
      compression: 8,
      predictor: 1,
      tileWidth: 512,
      tileHeight: 512,
      tileOffsets: [],
      tileByteCounts: [],
      sampleFormat: 3,
      noDataValue: null,
      pixelScale: null,
      tiepoint: null,
      geoAscii: '',
    };

    for (let i = 0; i < numEntries; i++) {
      const e = ifdOff + (isBigTiff ? 8 + i * 20 : 2 + i * 12);
      if (e + (isBigTiff ? 20 : 12) > hdrBuf.length) break;
      const tag = hdrBuf.readUInt16LE(e);
      const type = hdrBuf.readUInt16LE(e + 2);
      const count = isBigTiff ? Number(hdrBuf.readBigUInt64LE(e + 4)) : hdrBuf.readUInt32LE(e + 4);

      if (tag === 256) info.width = readTagNumbers(hdrBuf, e, isBigTiff, type, count)[0] ?? 0;
      else if (tag === 257) info.height = readTagNumbers(hdrBuf, e, isBigTiff, type, count)[0] ?? 0;
      else if (tag === 258) info.bitsPerSample = readTagNumbers(hdrBuf, e, isBigTiff, type, count)[0] ?? 32;
      else if (tag === 259) info.compression = readTagNumbers(hdrBuf, e, isBigTiff, type, count)[0] ?? 8;
      else if (tag === 317) info.predictor = readTagNumbers(hdrBuf, e, isBigTiff, type, count)[0] ?? 1;
      else if (tag === 322) info.tileWidth = readTagNumbers(hdrBuf, e, isBigTiff, type, count)[0] ?? 512;
      else if (tag === 323) info.tileHeight = readTagNumbers(hdrBuf, e, isBigTiff, type, count)[0] ?? 512;
      else if (tag === 324) info.tileOffsets = readTagNumbers(hdrBuf, e, isBigTiff, type, count);
      else if (tag === 325) info.tileByteCounts = readTagNumbers(hdrBuf, e, isBigTiff, type, count);
      else if (tag === 339) info.sampleFormat = readTagNumbers(hdrBuf, e, isBigTiff, type, count)[0] ?? 3;
      else if (tag === 33550) {
        const sc = readTagNumbers(hdrBuf, e, isBigTiff, type, count);
        if (sc.length >= 3) info.pixelScale = [sc[0], sc[1], sc[2]];
      } else if (tag === 33922) {
        info.tiepoint = readTagNumbers(hdrBuf, e, isBigTiff, type, count);
      } else if (tag === 34737) {
        info.geoAscii = readTagAscii(hdrBuf, e, isBigTiff, count);
      } else if (tag === 42113) {
        const ndStr = readTagAscii(hdrBuf, e, isBigTiff, count);
        const nd = parseFloat(ndStr);
        if (Number.isFinite(nd)) info.noDataValue = nd;
      }
    }

    ifds.push(info);
    const nextPos = ifdOff + (isBigTiff ? 8 + numEntries * 20 : 2 + numEntries * 12);
    ifdOff =
      nextPos + (isBigTiff ? 8 : 4) <= hdrBuf.length
        ? isBigTiff
          ? Number(hdrBuf.readBigUInt64LE(nextPos))
          : hdrBuf.readUInt32LE(nextPos)
        : 0;
    idx++;
  }

  return { isBigTiff, ifds };
}

/**
 * Decode a single Deflate-compressed Float32 COG tile with TIFF predictor 1, 2 (horAcc32), or 3 (fpAcc).
 */
export function decodeFloat32CogTile(
  compressedBuf: Buffer,
  tileWidth: number,
  tileHeight: number,
  predictor: number,
): Buffer {
  const raw = zlib.inflateSync(compressedBuf);
  if (predictor === 2) {
    // 32-bit horizontal word differencing (horAcc32)
    for (let r = 0; r < tileHeight; r++) {
      const rowOff = r * tileWidth * 4;
      for (let c = 1; c < tileWidth; c++) {
        const prev = raw.readUInt32LE(rowOff + (c - 1) * 4);
        const cur = raw.readUInt32LE(rowOff + c * 4);
        raw.writeUInt32LE((prev + cur) >>> 0, rowOff + c * 4);
      }
    }
    return raw;
  }
  if (predictor === 3) {
    // IEEE 754 floating-point horizontal byte-plane differencing (fpAcc)
    const out = Buffer.allocUnsafe(raw.length);
    for (let r = 0; r < tileHeight; r++) {
      const rowOff = r * tileWidth * 4;
      for (let i = 1; i < tileWidth * 4; i++) {
        raw[rowOff + i] = (raw[rowOff + i] + raw[rowOff + i - 1]) & 0xff;
      }
      for (let c = 0; c < tileWidth; c++) {
        for (let b = 0; b < 4; b++) {
          out[rowOff + c * 4 + (3 - b)] = raw[rowOff + b * tileWidth + c];
        }
      }
    }
    return out;
  }
  return raw;
}

/**
 * Stream and decode a specific overview IFD from a USGS Astrogeology COG DTM URL via HTTP Range requests.
 */
export async function fetchCogOverviewGrid(options: {
  url: string;
  bbox: [number, number, number, number]; // [west, south, east, north]
  nativeGsdMeters: number;
  targetIfdIndex?: number;
  maxDimension?: number;
}): Promise<DecodedCogOverview> {
  const { url, bbox, nativeGsdMeters, targetIfdIndex, maxDimension = 950 } = options;

  // 1. Fetch first 128 KB header containing all IFDs & tile offset tables
  const hdrRes = await fetch(url, {
    headers: { Range: 'bytes=0-131071' },
    signal: AbortSignal.timeout(12_000),
  });
  if (!hdrRes.ok && hdrRes.status !== 206) {
    throw new Error(`COG header HTTP ${hdrRes.status} for ${url}`);
  }
  const hdrBuf = Buffer.from(await hdrRes.arrayBuffer());
  const { ifds } = parseCogHeader(hdrBuf);
  if (ifds.length === 0) {
    throw new Error(`No TIFF IFDs found in ${url}`);
  }

  const baseIfd = ifds[0];
  let chosenIfd = baseIfd;
  if (targetIfdIndex !== undefined && ifds[targetIfdIndex]) {
    chosenIfd = ifds[targetIfdIndex];
  } else {
    for (const cand of ifds) {
      if (cand.width > 0 && cand.height > 0 && Math.max(cand.width, cand.height) <= maxDimension) {
        chosenIfd = cand;
        break;
      }
    }
  }

  const W = chosenIfd.width;
  const H = chosenIfd.height;
  const TW = chosenIfd.tileWidth;
  const TH = chosenIfd.tileHeight;
  const tilesAcross = Math.ceil(W / TW);
  const tilesDown = Math.ceil(H / TH);

  // Fetch the contiguous byte range covering all tiles of chosenIfd in a single HTTP Range request
  const minOffset = Math.min(...chosenIfd.tileOffsets);
  let maxEnd = 0;
  for (let i = 0; i < chosenIfd.tileOffsets.length; i++) {
    maxEnd = Math.max(maxEnd, chosenIfd.tileOffsets[i] + chosenIfd.tileByteCounts[i]);
  }

  const dataRes = await fetch(url, {
    headers: { Range: `bytes=${minOffset}-${maxEnd - 1}` },
    signal: AbortSignal.timeout(25_000),
  });
  if (!dataRes.ok && dataRes.status !== 206) {
    throw new Error(`COG tile range HTTP ${dataRes.status} for ${url}`);
  }
  const rangeBuf = Buffer.from(await dataRes.arrayBuffer());

  const elevation = new Float32Array(W * H);
  elevation.fill(NaN);

  const noDataVal = chosenIfd.noDataValue ?? baseIfd.noDataValue ?? -32767;
  let validCount = 0;

  for (let ty = 0; ty < tilesDown; ty++) {
    for (let tx = 0; tx < tilesAcross; tx++) {
      const tIdx = ty * tilesAcross + tx;
      if (tIdx >= chosenIfd.tileOffsets.length) continue;
      const relStart = chosenIfd.tileOffsets[tIdx] - minOffset;
      const byteLen = chosenIfd.tileByteCounts[tIdx];
      if ( byteLen <= 0 || relStart < 0 || relStart + byteLen > rangeBuf.length) continue;

      const compressedTile = rangeBuf.subarray(relStart, relStart + byteLen);
      const decodedTile = decodeFloat32CogTile(compressedTile, TW, TH, chosenIfd.predictor);

      const rStart = ty * TH;
      const cStart = tx * TW;
      const rMax = Math.min(TH, H - rStart);
      const cMax = Math.min(TW, W - cStart);

      for (let r = 0; r < rMax; r++) {
        for (let c = 0; c < cMax; c++) {
          const val = decodedTile.readFloatLE((r * TW + c) * 4);
          // Filter out NoData (-32767 or -3.40282e+38) and out-of-range artifacts
          if (
            Number.isFinite(val) &&
            val > -9500 &&
            val < 24000 &&
            Math.abs(val - noDataVal) > 1.0 &&
            Math.abs(val) > 1e-4
          ) {
            elevation[(rStart + r) * W + (cStart + c)] = val;
            validCount++;
          }
        }
      }
    }
  }

  const [west, south, east, north] = bbox;
  const scaleFactor = baseIfd.width > 0 ? baseIfd.width / W : 1;
  const crsMeta = parseMoonWktCrs(baseIfd.geoAscii);

  return {
    width: W,
    height: H,
    north,
    south,
    west,
    east,
    dLat: (north - south) / H,
    dLon: (east - west) / W,
    nativeGsdMeters,
    overviewGsdMeters: Math.round(nativeGsdMeters * scaleFactor * 100) / 100,
    crsCode: crsMeta.code,
    noDataValue: noDataVal,
    validSampleCount: validCount,
    totalSampleCount: W * H,
    noDataFraction: Math.round((1 - validCount / (W * H)) * 10000) / 10000,
    elevation,
  };
}
