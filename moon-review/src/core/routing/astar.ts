/**
 * Generic A* over a regular latitude/longitude grid (8-connected).
 * Edge cost = metric step length × mean(cost multiplier of the two cells).
 * Multipliers must be ≥ 1 so the great-circle heuristic stays admissible,
 * which guarantees the returned path is optimal for the given cost surface.
 */
import { DEG } from '../geo/sphere';
import { ElevationGrid } from '../terrain/grid';

export interface AStarResult {
  path: number[]; // cell indices start..goal
  cost: number;
  expanded: number;
}

class MinHeap {
  private keys: Float64Array;
  private vals: Int32Array;
  size = 0;
  constructor(cap: number) { this.keys = new Float64Array(cap); this.vals = new Int32Array(cap); }
  push(k: number, v: number) {
    if (this.size >= this.keys.length) {
      const nk = new Float64Array(this.keys.length * 2); nk.set(this.keys); this.keys = nk;
      const nv = new Int32Array(this.vals.length * 2); nv.set(this.vals); this.vals = nv;
    }
    let i = this.size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.keys[p] <= k) break;
      this.keys[i] = this.keys[p]; this.vals[i] = this.vals[p]; i = p;
    }
    this.keys[i] = k; this.vals[i] = v;
  }
  pop(): number {
    const top = this.vals[0];
    const k = this.keys[--this.size], v = this.vals[this.size];
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= this.size) break;
      if (c + 1 < this.size && this.keys[c + 1] < this.keys[c]) c++;
      if (this.keys[c] >= k) break;
      this.keys[i] = this.keys[c]; this.vals[i] = this.vals[c]; i = c;
    }
    this.keys[i] = k; this.vals[i] = v;
    return top;
  }
}

/**
 * @param multiplier per-cell cost multiplier (≥1); Infinity or NaN = impassable.
 */
export function astarGrid(g: ElevationGrid, multiplier: Float32Array, start: number, goal: number, radius: number): AStarResult | null {
  const W = g.width, H = g.height, N = W * H;
  if (!(multiplier[start] < Infinity) || !(multiplier[goal] < Infinity)) return null;
  const dy = radius * g.dLat * DEG;
  const rowDx = new Float64Array(H);
  const rowCos = new Float64Array(H);
  for (let r = 0; r < H; r++) {
    const lat = (g.north - (r + 0.5) * g.dLat) * DEG;
    rowCos[r] = Math.cos(lat);
    rowDx[r] = radius * Math.cos(lat) * g.dLon * DEG;
  }
  const gr = Math.floor(goal / W), gc = goal % W;
  const goalLat = (g.north - (gr + 0.5) * g.dLat) * DEG;
  const heuristic = (idx: number) => {
    const r = Math.floor(idx / W), c = idx % W;
    const lat = (g.north - (r + 0.5) * g.dLat) * DEG;
    const dl = (c - gc) * g.dLon * DEG;
    const h = Math.sin((goalLat - lat) / 2) ** 2 + Math.cos(lat) * Math.cos(goalLat) * Math.sin(dl / 2) ** 2;
    return 2 * radius * Math.asin(Math.min(1, Math.sqrt(h))) * 0.999;
  };
  const gScore = new Float64Array(N).fill(Infinity);
  const came = new Int32Array(N).fill(-1);
  const closed = new Uint8Array(N);
  const heap = new MinHeap(4096);
  gScore[start] = 0;
  heap.push(heuristic(start), start);
  let expanded = 0;
  while (heap.size) {
    const cur = heap.pop();
    if (closed[cur]) continue;
    if (cur === goal) break;
    closed[cur] = 1;
    expanded++;
    const r = Math.floor(cur / W), c = cur % W;
    const mc = multiplier[cur];
    for (let drr = -1; drr <= 1; drr++) {
      const rr = r + drr; if (rr < 0 || rr >= H) continue;
      for (let dcc = -1; dcc <= 1; dcc++) {
        if (drr === 0 && dcc === 0) continue;
        const cc = c + dcc; if (cc < 0 || cc >= W) continue;
        const nb = rr * W + cc;
        if (closed[nb]) continue;
        const mn = multiplier[nb];
        if (!(mn < Infinity)) continue;
        const dx = (rowDx[r] + rowDx[rr]) / 2 * Math.abs(dcc);
        const step = Math.hypot(dx, dy * Math.abs(drr));
        const ng = gScore[cur] + step * (mc + mn) / 2;
        if (ng < gScore[nb]) {
          gScore[nb] = ng; came[nb] = cur;
          heap.push(ng + heuristic(nb), nb);
        }
      }
    }
  }
  if (!Number.isFinite(gScore[goal])) return null;
  const path: number[] = [];
  for (let v = goal; v !== -1; v = came[v]) path.push(v);
  path.reverse();
  return { path, cost: gScore[goal], expanded };
}

/** Nearest passable cell (breadth-first ring search) within maxRing cells. */
export function nearestPassable(g: ElevationGrid, multiplier: Float32Array, idx: number, maxRing = 25): number | null {
  if (multiplier[idx] < Infinity) return idx;
  const W = g.width, H = g.height;
  const r0 = Math.floor(idx / W), c0 = idx % W;
  for (let k = 1; k <= maxRing; k++) {
    let best: number | null = null, bestD = Infinity;
    for (let r = r0 - k; r <= r0 + k; r++) {
      if (r < 0 || r >= H) continue;
      for (let c = c0 - k; c <= c0 + k; c++) {
        if (c < 0 || c >= W) continue;
        if (Math.max(Math.abs(r - r0), Math.abs(c - c0)) !== k) continue;
        const i = r * W + c;
        if (multiplier[i] < Infinity) {
          const d = (r - r0) ** 2 + (c - c0) ** 2;
          if (d < bestD) { bestD = d; best = i; }
        }
      }
    }
    if (best !== null) return best;
  }
  return null;
}

/** Douglas-Peucker simplification on index-space coordinates. Returns kept positions. */
export function simplifyIndices(points: { x: number; y: number }[], tolerance: number): number[] {
  if (points.length <= 2) return points.map((_, i) => i);
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let maxD = -1, idx = -1;
    const ax = points[a].x, ay = points[a].y, bx = points[b].x, by = points[b].y;
    const L = Math.hypot(bx - ax, by - ay) || 1e-9;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((bx - ax) * (ay - points[i].y) - (ax - points[i].x) * (by - ay)) / L;
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > tolerance && idx > 0) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  const out: number[] = [];
  keep.forEach((k, i) => k && out.push(i));
  return out;
}
