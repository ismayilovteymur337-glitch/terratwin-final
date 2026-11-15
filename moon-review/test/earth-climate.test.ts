import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import { getEarthAnalogClimate, parsePowerAnnual, powerUrl } from '../server/earth-climate.ts';
import { EARTH_ANALOGS } from '../src/moon/analogs.ts';

const sample = {
  properties: { parameter: { T2M: { JAN: 1, ANN: 16.8 }, T2M_MIN: { ANN: 9.2 }, T2M_MAX: { ANN: 25.1 }, PRECTOTCORR: { ANN: 0.02 }, RH2M: { ANN: -999 }, ALLSKY_SFC_SW_DWN: { ANN: 6.9 } } },
  header: { start: 2001, end: 2020 },
};

test('parses annual values and drops the -999 fill value', () => {
  const { values, period } = parsePowerAnnual(sample);
  assert.equal(values.T2M, 16.8);
  assert.equal(values.PRECTOTCORR, 0.02);
  assert.equal(values.RH2M, undefined);
  assert.equal(period, '2001–2020');
  assert.match(powerUrl(-24.1, -70), /^https:\/\/power\.larc\.nasa\.gov\/api\/temporal\/climatology\/point\?parameters=T2M%2CT2M_MIN/);
});

test('fetches every analog once, caches to disk, reports failures per site', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-power-'));
  const cwd = process.cwd();
  process.chdir(dir);
  try {
    let calls = 0;
    const fake = (async (url: string) => {
      calls++;
      if (url.includes('latitude=40.0300')) return new Response('busy', { status: 503 }); // Gobustan fails
      return new Response(JSON.stringify(sample), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await getEarthAnalogClimate(fake);
    assert.equal(calls, EARTH_ANALOGS.length);
    assert.equal(Object.keys(r.sites).length, EARTH_ANALOGS.length - 1);
    assert.match(r.errors.gobustan, /503/);
    assert.ok(fs.existsSync(path.join(dir, 'data', 'cache', 'power-analogs.json')));
    // Second call: only the failed site is requested again
    const r2 = await getEarthAnalogClimate(fake);
    assert.equal(calls, EARTH_ANALOGS.length + 1);
    assert.equal(r2.sites.atacama.values.T2M, 16.8);
  } finally {
    process.chdir(cwd);
  }
});
