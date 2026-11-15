import React from 'react';
import { ExperienceMode, formatLatLonShort } from '../coordinate-state';
import {
  LandingSiteEvaluation,
  RouteModeId,
  RoutePlanResponse,
  RoverRoute,
} from '../core/planet/types';
import { NasaRoverProfile } from '../moon/rovers';

export type BottomTabId = 'route_profile' | 'route_compare' | 'site_matrix';

interface BottomAnalysisPanelProps {
  experienceMode: ExperienceMode;
  activeTab: BottomTabId;
  onSelectTab: (tab: BottomTabId) => void;
  expanded: boolean;
  onToggleExpanded: () => void;
  selectedRover: NasaRoverProfile;
  routePlan: RoutePlanResponse | null;
  selectedRouteId: RouteModeId;
  onSelectRoute: (id: RouteModeId) => void;
  candidates: LandingSiteEvaluation[];
  regionalCandidates?: LandingSiteEvaluation[];
  selectedSite: LandingSiteEvaluation | null;
  onSelectCandidateSite: (lat: number, lon: number) => void;
  loadingRoutes: boolean;
}

export const BottomAnalysisPanel: React.FC<BottomAnalysisPanelProps> = ({
  experienceMode,
  activeTab,
  onSelectTab,
  expanded,
  onToggleExpanded,
  selectedRover,
  routePlan,
  selectedRouteId,
  onSelectRoute,
  candidates,
  regionalCandidates = [],
  selectedSite,
  onSelectCandidateSite,
  loadingRoutes,
}) => {
  const isBeginner = experienceMode === 'beginner';
  const activeRoute: RoverRoute | null =
    routePlan?.routes.find((r) => r.id === selectedRouteId) ??
    routePlan?.routes[0] ??
    null;

  return (
    <section className={`tt-bottom-drawer ${expanded ? 'expanded' : 'collapsed'}`}>
      <div className="tt-bottom-drawer-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <div className="tt-vp-pill-group">
            <button
              type="button"
              className={`tt-vp-pill-btn ${activeTab === 'route_profile' && expanded ? 'active' : ''}`}
              onClick={() => onSelectTab('route_profile')}
            >
              Elevation Chart
            </button>
            <button
              type="button"
              className={`tt-vp-pill-btn ${activeTab === 'route_compare' && expanded ? 'active' : ''}`}
              onClick={() => onSelectTab('route_compare')}
            >
              Compare Routes
            </button>
            <button
              type="button"
              className={`tt-vp-pill-btn ${activeTab === 'site_matrix' && expanded ? 'active' : ''}`}
              onClick={() => onSelectTab('site_matrix')}
            >
              Landing Sites
            </button>
          </div>
        </div>

        <button
          type="button"
          className="tt-btn-ghost"
          onClick={onToggleExpanded}
          style={{ fontWeight: 600, flexShrink: 0, whiteSpace: 'nowrap' }}
        >
          <span>{expanded ? 'Hide Drawer' : 'Analysis Drawer'}</span>
          <span style={{ fontSize: 11 }}>{expanded ? '▾' : '▴'}</span>
        </button>
      </div>

      {expanded && (
        <div className="tt-bottom-drawer-body">
          {activeTab === 'route_profile' && (
            <RouteElevationChart
              isBeginner={isBeginner}
              route={activeRoute}
              allRoutes={routePlan?.routes ?? []}
              selectedRover={selectedRover}
              onSelectRoute={onSelectRoute}
              loading={loadingRoutes}
            />
          )}

          {activeTab === 'route_compare' && (
            <RouteCompareRow
              isBeginner={isBeginner}
              routePlan={routePlan}
              selectedRover={selectedRover}
              selectedRouteId={selectedRouteId}
              onSelectRoute={onSelectRoute}
            />
          )}

          {activeTab === 'site_matrix' && (
            <CandidateSiteRow
              isBeginner={isBeginner}
              candidates={regionalCandidates.length > 0 ? regionalCandidates : candidates}
              selectedSite={selectedSite}
              onSelectCandidateSite={onSelectCandidateSite}
            />
          )}
        </div>
      )}
    </section>
  );
};

/* ============================================================================
   1. CLEAN APPLE-INSPIRED ELEVATION & SLOPE PROFILE CHART
   ============================================================================ */
const RouteElevationChart: React.FC<{
  isBeginner: boolean;
  route: RoverRoute | null;
  allRoutes: RoverRoute[];
  selectedRover: NasaRoverProfile;
  onSelectRoute: (id: RouteModeId) => void;
  loading: boolean;
}> = ({ isBeginner, route, allRoutes, selectedRover, onSelectRoute, loading }) => {
  if (!route || route.profile.length < 2) {
    return (
      <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
        {loading
          ? 'Calculating 3D elevation profile along the lunar surface…'
          : 'Select a Start and Destination on Moon to inspect the elevation profile.'}
      </div>
    );
  }

  const samples = route.profile;
  const maxDist = samples[samples.length - 1].distanceKm || 1;
  const elevs = samples.map((s) => s.elevationM);
  const minElev = Math.min(...elevs);
  const maxElev = Math.max(...elevs);
  const elevSpan = Math.max(50, maxElev - minElev);

  const W = 720;
  const H = 138;
  const padL = 48;
  const padR = 18;
  const padT = 14;
  const padB = 24;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const toX = (d: number) => padL + (d / maxDist) * plotW;
  const toY = (e: number) => padT + plotH - ((e - minElev) / elevSpan) * plotH;

  const polyPts = samples.map((s) => `${toX(s.distanceKm).toFixed(1)},${toY(s.elevationM).toFixed(1)}`).join(' ');
  const areaPts = `${padL},${padT + plotH} ${polyPts} ${padL + plotW},${padT + plotH}`;

  return (
    <div style={{ display: 'flex', gap: 20, alignItems: 'center', height: '100%' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 155, display: 'block' }}>
          <defs>
            <linearGradient id="ttElevFillLight" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={route.accentColor} stopOpacity="0.26" />
              <stop offset="100%" stopColor={route.accentColor} stopOpacity="0.02" />
            </linearGradient>
          </defs>

          {[0, 0.5, 1].map((t) => {
            const y = padT + (1 - t) * plotH;
            const val = Math.round(minElev + t * elevSpan);
            return (
              <g key={t}>
                <line x1={padL} y1={y} x2={padL + plotW} y2={y} stroke="#E5E7EB" strokeDasharray="3 3" />
                <text x={padL - 8} y={y + 4} textAnchor="end" fill="#737780" fontSize="10" fontFamily="var(--font-mono)">
                  {val}m
                </text>
              </g>
            );
          })}

          <polygon points={areaPts} fill="url(#ttElevFillLight)" />
          <polyline
            fill="none"
            stroke={route.accentColor}
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            points={polyPts}
          />

          <text x={padL} y={H - 5} fill="#737780" fontSize="10" fontFamily="var(--font-sans)">
            Start (0 km)
          </text>
          <text x={padL + plotW} y={H - 5} textAnchor="end" fill="#737780" fontSize="10" fontFamily="var(--font-sans)">
            Destination ({maxDist.toFixed(1)} km)
          </text>
        </svg>
      </div>

      {/* Summary & Route Switcher */}
      <div style={{ width: 250, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {allRoutes.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => onSelectRoute(r.id)}
              className={`tt-badge ${r.id === route.id ? 'green' : ''}`}
              style={{
                cursor: 'pointer',
                border: r.id === route.id ? `1.5px solid ${r.accentColor}` : '1px solid var(--border-color)',
                background: r.id === route.id ? 'var(--bg-primary)' : 'var(--bg-secondary)',
                color: 'var(--text-primary)',
              }}
            >
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: r.accentColor }} />
              <span>
                {r.id === 'terrain_optimized'
                  ? 'Recommended'
                  : r.id === 'scientific_exploration'
                    ? 'Science'
                    : 'Shortest'}
              </span>
            </button>
          ))}
        </div>

        <div className="tt-card-soft" style={{ padding: '10px 12px' }}>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>
            {isBeginner ? 'How much does the ground rise or fall?' : 'Elevation Gain / Loss'}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 600 }}>
            <span>Climb: +{route.analytics.totalElevationGainM} m</span>
            <span>Descent: -{route.analytics.totalElevationLossM} m</span>
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', marginTop: 4 }}>
            Max steepness: <strong>{route.analytics.maxSlopeDeg.toFixed(1)}°</strong> ({selectedRover.name} limit:{' '}
            {selectedRover.mobilityProfile.operationalMaxSlopeDeg}°)
          </div>
        </div>
      </div>
    </div>
  );
};

/* ============================================================================
   2. CLEAN 3-CARD ROUTE COMPARISON ROW
   ============================================================================ */
const RouteCompareRow: React.FC<{
  isBeginner: boolean;
  routePlan: RoutePlanResponse | null;
  selectedRover: NasaRoverProfile;
  selectedRouteId: RouteModeId;
  onSelectRoute: (id: RouteModeId) => void;
}> = ({ isBeginner, routePlan, selectedRover, selectedRouteId, onSelectRoute }) => {
  if (!routePlan || routePlan.routes.length === 0) {
    return <div style={{ color: 'var(--text-secondary)' }}>No routes generated yet.</div>;
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
      {routePlan.routes.map((r) => {
        const isSel = r.id === selectedRouteId;
        const isRec = r.id === 'terrain_optimized';
        return (
          <div
            key={r.id}
            onClick={() => onSelectRoute(r.id)}
            className={`tt-card-interactive ${isSel ? 'selected' : ''}`}
            style={{ padding: '12px 14px' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <span style={{ width: 9, height: 9, borderRadius: '50%', background: r.accentColor }} />
                <strong style={{ fontSize: 13.5 }}>
                  {isBeginner
                    ? r.id === 'terrain_optimized'
                      ? 'Safest Balanced Route'
                      : r.id === 'scientific_exploration'
                        ? 'Science Discovery Route'
                        : 'Direct Shortest Route'
                    : r.name}
                </strong>
              </div>
              {isRec && <span className="tt-badge green">Recommended</span>}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginTop: 8 }}>
              <div>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Distance</div>
                <div className="tt-mono" style={{ fontSize: 13, fontWeight: 600 }}>
                  {r.analytics.totalDistanceKm.toFixed(1)} km
                </div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                  {isBeginner ? 'Steepness' : 'Max Slope'}
                </div>
                <div className="tt-mono" style={{ fontSize: 13, fontWeight: 600 }}>
                  {r.analytics.maxSlopeDeg.toFixed(1)}°
                </div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                  {isBeginner ? 'Safety' : `Fit (${selectedRover.name})`}
                </div>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: isRec ? 'var(--rec-green)' : 'var(--text-primary)' }}>
                  {r.analytics.maxSlopeDeg <= selectedRover.mobilityProfile.optimalSlopeDeg
                    ? 'Easy & Safe'
                    : r.analytics.maxSlopeDeg <= selectedRover.mobilityProfile.operationalMaxSlopeDeg
                      ? 'Moderate'
                      : 'Challenging'}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

/* ============================================================================
   3. CANDIDATE LANDING SITE CARDS
   ============================================================================ */
const CandidateSiteRow: React.FC<{
  isBeginner: boolean;
  candidates: LandingSiteEvaluation[];
  selectedSite: LandingSiteEvaluation | null;
  onSelectCandidateSite: (lat: number, lon: number) => void;
}> = ({ isBeginner, candidates, selectedSite, onSelectCandidateSite }) => {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 12 }}>
      {candidates.slice(0, 5).map((site, i) => {
        const score = site.suitability.total !== null ? Math.round(site.suitability.total * 100) : 0;
        const isSel =
          selectedSite &&
          Math.abs(selectedSite.lat - site.lat) < 0.05 &&
          Math.abs(selectedSite.lon - site.lon) < 0.05;
        return (
          <div
            key={site.id}
            onClick={() => onSelectCandidateSite(site.lat, site.lon)}
            className={`tt-card-interactive ${isSel ? 'selected' : ''}`}
            style={{ padding: '12px 14px' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <strong style={{ fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                #{i + 1} {site.name.split('(')[0].trim()}
              </strong>
              <span className={`tt-badge ${score >= 75 ? 'green' : 'amber'}`}>{score}/100</span>
            </div>
            <div className="tt-mono" style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 6 }}>
              {formatLatLonShort(site.lat, site.lon)} · {site.telemetry.elevationM ?? 0} m
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              {isBeginner
                ? `Ground tilt: ${site.telemetry.slopeDeg?.toFixed(1) ?? '0'}° (${(site.telemetry.slopeDeg ?? 0) < 3 ? 'Very flat' : 'Gentle slope'})`
                : `Slope: ${site.telemetry.slopeDeg?.toFixed(2) ?? '0'}° · TRI: ${site.telemetry.triM ?? 0} m`}
            </div>
          </div>
        );
      })}
    </div>
  );
};
