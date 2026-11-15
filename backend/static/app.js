/* Meridian — dependency-free web UI served by the backend. */
"use strict";

const API = "";
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const uid = () => Math.random().toString(36).slice(2, 10);

// ---------------------------------------------------------------- format
function fnum(x) {
  if (x === null || x === undefined || Number.isNaN(x)) return "—";
  const a = Math.abs(x);
  if (a >= 1000) return x.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (a >= 100) return x.toFixed(1);
  return String(Number(x.toFixed(2)));
}
const signed = (x, d = 1) => (x > 0 ? "+" : x < 0 ? "−" : "") + Math.abs(x).toFixed(d);
const STOPS = [[0, [190, 78, 62]], [50, [216, 178, 74]], [100, [62, 158, 98]]];
function ramp(v, alpha = 1) {
  if (v === null || v === undefined) return `rgba(120,130,140,${alpha})`;
  const x = Math.max(0, Math.min(100, v));
  const [a, b] = x <= 50 ? [STOPS[0], STOPS[1]] : [STOPS[1], STOPS[2]];
  const t = (x - a[0]) / (b[0] - a[0]);
  const c = a[1].map((p, i) => Math.round(p + (b[1][i] - p) * t));
  return `rgba(${c[0]},${c[1]},${c[2]},${alpha})`;
}
const KIND = { modelled: "Modelled", reported: "Reported", survey_index: "Survey index", proxy: "Proxy", predicted: "Predicted", estimated: "Estimated" };
const KIND_HELP = {
  modelled: "Satellite-derived or reanalysis model output, not a ground measurement.",
  reported: "Official statistic reported by a national or international agency.",
  survey_index: "Composite index built from surveys or expert perception.",
  proxy: "A real statistic standing in for a quantity that has no connected dataset.",
  predicted: "Machine-learning prediction from a global model.",
  estimated: "Calculated in this app from retrieved values with a stated formula. See the variable description.",
};
const CAT = { Environment: "#d9b24a", Climate: "#5fa8c9", Economics: "#b98ad0", Infrastructure: "#6fc3a8", Governance: "#8f9bb0", Soil: "#b08a5c", Land: "#93b86a", Water: "#4f8fd6", Agriculture: "#93b86a", Workforce: "#d08a8a", Connectivity: "#6fa0d8", Mining: "#c79a6b", Industry: "#a9a3d6", Energy: "#e0c268", Custom: "#9aa5b1" };
const SERIES = ["#8fd3c1", "#d9b24a", "#b98ad0", "#5fa8c9", "#d08a8a"];
const kindBadge = (v) => `<span class="kind ${v.kind}" title="${esc(v.proxy_note || KIND_HELP[v.kind])}">${KIND[v.kind]}</span>`;

// ---------------------------------------------------------------- state
const S = {
  session: uid(), health: null, offline: false, busy: false, working: false,
  messages: [], analysis: null, comparison: null, area: null,
  highlight: [], selected: null, selection: null, tab: "ranking", picked: [],
  metric: "score", basemap: "osm", dim: false, layers: { fill: true, borders: true, labels: true, points: true },
  weights: {}, settings: null, models: null, model: (() => { try { return localStorage.getItem('meridian.model') || null; } catch (e) { return null; } })(),
  dlg: { open: false, status: null, busy: false, custom: false },
};
const countries = new Map();
let map = null, mapReady = false, markers = [];

// ---------------------------------------------------------------- api
async function post(path, body) {
  const r = await fetch(API + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || `Request failed (${r.status})`);
  return data;
}
async function streamChat(body, onEvent) {
  const r = await fetch(API + "/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok || !r.body) throw new Error(`The analysis service returned ${r.status}`);
  const reader = r.body.getReader(), dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
      for (const line of chunk.split("\n")) if (line.startsWith("data: ")) { try { onEvent(JSON.parse(line.slice(6))); } catch (e) { /* ignore */ } }
    }
  }
}

// ---------------------------------------------------------------- chat panel
function inlineMd(t) {
  return esc(t).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/\*([^*]+)\*/g, "<em>$1</em>");
}
function rich(text) {
  let html = "", list = [];
  const flush = () => { if (list.length) html += "<ul>" + list.map((l) => `<li>${inlineMd(l)}</li>`).join("") + "</ul>"; list = []; };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (/^[-•]\s+/.test(line)) { list.push(line.replace(/^[-•]\s+/, "")); continue; }
    flush();
    if (line) html += `<p>${inlineMd(line)}</p>`;
  }
  flush();
  return `<div class="rich">${html}</div>`;
}
const SUGGESTIONS = [
  "Find the best regions in Africa for building solar farms.",
  "Find the best places in Africa to grow carrots.",
  "Compare Angola and Brazil for solar energy.",
  "Which South American countries have the best agricultural potential?",
];
function renderChat() {
  const el = $("#chat");
  if (!S.messages.length) {
    el.innerHTML = `<div class="agent-empty">
      <div class="hero"><div class="hero-mark"></div><h2>Where should it go?</h2>
      <p>Describe an activity. The agent decides which variables matter, pulls open data, scores every country and draws the result on the map, with sources and confidence for each number.</p></div>
      <button class="demo" data-act="demo"><span><b>Run the guided demo</b><small>Solar farms in Africa → compare the top two → prioritise low cost</small></span><i>▶</i></button>
      <div class="eyebrow sp">Or try one</div>${SUGGESTIONS.map((t) => `<button class="suggestion" data-s="${esc(t)}"><span>${esc(t)}</span><i>↗</i></button>`).join("")}
      <p class="fine"><kbd>Shift</kbd> + drag on the map to select an area, then ask “Analyze this region for solar energy production.”</p></div>`;
  } else {
    el.innerHTML = S.messages.map((m) => {
      if (m.role === "user") return `<div class="msg user"><div class="bubble">${esc(m.text)}</div>${m.selection ? `<div class="msg-meta">with selected area</div>` : ""}</div>`;
      let steps = "";
      if (m.pending) {
        steps = `<div class="steps">${m.steps.length ? m.steps.map((s, i) => `<div class="step${i === m.steps.length - 1 ? " live" : ""}"><i></i>${esc(s)}</div>`).join("") : `<div class="step live"><i></i>Understanding the request</div>`}</div>`;
      } else if (m.steps.length) {
        steps = m.open
          ? `<div class="steps"><button class="steps-toggle" data-t="${m.id}">Hide research steps ▾</button>${m.steps.map((s) => `<div class="step"><i></i>${esc(s)}</div>`).join("")}</div>`
          : `<button class="steps-toggle" data-t="${m.id}">${m.steps.length} research steps ▸</button>`;
      }
      return `<div class="msg agent${m.error ? " error" : ""}">${steps}${m.text ? rich(m.text) : ""}${m.model ? `<div class="msg-meta left">${esc(modelName(m.model))}</div>` : ""}</div>`;
    }).join("");
  }
  el.scrollTo({ top: el.scrollHeight });
  $("#send").disabled = S.busy || !$("#draft").value.trim();
  $("#send").textContent = S.busy ? `Working… ${S.busySince ? Math.round((Date.now() - S.busySince) / 1000) + "s" : ""}` : "Run";
  $("#send").classList.toggle("busy", S.busy);
}
function renderChip() {
  const s = S.selection;
  $("#chip").innerHTML = s ? `<div class="chip">Area selected: ${s[1].toFixed(1)}°, ${s[0].toFixed(1)}° → ${s[3].toFixed(1)}°, ${s[2].toFixed(1)}°<button id="chip-x" aria-label="Clear">×</button></div>` : "";
  $("#draft").placeholder = s ? "Analyze this region for…" : "Find the best locations for…";
}
const modelName = (id) => { const m = (S.models?.models || []).find((x) => x.id === id); return m ? m.name : String(id || "").replace(/^claude-/, "Claude ").replace(/-(\d+)-(\d+)$/, " $1.$2").replace(/-/g, " ").replace(/\b[a-z]/g, (c) => c.toUpperCase()); };
const activeModel = () => S.model || S.settings?.model || S.health?.model || null;
function renderBadge() {
  const b = $("#badge"), llm = S.settings ? S.settings.has_key : S.health?.planner === "llm";
  b.className = "badge " + (S.offline ? "bad" : llm ? "ok" : "warn");
  b.textContent = S.offline ? "Offline" : llm ? "LLM agent" : "Rule-based planner";
  b.title = S.offline ? "The backend is not reachable" : llm ? `Language model with tool calling (${activeModel()}). Click to change.` : "No Claude API key set. A rule-based planner handles solar and agriculture. Click to add a key.";
  const c = $("#model-chip");
  c.className = "model-chip" + (llm && !S.offline ? " live" : "");
  c.innerHTML = `<i></i>${S.offline ? "Offline" : llm ? esc(modelName(activeModel())) : "Rule-based · add key"}`;
}
function toast(text, kind = "") {
  const t = document.createElement("div"); t.className = "toast " + kind; t.textContent = text; $("#toasts").appendChild(t);
  setTimeout(() => t.classList.add("out"), 3800); setTimeout(() => t.remove(), 4300);
}

// ---------------------------------------------------------------- settings dialog (API key + model)
async function loadSettings() {
  try { S.settings = await (await fetch(API + "/api/settings")).json(); S.offline = false; } catch (e) { S.offline = true; }
  renderBadge();
  if (S.settings?.has_key) loadModels();
}
async function loadModels(refresh) {
  try { S.models = await (await fetch(API + "/api/models" + (refresh ? "?refresh=1" : ""))).json(); } catch (e) { S.models = null; }
  renderBadge(); if (S.dlg.open) renderSettings();
}
function openSettings() {
  S.dlg = { open: true, status: null, busy: false, custom: false };
  if (!S.models) loadModels();
  renderSettings(); $("#overlay").hidden = false;
  setTimeout(() => ($("#key-input") || $("#model-select"))?.focus(), 30);
}
function closeSettings() { S.dlg.open = false; $("#overlay").hidden = true; $("#overlay").innerHTML = ""; $("#draft").focus(); }
function renderSettings() {
  const st = S.settings || {}, d = S.dlg, ms = S.models?.models || [], cur = S.model || "";
  const inList = !cur || ms.some((m) => m.id === cur), custom = d.custom || !inList;
  const src = st.key_source === "env" ? "saved in backend/.env" : st.key_source === "shared" ? "shared with TerraTwin (Mars)" : "kept in memory until the server restarts";
  $("#overlay").innerHTML = `<div class="dialog" role="dialog" aria-modal="true" aria-labelledby="dlg-title">
    <header><h2 id="dlg-title">Settings</h2><button class="x" data-act="close-settings" aria-label="Close">×</button></header>
    <section>
      <div class="eyebrow">Claude API key</div>
      <div class="keystate ${st.has_key ? "ok" : ""}"><i></i>${st.has_key ? `Key active <code>${esc(st.key_hint || "…")}</code> · ${src}` : "No key. The rule-based planner is used (solar and agriculture only)."}</div>
      <form id="key-form" autocomplete="off">
        <input type="password" id="key-input" name="k" autocomplete="new-password" autocapitalize="off" spellcheck="false" placeholder="${st.has_key ? "Paste a new key to replace it" : "sk-ant-…"}" ${d.busy ? "disabled" : ""}>
        <button class="btn primary" type="submit" ${d.busy ? "disabled" : ""}>${d.busy ? "Checking…" : "Save key"}</button>
        ${st.has_key ? `<button class="btn" type="button" data-act="remove-key" ${d.busy ? "disabled" : ""}>Remove</button>` : ""}
      </form>
      <label class="check"><input type="checkbox" id="key-remember" checked> Remember on this computer <span class="faint">(writes backend/.env)</span></label>
      <p class="fine">One key is enough for every Claude model. It goes only to the Meridian server on this computer, which calls Anthropic. It is never sent back to the browser, never shown again (only the last four characters), and is stripped from error messages.</p>
      ${d.status ? `<div class="status ${d.status.kind}">${esc(d.status.text)}</div>` : ""}
    </section>
    <section>
      <div class="eyebrow">Model <button class="link" data-act="refresh-models" ${st.has_key ? "" : "disabled"}>refresh list</button></div>
      <select id="model-select" ${st.has_key ? "" : "disabled"}>
        <option value="">Server default${st.model ? ` — ${esc(modelName(st.model))}` : ""}</option>
        ${ms.map((m) => `<option value="${esc(m.id)}" ${m.id === cur && !custom ? "selected" : ""}>${esc(m.name)} — ${esc(m.id)}</option>`).join("")}
        <option value="__custom" ${custom ? "selected" : ""}>Other model id…</option>
      </select>
      ${custom ? `<input type="text" id="model-custom" placeholder="e.g. claude-opus-5-5" value="${esc(inList ? "" : cur)}" spellcheck="false">` : ""}
      <p class="fine">${!st.has_key ? "Add a key to choose a model." : S.models?.live ? "List fetched live from your Anthropic account." : "Showing a built-in list" + (S.models?.error ? ` (live list unavailable: ${esc(S.models.error)})` : "") + ". You can type any model id."} The choice applies from your next message and is remembered in this browser.</p>
    </section>
    <footer><button class="btn" data-act="close-settings">Done</button></footer></div>`;
}
async function saveKey(key, remember) {
  S.dlg.busy = true; S.dlg.status = null; renderSettings();
  try {
    S.settings = await post("/api/settings", { api_key: key, remember });
    S.dlg.status = { kind: "ok", text: S.settings.message || "Saved." };
    S.models = null; await loadModels(true);
  } catch (e) { S.dlg.status = { kind: "bad", text: e.message }; try { S.settings = await (await fetch(API + "/api/settings")).json(); } catch (x) { /* ignore */ } }
  S.dlg.busy = false; renderBadge(); renderSettings();
}
function setModel(id) {
  S.model = id || null;
  try { id ? localStorage.setItem("meridian.model", id) : localStorage.removeItem("meridian.model"); } catch (e) { /* ignore */ }
  renderBadge();
}

async function send(text) {
  text = text.trim();
  if (!text || S.busy) return;
  const sel = S.selection;
  const m = { id: uid(), role: "agent", text: "", steps: [], pending: true };
  S.messages.push({ id: uid(), role: "user", text, selection: sel }, m);
  S.busy = true; S.busySince = Date.now(); clearInterval(S.busyTick); S.busyTick = setInterval(() => { if (!S.busy) return clearInterval(S.busyTick); $("#send").textContent = `Working… ${Math.round((Date.now() - S.busySince) / 1000)}s`; }, 1000); $("#draft").value = ""; $("#draft").style.height = "auto"; renderChat();
  const onEvent = (ev) => {
    switch (ev.type) {
      case "step": m.steps.push(ev.label); break;
      case "analysis":
        if (!S.analysis || S.analysis.id !== ev.analysis.id) { S.comparison = null; S.selected = null; S.area = null; S.picked = []; }
        S.analysis = ev.analysis; if (S.tab === "compare") S.tab = "ranking"; resetWeights(); break;
      case "comparison": S.comparison = ev.comparison; S.tab = "compare"; S.selected = null; break;
      case "area": S.area = ev.area; break;
      case "map": if (ev.command.action === "fit") fitTo(ev.command.iso3); else S.highlight = ev.command.iso3; break;
      case "message": m.text = ev.text; m.model = ev.model || null; break;
      case "error": m.text = "The analysis failed: " + ev.message; m.error = true; break;
    }
    renderChat(); renderAll();
  };
  try { await streamChat({ session_id: S.session, message: text, selection: sel ? { bbox: sel } : null, model: S.settings?.has_key ? S.model : null }, onEvent); S.offline = false; }
  catch (e) { S.offline = true; m.error = true; m.text = `Could not reach the analysis service. Make sure the backend is running. (${e.message})`; }
  m.pending = false; S.busy = false; renderBadge(); renderChat(); renderAll();
}

// ---------------------------------------------------------------- map
/* Leaflet + OpenStreetMap. Leaflet draws with plain DOM/canvas, so unlike WebGL map libraries it
   also works on computers where GPU acceleration is switched off or unsupported. */
const OSM_ATTR = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const BASEMAPS = {
  osm: { label: "Standard", url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png", maxNativeZoom: 19, attribution: OSM_ATTR },
  humanitarian: { label: "Humanitarian", url: "https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png", subdomains: "abc", maxNativeZoom: 19,
    attribution: OSM_ATTR + ', tiles by <a href="https://www.hotosm.org/">HOT</a>, hosted by <a href="https://openstreetmap.fr/">OSM France</a>' },
  satellite: { label: "Satellite", url: "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/{z}/{y}/{x}.jpg", maxNativeZoom: 13,
    attribution: 'Sentinel-2 cloudless 2024 — <a href="https://s2maps.eu">s2maps.eu</a> by <a href="https://eox.at">EOX IT Services GmbH</a> (contains modified Copernicus Sentinel data 2024)' },
  // Same OpenStreetMap tiles, recoloured in the browser with a CSS filter (no extra service).
  dark: { label: "Dark", url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png", maxNativeZoom: 19, attribution: OSM_ATTR,
    filter: "invert(1) hue-rotate(180deg) brightness(0.95) contrast(0.9)" },
};
const FALLBACK_BASEMAP = "osm";
const metricValue = (l, metric) => (metric === "score" ? (l.rank ? l.score : null) : (l.values[metric]?.norm ?? null) === null ? null : l.values[metric].norm * 100);

let noticeTimer = null;
function notice(text, ms = 8000) {
  clearTimeout(noticeTimer);
  $("#maperr").innerHTML = `<div class="fatal">${esc(text)}</div>`;
  if (ms) noticeTimer = setTimeout(() => ($("#maperr").innerHTML = ""), ms);
}

let baseLayer = null, geoLayer = null, pointLayer = null, selLayer = null, countriesFC = null, locIndex = new Map();
const tiles = { ok: 0, timer: null };

function initMap() {
  if (typeof L === "undefined") {
    $("#maperr").innerHTML = `<div class="fatal">The map library (Leaflet) could not be loaded. Run <code>python -m app.vendor</code> once, or check the internet connection. The chat and results panels still work.</div>`;
    return;
  }
  map = L.map("map", { center: [8, 18], zoom: 2, minZoom: 2, maxZoom: 12, zoomControl: false, attributionControl: false, preferCanvas: true,
    maxBounds: [[-85, -180], [85, 180]], maxBoundsViscosity: 1, worldCopyJump: false });
  L.control.zoom({ position: "bottomright" }).addTo(map);
  L.control.scale({ position: "bottomright", maxWidth: 110, imperial: false }).addTo(map);
  L.control.attribution({ position: "bottomright", prefix: '<a href="https://leafletjs.com">Leaflet</a>' }).addTo(map);
  map.boxZoom.disable();
  pointLayer = L.layerGroup().addTo(map);
  applyBasemap(S.basemap);
  map.on("click", (e) => { if (!e.originalEvent.shiftKey) selectCountry(null); });
  setupBoxSelect();
  loadCountries();
  setTimeout(() => map.invalidateSize(), 0);
  window.addEventListener("resize", () => map.invalidateSize());
}

/* Swap the tile layer. If a basemap delivers no tiles within a few seconds, fall back to the
   standard OpenStreetMap layer instead of leaving the map empty. */
function applyBasemap(k) {
  const b = BASEMAPS[k];
  if (baseLayer) map.removeLayer(baseLayer);
  baseLayer = L.tileLayer(b.url, { subdomains: b.subdomains || "abc", maxNativeZoom: b.maxNativeZoom, maxZoom: 12, noWrap: true, attribution: b.attribution, crossOrigin: true });
  tiles.ok = 0;
  baseLayer.on("tileload", () => { tiles.ok++; });
  baseLayer.addTo(map);
  baseLayer.bringToBack();
  setTilePaneFilter();
  clearTimeout(tiles.timer);
  tiles.timer = setTimeout(() => {
    if (tiles.ok > 0 || S.basemap !== k) return;
    if (k !== FALLBACK_BASEMAP) { notice(`The “${b.label}” basemap delivered no tiles, so ${BASEMAPS[FALLBACK_BASEMAP].label} is shown instead.`); setBasemap(FALLBACK_BASEMAP); }
    else notice("Map tiles could not be loaded. Check the internet connection, or whether a firewall or ad blocker is blocking tile.openstreetmap.org.", 0);
  }, 7000);
}
function setTilePaneFilter() {
  if (!map) return;
  const b = BASEMAPS[S.basemap], f = [b.filter, S.dim ? "brightness(0.7) saturate(0.8)" : ""].filter(Boolean).join(" ");
  map.getPane("tilePane").style.filter = f;
}
function setBasemap(k) {
  if (!BASEMAPS[k]) return;
  S.basemap = k;
  if (map) applyBasemap(k);
  syncMap();
}

async function loadCountries() {
  try {
    const r = await fetch(API + "/api/geo/countries"); const fc = await r.json();
    if (!r.ok) throw new Error(fc.error || "HTTP " + r.status);
    for (const f of fc.features) countries.set(f.properties.iso3, f.properties);
    countriesFC = fc;
    geoLayer = L.geoJSON(fc, {
      style: featStyle, bubblingMouseEvents: false,
      onEachFeature: (f, layer) => {
        const iso = f.properties.iso3;
        layer.on("mousemove", (e) => showTip(e.containerPoint, iso));
        layer.on("mouseout", hideTip);
        layer.on("click", (e) => { if (!e.originalEvent.shiftKey) selectCountry(iso); });
      },
    }).addTo(map);
    mapReady = true; syncMap();
  } catch (err) {
    $("#maperr").innerHTML = `<div class="fatal">Could not load country boundaries. ${esc(err.message)}<br>The first start downloads them once from Natural Earth, so internet access is needed for that.</div>`;
  }
}

const lightBorders = () => S.dim || S.basemap === "dark" || S.basemap === "satellite";
function featStyle(f) {
  const iso = f.properties.iso3, l = locIndex.get(iso);
  const v = l ? metricValue(l, S.metric) : null;
  const hl = S.highlight.includes(iso), sel = S.selected === iso;
  let fill = "#ffffff", op = 0.01;
  if (l && v !== null) { fill = ramp(v, 1); op = 0.5; } else if (l) { fill = "#6b7683"; op = 0.28; }
  if (sel) op = 0.78; else if (hl) op = 0.7;
  const border = lightBorders() ? "rgba(255,255,255,0.45)" : "rgba(20,30,40,0.55)";
  return {
    fill: true, fillColor: fill, fillOpacity: S.layers.fill ? op : 0.01,
    stroke: true, color: sel ? "#ffffff" : hl ? (lightBorders() ? "#dfeee4" : "#10261c") : border,
    weight: sel ? 2.2 : hl ? 1.6 : 0.7, opacity: sel || hl || S.layers.borders ? 1 : 0, dashArray: sel || hl ? null : "3 3",
  };
}

/* Shift + drag draws an analysis box. */
function setupBoxSelect() {
  const el = map.getContainer(), box = $("#box");
  let start = null;
  const pos = (ev) => { const r = el.getBoundingClientRect(); return { x: ev.clientX - r.left, y: ev.clientY - r.top }; };
  const move = (ev) => {
    if (!start) return; const p = pos(ev);
    Object.assign(box.style, { display: "block", left: Math.min(start.x, p.x) + "px", top: Math.min(start.y, p.y) + "px", width: Math.abs(p.x - start.x) + "px", height: Math.abs(p.y - start.y) + "px" });
  };
  const up = (ev) => {
    document.removeEventListener("mousemove", move); document.removeEventListener("mouseup", up);
    map.dragging.enable(); box.style.display = "none";
    const s = start; start = null; if (!s) return;
    const p = pos(ev); if (Math.abs(p.x - s.x) < 8 || Math.abs(p.y - s.y) < 8) return;
    const a = map.containerPointToLatLng(L.point(Math.min(s.x, p.x), Math.max(s.y, p.y))), b = map.containerPointToLatLng(L.point(Math.max(s.x, p.x), Math.min(s.y, p.y)));
    S.selection = [a.lng, a.lat, b.lng, b.lat].map((n) => Math.round(n * 100) / 100);
    renderChip(); syncMap();
  };
  el.addEventListener("mousedown", (ev) => {
    if (!ev.shiftKey || ev.button !== 0) return;
    ev.preventDefault(); ev.stopPropagation(); map.dragging.disable(); start = pos(ev);
    document.addEventListener("mousemove", move); document.addEventListener("mouseup", up);
  }, true);
}

/* Tooltip: the HTML is rebuilt only when the hovered country or the analysis changes;
   other mouse moves just reposition it, batched to one update per animation frame. */
const tipState = { key: null, x: 0, y: 0, raf: 0 };
function showTip(pt, iso) {
  const tip = $("#tip"), key = iso + "|" + (S.analysis ? S.analysis.id : "") + "|" + S.metric;
  tipState.x = pt.x; tipState.y = pt.y;
  if (key !== tipState.key) { tipState.key = key; buildTip(tip, iso); }
  if (!tipState.raf) tipState.raf = requestAnimationFrame(() => {
    tipState.raf = 0; tip.style.display = "block";
    tip.style.transform = `translate(${tipState.x + 14}px, ${tipState.y + 14}px)`;
  });
}
function hideTip() { tipState.key = null; $("#tip").style.display = "none"; }
function buildTip(tip, iso) {
  const a = S.analysis, l = a && locIndex.get(iso);
  const name = countries.get(iso)?.name_long || iso;
  let html = `<div class="tip-name">${esc(name)}</div>`;
  if (l) {
    html += `<div class="tip-score">${l.rank ? `#${l.rank} · score <b>${l.score}</b>` : "Not ranked — too little data"}<span> · confidence ${Math.round(l.confidence * 100)}%</span></div>`;
    for (const v of [...a.variables].sort((x, y) => y.weight - x.weight).slice(0, 4)) {
      const c = l.values[v.id];
      html += `<div class="tip-row"><span>${esc(v.label)}${v.kind === "proxy" ? " (proxy)" : ""}</span><span>${c?.value == null ? "no data" : fnum(c.value)}${c?.diff_pct != null ? `<em>${signed(c.diff_pct)}%</em>` : ""}</span></div>`;
    }
    html += `<div class="tip-foot">% vs ${esc(a.benchmark.label)}. Click for all values.</div>`;
  } else if (a) html += `<div class="tip-foot">Outside the current analysis scope</div>`;
  tip.innerHTML = html; tip.style.left = "0px"; tip.style.top = "0px";
}

function fitTo(iso3) {
  if (!map || !mapReady || !iso3.length) return;
  let x0 = 180, y0 = 90, x1 = -180, y1 = -90;
  for (const i of iso3) { const p = countries.get(i); if (!p) continue; const b = p.bbox; x0 = Math.min(x0, b[0]); y0 = Math.min(y0, b[1]); x1 = Math.max(x1, b[2]); y1 = Math.max(y1, b[3]); }
  if (x0 > x1) return;
  map.fitBounds([[Math.max(y0, -75), x0], [Math.min(y1, 82), x1]], { padding: [60, 60], maxZoom: 6 });
}

function syncMap() {
  const a = S.analysis;
  if (S.metric !== "score" && !(a && a.variables.some((v) => v.id === S.metric))) S.metric = "score";
  locIndex = new Map(a ? a.locations.map((l) => [l.iso3, l]) : []);
  renderLegend(); renderMapControls();
  if (!map || !mapReady) return;
  setTilePaneFilter();
  geoLayer.setStyle(featStyle);
  geoLayer.eachLayer((layer) => { const iso = layer.feature.properties.iso3; if (S.selected === iso || S.highlight.includes(iso)) layer.bringToFront(); });

  pointLayer.clearLayers();
  if (S.layers.points) {
    const add = (lat, lon, c) => L.circleMarker([lat, lon], { radius: 4, fillColor: c, fillOpacity: 0.95, color: "#0a0d10", weight: 1, interactive: false }).addTo(pointLayer);
    const mv = a && a.variables.find((v) => v.id === S.metric);
    if (a && mv && mv.range && mv.connector === "nasa_power") {
      const [lo, hi] = mv.range;
      for (const p of a.points) {
        const x = p.values[S.metric]; if (x === undefined) continue;
        let n = hi === lo ? 0.5 : Math.max(0, Math.min(1, (x - lo) / (hi - lo)));
        if (mv.direction === "lower") n = 1 - n;
        if (mv.direction === "target" && mv.target) { const [t0, t1] = mv.target, w = t1 - t0 || 1; n = x >= t0 && x <= t1 ? 1 : Math.max(0, 1 - (x < t0 ? t0 - x : x - t1) / w); }
        add(p.lat, p.lon, ramp(n * 100));
      }
    } else if (a && S.metric === "score") for (const p of a.points) add(p.lat, p.lon, "rgba(60,70,80,0.8)");
    if (S.area) for (const p of S.area.points) add(p.lat, p.lon, "#1f9d82");
  }

  if (selLayer) { map.removeLayer(selLayer); selLayer = null; }
  if (S.selection) { const [x0, y0, x1, y1] = S.selection; selLayer = L.rectangle([[y0, x0], [y1, x1]], { color: "#1f9d82", weight: 1.8, dashArray: "5 4", fillColor: "#1f9d82", fillOpacity: 0.1, interactive: false }).addTo(map); }

  markers.forEach((m) => map.removeLayer(m)); markers = [];
  if (a && S.layers.labels) {
    const by = new Map(a.locations.map((l) => [l.iso3, l]));
    let lab;
    if (S.highlight.length >= 2) lab = S.highlight.map((i) => by.get(i)).filter(Boolean);
    else { lab = a.locations.filter((l) => l.rank).slice(0, 5); const sel = S.selected && by.get(S.selected); if (sel && !lab.includes(sel)) lab.push(sel); }
    for (const l of lab) {
      const p = countries.get(l.iso3); if (!p) continue;
      const val = S.metric === "score" ? (l.score === null ? "n/a" : l.score.toFixed(0)) : fnum(l.values[S.metric]?.value ?? null);
      const html = `<button class="map-pill pill-abs${l.iso3 === S.selected ? " is-selected" : ""}" style="background:${ramp(metricValue(l, S.metric), 0.96)}">${l.rank ? `<span class="map-pill-rank">${l.rank}</span>` : ""}<span>${esc(p.name)}</span><b>${esc(val)}</b></button>`;
      const m = L.marker([p.label_y, p.label_x], { icon: L.divIcon({ className: "pill-wrap", html, iconSize: [0, 0] }), keyboard: false });
      m.on("click", () => selectCountry(l.iso3));
      m.addTo(map); markers.push(m);
    }
  }
}

function renderMapControls() {
  $("#basemaps").innerHTML = Object.keys(BASEMAPS).map((b) => `<button class="${b === S.basemap ? "on" : ""}" data-b="${b}" title="${esc(BASEMAPS[b].attribution.replace(/<[^>]+>/g, ""))}">${esc(BASEMAPS[b].label)}</button>`).join("");
  const a = S.analysis;
  $("#layers").innerHTML = `<div class="eyebrow">Layers</div>` +
    [["fill", "Opportunity zones"], ["borders", "Borders"], ["labels", "Floating labels"], ["points", "Sample points"]].map(([k, t]) => `<label class="check"><input type="checkbox" data-l="${k}" ${S.layers[k] ? "checked" : ""}><span>${t}</span></label>`).join("") +
    `<label class="check"><input type="checkbox" data-dim="1" ${S.dim ? "checked" : ""}><span>Dim basemap</span></label>` +
    (a ? `<div class="eyebrow" style="margin-top:10px">Colour by</div><select id="metric"><option value="score">Overall score</option>${a.variables.map((v) => `<option value="${esc(v.id)}" ${v.id === S.metric ? "selected" : ""}>${esc(v.label)}</option>`).join("")}</select>` : "");
}
function renderLegend() {
  const a = S.analysis, mv = a && a.variables.find((v) => v.id === S.metric);
  $("#legend").innerHTML = a
    ? `<div class="legend-title">${S.metric === "score" ? "Overall opportunity score" : esc(mv?.label)}</div>
       <div class="legend-sub">${esc(a.title)} · ${esc(a.scope_label)}${mv ? " · " + (mv.direction === "lower" ? "lower is better" : mv.direction === "target" ? `target ${mv.target?.[0]}–${mv.target?.[1]}` : "higher is better") : ""}</div>
       <div class="legend-ramp"></div><div class="legend-ticks"><span>Low</span><span>Medium</span><span>High</span></div>
       <div class="legend-note"><i class="swatch"></i> In scope, no data or not ranked · relative to the ${a.locations.length} analysed locations</div>
       <div class="legend-hint">Shift + drag to select an area</div>`
    : `<div class="legend-title">No analysis yet</div><div class="legend-sub">Ask the agent a question to colour the map.</div><div class="legend-hint">Shift + drag to select an area</div>`;
}

function selectCountry(iso) {
  S.selected = iso;
  if (iso && S.analysis?.locations.some((l) => l.iso3 === iso)) S.tab = "ranking";
  renderAll();
}

// ---------------------------------------------------------------- results panel
const diffHtml = (c, v) => {
  if (!c || c.value == null || c.diff_abs == null) return `<span class="faint">—</span>`;
  const good = v.direction === "target" ? null : v.direction === "lower" ? c.diff_abs < 0 : c.diff_abs > 0;
  const cls = c.diff_abs === 0 || good === null ? "faint" : good ? "pos" : "neg";
  return `<span class="${cls}">${v.pct_meaningful && c.diff_pct != null ? signed(c.diff_pct) + "%" : signed(c.diff_abs, 2)}</span>`;
};
const cellHtml = (c) => (!c || c.value == null ? `<span class="faint" title="${esc(c?.note || "")}">${c?.status === "not_retrieved" ? "not retrieved" : c?.status === "error" ? "request failed" : "no data"}</span>` : esc(fnum(c.value)));

function detailHtml(a, l) {
  const nr = a.locations.filter((x) => x.rank).length;
  return `<div class="detail"><div class="detail-head"><div><div class="detail-name">${esc(l.name)}</div>
    <div class="faint">${esc(l.subregion || l.continent)} · ${l.rank ? `rank #${l.rank} of ${nr}` : "not ranked — too little data"}</div></div>
    <div class="detail-score" style="color:${ramp(l.rank ? l.score : null)}">${l.score === null ? "—" : l.score.toFixed(1)}<small>/100</small></div>
    <button class="x" data-act="close-detail" aria-label="Close">×</button></div>
    <div class="conf"><span style="width:${l.confidence * 100}%"></span><em>Data confidence ${Math.round(l.confidence * 100)}%</em></div>
    ${reasonsHtml(l, 4)}
    <table class="tbl"><thead><tr><th>Variable</th><th class="r">Value</th><th class="r" title="Difference against: ${esc(a.benchmark.label)}">vs benchmark</th><th class="r" title="Points this variable adds to the score">Pts</th></tr></thead><tbody>
    ${a.variables.map((v) => { const c = l.values[v.id]; return `<tr><td><div>${esc(v.label)} ${kindBadge(v)}</div><div class="faint small">${esc(v.units)}${c?.period ? " · " + esc(c.period) : ""}${c?.n_points ? ` · ${c.n_points} pt` : ""}</div></td>
      <td class="r num">${cellHtml(c)}</td><td class="r num">${diffHtml(c, v)}</td><td class="r num">${c?.contribution !== undefined ? c.contribution.toFixed(1) : `<span class="faint">—</span>`}</td></tr>`; }).join("")}
    </tbody></table><div class="fine">Benchmark: ${esc(a.benchmark.label)}. Score is relative suitability on these variables, not a yield, cost or profit forecast.</div></div>`;
}

function factHtml(f) {
  const cmp = f.benchmark == null ? "" : f.diff_pct != null ? `${signed(f.diff_pct)}%` : f.diff_abs != null ? signed(f.diff_abs) : "";
  const p = f.points_vs_average, cls = p > 0.05 ? "pos" : p < -0.05 ? "neg" : "faint";
  return `<div class="fact"><span class="fact-l">${esc(f.label)}${f.kind === "proxy" ? ` <em>proxy</em>` : f.kind === "estimated" ? ` <em>estimate</em>` : ""}</span>
    <span class="fact-v num"><b>${fnum(f.value)}</b> ${esc(f.units)}${f.benchmark == null ? "" : `<i>${S.analysis?.benchmark.type === "candidates_mean" ? "avg" : "ref"} ${fnum(f.benchmark)}${cmp ? ` · <u class="${f.favourable === null ? "faint" : f.favourable ? "pos" : "neg"}">${cmp}</u>` : ""}</i>`}</span>
    <span class="fact-p num ${cls}" title="Score points gained or lost against an average candidate">${p > 0 ? "+" : ""}${p.toFixed(1)}</span></div>`;
}
function reasonsHtml(l, n) {
  const r = l.reasons; if (!r) return "";
  const up = r.up.slice(0, n), down = r.down.slice(0, n);
  return `<div class="why"><p class="why-head">${esc(r.headline)}</p>
    ${up.length ? `<div class="why-grp"><div class="why-t pos">▲ Above average here</div>${up.map(factHtml).join("")}</div>` : ""}
    ${down.length ? `<div class="why-grp"><div class="why-t neg">▼ Holding it back</div>${down.map(factHtml).join("")}</div>` : ""}
    ${r.gaps.length ? `<div class="why-gaps"><b>No data (${r.gaps.length}):</b> ${esc(r.gaps.join(", "))}</div>` : ""}</div>`;
}
function whyHtml(a) {
  const ref = a.locations[0]?.reasons?.reference || a.benchmark.label;
  let html = `<div class="note">Every value is shown next to <b>${esc(ref)}</b> (“avg” or “ref”). The right-hand number is how many score points that variable gains or loses for the location against an average candidate. Nothing here is generated text: it is arithmetic on the retrieved values.</div>`;
  for (const l of a.locations) {
    const open = S.whyOpen === l.iso3, r = l.reasons;
    html += `<div class="why-card${l.rank ? "" : " unranked"}"><div class="why-top" data-iso="${l.iso3}"><span class="rank-n">${l.rank ?? "—"}</span><b>${esc(l.name)}</b>
      <span class="why-score num" style="color:${ramp(l.rank ? l.score : null)}">${l.score === null ? "—" : l.score.toFixed(1)}</span></div>
      ${reasonsHtml(l, 5)}
      ${r && r.facts.length ? `<button class="link" data-why="${l.iso3}">${open ? "Hide" : `All ${r.facts.length} variables`}</button>${open ? `<div class="why-grp all">${r.facts.map(factHtml).join("")}</div>` : ""}` : ""}</div>`;
  }
  return html + `<div class="fine">Percentages are measured against ${esc(a.benchmark.label)}. Proxies and estimates are marked. Change the benchmark in the Compare tab or ask the agent.</div>`;
}

function rankingHtml(a) {
  const ranked = a.locations.filter((l) => l.rank), unranked = a.locations.filter((l) => !l.rank);
  const sel = S.selected && a.locations.find((l) => l.iso3 === S.selected);
  const cats = [...new Set(a.variables.map((v) => v.category))];
  let html = sel ? detailHtml(a, sel) : "";
  html += a.warnings.map((w) => `<div class="note warn">${esc(w)}</div>`).join("");
  html += `<div class="section-head"><span>Ranked locations <em>${ranked.length}</em></span><button class="btn sm" data-act="compare-picked" ${S.picked.length < 2 ? "disabled" : ""}>${S.picked.length < 2 ? "Tick 2–5 to compare" : "Compare " + S.picked.length}</button></div><div class="rank-list">`;
  for (const l of ranked) {
    const d = l.prev_rank && l.prev_rank !== l.rank ? l.prev_rank - l.rank : 0;
    html += `<div class="rank-row${l.iso3 === S.selected ? " on" : ""}" data-iso="${l.iso3}">
      <input type="checkbox" data-pick="${l.iso3}" ${S.picked.includes(l.iso3) ? "checked" : ""} aria-label="Select ${esc(l.name)}">
      <span class="rank-n">${l.rank}</span><span class="rank-name">${esc(l.name)}${d ? `<i class="${d > 0 ? "pos" : "neg"}">${d > 0 ? "▲" : "▼"}${Math.abs(d)}</i>` : ""}</span>
      <span class="rank-bar"><span style="width:${l.score}%;background:${ramp(l.score)}"></span></span><span class="rank-score num">${l.score.toFixed(1)}</span>
      <span class="rank-conf num${l.confidence < 0.8 ? " low" : ""}" title="Data confidence: share of the weighting backed by data">${Math.round(l.confidence * 100)}%</span></div>`;
  }
  html += "</div>";
  if (unranked.length) html += `<div class="note"><b>Not ranked (${unranked.length})</b> — less than half of the weighting has data: ${esc(unranked.map((l) => l.name).join(", "))}.</div>`;
  if (ranked.length) {
    html += `<div class="section-head"><span>What makes up the score</span></div>`;
    for (const l of ranked.slice(0, 8)) {
      const parts = cats.map((c) => [c, a.variables.filter((v) => v.category === c).reduce((s, v) => s + (l.values[v.id]?.contribution || 0), 0)]);
      html += `<div class="stack-row"><span class="stack-name">${esc(l.name)}</span><span class="stack">${parts.map(([c, p]) => `<span style="width:${p}%;background:${CAT[c] || "#9aa5b1"}" title="${esc(c)}: ${p.toFixed(1)} pts"></span>`).join("")}</span></div>`;
    }
    html += `<div class="legend-cats">${cats.map((c) => `<span><i style="background:${CAT[c] || "#9aa5b1"}"></i>${esc(c)}</span>`).join("")}</div><div class="fine">Points contributed by each group of variables. Bars add up to the location's score.</div>`;
  }
  return html;
}

function compareHtml(a, cmp) {
  if (!cmp) return `<div class="empty">Tick two or more locations in the ranking, or ask the agent — for example “Compare the two best locations based on construction costs, solar irradiance, labor costs, and infrastructure.”</div>`;
  let html = `<div class="cmp-heads">${cmp.locations.map((l, i) => `<div class="cmp-head" style="border-color:${SERIES[i % 5]}"><div class="cmp-name">${esc(l.name)}</div>
    <div class="cmp-score num">${l.focused_score ?? "—"}<small>${cmp.subset ? " on compared variables" : " score"}</small></div>
    <div class="faint small">overall #${l.rank ?? "—"} · ${l.score ?? "—"} · confidence ${Math.round(l.focused_confidence * 100)}%</div></div>`).join("")}</div>`;
  html += `<div class="tbl-scroll"><table class="tbl"><thead><tr><th>Variable</th>${cmp.locations.map((l) => `<th class="r">${esc(l.name)}</th>`).join("")}<th class="r" title="${esc(cmp.benchmark_label)}">Benchmark</th></tr></thead><tbody>`;
  for (const r of cmp.rows) {
    html += `<tr><td><div>${esc(r.label)} ${kindBadge(r)}</div><div class="faint small">${esc(r.units)} · ${r.direction === "lower" ? "lower is better" : r.direction === "target" ? `target ${r.target?.[0]}–${r.target?.[1]}` : "higher is better"}${r.period ? " · " + esc(r.period) : ""}</div></td>`;
    for (const l of cmp.locations) { const c = r.values[l.iso3]; html += `<td class="r num${r.best === l.iso3 ? " best" : ""}"><div>${cellHtml(c)}</div><div class="small">${diffHtml(c, r)}</div></td>`; }
    html += `<td class="r num faint">${fnum(r.benchmark)}</td></tr>`;
  }
  html += `</tbody></table></div><div class="fine">Differences = (location − benchmark) ÷ |benchmark| × 100, in the units and reference period shown per row. Benchmark: ${esc(cmp.benchmark_label)}. Index variables on an interval scale show the absolute difference instead. ${esc(cmp.note)}</div>`;
  const px = cmp.rows.filter((r) => r.kind === "proxy");
  if (px.length) html += `<div class="note warn">${px.map((r) => `<div><b>${esc(r.label)}:</b> ${esc(r.proxy_note)}</div>`).join("")}</div>`;
  return html;
}

function resetWeights() { S.weights = S.analysis ? Object.fromEntries(S.analysis.variables.map((v) => [v.id, Math.round(v.weight_pct)])) : {}; }
function weightsHtml(a) {
  const total = Object.values(S.weights).reduce((s, x) => s + x, 0) || 1;
  const dirty = a.variables.some((v) => Math.round(v.weight_pct) !== S.weights[v.id]);
  const bsel = a.benchmark.type === "country" ? "country:" + a.benchmark.iso3 : a.benchmark.type;
  return `<div class="section-head"><span>Benchmark</span></div>
    <select id="bench" ${S.working ? "disabled" : ""}><option value="candidates_mean" ${bsel === "candidates_mean" ? "selected" : ""}>Mean of analysed locations (${esc(a.scope_label)})</option>
    <option value="world" ${bsel === "world" ? "selected" : ""}>World aggregate (World Bank indicators only)</option>
    <optgroup label="A selected location">${[...a.locations].sort((x, y) => x.name.localeCompare(y.name)).map((l) => `<option value="country:${l.iso3}" ${bsel === "country:" + l.iso3 ? "selected" : ""}>${esc(l.name)}</option>`).join("")}</optgroup></select>
    ${a.benchmark.note ? `<div class="fine">${esc(a.benchmark.note)}</div>` : ""}
    <div class="section-head"><span>Scoring weights</span><button class="btn sm primary" id="apply-w" ${!dirty || S.working ? "disabled" : ""}>${S.working ? "Recalculating…" : "Apply"}</button></div>
    ${a.variables.map((v) => `<div class="weight"><div class="weight-top"><span>${esc(v.label)} ${kindBadge(v)}</span><span class="num" data-wp="${esc(v.id)}">${Math.round((100 * (S.weights[v.id] ?? 0)) / total)}%</span></div>
      <input type="range" min="0" max="60" step="1" value="${S.weights[v.id] ?? 0}" data-w="${esc(v.id)}" style="accent-color:${CAT[v.category] || "#8fd3c1"}">
      <div class="faint small">${v.direction === "lower" ? "Lower is better" : v.direction === "target" ? `Target ${v.target?.[0]}–${v.target?.[1]} ${esc(v.units)}` : "Higher is better"}${v.rationale ? " · " + esc(v.rationale) : ""}</div></div>`).join("")}
    <div class="fine">Weights are relative and always normalised to 100%. Changing them recalculates the ranking from data already retrieved; no new requests are made.</div>`;
}

function sourcesHtml(a) {
  return `<div class="export"><a class="btn sm" href="${API}/api/analysis/${a.id}/export.csv">Export CSV</a><button class="btn sm" data-act="print">Export PDF</button><span class="fine">PDF uses your browser's print dialog — choose “Save as PDF”.</span></div>
  <div class="section-head"><span>Variables and provenance</span></div>
  ${a.variables.map((v) => `<div class="src-var"><div class="src-top"><span>${esc(v.label)}</span><span class="cover num" title="Locations with data">${v.coverage.with_data}/${v.coverage.total}</span></div>
    <div class="cover-bar"><span style="width:${(100 * v.coverage.with_data) / v.coverage.total}%"></span></div>
    <div class="faint small">${kindBadge(v)} <a href="${esc(v.source_url)}" target="_blank" rel="noreferrer">${esc(v.source_name)}</a> · ${esc(v.units)} · ${esc(v.resolution)}${v.period ? " · period: " + esc(v.period) : ""}</div>
    ${v.proxy_note ? `<div class="small warn-text">${esc(v.proxy_note)}</div>` : ""}${v.assumption ? `<div class="small warn-text">Assumption: ${esc(v.assumption)}</div>` : ""}</div>`).join("")}
  <div class="section-head"><span>Data sources</span></div>
  ${a.sources.map((s) => `<div class="src"><div><a href="${esc(s.url)}" target="_blank" rel="noreferrer">${esc(s.name)}</a> <span class="faint small">${esc(s.license)}</span></div>
    <div class="faint small">Retrieved ${esc(s.retrieved_at || "—")}${s.source_updated ? " · source last updated " + esc(s.source_updated) : ""}${s.failed_requests > 0 ? `<span class="neg"> · ${s.failed_requests} failed request(s), shown as missing</span>` : ""}</div>
    <div class="faint small">${esc(s.notes)}</div></div>`).join("")}
  ${a.unavailable.length ? `<div class="section-head"><span>Relevant but not included <em>${a.unavailable.length}</em></span></div><div class="fine" style="margin-top:0">These matter for the decision but no dataset is connected. They are left out, not estimated.</div>${a.unavailable.map((u) => `<div class="unavail"><b>${esc(u.name)}</b><span>${esc(u.reason)}</span></div>`).join("")}` : ""}
  <div class="section-head"><span>How the score is calculated</span></div><ol class="method">${a.methodology.map((m) => `<li>${esc(m)}</li>`).join("")}</ol>`;
}

function renderResults() {
  const a = S.analysis;
  $("#r-eyebrow").textContent = a ? `${a.scope_label} · ${a.locations.length} locations · ${a.variables.length} variables` : "Results";
  $("#r-title").textContent = a ? a.title : "No analysis yet";
  $("#tabs").innerHTML = [["ranking", "Ranking"], ["why", "Why"], ["compare", "Compare"], ["weights", "Weights"], ["sources", "Sources & confidence"]].map(([t, n]) => `<button data-tab="${t}" class="${t === S.tab ? "on" : ""}">${n}</button>`).join("");
  const el = $("#results"), top = el.scrollTop;
  el.innerHTML = !a ? (S.busy ? skeletonHtml() : emptyResultsHtml())
    : S.tab === "ranking" ? rankingHtml(a) : S.tab === "why" ? whyHtml(a) : S.tab === "compare" ? compareHtml(a, S.comparison) : S.tab === "weights" ? weightsHtml(a) : sourcesHtml(a);
  el.scrollTop = top;
  $("#topnote").textContent = a ? "Country resolution · scores are relative suitability, not forecasts" : "";
}

function skeletonHtml() {
  return `<div class="skel" aria-hidden="true">${Array.from({ length: 9 }, (_, i) => `<div class="skel-row"><i></i><b style="width:${70 - i * 5}%"></b></div>`).join("")}</div><p class="fine c">Collecting data from NASA POWER and the World Bank…</p>`;
}
function emptyResultsHtml() {
  const it = [["Ranking", "Every location scored 0–100, with a confidence figure."], ["Why", "The facts behind each position: every value next to the average, and the points it gains or loses."], ["Compare", "Side by side, with the winner per variable and % vs a benchmark."], ["Weights", "Change priorities and watch the ranking move."], ["Sources", "Where each number came from, and what is missing."]];
  return `<div class="empty-res"><div class="eyebrow">What appears here</div>${it.map(([t, d]) => `<div class="empty-item"><b>${t}</b><span>${d}</span></div>`).join("")}</div>`;
}
function renderPrint() {
  const a = S.analysis; if (!a) { $("#print").innerHTML = ""; return; }
  $("#print").innerHTML = `<h1>${esc(a.title)} — ${esc(a.scope_label)}</h1><p>${esc(a.objective)} Generated ${esc(a.created_at)}. Benchmark: ${esc(a.benchmark.label)}.</p><h2>Ranking</h2>
    <table><thead><tr><th>#</th><th>Location</th><th>Score</th><th>Confidence</th>${a.variables.map((v) => `<th>${esc(v.label)} (${esc(v.units)})</th>`).join("")}</tr></thead><tbody>
    ${a.locations.map((l) => `<tr><td>${l.rank ?? "–"}</td><td>${esc(l.name)}</td><td>${l.score ?? "–"}</td><td>${Math.round(l.confidence * 100)}%</td>${a.variables.map((v) => `<td>${l.values[v.id]?.value == null ? "no data" : fnum(l.values[v.id].value)}</td>`).join("")}</tr>`).join("")}</tbody></table>
    <h2>Variables, weights and sources</h2><table><thead><tr><th>Variable</th><th>Weight</th><th>Source</th><th>Data kind</th><th>Resolution</th><th>Coverage</th><th>Note</th></tr></thead><tbody>
    ${a.variables.map((v) => `<tr><td>${esc(v.label)}</td><td>${v.weight_pct}%</td><td>${esc(v.source_name)}</td><td>${KIND[v.kind]}</td><td>${esc(v.resolution)}</td><td>${v.coverage.with_data}/${v.coverage.total}</td><td>${esc(v.proxy_note || v.assumption || "")}</td></tr>`).join("")}</tbody></table>
    <h2>Not included (no dataset connected)</h2><ul>${a.unavailable.map((u) => `<li><b>${esc(u.name)}:</b> ${esc(u.reason)}</li>`).join("")}</ul><h2>Method</h2><ol>${a.methodology.map((m) => `<li>${esc(m)}</li>`).join("")}</ol>`;
}

function renderAll() { renderResults(); renderPrint(); syncMap(); }

// ---------------------------------------------------------------- actions
async function withAnalysis(fn) {
  S.working = true; renderResults();
  try {
    S.analysis = await fn(); resetWeights();
    if (S.comparison) { try { S.comparison = await post(`/api/analysis/${S.analysis.id}/compare`, { iso3: S.comparison.locations.map((l) => l.iso3), variables: S.comparison.subset ? S.comparison.rows.map((r) => r.id) : null }); } catch (e) { /* keep */ } }
  } catch (e) { S.messages.push({ id: uid(), role: "agent", text: e.message, steps: [], error: true }); renderChat(); }
  S.working = false; renderAll();
}
async function comparePicked() {
  try {
    S.comparison = await post(`/api/analysis/${S.analysis.id}/compare`, { iso3: S.picked });
    S.highlight = [...S.picked]; fitTo(S.picked); S.selected = null; S.tab = "compare"; renderAll();
  } catch (e) { S.messages.push({ id: uid(), role: "agent", text: e.message, steps: [], error: true }); renderChat(); }
}

const DEMO = ["Find the best regions in Africa for building solar farms.", "Compare the two best locations based on construction costs, solar irradiance, labor costs, and infrastructure.", "What if I prioritize low construction costs over maximum solar production?"];
async function runDemo() { for (const q of DEMO) { await send(q); if (S.offline) break; } }

document.addEventListener("click", (e) => {
  if (e.target.id === "overlay") return closeSettings();
  const v = e.target.closest("#viewbar [data-view]");
  if (v) { $("#app").dataset.view = v.dataset.view; document.querySelectorAll("#viewbar button").forEach((b) => b.classList.toggle("on", b === v)); if (v.dataset.view === "map" && map) setTimeout(() => map.invalidateSize(), 30); return; }
  const t = e.target.closest("[data-s],[data-t],[data-b],[data-tab],[data-act],[data-why],[data-iso],#chip-x,#apply-w");
  if (!t) return;
  if (t.dataset.act === "open-settings") openSettings();
  else if (t.dataset.act === "close-settings") closeSettings();
  else if (t.dataset.act === "remove-key") saveKey("", false);
  else if (t.dataset.act === "refresh-models") loadModels(true);
  else if (t.dataset.act === "demo") runDemo();
  else if (t.dataset.s) send(t.dataset.s);
  else if (t.dataset.t) { const m = S.messages.find((x) => x.id === t.dataset.t); if (m) { m.open = !m.open; renderChat(); } }
  else if (t.dataset.b) setBasemap(t.dataset.b);
  else if (t.dataset.why) { S.whyOpen = S.whyOpen === t.dataset.why ? null : t.dataset.why; renderResults(); }
  else if (t.dataset.tab) { S.tab = t.dataset.tab; renderResults(); }
  else if (t.id === "chip-x") { S.selection = null; renderChip(); syncMap(); }
  else if (t.id === "apply-w") withAnalysis(() => post(`/api/analysis/${S.analysis.id}/reweight`, { weights: S.weights }));
  else if (t.dataset.act === "close-detail") selectCountry(null);
  else if (t.dataset.act === "compare-picked") comparePicked();
  else if (t.dataset.act === "print") window.print();
  else if (t.dataset.iso && !e.target.matches("input")) selectCountry(t.dataset.iso === S.selected ? null : t.dataset.iso);
});
document.addEventListener("change", (e) => {
  const t = e.target;
  if (t.id === "model-select") { if (t.value === "__custom") { S.dlg.custom = true; renderSettings(); $("#model-custom")?.focus(); } else { S.dlg.custom = false; setModel(t.value); renderSettings(); } }
  else if (t.id === "model-custom") { const v = t.value.trim(); if (/^[A-Za-z0-9][A-Za-z0-9._:-]{2,79}$/.test(v)) { setModel(v); toast("Model set to " + v); } else if (v) toast("That is not a valid model id", "bad"); }
  else if (t.dataset.l) { S.layers[t.dataset.l] = t.checked; syncMap(); }
  else if (t.dataset.dim) { S.dim = t.checked; syncMap(); }
  else if (t.id === "metric") { S.metric = t.value; syncMap(); }
  else if (t.dataset.pick) { const i = t.dataset.pick; S.picked = S.picked.includes(i) ? S.picked.filter((x) => x !== i) : S.picked.length >= 5 ? S.picked : [...S.picked, i]; renderResults(); }
  else if (t.id === "bench") { const [ty, iso] = t.value.split(":"); withAnalysis(() => post(`/api/analysis/${S.analysis.id}/benchmark`, { type: ty, iso3: iso || null })); }
});
document.addEventListener("input", (e) => {
  const t = e.target;
  if (t.dataset.w) {
    S.weights[t.dataset.w] = Number(t.value);
    const total = Object.values(S.weights).reduce((s, x) => s + x, 0) || 1;
    document.querySelectorAll("[data-wp]").forEach((el) => (el.textContent = Math.round((100 * (S.weights[el.dataset.wp] ?? 0)) / total) + "%"));
    $("#apply-w").disabled = !S.analysis.variables.some((v) => Math.round(v.weight_pct) !== S.weights[v.id]);
  } else if (t.id === "draft") $("#send").disabled = S.busy || !t.value.trim();
});
document.addEventListener("submit", (e) => {
  if (e.target.id !== "key-form") return;
  e.preventDefault();
  const inp = $("#key-input"), key = inp.value.trim(), remember = $("#key-remember").checked;
  if (!key) { S.dlg.status = { kind: "bad", text: "Paste a key first." }; renderSettings(); return; }
  inp.value = ""; saveKey(key, remember);        // the field is cleared at once; the key never stays in the page
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && S.dlg.open) closeSettings();
  else if (e.key === "/" && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) && !S.dlg.open) { e.preventDefault(); $("#draft").focus(); }
});
$("#draft").addEventListener("input", (e) => { e.target.style.height = "auto"; e.target.style.height = Math.min(e.target.scrollHeight, 140) + "px"; });
$("#send").onclick = () => send($("#draft").value);
$("#draft").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send($("#draft").value); } });

// ---------------------------------------------------------------- start
renderChat(); renderChip(); renderResults(); renderMapControls(); renderLegend(); renderBadge();
fetch(API + "/api/health").then((r) => r.json()).then((h) => { S.health = h; renderBadge(); }).catch(() => { S.offline = true; renderBadge(); });
loadSettings();
initMap();
