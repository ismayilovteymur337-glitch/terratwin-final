import { LatLon } from '../core/geo/sphere';
import {
  LandingSiteAnalysis,
  LandingSiteWeights,
  RouteModeId,
  RoutePlanResponse,
} from '../core/planet/types';
import { CustomRoverConfig, NasaRoverProfile, RoverId } from './rovers';

export type AgentTaskCategory =
  | 'mission_reasoning'
  | 'tool_orchestration'
  | 'conversational_followup'
  | 'visual_interpretation';

export interface LlmModelDescriptor {
  id: string;
  provider: 'openai' | 'gemini' | 'anthropic' | 'openrouter' | 'ollama' | 'terratwin_scientific_engine';
  displayName: string;
  configured: boolean;
  available: boolean;
  reasoningScore: number; // 0..100
  toolCallingScore: number; // 0..100
  structuredOutputSupport: boolean;
  multimodalSupport: boolean;
  contextWindowTokens: number;
  latencyClass: 'fast' | 'balanced' | 'deep';
  costPer1kTokensUsd: number;
  statusNote: string;
}

export interface LlmRouterConfig {
  mode: 'auto' | 'pinned';
  pinnedModelId?: string;
  preferLowLatency?: boolean;
  preferLowCost?: boolean;
  timeoutMs: number;
  maxRetries: number;
}

export interface LlmRouterDecision {
  selectedModelId: string;
  provider: LlmModelDescriptor['provider'];
  displayName: string;
  taskCategory: AgentTaskCategory;
  selectionReason: string;
  fallbackUsed: boolean;
  fallbackChain: string[];
  latencyMs: number;
  estimatedTokens: number;
  estimatedCostUsd: number;
}

export interface LlmRouterStatusResponse {
  config: LlmRouterConfig;
  models: LlmModelDescriptor[];
  stats: {
    totalRequests: number;
    totalFallbacks: number;
    totalEstimatedTokens: number;
    totalEstimatedCostUsd: number;
    lastDecision: LlmRouterDecision | null;
  };
}

export type ScienceDomainFocus =
  | 'ancient_water_biosignatures'
  | 'sedimentary_stratigraphy'
  | 'volcanic_tectonic'
  | 'subsurface_ice_isru'
  | 'general_geology';

export type MissionOptimizationPriority = 'safety' | 'balanced' | 'science' | 'shortest_distance';

export interface MissionSpecification {
  missionTitle: string;
  regionKey: string;
  regionName: string;
  targetCenter: LatLon;
  scienceObjective: ScienceDomainFocus;
  scienceObjectiveSummary: string;
  roverSource: 'nasa_fleet' | 'custom_saved' | 'custom_new';
  roverId: RoverId;
  proposedCustomRover?: CustomRoverConfig;
  customRoverConfirmed: boolean;
  requiredCapabilities: string[];
  optimizationPriority: MissionOptimizationPriority;
  maxAllowedSlopeDeg: number;
  slopeWeight: number;
  roughnessWeight: number;
  scienceWeight: number;
  maxTraverseDistanceKm?: number;
  landingWeights: LandingSiteWeights;
  completeness: 'needs_clarification' | 'ready_to_execute';
  missingFields: string[];
}

export interface AgentToolCallRecord {
  id: string;
  stepNumber: number;
  category: 'rover' | 'nasa_data' | 'analysis' | 'mission_planning' | 'map_interaction';
  toolName: string;
  title: string;
  inputSummary: string;
  outputSummary: string;
  durationMs: number;
  status: 'completed' | 'warning';
  dataProvenance?: string;
}

export interface MultiObjectiveRouteScore {
  routeId: RouteModeId;
  routeName: string;
  totalObjectiveScore: number; // 0..100
  terrainSafetyScore: number; // 0..100
  roverMobilityFitScore: number; // 0..100
  scienceValueScore: number; // 0..100
  distanceEfficiencyScore: number; // 0..100
  dataConfidenceScore: number; // 0..100
  weightsUsed: {
    terrainSafety: number;
    roverMobility: number;
    scienceValue: number;
    distanceEfficiency: number;
    dataConfidence: number;
  };
  formulaText: string;
  rationale: string;
}

export interface MissionExecutionReport {
  missionTitle: string;
  rover: NasaRoverProfile;
  isProposedCustomRover: boolean;
  proposedCustomRoverConfig?: CustomRoverConfig;
  objectiveSummary: string;
  recommendedLandingSite: LandingSiteAnalysis;
  alternativeLandingSites: LandingSiteAnalysis[];
  spacecraftVsRoverDisclaimer: string;
  selectedDestination: {
    name: string;
    type: string;
    lat: number;
    lon: number;
    rationale: string;
  };
  routePlan: RoutePlanResponse;
  recommendedRouteId: RouteModeId;
  routeObjectiveScores: MultiObjectiveRouteScore[];
  dataSourcesUsed: {
    id: string;
    title: string;
    resolution: string;
    crs: string;
    status: string;
  }[];
  confidenceAndLimitations: {
    overallConfidencePct: number;
    dtmCoverageNote: string;
    limitations: string[];
  };
  beginnerSummary: {
    whyThisRover: string;
    whyThisLandingSite: string;
    whyThisRoute: string;
    terrainDifficultyLabel: 'Easy & Flat' | 'Moderate Hills' | 'Challenging Terrain';
  };
}

export interface MapStateUpdateCommand {
  focusLocation: LatLon;
  viewportMode: 'global_3d' | 'regional_3d';
  regionalSpanDeg: number;
  selectRoverId?: RoverId;
  stageCustomRoverConfig?: CustomRoverConfig;
  autoApplyCustomRover?: boolean;
  routeStart: LatLon;
  routeDestination: LatLon;
  selectedRouteId: RouteModeId;
  maxAllowedSlopeDeg: number;
  slopeWeight: number;
  roughnessWeight: number;
  scienceWeight: number;
  landingWeights: LandingSiteWeights;
  openBottomDrawerTab?: 'route_profile' | 'route_compare' | 'site_matrix';
}

export interface AgentChatMessage {
  id: string;
  role: 'user' | 'assistant';
  timestamp: string;
  content: string;
  followUpQuestions?: {
    question: string;
    quickReplies: string[];
  }[];
  toolCalls?: AgentToolCallRecord[];
  missionSpec?: MissionSpecification;
  missionReport?: MissionExecutionReport;
  mapUpdate?: MapStateUpdateCommand;
  routerDecision?: LlmRouterDecision;
}

export interface AgentChatRequestPayload {
  messages: { role: 'user' | 'assistant'; content: string }[];
  currentSpec?: Partial<MissionSpecification> | null;
  experienceMode: 'beginner' | 'advanced';
  activeRoverId: RoverId;
  savedCustomRoverConfig: CustomRoverConfig;
  currentLocation: LatLon;
  currentRouteStart: LatLon;
  currentRouteDestination: LatLon;
}

export interface AgentChatResponsePayload {
  message: AgentChatMessage;
  updatedSpec: MissionSpecification;
  routerStatus: LlmRouterStatusResponse;
}
