"""Tools the agent can call. The LLM agent and the rule-based planner both go
through this Toolbox, so either way results come from real retrieval and
calculation, and every tool call drives the map and dashboard via events.
"""
import threading
from typing import Callable

from .. import engine, frameworks, geo
from ..connectors import registry


class Session:
    def __init__(self, sid: str):
        self.id = sid
        self.turns: list[list[dict]] = []      # LLM message history, one list per user turn
        self.analysis_id: str | None = None
        self.lock = threading.Lock()


SESSIONS: dict[str, Session] = {}


def get_session(sid: str) -> Session:
    if sid not in SESSIONS:
        SESSIONS[sid] = Session(sid)
    return SESSIONS[sid]


def fnum(x) -> str:
    if x is None:
        return "no data"
    ax = abs(x)
    if ax >= 1000:
        return f"{x:,.0f}"
    if ax >= 100:
        return f"{x:.1f}"
    return f"{x:.2f}".rstrip("0").rstrip(".")


class Toolbox:
    def __init__(self, session: Session, emit: Callable[[dict], None]):
        self.session = session
        self.emit = emit

    # -- helpers
    def step(self, label: str) -> None:
        self.emit({"type": "step", "label": label})

    @property
    def analysis(self) -> dict | None:
        return engine.STORE.get(self.session.analysis_id or "")

    def _need_analysis(self) -> dict:
        a = self.analysis
        if not a:
            raise ValueError("There is no analysis yet. Run an analysis first.")
        return a

    def _publish(self, a: dict, fit: list[str] | None = None, highlight: list[str] | None = None) -> None:
        self.emit({"type": "analysis", "analysis": engine.public(a)})
        if fit:
            self.emit({"type": "map", "command": {"action": "fit", "iso3": fit}})
        self.emit({"type": "map", "command": {"action": "highlight", "iso3": highlight or []}})

    def summary(self, a: dict, n: int = 10) -> dict:
        ranked = [l for l in a["locations"] if l["rank"]]
        return {
            "analysis_id": a["id"], "title": a["title"], "scope": a["scope_label"],
            "locations_analysed": len(a["locations"]), "locations_ranked": len(ranked),
            "benchmark": a["benchmark"]["label"],
            "variables": [{"id": v["id"], "label": v["label"], "units": v["units"], "weight_pct": v["weight_pct"],
                           "direction": v["direction"], "target": v["target"], "data_kind": v["kind"],
                           "coverage": f"{v['coverage']['with_data']}/{v['coverage']['total']}",
                           "period": v["period"], "proxy_note": v["proxy_note"], "assumption": v["assumption"]} for v in a["variables"]],
            "top": [{"rank": l["rank"], "previous_rank": l["prev_rank"], "name": l["name"], "iso3": l["iso3"], "score": l["score"],
                     "data_confidence": l["confidence"], "strengths": l["strengths"], "weaknesses": l["weaknesses"],
                     "why": {"headline": l["reasons"]["headline"],
                             "advantages_vs_benchmark": [f"{f['text']} ({f['points_vs_average']:+.1f} pts vs an average candidate)" for f in l["reasons"]["up"][:6]],
                             "disadvantages_vs_benchmark": [f"{f['text']} ({f['points_vs_average']:+.1f} pts vs an average candidate)" for f in l["reasons"]["down"][:6]],
                             "no_data_for": l["reasons"]["gaps"]},
                     "values": {vid: c.get("value") for vid, c in l["values"].items()}} for l in ranked[:n]],
            "benchmark_values": a["benchmark"]["values"],
            "not_ranked_insufficient_data": [l["name"] for l in a["locations"] if not l["rank"]][:25],
            "unavailable_variables": a["unavailable"], "warnings": a["warnings"],
        }

    # -- tools
    def get_data_catalog(self) -> dict:
        self.step("Reading the data catalog")
        return {
            "connectors": registry.connectors_public(),
            "variable_count": len(registry.CATALOG),
            "variables": [{k: v[k] for k in ("id", "label", "units", "kind", "category", "resolution", "default_direction", "description", "proxy_note")}
                          for v in registry.catalog_public()],
            "dynamic_ids": "Also valid: 'wb:<World Bank indicator code>' and 'power:<NASA POWER climatology parameter>'.",
            "example_frameworks": {"solar": frameworks.solar(), "agriculture_carrot": frameworks.agriculture("carrot")},
            "scope_options": {"continents": geo.CONTINENTS, "subregions": sorted({l.subregion for l in geo.locations().values() if l.subregion})},
        }

    def run_analysis(self, title: str, variables: list[dict], scope: dict | None = None, objective: str = "",
                     unavailable: list[dict] | None = None, benchmark: dict | None = None) -> dict:
        self.step(f"Building the research framework: {len(variables)} variable(s)")
        a = engine.run_analysis({"title": title, "objective": objective, "variables": variables, "scope": scope or {},
                                 "unavailable": unavailable or [], "benchmark": benchmark or {}}, self.step)
        self.session.analysis_id = a["id"]
        top = [l["iso3"] for l in a["locations"] if l["rank"]][:5]
        self._publish(a, fit=[l["iso3"] for l in a["locations"]], highlight=top[:1])
        self.step("Map updated with the scored locations")
        return self.summary(a)

    def compare_locations(self, locations: list[str] | None = None, top_n: int | None = None,
                          variable_ids: list[str] | None = None) -> dict:
        a = self._need_analysis()
        if locations:
            isos = []
            for name in locations:
                found = [name.upper()] if name.upper() in geo.locations() else geo.find_countries(name)
                isos.extend(found[:1])
        else:
            isos = [l["iso3"] for l in a["locations"] if l["rank"]][:max(2, int(top_n or 2))]
        self.step(f"Comparing {', '.join(isos)}")
        cmp = engine.compare(a, isos, variable_ids)
        self.emit({"type": "comparison", "comparison": cmp})
        self.emit({"type": "map", "command": {"action": "fit", "iso3": isos}})
        self.emit({"type": "map", "command": {"action": "highlight", "iso3": isos}})
        self.step("Map focused on the compared locations")
        return cmp

    def adjust_weights(self, weights: dict[str, float]) -> dict:
        a = self._need_analysis()
        before = {v["id"]: v["weight_pct"] for v in a["variables"]}
        self.step("Recalculating scores with the new weights (no new data requests)")
        engine.set_weights(a, weights)
        self._publish(a, highlight=[l["iso3"] for l in a["locations"] if l["rank"]][:1])
        out = self.summary(a)
        out["weight_changes_pct"] = {v["id"]: {"before": before[v["id"]], "after": v["weight_pct"]}
                                     for v in a["variables"] if before[v["id"]] != v["weight_pct"]}
        return out

    def set_benchmark(self, type: str, country: str | None = None) -> dict:
        a = self._need_analysis()
        iso = None
        if type == "country":
            found = [country.upper()] if country and country.upper() in geo.locations() else geo.find_countries(country or "")
            if not found:
                raise ValueError(f"Could not resolve benchmark country '{country}'.")
            iso = found[0]
        self.step(f"Changing the benchmark to: {type}{' ' + iso if iso else ''}")
        engine.set_benchmark(a, type, iso, self.step)
        self.emit({"type": "analysis", "analysis": engine.public(a)})
        return {"benchmark": a["benchmark"]}

    def analyze_area(self, bbox: list[float], variable_ids: list[str]) -> dict:
        res = engine.analyze_area(bbox, variable_ids, self.step)
        self.emit({"type": "area", "area": res})
        return res

    def focus_map(self, countries: list[str]) -> dict:
        isos = []
        for c in countries:
            isos.extend(([c.upper()] if c.upper() in geo.locations() else geo.find_countries(c))[:1])
        self.emit({"type": "map", "command": {"action": "fit", "iso3": isos}})
        self.emit({"type": "map", "command": {"action": "highlight", "iso3": isos}})
        return {"focused": isos}


_VAR_ITEM = {
    "type": "object",
    "properties": {
        "id": {"type": "string", "description": "Catalog variable id, or wb:<code>, or power:<parameter>."},
        "weight": {"type": "number", "description": "Relative importance; any positive scale."},
        "direction": {"type": "string", "enum": ["higher", "lower", "target"]},
        "target": {"type": "array", "items": {"type": "number"}, "description": "[low, high] in the variable's units; required when direction is 'target'."},
        "label": {"type": "string"},
        "rationale": {"type": "string", "description": "One short sentence: why this variable matters for this request."},
        "assumption": {"type": "string", "description": "State it when a target range or direction rests on your own assumption rather than a connected dataset."},
    },
    "required": ["id", "weight", "direction"],
}

TOOL_SCHEMAS = [
    {"name": "get_data_catalog",
     "description": "List connected data sources, available variables, valid scopes and two example frameworks. Call this before designing a framework for a new topic.",
     "input_schema": {"type": "object", "properties": {}}},
    {"name": "run_analysis",
     "description": "Retrieve data for the chosen variables over a geographic scope, score and rank the locations, and draw the result on the map. "
                    "Design the variable list for the specific request; do not reuse one generic model. List in 'unavailable' every variable that matters but has no connected dataset.",
     "input_schema": {"type": "object", "properties": {
         "title": {"type": "string"}, "objective": {"type": "string"},
         "scope": {"type": "object", "description": "One of: {continent}, {subregion}, {countries:[names or ISO3]}, or {} for the whole world.",
                   "properties": {"continent": {"type": "string"}, "subregion": {"type": "string"}, "countries": {"type": "array", "items": {"type": "string"}}}},
         "variables": {"type": "array", "items": _VAR_ITEM},
         "unavailable": {"type": "array", "items": {"type": "object", "properties": {"name": {"type": "string"}, "reason": {"type": "string"}}, "required": ["name", "reason"]}},
         "benchmark": {"type": "object", "properties": {"type": {"type": "string", "enum": ["candidates_mean", "world", "country"]}, "iso3": {"type": "string"}}},
     }, "required": ["title", "variables"]}},
    {"name": "compare_locations",
     "description": "Side-by-side comparison of locations from the current analysis, optionally restricted to some variables. Highlights them on the map. Give either 'locations' or 'top_n'.",
     "input_schema": {"type": "object", "properties": {
         "locations": {"type": "array", "items": {"type": "string"}}, "top_n": {"type": "integer"},
         "variable_ids": {"type": "array", "items": {"type": "string"}}}}},
    {"name": "adjust_weights",
     "description": "Set new weights for variables of the current analysis and recalculate the ranking. Unlisted variables keep their weight. Returns before/after weight percentages.",
     "input_schema": {"type": "object", "properties": {"weights": {"type": "object", "additionalProperties": {"type": "number"}}}, "required": ["weights"]}},
    {"name": "set_benchmark",
     "description": "Change the reference used for percentage differences: mean of analysed locations, World Bank world aggregate, or a specific country.",
     "input_schema": {"type": "object", "properties": {"type": {"type": "string", "enum": ["candidates_mean", "world", "country"]}, "country": {"type": "string"}}, "required": ["type"]}},
    {"name": "analyze_area",
     "description": "Sample gridded (NASA POWER) variables inside a bounding box the user drew on the map. bbox = [min_lon, min_lat, max_lon, max_lat].",
     "input_schema": {"type": "object", "properties": {"bbox": {"type": "array", "items": {"type": "number"}}, "variable_ids": {"type": "array", "items": {"type": "string"}}}, "required": ["bbox", "variable_ids"]}},
    {"name": "focus_map",
     "description": "Zoom the map to and highlight the given countries.",
     "input_schema": {"type": "object", "properties": {"countries": {"type": "array", "items": {"type": "string"}}}, "required": ["countries"]}},
]
