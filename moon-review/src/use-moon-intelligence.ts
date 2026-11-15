import { useCallback, useEffect, useRef, useState } from 'react';
import { LatLon } from './core/geo/sphere';
import {
  CraterRecord,
  DtmCatalogEntry,
  GeologicalFeature,
  LandingSiteAnalysis,
  LandingSiteWeights,
  PlanetaryBodyConfig,
  RoutePlanResponse,
} from './core/planet/types';
import { ClientGlobalDem, loadClientGlobalDem } from './moon/client-dem';
import {
  CURIOSITY_RAD_EXCERPT,
  DEFAULT_LANDING_WEIGHTS,
  MOON_BODY,
  MOON_DATA_SOURCES,
  MOON_ROUTE_PRESETS,
  MoonDatasetSource,
  RoutePreset,
} from './moon/constants';
import {
  CustomRoverConfig,
  DEFAULT_CUSTOM_ROVER_CONFIG,
  getRoverProfile,
  NASA_MOON_ROVERS,
  NasaRoverProfile,
  RoverId,
} from './moon/rovers';
import { planMoonRoutes } from './moon/routing';

export interface RegionalTerrainPatch {
  center: LatLon;
  spanDeg: number;
  source: string;
  resolutionMeters: number;
  lodLevel?: 1 | 2 | 3;
  lodLabel?: string;
  dtmId?: string;
  crsCode?: string;
  nativeGsdMeters?: number;
  provenanceBreakdown?: {
    hirise1mPct: number;
    ctx20mPct: number;
    lola463mPct: number;
    primaryNoDataPct: number;
  };
  verticalUncertaintyMeters?: string | number;
  grid: {
    width: number;
    height: number;
    north: number;
    west: number;
    dLat: number;
    dLon: number;
    elevation: number[];
    slope: number[];
    tri: number[];
    terrainClass: number[];
  };
  classHistogram: Record<string, number>;
  availableDtms: DtmCatalogEntry[];
  craters: (CraterRecord & { distanceKm: number; insideRim: boolean })[];
  features: (GeologicalFeature & { distanceKm: number })[];
}

export interface RoutePriorityParams {
  maxAllowedSlopeDeg: number;
  slopeWeight: number;
  roughnessWeight: number;
  scienceWeight: number;
}

export function useMoonIntelligence(
  selectedLocation: LatLon,
  routeStart: LatLon,
  routeDestination: LatLon,
  selectedRoverId: RoverId,
  regionalSpanDeg: number,
  customRoverConfig: CustomRoverConfig = DEFAULT_CUSTOM_ROVER_CONFIG,
) {
  const [globalDem, setGlobalDem] = useState<ClientGlobalDem | null>(null);
  const [planet, setPlanet] = useState<PlanetaryBodyConfig>(MOON_BODY);
  const [candidates, setCandidates] = useState<LandingSiteAnalysis[]>([]);
  const [regionalCandidates, setRegionalCandidates] = useState<LandingSiteAnalysis[]>([]);
  const [rovers, setRovers] = useState<NasaRoverProfile[]>(NASA_MOON_ROVERS);
  const [selectedSite, setSelectedSite] = useState<LandingSiteAnalysis | null>(null);
  const [weights, setWeights] = useState<LandingSiteWeights>(DEFAULT_LANDING_WEIGHTS);
  const [globeFeatures, setGlobeFeatures] = useState<GeologicalFeature[]>([]);
  const [routePresets, setRoutePresets] = useState<RoutePreset[]>(MOON_ROUTE_PRESETS);
  const [dataSources, setDataSources] = useState<MoonDatasetSource[]>(MOON_DATA_SOURCES);
  const [radExcerpt, setRadExcerpt] = useState(CURIOSITY_RAD_EXCERPT);

  const [regionalPatch, setRegionalPatch] = useState<RegionalTerrainPatch | null>(null);
  const [loadingPatch, setLoadingPatch] = useState(false);

  const [routePlan, setRoutePlan] = useState<RoutePlanResponse | null>(null);
  const [loadingRoutes, setLoadingRoutes] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [routeParams, setRouteParams] = useState<RoutePriorityParams>({
    maxAllowedSlopeDeg: 20,
    slopeWeight: 1.0,
    roughnessWeight: 1.0,
    scienceWeight: 1.0,
  });

  const [loadingSite, setLoadingSite] = useState(false);

  const selectedRover = getRoverProfile(selectedRoverId, customRoverConfig);

  // 1. Load client global 4 PPD LOLA DEM and server bootstrap once
  useEffect(() => {
    loadClientGlobalDem()
      .then((dem) => setGlobalDem(dem))
      .catch((err) => console.error('Global DEM load error:', err));

    fetch('./api/moon/bootstrap')
      .then((r) => r.json())
      .then((data) => {
        if (data.planet) setPlanet(data.planet);
        if (data.candidates) setCandidates(data.candidates);
        if (data.rovers) setRovers(data.rovers);
        if (data.globeFeatures) setGlobeFeatures(data.globeFeatures);
        if (data.routePresets) setRoutePresets(data.routePresets);
        if (data.dataSources) setDataSources(data.dataSources);
        if (data.radExcerpt) setRadExcerpt(data.radExcerpt);
      })
      .catch((err) => console.error('Bootstrap error:', err));
  }, []);

  // 2. Debounced landing-site evaluation on selectedLocation or weights change
  const siteAbortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => {
      if (siteAbortRef.current) siteAbortRef.current.abort();
      const ctrl = new AbortController();
      siteAbortRef.current = ctrl;
      setLoadingSite(true);

      fetch('./api/moon/landing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lat: selectedLocation.lat,
          lon: selectedLocation.lon,
          spanDeg: regionalSpanDeg,
          weights,
        }),
        signal: ctrl.signal,
      })
        .then((r) => r.json())
        .then((data) => {
          if (data.selected) setSelectedSite(data.selected);
          if (data.regionalCandidates) setRegionalCandidates(data.regionalCandidates);
          if (data.rankedCandidates) setCandidates(data.rankedCandidates);
          setLoadingSite(false);
        })
        .catch((err) => {
          if (err.name !== 'AbortError') setLoadingSite(false);
        });
    }, 80);

    return () => clearTimeout(timer);
  }, [selectedLocation.lat, selectedLocation.lon, regionalSpanDeg, weights]);

  // 3. Load regional 3D terrain patch around selectedLocation
  const patchAbortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => {
      if (patchAbortRef.current) patchAbortRef.current.abort();
      const ctrl = new AbortController();
      patchAbortRef.current = ctrl;
      setLoadingPatch(true);

      fetch(
        `./api/moon/terrain-patch?lat=${selectedLocation.lat}&lon=${selectedLocation.lon}&spanDeg=${regionalSpanDeg}`,
        { signal: ctrl.signal },
      )
        .then((r) => r.json())
        .then((data) => {
          if (data.grid) setRegionalPatch(data);
          setLoadingPatch(false);
        })
        .catch((err) => {
          if (err.name !== 'AbortError') setLoadingPatch(false);
        });
    }, 100);

    return () => clearTimeout(timer);
  }, [selectedLocation.lat, selectedLocation.lon, regionalSpanDeg]);

  // 4. Calculate 3D rover routes (vehicle-specific via selectedRoverId, with client-side A* fallback)
  const fallbackRef = useRef({ regionalPatch, globalDem, globeFeatures });
  fallbackRef.current = { regionalPatch, globalDem, globeFeatures };

  const routeAbortRef = useRef<AbortController | null>(null);
  const computeRoutes = useCallback(
    (
      startPt = routeStart,
      destPt = routeDestination,
      customParams = routeParams,
      roverId = selectedRoverId,
      customCfg = customRoverConfig,
    ) => {
      if (routeAbortRef.current) routeAbortRef.current.abort();
      const ctrl = new AbortController();
      routeAbortRef.current = ctrl;
      setLoadingRoutes(true);
      setRouteError(null);

      const payload = JSON.stringify({
        start: startPt,
        destination: destPt,
        roverId,
        customRoverConfig: roverId === 'custom' ? customCfg : undefined,
        ...customParams,
      });

      const attemptFetch = (retryCount: number) => {
        fetch('./api/moon/route', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
          signal: ctrl.signal,
        })
          .then(async (r) => {
            const data = await r.json();
            if (!r.ok || data.error) {
              throw new Error(data.error || `HTTP ${r.status}`);
            }
            setRoutePlan(data);
            setRouteError(null);
            setLoadingRoutes(false);
          })
          .catch((err) => {
            if (err.name === 'AbortError') return;
            if (retryCount < 1 && /fetch|network/i.test(String(err.message || ''))) {
              setTimeout(() => attemptFetch(retryCount + 1), 350);
              return;
            }
            // Client-side A* fallback using loaded regionalPatch or globalDem so routes always compute even offline
            try {
              const { regionalPatch: rp, globalDem: gd, globeFeatures: gf } = fallbackRef.current;
              const fallbackGrid = rp
                ? {
                    width: rp.grid.width,
                    height: rp.grid.height,
                    north: rp.grid.north,
                    west: rp.grid.west,
                    dLat: rp.grid.dLat,
                    dLon: rp.grid.dLon,
                    elevation: new Float32Array(rp.grid.elevation),
                  }
                : gd?.grid;
              if (fallbackGrid) {
                const localPlan = planMoonRoutes({
                  grid: fallbackGrid,
                  gridSource: rp?.source ?? 'NASA MGS LOLA Global DEM (Client Fallback)',
                  start: startPt,
                  destination: destPt,
                  roverId,
                  customRoverConfig: roverId === 'custom' ? customCfg : undefined,
                  maxAllowedSlopeDeg: customParams.maxAllowedSlopeDeg,
                  slopeWeight: customParams.slopeWeight,
                  roughnessWeight: customParams.roughnessWeight,
                  scienceWeight: customParams.scienceWeight,
                  craters: rp?.craters ?? [],
                  features: gf,
                });
                setRoutePlan(localPlan);
                setRouteError(null);
                setLoadingRoutes(false);
                return;
              }
            } catch {
              // ignore fallback error
            }
            setRouteError(err.message);
            setLoadingRoutes(false);
          });
      };

      attemptFetch(0);
    },
    [routeStart, routeDestination, routeParams, selectedRoverId, customRoverConfig],
  );

  // Automatically compute routes on initial load and whenever start, destination, rover, or routeParams change
  useEffect(() => {
    const timer = setTimeout(() => {
      computeRoutes(routeStart, routeDestination, routeParams, selectedRoverId, customRoverConfig);
    }, 80);
    return () => clearTimeout(timer);
  }, [
    routeStart.lat,
    routeStart.lon,
    routeDestination.lat,
    routeDestination.lon,
    selectedRoverId,
    customRoverConfig,
    routeParams,
    computeRoutes,
  ]);

  return {
    globalDem,
    planet,
    candidates,
    regionalCandidates,
    rovers,
    selectedRover,
    selectedSite,
    loadingSite,
    weights,
    setWeights,
    globeFeatures,
    routePresets,
    dataSources,
    radExcerpt,
    regionalPatch,
    loadingPatch,
    routePlan,
    loadingRoutes,
    routeError,
    routeParams,
    setRouteParams,
    computeRoutes,
  };
}
