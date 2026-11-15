/**
 * Which rover suits the drawn A→B route best?
 *
 * The selected route's terrain profile (LOLA slope and TRI roughness at every sample) is checked
 * against each NASA rover's own published limits (rovers.ts):
 *  - Feasible only if no stretch is steeper than the rover's operational slope limit.
 *  - Slope margin: how far the steepest point stays below that limit.
 *  - Comfort: share of the distance steeper than the rover's comfortable cruise grade.
 *  - Roughness: share of the distance above the TRI level that threatens its wheels
 *    (28 m for puncture-sensitive wheels, 42 m otherwise — the same rule the planner uses).
 *  - Speed: top hard-surface speed (a tie-breaker; real drives are much slower).
 * Score = 45% slope margin + 25% comfort + 20% roughness + 10% speed. Pure arithmetic.
 */
import { RoverRoute } from '../core/planet/types';
import { NASA_MOON_ROVERS, NasaRoverProfile, RoverId } from './rovers';

export interface RoverFit {
  rover: NasaRoverProfile;
  feasible: boolean;
  score: number; // 0..100
  slopeMarginPct: number;
  aboveCruisePct: number;
  roughPct: number;
  driveHoursAtTopSpeed: number;
  reasons: string[];
}

const r0 = (x: number) => Math.round(x);
const r1 = (x: number) => Math.round(x * 10) / 10;

export function evaluateRoverFit(route: RoverRoute, rover: NasaRoverProfile, fastestCmS: number): RoverFit {
  const prof = route.profile;
  const mob = rover.mobilityProfile;
  const limit = mob.operationalMaxSlopeDeg;
  const cruise = mob.optimalSlopeDeg;
  const triLimit = mob.rockPunctureSensitivity === 'high' ? 28 : 42;
  const total = Math.max(1e-6, route.analytics.totalDistanceKm);

  let over = 0;
  let aboveCruise = 0;
  let rough = 0;
  for (let i = 1; i < prof.length; i++) {
    const seg = Math.max(0, prof[i].distanceKm - prof[i - 1].distanceKm);
    const slope = Math.max(prof[i].slopeDeg, prof[i - 1].slopeDeg);
    const tri = Math.max(prof[i].triM, prof[i - 1].triM);
    if (slope > limit) over += seg;
    if (slope > cruise) aboveCruise += seg;
    if (tri >= triLimit) rough += seg;
  }
  const maxSlope = route.analytics.maxSlopeDeg;
  const feasible = over === 0 && maxSlope <= limit;
  const slopeMargin = Math.max(0, 1 - maxSlope / limit);
  const comfort = 1 - aboveCruise / total;
  const smooth = 1 - rough / total;
  const speed = fastestCmS > 0 ? rover.steeringAndDrive.maxHardSurfaceSpeedCmPerSec / fastestCmS : 0;
  const score = feasible ? 100 * (0.45 * slopeMargin + 0.25 * comfort + 0.2 * smooth + 0.1 * speed) : 0;
  const hours = (total * 100_000) / Math.max(0.1, rover.steeringAndDrive.maxHardSurfaceSpeedCmPerSec) / 3600;

  const reasons: string[] = [];
  if (!feasible) {
    reasons.push(`${r1(over)} km of the route is steeper than its ${limit}° limit (steepest ${r1(maxSlope)}°).`);
  } else {
    reasons.push(`Steepest point ${r1(maxSlope)}° uses ${r0((maxSlope / limit) * 100)}% of its ${limit}° limit.`);
  }
  reasons.push(
    aboveCruise > 0
      ? `${r0((aboveCruise / total) * 100)}% of the drive is above its ${cruise}° cruise grade.`
      : `Whole drive within its ${cruise}° cruise grade.`,
  );
  reasons.push(
    rough > 0
      ? `${r0((rough / total) * 100)}% of the drive is rough enough to threaten its ${rover.wheels.skinThicknessMm} mm wheels.`
      : `No stretch rough enough to threaten its wheels.`,
  );
  reasons.push(`Top speed ${rover.steeringAndDrive.maxHardSurfaceSpeedCmPerSec} cm/s → at least ${r1(hours)} h of pure driving.`);

  return {
    rover,
    feasible,
    score: r0(score),
    slopeMarginPct: r0(slopeMargin * 100),
    aboveCruisePct: r0((aboveCruise / total) * 100),
    roughPct: r0((rough / total) * 100),
    driveHoursAtTopSpeed: r1(hours),
    reasons,
  };
}

export function rankRoversForRoute(route: RoverRoute, rovers: NasaRoverProfile[] = NASA_MOON_ROVERS): RoverFit[] {
  const fastest = Math.max(...rovers.map((r) => r.steeringAndDrive.maxHardSurfaceSpeedCmPerSec));
  return rovers
    .map((r) => evaluateRoverFit(route, r, fastest))
    .sort((a, b) => Number(b.feasible) - Number(a.feasible) || b.score - a.score);
}

/** One sentence: why the winner beats the runner-up. */
export function whyBest(ranked: RoverFit[]): string {
  const [a, b] = ranked;
  if (!a) return '';
  if (!a.feasible) return 'No NASA rover can drive this route within its slope limit — pick the Safest route or move A/B.';
  if (!b) return a.reasons[0];
  const parts: string[] = [];
  if (a.slopeMarginPct > b.slopeMarginPct) parts.push(`more slope margin (${a.slopeMarginPct}% vs ${b.slopeMarginPct}%)`);
  if (a.aboveCruisePct < b.aboveCruisePct) parts.push(`less steep driving (${a.aboveCruisePct}% vs ${b.aboveCruisePct}% above cruise grade)`);
  if (a.roughPct < b.roughPct) parts.push(`less wheel-threatening ground (${a.roughPct}% vs ${b.roughPct}%)`);
  if (a.rover.steeringAndDrive.maxHardSurfaceSpeedCmPerSec > b.rover.steeringAndDrive.maxHardSurfaceSpeedCmPerSec)
    parts.push('a faster top speed');
  if (!b.feasible) parts.unshift(`${b.rover.name} exceeds its slope limit here`);
  return parts.length
    ? `${a.rover.name} beats ${b.rover.name}: ${parts.join(', ')}.`
    : `${a.rover.name} and ${b.rover.name} are nearly equal on this route.`;
}

export const isMissionEnded = (id: RoverId | string) =>
  NASA_MOON_ROVERS.find((r) => r.id === id)?.status === 'HISTORICAL_COMPLETED';
