import { normLon180, normLon360 } from '../core/geo/sphere';
import { LandingSiteWeights } from '../core/planet/types';
import { classifyTerrain } from '../core/terrain/classify';
import { computeSlope, computeTRI, ElevationGrid, sampleArray, sampleElevation } from '../core/terrain/grid';
import { MOON_BODY } from './constants';

export interface ClientGlobalDem {
  grid: ElevationGrid;
  slope: Float32Array;
  tri: Float32Array;
  classes: Uint8Array;
}

let cachedGlobalDem: Promise<ClientGlobalDem> | null = null;

/**
 * Load the bundled 4 PPD NASA PDS LOLA global elevation grid (`megt90n000cb.img`,
 * 1440 x 720, MSB Int16, 0..360E shifted to -180..180E) for 3D globe vertex
 * displacement, surface-clamped 3D route rendering, and global scientific layer
 * synthesis.
 */
export function loadClientGlobalDem(): Promise<ClientGlobalDem> {
  if (cachedGlobalDem) return cachedGlobalDem;
  cachedGlobalDem = (async () => {
    const res = await fetch('./data/megt90n000cb.img');
    if (!res.ok) {
      throw new Error(`Failed to load LOLA 4 PPD global DEM (HTTP ${res.status})`);
    }
    const buf = await res.arrayBuffer();
    const view = new DataView(buf);
    const width = 1440;
    const height = 720;
    const halfW = width / 2; // 720 columns = 180 deg

    // Shift columns so column 0 is -180°E and column 1439 is +180°E, matching Moon Trek WMTS
    const elevation = new Float32Array(width * height);
    for (let r = 0; r < height; r++) {
      for (let c = 0; c < width; c++) {
        const srcCol = (c + halfW) % width; // srcCol 0 is 0°E, srcCol 720 is 180°E
        elevation[r * width + c] = view.getInt16((r * width + srcCol) * 2, false);
      }
    }

    const grid: ElevationGrid = {
      width,
      height,
      north: 90,
      west: -180,
      dLat: 180 / height, // 0.25 deg
      dLon: 360 / width, // 0.25 deg
      elevation,
    };

    const slope = computeSlope(grid, MOON_BODY.meanRadiusM);
    const tri = computeTRI(grid);
    const classes = classifyTerrain(slope, tri, {
      flatSlope: 1.5,
      steepSlope: 6.0,
      roughTRI: 120,
    });

    return { grid, slope, tri, classes };
  })();
  return cachedGlobalDem;
}

export function sampleGlobalElevationM(dem: ClientGlobalDem | null, lat: number, lon: number): number {
  if (!dem) return 0;
  const v = sampleElevation(dem.grid, lat, normLon180(lon));
  return Number.isFinite(v) ? v : 0;
}

export function sampleGlobalSlopeDeg(dem: ClientGlobalDem | null, lat: number, lon: number): number {
  if (!dem) return 0;
  const v = sampleArray(dem.grid, dem.slope, lat, normLon180(lon));
  return Number.isFinite(v) ? v : 0;
}

export type SurfaceLayerId =
  | 'mro_ctx_mosaic'
  | 'jezero_hirise_25cm'
  | 'viking_color'
  | 'hrsc_lola_blend'
  | 'lola_shaded'
  | 'lola_hypsometric'
  | 'lola_roughness_wmts'
  | 'suitability_heatmap'
  | 'slope_hazard'
  | 'roughness_tri'
  | 'terrain_class';

export type ImageryLayerId =
  | 'mro_ctx_mosaic'
  | 'jezero_hirise_25cm'
  | 'viking_color'
  | 'hrsc_lola_blend'
  | 'lola_shaded'
  | 'lola_roughness_wmts';

export function isWmtsImageryLayer(layer: SurfaceLayerId): layer is ImageryLayerId {
  return (
    layer === 'mro_ctx_mosaic' ||
    layer === 'jezero_hirise_25cm' ||
    layer === 'viking_color' ||
    layer === 'hrsc_lola_blend' ||
    layer === 'lola_shaded' ||
    layer === 'lola_roughness_wmts'
  );
}

export interface SurfaceLayerMeta {
  id: SurfaceLayerId;
  name: string;
  shortLabel: string;
  source: string;
  resolution: string;
  provenance: 'measured' | 'derived';
  description: string;
  legend: { label: string; color: string }[];
}

export const SURFACE_LAYERS: SurfaceLayerMeta[] = [
  {
    id: 'mro_ctx_mosaic',
    name: 'Caltech Global CTX Panchromatic Mosaic (~5 m/px) + 3D DTM Relief',
    shortLabel: 'Caltech CTX (~5m Grayscale)',
    source: 'Caltech Murray Lab Global CTX V01 WMTS + HiRISE/CTX Stereo DTM Hillshade',
    resolution: '~5 m/px Orbital Panchromatic + Measured 3D DTM Geometry',
    provenance: 'measured',
    description:
      'High-resolution grayscale panchromatic MRO Context Camera (CTX ~5 m/px) mosaic draped over measured 3D HiRISE/CTX/LOLA terrain geometry with oblique directional hillshading.',
    legend: [
      { label: 'Dark Mafic / Dune Sands', color: '#27272a' },
      { label: 'Crater Floor Basaltic Plains', color: '#71717a' },
      { label: 'Layered Delta & Fan Outcrops', color: '#d4d4d8' },
      { label: 'Sunlit Escarpments & Rims', color: '#f4f4f5' },
    ],
  },
  {
    id: 'jezero_hirise_25cm',
    name: 'Jezero HiRISE 25 cm Orthoimage Mosaic + Co-Registered 1 m Stereo DTM',
    shortLabel: 'Jezero HiRISE Ortho (25cm)',
    source: 'NASA Moon Trek WMTS (JEZ_hirise_soc_006_orthoMosaic_25cm) + USGS HiRISE 1m DTM',
    resolution: '0.25 m/px Orthoimage + 1.02 m/px HiRISE Stereo DTM (LOD 3)',
    provenance: 'measured',
    description:
      'Ultra-high-resolution 25 cm/px Jezero Crater HiRISE orthoimage mosaic draped over co-registered 1.02 m/px HiRISE SOCET stereo DTMs (with CTX 5 m regional fallback outside Jezero).',
    legend: [
      { label: '25 cm HiRISE Ortho Coverage', color: '#38bdf8' },
      { label: 'Delta Front Layered Scarps', color: '#cbd5e1' },
      { label: 'Boulder Fields & Megabreccia', color: '#94a3b8' },
      { label: 'CTX 5 m Regional Context', color: '#52525b' },
    ],
  },
  {
    id: 'viking_color',
    name: 'Natural lunar Color + CTX/HiRISE Panchromatic Detail Fusion',
    shortLabel: 'Natural Moon Color + CTX',
    source: 'NASA Moon Trek Viking MDIM 2.1 Color + Caltech CTX 5 m Detail Fusion',
    resolution: '232 m/px Color Chromaticity + 5 m/px CTX Luminance Detail',
    provenance: 'measured',
    description:
      'Natural warm lunar ochre/basalt color mosaic pan-sharpened in regional/local views with 5 m/px CTX and 25 cm/px HiRISE orbital detail over 3D terrain relief.',
    legend: [
      { label: 'Low Albedo Mafic Sands', color: '#4a3528' },
      { label: 'Intermediate Crater Floor', color: '#9c5a3c' },
      { label: 'Ferric Oxide / Delta Sediments', color: '#d4875e' },
      { label: 'Bright Escarpment / Frost', color: '#e5e7eb' },
    ],
  },
  {
    id: 'hrsc_lola_blend',
    name: 'ESA HRSC + NASA LOLA Blended Color Hillshade (200 m/px)',
    shortLabel: 'HRSC+LOLA Blend (200m)',
    source: 'NASA Moon Trek WMTS (Moon_LOLA_blend200ppx_HRSC_ClrShade_clon0dd_200mpp_lzw)',
    resolution: '200 m/px Blended HRSC Stereo + LOLA Altimetry',
    provenance: 'measured',
    description:
      'Official USGS/NASA/DLR 200 m/px blended Moon Express HRSC and MGS LOLA colorized shaded relief.',
    legend: [
      { label: 'Deep Basins (−8..−4 km)', color: '#1d4ed8' },
      { label: 'Northern Plains (−4..−1 km)', color: '#0ea5e9' },
      { label: 'Transition (−1..+2 km)', color: '#84cc16' },
      { label: 'Southern Highlands (+2..+8 km)', color: '#ea580c' },
    ],
  },
  {
    id: 'lola_shaded',
    name: 'NASA MGS LOLA Global Colorized Shaded Relief (463 m/px)',
    shortLabel: 'LOLA Shaded Relief (463m)',
    source: 'NASA Moon Trek WMTS (Moon_MGS_LOLA_ClrShade_merge_global_463m)',
    resolution: '463 m/px WMTS Topographic Mosaic (128 PPD)',
    provenance: 'measured',
    description: 'Official NASA MGS LOLA hypsometric shaded-relief mosaic from Moon Trek.',
    legend: [
      { label: '−8 km (Hellas)', color: '#1e3a8a' },
      { label: '−4 km (Lowlands)', color: '#0284c7' },
      { label: '0 km (Areoid)', color: '#22c55e' },
      { label: '+4 km (Highlands)', color: '#eab308' },
      { label: '+12..21 km (Tharsis)', color: '#f8fafc' },
    ],
  },
  {
    id: 'lola_hypsometric',
    name: 'LOLA Analytical Hypsometry & Contours',
    shortLabel: 'Elevation + Contours',
    source: 'PDS LOLA / USGS CTX & HiRISE Stereo DTMs',
    resolution: 'Direct Metric DEM + Contour Isolines',
    provenance: 'measured',
    description: 'Quantitative elevation ramp with analytical Lambertian hillshading and contour isolines.',
    legend: [
      { label: '≤ −5,000 m', color: '#172554' },
      { label: '−2,000 m (EDL Target)', color: '#0ea5e9' },
      { label: '0 m (LOLA Datum)', color: '#4ade80' },
      { label: '+3,000 m', color: '#f59e0b' },
      { label: '≥ +10,000 m', color: '#e2e8f0' },
    ],
  },
  {
    id: 'lola_roughness_wmts',
    name: 'NASA Moon Trek Global LOLA Surface Roughness Layer',
    shortLabel: 'Moon Trek Roughness (WMTS)',
    source: 'NASA Moon Trek WMTS (lola_roughness) + Local DEM Micro-Relief',
    resolution: 'Global LOLA Pulse-Width / Differential Roughness',
    provenance: 'measured',
    description:
      'Official NASA Moon Trek lola_roughness OGC WMTS layer for preliminary planetary roughness inspection.',
    legend: [
      { label: 'Smooth Northern Plains', color: '#1e293b' },
      { label: 'Moderate Basin Floors', color: '#0ea5e9' },
      { label: 'Rough Cratered Highlands', color: '#f59e0b' },
      { label: 'Extreme Scarp / Canyon Roughness', color: '#ef4444' },
    ],
  },
  {
    id: 'suitability_heatmap',
    name: 'Multi-Criteria Landing Suitability Surface Map (Golombek et al., 2012)',
    shortLabel: 'Landing Suitability Map',
    source: 'Derived MCDA on LOLA Elevation, Horn Slope, TRI Roughness & Latitude',
    resolution: 'Continuous Multi-Criteria Decision Support Surface',
    provenance: 'derived',
    description: 'Highlights suitable low-elevation, flat, low-roughness equatorial/mid-latitude landing basins vs. hazardous scarps and highlands.',
    legend: [
      { label: '≥ 75/100 (High Suitability Basin)', color: '#10b981' },
      { label: '60–74/100 (Favorable Plains)', color: '#38bdf8' },
      { label: '45–59/100 (Marginal / Elevated)', color: '#f59e0b' },
      { label: '< 45/100 (Highland / Steep Hazard)', color: '#ef4444' },
    ],
  },
  {
    id: 'slope_hazard',
    name: 'Horn (1981) 3×3 Terrain Slope Map',
    shortLabel: 'Slope Analysis (°)',
    source: 'Derived from LOLA / Regional DEM via Horn 3×3 Operator',
    resolution: 'Latitude-Corrected Finite Difference',
    provenance: 'derived',
    description: 'Local surface gradient in degrees. Highlights flat landing basins (<2°) vs. hazardous scarps (>10°).',
    legend: [
      { label: '< 1.5° (Optimal Flat)', color: '#18181b' },
      { label: '1.5° – 4° (Gentle)', color: '#0284c7' },
      { label: '4° – 8° (Moderate)', color: '#eab308' },
      { label: '8° – 15° (Steep)', color: '#f97316' },
      { label: '≥ 15° (Hazard Scarp)', color: '#ef4444' },
    ],
  },
  {
    id: 'roughness_tri',
    name: 'Terrain Ruggedness Index (Riley et al., 1999)',
    shortLabel: 'Roughness (TRI m)',
    source: 'Derived 8-Neighbour Mean |Δz| from LOLA DEM',
    resolution: 'Baseline-Explicit Vertical Roughness (m)',
    provenance: 'derived',
    description: 'Mean absolute elevation difference between each cell and its 8 adjacent cells.',
    legend: [
      { label: '< 15 m (Smooth Plains)', color: '#141414' },
      { label: '15 – 45 m (Low Relief)', color: '#0d9488' },
      { label: '45 – 100 m (Dissected)', color: '#f59e0b' },
      { label: '> 100 m (Rugged Scarp)', color: '#f43f5e' },
    ],
  },
  {
    id: 'terrain_class',
    name: 'Geomorphic Terrain Classification',
    shortLabel: 'Terrain Classes',
    source: 'Rule-Based Classification on Derived Slope & TRI',
    resolution: '4-Class Deterministic Partition',
    provenance: 'derived',
    description: 'Classifies surface into Relatively Flat, Moderate, High Roughness, and Steep Hazard zones.',
    legend: [
      { label: 'Relatively Flat (θ < 2°, Low TRI)', color: '#10b981' },
      { label: 'Moderate Terrain (2° ≤ θ < 8°)', color: '#38bdf8' },
      { label: 'High Roughness (High TRI)', color: '#f59e0b' },
      { label: 'Steep Terrain (θ ≥ 8°)', color: '#ef4444' },
    ],
  },
];

function hypsometricRgb(elevM: number): [number, number, number] {
  const stops: [number, [number, number, number]][] = [
    [-8200, [20, 34, 92]],
    [-4500, [14, 116, 178]],
    [-2000, [34, 168, 140]],
    [0, [84, 184, 92]],
    [2000, [196, 172, 68]],
    [6000, [186, 92, 48]],
    [12000, [148, 72, 68]],
    [21500, [242, 242, 245]],
  ];
  if (elevM <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    if (elevM <= stops[i][0]) {
      const [z0, c0] = stops[i - 1];
      const [z1, c1] = stops[i];
      const t = (elevM - z0) / (z1 - z0);
      return [
        Math.round(c0[0] + (c1[0] - c0[0]) * t),
        Math.round(c0[1] + (c1[1] - c0[1]) * t),
        Math.round(c0[2] + (c1[2] - c0[2]) * t),
      ];
    }
  }
  return stops[stops.length - 1][1];
}

function slopeRgb(slopeDeg: number): [number, number, number] {
  const stops: [number, [number, number, number]][] = [
    [0, [20, 22, 26]],
    [1.5, [28, 78, 128]],
    [3.5, [14, 155, 212]],
    [6.5, [234, 179, 8]],
    [11.0, [249, 115, 22]],
    [18.0, [239, 68, 68]],
  ];
  if (!Number.isFinite(slopeDeg) || slopeDeg <= 0) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    if (slopeDeg <= stops[i][0]) {
      const [s0, c0] = stops[i - 1];
      const [s1, c1] = stops[i];
      const t = (slopeDeg - s0) / (s1 - s0);
      return [
        Math.round(c0[0] + (c1[0] - c0[0]) * t),
        Math.round(c0[1] + (c1[1] - c0[1]) * t),
        Math.round(c0[2] + (c1[2] - c0[2]) * t),
      ];
    }
  }
  return stops[stops.length - 1][1];
}

function triRgb(triM: number, scale = 1): [number, number, number] {
  const v = triM / Math.max(0.15, scale);
  const stops: [number, [number, number, number]][] = [
    [0, [18, 20, 22]],
    [25, [16, 118, 110]],
    [65, [56, 189, 248]],
    [130, [245, 158, 11]],
    [260, [244, 63, 94]],
  ];
  if (!Number.isFinite(v) || v <= 0) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    if (v <= stops[i][0]) {
      const [x0, c0] = stops[i - 1];
      const [x1, c1] = stops[i];
      const t = (v - x0) / (x1 - x0);
      return [
        Math.round(c0[0] + (c1[0] - c0[0]) * t),
        Math.round(c0[1] + (c1[1] - c0[1]) * t),
        Math.round(c0[2] + (c1[2] - c0[2]) * t),
      ];
    }
  }
  return stops[stops.length - 1][1];
}

function classRgb(code: number): [number, number, number] {
  switch (code) {
    case 1:
      return [22, 128, 92]; // Flat
    case 2:
      return [38, 118, 168]; // Moderate
    case 3:
      return [218, 58, 58]; // Steep
    case 4:
      return [212, 138, 28]; // Rough
    default:
      return [32, 32, 36];
  }
}

function suitabilityRgb(
  elevM: number,
  slopeDeg: number,
  triM: number,
  latDeg: number,
  triScale = 1,
  weights?: LandingSiteWeights,
): [number, number, number] {
  const sScore = !Number.isFinite(slopeDeg)
    ? 0.5
    : slopeDeg <= 1.5
      ? 1.0
      : slopeDeg <= 4.0
        ? 0.85 - ((slopeDeg - 1.5) / 2.5) * 0.25
        : slopeDeg <= 10.0
          ? 0.6 - ((slopeDeg - 4.0) / 6.0) * 0.45
          : 0.08;
  const normTri = (Number.isFinite(triM) ? triM : 20) / Math.max(0.2, triScale);
  const rScore =
    normTri <= 18 ? 0.95 : normTri <= 55 ? 0.8 - ((normTri - 18) / 37) * 0.35 : normTri <= 120 ? 0.3 : 0.05;
  const eScore =
    elevM <= -2000
      ? 0.98
      : elevM <= -1000
        ? 0.82
        : elevM <= 0
          ? 0.48
          : elevM <= 2000
            ? 0.2
            : 0.04;
  const lScore = Math.abs(latDeg) <= 25 ? 0.95 : Math.abs(latDeg) <= 40 ? 0.65 : 0.18;

  const ws = weights?.slopeSafety ?? 0.25;
  const wr = weights?.roughnessSafety ?? 0.2;
  const we = weights?.elevationConstraint ?? 0.15;
  const wl = weights?.latitudeThermal ?? 0.1;
  const wSum = Math.max(0.05, ws + wr + we + wl);

  const total = (ws * sScore + wr * rScore + we * eScore + wl * lScore) / wSum;
  const stops: [number, [number, number, number]][] = [
    [0.22, [153, 27, 27]],
    [0.42, [220, 92, 30]],
    [0.58, [234, 179, 8]],
    [0.72, [14, 165, 233]],
    [0.86, [16, 185, 129]],
    [1.0, [52, 211, 153]],
  ];
  if (total <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    if (total <= stops[i][0]) {
      const [v0, c0] = stops[i - 1];
      const [v1, c1] = stops[i];
      const t = (total - v0) / (v1 - v0);
      return [
        Math.round(c0[0] + (c1[0] - c0[0]) * t),
        Math.round(c0[1] + (c1[1] - c0[1]) * t),
        Math.round(c0[2] + (c1[2] - c0[2]) * t),
      ];
    }
  }
  return stops[stops.length - 1][1];
}

/**
 * Render a scientific data canvas from any `ElevationGrid` + `slope` + `tri` + `classes`.
 */
export function renderScientificLayerCanvas(
  grid: ElevationGrid,
  slope: Float32Array,
  tri: Float32Array,
  classes: Uint8Array,
  layer: SurfaceLayerId,
  triScale = 1,
  weights?: LandingSiteWeights,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = grid.width;
  canvas.height = grid.height;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(grid.width, grid.height);
  const data = img.data;
  const W = grid.width;
  const H = grid.height;
  const z = grid.elevation;

  for (let r = 0; r < H; r++) {
    const rm = Math.max(0, r - 1);
    const rp = Math.min(H - 1, r + 1);
    for (let c = 0; c < W; c++) {
      const idx = r * W + c;
      const cm = (c - 1 + W) % W;
      const cp = (c + 1) % W;

      // Analytical hillshade from NW sun
      const dzdx = z[r * W + cp] - z[r * W + cm];
      const dzdy = z[rp * W + c] - z[rm * W + c];
      const shade = Math.max(0.42, Math.min(1.28, 0.88 - dzdx * 0.00028 - dzdy * 0.00022));

      let rgb: [number, number, number];
      if (layer === 'lola_hypsometric') {
        rgb = hypsometricRgb(z[idx]);
        // 1,000 m contour lines
        const band = Math.floor(z[idx] / 1000);
        const bandR = Math.floor(z[r * W + cp] / 1000);
        const bandD = Math.floor(z[rp * W + c] / 1000);
        if (band !== bandR || band !== bandD) {
          rgb = [Math.round(rgb[0] * 0.55), Math.round(rgb[1] * 0.55), Math.round(rgb[2] * 0.55)];
        }
      } else if (layer === 'suitability_heatmap') {
        const cellLat = grid.north - (r + 0.5) * grid.dLat;
        rgb = suitabilityRgb(z[idx], slope[idx], tri[idx], cellLat, triScale, weights);
      } else if (layer === 'slope_hazard') {
        rgb = slopeRgb(slope[idx]);
      } else if (layer === 'roughness_tri') {
        rgb = triRgb(tri[idx], triScale);
      } else if (layer === 'terrain_class') {
        rgb = classRgb(classes[idx]);
      } else {
        rgb = hypsometricRgb(z[idx]);
      }

      const p = idx * 4;
      data[p] = Math.min(255, Math.round(rgb[0] * shade));
      data[p + 1] = Math.min(255, Math.round(rgb[1] * shade));
      data[p + 2] = Math.min(255, Math.round(rgb[2] * shade));
      data[p + 3] = 255;
    }
  }

  ctx.putImageData(img, 0, 0);
  return canvas;
}

const wmtsTileCache = new Map<string, HTMLImageElement>();
const MAX_TILE_CACHE = 320;

function getDirectWmtsTileUrl(
  source:
    | 'ctx_caltech'
    | 'hirise_jezero'
    | 'hrsc_lola_blend'
    | 'lola_shaded'
    | 'lola_roughness'
    | 'viking_color',
  z: number,
  r: number,
  c: number,
): string {
  switch (source) {
    case 'ctx_caltech':
      return `https://astro.arcgis.com/arcgis/rest/services/OnMoon/CTX/MapServer/tile/${z}/${r}/${c}`;
    case 'hirise_jezero':
      return `https://trek.nasa.gov/tiles/Moon/EQ/JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first_dd/1.0.0/default/default028mm/${z}/${r}/${c}.png`;
    case 'hrsc_lola_blend':
      return `https://trek.nasa.gov/tiles/Moon/EQ/Moon_LOLA_blend200ppx_HRSC_ClrShade_clon0dd_200mpp_lzw/1.0.0/default/default028mm/${z}/${r}/${c}.jpg`;
    case 'lola_shaded':
      return `https://trek.nasa.gov/tiles/Moon/EQ/Moon_MGS_LOLA_ClrShade_merge_global_463m/1.0.0/default/default028mm/${z}/${r}/${c}.jpg`;
    case 'lola_roughness':
      return `https://trek.nasa.gov/tiles/Moon/EQ/lola_roughness/1.0.0/default/default028mm/${z}/${r}/${c}.png`;
    case 'viking_color':
    default:
      return `https://trek.nasa.gov/tiles/Moon/EQ/Moon_Viking_MDIM21_ClrMosaic_global_232m/1.0.0/default/default028mm/${z}/${r}/${c}.jpg`;
  }
}

function getWmtsTileUrl(
  source:
    | 'ctx_caltech'
    | 'hirise_jezero'
    | 'hrsc_lola_blend'
    | 'lola_shaded'
    | 'lola_roughness'
    | 'viking_color',
  z: number,
  r: number,
  c: number,
): string {
  return `./api/moon/wmts-tile?source=${source}&z=${z}&r=${r}&c=${c}`;
}

function loadCachedTileImage(
  url: string,
  fallbackUrl?: string,
): Promise<HTMLImageElement | null> {
  const cached = wmtsTileCache.get(url);
  if (cached) {
    return Promise.resolve(cached);
  }
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (wmtsTileCache.size >= MAX_TILE_CACHE) {
        const firstKey = wmtsTileCache.keys().next().value;
        if (firstKey) wmtsTileCache.delete(firstKey);
      }
      wmtsTileCache.set(url, img);
      resolve(img);
    };
    img.onerror = () => {
      if (fallbackUrl) {
        const fbImg = new Image();
        fbImg.crossOrigin = 'anonymous';
        fbImg.onload = () => {
          wmtsTileCache.set(url, fbImg);
          resolve(fbImg);
        };
        fbImg.onerror = () => resolve(null);
        fbImg.src = fallbackUrl;
      } else {
        resolve(null);
      }
    };
    img.src = url;
  });
}

/**
 * Stitch the 32 cached Zoom-2 tiles (`8 x 4` = `2048 x 1024`) from local
 * `public/data/tiles/{viking_z2|lola_z2}` or live NASA Moon Trek / Caltech CTX WMTS endpoints.
 */
export async function loadMoonTrekMosaicCanvas(
  layer: ImageryLayerId,
): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas');
  canvas.width = 2048;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#2a1c15';
  ctx.fillRect(0, 0, 2048, 1024);

  if (layer === 'lola_roughness_wmts') {
    // lola_roughness WMTS has max zoom = 1 (4 cols x 2 rows)
    const jobs: Promise<void>[] = [];
    for (let r = 0; r < 2; r++) {
      for (let c = 0; c < 4; c++) {
        jobs.push(
          loadCachedTileImage(getWmtsTileUrl('lola_roughness', 1, r, c)).then((img) => {
            if (img) ctx.drawImage(img, c * 512, r * 512, 512, 512);
          }),
        );
      }
    }
    await Promise.all(jobs);
    return canvas;
  }

  const useLocalCache = layer === 'viking_color' || layer === 'lola_shaded';
  const localFolder = layer === 'lola_shaded' ? 'lola_z2' : 'viking_z2';
  const wmtsSource =
    layer === 'lola_shaded'
      ? 'lola_shaded'
      : layer === 'hrsc_lola_blend'
        ? 'hrsc_lola_blend'
        : layer === 'mro_ctx_mosaic' || layer === 'jezero_hirise_25cm'
          ? 'ctx_caltech'
          : 'viking_color';

  const loadTile = (row: number, col: number): Promise<void> =>
    new Promise((resolve) => {
      if (useLocalCache) {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          ctx.drawImage(img, col * 256, row * 256, 256, 256);
          resolve();
        };
        img.onerror = () => {
          loadCachedTileImage(getWmtsTileUrl(wmtsSource, 2, row, col)).then((liveImg) => {
            if (liveImg) ctx.drawImage(liveImg, col * 256, row * 256, 256, 256);
            resolve();
          });
        };
        img.src = `./data/tiles/${localFolder}/${row}_${col}.jpg`;
      } else {
        loadCachedTileImage(getWmtsTileUrl(wmtsSource, 2, row, col)).then((liveImg) => {
          if (liveImg) {
            ctx.drawImage(liveImg, col * 256, row * 256, 256, 256);
            resolve();
          } else {
            // Fallback to local viking_z2 if offline
            const fallbackImg = new Image();
            fallbackImg.crossOrigin = 'anonymous';
            fallbackImg.onload = () => {
              ctx.drawImage(fallbackImg, col * 256, row * 256, 256, 256);
              resolve();
            };
            fallbackImg.onerror = () => resolve();
            fallbackImg.src = `./data/tiles/${localFolder}/${row}_${col}.jpg`;
          }
        });
      }
    });

  const jobs: Promise<void>[] = [];
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 8; c++) {
      jobs.push(loadTile(r, c));
    }
  }
  await Promise.all(jobs);

  if (layer === 'mro_ctx_mosaic') {
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = imgData.data;
    for (let i = 0; i < d.length; i += 4) {
      const lum = 0.35 * d[i] + 0.5 * d[i + 1] + 0.15 * d[i + 2];
      const contrast = Math.max(0, Math.min(255, Math.round((lum - 118) * 1.38 + 124)));
      d[i] = contrast;
      d[i + 1] = contrast;
      d[i + 2] = Math.min(255, contrast + 2);
    }
    ctx.putImageData(imgData, 0, 0);
  } else if (layer === 'jezero_hirise_25cm') {
    // Apply natural warm lunar regolith color grading at global scale
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = imgData.data;
    for (let i = 0; i < d.length; i += 4) {
      const lum = (0.35 * d[i] + 0.5 * d[i + 1] + 0.15 * d[i + 2]) / 255;
      const g = Math.pow(Math.max(0, Math.min(1, lum)), 0.92);
      d[i] = Math.min(255, Math.round(g * 218 + 16));
      d[i + 1] = Math.min(255, Math.round(g * 154 + 10));
      d[i + 2] = Math.min(255, Math.round(g * 114 + 8));
    }
    ctx.putImageData(imgData, 0, 0);
  }

  return canvas;
}

async function drawWmtsLayerToCanvas(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  bbox: { south: number; north: number; west: number; east: number },
  source:
    | 'ctx_caltech'
    | 'hirise_jezero'
    | 'hrsc_lola_blend'
    | 'lola_shaded'
    | 'lola_roughness'
    | 'viking_color',
  zoom: number,
): Promise<number> {
  const matrixW = 2 * Math.pow(2, zoom);
  const matrixH = Math.pow(2, zoom);
  const degPerTileX = 360 / matrixW;
  const degPerTileY = 180 / matrixH;

  const west = normLon180(bbox.west);
  const east = normLon180(bbox.east);
  const lonSpan = Math.max(0.005, east - west);
  const latSpan = Math.max(0.005, bbox.north - bbox.south);

  const col0 = Math.max(0, Math.floor((west + 180) / degPerTileX));
  const col1 = Math.min(matrixW - 1, Math.floor((east + 180) / degPerTileX));
  const row0 = Math.max(0, Math.floor((90 - bbox.north) / degPerTileY));
  const row1 = Math.min(matrixH - 1, Math.floor((90 - bbox.south) / degPerTileY));

  let loadedCount = 0;
  const tasks: Promise<void>[] = [];
  for (let r = row0; r <= row1; r++) {
    for (let c = col0; c <= col1; c++) {
      const tileWest = -180 + c * degPerTileX;
      const tileEast = tileWest + degPerTileX;
      const tileNorth = 90 - r * degPerTileY;
      const tileSouth = tileNorth - degPerTileY;

      const x0 = ((tileWest - west) / lonSpan) * width;
      const x1 = ((tileEast - west) / lonSpan) * width;
      const y0 = ((bbox.north - tileNorth) / latSpan) * height;
      const y1 = ((bbox.north - tileSouth) / latSpan) * height;

      tasks.push(
        loadCachedTileImage(
          getWmtsTileUrl(source, zoom, r, c),
          getDirectWmtsTileUrl(source, zoom, r, c),
        ).then((img) => {
          if (img) {
            ctx.drawImage(img, x0, y0, x1 - x0 + 0.75, y1 - y0 + 0.75);
            loadedCount++;
          }
        }),
      );
    }
  }
  await Promise.all(tasks);
  return loadedCount;
}

/**
 * Load high-zoom regional NASA Moon Trek & Caltech CTX WMTS imagery covering `bbox`
 * into a 1024x1024 canvas for draping onto the Regional/Local 3D Terrain mesh,
 * modulated with analytical 3D directional hillshading from `grid` so scarps,
 * craters, and delta beds exhibit crisp, realistic relief.
 */
export async function loadRegionalMoonTrekCanvas(
  bbox: { south: number; north: number; west: number; east: number },
  layer: ImageryLayerId,
  grid?: ElevationGrid,
): Promise<HTMLCanvasElement> {
  const span = Math.max(bbox.north - bbox.south, bbox.east - bbox.west);
  const outCanvas = document.createElement('canvas');
  outCanvas.width = 1024;
  outCanvas.height = 1024;
  const outCtx = outCanvas.getContext('2d')!;
  outCtx.fillStyle = layer === 'mro_ctx_mosaic' ? '#585858' : '#73513b';
  outCtx.fillRect(0, 0, 1024, 1024);

  const overlapsJezeroHiRise =
    bbox.east >= 77.2229 &&
    bbox.west <= 77.584 &&
    bbox.north >= 18.3068 &&
    bbox.south <= 18.6693;

  if (layer === 'lola_roughness_wmts') {
    await drawWmtsLayerToCanvas(outCtx, 1024, 1024, bbox, 'lola_roughness', 1);
  } else if (layer === 'lola_shaded') {
    const z = span <= 0.6 ? 7 : span <= 1.5 ? 6 : 5;
    await drawWmtsLayerToCanvas(outCtx, 1024, 1024, bbox, 'lola_shaded', z);
  } else if (layer === 'hrsc_lola_blend') {
    const z = span <= 0.4 ? 8 : span <= 1.0 ? 7 : span <= 2.2 ? 6 : 5;
    await drawWmtsLayerToCanvas(outCtx, 1024, 1024, bbox, 'hrsc_lola_blend', z);
  } else if (layer === 'viking_color') {
    const zViking = span <= 0.8 ? 6 : 5;
    await drawWmtsLayerToCanvas(outCtx, 1024, 1024, bbox, 'viking_color', zViking);
    // Pan-sharpen Viking color with high-resolution Caltech CTX 5 m luminance
    const ctxCanvas = document.createElement('canvas');
    ctxCanvas.width = 1024;
    ctxCanvas.height = 1024;
    const ctx2d = ctxCanvas.getContext('2d')!;
    const zCtx = span <= 0.25 ? 10 : span <= 0.5 ? 9 : span <= 1.2 ? 8 : 7;
    const count = await drawWmtsLayerToCanvas(ctx2d, 1024, 1024, bbox, 'ctx_caltech', zCtx);
    if (overlapsJezeroHiRise && span <= 0.8) {
      const zHiRise = span <= 0.22 ? 11 : span <= 0.45 ? 10 : 9;
      await drawWmtsLayerToCanvas(ctx2d, 1024, 1024, bbox, 'hirise_jezero', zHiRise);
    }
    if (count > 0) {
      const colorImg = outCtx.getImageData(0, 0, 1024, 1024);
      const panImg = ctx2d.getImageData(0, 0, 1024, 1024);
      const cd = colorImg.data;
      const pd = panImg.data;
      for (let i = 0; i < cd.length; i += 4) {
        const panLum = (0.33 * pd[i] + 0.5 * pd[i + 1] + 0.17 * pd[i + 2]) / 255;
        if (panLum > 0.02) {
          const baseLum = Math.max(0.12, (0.33 * cd[i] + 0.5 * cd[i + 1] + 0.17 * cd[i + 2]) / 255);
          const ratio = 0.35 + 0.65 * (panLum / baseLum);
          cd[i] = Math.min(255, Math.round(cd[i] * ratio));
          cd[i + 1] = Math.min(255, Math.round(cd[i + 1] * ratio));
          cd[i + 2] = Math.min(255, Math.round(cd[i + 2] * ratio));
        }
      }
      outCtx.putImageData(colorImg, 0, 0);
    }
  } else {
    // 'mro_ctx_mosaic' or 'jezero_hirise_25cm'
    // 1. Base high-res Caltech CTX 5 m mosaic across the entire bbox
    const zCtx = span <= 0.22 ? 10 : span <= 0.45 ? 9 : span <= 1.0 ? 8 : span <= 2.2 ? 7 : 6;
    await drawWmtsLayerToCanvas(outCtx, 1024, 1024, bbox, 'ctx_caltech', zCtx);

    // 2. Overlay Jezero 25 cm HiRISE Orthoimage Mosaic where intersecting
    if (overlapsJezeroHiRise) {
      const zHiRise = span <= 0.22 ? 11 : span <= 0.42 ? 10 : span <= 0.9 ? 9 : 8;
      await drawWmtsLayerToCanvas(outCtx, 1024, 1024, bbox, 'hirise_jezero', zHiRise);
    }
  }

  // Apply analytical 3D directional hillshading and tonal grading from the underlying ElevationGrid
  if (grid) {
    const W = grid.width;
    const H = grid.height;
    const z = grid.elevation;
    const dLat = (bbox.north - bbox.south) / Math.max(1, H - 1);
    const dLon = (bbox.east - bbox.west) / Math.max(1, W - 1);
    const midLatRad = (((bbox.north + bbox.south) * 0.5) * Math.PI) / 180;
    const metersPerDegLat = (MOON_BODY.meanRadiusM * Math.PI) / 180;
    const mPerPixelY = Math.max(0.5, dLat * metersPerDegLat);
    const mPerPixelX = Math.max(0.5, dLon * metersPerDegLat * Math.max(0.15, Math.cos(midLatRad)));

    // Low-angle NW/WNW solar illumination (Azimuth 305 deg, Altitude 32 deg) for crisp scarp & crater relief
    const az = (305 * Math.PI) / 180;
    const alt = (32 * Math.PI) / 180;
    const lx = Math.cos(alt) * Math.sin(az);
    const ly = -Math.cos(alt) * Math.cos(az);
    const lz = Math.sin(alt);
    // Exaggerate slope normal slightly for visual clarity at orbital/regional scales
    const zFactor = span <= 0.35 ? 1.85 : span <= 1.0 ? 2.4 : 3.2;

    const imgData = outCtx.getImageData(0, 0, 1024, 1024);
    const d = imgData.data;

    for (let py = 0; py < 1024; py++) {
      const gy = (py / 1023) * (H - 1);
      const r = Math.min(H - 1, Math.max(0, Math.round(gy)));
      const rm = Math.max(0, r - 1);
      const rp = Math.min(H - 1, r + 1);
      const dy = (rp - rm) * mPerPixelY;

      for (let px = 0; px < 1024; px++) {
        const gx = (px / 1023) * (W - 1);
        const c = Math.min(W - 1, Math.max(0, Math.round(gx)));
        const cm = Math.max(0, c - 1);
        const cp = Math.min(W - 1, c + 1);
        const dx = (cp - cm) * mPerPixelX;

        const dzdx = ((z[r * W + cp] - z[r * W + cm]) / dx) * zFactor;
        const dzdy = ((z[rp * W + c] - z[rm * W + c]) / dy) * zFactor;
        const invNorm = 1 / Math.sqrt(dzdx * dzdx + dzdy * dzdy + 1);
        const nx = -dzdx * invNorm;
        const ny = -dzdy * invNorm;
        const nz = invNorm;

        const dot = Math.max(0, nx * lx + ny * ly + nz * lz);
        const shade = 0.42 + 0.82 * dot;

        const p = (py * 1024 + px) * 4;
        if (layer === 'mro_ctx_mosaic') {
          // Crisp high-contrast panchromatic grayscale (Reference Image 2 style)
          const rawLum = 0.33 * d[p] + 0.5 * d[p + 1] + 0.17 * d[p + 2];
          const normLum = rawLum > 8 ? (rawLum - 118) * 1.24 + 132 : 132;
          const v = Math.max(10, Math.min(252, Math.round(normLum * shade)));
          d[p] = v;
          d[p + 1] = v;
          d[p + 2] = v;
        } else if (layer === 'jezero_hirise_25cm') {
          // Warm natural lunar regolith color-graded HiRISE + CTX (Reference Image 3 style)
          const rawLum = (0.33 * d[p] + 0.5 * d[p + 1] + 0.17 * d[p + 2]) / 255;
          const baseLum = rawLum > 0.03 ? Math.pow(rawLum, 0.9) : 0.52;
          const lit = Math.max(0.06, Math.min(1.18, baseLum * shade));
          d[p] = Math.min(255, Math.round(lit * 214 + 14));
          d[p + 1] = Math.min(255, Math.round(lit * 149 + 8));
          d[p + 2] = Math.min(255, Math.round(lit * 108 + 5));
        } else {
          // Modulate color layers with subtle 3D topographic relief shading
          const colorShade = 0.68 + 0.46 * dot;
          d[p] = Math.min(255, Math.round(d[p] * colorShade));
          d[p + 1] = Math.min(255, Math.round(d[p + 1] * colorShade));
          d[p + 2] = Math.min(255, Math.round(d[p + 2] * colorShade));
        }
      }
    }
    outCtx.putImageData(imgData, 0, 0);
  }

  return outCanvas;
}
