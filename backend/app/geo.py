"""Country boundaries (Natural Earth admin-0), name matching and point sampling.

The MVP analyses at country resolution with a few sample points per country.
Sub-national boundaries are the next resolution step (see README).
"""
import json
import re
import threading
from dataclasses import dataclass, field

import requests

from . import config
from .http import USER_AGENT

_lock = threading.Lock()
_cache: dict | None = None

ALIASES = {
    "COD": ["DRC", "DR Congo", "Democratic Republic of the Congo", "Democratic Republic of Congo", "Congo-Kinshasa"],
    "COG": ["Republic of the Congo", "Republic of Congo", "Congo-Brazzaville"],
    "CIV": ["Ivory Coast", "Cote d'Ivoire", "Côte d'Ivoire"],
    "USA": ["USA", "United States", "United States of America", "US"],
    "GBR": ["UK", "United Kingdom", "Great Britain", "Britain"],
    "TZA": ["Tanzania"],
    "CZE": ["Czech Republic", "Czechia"],
    "SWZ": ["Eswatini", "Swaziland"],
    "KOR": ["South Korea"],
    "PRK": ["North Korea"],
    "RUS": ["Russia"],
    "ARE": ["UAE", "United Arab Emirates"],
    "SSD": ["South Sudan"],
    "CAF": ["Central African Republic", "CAR"],
    "GNQ": ["Equatorial Guinea"],
    "ESH": ["Western Sahara"],
    "BIH": ["Bosnia", "Bosnia and Herzegovina"],
    "DOM": ["Dominican Republic"],
    "TUR": ["Turkey", "Türkiye", "Turkiye"],
}

CONTINENTS = ["Africa", "Asia", "Europe", "North America", "South America", "Oceania"]


@dataclass
class Location:
    iso3: str
    name: str
    continent: str
    subregion: str
    label: tuple[float, float]  # (lat, lon)
    bbox: tuple[float, float, float, float]  # (min_lon, min_lat, max_lon, max_lat)
    geometry: dict = field(repr=False, default_factory=dict)
    names: list[str] = field(default_factory=list)


# ---------------------------------------------------------------- geometry

def _rings(geometry: dict):
    """Yield polygons as lists of rings ([outer, hole, ...])."""
    if geometry["type"] == "Polygon":
        yield geometry["coordinates"]
    elif geometry["type"] == "MultiPolygon":
        yield from geometry["coordinates"]


def _in_ring(lon: float, lat: float, ring: list) -> bool:
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        if (yi > lat) != (yj > lat) and lon < (xj - xi) * (lat - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def contains(geometry: dict, lon: float, lat: float) -> bool:
    for poly in _rings(geometry):
        if _in_ring(lon, lat, poly[0]) and not any(_in_ring(lon, lat, h) for h in poly[1:]):
            return True
    return False


def _bbox(geometry: dict) -> tuple[float, float, float, float]:
    xs, ys = [], []
    for poly in _rings(geometry):
        for x, y, *_ in poly[0]:
            xs.append(x)
            ys.append(y)
    return (min(xs), min(ys), max(xs), max(ys))


def _largest_polygon_bbox(geometry: dict) -> tuple[float, float, float, float]:
    """bbox of the largest part, so overseas territories do not stretch sampling."""
    best, best_area = None, -1.0
    for poly in _rings(geometry):
        xs = [p[0] for p in poly[0]]
        ys = [p[1] for p in poly[0]]
        area = (max(xs) - min(xs)) * (max(ys) - min(ys))
        if area > best_area:
            best, best_area = (min(xs), min(ys), max(xs), max(ys)), area
    return best  # type: ignore[return-value]


def sample_points(loc: Location, n: int) -> list[tuple[float, float]]:
    """Label point plus up to n-1 interior points spread over the main landmass."""
    pts = [loc.label]
    if n <= 1:
        return pts
    x0, y0, x1, y1 = _largest_polygon_bbox(loc.geometry)
    grid = 8
    inside = []
    for i in range(grid):
        for j in range(grid):
            lon = x0 + (x1 - x0) * (i + 0.5) / grid
            lat = y0 + (y1 - y0) * (j + 0.5) / grid
            if contains(loc.geometry, lon, lat):
                inside.append((round(lat, 2), round(lon, 2)))
    # greedily pick the points farthest from those already chosen
    while len(pts) < n and inside:
        far = max(inside, key=lambda p: min((p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 for q in pts))
        if min((far[0] - q[0]) ** 2 + (far[1] - q[1]) ** 2 for q in pts) < 0.25:
            break
        pts.append(far)
        inside.remove(far)
    return pts


def grid_in_bbox(bbox: list[float], n: int = 3) -> list[tuple[float, float]]:
    x0, y0, x1, y1 = bbox
    return [
        (round(y0 + (y1 - y0) * (j + 0.5) / n, 2), round(x0 + (x1 - x0) * (i + 0.5) / n, 2))
        for i in range(n)
        for j in range(n)
    ]


# ---------------------------------------------------------------- loading

def _round_coords(c):
    if isinstance(c[0], (int, float)):
        return [round(c[0], 3), round(c[1], 3)]
    return [_round_coords(x) for x in c]


def _slim(raw: dict) -> dict:
    feats = []
    for f in raw["features"]:
        p = f.get("properties", {})
        g = f.get("geometry")
        if not g:
            continue
        iso = p.get("ISO_A3_EH") or p.get("ISO_A3") or ""
        if not re.fullmatch(r"[A-Z]{3}", str(iso)):
            iso = p.get("ADM0_A3") or p.get("iso3") or ""
        if not iso or p.get("NAME") == "Antarctica":
            continue
        geom = {"type": g["type"], "coordinates": _round_coords(g["coordinates"])}
        bb = _bbox(geom)
        lx, ly = p.get("LABEL_X"), p.get("LABEL_Y")
        if lx is None or ly is None:
            lb = _largest_polygon_bbox(geom)
            lx, ly = (lb[0] + lb[2]) / 2, (lb[1] + lb[3]) / 2
        feats.append({
            "type": "Feature",
            "id": iso,
            "properties": {
                "iso3": iso,
                "name": p.get("NAME") or p.get("name") or iso,
                "name_long": p.get("NAME_LONG") or p.get("NAME") or iso,
                "continent": p.get("CONTINENT") or "",
                "subregion": p.get("SUBREGION") or "",
                "label_x": round(float(lx), 3),
                "label_y": round(float(ly), 3),
                "bbox": [round(v, 3) for v in bb],
            },
            "geometry": geom,
        })
    return {
        "type": "FeatureCollection",
        "attribution": "Made with Natural Earth (public domain)",
        "features": feats,
    }


def feature_collection() -> dict:
    """Slim FeatureCollection served to the map. Downloaded once, then cached on disk."""
    global _cache
    with _lock:
        if _cache is not None:
            return _cache
        slim_path = config.DATA_DIR / "countries.slim.json"
        if config.COUNTRIES_FILE:
            _cache = _slim(json.loads(open(config.COUNTRIES_FILE, encoding="utf-8").read()))
        elif slim_path.exists():
            _cache = json.loads(slim_path.read_text(encoding="utf-8"))
        else:
            r = requests.get(config.COUNTRIES_URL, timeout=120, headers={"User-Agent": USER_AGENT})
            r.raise_for_status()
            _cache = _slim(r.json())
            slim_path.write_text(json.dumps(_cache), encoding="utf-8")
        return _cache


def reset_cache() -> None:
    global _cache, _index
    _cache = None
    _index = None


_index: dict[str, Location] | None = None


def locations() -> dict[str, Location]:
    global _index
    if _index is None:
        idx = {}
        for f in feature_collection()["features"]:
            p = f["properties"]
            names = {p["name"], p["name_long"], *ALIASES.get(p["iso3"], [])}
            idx[p["iso3"]] = Location(
                iso3=p["iso3"], name=p["name_long"] if len(p["name_long"]) < 28 else p["name"],
                continent=p["continent"], subregion=p["subregion"],
                label=(p["label_y"], p["label_x"]), bbox=tuple(p["bbox"]),
                geometry=f["geometry"], names=sorted(names, key=len, reverse=True),
            )
        _index = idx
    return _index


# ---------------------------------------------------------------- text matching

def find_countries(text: str) -> list[str]:
    """ISO3 codes of countries named in free text, in order of appearance."""
    cands = []
    for loc in locations().values():
        for n in loc.names:
            cands.append((n, loc.iso3))
    cands.sort(key=lambda c: len(c[0]), reverse=True)
    taken: list[tuple[int, int]] = []
    hits: list[tuple[int, str]] = []
    for name, iso in cands:
        flags = 0 if name.isupper() and len(name) <= 3 else re.IGNORECASE
        for m in re.finditer(r"(?<![\w-])" + re.escape(name) + r"(?![\w-])", text, flags):
            if any(m.start() < e and m.end() > s for s, e in taken):
                continue
            taken.append((m.start(), m.end()))
            hits.append((m.start(), iso))
    out = []
    for _, iso in sorted(hits):
        if iso not in out:
            out.append(iso)
    return out


def find_region(text: str) -> dict | None:
    """Detect a continent or Natural Earth subregion mentioned in text."""
    t = text.lower()
    subs = {loc.subregion for loc in locations().values() if loc.subregion}
    for s in sorted(subs, key=len, reverse=True):
        variants = {s.lower(), s.lower().replace("ern ", " "), s.lower().replace("-eastern", "east").replace("south-east", "southeast")}
        if any(re.search(r"\b" + re.escape(v) + r"\b", t) for v in variants):
            return {"subregion": s}
    for c in sorted(CONTINENTS, key=len, reverse=True):
        if re.search(r"\b" + c.lower() + r"n?\b", t):
            return {"continent": c}
    if re.search(r"\b(world|global|globally|worldwide|earth|anywhere)\b", t):
        return {"world": True}
    return None


def resolve_scope(scope: dict) -> tuple[list[Location], str]:
    """Scope dict -> candidate locations and a human label."""
    locs = locations()
    if scope.get("countries"):
        chosen = []
        for c in scope["countries"]:
            c = str(c)
            if c.upper() in locs:
                chosen.append(locs[c.upper()])
            else:
                found = find_countries(c)
                if found:
                    chosen.append(locs[found[0]])
        return chosen, ", ".join(l.name for l in chosen)
    if scope.get("subregion"):
        s = scope["subregion"].lower()
        chosen = [l for l in locs.values() if l.subregion.lower() == s]
        if chosen:
            return chosen, chosen[0].subregion
    if scope.get("continent"):
        c = scope["continent"].lower()
        chosen = [l for l in locs.values() if l.continent.lower() == c]
        if chosen:
            return chosen, chosen[0].continent
    return list(locs.values()), "World"
