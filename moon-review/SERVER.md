# ARES server integration

Run Node 22.12+ with `npm install`, then `npm run dev`. For production run
`npm run build` followed by `npm start` (serves `dist/` and the API together).
The server binds to 127.0.0.1:5173 by default. Set HOST/PORT for a deployment.
Deploy the repository with `public/data/`, not only `dist/`: server LOLA sampling
requires the bundled IMG, label and checksum manifest. Install dev dependencies
because the startup command uses tsx. Static GitHub Pages cannot run these APIs.

Secrets belong in deployment environment variables or ignored `.env.local`.
Existing process variables win; `.env.local` overrides `.env`. No VITE-prefixed
keys are used. Set ANTHROPIC_API_KEY (Claude Sonnet 5.5 is the default router model; Opus 5.5 and
Haiku 5.5 can be pinned in the AI panel) or OPENAI_API_KEY and restart to enable AI. If
ANTHROPIC_API_KEY is empty, the server reuses the key saved by Meridian in `earth/backend/.env`
(or `../terratwin final/backend/.env`); it is read on the server only and never sent to the browser.
The router waits up to 60 s per model call (adjustable to 180 s) and retries timeouts, 429 and 5xx
responses before falling back to the deterministic engine. For OpenAI, OPENAI_MODEL accepts
`gpt-6-luna` (default) or `gpt-6.1-terra`; account access is required. No other model
is silently substituted. The browser sends coordinates/questions only to ARES;
ARES sends bounded context to OpenAI Responses with store:false and strict JSON
schema, following https://developers.openai.com/api/docs/guides/structured-outputs.

## Endpoints and state

- GET `/api/moon/telemetry?lat=18.44&lon=77.45`: deterministic evidence and status.
- POST `/api/moon/analyze`, JSON `{ "lat": 18.44, "lon": 77.45 }`: evidence plus
  AI interpretation, or explicit unavailable AI status with deterministic data.
- POST `/api/moon/chat`, JSON `{ "lat": 18.44, "lon": 77.45, "message": "What is
  known here?", "history": [] }`: grounded follow-up. History is limited to eight
  messages of at most 2400 characters; question limit is 2000.

`src/coordinate-state.ts` connects selected landmarks and deliberate 2D/3D clicks
to the existing panel. Hover never requests the API. `use-moon-intelligence.ts`
debounces selection, aborts stale browser requests and renders deterministic data
before AI. Chat resets on location changes. Panel layouts and map engines remain
unchanged. Existing scenario comparisons/layers keep their accurate labels.

There is no Supabase integration. Analysis uses a bounded 256-entry in-process
cache and pending-request deduplication at rounded 0.01° coordinates: one hour for
AI success, one minute for unavailable AI. Weather has a one-hour success cache,
one-minute failure cache. Caches reset on restart and are not shared across workers.
Rounding can shift the sampled point by hundreds of meters, below this DEM's scale.

## Evidence and limits

- LOLA MEGT90N000EB v2.0 is checksum-verified locally. Bilinear elevation and central
  difference slope are Derived, at ~3.7 km N–S spacing. Relief is max–min in 1°;
  it is not local obstacle roughness. Polar slopes above 85° are unavailable.
- Landing terrain score reuses existing explicit LOLA proxy thresholds, labeled
  Model. It is not operational suitability. Candidate scenario rankings retain
  their unsourced factors as assumptions.
- Moon Trek Viking WMTS imagery integration remains unchanged in `imagery.js`;
  its existing LOLA fallback remains. No additional imagery is fabricated.
- NASA InSight API is queried on the server using NASA_API_KEY, with a 6-second
  timeout. It returns historical station weather, not current global weather.
  Invalid/empty/error responses are Unavailable. Station context is never applied
  as a measurement at another location. Curiosity/Perseverance distances are to
  cited landing references, not current rover positions.
- Existing RAD extract is supplied to AI as historical Gale context with records,
  dates, product versions, quality exclusions and inferred landing-location caveat.
  No global dose, shielding design, radiation score or dose-equivalent conversion
  is generated. Decorative radiation stays illustrative.
- Solar uses the NASA fact-sheet mean-distance 586.2 W/m², equinox local-noon
  horizontal geometry and Beer–Lambert direct-beam extinction with assumed dust
  optical depth 0.5. It is not annual yield, weather or panel efficiency.
- Pressure follows NASA Glenn's educational altitude curve, using LOLA elevation
  as an approximation. Negative elevations extrapolate the curve. Mass column is
  pressure / 3.73 m/s²; it is not radiation dose. Temperature range, ice probability,
  science score, greenhouse score and exact Earth analog similarity stay null:
  the necessary calibrated datasets/engineering inputs are not connected.
- AI prose is a Model interpretation. Schema and source-ID validation cannot
  certify factual accuracy; cited sources and limitations remain visible.

## Serving and security

The server enforces same-origin browser requests, a 32 KiB body limit, 30 requests
per socket IP per minute, eight active API requests, upstream timeouts and bounded
caches. Errors omit upstream details and keys. APP_ORIGIN can pin the public origin.
It does not trust forwarded IP headers. This is a single-instance application
server, not an authenticated multi-tenant service. Before public deployment put
authentication, shared quota/budget controls and TLS at your hosting gateway;
same-origin checks alone do not authenticate arbitrary HTTP clients. No deployment
or public exposure was performed.

Validation: `npm run typecheck`, `npm test`, `npm run build`. Automated tests cover
geography, LOLA source integrity, deterministic models, missing data, JSON validation,
source whitelists, sanitized errors and HTTP validation. A real OpenAI response
cannot be verified without the server key.
