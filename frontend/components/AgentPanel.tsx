"use client";

import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import type { ChatMessage, Health } from "@/lib/types";

const SUGGESTIONS = [
  "Find the best regions in Africa for building solar farms.",
  "Find the best places in Africa to grow carrots.",
  "Compare Angola and Brazil for solar energy.",
  "Which South American countries have the best agricultural potential?",
];

function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) return <em key={i}>{part.slice(1, -1)}</em>;
    return <Fragment key={i}>{part}</Fragment>;
  });
}

/** Minimal markdown: paragraphs, "- " bullets, **bold**, *italic*. */
function Rich({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length) blocks.push(<ul key={blocks.length}>{list.map((li, i) => <li key={i}>{inline(li)}</li>)}</ul>);
    list = [];
  };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (/^[-•]\s+/.test(line)) { list.push(line.replace(/^[-•]\s+/, "")); continue; }
    flush();
    if (line) blocks.push(<p key={blocks.length}>{inline(line)}</p>);
  }
  flush();
  return <div className="rich">{blocks}</div>;
}

function Steps({ steps, pending }: { steps: string[]; pending?: boolean }) {
  const [open, setOpen] = useState(false);
  if (!steps.length) return pending ? <div className="steps"><div className="step live"><i />Understanding the request</div></div> : null;
  if (!pending && !open) {
    return <button className="steps-toggle" onClick={() => setOpen(true)}>{steps.length} research steps ▸</button>;
  }
  return (
    <div className="steps">
      {!pending && <button className="steps-toggle" onClick={() => setOpen(false)}>Hide research steps ▾</button>}
      {steps.map((s, i) => (
        <div key={i} className={"step" + (pending && i === steps.length - 1 ? " live" : "")}><i />{s}</div>
      ))}
    </div>
  );
}

interface Props {
  messages: ChatMessage[];
  busy: boolean;
  health: Health | null;
  offline: boolean;
  selection: number[] | null;
  onClearSelection: () => void;
  onSend: (text: string) => void;
}

export default function AgentPanel({ messages, busy, health, offline, selection, onClearSelection, onSend }: Props) {
  const [draft, setDraft] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const send = (text: string) => {
    const t = text.trim();
    if (!t || busy) return;
    onSend(t);
    setDraft("");
  };

  return (
    <aside className="agent">
      <header className="panel-head">
        <div>
          <div className="eyebrow">Research agent</div>
          <div className="panel-title">Ask about any place, for any purpose</div>
        </div>
        <span className={"badge " + (offline ? "bad" : health?.planner === "llm" ? "ok" : "warn")}
          title={offline ? "The backend is not reachable" : health?.planner === "llm"
            ? `Language model with tool calling (${health.model})`
            : "No LLM key configured. A rule-based planner handles solar and agriculture requests with the same data tools."}>
          {offline ? "Offline" : health?.planner === "llm" ? "LLM agent" : "Rule-based planner"}
        </span>
      </header>

      <div className="agent-scroll" ref={scroller}>
        {messages.length === 0 && (
          <div className="agent-empty">
            <p>Describe what you want to do. The agent works out which variables matter, retrieves the data, scores locations and draws the result on the map.</p>
            <div className="eyebrow">Try</div>
            {SUGGESTIONS.map((s) => <button key={s} className="suggestion" onClick={() => send(s)}>{s}</button>)}
            <p className="fine">To analyse a specific area, hold Shift and drag a box on the map, then ask “Analyze this region for solar energy production.”</p>
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={"msg " + m.role + (m.error ? " error" : "")}>
            {m.role === "user" ? (
              <>
                <div className="bubble">{m.text}</div>
                {m.selection && <div className="msg-meta">with selected area {m.selection.map((n) => n.toFixed(1)).join(", ")}</div>}
              </>
            ) : (
              <>
                <Steps steps={m.steps} pending={m.pending} />
                {m.text && <Rich text={m.text} />}
              </>
            )}
          </div>
        ))}
      </div>

      <div className="composer">
        {selection && (
          <div className="chip">
            Area selected: {selection[1].toFixed(1)}°, {selection[0].toFixed(1)}° → {selection[3].toFixed(1)}°, {selection[2].toFixed(1)}°
            <button onClick={onClearSelection} aria-label="Clear selected area">×</button>
          </div>
        )}
        <div className="composer-row">
          <textarea
            value={draft} rows={2} placeholder={selection ? "Analyze this region for…" : "Find the best locations for…"}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(draft); } }}
          />
          <button className="send" disabled={busy || !draft.trim()} onClick={() => send(draft)}>{busy ? "Working…" : "Run"}</button>
        </div>
      </div>
    </aside>
  );
}
