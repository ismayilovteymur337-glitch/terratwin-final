/**
 * Planet-agnostic domain interfaces for TERRATWIN.
 * Separates shared geospatial intelligence structures from planetary-specific
 * constants and datasets so Moon and future Earth modules share the same
 * rendering, terrain analysis, scoring, and pathfinding architecture.
 */
import { BBox, LatLon } from '../geo/sphere';
import { MCDAResult, Provenance } from '../scoring/mcda';

export type PlanetId = 'moon' | 'earth';

export interface PlanetaryBodyConfig {
  id: PlanetId;
  name: string;
  meanRadiusM: number;
  equatorialRadiusM: number;
  polarRadiusM: number;
  surfaceGravityMps2: number;
  solarIrradianceWm2: number;
  verticalDatumName: string;
  coordinateSystemName: string;
  longitudeDirection: 'EAST' | 'WEST';
}

export interface GeologicalFeature {
  id: string;
  name: string;
  type: string;
  code: string;
  lat: number;
  lon: number;
  diameterKm: number;
  origin?: string;
  link?: string;
}

export interface CraterRecord {
  id: string;
  name?: string;
  lat: number;
  lon: number;
  diameterKm: number;
  depthRimFloorKm: number | null;
  morphology?: string;
  degradationState?: number | null;
}

export interface DtmCatalogEntry {
  id: string;
  collection: 'hirise_dtm' | 'ctx_dtm';
  title: string;
  gsdMeters: number;
  bbox: [number, number, number, number]; // [west, south, east, north]
  dtmUrl: string;
  hillshadeUrl?: string;
  orthoUrl?: string;
  thumbnailUrl?: string;
  created?: string;
}

export interface PointTerrainTelemetry {
  lat: number;
  lon: number;
  elevationM: number | null;
  slopeDeg: number | null;
  aspectDeg: number | null;
  triM: number | null;
  rmsReliefM: number | null;
  reliefSpanM: number | null;
  baselineM: number;
  lolaShotCount: number | null;
  terrainClassCode: number;
  terrainClassId: string;
  terrainClassLabel: string;
  terrainClassRule: string;
  resolutionSource: string;
  resolutionMetersPerPixel: number;
}

export interface AtmosphericEstimate {
  surfacePressurePa: number | null;
  atmosphericColumnKgM2: number | null;
  equinoxNoonIrradianceWm2: number | null;
  provenance: Provenance;
  modelNotes: string[];
}

export interface NearbyCraterSummary {
  searchRadiusKm: number;
  totalCount: number;
  cratersOver5Km: number;
  maxDiameterKm: number;
  arealDensityPer1000Km2: number;
  nearestCrater: (CraterRecord & { distanceKm: number; insideRim: boolean }) | null;
  craters: (CraterRecord & { distanceKm: number; insideRim: boolean })[];
}

export interface LandingSiteWeights {
  slopeSafety: number;
  roughnessSafety: number;
  craterHazardFree: number;
  elevationConstraint: number;
  latitudeThermal: number;
  scientificValue: number;
  dataConfidence: number;
}

export interface LandingSiteAnalysis {
  id: string;
  name: string;
  lat: number;
  lon: number;
  isCandidatePreset: boolean;
  referenceMission?: string;
  telemetry: PointTerrainTelemetry;
  regionalStats25Km: {
    elevationMinM: number;
    elevationMaxM: number;
    elevationMeanM: number;
    slopeMeanDeg: number;
    slopeP95Deg: number;
    slopeMaxDeg: number;
    triMeanM: number;
    triP95M: number;
    sampleCount: number;
  };
  atmosphere: AtmosphericEstimate;
  craterSummary: NearbyCraterSummary;
  nearbyFeatures: (GeologicalFeature & { distanceKm: number })[];
  availableDtms: DtmCatalogEntry[];
  suitability: MCDAResult;
  advantages: string[];
  disadvantages: string[];
  scientificSummary: string;
}

export type LandingSuitabilityWeights = LandingSiteWeights;
export type LandingSiteEvaluation = LandingSiteAnalysis;

export type RouteModeId = 'shortest' | 'terrain_optimized' | 'scientific_exploration';

export interface RouteWaypoint {
  index: number;
  lat: number;
  lon: number;
  distanceFromStartKm: number;
  elevationM: number;
  slopeDeg: number;
  triM: number;
  cumulativeGainM: number;
  cumulativeLossM: number;
  label?: string;
}

export interface RouteProfileSample {
  distanceKm: number;
  lat: number;
  lon: number;
  elevationM: number;
  slopeDeg: number;
  triM: number;
  costMultiplier: number;
  terrainClassId: string;
}

export interface RouteScienceTargetHit {
  id: string;
  name: string;
  type: string;
  lat: number;
  lon: number;
  closestApproachKm: number;
  alongRouteKm: number;
  diameterKm?: number;
}

export interface RouteObstacleSegment {
  type: 'steep_slope' | 'high_roughness_tri' | 'crater_rim_proximity';
  alongRouteKm: number;
  lat: number;
  lon: number;
  severity: 'advisory' | 'caution' | 'limit_near';
  valueLabel: string;
  description: string;
}

export interface RouteAnalytics {
  totalDistanceKm: number;
  straightLineDistanceKm: number;
  tortuosityRatio: number;
  elevationStartM: number;
  elevationEndM: number;
  elevationMinM: number;
  elevationMaxM: number;
  totalElevationGainM: number;
  totalElevationLossM: number;
  maxSlopeDeg: number;
  meanSlopeDeg: number;
  p95SlopeDeg: number;
  meanTriM: number;
  maxTriM: number;
  traversalCostIndex: number;
  normalizedCostRatio: number;
  gridResolutionM: number;
  gridDimensions: [number, number];
  expandedNodes: number;
  terrainClassBreakdown: Record<string, number>;
  scienceTargetsAlongRoute: RouteScienceTargetHit[];
  obstaclesAlongRoute: RouteObstacleSegment[];
}

export interface RoverRoute {
  id: RouteModeId;
  name: string;
  subtitle: string;
  accentColor: string;
  dashPattern?: [number, number];
  priorityDescription: string;
  costFormula: string;
  path: LatLon[];
  waypoints: RouteWaypoint[];
  profile: RouteProfileSample[];
  analytics: RouteAnalytics;
  scientificExplanation: string;
  roverSuitabilityExplanation: string;
}

export interface RoutePlanResponse {
  roverId: string;
  roverName: string;
  roverCodeName: string;
  effectiveMaxSlopeDeg: number;
  start: LatLon;
  destination: LatLon;
  bbox: BBox;
  gridResolutionMeters: number;
  gridSource: string;
  maxAllowedSlopeDeg: number;
  routes: RoverRoute[];
  warnings: string[];
}
