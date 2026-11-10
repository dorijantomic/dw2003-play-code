// Dev-only Canvas2D benchmark (nothing in the game loads this). Measures real rAF cadence on a big canvas per Canvas2D operation.
// Open canvas-bench.html#auto,close ; results go to tools/perf-receiver.mjs (POST http://<host>:20032/results).
"use strict";
const AUTO = /(^|[#&,])auto($|[&,=])/.test(location.hash);
const CLOSE = /(^|[#&,])close($|[&,=])/.test(location.hash);
const WARM_MS = 1000, MEASURE_MS = 4000;
const LW = 640, LH = 480;
const hud = document.getElementById("hud");
const say = (t) => { hud.textContent = t; };

function browserName(ua) {
    if (/Firefox\//.test(ua)) return "firefox";
    if (/Edg\//.test(ua)) return "edge";
    if (/Chrome\//.test(ua)) return "chrome";
    if (/Safari\//.test(ua)) return "safari";
    return "browser";
}
function glInfo() {
    const out = { renderer: null, unmaskedRenderer: null, unmaskedVendor: null };
    try {
        const c = document.createElement("canvas");
        const gl = c.getContext("webgl2") || c.getContext("webgl");
        if (!gl) return out;
        out.renderer = gl.getParameter(gl.RENDERER);
        const ext = gl.getExtension("WEBGL_debug_renderer_info");
        if (ext) { out.unmaskedRenderer = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL); out.unmaskedVendor = gl.getParameter(ext.UNMASKED_VENDOR_WEBGL); }
    } catch (e) { out.error = String(e); }
    out.renderString = out.unmaskedRenderer || out.renderer;
    return out;
}
const r3 = (v) => Math.round(v * 1000) / 1000;
function pct(sorted, p) { const n = sorted.length; return n ? sorted[Math.min(n - 1, Math.max(0, Math.ceil(p * n) - 1))] : null; }

// ---- sources
function makeSource() {
    const c = document.createElement("canvas"); c.width = 1664; c.height = 1280;
    const g = c.getContext("2d");
    let s = 12345;
    const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    for (let y = 0; y < 1280; y += 8) for (let x = 0; x < 1664; x += 8) {
        g.fillStyle = "rgb(" + (rnd() * 256 | 0) + "," + (rnd() * 256 | 0) + "," + (rnd() * 256 | 0) + ")";
        g.fillRect(x, y, 8, 8);
    }
    return c;
}
function makeSprite() {
    const c = document.createElement("canvas"); c.width = 64; c.height = 64;
    const g = c.getContext("2d");
    g.fillStyle = "#e0a030"; g.beginPath(); g.arc(32, 32, 28, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#304090"; g.fillRect(20, 20, 24, 24);
    g.fillStyle = "rgba(255,255,255,0.6)"; g.fillRect(8, 8, 16, 16);
    return c;
}
function makeStrips() {
    const c = document.createElement("canvas"); c.width = LW; c.height = LH;
    const g = c.getContext("2d");
    for (let y = 0; y < LH; y += 8) { g.fillStyle = "hsl(" + ((y * 7) % 360) + ",50%," + (30 + (y % 5) * 6) + "%)"; g.fillRect(0, y, LW, 8); }
    return c;
}
function makeGlCanvas() {
    const c = document.createElement("canvas"); c.width = LW; c.height = LH;
    const gl = c.getContext("webgl2") || c.getContext("webgl");
    return { c, gl };
}

// fixed pseudo-random layout so every frame draws the same thing
let ls = 777;
const lrnd = () => { ls = (ls * 1664525 + 1013904223) >>> 0; return ls / 4294967296; };
const RECTS = Array.from({ length: 20 }, () => ({ x: lrnd() * (LW - 260), y: lrnd() * (LH - 195), w: 260, h: 195 }));
const SPOS = Array.from({ length: 150 }, () => ({ x: lrnd() * (LW - 32), y: lrnd() * (LH - 32) }));
const APOS = Array.from({ length: 60 }, () => ({ x: 3 + lrnd() * (LW - 6), y: 3 + lrnd() * (LH - 6) }));

let src, sprite, strips, glc, glFrame = 0;

function big(ctx) { ctx.imageSmoothingEnabled = true; ctx.drawImage(src, 0, 0, LW, LH); }
function radials(ctx) {
    for (const r of RECTS) {
        const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r.w / 2);
        g.addColorStop(0, "rgba(255,200,80,0.5)"); g.addColorStop(1, "rgba(255,200,80,0)");
        ctx.fillStyle = g; ctx.fillRect(r.x, r.y, r.w, r.h);
    }
}
function linears(ctx) {
    for (const r of RECTS) {
        const g = ctx.createLinearGradient(r.x, r.y, r.x, r.y + r.h);
        g.addColorStop(0, "rgba(255,200,80,0.5)"); g.addColorStop(1, "rgba(255,200,80,0)");
        ctx.fillStyle = g; ctx.fillRect(r.x, r.y, r.w, r.h);
    }
}
function solids(ctx) { ctx.fillStyle = "rgba(255,200,80,0.3)"; for (const r of RECTS) ctx.fillRect(r.x, r.y, r.w, r.h); }
function fulls(ctx) { ctx.fillStyle = "rgba(20,40,90,0.15)"; for (let i = 0; i < 4; i++) ctx.fillRect(0, 0, LW, LH); }
function sprites(ctx) { for (const p of SPOS) ctx.drawImage(sprite, p.x, p.y, 32, 32); }

function hlinears(ctx) {
    for (const r of RECTS) {
        const g = ctx.createLinearGradient(r.x, r.y, r.x + r.w, r.y);
        g.addColorStop(0, "rgba(255,200,80,0.5)"); g.addColorStop(1, "rgba(255,200,80,0)");
        ctx.fillStyle = g; ctx.fillRect(r.x, r.y, r.w, r.h);
    }
}
let cachedGrads = null, gradCanvas = null;
function getCachedGrads() {
    if (!cachedGrads) {
        const g0 = document.createElement("canvas").getContext("2d");
        cachedGrads = RECTS.map((r) => {
            const g = g0.createLinearGradient(r.x, r.y, r.x, r.y + r.h);
            g.addColorStop(0, "rgba(255,200,80,0.5)"); g.addColorStop(1, "rgba(255,200,80,0)");
            return g;
        });
    }
    return cachedGrads;
}
function linears3(ctx) {
    for (const r of RECTS) {
        const g = ctx.createLinearGradient(r.x, r.y, r.x, r.y + r.h);
        g.addColorStop(0, "rgba(255,200,80,0)"); g.addColorStop(0.5, "rgba(255,200,80,0.5)"); g.addColorStop(1, "rgba(255,200,80,0)");
        ctx.fillStyle = g; ctx.fillRect(r.x, r.y, r.w, r.h);
    }
}
function shafts(ctx) {
    const k = 0.42, w = 120, VIEW_H = LH;
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < 10; i++) {
        const base = (i + 0.5) * (LW / 10);
        const g = ctx.createLinearGradient(base - w / 2, 0, base + w / 2, 0);
        g.addColorStop(0, "rgba(255,243,190,0)"); g.addColorStop(0.5, "rgba(255,243,190,0.4)"); g.addColorStop(1, "rgba(255,243,190,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(base - w / 2, 0); ctx.lineTo(base + w / 2, 0);
        ctx.lineTo(base + w / 2 + k * VIEW_H, VIEW_H); ctx.lineTo(base - w / 2 + k * VIEW_H, VIEW_H);
        ctx.closePath(); ctx.fill();
    }
    ctx.globalCompositeOperation = "source-over";
}
function gradStrip() {
    if (!gradCanvas) {
        gradCanvas = document.createElement("canvas"); gradCanvas.width = 1; gradCanvas.height = 256;
        const g = gradCanvas.getContext("2d");
        const lg = g.createLinearGradient(0, 0, 0, 256);
        lg.addColorStop(0, "rgba(255,200,80,0.5)"); lg.addColorStop(1, "rgba(255,200,80,0)");
        g.fillStyle = lg; g.fillRect(0, 0, 1, 256);
    }
    return gradCanvas;
}
function gradImages(ctx) { const s = gradStrip(); for (const r of RECTS) ctx.drawImage(s, 0, 0, 1, 256, r.x, r.y, r.w, r.h); }
function linearsPath(ctx) {
    for (const r of RECTS) {
        const g = ctx.createLinearGradient(r.x, r.y, r.x, r.y + r.h);
        g.addColorStop(0, "rgba(255,200,80,0.5)"); g.addColorStop(1, "rgba(255,200,80,0)");
        ctx.fillStyle = g; ctx.beginPath(); ctx.rect(r.x, r.y, r.w, r.h); ctx.fill();
    }
}

// GPU-friendly load like the game: 6 full-canvas drawImage of the big source at alpha 0.5, plus 150 sprites.
function heavy(ctx) {
    ctx.imageSmoothingEnabled = true;
    ctx.globalAlpha = 0.5;
    for (let i = 0; i < 6; i++) ctx.drawImage(src, 0, 0, 1664, 1280, 0, 0, LW, LH);
    ctx.globalAlpha = 1;
    sprites(ctx);
}
function radial1(ctx) {
    const r = RECTS[0], cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r.w / 2);
    g.addColorStop(0, "rgba(255,200,80,0.5)"); g.addColorStop(1, "rgba(255,200,80,0)");
    ctx.fillStyle = g; ctx.fillRect(r.x, r.y, r.w, r.h);
}
let radialPreCanvas = null;
function radialPre() {
    if (!radialPreCanvas) {
        radialPreCanvas = document.createElement("canvas"); radialPreCanvas.width = 256; radialPreCanvas.height = 256;
        const g = radialPreCanvas.getContext("2d");
        const rg = g.createRadialGradient(128, 128, 0, 128, 128, 128);
        rg.addColorStop(0, "rgba(255,200,80,0.5)"); rg.addColorStop(1, "rgba(255,200,80,0)");
        g.fillStyle = rg; g.fillRect(0, 0, 256, 256);
    }
    return radialPreCanvas;
}

const CASES = [
    { id: 1, d: "clear only", f: () => {} },
    { id: 2, d: "1 big drawImage 1664x1280 over whole canvas", f: (c) => { big(c); } },
    { id: 3, d: "case 2 + 20 fillRect with new radial gradient each", f: (c) => { big(c); radials(c); } },
    { id: 4, d: "case 2 + 20 fillRect with new linear gradient each", f: (c) => { big(c); linears(c); } },
    { id: 5, d: "case 2 + 20 fillRect solid semi-transparent", f: (c) => { big(c); solids(c); } },
    { id: 6, d: "case 2 + 4 full-screen fillRect semi-transparent", f: (c) => { big(c); fulls(c); } },
    { id: 7, d: "case 2 + 150 sprite drawImage 64x64 -> 32x32 source-over", f: (c) => { big(c); sprites(c); } },
    { id: 8, d: "case 7 with globalCompositeOperation lighter", f: (c) => { big(c); c.globalCompositeOperation = "lighter"; sprites(c); c.globalCompositeOperation = "source-over"; } },
    { id: 9, d: "case 2 + ctx.filter brightness(0.9), 1 sprite, filter none", f: (c) => { big(c); c.filter = "brightness(0.9)"; c.drawImage(sprite, 100, 100, 32, 32); c.filter = "none"; } },
    { id: 10, d: "case 2 + ctx.filter sepia(0.3) saturate(1.2), 1 sprite, filter none", f: (c) => { big(c); c.filter = "sepia(0.3) saturate(1.2)"; c.drawImage(sprite, 100, 100, 32, 32); c.filter = "none"; } },
    { id: 11, d: "case 2 + save, clip rect whole view, 150 sprites, restore", f: (c) => { big(c); c.save(); c.beginPath(); c.rect(0, 0, LW, LH); c.clip(); sprites(c); c.restore(); } },
    { id: 12, d: "case 2 + 60 small solid arc fills (r=3 logical)", f: (c) => { big(c); c.fillStyle = "#ffd34d"; for (const p of APOS) { c.beginPath(); c.arc(p.x, p.y, 3, 0, Math.PI * 2); c.fill(); } } },
    { id: 13, d: "case 2 + 30 drawImage strips 8px tall from a second 640x480 2D canvas", f: (c) => { big(c); for (let i = 0; i < 30; i++) { const y = i * 16; c.drawImage(strips, 0, y, LW, 8, 0, y, LW, 8); } } },
    { id: 14, d: "case 2 + 1 drawImage of 640x480 WebGL canvas (cleared each frame) covering view", f: (c) => {
        big(c);
        const gl = glc.gl;
        if (gl) { glFrame++; gl.clearColor((glFrame % 60) / 120, 0.3, 0.5, 0.5); gl.clear(gl.COLOR_BUFFER_BIT); }
        c.drawImage(glc.c, 0, 0, LW, LH);
    } },
    { id: 15, d: "same as 2, backing 1600x686 CSS-scaled to window", f: (c) => { big(c); }, w: 1600, h: 686 },
    { id: 16, d: "same as 3, backing 1600x686 CSS-scaled to window", f: (c) => { big(c); radials(c); }, w: 1600, h: 686 },
    { id: 17, d: "case 2 + 20 fillRect with new HORIZONTAL linear gradient each", f: (c) => { big(c); hlinears(c); } },
    { id: 18, d: "case 2 + 1 vertical linear gradient fillRect only", f: (c) => {
        big(c); const r = RECTS[0];
        const g = c.createLinearGradient(r.x, r.y, r.x, r.y + r.h);
        g.addColorStop(0, "rgba(255,200,80,0.5)"); g.addColorStop(1, "rgba(255,200,80,0)");
        c.fillStyle = g; c.fillRect(r.x, r.y, r.w, r.h);
    } },
    { id: 19, d: "case 2 + 20 vertical linear gradients created once (cached), reused every frame", f: (c) => { big(c); const gs = getCachedGrads(); for (let i = 0; i < RECTS.length; i++) { const r = RECTS[i]; c.fillStyle = gs[i]; c.fillRect(r.x, r.y, r.w, r.h); } } },
    { id: 20, d: "case 2 + 20 vertical linear gradients with 3 stops", f: (c) => { big(c); linears3(c); } },
    { id: 21, d: "case 2 + 10 slanted shafts, lighter, horizontal 3-stop gradient each", f: (c) => { big(c); shafts(c); } },
    { id: 22, d: "case 2 + 20 drawImage of pre-made 1x256 gradient canvas stretched to 260x195", f: (c) => { big(c); gradImages(c); } },
    { id: 23, d: "case 2 + 20 vertical linear gradients drawn with fill() on a rect path", f: (c) => { big(c); linearsPath(c); } },
    { id: 30, fresh: true, d: "FRESH canvas: heavy only (6 full drawImage alpha 0.5 + 150 sprites)", f: (c) => { heavy(c); } },
    { id: 31, fresh: true, keep: true, d: "FRESH canvas: heavy + 1 radial gradient fillRect 260x195", f: (c) => { heavy(c); radial1(c); } },
    { id: 32, fresh: true, d: "FRESH canvas: heavy + ctx.filter sepia(0.3) saturate(1.2), 1 sprite, filter none", f: (c) => { heavy(c); c.filter = "sepia(0.3) saturate(1.2)"; c.drawImage(sprite, 100, 100, 32, 32); c.filter = "none"; } },
    { id: 33, fresh: true, d: "FRESH canvas: heavy + ctx.filter brightness(0.9), 1 sprite, filter none", f: (c) => { heavy(c); c.filter = "brightness(0.9)"; c.drawImage(sprite, 100, 100, 32, 32); c.filter = "none"; } },
    { id: 34, fresh: true, d: "FRESH canvas: heavy + 1 drawImage of radial gradient pre-rendered once into 256x256 canvas, scaled to 260x195", f: (c) => { heavy(c); const r = RECTS[0]; c.drawImage(radialPre(), 0, 0, 256, 256, r.x, r.y, r.w, r.h); } },
    { id: 35, reuse: true, d: "NOT fresh: canvas kept from case 31, heavy only (is the switch permanent?)", f: (c) => { heavy(c); } },
];
// Cases that must not run (no linear-gradient case runs any more). Code kept above.
const DISABLED = new Set([4, 17, 18, 19, 20, 21, 22, 23]);
const RUN_CASES = CASES.filter((cs) => !DISABLED.has(cs.id));

let cvEl = document.getElementById("cv");
let nativeW = 0, nativeH = 0;
function freshCanvas(w, h) {
    const n = document.createElement("canvas");
    n.id = "cv"; n.width = w; n.height = h;
    cvEl.replaceWith(n); cvEl = n;
    return n.getContext("2d");
}

let keptEl = null;
// Take the case canvas out of the page; a blank placeholder (same id/CSS, no context) takes its place.
function removeCaseCanvas() {
    const ph = document.createElement("canvas"); ph.id = "cv";
    cvEl.replaceWith(ph); cvEl = ph;
}
function runCase(cs) {
    return new Promise((resolve) => {
        let w = cs.w || nativeW, h = cs.h || nativeH, ctx;
        if (cs.reuse) {
            if (!keptEl) throw new Error("case " + cs.id + ": no kept canvas (case 31 did not run)");
            cvEl.replaceWith(keptEl); cvEl = keptEl; w = keptEl.width; h = keptEl.height;
            ctx = keptEl.getContext("2d");
        } else ctx = freshCanvas(w, h);
        const sx = w / LW, sy = h / LH;
        const gaps = [], js = [];
        let t0 = null, last = null, frames = 0, mFirst = null, mLast = null;
        const frame = (ts) => {
            if (t0 === null) t0 = ts;
            const el = ts - t0;
            const measuring = el >= WARM_MS;
            const a = performance.now();
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.clearRect(0, 0, w, h);
            ctx.setTransform(sx, 0, 0, sy, 0, 0);
            cs.f(ctx);
            const b = performance.now();
            if (measuring) {
                if (mFirst === null) { mFirst = ts; } else { gaps.push(ts - last); }
                mLast = ts; frames++; js.push(b - a);
            }
            last = ts;
            if (el >= WARM_MS + MEASURE_MS) {
                const sg = gaps.slice().sort((x, y) => x - y);
                const dur = mLast - mFirst;
                if (cs.keep) keptEl = cvEl;
                if (cs.fresh || cs.reuse) removeCaseCanvas();
                resolve({
                    id: cs.id, description: cs.d, fresh: !!cs.fresh, fps: dur > 0 ? r3((frames - 1) * 1000 / dur) : 0,
                    gapMedian: r3(pct(sg, 0.5)), gapP95: r3(pct(sg, 0.95)), gapWorst: r3(sg[sg.length - 1]),
                    jsMs: r3(js.reduce((s, v) => s + v, 0) / (js.length || 1)),
                    canvasW: w, canvasH: h, canvas: w + "x" + h, frames,
                });
                return;
            }
            requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
    });
}

let running = false;
async function main() {
    if (running) return; running = true;
    nativeW = Math.round(innerWidth * devicePixelRatio); nativeH = Math.round(innerHeight * devicePixelRatio);
    src = makeSource(); sprite = makeSprite(); strips = makeStrips(); glc = makeGlCanvas();
    const ua = navigator.userAgent;
    const results = { meta: {
        browser: browserName(ua), userAgent: ua, platform: navigator.platform, devicePixelRatio: window.devicePixelRatio,
        window: { innerW: innerWidth, innerH: innerHeight }, nativeCanvas: { w: nativeW, h: nativeH }, gl: glInfo(),
        startedAt: new Date().toISOString(), timing: { warmMs: WARM_MS, measureMs: MEASURE_MS }, page: location.href,
        visibilityAtStart: document.visibilityState,
    }, groups: [], notes: [] };
    const cases = [];
    results.groups.push({ id: "canvas-bench", name: "Canvas2D operations on a big canvas", cases });
    results.notes.push("fps = measured rAF cadence over " + MEASURE_MS + " ms after " + WARM_MS + " ms warm-up; gaps in ms; jsMs = mean JS time of the draw calls per frame (not GPU / other-process time).");
    try {
        for (const cs of RUN_CASES) {
            say("case " + cs.id + " (" + (RUN_CASES.indexOf(cs) + 1) + "/" + RUN_CASES.length + "): " + cs.d);
            const r = await runCase(cs);
            cases.push(r);
        }
        say("sending results");
    } catch (e) { results.error = String(e && e.stack || e); }
    results.meta.finishedAt = new Date().toISOString();
    window.__canvasBenchResults = results;
    try {
        const recv = "http://" + (location.hostname || "127.0.0.1") + ":20032";
        const r = await fetch(recv + "/results", { method: "POST", body: JSON.stringify(results) });
        const j = await r.json();
        if (!j.ok) throw new Error(j.error || "receiver refused");
        say("DONE " + j.file);
    } catch (e) {
        say("results NOT sent: " + e + "\nresults are in window.__canvasBenchResults");
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob([JSON.stringify(results, null, 1)], { type: "application/json" }));
        a.download = results.meta.browser + "-canvasbench-" + Date.now() + ".json";
        a.textContent = "download results"; hud.appendChild(document.createElement("br")); hud.appendChild(a);
    }
    running = false;
    if (CLOSE) { await new Promise((r) => setTimeout(r, 1000)); window.close(); }
}

window.addEventListener("keydown", (e) => { if (e.key === "s" || e.key === "S") main(); });
if (AUTO) setTimeout(main, 1500);
