"""The API key must stay on the server, and model choice must work with one key."""
import json

import pytest
from starlette.testclient import TestClient

from app import agent, config
from app.agent import llm
from app.main import app

KEY = "sk-ant-api03-TESTKEY1234567890abcdefXYZ"
client = TestClient(app)


@pytest.fixture(autouse=True)
def reset(monkeypatch):
    monkeypatch.setattr(config, "ANTHROPIC_API_KEY", "")
    monkeypatch.setattr(config, "KEY_SOURCE", None)
    monkeypatch.setattr(config, "AGENT_MODEL", "claude-sonnet-5-5")
    monkeypatch.setattr(llm, "verify_key", lambda: (True, "Key accepted."))
    monkeypatch.setattr(config, "_write_env", lambda *a, **k: None)


def test_key_is_never_returned():
    r = client.post("/api/settings", json={"api_key": KEY})
    assert r.status_code == 200 and r.json()["has_key"] and r.json()["planner"] == "llm"
    for path in ("/api/settings", "/api/health", "/api/models", "/api/catalog"):
        assert KEY not in client.get(path).text and "TESTKEY" not in client.get(path).text
    assert KEY not in r.text
    assert r.json()["key_hint"] == "…" + KEY[-4:]


def test_errors_are_redacted(monkeypatch):
    config.set_api_key(KEY)
    class R:  # an upstream error that echoes the key back
        status_code = 401
        text = f"invalid x-api-key {KEY}"
        def json(self): return {"error": {"message": f"bad key {KEY}"}}
    monkeypatch.setattr(llm.requests, "post", lambda *a, **k: R())
    with pytest.raises(RuntimeError) as e:
        llm._call([], "claude-sonnet-5-5")
    assert KEY not in str(e.value) and "[hidden key]" in str(e.value)
    ev = []
    agent.run("sec", "Find the best regions in Africa for building solar farms.", None, ev.append)
    assert KEY not in json.dumps(ev)                      # fell back to rules, key not shown in the step text


def test_rejected_key_is_not_kept(monkeypatch):
    monkeypatch.setattr(llm, "verify_key", lambda: (False, "Anthropic rejected this key."))
    r = client.post("/api/settings", json={"api_key": KEY})
    assert r.status_code == 400 and not config.ANTHROPIC_API_KEY


def test_remote_hosts_cannot_change_settings():
    remote = TestClient(app, client=("203.0.113.9", 5000))
    assert remote.post("/api/settings", json={"api_key": KEY}).status_code == 403
    assert not config.ANTHROPIC_API_KEY


def test_bad_inputs():
    assert client.post("/api/settings", json={"api_key": "short"}).status_code == 400
    assert client.post("/api/settings", json={"model": "bad model!"}).status_code == 400


def test_model_selection(monkeypatch):
    config.set_api_key(KEY)
    seen = []
    def fake_post(url, **k):
        seen.append(k["json"]["model"])
        class R:
            status_code = 200
            def json(self): return {"content": [{"type": "text", "text": "ok"}], "stop_reason": "end_turn"}
        return R()
    monkeypatch.setattr(llm.requests, "post", fake_post)
    ev = []
    agent.run("m1", "hello", None, ev.append, model="claude-opus-5-5")
    assert seen == ["claude-opus-5-5"] and ev[-1]["model"] == "claude-opus-5-5"
    client.post("/api/settings", json={"model": "claude-haiku-5-5"})
    agent.run("m2", "hello", None, ev.append)
    assert seen[-1] == "claude-haiku-5-5"


def test_models_list_live_and_fallback(monkeypatch):
    assert client.get("/api/models").json()["live"] is False
    config.set_api_key(KEY)
    class R:
        status_code = 200
        def json(self): return {"data": [{"id": "claude-opus-5-5", "display_name": "Claude Opus 5.5"}, {"id": "other-x"}]}
    monkeypatch.setattr(llm.requests, "get", lambda *a, **k: R())
    llm._models_cache["data"] = None
    d = client.get("/api/models?refresh=1").json()
    assert d["live"] and [m["id"] for m in d["models"]] == ["claude-opus-5-5"]
