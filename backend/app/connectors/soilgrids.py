"""ISRIC SoilGrids v2.0 point queries (no key; fair-use rate limit).

SoilGrids values are machine-learning predictions at 250 m, not lab samples.
The MVP queries a single point per country (the label point), so the value
describes that point only and is shown as such.
"""
import time

from .. import http
from ..geo import Location
from .base import Connector, FetchResult, Obs, Progress, VariableDef

API = "https://rest.isric.org/soilgrids/v2.0/properties/query"
DEPTH = "0-5cm"


class SoilGrids(Connector):
    id = "soilgrids"
    name = "ISRIC SoilGrids v2.0"
    url = "https://soilgrids.org/"
    license = "CC BY 4.0"
    notes = ("Predicted soil properties at 250 m, topsoil (0–5 cm). One point per country in this version, "
             "retrieved only for shortlisted candidates because the public API is rate limited.")

    def fetch(self, variables: list[VariableDef], locations: list[Location], progress: Progress,
              points=None) -> FetchResult:
        res = FetchResult(period="SoilGrids v2.0 (2020 release)")
        props = sorted({v.param for v in variables})
        for v in variables:
            res.obs[v.id] = {}
        progress(f"SoilGrids: querying {len(locations)} shortlisted point(s) — rate limited, this is the slow step")
        for i, loc in enumerate(locations):
            lat, lon = loc.label
            try:
                data, ts = http.get_json(API, {
                    "lon": lon, "lat": lat, "property": props, "depth": [DEPTH], "value": ["mean"],
                }, ttl_days=365, retries=1)
                res.retrieved_at = max(res.retrieved_at or 0, ts)
                layers = {l["name"]: l for l in ((data.get("properties") or {}).get("layers") or [])}
                for v in variables:
                    layer = layers.get(v.param)
                    val = None
                    if layer:
                        d = float((layer.get("unit_measure") or {}).get("d_factor") or 1)
                        for depth in layer.get("depths", []):
                            mean = (depth.get("values") or {}).get("mean")
                            if depth.get("label") == DEPTH and mean is not None:
                                val = round(mean / d, 3)
                        tgt = (layer.get("unit_measure") or {}).get("target_units")
                        if tgt:
                            res.units[v.id] = tgt
                    if val is None:
                        res.obs[v.id][loc.iso3] = Obs(None, status="missing", note="no prediction at this point (e.g. water, bare rock, urban)")
                    else:
                        res.obs[v.id][loc.iso3] = Obs(val, period=res.period, extra={"n_points": 1, "point": [lat, lon]})
            except Exception as e:  # noqa: BLE001
                res.errors.append(f"{loc.iso3}: {e}")
                for v in variables:
                    res.obs[v.id][loc.iso3] = Obs(None, status="error", note=f"SoilGrids request failed: {e}")
            if i < len(locations) - 1:
                time.sleep(0.5)
        return res
