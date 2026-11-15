"""Runtime configuration. Reads backend/.env if present (no extra dependency)."""
import os
import re
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent


def _load_env_file() -> None:
    env = BASE_DIR / ".env"
    if not env.exists():
        return
    for line in env.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


_load_env_file()

DATA_DIR = Path(os.getenv("MERIDIAN_DATA_DIR", str(BASE_DIR / "data")))
DATA_DIR.mkdir(parents=True, exist_ok=True)

# The key lives only on the server. It is never sent to the browser, never logged and is
# removed from every error text (see redact()). It comes from backend/.env or, if the user
# types it into the Settings panel, from memory for the lifetime of the process.
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "").strip()
AGENT_MODEL = os.getenv("AGENT_MODEL", "claude-sonnet-5-5")
KEY_SOURCE = "env" if ANTHROPIC_API_KEY else None

MODEL_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{2,79}$")
KEY_RE = re.compile(r"^[A-Za-z0-9_\-]{20,300}$")
# Shown when the live list cannot be fetched. Any other id can still be typed in.
KNOWN_MODELS = [
    ("claude-fable-5-2", "Claude Fable 5.2"), ("claude-opus-5-5", "Claude Opus 5.5"),
    ("claude-sonnet-5-5", "Claude Sonnet 5.5"), ("claude-haiku-5-5", "Claude Haiku 5.5"),
]


def key_hint() -> str | None:
    k = ANTHROPIC_API_KEY
    return None if not k else ("…" + k[-4:] if len(k) > 8 else "…")


def redact(text: object) -> str:
    """Remove the API key (and anything shaped like one) from text before it can be shown or logged."""
    s = str(text)
    if ANTHROPIC_API_KEY:
        s = s.replace(ANTHROPIC_API_KEY, "[hidden key]")
    return re.sub(r"sk-ant-[A-Za-z0-9_\-]{8,}", "[hidden key]", s)


def set_api_key(key: str, persist: bool = False) -> None:
    global ANTHROPIC_API_KEY, KEY_SOURCE
    key = key.strip()
    if key and not KEY_RE.match(key):
        raise ValueError("That does not look like an API key (unexpected characters or length).")
    ANTHROPIC_API_KEY, KEY_SOURCE = key, ("session" if key else None)
    if persist:
        _write_env("ANTHROPIC_API_KEY", key)
        if key:
            KEY_SOURCE = "env"


def set_model(model: str, persist: bool = False) -> None:
    global AGENT_MODEL
    if not MODEL_ID_RE.match(model):
        raise ValueError("Invalid model id.")
    AGENT_MODEL = model
    if persist:
        _write_env("AGENT_MODEL", model)


def _write_env(name: str, value: str) -> None:
    """Update one line of backend/.env (created if missing; it is git-ignored)."""
    path = BASE_DIR / ".env"
    lines = path.read_text().splitlines() if path.exists() else []
    out, done = [], False
    for ln in lines:
        if ln.strip().startswith(name + "="):
            out.append(f"{name}={value}"); done = True
        else:
            out.append(ln)
    if not done:
        out.append(f"{name}={value}")
    path.write_text("\n".join(out) + "\n")
    try:
        path.chmod(0o600)
    except OSError:
        pass

POWER_SAMPLES_PER_COUNTRY = int(os.getenv("POWER_SAMPLES_PER_COUNTRY", "5"))
POWER_FULL_SAMPLING_MAX_COUNTRIES = int(os.getenv("POWER_FULL_SAMPLING_MAX_COUNTRIES", "60"))
SOIL_SHORTLIST = int(os.getenv("SOIL_SHORTLIST", "6"))

# Where the TerraTwin 3D Mars app runs. Empty = same host as Meridian, port 5173.
MARS_URL = os.getenv("MARS_URL", "").strip()

ALLOWED_ORIGINS = [o.strip() for o in os.getenv("ALLOWED_ORIGINS", "http://localhost:3000").split(",") if o.strip()]

COUNTRIES_URL = os.getenv(
    "MERIDIAN_COUNTRIES_URL",
    "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson",
)
# Point this at a local Natural Earth admin-0 GeoJSON to skip the download.
COUNTRIES_FILE = os.getenv("MERIDIAN_COUNTRIES_FILE", "")

MIN_CONFIDENCE_TO_RANK = 0.5
