"""HTTP API (Starlette — the ASGI toolkit FastAPI is built on).

Run:  uvicorn app.main:app --reload --port 8000
"""
import json
import queue
import threading

from starlette.applications import Starlette
from starlette.middleware import Middleware
from starlette.middleware.cors import CORSMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response, StreamingResponse
from pathlib import Path

from starlette.routing import Mount, Route
from starlette.staticfiles import StaticFiles

from . import agent, config, engine, geo
from .connectors import registry


def _settings_public() -> dict:
    """What the browser may know about the LLM setup. The key itself is never included."""
    return {"planner": agent.planner_mode(), "has_key": bool(config.ANTHROPIC_API_KEY), "key_hint": config.key_hint(),
            "key_source": config.KEY_SOURCE, "model": config.AGENT_MODEL}


async def health(request: Request):
    s = _settings_public()
    return JSONResponse({"status": "ok", "planner": s["planner"], "model": config.AGENT_MODEL if s["has_key"] else None,
                         "has_key": s["has_key"], "connectors": registry.connectors_public(),
                         "mars_url": config.MARS_URL or None})


def _is_local(request: Request) -> bool:
    return (request.client.host if request.client else "") in ("127.0.0.1", "::1", "localhost", "testclient")


async def settings_get(request: Request):
    return JSONResponse(_settings_public(), headers={"Cache-Control": "no-store"})


async def settings_post(request: Request):
    """Set the key and/or default model. Only accepted from the machine the server runs on."""
    if not _is_local(request):
        return JSONResponse({"error": "Settings can only be changed from the computer that runs Meridian."}, status_code=403)
    body = await request.json()
    out: dict = {}
    try:
        if "api_key" in body:
            if not str(body["api_key"]).strip():
                config.set_api_key("", persist=bool(body.get("remember")))
                out["message"] = "Key removed. The rule-based planner is active."
            else:
                config.set_api_key(str(body["api_key"]), persist=bool(body.get("remember")))
                ok, msg = agent.llm.verify_key()
                if ok is False:
                    config.set_api_key("", persist=False)
                    return JSONResponse({"error": msg, **_settings_public()}, status_code=400)
                out["message"] = msg
        if body.get("model"):
            config.set_model(str(body["model"]).strip(), persist=bool(body.get("remember")))
    except ValueError as e:
        return JSONResponse({"error": str(e)}, status_code=400)
    return JSONResponse({**_settings_public(), **out}, headers={"Cache-Control": "no-store"})


async def models(request: Request):
    return JSONResponse(agent.llm.list_models(force=request.query_params.get("refresh") == "1"), headers={"Cache-Control": "no-store"})


_COUNTRIES_CACHE: dict = {}


def _countries_payload() -> tuple[bytes, bytes]:
    """Serialise the boundaries once and keep a gzip copy: the GeoJSON is several MB as plain JSON
    and a fraction of that compressed, so the map appears much sooner, especially on slow links."""
    if "raw" not in _COUNTRIES_CACHE:
        import gzip
        raw = json.dumps(geo.feature_collection(), separators=(",", ":")).encode("utf-8")
        _COUNTRIES_CACHE["raw"] = raw
        _COUNTRIES_CACHE["gz"] = gzip.compress(raw, compresslevel=6)
    return _COUNTRIES_CACHE["raw"], _COUNTRIES_CACHE["gz"]


def countries(request: Request):
    try:
        raw, gz = _countries_payload()
        headers = {"Cache-Control": "public, max-age=86400", "Vary": "Accept-Encoding"}
        if "gzip" in request.headers.get("accept-encoding", "").lower():
            return Response(gz, media_type="application/json", headers={**headers, "Content-Encoding": "gzip"})
        return Response(raw, media_type="application/json", headers=headers)
    except Exception as e:  # noqa: BLE001
        return JSONResponse({"error": f"Could not load country boundaries: {e}"}, status_code=502)


async def catalog(request: Request):
    return JSONResponse({"connectors": registry.connectors_public(), "variables": registry.catalog_public()})


async def chat(request: Request):
    body = await request.json()
    message = str(body.get("message", "")).strip()
    session_id = str(body.get("session_id") or "default")
    selection = body.get("selection")
    model = str(body.get("model") or "").strip() or None
    if model and not config.MODEL_ID_RE.match(model):
        return JSONResponse({"error": "Invalid model id."}, status_code=400)
    if not message:
        return JSONResponse({"error": "Empty message"}, status_code=400)
    q: queue.Queue = queue.Queue()

    def worker():
        try:
            agent.run(session_id, message, selection, q.put, model)
        except Exception as e:  # noqa: BLE001
            q.put({"type": "error", "message": config.redact(e)})
        finally:
            q.put({"type": "done"})

    threading.Thread(target=worker, daemon=True).start()

    def stream():
        while True:
            try:
                ev = q.get(timeout=15)
            except queue.Empty:
                yield ": keep-alive\n\n"
                continue
            yield f"data: {json.dumps(ev, default=str)}\n\n"
            if ev.get("type") == "done":
                break

    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


def _analysis(request: Request):
    return engine.STORE.get(request.path_params["analysis_id"])


def _guard(fn):
    def wrapped(request: Request, body: dict):
        a = _analysis(request)
        if not a:
            return JSONResponse({"error": "Analysis not found (the server may have restarted)."}, status_code=404)
        try:
            return JSONResponse(fn(a, body))
        except Exception as e:  # noqa: BLE001
            return JSONResponse({"error": str(e)}, status_code=400)
    return wrapped


async def reweight(request: Request):
    body = await request.json()
    return _guard(lambda a, b: engine.public(engine.set_weights(a, b.get("weights") or {})))(request, body)


async def benchmark(request: Request):
    body = await request.json()
    return _guard(lambda a, b: engine.public(engine.set_benchmark(a, b.get("type", "candidates_mean"), b.get("iso3"))))(request, body)


async def compare(request: Request):
    body = await request.json()
    return _guard(lambda a, b: engine.compare(a, b.get("iso3") or [], b.get("variables")))(request, body)


async def export_csv(request: Request):
    a = _analysis(request)
    if not a:
        return JSONResponse({"error": "Analysis not found"}, status_code=404)
    return Response(engine.to_csv(a), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="meridian-{a["id"]}.csv"'})


app = Starlette(
    routes=[
        Route("/api/health", health),
        Route("/api/geo/countries", countries),
        Route("/api/catalog", catalog),
        Route("/api/settings", settings_get),
        Route("/api/settings", settings_post, methods=["POST"]),
        Route("/api/models", models),
        Route("/api/chat", chat, methods=["POST"]),
        Route("/api/analysis/{analysis_id}/reweight", reweight, methods=["POST"]),
        Route("/api/analysis/{analysis_id}/benchmark", benchmark, methods=["POST"]),
        Route("/api/analysis/{analysis_id}/compare", compare, methods=["POST"]),
        Route("/api/analysis/{analysis_id}/export.csv", export_csv),
        Mount("/", app=StaticFiles(directory=Path(__file__).resolve().parent.parent / "static", html=True), name="web"),
    ],
    middleware=[
        Middleware(CORSMiddleware, allow_origins=config.ALLOWED_ORIGINS, allow_methods=["*"], allow_headers=["*"]),
    ],
)
