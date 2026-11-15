import React, { useMemo, useState } from 'react';
import { AiMissionAgentPanel } from './components/AiMissionAgentPanel';
import { BottomAnalysisPanel, BottomTabId } from './components/BottomAnalysisPanel';
import { LeftSidebar } from './components/LeftSidebar';
import {
  MapClickMode,
  MoonViewport3D,
  ViewportMode,
} from './components/MoonViewport3D';
import { MissionDashboardView } from './components/MissionDashboardView';
import { EarthAnalogView } from './components/EarthAnalogView';
import { MissionInsightsOverlay } from './components/MissionInsightsOverlay';
import { RightIntelligencePanel } from './components/RightIntelligencePanel';
import { RoverStudioModal } from './components/RoverStudio3D';
import { ExperienceMode, NavTab } from './coordinate-state';
import { LandingSuitabilityWeights, RouteModeId } from './core/planet/types';
import { MapStateUpdateCommand } from './moon/agent-types';
import { DEFAULT_LANDING_WEIGHTS } from './moon/constants';
import { SurfaceLayerId } from './moon/client-dem';
import {
  buildCustomRoverProfile,
  CustomRoverConfig,
  DEFAULT_CUSTOM_ROVER_CONFIG,
  getRoverById,
  RoverId,
} from './moon/rovers';
import { useMoonIntelligence } from './use-moon-intelligence';
import { isEmbeddedInMeridian, returnToEarth } from './earth-link';
import { useTheme } from './theme';

export function App() {
  // Persisted Dual-Mode Experience ('beginner' vs 'advanced')
  const [experienceMode, setExperienceMode] = useState<ExperienceMode>(() => {
    try {
      const saved = window.localStorage.getItem('terratwin_experience_mode');
      if (saved === 'beginner' || saved === 'advanced') return saved;
    } catch {
      // ignore storage errors
    }
    return 'beginner';
  });

  const handleSelectExperienceMode = (mode: ExperienceMode) => {
    setExperienceMode(mode);
    try {
      window.localStorage.setItem('terratwin_experience_mode', mode);
    } catch {
      // ignore storage errors
    }
  };

  // Navigation & UI state
  const [activeTab, setActiveTab] = useState<NavTab>('explorer_3d');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // 3D Viewport state
  const [viewportMode, setViewportMode] = useState<ViewportMode>('global_3d');
  const [surfaceLayer, setSurfaceLayer] = useState<SurfaceLayerId>('viking_color');
  const [exaggeration, setExaggeration] = useState<number>(6);
  const [regionalSpanDeg, setRegionalSpanDeg] = useState<number>(0.6);
  const [clickMode, setClickMode] = useState<MapClickMode>('inspect_site');

  // Selected NASA Rover or Custom Rover
  const [selectedRoverId, setSelectedRoverId] = useState<RoverId>('perseverance');
  const [customRoverConfig, setCustomRoverConfig] = useState<CustomRoverConfig>(
    DEFAULT_CUSTOM_ROVER_CONFIG,
  );
  const [roverStudioOpen, setRoverStudioOpen] = useState<boolean>(false);
  const [roverStudioInitialTab, setRoverStudioInitialTab] = useState<
    'overview' | 'engineering' | 'compare' | 'custom_builder'
  >('overview');

  const selectedRover = useMemo(
    () => getRoverById(selectedRoverId, customRoverConfig),
    [selectedRoverId, customRoverConfig],
  );

  // Map Overlays (accessible via Top Bar Settings popover)
  const [showGraticule, setShowGraticule] = useState(false);
  const [showLandingCandidates, setShowLandingCandidates] = useState(true);
  const [showNomenclature, setShowNomenclature] = useState(true);
  const [showCraters, setShowCraters] = useState(true);
  const [showRoutes, setShowRoutes] = useState(true);

  // Selected Location & Route Endpoints (Default: Jezero Crater Western Fan)
  const [selectedLocation, setSelectedLocation] = useState({ lat: 18.4447, lon: 77.4508 });
  const [hoveredLocation, setHoveredLocation] = useState<{
    lat: number;
    lon: number;
    elevationM: number;
    slopeDeg: number;
  } | null>(null);

  const [routeStart, setRouteStart] = useState({ lat: 18.4447, lon: 77.4508 });
  const [routeDestination, setRouteDestination] = useState({ lat: 18.525, lon: 77.265 });
  const [selectedRouteId, setSelectedRouteId] = useState<RouteModeId>('terrain_optimized');

  // Configurable Route & Landing Parameters
  const [maxAllowedSlopeDeg, setMaxAllowedSlopeDeg] = useState<number>(24);
  const [slopePriority, setSlopePriority] = useState<number>(1.2);
  const [roughnessPriority, setRoughnessPriority] = useState<number>(1.2);
  const [sciencePriority, setSciencePriority] = useState<number>(1.3);
  const [landingWeights, setLandingWeights] =
    useState<LandingSuitabilityWeights>(DEFAULT_LANDING_WEIGHTS);

  // Collapsible Bottom Drawer (Collapsed by default so the 3D Moon view is spacious)
  const [bottomTab, setBottomTab] = useState<BottomTabId>('route_profile');
  const [bottomExpanded, setBottomExpanded] = useState(false);

  // Undo snapshot for AI Mission Agent map updates
  const [previousMapStateSnapshot, setPreviousMapStateSnapshot] = useState<{
    selectedLocation: { lat: number; lon: number };
    viewportMode: ViewportMode;
    regionalSpanDeg: number;
    selectedRoverId: RoverId;
    routeStart: { lat: number; lon: number };
    routeDestination: { lat: number; lon: number };
    selectedRouteId: RouteModeId;
    maxAllowedSlopeDeg: number;
    slopePriority: number;
    roughnessPriority: number;
    sciencePriority: number;
    landingWeights: LandingSuitabilityWeights;
  } | null>(null);

  // Real NASA LOLA / PDS / Trek Intelligence Hook
  const intel = useMoonIntelligence(
    selectedLocation,
    routeStart,
    routeDestination,
    selectedRoverId,
    regionalSpanDeg,
    customRoverConfig,
  );

  const handleApplyAgentMapUpdate = (cmd: MapStateUpdateCommand) => {
    setPreviousMapStateSnapshot({
      selectedLocation: { ...selectedLocation },
      viewportMode,
      regionalSpanDeg,
      selectedRoverId,
      routeStart: { ...routeStart },
      routeDestination: { ...routeDestination },
      selectedRouteId,
      maxAllowedSlopeDeg,
      slopePriority,
      roughnessPriority,
      sciencePriority,
      landingWeights: { ...landingWeights },
    });

    setSelectedLocation(cmd.focusLocation);
    setViewportMode(cmd.viewportMode);
    if (cmd.regionalSpanDeg) {
      setRegionalSpanDeg(cmd.regionalSpanDeg);
    }
    if (cmd.stageCustomRoverConfig && cmd.autoApplyCustomRover) {
      setCustomRoverConfig(cmd.stageCustomRoverConfig);
      setSelectedRoverId('custom');
    } else if (cmd.selectRoverId && cmd.selectRoverId !== 'custom') {
      setSelectedRoverId(cmd.selectRoverId);
    } else if (cmd.selectRoverId === 'custom' && cmd.stageCustomRoverConfig) {
      setCustomRoverConfig(cmd.stageCustomRoverConfig);
      setSelectedRoverId('custom');
    }

    setRouteStart(cmd.routeStart);
    setRouteDestination(cmd.routeDestination);
    setSelectedRouteId(cmd.selectedRouteId);

    setMaxAllowedSlopeDeg(cmd.maxAllowedSlopeDeg);
    setSlopePriority(cmd.slopeWeight);
    setRoughnessPriority(cmd.roughnessWeight);
    setSciencePriority(cmd.scienceWeight);
    intel.setRouteParams({
      maxAllowedSlopeDeg: cmd.maxAllowedSlopeDeg,
      slopeWeight: cmd.slopeWeight,
      roughnessWeight: cmd.roughnessWeight,
      scienceWeight: cmd.scienceWeight,
    });

    setLandingWeights(cmd.landingWeights);
    intel.setWeights(cmd.landingWeights);
  };

  const handleUndoAgentMapUpdate = () => {
    if (!previousMapStateSnapshot) return;
    setSelectedLocation(previousMapStateSnapshot.selectedLocation);
    setViewportMode(previousMapStateSnapshot.viewportMode);
    setRegionalSpanDeg(previousMapStateSnapshot.regionalSpanDeg);
    setSelectedRoverId(previousMapStateSnapshot.selectedRoverId);
    setRouteStart(previousMapStateSnapshot.routeStart);
    setRouteDestination(previousMapStateSnapshot.routeDestination);
    setSelectedRouteId(previousMapStateSnapshot.selectedRouteId);
    setMaxAllowedSlopeDeg(previousMapStateSnapshot.maxAllowedSlopeDeg);
    setSlopePriority(previousMapStateSnapshot.slopePriority);
    setRoughnessPriority(previousMapStateSnapshot.roughnessPriority);
    setSciencePriority(previousMapStateSnapshot.sciencePriority);
    intel.setRouteParams({
      maxAllowedSlopeDeg: previousMapStateSnapshot.maxAllowedSlopeDeg,
      slopeWeight: previousMapStateSnapshot.slopePriority,
      roughnessWeight: previousMapStateSnapshot.roughnessPriority,
      scienceWeight: previousMapStateSnapshot.sciencePriority,
    });
    setLandingWeights(previousMapStateSnapshot.landingWeights);
    intel.setWeights(previousMapStateSnapshot.landingWeights);
    setPreviousMapStateSnapshot(null);
  };

  const handleChangeMaxSlope = (deg: number) => {
    setMaxAllowedSlopeDeg(deg);
    intel.setRouteParams((prev) => ({ ...prev, maxAllowedSlopeDeg: deg }));
  };

  const handleChangeSlopePriority = (w: number) => {
    setSlopePriority(w);
    intel.setRouteParams((prev) => ({ ...prev, slopeWeight: w }));
  };

  const handleChangeRoughnessPriority = (w: number) => {
    setRoughnessPriority(w);
    intel.setRouteParams((prev) => ({ ...prev, roughnessWeight: w }));
  };

  const handleChangeSciencePriority = (w: number) => {
    setSciencePriority(w);
    intel.setRouteParams((prev) => ({ ...prev, scienceWeight: w }));
  };

  const handleChangeWeights = (w: LandingSuitabilityWeights) => {
    setLandingWeights(w);
    intel.setWeights(w);
  };

  const handleSelectRover = (newRoverId: RoverId) => {
    setSelectedRoverId(newRoverId);
    const profile =
      newRoverId === 'custom'
        ? buildCustomRoverProfile(customRoverConfig)
        : getRoverById(newRoverId, customRoverConfig);
    setMaxAllowedSlopeDeg(profile.mobilityProfile.operationalMaxSlopeDeg);
  };

  const handleUpdateCustomRoverConfig = (nextConfig: CustomRoverConfig) => {
    setCustomRoverConfig(nextConfig);
    if (selectedRoverId === 'custom') {
      const profile = buildCustomRoverProfile(nextConfig);
      setMaxAllowedSlopeDeg(profile.mobilityProfile.operationalMaxSlopeDeg);
    }
  };

  const handleToggleOverlay = (
    key: 'graticule' | 'candidates' | 'nomenclature' | 'craters' | 'routes',
  ) => {
    if (key === 'graticule') setShowGraticule((v) => !v);
    if (key === 'candidates') setShowLandingCandidates((v) => !v);
    if (key === 'nomenclature') setShowNomenclature((v) => !v);
    if (key === 'craters') setShowCraters((v) => !v);
    if (key === 'routes') setShowRoutes((v) => !v);
  };

  const [theme, toggleTheme] = useTheme();

  const handleSelectTab = (tab: NavTab) => {
    setActiveTab(tab);
    if (tab === 'route_comparison') {
      setBottomTab('route_compare');
      setBottomExpanded(true);
    }
  };

  const currentMissionTitle = useMemo(() => {
    const siteName = intel.selectedSite?.name?.split('(')[0]?.trim() || 'Jezero Crater';
    return `${siteName} · ${selectedRover.name}`;
  }, [intel.selectedSite, selectedRover.name]);

  return (
    <div className="tt-app-shell">
      {/* 1. CLEAN APPLE-INSPIRED TOP BAR */}
      <header className="tt-topbar">
        <div className="tt-topbar-left">
          <button
            type="button"
            className="tt-sidebar-collapse-btn"
            onClick={() => setSidebarCollapsed((v) => !v)}
            title={sidebarCollapsed ? 'Expand navigation sidebar' : 'Collapse navigation sidebar'}
            aria-label="Toggle Navigation Sidebar"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M4 6h16M4 12h16M4 18h10" />
            </svg>
          </button>

          <button
            type="button"
            className="tt-earth-return-btn"
            onClick={returnToEarth}
            title={
              isEmbeddedInMeridian
                ? 'Back to the Meridian Earth map (your Earth analysis is kept)'
                : 'Open the Meridian Earth map'
            }
            aria-label="Back to Earth"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M15 18l-6-6 6-6" />
            </svg>
            <span className="tt-earth-orb" aria-hidden="true" />
            <span>Back to Earth</span>
          </button>

          <div
            className="tt-brand-lockup"
            onClick={() => handleSelectTab('overview')}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') handleSelectTab('overview');
            }}
          >
            <div className="tt-brand-orb" />
            <span className="tt-brand-name">TERRATWIN</span>
          </div>

          <div className="tt-brand-divider" />

          <div className="tt-mission-badge" title="Current Active Moon Mission Context">
            <span className="tt-mission-badge-dot" />
            <span>{currentMissionTitle}</span>
          </div>
        </div>

        {/* Center: Prominent Beginner / Advanced Mode Switch */}
        <div className="tt-topbar-center">
          <div className="tt-mode-segmented" role="group" aria-label="Experience Mode Switch">
            <button
              type="button"
              className={`tt-mode-segment-btn ${experienceMode === 'beginner' ? 'active' : ''}`}
              onClick={() => handleSelectExperienceMode('beginner')}
            >
              <span className="tt-mode-segment-dot beginner" />
              <span>Beginner</span>
            </button>
            <button
              type="button"
              className={`tt-mode-segment-btn ${experienceMode === 'advanced' ? 'active' : ''}`}
              onClick={() => handleSelectExperienceMode('advanced')}
            >
              <span className="tt-mode-segment-dot advanced" />
              <span>Advanced</span>
            </button>
          </div>
        </div>

        {/* Right: AI Mission Copilot + Quick Rover Studio + Settings Popover */}
        <div className="tt-topbar-right">
          <button
            type="button"
            className="tt-theme-toggle"
            onClick={toggleTheme}
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {theme === 'dark' ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="4.2" />
                <path d="M12 2.5v2.2M12 19.3v2.2M4.6 4.6l1.6 1.6M17.8 17.8l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.6 19.4l1.6-1.6M17.8 6.2l1.6-1.6" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5a8.5 8.5 0 1 0 10.7 10.7z" />
              </svg>
            )}
          </button>
          <button
            type="button"
            className={`tt-topbar-action-btn ${activeTab === 'ai_agent' ? 'active' : ''}`}
            onClick={() => handleSelectTab(activeTab === 'ai_agent' ? 'explorer_3d' : 'ai_agent')}
            style={{
              background: activeTab === 'ai_agent' ? 'var(--accent-moon)' : undefined,
              color: activeTab === 'ai_agent' ? '#FFFFFF' : undefined,
              borderColor: activeTab === 'ai_agent' ? 'var(--accent-moon)' : 'rgba(217, 83, 47, 0.35)',
              fontWeight: 600,
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z" />
              <path d="M19 16l.9 2.1L22 19l-2.1.9L19 22l-.9-2.1L16 19l2.1-.9L19 16z" />
            </svg>
            <span>AI Mission Copilot</span>
          </button>

          <button
            type="button"
            className="tt-topbar-action-btn"
            onClick={() => {
              setRoverStudioInitialTab('overview');
              setRoverStudioOpen(true);
            }}
          >
            <span>Rover Studio</span>
          </button>

          <button
            type="button"
            className={`tt-topbar-action-btn ${settingsOpen ? 'active' : ''}`}
            onClick={() => setSettingsOpen((v) => !v)}
            aria-expanded={settingsOpen}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.604.852.997 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            <span>Settings</span>
          </button>

          {settingsOpen && (
            <div className="tt-settings-popover">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <strong style={{ fontSize: 14, color: 'var(--text-primary)' }}>
                  3D Map & Display Settings
                </strong>
                <button
                  type="button"
                  className="tt-btn-ghost"
                  onClick={() => setSettingsOpen(false)}
                >
                  Done
                </button>
              </div>

              <div>
                <div className="tt-settings-group-title" style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Vertical Relief Exaggeration</span>
                  <span className="tt-mono" style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
                    {exaggeration}× {exaggeration === 1 ? '(True Scale)' : ''}
                  </span>
                </div>
                <input
                  type="range"
                  className="tt-slider"
                  min={1}
                  max={14}
                  step={1}
                  value={exaggeration}
                  onChange={(e) => setExaggeration(Number(e.target.value))}
                />
              </div>

              <div>
                <div className="tt-settings-group-title">Regional 3D Patch Span</div>
                <select
                  className="tt-vp-select"
                  style={{ width: '100%', padding: '8px 10px' }}
                  value={regionalSpanDeg}
                  onChange={(e) => setRegionalSpanDeg(Number(e.target.value))}
                >
                  <option value={0.16}>0.16° (~9.5 km · HiRISE 1m Local DTM)</option>
                  <option value={0.6}>0.6° (~35.6 km · CTX 20m Regional DTM)</option>
                  <option value={1.0}>1.0° (~59 km · LOLA 128 PPD)</option>
                  <option value={1.8}>1.8° (~106 km · LOLA 128 PPD)</option>
                </select>
              </div>

              <div>
                <div className="tt-settings-group-title">3D Map Overlays</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {[
                    { id: 'candidates' as const, label: 'Landing Sites', on: showLandingCandidates },
                    { id: 'routes' as const, label: '3D Rover Routes', on: showRoutes },
                    { id: 'nomenclature' as const, label: 'Place Names', on: showNomenclature },
                    { id: 'craters' as const, label: 'Crater Rims', on: showCraters },
                    { id: 'graticule' as const, label: 'Lat/Lon Grid', on: showGraticule },
                  ].map((ov) => (
                    <button
                      key={ov.id}
                      type="button"
                      onClick={() => handleToggleOverlay(ov.id)}
                      className={`tt-badge ${ov.on ? 'moon' : ''}`}
                      style={{ cursor: 'pointer', border: '1px solid var(--border-color)', padding: '5px 11px' }}
                    >
                      {ov.on ? '✓ ' : ''}
                      {ov.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </header>

      {/* 2. MAIN WORKSPACE BODY */}
      <div className="tt-workspace-body">
        <LeftSidebar
          experienceMode={experienceMode}
          onSelectExperienceMode={handleSelectExperienceMode}
          activeTab={activeTab}
          onSelectTab={handleSelectTab}
          selectedRover={selectedRover}
          onOpenRoverStudio={() => {
            setRoverStudioInitialTab('overview');
            setRoverStudioOpen(true);
          }}
          collapsed={sidebarCollapsed}
        />

        {activeTab === 'overview' ? (
          <div style={{ flex: 1, minWidth: 0, height: '100%', overflow: 'hidden' }}>
            <MissionDashboardView
              experienceMode={experienceMode}
              onSelectExperienceMode={handleSelectExperienceMode}
              selectedRover={selectedRover}
              onSelectRover={handleSelectRover}
              selectedSite={intel.selectedSite}
              candidates={intel.candidates}
              routePlan={intel.routePlan}
              onNavigateTab={(tab) => handleSelectTab(tab)}
              onSelectMissionLocation={(coord, openRegional3D) => {
                setSelectedLocation(coord);
                setRouteStart(coord);
                setRouteDestination({
                  lat: Math.min(85, coord.lat + 0.08),
                  lon: coord.lon - 0.16,
                });
                if (openRegional3D) {
                  setViewportMode('regional_3d');
                }
                handleSelectTab('explorer_3d');
              }}
              onOpenRoverStudio={(initialTab) => {
                setRoverStudioInitialTab(initialTab ?? 'overview');
                setRoverStudioOpen(true);
              }}
            />
          </div>
        ) : activeTab === 'earth_analogs' ? (
          <div style={{ flex: 1, minWidth: 0, height: '100%', overflow: 'hidden' }}>
            <EarthAnalogView
              onOpenOnMoon={(coord) => {
                setSelectedLocation(coord);
                handleSelectTab('explorer_3d');
              }}
            />
          </div>
        ) : (
          <>
            {/* 3. CENTER 3D MOON WORKSPACE + COLLAPSIBLE BOTTOM ANALYSIS DRAWER */}
            <main className="tt-center-column">
              <div className="tt-center-stage">
                <MoonViewport3D
                  viewportMode={viewportMode}
                  onViewportModeChange={setViewportMode}
                  surfaceLayer={surfaceLayer}
                  onSurfaceLayerChange={setSurfaceLayer}
                  exaggeration={exaggeration}
                  onExaggerationChange={setExaggeration}
                  regionalSpanDeg={regionalSpanDeg}
                  onRegionalSpanChange={setRegionalSpanDeg}
                  clickMode={clickMode}
                  onClickModeChange={setClickMode}
                  infoMode={experienceMode}
                  onInfoModeChange={handleSelectExperienceMode}
                  selectedRover={selectedRover}
                  onSelectRover={handleSelectRover}
                  onOpenRoverStudio={() => {
                    setRoverStudioInitialTab('overview');
                    setRoverStudioOpen(true);
                  }}
                  globalDem={intel.globalDem}
                  regionalPatch={intel.regionalPatch}
                  selectedLocation={selectedLocation}
                  selectedSite={intel.selectedSite}
                  hoveredLocation={hoveredLocation}
                  candidates={intel.candidates}
                  regionalCandidates={intel.regionalCandidates}
                  globeFeatures={intel.globeFeatures}
                  routePlan={intel.routePlan}
                  selectedRouteId={selectedRouteId}
                  routeStart={routeStart}
                  routeDestination={routeDestination}
                  showGraticule={showGraticule}
                  showLandingCandidates={showLandingCandidates}
                  showNomenclature={showNomenclature}
                  showCraters={showCraters}
                  showRoutes={showRoutes}
                  onToggleOverlay={handleToggleOverlay}
                  onSelectLocation={(c) => setSelectedLocation(c)}
                  onSetRouteStart={(c) => setRouteStart(c)}
                  onSetRouteDestination={(c) => setRouteDestination(c)}
                  onHoverLocation={setHoveredLocation}
                  loadingPatch={intel.loadingPatch}
                  loadingRoutes={intel.loadingRoutes}
                />
                <MissionInsightsOverlay
                  selectedSite={intel.selectedSite}
                  routePlan={showRoutes ? intel.routePlan : null}
                  selectedRouteId={selectedRouteId}
                  onSelectRoute={setSelectedRouteId}
                  rover={selectedRover}
                  onSelectRover={handleSelectRover}
                  onOpenEarthAnalogs={() => handleSelectTab('earth_analogs')}
                />
              </div>

              <BottomAnalysisPanel
                experienceMode={experienceMode}
                activeTab={bottomTab}
                onSelectTab={(t) => {
                  setBottomTab(t);
                  setBottomExpanded(true);
                }}
                expanded={bottomExpanded}
                onToggleExpanded={() => setBottomExpanded((v) => !v)}
                selectedRover={selectedRover}
                routePlan={intel.routePlan}
                selectedRouteId={selectedRouteId}
                onSelectRoute={setSelectedRouteId}
                candidates={intel.candidates}
                regionalCandidates={intel.regionalCandidates}
                selectedSite={intel.selectedSite}
                onSelectCandidateSite={(lat, lon) => setSelectedLocation({ lat, lon })}
                loadingRoutes={intel.loadingRoutes}
              />
            </main>

            {/* 4. CONTEXTUAL RIGHT PANEL OR AI MISSION COPILOT */}
            <div style={{ display: activeTab === 'ai_agent' ? 'flex' : 'none', height: '100%' }}>
              <AiMissionAgentPanel
                experienceMode={experienceMode}
                selectedRoverId={selectedRoverId}
                selectedRover={selectedRover}
                customRoverConfig={customRoverConfig}
                selectedLocation={selectedLocation}
                routeStart={routeStart}
                routeDestination={routeDestination}
                selectedRouteId={selectedRouteId}
                onSelectRoute={setSelectedRouteId}
                onApplyMapUpdate={handleApplyAgentMapUpdate}
                onConfirmCustomRover={(cfg) => {
                  handleUpdateCustomRoverConfig(cfg);
                  handleSelectRover('custom');
                }}
                onOpenRoverStudio={(initialTab) => {
                  setRoverStudioInitialTab(initialTab ?? 'overview');
                  setRoverStudioOpen(true);
                }}
                onOpenBottomDrawer={(tab) => {
                  if (tab) setBottomTab(tab);
                  setBottomExpanded(true);
                }}
                onSelectTab={handleSelectTab}
                canUndoMapUpdate={Boolean(previousMapStateSnapshot)}
                onUndoMapUpdate={handleUndoAgentMapUpdate}
              />
            </div>

            {activeTab !== 'ai_agent' && (
              <RightIntelligencePanel
                experienceMode={experienceMode}
                onSelectExperienceMode={handleSelectExperienceMode}
                activeTab={activeTab}
                onSelectTab={handleSelectTab}
                selectedLocation={selectedLocation}
                selectedSite={intel.selectedSite}
                candidates={intel.candidates}
                regionalCandidates={intel.regionalCandidates}
                weights={landingWeights}
                onChangeWeights={handleChangeWeights}
                onResetWeights={() => handleChangeWeights(DEFAULT_LANDING_WEIGHTS)}
                onSelectCandidate={(lat, lon) => setSelectedLocation({ lat, lon })}
                selectedRoverId={selectedRoverId}
                selectedRover={selectedRover}
                onSelectRover={handleSelectRover}
                customRoverConfig={customRoverConfig}
                onChangeCustomRoverConfig={handleUpdateCustomRoverConfig}
                onOpenRoverStudio={(initialTab) => {
                  setRoverStudioInitialTab(initialTab ?? 'overview');
                  setRoverStudioOpen(true);
                }}
                routeStart={routeStart}
                routeDestination={routeDestination}
                onSetRouteStart={setRouteStart}
                onSetRouteDestination={setRouteDestination}
                clickMode={clickMode}
                onClickModeChange={setClickMode}
                maxAllowedSlopeDeg={maxAllowedSlopeDeg}
                onChangeMaxSlope={handleChangeMaxSlope}
                slopePriority={slopePriority}
                onChangeSlopePriority={handleChangeSlopePriority}
                roughnessPriority={roughnessPriority}
                onChangeRoughnessPriority={handleChangeRoughnessPriority}
                sciencePriority={sciencePriority}
                onChangeSciencePriority={handleChangeSciencePriority}
                routePlan={intel.routePlan}
                selectedRouteId={selectedRouteId}
                onSelectRoute={(id) => {
                  setSelectedRouteId(id);
                }}
                loadingSite={intel.loadingSite}
                loadingRoutes={intel.loadingRoutes}
                curiosityRad={intel.radExcerpt}
                dataSources={intel.dataSources}
                viewportMode={viewportMode}
                onViewportModeChange={setViewportMode}
                onOpenBottomDrawer={(tab) => {
                  if (tab) setBottomTab(tab);
                  setBottomExpanded(true);
                }}
              />
            )}
          </>
        )}
      </div>

      {/* INTERACTIVE 3D ROVER STUDIO & CUSTOM ROVER BUILDER MODAL */}
      <RoverStudioModal
        isOpen={roverStudioOpen}
        initialTab={roverStudioInitialTab}
        experienceMode={experienceMode}
        onClose={() => setRoverStudioOpen(false)}
        selectedRoverId={selectedRoverId}
        onSelectRover={handleSelectRover}
        customRoverConfig={customRoverConfig}
        onChangeCustomRoverConfig={handleUpdateCustomRoverConfig}
        routePlan={intel.routePlan}
      />
    </div>
  );
}
