import React, { useEffect, useRef, useState } from 'react';
import { ExperienceMode, formatLatLonShort, NavTab } from '../coordinate-state';
import { LatLon } from '../core/geo/sphere';
import { RouteModeId } from '../core/planet/types';
import {
  AgentChatMessage,
  AgentChatResponsePayload,
  LlmRouterConfig,
  LlmRouterStatusResponse,
  MapStateUpdateCommand,
  MissionSpecification,
} from '../moon/agent-types';
import { CustomRoverConfig, NasaRoverProfile, RoverId } from '../moon/rovers';

interface AiMissionAgentPanelProps {
  experienceMode: ExperienceMode;
  selectedRoverId: RoverId;
  selectedRover: NasaRoverProfile;
  customRoverConfig: CustomRoverConfig;
  selectedLocation: LatLon;
  routeStart: LatLon;
  routeDestination: LatLon;
  selectedRouteId: RouteModeId;
  onSelectRoute: (routeId: RouteModeId) => void;
  onApplyMapUpdate: (update: MapStateUpdateCommand) => void;
  onConfirmCustomRover: (cfg: CustomRoverConfig) => void;
  onOpenRoverStudio: (initialTab?: 'overview' | 'engineering' | 'compare' | 'custom_builder') => void;
  onOpenBottomDrawer: (tab?: 'route_profile' | 'route_compare' | 'site_matrix') => void;
  onSelectTab: (tab: NavTab) => void;
  canUndoMapUpdate: boolean;
  onUndoMapUpdate: () => void;
}

const STARTER_MISSION_PROMPTS: Array<{
  id: string;
  badge: string;
  label: string;
  prompt: string;
}> = [
  {
    id: 'jezero_full',
    badge: 'Full Autonomous Plan',
    label: 'Jezero Crater Sample Return & Safe Delta Route',
    prompt:
      'I want to explore the Jezero Crater region. I need a rover capable of collecting rock samples and examining ancient water activity and geological formations. Find a suitable landing region and automatically plan the best exploration route while avoiding difficult terrain.',
  },
  {
    id: 'clarification_demo',
    badge: 'Interactive Clarification',
    label: 'Explore Interesting Geological Formations (Guided Q&A)',
    prompt: 'I want to explore an area with interesting geological formations.',
  },
  {
    id: 'gale_curiosity',
    badge: 'Stratigraphy Mission',
    label: 'Gale Crater & Mount Sharp Ascent with Curiosity',
    prompt:
      'Plan a mission in Gale Crater using Curiosity to investigate clay and sulfate sedimentary layers ascending Mount Sharp, and prioritize scientific discoveries.',
  },
  {
    id: 'custom_rover_design',
    badge: 'Custom Robot + Route',
    label: 'Design Custom 8-Wheel Nuclear Rover with Ground Radar',
    prompt:
      'Design a custom 8-wheel rover named Valkyrie-8 with 58cm wheels, curved grousers, nuclear MMRTG power, ground-penetrating radar, and a rock core drill to explore Jezero Crater.',
  },
];

function renderFormattedText(text: string): React.ReactNode {
  const paragraphs = text.split('\n\n');
  return paragraphs.map((para, pIdx) => {
    const lines = para.split('\n');
    const isList = lines.every((l) => l.trim().startsWith('- ') || l.trim().startsWith('* '));

    const formatInline = (line: string) => {
      const parts = line.split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g);
      return parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return (
            <strong key={i} style={{ fontWeight: 650, color: 'var(--text-primary)' }}>
              {part.slice(2, -2)}
            </strong>
          );
        }
        if (part.startsWith('`') && part.endsWith('`')) {
          return (
            <code
              key={i}
              className="tt-mono"
              style={{
                fontSize: 11.5,
                background: 'var(--bg-secondary)',
                padding: '1px 5px',
                borderRadius: 4,
                border: '1px solid var(--border-subtle)',
              }}
            >
              {part.slice(1, -1)}
            </code>
          );
        }
        if (part.startsWith('*') && part.endsWith('*')) {
          return <em key={i}>{part.slice(1, -1)}</em>;
        }
        return part;
      });
    };

    if (isList) {
      return (
        <ul
          key={pIdx}
          style={{
            margin: '6px 0',
            paddingLeft: 18,
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
          }}
        >
          {lines.map((l, lIdx) => (
            <li key={lIdx} style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--text-secondary)' }}>
              {formatInline(l.replace(/^[-*]\s+/, ''))}
            </li>
          ))}
        </ul>
      );
    }

    return (
      <p
        key={pIdx}
        style={{
          margin: pIdx === 0 ? '0 0 8px 0' : '8px 0 0 0',
          fontSize: 13.5,
          lineHeight: 1.55,
          color: 'var(--text-primary)',
        }}
      >
        {lines.map((line, lIdx) => (
          <React.Fragment key={lIdx}>
            {lIdx > 0 && <br />}
            {formatInline(line)}
          </React.Fragment>
        ))}
      </p>
    );
  });
}

export const AiMissionAgentPanel: React.FC<AiMissionAgentPanelProps> = ({
  experienceMode,
  selectedRoverId,
  selectedRover,
  customRoverConfig,
  selectedLocation,
  routeStart,
  routeDestination,
  selectedRouteId,
  onSelectRoute,
  onApplyMapUpdate,
  onConfirmCustomRover,
  onOpenRoverStudio,
  onOpenBottomDrawer,
  onSelectTab,
  canUndoMapUpdate,
  onUndoMapUpdate,
}) => {
  const [messages, setMessages] = useState<AgentChatMessage[]>([]);
  const [currentSpec, setCurrentSpec] = useState<MissionSpecification | null>(null);
  const [inputText, setInputText] = useState('');
  const [isPlanning, setIsPlanning] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Autonomous LLM Router status & admin drawer state
  const [routerStatus, setRouterStatus] = useState<LlmRouterStatusResponse | null>(null);
  const [routerPanelOpen, setRouterPanelOpen] = useState(false);
  const [expandedToolMsgIds, setExpandedToolMsgIds] = useState<Record<string, boolean>>({});

  const chatEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    fetch('/api/moon/agent/router-status')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) setRouterStatus(data);
      })
      .catch(() => {
        // ignore offline status fetch
      });
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, isPlanning]);

  const handleUpdateRouterConfig = async (patch: Partial<LlmRouterConfig>) => {
    try {
      const res = await fetch('/api/moon/agent/router-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (res.ok) {
        const updated: LlmRouterStatusResponse = await res.json();
        setRouterStatus(updated);
      }
    } catch {
      // ignore
    }
  };

  const sendMessage = async (rawPrompt: string) => {
    const trimmed = rawPrompt.trim();
    if (!trimmed || isPlanning) return;

    setErrorMsg(null);
    const userMessage: AgentChatMessage = {
      id: `user_${Date.now()}`,
      role: 'user',
      timestamp: new Date().toISOString(),
      content: trimmed,
    };

    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setInputText('');
    setIsPlanning(true);

    try {
      const res = await fetch('/api/moon/agent/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: nextMessages.map((m) => ({ role: m.role, content: m.content })),
          currentSpec,
          experienceMode,
          activeRoverId: selectedRoverId,
          savedCustomRoverConfig: customRoverConfig,
          currentLocation: selectedLocation,
          currentRouteStart: routeStart,
          currentRouteDestination: routeDestination,
        }),
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error || `Mission Agent HTTP ${res.status}`);
      }

      const data: AgentChatResponsePayload = await res.json();
      setMessages((prev) => [...prev, data.message]);
      setCurrentSpec(data.updatedSpec);
      setRouterStatus(data.routerStatus);

      if (data.message.mapUpdate) {
        onApplyMapUpdate(data.message.mapUpdate);
      }
    } catch (err) {
      setErrorMsg((err as Error).message || 'Failed to communicate with AI Mission Agent.');
    } finally {
      setIsPlanning(false);
    }
  };

  const handleResetChat = () => {
    setMessages([]);
    setCurrentSpec(null);
    setErrorMsg(null);
  };

  const toggleToolTrace = (msgId: string) => {
    setExpandedToolMsgIds((prev) => ({
      ...prev,
      [msgId]: !(prev[msgId] ?? experienceMode === 'advanced'),
    }));
  };

  const activeModelBadge =
    routerStatus?.stats.lastDecision?.displayName ||
    (routerStatus?.config.mode === 'pinned'
      ? routerStatus.models.find((m) => m.id === routerStatus.config.pinnedModelId)?.displayName
      : 'Auto Model Router · Aerospace NLU v2');

  return (
    <aside
      className="tt-right-panel"
      style={{
        width: 410,
        minWidth: 365,
        maxWidth: 430,
        height: '100%',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg-surface)',
        borderLeft: '1px solid var(--border-color)',
      }}
      aria-label="AI Mission Planning Agent"
    >
      {/* 1. AGENT HEADER */}
      <div
        className="tt-panel-header"
        style={{
          padding: '14px 18px',
          borderBottom: '1px solid var(--border-subtle)',
          background: 'var(--bg-surface)',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <div
              style={{
                width: 30,
                height: 30,
                borderRadius: 9,
                background: 'linear-gradient(135deg, #D9532F 0%, #2563EB 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#FFFFFF',
                boxShadow: '0 2px 8px rgba(217, 83, 47, 0.25)',
                flexShrink: 0,
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z" />
                <path d="M19 16l.9 2.1L22 19l-2.1.9L19 22l-.9-2.1L16 19l2.1-.9L19 16z" />
              </svg>
            </div>
            <div>
              <h2 className="tt-panel-title" style={{ fontSize: 15, margin: 0 }}>
                AI Mission Copilot
              </h2>
              <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 5 }}>
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: '#16A34A',
                    display: 'inline-block',
                  }}
                />
                <span
                  style={{
                    maxWidth: 205,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                  title={activeModelBadge}
                >
                  {activeModelBadge}
                </span>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {canUndoMapUpdate && (
              <button
                type="button"
                className="tt-btn-secondary"
                style={{ padding: '5px 9px', fontSize: 11.5 }}
                onClick={onUndoMapUpdate}
                title="Restore previous 3D map coordinates, rover, and route state"
              >
                Undo Map
              </button>
            )}
            <button
              type="button"
              className={`tt-btn-secondary ${routerPanelOpen ? 'active' : ''}`}
              style={{
                padding: '5px 9px',
                fontSize: 11.5,
                borderColor: routerPanelOpen ? 'var(--accent-blue)' : undefined,
              }}
              onClick={() => setRouterPanelOpen((v) => !v)}
              title="Configure Autonomous LLM Model Router & Provider Telemetry"
            >
              AI Router
            </button>
            {messages.length > 0 && (
              <button
                type="button"
                className="tt-btn-ghost"
                style={{ padding: '5px 8px', fontSize: 11.5 }}
                onClick={handleResetChat}
                title="Start a new mission conversation"
              >
                Reset
              </button>
            )}
          </div>
        </div>

        {/* Active Context Strip */}
        <div
          style={{
            marginTop: 10,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 6,
            padding: '6px 10px',
            borderRadius: 8,
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-subtle)',
            fontSize: 11.5,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            <span style={{ color: 'var(--text-tertiary)', fontWeight: 600 }}>ROVER:</span>
            <strong style={{ color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {selectedRover.name}
            </strong>
            <span style={{ color: 'var(--text-tertiary)' }}>·</span>
            <span className="tt-mono" style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
              {formatLatLonShort(selectedLocation.lat, selectedLocation.lon)}
            </span>
          </div>
          <button
            type="button"
            className="tt-btn-ghost"
            style={{ padding: '2px 6px', fontSize: 11, color: 'var(--accent-blue)' }}
            onClick={() => onOpenRoverStudio('overview')}
          >
            Switch Robot
          </button>
        </div>

        {/* Collapsible Autonomous LLM Router Configuration Drawer */}
        {routerPanelOpen && routerStatus && (
          <div
            style={{
              marginTop: 10,
              padding: 12,
              borderRadius: 10,
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border-color)',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-primary)' }}>
                  Autonomous Multi-Provider LLM Router
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                  Evaluates reasoning, tool-calling reliability, latency & fallback health
                </div>
              </div>
              <span className="tt-badge blue" style={{ fontSize: 10.5 }}>
                {routerStatus.config.mode === 'auto' ? 'AUTO ROUTING' : 'PINNED'}
              </span>
            </div>

            <div style={{ display: 'flex', gap: 6 }}>
              <button
                type="button"
                className={routerStatus.config.mode === 'auto' ? 'tt-btn-primary' : 'tt-btn-secondary'}
                style={{ flex: 1, padding: '6px 10px', fontSize: 11.5 }}
                onClick={() => handleUpdateRouterConfig({ mode: 'auto' })}
              >
                Automatic Best Model
              </button>
              <select
                className="tt-vp-select"
                style={{ flex: 1.3, fontSize: 11.5, padding: '5px 8px' }}
                value={
                  routerStatus.config.mode === 'pinned'
                    ? routerStatus.config.pinnedModelId || 'terratwin-scientific-nlu-v2'
                    : ''
                }
                onChange={(e) => {
                  const val = e.target.value;
                  if (!val) {
                    handleUpdateRouterConfig({ mode: 'auto' });
                  } else {
                    handleUpdateRouterConfig({ mode: 'pinned', pinnedModelId: val });
                  }
                }}
              >
                <option value="">Pin Specific Model...</option>
                {routerStatus.models.map((m) => (
                  <option key={m.id} value={m.id} disabled={!m.available}>
                    {m.displayName} {m.available ? '✓' : '(API Key Unconfigured)'}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ display: 'flex', gap: 8, fontSize: 11.5 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', color: 'var(--text-secondary)' }}>
                <input
                  type="checkbox"
                  checked={Boolean(routerStatus.config.preferLowLatency)}
                  onChange={(e) => handleUpdateRouterConfig({ preferLowLatency: e.target.checked })}
                />
                Prefer Low Latency
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', color: 'var(--text-secondary)' }}>
                <input
                  type="checkbox"
                  checked={Boolean(routerStatus.config.preferLowCost)}
                  onChange={(e) => handleUpdateRouterConfig({ preferLowCost: e.target.checked })}
                />
                Prefer Low Cost
              </label>
            </div>

            <div
              style={{
                maxHeight: 155,
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: 5,
                paddingRight: 2,
              }}
            >
              {routerStatus.models.map((m) => (
                <div
                  key={m.id}
                  style={{
                    padding: '6px 8px',
                    borderRadius: 7,
                    background: 'var(--bg-primary)',
                    border: '1px solid var(--border-subtle)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    fontSize: 11,
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{m.displayName}</div>
                    <div style={{ fontSize: 10.5, color: 'var(--text-tertiary)' }}>
                      Reasoning {m.reasoningScore} · Tools {m.toolCallingScore} · {m.latencyClass}
                    </div>
                  </div>
                  <span
                    className={`tt-badge ${m.available ? 'green' : ''}`}
                    style={{ fontSize: 10, flexShrink: 0 }}
                    title={m.statusNote}
                  >
                    {m.available ? 'Active' : 'No Key'}
                  </span>
                </div>
              ))}
            </div>

            <div
              className="tt-mono"
              style={{
                fontSize: 10.5,
                color: 'var(--text-secondary)',
                display: 'flex',
                justifyContent: 'space-between',
                borderTop: '1px solid var(--border-subtle)',
                paddingTop: 6,
              }}
            >
              <span>Requests: {routerStatus.stats.totalRequests}</span>
              <span>Fallbacks: {routerStatus.stats.totalFallbacks}</span>
              <span>Tokens: ~{routerStatus.stats.totalEstimatedTokens}</span>
            </div>
          </div>
        )}
      </div>

      {/* 2. SCROLLABLE CONVERSATION BODY */}
      <div
        className="tt-panel-body"
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          padding: '16px 18px',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        {/* Welcome Empty State + Starter Mission Prompts */}
        {messages.length === 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div
              className="tt-card"
              style={{
                background: 'linear-gradient(180deg, #FFFBF9 0%, #FFFFFF 100%)',
                border: '1px solid rgba(217, 83, 47, 0.22)',
                padding: 16,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span className="tt-badge moon">Agentic Mission System</span>
                <span className="tt-badge blue">
                  {experienceMode === 'beginner' ? 'Beginner Mode' : 'Advanced Engineering Mode'}
                </span>
              </div>
              <h3 style={{ fontSize: 15, fontWeight: 700, margin: '4px 0 6px 0', color: 'var(--text-primary)' }}>
                Describe your Moon exploration mission naturally
              </h3>
              <p style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--text-secondary)', margin: 0 }}>
                {experienceMode === 'beginner'
                  ? 'Tell me where on Moon you want to explore, what science you want to do, or what kind of robot you want to drive. I will search real NASA terrain data, rank landing sites, calculate safe 3D routes, and update the 3D Moon globe for you.'
                  : 'Specify target geological regions, payload requirements, custom rover mobility parameters, or multi-objective route priorities. The agent orchestrates deterministic LOLA/HiRISE DEM sampling, 7-criterion landing suitability, and Octile A* pathfinding directly on the 3D scene.'}
              </p>
            </div>

            <div>
              <div
                style={{
                  fontSize: 11.5,
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  color: 'var(--text-tertiary)',
                  marginBottom: 8,
                }}
              >
                Try a Mission Prompt
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {STARTER_MISSION_PROMPTS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => sendMessage(item.prompt)}
                    style={{
                      textAlign: 'left',
                      padding: '11px 13px',
                      borderRadius: 12,
                      background: 'var(--bg-surface)',
                      border: '1px solid var(--border-color)',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 4,
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = 'var(--accent-moon)';
                      e.currentTarget.style.background = 'var(--moon-accent-soft)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = 'var(--border-color)';
                      e.currentTarget.style.background = 'var(--bg-surface)';
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 13, fontWeight: 650, color: 'var(--text-primary)' }}>
                        {item.label}
                      </span>
                      <span className="tt-badge" style={{ fontSize: 10.5 }}>
                        {item.badge}
                      </span>
                    </div>
                    <span
                      style={{
                        fontSize: 12,
                        color: 'var(--text-secondary)',
                        lineHeight: 1.4,
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                      }}
                    >
                      “{item.prompt}”
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Render Conversation Messages */}
        {messages.map((msg) => {
          const isUser = msg.role === 'user';
          const showToolsExpanded =
            expandedToolMsgIds[msg.id] ?? experienceMode === 'advanced';
          const rpt = msg.missionReport;

          if (isUser) {
            return (
              <div
                key={msg.id}
                style={{
                  alignSelf: 'flex-end',
                  maxWidth: '88%',
                  background: '#1D1D1F',
                  color: '#FFFFFF',
                  padding: '11px 15px',
                  borderRadius: '16px 16px 4px 16px',
                  fontSize: 13.5,
                  lineHeight: 1.5,
                  boxShadow: '0 2px 6px rgba(0,0,0,0.08)',
                }}
              >
                {msg.content}
              </div>
            );
          }

          return (
            <div
              key={msg.id}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
                alignSelf: 'stretch',
              }}
            >
              {/* 2a. Agent Tool Execution Trace */}
              {msg.toolCalls && msg.toolCalls.length > 0 && (
                <div
                  style={{
                    borderRadius: 10,
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border-color)',
                    overflow: 'hidden',
                  }}
                >
                  <button
                    type="button"
                    onClick={() => toggleToolTrace(msg.id)}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      background: 'transparent',
                      border: 'none',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      cursor: 'pointer',
                      fontSize: 12,
                      color: 'var(--text-secondary)',
                    }}
                  >
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600 }}>
                      <span style={{ color: '#16A34A' }}>✓</span>
                      <span>
                        Executed {msg.toolCalls.length} NASA Terrain & Mission Planning Tools
                      </span>
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--accent-blue)' }}>
                      {showToolsExpanded ? 'Hide Steps ▲' : 'View Steps ▼'}
                    </span>
                  </button>

                  {showToolsExpanded && (
                    <div
                      style={{
                        padding: '4px 12px 10px 12px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 6,
                        borderTop: '1px solid var(--border-subtle)',
                      }}
                    >
                      {msg.toolCalls.map((tc) => (
                        <div
                          key={tc.id}
                          style={{
                            padding: '6px 8px',
                            borderRadius: 7,
                            background: 'var(--bg-primary)',
                            border: '1px solid var(--border-subtle)',
                            fontSize: 11.5,
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <strong style={{ color: 'var(--text-primary)' }}>
                              {tc.stepNumber}. {tc.title}
                            </strong>
                            <span className="tt-mono" style={{ fontSize: 10.5, color: 'var(--text-tertiary)' }}>
                              {tc.durationMs} ms
                            </span>
                          </div>
                          <div style={{ color: 'var(--text-secondary)', marginTop: 2 }}>
                            {tc.outputSummary}
                          </div>
                          {experienceMode === 'advanced' && tc.dataProvenance && (
                            <div className="tt-mono" style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 2 }}>
                              Source: {tc.dataProvenance}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* 2b. Assistant Narrative Response Bubble */}
              <div
                style={{
                  background: 'var(--bg-secondary)',
                  border: '1px solid var(--border-subtle)',
                  padding: '13px 15px',
                  borderRadius: '16px 16px 16px 4px',
                }}
              >
                {renderFormattedText(msg.content)}

                {experienceMode === 'advanced' && msg.routerDecision && (
                  <div
                    className="tt-mono"
                    style={{
                      marginTop: 8,
                      paddingTop: 6,
                      borderTop: '1px dashed var(--border-color)',
                      fontSize: 10.5,
                      color: 'var(--text-tertiary)',
                      display: 'flex',
                      justifyContent: 'space-between',
                    }}
                  >
                    <span>Model: {msg.routerDecision.displayName}</span>
                    <span>{msg.routerDecision.latencyMs} ms</span>
                  </div>
                )}
              </div>

              {/* 2c. Clarifying Follow-Up Questions & Quick Replies */}
              {msg.followUpQuestions && msg.followUpQuestions.length > 0 && (
                <div
                  className="tt-card"
                  style={{
                    padding: 13,
                    background: 'var(--bg-primary)',
                    border: '1px solid var(--border-color)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 12,
                  }}
                >
                  {msg.followUpQuestions.map((fq, qIdx) => (
                    <div key={qIdx} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 650, color: 'var(--text-primary)' }}>
                        {fq.question}
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {fq.quickReplies.map((replyText, rIdx) => (
                          <button
                            key={rIdx}
                            type="button"
                            onClick={() => sendMessage(replyText)}
                            disabled={isPlanning}
                            style={{
                              padding: '6px 11px',
                              borderRadius: 999,
                              fontSize: 12,
                              fontWeight: 500,
                              background: 'var(--bg-secondary)',
                              border: '1px solid var(--border-color)',
                              color: 'var(--text-primary)',
                              cursor: 'pointer',
                              textAlign: 'left',
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.borderColor = 'var(--accent-moon)';
                              e.currentTarget.style.background = 'var(--moon-accent-soft)';
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.borderColor = 'var(--border-color)';
                              e.currentTarget.style.background = 'var(--bg-secondary)';
                            }}
                          >
                            {replyText}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* 2d. Custom Rover Confirmation Card (when AI designed a custom rover) */}
              {rpt?.isProposedCustomRover && rpt.proposedCustomRoverConfig && (
                <div
                  className="tt-card"
                  style={{
                    padding: 14,
                    background: 'var(--sci-blue-soft)',
                    border: '1px solid rgba(37, 99, 235, 0.3)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span className="tt-badge blue">AI-Engineered Custom Rover</span>
                    <span className="tt-mono" style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                      {rpt.rover.wheels.count}W · {rpt.rover.wheels.diameterCm}cm · {rpt.rover.mobilityProfile.operationalMaxSlopeDeg}° Max
                    </span>
                  </div>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text-primary)' }}>
                    {rpt.proposedCustomRoverConfig.name}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.45 }}>
                    {rpt.rover.suspension.architecture} · {rpt.rover.dimensions.powerSource} · Instruments:{' '}
                    {rpt.rover.instruments.map((i) => i.name).join(', ')}
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                    <button
                      type="button"
                      className="tt-btn-primary"
                      style={{ flex: 1, padding: '7px 10px', fontSize: 12 }}
                      onClick={() => {
                        if (rpt.proposedCustomRoverConfig) {
                          onConfirmCustomRover(rpt.proposedCustomRoverConfig);
                        }
                      }}
                    >
                      Save & Activate Custom Robot
                    </button>
                    <button
                      type="button"
                      className="tt-btn-secondary"
                      style={{ padding: '7px 10px', fontSize: 12 }}
                      onClick={() => {
                        if (rpt.proposedCustomRoverConfig) {
                          onConfirmCustomRover(rpt.proposedCustomRoverConfig);
                        }
                        onOpenRoverStudio('custom_builder');
                      }}
                    >
                      Edit in 3D Studio
                    </button>
                  </div>
                </div>
              )}

              {/* 2e. Structured Mission Execution Report Card */}
              {rpt && (
                <div
                  className="tt-card"
                  style={{
                    padding: 15,
                    border: '1px solid var(--border-color)',
                    background: 'var(--bg-primary)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 14,
                    boxShadow: '0 4px 14px rgba(0, 0, 0, 0.04)',
                  }}
                >
                  {/* Header */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                        <span className="tt-badge green">✓ Applied to 3D Moon Map</span>
                        <span className="tt-badge">{rpt.beginnerSummary.terrainDifficultyLabel}</span>
                      </div>
                      <h4 style={{ fontSize: 14.5, fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
                        {rpt.missionTitle}
                      </h4>
                    </div>
                  </div>

                  {/* Selected Rover & Landing Site Summary Grid */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <div
                      style={{
                        padding: 10,
                        borderRadius: 10,
                        background: 'var(--bg-secondary)',
                        border: '1px solid var(--border-subtle)',
                      }}
                    >
                      <div style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>
                        Selected Rover
                      </div>
                      <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text-primary)', marginTop: 2 }}>
                        {rpt.rover.name}
                      </div>
                      <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', marginTop: 2 }}>
                        {rpt.rover.wheels.count} wheels ({rpt.rover.wheels.diameterCm} cm) · {rpt.rover.mobilityProfile.operationalMaxSlopeDeg}° limit
                      </div>
                    </div>

                    <div
                      style={{
                        padding: 10,
                        borderRadius: 10,
                        background: 'var(--bg-secondary)',
                        border: '1px solid var(--border-subtle)',
                      }}
                    >
                      <div style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>
                        Top Landing Site
                      </div>
                      <div style={{ fontSize: 13.5, fontWeight: 700, color: '#16A34A', marginTop: 2 }}>
                        {Math.round((rpt.recommendedLandingSite.suitability.total ?? 0) * 100)} / 100 Score
                      </div>
                      <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', marginTop: 2 }}>
                        Elev {Math.round(rpt.recommendedLandingSite.telemetry.elevationM ?? 0)} m · Slope{' '}
                        {rpt.recommendedLandingSite.telemetry.slopeDeg?.toFixed(1) ?? 0}°
                      </div>
                    </div>
                  </div>

                  {/* Beginner Plain-Language Explanations vs Advanced Engineering Telemetry */}
                  {experienceMode === 'beginner' ? (
                    <div
                      style={{
                        padding: '10px 12px',
                        borderRadius: 10,
                        background: 'var(--bg-elevated)',
                        border: '1px solid var(--border-subtle)',
                        fontSize: 12.5,
                        lineHeight: 1.5,
                        color: 'var(--text-secondary)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 6,
                      }}
                    >
                      <div>
                        <strong style={{ color: 'var(--text-primary)' }}>Why this robot: </strong>
                        {rpt.beginnerSummary.whyThisRover}
                      </div>
                      <div>
                        <strong style={{ color: 'var(--text-primary)' }}>Why this landing zone: </strong>
                        {rpt.beginnerSummary.whyThisLandingSite}
                      </div>
                      <div>
                        <strong style={{ color: 'var(--text-primary)' }}>Why this route: </strong>
                        {rpt.beginnerSummary.whyThisRoute}
                      </div>
                    </div>
                  ) : (
                    <div
                      style={{
                        padding: '10px 12px',
                        borderRadius: 10,
                        background: 'var(--warn-amber-soft)',
                        border: '1px solid rgba(217, 119, 6, 0.28)',
                        fontSize: 11.5,
                        lineHeight: 1.45,
                        color: '#92400E',
                      }}
                    >
                      <strong>EDL Touchdown vs. Surface Accessibility: </strong>
                      {rpt.spacecraftVsRoverDisclaimer}
                    </div>
                  )}

                  {/* Multi-Objective Route Comparison Table */}
                  <div>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginBottom: 6,
                      }}
                    >
                      <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>
                        3D Exploration Routes to {rpt.selectedDestination.name}
                      </span>
                      <span className="tt-mono" style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                        Click to preview on 3D map
                      </span>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {rpt.routePlan.routes.map((route) => {
                        const objScore = rpt.routeObjectiveScores.find((s) => s.routeId === route.id);
                        const isRec = route.id === rpt.recommendedRouteId;
                        const isSelectedOnMap = route.id === selectedRouteId;

                        return (
                          <div
                            key={route.id}
                            onClick={() => onSelectRoute(route.id)}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') onSelectRoute(route.id);
                            }}
                            style={{
                              padding: '9px 11px',
                              borderRadius: 10,
                              cursor: 'pointer',
                              background: isSelectedOnMap ? 'var(--moon-accent-soft)' : 'var(--bg-elevated)',
                              border: isSelectedOnMap
                                ? '1.5px solid var(--accent-moon)'
                                : '1px solid var(--border-subtle)',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 4,
                            }}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <span
                                  style={{
                                    width: 9,
                                    height: 9,
                                    borderRadius: '50%',
                                    background: route.accentColor,
                                    display: 'inline-block',
                                  }}
                                />
                                <strong style={{ fontSize: 12.5, color: 'var(--text-primary)' }}>
                                  {route.name}
                                </strong>
                                {isRec && (
                                  <span className="tt-badge moon" style={{ fontSize: 10, padding: '1px 6px' }}>
                                    AI Recommended
                                  </span>
                                )}
                              </div>
                              <span className="tt-mono" style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>
                                {objScore?.totalObjectiveScore ?? 85}/100
                              </span>
                            </div>

                            <div
                              className="tt-mono"
                              style={{
                                display: 'flex',
                                gap: 10,
                                fontSize: 11,
                                color: 'var(--text-secondary)',
                              }}
                            >
                              <span>Dist: {route.analytics.totalDistanceKm.toFixed(2)} km</span>
                              <span>Max Slope: {route.analytics.maxSlopeDeg.toFixed(1)}°</span>
                              <span>Climb: +{Math.round(route.analytics.totalElevationGainM)} m</span>
                              <span>Safety: {objScore?.terrainSafetyScore ?? 85}%</span>
                            </div>

                            {experienceMode === 'advanced' && objScore && (
                              <div className="tt-mono" style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>
                                {objScore.formulaText}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Alternative Regional Landing Candidates */}
                  {rpt.alternativeLandingSites.length > 0 && (
                    <div>
                      <div style={{ fontSize: 11.5, fontWeight: 650, color: 'var(--text-secondary)', marginBottom: 5 }}>
                        Alternative Regional Landing Candidates Ranked:
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {rpt.alternativeLandingSites.slice(0, 2).map((alt) => (
                          <div
                            key={alt.id}
                            style={{
                              fontSize: 11.5,
                              padding: '5px 9px',
                              borderRadius: 7,
                              background: 'var(--bg-secondary)',
                              display: 'flex',
                              justifyContent: 'space-between',
                              color: 'var(--text-secondary)',
                            }}
                          >
                            <span>{alt.name}</span>
                            <span className="tt-mono">
                              {Math.round((alt.suitability.total ?? 0) * 100)}/100 · {alt.telemetry.slopeDeg?.toFixed(1) ?? 0}°
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Confidence & Limitations Footer (always visible in Advanced, compact in Beginner) */}
                  <div
                    style={{
                      padding: '8px 10px',
                      borderRadius: 8,
                      background: 'var(--bg-secondary)',
                      fontSize: 11,
                      color: 'var(--text-secondary)',
                      lineHeight: 1.4,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600, color: 'var(--text-primary)' }}>
                      <span>NASA Data Confidence: {rpt.confidenceAndLimitations.overallConfidencePct}%</span>
                      <span>{rpt.routePlan.gridSource.split('(')[0]}</span>
                    </div>
                    <div style={{ marginTop: 2 }}>{rpt.confidenceAndLimitations.dtmCoverageNote}</div>
                  </div>

                  {/* Quick Action & Conversational Revision Buttons */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 4, borderTop: '1px solid var(--border-subtle)' }}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        type="button"
                        className="tt-btn-secondary"
                        style={{ flex: 1, padding: '7px 10px', fontSize: 12 }}
                        onClick={() => onOpenBottomDrawer('route_profile')}
                      >
                        Elevation Profile Chart
                      </button>
                      <button
                        type="button"
                        className="tt-btn-secondary"
                        style={{ flex: 1, padding: '7px 10px', fontSize: 12 }}
                        onClick={() => onSelectTab('route_planner')}
                      >
                        Manual Route Controls
                      </button>
                    </div>

                    <div>
                      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', marginBottom: 5 }}>
                        Ask AI to Revise This Mission:
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                        {[
                          'Find a less difficult route',
                          'Prioritize scientific discoveries',
                          'Move the destination closer to the landing site',
                          rpt.rover.id === 'perseverance' ? 'Choose Curiosity instead' : 'Choose Perseverance instead',
                        ].map((revPrompt) => (
                          <button
                            key={revPrompt}
                            type="button"
                            disabled={isPlanning}
                            onClick={() => sendMessage(revPrompt)}
                            style={{
                              padding: '5px 10px',
                              borderRadius: 999,
                              fontSize: 11.5,
                              background: 'var(--bg-secondary)',
                              border: '1px solid var(--border-color)',
                              color: 'var(--text-primary)',
                              cursor: 'pointer',
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.borderColor = 'var(--accent-moon)';
                              e.currentTarget.style.background = 'var(--moon-accent-soft)';
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.borderColor = 'var(--border-color)';
                              e.currentTarget.style.background = 'var(--bg-secondary)';
                            }}
                          >
                            {revPrompt}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {/* Loading Indicator while executing NASA tools */}
        {isPlanning && (
          <div
            style={{
              padding: '12px 14px',
              borderRadius: 12,
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-subtle)',
              fontSize: 13,
              color: 'var(--text-secondary)',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
            }}
          >
            <div
              style={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                background: 'var(--accent-moon)',
                animation: 'pulse 1.2s infinite ease-in-out',
              }}
            />
            <span>
              Sampling NASA LOLA/HiRISE terrain, scoring landing candidates, and computing 3D A* routes...
            </span>
          </div>
        )}

        {errorMsg && (
          <div
            style={{
              padding: '10px 12px',
              borderRadius: 10,
              background: 'var(--danger-red-soft)',
              border: '1px solid #FECACA',
              color: '#DC2626',
              fontSize: 12.5,
            }}
          >
            {errorMsg}
          </div>
        )}

        <div ref={chatEndRef} />
      </div>

      {/* 3. CHAT INPUT BAR */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          sendMessage(inputText);
        }}
        style={{
          padding: '12px 16px',
          borderTop: '1px solid var(--border-color)',
          background: 'var(--bg-surface)',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <textarea
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage(inputText);
              }
            }}
            placeholder="Describe your Moon mission, rover, or ask to adjust the route..."
            rows={2}
            disabled={isPlanning}
            style={{
              flex: 1,
              resize: 'none',
              padding: '10px 12px',
              borderRadius: 12,
              border: '1px solid var(--border-color)',
              background: 'var(--bg-secondary)',
              color: 'var(--text-primary)',
              fontSize: 13,
              fontFamily: 'inherit',
              lineHeight: 1.45,
              outline: 'none',
            }}
          />
          <button
            type="submit"
            className="tt-btn-primary"
            disabled={isPlanning || !inputText.trim()}
            style={{
              height: 42,
              padding: '0 16px',
              borderRadius: 12,
              fontSize: 13,
              fontWeight: 600,
              opacity: isPlanning || !inputText.trim() ? 0.55 : 1,
            }}
          >
            Send
          </button>
        </div>
      </form>
    </aside>
  );
};
