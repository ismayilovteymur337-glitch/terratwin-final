/**
 * Rule-based terrain classification from measurable grid properties.
 * Every class has an explicit mathematical definition exposed to the UI.
 */
export interface ClassThresholds {
  /** Slope below which terrain is "relatively flat" (deg). */
  flatSlope: number;
  /** Slope at/above which terrain is "steep" (deg). */
  steepSlope: number;
  /** TRI at/above which terrain is "high roughness" (m). */
  roughTRI: number;
}

export const TERRAIN_CLASSES = [
  { code: 0, id: 'nodata', label: 'Insufficient data', rule: 'Elevation missing for cell or any Horn neighbour' },
  { code: 1, id: 'flat', label: 'Relatively flat', rule: 'slope < flatSlope AND TRI < roughTRI' },
  { code: 2, id: 'moderate', label: 'Moderate', rule: 'flatSlope ≤ slope < steepSlope AND TRI < roughTRI' },
  { code: 3, id: 'steep', label: 'Steep', rule: 'slope ≥ steepSlope' },
  { code: 4, id: 'rough', label: 'High roughness', rule: 'TRI ≥ roughTRI AND slope < steepSlope' },
  { code: 5, id: 'science', label: 'Potential science interest', rule: 'Non-steep cell within the influence radius of a mapped IAU feature / fresh crater (set by the planet module)' },
] as const;

export function classifyTerrain(slope: Float32Array, tri: Float32Array, t: ClassThresholds, scienceMask?: Uint8Array): Uint8Array {
  const out = new Uint8Array(slope.length);
  for (let i = 0; i < slope.length; i++) {
    const s = slope[i], r = tri[i];
    if (!Number.isFinite(s) || !Number.isFinite(r)) { out[i] = 0; continue; }
    if (s >= t.steepSlope) out[i] = 3;
    else if (r >= t.roughTRI) out[i] = 4;
    else if (scienceMask && scienceMask[i]) out[i] = 5;
    else if (s < t.flatSlope) out[i] = 1;
    else out[i] = 2;
  }
  return out;
}

export function classHistogram(classes: Uint8Array): Record<string, number> {
  const counts = new Array(TERRAIN_CLASSES.length).fill(0);
  for (let i = 0; i < classes.length; i++) counts[classes[i]]++;
  const out: Record<string, number> = {};
  TERRAIN_CLASSES.forEach((c, k) => (out[c.id] = classes.length ? counts[k] / classes.length : 0));
  return out;
}
