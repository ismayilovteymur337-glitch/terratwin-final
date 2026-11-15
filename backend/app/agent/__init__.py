from typing import Callable

from .. import config
from . import llm, rules
from .tools import Toolbox, get_session


def planner_mode() -> str:
    return "llm" if config.ANTHROPIC_API_KEY else "rules"


def digest(a: dict, n: int = 5) -> str:
    """Readable explanation built only from the computed facts (no model involved)."""
    ranked = [l for l in a["locations"] if l.get("rank")][:n]
    if not ranked:
        return "The analysis finished, but no location has enough data to be ranked. See the Sources tab for what is missing."
    out = [f"**{a['title']}** — {a['scope_label']}. Differences are against {a['benchmark']['label']}."]
    for l in ranked:
        r = l["reasons"]
        block = [f"**#{l['rank']} {l['name']}** (score {l['score']}) — {r['headline']}"]
        if r["up"]:
            block.append("Strengths: " + "; ".join(f["text"] for f in r["up"][:4]) + ".")
        if r["down"]:
            block.append("Weaknesses: " + "; ".join(f["text"] for f in r["down"][:4]) + ".")
        out.append("\n".join(block))
    out.append("Values marked [proxy] or [estimate] are stand-ins or calculations, not measurements. The Why tab lists every factor.")
    return "\n\n".join(out)


def run(session_id: str, message: str, selection: dict | None, emit: Callable[[dict], None], model: str | None = None) -> None:
    """Handle one user message. Emits step / analysis / comparison / map / area / message events."""
    session = get_session(session_id)
    with session.lock:
        tb = Toolbox(session, emit)
        text, mode = None, planner_mode()
        if mode == "llm":
            try:
                text = llm.handle(tb, session, message, selection, model or config.AGENT_MODEL)
            except RuntimeError as e:
                if tb.analysis:
                    # The analysis is already done and on screen. Do not throw it away and start again with the
                    # rule-based planner: explain it from the computed facts instead.
                    tb.step(f"The language model did not finish ({config.redact(e)}). Explaining the finished analysis from its computed facts.")
                    text, mode = digest(tb.analysis), "rules"
                else:
                    tb.step(f"LLM agent unavailable ({config.redact(e)}). Falling back to the rule-based planner.")
                    mode = "rules"
        if text is None:
            text = rules.handle(tb, message, selection)
        emit({"type": "message", "text": text, "planner": mode, "model": (model or config.AGENT_MODEL) if mode == "llm" else None})
