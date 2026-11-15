import React, { useEffect, useMemo, useRef, useState } from 'react';
import { LandingSiteEvaluation, RoutePlanResponse, RouteModeId } from '../core/planet/types';
import { NasaRoverProfile, RoverId } from '../moon/rovers';
import { rankRoversForRoute, whyBest } from '../moon/rover-fit';
import { earthTwinForSite } from '../moon/point-analog';
import { explainPlan, RiskLevel } from '../moon/route-explain';
import { roverPlayback } from '../moon/rover-playback';
import { climateLine, useEarthClimate } from '../moon/use-earth-climate';
import { showOnEarth } from '../earth-link';

interface MissionInsightsOverlayProps {
  selectedSite: LandingSiteEvaluation | null;
  routePlan: RoutePlanResponse | null;
  selectedRouteId: RouteModeId;
  onSelectRoute: (id: RouteModeId) => void;
  rover: NasaRoverProfile;
  onSelectRover: (id: RoverId) => void;
  onOpenEarthAnalogs: () => void;
}

const RISK_COLOR: Record<RiskLevel, string> = { low: '#4ADE80', moderate: '#FBBF24', high: '#F87171' };
const RISK_SHORT: Record<RiskLevel, string> = { low: 'Low', moderate: 'Medium', high: 'High' };
const pct = (x: number) => `${Math.round(x * 100)}%`;

/** Expanded/collapsed state that survives page reloads. */
function usePersistentOpen(key: string, initial: boolean): [boolean, () => void] {
  const [open, setOpen] = useState<boolean>(() => {
    try {
      const v = window.localStorage.getItem(key);
      return v === null ? initial : v === '1';
    } catch {
      return initial;
    }
  });
  return [
    open,
    () =>
      setOpen((v) => {
        try {
          window.localStorage.setItem(key, v ? '0' : '1');
        } catch {
          // ignore
        }
        return !v;
      }),
  ];
}

const Chevron: React.FC<{ open: boolean }> = ({ open }) => (
  <svg className={`tt-ins-chev ${open ? 'open' : ''}`} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
    <path d="M9 6l6 6-6 6" />
  </svg>
);

/* ------------------------------------------------------------------ Earth twin of the clicked point */

const EarthTwinCard: React.FC<{ site: LandingSiteEvaluation; onOpenEarthAnalogs: () => void }> = ({ site, onOpenEarthAnalogs }) => {
  const [open, toggle] = usePersistentOpen('tt_twin_open', false);
  const twin = useMemo(() => earthTwinForSite(site), [site]);
  const { climate } = useEarthClimate();
  const best = twin.matches[0];
  if (!best) return null;
  const shared = best.dims.flatMap((d) => d.shared).slice(0, 4);
  const worstEnv = [...best.env].sort((a, b) => a.similarity - b.similarity)[0];
  const measured = climateLine(climate?.sites[best.analog.id]?.values);

  return (
    <div className="tt-ins-glass" style={{ width: open ? 280 : 200 }}>
      <button type="button" className="tt-ins-pill" onClick={toggle} aria-expanded={open} title="Most similar place on Earth">
        <span style={{ width: 10, height: 10, borderRadius: '50%', flexShrink: 0, background: 'radial-gradient(circle at 35% 35%, #9fe0ff, #2b7bc0 55%, #2f8a4f)' }} />
        <span style={{ flex: 1, minWidth: 0 }}>
          <span className="tt-ins-muted" style={{ fontSize: 9.5, display: 'block', letterSpacing: '.05em' }}>
            EARTH TWIN
          </span>
          <span style={{ fontWeight: 650, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {best.analog.name}
          </span>
        </span>
        <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: best.overall >= 0.5 ? '#4ADE80' : '#FBBF24' }}>{pct(best.overall)}</span>
        <Chevron open={open} />
      </button>
      <div className={`tt-ins-body ${open ? 'open' : ''}`}>
        <div>
          <div style={{ padding: '0 12px 12px' }}>
            <div className="tt-ins-muted" style={{ fontSize: 11.5 }}>
              {best.analog.country}
              {best.analog.status === 'hypothesis' ? ' · proposed analog' : ''}
            </div>
            <div style={{ marginTop: 8, fontWeight: 600 }}>Why similar</div>
            <ul>
              {shared.length > 0 && <li>{shared.join(', ')}</li>}
              {best.dims
                .filter((d) => d.score !== null && d.score > 0)
                .map((d) => (
                  <li key={d.key}>
                    {d.label} {pct(d.score!)}
                  </li>
                ))}
            </ul>
            <div style={{ fontWeight: 600 }}>What differs</div>
            <ul>
              {worstEnv && worstEnv.similarity < 0.7 && (
                <li>
                  {worstEnv.label}: Moon {worstEnv.target.toFixed(2)} vs {worstEnv.earth.toFixed(2)}
                </li>
              )}
              {twin.pressureRatio && <li>Air pressure here ≈ 1/{Math.round(twin.pressureRatio)} of Earth's</li>}
              <li>0.38 g gravity, ~100× radiation</li>
            </ul>
            {measured && (
              <div style={{ fontSize: 11.5, color: '#93C5FD', margin: '2px 0 6px' }}>
                NASA POWER on Earth: {measured}
              </div>
            )}
            <details>
              <summary className="tt-ins-muted" style={{ cursor: 'pointer' }}>
                How this spot was profiled
              </summary>
              <ul className="tt-ins-muted">
                {twin.basis.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
              <div className="tt-ins-muted">Next: {twin.matches.slice(1, 3).map((m) => `${m.analog.name} ${pct(m.overall)}`).join(' · ')}</div>
            </details>
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              <button type="button" className="tt-ins-btn" onClick={() => showOnEarth(best.analog.lat, best.analog.lon, best.analog.name)}>
                Show on Earth
              </button>
              <button type="button" className="tt-ins-btn" onClick={onOpenEarthAnalogs}>
                Full comparison
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ Routes: why safe / why dangerous */

const RoutePanel: React.FC<{
  plan: RoutePlanResponse;
  selectedRouteId: RouteModeId;
  onSelectRoute: (id: RouteModeId) => void;
  rover: NasaRoverProfile;
  onSelectRover: (id: RoverId) => void;
}> = ({ plan, selectedRouteId, onSelectRoute, rover, onSelectRover }) => {
  const [fitOpen, setFitOpen] = useState(false);
  const activeRoute = plan.routes.find((r) => r.id === selectedRouteId) ?? plan.routes[0];
  const fits = useMemo(() => (activeRoute ? rankRoversForRoute(activeRoute) : []), [activeRoute]);
  const bestFit = fits[0];
  const [open, toggle] = usePersistentOpen('tt_routes_open_v2', false);
  const [detail, setDetail] = useState<RouteModeId | null>(null);
  // Only the play/pause state is React state; the progress bar is moved directly (60 fps, no re-render).
  const [playing, setPlaying] = useState<boolean>(roverPlayback.isPlaying());
  const barRef = useRef<HTMLDivElement | null>(null);
  const explanations = useMemo(() => explainPlan(plan, rover), [plan, rover]);

  useEffect(
    () =>
      roverPlayback.subscribe((st) => {
        setPlaying((p) => (p === st.playing ? p : st.playing));
        if (barRef.current) barRef.current.style.transform = `scaleX(${st.progress})`;
      }),
    [],
  );
  // A new A→B plan or another route: drive it from the start.
  useEffect(() => {
    roverPlayback.restart();
  }, [plan, selectedRouteId]);

  const ex = explanations.find((e) => e.id === detail) ?? null;
  const exRoute = ex ? plan.routes.find((r) => r.id === ex.id) : null;

  return (
    <div className="tt-ins-glass" style={{ width: ex && open ? 300 : open ? 230 : 200, maxHeight: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 6px 2px 2px' }}>
        <button type="button" className="tt-ins-pill" style={{ padding: '3px 6px', flex: 1 }} onClick={toggle} aria-expanded={open}>
          <span style={{ flex: 1, fontWeight: 650, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {(() => {
              const cur = explanations.find((e) => e.id === selectedRouteId);
              return cur ? (
                <>
                  <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: RISK_COLOR[cur.risk], marginRight: 6 }} />
                  {cur.shortName}
                  <span className="tt-ins-muted" style={{ fontWeight: 400 }}> route</span>
                </>
              ) : (
                'Routes'
              );
            })()}
          </span>
          <Chevron open={open} />
        </button>
        <button
          type="button"
          className="tt-ins-btn"
          onClick={() => (playing ? roverPlayback.pause() : roverPlayback.play())}
          title={playing ? 'Pause the rover' : 'Drive the rover along the selected route'}
          aria-label={playing ? 'Pause' : 'Drive'}
        >
          {playing ? '❚❚' : '▶'}
        </button>
        <button type="button" className="tt-ins-btn" onClick={() => roverPlayback.restart()} title="Drive again from A" aria-label="Restart">
          ↺
        </button>
      </div>
      <div style={{ height: 2, margin: '2px 10px 6px', borderRadius: 2, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
        <div
          ref={barRef}
          style={{ height: '100%', width: '100%', background: '#4ADE80', transformOrigin: 'left', transform: `scaleX(${roverPlayback.get().progress})`, willChange: 'transform' }}
        />
      </div>

      <div className={`tt-ins-body ${open ? 'open' : ''}`} style={{ minHeight: 0 }}>
        <div style={{ overflowY: 'auto' }}>
          <div style={{ padding: '0 6px 8px' }}>
            {explanations.map((e) => {
              const route = plan.routes.find((r) => r.id === e.id)!;
              const on = e.id === selectedRouteId;
              return (
                <button
                  key={e.id}
                  type="button"
                  className={`tt-ins-route ${on ? 'on' : ''}`}
                  style={{ borderColor: on ? `${route.accentColor}99` : 'transparent' }}
                  onClick={() => {
                    onSelectRoute(e.id);
                    setDetail((d) => (d === e.id && on ? null : e.id));
                  }}
                  title={e.headline}
                >
                  <span style={{ width: 3, height: 18, borderRadius: 2, background: route.accentColor, flexShrink: 0 }} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontWeight: 650, display: 'block', fontSize: 11.5 }}>{e.shortName}</span>
                    <span className="tt-ins-muted" style={{ fontSize: 10.5 }}>
                      {route.analytics.totalDistanceKm} km · max {Math.round(route.analytics.maxSlopeDeg * 10) / 10}°
                    </span>
                  </span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 650, color: RISK_COLOR[e.risk] }}>
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: RISK_COLOR[e.risk] }} />
                    {RISK_SHORT[e.risk]}
                  </span>
                </button>
              );
            })}

            {bestFit && (
              <div style={{ margin: '4px 2px 2px', padding: '6px 8px', borderRadius: 9, background: 'rgba(74, 222, 128, 0.08)', border: '1px solid rgba(74, 222, 128, 0.22)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <button
                    type="button"
                    onClick={() => setFitOpen((v) => !v)}
                    style={{ all: 'unset', cursor: 'pointer', flex: 1, minWidth: 0 }}
                    aria-expanded={fitOpen}
                    title="Best NASA rover for this route — tap for the reasons"
                  >
                    <span className="tt-ins-muted" style={{ fontSize: 9.5, letterSpacing: '.05em', display: 'block' }}>
                      BEST ROVER FOR THIS ROUTE
                    </span>
                    <span style={{ fontWeight: 650, fontSize: 11.5 }}>
                      {bestFit.feasible ? bestFit.rover.name : 'None fits'}
                      {bestFit.feasible && <span style={{ color: '#4ADE80', fontFamily: 'var(--font-mono)', marginLeft: 6 }}>{bestFit.score}</span>}
                    </span>
                  </button>
                  {bestFit.feasible && bestFit.rover.id !== rover.id && (
                    <button type="button" className="tt-ins-btn" onClick={() => onSelectRover(bestFit.rover.id)} title={`Switch to ${bestFit.rover.name}`}>
                      Use
                    </button>
                  )}
                  {bestFit.feasible && bestFit.rover.id === rover.id && (
                    <span style={{ fontSize: 10.5, color: '#4ADE80' }}>✓ current</span>
                  )}
                </div>
                <div className={`tt-ins-body ${fitOpen ? 'open' : ''}`}>
                  <div>
                    <div style={{ fontSize: 11, marginTop: 6 }}>{whyBest(fits)}</div>
                    <ul style={{ fontSize: 11 }}>
                      {bestFit.reasons.map((r) => (
                        <li key={r}>{r}</li>
                      ))}
                    </ul>
                    <div style={{ fontSize: 10.5 }}>
                      {fits.map((f) => (
                        <div key={f.rover.id} style={{ display: 'flex', gap: 6, alignItems: 'center', opacity: f.feasible ? 1 : 0.55 }}>
                          <span style={{ flex: 1 }}>
                            {f.rover.name}
                            {f.rover.status === 'HISTORICAL_COMPLETED' ? <span className="tt-ins-muted"> · design only</span> : null}
                          </span>
                          <span style={{ fontFamily: 'var(--font-mono)' }}>{f.feasible ? f.score : 'too steep'}</span>
                        </div>
                      ))}
                    </div>
                    <div className="tt-ins-muted" style={{ fontSize: 10, marginTop: 4 }}>
                      Score: 45% slope margin, 25% cruise-grade share, 20% wheel-safe ground, 10% top speed. Route profile from LOLA.
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className={`tt-ins-body ${ex ? 'open' : ''}`}>
              <div>
                {ex && exRoute && (
                  <div style={{ padding: '8px 8px 2px', borderTop: '1px solid rgba(255,255,255,0.08)', marginTop: 4 }}>
                    <div style={{ marginBottom: 6 }}>{ex.headline}</div>
                    {ex.dangers.length > 0 && (
                      <>
                        <div style={{ color: '#F87171', fontWeight: 600 }}>Why it is dangerous</div>
                        <ul>
                          {ex.dangers.map((d) => (
                            <li key={d}>{d}</li>
                          ))}
                        </ul>
                      </>
                    )}
                    {ex.safeguards.length > 0 && (
                      <>
                        <div style={{ color: '#4ADE80', fontWeight: 600 }}>Why it is safe</div>
                        <ul>
                          {ex.safeguards.map((d) => (
                            <li key={d}>{d}</li>
                          ))}
                        </ul>
                      </>
                    )}
                    {ex.tradeoffs.length > 0 && (
                      <>
                        <div style={{ color: '#93C5FD', fontWeight: 600 }}>Trade-offs</div>
                        <ul>
                          {ex.tradeoffs.map((d) => (
                            <li key={d}>{d}</li>
                          ))}
                        </ul>
                      </>
                    )}
                    <div className="tt-ins-muted" style={{ fontSize: 10.5 }}>
                      LOLA grid {Math.round(plan.gridResolutionMeters)} m: rocks smaller than a cell are not visible; hazard cameras still required.
                    </div>
                  </div>
                )}
              </div>
            </div>
            {!ex && (
              <div className="tt-ins-muted" style={{ fontSize: 10.5, padding: '4px 8px 0' }}>
                Tap a route to see why it is safe or dangerous.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ container */

export const MissionInsightsOverlay: React.FC<MissionInsightsOverlayProps> = ({
  selectedSite,
  routePlan,
  selectedRouteId,
  onSelectRoute,
  rover,
  onSelectRover,
  onOpenEarthAnalogs,
}) => (
  <div className="tt-ins-column">
    {routePlan && routePlan.routes.length > 0 && (
      <RoutePanel plan={routePlan} selectedRouteId={selectedRouteId} onSelectRoute={onSelectRoute} rover={rover} onSelectRover={onSelectRover} />
    )}
    {selectedSite && (
      <div style={{ overflowY: 'auto', pointerEvents: 'none', minHeight: 0 }}>
        <EarthTwinCard site={selectedSite} onOpenEarthAnalogs={onOpenEarthAnalogs} />
      </div>
    )}
  </div>
);
