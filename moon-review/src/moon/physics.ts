import { DEG, normLon180, normLon360 } from '../core/geo/sphere';
import { AtmosphericEstimate } from '../core/planet/types';
import { MOON_BODY } from './constants';

/**
 * Compute deterministic Moon atmospheric & equinox solar estimates at a given
 * latitude and LOLA elevation (m), following the physical models documented in
 * SERVER.md with explicit provenance and limitations.
 */
export function computeMoonAtmosphere(latDeg: number, elevationM: number | null, dustOpticalDepth = 0.5): AtmosphericEstimate {
  const cosLat = Math.max(0, Math.cos(Math.abs(latDeg) * DEG));
  const equinoxNoonIrradianceWm2 =
    cosLat > 0.02
      ? Math.round(MOON_BODY.solarIrradianceWm2 * cosLat * Math.exp(-dustOpticalDepth / Math.max(0.08, cosLat)) * 10) / 10
      : 0;

  if (elevationM === null || !Number.isFinite(elevationM)) {
    return {
      surfacePressurePa: null,
      atmosphericColumnKgM2: null,
      equinoxNoonIrradianceWm2,
      provenance: 'heuristic',
      modelNotes: [
        'Elevation unavailable; barometric pressure cannot be evaluated.',
        `Equinox local-noon horizontal irradiance uses NASA mean Moon solar constant 586.2 W/m² and Beer–Lambert extinction (τ = ${dustOpticalDepth}).`,
      ],
    };
  }

  // NASA Glenn Moon Atmosphere Model: P = 699 * exp(-0.00009 * h) Pa
  const surfacePressurePa = Math.round(699 * Math.exp(-0.00009 * elevationM) * 10) / 10;
  const atmosphericColumnKgM2 = Math.round((surfacePressurePa / MOON_BODY.surfaceGravityMps2) * 10) / 10;

  return {
    surfacePressurePa,
    atmosphericColumnKgM2,
    equinoxNoonIrradianceWm2,
    provenance: 'heuristic',
    modelNotes: [
      'Barometric pressure derived from NASA Glenn exponential atmosphere curve P(h) = 699·exp(−0.00009·h) Pa using LOLA elevation h; not live meteorological telemetry.',
      'Atmospheric mass column = P / g_Moon (3.721 m/s²); indicates aerodynamic deceleration & shielding column, not biological radiation dose.',
      `Equinox local-noon horizontal direct beam = 586.2·cos(|φ|)·exp(−τ/cos(|φ|)) W/m² with assumed dust optical depth τ = ${dustOpticalDepth}.`,
    ],
  };
}

export function formatLat(lat: number, digits = 2): string {
  const abs = Math.abs(lat).toFixed(digits);
  return `${abs}°${lat >= 0 ? 'N' : 'S'}`;
}

export function formatLon(lon: number, digits = 2): string {
  const l = normLon180(lon);
  const abs = Math.abs(l).toFixed(digits);
  return `${abs}°${l >= 0 ? 'E' : 'W'} (${normLon360(l).toFixed(digits)}°E)`;
}

export function formatLatLonShort(lat: number, lon: number, digits = 2): string {
  const l = normLon180(lon);
  return `${Math.abs(lat).toFixed(digits)}°${lat >= 0 ? 'N' : 'S'}, ${Math.abs(l).toFixed(digits)}°${l >= 0 ? 'E' : 'W'}`;
}
