"""Rule-based planner used when no LLM key is configured.

It parses intent with keywords and regular expressions and then calls the same
tools as the LLM agent, so all numbers still come from retrieval and
calculation. Its language understanding is deliberately narrow: solar and
agriculture analyses, comparisons, re-weighting, benchmarks and area sampling.
"""
import re

from .. import frameworks, geo
from ..connectors import registry
from .tools import Toolbox, fnum

NUM_WORDS = {"two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "ten": 10}
SOLAR_RE = r"\b(solar|photovoltaic|pv)\b"
AGRI_RE = r"\b(grow|growing|crop|crops|farm|farming|agricultur\w*|cultivat\w*|plant|harvest)\b"
REWEIGHT_RE = r"prioriti[sz]|emphasi[sz]|what if|weigh|more important|less important|focus (?:more )?on|care more|ignore|matters? (?:more|most)"


def _topic(t: str) -> tuple[str, str | None] | None:
    if re.search(SOLAR_RE, t):
        return ("solar", None)
    crops = list(frameworks.CROPS) + list(frameworks.CROP_ALIASES)
    for c in sorted(crops, key=len, reverse=True):
        if re.search(r"\b" + c + r"\b", t):
            return ("agriculture", frameworks.CROP_ALIASES.get(c, c))
    if re.search(AGRI_RE, t):
        m = re.search(r"\b(?:grow|growing|cultivate|cultivating|plant|planting|farm|farming)\s+([a-z]+)", t)
        crop = m.group(1) if m and m.group(1) not in {"in", "crops", "food", "the", "a", "things", "produce", "land"} else None
        return ("agriculture", crop)
    return None


def _match_vars(phrase: str, a: dict) -> list[str]:
    out = []
    for v in a["variables"]:
        vd = registry.resolve(v["id"])
        kws = (vd.keywords if vd else []) + [v["label"].lower()]
        if any(k in phrase for k in kws):
            out.append(v["id"])
    if not out and "cost" in phrase:
        out = [v["id"] for v in a["variables"] if v["category"] == "Economics" and v["direction"] == "lower"]
    return out


def _scope(text: str) -> tuple[dict, list[str], str | None]:
    countries = geo.find_countries(text)
    region = geo.find_region(text)
    if len(countries) >= 2:
        return {"countries": countries}, countries, None
    if len(countries) == 1:
        loc = geo.locations()[countries[0]]
        return ({"continent": loc.continent}, countries,
                f"A single country cannot be ranked on its own, so I scored all of {loc.continent} and focused on {loc.name}.")
    if region and not region.get("world"):
        return region, [], None
    note = None if region else "No region was specified, so I analysed the whole world at one sample point per country."
    return {}, [], note


def _ranking_text(a: dict, n: int = 5) -> str:
    lines = []
    for l in [l for l in a["locations"] if l["rank"]][:n]:
        move = ""
        if l["prev_rank"] and l["prev_rank"] != l["rank"]:
            move = f" (was #{l['prev_rank']})"
        extra = f" — strongest on {', '.join(l['strengths'][:2]).lower()}" if l["strengths"] else ""
        lines.append(f"- **#{l['rank']} {l['name']}** · score {l['score']} · data confidence {round(l['confidence'] * 100)}%{move}{extra}")
    return "\n".join(lines)


def _why_text(a: dict, n: int = 5) -> str:
    """Facts behind each top location, against the benchmark."""
    ranked = [l for l in a["locations"] if l["rank"]][:n]
    if not ranked:
        return ""
    out = [f"**Why they rank this way** — each value against {ranked[0]['reasons']['reference']}:"]
    for l in ranked:
        rs = l["reasons"]
        lines = [f"**#{l['rank']} {l['name']}** ({l['score']})"]
        for f in rs["up"][:3]:
            lines.append(f"- ▲ {f['text']} ({f['points_vs_average']:+.1f} pts)")
        for f in rs["down"][:2]:
            lines.append(f"- ▼ {f['text']} ({f['points_vs_average']:+.1f} pts)")
        if rs["gaps"]:
            lines.append(f"- No data: {', '.join(rs['gaps'][:4]).lower()}{' and more' if len(rs['gaps']) > 4 else ''}")
        out.append("\n".join(lines))
    out.append("Points are gained or lost against an average candidate. The **Why** tab has this for every location and every variable.")
    return "\n\n".join(out)


def _caveats(a: dict) -> str:
    proxies = [v["label"] for v in a["variables"] if v["kind"] == "proxy"]
    parts = []
    if proxies:
        parts.append(f"{len(proxies)} variable(s) are proxies, not direct measurements ({', '.join(proxies).lower()})")
    est = [v["label"] for v in a["variables"] if v["kind"] == "estimated"]
    if est:
        parts.append(f"{', '.join(est).lower()} is calculated here with a stated formula, not measured")
    empty = [v["label"] for v in a["variables"] if v["coverage"]["with_data"] == 0]
    if empty:
        parts.append(f"no location had data for {', '.join(empty).lower()}, so it did not affect the scores")
    if a["unavailable"]:
        parts.append(f"{len(a['unavailable'])} relevant variable(s) have no connected dataset and are left out — see the Sources tab")
    unranked = sum(1 for l in a["locations"] if not l["rank"])
    if unranked:
        parts.append(f"{unranked} location(s) had too little data to rank")
    return ("**Limits:** " + "; ".join(parts) + ". Scores are relative to this candidate set and are not a yield or profit forecast.") if parts else ""


def _new_analysis(tb: Toolbox, text: str, topic: tuple[str, str | None]) -> str:
    kind, crop = topic
    fw = frameworks.solar() if kind == "solar" else frameworks.agriculture(crop)
    scope, focus, note = _scope(text)
    tb.step(f"Understood: {fw['title'].lower()} — identifying relevant variables")
    cats: dict[str, list[str]] = {}
    for item in fw["variables"]:
        vd = registry.resolve(item["id"])
        if vd:
            cats.setdefault(vd.category, []).append(vd.label)
    for cat, labels in cats.items():
        tb.step(f"{cat} ({len(labels)}): {', '.join(labels)}")
    tb.step(f"{len(fw['variables'])} variables chosen from a catalog of {len(registry.CATALOG)}")
    s = tb.run_analysis(fw["title"], fw["variables"], scope, fw["objective"], fw["unavailable"])
    a = tb.analysis
    if focus and len(focus) == 1:
        tb.focus_map(focus)
    out = [f"**{a['title']} — {a['scope_label']}.** I scored {s['locations_analysed']} locations on {len(a['variables'])} variables "
           f"in {len(cats)} groups and ranked {s['locations_ranked']}.", _ranking_text(a), _why_text(a)]
    if focus and len(focus) == 1:
        l = next((l for l in a["locations"] if l["iso3"] == focus[0]), None)
        if l:
            out.append(f"**{l['name']}** ranks " + (f"#{l['rank']} with a score of {l['score']}." if l["rank"] else "unranked (too little data)."))
    if note:
        out.append(note)
    for w in a["warnings"]:
        out.append(w)
    out.append(_caveats(a))
    out.append("Click a location for its underlying values, or ask me to compare locations or change what matters most.")
    return "\n\n".join(p for p in out if p)


def _compare(tb: Toolbox, text: str, t: str) -> str:
    names = geo.find_countries(text)
    topic = _topic(t)
    a = tb.analysis
    in_current = a and all(n in {l["iso3"] for l in a["locations"]} for n in names)
    intro = ""
    if topic and (not a or (len(names) >= 2 and not in_current)):
        intro = _new_analysis(tb, text, topic) + "\n\n"
        a = tb.analysis
    if not a:
        return ("What should the comparison be for? Tell me the activity — for example “compare Angola and Brazil for solar energy” — "
                "and I will choose the variables.")
    n = None
    nums = r"(two|three|four|five|six|ten|\d+)"
    m = re.search(rf"\b{nums}\s+(?:best|top)\b|\b(?:best|top)\s+{nums}\b", t)
    if m:
        word = m.group(1) or m.group(2)
        n = NUM_WORDS.get(word) or (int(word) if word.isdigit() else None)
    var_ids = None
    m = re.search(r"\b(?:based on|in terms of|regarding|with respect to|looking at|on)\s+(.+)$", t)
    if m:
        var_ids = _match_vars(m.group(1), a) or None
    if len(names) >= 2:
        cmp = tb.compare_locations(locations=names, variable_ids=var_ids)
    else:
        cmp = tb.compare_locations(top_n=n or 2, variable_ids=var_ids)

    locs = cmp["locations"]
    head = " vs ".join(f"**{l['name']}**" for l in locs)
    lines = [f"{intro}Comparing {head}" + (" on the variables you named." if cmp["subset"] else " on all variables.")]
    for r in cmp["rows"]:
        cells = []
        for l in locs:
            c = r["values"][l["iso3"]]
            if c["value"] is None:
                cells.append(f"{l['name']}: no data")
                continue
            if c.get("diff_pct") is not None:
                d = f" ({c['diff_pct']:+.1f}% vs benchmark)"
            elif c.get("diff_abs") is not None:
                d = f" ({c['diff_abs']:+.2f} vs benchmark)"
            else:
                d = ""
            cells.append(f"{l['name']} {fnum(c['value'])}{d}")
        best = next((l["name"] for l in locs if l["iso3"] == r["best"]), None)
        tag = " *(proxy)*" if r["kind"] == "proxy" else ""
        better = {"higher": "higher is better", "lower": "lower is better", "target": "closer to target range is better"}[r["direction"]]
        lines.append(f"- **{r['label']}**{tag} [{r['units']}; {better}]: " + "; ".join(cells) + (f" → {best} leads" if best else ""))
    wins = {l["iso3"]: sum(1 for r in cmp["rows"] if r["best"] == l["iso3"]) for l in locs}
    fs = "; ".join(f"{l['name']} {l['focused_score']}" for l in locs if l["focused_score"] is not None)
    lead = max(locs, key=lambda l: l["focused_score"] or -1)
    lines.append(f"**On these variables:** {fs}. {lead['name']} leads on {wins[lead['iso3']]} of {len(cmp['rows'])} variables.")
    lines.append(f"Benchmark: {cmp['benchmark_label']}. Reference periods and sources are in the comparison table.")
    proxies = [r["label"] for r in cmp["rows"] if r["kind"] == "proxy"]
    if proxies:
        lines.append("**Read with care:** " + ", ".join(proxies).lower() + " are proxies. They indicate direction, not actual construction, wage or grid costs.")
    return "\n".join(lines)


def _reweight(tb: Toolbox, t: str) -> str | None:
    a = tb.analysis
    up: list[str] = []
    down: list[str] = []
    zero: list[str] = []
    m = re.search(r"(?:prioriti[sz]e|emphasi[sz]e|focus(?: more)? on|care more about|more weight (?:on|to)|what if)\s+(.+?)"
                  r"(?:\s+(?:over|rather than|instead of|above|more than|and less on)\s+(.+?))?[\?\.!\s]*$", t)
    if m:
        up = _match_vars(m.group(1), a)
        down = _match_vars(m.group(2), a) if m.group(2) else []
    m = re.search(r"(?:ignore|without|drop|exclude|remove)\s+(.+?)[\?\.!\s]*$", t)
    if m:
        zero = _match_vars(m.group(1), a)
    up = [v for v in up if v not in down]
    if not (up or down or zero):
        return None
    weights = {}
    for v in a["variables"]:
        w = v["weight"]
        if v["id"] in zero:
            w = 0
        elif v["id"] in up:
            w = w * 3
        elif v["id"] in down:
            w = w * 0.4
        weights[v["id"]] = w
    tb.step("Interpreting the new priority as a weight change")
    s = tb.adjust_weights(weights)
    a = tb.analysis
    by = {v["id"]: v["label"] for v in a["variables"]}
    ch = s["weight_changes_pct"]
    lines = ["I changed the weights and recalculated the ranking from the data already retrieved."]
    if up:
        lines.append("**Raised (×3):** " + "; ".join(f"{by[i]} {ch[i]['before']}% → {ch[i]['after']}%" for i in up if i in ch))
    if down:
        lines.append("**Lowered (×0.4):** " + "; ".join(f"{by[i]} {ch[i]['before']}% → {ch[i]['after']}%" for i in down if i in ch))
    if zero:
        lines.append("**Removed from scoring:** " + ", ".join(by[i] for i in zero))
    lines.append("Other weights shrink or grow proportionally because weights always sum to 100%.")
    lines.append("**New ranking**\n" + _ranking_text(a))
    moved = [l for l in a["locations"] if l["rank"] and l["prev_rank"] and l["rank"] != l["prev_rank"]]
    lines.append(_why_text(a, 3))
    lines.append(f"{len(moved)} location(s) changed position." if moved else "The order did not change: the leaders are also ahead on the variables you prioritised.")
    for i in up:
        gaps = [l["name"] for l in a["locations"] if l["rank"] and l["values"].get(i, {}).get("value") is None][:6]
        if gaps:
            lines.append(f"**Data gap:** {', '.join(gaps)} ha{'s' if len(gaps) == 1 else 've'} no value for {by[i].lower()}, so the score there "
                         "rests on the remaining variables only (see the lower data confidence). Treat that position with caution.")
    proxied = [by[i] for i in up if any(v["id"] == i and v["kind"] == "proxy" for v in a["variables"])]
    if proxied:
        lines.append(f"**Note:** {', '.join(proxied).lower()} is a proxy, so this ranking reflects general price or income levels rather than quoted costs. "
                     "You can fine-tune every weight in the Weights tab.")
    return "\n\n".join(lines)


def _area(tb: Toolbox, t: str, selection: dict) -> str:
    topic = _topic(t)
    if topic and topic[0] == "agriculture":
        ids = ["power.temp", "power.precip", "power.humidity", "power.soil_wetness"]
    else:
        ids = ["power.ghi", "power.dni", "power.ghi_seasonality", "power.cloud", "power.temp"]
    tb.step("Using the selected map area as the analysis boundary")
    res = tb.analyze_area(selection["bbox"], ids)
    b = res["bbox"]
    lines = [f"**Selected area** ({b[1]:.2f}°, {b[0]:.2f}°) to ({b[3]:.2f}°, {b[2]:.2f}°):"]
    for v in res["variables"]:
        if v["mean"] is None:
            lines.append(f"- **{v['label']}**: no data returned")
        else:
            lines.append(f"- **{v['label']}**: mean {fnum(v['mean'])} {v['units']} (range {fnum(v['min'])}–{fnum(v['max'])} across {v['n_points']} points)")
    a = tb.analysis
    if a:
        for v in res["variables"]:
            bench = a["benchmark"]["values"].get(v["id"])
            if v["mean"] is not None and bench:
                lines.append(f"{v['label']} is {100 * (v['mean'] - bench) / abs(bench):+.1f}% against the current benchmark ({a['benchmark']['label']}: {fnum(bench)} {v['units']}).")
                break
    lines.append(res["note"])
    return "\n".join(lines)


def _explain(tb: Toolbox, text: str) -> str:
    a = tb.analysis
    names = geo.find_countries(text)
    l = next((l for l in a["locations"] if names and l["iso3"] == names[0]), None) or next((l for l in a["locations"] if l["rank"]), None)
    if not l:
        return "No ranked location to explain yet."
    tb.focus_map([l["iso3"]])
    rs = l["reasons"]
    lines = [f"**{l['name']}** — {rs['headline']}", f"Every variable, largest effect first (against {rs['reference']}):"]
    for f in rs["facts"]:
        mark = "▲" if f["points_vs_average"] > 0.05 else "▼" if f["points_vs_average"] < -0.05 else "•"
        lines.append(f"- {mark} {f['text']} ({f['points_vs_average']:+.1f} pts, weight {f['weight_pct']}%)")
    if rs["gaps"]:
        lines.append(f"- No data: {', '.join(rs['gaps']).lower()}")
    return "\n".join(lines)


HELP = ("I can run **solar** and **agriculture** location analyses in this mode, then compare locations, change priorities, switch the benchmark "
        "or sample an area you draw on the map (hold Shift and drag).\n\nTry: “Find the best regions in Africa for building solar farms.”\n\n"
        "For other industries the platform needs its LLM agent: set ANTHROPIC_API_KEY in backend/.env and it will build a framework from the data catalog.")


def handle(tb: Toolbox, text: str, selection: dict | None) -> str:
    t = text.lower().strip()
    a = tb.analysis
    if selection and selection.get("bbox") and re.search(r"\b(this|selected|that|the)\s+(region|area|box|selection|zone)\b", t):
        return _area(tb, t, selection)
    if re.search(r"\bcompar|\bversus\b|\bvs\.?\b", t):
        return _compare(tb, text, t)
    if a and re.search(REWEIGHT_RE, t):
        out = _reweight(tb, t)
        if out:
            return out
    if a and re.search(r"benchmark|relative to|against", t):
        names = geo.find_countries(text)
        if re.search(r"\b(world|global)\b", t):
            tb.set_benchmark("world")
        elif names:
            tb.set_benchmark("country", names[0])
        else:
            tb.set_benchmark("candidates_mean")
        b = tb.analysis["benchmark"]
        return f"Benchmark is now **{b['label']}**. Percentage differences in the tables have been recalculated." + (f"\n\n{b['note']}" if b.get("note") else "")
    topic = _topic(t)
    if topic:
        return _new_analysis(tb, text, topic)
    if a and re.search(r"\b(why|explain|how come|breakdown|break down|detail)\b", t):
        return _explain(tb, text)
    if a and re.search(REWEIGHT_RE, t):
        return ("I could not tell which variables to re-weight. Name them as they appear in the Weights tab, for example "
                "“prioritise construction cost over irradiance”.")
    return HELP
