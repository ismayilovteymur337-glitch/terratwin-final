"""Live connectivity check:  python -m app.check
Makes one small request to each public API and prints what came back."""
from . import geo
from .connectors import registry


def main() -> None:
    print("Country boundaries (Natural Earth) …", end=" ", flush=True)
    try:
        locs = geo.locations()
        print(f"OK — {len(locs)} countries")
    except Exception as e:  # noqa: BLE001
        print(f"FAILED: {e}")
        return
    sample = [locs[i] for i in ("AGO", "BRA") if i in locs] or list(locs.values())[:2]
    tests = {"nasa_power": ["power.ghi", "power.pv_yield", "power.clearness", "power.temp_max"], "world_bank": ["wb.gni_pc", "wb.regulatory_quality", "wb.grid_losses", "wb.lending_rate"],
             "ilostat": ["ilo.wage", "ilo.wage_construction"], "soilgrids": ["soil.ph"]}
    for cid, ids in tests.items():
        conn = registry.CONNECTORS[cid]
        print(f"{conn.name} …", end=" ", flush=True)
        try:
            res = conn.fetch([registry.resolve(i) for i in ids], sample[:1] if cid == "soilgrids" else sample, lambda s: None)
            cells = [f"{vid}[{iso}]={o.value} ({o.period or o.note})" for vid, by in res.obs.items() for iso, o in by.items() if iso != "WLD"]
            ok = any(o.value is not None for by in res.obs.values() for o in by.values())
            print(("OK — " if ok else "NO VALUES — ") + "; ".join(cells) + (f" | errors: {res.errors}" if res.errors else ""))
        except Exception as e:  # noqa: BLE001
            print(f"FAILED: {e}")


if __name__ == "__main__":
    main()
