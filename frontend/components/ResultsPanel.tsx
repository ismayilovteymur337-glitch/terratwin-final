"use client";

import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, PolarAngleAxis, PolarGrid, Radar, RadarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { csvUrl } from "@/lib/api";
import { CATEGORY_COLORS, fnum, KIND_HELP, KIND_LABEL, ramp, signed } from "@/lib/format";
import type { Analysis, Cell, Comparison, Loc, Variable } from "@/lib/types";

export type Tab = "ranking" | "compare" | "weights" | "sources";

interface Props {
  analysis: Analysis | null;
  comparison: Comparison | null;
  tab: Tab;
  onTab: (t: Tab) => void;
  selected: string | null;
  onSelect: (iso3: string | null) => void;
  onCompare: (iso3: string[]) => void;
  onWeights: (w: Record<string, number>) => Promise<void>;
  onBenchmark: (type: string, iso3?: string | null) => Promise<void>;
  working: boolean;
}

const tooltipStyle = { background: "#141a20", border: "1px solid #2a343f", borderRadius: 6, fontSize: 12, color: "#dfe5ea" };
const SERIES = ["#8fd3c1", "#d9b24a", "#b98ad0", "#5fa8c9", "#d08a8a"];

function KindBadge({ v }: { v: { kind: Variable["kind"]; proxy_note?: string | null } }) {
  return <span className={"kind " + v.kind} title={v.proxy_note || KIND_HELP[v.kind]}>{KIND_LABEL[v.kind]}</span>;
}

function Diff({ c, v }: { c: Cell | undefined; v: { pct_meaningful: boolean; direction: string } }) {
  if (!c || c.value === null || c.diff_abs === null || c.diff_abs === undefined) return <span className="faint">—</span>;
  const good = v.direction === "target" ? null : v.direction === "lower" ? c.diff_abs < 0 : c.diff_abs > 0;
  const cls = c.diff_abs === 0 || good === null ? "faint" : good ? "pos" : "neg";
  return (
    <span className={cls}>
      {v.pct_meaningful && c.diff_pct !== null && c.diff_pct !== undefined ? `${signed(c.diff_pct)}%` : signed(c.diff_abs, 2)}
    </span>
  );
}

function CellValue({ c }: { c: Cell | undefined }) {
  if (!c || c.value === null || c.value === undefined) {
    return <span className="faint" title={c?.note || undefined}>{c?.status === "not_retrieved" ? "not retrieved" : c?.status === "error" ? "request failed" : "no data"}</span>;
  }
  return <>{fnum(c.value)}</>;
}

function Detail({ a, l, onClose }: { a: Analysis; l: Loc; onClose: () => void }) {
  return (
    <div className="detail">
      <div className="detail-head">
        <div>
          <div className="detail-name">{l.name}</div>
          <div className="faint">{l.subregion || l.continent} · {l.rank ? `rank #${l.rank} of ${a.locations.filter((x) => x.rank).length}` : "not ranked — too little data"}</div>
        </div>
        <div className="detail-score" style={{ color: ramp(l.rank ? l.score : null) }}>{l.score === null ? "—" : l.score.toFixed(1)}<small>/100</small></div>
        <button className="x" onClick={onClose} aria-label="Close details">×</button>
      </div>
      <div className="conf"><span style={{ width: `${l.confidence * 100}%` }} /><em>Data confidence {Math.round(l.confidence * 100)}%</em></div>
      {(l.strengths.length > 0 || l.weaknesses.length > 0) && (
        <div className="sw">
          {l.strengths.length > 0 && <div><span className="pos">Advantages</span> {l.strengths.join(" · ")}</div>}
          {l.weaknesses.length > 0 && <div><span className="neg">Disadvantages</span> {l.weaknesses.join(" · ")}</div>}
        </div>
      )}
      <table className="tbl">
        <thead><tr><th>Variable</th><th className="r">Value</th><th className="r" title={`Difference against: ${a.benchmark.label}`}>vs benchmark</th><th className="r" title="Points this variable adds to the score">Pts</th></tr></thead>
        <tbody>
          {a.variables.map((v) => {
            const c = l.values[v.id];
            return (
              <tr key={v.id}>
                <td>
                  <div>{v.label} <KindBadge v={v} /></div>
                  <div className="faint small">{v.units}{c?.period ? ` · ${c.period}` : ""}{c?.n_points ? ` · ${c.n_points} pt` : ""}</div>
                </td>
                <td className="r num"><CellValue c={c} /></td>
                <td className="r num"><Diff c={c} v={v} /></td>
                <td className="r num">{c?.contribution !== undefined ? c.contribution.toFixed(1) : <span className="faint">—</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="fine">Benchmark: {a.benchmark.label}. Score is relative suitability on these variables, not a yield, cost or profit forecast.</div>
    </div>
  );
}

function Ranking({ a, selected, onSelect, onCompare }: { a: Analysis; selected: string | null; onSelect: Props["onSelect"]; onCompare: Props["onCompare"] }) {
  const [picked, setPicked] = useState<string[]>([]);
  useEffect(() => setPicked([]), [a.id]);
  const ranked = a.locations.filter((l) => l.rank);
  const unranked = a.locations.filter((l) => !l.rank);
  const sel = selected ? a.locations.find((l) => l.iso3 === selected) : null;

  const cats = useMemo(() => Array.from(new Set(a.variables.map((v) => v.category))), [a]);
  const composition = useMemo(() => ranked.slice(0, 8).map((l) => {
    const row: Record<string, number | string> = { name: l.name.length > 14 ? l.iso3 : l.name };
    for (const c of cats) row[c] = 0;
    for (const v of a.variables) row[v.category] = Number(((row[v.category] as number) + (l.values[v.id]?.contribution || 0)).toFixed(2));
    return row;
  }), [a, ranked, cats]);

  const toggle = (iso: string) => setPicked((p) => (p.includes(iso) ? p.filter((x) => x !== iso) : p.length >= 5 ? p : [...p, iso]));

  return (
    <div>
      {sel && <Detail a={a} l={sel} onClose={() => onSelect(null)} />}
      {a.warnings.map((w, i) => <div className="note warn" key={i}>{w}</div>)}

      <div className="section-head">
        <span>Ranked locations <em>{ranked.length}</em></span>
        <button className="btn sm" disabled={picked.length < 2} onClick={() => onCompare(picked)}>
          {picked.length < 2 ? "Tick 2–5 to compare" : `Compare ${picked.length}`}
        </button>
      </div>
      <div className="rank-list">
        {ranked.map((l) => {
          const delta = l.prev_rank && l.prev_rank !== l.rank ? l.prev_rank - (l.rank as number) : 0;
          return (
            <div key={l.iso3} className={"rank-row" + (l.iso3 === selected ? " on" : "")} onClick={() => onSelect(l.iso3 === selected ? null : l.iso3)}>
              <input type="checkbox" checked={picked.includes(l.iso3)} onClick={(e) => e.stopPropagation()} onChange={() => toggle(l.iso3)} aria-label={`Select ${l.name} for comparison`} />
              <span className="rank-n">{l.rank}</span>
              <span className="rank-name">
                {l.name}
                {delta !== 0 && <i className={delta > 0 ? "pos" : "neg"}>{delta > 0 ? "▲" : "▼"}{Math.abs(delta)}</i>}
              </span>
              <span className="rank-bar"><span style={{ width: `${l.score}%`, background: ramp(l.score) }} /></span>
              <span className="rank-score num">{(l.score as number).toFixed(1)}</span>
              <span className={"rank-conf num" + (l.confidence < 0.8 ? " low" : "")} title="Data confidence: share of the weighting backed by data">{Math.round(l.confidence * 100)}%</span>
            </div>
          );
        })}
      </div>
      {unranked.length > 0 && (
        <div className="note">
          <b>Not ranked ({unranked.length})</b> — less than half of the weighting has data: {unranked.map((l) => l.name).join(", ")}.
        </div>
      )}

      {composition.length > 0 && (
        <>
          <div className="section-head"><span>What makes up the score</span></div>
          <div style={{ height: 30 + composition.length * 26 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={composition} layout="vertical" margin={{ left: 0, right: 12, top: 0, bottom: 0 }} barSize={12}>
                <CartesianGrid horizontal={false} stroke="#1f2730" />
                <XAxis type="number" domain={[0, 100]} tick={{ fill: "#8b97a3", fontSize: 11 }} stroke="#2a343f" />
                <YAxis type="category" dataKey="name" width={92} tick={{ fill: "#b9c2cb", fontSize: 11 }} stroke="#2a343f" />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
                <Legend iconSize={8} wrapperStyle={{ fontSize: 11, color: "#8b97a3" }} />
                {cats.map((c) => <Bar key={c} dataKey={c} stackId="s" fill={CATEGORY_COLORS[c] || "#9aa5b1"} isAnimationActive={false} />)}
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="fine">Points contributed by each group of variables. Bars add up to the location's score.</div>
        </>
      )}
    </div>
  );
}

function Compare({ a, cmp }: { a: Analysis | null; cmp: Comparison | null }) {
  if (!cmp || !a) {
    return <div className="empty">Tick two or more locations in the ranking, or ask the agent — for example “Compare the two best locations based on construction costs, solar irradiance, labor costs, and infrastructure.”</div>;
  }
  const radar = cmp.rows.map((r) => {
    const row: Record<string, number | string> = { metric: r.label.length > 22 ? r.label.slice(0, 20) + "…" : r.label };
    for (const l of cmp.locations) row[l.iso3] = Math.round((r.values[l.iso3]?.norm ?? 0) * 100);
    return row;
  });
  return (
    <div>
      <div className="cmp-heads">
        {cmp.locations.map((l, i) => (
          <div className="cmp-head" key={l.iso3} style={{ borderColor: SERIES[i % SERIES.length] }}>
            <div className="cmp-name">{l.name}</div>
            <div className="cmp-score num">{l.focused_score ?? "—"}<small>{cmp.subset ? " on compared variables" : " score"}</small></div>
            <div className="faint small">overall #{l.rank ?? "—"} · {l.score ?? "—"} · confidence {Math.round(l.focused_confidence * 100)}%</div>
          </div>
        ))}
      </div>
      {cmp.rows.length >= 3 && (
        <div style={{ height: 250 }}>
          <ResponsiveContainer width="100%" height="100%">
            <RadarChart data={radar} outerRadius="68%">
              <PolarGrid stroke="#2a343f" />
              <PolarAngleAxis dataKey="metric" tick={{ fill: "#8b97a3", fontSize: 10 }} />
              <Tooltip contentStyle={tooltipStyle} />
              {cmp.locations.map((l, i) => (
                <Radar key={l.iso3} name={l.name} dataKey={l.iso3} stroke={SERIES[i % SERIES.length]} fill={SERIES[i % SERIES.length]} fillOpacity={0.14} isAnimationActive={false} />
              ))}
              <Legend iconSize={8} wrapperStyle={{ fontSize: 11 }} />
            </RadarChart>
          </ResponsiveContainer>
        </div>
      )}
      <div className="fine">Radar shows each variable rescaled 0–100 where 100 is the best in the analysed set (direction already applied). Missing values plot as 0.</div>

      <div className="tbl-scroll">
        <table className="tbl">
          <thead>
            <tr><th>Variable</th>{cmp.locations.map((l) => <th className="r" key={l.iso3}>{l.name}</th>)}<th className="r" title={cmp.benchmark_label}>Benchmark</th></tr>
          </thead>
          <tbody>
            {cmp.rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <div>{r.label} <KindBadge v={r} /></div>
                  <div className="faint small">{r.units} · {r.direction === "lower" ? "lower is better" : r.direction === "target" ? `target ${r.target?.[0]}–${r.target?.[1]}` : "higher is better"}{r.period ? ` · ${r.period}` : ""}</div>
                </td>
                {cmp.locations.map((l) => {
                  const c = r.values[l.iso3];
                  return (
                    <td className={"r num" + (r.best === l.iso3 ? " best" : "")} key={l.iso3}>
                      <div><CellValue c={c} /></div>
                      <div className="small"><Diff c={c} v={r} /></div>
                    </td>
                  );
                })}
                <td className="r num faint">{fnum(r.benchmark)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="fine">
        Differences = (location − benchmark) ÷ |benchmark| × 100, in the units and reference period shown per row. Benchmark: {cmp.benchmark_label}.
        Index variables on an interval scale show the absolute difference instead. {cmp.note}
      </div>
      {cmp.rows.some((r) => r.kind === "proxy") && (
        <div className="note warn">
          {cmp.rows.filter((r) => r.kind === "proxy").map((r) => <div key={r.id}><b>{r.label}:</b> {r.proxy_note}</div>)}
        </div>
      )}
    </div>
  );
}

function Weights({ a, onWeights, onBenchmark, working }: { a: Analysis; onWeights: Props["onWeights"]; onBenchmark: Props["onBenchmark"]; working: boolean }) {
  const [w, setW] = useState<Record<string, number>>({});
  useEffect(() => setW(Object.fromEntries(a.variables.map((v) => [v.id, Math.round(v.weight_pct)]))), [a]);
  const total = Object.values(w).reduce((s, x) => s + x, 0) || 1;
  const dirty = a.variables.some((v) => Math.round(v.weight_pct) !== w[v.id]);
  return (
    <div>
      <div className="section-head"><span>Benchmark</span></div>
      <select
        value={a.benchmark.type === "country" ? `country:${a.benchmark.iso3}` : a.benchmark.type} disabled={working}
        onChange={(e) => { const [t, iso] = e.target.value.split(":"); void onBenchmark(t, iso || null); }}>
        <option value="candidates_mean">Mean of analysed locations ({a.scope_label})</option>
        <option value="world">World aggregate (World Bank indicators only)</option>
        <optgroup label="A selected location">
          {[...a.locations].sort((x, y) => x.name.localeCompare(y.name)).map((l) => <option key={l.iso3} value={`country:${l.iso3}`}>{l.name}</option>)}
        </optgroup>
      </select>
      {a.benchmark.note && <div className="fine">{a.benchmark.note}</div>}

      <div className="section-head">
        <span>Scoring weights</span>
        <button className="btn sm primary" disabled={!dirty || working} onClick={() => void onWeights(w)}>{working ? "Recalculating…" : "Apply"}</button>
      </div>
      {a.variables.map((v) => (
        <div className="weight" key={v.id}>
          <div className="weight-top">
            <span>{v.label} <KindBadge v={v} /></span>
            <span className="num">{Math.round((100 * (w[v.id] ?? 0)) / total)}%</span>
          </div>
          <input type="range" min={0} max={60} step={1} value={w[v.id] ?? 0} onChange={(e) => setW((s) => ({ ...s, [v.id]: Number(e.target.value) }))}
            style={{ accentColor: CATEGORY_COLORS[v.category] || "#8fd3c1" }} />
          <div className="faint small">
            {v.direction === "lower" ? "Lower is better" : v.direction === "target" ? `Target ${v.target?.[0]}–${v.target?.[1]} ${v.units}` : "Higher is better"}
            {v.rationale ? ` · ${v.rationale}` : ""}
          </div>
        </div>
      ))}
      <div className="fine">Weights are relative and always normalised to 100%. Changing them recalculates the ranking from data already retrieved; no new requests are made.</div>
    </div>
  );
}

function Sources({ a }: { a: Analysis }) {
  return (
    <div>
      <div className="export">
        <a className="btn sm" href={csvUrl(a.id)}>Export CSV</a>
        <button className="btn sm" onClick={() => window.print()}>Export PDF</button>
        <span className="fine">PDF uses your browser's print dialog — choose “Save as PDF”.</span>
      </div>

      <div className="section-head"><span>Variables and provenance</span></div>
      {a.variables.map((v) => (
        <div className="src-var" key={v.id}>
          <div className="src-top">
            <span>{v.label}</span>
            <span className="cover num" title="Locations with data">{v.coverage.with_data}/{v.coverage.total}</span>
          </div>
          <div className="cover-bar"><span style={{ width: `${(100 * v.coverage.with_data) / v.coverage.total}%` }} /></div>
          <div className="faint small">
            <KindBadge v={v} /> <a href={v.source_url} target="_blank" rel="noreferrer">{v.source_name}</a> · {v.units} · {v.resolution}{v.period ? ` · period: ${v.period}` : ""}
          </div>
          {v.proxy_note && <div className="small warn-text">{v.proxy_note}</div>}
          {v.assumption && <div className="small warn-text">Assumption: {v.assumption}</div>}
        </div>
      ))}

      <div className="section-head"><span>Data sources</span></div>
      {a.sources.map((s) => (
        <div className="src" key={s.id}>
          <div><a href={s.url} target="_blank" rel="noreferrer">{s.name}</a> <span className="faint small">{s.license}</span></div>
          <div className="faint small">
            Retrieved {s.retrieved_at || "—"}{s.source_updated ? ` · source last updated ${s.source_updated}` : ""}
            {s.failed_requests > 0 ? <span className="neg"> · {s.failed_requests} failed request(s), shown as missing</span> : ""}
          </div>
          <div className="faint small">{s.notes}</div>
        </div>
      ))}

      {a.unavailable.length > 0 && (
        <>
          <div className="section-head"><span>Relevant but not included <em>{a.unavailable.length}</em></span></div>
          <div className="fine" style={{ marginTop: 0 }}>These matter for the decision but no dataset is connected. They are left out, not estimated.</div>
          {a.unavailable.map((u, i) => <div className="unavail" key={i}><b>{u.name}</b><span>{u.reason}</span></div>)}
        </>
      )}

      <div className="section-head"><span>How the score is calculated</span></div>
      <ol className="method">{a.methodology.map((m, i) => <li key={i}>{m}</li>)}</ol>
    </div>
  );
}

export default function ResultsPanel(p: Props) {
  const { analysis: a, comparison, tab, onTab } = p;
  return (
    <aside className="results">
      <header className="panel-head">
        <div>
          <div className="eyebrow">{a ? `${a.scope_label} · ${a.locations.length} locations · ${a.variables.length} variables` : "Results"}</div>
          <div className="panel-title">{a ? a.title : "No analysis yet"}</div>
        </div>
      </header>
      <nav className="tabs">
        {(["ranking", "compare", "weights", "sources"] as Tab[]).map((t) => (
          <button key={t} className={t === tab ? "on" : ""} onClick={() => onTab(t)}>
            {t === "sources" ? "Sources & confidence" : t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </nav>
      <div className="results-scroll">
        {!a ? (
          <div className="empty">Results appear here once the agent has run an analysis: a ranked list, the values behind each score, comparisons against a benchmark, and where every number came from.</div>
        ) : tab === "ranking" ? (
          <Ranking a={a} selected={p.selected} onSelect={p.onSelect} onCompare={p.onCompare} />
        ) : tab === "compare" ? (
          <Compare a={a} cmp={comparison} />
        ) : tab === "weights" ? (
          <Weights a={a} onWeights={p.onWeights} onBenchmark={p.onBenchmark} working={p.working} />
        ) : (
          <Sources a={a} />
        )}
      </div>
    </aside>
  );
}

/** Rendered only when printing (Export PDF). */
export function PrintReport({ a, cmp }: { a: Analysis | null; cmp: Comparison | null }) {
  if (!a) return null;
  return (
    <div className="print-report">
      <h1>{a.title} — {a.scope_label}</h1>
      <p>{a.objective} Generated {a.created_at}. Benchmark: {a.benchmark.label}.</p>
      <h2>Ranking</h2>
      <table>
        <thead><tr><th>#</th><th>Location</th><th>Score</th><th>Confidence</th>{a.variables.map((v) => <th key={v.id}>{v.label} ({v.units})</th>)}</tr></thead>
        <tbody>
          {a.locations.map((l) => (
            <tr key={l.iso3}><td>{l.rank ?? "–"}</td><td>{l.name}</td><td>{l.score ?? "–"}</td><td>{Math.round(l.confidence * 100)}%</td>
              {a.variables.map((v) => <td key={v.id}>{l.values[v.id]?.value === null || l.values[v.id]?.value === undefined ? "no data" : fnum(l.values[v.id].value)}</td>)}</tr>
          ))}
        </tbody>
      </table>
      {cmp && (
        <>
          <h2>Comparison: {cmp.locations.map((l) => l.name).join(" vs ")}</h2>
          <table>
            <thead><tr><th>Variable</th>{cmp.locations.map((l) => <th key={l.iso3}>{l.name}</th>)}<th>Benchmark</th></tr></thead>
            <tbody>{cmp.rows.map((r) => (
              <tr key={r.id}><td>{r.label} ({r.units})</td>
                {cmp.locations.map((l) => <td key={l.iso3}>{fnum(r.values[l.iso3]?.value)}{r.values[l.iso3]?.diff_pct != null ? ` (${signed(r.values[l.iso3].diff_pct as number)}%)` : ""}</td>)}
                <td>{fnum(r.benchmark)}</td></tr>
            ))}</tbody>
          </table>
        </>
      )}
      <h2>Variables, weights and sources</h2>
      <table>
        <thead><tr><th>Variable</th><th>Weight</th><th>Direction</th><th>Source</th><th>Data kind</th><th>Resolution</th><th>Period</th><th>Coverage</th><th>Note</th></tr></thead>
        <tbody>{a.variables.map((v) => (
          <tr key={v.id}><td>{v.label}</td><td>{v.weight_pct}%</td><td>{v.direction}{v.target ? ` ${v.target[0]}–${v.target[1]}` : ""}</td><td>{v.source_name}</td>
            <td>{KIND_LABEL[v.kind]}</td><td>{v.resolution}</td><td>{v.period || "–"}</td><td>{v.coverage.with_data}/{v.coverage.total}</td><td>{v.proxy_note || v.assumption || ""}</td></tr>
        ))}</tbody>
      </table>
      <h2>Relevant variables not included (no dataset connected)</h2>
      <ul>{a.unavailable.map((u, i) => <li key={i}><b>{u.name}:</b> {u.reason}</li>)}</ul>
      <h2>Method</h2>
      <ol>{a.methodology.map((m, i) => <li key={i}>{m}</li>)}</ol>
    </div>
  );
}
