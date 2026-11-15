"""Download Leaflet (the open-source map library) into static/vendor so the page does not
depend on a CDN at runtime:

    python -m app.vendor

Leaflet is BSD-2-Clause licensed; the files are served from this app afterwards.
Without this step the page falls back to unpkg.com.
"""
from pathlib import Path

import requests

from .http import USER_AGENT

VERSION = "1.9.4"
BASE = f"https://unpkg.com/leaflet@{VERSION}/dist/"
FILES = ["leaflet.js", "leaflet.css", "images/layers.png", "images/layers-2x.png",
         "images/marker-icon.png", "images/marker-icon-2x.png", "images/marker-shadow.png"]
DEST = Path(__file__).resolve().parent.parent / "static" / "vendor"


def main() -> None:
    for name in FILES:
        print(f"{name} …", end=" ", flush=True)
        try:
            r = requests.get(BASE + name, timeout=120, headers={"User-Agent": USER_AGENT})
            r.raise_for_status()
            target = DEST / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(r.content)
            print(f"OK — {len(r.content) / 1024:.0f} KB")
        except Exception as e:  # noqa: BLE001
            print(f"FAILED: {e}")
            return
    (DEST / "README.txt").write_text(
        f"Leaflet {VERSION} — BSD-2-Clause — https://leafletjs.com\n"
        "Downloaded by `python -m app.vendor`. Delete this folder to go back to the CDN.\n", encoding="utf-8")
    print(f"Saved to {DEST}. Reload the page; the map library now loads from this app.")
    print("Map tiles still come from the network (OpenStreetMap, OpenTopoMap, EOX).")


if __name__ == "__main__":
    main()
