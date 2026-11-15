import assert from 'node:assert/strict';
import test from 'node:test';
import {
  bestPerDimension,
  compareSites,
  earthLimits,
  EARTH_ANALOGS,
  rankAnalogs,
  TARGETS,
} from '../src/moon/analogs.ts';

const target = (id: string) => TARGETS.find((t) => t.id === id)!;
const analog = (id: string) => EARTH_ANALOGS.find((a) => a.id === id)!;

test('every site has valid coordinates, references and 0–1 environment levels', () => {
  for (const s of [...TARGETS, ...EARTH_ANALOGS]) {
    assert.ok(Math.abs(s.lat) <= 90 && Math.abs(s.lon) <= 180, s.id);
    assert.ok(s.refs.length > 0, `${s.id} has references`);
    for (const v of Object.values(s.env)) assert.ok(v >= 0 && v <= 1, s.id);
  }
});

test('scores are bounded and identical profiles score 100%', () => {
  for (const t of TARGETS) for (const m of rankAnalogs(t)) assert.ok(m.overall >= 0 && m.overall <= 1);
  const t = target('jezero');
  const twin = { ...analog('ries'), morphology: t.morphology, mineralogy: t.mineralogy, habitability: t.habitability, env: t.env };
  assert.equal(compareSites(t, twin).overall, 1);
});

test('known analogs come out where the literature puts them', () => {
  const top = (id: string, n: number) => rankAnalogs(target(id)).slice(0, n).map((m) => m.analog.id);
  assert.ok(top('meridiani', 3).includes('rio_tinto'), 'Río Tinto is a top Meridiani analog');
  assert.ok(top('phoenix', 3).includes('dry_valleys'), 'Dry Valleys is a top Phoenix analog');
  assert.ok(top('acidalia_mounds', 3).includes('gobustan'), 'Gobustan is a top analog for the mound fields');
  assert.ok(top('descartes', 4).includes('stillwater') || top('descartes', 4).includes('meteor_crater'));
});

test('a site can be strong on one dimension and weak on another', () => {
  const m = compareSites(target('meridiani'), analog('rio_tinto'));
  const minerals = m.dims.find((d) => d.key === 'mineralogy')!.score!;
  const env = m.dims.find((d) => d.key === 'environment')!.score!;
  assert.ok(minerals > 0.7 && env < minerals, 'minerals match well, climate much less');
  assert.ok(bestPerDimension(target('jezero')).length >= 3);
});

test('weights change the ranking and empty dimensions are not counted as matches', () => {
  const t = target('tranquillitatis'); // no habitability tags
  const m = compareSites(t, analog('stillwater'));
  assert.equal(m.dims.find((d) => d.key === 'habitability')!.score, null);
  const geoOnly = rankAnalogs(target('jezero'), { geology: 1, environment: 0, habitability: 0 })[0].analog.id;
  const envOnly = rankAnalogs(target('jezero'), { geology: 0, environment: 1, habitability: 0 })[0].analog.id;
  assert.notEqual(geoOnly, envOnly);
});

test('Earth limits are computed from the bundled constants', () => {
  const moon = earthLimits('moon');
  assert.match(moon.find((l) => l.quantity === 'Gravity')!.ratio, /^0\.38 g$/);
  const rad = moon.find((l) => l.quantity.startsWith('Surface radiation'))!;
  assert.match(rad.other, /0\.64 mSv\/day/);
  assert.match(earthLimits('moon').find((l) => l.quantity === 'Gravity')!.ratio, /^0\.17 g$/);
});
