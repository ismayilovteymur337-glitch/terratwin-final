import React, { useEffect, useState } from 'react';
import { BottomTabId } from './BottomAnalysisPanel';
import { MapClickMode, ViewportMode } from './MoonViewport3D';
import {
  ExperienceMode,
  formatLatLon,
  formatLatLonShort,
  NavTab,
} from '../coordinate-state';
import {
  LandingSiteEvaluation,
  LandingSuitabilityWeights,
  RouteModeId,
  RoutePlanResponse,
  RoverRoute,
} from '../core/planet/types';
import {
  CURIOSITY_RAD_EXCERPT,
  LANDING_WEIGHT_PRESETS,
  MoonDatasetSource,
} from '../moon/constants';
import {
  CustomRoverConfig,
  getRoverBeginnerGuide,
  NASA_MOON_ROVERS,
  NasaRoverProfile,
  RoverId,
} from '../moon/rovers';

interface RightIntelligencePanelProps {
  experienceMode: ExperienceMode;
  onSelectExperienceMode: (mode: ExperienceMode) => void;
  activeTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  selectedLocation: { lat: number; lon: number };
  selectedSite: LandingSiteEvaluation | null;
  candidates: LandingSiteEvaluation[];
  regionalCandidates?: LandingSiteEvaluation[];
  weights: LandingSuitabilityWeights;
  onChangeWeights: (w: LandingSuitabilityWeights) => void;
  onResetWeights: () => void;
  onSelectCandidate: (lat: number, lon: number) => void;
  selectedRoverId: RoverId;
  selectedRover: NasaRoverProfile;
  onSelectRover: (id: RoverId) => void;
  customRoverConfig: CustomRoverConfig;
  onChangeCustomRoverConfig: (cfg: CustomRoverConfig) => void;
  onOpenRoverStudio: (initialTab?: 'overview' | 'engineering' | 'compare' | 'custom_builder') => void;
  routeStart: { lat: number; lon: number };
  routeDestination: { lat: number; lon: number };
  onSetRouteStart: (c: { lat: number; lon: number }) => void;
  onSetRouteDestination: (c: { lat: number; lon: number }) => void;
  clickMode: MapClickMode;
  onClickModeChange: (m: MapClickMode) => void;
  maxAllowedSlopeDeg: number;
  onChangeMaxSlope: (deg: number) => void;
  slopePriority: number;
  onChangeSlopePriority: (w: number) => void;
  roughnessPriority: number;
  onChangeRoughnessPriority: (w: number) => void;
  sciencePriority: number;
  onChangeSciencePriority: (w: number) => void;
  routePlan: RoutePlanResponse | null;
  selectedRouteId: RouteModeId;
  onSelectRoute: (id: RouteModeId) => void;
  loadingSite: boolean;
  loadingRoutes: boolean;
  curiosityRad: typeof CURIOSITY_RAD_EXCERPT | null;
  dataSources: MoonDatasetSource[];
  viewportMode: ViewportMode;
  onViewportModeChange: (m: ViewportMode) => void;
  onOpenBottomDrawer?: (tab?: BottomTabId) => void;
}

const FAMOUS_MOON_LANDMARKS = [
  {
    name: 'Jezero Crater Delta',
    tag: 'Ancient Lakebed · Perseverance',
    summary: 'An ancient river delta where water once flowed into a crater lake 3.7 billion years ago.',
    lat: 18.4447,
    lon: 77.4508,
    destLat: 18.525,
    destLon: 77.265,
  },
  {
    name: 'Gale Crater (Mount Sharp)',
    tag: 'Layered Mountain · Curiosity',
    summary: 'A 154 km crater holding a 5.5 km mountain of clay and sulfate layers that record Moon’ climate.',
    lat: -4.5895,
    lon: 137.4417,
    destLat: -4.68,
    destLon: 137.38,
  },
  {
    name: 'Valles Marineris',
    tag: 'Grand Canyon of Moon',
    summary: 'A colossal tectonic canyon system stretching 4,000 km across the lunar equator.',
    lat: -11.6,
    lon: -62.4,
    destLat: -11.45,
    destLon: -62.15,
  },
  {
    name: 'Olympus Mons',
    tag: 'Tallest Volcano in Solar System',
    summary: 'A shield volcano rising +21.2 km above the lunar datum—nearly 3× the height of Mount Everest.',
    lat: 18.65,
    lon: -133.8,
    destLat: 18.85,
    destLon: -133.55,
  },
];

const BEGINNER_MISSIONS = [
  {
    id: 'ancient_life',
    title: 'Find Signs of Ancient Life',
    subtitle: 'Prioritize ancient river deltas, clay minerals, and lakebeds',
    presetId: 'science_sample',
    scienceWeight: 1.75,
    slopeWeight: 1.2,
    roughnessWeight: 1.2,
  },
  {
    id: 'rocks_craters',
    title: 'Explore Rocks & Craters',
    subtitle: 'Balance safe driving with visits to nearby impact craters and outcrops',
    presetId: 'balanced',
    scienceWeight: 1.45,
    slopeWeight: 1.15,
    roughnessWeight: 1.15,
  },
  {
    id: 'safe_driving',
    title: 'Test Safe Rover Driving',
    subtitle: 'Stay on the flattest, smoothest ground to protect the robot’s wheels',
    presetId: 'rover_traverse',
    scienceWeight: 0.85,
    slopeWeight: 2.0,
    roughnessWeight: 2.0,
  },
  {
    id: 'high_interest',
    title: 'Reach a High-Interest Target',
    subtitle: 'Take the most direct safe path between Start (A) and Destination (B)',
    presetId: 'edl_safety',
    scienceWeight: 1.0,
    slopeWeight: 1.4,
    roughnessWeight: 1.4,
  },
];

export const RightIntelligencePanel: React.FC<RightIntelligencePanelProps> = (props) => {
  const {
    experienceMode,
    activeTab,
    onSelectTab,
    selectedLocation,
    selectedSite,
    candidates,
    regionalCandidates = [],
    weights,
    onChangeWeights,
    onResetWeights,
    onSelectCandidate,
    selectedRoverId,
    selectedRover,
    onSelectRover,
    onOpenRoverStudio,
    routeStart,
    routeDestination,
    onSetRouteStart,
    onSetRouteDestination,
    clickMode,
    onClickModeChange,
    maxAllowedSlopeDeg,
    onChangeMaxSlope,
    slopePriority,
    onChangeSlopePriority,
    roughnessPriority,
    onChangeRoughnessPriority,
    sciencePriority,
    onChangeSciencePriority,
    routePlan,
    selectedRouteId,
    onSelectRoute,
    loadingRoutes,
    curiosityRad,
    dataSources,
    viewportMode,
    onViewportModeChange,
    onOpenBottomDrawer,
  } = props;

  // Beginner 6-Step Guided Workflow state (1 .. 6)
  const [beginnerStep, setBeginnerStep] = useState<number>(1);
  const [selectedMissionGoal, setSelectedMissionGoal] = useState<string>('ancient_life');

  // Sync Beginner Step when the user clicks a Left Sidebar item
  useEffect(() => {
    if (activeTab === 'explorer_3d') setBeginnerStep(1);
    else if (activeTab === 'rover_fleet' || activeTab === 'custom_rover') setBeginnerStep(2);
    else if (activeTab === 'landing_site') setBeginnerStep(4);
    else if (activeTab === 'route_planner') setBeginnerStep(5);
    else if (activeTab === 'route_comparison') setBeginnerStep(6);
  }, [activeTab]);

  const activeRoute: RoverRoute | null =
    routePlan?.routes.find((r) => r.id === selectedRouteId) ??
    routePlan?.routes[1] ??
    routePlan?.routes[0] ??
    null;


  // Data Library: shared by beginner and advanced modes
  const statusLabel: Record<MoonDatasetSource['status'], string> = {
    bundled_verified: 'Bundled',
    live_streamed: 'Live',
    catalog_indexed: 'Reference',
  };
  const renderDataLibrary = () => (
    <>
      <p className="tt-section-desc" style={{ margin: 0 }}>
        {dataSources.length} NASA datasets behind TERRATWIN. Each card says what it is used for and where its limits are.
      </p>
      {curiosityRad && (
        <div className="tt-card">
          <span className="tt-badge moon" style={{ marginBottom: 6 }}>
            MSL Curiosity RAD Surface Dosimetry
          </span>
          <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>{curiosityRad.productVersion}</h3>
          <div className="tt-mono" style={{ fontSize: 13, fontWeight: 700, color: 'var(--moon-accent)', marginBottom: 6 }}>
            GCR Dose Equivalent: {curiosityRad.meanDoseEquivalentUSvPerDay} µSv/day ({curiosityRad.meanDoseRateUGyPerDay} {curiosityRad.unit})
          </div>
          <p style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>{curiosityRad.citation}</p>
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {dataSources.map((ds) => (
          <div key={ds.id} className="tt-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 4 }}>
              <strong style={{ fontSize: 13.5 }}>{ds.title}</strong>
              <span className="tt-badge blue" style={{ flexShrink: 0 }}>{statusLabel[ds.status] ?? ds.status}</span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6 }}>
              {ds.instrument} · {ds.agency}
            </div>
            <p style={{ fontSize: 12.5, color: 'var(--text-primary)', marginBottom: 6 }}>{ds.description}</p>
            <div className="tt-mono" style={{ fontSize: 11.5, color: 'var(--text-secondary)', marginBottom: 4 }}>
              Resolution: {String(ds.resolution ?? '—')}
            </div>
            {ds.limitations && (
              <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', marginBottom: 6 }}>
                <strong>Limits:</strong> {ds.limitations}
              </div>
            )}
            {ds.url && /^https?:\/\//.test(ds.url) && (
              <a href={ds.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, fontWeight: 600, color: 'var(--moon-accent)' }}>
                Open source ↗
              </a>
            )}
          </div>
        ))}
      </div>
    </>
  );

  // ==========================================================================
  // BEGINNER MODE: CLEAN 6-STEP GUIDED EXPERIENCE
  // ==========================================================================
  if (experienceMode === 'beginner' && activeTab === 'data_sources') {
    return (
      <aside className="tt-right-panel" aria-label="NASA Data Library">
        <div className="tt-right-panel-header">
          <span className="tt-section-eyebrow" style={{ margin: 0 }}>Data Library</span>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: '4px 0 0' }}>NASA data sources</h2>
        </div>
        <div className="tt-right-panel-scroll">{renderDataLibrary()}</div>
      </aside>
    );
  }

  if (experienceMode === 'beginner') {
    const stepTitles = [
      'Explore Moon',
      'Choose Your Robot',
      'Choose Your Mission',
      'Find a Suitable Location',
      'Plan Your Route',
      'Understand the Results',
    ];

    const siteScore =
      selectedSite?.suitability.total !== null && selectedSite?.suitability.total !== undefined
        ? Math.round(selectedSite.suitability.total * 100)
        : 82;

    const slopeDeg = selectedSite?.telemetry.slopeDeg ?? 1.8;
    const roughnessM = selectedSite?.telemetry.triM ?? 9.5;
    const elevM = selectedSite?.telemetry.elevationM ?? -2540;
    const roverGuide = getRoverBeginnerGuide(selectedRover);

    return (
      <aside className="tt-right-panel" aria-label="Guided Moon Mission Assistant">
        {/* Step Progress Header */}
        <div className="tt-right-panel-header">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <span className="tt-section-eyebrow" style={{ margin: 0 }}>
              Step {beginnerStep} of 6
            </span>
            <div style={{ display: 'flex', gap: 5 }}>
              {[1, 2, 3, 4, 5, 6].map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setBeginnerStep(s)}
                  title={`Step ${s}: ${stepTitles[s - 1]}`}
                  style={{
                    width: s === beginnerStep ? 24 : 8,
                    height: 8,
                    borderRadius: 999,
                    border: 'none',
                    background:
                      s === beginnerStep
                        ? 'var(--moon-accent)'
                        : s < beginnerStep
                          ? 'var(--rec-green)'
                          : 'var(--bg-secondary)',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                  }}
                />
              ))}
            </div>
          </div>

          <h2 className="tt-section-title">{stepTitles[beginnerStep - 1]}</h2>
        </div>

        {/* Step Body */}
        <div className="tt-right-panel-scroll">
          {/* STEP 1: EXPLORE MOON */}
          {beginnerStep === 1 && (
            <>
              <p className="tt-section-desc">
                Welcome to Moon. Rotate the 3D planet on the left, or choose one of NASA’s famous exploration regions below to fly there immediately.
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {FAMOUS_MOON_LANDMARKS.map((lm) => {
                  const isCurrent =
                    Math.abs(selectedLocation.lat - lm.lat) < 1.2 &&
                    Math.abs(selectedLocation.lon - lm.lon) < 1.2;
                  return (
                    <div
                      key={lm.name}
                      onClick={() => {
                        onSelectCandidate(lm.lat, lm.lon);
                        onSetRouteStart({ lat: lm.lat, lon: lm.lon });
                        onSetRouteDestination({ lat: lm.destLat, lon: lm.destLon });
                      }}
                      className={`tt-card-interactive ${isCurrent ? 'selected' : ''}`}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                        <strong style={{ fontSize: 15 }}>{lm.name}</strong>
                        <span className="tt-badge moon">{lm.tag}</span>
                      </div>
                      <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.45 }}>
                        {lm.summary}
                      </p>
                    </div>
                  );
                })}
              </div>

              <div className="tt-card-soft">
                <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>
                  Want a closer 3D look at the ground?
                </div>
                <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>
                  Switch from the whole planet to a close-up 3D mountain and crater view around{' '}
                  <strong>{selectedSite?.name.split('(')[0].trim() || 'your selected spot'}</strong>.
                </p>
                <button
                  type="button"
                  className="tt-btn-secondary"
                  style={{ width: '100%' }}
                  onClick={() =>
                    onViewportModeChange(viewportMode === 'global_3d' ? 'regional_3d' : 'global_3d')
                  }
                >
                  {viewportMode === 'global_3d'
                    ? 'Zoom Into 3D Surface View'
                    : 'Return to Full 3D Moon Globe'}
                </button>
              </div>

              <button
                type="button"
                className="tt-btn-primary"
                style={{ width: '100%' }}
                onClick={() => setBeginnerStep(2)}
              >
                Next: Choose Your Robot →
              </button>
            </>
          )}

          {/* STEP 2: CHOOSE YOUR ROBOT */}
          {beginnerStep === 2 && (
            <>
              <p className="tt-section-desc">
                Every Moon robot has different wheels, size, and climbing ability. Pick a real NASA rover or design your own custom robot.
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {NASA_MOON_ROVERS.map((r) => {
                  const isSel = selectedRover.id === r.id;
                  const guide = getRoverBeginnerGuide(r);
                  return (
                    <div
                      key={r.id}
                      onClick={() => onSelectRover(r.id)}
                      className={`tt-card-interactive ${isSel ? 'selected' : ''}`}
                      style={{ display: 'flex', gap: 12, alignItems: 'center' }}
                    >
                      <img
                        src={r.officialPhotos[0]?.url}
                        alt={r.name}
                        style={{
                          width: 58,
                          height: 58,
                          borderRadius: 12,
                          objectFit: 'cover',
                          flexShrink: 0,
                          background: '#17191D',
                        }}
                      />
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
                          <strong style={{ fontSize: 15 }}>{r.name}</strong>
                          <span className={`tt-badge ${r.status === 'OPERATIONAL' ? 'green' : ''}`}>
                            {r.status === 'OPERATIONAL' ? 'Active' : 'Historical'}
                          </span>
                        </div>
                        <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginBottom: 4 }}>
                          {r.wheels.count} wheels · Safe up to {r.mobilityProfile.operationalMaxSlopeDeg}° hills
                        </div>
                        <div style={{ fontSize: 12.5, color: 'var(--text-primary)' }}>
                          {guide.whatDesignedToDo.split('.')[0]}.
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Why is this robot a good choice? */}
              <div className="tt-card-soft" style={{ borderLeft: '3px solid var(--rec-green)' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--rec-green)', marginBottom: 4 }}>
                  Why is {selectedRover.name} a good choice?
                </div>
                <p style={{ fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.5 }}>
                  {roverGuide.whatMakesItDifferent}
                </p>
              </div>

              <button
                type="button"
                className="tt-btn-secondary"
                style={{ width: '100%' }}
                onClick={() => onOpenRoverStudio('custom_builder')}
              >
                ★ Build Your Own Custom Moon Robot
              </button>

              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  type="button"
                  className="tt-btn-secondary"
                  style={{ flex: 1 }}
                  onClick={() => setBeginnerStep(1)}
                >
                  ← Back
                </button>
                <button
                  type="button"
                  className="tt-btn-primary"
                  style={{ flex: 2 }}
                  onClick={() => setBeginnerStep(3)}
                >
                  Next: Choose Your Mission →
                </button>
              </div>
            </>
          )}

          {/* STEP 3: CHOOSE YOUR MISSION */}
          {beginnerStep === 3 && (
            <>
              <p className="tt-section-desc">
                What should <strong>{selectedRover.name}</strong> focus on during this mission? Your choice adjusts how TERRATWIN scores landing sites and routes.
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {BEGINNER_MISSIONS.map((m) => {
                  const isSel = selectedMissionGoal === m.id;
                  return (
                    <div
                      key={m.id}
                      onClick={() => {
                        setSelectedMissionGoal(m.id);
                        const preset = LANDING_WEIGHT_PRESETS.find((p) => p.id === m.presetId);
                        if (preset) onChangeWeights(preset.weights);
                        onChangeSlopePriority(m.slopeWeight);
                        onChangeRoughnessPriority(m.roughnessWeight);
                        onChangeSciencePriority(m.scienceWeight);
                      }}
                      className={`tt-card-interactive ${isSel ? 'selected' : ''}`}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                        <strong style={{ fontSize: 15 }}>{m.title}</strong>
                        {isSel && <span className="tt-badge green">Selected</span>}
                      </div>
                      <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.45 }}>
                        {m.subtitle}
                      </p>
                    </div>
                  );
                })}
              </div>

              <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                <button
                  type="button"
                  className="tt-btn-secondary"
                  style={{ flex: 1 }}
                  onClick={() => setBeginnerStep(2)}
                >
                  ← Back
                </button>
                <button
                  type="button"
                  className="tt-btn-primary"
                  style={{ flex: 2 }}
                  onClick={() => setBeginnerStep(4)}
                >
                  Next: Check Location →
                </button>
              </div>
            </>
          )}

          {/* STEP 4: FIND A SUITABLE LOCATION */}
          {beginnerStep === 4 && (
            <>
              <p className="tt-section-desc">
                Click any spot on the 3D Moon globe to check if it is safe for landing and driving.
              </p>

              {/* Main Location Suitability Score Card */}
              <div className="tt-card" style={{ borderLeft: `4px solid ${siteScore >= 72 ? 'var(--rec-green)' : 'var(--warn-amber)'}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                  <div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600 }}>
                      Selected Moon Location
                    </div>
                    <h3 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>
                      {selectedSite?.name.split('(')[0].trim() || 'Custom Surface Point'}
                    </h3>
                    <div className="tt-mono" style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                      {formatLatLonShort(selectedLocation.lat, selectedLocation.lon)}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div
                      style={{
                        fontSize: 26,
                        fontWeight: 800,
                        color: siteScore >= 72 ? 'var(--rec-green)' : 'var(--warn-amber)',
                        lineHeight: 1,
                      }}
                    >
                      {siteScore}/100
                    </div>
                    <span className={`tt-badge ${siteScore >= 72 ? 'green' : 'amber'}`} style={{ marginTop: 4 }}>
                      {siteScore >= 75 ? 'Great Site' : siteScore >= 55 ? 'Moderate Caution' : 'Hazardous'}
                    </span>
                  </div>
                </div>

                {/* Plain Human Language Questions */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 14 }}>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
                      <span style={{ color: 'var(--text-secondary)' }}>How steep is the ground?</span>
                      <strong>
                        {slopeDeg.toFixed(1)}° ({slopeDeg < 3 ? 'Very Flat & Safe' : slopeDeg < 8 ? 'Gentle Tilt' : 'Steep Hill'})
                      </strong>
                    </div>
                    <div className="tt-progress-track">
                      <div
                        className="tt-progress-fill"
                        style={{
                          width: `${Math.max(12, Math.min(100, 100 - slopeDeg * 4))}%`,
                          background: slopeDeg < 5 ? 'var(--rec-green)' : 'var(--warn-amber)',
                        }}
                      />
                    </div>
                  </div>

                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
                      <span style={{ color: 'var(--text-secondary)' }}>How uneven is the surface?</span>
                      <strong>
                        {roughnessM < 12 ? 'Smooth Ground' : roughnessM < 25 ? 'Moderately Bumpy' : 'Rough & Rocky'}
                      </strong>
                    </div>
                    <div className="tt-progress-track">
                      <div
                        className="tt-progress-fill"
                        style={{
                          width: `${Math.max(15, Math.min(100, 100 - roughnessM * 2))}%`,
                          background: roughnessM < 18 ? 'var(--rec-green)' : 'var(--warn-amber)',
                        }}
                      />
                    </div>
                  </div>

                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                      <span style={{ color: 'var(--text-secondary)' }}>How high or low is the ground?</span>
                      <strong>
                        {elevM} m ({elevM < -1000 ? 'Deep basin — thick air for parachutes' : 'High ground — thinner air'})
                      </strong>
                    </div>
                  </div>
                </div>
              </div>

              {/* Why is this a good choice? */}
              <div className="tt-card-soft" style={{ borderLeft: '3px solid var(--rec-green)' }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--rec-green)', marginBottom: 4 }}>
                  Why is this a good choice?
                </div>
                <p style={{ fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.5 }}>
                  {selectedSite?.advantages?.[0] ||
                    'Gentle slopes, low surface bumpiness, and deep basin elevation give parachutes plenty of atmosphere to slow down safely.'}
                </p>
              </div>

              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  type="button"
                  className="tt-btn-secondary"
                  style={{ flex: 1 }}
                  onClick={() => setBeginnerStep(3)}
                >
                  ← Back
                </button>
                <button
                  type="button"
                  className="tt-btn-primary"
                  style={{ flex: 2 }}
                  onClick={() => setBeginnerStep(5)}
                >
                  Next: Plan Your Route →
                </button>
              </div>
            </>
          )}

          {/* STEP 5: PLAN YOUR ROUTE */}
          {beginnerStep === 5 && (
            <>
              <p className="tt-section-desc">
                Choose where <strong>{selectedRover.name}</strong> starts driving (A) and where it should go (B). You can click directly on the 3D Moon map.
              </p>

              <div className="tt-card">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
                  <button
                    type="button"
                    onClick={() =>
                      onClickModeChange(clickMode === 'set_route_start' ? 'inspect_site' : 'set_route_start')
                    }
                    className={`tt-card-interactive ${clickMode === 'set_route_start' ? 'selected' : ''}`}
                    style={{ padding: 12, textAlign: 'left' }}
                  >
                    <div style={{ fontSize: 11.5, color: 'var(--rec-green)', fontWeight: 700 }}>
                      START POINT (A)
                    </div>
                    <div className="tt-mono" style={{ fontSize: 12.5, fontWeight: 600, marginTop: 2 }}>
                      {formatLatLonShort(routeStart.lat, routeStart.lon)}
                    </div>
                    <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', marginTop: 4 }}>
                      {clickMode === 'set_route_start' ? 'Click Moon map now…' : 'Click to move Start'}
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      onClickModeChange(clickMode === 'set_route_dest' ? 'inspect_site' : 'set_route_dest')
                    }
                    className={`tt-card-interactive ${clickMode === 'set_route_dest' ? 'selected' : ''}`}
                    style={{ padding: 12, textAlign: 'left' }}
                  >
                    <div style={{ fontSize: 11.5, color: 'var(--moon-accent)', fontWeight: 700 }}>
                      DESTINATION (B)
                    </div>
                    <div className="tt-mono" style={{ fontSize: 12.5, fontWeight: 600, marginTop: 2 }}>
                      {formatLatLonShort(routeDestination.lat, routeDestination.lon)}
                    </div>
                    <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', marginTop: 4 }}>
                      {clickMode === 'set_route_dest' ? 'Click Moon map now…' : 'Click to move End'}
                    </div>
                  </button>
                </div>

                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
                  How careful should the robot be?
                </div>
                <div className="tt-vp-pill-group" style={{ width: '100%', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)' }}>
                  <button
                    type="button"
                    className={`tt-vp-pill-btn ${slopePriority >= 1.7 ? 'active' : ''}`}
                    onClick={() => {
                      onChangeSlopePriority(2.0);
                      onChangeRoughnessPriority(2.0);
                      onSelectRoute('terrain_optimized');
                    }}
                  >
                    Extra Safe
                  </button>
                  <button
                    type="button"
                    className={`tt-vp-pill-btn ${slopePriority > 1.0 && slopePriority < 1.7 ? 'active' : ''}`}
                    onClick={() => {
                      onChangeSlopePriority(1.25);
                      onChangeRoughnessPriority(1.25);
                      onSelectRoute('terrain_optimized');
                    }}
                  >
                    Balanced
                  </button>
                  <button
                    type="button"
                    className={`tt-vp-pill-btn ${selectedRouteId === 'scientific_exploration' ? 'active' : ''}`}
                    onClick={() => {
                      onChangeSciencePriority(1.75);
                      onSelectRoute('scientific_exploration');
                    }}
                  >
                    More Science
                  </button>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  type="button"
                  className="tt-btn-secondary"
                  style={{ flex: 1 }}
                  onClick={() => setBeginnerStep(4)}
                >
                  ← Back
                </button>
                <button
                  type="button"
                  className="tt-btn-primary"
                  style={{ flex: 2 }}
                  onClick={() => setBeginnerStep(6)}
                >
                  See Route Results →
                </button>
              </div>
            </>
          )}

          {/* STEP 6: UNDERSTAND THE RESULTS */}
          {beginnerStep === 6 && (
            <>
              <p className="tt-section-desc">
                TERRATWIN calculated 3 real paths across the lunar terrain for <strong>{selectedRover.name}</strong>. Click any route below to highlight it on the 3D map.
              </p>

              {routePlan && routePlan.routes.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {routePlan.routes.map((r) => {
                    const isSel = r.id === selectedRouteId;
                    const isRec = r.id === 'terrain_optimized';
                    const friendlyTitle =
                      r.id === 'terrain_optimized'
                        ? 'Safest Balanced Route'
                        : r.id === 'scientific_exploration'
                          ? 'Science Discovery Route'
                          : 'Direct Shortest Route';
                    return (
                      <div
                        key={r.id}
                        onClick={() => onSelectRoute(r.id)}
                        className={`tt-card-interactive ${isSel ? 'selected' : ''}`}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ width: 10, height: 10, borderRadius: '50%', background: r.accentColor }} />
                            <strong style={{ fontSize: 15 }}>{friendlyTitle}</strong>
                          </div>
                          {isRec && <span className="tt-badge green">Recommended</span>}
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginTop: 8 }}>
                          <div>
                            <div style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>Distance</div>
                            <div className="tt-mono" style={{ fontSize: 14, fontWeight: 700 }}>
                              {r.analytics.totalDistanceKm.toFixed(1)} km
                            </div>
                          </div>
                          <div>
                            <div style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>Steepest Hill</div>
                            <div className="tt-mono" style={{ fontSize: 14, fontWeight: 700 }}>
                              {r.analytics.maxSlopeDeg.toFixed(1)}°
                            </div>
                          </div>
                          <div>
                            <div style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>Difficulty</div>
                            <div style={{ fontSize: 13, fontWeight: 700, color: isRec ? 'var(--rec-green)' : 'var(--text-primary)' }}>
                              {r.analytics.maxSlopeDeg <= selectedRover.mobilityProfile.optimalSlopeDeg
                                ? 'Easy & Safe'
                                : r.analytics.maxSlopeDeg <= selectedRover.mobilityProfile.operationalMaxSlopeDeg
                                  ? 'Moderate'
                                  : 'Hard'}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="tt-card-soft">
                  {loadingRoutes ? 'Computing 3D routes…' : 'Select Start and Destination points to view routes.'}
                </div>
              )}

              {/* Plain-Language Explanation Card */}
              {activeRoute && (
                <div className="tt-card-soft" style={{ borderLeft: '3px solid var(--rec-green)' }}>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--rec-green)', marginBottom: 6 }}>
                    Why is this a good choice?
                  </div>
                  <p style={{ fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.5, marginBottom: 10 }}>
                    {activeRoute.roverSuitabilityExplanation}
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12.5, color: 'var(--text-secondary)' }}>
                    <div>
                      • <strong>How difficult is this terrain for the robot?</strong>{' '}
                      Average steepness is {activeRoute.analytics.meanSlopeDeg.toFixed(1)}° (max {activeRoute.analytics.maxSlopeDeg.toFixed(1)}°).
                    </div>
                    <div>
                      • <strong>How much does the ground rise or fall?</strong>{' '}
                      +{activeRoute.analytics.totalElevationGainM} m climb / -{activeRoute.analytics.totalElevationLossM} m descent.
                    </div>
                  </div>
                </div>
              )}

              {onOpenBottomDrawer && (
                <button
                  type="button"
                  className="tt-btn-secondary"
                  style={{ width: '100%' }}
                  onClick={() => onOpenBottomDrawer('route_profile')}
                >
                  Open Elevation & Steepness Chart
                </button>
              )}

              <button
                type="button"
                className="tt-btn-ghost"
                style={{ width: '100%' }}
                onClick={() => setBeginnerStep(1)}
              >
                ↺ Restart Guided Tour from Step 1
              </button>
            </>
          )}
        </div>
      </aside>
    );
  }

  // ==========================================================================
  // ADVANCED MODE: PROGRESSIVE-DISCLOSURE CONTEXTUAL ENGINEERING INSPECTOR
  // ==========================================================================
  const normalizedTab: NavTab =
    activeTab === 'custom_rover'
      ? 'rover_fleet'
      : activeTab === 'route_comparison'
        ? 'route_planner'
        : activeTab;

  return (
    <aside className="tt-right-panel" aria-label="Advanced Engineering Inspector">
      <div className="tt-right-panel-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span className="tt-section-eyebrow" style={{ margin: 0 }}>
            Advanced Engineering Inspector
          </span>
          <span className="tt-badge blue">IAU_2015:49910</span>
        </div>

        {/* Clean Section Switcher */}
        <div className="tt-vp-pill-group" style={{ width: '100%', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)' }}>
          <button
            type="button"
            className={`tt-vp-pill-btn ${normalizedTab === 'explorer_3d' || normalizedTab === 'landing_site' ? 'active' : ''}`}
            onClick={() => onSelectTab('landing_site')}
          >
            Terrain
          </button>
          <button
            type="button"
            className={`tt-vp-pill-btn ${normalizedTab === 'rover_fleet' ? 'active' : ''}`}
            onClick={() => onSelectTab('rover_fleet')}
          >
            Rover
          </button>
          <button
            type="button"
            className={`tt-vp-pill-btn ${normalizedTab === 'route_planner' ? 'active' : ''}`}
            onClick={() => onSelectTab('route_planner')}
          >
            Routing
          </button>
          <button
            type="button"
            className={`tt-vp-pill-btn ${normalizedTab === 'data_sources' ? 'active' : ''}`}
            onClick={() => onSelectTab('data_sources')}
          >
            Data
          </button>
        </div>
      </div>

      <div className="tt-right-panel-scroll">
        {/* 1. TERRAIN & LANDING SUITABILITY */}
        {(normalizedTab === 'explorer_3d' || normalizedTab === 'landing_site') && (
          <>
            <div className="tt-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                <div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600 }}>
                    Target Surface Coordinate
                  </div>
                  <h3 style={{ fontSize: 17, fontWeight: 700 }}>
                    {selectedSite?.name || 'Surface Telemetry Point'}
                  </h3>
                  <div className="tt-mono" style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                    {formatLatLon(selectedLocation.lat, selectedLocation.lon)}
                  </div>
                </div>
                {selectedSite && (
                  <div style={{ textAlign: 'right' }}>
                    <div className="tt-mono" style={{ fontSize: 22, fontWeight: 700, color: 'var(--rec-green)' }}>
                      {Math.round((selectedSite.suitability.total ?? 0) * 100)}
                      <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>/100</span>
                    </div>
                    <span className="tt-badge green">MCDA Score</span>
                  </div>
                )}
              </div>

              {selectedSite && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 12 }}>
                  <div className="tt-card-soft" style={{ padding: 10 }}>
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>LOLA Elevation</div>
                    <div className="tt-mono" style={{ fontSize: 14, fontWeight: 700 }}>
                      {selectedSite.telemetry.elevationM ?? '—'} m
                    </div>
                  </div>
                  <div className="tt-card-soft" style={{ padding: 10 }}>
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Horn 3×3 Slope</div>
                    <div className="tt-mono" style={{ fontSize: 14, fontWeight: 700 }}>
                      {selectedSite.telemetry.slopeDeg?.toFixed(2) ?? '—'}°
                    </div>
                  </div>
                  <div className="tt-card-soft" style={{ padding: 10 }}>
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Roughness (TRI)</div>
                    <div className="tt-mono" style={{ fontSize: 14, fontWeight: 700 }}>
                      {selectedSite.telemetry.triM ?? '—'} m
                    </div>
                  </div>
                  <div className="tt-card-soft" style={{ padding: 10 }}>
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>LOLA Shot Density</div>
                    <div className="tt-mono" style={{ fontSize: 14, fontWeight: 700 }}>
                      {selectedSite.telemetry.lolaShotCount ?? '—'} shots
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Multi-Criteria Suitability Breakdown */}
            {selectedSite && (
              <div className="tt-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <strong style={{ fontSize: 14 }}>Suitability Criteria & Weights</strong>
                  <button type="button" className="tt-btn-ghost" onClick={onResetWeights}>
                    Reset
                  </button>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {(
                    [
                      ['slopeSafety', 'Slope Safety'],
                      ['roughnessSafety', 'Surface Roughness (TRI)'],
                      ['elevationConstraint', 'Atmospheric EDL Margin'],
                      ['craterHazardFree', 'Crater Rim Clearance'],
                      ['scientificValue', 'Geological Science Value'],
                      ['dataConfidence', 'Orbital DTM Coverage'],
                    ] as const
                  ).map(([key, label]) => {
                    const weightVal = weights[key];
                    const itemMatch = selectedSite.suitability.criteria.find((b) => b.id === key);
                    const pct = itemMatch && itemMatch.score !== null ? Math.round(itemMatch.score * 100) : 80;
                    return (
                      <div key={key}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 4 }}>
                          <span>{label}</span>
                          <span className="tt-mono">
                            Score: <strong>{pct}%</strong> · Weight: {(weightVal * 100).toFixed(0)}%
                          </span>
                        </div>
                        <input
                          type="range"
                          className="tt-slider"
                          min={0}
                          max={0.5}
                          step={0.02}
                          value={weightVal}
                          onChange={(e) =>
                            onChangeWeights({
                              ...weights,
                              [key]: Number(e.target.value),
                            })
                          }
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Top Regional ROI Candidates */}
            <div className="tt-card">
              <strong style={{ fontSize: 14, display: 'block', marginBottom: 10 }}>
                Candidate Landing Sites ({regionalCandidates.length > 0 ? 'Regional ROI' : 'Global'})
              </strong>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {(regionalCandidates.length > 0 ? regionalCandidates : candidates).slice(0, 5).map((c, idx) => {
                  const sc = c.suitability.total !== null ? Math.round(c.suitability.total * 100) : 0;
                  return (
                    <div
                      key={c.id}
                      onClick={() => onSelectCandidate(c.lat, c.lon)}
                      className="tt-card-interactive"
                      style={{ padding: '10px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                    >
                      <div>
                        <strong style={{ fontSize: 13 }}>
                          #{idx + 1} {c.name.split('(')[0].trim()}
                        </strong>
                        <div className="tt-mono" style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
                          {formatLatLonShort(c.lat, c.lon)} · {c.telemetry.slopeDeg?.toFixed(2) ?? '0'}° · {c.telemetry.elevationM ?? 0} m
                        </div>
                      </div>
                      <span className={`tt-badge ${sc >= 75 ? 'green' : 'amber'}`}>{sc}/100</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}

        {/* 2. ROVER FLEET & MOBILITY ENGINEERING */}
        {normalizedTab === 'rover_fleet' && (
          <>
            <div className="tt-card">
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12 }}>
                <img
                  src={selectedRover.officialPhotos[0]?.url}
                  alt={selectedRover.name}
                  style={{ width: 64, height: 64, borderRadius: 12, objectFit: 'cover', background: '#17191D' }}
                />
                <div>
                  <span className="tt-badge green">{selectedRover.codeName}</span>
                  <h3 style={{ fontSize: 18, fontWeight: 700, marginTop: 2 }}>{selectedRover.name}</h3>
                  <div style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>
                    {selectedRover.landingSiteName}
                  </div>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 14 }}>
                <div className="tt-card-soft" style={{ padding: 10 }}>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Wheel System</div>
                  <div className="tt-mono" style={{ fontSize: 13, fontWeight: 700 }}>
                    {selectedRover.wheels.count} × Ø{selectedRover.wheels.diameterCm} cm
                  </div>
                </div>
                <div className="tt-card-soft" style={{ padding: 10 }}>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Vehicle Mass / Power</div>
                  <div className="tt-mono" style={{ fontSize: 13, fontWeight: 700 }}>
                    {selectedRover.dimensions.massKg} kg
                  </div>
                </div>
                <div className="tt-card-soft" style={{ padding: 10 }}>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Max Operational Slope</div>
                  <div className="tt-mono" style={{ fontSize: 13, fontWeight: 700 }}>
                    {selectedRover.mobilityProfile.operationalMaxSlopeDeg}° (Optimal ≤{selectedRover.mobilityProfile.optimalSlopeDeg}°)
                  </div>
                </div>
                <div className="tt-card-soft" style={{ padding: 10 }}>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>A* Cost Multipliers</div>
                  <div className="tt-mono" style={{ fontSize: 13, fontWeight: 700 }}>
                    {selectedRover.mobilityProfile.slopePenaltyFactor}× θ · {selectedRover.mobilityProfile.roughnessPenaltyFactor}× TRI
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  className="tt-btn-primary"
                  style={{ flex: 1 }}
                  onClick={() => onOpenRoverStudio('overview')}
                >
                  Open 3D Rover Studio
                </button>
                <button
                  type="button"
                  className="tt-btn-secondary"
                  onClick={() => onOpenRoverStudio('custom_builder')}
                >
                  Custom Builder
                </button>
              </div>
            </div>

            <div className="tt-card">
              <strong style={{ fontSize: 14, display: 'block', marginBottom: 10 }}>
                Switch Active Rover Profile
              </strong>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {NASA_MOON_ROVERS.map((r) => (
                  <div
                    key={r.id}
                    onClick={() => onSelectRover(r.id)}
                    className={`tt-card-interactive ${selectedRoverId === r.id ? 'selected' : ''}`}
                    style={{ padding: '10px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                  >
                    <div>
                      <strong style={{ fontSize: 13.5 }}>{r.name}</strong>
                      <div className="tt-mono" style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
                        {r.wheels.count} wheels · Ø{r.wheels.diameterCm}cm · Max {r.mobilityProfile.operationalMaxSlopeDeg}°
                      </div>
                    </div>
                    <span className={`tt-badge ${r.status === 'OPERATIONAL' ? 'green' : ''}`}>
                      {r.status === 'OPERATIONAL' ? 'Operational' : 'Historical'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {/* 3. MISSION PLANNER & A* PATHFINDING */}
        {normalizedTab === 'route_planner' && (
          <>
            <div className="tt-card">
              <strong style={{ fontSize: 14, display: 'block', marginBottom: 10 }}>
                Traverse Endpoints & Cost Weights
              </strong>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 14 }}>
                <button
                  type="button"
                  onClick={() =>
                    onClickModeChange(clickMode === 'set_route_start' ? 'inspect_site' : 'set_route_start')
                  }
                  className={`tt-card-interactive ${clickMode === 'set_route_start' ? 'selected' : ''}`}
                  style={{ padding: 10, textAlign: 'left' }}
                >
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--rec-green)' }}>START (A)</div>
                  <div className="tt-mono" style={{ fontSize: 12, fontWeight: 600 }}>
                    {formatLatLonShort(routeStart.lat, routeStart.lon)}
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() =>
                    onClickModeChange(clickMode === 'set_route_dest' ? 'inspect_site' : 'set_route_dest')
                  }
                  className={`tt-card-interactive ${clickMode === 'set_route_dest' ? 'selected' : ''}`}
                  style={{ padding: 10, textAlign: 'left' }}
                >
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--moon-accent)' }}>DEST (B)</div>
                  <div className="tt-mono" style={{ fontSize: 12, fontWeight: 600 }}>
                    {formatLatLonShort(routeDestination.lat, routeDestination.lon)}
                  </div>
                </button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 4 }}>
                    <span>Max Operational Slope Ceiling</span>
                    <span className="tt-mono" style={{ fontWeight: 600 }}>
                      {maxAllowedSlopeDeg}° (Rover limit: {selectedRover.mobilityProfile.operationalMaxSlopeDeg}°)
                    </span>
                  </div>
                  <input
                    type="range"
                    className="tt-slider"
                    min={6}
                    max={30}
                    step={1}
                    value={maxAllowedSlopeDeg}
                    onChange={(e) => onChangeMaxSlope(Number(e.target.value))}
                  />
                </div>

                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 4 }}>
                    <span>Slope Avoidance Multiplier</span>
                    <span className="tt-mono" style={{ fontWeight: 600 }}>{slopePriority.toFixed(2)}×</span>
                  </div>
                  <input
                    type="range"
                    className="tt-slider"
                    min={0.5}
                    max={2.5}
                    step={0.1}
                    value={slopePriority}
                    onChange={(e) => onChangeSlopePriority(Number(e.target.value))}
                  />
                </div>

                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 4 }}>
                    <span>TRI Roughness Penalty Multiplier</span>
                    <span className="tt-mono" style={{ fontWeight: 600 }}>{roughnessPriority.toFixed(2)}×</span>
                  </div>
                  <input
                    type="range"
                    className="tt-slider"
                    min={0.5}
                    max={2.5}
                    step={0.1}
                    value={roughnessPriority}
                    onChange={(e) => onChangeRoughnessPriority(Number(e.target.value))}
                  />
                </div>
              </div>
            </div>

            {/* Route Alternatives */}
            {routePlan && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {routePlan.routes.map((r) => {
                  const isSel = r.id === selectedRouteId;
                  return (
                    <div
                      key={r.id}
                      onClick={() => onSelectRoute(r.id)}
                      className={`tt-card-interactive ${isSel ? 'selected' : ''}`}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ width: 9, height: 9, borderRadius: '50%', background: r.accentColor }} />
                          <strong style={{ fontSize: 14 }}>{r.name}</strong>
                        </div>
                        {r.id === 'terrain_optimized' && <span className="tt-badge green">Recommended</span>}
                      </div>

                      <div className="tt-mono" style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 8 }}>
                        {r.costFormula}
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
                        <div>
                          <div style={{ fontSize: 10.5, color: 'var(--text-secondary)' }}>Length</div>
                          <div className="tt-mono" style={{ fontSize: 12.5, fontWeight: 700 }}>
                            {r.analytics.totalDistanceKm.toFixed(2)} km
                          </div>
                        </div>
                        <div>
                          <div style={{ fontSize: 10.5, color: 'var(--text-secondary)' }}>Max Slope</div>
                          <div className="tt-mono" style={{ fontSize: 12.5, fontWeight: 700 }}>
                            {r.analytics.maxSlopeDeg.toFixed(2)}°
                          </div>
                        </div>
                        <div>
                          <div style={{ fontSize: 10.5, color: 'var(--text-secondary)' }}>Mean TRI</div>
                          <div className="tt-mono" style={{ fontSize: 12.5, fontWeight: 700 }}>
                            {r.analytics.meanTriM} m
                          </div>
                        </div>
                        <div>
                          <div style={{ fontSize: 10.5, color: 'var(--text-secondary)' }}>Cost Index</div>
                          <div className="tt-mono" style={{ fontSize: 12.5, fontWeight: 700 }}>
                            {r.analytics.traversalCostIndex.toFixed(2)}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* 4. DATA LIBRARY & PROVENANCE */}
        {normalizedTab === 'data_sources' && renderDataLibrary()}
      </div>
    </aside>
  );
};
