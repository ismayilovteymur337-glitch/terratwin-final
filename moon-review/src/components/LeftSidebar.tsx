import React from 'react';
import { ExperienceMode, NavTab } from '../coordinate-state';
import { NasaRoverProfile } from '../moon/rovers';

interface LeftSidebarProps {
  experienceMode: ExperienceMode;
  onSelectExperienceMode: (mode: ExperienceMode) => void;
  activeTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  selectedRover: NasaRoverProfile;
  onOpenRoverStudio: () => void;
  collapsed?: boolean;
}

interface NavItemConfig {
  id: NavTab;
  label: string;
  subtitle: string;
  icon: React.ReactNode;
}

const NAV_ITEMS: NavItemConfig[] = [
  {
    id: 'overview',
    label: 'Home',
    subtitle: 'Mission overview & guide',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 9.5L12 3l9 6.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1V9.5z" />
      </svg>
    ),
  },
  {
    id: 'explorer_3d',
    label: 'Explore Moon',
    subtitle: 'Interactive 3D planet',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="9" />
        <path d="M3.6 9h16.8" />
        <path d="M3.6 15h16.8" />
        <path d="M11.5 3a17 17 0 0 0 0 18" />
        <path d="M12.5 3a17 17 0 0 1 0 18" />
      </svg>
    ),
  },
  {
    id: 'ai_agent',
    label: 'AI Mission Agent',
    subtitle: 'Conversational AI copilot',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z" />
        <path d="M19 16l.9 2.1L22 19l-2.1.9L19 22l-.9-2.1L16 19l2.1-.9L19 16z" />
      </svg>
    ),
  },
  {
    id: 'rover_fleet',
    label: 'Rover Fleet',
    subtitle: 'Choose or build a robot',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <rect x="4" y="8" width="16" height="7" rx="2" />
        <circle cx="7" cy="18" r="2.2" />
        <circle cx="12" cy="18" r="2.2" />
        <circle cx="17" cy="18" r="2.2" />
        <path d="M15 8V4h3" />
      </svg>
    ),
  },
  {
    id: 'route_planner',
    label: 'Mission Planner',
    subtitle: 'Safe rover pathfinding',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="6" cy="18" r="2.5" />
        <circle cx="18" cy="6" r="2.5" />
        <path d="M8.5 18h3.5a3 3 0 0 0 3-3V9a3 3 0 0 1 3-3" />
      </svg>
    ),
  },
  {
    id: 'landing_site',
    label: 'Terrain Analysis',
    subtitle: 'Suitability & hazards',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 19l6-8 4 5 4-7 4 10H3z" />
      </svg>
    ),
  },
  {
    id: 'earth_analogs',
    label: 'Earth Analogs',
    subtitle: 'Earth places like Moon & Moon',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="7" cy="12" r="4.5" />
        <circle cx="17.5" cy="12" r="3" />
        <path d="M11.5 12h3" />
      </svg>
    ),
  },
  {
    id: 'data_sources',
    label: 'Data Library',
    subtitle: 'NASA orbital datasets',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <ellipse cx="12" cy="5" rx="8" ry="3" />
        <path d="M4 5v7c0 1.66 3.58 3 8 3s8-1.34 8-3V5" />
        <path d="M4 12v7c0 1.66 3.58 3 8 3s8-1.34 8-3v-7" />
      </svg>
    ),
  },
];

export const LeftSidebar: React.FC<LeftSidebarProps> = ({
  activeTab,
  onSelectTab,
  selectedRover,
  onOpenRoverStudio,
  collapsed = false,
}) => {
  // Map custom_rover or route_comparison to their primary 6-item parent for active highlight
  const normalizedActiveTab: NavTab =
    activeTab === 'custom_rover'
      ? 'rover_fleet'
      : activeTab === 'route_comparison'
        ? 'route_planner'
        : activeTab;

  return (
    <aside className={`tt-left-sidebar ${collapsed ? 'collapsed' : ''}`} aria-label="Main navigation">
      <div>
        {!collapsed && <div className="tt-nav-section-label">Navigation</div>}
        <nav className="tt-nav-list">
          {NAV_ITEMS.map((item) => {
            const isActive = normalizedActiveTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectTab(item.id)}
                className={`tt-nav-item ${isActive ? 'active' : ''}`}
                title={collapsed ? `${item.label} — ${item.subtitle}` : item.subtitle}
              >
                <span className="tt-nav-icon">{item.icon}</span>
                {!collapsed && (
                  <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {item.label}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Bottom Active Rover Summary Card */}
      <div className="tt-sidebar-footer">
        {!collapsed ? (
          <div>
            <div className="tt-nav-section-label" style={{ paddingLeft: 4, paddingBottom: 6 }}>
              Active Robot
            </div>
            <div
              className="tt-sidebar-rover-card"
              onClick={onOpenRoverStudio}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') onOpenRoverStudio();
              }}
              title="Open Rover Fleet & 3D Studio"
            >
              <img
                src={selectedRover.officialPhotos[0]?.url}
                alt={selectedRover.name}
                className="tt-sidebar-rover-thumb"
              />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: 'var(--text-primary)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {selectedRover.name}
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
                  {selectedRover.wheels.count} wheels · {selectedRover.mobilityProfile.operationalMaxSlopeDeg}° max
                </div>
              </div>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={onOpenRoverStudio}
            className="tt-nav-item"
            title={`Active Robot: ${selectedRover.name} (Click to open 3D Studio)`}
          >
            <img
              src={selectedRover.officialPhotos[0]?.url}
              alt={selectedRover.name}
              style={{ width: 28, height: 28, borderRadius: 7, objectFit: 'cover' }}
            />
          </button>
        )}
      </div>
    </aside>
  );
};
