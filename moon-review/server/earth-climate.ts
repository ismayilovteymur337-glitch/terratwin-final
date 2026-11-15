/**
 * Measured climate of every Earth analog site from NASA POWER (Prediction Of Worldwide Energy Resources).
 * Climatology API, 2001–2020 long-term means, no API key required:
 *   https://power.larc.nasa.gov/api/temporal/climatology/point
 * Results are cached in memory and on disk (data/cache/power-analogs.json), so after the first
 * successful run the panel also works offline.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { EARTH_ANALOGS } from '../src/moon/analogs.ts';

export const POWER_PARAMS = ['T2M', 'T2M_MIN', 'T2M_MAX', 'PRECTOTCORR', 'RH2M', 'ALLSKY_SFC_SW_DWN'] as const;
export type PowerParam = (typeof POWER_PARAMS)[number];

export interface SiteClimate {
  values: Partial<Record<PowerParam, number>>;
  url: string;
}

export interface EarthClimateResponse {
  source: string;
  sourceUrl: string;
  period: string | null;
  units: Record<PowerParam, string>;
  sites: Record<string, SiteClimate>;
  errors: Record<string, string>;
  cachedAt: string | null;
}

const API = 'https://power.larc.nasa.gov/api/temporal/climatology/point';
const FILL = -998; // POWER uses -999 for missing values
const UNITS: Record<PowerParam, string> = {
  T2M: '°C',
  T2M_MIN: '°C',
  T2M_MAX: '°C',
  PRECTOTCORR: 'mm/day',
  RH2M: '%',
  ALLSKY_SFC_SW_DWN: 'kWh/m²/day',
};

let memory: EarthClimateResponse | null = null;
let inflight: Promise<EarthClimateResponse> | null = null;

function cacheFile(): string {
  return path.join(process.cwd(), 'data', 'cache', 'power-analogs.json');
}

export function powerUrl(lat: number, lon: number): string {
  const q = new URLSearchParams({
    parameters: POWER_PARAMS.join(','),
    community: 'RE',
    longitude: lon.toFixed(4),
    latitude: lat.toFixed(4),
    format: 'JSON',
  });
  return `${API}?${q.toString()}`;
}

/** Pull the annual ("ANN") value of each parameter out of a POWER climatology response. */
export function parsePowerAnnual(json: any): { values: Partial<Record<PowerParam, number>>; period: string | null } {
  const params = json?.properties?.parameter ?? {};
  const values: Partial<Record<PowerParam, number>> = {};
  for (const p of POWER_PARAMS) {
    const v = params?.[p]?.ANN;
    if (typeof v === 'number' && Number.isFinite(v) && v > FILL) values[p] = v;
  }
  const h = json?.header;
  const period = h?.start && h?.end ? `${h.start}–${h.end}` : null;
  return { values, period };
}

async function fetchOne(lat: number, lon: number, fetchImpl: typeof fetch): Promise<{ values: Partial<Record<PowerParam, number>>; period: string | null; url: string }> {
  const url = powerUrl(lat, lon);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 30_000);
  try {
    const res = await fetchImpl(url, { signal: ctl.signal, headers: { 'User-Agent': 'TerraTwin/1.0 (NASA Space Apps)' } });
    if (!res.ok) throw new Error(`NASA POWER HTTP ${res.status}`);
    const parsed = parsePowerAnnual(await res.json());
    if (!Object.keys(parsed.values).length) throw new Error('NASA POWER returned no values');
    return { ...parsed, url };
  } finally {
    clearTimeout(timer);
  }
}

export async function getEarthAnalogClimate(fetchImpl: typeof fetch = fetch): Promise<EarthClimateResponse> {
  if (memory && Object.keys(memory.errors).length === 0) return memory;
  if (inflight) return inflight;

  inflight = (async () => {
    let disk: EarthClimateResponse | null = null;
    try {
      if (fs.existsSync(cacheFile())) disk = JSON.parse(fs.readFileSync(cacheFile(), 'utf8'));
    } catch {
      disk = null;
    }

    const out: EarthClimateResponse = {
      source: 'NASA POWER Climatology API (MERRA-2 meteorology, CERES radiation)',
      sourceUrl: 'https://power.larc.nasa.gov/',
      period: disk?.period ?? null,
      units: UNITS,
      sites: { ...(disk?.sites ?? {}) },
      errors: {},
      cachedAt: disk?.cachedAt ?? null,
    };

    const todo = EARTH_ANALOGS.filter((a) => !out.sites[a.id]);
    // Four requests at a time keeps well inside POWER's rate limits.
    for (let i = 0; i < todo.length; i += 4) {
      await Promise.all(
        todo.slice(i, i + 4).map(async (a) => {
          try {
            const r = await fetchOne(a.lat, a.lon, fetchImpl);
            out.sites[a.id] = { values: r.values, url: r.url };
            out.period = out.period ?? r.period;
          } catch (err) {
            out.errors[a.id] = err instanceof Error ? err.message : String(err);
          }
        }),
      );
    }

    if (todo.length && Object.keys(out.sites).length) {
      out.cachedAt = new Date().toISOString();
      try {
        fs.mkdirSync(path.dirname(cacheFile()), { recursive: true });
        fs.writeFileSync(cacheFile(), JSON.stringify({ ...out, errors: {} }, null, 1));
      } catch {
        // read-only folder: keep the in-memory copy only
      }
    }
    memory = out;
    return out;
  })();

  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}
