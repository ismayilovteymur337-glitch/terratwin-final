import { LatLon, normLon180 } from './core/geo/sphere';
import { RouteModeId } from './core/planet/types';
import { SurfaceLayerId } from './moon/client-dem';
import { formatLat, formatLatLonShort, formatLon } from './moon/physics';
import { RoverId } from './moon/rovers';

export { formatLatLonShort };

export function formatLatLon(lat: number, lon: number, digits = 3): string {
  return `${formatLat(lat, digits)}, ${formatLon(lon, digits)}`;
}

export type SidebarModuleId =
  | 'overview'
  | 'explorer_3d'
  | 'ai_agent'
  | 'rover_fleet'
  | 'custom_rover'
  | 'landing_site'
  | 'route_planner'
  | 'route_comparison'
  | 'terrain_intel'
  | 'earth_analogs'
  | 'data_sources';

export type NavTab = SidebarModuleId;

export type ViewportMode = 'global_3d' | 'regional_3d';

export type ClickSelectionMode = 'inspect_site' | 'set_route_start' | 'set_route_dest';
export type MapClickMode = ClickSelectionMode;

export type InfoDetailMode = 'beginner' | 'advanced';
export type ExperienceMode = InfoDetailMode;

export function getSavedExperienceMode(): InfoDetailMode {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const saved = window.localStorage.getItem('terratwin_experience_mode');
      if (saved === 'beginner' || saved === 'advanced') {
        return saved;
      }
    }
  } catch {
    // ignore storage errors
  }
  return 'beginner';
}

export function saveExperienceMode(mode: InfoDetailMode): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem('terratwin_experience_mode', mode);
    }
  } catch {
    // ignore storage errors
  }
}

export interface CoordinateState {
  selectedLocation: LatLon;
  hoveredLocation: (LatLon & { elevationM: number; slopeDeg: number }) | null;
  routeStart: LatLon;
  routeDestination: LatLon;
  selectedRouteId: RouteModeId;
  selectedRoverId: RoverId;
  roverStudioOpen: boolean;
  activeModule: SidebarModuleId;
  viewportMode: ViewportMode;
  surfaceLayer: SurfaceLayerId;
  clickMode: ClickSelectionMode;
  infoMode: InfoDetailMode;
  exaggeration: number;
  showGraticule: boolean;
  showLandingCandidates: boolean;
  showNomenclature: boolean;
  showCraters: boolean;
  showRoutes: boolean;
}

export const INITIAL_COORDINATE_STATE: CoordinateState = {
  // Default focus on Jezero Crater (Octavia E. Butler Landing -> Western Delta & Belva Crater)
  selectedLocation: { lat: 18.4447, lon: 77.4508 },
  hoveredLocation: null,
  routeStart: { lat: 18.4447, lon: 77.4508 },
  routeDestination: { lat: 18.4720, lon: 77.4120 },
  selectedRouteId: 'terrain_optimized',
  selectedRoverId: 'perseverance',
  roverStudioOpen: false,
  activeModule: 'explorer_3d',
  viewportMode: 'global_3d',
  surfaceLayer: 'viking_color',
  clickMode: 'inspect_site',
  infoMode: getSavedExperienceMode(),
  exaggeration: 6,
  showGraticule: true,
  showLandingCandidates: true,
  showNomenclature: true,
  showCraters: true,
  showRoutes: true,
};

export function sanitizeLatLon(lat: number, lon: number): LatLon {
  return {
    lat: Math.max(-89.9, Math.min(89.9, Math.round(lat * 10000) / 10000)),
    lon: Math.round(normLon180(lon) * 10000) / 10000,
  };
}
