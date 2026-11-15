import * as fs from 'node:fs';
import * as path from 'node:path';

let loaded = false;

/**
 * Load environment variables from `.env` and `.env.local` (where `.env.local`
 * overrides `.env`, and existing `process.env` variables take precedence),
 * matching the behavior documented in SERVER.md.
 */
export function loadServerEnv(rootDir = process.cwd()): void {
  if (loaded) return;
  loaded = true;

  const existingKeys = new Set(Object.keys(process.env));
  for (const file of ['.env', '.env.local']) {
    const full = path.join(rootDir, file);
    if (!fs.existsSync(full)) continue;
    const text = fs.readFileSync(full, 'utf8');
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      let val = line.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!existingKeys.has(key)) {
        process.env[key] = val;
      }
    }
  }

  shareMeridianAnthropicKey(rootDir);
}

/**
 * One key for both apps: if no ANTHROPIC_API_KEY is set for TerraTwin, use the one saved by Meridian
 * (Earth) in its backend/.env. Read on the server only; the value is never logged or sent to the browser.
 * Looks in: ./earth/backend, ../terratwin final/backend, ../earth/backend, ../meridian/backend.
 */
export function shareMeridianAnthropicKey(rootDir: string): void {
  if ((process.env.ANTHROPIC_API_KEY ?? '').trim().length > 8) return;
  const candidates = [
    path.join(rootDir, 'earth', 'backend', '.env'),
    path.join(rootDir, '..', 'terratwin final', 'backend', '.env'),
    path.join(rootDir, '..', 'earth', 'backend', '.env'),
    path.join(rootDir, '..', 'meridian', 'backend', '.env'),
  ];
  for (const file of candidates) {
    try {
      if (!fs.existsSync(file)) continue;
      let key = '';
      for (const rawLine of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;
        const eq = line.indexOf('=');
        if (eq <= 0) continue;
        const name = line.slice(0, eq).trim();
        const val = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
        if (name === 'ANTHROPIC_API_KEY') key = val;
      }
      if (key.length > 8) {
        process.env.ANTHROPIC_API_KEY = key;
        return;
      }
    } catch {
      // unreadable file: try the next location
    }
  }
}
