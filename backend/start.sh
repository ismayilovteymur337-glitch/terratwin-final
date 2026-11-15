#!/usr/bin/env bash
cd "$(dirname "$0")"
[ -d .venv ] || python3 -m venv .venv
source .venv/bin/activate
pip install -q -r requirements.txt
[ -f static/vendor/leaflet.js ] || python -m app.vendor
(sleep 2; command -v xdg-open >/dev/null && xdg-open http://localhost:8001 || open http://localhost:8001) >/dev/null 2>&1 &
uvicorn app.main:app --port 8001
