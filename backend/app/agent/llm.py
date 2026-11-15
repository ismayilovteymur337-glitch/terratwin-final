"""LLM agent: Anthropic Messages API with tool calling, over plain HTTPS.

The model plans and explains; every number it reports comes back from a tool.
"""
import json
import time

import requests

from .. import config
from .tools import TOOL_SCHEMAS, Session, Toolbox

API_URL = "https://api.anthropic.com/v1/messages"
MODELS_URL = "https://api.anthropic.com/v1/models"
MAX_TOOL_ROUNDS = 16
# (connect, read) seconds. A long, detailed answer can take well over two minutes to write, so the old
# 120 s limit cut it off and discarded the finished analysis. Timeouts and temporary API errors are
# also retried (see _call).
REQUEST_TIMEOUT = (15, 300)
MAX_OUTPUT_TOKENS = 8192
RETRY_STATUS = {408, 409, 429, 500, 502, 503, 504, 529}

SYSTEM = """You are the research agent inside Meridian, a geospatial intelligence platform. The user describes something they want to do \
somewhere on Earth; you turn that into a location analysis using your tools, which also drive the map and dashboard the user is looking at.

How to work
1. Understand the activity and the goal. Ask a follow-up question only if the request cannot be analysed without the answer; otherwise state your assumption and proceed.
2. Decompose: decide which variables matter for THIS activity. Do not apply one generic model to every industry. Call get_data_catalog to see what is connected. \
You may also use any World Bank indicator (wb:<code>) or NASA POWER climatology parameter (power:<name>) you know to be relevant.
   Research in depth: a framework normally has 20–35 variables and covers every side of the decision: the physical resource, climate stress, \
construction and labour cost (use reported wages such as ilo.wage alongside proxies), financing cost, energy system and grid, logistics, workforce, \
governance and risk, land and water. Leave a category out only when it truly does not apply.
3. Call run_analysis with variables, directions and weights. Every variable that matters but has no connected dataset goes in `unavailable` with a reason.
4. For comparisons call compare_locations. For changed priorities call adjust_weights (never re-run the analysis just to change weights). \
For a different reference point call set_benchmark. If the user message includes a selected map area, call analyze_area with that bbox.
5. Explain the result in depth. Start with two or three sentences on what decides the ranking overall. Then, for EACH of the top locations (at least the top five, or all if fewer), \
write a block built from the `why`, `strengths` and `weaknesses` fields of the tool result:
   - **Why it ranks here:** the score and what separates it from the locations around it.
   - **Strengths:** the three to five factors that gain it the most, each with the actual value and units, the benchmark value and the difference against the benchmark.
   - **Weaknesses and risks:** the factors that cost it the most, in the same form, plus what has no data.
   - **Reading:** one sentence on what this means for the user's goal.
   Example of the expected form: "**Namibia** (#2, score 71.4) — Strengths: irradiance 6.4 kWh/m²/day, 14% above the average of the analysed locations (5.6); \
mean monthly earnings US$ 410, 22% below it. Weaknesses: logistics infrastructure 2.1 vs 2.6." \
Finish with a short comparison of the top two or three, then the limits of the data and which values are proxies or estimates.

Scope and speed
- Prefer a continent or a list of countries. A whole-world scope means about 240 locations and several minutes of data retrieval on the first run; use it only when the user asks for the whole world, and say so.

Hard rules
- Never state a number, law, price, wage, yield or measurement that did not come from a tool result in this conversation. If data is missing, say it is missing.
- Proxy variables must be called proxies. A suitability score is never a yield, cost or profit forecast, and you must not present it as one.
- When a target range or direction rests on your own domain assumption, put that in the variable's `assumption` field and mention it.
- Whenever you give a percentage difference, name the benchmark it is measured against.
- Do not describe laws, permits or regulations of specific countries; say they need verification.

Style: thorough, analytical and specific; explain the reasons behind every ranking, not only the numbers. One block per location, **bold** for location names, numbers with units. \
No preamble, no filler. The dashboard has the full tables and a Why tab for every location, so quote the facts that decide the ranking rather than reproducing whole tables.
Answer in the language the user writes in (for example Azerbaijani or Russian); keep location names, units and variable names recognisable."""


def _headers() -> dict:
    return {"x-api-key": config.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json"}


def _error_detail(r: requests.Response) -> str:
    try:
        return r.json().get("error", {}).get("message", r.text[:300])
    except Exception:  # noqa: BLE001
        return r.text[:300]


def _call(messages: list[dict], model: str) -> dict:
    # The system prompt and tool list are identical on every round, so cache them: later rounds are
    # processed faster and cost less.
    tools = [dict(t) for t in TOOL_SCHEMAS]
    if tools:
        tools[-1]["cache_control"] = {"type": "ephemeral"}
    payload = {"model": model, "max_tokens": MAX_OUTPUT_TOKENS,
               "system": [{"type": "text", "text": SYSTEM, "cache_control": {"type": "ephemeral"}}],
               "tools": tools, "messages": messages}
    last = ""
    for attempt in range(3):
        try:
            r = requests.post(API_URL, timeout=REQUEST_TIMEOUT, headers=_headers(), json=payload)
        except requests.Timeout:
            last = "the Anthropic API did not answer in time"
            time.sleep(2 * (attempt + 1))
            continue
        except requests.RequestException as e:
            raise RuntimeError(config.redact(f"could not reach the Anthropic API: {type(e).__name__}")) from None
        if r.status_code in RETRY_STATUS and attempt < 2:
            last = f"temporary API error {r.status_code}"
            try:
                wait = float(r.headers.get("retry-after", 0))
            except ValueError:
                wait = 0
            time.sleep(min(20, max(wait, 2 * (attempt + 1))))
            continue
        if r.status_code != 200:
            hint = " Check the key in Settings." if r.status_code in (401, 403) else " Pick another model in Settings." if r.status_code == 404 else ""
            raise RuntimeError(config.redact(f"LLM API error {r.status_code} for model {model}: {_error_detail(r)}.{hint}"))
        return r.json()
    raise RuntimeError(config.redact(f"{last} (tried 3 times)"))


def _compact_history(turns: list[list[dict]]) -> list[dict]:
    """Earlier turns carry the full tool results (tens of thousands of characters each). The model only
    needs the gist of them to follow the conversation, so shrink them: this keeps every new round fast."""
    out: list[dict] = []
    for turn in turns:
        for m in turn:
            c = m.get("content")
            if m.get("role") == "user" and isinstance(c, list):
                c = [({**b, "content": (b.get("content") or "")[:1500] + " …[earlier result shortened]"}
                      if b.get("type") == "tool_result" and len(b.get("content") or "") > 1500 else b) for b in c]
                m = {**m, "content": c}
            out.append(m)
    return out


_models_cache: dict = {"at": 0.0, "key": None, "data": None}


def list_models(force: bool = False) -> dict:
    """Models this key can use, newest first. Falls back to a short built-in list (live=False)."""
    fallback = [{"id": i, "name": n} for i, n in config.KNOWN_MODELS]
    if not config.ANTHROPIC_API_KEY:
        return {"live": False, "models": fallback}
    c = _models_cache
    if not force and c["data"] and c["key"] == config.ANTHROPIC_API_KEY and time.time() - c["at"] < 600:
        return c["data"]
    try:
        r = requests.get(MODELS_URL, params={"limit": 100}, headers=_headers(), timeout=20)
        if r.status_code != 200:
            return {"live": False, "models": fallback, "error": config.redact(f"{r.status_code}: {_error_detail(r)}")}
        items = [{"id": m["id"], "name": m.get("display_name") or m["id"]} for m in r.json().get("data", []) if str(m.get("id", "")).startswith("claude")]
        data = {"live": True, "models": items or fallback}
    except requests.RequestException as e:
        return {"live": False, "models": fallback, "error": config.redact(type(e).__name__)}
    c.update(at=time.time(), key=config.ANTHROPIC_API_KEY, data=data)
    return data


def verify_key() -> tuple[bool | None, str]:
    """True = accepted, False = rejected, None = could not tell (network)."""
    try:
        r = requests.get(MODELS_URL, params={"limit": 1}, headers=_headers(), timeout=15)
    except requests.RequestException:
        return None, "The key was saved, but the Anthropic API could not be reached to check it."
    if r.status_code == 200:
        return True, "Key accepted."
    if r.status_code in (401, 403):
        return False, "Anthropic rejected this key."
    return None, config.redact(f"Could not verify the key ({r.status_code}).")


def handle(tb: Toolbox, session: Session, text: str, selection: dict | None, model: str) -> str:
    user = text
    if selection and selection.get("bbox"):
        user += f"\n\n[Map selection drawn by the user — bbox [min_lon, min_lat, max_lon, max_lat]: {selection['bbox']}]"
    a = tb.analysis
    if a:
        user += f"\n\n[Current analysis on screen: '{a['title']}' — {a['scope_label']}; variables: {[v['id'] for v in a['variables']]}]"

    history = _compact_history(session.turns[-4:])
    turn: list[dict] = [{"role": "user", "content": user}]
    final = ""
    for _ in range(MAX_TOOL_ROUNDS):
        resp = _call(history + turn, model)
        content = resp.get("content", [])
        turn.append({"role": "assistant", "content": content})
        texts = [b["text"] for b in content if b.get("type") == "text" and b.get("text", "").strip()]
        if resp.get("stop_reason") != "tool_use":
            final = "\n\n".join(texts)
            break
        for tx in texts:
            tb.step(tx.strip()[:220])
        results = []
        for b in content:
            if b.get("type") != "tool_use":
                continue
            try:
                fn = getattr(tb, b["name"])
                out = fn(**(b.get("input") or {}))
                results.append({"type": "tool_result", "tool_use_id": b["id"], "content": json.dumps(out, default=str)[:60000]})
            except Exception as e:  # noqa: BLE001
                tb.step(f"Tool {b['name']} failed: {config.redact(e)}")
                results.append({"type": "tool_result", "tool_use_id": b["id"], "content": f"Error: {config.redact(e)}", "is_error": True})
        turn.append({"role": "user", "content": results})
    else:
        final = "I reached the limit of analysis steps for one request. The map and dashboard show what was completed so far."
    session.turns.append(turn)
    return final or "Done — the map and dashboard are updated."
