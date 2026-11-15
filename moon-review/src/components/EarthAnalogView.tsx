import React, { useMemo, useState } from 'react';
import { formatLatLonShort } from '../coordinate-state';
import {
  AnalogMatch,
  Body,
  bestPerDimension,
  DEFAULT_WEIGHTS,
  earthLimits,
  rankAnalogs,
  TARGETS,
  Weights,
} from '../moon/analogs';
import { showOnEarth } from '../earth-link';
import { climateLine, MOON_CLIMATE_REFERENCE, useEarthClimate } from '../moon/use-earth-climate';

interface EarthAnalogViewProps {
  /** Fly the 3D Moon view to a Moon target. */
  onOpenOnMoon: (coord: { lat: number; lon: number }) => void;
}

const pct = (x: number | null) => (x === null ? '—' : `${Math.round(x * 100)}%`);

function band(x: number): { label: string; color: string } {
  if (x >= 0.6) return { label: 'Strong', color: 'var(--rec-green)' };
  if (x >= 0.35) return { label: 'Partial', color: 'var(--warn-amber)' };
  return { label: 'Weak', color: 'var(--danger-red)' };
}

const Bar: React.FC<{ value: number | null; height?: number }> = ({ value, height = 6 }) => (
  <div
    style={{
      height,
      borderRadius: height,
      background: 'var(--bg-secondary)',
      overflow: 'hidden',
      flex: 1,
      minWidth: 40,
    }}
  >
    {value !== null && (
      <div style={{ width: `${Math.max(2, value * 100)}%`, height: '100%', background: band(value).color, transition: 'width .25s ease' }} />
    )}
  </div>
);

const Chips: React.FC<{ items: string[]; tone: 'green' | 'moon' | 'blue' }> = ({ items, tone }) =>
  items.length ? (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {items.map((t) => (
        <span key={t} className={`tt-badge ${tone}`} style={{ fontSize: 11 }}>
          {t}
        </span>
      ))}
    </div>
  ) : (
    <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>none</span>
  );

export const EarthAnalogView: React.FC<EarthAnalogViewProps> = ({ onOpenOnMoon }) => {
  const [body, setBody] = useState<Body>('moon');
  const [targetId, setTargetId] = useState<string>('jezero');
  const [weights, setWeights] = useState<Weights>(DEFAULT_WEIGHTS);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { climate, loading: climateLoading } = useEarthClimate();

  const targets = useMemo(() => TARGETS.filter((t) => t.body === body), [body]);
  const target = targets.find((t) => t.id === targetId) ?? targets[0];
  const ranked = useMemo(() => rankAnalogs(target, weights), [target, weights]);
  const perDim = useMemo(() => bestPerDimension(target, weights), [target, weights]);
  const limits = useMemo(() => earthLimits(target.body), [target.body]);
  const selected: AnalogMatch = ranked.find((m) => m.analog.id === selectedId) ?? ranked[0];

  const switchBody = (b: Body) => {
    setBody(b);
    const first = TARGETS.find((t) => t.body === b);
    if (first) setTargetId(first.id);
    setSelectedId(null);
  };

  const setW = (k: keyof Weights, v: number) => setWeights((w) => ({ ...w, [k]: v }));

  return (
    <div className="tt-home-scroll" style={{ padding: '24px 28px 40px' }}>
      <div style={{ maxWidth: 1240, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 18 }}>
        {/* Header */}
        <div className="tt-card" style={{ padding: 22 }}>
          <span className="tt-badge moon" style={{ marginBottom: 10 }}>
            Earth ⇄ {body === 'moon' ? 'Moon' : 'Moon'}
          </span>
          <h1 style={{ margin: '6px 0 6px', fontSize: 24, fontWeight: 700 }}>Earth Analog Finder</h1>
          <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 14, lineHeight: 1.55, maxWidth: 880 }}>
            Pick a place on Moon or the Moon. Every Earth analog is compared on four separate dimensions, because a site can be an
            excellent geological analog and a poor temperature analog at the same time. Each result shows what is similar, how similar,
            what is different — and what no place on Earth can reproduce.
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
            <span className="tt-badge blue" title="Shared tags divided by all tags (Jaccard index)">
              Landforms, minerals, habitability: Jaccard similarity of literature tags
            </span>
            <span className="tt-badge" title="0–1 levels are ordinal judgements, not measurements">
              Environment: 0–1 ordinal levels — assumption, not measured
            </span>
            <span className="tt-badge">Screening aid, not a physical equivalence</span>
          </div>
        </div>

        {/* Target picker + weights */}
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(260px, 1fr)', gap: 18 }}>
          <div className="tt-card" style={{ padding: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
              <div className="tt-section-eyebrow" style={{ margin: 0 }}>
                1 · Choose the target
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {(['moon', 'moon'] as Body[]).map((b) => (
                  <button
                    key={b}
                    type="button"
                    className={b === body ? 'tt-btn-primary' : 'tt-btn-secondary'}
                    style={{ padding: '6px 14px' }}
                    onClick={() => switchBody(b)}
                  >
                    {b === 'moon' ? 'Moon' : 'Moon'}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: 10 }}>
              {targets.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className="tt-card-interactive"
                  onClick={() => {
                    setTargetId(t.id);
                    setSelectedId(null);
                  }}
                  style={{
                    textAlign: 'left',
                    padding: 12,
                    borderColor: t.id === target.id ? 'var(--moon-accent)' : undefined,
                    boxShadow: t.id === target.id ? '0 0 0 2px var(--moon-accent-soft)' : undefined,
                  }}
                >
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}>
                    <strong style={{ fontSize: 13.5 }}>{t.name}</strong>
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', marginBottom: 6 }}>
                    {t.mission ?? 'Orbital observations'} · <span className="tt-mono">{formatLatLonShort(t.lat, t.lon)}</span>
                  </div>
                  {t.status === 'hypothesis' && (
                    <span className="tt-badge" style={{ fontSize: 10.5, background: 'var(--warn-amber-soft)', color: 'var(--warn-amber)' }}>
                      Interpretation debated
                    </span>
                  )}
                </button>
              ))}
            </div>
            <p style={{ margin: '12px 0 0', fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              <strong style={{ color: 'var(--text-primary)' }}>{target.name}:</strong> {target.summary}
              {target.body === 'moon' && (
                <button
                  type="button"
                  className="tt-btn-secondary"
                  style={{ marginLeft: 10, padding: '3px 10px', fontSize: 12 }}
                  onClick={() => onOpenOnMoon({ lat: target.lat, lon: target.lon })}
                >
                  View in 3D Moon
                </button>
              )}
            </p>
          </div>

          <div className="tt-card" style={{ padding: 18 }}>
            <div className="tt-section-eyebrow" style={{ marginTop: 0 }}>
              2 · What matters to you
            </div>
            {(
              [
                ['geology', 'Geology (landforms + minerals)'],
                ['environment', 'Environment (dry, cold, ice, UV)'],
                ['habitability', 'Habitability context'],
              ] as [keyof Weights, string][]
            ).map(([k, label]) => (
              <label key={k} style={{ display: 'block', marginBottom: 12, fontSize: 12.5 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span>{label}</span>
                  <span className="tt-mono">{weights[k].toFixed(2)}</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={weights[k]}
                  onChange={(e) => setW(k, Number(e.target.value))}
                  style={{ width: '100%', accentColor: 'var(--moon-accent)' }}
                />
              </label>
            ))}
            <button type="button" className="tt-btn-secondary" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => setWeights(DEFAULT_WEIGHTS)}>
              Reset weights
            </button>
          </div>
        </div>

        {/* Best per dimension */}
        <div className="tt-card" style={{ padding: 18 }}>
          <div className="tt-section-eyebrow" style={{ marginTop: 0 }}>
            No analog matches everything — best Earth site per dimension
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
            {perDim.map((p) => (
              <button
                key={p.label}
                type="button"
                className="tt-card-interactive"
                style={{ textAlign: 'left', padding: 12 }}
                onClick={() => setSelectedId(p.match.analog.id)}
              >
                <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '.04em' }}>{p.label}</div>
                <div style={{ fontWeight: 650, fontSize: 13.5, margin: '4px 0 6px' }}>{p.match.analog.name}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Bar value={p.score} />
                  <span className="tt-mono" style={{ fontSize: 12 }}>
                    {pct(p.score)}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Ranking + detail */}
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 1fr) minmax(0, 1.6fr)', gap: 18, alignItems: 'start' }}>
          <div className="tt-card" style={{ padding: 14 }}>
            <div className="tt-section-eyebrow" style={{ margin: '4px 4px 10px' }}>
              3 · Ranked Earth analogs
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {ranked.map((m, i) => {
                const on = m.analog.id === selected.analog.id;
                return (
                  <button
                    key={m.analog.id}
                    type="button"
                    onClick={() => setSelectedId(m.analog.id)}
                    style={{
                      textAlign: 'left',
                      border: `1px solid ${on ? 'var(--moon-accent)' : 'var(--border-subtle)'}`,
                      background: on ? 'var(--moon-accent-soft)' : 'var(--bg-primary)',
                      borderRadius: 10,
                      padding: '9px 11px',
                      cursor: 'pointer',
                      font: 'inherit',
                      color: 'inherit',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span className="tt-mono" style={{ width: 20, color: 'var(--text-muted)', fontSize: 12 }}>
                        {i + 1}
                      </span>
                      <strong style={{ fontSize: 13, flex: 1, minWidth: 0 }}>{m.analog.name}</strong>
                      <span className="tt-mono" style={{ fontSize: 12.5, fontWeight: 600 }}>
                        {pct(m.overall)}
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '6px 0 0 28px' }}>
                      <Bar value={m.overall} height={5} />
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)', margin: '5px 0 0 28px' }}>
                      {m.analog.country} · best: {m.strongest} · weakest: {m.weakest}
                      {m.analog.status === 'hypothesis' ? ' · proposed analog' : ''}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div className="tt-card" style={{ padding: 20 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                    {target.name} ⇄ Earth analog
                  </div>
                  <h2 style={{ margin: '4px 0 2px', fontSize: 20 }}>{selected.analog.name}</h2>
                  <div style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>
                    {selected.analog.country} · <span className="tt-mono">{formatLatLonShort(selected.analog.lat, selected.analog.lon)}</span>
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div className="tt-mono" style={{ fontSize: 28, fontWeight: 700, color: band(selected.overall).color }}>
                    {pct(selected.overall)}
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>{band(selected.overall).label} overall similarity</div>
                </div>
              </div>
              <p style={{ fontSize: 13.5, lineHeight: 1.55, margin: '12px 0 6px' }}>{selected.analog.summary}</p>
              <p style={{ fontSize: 12.5, color: 'var(--text-secondary)', margin: '0 0 12px' }}>
                <strong>Used for:</strong> {selected.analog.usedFor}
              </p>
              {selected.analog.status === 'hypothesis' && (
                <p
                  style={{
                    fontSize: 12.5,
                    margin: '0 0 12px',
                    padding: '8px 10px',
                    borderRadius: 8,
                    background: 'var(--warn-amber-soft)',
                    color: 'var(--warn-amber)',
                  }}
                >
                  Proposed analog: it depends on an interpretation that is still debated. Treat the similarity as a hypothesis to test.
                </p>
              )}
              <div
                style={{
                  margin: '0 0 12px',
                  padding: '10px 12px',
                  borderRadius: 10,
                  background: 'var(--sci-blue-soft)',
                  fontSize: 12.5,
                  lineHeight: 1.5,
                }}
              >
                <div style={{ fontWeight: 650, color: 'var(--sci-blue)', marginBottom: 2 }}>
                  Measured on Earth · NASA POWER{climate?.period ? ` (${climate.period} mean)` : ''}
                </div>
                {(() => {
                  const line = climateLine(climate?.sites[selected.analog.id]?.values);
                  if (line) return <div>{line}</div>;
                  if (climateLoading) return <div style={{ color: 'var(--text-secondary)' }}>Loading NASA POWER climatology…</div>;
                  return (
                    <div style={{ color: 'var(--text-secondary)' }}>
                      NASA POWER could not be reached; start the TerraTwin server online once and the values are cached.
                    </div>
                  );
                })()}
                {target.body === 'moon' && (
                  <div style={{ color: 'var(--text-secondary)', marginTop: 2 }}>
                    Moon for comparison: about {MOON_CLIMATE_REFERENCE.meanTempC} °C global mean, no rain (
                    <a href={MOON_CLIMATE_REFERENCE.url} target="_blank" rel="noreferrer" style={{ color: 'inherit' }}>
                      {MOON_CLIMATE_REFERENCE.source}
                    </a>
                    ).
                  </div>
                )}
              </div>
              <button
                type="button"
                className="tt-btn-primary"
                style={{ padding: '7px 14px' }}
                onClick={() => showOnEarth(selected.analog.lat, selected.analog.lon, selected.analog.name)}
              >
                Show on the Earth map
              </button>
            </div>

            <div className="tt-card" style={{ padding: 20 }}>
              <div className="tt-section-eyebrow" style={{ marginTop: 0 }}>
                What is similar, how similar, what is different
              </div>
              {selected.dims.map((d) => (
                <div key={d.key} style={{ padding: '10px 0', borderTop: '1px solid var(--border-subtle)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                    <strong style={{ width: 170, fontSize: 13 }}>{d.label}</strong>
                    <Bar value={d.score} />
                    <span className="tt-mono" style={{ width: 46, textAlign: 'right', fontSize: 12.5 }}>
                      {pct(d.score)}
                    </span>
                  </div>
                  {d.key === 'environment' ? (
                    <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ color: 'var(--text-secondary)', textAlign: 'left' }}>
                          <th style={{ fontWeight: 500, padding: '3px 0' }}>Level (0–1, assumption)</th>
                          <th style={{ fontWeight: 500 }}>{target.body === 'moon' ? 'Moon' : 'Moon'}</th>
                          <th style={{ fontWeight: 500 }}>Earth site</th>
                          <th style={{ fontWeight: 500 }}>Similarity</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selected.env.map((e) => (
                          <tr key={e.key}>
                            <td style={{ padding: '3px 0' }}>{e.label}</td>
                            <td className="tt-mono">{e.target.toFixed(2)}</td>
                            <td className="tt-mono">{e.earth.toFixed(2)}</td>
                            <td className="tt-mono" style={{ color: band(e.similarity).color }}>
                              {pct(e.similarity)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : d.score === null ? (
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Nothing recorded on either side — not counted.</div>
                  ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10, fontSize: 12 }}>
                      <div>
                        <div style={{ color: 'var(--text-secondary)', marginBottom: 4 }}>Shared</div>
                        <Chips items={d.shared} tone="green" />
                      </div>
                      <div>
                        <div style={{ color: 'var(--text-secondary)', marginBottom: 4 }}>Only on {target.body === 'moon' ? 'Moon' : 'the Moon'}</div>
                        <Chips items={d.onlyTarget} tone="moon" />
                      </div>
                      <div>
                        <div style={{ color: 'var(--text-secondary)', marginBottom: 4 }}>Only on Earth</div>
                        <Chips items={d.onlyEarth} tone="blue" />
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="tt-card" style={{ padding: 20 }}>
              <div className="tt-section-eyebrow" style={{ marginTop: 0 }}>
                What no place on Earth can reproduce
              </div>
              <table style={{ width: '100%', fontSize: 12.5, borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ color: 'var(--text-secondary)', textAlign: 'left' }}>
                    <th style={{ fontWeight: 500, padding: '4px 6px 4px 0' }}>Quantity</th>
                    <th style={{ fontWeight: 500, padding: '4px 6px' }}>Earth</th>
                    <th style={{ fontWeight: 500, padding: '4px 6px' }}>{target.body === 'moon' ? 'Moon' : 'Moon'}</th>
                    <th style={{ fontWeight: 500, padding: '4px 6px' }}>Ratio</th>
                  </tr>
                </thead>
                <tbody>
                  {limits.map((l) => (
                    <React.Fragment key={l.quantity}>
                      <tr style={{ borderTop: '1px solid var(--border-subtle)' }}>
                        <td style={{ padding: '7px 6px 2px 0', fontWeight: 600 }}>{l.quantity}</td>
                        <td style={{ padding: '7px 6px 2px' }}>{l.earth}</td>
                        <td style={{ padding: '7px 6px 2px' }}>{l.other}</td>
                        <td className="tt-mono" style={{ padding: '7px 6px 2px' }}>
                          {l.ratio}
                        </td>
                      </tr>
                      <tr>
                        <td colSpan={4} style={{ padding: '0 0 7px', color: 'var(--text-secondary)', fontSize: 12 }}>
                          {l.consequence} <span style={{ color: 'var(--text-muted)' }}>Source: {l.source}</span>
                        </td>
                      </tr>
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="tt-card" style={{ padding: 16, fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              <strong style={{ color: 'var(--text-primary)' }}>References</strong> — {target.name}: {target.refs.join('; ')}. {selected.analog.name}:{' '}
              {selected.analog.refs.join('; ')}. Tags summarise these publications; environmental levels are judgements for comparison only.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
