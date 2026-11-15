import type { AgentEvent, Analysis, Comparison, Health } from "./types";

export const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

async function post<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(API + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await r.json();
  if (!r.ok) throw new Error(data?.error || `Request failed (${r.status})`);
  return data as T;
}

export const getHealth = async (): Promise<Health> => (await fetch(API + "/api/health")).json();
export const reweight = (id: string, weights: Record<string, number>) => post<Analysis>(`/api/analysis/${id}/reweight`, { weights });
export const setBenchmark = (id: string, type: string, iso3?: string | null) => post<Analysis>(`/api/analysis/${id}/benchmark`, { type, iso3 });
export const compare = (id: string, iso3: string[], variables?: string[]) => post<Comparison>(`/api/analysis/${id}/compare`, { iso3, variables });
export const csvUrl = (id: string) => `${API}/api/analysis/${id}/export.csv`;

/** POST a chat message and read the server-sent event stream. */
export async function streamChat(
  body: { session_id: string; message: string; selection?: { bbox: number[] } | null },
  onEvent: (ev: AgentEvent) => void,
): Promise<void> {
  const r = await fetch(API + "/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok || !r.body) throw new Error(`The analysis service returned ${r.status}`);
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      for (const line of chunk.split("\n")) {
        if (line.startsWith("data: ")) {
          try { onEvent(JSON.parse(line.slice(6)) as AgentEvent); } catch { /* ignore malformed frame */ }
        }
      }
    }
  }
}
