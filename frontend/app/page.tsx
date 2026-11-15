"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import AgentPanel from "@/components/AgentPanel";
import ResultsPanel, { PrintReport, type Tab } from "@/components/ResultsPanel";
import * as api from "@/lib/api";
import type { AgentEvent, Analysis, AreaResult, ChatMessage, Comparison, Health } from "@/lib/types";

const MapView = dynamic(() => import("@/components/MapView"), { ssr: false });

const uid = () => Math.random().toString(36).slice(2, 10);

export default function Page() {
  const session = useRef(uid());
  const [health, setHealth] = useState<Health | null>(null);
  const [offline, setOffline] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [working, setWorking] = useState(false);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [area, setArea] = useState<AreaResult | null>(null);
  const [highlight, setHighlight] = useState<string[]>([]);
  const [fit, setFit] = useState<{ iso3: string[]; n: number } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [selection, setSelection] = useState<number[] | null>(null);
  const [tab, setTab] = useState<Tab>("ranking");
  const analysisId = useRef<string | null>(null);

  useEffect(() => {
    api.getHealth().then(setHealth).catch(() => setOffline(true));
  }, []);

  const patch = (id: string, fn: (m: ChatMessage) => ChatMessage) =>
    setMessages((ms) => ms.map((m) => (m.id === id ? fn(m) : m)));

  const send = useCallback(async (text: string) => {
    const id = uid();
    const sel = selection;
    setMessages((ms) => [
      ...ms,
      { id: uid(), role: "user", text, steps: [], selection: sel },
      { id, role: "agent", text: "", steps: [], pending: true },
    ]);
    setBusy(true);
    const onEvent = (ev: AgentEvent) => {
      switch (ev.type) {
        case "step": patch(id, (m) => ({ ...m, steps: [...m.steps, ev.label] })); break;
        case "analysis":
          if (analysisId.current !== ev.analysis.id) { setComparison(null); setSelected(null); setArea(null); }
          analysisId.current = ev.analysis.id;
          setAnalysis(ev.analysis);
          setTab((t) => (t === "compare" ? "ranking" : t));
          break;
        case "comparison": setComparison(ev.comparison); setTab("compare"); setSelected(null); break;
        case "area": setArea(ev.area); break;
        case "map":
          if (ev.command.action === "fit") setFit({ iso3: ev.command.iso3, n: Date.now() });
          else setHighlight(ev.command.iso3);
          break;
        case "message": patch(id, (m) => ({ ...m, text: ev.text })); break;
        case "error": patch(id, (m) => ({ ...m, text: `The analysis failed: ${ev.message}`, error: true })); break;
        case "done": break;
      }
    };
    try {
      await api.streamChat({ session_id: session.current, message: text, selection: sel ? { bbox: sel } : null }, onEvent);
      setOffline(false);
    } catch (e) {
      setOffline(true);
      patch(id, (m) => ({ ...m, error: true, text: `Could not reach the analysis service at ${api.API}. Start the backend and try again. (${(e as Error).message})` }));
    } finally {
      patch(id, (m) => ({ ...m, pending: false }));
      setBusy(false);
    }
  }, [selection]);

  const refreshComparison = async (a: Analysis) => {
    if (!comparison) return;
    try {
      const vars = comparison.subset ? comparison.rows.map((r) => r.id) : undefined;
      setComparison(await api.compare(a.id, comparison.locations.map((l) => l.iso3), vars));
    } catch { /* keep the previous comparison */ }
  };

  const run = async (fn: () => Promise<Analysis>) => {
    setWorking(true);
    try {
      const a = await fn();
      setAnalysis(a);
      await refreshComparison(a);
    } catch (e) {
      setMessages((ms) => [...ms, { id: uid(), role: "agent", text: (e as Error).message, steps: [], error: true }]);
    } finally {
      setWorking(false);
    }
  };

  const onCompare = async (iso3: string[]) => {
    if (!analysis) return;
    try {
      setComparison(await api.compare(analysis.id, iso3));
      setHighlight(iso3);
      setFit({ iso3, n: Date.now() });
      setSelected(null);
      setTab("compare");
    } catch (e) {
      setMessages((ms) => [...ms, { id: uid(), role: "agent", text: (e as Error).message, steps: [], error: true }]);
    }
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand"><span className="brand-mark" />MERIDIAN<small>Geospatial intelligence</small></div>
        <div className="topbar-right">
          {analysis && <span className="faint">Country resolution · scores are relative suitability, not forecasts</span>}
        </div>
      </header>
      <AgentPanel messages={messages} busy={busy} health={health} offline={offline} selection={selection}
        onClearSelection={() => setSelection(null)} onSend={send} />
      <main className="map-col">
        <MapView analysis={analysis} highlight={highlight} fit={fit} selected={selected}
          onSelect={(iso) => { setSelected(iso); if (iso && analysis?.locations.some((l) => l.iso3 === iso)) setTab("ranking"); }}
          selection={selection} onSelection={setSelection} area={area} />
      </main>
      <ResultsPanel analysis={analysis} comparison={comparison} tab={tab} onTab={setTab} selected={selected} onSelect={setSelected}
        onCompare={onCompare} working={working}
        onWeights={(w) => run(() => api.reweight(analysis!.id, w))}
        onBenchmark={(t, iso) => run(() => api.setBenchmark(analysis!.id, t, iso))} />
      <PrintReport a={analysis} cmp={comparison} />
    </div>
  );
}
