import React from 'react';
import { ExperienceMode, formatLatLonShort, NavTab } from '../coordinate-state';
import { LandingSiteEvaluation, RoutePlanResponse } from '../core/planet/types';
import { NASA_MOON_ROVERS, NasaRoverProfile, RoverId } from '../moon/rovers';

interface MissionDashboardViewProps {
  experienceMode: ExperienceMode;
  onSelectExperienceMode: (mode: ExperienceMode) => void;
  selectedRover: NasaRoverProfile;
  onSelectRover: (id: RoverId) => void;
  selectedSite: LandingSiteEvaluation | null;
  candidates: LandingSiteEvaluation[];
  routePlan: RoutePlanResponse | null;
  onNavigateTab: (tab: NavTab) => void;
  onSelectMissionLocation: (coord: { lat: number; lon: number }, openRegional3D?: boolean) => void;
  onOpenRoverStudio: (initialTab?: 'overview' | 'engineering' | 'compare' | 'custom_builder') => void;
}

const FEATURED_MOON_REGIONS = [
  {
    name: 'Jezero Crater Western Delta',
    badge: 'Moon 2020 Perseverance',
    description:
      'An ancient lake-delta system rich in clay and carbonate minerals that preserve potential biosignatures from 3.7 billion years ago.',
    lat: 18.4447,
    lon: 77.4508,
    elevation: '-2,540 m',
    slope: '1.8°',
  },
  {
    name: 'Gale Crater & Aeolis Mons',
    badge: 'MSL Curiosity',
    description:
      'A 154 km impact basin with a 5.5 km layered mountain recording Moon’ transition from a wet world to an arid desert.',
    lat: -4.5895,
    lon: 137.4417,
    elevation: '-4,501 m',
    slope: '1.9°',
  },
  {
    name: 'Elysium Planitia',
    badge: 'InSight Lander Plains',
    description:
      'Smooth equatorial volcanic plains offering some of the flattest, safest landing and driving terrain on Moon.',
    lat: 4.5024,
    lon: 135.6234,
    elevation: '-2,613 m',
    slope: '0.8°',
  },
  {
    name: 'Meridiani Planum',
    badge: 'MER Opportunity',
    description:
      'Hematite-bearing plains where Opportunity drove a record 45.16 km across ancient water-lain sedimentary bedrock.',
    lat: -1.9462,
    lon: 354.4734,
    elevation: '-1,445 m',
    slope: '0.9°',
  },
];

export const MissionDashboardView: React.FC<MissionDashboardViewProps> = ({
  experienceMode,
  selectedRover,
  onSelectRover,
  onNavigateTab,
  onSelectMissionLocation,
  onOpenRoverStudio,
}) => {
  const isBeginner = experienceMode === 'beginner';

  return (
    <div className="tt-home-scroll">
      <div style={{ maxWidth: 1180, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 32 }}>
        {/* HERO BANNER */}
        <section
          className="tt-card"
          style={{
            padding: '32px 36px',
            display: 'grid',
            gridTemplateColumns: '1.35fr 1fr',
            gap: 32,
            alignItems: 'center',
            background: 'linear-gradient(135deg, #FFFFFF 0%, #F8F9FB 100%)',
          }}
        >
          <div>
            <span className="tt-badge moon" style={{ marginBottom: 12 }}>
              {isBeginner
                ? 'Guided Moon Exploration Experience'
                : 'NASA LOLA · CTX · HiRISE Planetary Intelligence'}
            </span>
            <h1
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: 32,
                fontWeight: 800,
                letterSpacing: '-0.03em',
                lineHeight: 1.15,
                color: 'var(--text-primary)',
                marginBottom: 12,
              }}
            >
              {isBeginner
                ? 'Explore Moon, choose a robot, and plan a safe surface mission.'
                : 'High-Resolution 3D lunar Terrain & Rover Mobility Intelligence.'}
            </h1>
            <p style={{ fontSize: 15, color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 22 }}>
              {isBeginner
                ? 'TERRATWIN turns real NASA satellite laser and camera measurements into a clear, interactive 3D planet. Discover why certain craters and valleys are safe to land in, and see how different robots navigate the red planet.'
                : 'Built on authentic NASA MGS LOLA 128 PPD laser altimetry, MRO CTX 20 m stereo DTMs, and Jezero HiRISE 1 m terrain models in IAU_2015:49910 coordinates.'}
            </p>

            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <button
                type="button"
                className="tt-btn-primary"
                onClick={() => onNavigateTab('ai_agent')}
              >
                {isBeginner ? 'Plan Mission with AI Copilot ✨' : 'Launch AI Mission Copilot ✨'}
              </button>
              <button
                type="button"
                className="tt-btn-secondary"
                onClick={() => onNavigateTab('explorer_3d')}
              >
                {isBeginner ? 'Explore 3D Moon Globe →' : 'Open 3D Moon Workspace →'}
              </button>
              <button
                type="button"
                className="tt-btn-secondary"
                onClick={() => onOpenRoverStudio('custom_builder')}
              >
                Build a Custom Moon Robot
              </button>
            </div>
          </div>

          <div
            className="tt-card-soft"
            style={{
              padding: 20,
              display: 'flex',
              flexDirection: 'column',
              gap: 14,
              background: 'var(--bg-primary)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <img
                src={selectedRover.officialPhotos[0]?.url}
                alt={selectedRover.name}
                style={{ width: 72, height: 72, borderRadius: 14, objectFit: 'cover', background: '#17191D' }}
              />
              <div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600 }}>
                  Currently Selected Robot
                </div>
                <h3 style={{ fontSize: 20, fontWeight: 700 }}>{selectedRover.name}</h3>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                  {selectedRover.wheels.count} wheels · Ø{selectedRover.wheels.diameterCm} cm · Safe up to{' '}
                  {selectedRover.mobilityProfile.operationalMaxSlopeDeg}° slopes
                </div>
              </div>
            </div>
            <p style={{ fontSize: 13.5, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              {selectedRover.missionObjectives[0]}
            </p>
            <button
              type="button"
              className="tt-btn-secondary"
              onClick={() => onOpenRoverStudio('overview')}
            >
              Inspect {selectedRover.name} in 3D Studio
            </button>
          </div>
        </section>

        {/* 6-STEP GUIDED WORKFLOW OVERVIEW */}
        <section>
          <div style={{ marginBottom: 16 }}>
            <div className="tt-section-eyebrow">How It Works</div>
            <h2 className="tt-section-title">Your 6-Step Moon Mission Workflow</h2>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
            {[
              {
                step: 'Step 1',
                title: 'Explore Moon',
                desc: 'Rotate the 3D planet and inspect craters, volcanoes, and ancient river deltas.',
                tab: 'explorer_3d' as NavTab,
              },
              {
                step: 'Step 2',
                title: 'Choose Your Robot',
                desc: 'Select NASA’s Perseverance, Curiosity, Opportunity, Spirit, Sojourner, or build your own.',
                tab: 'rover_fleet' as NavTab,
              },
              {
                step: 'Step 3',
                title: 'Choose Your Mission',
                desc: 'Decide whether to prioritize ancient life, rock outcrops, or ultra-safe driving.',
                tab: 'explorer_3d' as NavTab,
              },
              {
                step: 'Step 4',
                title: 'Find a Suitable Location',
                desc: 'Check ground steepness, surface bumpiness, and atmospheric depth for landing.',
                tab: 'landing_site' as NavTab,
              },
              {
                step: 'Step 5',
                title: 'Plan Your Route',
                desc: 'Set a Start (A) and Destination (B) on Moon and compute real 3D surface paths.',
                tab: 'route_planner' as NavTab,
              },
              {
                step: 'Step 6',
                title: 'Understand the Results',
                desc: 'Compare the safest, shortest, and science routes with clear elevation charts.',
                tab: 'route_comparison' as NavTab,
              },
            ].map((item) => (
              <div
                key={item.step}
                onClick={() => onNavigateTab(item.tab)}
                className="tt-card-interactive"
              >
                <span className="tt-badge moon" style={{ marginBottom: 8 }}>
                  {item.step}
                </span>
                <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>{item.title}</h3>
                <p style={{ fontSize: 13.5, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                  {item.desc}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* FEATURED MOON LANDING & EXPLORATION REGIONS */}
        <section>
          <div style={{ marginBottom: 16 }}>
            <div className="tt-section-eyebrow">Real NASA Landing Sites</div>
            <h2 className="tt-section-title">Featured Moon Regions</h2>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
            {FEATURED_MOON_REGIONS.map((reg) => (
              <div
                key={reg.name}
                onClick={() => onSelectMissionLocation({ lat: reg.lat, lon: reg.lon }, true)}
                className="tt-card-interactive"
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <h3 style={{ fontSize: 17, fontWeight: 700 }}>{reg.name}</h3>
                  <span className="tt-badge blue">{reg.badge}</span>
                </div>
                <p style={{ fontSize: 13.5, color: 'var(--text-secondary)', marginBottom: 12, lineHeight: 1.5 }}>
                  {reg.description}
                </p>
                <div style={{ display: 'flex', gap: 16, fontSize: 12.5, color: 'var(--text-secondary)' }}>
                  <span className="tt-mono">{formatLatLonShort(reg.lat, reg.lon)}</span>
                  <span>Elevation: <strong>{reg.elevation}</strong></span>
                  <span>Slope: <strong>{reg.slope}</strong></span>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* NASA ROVER FLEET PREVIEW */}
        <section>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div>
              <div className="tt-section-eyebrow">NASA Moon Rovers</div>
              <h2 className="tt-section-title">Select or Customize a Surface Vehicle</h2>
            </div>
            <button
              type="button"
              className="tt-btn-secondary"
              onClick={() => onOpenRoverStudio('overview')}
            >
              Open Full 3D Rover Studio
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 14 }}>
            {NASA_MOON_ROVERS.map((r) => {
              const isSel = selectedRover.id === r.id;
              return (
                <div
                  key={r.id}
                  onClick={() => onSelectRover(r.id)}
                  className={`tt-card-interactive ${isSel ? 'selected' : ''}`}
                  style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
                >
                  <img
                    src={r.officialPhotos[0]?.url}
                    alt={r.name}
                    style={{ width: '100%', height: 110, borderRadius: 10, objectFit: 'cover', background: '#17191D' }}
                  />
                  <div>
                    <strong style={{ fontSize: 15, display: 'block' }}>{r.name}</strong>
                    <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                      {r.wheels.count} wheels · Max {r.mobilityProfile.operationalMaxSlopeDeg}°
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
};
