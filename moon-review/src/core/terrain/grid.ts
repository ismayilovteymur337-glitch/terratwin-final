/**
 * Planet-agnostic gridded terrain analysis on a regular latitude/longitude
 * grid. All metric spacing is derived from the body radius passed in, so the
 * same code serves Moon (LOLA/HiRISE/CTX) and future Earth DEMs.
 */
import { DEG, LatLon, normLon180 } from '../geo/sphere';

/** Source tier codes stored per cell (planet modules define the labels). */
export type SourceCode = number;

export interface ElevationGrid {
  width: number;
  height: number;
  /** North edge latitude of row 0 (deg). */
  north: number;
  /** West edge longitude of column 0 (deg, east-positive, may exceed ±180). */
  west: number;
  /** Cell size in degrees. */
  dLat: number;
  dLon: number;
  /** Elevation in metres relative to the body's vertical datum; NaN = no data. */
  elevation: Float32Array;
  /** Optional per-cell data source code. */
  source?: Uint8Array;
}

export function cellCenter(g: ElevationGrid, row: number, col: number): LatLon {
  return { lat: g.north - (row + 0.5) * g.dLat, lon: normLon180(g.west + (col + 0.5) * g.dLon) };
}

/** Fractional (row, col) of a lat/lon in grid index space (cell centres at integers). */
export function gridIndexOf(g: ElevationGrid, lat: number, lon: number): { r: number; c: number } {
  let dl = lon - g.west;
  dl = ((dl % 360) + 360) % 360; // longitude offset east of the west edge
  if (dl > g.width * g.dLon + 180) dl -= 360;
  return { r: (g.north - lat) / g.dLat - 0.5, c: dl / g.dLon - 0.5 };
}

export function cellOf(g: ElevationGrid, lat: number, lon: number): { row: number; col: number } | null {
  const { r, c } = gridIndexOf(g, lat, lon);
  const row = Math.round(r), col = Math.round(c);
  if (row < 0 || col < 0 || row >= g.height || col >= g.width) return null;
  return { row, col };
}

/** Bilinear sample of any per-cell array on the grid; NaN outside / no data. */
export function sampleArray(g: ElevationGrid, arr: ArrayLike<number>, lat: number, lon: number): number {
  const { r, c } = gridIndexOf(g, lat, lon);
  if (r < -0.5 || c < -0.5 || r > g.height - 0.5 || c > g.width - 0.5) return NaN;
  const r0 = Math.max(0, Math.min(g.height - 1, Math.floor(r)));
  const c0 = Math.max(0, Math.min(g.width - 1, Math.floor(c)));
  const r1 = Math.min(g.height - 1, r0 + 1), c1 = Math.min(g.width - 1, c0 + 1);
  const fr = Math.max(0, Math.min(1, r - r0)), fc = Math.max(0, Math.min(1, c - c0));
  const v00 = arr[r0 * g.width + c0], v01 = arr[r0 * g.width + c1];
  const v10 = arr[r1 * g.width + c0], v11 = arr[r1 * g.width + c1];
  if (!Number.isFinite(v00 + v01 + v10 + v11)) {
    // fall back to nearest valid neighbour
    const near = arr[Math.round(r < 0 ? 0 : Math.min(g.height - 1, r)) * g.width + Math.round(c < 0 ? 0 : Math.min(g.width - 1, c))];
    return Number.isFinite(near) ? near : NaN;
  }
  return (v00 * (1 - fc) + v01 * fc) * (1 - fr) + (v10 * (1 - fc) + v11 * fc) * fr;
}

export function sampleElevation(g: ElevationGrid, lat: number, lon: number): number {
  return sampleArray(g, g.elevation, lat, lon);
}

/** Metric cell spacing for a given row. */
export function cellSpacing(g: ElevationGrid, row: number, radius: number): { dx: number; dy: number } {
  const lat = (g.north - (row + 0.5) * g.dLat) * DEG;
  return { dx: radius * Math.cos(lat) * g.dLon * DEG, dy: radius * g.dLat * DEG };
}

/** Representative cell size (m) at the grid centre latitude. */
export function nominalCellSize(g: ElevationGrid, radius: number): number {
  const s = cellSpacing(g, Math.floor(g.height / 2), radius);
  return Math.sqrt(s.dx * s.dy);
}

/**
 * Slope in degrees using Horn's (1981) 3x3 finite-difference operator with
 * latitude-dependent east-west spacing. Edge cells reuse the nearest
 * interior neighbour. NaN propagates where any neighbour lacks data.
 */
export function computeSlope(g: ElevationGrid, radius: number): Float32Array {
  const { width: W, height: H, elevation: z } = g;
  const out = new Float32Array(W * H);
  for (let r = 0; r < H; r++) {
    const { dx, dy } = cellSpacing(g, r, radius);
    const rm = Math.max(0, r - 1), rp = Math.min(H - 1, r + 1);
    for (let c = 0; c < W; c++) {
      const cm = Math.max(0, c - 1), cp = Math.min(W - 1, c + 1);
      const a = z[rm * W + cm], b = z[rm * W + c], cc = z[rm * W + cp];
      const d = z[r * W + cm], f = z[r * W + cp];
      const gg = z[rp * W + cm], h = z[rp * W + c], i = z[rp * W + cp];
      const sx = (cp - cm) || 1, sy = (rp - rm) || 1;
      const dzdx = ((cc + 2 * f + i) - (a + 2 * d + gg)) / (4 * sx * dx);
      const dzdy = ((gg + 2 * h + i) - (a + 2 * b + cc)) / (4 * sy * dy);
      out[r * W + c] = Math.atan(Math.hypot(dzdx, dzdy)) / DEG;
    }
  }
  return out;
}

/**
 * Terrain Ruggedness Index (Riley et al., 1999): mean absolute elevation
 * difference (m) between a cell and its 8 neighbours. Its magnitude depends
 * on the grid baseline, which callers must report alongside the value.
 */
export function computeTRI(g: ElevationGrid): Float32Array {
  const { width: W, height: H, elevation: z } = g;
  const out = new Float32Array(W * H);
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      const v = z[r * W + c];
      if (!Number.isFinite(v)) { out[r * W + c] = NaN; continue; }
      let s = 0, n = 0;
      for (let dr = -1; dr <= 1; dr++) {
        const rr = r + dr; if (rr < 0 || rr >= H) continue;
        for (let dc = -1; dc <= 1; dc++) {
          const c2 = c + dc; if ((dr === 0 && dc === 0) || c2 < 0 || c2 >= W) continue;
          const u = z[rr * W + c2];
          if (Number.isFinite(u)) { s += Math.abs(u - v); n++; }
        }
      }
      out[r * W + c] = n ? s / n : NaN;
    }
  }
  return out;
}

/**
 * Detrended RMS relief: RMS residual (m) of elevations around the best-fit
 * plane within `radiusM` of a point. This is a baseline-explicit roughness
 * measure comparable with relief constraints used in landing-site studies.
 */
export function detrendedRelief(g: ElevationGrid, lat: number, lon: number, radiusM: number, radius: number): { rms: number; n: number; relief: number } {
  const idx = gridIndexOf(g, lat, lon);
  const { dx, dy } = cellSpacing(g, Math.max(0, Math.min(g.height - 1, Math.round(idx.r))), radius);
  const nr = Math.ceil(radiusM / dy), nc = Math.ceil(radiusM / dx);
  const r0 = Math.round(idx.r), c0 = Math.round(idx.c);
  const xs: number[] = [], ys: number[] = [], zs: number[] = [];
  for (let r = r0 - nr; r <= r0 + nr; r++) {
    if (r < 0 || r >= g.height) continue;
    for (let c = c0 - nc; c <= c0 + nc; c++) {
      if (c < 0 || c >= g.width) continue;
      const x = (c - idx.c) * dx, y = (r - idx.r) * dy;
      if (x * x + y * y > radiusM * radiusM) continue;
      const z = g.elevation[r * g.width + c];
      if (!Number.isFinite(z)) continue;
      xs.push(x); ys.push(y); zs.push(z);
    }
  }
  const n = zs.length;
  if (n < 6) return { rms: NaN, n, relief: NaN };
  // least-squares plane z = a + b x + c y
  let sx = 0, sy = 0, sz = 0, sxx = 0, syy = 0, sxy = 0, sxz = 0, syz = 0;
  for (let k = 0; k < n; k++) {
    const x = xs[k], y = ys[k], z = zs[k];
    sx += x; sy += y; sz += z; sxx += x * x; syy += y * y; sxy += x * y; sxz += x * z; syz += y * z;
  }
  const M = [[n, sx, sy], [sx, sxx, sxy], [sy, sxy, syy]];
  const V = [sz, sxz, syz];
  const sol = solve3(M, V);
  let ss = 0, zmin = Infinity, zmax = -Infinity;
  for (let k = 0; k < n; k++) {
    const res = zs[k] - (sol[0] + sol[1] * xs[k] + sol[2] * ys[k]);
    ss += res * res;
    zmin = Math.min(zmin, zs[k]); zmax = Math.max(zmax, zs[k]);
  }
  return { rms: Math.sqrt(ss / n), n, relief: zmax - zmin };
}

function solve3(M: number[][], V: number[]): number[] {
  const det = (m: number[][]) =>
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const D = det(M);
  if (Math.abs(D) < 1e-9) return [V[0] / M[0][0], 0, 0];
  const out: number[] = [];
  for (let k = 0; k < 3; k++) {
    const Mk = M.map((row, i) => row.map((v, j) => (j === k ? V[i] : v)));
    out.push(det(Mk) / D);
  }
  return out;
}

export interface Stats { min: number; max: number; mean: number; p50: number; p95: number; n: number }

export function stats(values: ArrayLike<number>): Stats {
  const v: number[] = [];
  for (let i = 0; i < values.length; i++) if (Number.isFinite(values[i])) v.push(values[i]);
  if (!v.length) return { min: NaN, max: NaN, mean: NaN, p50: NaN, p95: NaN, n: 0 };
  v.sort((a, b) => a - b);
  const q = (p: number) => v[Math.min(v.length - 1, Math.floor(p * (v.length - 1)))];
  return { min: v[0], max: v[v.length - 1], mean: v.reduce((a, b) => a + b, 0) / v.length, p50: q(0.5), p95: q(0.95), n: v.length };
}

/** Collect values of an array within radius (m) of a point. */
export function valuesWithin(g: ElevationGrid, arr: ArrayLike<number>, lat: number, lon: number, radiusM: number, radius: number): number[] {
  const idx = gridIndexOf(g, lat, lon);
  const { dx, dy } = cellSpacing(g, Math.max(0, Math.min(g.height - 1, Math.round(idx.r))), radius);
  const nr = Math.ceil(radiusM / dy), nc = Math.ceil(radiusM / dx);
  const r0 = Math.round(idx.r), c0 = Math.round(idx.c);
  const out: number[] = [];
  for (let r = r0 - nr; r <= r0 + nr; r++) {
    if (r < 0 || r >= g.height) continue;
    for (let c = c0 - nc; c <= c0 + nc; c++) {
      if (c < 0 || c >= g.width) continue;
      const x = (c - idx.c) * dx, y = (r - idx.r) * dy;
      if (x * x + y * y > radiusM * radiusM) continue;
      out.push(arr[r * g.width + c]);
    }
  }
  return out;
}

/** Box-window maximum filter (used for local slope envelopes). */
export function maxFilter(src: Float32Array, W: number, H: number, k: number): Float32Array {
  const tmp = new Float32Array(W * H), out = new Float32Array(W * H);
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    let m = -Infinity;
    for (let d = -k; d <= k; d++) { const cc = c + d; if (cc >= 0 && cc < W) { const v = src[r * W + cc]; if (v > m) m = v; } }
    tmp[r * W + c] = m;
  }
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    let m = -Infinity;
    for (let d = -k; d <= k; d++) { const rr = r + d; if (rr >= 0 && rr < H) { const v = tmp[rr * W + c]; if (v > m) m = v; } }
    out[r * W + c] = m;
  }
  return out;
}

/** Box-window mean filter ignoring NaN. */
export function meanFilter(src: Float32Array, W: number, H: number, k: number): Float32Array {
  const out = new Float32Array(W * H);
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    let s = 0, n = 0;
    for (let dr = -k; dr <= k; dr++) {
      const rr = r + dr; if (rr < 0 || rr >= H) continue;
      for (let dc = -k; dc <= k; dc++) {
        const cc = c + dc; if (cc < 0 || cc >= W) continue;
        const v = src[rr * W + cc]; if (Number.isFinite(v)) { s += v; n++; }
      }
    }
    out[r * W + c] = n ? s / n : NaN;
  }
  return out;
}
