"""Offline fixtures: tiny rectangular 'countries' and fake API payloads shaped
like the real NASA POWER / World Bank / SoilGrids responses. TEST DATA ONLY."""
import json, os, tempfile

COUNTRIES = {  # iso3: (name, continent, subregion, lon0, lat0, lon1, lat1)
    "AGO": ("Angola", "Africa", "Middle Africa", 12, -18, 24, -5),
    "NAM": ("Namibia", "Africa", "Southern Africa", 12, -28, 21, -18),
    "COD": ("Dem. Rep. Congo", "Africa", "Middle Africa", 24, -12, 31, 5),
    "EGY": ("Egypt", "Africa", "Northern Africa", 25, 22, 35, 31),
    "NGA": ("Nigeria", "Africa", "Western Africa", 3, 4, 14, 13),
    "BRA": ("Brazil", "South America", "South America", -70, -30, -40, 0),
}


def write_geojson() -> str:
    feats = []
    for iso, (name, cont, sub, x0, y0, x1, y1) in COUNTRIES.items():
        feats.append({"type": "Feature", "properties": {
            "ISO_A3_EH": iso, "ADM0_A3": iso, "NAME": name,
            "NAME_LONG": "Democratic Republic of the Congo" if iso == "COD" else name,
            "CONTINENT": cont, "SUBREGION": sub, "LABEL_X": (x0 + x1) / 2, "LABEL_Y": (y0 + y1) / 2},
            "geometry": {"type": "Polygon", "coordinates": [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]]}})
    path = os.path.join(tempfile.mkdtemp(), "countries.geojson")
    json.dump({"type": "FeatureCollection", "features": feats}, open(path, "w"))
    return path


WB = {  # indicator -> iso3 -> value (EGY deliberately missing price level)
    "PA.NUS.PPPC.RF": {"AGO": 0.45, "NAM": 0.50, "COD": 0.48, "NGA": 0.30, "BRA": 0.52, "WLD": None},
    "NY.GNP.PCAP.CD": {"AGO": 2100, "NAM": 4800, "COD": 650, "EGY": 3900, "NGA": 1900, "BRA": 9100, "WLD": 13000},
    "EG.ELC.ACCS.ZS": {"AGO": 48, "NAM": 56, "COD": 21, "EGY": 100, "NGA": 60, "BRA": 100, "WLD": 91},
    "LP.LPI.INFR.XQ": {"AGO": 2.1, "NAM": 2.8, "COD": 2.3, "EGY": 3.0, "NGA": 2.4, "BRA": 3.2},
    "RQ.EST": {"AGO": -0.7, "NAM": 0.1, "COD": -1.3, "EGY": -0.6, "NGA": -0.9, "BRA": -0.2},
    "PV.EST": {"AGO": -0.5, "NAM": 0.6, "COD": -1.9, "EGY": -1.0, "NGA": -1.8, "BRA": -0.4},
}


def _fake(code: str, iso: str, lo: float, hi: float) -> float:
    """Deterministic made-up value (TEST DATA)."""
    h = sum(ord(ch) * (i + 7) for i, ch in enumerate(code + iso)) % 1000
    return round(lo + (hi - lo) * h / 999, 3)


def _fill_wb():
    from app.connectors import registry
    for v in registry.CATALOG.values():
        if v.connector == "world_bank" and v.param not in WB:
            WB[v.param] = {iso: _fake(v.param, iso, 1, 90) for iso in list(COUNTRIES) + ["WLD"]}
    WB["IS.SHP.GCNW.XQ"].pop("COD", None)       # a second deliberate gap
    WB["IC.ELC.OUTG"] = {}                      # an indicator with no data at all


ILO_CSV = "ref_area,source,indicator,sex,classif1,classif2,time,obs_value,obs_status\n" + "".join(
    f"{iso},X,EAR_4MTH_SEX_ECO_CUR_NB_A,SEX_T,{cls},CUR_TYPE_USD,{yr},{val},\n"
    for iso, tot, con in (("AGO", 310, 280), ("NAM", 520, 430), ("EGY", 240, 210), ("BRA", 610, 480))   # COD, NGA: not published
    for cls, yr, val in (("ECO_AGGREGATE_TOTAL", 2019, tot * 0.9), ("ECO_AGGREGATE_TOTAL", 2022, tot), ("ECO_AGGREGATE_CON", 2022, con),
                         ("ECO_AGGREGATE_AGR", 2022, 99)))


def fake_get_text(url, params=None, **kw):
    if "ilo.org" in url:
        return ILO_CSV, 1.0e9
    raise RuntimeError("unexpected url " + url)


def fake_get_json(url, params=None, **kw):
    params = params or {}
    if "power.larc.nasa.gov" in url:
        lat = float(params["latitude"])
        out = {}
        for p in params["parameters"].split(","):
            base = {"ALLSKY_SFC_SW_DWN": 4.0 + abs(lat) / 10, "ALLSKY_SFC_SW_DNI": 3.5 + abs(lat) / 8, "CLOUD_AMT": 70 - abs(lat) * 1.5,
                    "T2M": 28 - abs(lat) / 3, "PRECTOTCORR": 4 - abs(lat) / 10, "GWETROOT": 0.5, "RH2M": 60,
                    "ALLSKY_KT": 0.45 + abs(lat) / 100, "CLRSKY_SFC_SW_DWN": 6.5, "T2M_MAX": 34 - abs(lat) / 4, "WS10M": 3.2}.get(p, -999)
            months = {m: base * (0.9 if i < 6 else 1.1) for i, m in enumerate(
                ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"])}
            out[p] = {**months, "ANN": base}
        return {"header": {"title": "TEST climatology"}, "properties": {"parameter": out},
                "parameters": {p: {"units": "test-units", "longname": p} for p in out}}, 1.0e9
    if "worldbank" in url:
        code = url.rsplit("/", 1)[-1]
        if len(WB) < 20:
            _fill_wb()
        if code not in WB:
            return [{"message": [{"id": "120", "value": "Invalid value"}]}], 1.0e9
        if not WB[code]:
            return [{"page": 0, "pages": 0}, None], 1.0e9
        rows = [{"countryiso3code": iso, "date": "2023", "value": v, "indicator": {"id": code, "value": code}} for iso, v in WB[code].items()]
        return [{"page": 1, "pages": 1, "lastupdated": "2026-01-01"}, rows], 1.0e9
    if "isric" in url:
        return {"properties": {"layers": [
            {"name": "phh2o", "unit_measure": {"d_factor": 10, "target_units": "pH"}, "depths": [{"label": "0-5cm", "values": {"mean": 63}}]},
            {"name": "clay", "unit_measure": {"d_factor": 10, "target_units": "%"}, "depths": [{"label": "0-5cm", "values": {"mean": 180}}]},
            {"name": "soc", "unit_measure": {"d_factor": 10, "target_units": "g/kg"}, "depths": [{"label": "0-5cm", "values": {"mean": None}}]},
        ]}}, 1.0e9
    raise RuntimeError("unexpected url " + url)
