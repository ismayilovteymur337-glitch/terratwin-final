import gzip, json
from starlette.testclient import TestClient
from app.main import app

def test_countries_gzip_and_portal():
    c = TestClient(app)
    r = c.get("/api/geo/countries", headers={"accept-encoding": "gzip"})
    assert r.status_code == 200 and r.json()["features"]
    r2 = c.get("/api/geo/countries", headers={"accept-encoding": "identity"})
    assert r2.json() == r.json()
    h = c.get("/api/health").json()
    assert "mars_url" in h
    page = c.get("/").text
    assert 'id="mars-open"' in page and "mars-portal.js" in page
    assert c.get("/mars-portal.js").status_code == 200
