# Meridian — AI geospatial intelligence platform (MVP)

> Part of **TerraTwin × Meridian**: this is the Earth side. Start both apps with `start-all.cmd` in the parent
> folder; the **Mars 3D** button opens TerraTwin, and TerraTwin's **Back to Earth** button returns here.

Describe what you want to do somewhere on Earth. An agent decides which variables matter, retrieves them from
public data sources, scores and ranks locations, and draws the result on an interactive world map. You can then
compare locations, change priorities, switch benchmark, or draw an area on the map and ask about it.

## Quickest way: no Node needed

The backend also serves a dependency-free web UI (`backend/static/`). Only Python is required:

```bash
cd backend
python -m venv .venv && .venv\Scripts\activate        # macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --port 8000
```

Open **http://localhost:8000**. Map tiles are fetched from the network, so the computer needs internet access.
The Next.js app below is the same interface as a React project for further development.

Optionally, to stop depending on a CDN for the map library:

```bash
python -m app.vendor     # downloads Leaflet into static/vendor/
```

## One-step start (Windows)

Unzip, open the `backend` folder, then either double-click **start.bat** or open PowerShell there (type `powershell` in the Explorer address bar) and run `.\start.bat`. It creates the virtual environment, installs the packages, downloads the map library once, starts the server and opens http://localhost:8001. On macOS/Linux use `./start.sh`.

## Run it (Next.js version)

Two terminals. Python 3.11+ and Node 18+.

```bash
# 1 — API
cd backend
python -m venv .venv && source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env                                      # optional; or paste the key in the app's Settings
python -m app.check                                       # one live request per data source
uvicorn app.main:app --reload --port 8000

# 2 — UI
cd frontend
npm install
npm run dev                                               # http://localhost:3000
```

The first analysis of a region is the slow one (one NASA POWER request per sample point); responses are cached in
`backend/data/http_cache.sqlite`, so repeats are fast. Country boundaries are downloaded once from Natural Earth.

### The demo scenario

1. `Find the best regions in Africa for building solar farms.`
2. `Compare the two best locations based on construction costs, solar irradiance, labor costs, and infrastructure.`
3. `What if I prioritize low construction costs over maximum solar production?`

Also: `Find the best places in Africa to grow carrots.` · `Compare Angola and Brazil for solar energy.` ·
Shift+drag a box on the map, then `Analyze this region for solar energy production.`

## API key and model

One Claude API key is enough for every Claude model. Two ways to provide it:

- **In the app:** click the gear (or the model chip) at the top right, paste the key, **Save key**. It is checked
  against Anthropic, kept in server memory, and the input is cleared. Tick *Remember on this computer* to write it to
  `backend/.env` (git-ignored, file mode 600) so it survives restarts.
- **In a file:** `ANTHROPIC_API_KEY=...` in `backend/.env`.

How the key is kept private: it lives only in the Python process. It is never sent to the browser (the API returns
only the last four characters), never written to localStorage or the page, is removed from every error message and
step text, and `/api/settings` refuses changes from any computer other than the one running the server. Do not
commit `.env`; the zip/`.gitignore` already exclude it. If you expose the server on a network, put it behind your own
authentication first.

**Model:** pick it in the same dialog. The list comes live from your Anthropic account (`/v1/models`), with a built-in
fallback, and *Other model id…* accepts any id. The choice is sent with each message and remembered per browser;
`AGENT_MODEL` in `.env` is the server default.

## Data catalog and explanations

The catalog holds **120 variables** from four open sources (plus any `wb:<code>` / `power:<param>` on request):

| Source | Variables | Examples |
|---|---|---|
| NASA POWER | 26 | irradiance (GHI, DNI, clear-sky, weakest month), clearness index, estimated PV output, max temperature, wind, rain |
| World Bank | 84 | price level, lending rate, inflation, tariffs, grid losses, outages, power demand, logistics, workforce, governance, land, water |
| ILOSTAT | 2 | mean monthly earnings of employees (all sectors, construction), US$ — **experimental connector, verify with `python -m app.check`** |
| SoilGrids | 8 | pH, texture, organic carbon, nitrogen, CEC, bulk density |

The solar framework uses 30 of them in 8 groups; agriculture uses up to 25. Countries are sampled at 5 NASA POWER points
each (`POWER_SAMPLES_PER_COUNTRY`), so the first run of a continent takes a few minutes and is cached afterwards.

*Estimated PV output* is calculated here: irradiance × 365 × performance ratio 0.80, minus 0.4 % per °C of cell
temperature above 25 °C (cell ≈ air + 20 °C), horizontal fixed array. It is labelled **Estimated**, not measured.

**Why tab.** For every location the engine lists each value next to the benchmark (by default the average of the
analysed locations), the % difference, whether that is favourable, and the score points gained or lost against an
average candidate: `weight % × (rescaled value − mean rescaled value)`. The agent's answer quotes these facts for the
top locations. It is arithmetic on retrieved values; missing values are listed as missing.

## Two agent modes

| | With `ANTHROPIC_API_KEY` | Without |
|---|---|---|
| Planner | LLM with tool calling (`app/agent/llm.py`) | Rule-based intent parser (`app/agent/rules.py`) |
| Industries | Any — it builds a framework from the catalog, plus any `wb:<code>` / `power:<param>` | Solar and agriculture |
| Numbers | From tools only | From the same tools |

The UI badge shows which mode is active. Neither mode contains canned answers: both call the same toolbox
(`app/agent/tools.py`), and every tool call emits events that drive the map and dashboard.

## What is real and what is not

- **Real, retrieved live:** NASA POWER climatology (irradiance, temperature, rainfall, cloud, soil wetness),
  World Bank Open Data (electricity access, logistics index, income, price level, governance, land, water),
  ISRIC SoilGrids (topsoil pH, texture, organic carbon), Natural Earth boundaries.
- **Proxies, labelled as such in the UI:** "construction cost" is the economy-wide price level; "labour cost" is
  GNI per capita; "grid" is access to electricity. They are real statistics standing in for quantities with no
  open global dataset. They show direction, not quotes.
- **Sample parameters, labelled as assumptions:** crop requirement ranges in `app/frameworks.py` (`CROPS`) are
  illustrative. Replace them with FAO ECOCROP before relying on agricultural results.
- **Not included, and listed in every analysis:** land prices, distance to transmission lines, grid-connection
  cost, tariffs, permits and land law. Nothing is invented to fill these gaps.
- Missing values stay missing. A location's *data confidence* is the share of the weighting backed by data;
  below 50% it is listed but not ranked.

## The map stack

Everything drawn on screen is open source or open data, and nothing needs an API key or a sign-up.

| Part | What it is | Licence |
|---|---|---|
| [Leaflet](https://leafletjs.com/) | The map library in the Python-served UI. Draws with plain DOM/canvas, so it needs **no WebGL** and works on any computer. (The optional Next.js project uses MapLibre GL JS.) | BSD-2-Clause |
| [OpenStreetMap](https://www.openstreetmap.org/) | Raster tiles for the default **Standard** basemap and the **Dark** one (same tiles recoloured in the browser). Also the fallback when another basemap fails. | ODbL data · [tile usage policy](https://operations.osmfoundation.org/policies/tiles/) |
| [Humanitarian OSM](https://www.hotosm.org/) | Raster tiles for the **Humanitarian** basemap, hosted by OSM France. | ODbL data |
| [Sentinel-2 cloudless](https://s2maps.eu) by EOX | Raster tiles for the **Satellite** basemap: a cloud-free mosaic of ESA Copernicus Sentinel-2 imagery. | Free endpoint, attribution required, non-commercial |
| [Natural Earth](https://www.naturalearthdata.com/) | The country boundaries the analysis is drawn on. | Public domain |

The analysis layers (country fill, dashed borders, floating labels, sample points) are Leaflet vector layers drawn on
top of whichever basemap is active. Any basemap that delivers no tiles within seven seconds is replaced by Standard
(OpenStreetMap), with a notice, rather than leaving the map blank. **Dim basemap** darkens the tiles under the colour ramp.

To change the basemaps, edit the `BASEMAPS` constant — `backend/static/app.js` for the Python-served UI,
`frontend/components/MapView.tsx` for the React one. Self-hosting the tiles is the same change: point the tile URLs at your own
tile server.

## Architecture

```
frontend/  Next.js + TypeScript
  components/MapView.tsx      MapLibre: choropleth via feature-state, floating labels, sample points, box select
  components/AgentPanel.tsx   conversation + live research steps
  components/ResultsPanel.tsx ranking, location detail, comparison, weights/benchmark, sources, CSV/PDF
  lib/api.ts                  REST + server-sent event stream

backend/   Python, Starlette (ASGI)
  app/main.py                 HTTP API; /api/chat streams agent events
  app/agent/                  llm.py (tool-calling loop) · rules.py (fallback planner) · tools.py (shared toolbox)
  app/engine.py               retrieve → normalise → score → rank → benchmark → compare → export
  app/frameworks.py           starting frameworks for solar and agriculture
  app/connectors/             base.py (contract) · registry.py (variable catalog) · one file per source
  app/geo.py                  boundaries, name matching, point sampling
  app/http.py                 cached HTTP with retrieval timestamps
```

**Agent pipeline** — understand → decompose into variables → retrieve → analyse → rank → visualise → explain →
iterate. Each step is emitted to the UI as a short progress line; model reasoning is not shown.

**Scoring** (also shown in the Sources tab): min–max rescaling across the analysed locations, inverted for
"lower is better"; target-range variables score 1 inside the range and fall linearly outside it; score = weighted
mean × 100 over variables that have data. Percentage differences are always against the named benchmark, in the
variable's own units and reference period.

### Adding a data source

1. Subclass `Connector` in `app/connectors/` and implement `fetch()` returning a `FetchResult` (values, units,
   retrieval time, errors).
2. Register it and add `VariableDef` entries (units, data kind, resolution, keywords) in `registry.py`.

The agent sees new variables through `get_data_catalog` immediately; no agent code changes.

## Tests

```bash
cd backend && python -m pytest -q          # offline; fake payloads, runs the whole demo conversation
python -m tests.offline_server             # API on test fixtures for UI work without internet (not real data)
```

## Known limits and next steps

- **Resolution is country level**, with 1–3 sample points per country for gridded data. "Regions" in results are
  countries. Next: admin-1 boundaries and raster zonal statistics in PostGIS (the suggested stack's database is not
  used yet — state is in memory and the cache is SQLite).
- **Connectors still to build:** OpenStreetMap (roads, power lines, substations), Global Solar Atlas rasters,
  FAOSTAT prices, Copernicus land cover, protected areas, flood hazard.
- **Sessions and analyses live in memory** and are lost on restart; no authentication.
- **PDF export** uses the browser's print dialog with a print layout, not a server-rendered report.
- **Basemap services** are public endpoints run by other people (see *The map stack* above). They are free to use,
  but for production you would self-host the tiles rather than rely on someone else's bandwidth.
- Annual means only: growing-season length and rainfall distribution are not scored yet.
