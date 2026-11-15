import assert from 'node:assert/strict';
import test from 'node:test';
import { ElevationGrid } from '../src/core/terrain/grid.ts';
import { planMoonRoutes } from '../src/moon/routing.ts';
import { getRoverById } from '../src/moon/rovers.ts';
import { explainPlan } from '../src/moon/route-explain.ts';
import { earthTwinForSite } from '../src/moon/point-analog.ts';
import { roverPlayback } from '../src/moon/rover-playback.ts';

/** Synthetic 0.5° × 0.5° terrain near Jezero: flat plain with a steep ridge across the straight line A→B. */
export function syntheticGrid(): ElevationGrid {
  const width = 120, height = 120, north = 18.7, west = 77.2, dLat = 0.5 / height, dLon = 0.5 / width;
  const elevation = new Float32Array(width * height);
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      const x = c / width, y = r / height;
      const ridge = Math.exp(-(((x - 0.5) / 0.035) ** 2)) * (y > 0.12 && y < 0.88 ? 1 : 0) * 900;
      const bumps = Math.sin(x * 40) * Math.cos(y * 37) * 25;
      elevation[r * width + c] = -2500 + ridge + bumps;
    }
  }
  return { width, height, north, west, dLat, dLon, elevation };
}

export function syntheticPlan(roverId = 'perseverance') {
  return planMoonRoutes({
    roverId,
    grid: syntheticGrid(),
    gridSource: 'synthetic test grid',
    start: { lat: 18.45, lon: 77.27 },
    destination: { lat: 18.45, lon: 77.63 },
    craters: [],
    features: [{ id: 'f1', name: 'Test Vallis', type: 'Vallis, valles', code: 'VA', lat: 18.62, lon: 77.45, diameterKm: 10 }],
  });
}

test('three routes are explained with a risk level and concrete numbers', () => {
  const plan = syntheticPlan();
  const rover = getRoverById('perseverance');
  const ex = explainPlan(plan, rover);
  assert.deepEqual(ex.map((e) => e.shortName), ['Safest', 'Science', 'Direct']);
  for (const e of ex) {
    assert.ok(['low', 'moderate', 'high'].includes(e.risk));
    assert.ok(e.headline.length > 20);
    assert.ok(e.dangers.length + e.safeguards.length > 0, 'every route says why it is or is not dangerous');
    assert.match([...e.dangers, ...e.safeguards].join(' '), /°/, 'reasons quote slopes in degrees');
  }
  const rank = { low: 0, moderate: 1, high: 2 } as const;
  const safest = ex.find((e) => e.id === 'terrain_optimized')!;
  const direct = ex.find((e) => e.id === 'shortest')!;
  assert.ok(rank[safest.risk] <= rank[direct.risk], 'the safest route is never riskier than the direct one');
});

test('Earth twin for a clicked point near Jezero uses Jezero minerals; a polar point gets ground ice', () => {
  const base: any = {
    id: 'p', name: 'Clicked point', isCandidatePreset: false,
    craterSummary: { nearestCrater: { id: 'c', name: 'Jezero', lat: 18.4, lon: 77.6, diameterKm: 45, depthRimFloorKm: null, distanceKm: 8, insideRim: true } },
    nearbyFeatures: [], atmosphere: { surfacePressurePa: 700 },
  };
  const jez = earthTwinForSite({ ...base, lat: 18.5, lon: 77.5 });
  assert.ok(jez.profile.mineralogy.includes('carbonates'));
  assert.ok(jez.profile.morphology.includes('impact_crater'));
  assert.ok(jez.basis.length >= 2);
  assert.equal(Math.round(jez.pressureRatio!), 145);

  const polar = earthTwinForSite({ ...base, lat: 72, lon: 30, craterSummary: { nearestCrater: null } });
  assert.ok(polar.profile.habitability.includes('water_ice'));
  assert.equal(polar.matches[0].analog.id, 'dry_valleys');
});

test('playback store plays, pauses and seeks', () => {
  roverPlayback.seek(0.5);
  assert.equal(roverPlayback.get().progress, 0.5);
  roverPlayback.pause();
  assert.equal(roverPlayback.get().playing, false);
  roverPlayback.seek(2);
  assert.equal(roverPlayback.get().progress, 1);
});

import { rankRoversForRoute, whyBest } from '../src/moon/rover-fit.ts';

test('best rover for the drawn route: ranks all NASA rovers with reasons', () => {
  const plan = syntheticPlan();
  const direct = plan.routes.find((r) => r.id === 'shortest')!;
  const ranked = rankRoversForRoute(direct);
  assert.equal(ranked.length, 5);
  for (const f of ranked) {
    assert.ok(f.score >= 0 && f.score <= 100);
    assert.ok(f.reasons.length >= 3);
  }
  // Feasible rovers always come first, sorted by score
  const firstInfeasible = ranked.findIndex((f) => !f.feasible);
  if (firstInfeasible >= 0) assert.ok(ranked.slice(firstInfeasible).every((f) => !f.feasible));
  assert.match(whyBest(ranked), /beats|equal|No NASA rover/);
  // A rover whose limit is below the route's steepest point is never feasible
  for (const f of ranked) {
    if (direct.analytics.maxSlopeDeg > f.rover.mobilityProfile.operationalMaxSlopeDeg) assert.equal(f.feasible, false);
  }
});
