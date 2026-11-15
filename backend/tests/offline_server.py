"""Run the API against offline TEST fixtures (six rectangular 'countries', fake values).
For UI development without internet only — nothing it serves is real data.

    python -m tests.offline_server
"""
import os, tempfile
from tests import fixtures

os.environ.setdefault("MERIDIAN_DATA_DIR", tempfile.mkdtemp())
os.environ["MERIDIAN_COUNTRIES_FILE"] = fixtures.write_geojson()

import uvicorn
from app import http
from app.main import app

http.get_json = fixtures.fake_get_json
http.get_text = fixtures.fake_get_text

if __name__ == "__main__":
    uvicorn.run(app, port=int(os.getenv("PORT", "8000")))
