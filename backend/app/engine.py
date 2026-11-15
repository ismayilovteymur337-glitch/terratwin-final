"""Analysis engine: retrieve -> normalise -> score -> rank -> benchmark -> compare.

Everything here is deterministic arithmetic on retrieved values. The agent
decides *what* to analyse (variables, directions, weights, scope); this module
does the calculation and records how every number was produced.
"""
import copy
import csv
import io
import time
import uuid
from datetime import datetime, timezone
from typing import Callable

from . import config, geo
from .connectors import registry
from .connectors.base import Obs, VariableDef

STORE: dict[str, dict] = {}
Emit = Callable[[str], None]


def _iso(ts: float | None) -> str | None:
    return datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%d %H:%M UTC") if ts else None


# ---------------------------------------------------------------- retrieval

def _fetch(vdefs: list[VariableDef], locs: list[geo.Location], emit: Emit, n_points: int,
           skip: set[str] = frozenset()) -> tuple[dict[str, dict[str, Obs]], list[dict], list[dict], dict, dict]:
    obs: dict[str, dict[str, Obs]] = {}
    points: list[dict] = []
    sources: list[dict] = []
    units: dict[str, str] = {}
    labels: dict[str, str] = {}
    by_conn: dict[str, list[VariableDef]] = {}
    for v in vdefs:
        by_conn.setdefault(v.connector, []).append(v)
    for cid, vs in by_conn.items():
        if cid in skip:
            continue
        conn = registry.CONNECTORS[cid]
        pts = {l.iso3: geo.sample_points(l, n_points) for l in locs} if cid == "nasa_power" else None
        t0 = time.time()
        res = conn.fetch(vs, locs, emit, pts)
        emit(f"{conn.name}: done in {time.time() - t0:.0f} s")
        obs.update(res.obs)
        points.extend(res.points)
        units.update(res.units)
        labels.update(res.labels)
        if res.errors:
            emit(f"{conn.name}: {len(res.errors)} request(s) failed — affected values are shown as missing")
        sources.append({**conn.describe(), "retrieved_at": _iso(res.retrieved_at), "source_updated": res.source_updated,
                        "period": res.period, "failed_requests": len(res.errors), "variables": [v.id for v in vs]})
    return obs, points, sources, units, labels


def run_analysis(spec: dict, emit: Emit = lambda s: None) -> dict:
    locs, scope_label = geo.resolve_scope(spec.get("scope") or {})
    if not locs:
        raise ValueError("No locations matched the requested scope.")

    unavailable = list(spec.get("unavailable") or [])
    items, vdefs = [], []
    seen = set()
    for item in spec.get("variables") or []:
        vd = registry.resolve(str(item.get("id", "")))
        if not vd:
            unavailable.append({"name": str(item.get("id")), "reason": "Not in the data catalog and not a valid wb:/power: id."})
            continue
        if vd.id in seen:
            continue
        direction = item.get("direction") or vd.default_direction
        target = item.get("target")
        if direction == "target" and not (isinstance(target, (list, tuple)) and len(target) == 2):
            unavailable.append({"name": vd.label, "reason": "Needs a target range to be scored; none was specified."})
            continue
        seen.add(vd.id)
        vdefs.append(vd)
        items.append({**item, "id": vd.id, "direction": direction})
    if not vdefs:
        raise ValueError("None of the requested variables could be resolved against the data catalog.")

    n_points = config.POWER_SAMPLES_PER_COUNTRY if len(locs) <= config.POWER_FULL_SAMPLING_MAX_COUNTRIES else 1
    emit(f"Scope: {scope_label} — {len(locs)} candidate location(s), {len(vdefs)} variable(s)")
    obs, points, sources, units, labels = _fetch(vdefs, locs, emit, n_points, skip={"soilgrids"})

    variables = []
    for vd, item in zip(vdefs, items):
        conn = registry.CONNECTORS[vd.connector]
        variables.append({
            "id": vd.id, "label": item.get("label") or labels.get(vd.id) or vd.label, "units": units.get(vd.id) or vd.units,
            "category": vd.category, "kind": vd.kind, "resolution": vd.resolution, "connector": vd.connector,
            "source_name": conn.name, "source_url": conn.url, "description": vd.description,
            "direction": item["direction"], "target": list(item["target"]) if item["direction"] == "target" else None,
            "weight": max(0.0, float(item.get("weight", 1) or 0)),
            "rationale": item.get("rationale"), "assumption": item.get("assumption"),
            "proxy_note": vd.proxy_note, "pct_meaningful": vd.pct_meaningful,
        })

    analysis = {
        "id": uuid.uuid4().hex[:12],
        "title": spec.get("title") or "Location analysis",
        "objective": spec.get("objective") or "",
        "scope": spec.get("scope") or {}, "scope_label": scope_label,
        "created_at": _iso(time.time()),
        "variables": variables,
        "locations": [{
            "iso3": l.iso3, "name": l.name, "continent": l.continent, "subregion": l.subregion,
            "label": list(l.label), "values": {}, "rank": None, "prev_rank": None,
        } for l in locs],
        "benchmark": {"type": (spec.get("benchmark") or {}).get("type", "candidates_mean"),
                      "iso3": (spec.get("benchmark") or {}).get("iso3")},
        "unavailable": unavailable, "sources": sources, "points": points, "warnings": [],
        "n_points_per_location": n_points,
    }
    _store_obs(analysis, obs)

    soil = [v for v in vdefs if v.connector == "soilgrids"]
    if soil:
        compute_scores(analysis)   # provisional ranking without soil
        ranked = [l for l in analysis["locations"] if l["rank"]] or analysis["locations"]
        short = [l["iso3"] for l in sorted(ranked, key=lambda l: l.get("score") or 0, reverse=True)[:config.SOIL_SHORTLIST]]
        emit(f"Shortlisting {len(short)} candidate(s) for soil data: {', '.join(short)}")
        by_iso = {l.iso3: l for l in locs}
        s_obs, _, s_sources, s_units, _ = _fetch(soil, [by_iso[i] for i in short], emit, 1)
        for v in soil:
            for l in locs:
                s_obs.setdefault(v.id, {}).setdefault(
                    l.iso3, Obs(None, status="not_retrieved", note="outside the soil shortlist (API rate limit)"))
        for var in analysis["variables"]:
            if var["id"] in s_units:
                var["units"] = s_units[var["id"]]
        analysis["sources"].extend(s_sources)
        _store_obs(analysis, s_obs)
        analysis["warnings"].append(
            f"Soil data was retrieved for the top {len(short)} candidates only. Other locations are scored without soil "
            "variables and show lower data confidence.")
        for l in analysis["locations"]:
            l["rank"] = None

    compute_scores(analysis)
    STORE[analysis["id"]] = analysis
    emit(f"Scored and ranked {sum(1 for l in analysis['locations'] if l['rank'])} location(s)")
    return analysis


def _store_obs(analysis: dict, obs: dict[str, dict[str, Obs]]) -> None:
    for loc in analysis["locations"]:
        for vid, by_iso in obs.items():
            o = by_iso.get(loc["iso3"])
            if o is not None:
                loc["values"][vid] = o.public()
    world = analysis.setdefault("_world", {})
    for vid, by_iso in obs.items():
        if "WLD" in by_iso and by_iso["WLD"].value is not None:
            world[vid] = by_iso["WLD"].public()


# ---------------------------------------------------------------- scoring

def _norm(value: float, var: dict, lo: float, hi: float) -> float:
    if var["direction"] == "target":
        a, b = var["target"]
        if a <= value <= b:
            return 1.0
        width = (b - a) or max(abs(a) * 0.25, 1e-9)
        dist = (a - value) if value < a else (value - b)
        return max(0.0, 1.0 - dist / width)
    if hi == lo:
        return 0.5
    x = (value - lo) / (hi - lo)
    return 1.0 - x if var["direction"] == "lower" else x


def compute_scores(analysis: dict) -> dict:
    variables, locs = analysis["variables"], analysis["locations"]
    total_w = sum(v["weight"] for v in variables) or 1.0
    for v in variables:
        v["weight_pct"] = round(100 * v["weight"] / total_w, 1)
        vals = [l["values"].get(v["id"], {}).get("value") for l in locs]
        vals = [x for x in vals if x is not None]
        v["coverage"] = {"with_data": len(vals), "total": len(locs)}
        v["range"] = [min(vals), max(vals)] if vals else None
        periods = sorted({str(l["values"].get(v["id"], {}).get("period")) for l in locs
                          if l["values"].get(v["id"], {}).get("value") is not None and l["values"][v["id"]].get("period")})
        v["period"] = periods[0] if len(periods) == 1 else (f"{periods[0]} – {periods[-1]} (varies by location)" if periods else None)

    for l in locs:
        got_w, acc = 0.0, 0.0
        for v in variables:
            cell = l["values"].setdefault(v["id"], {"value": None, "status": "missing"})
            cell.pop("norm", None)
            cell.pop("contribution", None)
            if cell.get("value") is None or not v["range"]:
                continue
            n = _norm(cell["value"], v, v["range"][0], v["range"][1])
            cell["norm"] = round(n, 4)
            if v["weight"] > 0:
                got_w += v["weight"]
                acc += v["weight"] * n
        l["confidence"] = round(got_w / total_w, 3)
        l["score"] = round(100 * acc / got_w, 1) if got_w > 0 else None
        for v in variables:
            cell = l["values"][v["id"]]
            if "norm" in cell and got_w > 0:
                cell["contribution"] = round(100 * v["weight"] * cell["norm"] / got_w, 2)

    for l in locs:
        l["prev_rank"] = l.get("rank")
        l["rank"] = None
    ranked = [l for l in locs if l["score"] is not None and l["confidence"] >= config.MIN_CONFIDENCE_TO_RANK]
    ranked.sort(key=lambda l: l["score"], reverse=True)
    for i, l in enumerate(ranked, 1):
        l["rank"] = i
    locs.sort(key=lambda l: (l["rank"] is None, l["rank"] or 0, l["name"]))

    by_id = {v["id"]: v for v in variables}
    for l in locs:
        scored = [(vid, c["norm"]) for vid, c in l["values"].items() if "norm" in c and by_id.get(vid, {}).get("weight", 0) > 0]
        l["strengths"] = [by_id[vid]["label"] for vid, n in sorted(scored, key=lambda t: -t[1]) if n >= 0.7][:3]
        l["weaknesses"] = [by_id[vid]["label"] for vid, n in sorted(scored, key=lambda t: t[1]) if n <= 0.35][:3]

    set_benchmark(analysis, analysis["benchmark"].get("type", "candidates_mean"), analysis["benchmark"].get("iso3"))
    analysis["methodology"] = _methodology(analysis)
    return analysis


def set_weights(analysis: dict, weights: dict[str, float]) -> dict:
    for v in analysis["variables"]:
        if v["id"] in weights:
            v["weight"] = max(0.0, float(weights[v["id"]]))
    if sum(v["weight"] for v in analysis["variables"]) <= 0:
        raise ValueError("At least one variable needs a weight above zero.")
    return compute_scores(analysis)


def set_benchmark(analysis: dict, btype: str, iso3: str | None = None, emit: Emit = lambda s: None) -> dict:
    variables, locs = analysis["variables"], analysis["locations"]
    values: dict[str, float | None] = {}
    note = None
    if btype == "world":
        world = analysis.get("_world", {})
        values = {v["id"]: (world.get(v["id"]) or {}).get("value") for v in variables}
        label = "World aggregate (World Bank)"
        note = ("Available only for World Bank indicators that publish a world aggregate. "
                "Gridded variables have no world benchmark in this version and are left blank.")
    elif btype == "country" and iso3:
        iso3 = iso3.upper()
        ref = next((l for l in locs if l["iso3"] == iso3), None)
        if ref is None:
            loc = geo.locations().get(iso3)
            if loc is None:
                raise ValueError(f"Unknown benchmark country {iso3}")
            cache = analysis.setdefault("_bench_cache", {})
            if iso3 not in cache:
                vdefs = [registry.resolve(v["id"]) for v in variables]
                obs, *_ = _fetch([v for v in vdefs if v], [loc], emit, analysis.get("n_points_per_location", 1))
                cache[iso3] = {"name": loc.name, "values": {vid: by.get(iso3).public() for vid, by in obs.items() if by.get(iso3)}}
            ref = cache[iso3]
        values = {v["id"]: (ref["values"].get(v["id"]) or {}).get("value") for v in variables}
        label = ref["name"]
    else:
        btype = "candidates_mean"
        for v in variables:
            xs = [l["values"][v["id"]]["value"] for l in locs if l["values"].get(v["id"], {}).get("value") is not None]
            values[v["id"]] = round(sum(xs) / len(xs), 4) if xs else None
        label = f"Mean of the {len(locs)} analysed locations ({analysis['scope_label']})"
        note = "Unweighted mean across analysed locations with data for that variable."
    analysis["benchmark"] = {"type": btype, "iso3": iso3 if btype == "country" else None, "label": label, "values": values, "note": note}

    for l in locs:
        for v in variables:
            cell = l["values"].get(v["id"]) or {}
            cell.pop("diff_abs", None)
            cell.pop("diff_pct", None)
            b = values.get(v["id"])
            if cell.get("value") is None or b is None:
                continue
            cell["diff_abs"] = round(cell["value"] - b, 4)
            if v["pct_meaningful"] and b != 0:
                cell["diff_pct"] = round(100 * (cell["value"] - b) / abs(b), 1)
    _reasons(analysis)
    return analysis


# ---------------------------------------------------------------- explanations

def fnum(x) -> str:
    if x is None:
        return "no data"
    ax = abs(x)
    if ax >= 1000:
        return f"{x:,.0f}"
    if ax >= 100:
        return f"{x:.1f}".removesuffix(".0")
    return f"{x:.2f}".rstrip("0").rstrip(".") or "0"


def _short_units(u: str) -> str:
    return (u or "").split(" (")[0]


def _reasons(analysis: dict) -> None:
    """Why each location scores as it does, stated as facts against the benchmark.

    For every variable: the location's value, the benchmark value, the difference, whether that
    is favourable given the variable's direction, and how many score points it gains or loses
    against an average candidate (weight % × (rescaled value − mean rescaled value)).
    Pure arithmetic on retrieved values; nothing is generated.
    """
    variables, locs, bench = analysis["variables"], analysis["locations"], analysis["benchmark"]
    ref = {"candidates_mean": f"the average of the {len(locs)} analysed locations", "world": "the world aggregate"}.get(bench["type"], bench["label"])
    short = {"candidates_mean": "the average", "world": "the world figure"}.get(bench["type"], bench["label"])
    mean_norm = {}
    for v in variables:
        ns = [l["values"][v["id"]]["norm"] for l in locs if "norm" in l["values"].get(v["id"], {})]
        mean_norm[v["id"]] = sum(ns) / len(ns) if ns else None
    scores = [l["score"] for l in locs if l["rank"]]
    mean_score = round(sum(scores) / len(scores), 1) if scores else None
    n_ranked = len(scores)

    for l in locs:
        facts, gaps = [], []
        for v in variables:
            if v["weight"] <= 0:
                continue
            c = l["values"].get(v["id"]) or {}
            if c.get("value") is None or "norm" not in c:
                gaps.append(v["label"])
                continue
            b = bench["values"].get(v["id"])
            delta = round(v["weight_pct"] * (c["norm"] - (mean_norm[v["id"]] or 0)), 2)
            units = _short_units(v["units"])
            text = f"{v['label']}: {fnum(c['value'])} {units}"
            favourable = None
            if v["direction"] == "target":
                lo, hi = v["target"]
                favourable = lo <= c["value"] <= hi
                text += f" — {'inside' if favourable else 'outside'} the target range {fnum(lo)}–{fnum(hi)}"
                if b is not None:
                    text += f" ({short}: {fnum(b)})"
            elif b is not None:
                diff = c["value"] - b
                if abs(diff) < 1e-9:
                    text += f" — equal to {short}"
                else:
                    favourable = (diff > 0) == (v["direction"] == "higher")
                    word = "above" if diff > 0 else "below"
                    amount = f"{abs(c['diff_pct']):g}%" if c.get("diff_pct") is not None else f"{fnum(abs(diff))} {units}".strip()
                    text += f" — {amount} {word} {short} ({fnum(b)}); {'higher' if v['direction'] == 'higher' else 'lower'} is better"
            if v["kind"] == "proxy":
                text += " [proxy]"
            elif v["kind"] == "estimated":
                text += " [estimate]"
            facts.append({"id": v["id"], "label": v["label"], "value": c["value"], "units": units, "benchmark": b,
                          "diff_pct": c.get("diff_pct"), "diff_abs": c.get("diff_abs"), "period": c.get("period"),
                          "favourable": favourable, "points_vs_average": delta, "weight_pct": v["weight_pct"], "kind": v["kind"], "text": text})
        facts.sort(key=lambda f: -abs(f["points_vs_average"]))
        up = [f for f in facts if f["points_vs_average"] >= 0.3]
        down = [f for f in facts if f["points_vs_average"] <= -0.3]
        if l["rank"] and mean_score is not None:
            gap = round(l["score"] - mean_score, 1)
            head = (f"Ranks #{l['rank']} of {n_ranked} with a score of {l['score']}, "
                    f"{abs(gap)} points {'above' if gap >= 0 else 'below'} the mean score of the ranked locations ({mean_score}).")
        else:
            head = "Not ranked: less than half of the weighting has data for this location."
        if up:
            head += " Gains most from " + ", ".join(f["label"].lower() for f in up[:3]) + "."
        if down:
            head += " Loses most on " + ", ".join(f["label"].lower() for f in down[:3]) + "."
        if gaps:
            head += f" No data for {len(gaps)} variable(s)."
        l["reasons"] = {"headline": head, "reference": ref, "up": up[:6], "down": down[:6], "facts": facts, "gaps": gaps}


def _methodology(a: dict) -> list[str]:
    n_ranked = sum(1 for l in a["locations"] if l["rank"])
    return [
        "Values marked Estimated are calculated here from retrieved values with a stated formula (for example PV output from irradiance and temperature).",
        "Each variable is rescaled to 0–1 across the analysed locations (min–max). For 'lower is better' variables the scale is inverted.",
        "Variables with a target range score 1 inside the range and fall linearly to 0 at one range-width outside it. This scale is absolute, not relative to other locations.",
        "Overall score = weighted average of the rescaled variables × 100, using only variables that have data for that location. Weights are shown as percentages and can be changed.",
        f"Data confidence = share of total weight backed by data for that location. Locations below {int(config.MIN_CONFIDENCE_TO_RANK * 100)}% are listed but not ranked.",
        f"Scores are relative to this candidate set ({a['scope_label']}, {len(a['locations'])} locations, {n_ranked} ranked). They are not comparable across analyses with a different scope.",
        "Percentage differences = (location value − benchmark value) ÷ |benchmark value| × 100, in the variable's own units and reference period. "
        "For interval-scale indices (e.g. governance estimates) only the absolute difference is shown.",
        "The Why view lists, per location, each value next to the benchmark and the score points it gains or loses against an average candidate: weight % × (rescaled value − mean rescaled value of all candidates).",
        "Missing values are never filled in. Proxy variables are real statistics standing in for a quantity with no connected dataset, and are labelled as such.",
        "A score describes relative suitability on the listed variables. It is not a yield, cost or profitability forecast.",
    ]


# ---------------------------------------------------------------- comparison

def compare(analysis: dict, iso3s: list[str], var_ids: list[str] | None = None) -> dict:
    by_iso = {l["iso3"]: l for l in analysis["locations"]}
    chosen = [by_iso[i.upper()] for i in iso3s if i.upper() in by_iso]
    if len(chosen) < 2:
        raise ValueError("Comparison needs at least two locations that are part of the current analysis.")
    variables = [v for v in analysis["variables"] if not var_ids or v["id"] in var_ids]
    if not variables:
        variables = analysis["variables"]
    bench = analysis["benchmark"]
    rows = []
    for v in variables:
        cells, best, best_norm = {}, None, -1.0
        for l in chosen:
            c = l["values"].get(v["id"]) or {}
            cells[l["iso3"]] = {k: c.get(k) for k in ("value", "period", "status", "note", "norm", "diff_abs", "diff_pct", "n_points")}
            if c.get("norm") is not None and c["norm"] > best_norm:
                best, best_norm = l["iso3"], c["norm"]
        norms = [c["norm"] for c in cells.values() if c.get("norm") is not None]
        if len(norms) > 1 and max(norms) - min(norms) < 1e-9:
            best = None
        rows.append({"id": v["id"], "label": v["label"], "units": v["units"], "direction": v["direction"], "target": v["target"],
                     "kind": v["kind"], "proxy_note": v["proxy_note"], "period": v["period"], "weight_pct": v["weight_pct"],
                     "pct_meaningful": v["pct_meaningful"], "source_name": v["source_name"],
                     "benchmark": bench["values"].get(v["id"]), "values": cells, "best": best})
    w_total = sum(v["weight"] for v in variables) or 1.0
    locs_out = []
    for l in chosen:
        got = [(v["weight"], l["values"][v["id"]]["norm"]) for v in variables if l["values"].get(v["id"], {}).get("norm") is not None]
        gw = sum(w for w, _ in got)
        locs_out.append({"iso3": l["iso3"], "name": l["name"], "rank": l["rank"], "score": l["score"], "confidence": l["confidence"],
                         "focused_score": round(100 * sum(w * n for w, n in got) / gw, 1) if gw > 0 else None,
                         "focused_confidence": round(gw / w_total, 3)})
    return {
        "analysis_id": analysis["id"], "locations": locs_out, "rows": rows,
        "benchmark_label": bench["label"], "subset": bool(var_ids) and len(variables) < len(analysis["variables"]),
        "note": "Focused score uses only the compared variables with their current relative weights. "
                "Rescaling is still relative to the full candidate set of the analysis.",
    }


# ---------------------------------------------------------------- area + export

def analyze_area(bbox: list[float], var_ids: list[str], emit: Emit = lambda s: None) -> dict:
    vdefs = [v for v in (registry.resolve(i) for i in var_ids) if v and v.connector == "nasa_power"]
    if not vdefs:
        raise ValueError("Area analysis currently supports NASA POWER (gridded) variables only.")
    x0, y0, x1, y1 = bbox
    pts = geo.grid_in_bbox(bbox, 3)
    loc = geo.Location(iso3="AREA", name="Selected area", continent="", subregion="",
                       label=((y0 + y1) / 2, (x0 + x1) / 2), bbox=tuple(bbox))
    conn = registry.CONNECTORS["nasa_power"]
    emit(f"Selected area: sampling {len(pts)} grid points inside the box")
    res = conn.fetch(vdefs, [loc], emit, {"AREA": pts})
    out = []
    for v in vdefs:
        o = res.obs[v.id]["AREA"].public()
        out.append({"id": v.id, "label": v.label, "units": res.units.get(v.id) or v.units, "kind": v.kind,
                    "mean": o.get("value"), "min": o.get("min"), "max": o.get("max"), "n_points": o.get("n_points", 0),
                    "period": o.get("period"), "status": o.get("status")})
    return {"bbox": bbox, "variables": out, "points": res.points,
            "source": {**conn.describe(), "retrieved_at": _iso(res.retrieved_at), "failed_requests": len(res.errors)},
            "note": "Unweighted mean of a 3×3 grid of point queries inside the box. Only gridded climate/solar variables are "
                    "available below country level in this version; economic and governance data are national."}


def to_csv(analysis: dict) -> str:
    buf = io.StringIO()
    w = csv.writer(buf)
    vs = analysis["variables"]
    w.writerow(["rank", "location", "iso3", "score_0_100", "data_confidence"] + [f"{v['label']} [{v['units']}]" for v in vs]
               + [f"{v['label']} — reference period" for v in vs])
    for l in analysis["locations"]:
        w.writerow([l["rank"] or "unranked", l["name"], l["iso3"], l["score"] if l["score"] is not None else "", l["confidence"]]
                   + [("" if l["values"].get(v["id"], {}).get("value") is None else l["values"][v["id"]]["value"]) for v in vs]
                   + [l["values"].get(v["id"], {}).get("period") or "" for v in vs])
    w.writerow([])
    w.writerow([f"# {analysis['title']} — {analysis['scope_label']} — generated {analysis['created_at']}"])
    w.writerow([f"# Benchmark: {analysis['benchmark']['label']}"])
    w.writerow(["# variable", "weight_pct", "direction", "target_range", "source", "data_kind", "resolution", "coverage", "note"])
    for v in vs:
        w.writerow([v["label"], v["weight_pct"], v["direction"], v["target"] or "", v["source_name"], v["kind"], v["resolution"],
                    f"{v['coverage']['with_data']}/{v['coverage']['total']}", v["proxy_note"] or v["assumption"] or ""])
    w.writerow([])
    w.writerow(["# Not included (no dataset connected)"])
    for u in analysis["unavailable"]:
        w.writerow([u.get("name"), u.get("reason")])
    w.writerow([])
    for m in analysis["methodology"]:
        w.writerow([f"# {m}"])
    return buf.getvalue()


def public(analysis: dict) -> dict:
    # deep copy: events are serialised on another thread while the analysis may still change
    return copy.deepcopy({k: v for k, v in analysis.items() if not k.startswith("_")})
