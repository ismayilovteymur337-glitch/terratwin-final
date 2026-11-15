/* Meridian ⇄ TerraTwin portal.
   "Mars 3D" opens the TerraTwin explorer in a full-screen layer above the Earth map, so the
   Earth analysis (chat, results, map position) is still there when you come back.
   "Back to Earth" — TerraTwin's own button, the button in this layer, the browser Back button —
   hides the layer and tells TerraTwin to stop rendering, so the 3D globe costs no GPU while
   you work on Earth. Opening it again resumes instantly instead of reloading. */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const portal = $("mars-portal"), frame = $("mars-frame"), status = $("mars-status"),
    statusText = $("mars-status-text"), floatBtn = $("earth-float"), openBtn = $("mars-open");
  if (!portal || !frame || !openBtn) return;

  let marsUrl = null, marsOrigin = null, loaded = false, ready = false, open = false, fallbackTimer = 0;

  function defaultMarsUrl() {
    const host = location.hostname || "localhost";
    return `${location.protocol === "https:" ? "https:" : "http:"}//${host}:5173/`;
  }
  async function resolveMarsUrl() {
    if (marsUrl) return marsUrl;
    let u = null;
    try {
      const h = await fetch("/api/health", { cache: "no-store" }).then((r) => r.json());
      if (h && typeof h.mars_url === "string" && /^https?:\/\//i.test(h.mars_url)) u = h.mars_url;
    } catch (e) { /* server default below */ }
    marsUrl = u || defaultMarsUrl();
    marsOrigin = new URL(marsUrl).origin;
    return marsUrl;
  }

  function post(type) {
    if (!loaded || !frame.contentWindow || !marsOrigin) return;
    try { frame.contentWindow.postMessage({ type, source: "meridian" }, marsOrigin); } catch (e) { /* ignore */ }
  }

  function setStatus(text, showBack) {
    statusText.textContent = text;
    status.hidden = false;
    status.classList.toggle("with-back", !!showBack);
  }

  async function reachable(url) {
    // no-cors: an opaque response still proves something is listening on that port.
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 4000);
    try { await fetch(url, { mode: "no-cors", cache: "no-store", signal: ctl.signal }); return true; }
    catch (e) { return false; }
    finally { clearTimeout(t); }
  }

  async function openMars(push) {
    if (open) return;
    open = true;
    document.body.classList.add("on-mars");
    portal.hidden = false;
    requestAnimationFrame(() => portal.classList.add("shown"));
    if (push !== false && location.hash !== "#mars") history.pushState({ mars: true }, "", "#mars");

    if (loaded) { post("meridian:resume"); return; }

    setStatus("Travelling to Mars…", false);
    const url = await resolveMarsUrl();
    if (!(await reachable(url))) {
      setStatus(`The TerraTwin Mars server is not running at ${url}. Start it with start-all.cmd (or "npm run dev" in the terratwin folder), then press Mars 3D again.`, true);
      open = true;
      return;
    }
    const u = new URL(url);
    u.searchParams.set("embed", "meridian");
    u.searchParams.set("earth", location.origin + location.pathname);
    frame.src = u.toString();
    loaded = true;
    // Older TerraTwin builds don't announce themselves; give them our own Back button.
    clearTimeout(fallbackTimer);
    fallbackTimer = setTimeout(() => { if (!ready) { status.hidden = true; floatBtn.hidden = false; } }, 9000);
  }

  function closeMars(fromPop) {
    if (!open) return;
    open = false;
    post("meridian:pause");
    portal.classList.remove("shown");
    document.body.classList.remove("on-mars");
    setTimeout(() => { if (!open) portal.hidden = true; }, 380);
    if (!fromPop && location.hash === "#mars") history.back();
    // If the Mars server was unreachable, try again from scratch next time.
    if (!ready && !status.hidden && status.classList.contains("with-back")) { loaded = false; frame.removeAttribute("src"); }
    // Leaflet needs to re-measure after being covered.
    setTimeout(() => window.dispatchEvent(new Event("resize")), 400);
  }

  /* Earth Analog Finder (TerraTwin) → "Show on the Earth map": fly there and mark the place. */
  let focusMarker = null;
  function focusEarth(lat, lon, label, attempt) {
    lat = Number(lat); lon = Number(lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return;
    const m = typeof map !== "undefined" ? map : null; // Leaflet map created by app.js
    if (!m || typeof L === "undefined") {
      if ((attempt || 0) < 40) setTimeout(() => focusEarth(lat, lon, label, (attempt || 0) + 1), 250);
      return;
    }
    if (focusMarker) focusMarker.remove();
    const div = document.createElement("div");
    div.textContent = String(label || "Earth analog").slice(0, 120);
    focusMarker = L.circleMarker([lat, lon], { radius: 9, color: "#fff", weight: 2, fillColor: "#d9532f", fillOpacity: 0.95 })
      .addTo(m).bindPopup(div, { closeButton: true }).openPopup();
    m.flyTo([lat, lon], Math.max(m.getZoom(), 6), { duration: 1.2 });
  }
  const hashFocus = /^#focus=(-?[\d.]+),(-?[\d.]+),?(.*)$/.exec(location.hash);
  if (hashFocus) {
    let name = "";
    try { name = decodeURIComponent(hashFocus[3] || ""); } catch (e) { name = ""; }
    focusEarth(hashFocus[1], hashFocus[2], name);
    history.replaceState(null, "", location.pathname + location.search);
  }

  openBtn.addEventListener("click", () => openMars(true));
  portal.addEventListener("click", (e) => { if (e.target.closest("[data-earth]")) closeMars(false); });
  window.addEventListener("popstate", () => {
    if (location.hash === "#mars") openMars(false); else closeMars(true);
  });
  window.addEventListener("message", (e) => {
    if (!marsOrigin || e.origin !== marsOrigin || !e.data || typeof e.data !== "object") return;
    if (e.data.type === "terratwin:ready") {
      ready = true; clearTimeout(fallbackTimer); status.hidden = true; floatBtn.hidden = true;
      if (!open) post("meridian:pause");
    } else if (e.data.type === "terratwin:return-earth") {
      closeMars(false);
    } else if (e.data.type === "terratwin:show-earth") {
      const { lat, lon, label } = e.data;
      closeMars(false);
      setTimeout(() => focusEarth(lat, lon, label), 420);
    }
  });
  // Pause Mars rendering when the whole tab is in the background, too.
  document.addEventListener("visibilitychange", () => {
    if (!open) return;
    post(document.hidden ? "meridian:pause" : "meridian:resume");
  });
  if (location.hash === "#mars") openMars(false);
})();
