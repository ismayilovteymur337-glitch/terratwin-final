import type { Kind } from "./types";

export function fnum(x: number | null | undefined): string {
  if (x === null || x === undefined || Number.isNaN(x)) return "—";
  const a = Math.abs(x);
  if (a >= 1000) return x.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (a >= 100) return x.toFixed(1);
  return String(Number(x.toFixed(2)));
}

export function signed(x: number, digits = 1): string {
  return (x > 0 ? "+" : x < 0 ? "−" : "") + Math.abs(x).toFixed(digits);
}

const STOPS: [number, [number, number, number]][] = [
  [0, [190, 78, 62]],
  [50, [216, 178, 74]],
  [100, [62, 158, 98]],
];

/** Red → yellow → green ramp for a 0–100 value. */
export function ramp(v: number | null | undefined, alpha = 1): string {
  if (v === null || v === undefined) return `rgba(120,130,140,${alpha})`;
  const x = Math.max(0, Math.min(100, v));
  const [a, b] = x <= 50 ? [STOPS[0], STOPS[1]] : [STOPS[1], STOPS[2]];
  const t = (x - a[0]) / (b[0] - a[0]);
  const c = a[1].map((p, i) => Math.round(p + (b[1][i] - p) * t));
  return `rgba(${c[0]},${c[1]},${c[2]},${alpha})`;
}

export const KIND_LABEL: Record<Kind, string> = {
  modelled: "Modelled", reported: "Reported", survey_index: "Survey index", proxy: "Proxy", predicted: "Predicted",
};
export const KIND_HELP: Record<Kind, string> = {
  modelled: "Satellite-derived or reanalysis model output, not a ground measurement.",
  reported: "Official statistic reported by a national or international agency.",
  survey_index: "Composite index built from surveys or expert perception.",
  proxy: "A real statistic standing in for a quantity that has no connected dataset.",
  predicted: "Machine-learning prediction from a global model.",
};

export const CATEGORY_COLORS: Record<string, string> = {
  Environment: "#d9b24a", Climate: "#5fa8c9", Economics: "#b98ad0", Infrastructure: "#6fc3a8", Governance: "#8f9bb0",
  Soil: "#b08a5c", Land: "#93b86a", Water: "#4f8fd6", Agriculture: "#93b86a", Workforce: "#d08a8a",
  Connectivity: "#6fa0d8", Mining: "#c79a6b", Energy: "#e0c268", Custom: "#9aa5b1",
};
