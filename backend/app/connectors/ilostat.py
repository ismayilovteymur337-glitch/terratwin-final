"""ILOSTAT (International Labour Organization) — mean monthly earnings of employees.

Endpoint: https://rplumber.ilo.org/data/indicator/  (CSV, no key required)

EXPERIMENTAL: this connector was written against the documented ILOSTAT column
layout (ref_area, sex, classif1, classif2, time, obs_value) but could not be
exercised against the live service when it was built. Run `python -m app.check`.
If the service answers differently, every value is reported as missing; nothing
is estimated in its place.

Earnings data is published by national statistical offices on their own
schedule, so many countries have no recent value. Those stay missing.
"""
import csv
import io

from .. import http
from ..geo import Location
from .base import Connector, FetchResult, Obs, Progress, VariableDef

API = "https://rplumber.ilo.org/data/indicator/"
INDICATOR = "EAR_4MTH_SEX_ECO_CUR_NB_A"     # mean nominal monthly earnings of employees by sex and economic activity
TOTAL_CODES = ("ECO_AGGREGATE_TOTAL", "ECO_SECTOR_TOTAL", "ECO_ISIC4_TOTAL", "ECO_ISIC3_TOTAL")
MIN_YEAR = 2012


class IloStat(Connector):
    id = "ilostat"
    name = "ILOSTAT — earnings of employees"
    url = "https://ilostat.ilo.org/"
    license = "ILO open data (CC BY 4.0)"
    notes = ("Mean nominal monthly earnings of employees, converted to US$ by the ILO. Reported by national surveys; "
             "the reference year differs by country and coverage is incomplete. Experimental connector.")

    def _rows(self):
        text, ts = http.get_text(API, {"id": INDICATOR, "sex": "SEX_T", "classif2": "CUR_TYPE_USD",
                                       "timefrom": MIN_YEAR, "type": "code", "format": ".csv"}, ttl_days=30)
        rows = list(csv.DictReader(io.StringIO(text)))
        if not rows or "ref_area" not in rows[0] or "obs_value" not in rows[0]:
            raise RuntimeError("unexpected response layout from ILOSTAT")
        return rows, ts

    def fetch(self, variables: list[VariableDef], locations: list[Location], progress: Progress, points=None) -> FetchResult:
        res = FetchResult()
        progress("ILOSTAT: requesting mean monthly earnings (US$)")
        try:
            rows, ts = self._rows()
        except Exception as e:  # noqa: BLE001
            res.errors.append(str(e))
            for v in variables:
                res.obs[v.id] = {l.iso3: Obs(None, status="error", note=f"ILOSTAT request failed: {e}") for l in locations}
            return res
        res.retrieved_at = ts
        for v in variables:
            wanted = tuple(v.extra.get("classif1") or TOTAL_CODES)
            best: dict[str, tuple[int, float]] = {}
            for r in rows:
                cls = [str(r.get(k) or "") for k in ("classif1", "classif2")]
                if (r.get("sex") or "SEX_T") != "SEX_T" or "CUR_TYPE_USD" not in cls or not any(c in wanted for c in cls):
                    continue
                try:
                    year, val = int(str(r.get("time"))[:4]), float(r["obs_value"])
                except (TypeError, ValueError):
                    continue
                iso = str(r.get("ref_area") or "")
                if year >= MIN_YEAR and val > 0 and (iso not in best or year > best[iso][0]):
                    best[iso] = (year, val)
            res.obs[v.id] = {}
            for loc in locations:
                if loc.iso3 in best:
                    res.obs[v.id][loc.iso3] = Obs(round(best[loc.iso3][1], 1), period=str(best[loc.iso3][0]))
                else:
                    res.obs[v.id][loc.iso3] = Obs(None, status="missing", note=f"no earnings figure published to ILOSTAT since {MIN_YEAR}")
        return res
