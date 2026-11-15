/**
 * Planet-agnostic spherical geometry. Every function takes the body radius
 * explicitly so Moon and (future) Earth logic never share hidden constants.
 * Latitudes are geocentric/planetocentric degrees, longitudes are
 * east-positive degrees.
 */
export interface LatLon {
  lat: number;
  lon: number;
}

export const DEG = Math.PI / 180;

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Normalise longitude into [-180, 180). */
export function normLon180(lon: number): number {
  let l = ((lon + 180) % 360 + 360) % 360 - 180;
  if (Object.is(l, -0)) l = 0;
  return l;
}

/** Normalise longitude into [0, 360). */
export function normLon360(lon: number): number {
  return ((lon % 360) + 360) % 360;
}

/** Great-circle distance (haversine) in the units of `radius`. */
export function greatCircleDistance(a: LatLon, b: LatLon, radius: number): number {
  const p1 = a.lat * DEG;
  const p2 = b.lat * DEG;
  const dp = p2 - p1;
  const dl = (b.lon - a.lon) * DEG;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * radius * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial bearing from a to b in degrees clockwise from north. */
export function initialBearing(a: LatLon, b: LatLon): number {
  const p1 = a.lat * DEG;
  const p2 = b.lat * DEG;
  const dl = (b.lon - a.lon) * DEG;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (Math.atan2(y, x) / DEG + 360) % 360;
}

/** Destination point given start, bearing (deg) and distance (same unit as radius). */
export function destination(a: LatLon, bearingDeg: number, dist: number, radius: number): LatLon {
  const d = dist / radius;
  const t = bearingDeg * DEG;
  const p1 = a.lat * DEG;
  const l1 = a.lon * DEG;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(t));
  const l2 = l1 + Math.atan2(Math.sin(t) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return { lat: p2 / DEG, lon: normLon180(l2 / DEG) };
}

/** Spherical linear interpolation along the great circle a->b. */
export function interpolateGreatCircle(a: LatLon, b: LatLon, f: number): LatLon {
  const p1 = a.lat * DEG, l1 = a.lon * DEG, p2 = b.lat * DEG, l2 = b.lon * DEG;
  const x1 = Math.cos(p1) * Math.cos(l1), y1 = Math.cos(p1) * Math.sin(l1), z1 = Math.sin(p1);
  const x2 = Math.cos(p2) * Math.cos(l2), y2 = Math.cos(p2) * Math.sin(l2), z2 = Math.sin(p2);
  const dot = clamp(x1 * x2 + y1 * y2 + z1 * z2, -1, 1);
  const w = Math.acos(dot);
  if (w < 1e-12) return { lat: a.lat, lon: a.lon };
  const s = Math.sin(w);
  const A = Math.sin((1 - f) * w) / s;
  const B = Math.sin(f * w) / s;
  const x = A * x1 + B * x2, y = A * y1 + B * y2, z = A * z1 + B * z2;
  return { lat: Math.atan2(z, Math.hypot(x, y)) / DEG, lon: Math.atan2(y, x) / DEG };
}

/** Insert great-circle points so no segment exceeds maxStep (same unit as radius). */
export function densifyPath(path: LatLon[], maxStep: number, radius: number): LatLon[] {
  if (path.length < 2) return path.slice();
  const out: LatLon[] = [path[0]];
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i];
    const d = greatCircleDistance(a, b, radius);
    const n = Math.max(1, Math.ceil(d / maxStep));
    for (let k = 1; k <= n; k++) out.push(interpolateGreatCircle(a, b, k / n));
  }
  return out;
}

/** Cumulative along-path distances. */
export function cumulativeDistances(path: LatLon[], radius: number): number[] {
  const out = [0];
  for (let i = 1; i < path.length; i++) out.push(out[i - 1] + greatCircleDistance(path[i - 1], path[i], radius));
  return out;
}

/** Distance from point p to the great-circle segment a-b (approximate, local planar). */
export function distanceToSegment(p: LatLon, a: LatLon, b: LatLon, radius: number): number {
  const lat0 = ((a.lat + b.lat) / 2) * DEG;
  const kx = Math.cos(lat0) * DEG * radius;
  const ky = DEG * radius;
  const ax = 0, ay = 0;
  const bx = normLon180(b.lon - a.lon) * kx, by = (b.lat - a.lat) * ky;
  const px = normLon180(p.lon - a.lon) * kx, py = (p.lat - a.lat) * ky;
  const L2 = bx * bx + by * by;
  const t = L2 > 0 ? clamp(((px - ax) * bx + (py - ay) * by) / L2, 0, 1) : 0;
  return Math.hypot(px - t * bx, py - t * by);
}

/** Projection parameter (0..1) of p onto a-b, local planar approximation. */
export function projectOnSegment(p: LatLon, a: LatLon, b: LatLon): number {
  const lat0 = ((a.lat + b.lat) / 2) * DEG;
  const bx = normLon180(b.lon - a.lon) * Math.cos(lat0), by = b.lat - a.lat;
  const px = normLon180(p.lon - a.lon) * Math.cos(lat0), py = p.lat - a.lat;
  const L2 = bx * bx + by * by;
  return L2 > 0 ? (px * bx + py * by) / L2 : 0;
}

/**
 * Cartesian position on a sphere. Scene convention (shared by every body):
 * +Y = north pole, +X = longitude 0, longitude increases counter-clockwise
 * when viewed from +Y (i.e. towards -Z), which keeps east-positive
 * longitudes and a right-handed frame.
 */
export function latLonToCartesian(lat: number, lon: number, r: number): [number, number, number] {
  const p = lat * DEG, l = lon * DEG;
  const c = Math.cos(p);
  return [r * c * Math.cos(l), r * Math.sin(p), -r * c * Math.sin(l)];
}

export function cartesianToLatLon(x: number, y: number, z: number): LatLon {
  const r = Math.hypot(x, y, z);
  return { lat: Math.asin(clamp(y / r, -1, 1)) / DEG, lon: normLon180(Math.atan2(-z, x) / DEG) };
}

export interface BBox {
  south: number;
  north: number;
  west: number; // may be < -180 or > 180 when crossing the antimeridian, always west < east
  east: number;
}

/** Bounding box around points (handles antimeridian by choosing the narrower span). */
export function bboxOf(points: LatLon[]): BBox {
  let s = 90, n = -90;
  for (const p of points) { s = Math.min(s, p.lat); n = Math.max(n, p.lat); }
  const lons = points.map((p) => normLon180(p.lon));
  let w = Math.min(...lons), e = Math.max(...lons);
  const shifted = points.map((p) => normLon360(p.lon));
  const w2 = Math.min(...shifted), e2 = Math.max(...shifted);
  if (e2 - w2 < e - w) { w = w2; e = e2; }
  return { south: s, north: n, west: w, east: e };
}

/** Pad a bbox by a distance (same unit as radius) on every side. */
export function padBBox(b: BBox, pad: number, radius: number, latLimit = 89.5): BBox {
  const dLat = (pad / radius) / DEG;
  const midLat = ((b.south + b.north) / 2) * DEG;
  const dLon = dLat / Math.max(0.05, Math.cos(Math.min(Math.abs(midLat) + dLat * DEG, 85 * DEG)));
  return {
    south: Math.max(-latLimit, b.south - dLat),
    north: Math.min(latLimit, b.north + dLat),
    west: b.west - dLon,
    east: b.east + dLon,
  };
}

export function bboxSpanMeters(b: BBox, radius: number): { width: number; height: number } {
  const midLat = ((b.south + b.north) / 2) * DEG;
  return {
    width: (b.east - b.west) * DEG * radius * Math.cos(midLat),
    height: (b.north - b.south) * DEG * radius,
  };
}
