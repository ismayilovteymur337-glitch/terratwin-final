export type Direction = "higher" | "lower" | "target";
export type Kind = "modelled" | "reported" | "survey_index" | "proxy" | "predicted";

export interface Variable {
  id: string; label: string; units: string; category: string; kind: Kind; resolution: string;
  connector: string; source_name: string; source_url: string; description: string;
  direction: Direction; target: [number, number] | null; weight: number; weight_pct: number;
  rationale?: string | null; assumption?: string | null; proxy_note?: string | null; pct_meaningful: boolean;
  coverage: { with_data: number; total: number }; range: [number, number] | null; period: string | null;
}

export interface Cell {
  value: number | null; period?: string | null; status?: string; note?: string | null;
  norm?: number | null; contribution?: number; diff_abs?: number | null; diff_pct?: number | null;
  n_points?: number | null; min?: number; max?: number;
}

export interface Loc {
  iso3: string; name: string; continent: string; subregion: string; label: [number, number];
  values: Record<string, Cell>; rank: number | null; prev_rank: number | null;
  score: number | null; confidence: number; strengths: string[]; weaknesses: string[];
}

export interface SamplePoint { iso3: string; lat: number; lon: number; values: Record<string, number> }

export interface Source {
  id: string; name: string; url: string; license: string; notes: string;
  retrieved_at: string | null; source_updated: string | null; period: string | null; failed_requests: number; variables: string[];
}

export interface Benchmark { type: "candidates_mean" | "world" | "country"; iso3: string | null; label: string; values: Record<string, number | null>; note: string | null }

export interface Analysis {
  id: string; title: string; objective: string; scope_label: string; created_at: string;
  variables: Variable[]; locations: Loc[]; benchmark: Benchmark;
  unavailable: { name: string; reason: string }[]; sources: Source[]; points: SamplePoint[];
  warnings: string[]; methodology: string[]; n_points_per_location: number;
}

export interface ComparisonRow {
  id: string; label: string; units: string; direction: Direction; target: [number, number] | null; kind: Kind;
  proxy_note: string | null; period: string | null; weight_pct: number; pct_meaningful: boolean; source_name: string;
  benchmark: number | null; values: Record<string, Cell>; best: string | null;
}

export interface Comparison {
  analysis_id: string;
  locations: { iso3: string; name: string; rank: number | null; score: number | null; confidence: number; focused_score: number | null; focused_confidence: number }[];
  rows: ComparisonRow[]; benchmark_label: string; subset: boolean; note: string;
}

export interface AreaResult {
  bbox: [number, number, number, number];
  variables: { id: string; label: string; units: string; mean: number | null; min?: number; max?: number; n_points: number }[];
  points: SamplePoint[]; note: string;
}

export type MapCommand = { action: "fit" | "highlight"; iso3: string[] };

export type AgentEvent =
  | { type: "step"; label: string }
  | { type: "analysis"; analysis: Analysis }
  | { type: "comparison"; comparison: Comparison }
  | { type: "area"; area: AreaResult }
  | { type: "map"; command: MapCommand }
  | { type: "message"; text: string; planner: "llm" | "rules" }
  | { type: "error"; message: string }
  | { type: "done" };

export interface ChatMessage {
  id: string; role: "user" | "agent"; text: string; steps: string[]; pending?: boolean; error?: boolean; selection?: number[] | null;
}

export interface Health { status: string; planner: "llm" | "rules"; model: string | null }
