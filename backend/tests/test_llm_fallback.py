"""If the language model times out after the analysis is finished, the answer is built from the computed facts."""
import requests
from app import agent, config
from app.agent import llm


def _run(session, msg, events):
    agent.run(session, msg, None, events.append)


def test_timeout_after_analysis_keeps_analysis_and_explains(monkeypatch):
    ev: list = []
    _run("s-timeout", "Find the best regions in Africa for building solar farms.", ev)   # rule-based, no key
    assert any(e["type"] == "analysis" for e in ev)

    monkeypatch.setattr(config, "ANTHROPIC_API_KEY", "sk-test-not-real")
    monkeypatch.setattr(llm, "handle", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("the Anthropic API did not answer in time (tried 3 times)")))
    ev2: list = []
    _run("s-timeout", "Why is the first one best?", ev2)
    msg = [e for e in ev2 if e["type"] == "message"][0]
    assert "Strengths" in msg["text"] and "Weaknesses" in msg["text"]
    assert not any(e["type"] == "analysis" for e in ev2)        # nothing was re-run


def test_call_retries_timeouts_then_succeeds(monkeypatch):
    monkeypatch.setattr(config, "ANTHROPIC_API_KEY", "sk-test-not-real")
    monkeypatch.setattr("time.sleep", lambda s: None)
    calls = {"n": 0}

    class R:
        status_code = 200
        headers = {}
        def json(self): return {"content": [{"type": "text", "text": "ok"}], "stop_reason": "end_turn"}

    def fake_post(*a, **k):
        calls["n"] += 1
        assert k["timeout"] == llm.REQUEST_TIMEOUT
        if calls["n"] < 3:
            raise requests.Timeout()
        return R()
    monkeypatch.setattr(llm.requests, "post", fake_post)
    assert llm._call([{"role": "user", "content": "hi"}], "claude-sonnet-5-5")["content"][0]["text"] == "ok"
    assert calls["n"] == 3
