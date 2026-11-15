/**
 * NASA POWER measured climate for the Earth analog sites (served by /api/moon/earth-climate).
 * Fetched once per page and shared by every component that needs it.
 */
import { useEffect, useState } from 'react';

export interface EarthClimate {
  source: string;
  sourceUrl: string;
  period: string | null;
  units: Record<string, string>;
  sites: Record<string, { values: Record<string, number>; url: string }>;
  errors: Record<string, string>;
}

let cache: EarthClimate | null = null;
let pending: Promise<EarthClimate | null> | null = null;

function load(): Promise<EarthClimate | null> {
  if (cache) return Promise.resolve(cache);
  if (!pending) {
    pending = fetch('./api/moon/earth-climate')
      .then((r) => (r.ok ? r.json() : null))
      .then((j: EarthClimate | null) => {
        if (j && j.sites) cache = j;
        return cache;
      })
      .catch(() => null)
      .finally(() => {
        pending = null;
      });
  }
  return pending;
}

export function useEarthClimate(): { climate: EarthClimate | null; loading: boolean } {
  const [climate, setClimate] = useState<EarthClimate | null>(cache);
  const [loading, setLoading] = useState(!cache);
  useEffect(() => {
    let alive = true;
    if (!cache) {
      load().then((c) => {
        if (!alive) return;
        setClimate(c);
        setLoading(false);
      });
    }
    return () => {
      alive = false;
    };
  }, []);
  return { climate, loading };
}

const r1 = (x: number) => (Math.round(x * 10) / 10).toFixed(1).replace(/\.0$/, '');

/** One readable line, e.g. "16.8 °C mean (−2 to 30 °C) · 0.02 mm/day rain · 23% humidity · 6.9 kWh/m²/day sunlight". */
export function climateLine(v: Record<string, number> | undefined): string | null {
  if (!v) return null;
  const parts: string[] = [];
  if (v.T2M !== undefined) {
    let t = `${r1(v.T2M)} °C mean`;
    if (v.T2M_MIN !== undefined && v.T2M_MAX !== undefined) t += ` (${r1(v.T2M_MIN)} to ${r1(v.T2M_MAX)} °C)`;
    parts.push(t);
  }
  if (v.PRECTOTCORR !== undefined) parts.push(`${v.PRECTOTCORR < 0.1 ? v.PRECTOTCORR.toFixed(2) : r1(v.PRECTOTCORR)} mm/day rain`);
  if (v.RH2M !== undefined) parts.push(`${Math.round(v.RH2M)}% humidity`);
  if (v.ALLSKY_SFC_SW_DWN !== undefined) parts.push(`${r1(v.ALLSKY_SFC_SW_DWN)} kWh/m²/day sunlight`);
  return parts.length ? parts.join(' · ') : null;
}

/** Moon reference values (NASA Moon Fact Sheet) used next to the measured Earth climate. */
export const MOON_CLIMATE_REFERENCE = {
  meanTempC: -63, // 210 K global mean surface temperature
  source: 'NASA Moon Fact Sheet (NSSDCA)',
  url: 'https://nssdc.gsfc.nasa.gov/planetary/factsheet/moonfact.html',
};
