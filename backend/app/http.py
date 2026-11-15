"""Cached JSON-over-HTTP helper shared by all connectors.

Responses are cached in SQLite so repeated analyses do not re-query public
APIs. Every cache entry keeps the time it was retrieved, which is surfaced in
the provenance panel.
"""
import json
import sqlite3
import threading
import time
from typing import Any

import requests

from . import config

_lock = threading.Lock()
_DB = config.DATA_DIR / "http_cache.sqlite"
USER_AGENT = "Meridian-Geospatial-Intelligence/0.1 (research prototype)"


def _conn() -> sqlite3.Connection:
    c = sqlite3.connect(_DB)
    c.execute("CREATE TABLE IF NOT EXISTS cache (key TEXT PRIMARY KEY, fetched_at REAL, body TEXT)")
    return c


def _key(url: str, params: dict | None) -> str:
    return url + "?" + json.dumps(params or {}, sort_keys=True)


def get_json(url: str, params: dict | None = None, ttl_days: float = 30, timeout: float = 40, retries: int = 2) -> tuple[Any, float]:
    """Return (json, retrieved_at_epoch). Raises on failure — callers turn
    failures into explicit 'missing' observations rather than filling gaps."""
    key = _key(url, params)
    with _lock:
        c = _conn()
        row = c.execute("SELECT fetched_at, body FROM cache WHERE key=?", (key,)).fetchone()
        c.close()
    if row and time.time() - row[0] < ttl_days * 86400:
        return json.loads(row[1]), row[0]

    last: Exception | None = None
    for attempt in range(retries + 1):
        try:
            t0 = time.time()
            r = requests.get(url, params=params, timeout=timeout, headers={"User-Agent": USER_AGENT})
            print(f"[http] {r.status_code} {time.time() - t0:5.1f}s {url.split('/')[2]} {url.rsplit('/', 1)[-1][:40]}", flush=True)
            if r.status_code == 429:
                raise RuntimeError("rate limited (HTTP 429)")
            r.raise_for_status()
            data = r.json()
            now = time.time()
            with _lock:
                c = _conn()
                c.execute("REPLACE INTO cache VALUES (?,?,?)", (key, now, json.dumps(data)))
                c.commit()
                c.close()
            return data, now
        except Exception as e:  # noqa: BLE001
            last = e
            print(f"[http] FAILED {url.split('/')[2]} {url.rsplit('/', 1)[-1][:40]}: {type(e).__name__}", flush=True)
            if attempt < retries:
                time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"{type(last).__name__}: {last}")


def get_text(url: str, params: dict | None = None, ttl_days: float = 30, timeout: float = 90, retries: int = 1) -> tuple[str, float]:
    """Same cache as get_json, for CSV/text endpoints."""
    key = "text:" + _key(url, params)
    with _lock:
        c = _conn()
        row = c.execute("SELECT fetched_at, body FROM cache WHERE key=?", (key,)).fetchone()
        c.close()
    if row and time.time() - row[0] < ttl_days * 86400:
        return row[1], row[0]
    last: Exception | None = None
    for attempt in range(retries + 1):
        try:
            r = requests.get(url, params=params, timeout=timeout, headers={"User-Agent": USER_AGENT})
            r.raise_for_status()
            now = time.time()
            with _lock:
                c = _conn()
                c.execute("REPLACE INTO cache VALUES (?,?,?)", (key, now, r.text))
                c.commit()
                c.close()
            return r.text, now
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"{type(last).__name__}: {last}")
