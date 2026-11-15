/**
 * Generic, explainable weighted multi-criteria decision analysis (MCDA).
 * Criteria scores are normalised 0..1 (1 = favourable). Criteria whose score
 * is null (data unavailable) are excluded and the remaining weights are
 * renormalised; the exclusion is reported, never silently imputed.
 */
export type Provenance = 'measured' | 'derived' | 'heuristic' | 'reference';

export interface CriterionResult {
  id: string;
  label: string;
  /** 0..1, or null when the necessary data are unavailable. */
  score: number | null;
  weight: number;
  /** Raw value that produced the score, with unit. */
  value: number | null;
  unit: string;
  provenance: Provenance;
  /** Human-readable explanation of how score was derived. */
  rationale: string;
  /** Scoring rule in plain mathematical form. */
  rule: string;
}

export interface MCDAResult {
  total: number | null;
  criteria: (CriterionResult & { normWeight: number; contribution: number })[];
  excluded: string[];
}

export function weightedScore(criteria: CriterionResult[]): MCDAResult {
  const usable = criteria.filter((c) => c.score !== null && c.weight > 0);
  const W = usable.reduce((s, c) => s + c.weight, 0);
  const out = criteria.map((c) => {
    const normWeight = c.score !== null && W > 0 ? c.weight / W : 0;
    return { ...c, normWeight, contribution: c.score !== null ? normWeight * c.score : 0 };
  });
  return {
    total: W > 0 ? out.reduce((s, c) => s + c.contribution, 0) : null,
    criteria: out,
    excluded: criteria.filter((c) => c.score === null).map((c) => c.id),
  };
}

/**
 * Piecewise-linear desirability: 1 at `good`, 0 at `bad` (works for either
 * direction), clamped outside.
 */
export function linearScore(value: number, good: number, bad: number): number {
  if (!Number.isFinite(value)) return NaN;
  if (good === bad) return value <= good ? 1 : 0;
  const t = (value - good) / (bad - good);
  return Math.max(0, Math.min(1, 1 - t));
}

/** Piecewise-linear through breakpoints [[x, score], ...] sorted by x. */
export function piecewise(value: number, pts: [number, number][]): number {
  if (value <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    if (value <= pts[i][0]) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
      return y0 + ((value - x0) / (x1 - x0)) * (y1 - y0);
    }
  }
  return pts[pts.length - 1][1];
}
