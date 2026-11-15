import os, tempfile
from tests import fixtures

os.environ["MERIDIAN_DATA_DIR"] = tempfile.mkdtemp()
os.environ["MERIDIAN_COUNTRIES_FILE"] = fixtures.write_geojson()
os.environ["ANTHROPIC_API_KEY"] = ""

import pytest
from app import http


@pytest.fixture(autouse=True)
def offline(monkeypatch):
    monkeypatch.setattr(http, "get_json", fixtures.fake_get_json)
    monkeypatch.setattr(http, "get_text", fixtures.fake_get_text)
    monkeypatch.setattr("time.sleep", lambda s: None)
