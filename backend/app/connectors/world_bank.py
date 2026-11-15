"""World Bank Open Data API (no key required).

One request per indicator returns the most recent non-empty value for every
country, plus the world aggregate (WLD) used for the global benchmark.
"""
from concurrent.futures import ThreadPoolExecutor

from .. import http
from ..geo import Location
from .base import Connector, FetchResult, Obs, Progress, VariableDef

API = "https://api.worldbank.org/v2/country/all/indicator/{code}"


class WorldBank(Connector):
    id = "world_bank"
    name = "World Bank Open Data"
    url = "https://data.worldbank.org/"
    license = "CC BY 4.0"
    notes = "National statistics. Country-level only; the reference year differs by country and is shown per value."

    def _indicator(self, code: str):
        last_err = "no data returned"
        # source 3 = Worldwide Governance Indicators; only governance codes (…EST) need it.
        for extra in ({}, {"source": 3}) if code.upper().endswith(".EST") else ({},):
            rows, page, ts, meta = [], 1, None, {}
            try:
                while True:
                    data, ts = http.get_json(
                        API.format(code=code),
                        {"format": "json", "mrnev": 1, "per_page": 500, "page": page, **extra}, ttl_days=30, timeout=25, retries=1)
                    if not isinstance(data, list) or len(data) < 2 or not data[1]:
                        if isinstance(data, list) and data and isinstance(data[0], dict) and data[0].get("message"):
                            last_err = str(data[0]["message"])
                        rows = []
                        break
                    meta = data[0]
                    rows.extend(data[1])
                    if page >= int(meta.get("pages", 1)):
                        break
                    page += 1
            except Exception as e:  # noqa: BLE001
                last_err = str(e)
                rows = []
            if rows:
                return rows, ts, meta
        raise RuntimeError(last_err)

    def fetch(self, variables: list[VariableDef], locations: list[Location], progress: Progress,
              points=None) -> FetchResult:
        res = FetchResult()
        total = len(variables)
        progress(f"World Bank: requesting {total} indicator(s), 6 at a time")

        def one(v):
            try:
                return v, *self._indicator(v.param), None
            except Exception as e:  # noqa: BLE001
                return v, None, None, None, str(e)

        done, step = 0, max(1, total // 4)
        with ThreadPoolExecutor(max_workers=6) as pool:
            results = []
            for r in pool.map(one, variables):
                results.append(r)
                done += 1
                if done % step == 0 and done < total:
                    progress(f"World Bank: {done}/{total} indicators received")
        for v, rows, ts, meta, err in results:
            res.obs[v.id] = {}
            if err:
                res.errors.append(f"{v.param}: {err}")
                for loc in locations:
                    res.obs[v.id][loc.iso3] = Obs(None, status="error", note=f"indicator request failed: {err}")
                continue
            res.retrieved_at = max(res.retrieved_at or 0, ts or 0)
            res.source_updated = (meta or {}).get("lastupdated") or res.source_updated
            by_iso = {}
            for r in rows:
                iso = r.get("countryiso3code") or ""
                if r.get("value") is None:
                    continue
                by_iso[iso] = (float(r["value"]), str(r.get("date") or ""))
                if v.id.startswith("wb:") and (r.get("indicator") or {}).get("value"):
                    res.labels[v.id] = r["indicator"]["value"]
            for loc in locations:
                if loc.iso3 in by_iso:
                    val, date = by_iso[loc.iso3]
                    res.obs[v.id][loc.iso3] = Obs(val, period=date)
                else:
                    res.obs[v.id][loc.iso3] = Obs(None, status="missing", note="no value reported for this country")
            if "WLD" in by_iso:
                res.obs[v.id]["WLD"] = Obs(by_iso["WLD"][0], period=by_iso["WLD"][1])
        return res
