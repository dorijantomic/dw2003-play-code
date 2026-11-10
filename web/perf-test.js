// web/perf-test.js - the speed test page (perf-test.html). DEV ONLY: nothing in the game loads this.
//
// It runs the REAL game (index.html in a same-origin iframe, the whole window) and measures scene after scene:
// 2 s warm-up, then 10 s measured. Between scenes it flips ONE suspect from docs/firefox-performance-audit.md and
// puts it back. Everything it flips is either an existing game switch (window.__fx.*, window.__noGrass3d, window.__noWater3d,
// the devicePixelRatio of the iframe window (the tree-sway suspect is NOT switched: it is being removed from the game), arenaDebug through __battle3d.setArenaDebug) or one of the dev-only hooks added
// for this page (all unset = the game plays exactly as before):
//   window.__perfHook(updateMs, renderMs)        web/game.js frame()          times update() and render() per game frame
//   window.__perfHook3d(name, ms, n)             web/battle3d.js              arena cull+upload loop, fighter vertex uploads
//   window.__perfNoFilter                        web/game.js drawEntitySprite  skip ctx.filter (wet look / water mirror), draws stay
// The results go to tools/perf-receiver.mjs (POST /results) and are written outside the repo.
//
// SAFETY: the game writes its save into localStorage of this origin. This page copies ALL of localStorage first (sessionStorage +
// the receiver's /backup file), seeds a throw-away party, and puts the copy back at the end (or on the next load of this page).
// Open the page on a different host name than you play on (127.0.0.1 vs localhost) and your own save is never touched at all.

const WARM_MS = 2000;
const MEASURE_MS = 10000;
const PROBE_MS = 2500;          // short extra pass (after the measured window) that counts canvas calls per second
const SETTLE_MS = 5000;         // after a map loads: the map, tiles and grass/water builds finish before scene 1
const AUTO = /(^|[#&,])auto($|[&,=])/.test(location.hash);   // open perf-test.html#auto: starts by itself
const QUICK = /(^|[#&,])quick($|[&,=])/.test(location.hash);   // #quick: Central Park field + battle, settings High only
const FILL = /(^|[#&,])fill($|[&,=])/.test(location.hash);     // #fill: game gets the "window-fill" class (as the F key does, fullscreen.js setWindowFill) so the field canvas takes stage size
const BOTH = /(^|[#&,])both($|[&,=])/.test(location.hash);     // #both: with #quick, run every scene in both variants (off and on)
const FXSWEEP = /(^|[#&,])fxsweep($|[&,=])/.test(location.hash);   // #fxsweep: with #quick #nobattle, a-normal, then one scene per Detail/effect key of variant "on" with only that key forced off, then a-normal-2
const CENSUS = /(^|[#&,])census($|[&,=])/.test(location.hash);   // #census: with #fill #quick #nobattle, one field scene; counts every 2D call on the game main canvas per call site (groups[].census)
const CUT = /(^|[#&,])cut($|[&,=])/.test(location.hash);   // #cut: with #fill #quick #nobattle, cut-none, then cut-1..cut-12 (game.js render() returns early at that checkpoint via window.__perfCut), then cut-none again
const CUT_LABELS = {
    1: "after camera, stage-tick set-up and the clear (before the zoom save)",
    2: "after the stage ticks (tickNativeStage, paceStageObjects)",
    3: "after the map pictures (layer 2 / base map, scroll layers)",
    4: "after under-map effects, ground picture, seam patch, tree patch",
    5: "after 3D water",
    6: "after 3D grass (blades only queued; drawn in cut 8)",
    7: "after every drawable is collected and sorted, before any is drawn",
    8: "after the y-sorted drawables loop and front quest fx",
    9: "after ambience/weather particles and debug records",
    10: "after cutscene effects, bubbles, ladders, fishing, editor overlays (end of the zoomed field)",
    11: "after the zoom restore and the wide side covers",
    12: "after all field UI / menus / HUD, before fades",
};
const SWEEP_WARM_MS = 1500, SWEEP_MEASURE_MS = 5000;   // shorter window for the sweep scenes (no canvas-call probe)
const CLOSE = /(^|[#&,])close($|[&,=])/.test(location.hash);   // #close: close the window when the run is done (test profile sets dom.allow_scripts_to_close_windows)
const BACKUP_KEY = "perfTestBackup";
const GAME_URL = (map) => `index.html?skipTitle=1&noEncounters=1&map=${map}`;

// ---- what to run. "set" names are applied by apply() below and undone by undo().
const FIELD_A = {   // Central Park: 28.8% grass pixels, 27.9% water pixels, open air, canopies, RAINY (rain draws), 1664x1280 map
    map: "s330", mapNote: "Central Park (grass + water + trees + rain)",
    scenes: [
        { id: "a-normal", label: "field normal (clear, day)", weather: "clear" },
        { id: "a-nogradient", label: "every canvas gradient replaced by transparent (TEST ONLY, look changes)", weather: "clear", set: ["noGradient"] },
        { id: "a-hd1x", label: "HD canvas at 1x instead of dpr", weather: "clear", set: ["dpr1"] },
        { id: "a-grass-off", label: "3D grass off", weather: "clear", set: ["noGrass"] },
        { id: "a-water-off", label: "3D water off", weather: "clear", set: ["noWater"] },
        { id: "a-filter-off", label: "sprite ctx.filter off (clear: only the water mirror filter can fire)", weather: "clear", set: ["noFilter"] },
        { id: "a-normal-2", label: "field normal again (drift check)", weather: "clear" },
        { id: "a-rain", label: "field normal, rain on", weather: "always" },
        { id: "a-rain-filter-off", label: "rain, sprite ctx.filter off (wet look + mirror)", weather: "always", set: ["noFilter"] },
        { id: "a-rain-hd1x", label: "rain, HD canvas at 1x", weather: "always", set: ["dpr1"] },
    ],
    battles: [
        { id: "a-battle", label: "battle normal (arena of Central Park)", mapId: "s330" },
        { id: "a-battle-grass-off", label: "battle, 3D grass off", mapId: "s330", set: ["noGrass"] },
        { id: "a-battle-grass-water-off", label: "battle, 3D grass + 3D water off", mapId: "s330", set: ["noGrass", "noWater"] },
        { id: "a-battle-grass-filter-off", label: "battle, 3D grass off + sprite ctx.filter off", mapId: "s330", set: ["noGrass", "noFilter"] },
        { id: "a-battle-nocull", label: "battle, arena cull + index upload path off (look changes: back faces drawn)", mapId: "s330", set: ["noCull"] },
    ],
};
const FIELD_B = {   // Pelche Oasis: sandy (heat shimmer + sepia wet look), water, open air
    map: "s560", mapNote: "Pelche Oasis (sand heat shimmer + water)",
    scenes: [
        { id: "b-normal", label: "sand map normal (clear, day)", weather: "clear" },
        { id: "b-heat-off", label: "heat shimmer off", weather: "clear", set: ["noHeat"] },
        { id: "b-water-off", label: "3D water off", weather: "clear", set: ["noWater"] },
        { id: "b-sand", label: "sand map, sandstorm on", weather: "always" },
        { id: "b-sand-filter-off", label: "sandstorm, sprite ctx.filter off (sepia look)", weather: "always", set: ["noFilter"] },
        { id: "b-sand-heat-off", label: "sandstorm, heat shimmer off", weather: "always", set: ["noHeat"] },
    ],
    battles: [
        { id: "b-battle", label: "battle normal (arena of Pelche Oasis)", mapId: "s560" },
    ],
};

// ---- the two OPTIONS states every scene runs in (set in memory for the run only; see applySettings)
// off = OPTIONS -> SCREEN -> Detail "Original" (the 35 detail keys off, quality low) and Pixel filter off.
// on  = Detail "High" (the 35 detail keys on, quality high) + every EFFECTS-page switch on + Pixel filter "xBR 4x, blended"
//       (the heaviest filter the OPTIONS row offers). Time of day and Weather are set by each scene, so they are not part of it.
// Keys copied from web/options-model.js DETAIL_KEYS and EFFECT_CATEGORIES (checked by node, see the report).
const DETAIL_KEYS = ["sway", "grass", "grasspush", "water", "reflect", "mirror", "wetlook", "seam", "rain", "rainwater", "snow", "sand", "lightning", "gusts", "breath", "frost", "screenfx", "tod", "nightlight", "clouds", "lamps", "lightpool", "lightreveal", "indoor", "fog", "shafts", "heat", "sparkle", "pollen", "leaves", "fireflies", "devils", "steps", "puddles", "uisharp"];
const EFFECT_ONLY_KEYS = ["sound", "ambience", "musicfx", "footsteps"];   // the Sound category of EFFECTS
const QUEST_KEYS = ["quests", "questtriggers", "questemotes", "questplacecard", "questsecondjob"];   // OPTIONS -> GAME -> Quests
const VARIANTS = {
    off: { label: "settings off (Detail Original, pixel filter off)", values: { ...Object.fromEntries(DETAIL_KEYS.map((k) => [k, false])), quality: "low", spriteFilter: "off" } },
    on: { label: "settings on (Detail High, all EFFECTS on, quality high, pixel filter xBR blended)", values: { ...Object.fromEntries([...DETAIL_KEYS, ...EFFECT_ONLY_KEYS, ...QUEST_KEYS].map((k) => [k, true])), quality: "high", spriteFilter: "xbrblend" } },
};
// a scene that switches a feature off is a no-op when Detail Original already has that feature off
const NOOP_WHEN_OFF = new Set(["noGrass", "noWater", "noFilter", "noHeat"]);

// ---- small helpers
const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const logEl = () => $("log");
function log(msg) { const el = logEl(); el.textContent += msg + "\n"; el.scrollTop = el.scrollHeight; }
function status(msg) { $("status").textContent = msg; }
async function waitFor(fn, ms, what) {
    const t0 = performance.now();
    for (;;) {
        let v = null;
        try { v = fn(); } catch { /* not ready */ }
        if (v) return v;
        if (performance.now() - t0 > ms) throw new Error("timeout waiting for " + what);
        await sleep(100);
    }
}
function stats(arr) {
    const n = arr.length;
    if (!n) return { n: 0 };
    const s = Float64Array.from(arr).sort();
    const sum = s.reduce((a, b) => a + b, 0);
    const at = (p) => s[Math.min(n - 1, Math.max(0, Math.ceil(p * n) - 1))];
    const r = (v) => Math.round(v * 1000) / 1000;
    return { n, avg: r(sum / n), median: r(n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2), p95: r(at(0.95)), p99: r(at(0.99)), worst: r(s[n - 1]), best: r(s[0]), sum: r(sum) };
}
function browserName(ua) {
    if (/Firefox\//.test(ua)) return "firefox";
    if (/Edg\//.test(ua)) return "edge";
    if (/Chrome\//.test(ua)) return "chrome";
    if (/Safari\//.test(ua)) return "safari";
    return "browser";
}
function glInfo() {
    const out = { renderer: null, vendor: null, version: null, unmaskedRenderer: null, unmaskedVendor: null, webgl2: false };
    try {
        const c = document.createElement("canvas");
        let gl = c.getContext("webgl2"); out.webgl2 = !!gl;
        if (!gl) gl = c.getContext("webgl");
        if (!gl) return out;
        out.renderer = gl.getParameter(gl.RENDERER); out.vendor = gl.getParameter(gl.VENDOR); out.version = gl.getParameter(gl.VERSION);
        const ext = gl.getExtension("WEBGL_debug_renderer_info");
        if (ext) { out.unmaskedRenderer = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL); out.unmaskedVendor = gl.getParameter(ext.UNMASKED_VENDOR_WEBGL); }
    } catch (e) { out.error = String(e); }
    out.renderString = out.unmaskedRenderer || out.renderer;
    return out;
}

// ---- localStorage safety
function takeBackup() {
    const all = {};
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); all[k] = localStorage.getItem(k); }
    sessionStorage.setItem(BACKUP_KEY, JSON.stringify(all));
    return all;
}
function restoreBackup() {
    const raw = sessionStorage.getItem(BACKUP_KEY);
    if (raw == null) return false;
    const all = JSON.parse(raw);
    localStorage.clear();
    for (const [k, v] of Object.entries(all)) localStorage.setItem(k, v);
    sessionStorage.removeItem(BACKUP_KEY);
    return true;
}
const LEAD = { digimonId: 1, level: 20, xp: 0, tp: 10, hp: 900, maxHp: 900, mp: 300, maxMp: 300, stats: { str: 99, def: 99, spt: 99, wis: 99, spd: 99, chr: 99 }, bonuses: {}, elemBonuses: {} };
function seedStorage(mode) {
    localStorage.clear();
    localStorage.setItem("assetMode", mode);
    localStorage.setItem("engineSchema", "2");
    localStorage.setItem("charId", "p003pken");
    localStorage.setItem("party", JSON.stringify(["p003pken"]));
    localStorage.setItem("partnerStats", JSON.stringify(LEAD));
    localStorage.setItem("partyStats", JSON.stringify([LEAD]));
    localStorage.setItem("rosterOwned", "1");
}

// ---- the run
const run = { iw: null, frame: null, rec: null, frameTimes: null, prevT: 0, walk: null, cat: [], saved: null, stamps: [], lastRafAt: 0, guard: null, recv: "", minStep: Infinity, ctxTypes: new WeakMap(), gcHooked: new WeakSet(), layerFrames: null };

// ---- stall guard. A hidden / covered / minimised window makes the browser stop (or nearly stop) requestAnimationFrame while timers
// still run. The page's own rAF loop keeps `stamps` (performance.now() of each frame, last 3 s) and a watchdog timer checks it.
const STALL_GAP_MS = 250, STALL_FPS = 20, FLOW_FPS = 50, FLOW_MS = 2000, MAX_TRIES = 3, FLOW_GIVEUP_MS = 600000;
function rafFpsOver(ms) {
    const now = performance.now();
    let n = 0;
    for (let i = run.stamps.length - 1; i >= 0 && now - run.stamps[i] <= ms; i--) n++;
    return n / (ms / 1000);
}
function rafLoop(now) {
    if (run.prevT && run.frameTimes) run.frameTimes.push(now - run.prevT);
    if (run.layerFrames) {   // battle 3D layer canvas (web/battle-layer.js sets dataset.battleLayer = "1"): shown / hidden / missing at this rAF
        let c = null;
        try { c = run.iw && run.iw.document.querySelector('canvas[data-battle-layer="1"]'); } catch { c = null; }
        if (!c) run.layerFrames.missing++;
        else if (c.style.visibility === "hidden") run.layerFrames.hidden++;
        else run.layerFrames.shown++;
    }
    if (run.prevT) { const d = now - run.prevT; if (d > 0 && d < run.minStep) run.minStep = d; }
    run.prevT = now;
    const t = performance.now();
    run.lastRafAt = t;
    run.stamps.push(t);
    while (run.stamps.length && t - run.stamps[0] > 3000) run.stamps.shift();
    requestAnimationFrame(rafLoop);
}
function guardStart(label) {
    const g = { label, stalled: false, reason: null, t0: performance.now(), timer: null };
    g.timer = setInterval(() => {
        if (g.stalled || QUICK) return;   // quick run: a slow game is the measurement, not a stall
        const now = performance.now();
        const since = now - Math.max(run.lastRafAt, g.t0);
        let why = null;
        if (since > STALL_GAP_MS) why = "rAF gap " + Math.round(since) + " ms (> " + STALL_GAP_MS + ")";
        else if (now - g.t0 >= 1000 && rafFpsOver(1000) < STALL_FPS) why = "rAF fps " + Math.round(rafFpsOver(1000)) + " (< " + STALL_FPS + ") over 1 s";
        if (why) { g.stalled = true; g.reason = why; }
    }, 100);
    run.guard = g;
    return g;
}
function guardStop(g) { clearInterval(g.timer); if (run.guard === g) run.guard = null; }
// wait until rAF runs at >= FLOW_FPS for FLOW_MS (a window that is hidden may never come back: gives up after FLOW_GIVEUP_MS)
async function waitForFlow(why) {
    if (QUICK) return;
    const t0 = performance.now();
    let announced = false;
    for (;;) {
        const now = performance.now();
        if (now - t0 >= FLOW_MS && now - run.lastRafAt < 100 && rafFpsOver(FLOW_MS) >= FLOW_FPS) return true;
        if (now - t0 > FLOW_GIVEUP_MS) { log("  frames did not come back within " + FLOW_GIVEUP_MS / 1000 + " s"); return false; }
        if (!announced && now - t0 > 1500) { announced = true; status("waiting for frames (" + why + "), window " + document.visibilityState); progress({ id: "-", status: "waiting-for-frames", note: why, visibility: document.visibilityState, focus: document.hasFocus() }); }
        await sleep(200);
    }
}
function progress(obj) {
    if (!run.recv) return;
    try { fetch(run.recv + "/progress", { method: "POST", body: JSON.stringify({ at: new Date().toISOString(), ...obj }) }).catch(() => {}); } catch { /* ignore */ }
}
// smallest non-zero step of performance.now() (spin 30 ms) and of rAF timestamps seen so far
function timerPrecision() {
    let minStep = Infinity, last = performance.now(), n = 0;
    const end = last + 30;
    while (last < end && n < 5e6) { const t = performance.now(); n++; if (t > last && t - last < minStep) minStep = t - last; last = t; }
    return { minNonZeroStepMs: Number.isFinite(minStep) ? minStep : null, method: "30 ms spin of performance.now()", spinCalls: n };
}

// canvas -> context type ("2d", "webgl", "webgl2", ...), filled by wrapping getContext as early as the new iframe window exists.
// Returns exactly what the original returns; only a non-null context is recorded (a failed getContext("webgl2") on a 2d canvas does not overwrite).
function hookContextTypes(iw) {
    if (!iw || run.gcHooked.has(iw)) return;
    try {
        for (const Ctor of [iw.HTMLCanvasElement, iw.OffscreenCanvas]) {
            if (!Ctor || !Ctor.prototype || !Ctor.prototype.getContext) continue;
            const orig = Ctor.prototype.getContext;
            Ctor.prototype.getContext = function (type, ...a) {
                const ctx = orig.call(this, type, ...a);
                if (ctx && !run.ctxTypes.has(this)) run.ctxTypes.set(this, String(type));
                return ctx;
            };
        }
        run.gcHooked.add(iw);
    } catch { /* window not ready yet: the poller tries again */ }
}
// after the iframe is pointed at the game: poll (every ms) for the new window and hook it before its modules run; stops when the load event fired
function watchFrameForEarlyHook(frame) {
    let on = true;
    const tick = () => {
        if (!on) return;
        try {
            const w = frame.contentWindow;
            if (w && w.location.href !== "about:blank") hookContextTypes(w);
        } catch { /* mid navigation */ }
        setTimeout(tick, 1);
    };
    tick();
    return () => { on = false; };
}

function installHooks(iw) {
    hookContextTypes(iw);   // late safety net: no-op when the early hook already ran on this window
    iw.__perfHook = (u, r) => {
        const rec = run.rec; if (!rec) return;
        const t = performance.now();
        if (rec.last) rec.gap.push(t - rec.last);
        rec.last = t; rec.upd.push(u); rec.ren.push(r);
    };
    iw.__perfHook3d = (name, ms, n) => {
        const rec = run.rec; if (!rec) return;
        const h = rec.h3[name] || (rec.h3[name] = { ms: [], n: [] });
        h.ms.push(ms); h.n.push(n);
    };
    // catalog of every canvas / offscreen canvas that asks for a context from now on (best effort: ones made before load are missed)
    run.cat = [];
    const seen = new Set();
    for (const [Ctor, kind] of [[iw.HTMLCanvasElement, "canvas"], [iw.OffscreenCanvas, "offscreen"]]) {
        if (!Ctor) continue;
        const orig = Ctor.prototype.getContext;
        Ctor.prototype.getContext = function (type, ...a) {
            const ctx = orig.call(this, type, ...a);
            const key = this; if (!seen.has(key)) { seen.add(key); run.cat.push({ kind, type: String(type), el: this }); }
            return ctx;
        };
    }
}
function canvasReport(iw) {
    const rows = [];
    for (const c of iw.document.querySelectorAll("canvas")) {
        rows.push({ where: "dom", id: c.id || null, cls: c.className || null, w: c.width, h: c.height, cssW: c.clientWidth, cssH: c.clientHeight, hidden: c.offsetParent === null });
    }
    for (const e of run.cat) {
        if (e.el.isConnected) continue;
        rows.push({ where: "detached-" + e.kind, ctx: e.type, w: e.el.width, h: e.el.height });
    }
    return rows;
}

// the per-second count of canvas calls (a separate pass AFTER the measured window so the wrappers never touch the numbers)
async function probeCalls(iw) {
    const proto = iw.CanvasRenderingContext2D.prototype;
    const names = ["drawImage", "fillRect", "fill", "stroke", "createRadialGradient", "createLinearGradient", "getImageData", "putImageData", "save", "arc"];
    const counts = {}, orig = {};
    const wgl = { calls: 0, ms: 0, worst: 0, sizes: new Map() }, unk = { calls: 0, sizes: new Map() }, decided = new WeakMap();
    const ms = {}, bySrc = {};   // time spent per call name, and drawImage time per source kind/size/filter
    const srcKind = (s) => {
        const c = s && s.constructor && s.constructor.name || "?";
        let ctx = "";
        if (c === "HTMLCanvasElement" || c === "OffscreenCanvas") ctx = s.__perfCtx || (s.__perfCtx = (() => { try { return s.getContext("webgl2") ? "webgl2" : s.getContext("webgl") ? "webgl" : "2d"; } catch { return "2d?"; } })());
        return c + (ctx ? ":" + ctx : "") + " " + (s.width || s.naturalWidth || 0) + "x" + (s.height || s.naturalHeight || 0);
    };
    for (const n of names) {
        counts[n] = 0; ms[n] = 0; orig[n] = proto[n];
        proto[n] = function (...a) {
            counts[n]++;
            let kind = null;   // "webgl" / "unknown" for canvas sources, decided from the recorded type BEFORE srcKind() may probe the canvas
            if (n === "drawImage") {
                const s0 = a[0], cn = s0 && s0.constructor && s0.constructor.name;
                if (cn === "HTMLCanvasElement" || cn === "OffscreenCanvas") {
                    kind = decided.get(s0);
                    if (!kind) { const ty = run.ctxTypes.get(s0); kind = ty ? (ty.startsWith("webgl") ? "webgl" : "other") : "unknown"; decided.set(s0, kind); }
                }
            }
            const t = performance.now();
            const r = orig[n].apply(this, a);
            const d = performance.now() - t;
            ms[n] += d;
            if (kind === "webgl" || kind === "unknown") {
                const key = (a[0].width || 0) + "x" + (a[0].height || 0);
                if (kind === "webgl") { wgl.calls++; wgl.ms += d; if (d > wgl.worst) wgl.worst = d; wgl.sizes.set(key, (wgl.sizes.get(key) || 0) + 1); }
                else { unk.calls++; unk.sizes.set(key, (unk.sizes.get(key) || 0) + 1); }
            }
            if (n === "drawImage") {
                const k = srcKind(a[0]) + (this.filter && this.filter !== "none" ? " +filter" : "") + " -> " + this.canvas.width + "x" + this.canvas.height;
                const b = bySrc[k] || (bySrc[k] = { calls: 0, ms: 0 });
                b.calls++; b.ms += d;
            }
            return r;
        };
    }
    const fdesc = Object.getOwnPropertyDescriptor(proto, "filter");
    counts.filterSet = 0;
    if (fdesc && fdesc.set) Object.defineProperty(proto, "filter", { ...fdesc, set(v) { if (v && v !== "none") counts.filterSet++; return fdesc.set.call(this, v); } });
    const t0 = performance.now();
    let frames = 0;
    run.layerFrames = { shown: 0, hidden: 0, missing: 0 };
    const hook = iw.__perfHook;
    iw.__perfHook = (u, r) => { frames++; hook?.(u, r); };
    await sleep(PROBE_MS);
    const layer = run.layerFrames; run.layerFrames = null;
    iw.__perfHook = hook;
    const secs = (performance.now() - t0) / 1000;
    for (const n of names) proto[n] = orig[n];
    if (fdesc) Object.defineProperty(proto, "filter", fdesc);
    const per = {};
    for (const n of Object.keys(counts)) per[n + "_perGameFrame"] = frames ? Math.round(counts[n] / frames * 10) / 10 : null;
    const r2 = (x) => Math.round(x * 100) / 100;
    const msPer = {};
    for (const n of names) msPer[n + "_msPerGameFrame"] = frames ? r2(ms[n] / frames) : null;
    const drawImageBySource = Object.entries(bySrc).map(([k, b]) => ({ source: k, callsPerGameFrame: frames ? r2(b.calls / frames) : null, msPerGameFrame: frames ? r2(b.ms / frames) : null }))
        .sort((a, b) => (b.msPerGameFrame || 0) - (a.msPerGameFrame || 0)).slice(0, 25);
    const sizeList = (m) => [...m.entries()].map(([size, calls]) => ({ size, calls }));
    const webglDrawImage = {
        calls: wgl.calls, callsPerGameFrame: frames ? r2(wgl.calls / frames) : null, msPerGameFrame: frames ? r2(wgl.ms / frames) : null,
        msPerCall: wgl.calls ? r2(wgl.ms / wgl.calls) : null, worstCallMs: r2(wgl.worst), sourceSizes: sizeList(wgl.sizes),
    };
    const unknownCanvasDrawImage = { calls: unk.calls, callsPerGameFrame: frames ? r2(unk.calls / frames) : null, sourceSizes: sizeList(unk.sizes) };
    return { seconds: r2(secs), gameFrames: frames, perGameFrame: per, msPerGameFrame: msPer, drawImageBySource,
        webglDrawImage, unknownCanvasDrawImage, battleLayerShownFrames: layer.shown, battleLayerHiddenFrames: layer.hidden, battleLayerMissingFrames: layer.missing };
}

// ---- switches
const FX_KEYS = ["grass", "water", "sway", "heat", "wetlook", "mirror", "reflect", "rain", "sand", "tod", "lamps", "fog", "weatherMode", "todMode", "widefield", "hd2d", "battleatmos", "battlepano"];
// Settings go into the running game only. setFxMany() (web/ambience.js) also writes localStorage "dw.fx.v1"; that key is removed
// again at once, and the whole localStorage is wiped/restored by this page anyway, so nothing reaches the player's saved settings.
function applySettings(iw, name) {
    iw.__setFxMany({ ...VARIANTS[name].values });
    iw.localStorage.removeItem("dw.fx.v1");
}
function applyScene(iw, scene) {
    const undo = [];
    const fx = iw.__fx;
    const setFx = (k, v) => { const old = fx[k]; fx[k] = v; undo.push(() => { fx[k] = old; }); };
    const setWin = (k, v) => { const had = Object.prototype.hasOwnProperty.call(iw, k), old = iw[k]; iw[k] = v; undo.push(() => { if (had) iw[k] = old; else delete iw[k]; }); };
    if (scene.weather) setFx("weatherMode", scene.weather);
    if (scene.cut != null) setWin("__perfCut", scene.cut);   // #cut: game.js render() stops at that checkpoint
    if (!run.noPin) setWin("__todForce", 0);   // day, so the clock does not change the scene
    for (const s of scene.set || []) {
        if (s === "dpr1") {
            const d = Object.getOwnPropertyDescriptor(iw, "devicePixelRatio");
            Object.defineProperty(iw, "devicePixelRatio", { configurable: true, get: () => 1 });
            undo.push(() => { if (d) Object.defineProperty(iw, "devicePixelRatio", d); else delete iw.devicePixelRatio; iw.__fieldCanvasResolution?.markDirty(); });
            iw.__fieldCanvasResolution?.markDirty();
        } else if (s === "noGrass") setWin("__noGrass3d", true);
        else if (s === "noWater") setWin("__noWater3d", true);
        else if (s === "noFilter") setWin("__perfNoFilter", true);
        else if (s === "noHeat") setFx("heat", false);
        else if (s === "noGradient") {   // TEST ONLY: every canvas gradient assigned to fillStyle/strokeStyle becomes transparent
            const proto = iw.CanvasRenderingContext2D.prototype, G = iw.CanvasGradient, counter = { n: 0 };
            run.gradients = counter;
            for (const prop of ["fillStyle", "strokeStyle"]) {
                const d = Object.getOwnPropertyDescriptor(proto, prop);
                Object.defineProperty(proto, prop, { ...d, set(v) { if (v instanceof G) { counter.n++; v = "rgba(0,0,0,0)"; } return d.set.call(this, v); } });
                undo.push(() => Object.defineProperty(proto, prop, d));
            }
            undo.push(() => { run.gradients = null; });
        }
        else if (s === "noCull") {
            const r3 = iw.__battle3d;
            const before = { ...r3.setArenaDebug() };
            r3.setArenaDebug({ ...before, cull: false });
            undo.push(() => r3.setArenaDebug({ ...before }));
        } else throw new Error("unknown switch " + s);
    }
    return () => { for (const u of undo.reverse()) { try { u(); } catch { /* ignore */ } } };
}

function startWalking(iw) {
    stopWalking(iw);
    if (!$("walk").checked) return;
    let dir = 0;
    const keys = ["ArrowRight", "ArrowLeft"];
    const send = (type, key) => iw.dispatchEvent(new iw.KeyboardEvent(type, { key, code: key, bubbles: true }));
    const step = () => { if (run.walk?.held) send("keyup", run.walk.held); const key = keys[dir++ % 2]; run.walk.held = key; send("keydown", key); };
    run.walk = { held: null, timer: setInterval(step, 1500) };
    step();
}
function stopWalking(iw) {
    if (!run.walk) return;
    clearInterval(run.walk.timer);
    try { if (run.walk.held) iw.dispatchEvent(new iw.KeyboardEvent("keyup", { key: run.walk.held, code: run.walk.held, bubbles: true })); } catch { /* frame gone */ }
    run.walk = null;
}

// ---- #census: per-frame list of 2D calls on the game's main canvas, keyed by method | style | composite | filter | shadow | alpha | source | call site
const CENSUS_METHODS = ["fill", "fillRect", "stroke", "strokeRect", "drawImage", "fillText", "strokeText", "putImageData", "getImageData", "clip", "clearRect"];
const CENSUS_FILL = new Set(["fill", "fillRect", "fillText"]), CENSUS_STROKE = new Set(["stroke", "strokeRect", "strokeText"]);
function censusStart(iw) {
    const proto = iw.CanvasRenderingContext2D.prototype;
    const main = iw.document.querySelector("#stage canvas");
    const st = { proto, orig: {}, counts: new Map(), total: 0, main, gradTag: new WeakMap(), gradOrig: {} };
    if (!main) throw new Error("census: #stage canvas not found");
    for (const g of ["createLinearGradient", "createRadialGradient"]) {
        const o = proto[g]; st.gradOrig[g] = o;
        const kind = g === "createLinearGradient" ? "linear" : "radial";
        proto[g] = function (...a) { const r = o.apply(this, a); try { st.gradTag.set(r, kind); } catch { /* not an object */ } return r; };
    }
    const styleKind = (v) => {
        if (typeof v === "string") return "color";
        const t = st.gradTag.get(v); if (t) return "CanvasGradient(" + t + ")";
        return (v && v.constructor && v.constructor.name) || "?";
    };
    const srcKind = (s) => {
        if (s === main) return "MAIN-CANVAS " + main.width + "x" + main.height;
        const c = (s && s.constructor && s.constructor.name) || "?";
        let k = c;
        if (c === "HTMLCanvasElement" || c === "OffscreenCanvas") { const t = run.ctxTypes.get(s); k = c + ":" + (t || "none"); }
        return k + " " + (s.width || s.naturalWidth || 0) + "x" + (s.height || s.naturalHeight || 0);
    };
    const site = () => {
        const lines = String(new Error().stack || "").split(/\r?\n/);
        for (const l of lines) {
            if (!l || l.includes("perf-test.js")) continue;
            return l.replace(/^.*?@/, "").replace(/^.*\//, "").replace(/:(\d+)$/, "");
        }
        return "?";
    };
    for (const n of CENSUS_METHODS) {
        const o = proto[n]; st.orig[n] = o;
        proto[n] = function (...a) {
            try {
                if (this.canvas === main) {
                    const style = CENSUS_FILL.has(n) ? styleKind(this.fillStyle) : CENSUS_STROKE.has(n) ? styleKind(this.strokeStyle) : "-";
                    const key = [n, style, this.globalCompositeOperation, this.filter, this.shadowBlur > 0 ? "shadow" : "-", this.globalAlpha < 1 ? "alpha<1" : "-", n === "drawImage" ? srcKind(a[0]) : "-", site()].join(" | ");
                    st.counts.set(key, (st.counts.get(key) || 0) + 1); st.total++;
                }
            } catch { /* never break the game */ }
            return o.apply(this, a);
        };
    }
    return st;
}
function censusStop(st, frames) {
    for (const n of CENSUS_METHODS) st.proto[n] = st.orig[n];
    for (const g of Object.keys(st.gradOrig)) st.proto[g] = st.gradOrig[g];
    const f = Math.max(1, frames), r = (v) => Math.round(v / f * 1000) / 1000;
    return { frames, totalPerFrame: r(st.total), census: [...st.counts].map(([key, c]) => ({ key, perFrame: r(c) })).sort((a, b) => b.perFrame - a.perFrame).slice(0, 150) };
}

async function measureScene(iw, scene, extra = {}) {
    const variant = extra.variant || "on";
    const sid = scene.id + "|" + variant;
    const vis0 = { visibility: document.visibilityState, hasFocus: document.hasFocus() };
    const guard = guardStart(sid);
    status("running: " + scene.label + " [" + variant + "]");
    log("scene " + sid + ": " + scene.label + " [" + VARIANTS[variant].label + "]");
    let undo = () => {}, out;
    try {
        applySettings(iw, variant);
        if (scene.fxOff) { iw.__setFxMany({ [scene.fxOff]: false }); iw.localStorage.removeItem("dw.fx.v1"); }   // fxsweep: same mechanism as applySettings, one key forced off
        await sleep(1500);                    // effects rebuild after a settings change: not counted
        undo = applyScene(iw, scene);
        await sleep(scene.fxOff ? SWEEP_WARM_MS : WARM_MS);
        run.rec = { upd: [], ren: [], gap: [], h3: {}, last: 0 };
        run.frameTimes = [];
        if (run.gradients) run.gradients.n = 0;
        const t0 = performance.now();
        const censusSt = CENSUS ? censusStart(iw) : null;
        const stateStart = iw.__battle?.isActive?.() ? iw.__battleB?.()?.state : null;
        await sleep(scene.fxOff ? SWEEP_MEASURE_MS : MEASURE_MS);
        const wall = performance.now() - t0;
        const censusRes = censusSt ? censusStop(censusSt, run.rec.upd.length) : null;
        const gradientsReplaced = run.gradients ? run.gradients.n : undefined;
        const ft = run.frameTimes; run.frameTimes = null;
        const rec = run.rec;           // keep recording through the probe pass? no: stop here
        run.rec = null;
        const h3 = {};
        for (const [k, v] of Object.entries(rec.h3)) h3[k] = { calls: v.ms.length, perGameFrame: Math.round(v.ms.length / Math.max(1, rec.upd.length) * 100) / 100, ms: stats(v.ms), sizeLast: v.n[v.n.length - 1], totalMsPerGameFrame: Math.round(v.ms.reduce((a, b) => a + b, 0) / Math.max(1, rec.upd.length) * 1000) / 1000 };
        const probe = scene.fxOff ? null : await probeCalls(iw);
        const fxs = {}; for (const k of FX_KEYS) fxs[k] = iw.__fx?.[k];
        out = {
            id: sid, scene: scene.id, variant, variantLabel: VARIANTS[variant].label, label: scene.label, switchesOff: scene.set || [], weather: scene.weather || null, fxOff: scene.fxOff || null,
            wallMs: Math.round(wall),
            ...(gradientsReplaced !== undefined ? { gradientsReplaced } : {}),
            rafFrameMs: stats(ft), rafFramesOver16_7: ft.filter((v) => v > 16.7 * 1.5).length, rafFramesOver33: ft.filter((v) => v > 33.4).length, rafFramesOver50: ft.filter((v) => v > 50).length,
            rafFps: ft.length ? Math.round(ft.length / (ft.reduce((a, b) => a + b, 0) / 1000) * 10) / 10 : null,
            gameFrames: rec.upd.length, gameFrameGapMs: stats(rec.gap), gameUpdateMs: stats(rec.upd), gameRenderMs: stats(rec.ren),
            gameDrawPlusUpdateMs: stats(rec.upd.map((u, i) => u + rec.ren[i])),
            battle3dHooks: h3,
            ...(censusRes ? { census: censusRes } : {}),
            canvasCallsPerGameFrame: probe,
            canvases: canvasReport(iw),
            devicePixelRatio: { page: window.devicePixelRatio, gameWindow: iw.devicePixelRatio },
            fx: fxs, spriteFilter: iw.__fx?.spriteFilter, quality: iw.__fx?.quality, todForce: iw.__todForce ?? null,
            ambienceProfile: iw.__ambienceProfile?.(extra.map) || null,
            battleState: { start: stateStart, end: iw.__battle?.isActive?.() ? iw.__battleB?.()?.state : null },
            ...extra.fields,
        };
        out.minStepSeenMs = Number.isFinite(run.minStep) ? run.minStep : null;
    } catch (e) {
        out = { id: sid, scene: scene.id, variant, label: scene.label, error: String(e && e.stack || e) };
        log("  ERROR " + out.error);
    } finally {
        run.rec = null; run.frameTimes = null;
        undo();
        guardStop(guard);
    }
    out.stalled = guard.stalled; out.stallReason = guard.reason;
    out.visibilityStart = vis0.visibility; out.hasFocusStart = vis0.hasFocus;
    out.visibilityEnd = document.visibilityState; out.hasFocusEnd = document.hasFocus();
    if (out.rafFrameMs) log(`  raf frame ms: avg ${out.rafFrameMs.avg} median ${out.rafFrameMs.median} p95 ${out.rafFrameMs.p95} p99 ${out.rafFrameMs.p99} worst ${out.rafFrameMs.worst} (${out.rafFrameMs.n} frames, ${out.rafFps} fps)`);
    return out;
}

// run one scene up to MAX_TRIES times; a stalled try waits for frames to flow again, then reruns
async function measureGuarded(iw, scene, extra) {
    let out = null, tries = 0;
    const tryLog = [];
    while (tries < MAX_TRIES) {
        tries++;
        out = await measureScene(iw, scene, extra);
        tryLog.push({ try: tries, stalled: out.stalled, reason: out.stallReason, visibility: out.visibilityStart + "/" + out.visibilityEnd, hasFocus: out.hasFocusStart + "/" + out.hasFocusEnd });
        progress({ id: out.id, tries, status: out.stalled ? "stalled" : out.error ? "error" : "ok", reason: out.stallReason, visibility: out.visibilityEnd, focus: out.hasFocusEnd, rafFps: out.rafFps ?? null });
        if (!out.stalled) break;
        log("  STALLED (try " + tries + "): " + out.stallReason + "; window " + out.visibilityEnd + ", focus " + out.hasFocusEnd);
        if (tries >= MAX_TRIES) break;
        stopWalking(iw);
        await waitForFlow("scene " + out.id);
        startWalking(iw);
    }
    out.tries = tries; out.tryLog = tryLog;
    out.status = out.stalled ? "stalled" : out.error ? "error" : "ok";
    if (out.stalled) { out.stalledFinal = true; log("  recorded as stalled after " + tries + " tries: " + out.stallReason); }
    return out;
}

async function loadGame(map) {
    status("loading game on " + map);
    log("loading game, map " + map);
    stopWalking(run.iw);
    const frame = run.frame;
    frame.src = "about:blank";
    await sleep(500);                 // the old game is gone before the storage is rewritten
    seedStorage($("mode").value);
    let stopWatch = () => {};
    await new Promise((res) => { frame.addEventListener("load", res, { once: true }); frame.src = GAME_URL(map); stopWatch = watchFrameForEarlyHook(frame); });
    stopWatch();
    const iw = frame.contentWindow;
    log("  early getContext hook on game window: " + run.gcHooked.has(iw));
    run.iw = iw;
    installHooks(iw);
    await waitFor(() => iw.__state?.started && iw.__fx && iw.__fieldCanvasResolution, 120000, "game started");
    await waitFor(() => iw.__ambienceProfile?.(map), 120000, "map profile for " + map);
    if (FILL) {
        iw.document.documentElement.classList.add("window-fill");   // same as fullscreen.js setWindowFill(doc, true)
        iw.dispatchEvent(new iw.Event("resize"));
        log("fill: window-fill set, iframe " + run.frame.clientWidth + "x" + run.frame.clientHeight);
    }
    log("game running; settling " + SETTLE_MS + " ms");
    await sleep(SETTLE_MS);
    if (FILL) { const cv = iw.document.querySelector("#stage canvas"); log("fill: game canvas " + (cv ? cv.width + "x" + cv.height : "none")); }
    return iw;
}

async function startBattle(iw, mapId) {
    status("starting battle on " + mapId);
    log("starting battle on arena of " + mapId);
    stopWalking(iw);
    const t0 = performance.now();
    await iw.__battle.start({ enemyId: 1, enemyLevel: 5, mapId, onWin() {}, onFlee() {}, onLose() {} });
    await waitFor(() => iw.__battle.isActive() && iw.__battleB?.(), 30000, "battle active");
    // INTRO = 1, PLAYER_MENU = 2 (web/battle.js ST): confirm the intro lines until the command menu is up
    let reached = false;
    const press = (type) => iw.dispatchEvent(new iw.KeyboardEvent(type, { key: "Enter", code: "Enter", bubbles: true }));
    while (performance.now() - t0 < 45000) {
        const st = iw.__battleB?.()?.state;
        if (st === 2) { reached = true; break; }
        if (st === 1) { press("keydown"); await sleep(60); press("keyup"); }
        await sleep(400);
    }
    log("  command menu reached: " + reached);
    return { battleMenuReached: reached, secondsToMenu: Math.round((performance.now() - t0) / 100) / 10 };
}

async function main() {
    $("start").disabled = true;
    logEl().textContent = "";
    const results = { meta: null, groups: [], notes: [] };
    run.noPin = !$("pin").checked;
    const ua = navigator.userAgent;
    results.meta = {
        browser: browserName(ua), userAgent: ua, platform: navigator.platform, hardwareConcurrency: navigator.hardwareConcurrency,
        devicePixelRatio: window.devicePixelRatio, screen: { w: screen.width, h: screen.height, availW: screen.availWidth, availH: screen.availHeight },
        window: { innerW: innerWidth, innerH: innerHeight }, gl: glInfo(), startedAt: new Date().toISOString(),
        timing: { warmMs: WARM_MS, measureMs: MEASURE_MS, probeMs: PROBE_MS, settleMs: SETTLE_MS },
        variants: Object.fromEntries(Object.entries(VARIANTS).map(([k, v]) => [k, { label: v.label, values: v.values }])),
        timerPrecision: timerPrecision(), visibilityAtStart: document.visibilityState, hasFocusAtStart: document.hasFocus(), autostart: AUTO,
        ...(CUT ? { cutLabels: CUT_LABELS } : {}),
        options: { assetMode: $("mode").value, walking: $("walk").checked, dayPinned: !run.noPin }, page: location.href,
    };
    log("browser " + results.meta.browser + ", GL renderer: " + results.meta.gl.renderString);
    const recv = $("recv").value.replace(/\/+$/, "");
    run.recv = recv;
    progress({ id: "-", status: "run-start", browser: results.meta.browser, visibility: document.visibilityState, focus: document.hasFocus(), timerStepMs: results.meta.timerPrecision.minNonZeroStepMs });
    try {
        const saved = takeBackup();
        $("saved").textContent = "localStorage copy kept (" + Object.keys(saved).length + " keys). It is put back at the end.";
        fetch(recv + "/backup", { method: "POST", body: JSON.stringify({ origin: location.origin, at: new Date().toISOString(), localStorage: saved }) }).catch(() => {});
        run.frame = $("g");
        requestAnimationFrame(rafLoop);
        const variants = QUICK && !BOTH ? ["on"] : ["off", "on"];
        const groups = QUICK ? [{ ...FIELD_A, scenes: /(^|[#&,])battleonly($|[&,=])/.test(location.hash) ? [] : FIELD_A.scenes.filter((s) => ["a-normal", "a-nogradient", "a-grass-off", "a-water-off", "a-filter-off"].includes(s.id)), battles: /(^|[#&,])nobattle($|[&,=])/.test(location.hash) ? [] : FIELD_A.battles.filter((b) => ["a-battle", "a-battle-grass-off", "a-battle-grass-water-off", "a-battle-grass-filter-off"].includes(b.id)) }] : [FIELD_A, FIELD_B];
        if (FXSWEEP) {
            const an = FIELD_A.scenes.find((s) => s.id === "a-normal");
            const keys = Object.entries(VARIANTS.on.values).filter(([, v]) => v === true).map(([k]) => k);
            groups[0].scenes = [an, ...keys.map((k) => ({ id: "fx-" + k + "-off", label: "settings on, only " + k + " forced off", weather: "clear", fxOff: k })), { ...an, id: "a-normal-2", label: "field normal again (drift check)" }];
            log("fxsweep keys (" + keys.length + "): " + keys.join(", "));
        }
        if (CUT) {
            const an = FIELD_A.scenes.find((s) => s.id === "a-normal");
            groups[0].scenes = [{ ...an, id: "cut-none", label: "no cut (full frame)" }, ...Object.entries(CUT_LABELS).map(([n, t]) => ({ ...an, id: "cut-" + n, label: "cut " + n + ": " + t, cut: Number(n) })), { ...an, id: "cut-none-2", label: "no cut again (drift check)" }];
            log("cut checkpoints: " + Object.entries(CUT_LABELS).map(([n, t]) => n + "=" + t).join("; "));
        }
        if (CENSUS) {
            const an = FIELD_A.scenes.find((s) => s.id === "a-normal");
            groups[0].scenes = [{ ...an, id: "census", label: "field normal, 2D call census" }];
            groups[0].battles = [];
        }
        for (const G of groups) {
            const grp = { map: G.map, note: G.mapNote, scenes: [], error: null };
            results.groups.push(grp);
            try {
                let iw = null;
                for (let a = 1; a <= MAX_TRIES && !iw; a++) {
                    await waitForFlow("before loading " + G.map);
                    try { iw = await loadGame(G.map); } catch (e) {
                        log("load of " + G.map + " failed (try " + a + "): " + String(e && e.message || e) + "; window " + document.visibilityState);
                        progress({ id: "load-" + G.map, tries: a, status: "load-failed", reason: String(e && e.message || e), visibility: document.visibilityState, focus: document.hasFocus() });
                        if (a >= MAX_TRIES) throw e;
                    }
                }
                progress({ id: "load-" + G.map, tries: 1, status: "loaded" });
                grp.canvasesAtStart = canvasReport(iw);
                grp.fxAtStart = Object.fromEntries(FX_KEYS.map((k) => [k, iw.__fx[k]]));
                grp.spriteFilterAtStart = iw.__fx.spriteFilter; grp.qualityAtStart = iw.__fx.quality;
                for (const s of G.scenes) {
                    for (const variant of variants) {
                        if (variant === "off" && (s.set || []).some((x) => NOOP_WHEN_OFF.has(x))) { log("skip " + s.id + "|off (that feature is already off in Detail Original)"); continue; }
                        startWalking(iw);
                        grp.scenes.push(await measureGuarded(iw, s, { map: G.map, variant }));
                        if (CENSUS) { const c = grp.scenes[grp.scenes.length - 1].census; if (c) { grp.census = c.census; grp.censusTotalPerFrame = c.totalPerFrame; grp.censusFrames = c.frames; } }
                        stopWalking(iw);
                    }
                }
                let bf = null;
                for (let a = 1; a <= MAX_TRIES && !bf && G.battles.length; a++) {
                    await waitForFlow("before battle on " + G.map);
                    try { bf = await startBattle(iw, G.battles[0].mapId); } catch (e) {
                        log("battle start failed (try " + a + "): " + String(e && e.message || e));
                        progress({ id: "battle-" + G.map, tries: a, status: "battle-start-failed", reason: String(e && e.message || e) });
                        if (a >= MAX_TRIES) throw e;
                    }
                }
                for (const b of G.battles) for (const variant of variants) grp.scenes.push(await measureGuarded(iw, b, { map: b.mapId, variant, fields: bf }));
            } catch (e) {
                grp.error = String(e && e.message || e) + "\n" + String(e && e.stack || "");
                progress({ id: "group-" + G.map, status: "group-error", reason: String(e && e.message || e) });
                log("GROUP ERROR " + grp.error);
            }
            stopWalking(run.iw);
        }
        results.meta.finishedAt = new Date().toISOString();
        results.notes.push("rAF frame times are from this page's own requestAnimationFrame; the game caps itself at 61 fps (web/game.js frame()), see gameFrameGapMs.");
        results.notes.push("GPU time is not measured: the hooks time the JS side only; WebGL work is queued and finishes later.");
        results.notes.push("Time inside grass3d / water3d render() is not separated: they are imported bindings of the game module (no hook); compare the grass-off / water-off scenes instead.");
        results.notes.push("Settings are applied to the running game only (window.__setFxMany, then the saved dw.fx.v1 key is removed at once); the page also restores the whole localStorage at the end.");
        results.notes.push("Defaults: a fresh game already starts with every Detail key on and quality high (see groups[].fxAtStart), so settings-on = the default plus the pixel filter and the EFFECTS-page sound/quest keys; settings-off = Detail Original. The whole-frame pixel filter is documented as Authentic-art only; in HD art it may do nothing.");
        results.notes.push("Canvas acceleration state of the 2D canvas is not visible to JavaScript.");
    } catch (e) {
        results.error = String(e && e.stack || e);
        log("RUN ERROR " + results.error);
    }
    // put the user's own storage back first, then send
    try { run.iw && stopWalking(run.iw); $("g").src = "about:blank"; await sleep(300); if (restoreBackup()) log("localStorage put back"); } catch (e) { log("restore failed: " + e); }
    window.__perfTestResults = results;
    results.meta.minRafStepSeenMs = Number.isFinite(run.minStep) ? run.minStep : null;
    results.notes.push("Timer precision: meta.timerPrecision.minNonZeroStepMs = smallest non-zero performance.now() step in a 30 ms spin; meta.minRafStepSeenMs = smallest rAF timestamp step seen.");
    results.notes.push("Stall guard: a scene with an rAF gap > " + STALL_GAP_MS + " ms or rAF fps < " + STALL_FPS + " over 1 s is marked stalled, rerun after frames flow again (>= " + FLOW_FPS + " fps for " + FLOW_MS + " ms), max " + MAX_TRIES + " tries. See scenes[].tries, tryLog, stalled, stallReason, visibility*, hasFocus*.");
    progress({ id: "-", status: "run-finished" });
    status("sending results");
    try {
        const r = await fetch(recv + "/results", { method: "POST", body: JSON.stringify(results) });
        const j = await r.json();
        if (!j.ok) throw new Error(j.error || "receiver refused");
        status("DONE " + j.file);
        $("done").textContent = "DONE " + j.file;
        log("DONE " + j.file + " (in " + j.dir + ")");
    } catch (e) {
        status("results NOT sent: " + e);
        log("could not reach the receiver at " + recv + ": " + e + "\nThe results are in window.__perfTestResults; the link below saves them as a file.");
        const a = $("dl");
        a.href = URL.createObjectURL(new Blob([JSON.stringify(results, null, 1)], { type: "application/json" }));
        a.download = results.meta.browser + "-" + Date.now() + ".json";
        a.hidden = false;
    }
    $("start").disabled = false;
    if (CLOSE) { await new Promise((r) => setTimeout(r, 1000)); window.close(); }
}

window.addEventListener("DOMContentLoaded", () => {
    $("recv").value = "http://" + (location.hostname || "127.0.0.1") + ":20032";
    $("origin").textContent = location.origin;
    try { if (restoreBackup()) log("An earlier run was cut off: your localStorage copy was put back."); } catch { /* storage blocked */ }
    $("start").addEventListener("click", main);
    if (AUTO) setTimeout(main, 1500);
});
