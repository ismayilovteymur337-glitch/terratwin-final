/**
 * Link between TerraTwin (Moon) and Meridian (Earth).
 *
 * - Embedded: Meridian opens TerraTwin in a full-screen layer with `?embed=meridian`.
 *   "Back to Earth" then asks the parent page to close that layer, so the Earth analysis is
 *   kept. Meridian sends `meridian:pause` / `meridian:resume` so the 3D globe stops rendering
 *   while it is hidden.
 * - Standalone: "Back to Earth" navigates to Meridian (the `earth` URL it was opened from,
 *   or http://<same host>:8001/ by default; override with VITE_EARTH_URL at build time).
 */

const EARTH_KEY = 'terratwin_earth_url';

function readParams(): URLSearchParams {
  try {
    return new URLSearchParams(window.location.search);
  } catch {
    return new URLSearchParams();
  }
}

function isSafeHttpUrl(u: string | null | undefined): u is string {
  if (!u) return false;
  try {
    const parsed = new URL(u);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

const params = typeof window !== 'undefined' ? readParams() : new URLSearchParams();

export const isEmbeddedInMeridian: boolean =
  typeof window !== 'undefined' && window.parent !== window && params.get('embed') === 'meridian';

function computeEarthUrl(): string {
  const fromQuery = params.get('earth');
  if (isSafeHttpUrl(fromQuery)) {
    try {
      window.sessionStorage.setItem(EARTH_KEY, fromQuery);
    } catch {
      // ignore storage errors
    }
    return fromQuery;
  }
  try {
    const saved = window.sessionStorage.getItem(EARTH_KEY);
    if (isSafeHttpUrl(saved)) return saved;
  } catch {
    // ignore storage errors
  }
  const envUrl = (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_EARTH_URL;
  if (isSafeHttpUrl(envUrl)) return envUrl;
  const host = window.location.hostname || 'localhost';
  const proto = window.location.protocol === 'https:' ? 'https:' : 'http:';
  return `${proto}//${host}:8001/`;
}

export const earthUrl: string = typeof window !== 'undefined' ? computeEarthUrl() : 'http://localhost:8001/';
const earthOrigin = (() => {
  try {
    return new URL(earthUrl).origin;
  } catch {
    return '*';
  }
})();

export function returnToEarth(): void {
  if (isEmbeddedInMeridian) {
    window.parent.postMessage({ type: 'terratwin:return-earth', source: 'terratwin' }, earthOrigin);
    return;
  }
  window.location.assign(earthUrl);
}

/**
 * Show an Earth location on the Meridian map (used by the Earth Analog Finder).
 * Embedded: Meridian closes the Moon layer and flies to the point. Standalone: opens Meridian at it.
 */
export function showOnEarth(lat: number, lon: number, label: string): void {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
  const safeLabel = String(label).slice(0, 120);
  if (isEmbeddedInMeridian) {
    window.parent.postMessage({ type: 'terratwin:show-earth', source: 'terratwin', lat, lon, label: safeLabel }, earthOrigin);
    return;
  }
  const u = new URL(earthUrl);
  u.hash = `focus=${lat.toFixed(4)},${lon.toFixed(4)},${encodeURIComponent(safeLabel)}`;
  window.location.assign(u.toString());
}

/* ----------------------------------------------------------------- render pause state */

let paused = false;
const listeners = new Set<(paused: boolean) => void>();

function setPaused(next: boolean) {
  if (next === paused) return;
  paused = next;
  listeners.forEach((fn) => fn(paused));
}

export function isRenderPaused(): boolean {
  return paused;
}

export function onRenderPauseChange(fn: (paused: boolean) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

if (typeof window !== 'undefined') {
  window.addEventListener('message', (e: MessageEvent) => {
    if (!isEmbeddedInMeridian || e.source !== window.parent) return;
    if (earthOrigin !== '*' && e.origin !== earthOrigin) return;
    const data = e.data as { type?: string } | null;
    if (!data || typeof data !== 'object') return;
    if (data.type === 'meridian:pause') setPaused(true);
    if (data.type === 'meridian:resume') setPaused(false);
  });

  if (isEmbeddedInMeridian) {
    const announce = () =>
      window.parent.postMessage({ type: 'terratwin:ready', source: 'terratwin' }, earthOrigin);
    if (document.readyState === 'complete') announce();
    else window.addEventListener('load', announce, { once: true });
  }
}
