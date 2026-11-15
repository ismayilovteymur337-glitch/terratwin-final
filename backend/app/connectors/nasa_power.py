"""NASA POWER climatology API (no key required).

Point queries: https://power.larc.nasa.gov/api/temporal/climatology/point
Values are satellite-derived / reanalysis model output on a coarse global grid,
not ground measurements.
"""
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor

from .. import http
from ..geo import Location
from .base import Connector, FetchResult, Obs, Progress, VariableDef

API = "https://power.larc.nasa.gov/api/temporal/climatology/point"
MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]
FILL = -900


def _period(data: dict) -> str | None:
    header = data.get("header") or {}
    for key in ("range", "title"):
        if header.get(key):
            return str(header[key])
    if header.get("start") and header.get("end"):
        return f"{header['start']}–{header['end']}"
    return None


def _months(series) -> list[float] | None:
    if not isinstance(series, dict):
        return None
    m = [series.get(k) for k in MONTHS]
    m = [v for v in m if isinstance(v, (int, float)) and v > FILL]
    return m if len(m) == 12 else None


def _ann(series) -> float | None:
    v = series.get("ANN") if isinstance(series, dict) else None
    return float(v) if isinstance(v, (int, float)) and v > FILL else None


# PV specific-yield estimate. ASSUMPTIONS (stated in the catalog entry): horizontal fixed array,
# performance ratio 0.80, power loss 0.4 %/°C for cell temperature above 25 °C, cell ≈ air + 20 °C.
PV_PR, PV_TEMP_COEFF, PV_CELL_RISE = 0.80, 0.004, 20.0


def _value(all_series: dict, v: VariableDef) -> float | None:
    s = all_series.get(v.param)
    if v.stat == "seasonal_ratio":
        m = _months(s)
        return round(min(m) / max(m), 3) if m and max(m) > 0 else None
    if v.stat == "min_month":
        m = _months(s)
        return round(min(m), 3) if m else None
    if v.stat == "max_month":
        m = _months(s)
        return round(max(m), 3) if m else None
    if v.stat == "annual_sum":
        x = _ann(s)
        return round(x * 365, 1) if x is not None else None
    if v.stat == "pv_yield":
        ghi, t = _ann(s), _ann(all_series.get("T2M"))
        if ghi is None or t is None:
            return None
        return round(ghi * 365 * PV_PR * (1 - PV_TEMP_COEFF * max(0.0, t + PV_CELL_RISE - 25.0)), 0)
    return _ann(s)


def _chunks(params: list[str], size: int = 20) -> list[list[str]]:
    return [params[i:i + size] for i in range(0, len(params), size)]


class NasaPower(Connector):
    id = "nasa_power"
    name = "NASA POWER — climatology API"
    url = "https://power.larc.nasa.gov/"
    license = "NASA open data"
    notes = ("Satellite-derived and reanalysis values on a coarse global grid (roughly 0.5°–1°). "
             "Country figures are the unweighted mean of a few sample points, not an area-weighted average.")

    def query_point(self, lat: float, lon: float, community: str, params: list[str]):
        return http.get_json(API, {
            "parameters": ",".join(sorted(params)), "community": community,
            "latitude": lat, "longitude": lon, "format": "JSON",
        }, ttl_days=90, timeout=30, retries=1)

    def fetch(self, variables: list[VariableDef], locations: list[Location], progress: Progress,
              points: dict[str, list[tuple[float, float]]] | None = None) -> FetchResult:
        res = FetchResult()
        by_comm: dict[str, set[str]] = defaultdict(set)
        for v in variables:
            by_comm[v.extra.get("community", "RE")].add(v.param)
            for extra_param in v.extra.get("also", []):
                by_comm[v.extra.get("community", "RE")].add(extra_param)

        jobs = []
        for loc in locations:
            for (lat, lon) in (points or {}).get(loc.iso3) or [loc.label]:
                for comm, params in by_comm.items():
                    for chunk in _chunks(sorted(params)):       # the API accepts at most 20 parameters per request
                        jobs.append((loc.iso3, lat, lon, comm, chunk))

        total = len(jobs)
        progress(f"NASA POWER: querying {total} point request(s) for {len(locations)} location(s)"
                 + (f" — roughly {max(1, round(total * 3 / 8 / 60))} min on the first run, cached afterwards" if total > 40 else ""))
        raw: dict[tuple[str, float, float], dict] = defaultdict(dict)   # (iso3, lat, lon) -> param -> series
        done = 0

        def run(job):
            iso3, lat, lon, comm, params = job
            try:
                data, ts = self.query_point(lat, lon, comm, params)
                return job, data, ts, None
            except Exception as e:  # noqa: BLE001
                if len(params) == 1:
                    return job, None, None, str(e)
            # One unsupported parameter fails the whole request, so split and retry the halves.
            merged, ts_max, errs = {"properties": {"parameter": {}}, "parameters": {}}, 0.0, []
            half = len(params) // 2
            for part in (params[:half], params[half:]):
                _, d, ts, err = run((iso3, lat, lon, comm, part))
                if d:
                    merged["properties"]["parameter"].update((d.get("properties") or {}).get("parameter") or {})
                    merged["parameters"].update(d.get("parameters") or {})
                    merged.setdefault("header", d.get("header") or {})
                    ts_max = max(ts_max, ts or 0)
                if err:
                    errs.append(err)
            if not merged["properties"]["parameter"]:
                return job, None, None, "; ".join(errs) or "request failed"
            return job, merged, ts_max, None

        step = max(1, total // 5)
        with ThreadPoolExecutor(max_workers=8) as pool:
            for job, data, ts, err in pool.map(run, jobs):
                done += 1
                if done % step == 0 and done < total:
                    progress(f"NASA POWER: {done}/{total} requests complete")
                iso3, lat, lon, comm, params = job
                if err:
                    res.errors.append(f"{iso3} ({lat},{lon}): {err}")
                    continue
                res.retrieved_at = max(res.retrieved_at or 0, ts)
                res.period = res.period or _period(data)
                series = (data.get("properties") or {}).get("parameter") or {}
                raw[(iso3, lat, lon)].update(series)
                meta = data.get("parameters") or {}
                for v in variables:
                    if v.param in meta:
                        if meta[v.param].get("units") and v.stat == "ANN":
                            res.units[v.id] = meta[v.param]["units"]
                        if meta[v.param].get("longname") and v.id.startswith("power:"):
                            res.labels[v.id] = meta[v.param]["longname"]

        per_loc: dict[str, dict[str, list[float]]] = defaultdict(lambda: defaultdict(list))
        for (iso3, lat, lon), series in raw.items():
            vals = {}
            for v in variables:
                x = _value(series, v)
                if x is not None:
                    per_loc[iso3][v.id].append(x)
                    vals[v.id] = x
            res.points.append({"iso3": iso3, "lat": lat, "lon": lon, "values": vals})

        for v in variables:
            res.obs[v.id] = {}
            for loc in locations:
                xs = per_loc[loc.iso3][v.id]
                if xs:
                    res.obs[v.id][loc.iso3] = Obs(
                        value=round(sum(xs) / len(xs), 4), period=res.period,
                        extra={"n_points": len(xs), "min": round(min(xs), 4), "max": round(max(xs), 4)},
                    )
                else:
                    failed = any(e.startswith(loc.iso3 + " ") for e in res.errors)
                    res.obs[v.id][loc.iso3] = Obs(
                        None, status="error" if failed else "missing",
                        note="request failed" if failed else "no value returned for this point",
                    )
        return res
