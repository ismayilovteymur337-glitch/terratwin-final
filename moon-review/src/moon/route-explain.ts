/**
 * Plain-language explanation of why each of the three rover routes is (or is not) dangerous.
 * Pure arithmetic on the route analytics computed by the A* planner (LOLA-derived slope and TRI
 * roughness, flagged obstacle segments) against the selected rover's own limits. Nothing is invented.
 */
import { RoutePlanResponse, RoverRoute, RouteModeId } from '../core/planet/types';
import { NasaRoverProfile } from './rovers';

export type RiskLevel = 'low' | 'moderate' | 'high';

export interface RouteExplanation {
  id: RouteModeId;
  shortName: string;
  purpose: string;
  risk: RiskLevel;
  riskLabel: string;
  headline: string;
  dangers: string[];
  safeguards: string[];
  tradeoffs: string[];
}

export const ROUTE_SHORT_NAMES: Record<RouteModeId, string> = {
  terrain_optimized: 'Safest',
  scientific_exploration: 'Science',
  shortest: 'Direct',
};

const PURPOSE: Record<RouteModeId, string> = {
  terrain_optimized: 'Avoids steep and rough ground, even if the drive gets longer.',
  scientific_exploration: 'Detours past geological targets worth studying, within the rover’s limits.',
  shortest: 'Shortest drive between A and B; accepts whatever terrain lies on the straight line.',
};

const f1 = (x: number) => (Math.round(x * 10) / 10).toString();
const pctDiff = (a: number, b: number) => (b > 0 ? Math.round(((a - b) / b) * 100) : 0);

export function explainRoute(route: RoverRoute, plan: RoutePlanResponse, rover: NasaRoverProfile): RouteExplanation {
  const a = route.analytics;
  const limit = plan.effectiveMaxSlopeDeg;
  const cruise = rover.mobilityProfile.optimalSlopeDeg;
  const others = plan.routes.filter((r) => r.id !== route.id);
  const dangers: string[] = [];
  const safeguards: string[] = [];
  const tradeoffs: string[] = [];
  let score = 0;

  // 1. Steepest grade against the rover's limit
  const share = limit > 0 ? a.maxSlopeDeg / limit : 0;
  if (share >= 0.9) {
    dangers.push(`Steepest grade ${f1(a.maxSlopeDeg)}° is ${Math.round(share * 100)}% of ${rover.name}'s ${f1(limit)}° limit — almost no margin for wheel slip or tipping.`);
    score += 3;
  } else if (share >= 0.7) {
    dangers.push(`Steepest grade ${f1(a.maxSlopeDeg)}° uses ${Math.round(share * 100)}% of the ${f1(limit)}° limit — drivable, but slip must be watched.`);
    score += 1.5;
  } else {
    safeguards.push(`Steepest grade ${f1(a.maxSlopeDeg)}° stays well under the ${f1(limit)}° limit (${Math.round(share * 100)}% of it).`);
  }

  // 2. How much of the drive is above cruise grade (p95)
  if (a.p95SlopeDeg > cruise) {
    dangers.push(`The steepest 5% of the drive is above ${f1(a.p95SlopeDeg)}°, more than the ${f1(cruise)}° comfortable cruise grade: slower driving and more energy.`);
    score += 1;
  } else {
    safeguards.push(`95% of the drive is gentler than ${f1(a.p95SlopeDeg)}°, within the ${f1(cruise)}° cruise grade.`);
  }

  // 3. Flagged hazard segments
  const obs = a.obstaclesAlongRoute;
  const nearLimit = obs.filter((o) => o.severity === 'limit_near');
  const caution = obs.filter((o) => o.severity === 'caution');
  if (nearLimit.length) {
    const first = nearLimit[0];
    dangers.push(`${nearLimit.length} segment(s) close to the rover's limits, first at km ${f1(first.alongRouteKm)} (${first.valueLabel}): ${first.description}`);
    score += 2 + Math.min(2, nearLimit.length * 0.5);
  }
  if (caution.length) {
    dangers.push(`${caution.length} caution segment(s) steeper than the cruise grade.`);
    score += Math.min(2, caution.length * 0.4);
  }
  if (!obs.length) safeguards.push('No hazard segments flagged along the whole route.');

  // 4. Roughness compared with the other two routes
  const roughest = Math.max(...plan.routes.map((r) => r.analytics.meanTriM));
  const smoothest = Math.min(...plan.routes.map((r) => r.analytics.meanTriM));
  if (plan.routes.length > 1 && a.meanTriM === roughest && roughest > smoothest * 1.15) {
    dangers.push(`Roughest of the three routes: mean roughness (TRI) ${f1(a.meanTriM)} m vs ${f1(smoothest)} m on the smoothest — more wheel wear and rock strikes.`);
    score += 1;
  } else if (a.meanTriM === smoothest) {
    safeguards.push(`Smoothest of the three routes (mean TRI ${f1(a.meanTriM)} m).`);
  }

  // 5. Climbing
  const minGain = Math.min(...plan.routes.map((r) => r.analytics.totalElevationGainM));
  if (a.totalElevationGainM > minGain * 1.3 && a.totalElevationGainM - minGain > 50) {
    tradeoffs.push(`Climbs ${Math.round(a.totalElevationGainM)} m in total, ${Math.round(a.totalElevationGainM - minGain)} m more than the least-climbing route: more energy per km.`);
  }

  // 6. Length and science
  const shortest = Math.min(...plan.routes.map((r) => r.analytics.totalDistanceKm));
  if (a.totalDistanceKm <= shortest) {
    tradeoffs.push(`Shortest drive of the three: ${f1(a.totalDistanceKm)} km (straight line ${f1(a.straightLineDistanceKm)} km).`);
  } else {
    const extra = a.totalDistanceKm - shortest;
    tradeoffs.push(
      extra / shortest < 0.02
        ? `${f1(a.totalDistanceKm)} km — about the same length as the shortest option (+${f1(extra)} km).`
        : `${f1(a.totalDistanceKm)} km long, ${pctDiff(a.totalDistanceKm, shortest)}% longer than the shortest option: more sols of driving.`,
    );
  }
  const sci = a.scienceTargetsAlongRoute.length;
  const maxSci = Math.max(...plan.routes.map((r) => r.analytics.scienceTargetsAlongRoute.length));
  if (sci > 0) {
    const names = a.scienceTargetsAlongRoute.slice(0, 3).map((t) => t.name).join(', ');
    tradeoffs.push(`Passes ${sci} science target(s)${names ? `: ${names}` : ''}.`);
  } else if (maxSci > 0) {
    tradeoffs.push('Passes no science targets on the way.');
  }

  const risk: RiskLevel = score >= 3.5 ? 'high' : score >= 1.5 ? 'moderate' : 'low';
  const riskLabel = risk === 'high' ? 'High risk' : risk === 'moderate' ? 'Moderate risk' : 'Low risk';

  // Headline: why this risk level, in one sentence, compared with the alternatives
  let headline: string;
  if (risk === 'low') headline = `Safe for ${rover.name}: ${safeguards[0]?.replace(/\.$/, '').toLowerCase() ?? 'gentle terrain'}.`;
  else {
    const why = dangers[0]?.split(' — ')[0].replace(/\.$/, '') ?? 'demanding terrain';
    headline = `${riskLabel} for ${rover.name}: ${why.charAt(0).toLowerCase()}${why.slice(1)}.`;
  }
  const safest = [...others, route].sort((x, y) => x.analytics.maxSlopeDeg - y.analytics.maxSlopeDeg)[0];
  if (safest && safest.id !== route.id && risk !== 'low') {
    headline += ` The ${ROUTE_SHORT_NAMES[safest.id]} route tops out at ${f1(safest.analytics.maxSlopeDeg)}° instead.`;
  }

  return {
    id: route.id,
    shortName: ROUTE_SHORT_NAMES[route.id] ?? route.name,
    purpose: PURPOSE[route.id] ?? route.priorityDescription,
    risk,
    riskLabel,
    headline,
    dangers,
    safeguards,
    tradeoffs,
  };
}

export function explainPlan(plan: RoutePlanResponse, rover: NasaRoverProfile): RouteExplanation[] {
  const order: RouteModeId[] = ['terrain_optimized', 'scientific_exploration', 'shortest'];
  return [...plan.routes]
    .sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id))
    .map((r) => explainRoute(r, plan, rover));
}
