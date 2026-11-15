/**
 * Light / dark theme. Saved per browser; inside the Meridian Earth app (which is dark) the
 * default is dark, elsewhere it follows the system setting until the user picks one.
 */
import { useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';
const KEY = 'terratwin_theme';

function initialTheme(): Theme {
  try {
    const saved = window.localStorage.getItem(KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    // storage blocked
  }
  try {
    if (new URLSearchParams(window.location.search).get('embed') === 'meridian') return 'dark';
    if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) return 'dark';
  } catch {
    // ignore
  }
  return 'light';
}

let current: Theme = typeof window !== 'undefined' ? initialTheme() : 'light';
const listeners = new Set<(t: Theme) => void>();
let switchTimer = 0;

export function applyTheme(t: Theme, animate = false): void {
  current = t;
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (animate) {
    root.classList.add('tt-theme-switching');
    window.clearTimeout(switchTimer);
    switchTimer = window.setTimeout(() => root.classList.remove('tt-theme-switching'), 320);
  }
  root.dataset.theme = t;
  listeners.forEach((fn) => fn(t));
}

export function setTheme(t: Theme): void {
  try {
    window.localStorage.setItem(KEY, t);
  } catch {
    // storage blocked: still switch for this visit
  }
  applyTheme(t, true);
}

export function useTheme(): [Theme, () => void] {
  const [theme, set] = useState<Theme>(current);
  useEffect(() => {
    listeners.add(set);
    return () => {
      listeners.delete(set);
    };
  }, []);
  return [theme, () => setTheme(theme === 'dark' ? 'light' : 'dark')];
}

// Apply before the first paint so there is no light flash in dark mode.
if (typeof document !== 'undefined') applyTheme(current);
