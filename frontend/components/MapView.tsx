"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { API } from "@/lib/api";
import { fnum, ramp, signed, KIND_LABEL } from "@/lib/format";
import type { Analysis, AreaResult, Loc } from "@/lib/types";

/* Basemaps — open data, open source, no API key.
   Vector styles come from OpenFreeMap (OpenStreetMap data, OpenMapTiles schema, rendered by
   MapLibre GL JS). Satellite is ESA Copernicus Sentinel-2 imagery mosaicked by EOX. */
type Basemap = "osm" | "light" | "streets" | "satellite" | "dark";
type BasemapDef =
  | { label: string; kind: "vector"; style: string; dim: boolean }
  | { label: string; kind: "raster"; tiles: string[]; attribution: string; maxzoom: number; dim: boolean };

const OSM_ATTR = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const BASEMAPS: Record<Basemap, BasemapDef> = {
  osm: { label: "Standard", kind: "raster", maxzoom: 19, dim: false, tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], attribution: OSM_ATTR },
  light: { label: "Light", kind: "vector", style: "https://tiles.openfreemap.org/styles/positron", dim: false },
  streets: { label: "Streets", kind: "vector", style: "https://tiles.openfreemap.org/styles/liberty", dim: false },
  satellite: {
    label: "Satellite", kind: "raster", maxzoom: 14, dim: false,
    tiles: ["https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/{z}/{y}/{x}.jpg"],
    attribution: 'Sentinel-2 cloudless 2024 — <a href="https://s2maps.eu">s2maps.eu</a> by <a href="https://eox.at">EOX IT Services GmbH</a> (contains modified Copernicus Sentinel data 2024)',
  },
  dark: { label: "Dark", kind: "vector", style: "https://tiles.openfreemap.org/styles/dark", dim: false },
};
// OpenStreetMap's own tile server: the most widely reachable open basemap, used when another one fails.
const FALLBACK_BASEMAP: Basemap = "osm";
const OWN_SOURCES = new Set(["countries", "points", "selection"]);

const rasterStyle = (b: Extract<BasemapDef, { kind: "raster" }>) => ({
  version: 8 as const,
  sources: { basemap: { type: "raster" as const, tiles: b.tiles, tileSize: 256, maxzoom: b.maxzoom, attribution: b.attribution } },
  layers: [
    { id: "bg", type: "background" as const, paint: { "background-color": "#d4dadf" } },
    { id: "basemap", type: "raster" as const, source: "basemap" },
  ],
});
const styleFor = (k: Basemap) => {
  const b = BASEMAPS[k];
  return b.kind === "vector" ? b.style : (rasterStyle(b) as unknown as maplibregl.StyleSpecification);
};

interface Props {
  analysis: Analysis | null;
  highlight: string[];
  fit: { iso3: string[]; n: number } | null;
  selected: string | null;
  onSelect: (iso3: string | null) => void;
  selection: number[] | null;
  onSelection: (bbox: number[] | null) => void;
  area: AreaResult | null;
}

interface CountryProps { iso3: string; name: string; name_long: string; label_x: number; label_y: number; bbox: number[] }

function metricValue(l: Loc, metric: string): number | null {
  if (metric === "score") return l.rank ? l.score : null;
  const n = l.values[metric]?.norm;
  return n === null || n === undefined ? null : n * 100;
}

export default function MapView({ analysis, highlight, fit, selected, onSelect, selection, onSelection, area }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const countries = useRef<Map<string, CountryProps>>(new Map());
  const fcRef = useRef<GeoJSON.FeatureCollection | null>(null);
  const markers = useRef<maplibregl.Marker[]>([]);
  const handlersBound = useRef(false);
  const tiles = useRef({ ok: 0, timer: 0 as unknown as ReturnType<typeof setTimeout> });
  const noticeTimer = useRef<ReturnType<typeof setTimeout>>();
  const basemapRef = useRef<Basemap>("osm");
  const showNotice = useCallback((text: string, ms = 8000) => {
    clearTimeout(noticeTimer.current);
    setNotice(text);
    if (ms) noticeTimer.current = setTimeout(() => setNotice(null), ms);
  }, []);
  const [ready, setReady] = useState(false);
  const [styleEpoch, setStyleEpoch] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [basemap, setBasemap] = useState<Basemap>("osm");
  const [dim, setDim] = useState(false);
  const [metric, setMetric] = useState("score");
  const [layers, setLayers] = useState({ fill: true, borders: true, labels: true, points: true });
  const [hover, setHover] = useState<{ x: number; y: number; iso3: string } | null>(null);
  const [box, setBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const onSelectRef = useRef(onSelect);
  const onSelectionRef = useRef(onSelection);
  onSelectRef.current = onSelect;
  onSelectionRef.current = onSelection;

  const metricVar = analysis?.variables.find((v) => v.id === metric) || null;
  useEffect(() => {
    if (metric !== "score" && !analysis?.variables.some((v) => v.id === metric)) setMetric("score");
  }, [analysis, metric]);

  /* Adds the analysis layers on top of whichever basemap style is loaded. Safe to call repeatedly. */
  const ensureDataLayers = useCallback(() => {
    const map = mapRef.current;
    if (!map || !fcRef.current || !map.isStyleLoaded() || map.getSource("countries")) return;
    const v = ["coalesce", ["feature-state", "v"], -1];
    const isIn = ["boolean", ["feature-state", "in"], false];
    const isHl = ["boolean", ["feature-state", "hl"], false];
    const isSel = ["boolean", ["feature-state", "sel"], false];
    map.addLayer({ id: "dim", type: "background", paint: { "background-color": "#070a0d", "background-opacity": 0.55 }, layout: { visibility: "none" } });
    map.addSource("countries", { type: "geojson", data: fcRef.current, promoteId: "iso3", attribution: (fcRef.current as never as { attribution: string }).attribution });
    map.addLayer({
      id: "c-fill", type: "fill", source: "countries",
      paint: {
        "fill-color": ["case", [">=", v, 0], ["interpolate", ["linear"], v, 0, "rgb(190,78,62)", 50, "rgb(216,178,74)", 100, "rgb(62,158,98)"], isIn, "#6b7683", "#ffffff"] as never,
        "fill-opacity": ["case", isSel, 0.78, isHl, 0.7, [">=", v, 0], 0.5, isIn, 0.28, 0.01] as never,
      },
    });
    map.addLayer({ id: "c-line", type: "line", source: "countries", paint: { "line-color": "rgba(255,255,255,0.28)", "line-width": 0.6, "line-dasharray": [2, 2] } });
    map.addLayer({
      id: "c-hl", type: "line", source: "countries",
      paint: { "line-color": ["case", isSel, "#ffffff", isHl, "#dfeee4", "rgba(0,0,0,0)"] as never, "line-width": ["case", isSel, 2, isHl, 1.4, 0] as never },
    });
    map.addSource("points", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    map.addLayer({
      id: "points", type: "circle", source: "points",
      paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 2, 3, 6, 6] as never, "circle-color": ["get", "c"] as never, "circle-stroke-color": "rgba(10,13,16,0.9)", "circle-stroke-width": 1 },
    });
    map.addSource("selection", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    map.addLayer({ id: "selection-fill", type: "fill", source: "selection", paint: { "fill-color": "#8fd3c1", "fill-opacity": 0.08 } });
    map.addLayer({ id: "selection-line", type: "line", source: "selection", paint: { "line-color": "#8fd3c1", "line-width": 1.5, "line-dasharray": [3, 2] } });

    if (!handlersBound.current) {
      handlersBound.current = true;
      map.on("mousemove", "c-fill", (e) => {
        const f = e.features?.[0];
        if (f) setHover({ x: e.point.x, y: e.point.y, iso3: String(f.id) });
      });
      map.on("mouseleave", "c-fill", () => setHover(null));
      map.on("click", (e) => {
        if (e.originalEvent.shiftKey) return;
        const f = map.queryRenderedFeatures(e.point, { layers: ["c-fill"] })[0];
        onSelectRef.current(f ? String(f.id) : null);
      });
    }
    setReady(true);
    setStyleEpoch((n) => n + 1);
  }, []);

  // ------------------------------------------------------------ map setup
  useEffect(() => {
    if (!el.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: el.current, style: styleFor("osm"),
      center: [18, 8], zoom: 1.7, minZoom: 1, maxZoom: 12, attributionControl: false, renderWorldCopies: true,
    });
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 110 }), "bottom-right");
    map.boxZoom.disable();
    map.dragRotate.disable();
    map.touchZoomRotate.disableRotation();
    mapRef.current = map;

    // Switching basemap replaces the whole style, so the analysis layers are re-added here.
    map.on("styledata", ensureDataLayers);
    map.on("sourcedata", (e) => { if (e.tile && !OWN_SOURCES.has(e.sourceId)) tiles.current.ok++; });
    watchRef.current("osm");

    (async () => {
      try {
        const r = await fetch(`${API}/api/geo/countries`);
        const fc = await r.json();
        if (!r.ok) throw new Error(fc?.error || `HTTP ${r.status}`);
        for (const f of fc.features) countries.current.set(f.properties.iso3, f.properties);
        fcRef.current = fc;
        ensureDataLayers();
      } catch (err) {
        setError(`Could not load country boundaries from ${API}. Is the backend running? (${(err as Error).message})`);
      }
    })();

    // Shift + drag draws an analysis box.
    const container = map.getCanvasContainer();
    let start: { x: number; y: number } | null = null;
    const pos = (ev: MouseEvent) => {
      const r = container.getBoundingClientRect();
      return { x: ev.clientX - r.left, y: ev.clientY - r.top };
    };
    const move = (ev: MouseEvent) => {
      if (!start) return;
      const p = pos(ev);
      setBox({ x: Math.min(start.x, p.x), y: Math.min(start.y, p.y), w: Math.abs(p.x - start.x), h: Math.abs(p.y - start.y) });
    };
    const up = (ev: MouseEvent) => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
      map.dragPan.enable();
      const s = start;
      start = null;
      setBox(null);
      if (!s) return;
      const p = pos(ev);
      if (Math.abs(p.x - s.x) < 8 || Math.abs(p.y - s.y) < 8) return;
      const a = map.unproject([Math.min(s.x, p.x), Math.max(s.y, p.y)]);
      const b = map.unproject([Math.max(s.x, p.x), Math.min(s.y, p.y)]);
      onSelectionRef.current([a.lng, a.lat, b.lng, b.lat].map((n) => Math.round(n * 100) / 100));
    };
    const down = (ev: MouseEvent) => {
      if (!ev.shiftKey || ev.button !== 0) return;
      ev.preventDefault();
      map.dragPan.disable();
      start = pos(ev);
      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", up);
    };
    container.addEventListener("mousedown", down, true);

    const ro = new ResizeObserver(() => map.resize());
    ro.observe(el.current);
    return () => {
      ro.disconnect();
      container.removeEventListener("mousedown", down, true);
      map.remove();
      mapRef.current = null;
    };
  }, [ensureDataLayers]);

  /* A vector style that cannot be reached would leave a blank map, so it is probed first; and if a
     basemap delivers no tiles within a few seconds the fallback is shown instead. */
  const switchBasemap = useCallback(async (k: Basemap): Promise<void> => {
    const map = mapRef.current;
    const b = BASEMAPS[k];
    if (!map) return;
    if (b.kind === "vector") {
      try {
        const r = await fetch(b.style, { cache: "force-cache" });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
      } catch (err) {
        showNotice(`The “${b.label}” basemap (OpenFreeMap) could not be reached, so ${BASEMAPS[FALLBACK_BASEMAP].label} is shown instead. ${(err as Error).message}`);
        if (k !== FALLBACK_BASEMAP) return switchBasemap(FALLBACK_BASEMAP);
        return;
      }
    }
    basemapRef.current = k;
    setBasemap(k);
    setDim(b.dim);
    map.setStyle(styleFor(k));   // styledata → ensureDataLayers
    watchRef.current(k);
  }, [showNotice]);

  const watchRef = useRef<(k: Basemap) => void>(() => {});
  watchRef.current = (k: Basemap) => {
    tiles.current.ok = 0;
    clearTimeout(tiles.current.timer);
    tiles.current.timer = setTimeout(() => {
      if (tiles.current.ok > 0 || basemapRef.current !== k) return;
      if (k !== FALLBACK_BASEMAP) {
        showNotice(`The “${BASEMAPS[k].label}” basemap delivered no tiles, so ${BASEMAPS[FALLBACK_BASEMAP].label} is shown instead.`);
        void switchBasemap(FALLBACK_BASEMAP);
      } else {
        showNotice("Map tiles could not be loaded. Check the internet connection, or whether a firewall or ad blocker is blocking tile.openstreetmap.org.", 0);
      }
    }, 7000);
  };

  // ------------------------------------------------------------ data → map
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !map.getSource("countries")) return;
    map.removeFeatureState({ source: "countries" });
    analysis?.locations.forEach((l) => {
      const v = metricValue(l, metric);
      map.setFeatureState({ source: "countries", id: l.iso3 }, { v: v === null ? -1 : v, in: true });
    });
    highlight.forEach((iso) => map.setFeatureState({ source: "countries", id: iso }, { hl: true }));
    if (selected) map.setFeatureState({ source: "countries", id: selected }, { sel: true });
  }, [analysis, metric, highlight, selected, ready, styleEpoch]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !map.getLayer("c-fill")) return;
    const vis = (id: string, on: boolean) => map.getLayer(id) && map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
    vis("dim", dim);
    vis("c-fill", layers.fill);
    vis("c-line", layers.borders);
    vis("points", layers.points);
    const onLight = !dim && basemap !== "dark";
    map.setPaintProperty("c-line", "line-color", onLight ? "rgba(20,30,40,0.55)" : "rgba(255,255,255,0.28)");
  }, [basemap, dim, layers, ready, styleEpoch]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !map.getSource("points")) return;
    const feats: GeoJSON.Feature[] = [];
    const add = (lat: number, lon: number, c: string) =>
      feats.push({ type: "Feature", properties: { c }, geometry: { type: "Point", coordinates: [lon, lat] } });
    if (analysis && metricVar?.range && metricVar.connector === "nasa_power") {
      const [lo, hi] = metricVar.range;
      for (const p of analysis.points) {
        const x = p.values[metric];
        if (x === undefined) continue;
        let n = hi === lo ? 0.5 : Math.max(0, Math.min(1, (x - lo) / (hi - lo)));
        if (metricVar.direction === "lower") n = 1 - n;
        if (metricVar.direction === "target" && metricVar.target) {
          const [a, b] = metricVar.target;
          const w = b - a || 1;
          n = x >= a && x <= b ? 1 : Math.max(0, 1 - (x < a ? a - x : x - b) / w);
        }
        add(p.lat, p.lon, ramp(n * 100));
      }
    } else if (analysis && metric === "score") {
      for (const p of analysis.points) add(p.lat, p.lon, "rgba(235,240,245,0.75)");
    }
    area?.points.forEach((p) => add(p.lat, p.lon, "#8fd3c1"));
    (map.getSource("points") as maplibregl.GeoJSONSource).setData({ type: "FeatureCollection", features: feats });
  }, [analysis, metric, metricVar, area, ready, styleEpoch]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !map.getSource("selection")) return;
    const features: GeoJSON.Feature[] = [];
    if (selection) {
      const [x0, y0, x1, y1] = selection;
      features.push({ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]] } });
    }
    (map.getSource("selection") as maplibregl.GeoJSONSource).setData({ type: "FeatureCollection", features });
  }, [selection, ready, styleEpoch]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !fit || fit.iso3.length === 0) return;
    let x0 = 180, y0 = 90, x1 = -180, y1 = -90;
    for (const iso of fit.iso3) {
      const p = countries.current.get(iso);
      if (!p) continue;
      const b = p.bbox;
      x0 = Math.min(x0, b[0]); y0 = Math.min(y0, b[1]); x1 = Math.max(x1, b[2]); y1 = Math.max(y1, b[3]);
    }
    if (x0 > x1) return;
    map.fitBounds([[x0, Math.max(y0, -75)], [x1, Math.min(y1, 82)]], { padding: 70, duration: 900, maxZoom: 6 });
  }, [fit, ready]);

  // Floating labels: the compared locations, or the five leaders.
  const labelled = useMemo(() => {
    if (!analysis) return [] as Loc[];
    const by = new Map(analysis.locations.map((l) => [l.iso3, l]));
    if (highlight.length >= 2) return highlight.map((i) => by.get(i)).filter(Boolean) as Loc[];
    const top = analysis.locations.filter((l) => l.rank).slice(0, 5);
    const sel = selected ? by.get(selected) : null;
    return sel && !top.includes(sel) ? [...top, sel] : top;
  }, [analysis, highlight, selected]);

  useEffect(() => {
    const map = mapRef.current;
    markers.current.forEach((m) => m.remove());
    markers.current = [];
    if (!map || !ready || !layers.labels) return;
    for (const l of labelled) {
      const p = countries.current.get(l.iso3);
      if (!p) continue;
      const v = metricValue(l, metric);
      const node = document.createElement("button");
      node.className = "map-pill" + (l.iso3 === selected ? " is-selected" : "");
      node.style.background = ramp(v, 0.96);
      const val = metric === "score" ? (l.score === null ? "n/a" : l.score.toFixed(0)) : fnum(l.values[metric]?.value ?? null);
      node.innerHTML = `${l.rank ? `<span class="map-pill-rank">${l.rank}</span>` : ""}<span>${p.name}</span><b>${val}</b>`;
      node.onclick = (ev) => { ev.stopPropagation(); onSelectRef.current(l.iso3); };
      markers.current.push(new maplibregl.Marker({ element: node, anchor: "center" }).setLngLat([p.label_x, p.label_y]).addTo(map));
    }
  }, [labelled, metric, selected, layers.labels, ready]);

  const toggle = useCallback((k: keyof typeof layers) => setLayers((s) => ({ ...s, [k]: !s[k] })), []);

  // ------------------------------------------------------------ overlays
  const hoverLoc = hover && analysis ? analysis.locations.find((l) => l.iso3 === hover.iso3) : null;
  const hoverName = hover ? countries.current.get(hover.iso3)?.name_long || hover.iso3 : "";
  const tipVars = analysis ? [...analysis.variables].sort((a, b) => b.weight - a.weight).slice(0, 4) : [];

  return (
    <div className="map-wrap">
      <div ref={el} className="map-canvas" />
      {box && <div className="map-box" style={{ left: box.x, top: box.y, width: box.w, height: box.h }} />}
      {error && <div className="map-error">{error}</div>}
      {notice && <div className="fatal">{notice}</div>}

      <div className="map-controls">
        <div className="seg" role="group" aria-label="Base map">
          {(Object.keys(BASEMAPS) as Basemap[]).map((b) => (
            <button key={b} className={b === basemap ? "on" : ""} onClick={() => void switchBasemap(b)}
              title={BASEMAPS[b].kind === "vector" ? "OpenStreetMap vector tiles (OpenFreeMap)" : BASEMAPS[b].attribution.replace(/<[^>]+>/g, "")}>
              {BASEMAPS[b].label}
            </button>
          ))}
        </div>
        <div className="layer-card">
          <div className="eyebrow">Layers</div>
          {([["fill", "Opportunity zones"], ["borders", "Borders"], ["labels", "Floating labels"], ["points", "Sample points"]] as const).map(([k, label]) => (
            <label key={k} className="check"><input type="checkbox" checked={layers[k]} onChange={() => toggle(k)} /><span>{label}</span></label>
          ))}
          <label className="check"><input type="checkbox" checked={dim} onChange={() => setDim((d) => !d)} /><span>Dim basemap</span></label>
          {analysis && (
            <>
              <div className="eyebrow" style={{ marginTop: 10 }}>Colour by</div>
              <select value={metric} onChange={(e) => setMetric(e.target.value)}>
                <option value="score">Overall score</option>
                {analysis.variables.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
              </select>
            </>
          )}
        </div>
      </div>

      <div className="map-legend">
        {analysis ? (
          <>
            <div className="legend-title">{metric === "score" ? "Overall opportunity score" : metricVar?.label}</div>
            <div className="legend-sub">
              {analysis.title} · {analysis.scope_label}
              {metricVar ? ` · ${metricVar.direction === "lower" ? "lower is better" : metricVar.direction === "target" ? `target ${metricVar.target?.[0]}–${metricVar.target?.[1]}` : "higher is better"}` : ""}
            </div>
            <div className="legend-ramp" />
            <div className="legend-ticks"><span>Low</span><span>Medium</span><span>High</span></div>
            <div className="legend-note">
              <i className="swatch" /> In scope, no data or not ranked · relative to the {analysis.locations.length} analysed locations
            </div>
          </>
        ) : (
          <>
            <div className="legend-title">No analysis yet</div>
            <div className="legend-sub">Ask the agent a question to colour the map.</div>
          </>
        )}
        <div className="legend-hint">Shift + drag to select an area</div>
      </div>

      {hover && (
        <div className="map-tip" style={{ left: hover.x + 14, top: hover.y + 14 }}>
          <div className="tip-name">{hoverName}</div>
          {hoverLoc ? (
            <>
              <div className="tip-score">
                {hoverLoc.rank ? <>#{hoverLoc.rank} · score <b>{hoverLoc.score}</b></> : "Not ranked — too little data"}
                <span> · confidence {Math.round(hoverLoc.confidence * 100)}%</span>
              </div>
              {tipVars.map((v) => {
                const c = hoverLoc.values[v.id];
                return (
                  <div className="tip-row" key={v.id}>
                    <span>{v.label}{v.kind === "proxy" ? ` (${KIND_LABEL.proxy.toLowerCase()})` : ""}</span>
                    <span>
                      {c?.value === null || c?.value === undefined ? "no data" : `${fnum(c.value)}`}
                      {c?.diff_pct !== null && c?.diff_pct !== undefined ? <em>{signed(c.diff_pct)}%</em> : null}
                    </span>
                  </div>
                );
              })}
              <div className="tip-foot">% vs {analysis?.benchmark.label}. Click for all values.</div>
            </>
          ) : analysis ? <div className="tip-foot">Outside the current analysis scope</div> : null}
        </div>
      )}
    </div>
  );
}
