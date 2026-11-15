import { DEG, LatLon, normLon180, normLon360 } from './sphere';

/**
 * Official IAU 2015 / NASA PDS lunar Reference Radii (meters).
 * - LOLA MEGDR Areoid Spherical Datum: R_LOLA = 3,396,000 m
 * - IAU 2015 Equatorial Radius (49910 Equirectangular sphere): R_EQ = 3,396,190 m
 * - IAU 2015 Polar Radius: R_POLAR = 3,376,200 m
 */
export const MOON_RADII = {
  lolaSphereM: 3_396_000,
  iauEquatorialM: 3_396_190,
  iauPolarM: 3_376_200,
} as const;

export type MoonCrsCode =
  | 'IAU_2015:49910' // Moon Equirectangular (Planetocentric, East-Positive)
  | 'IAU_2015:49930' // Moon North Polar Stereographic
  | 'IAU_2015:49935' // Moon South Polar Stereographic
  | 'EPSG:104905' // Moon 2000 / IAU Planetocentric Geographic 2D
  | 'PDS_LOLA_EQUIRECT'; // NASA PDS MGS LOLA Simple Cylindrical (R = 3,396,000 m)

export interface MoonCrsDescriptor {
  code: MoonCrsCode;
  name: string;
  latitudeType: 'planetocentric' | 'planetographic';
  longitudeDirection: 'EAST_POSITIVE';
  sphereRadiusM: number;
  standardParallelDeg: number;
  centralMeridianDeg: number;
  verticalDatum: string;
}

export const MOON_CRS_CATALOG: Record<MoonCrsCode, MoonCrsDescriptor> = {
  'IAU_2015:49910': {
    code: 'IAU_2015:49910',
    name: 'Moon (2015) - Sphere / Ocentric / Equirectangular (IAU:49910)',
    latitudeType: 'planetocentric',
    longitudeDirection: 'EAST_POSITIVE',
    sphereRadiusM: MOON_RADII.iauEquatorialM,
    standardParallelDeg: 0,
    centralMeridianDeg: 0,
    verticalDatum: 'LOLA Areoid (m)',
  },
  'IAU_2015:49930': {
    code: 'IAU_2015:49930',
    name: 'Moon (2015) - Sphere / Ocentric / North Polar Stereographic (IAU:49930)',
    latitudeType: 'planetocentric',
    longitudeDirection: 'EAST_POSITIVE',
    sphereRadiusM: MOON_RADII.iauEquatorialM,
    standardParallelDeg: 90,
    centralMeridianDeg: 0,
    verticalDatum: 'LOLA Areoid (m)',
  },
  'IAU_2015:49935': {
    code: 'IAU_2015:49935',
    name: 'Moon (2015) - Sphere / Ocentric / South Polar Stereographic (IAU:49935)',
    latitudeType: 'planetocentric',
    longitudeDirection: 'EAST_POSITIVE',
    sphereRadiusM: MOON_RADII.iauEquatorialM,
    standardParallelDeg: -90,
    centralMeridianDeg: 0,
    verticalDatum: 'LOLA Areoid (m)',
  },
  'EPSG:104905': {
    code: 'EPSG:104905',
    name: 'GCS_Moon_2000_Sphere / OGC default028mm WMTS (EPSG:104905)',
    latitudeType: 'planetocentric',
    longitudeDirection: 'EAST_POSITIVE',
    sphereRadiusM: MOON_RADII.iauEquatorialM,
    standardParallelDeg: 0,
    centralMeridianDeg: 0,
    verticalDatum: 'LOLA Areoid (m)',
  },
  PDS_LOLA_EQUIRECT: {
    code: 'PDS_LOLA_EQUIRECT',
    name: 'NASA PDS MGS LOLA Simple Cylindrical (IAU 2000 Sphere R = 3,396,000 m)',
    latitudeType: 'planetocentric',
    longitudeDirection: 'EAST_POSITIVE',
    sphereRadiusM: MOON_RADII.lolaSphereM,
    standardParallelDeg: 0,
    centralMeridianDeg: 0,
    verticalDatum: 'LOLA Areoid (MEGT90N000EB v2.0)',
  },
};

/**
 * Convert Planetographic latitude (deg) to Planetocentric latitude (deg)
 * on the lunar oblate spheroid (a = 3396190 m, b = 3376200 m):
 *   tan(phi_c) = (b / a)^2 * tan(phi_g)
 */
export function planetographicToPlanetocentricLat(latGraphicDeg: number): number {
  if (Math.abs(latGraphicDeg) >= 90) return Math.sign(latGraphicDeg) * 90;
  const ratioSq = (MOON_RADII.iauPolarM / MOON_RADII.iauEquatorialM) ** 2;
  return Math.atan(ratioSq * Math.tan(latGraphicDeg * DEG)) / DEG;
}

/**
 * Convert Planetocentric latitude (deg) to Planetographic latitude (deg):
 *   tan(phi_g) = (a / b)^2 * tan(phi_c)
 */
export function planetocentricToPlanetographicLat(latCentricDeg: number): number {
  if (Math.abs(latCentricDeg) >= 90) return Math.sign(latCentricDeg) * 90;
  const invRatioSq = (MOON_RADII.iauEquatorialM / MOON_RADII.iauPolarM) ** 2;
  return Math.atan(invRatioSq * Math.tan(latCentricDeg * DEG)) / DEG;
}

/**
 * Convert West-positive longitude (0..360°W) to East-positive longitude (-180..+180°E and 0..360°E).
 */
export function westLonToEastLon(westLonDeg: number): { lon180: number; lon360: number } {
  const lon360 = normLon360(360 - (westLonDeg % 360));
  return { lon180: normLon180(lon360), lon360 };
}

/**
 * Convert East-positive longitude (-180..+180°E or 0..360°E) to West-positive longitude (0..360°W).
 */
export function eastLonToWestLon(eastLonDeg: number): number {
  const lon360 = normLon360(eastLonDeg);
  return normLon360(360 - lon360);
}

/**
 * Select the optimal IAU 2015 lunar Coordinate Reference System for a given latitude:
 * - |lat| >= 65°N -> IAU_2015:49930 (North Polar Stereographic)
 * - |lat| <= -65°S -> IAU_2015:49935 (South Polar Stereographic)
 * - Equatorial/Mid-Latitudes -> IAU_2015:49910 (Equirectangular)
 */
export function selectBestMoonCrs(latDeg: number): MoonCrsDescriptor {
  if (latDeg >= 65) return MOON_CRS_CATALOG['IAU_2015:49930'];
  if (latDeg <= -65) return MOON_CRS_CATALOG['IAU_2015:49935'];
  return MOON_CRS_CATALOG['IAU_2015:49910'];
}

/**
 * Detect lunar CRS code and parameters from a GeoTIFF WKT2 or GeoAsciiParams citation string.
 */
export function parseMoonWktCrs(wktOrAscii: string | undefined): {
  code: MoonCrsCode;
  sphereRadiusM: number;
  standardParallelDeg: number;
  centralMeridianDeg: number;
} {
  const txt = wktOrAscii || '';
  let code: MoonCrsCode = 'IAU_2015:49910';
  if (/49930|North[_\s-]*Polar[_\s-]*Stereographic/i.test(txt)) {
    code = 'IAU_2015:49930';
  } else if (/49935|South[_\s-]*Polar[_\s-]*Stereographic/i.test(txt)) {
    code = 'IAU_2015:49935';
  }

  let sphereRadiusM: number = MOON_RADII.iauEquatorialM;
  const spheroidMatch = txt.match(/SPHEROID\["[^"]+",\s*([0-9.]+)/i) || txt.match(/ELLIPSOID\["[^"]+",\s*([0-9.]+)/i);
  if (spheroidMatch) {
    const r = parseFloat(spheroidMatch[1]);
    if (r > 3_300_000 && r < 3_500_000) sphereRadiusM = r;
  }

  let standardParallelDeg = code === 'IAU_2015:49930' ? 90 : code === 'IAU_2015:49935' ? -90 : 0;
  const stdParMatch =
    txt.match(/PARAMETER\["standard_parallel_1",\s*([-0-9.]+)/i) ||
    txt.match(/PARAMETER\["Latitude of 1st standard parallel",\s*([-0-9.]+)/i);
  if (stdParMatch) {
    const sp = parseFloat(stdParMatch[1]);
    if (Number.isFinite(sp)) standardParallelDeg = sp;
  }

  let centralMeridianDeg = 0;
  const cmMatch =
    txt.match(/PARAMETER\["central_meridian",\s*([-0-9.]+)/i) ||
    txt.match(/PARAMETER\["Longitude of natural origin",\s*([-0-9.]+)/i);
  if (cmMatch) {
    const cm = parseFloat(cmMatch[1]);
    if (Number.isFinite(cm)) centralMeridianDeg = cm;
  }

  return { code, sphereRadiusM, standardParallelDeg, centralMeridianDeg };
}

/**
 * Forward projection: Planetocentric East-Positive (lat, lon) -> Projected (xMeters, yMeters)
 * in IAU_2015:49910 (Equirectangular), IAU_2015:49930 (North Polar Stereographic), or IAU_2015:49935 (South Polar Stereographic).
 */
export function moonLatLonToProjectedXY(
  latDeg: number,
  lonDeg: number,
  crsCode: MoonCrsCode = 'IAU_2015:49910',
  sphereRadiusM: number = MOON_RADII.iauEquatorialM,
  standardParallelDeg = 0,
  centralMeridianDeg = 0,
): { x: number; y: number } {
  if (crsCode === 'IAU_2015:49930') {
    // North Polar Stereographic (true scale at pole)
    const phi = latDeg * DEG;
    const lam = (lonDeg - centralMeridianDeg) * DEG;
    const k = (2 * sphereRadiusM * Math.cos(phi)) / (1 + Math.sin(phi));
    return {
      x: k * Math.sin(lam),
      y: -k * Math.cos(lam),
    };
  }
  if (crsCode === 'IAU_2015:49935') {
    // South Polar Stereographic
    const phi = latDeg * DEG;
    const lam = (lonDeg - centralMeridianDeg) * DEG;
    const k = (2 * sphereRadiusM * Math.cos(phi)) / (1 - Math.sin(phi));
    return {
      x: k * Math.sin(lam),
      y: k * Math.cos(lam),
    };
  }

  // Default: IAU_2015:49910 Moon Equirectangular
  const lon360 = centralMeridianDeg === 0 && lonDeg > 0 ? lonDeg : normLon180(lonDeg - centralMeridianDeg);
  const x = sphereRadiusM * (lon360 * DEG) * Math.cos(standardParallelDeg * DEG);
  const y = sphereRadiusM * (latDeg * DEG);
  return { x, y };
}

/**
 * Inverse projection: Projected (xMeters, yMeters) -> Planetocentric East-Positive (lat, lon)
 */
export function moonProjectedXYToLatLon(
  x: number,
  y: number,
  crsCode: MoonCrsCode = 'IAU_2015:49910',
  sphereRadiusM: number = MOON_RADII.iauEquatorialM,
  standardParallelDeg = 0,
  centralMeridianDeg = 0,
): LatLon {
  if (crsCode === 'IAU_2015:49930') {
    const rho = Math.hypot(x, y);
    if (rho < 1e-9) return { lat: 90, lon: centralMeridianDeg };
    const c = 2 * Math.atan2(rho, 2 * sphereRadiusM);
    const lat = Math.asin(Math.cos(c)) / DEG;
    const lon = normLon180(centralMeridianDeg + Math.atan2(x, -y) / DEG);
    return { lat, lon };
  }
  if (crsCode === 'IAU_2015:49935') {
    const rho = Math.hypot(x, y);
    if (rho < 1e-9) return { lat: -90, lon: centralMeridianDeg };
    const c = 2 * Math.atan2(rho, 2 * sphereRadiusM);
    const lat = -Math.asin(Math.cos(c)) / DEG;
    const lon = normLon180(centralMeridianDeg + Math.atan2(x, y) / DEG);
    return { lat, lon };
  }

  const lat = Math.max(-90, Math.min(90, y / sphereRadiusM / DEG));
  const cosTs = Math.max(0.05, Math.cos(standardParallelDeg * DEG));
  const rawLon = centralMeridianDeg + x / (sphereRadiusM * cosTs) / DEG;
  return { lat, lon: normLon180(rawLon) };
}
