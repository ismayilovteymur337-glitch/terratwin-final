/**
 * "Earth twin" for any clicked point on Moon.
 *
 * The clicked point gets a profile built only from robust signals:
 *  - inside a mapped impact crater (Robbins & Hynek 2012 catalog)       → Impact crater
 *  - a named valley (IAU "Vallis/Valles") within 60 km                  → Channels
 *  - a named volcano (IAU "Patera/Tholus") within 150 km                → Lava flows, basalt
 *  - latitude poleward of 55° (Moon Odyssey GRS ground-ice detection)    → Patterned ground, ground ice
 *  - a mission-characterised region within 250 km (Jezero, Gale, …)     → its published minerals and context
 *  - otherwise the global Moon surface default: basalt and fine dust
 * The profile is then ranked against the Earth analog library (see analogs.ts).
 * Every inference is listed in `basis`, so the user sees why the twin was chosen.
 */
import { LandingSiteAnalysis } from '../core/planet/types';
import { AnalogMatch, EnvLevels, HabTag, MineralTag, MorphTag, rankAnalogs, TARGETS, TargetSite } from './analogs';

const R_MOON_KM = 3389.5;

function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * R_MOON_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface PointTwin {
  profile: TargetSite;
  basis: string[];
  matches: AnalogMatch[];
  /** The nearest mission-characterised region used for minerals, if any. */
  nearestRegion: { name: string; distanceKm: number } | null;
  pressureRatio: number | null;
}

export function earthTwinForSite(site: LandingSiteAnalysis): PointTwin {
  const lat = site.lat;
  const lon = site.lon;
  const morphology = new Set<MorphTag>();
  const mineralogy = new Set<MineralTag>();
  const habitability = new Set<HabTag>();
  const basis: string[] = [];

  // Mission-characterised region nearby
  let nearestRegion: { target: TargetSite; distanceKm: number } | null = null;
  for (const t of TARGETS) {
    if (t.body !== 'moon') continue;
    const d = distanceKm(lat, lon, t.lat, t.lon);
    if (!nearestRegion || d < nearestRegion.distanceKm) nearestRegion = { target: t, distanceKm: d };
  }
  const regionUsed = nearestRegion && nearestRegion.distanceKm <= 250 ? nearestRegion : null;
  if (regionUsed) {
    regionUsed.target.mineralogy.forEach((m) => mineralogy.add(m));
    regionUsed.target.habitability.forEach((h) => habitability.add(h));
    regionUsed.target.morphology.forEach((m) => morphology.add(m));
    basis.push(
      `${Math.round(regionUsed.distanceKm)} km from ${regionUsed.target.name}: minerals and context taken from ${regionUsed.target.mission ?? 'published'} results.`,
    );
  }

  // Impact crater
  const nc = site.craterSummary?.nearestCrater;
  if (nc && (nc.insideRim || nc.distanceKm <= (nc.diameterKm ?? 0) * 0.5)) {
    morphology.add('impact_crater');
    basis.push(`Inside a ${Math.round(nc.diameterKm ?? 0)} km crater${nc.name ? ` (${nc.name})` : ''} from the Robbins & Hynek catalog.`);
  }

  // Named valleys and volcanoes
  for (const f of site.nearbyFeatures ?? []) {
    const type = (f.type || '').toLowerCase();
    if (/vall/.test(type) && f.distanceKm <= 60) {
      if (!morphology.has('channels')) basis.push(`${f.name} (valley) is ${Math.round(f.distanceKm)} km away: water-carved channels.`);
      morphology.add('channels');
    }
    if (/(patera|tholus)/.test(type) && f.distanceKm <= 150) {
      if (!morphology.has('lava_flows')) basis.push(`${f.name} (volcano) is ${Math.round(f.distanceKm)} km away: volcanic plains.`);
      morphology.add('lava_flows');
      mineralogy.add('basalt');
    }
  }

  // Latitude: ground ice
  const absLat = Math.abs(lat);
  if (absLat >= 55) {
    morphology.add('patterned_ground');
    habitability.add('water_ice');
    basis.push(`Latitude ${absLat.toFixed(0)}°: ground ice is expected this far poleward (Moon Odyssey neutron/gamma data).`);
  }

  if (!mineralogy.size) {
    mineralogy.add('basalt');
    mineralogy.add('fine_regolith');
    basis.push('No mission-characterised region nearby: using the global Moon surface — basaltic rock under fine dust.');
  }
  if (!morphology.size) basis.push('No mapped crater, valley or volcano at this point: landforms are not compared.');

  const env: EnvLevels = {
    aridity: 0.95,
    cold: Math.min(1, 0.8 + (0.2 * absLat) / 90),
    groundIce: absLat >= 60 ? 1 : absLat >= 55 ? 0.7 : absLat >= 40 ? 0.3 : 0.1,
    uvOxidising: 0.95,
  };

  const profile: TargetSite = {
    id: 'clicked_point',
    body: 'moon',
    name: site.name || 'Selected point',
    lat,
    lon,
    summary: 'Profile built from the selected point.',
    status: 'established',
    refs: [],
    morphology: [...morphology],
    mineralogy: [...mineralogy],
    habitability: [...habitability],
    env,
  };

  const p = site.atmosphere?.surfacePressurePa;
  return {
    profile,
    basis,
    matches: rankAnalogs(profile),
    nearestRegion: regionUsed ? { name: regionUsed.target.name, distanceKm: regionUsed.distanceKm } : null,
    pressureRatio: typeof p === 'number' && p > 0 ? 101_325 / p : null,
  };
}
