import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { cartesianToLatLon, DEG, greatCircleDistance, LatLon, latLonToCartesian, normLon180 } from '../core/geo/sphere';
import {
  GeologicalFeature,
  LandingSiteAnalysis,
  LandingSiteWeights,
  RouteModeId,
  RoutePlanResponse,
} from '../core/planet/types';
import { ElevationGrid, sampleArray, sampleElevation } from '../core/terrain/grid';
import { ClickSelectionMode, InfoDetailMode, sanitizeLatLon, ViewportMode } from '../coordinate-state';

export type { ViewportMode };
export type MapClickMode = ClickSelectionMode;
import {
  ClientGlobalDem,
  isWmtsImageryLayer,
  loadMoonTrekMosaicCanvas,
  loadRegionalMoonTrekCanvas,
  renderScientificLayerCanvas,
  sampleGlobalElevationM,
  sampleGlobalSlopeDeg,
  SURFACE_LAYERS,
  SurfaceLayerId,
} from '../moon/client-dem';
import { MOON_BODY } from '../moon/constants';
import { formatLatLonShort } from '../moon/physics';
import { NASA_MOON_ROVERS, NasaRoverProfile, RoverId } from '../moon/rovers';
import { isRenderPaused, onRenderPauseChange } from '../earth-link';
import { roverPlayback } from '../moon/rover-playback';
import { RegionalTerrainPatch } from '../use-moon-intelligence';
import { ArticulatedRoverRig, createArticulatedRoverGroup } from './RoverStudio3D';

/**
 * Per-patch derived data, computed once per patch instead of on every marker / hover sample.
 * (Previously each call copied the whole elevation array and scanned it for min/max, which made
 * overlay rebuilds O(route points × grid cells).)
 */
const patchInfoCache = new WeakMap<RegionalTerrainPatch['grid'], { gridObj: ElevationGrid; meanE: number }>();
function getPatchInfo(g: RegionalTerrainPatch['grid']): { gridObj: ElevationGrid; meanE: number } {
  let info = patchInfoCache.get(g);
  if (!info) {
    const elevation = new Float32Array(g.elevation);
    let minE = Infinity;
    let maxE = -Infinity;
    for (let i = 0; i < elevation.length; i++) {
      const v = elevation[i];
      if (Number.isFinite(v)) {
        if (v < minE) minE = v;
        if (v > maxE) maxE = v;
      }
    }
    info = {
      gridObj: {
        width: g.width,
        height: g.height,
        north: g.north,
        west: g.west,
        dLat: g.dLat,
        dLon: g.dLon,
        elevation,
      },
      meanE: Number.isFinite(minE) ? (minE + maxE) * 0.5 : 0,
    };
    patchInfoCache.set(g, info);
  }
  return info;
}

/** Global-texture canvases are expensive (32 tiles + per-pixel colour work): build each once per layer. */
const globalMosaicCache = new Map<string, Promise<HTMLCanvasElement>>();
function cachedGlobalMosaic(layer: Parameters<typeof loadMoonTrekMosaicCanvas>[0]): Promise<HTMLCanvasElement> {
  let p = globalMosaicCache.get(layer);
  if (!p) {
    p = loadMoonTrekMosaicCanvas(layer).catch((err) => {
      globalMosaicCache.delete(layer); // allow a retry after a network failure
      throw err;
    });
    globalMosaicCache.set(layer, p);
  }
  return p;
}
const scientificCanvasCache = new WeakMap<object, Map<string, HTMLCanvasElement>>();

function sameMarkers(a: OverlayMarkerScreen[], b: OverlayMarkerScreen[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const p = a[i];
    const q = b[i];
    if (p.id !== q.id || p.x !== q.x || p.y !== q.y || p.active !== q.active || p.label !== q.label || p.sublabel !== q.sublabel) {
      return false;
    }
  }
  return true;
}

interface OverlayMarkerScreen {
  id: string;
  label: string;
  sublabel?: string;
  x: number;
  y: number;
  kind: 'candidate' | 'selected' | 'route_start' | 'route_dest' | 'waypoint' | 'feature' | 'rover';
  color: string;
  lat: number;
  lon: number;
  active?: boolean;
}

export interface MoonViewport3DProps {
  globalDem: ClientGlobalDem | null;
  viewportMode: ViewportMode;
  onViewportModeChange: (mode: ViewportMode) => void;
  surfaceLayer: SurfaceLayerId;
  onSurfaceLayerChange: (layer: SurfaceLayerId) => void;
  clickMode: ClickSelectionMode;
  onClickModeChange: (mode: ClickSelectionMode) => void;
  exaggeration: number;
  onExaggerationChange: (exag: number) => void;
  regionalSpanDeg: number;
  onRegionalSpanChange: (span: number) => void;
  selectedLocation: LatLon;
  onSelectLocation: (loc: LatLon) => void;
  hoveredLocation: (LatLon & { elevationM: number; slopeDeg: number }) | null;
  onHoverLocation: (loc: (LatLon & { elevationM: number; slopeDeg: number }) | null) => void;
  routeStart: LatLon;
  onSetRouteStart: (loc: LatLon) => void;
  routeDestination: LatLon;
  onSetRouteDestination: (loc: LatLon) => void;
  selectedRouteId: RouteModeId;
  onSelectRouteId?: (id: RouteModeId) => void;
  selectedRover: NasaRoverProfile;
  onSelectRover: (id: RoverId) => void;
  onOpenRoverStudio: () => void;
  candidates: LandingSiteAnalysis[];
  regionalCandidates: LandingSiteAnalysis[];
  weights?: LandingSiteWeights;
  selectedSite: LandingSiteAnalysis | null;
  globeFeatures: GeologicalFeature[];
  regionalPatch: RegionalTerrainPatch | null;
  loadingPatch: boolean;
  routePlan: RoutePlanResponse | null;
  loadingRoutes: boolean;
  roverProgress?: number; // 0..1 along selected route
  showGraticule: boolean;
  showLandingCandidates: boolean;
  showNomenclature: boolean;
  showCraters: boolean;
  showRoutes: boolean;
  onToggleOverlay: (key: 'graticule' | 'candidates' | 'nomenclature' | 'craters' | 'routes') => void;
  infoMode: InfoDetailMode;
  onInfoModeChange: (mode: InfoDetailMode) => void;
}

const GLOBE_RADIUS = 10.0;
const REGIONAL_SIZE = 18.0;

function globeRadiusAt(dem: ClientGlobalDem | null, lat: number, lon: number, exaggeration: number): number {
  const elevM = sampleGlobalElevationM(dem, lat, lon);
  return GLOBE_RADIUS * (1 + (elevM * exaggeration) / MOON_BODY.meanRadiusM);
}

function buildCustomMoonSphereGeometry(
  dem: ClientGlobalDem | null,
  exaggeration: number,
  latBands = 144,
  lonBands = 288,
): THREE.BufferGeometry {
  const numVerts = (latBands + 1) * (lonBands + 1);
  const positions = new Float32Array(numVerts * 3);
  const uvs = new Float32Array(numVerts * 2);
  const indices: number[] = [];

  let ptr = 0;
  let uvPtr = 0;
  for (let r = 0; r <= latBands; r++) {
    const v = r / latBands; // 0 at North Pole (+90), 1 at South Pole (-90)
    const lat = 90 - v * 180;
    for (let c = 0; c <= lonBands; c++) {
      const u = c / lonBands; // 0 at -180°E, 1 at +180°E
      const lon = -180 + u * 360;
      const rad = globeRadiusAt(dem, lat, lon, exaggeration);
      const [x, y, z] = latLonToCartesian(lat, lon, rad);
      positions[ptr++] = x;
      positions[ptr++] = y;
      positions[ptr++] = z;
      uvs[uvPtr++] = u;
      uvs[uvPtr++] = 1 - v;
    }
  }

  for (let r = 0; r < latBands; r++) {
    for (let c = 0; c < lonBands; c++) {
      const a = r * (lonBands + 1) + c;
      const b = a + lonBands + 1;
      const d = a + 1;
      const e = b + 1;
      indices.push(a, b, d);
      indices.push(b, e, d);
    }
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geom.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geom.setIndex(indices);
  geom.computeVertexNormals();
  return geom;
}

export const MoonViewport3D: React.FC<MoonViewport3DProps> = (props) => {
  const {
    globalDem,
    viewportMode,
    onViewportModeChange,
    surfaceLayer,
    onSurfaceLayerChange,
    clickMode,
    onClickModeChange,
    exaggeration,
    onExaggerationChange,
    regionalSpanDeg,
    onRegionalSpanChange,
    selectedLocation,
    onSelectLocation,
    hoveredLocation,
    onHoverLocation,
    routeStart,
    onSetRouteStart,
    routeDestination,
    onSetRouteDestination,
    selectedRouteId,
    selectedRover,
    onSelectRover,
    onOpenRoverStudio,
    candidates,
    regionalCandidates,
    weights,
    selectedSite,
    globeFeatures,
    regionalPatch,
    loadingPatch,
    routePlan,
    loadingRoutes,
    roverProgress = 0.35,
    showGraticule,
    showLandingCandidates,
    showNomenclature,
    showCraters,
    showRoutes,
    onToggleOverlay,
    infoMode,
    onInfoModeChange,
  } = props;

  // Imagery layers don't depend on the landing weights; only scientific layers are re-rendered
  // when weights change (avoids re-uploading a 2048×1024 texture on every slider tick).
  const textureWeights = isWmtsImageryLayer(surfaceLayer) ? null : weights;
  // The globe mesh does not depend on the regional patch: without this, every click (which loads a
  // new patch) rebuilt the whole global texture.
  const meshPatch = viewportMode === 'regional_3d' ? regionalPatch : null;

  const mountRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const primaryMeshRef = useRef<THREE.Mesh | null>(null);
  const overlayGroupRef = useRef<THREE.Group | null>(null);
  const roverMountGroupRef = useRef<THREE.Group | null>(null);
  const roverSurfaceRigRef = useRef<ArticulatedRoverRig | null>(null);
  const candidateMeshesRef = useRef<{ mesh: THREE.Object3D; lat: number; lon: number }[]>([]);

  const [screenMarkers, setScreenMarkers] = useState<OverlayMarkerScreen[]>([]);

  // Rover drive animation (route panel → Play): the rover is moved directly in the three.js scene
  // from the playback store — no React state, so nothing re-renders while it drives.
  const roverProgressRef = useRef<number>(roverProgress);
  const placeRoverRef = useRef<(progress: number) => void>(() => {});

  // Render-on-demand: the scene is redrawn only when something changed (camera move, tween,
  // prop change, texture arrival), plus a slow idle refresh as a safety net. A static globe
  // therefore costs almost no GPU, and none at all while paused behind the Earth map.
  const needsRenderRef = useRef(true);
  const invalidate = () => {
    needsRenderRef.current = true;
  };
  // Any re-render (= any prop change) may have changed the scene.
  useEffect(() => {
    needsRenderRef.current = true;
  });
  const globeGeomCacheRef = useRef<{
    dem: ClientGlobalDem | null;
    exag: number;
    geom: THREE.BufferGeometry;
  } | null>(null);
  const [coordInputLat, setCoordInputLat] = useState<string>(selectedLocation.lat.toFixed(2));
  const [coordInputLon, setCoordInputLon] = useState<string>(selectedLocation.lon.toFixed(2));

  useEffect(() => {
    setCoordInputLat(selectedLocation.lat.toFixed(2));
    setCoordInputLon(selectedLocation.lon.toFixed(2));
  }, [selectedLocation.lat, selectedLocation.lon]);

  // Keep latest props in a ref for raycast & animation loop callbacks
  const latestPropsRef = useRef(props);
  latestPropsRef.current = props;

  // Store 3D world positions of labels to project onto 2D screen coordinates every frame
  const worldAnchorsRef = useRef<
    {
      id: string;
      label: string;
      sublabel?: string;
      pos: THREE.Vector3;
      normal?: THREE.Vector3;
      kind: OverlayMarkerScreen['kind'];
      color: string;
      lat: number;
      lon: number;
      active?: boolean;
    }[]
  >([]);

  const roverAnchorRef = useRef<{
    id: string;
    label: string;
    sublabel?: string;
    pos: THREE.Vector3;
    normal?: THREE.Vector3;
    kind: OverlayMarkerScreen['kind'];
    color: string;
    lat: number;
    lon: number;
    active?: boolean;
  } | null>(null);

  // Target camera animation state
  const cameraTweenRef = useRef<{
    active: boolean;
    startPos: THREE.Vector3;
    endPos: THREE.Vector3;
    startTarget: THREE.Vector3;
    endTarget: THREE.Vector3;
    t0: number;
    durationMs: number;
  } | null>(null);

  // Helper: Map (lat, lon, offsetUnits) -> 3D position on current surface (Global Sphere or Regional 3D Patch)
  const computeSurfaceVec3 = (
    lat: number,
    lon: number,
    lift = 0.035,
    mode = viewportMode,
    dem = globalDem,
    patch = regionalPatch,
    exag = exaggeration,
  ): THREE.Vector3 | null => {
    if (mode === 'global_3d') {
      const r = globeRadiusAt(dem, lat, lon, exag) + lift;
      const [x, y, z] = latLonToCartesian(lat, lon, r);
      return new THREE.Vector3(x, y, z);
    } else if (patch) {
      const g = patch.grid;
      const south = g.north - g.height * g.dLat;
      const east = g.west + g.width * g.dLon;
      const l = normLon180(lon);
      if (lat > g.north || lat < south || l < g.west || l > east) return null;

      const { gridObj, meanE } = getPatchInfo(g);
      const spanMeters = Math.max(2_500, patch.spanDeg * DEG * MOON_BODY.meanRadiusM);
      const metersToScene = REGIONAL_SIZE / spanMeters;
      const zM = sampleElevation(gridObj, lat, l);
      const yScene = ((Number.isFinite(zM) ? zM : meanE) - meanE) * metersToScene * exag + lift;
      const u = (l - g.west) / (east - g.west);
      const v = (g.north - lat) / (g.north - south);
      const xScene = (u - 0.5) * REGIONAL_SIZE;
      const zScene = (v - 0.5) * REGIONAL_SIZE;
      return new THREE.Vector3(xScene, yScene, zScene);
    }
    return null;
  };

  // Initialize Three.js WebGLRenderer, Scene, Camera, Lights, OrbitControls
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#080808');
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(
      40,
      Math.max(1, container.clientWidth) / Math.max(1, container.clientHeight),
      0.08,
      400,
    );
    // Initial view facing Jezero Crater (18.44°N, 77.45°E)
    const [jx, jy, jz] = latLonToCartesian(18.4447, 77.4508, 25.5);
    camera.position.set(jx, jy, jz);
    cameraRef.current = camera;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    } catch (err) {
      console.error('WebGLRenderer initialization error:', err);
      return;
    }
    renderer.setSize(container.clientWidth, container.clientHeight);
    // 1.5× is visually indistinguishable here and draws ~44% fewer pixels than 2× on HiDPI screens.
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.07;
    controls.minDistance = 11.2;
    controls.maxDistance = 65;
    controls.rotateSpeed = 0.65;
    controls.zoomSpeed = 0.9;
    controlsRef.current = controls;
    controls.addEventListener('change', () => {
      needsRenderRef.current = true;
    });

    // Lighting: restrained directional sunlight + hemisphere ambient fill
    const ambient = new THREE.HemisphereLight('#d4d4d8', '#18181b', 0.85);
    scene.add(ambient);

    const sunLight = new THREE.DirectionalLight('#fff8f0', 1.75);
    sunLight.position.set(35, 24, 30);
    scene.add(sunLight);

    const rimLight = new THREE.DirectionalLight('#7dd3fc', 0.35);
    rimLight.position.set(-30, -15, -28);
    scene.add(rimLight);

    // Subtle deep-space starfield points (astronomically restrained)
    const starCount = 900;
    const starPos = new Float32Array(starCount * 3);
    let seed = 42;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let i = 0; i < starCount; i++) {
      const r = 130 + rand() * 80;
      const theta = rand() * Math.PI * 2;
      const phi = Math.acos(2 * rand() - 1);
      starPos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      starPos[i * 3 + 1] = r * Math.cos(phi);
      starPos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    }
    const starGeom = new THREE.BufferGeometry();
    starGeom.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    const starMat = new THREE.PointsMaterial({
      color: '#71717a',
      size: 0.35,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.55,
    });
    scene.add(new THREE.Points(starGeom, starMat));

    const overlayGroup = new THREE.Group();
    scene.add(overlayGroup);
    overlayGroupRef.current = overlayGroup;

    // Dedicated 3D Rover Mount Group on the lunar surface
    const roverMountGroup = new THREE.Group();
    scene.add(roverMountGroup);
    roverMountGroupRef.current = roverMountGroup;

    // Pointer interaction (distinguish click vs drag)
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let downX = 0;
    let downY = 0;
    let downTime = 0;

    const getIntersectLatLon = (ev: MouseEvent): (LatLon & { elevationM: number; slopeDeg: number }) | null => {
      const mesh = primaryMeshRef.current;
      if (!mesh) return null;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObject(mesh, false);
      if (!hits.length) return null;
      const pt = hits[0].point;
      const lp = latestPropsRef.current;

      if (lp.viewportMode === 'global_3d') {
        const ll = cartesianToLatLon(pt.x, pt.y, pt.z);
        const elev = sampleGlobalElevationM(lp.globalDem, ll.lat, ll.lon);
        const slp = sampleGlobalSlopeDeg(lp.globalDem, ll.lat, ll.lon);
        return {
          lat: Math.round(ll.lat * 10000) / 10000,
          lon: Math.round(ll.lon * 10000) / 10000,
          elevationM: Math.round(elev),
          slopeDeg: Math.round(slp * 100) / 100,
        };
      } else if (lp.regionalPatch) {
        const g = lp.regionalPatch.grid;
        const south = g.north - g.height * g.dLat;
        const east = g.west + g.width * g.dLon;
        const u = Math.max(0, Math.min(1, pt.x / REGIONAL_SIZE + 0.5));
        const v = Math.max(0, Math.min(1, pt.z / REGIONAL_SIZE + 0.5));
        const lat = g.north - v * (g.north - south);
        const lon = normLon180(g.west + u * (east - g.west));
        const { gridObj } = getPatchInfo(g);
        const elev = sampleElevation(gridObj, lat, lon);
        const slp = sampleArray(gridObj, g.slope, lat, lon);
        return {
          lat: Math.round(lat * 10000) / 10000,
          lon: Math.round(lon * 10000) / 10000,
          elevationM: Number.isFinite(elev) ? Math.round(elev) : 0,
          slopeDeg: Number.isFinite(slp) ? Math.round(slp * 100) / 100 : 0,
        };
      }
      return null;
    };

    const onPointerDown = (ev: MouseEvent) => {
      downX = ev.clientX;
      downY = ev.clientY;
      downTime = performance.now();
    };

    // Hover: at most one raycast per animation frame, none while dragging the globe, and the
    // parent is only notified when the hovered value actually changes (each notification
    // re-renders the whole app).
    let hoverRaf = 0;
    let pendingHover: MouseEvent | null = null;
    let lastHoverKey = '';
    const flushHover = () => {
      hoverRaf = 0;
      const ev = pendingHover;
      pendingHover = null;
      if (!ev) return;
      const hit = getIntersectLatLon(ev);
      const key = hit ? `${hit.lat}|${hit.lon}|${hit.elevationM}|${hit.slopeDeg}` : 'none';
      if (key === lastHoverKey) return;
      lastHoverKey = key;
      latestPropsRef.current.onHoverLocation(hit);
    };
    const onPointerMove = (ev: MouseEvent) => {
      if (ev.buttons !== 0) return;
      pendingHover = ev;
      if (!hoverRaf) hoverRaf = requestAnimationFrame(flushHover);
    };
    const onPointerLeave = () => {
      pendingHover = null;
      if (lastHoverKey !== 'none') {
        lastHoverKey = 'none';
        latestPropsRef.current.onHoverLocation(null);
      }
    };

    const onPointerUp = (ev: MouseEvent) => {
      const dist = Math.hypot(ev.clientX - downX, ev.clientY - downY);
      const dt = performance.now() - downTime;
      if (dist > 5 || dt > 450) return;

      const lp = latestPropsRef.current;

      // First check if the user clicked directly on a 3D candidate landing site marker mesh
      if (candidateMeshesRef.current.length > 0 && lp.clickMode === 'inspect_site') {
        const rect = renderer.domElement.getBoundingClientRect();
        pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
        pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(pointer, camera);
        const candObjects = candidateMeshesRef.current.map((c) => c.mesh);
        const candHits = raycaster.intersectObjects(candObjects, false);
        if (candHits.length > 0) {
          const hitObj = candHits[0].object;
          const match = candidateMeshesRef.current.find((c) => c.mesh === hitObj);
          if (match) {
            lp.onSelectLocation(sanitizeLatLon(match.lat, match.lon));
            return;
          }
        }
      }

      const hit = getIntersectLatLon(ev);
      if (!hit) return;
      const clean = sanitizeLatLon(hit.lat, hit.lon);
      if (lp.clickMode === 'set_route_start') {
        lp.onSetRouteStart(clean);
      } else if (lp.clickMode === 'set_route_dest') {
        lp.onSetRouteDestination(clean);
      } else {
        lp.onSelectLocation(clean);
      }
    };

    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('pointerleave', onPointerLeave);
    renderer.domElement.addEventListener('pointerup', onPointerUp);

    const onResize = () => {
      if (!container) return;
      const w = Math.max(1, container.clientWidth);
      const h = Math.max(1, container.clientHeight);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      needsRenderRef.current = true;
    };
    const ro = new ResizeObserver(onResize);
    ro.observe(container);

    let animId = 0;
    let lastMarkerSync = 0;
    let lastRender = 0;
    let markersDirty = true;
    const IDLE_REFRESH_MS = 400;

    const animate = (now: number) => {
      // Paused (hidden behind the Meridian Earth map): stop the loop entirely.
      if (isRenderPaused()) {
        animId = 0;
        return;
      }
      animId = requestAnimationFrame(animate);

      // Update camera tween if active
      const tween = cameraTweenRef.current;
      if (tween && tween.active) {
        needsRenderRef.current = true;
        const u = Math.min(1, (now - tween.t0) / tween.durationMs);
        const ease = 1 - Math.pow(1 - u, 3);
        camera.position.lerpVectors(tween.startPos, tween.endPos, ease);
        controls.target.lerpVectors(tween.startTarget, tween.endTarget, ease);
        if (u >= 1) tween.active = false;
      }

      // Dynamically scale the 3D surface rover so it is visible at both orbital and regional zoom levels
      const rMount = roverMountGroupRef.current;
      if (rMount && rMount.visible) {
        const camDist = camera.position.distanceTo(rMount.position);
        const lp = latestPropsRef.current;
        const targetScale =
          lp.viewportMode === 'global_3d'
            ? Math.max(0.08, Math.min(0.28, camDist * 0.012))
            : Math.max(0.22, Math.min(0.68, camDist * 0.032));
        rMount.scale.setScalar(targetScale);
      }

      // update() returns true while damping is still moving the camera.
      if (controls.update()) needsRenderRef.current = true;

      if (!needsRenderRef.current && now - lastRender < IDLE_REFRESH_MS) return;
      needsRenderRef.current = false;
      lastRender = now;
      markersDirty = true;
      renderer.render(scene, camera);

      // Project 3D anchor labels to 2D screen coordinates (~25 Hz, only after the view changed)
      // While the rover drives, labels follow at 10 Hz (each sync re-renders this component).
      if (markersDirty && now - lastMarkerSync > (roverPlayback.isPlaying() ? 100 : 40)) {
        markersDirty = false;
        lastMarkerSync = now;
        const w = container.clientWidth;
        const h = container.clientHeight;
        const camDir = new THREE.Vector3();
        const nextMarkers: OverlayMarkerScreen[] = [];

        const allAnchors = roverAnchorRef.current
          ? [...worldAnchorsRef.current, roverAnchorRef.current]
          : worldAnchorsRef.current;

        for (const a of allAnchors) {
          if (a.normal) {
            // Horizon culling on the 3D sphere
            camDir.subVectors(camera.position, a.pos).normalize();
            if (a.normal.dot(camDir) < 0.08) continue;
          }
          const proj = a.pos.clone().project(camera);
          if (proj.z < -1 || proj.z > 1) continue;
          const sx = (proj.x * 0.5 + 0.5) * w;
          const sy = (-proj.y * 0.5 + 0.5) * h;
          if (sx < 10 || sx > w - 10 || sy < 10 || sy > h - 10) continue;
          nextMarkers.push({
            id: a.id,
            label: a.label,
            sublabel: a.sublabel,
            x: Math.round(sx),
            y: Math.round(sy),
            kind: a.kind,
            color: a.color,
            lat: a.lat,
            lon: a.lon,
            active: a.active,
          });
        }
        setScreenMarkers((prev) => (sameMarkers(prev, nextMarkers) ? prev : nextMarkers));
      }
    };
    animId = requestAnimationFrame(animate);

    const unsubscribePause = onRenderPauseChange((paused) => {
      if (!paused && !animId) {
        needsRenderRef.current = true;
        animId = requestAnimationFrame(animate);
      }
    });

    return () => {
      unsubscribePause();
      if (animId) cancelAnimationFrame(animId);
      if (hoverRaf) cancelAnimationFrame(hoverRaf);
      renderer.domElement.removeEventListener('pointerleave', onPointerLeave);
      ro.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      globeGeomCacheRef.current?.geom.dispose();
      globeGeomCacheRef.current = null;
      renderer.forceContextLoss();
      renderer.dispose();
    };
  }, []);

  // Build / rebuild the 3D Articulated Rover Model on the lunar surface when selectedRover changes
  useEffect(() => {
    const rMount = roverMountGroupRef.current;
    if (!rMount) return;

    while (rMount.children.length > 0) {
      rMount.remove(rMount.children[0]);
    }

    const rig = createArticulatedRoverGroup(selectedRover);
    rMount.add(rig.group);

    // Subtle tactical base ring beneath the 3D rover so its footprint is clear against the route tube
    const baseRing = new THREE.Mesh(
      new THREE.RingGeometry(1.15, 1.38, 32),
      new THREE.MeshBasicMaterial({
        color: '#4ADE80',
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.75,
      }),
    );
    baseRing.rotation.x = -Math.PI / 2;
    baseRing.position.y = 0.02;
    rMount.add(baseRing);

    roverSurfaceRigRef.current = rig;
  }, [selectedRover]);

  // Update the 3D Rover's surface position, heading, slope pitch, wheel rotation, and rocker-bogie articulation
  useEffect(() => {
    const place = (effectiveRoverProgress: number) => {
    const rMount = roverMountGroupRef.current;
    const rig = roverSurfaceRigRef.current;
    if (!rMount || !rig) return;

    if (!showRoutes || !routePlan || routePlan.routes.length === 0) {
      rMount.visible = false;
      roverAnchorRef.current = null;
      return;
    }

    const route = routePlan.routes.find((r) => r.id === selectedRouteId) ?? routePlan.routes[0];
    if (!route || route.profile.length === 0) {
      rMount.visible = false;
      roverAnchorRef.current = null;
      return;
    }

    const totalSamples = route.profile.length;
    const exactIdx = Math.max(0, Math.min(totalSamples - 1, effectiveRoverProgress * (totalSamples - 1)));
    const idx0 = Math.floor(exactIdx);
    const idx1 = Math.min(totalSamples - 1, idx0 + 1);
    const frac = exactIdx - idx0;

    const s0 = route.profile[idx0];
    const s1 = route.profile[idx1];
    const curLat = s0.lat + (s1.lat - s0.lat) * frac;
    const curLon = s0.lon + (s1.lon - s0.lon) * frac;
    const curDistKm = s0.distanceKm + (s1.distanceKm - s0.distanceKm) * frac;
    const curElevM = s0.elevationM + (s1.elevationM - s0.elevationM) * frac;
    const curSlopeDeg = s0.slopeDeg + (s1.slopeDeg - s0.slopeDeg) * frac;
    const curTriM = s0.triM + (s1.triM - s0.triM) * frac;

    const lift = viewportMode === 'global_3d' ? 0.068 : 0.085;
    const roverPos = computeSurfaceVec3(curLat, curLon, lift);
    if (!roverPos) {
      rMount.visible = false;
      roverAnchorRef.current = null;
      return;
    }

    rMount.visible = true;
    rMount.position.copy(roverPos);

    // Determine forward tangent vector along the route on the 3D surface
    const lookAheadIdx = Math.min(totalSamples - 1, idx0 + 2);
    const lookBehindIdx = Math.max(0, idx0 - 1);
    const pAhead =
      computeSurfaceVec3(route.profile[lookAheadIdx].lat, route.profile[lookAheadIdx].lon, lift) ?? roverPos;
    const pBehind =
      computeSurfaceVec3(route.profile[lookBehindIdx].lat, route.profile[lookBehindIdx].lon, lift) ?? roverPos;

    const upVec =
      viewportMode === 'global_3d' ? roverPos.clone().normalize() : new THREE.Vector3(0, 1, 0);

    const forwardVec = pAhead.clone().sub(pBehind);
    if (forwardVec.lengthSq() < 1e-6) {
      forwardVec.set(0, 0, 1);
    }
    // Project forwardVec onto tangent plane orthogonal to upVec (with slight pitch in regional mode)
    if (viewportMode === 'global_3d') {
      forwardVec.addScaledVector(upVec, -forwardVec.dot(upVec)).normalize();
    } else {
      forwardVec.normalize();
    }

    const leftVec = new THREE.Vector3().crossVectors(upVec, forwardVec).normalize();
    const orthoUpVec = new THREE.Vector3().crossVectors(forwardVec, leftVec).normalize();

    const rotMatrix = new THREE.Matrix4().makeBasis(leftVec, orthoUpVec, forwardVec);
    rMount.quaternion.setFromRotationMatrix(rotMatrix);

    // Compute kinematic wheel rotation & rocker-bogie suspension articulation from real route distance & terrain
    const distanceMeters = curDistKm * 1000;
    const wheelRadiusM = Math.max(0.065, selectedRover.wheels.diameterCm / 200);
    // Scaled visual wheel rotation so grouser cleats visibly turn during route playback
    const wheelRotationRad = (distanceMeters / wheelRadiusM) * 0.06;

    // Rocker-Bogie differential tilt responds to local terrain roughness (TRI) and slope
    const roughnessFactor = Math.min(1.5, curTriM / 15 + curSlopeDeg / 18);
    const rockerDifferentialRad = Math.sin(distanceMeters * 0.012) * (0.06 + roughnessFactor * 0.16);
    const bogiePitchRad = Math.cos(distanceMeters * 0.019) * (0.04 + roughnessFactor * 0.12);

    // Corner steering angle from local route curvature
    let steeringAngleRad = 0;
    if (idx0 > 0 && idx1 < totalSamples - 1) {
      const prevPt = route.profile[idx0 - 1];
      const nextPt = route.profile[Math.min(totalSamples - 1, idx0 + 2)];
      const h1 = Math.atan2(curLon - prevPt.lon, curLat - prevPt.lat);
      const h2 = Math.atan2(nextPt.lon - curLon, nextPt.lat - curLat);
      let dHeading = h2 - h1;
      while (dHeading > Math.PI) dHeading -= Math.PI * 2;
      while (dHeading < -Math.PI) dHeading += Math.PI * 2;
      steeringAngleRad = Math.max(-0.42, Math.min(0.42, dHeading * 0.85));
    }

    rig.updateKinematics({
      wheelRotationRad,
      rockerDifferentialRad,
      bogiePitchRad,
      steeringAngleRad,
    });

    roverAnchorRef.current = {
      id: 'active_rover',
      label: `${selectedRover.name.toUpperCase()} (${curDistKm.toFixed(1)} km)`,
      sublabel: `${Math.round(curElevM)} m · ${curSlopeDeg.toFixed(1)}° slope`,
      pos: roverPos.clone().addScaledVector(orthoUpVec, viewportMode === 'global_3d' ? 0.18 : 0.45),
      normal: viewportMode === 'global_3d' ? roverPos.clone().normalize() : undefined,
      kind: 'rover',
      color: '#4ADE80',
      lat: curLat,
      lon: curLon,
      active: true,
    };
    };
    placeRoverRef.current = place;
    place(roverProgressRef.current);
  }, [
    selectedRover,
    routePlan,
    selectedRouteId,
    viewportMode,
    globalDem,
    regionalPatch,
    exaggeration,
    showRoutes,
  ]);

  useEffect(
    () =>
      roverPlayback.subscribe((st) => {
        if (st.progress === roverProgressRef.current) return;
        roverProgressRef.current = st.progress;
        placeRoverRef.current(st.progress);
        needsRenderRef.current = true;
      }),
    [],
  );

  // Smooth camera transition when switching between Global 3D Sphere and Regional/Local 3D Terrain or focusing a new site
  const flyToLocation = (
    loc: LatLon,
    mode = viewportMode,
    distanceGlobe = 21.5,
    span = regionalSpanDeg,
  ) => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;

    if (mode === 'global_3d') {
      controls.minDistance = 10.9;
      controls.maxDistance = 65;
      const [tx, ty, tz] = latLonToCartesian(loc.lat, loc.lon, distanceGlobe);
      cameraTweenRef.current = {
        active: true,
        startPos: camera.position.clone(),
        endPos: new THREE.Vector3(tx, ty, tz),
        startTarget: controls.target.clone(),
        endTarget: new THREE.Vector3(0, 0, 0),
        t0: performance.now(),
        durationMs: 650,
      };
    } else if (span <= 0.35) {
      // LOD 3 Local HiRISE 3D Oblique Perspective (looking WNW across the Jezero Landing Site toward the Western Delta scarp)
      controls.minDistance = 2.2;
      controls.maxDistance = 42;
      cameraTweenRef.current = {
        active: true,
        startPos: camera.position.clone(),
        endPos: new THREE.Vector3(5.8, 5.4, 11.2),
        startTarget: controls.target.clone(),
        endTarget: new THREE.Vector3(-1.1, 0.2, -1.0),
        t0: performance.now(),
        durationMs: 650,
      };
    } else {
      controls.minDistance = 2.5;
      controls.maxDistance = 42;
      cameraTweenRef.current = {
        active: true,
        startPos: camera.position.clone(),
        endPos: new THREE.Vector3(2.8, 10.2, 13.8),
        startTarget: controls.target.clone(),
        endTarget: new THREE.Vector3(0, 0, 0),
        t0: performance.now(),
        durationMs: 600,
      };
    }
  };

  useEffect(() => {
    flyToLocation(selectedLocation, viewportMode, 21.5, regionalSpanDeg);
  }, [viewportMode, regionalSpanDeg]);

  // Build / update primary 3D Mesh (Global 3D Moon Sphere OR Regional/Local 3D Terrain Block)
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    let cancelled = false;

    // Remove previous primary mesh
    if (primaryMeshRef.current) {
      scene.remove(primaryMeshRef.current);
      if (primaryMeshRef.current.geometry !== globeGeomCacheRef.current?.geom) {
        primaryMeshRef.current.geometry.dispose();
      }
      const mat = primaryMeshRef.current.material as THREE.MeshStandardMaterial;
      mat.map?.dispose();
      mat.dispose();
      primaryMeshRef.current = null;
    }

    if (viewportMode === 'global_3d') {
      // Rebuilding the 144×288 displaced sphere is only needed when the DEM or exaggeration
      // changes — not for layer or weight changes.
      let cached = globeGeomCacheRef.current;
      if (!cached || cached.dem !== globalDem || cached.exag !== exaggeration) {
        cached?.geom.dispose();
        cached = {
          dem: globalDem,
          exag: exaggeration,
          geom: buildCustomMoonSphereGeometry(globalDem, exaggeration, 144, 288),
        };
        globeGeomCacheRef.current = cached;
      }
      const geom = cached.geom;
      const mat = new THREE.MeshStandardMaterial({
        color: '#ffffff',
        roughness: 0.88,
        metalness: 0.04,
      });
      const mesh = new THREE.Mesh(geom, mat);
      scene.add(mesh);
      primaryMeshRef.current = mesh;

      // Apply surface layer texture
      const applyTexture = async () => {
        if (isWmtsImageryLayer(surfaceLayer)) {
          const canvas = await cachedGlobalMosaic(surfaceLayer);
          if (cancelled) return;
          const tex = new THREE.CanvasTexture(canvas);
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.anisotropy = 8;
          mat.map = tex;
          mat.needsUpdate = true;
          invalidate();
        } else if (globalDem) {
          let perDem = scientificCanvasCache.get(globalDem);
          if (!perDem) {
            perDem = new Map();
            scientificCanvasCache.set(globalDem, perDem);
          }
          const key = `${surfaceLayer}|${JSON.stringify(weights ?? null)}`;
          let canvas = perDem.get(key);
          if (!canvas) {
            canvas = renderScientificLayerCanvas(
              globalDem.grid,
              globalDem.slope,
              globalDem.tri,
              globalDem.classes,
              surfaceLayer,
              2.2,
              weights,
            );
            if (perDem.size > 6) perDem.clear();
            perDem.set(key, canvas);
          }
          if (cancelled) return;
          const tex = new THREE.CanvasTexture(canvas);
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.anisotropy = 8;
          mat.map = tex;
          mat.needsUpdate = true;
          invalidate();
        }
      };
      applyTexture();
    } else if (regionalPatch) {
      // Regional / Local 3D Terrain Mesh from HiRISE 1 m / CTX 20 m / LOLA 128 PPD / 16 PPD patch
      const g = regionalPatch.grid;
      const W = g.width;
      const H = g.height;
      const elevArr = new Float32Array(g.elevation);
      const slopeArr = new Float32Array(g.slope);
      const triArr = new Float32Array(g.tri);
      const classArr = new Uint8Array(g.terrainClass);

      let minE = Infinity;
      let maxE = -Infinity;
      for (let i = 0; i < elevArr.length; i++) {
        if (Number.isFinite(elevArr[i])) {
          minE = Math.min(minE, elevArr[i]);
          maxE = Math.max(maxE, elevArr[i]);
        }
      }
      const meanE = (minE + maxE) * 0.5;
      const spanMeters = Math.max(2_500, regionalPatch.spanDeg * DEG * MOON_BODY.meanRadiusM);
      const metersToScene = REGIONAL_SIZE / spanMeters;

      const geom = new THREE.PlaneGeometry(REGIONAL_SIZE, REGIONAL_SIZE, W - 1, H - 1);
      geom.rotateX(-Math.PI / 2);
      const posAttr = geom.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < posAttr.count; i++) {
        const zM = elevArr[i];
        const yScene = (zM - meanE) * metersToScene * exaggeration;
        posAttr.setY(i, Number.isFinite(yScene) ? yScene : 0);
      }
      geom.computeVertexNormals();

      const mat = new THREE.MeshStandardMaterial({
        color: '#ffffff',
        roughness: 0.86,
        metalness: 0.05,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geom, mat);
      scene.add(mesh);
      primaryMeshRef.current = mesh;

      const gridObj: ElevationGrid = {
        width: W,
        height: H,
        north: g.north,
        west: g.west,
        dLat: g.dLat,
        dLon: g.dLon,
        elevation: elevArr,
      };

      const applyRegionalTex = async () => {
        if (isWmtsImageryLayer(surfaceLayer)) {
          const bbox = {
            north: g.north,
            south: g.north - H * g.dLat,
            west: g.west,
            east: g.west + W * g.dLon,
          };
          const canvas = await loadRegionalMoonTrekCanvas(bbox, surfaceLayer, gridObj);
          if (cancelled) return;
          const tex = new THREE.CanvasTexture(canvas);
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.anisotropy = 8;
          mat.map = tex;
          mat.needsUpdate = true;
          invalidate();
        } else {
          const canvas = renderScientificLayerCanvas(
            gridObj,
            slopeArr,
            triArr,
            classArr,
            surfaceLayer,
            0.45,
            weights,
          );
          if (cancelled) return;
          const tex = new THREE.CanvasTexture(canvas);
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.anisotropy = 8;
          mat.map = tex;
          mat.needsUpdate = true;
          invalidate();
        }
      };
      applyRegionalTex();
    }

    return () => {
      cancelled = true;
    };
  }, [viewportMode, globalDem, meshPatch, surfaceLayer, exaggeration, textureWeights]);

  // Build / update 3D surface-clamped overlays: Graticule, Candidate Markers, Selected Reticle, Craters, and 3D Rover Routes
  useEffect(() => {
    const group = overlayGroupRef.current;
    if (!group) return;

    // Clear existing children
    while (group.children.length > 0) {
      const child = group.children[0] as THREE.Object3D;
      group.remove(child);
    }

    const anchors: typeof worldAnchorsRef.current = [];
    const clickableMeshes: { mesh: THREE.Object3D; lat: number; lon: number }[] = [];
    const toSurfaceVec3 = (lat: number, lon: number, lift = 0.035) =>
      computeSurfaceVec3(lat, lon, lift, viewportMode, globalDem, regionalPatch, exaggeration);

    // Helper: build a surface-clamped 3D circle / landing ellipse of given radiusKm around (lat, lon)
    const addSurfaceCircle = (cLat: number, cLon: number, radiusKm: number, hexColor: string, opacity = 0.65, lift = 0.045) => {
      const radDegLat = (radiusKm * 1000) / (MOON_BODY.meanRadiusM * DEG);
      const radDegLon = radDegLat / Math.max(0.2, Math.cos(cLat * DEG));
      const pts: THREE.Vector3[] = [];
      for (let a = 0; a <= 360; a += 12) {
        const rad = a * DEG;
        const pLat = cLat + Math.sin(rad) * radDegLat;
        const pLon = cLon + Math.cos(rad) * radDegLon;
        const v = toSurfaceVec3(pLat, pLon, lift);
        if (v) pts.push(v);
      }
      if (pts.length >= 6) {
        const line = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(pts),
          new THREE.LineBasicMaterial({ color: hexColor, transparent: true, opacity }),
        );
        group.add(line);
      }
    };

    // 1. Graticule / Coordinate Grid
    if (showGraticule && viewportMode === 'global_3d') {
      const gratMat = new THREE.LineBasicMaterial({
        color: '#52525b',
        transparent: true,
        opacity: 0.26,
      });
      for (let lat = -60; lat <= 60; lat += 30) {
        const pts: THREE.Vector3[] = [];
        for (let lon = -180; lon <= 180; lon += 4) {
          const v = toSurfaceVec3(lat, lon, 0.02);
          if (v) pts.push(v);
        }
        group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), gratMat));
      }
      for (let lon = -180; lon < 180; lon += 30) {
        const pts: THREE.Vector3[] = [];
        for (let lat = -84; lat <= 84; lat += 4) {
          const v = toSurfaceVec3(lat, lon, 0.02);
          if (v) pts.push(v);
        }
        group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), gratMat));
      }
    } else if (showGraticule && viewportMode === 'regional_3d') {
      const gridHelper = new THREE.GridHelper(REGIONAL_SIZE, 12, '#3f3f46', '#27272a');
      gridHelper.position.y = -1.2;
      group.add(gridHelper);
    }

    // 2. Selected Location 3D Surface Targeting Ring + Adaptive EDL Landing Ellipse + 3D Scale Bar
    const selPos = toSurfaceVec3(selectedLocation.lat, selectedLocation.lon, 0.05);
    if (selPos) {
      const ringGeom = new THREE.RingGeometry(0.14, 0.21, 32);
      const ringMat = new THREE.MeshBasicMaterial({
        color: '#f1f1f1',
        side: THREE.DoubleSide,
      });
      const ringMesh = new THREE.Mesh(ringGeom, ringMat);
      ringMesh.position.copy(selPos);
      if (viewportMode === 'global_3d') {
        ringMesh.lookAt(selPos.clone().multiplyScalar(2));
      } else {
        ringMesh.rotation.x = -Math.PI / 2;
      }
      group.add(ringMesh);

      const pinGeom = new THREE.SphereGeometry(0.065, 16, 16);
      const pinMat = new THREE.MeshBasicMaterial({ color: '#f1f1f1' });
      const pin = new THREE.Mesh(pinGeom, pinMat);
      pin.position.copy(selPos);
      group.add(pin);

      // Adaptive EDL Landing Zone Ring draped on the 3D terrain (3.6 km Perseverance ellipse in Local HiRISE LOD 3 view, 10-15 km in Regional/Global)
      const ellipseRadiusKm =
        viewportMode === 'regional_3d' && regionalPatch
          ? regionalPatch.spanDeg <= 0.35
            ? 3.6
            : regionalPatch.spanDeg <= 0.9
              ? 8.0
              : 15.0
          : 15.0;
      const ellipseCenter =
        viewportMode === 'regional_3d' && regionalPatch && regionalPatch.spanDeg <= 0.35
          ? routeStart
          : selectedLocation;
      addSurfaceCircle(ellipseCenter.lat, ellipseCenter.lon, ellipseRadiusKm, '#93C5FD', 0.85, 0.052);

      // 3D Surface-Clamped Scale Bar (<---> 1 km in Local LOD 3 view, <---> 5 km in Regional LOD 2 view)
      if (viewportMode === 'regional_3d' && regionalPatch) {
        const scaleKm = regionalPatch.spanDeg <= 0.35 ? 1.0 : 5.0;
        const barLat = regionalPatch.center.lat + regionalPatch.spanDeg * 0.08;
        const barCenterLon = regionalPatch.center.lon - regionalPatch.spanDeg * 0.04;
        const halfLonSpan =
          ((scaleKm * 500) / (MOON_BODY.meanRadiusM * DEG)) /
          Math.max(0.2, Math.cos(barLat * DEG));
        const scalePts: THREE.Vector3[] = [];
        for (let s = 0; s <= 16; s++) {
          const sLon = barCenterLon - halfLonSpan + (2 * halfLonSpan * s) / 16;
          const sv = toSurfaceVec3(barLat, sLon, 0.085);
          if (sv) scalePts.push(sv);
        }
        if (scalePts.length >= 2) {
          group.add(
            new THREE.Line(
              new THREE.BufferGeometry().setFromPoints(scalePts),
              new THREE.LineBasicMaterial({ color: '#F8FAFC' }),
            ),
          );
          const midPt = scalePts[Math.floor(scalePts.length / 2)];
          anchors.push({
            id: 'terrain_scale_bar',
            label: `↔ ${scaleKm} km`,
            sublabel: `${regionalPatch.nativeGsdMeters ?? regionalPatch.resolutionMeters} m/px DTM`,
            pos: midPt,
            kind: 'feature',
            color: '#F8FAFC',
            lat: barLat,
            lon: barCenterLon,
          });
        }
      }

      anchors.push({
        id: 'selected_target',
        label: selectedSite?.name.split('(')[0].trim() || 'SELECTED SITE',
        sublabel:
          selectedSite?.telemetry.elevationM !== null && selectedSite?.telemetry.elevationM !== undefined
            ? `${Math.round(selectedSite.telemetry.elevationM)} m · ${selectedSite.telemetry.slopeDeg?.toFixed(1) ?? '0'}°`
            : formatLatLonShort(selectedLocation.lat, selectedLocation.lon),
        pos: selPos,
        normal: viewportMode === 'global_3d' ? selPos.clone().normalize() : undefined,
        kind: 'selected',
        color: '#F1F1F1',
        lat: selectedLocation.lat,
        lon: selectedLocation.lon,
        active: true,
      });
    }

    // 2b. 3D HiRISE & CTX Stereo DTM Coverage Footprints on the lunar Surface
    const dtmList = selectedSite?.availableDtms || regionalPatch?.availableDtms || [];
    for (const dtm of dtmList.slice(0, 8)) {
      const [w, s, e, n] = dtm.bbox;
      const boxCorners: [number, number][] = [
        [n, w],
        [n, (w + e) * 0.5],
        [n, e],
        [(n + s) * 0.5, e],
        [s, e],
        [s, (w + e) * 0.5],
        [s, w],
        [(n + s) * 0.5, w],
        [n, w],
      ];
      const boxPts: THREE.Vector3[] = [];
      for (const [bLat, bLon] of boxCorners) {
        const v = toSurfaceVec3(bLat, bLon, 0.055);
        if (v) boxPts.push(v);
      }
      if (boxPts.length >= 4) {
        const dtmColor = dtm.collection === 'hirise_dtm' ? '#38BDF8' : '#A78BFA';
        group.add(
          new THREE.Line(
            new THREE.BufferGeometry().setFromPoints(boxPts),
            new THREE.LineBasicMaterial({ color: dtmColor, transparent: true, opacity: 0.72 }),
          ),
        );
      }
    }

    // 3. Landing Candidate Markers on the 3D Surface (Global 12 Candidates + Top 5 Regional ROI Candidate Zones)
    if (showLandingCandidates) {
      for (const c of candidates) {
        const dFromSel = greatCircleDistance(selectedLocation, { lat: c.lat, lon: c.lon }, MOON_BODY.meanRadiusM / 1000);
        if (dFromSel < 15) continue; // already shown by selected reticle
        const pos = toSurfaceVec3(c.lat, c.lon, 0.042);
        if (!pos) continue;

        const scorePct = c.suitability.total !== null ? Math.round(c.suitability.total * 100) : 0;
        const markerColor = scorePct >= 75 ? '#10B981' : scorePct >= 55 ? '#F59E0B' : '#EF4444';

        const dot = new THREE.Mesh(
          new THREE.SphereGeometry(0.072, 14, 14),
          new THREE.MeshBasicMaterial({ color: markerColor }),
        );
        dot.position.copy(pos);
        group.add(dot);
        clickableMeshes.push({ mesh: dot, lat: c.lat, lon: c.lon });

        anchors.push({
          id: `cand_${c.id}`,
          label: c.name.split('(')[0].trim(),
          sublabel: `${scorePct}/100`,
          pos,
          normal: viewportMode === 'global_3d' ? pos.clone().normalize() : undefined,
          kind: 'candidate',
          color: markerColor,
          lat: c.lat,
          lon: c.lon,
        });
      }

      // Discovered Regional ROI Candidate Landing Zones (ROI #1 - ROI #5)
      for (let i = 0; i < regionalCandidates.length; i++) {
        const rc = regionalCandidates[i];
        const dFromSel = greatCircleDistance(selectedLocation, { lat: rc.lat, lon: rc.lon }, MOON_BODY.meanRadiusM / 1000);
        if (dFromSel < 8) continue;
        const pos = toSurfaceVec3(rc.lat, rc.lon, 0.052);
        if (!pos) continue;

        const scorePct = rc.suitability.total !== null ? Math.round(rc.suitability.total * 100) : 0;
        const roiColor = i === 0 ? '#38BDF8' : scorePct >= 75 ? '#10B981' : '#F59E0B';

        const beacon = new THREE.Mesh(
          new THREE.SphereGeometry(viewportMode === 'regional_3d' ? 0.12 : 0.058, 14, 14),
          new THREE.MeshBasicMaterial({ color: roiColor }),
        );
        beacon.position.copy(pos);
        group.add(beacon);
        clickableMeshes.push({ mesh: beacon, lat: rc.lat, lon: rc.lon });

        if (viewportMode === 'regional_3d') {
          addSurfaceCircle(rc.lat, rc.lon, 10, roiColor, 0.65, 0.048);
        }

        if (viewportMode === 'regional_3d' || i < 2) {
          anchors.push({
            id: `roi_cand_${rc.id}`,
            label: `ROI #${i + 1}`,
            sublabel: `${scorePct}/100 · ${rc.telemetry.slopeDeg?.toFixed(1) ?? '0'}°`,
            pos,
            normal: viewportMode === 'global_3d' ? pos.clone().normalize() : undefined,
            kind: 'candidate',
            color: roiColor,
            lat: rc.lat,
            lon: rc.lon,
          });
        }
      }
    }

    candidateMeshesRef.current = clickableMeshes;

    // 4. Named IAU Geological Features
    if (showNomenclature) {
      const list =
        viewportMode === 'regional_3d' && regionalPatch
          ? regionalPatch.features
          : globeFeatures.slice(0, 42);
      for (const f of list) {
        const pos = toSurfaceVec3(f.lat, f.lon, 0.035);
        if (!pos) continue;
        anchors.push({
          id: `feat_${f.id}`,
          label: f.name,
          sublabel: f.type,
          pos,
          normal: viewportMode === 'global_3d' ? pos.clone().normalize() : undefined,
          kind: 'feature',
          color: '#929292',
          lat: f.lat,
          lon: f.lon,
        });
      }
    }

    // 5. Mapped Robbins Crater Rims in Regional 3D View
    if (showCraters && viewportMode === 'regional_3d' && regionalPatch) {
      const craterMat = new THREE.LineBasicMaterial({
        color: '#a1a1aa',
        transparent: true,
        opacity: 0.55,
      });
      for (const c of regionalPatch.craters.slice(0, 14)) {
        const radDegLat = (c.diameterKm * 500) / (MOON_BODY.meanRadiusM * DEG);
        const radDegLon = radDegLat / Math.max(0.2, Math.cos(c.lat * DEG));
        const rimPts: THREE.Vector3[] = [];
        for (let a = 0; a <= 360; a += 15) {
          const rad = a * DEG;
          const rLat = c.lat + Math.sin(rad) * radDegLat;
          const rLon = c.lon + Math.cos(rad) * radDegLon;
          const p = toSurfaceVec3(rLat, rLon, 0.045);
          if (p) rimPts.push(p);
        }
        if (rimPts.length >= 6) {
          group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(rimPts), craterMat));
        }
      }
    }

    // 6. 3D Rover Routes (Route A, Route B, Route C) draped directly on the 3D lunar Surface
    if (showRoutes && routePlan && routePlan.routes.length > 0) {
      for (const route of routePlan.routes) {
        const isSelected = route.id === selectedRouteId;
        const lift = isSelected ? 0.068 : 0.048;
        const pts3D: THREE.Vector3[] = [];

        for (const pt of route.path) {
          const v = toSurfaceVec3(pt.lat, pt.lon, lift);
          if (v) pts3D.push(v);
        }

        if (pts3D.length >= 2) {
          const curve = new THREE.CatmullRomCurve3(pts3D);
          const tubeRadius =
            viewportMode === 'global_3d'
              ? isSelected
                ? 0.032
                : 0.018
              : isSelected
                ? 0.075
                : 0.042;
          const tubeGeom = new THREE.TubeGeometry(
            curve,
            Math.min(260, pts3D.length * 2),
            tubeRadius,
            8,
            false,
          );
          const tubeMat = new THREE.MeshBasicMaterial({
            color: route.accentColor,
            transparent: !isSelected,
            opacity: isSelected ? 1.0 : 0.55,
          });
          group.add(new THREE.Mesh(tubeGeom, tubeMat));

          // Intermediate waypoints for the selected route
          if (isSelected) {
            for (const wp of route.waypoints) {
              if (wp.index === 0 || wp.index === route.waypoints.length - 1) continue;
              const wpPos = toSurfaceVec3(wp.lat, wp.lon, lift + 0.025);
              if (!wpPos) continue;
              const wpMesh = new THREE.Mesh(
                new THREE.SphereGeometry(viewportMode === 'global_3d' ? 0.042 : 0.095, 10, 10),
                new THREE.MeshBasicMaterial({ color: route.accentColor }),
              );
              wpMesh.position.copy(wpPos);
              group.add(wpMesh);

              if (viewportMode === 'regional_3d' || route.waypoints.length <= 8 || wp.index % 2 === 1) {
                anchors.push({
                  id: `wp_${wp.index}`,
                  label: wp.label || `WP-${wp.index}`,
                  sublabel: `${wp.distanceFromStartKm.toFixed(1)} km · ${wp.slopeDeg.toFixed(1)}°`,
                  pos: wpPos,
                  normal: viewportMode === 'global_3d' ? wpPos.clone().normalize() : undefined,
                  kind: 'waypoint',
                  color: route.accentColor,
                  lat: wp.lat,
                  lon: wp.lon,
                });
              }
            }
          }
        }
      }

      // Start (A) and Destination (B) 3D Beacons
      const startPos = toSurfaceVec3(routeStart.lat, routeStart.lon, 0.085);
      if (startPos) {
        const sMesh = new THREE.Mesh(
          new THREE.SphereGeometry(viewportMode === 'global_3d' ? 0.068 : 0.15, 14, 14),
          new THREE.MeshBasicMaterial({ color: '#10B981' }),
        );
        sMesh.position.copy(startPos);
        group.add(sMesh);
        anchors.push({
          id: 'route_start_beacon',
          label: 'START (A)',
          sublabel: formatLatLonShort(routeStart.lat, routeStart.lon),
          pos: startPos,
          normal: viewportMode === 'global_3d' ? startPos.clone().normalize() : undefined,
          kind: 'route_start',
          color: '#10B981',
          lat: routeStart.lat,
          lon: routeStart.lon,
          active: true,
        });
      }

      const destPos = toSurfaceVec3(routeDestination.lat, routeDestination.lon, 0.085);
      if (destPos) {
        const dMesh = new THREE.Mesh(
          new THREE.SphereGeometry(viewportMode === 'global_3d' ? 0.068 : 0.15, 14, 14),
          new THREE.MeshBasicMaterial({ color: '#F59E0B' }),
        );
        dMesh.position.copy(destPos);
        group.add(dMesh);
        anchors.push({
          id: 'route_dest_beacon',
          label: 'DEST (B)',
          sublabel: formatLatLonShort(routeDestination.lat, routeDestination.lon),
          pos: destPos,
          normal: viewportMode === 'global_3d' ? destPos.clone().normalize() : undefined,
          kind: 'route_dest',
          color: '#F59E0B',
          lat: routeDestination.lat,
          lon: routeDestination.lon,
          active: true,
        });
      }
    }

    worldAnchorsRef.current = anchors;
  }, [
    viewportMode,
    globalDem,
    regionalPatch,
    exaggeration,
    selectedLocation,
    selectedSite,
    candidates,
    regionalCandidates,
    globeFeatures,
    routePlan,
    selectedRouteId,
    routeStart,
    routeDestination,
    showGraticule,
    showLandingCandidates,
    showNomenclature,
    showCraters,
    showRoutes,
  ]);

  const activeLayerMeta = SURFACE_LAYERS.find((l) => l.id === surfaceLayer) ?? SURFACE_LAYERS[0];

  const handleCoordinateJump = (e: React.FormEvent) => {
    e.preventDefault();
    const lat = parseFloat(coordInputLat);
    const lon = parseFloat(coordInputLon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    const clean = sanitizeLatLon(lat, lon);
    onSelectLocation(clean);
    flyToLocation(clean, viewportMode, 19.5);
  };

  return (
    <div className="tt-viewport-root">
      {/* SINGLE COMPACT FLOATING GLASS TOOLBAR */}
      <div className="tt-viewport-floating-bar">
        {/* View Mode Selector */}
        <div className="tt-vp-pill-group" title="3D View Mode">
          <button
            type="button"
            className={`tt-vp-pill-btn ${viewportMode === 'global_3d' ? 'active' : ''}`}
            onClick={() => onViewportModeChange('global_3d')}
          >
            Global Globe
          </button>
          <button
            type="button"
            className={`tt-vp-pill-btn ${viewportMode === 'regional_3d' && regionalSpanDeg > 0.35 ? 'active' : ''}`}
            onClick={() => {
              if (regionalSpanDeg <= 0.35) onRegionalSpanChange(0.6);
              onViewportModeChange('regional_3d');
            }}
          >
            Regional 3D
          </button>
          <button
            type="button"
            className={`tt-vp-pill-btn ${viewportMode === 'regional_3d' && regionalSpanDeg <= 0.35 ? 'active' : ''}`}
            onClick={() => {
              const inJezeroHiRise =
                selectedLocation.lat >= 18.35 &&
                selectedLocation.lat <= 18.55 &&
                selectedLocation.lon >= 77.36 &&
                selectedLocation.lon <= 77.52;
              if (!inJezeroHiRise) {
                onSelectLocation({ lat: 18.455, lon: 77.432 });
                onSetRouteStart({ lat: 18.4447, lon: 77.4508 });
                onSetRouteDestination({ lat: 18.472, lon: 77.412 });
              }
              onRegionalSpanChange(0.16);
              onViewportModeChange('regional_3d');
            }}
          >
            HiRISE Close-Up
          </button>
        </div>

        <div className="tt-vp-divider" />

        {/* Surface Layer Selector */}
        <select
          className="tt-vp-select"
          value={surfaceLayer}
          onChange={(e) => onSurfaceLayerChange(e.target.value as SurfaceLayerId)}
          aria-label="Moon Surface Layer"
        >
          {SURFACE_LAYERS.map((l) => (
            <option key={l.id} value={l.id}>
              Map: {l.shortLabel}
            </option>
          ))}
        </select>

        <div className="tt-vp-divider" />

        {/* Map Click Action */}
        <div className="tt-vp-pill-group" title="Map Click Action">
          <button
            type="button"
            className={`tt-vp-pill-btn ${clickMode === 'inspect_site' ? 'active' : ''}`}
            onClick={() => onClickModeChange('inspect_site')}
          >
            Inspect
          </button>
          <button
            type="button"
            className={`tt-vp-pill-btn ${clickMode === 'set_route_start' ? 'active' : ''}`}
            onClick={() => onClickModeChange('set_route_start')}
          >
            Set Start (A)
          </button>
          <button
            type="button"
            className={`tt-vp-pill-btn ${clickMode === 'set_route_dest' ? 'active' : ''}`}
            onClick={() => onClickModeChange('set_route_dest')}
          >
            Set End (B)
          </button>
        </div>

        <button
          type="button"
          className="tt-vp-select"
          onClick={() =>
            flyToLocation(
              {
                lat: (routeStart.lat + routeDestination.lat) * 0.5,
                lon: (routeStart.lon + routeDestination.lon) * 0.5,
              },
              viewportMode,
              17.5,
            )
          }
          title="Center camera on active rover route"
        >
          Center Route
        </button>
      </div>

      {/* THREE.JS 3D CANVAS MOUNT */}
      <div ref={mountRef} className="tt-three-canvas" />

      {/* 3D SURFACE-ANCHORED HTML MARKER LABELS */}
      <div className="tt-markers-layer">
        {screenMarkers.map((m) => (
          <button
            key={m.id}
            type="button"
            className={`tt-surface-marker kind-${m.kind} ${m.active ? 'is-active' : ''}`}
            style={{ left: `${m.x}px`, top: `${m.y}px`, borderColor: m.color }}
            onClick={() => {
              if (m.kind === 'rover') {
                onOpenRoverStudio();
                return;
              }
              const clean = sanitizeLatLon(m.lat, m.lon);
              onSelectLocation(clean);
              if (viewportMode === 'global_3d') {
                flyToLocation(clean, 'global_3d', 18.5);
              }
            }}
          >
            <span className="tt-marker-dot" style={{ backgroundColor: m.color }} />
            <span className="tt-marker-title">{m.label}</span>
            {m.sublabel && <span className="tt-marker-sub">{m.sublabel}</span>}
          </button>
        ))}
      </div>

      {/* MINIMAL BOTTOM-LEFT LEGEND PILL */}
      <div className="tt-viewport-bottom-left">
        <div className="tt-vp-glass-pill">
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: '#269B68',
              display: 'inline-block',
              flexShrink: 0,
            }}
          />
          <span style={{ whiteSpace: 'nowrap' }}>{activeLayerMeta.shortLabel}</span>
          {(loadingPatch || loadingRoutes) && (
            <span style={{ color: '#60A5FA', marginLeft: 4, fontWeight: 600, whiteSpace: 'nowrap' }}>
              · {loadingPatch ? 'Loading 3D…' : 'Routing…'}
            </span>
          )}
        </div>
      </div>

      {/* MINIMAL BOTTOM-RIGHT COORDINATE READOUT */}
      <div className="tt-viewport-bottom-right">
        <form
          onSubmit={handleCoordinateJump}
          className="tt-vp-glass-pill"
          style={{ padding: '4px 10px', gap: 6 }}
          title="Jump to Latitude / Longitude"
        >
          <span className="tt-mono" style={{ fontSize: 11.5 }}>
            {hoveredLocation
              ? `${formatLatLonShort(hoveredLocation.lat, hoveredLocation.lon)} · ${hoveredLocation.elevationM} m · ${hoveredLocation.slopeDeg.toFixed(1)}°`
              : `${formatLatLonShort(selectedLocation.lat, selectedLocation.lon)}`}
          </span>
        </form>
      </div>
    </div>
  );
};
