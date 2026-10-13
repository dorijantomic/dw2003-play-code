// EXPERIMENT: scenery layer 2 — breath fog, frost edges, wind gusts, cloud shadows,
// lamp and window glow, dust devils and tumbleweeds, dragonflies, jumping fish and
// grass critters. Same rules as scenery.js: everything lives in WORLD space (map
// pixels), wrapped onto a torus a little bigger than the view, so the camera never
// drags it along. ambience.js decides which maps get which effect.
import { darkness, setReveal } from "./scenery.js";

const VIEW_W = 320;
const VIEW_H = 240;

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const smooth = (v) => { v = clamp01(v); return v * v * (3 - 2 * v); };
function rng(seed) {
    let s = seed >>> 0 || 1;
    return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}
const isGrassPx = (r, g, b) => g >= 105 && g > r * 1.22 && g > b * 1.7 && g - b >= 55;
const isWaterPx = (r, g, b) => b >= 62 && b > r + 28 && b > g + 6 && r < 150;

let sc2 = null;
let frost = null;                       // pre-rendered frost canvas (made once)
let breath = [], rings = [], fishes = [], critters = [], glints = [];
let gust = null, nextGust = 0;
let devil = null, nextDevil = 0, weed = null, nextWeed = 0;
let nextFish = 0, nextCritter = 0, wasMoving = false, nextBreath = [0, 0, 0, 0, 0];

// light sources read from the game own ambient-prop records (tools/gen_lights.py)
let stageLights = null;
fetch("assets/data/lights.json").then((r) => r.json()).then((j) => { stageLights = j; }).catch(() => { stageLights = {}; });
const imgs = {};
function loadImg(src) {
    if (!imgs[src]) { const i = new Image(); i.src = src; imgs[src] = i; }
    return imgs[src];
}
// the game's own glow sprite for one light, drawn at night over the darkness: the plain layer at
// full brightness, the additive layer on top (its real palette variants cycle like the game's), and
// a blurred copy of that same picture as the bloom. Nothing here is invented colour.
const bloomCache = new Map();
function bloomFor(sc, key, layers) {
    let c = bloomCache.get(key);
    if (c) return c;
    const K = 3, pad = 10;
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const [, , w, h, dx, dy] of layers) { x0 = Math.min(x0, dx); y0 = Math.min(y0, dy); x1 = Math.max(x1, dx + w); y1 = Math.max(y1, dy + h); }
    c = document.createElement("canvas"); c.width = (x1 - x0 + pad * 2) * K; c.height = (y1 - y0 + pad * 2) * K;
    const g = c.getContext("2d");
    g.filter = "blur(" + 5 * K / 3 + "px)";
    for (const [sx, sy, w, h, dx, dy] of layers) {
        g.drawImage(sc.sheetP, sx, sy, w, h, (dx - x0 + pad) * K, (dy - y0 + pad) * K, w * K, h * K);
        g.globalCompositeOperation = "lighter";
        g.drawImage(sc.sheetS, sx, sy, w, h, (dx - x0 + pad) * K, (dy - y0 + pad) * K, w * K, h * K);
        g.globalCompositeOperation = "source-over";
    }
    g.filter = "none"; g.globalCompositeOperation = "lighter"; g.drawImage(c, 0, 0);   // doubled once here, so it is drawn once per frame
    c.ox = x0 - pad; c.oy = y0 - pad; c.K = K;
    c.col = [255, 255, 255];
    try {
        const d = g.getImageData(0, 0, c.width, c.height).data;
        let r = 0, gg = 0, b = 0, wsum = 0;
        for (let i = 0; i < d.length; i += 4) {
            const l = Math.max(d[i], d[i + 1], d[i + 2]);
            if (l < 90 || d[i + 3] < 128) continue;
            r += d[i] * l; gg += d[i + 1] * l; b += d[i + 2] * l; wsum += l;
        }
        if (wsum) { const m = Math.max(r, gg, b) / wsum || 1; c.col = [Math.round(r / wsum * 255 / m), Math.round(gg / wsum * 255 / m), Math.round(b / wsum * 255 / m)]; }
    } catch (e) { /* tainted canvas: keep white */ }
    bloomCache.set(key, c);
    return c;
}
const poolSprites = new Map();
function poolSprite(r, g, b) {
    const k = (r << 16) | (g << 8) | b;
    let c = poolSprites.get(k);
    if (c) return c;
    c = document.createElement("canvas"); c.width = c.height = 64;
    const x = c.getContext("2d"), gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, `rgba(${r},${g},${b},1)`); gr.addColorStop(0.35, `rgba(${r},${g},${b},0.47)`); gr.addColorStop(0.7, `rgba(${r},${g},${b},0.17)`); gr.addColorStop(1, `rgba(${r},${g},${b},0)`);
    x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
    poolSprites.set(k, c);
    return c;
}
function drawGameLight(ctx, sc, m, camX, camY, a, now, fxo) {
    if (!(sc.sheetP.complete && sc.sheetP.naturalWidth && sc.sheetS.complete && sc.sheetS.naturalWidth)) return;
    const vi = ((now / 1000 * 60 / m.per) | 0) % m.v.length, layers = m.v[vi];
    const bx = Math.round(m.ox - camX), by = Math.round(m.oy - camY);
    const bl = bloomFor(sc, (m.key || (m.key = sc.id + ":" + m.v[0][0].join(","))) + ":" + vi, layers);
    const f0 = layers[0], cx = bx + f0[4] + f0[2] / 2, cy = by + f0[5] + f0[3] / 2, size = Math.max(f0[2], f0[3]);
    const gain = typeof window.__lightGain === "number" ? window.__lightGain : 1, rad = 14 + size * 2.4, small = 0.45 + 0.55 * clamp01(size / 24), [cr, cg, cb] = bl.col, flick = 0.88 + 0.12 * Math.sin(now / 1000 * 9 + m.ph);
    ctx.globalCompositeOperation = "lighter";
    if (fxo.lightpool) {
        const sprite = poolSprite(cr, cg, cb);
        ctx.globalAlpha = Math.min(1, 0.30 * small * gain * a * flick);
        ctx.drawImage(sprite, cx - rad, cy + (m.wall ? rad * 0.25 : 0) - rad * 0.62, rad * 2, rad * 1.24);   // lies on the ground, not a flat disc
    }
    // a big glow sprite is already a soft wide light: it gets far less bloom than a small bright lamp, or it saturates to a white disc
    const bloomGain = Math.max(0.15, Math.min(1, 1.5 - size / 26));
    ctx.globalAlpha = Math.min(1, a * bloomGain * gain);
    ctx.drawImage(bl, bx + bl.ox, by + bl.oy, bl.width / bl.K, bl.height / bl.K);   // stacked: additive, so it brightens in the sprite own colours
    const redraw = size >= 32 ? 0.4 : size >= 24 ? 0.7 : 1;            // restoring a big glow to full brightness over the dark makes it a white disc
    ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = Math.min(1, a * redraw);
    for (const [sx, sy, w, h, dx, dy] of layers) ctx.drawImage(sc.sheetP, sx, sy, w, h, bx + dx, by + dy, w, h);
    ctx.globalCompositeOperation = "lighter"; ctx.globalAlpha = Math.min(1, a * redraw);
    for (const [sx, sy, w, h, dx, dy] of layers) ctx.drawImage(sc.sheetS, sx, sy, w, h, bx + dx, by + dy, w, h);
    ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = 1;
}

// Put the real, untinted colours back around each light. The mask is the same flattened ellipse as the
// pool; the snapshot is the frame as drawn just before the night tint.
let rvMask = null, rvTmp = null, rvSprite = null;
function revealSprite() {
    if (rvSprite) return rvSprite;
    rvSprite = document.createElement("canvas"); rvSprite.width = rvSprite.height = 64;
    const x = rvSprite.getContext("2d"), g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.4, "rgba(255,255,255,0.55)"); g.addColorStop(1, "rgba(255,255,255,0)");
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    return rvSprite;
}
setReveal({
    wants(S) { return !!(sc2 && sc2.id === S.map.id && sc2.built && sc2.lamps && sc2.lamps.some((m) => m.rec) && S.fx.lamps && S.fx.lightreveal && S.p.lamps); },
    draw(ctx, snap, S) {
        const dark = darkness(S.p, S.fx, S.now);
        if (dark < 0.04) return;
        const gain = typeof window.__lightGain === "number" ? window.__lightGain : 1, a = clamp01(0.85 * gain * dark * S.fade);
        if (!rvMask) { rvMask = document.createElement("canvas"); rvMask.width = VIEW_W; rvMask.height = VIEW_H; }
        if (!rvTmp || rvTmp.width !== snap.width || rvTmp.height !== snap.height) { rvTmp = document.createElement("canvas"); rvTmp.width = snap.width; rvTmp.height = snap.height; }
        const mx = rvMask.getContext("2d");
        mx.setTransform(1, 0, 0, 1, 0, 0); mx.globalCompositeOperation = "source-over"; mx.clearRect(0, 0, VIEW_W, VIEW_H);
        mx.globalCompositeOperation = "lighter";
        let any = false;
        for (const m of sc2.lamps) {
            if (!m.rec) continue;
            const rad = 12 + m.sz * 2.0, small = 0.5 + 0.5 * clamp01(m.sz / 24), x = m.x - S.camX, y = m.y - S.camY + (m.wall ? rad * 0.2 : 0);
            if (x < -rad || x > VIEW_W + rad || y < -rad || y > VIEW_H + rad) continue;
            any = true;
            mx.globalAlpha = a * small;
            mx.drawImage(revealSprite(), x - rad, y - rad * 0.8, rad * 2, rad * 1.6);
        }
        if (!any) return;
        mx.globalAlpha = 1;
        const tx = rvTmp.getContext("2d");
        tx.setTransform(1, 0, 0, 1, 0, 0); tx.globalCompositeOperation = "copy"; tx.drawImage(snap, 0, 0);
        tx.globalCompositeOperation = "destination-in"; tx.drawImage(rvMask, 0, 0, rvTmp.width, rvTmp.height);
        ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = 1;
        ctx.drawImage(rvTmp, 0, 0, VIEW_W, VIEW_H);
    },
});

export const hasLights = (id) => !!(stageLights && stageLights[id]);

export function resetScenery2(map, p, S) {
    const r = rng(p.seed ^ 0x7f4a7c15);
    sc2 = { id: map.id, rand: r, built: false };
    const W = S.DWB, H = S.DHB;
    sc2.clouds = Array.from({ length: 5 }, () => {
        const x = r() * W, y = r() * H, vx = 8 + r() * 8, vy = (r() - 0.5) * 3;
        return { x, y, vx, vy, parts: Array.from({ length: 3 }, () => ({ dx: (r() - 0.5) * 150, dy: (r() - 0.5) * 90, rad: 100 + r() * 90 })), a: 0.15 + r() * 0.08 };
    });
    breath = []; rings = []; fishes = []; critters = []; glints = [];
    gust = null; nextGust = performance.now() + 5000 + r() * 8000;
    devil = null; nextDevil = performance.now() + 2500 + r() * 6000;
    weed = null; nextWeed = performance.now() + 6000 + r() * 10000;
    nextFish = performance.now() + 3000 + r() * 4000;
    nextCritter = performance.now() + 4000 + r() * 6000;
    nextBreath = [0, 0, 0, 0, 0]; wasMoving = false;
    window.__grassGust = null;
}

// ----------------------------------------------------------------- scatter
function scatterOn(S, count, test, tries = 80) {
    const px = S.pix();
    if (!px) return [];
    const out = [], r = sc2.rand;
    for (let n = 0; out.length < count && n < count * tries; n++) {
        const x = r() * px.w, y = r() * px.h, o = ((y | 0) * px.w + (x | 0)) * 4;
        if (px.data[o + 3] < 128) continue;
        if (test(px.data[o], px.data[o + 1], px.data[o + 2])) out.push([x, y]);
    }
    return out;
}
// lit lamps and windows: small clusters of bright, saturated warm pixels in the picture itself
function findLamps(S) {
    const px = S.pixMap();
    if (!px) return null;
    const CELL = 6, cols = Math.ceil(px.w / CELL), rows = Math.ceil(px.h / CELL);
    const cnt = new Uint16Array(cols * rows), d = px.data;
    let warm = 0;
    for (let y = 0; y < px.h; y++) for (let x = 0; x < px.w; x++) {
        const o = (y * px.w + x) * 4;
        if (d[o + 3] < 128) continue;
        const r = d[o], g = d[o + 1], b = d[o + 2];
        if (r >= 232 && g >= 185 && b >= 70 && b <= 165 && r >= g && r - b > 70) { cnt[((y / CELL) | 0) * cols + ((x / CELL) | 0)]++; warm++; }
    }
    if (warm > px.w * px.h * 0.03) return [];          // sand or a lit floor, not lamps
    const seen = new Uint8Array(cols * rows), out = [], windows = [];
    let bx0 = 0, bx1 = 0, by0 = 0, by1 = 0;
    for (let i = 0; i < cnt.length; i++) {
        if (cnt[i] < 3 || seen[i]) continue;
        let sx = 0, sy = 0, sw = 0, n = 0;
        bx0 = bx1 = i % cols; by0 = by1 = (i / cols) | 0;
        const stack = [i]; seen[i] = 1;
        while (stack.length) {
            const c = stack.pop(), cx = c % cols, cy = (c / cols) | 0;
            sx += (cx + 0.5) * cnt[c]; sy += (cy + 0.5) * cnt[c]; sw += cnt[c]; n++;
            bx0 = Math.min(bx0, cx); bx1 = Math.max(bx1, cx); by0 = Math.min(by0, cy); by1 = Math.max(by1, cy);
            for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
                const nx = cx + dx, ny = cy + dy;
                if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
                const k = ny * cols + nx;
                if (cnt[k] >= 2 && !seen[k]) { seen[k] = 1; stack.push(k); }
            }
        }
        const bw = bx1 - bx0 + 1, bh = by1 - by0 + 1;
        if (sw >= 30 && n > 3 && n <= 90 && bw <= 11 && bh <= 11 && sw / (bw * bh * CELL * CELL * 0.0009 + 1) >= 6 && Math.min(bw, bh) / Math.max(bw, bh) >= 0.3 && windows.length < 40) {
            windows.push({ x: (sx / sw) * CELL, y: (sy / sw) * CELL, w: Math.max(5, bw * CELL * 0.7), h: Math.max(5, bh * CELL * 0.7), ph: sc2.rand() * 6.28 });
            continue;                                   // a lit window or doorway, not a lamp
        }
        if (n > 30 || sw < 8) continue;                 // a big bright area, or a stray bright speck, not a lamp
        if (Math.max(bw, bh) > 4 || Math.min(bw, bh) / Math.max(bw, bh) < 0.5) continue;   // rails and edges are long and thin
        out.push({ x: (sx / sw) * CELL, y: (sy / sw) * CELL, size: Math.min(1, 0.45 + sw / 120), ph: sc2.rand() * 6.28 });
        if (out.length >= 110) break;
    }
    out.windows = windows;
    return out;
}
function build(S) {
    const { p } = S;
    if (!S.pix() || !stageLights) return;
    sc2.built = true;
    sc2.waterPts = p.open && !p.snowy && S.waterStage() ? scatterOn(S, 60, S.waterTest()) : [];
    sc2.meadow = p.butterflies ? scatterOn(S, 40, isGrassPx) : [];
    sc2.lamps = []; sc2.lamps.windows = [];             // no picture scan any more: only the game own records place lights
    sc2.windows = (sc2.lamps && sc2.lamps.windows) || [];
    const rec = stageLights[sc2.id];
    if (rec) {                                      // the game says where its lights are: use that, not the picture scan
        sc2.sheetP = loadImg(`assets/effects/${sc2.id}.png`); sc2.sheetS = loadImg(`assets/effects/${sc2.id}_semi.png`);
        const win = [];
        sc2.lamps = rec.lights.map((l) => {
            const v = rec.sprites[l.s], f = v[0][0];
            return { x: l.x + f[4] + f[2] / 2, y: l.y + f[5] + f[3] / 2, size: clamp01(f[2] / 40), ph: sc2.rand() * 6.28, rec: true, sz: Math.max(f[2], f[3]), wall: l.z >= 6, v, ox: l.x, oy: l.y, per: l.p + 1 };
        });
        sc2.lamps.windows = win; sc2.windows = win;
    }
    const r = sc2.rand;
    sc2.dragonflies = sc2.waterPts.length >= 12 && p.open && !p.night
        ? sc2.waterPts.slice(0, 6).map(([x, y]) => ({ hx: x, hy: y, x, y, tx: x, ty: y, until: 0, ph: r() * 6.28, col: ["#3fd0e0", "#4a8cff", "#7be08a"][(r() * 3) | 0] })) : [];
    window.__ambLamps = sc2.lamps.length;
}

function makeFrost() {
    const cv = document.createElement("canvas");
    cv.width = VIEW_W; cv.height = VIEW_H;
    const g = cv.getContext("2d");
    const r = rng(0xf205);
    const vg = g.createRadialGradient(VIEW_W / 2, VIEW_H / 2, VIEW_H * 0.4, VIEW_W / 2, VIEW_H / 2, VIEW_W * 0.66);
    vg.addColorStop(0, "rgba(225,240,255,0)"); vg.addColorStop(0.65, "rgba(225,240,255,0.14)"); vg.addColorStop(1, "rgba(235,246,255,0.55)");
    g.fillStyle = vg; g.fillRect(0, 0, VIEW_W, VIEW_H);
    g.strokeStyle = "rgba(247,252,255,0.75)"; g.lineCap = "round";
    const branch = (x, y, a, len, w, depth) => {
        if (depth > 3 || len < 3) return;
        g.lineWidth = w; g.beginPath(); g.moveTo(x, y);
        const nx = x + Math.cos(a) * len, ny = y + Math.sin(a) * len;
        g.lineTo(nx, ny); g.stroke();
        branch(nx, ny, a + 0.55 + r() * 0.3, len * 0.6, w * 0.7, depth + 1);
        branch(nx, ny, a - 0.55 - r() * 0.3, len * 0.6, w * 0.7, depth + 1);
    };
    for (let i = 0; i < 22; i++) {
        const side = (r() * 4) | 0, t = r();
        const x = side === 0 ? t * VIEW_W : side === 1 ? VIEW_W : side === 2 ? t * VIEW_W : 0;
        const y = side === 0 ? 0 : side === 1 ? t * VIEW_H : side === 2 ? VIEW_H : t * VIEW_H;
        const toward = Math.atan2(VIEW_H / 2 - y, VIEW_W / 2 - x);
        branch(x, y, toward + (r() - 0.5) * 0.9, 9 + r() * 10, 1.2, 0);
    }
    // keep the middle of the picture clear: fade everything out toward the centre
    g.globalCompositeOperation = "destination-in";
    const mask = g.createRadialGradient(VIEW_W / 2, VIEW_H / 2, VIEW_H * 0.36, VIEW_W / 2, VIEW_H / 2, VIEW_W * 0.6);
    mask.addColorStop(0, "rgba(0,0,0,0)"); mask.addColorStop(1, "rgba(0,0,0,1)");
    g.fillStyle = mask; g.fillRect(0, 0, VIEW_W, VIEW_H);
    return cv;
}

// ----------------------------------------------------------------- gusts
// A gust is a front sweeping across the world; it boosts the wind, bends grass blades
// (grass3d.js reads window.__grassGust) and draws long streaks behind its leading edge.
export function gustLevel(S) {
    if (!sc2 || sc2.id !== S.map.id) return 0;
    const { fx, p, now, camX } = S;
    if (!fx.gusts || !p.open) { window.__grassGust = null; return 0; }
    if (window.__forceGust) { window.__forceGust = false; nextGust = 0; gust = null; }   // filming: gust on cue
    if (!gust && now >= nextGust) {
        gust = { x0: camX - 100, born: now, speed: 130 + sc2.rand() * 50, streaks: Array.from({ length: 22 }, () => ({ o: sc2.rand() * 90, y: sc2.rand() * VIEW_H, l: 20 + sc2.rand() * 40 })) };
    }
    if (!gust) { window.__grassGust = null; return 0; }
    const age = (now - gust.born) / 1000, front = gust.x0 + gust.speed * age;
    const k = (front - (camX - 100)) / (VIEW_W + 260);
    if (k >= 1) { gust = null; nextGust = now + 9000 + sc2.rand() * 15000; window.__grassGust = null; return 0; }
    const s = Math.sin(Math.max(0, Math.min(1, k)) * Math.PI);
    gust.front = front; gust.s = s;
    window.__grassGust = { x: front, s };
    return s;
}

// ----------------------------------------------------------------- overlay
export function drawScenery2(ctx, S) {
    if (!sc2 || sc2.id !== S.map.id) return;
    const { fx, p, L, t, dt, fade, camX, camY, Q, now } = S;
    if (!sc2.built) build(S);
    // filming: make the rare things happen on cue ("fish", "critter", "devil", joined with +)
    if (window.__cue) {
        for (const k of String(window.__cue).split("+")) {
            if (k === "fish") nextFish = 0;
            if (k === "critter") nextCritter = 0;
            if (k === "devil") { nextDevil = 0; nextWeed = 0; }
        }
        window.__cue = "";
    }

    // cloud shadows: soft dark patches sliding over the ground, daytime only
    if (fx.clouds && p.clouds) {
        const day = 1 - darkness(p, fx, now);
        const a = fade * day * (1 - L.rain * 0.7) * (0.8 + 0.2 * Q);
        if (a > 0.02) for (const c of sc2.clouds) {
            c.x += c.vx * dt; c.y += c.vy * dt;
            for (const q of c.parts) {
                const bx = S.wrapXB(c.x + q.dx, camX), by = S.wrapYB(c.y + q.dy, camY);
                if (bx < -q.rad || bx > VIEW_W + q.rad || by < -q.rad || by > VIEW_H + q.rad) continue;
                const g = ctx.createRadialGradient(bx, by, 0, bx, by, q.rad);
                g.addColorStop(0, `rgba(8,18,40,${(c.a * a).toFixed(3)})`); g.addColorStop(0.6, `rgba(8,18,40,${(c.a * a * 0.55).toFixed(3)})`); g.addColorStop(1, "rgba(8,18,40,0)");
                ctx.globalAlpha = 1; ctx.fillStyle = g; ctx.fillRect(bx - q.rad, by - q.rad, q.rad * 2, q.rad * 2);
            }
        }
    }

    // lamp and window glow: warm blooms that wake up as the light fades
    if (fx.lamps && p.lamps && sc2.lamps && sc2.lamps.length) {
        const dark = darkness(p, fx, now);
        if (dark > 0.04) {
            ctx.globalCompositeOperation = "lighter";
            for (const m of sc2.lamps) {
                const sx = m.x - camX, sy = m.y - camY;
                if (sx < -40 || sx > VIEW_W + 40 || sy < -40 || sy > VIEW_H + 40) continue;
                if (m.rec) { drawGameLight(ctx, sc2, m, camX, camY, dark * fade, now, fx); ctx.globalCompositeOperation = "lighter"; continue; }
                const fl = 0.86 + 0.09 * Math.sin(t * 7.3 + m.ph) + 0.05 * Math.sin(t * 17 + m.ph * 3);
                const rad = 20 + 32 * m.size, a = dark * fl * fade;
                // wide soft halo, then a hot bloom, then the bright core
                const halo = ctx.createRadialGradient(sx, sy, 0, sx, sy, rad * 1.9);
                halo.addColorStop(0, `rgba(255,170,70,${(0.2 * a).toFixed(3)})`); halo.addColorStop(1, "rgba(255,140,40,0)");
                ctx.globalAlpha = 1; ctx.fillStyle = halo; ctx.fillRect(sx - rad * 1.9, sy - rad * 1.9, rad * 3.8, rad * 3.8);
                const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, rad);
                g.addColorStop(0, `rgba(255,222,140,${(0.95 * a).toFixed(3)})`); g.addColorStop(0.3, `rgba(255,184,86,${(0.42 * a).toFixed(3)})`); g.addColorStop(1, "rgba(255,150,50,0)");
                ctx.fillStyle = g; ctx.fillRect(sx - rad, sy - rad, rad * 2, rad * 2);
                ctx.globalAlpha = Math.min(1, 0.95 * a); ctx.fillStyle = "#fff4cf";
                ctx.beginPath(); ctx.arc(sx, sy, 1.7 + 2.0 * m.size, 0, 6.2832); ctx.fill();
            }
            ctx.globalCompositeOperation = "source-over";
        }
    }

    // wind gust: long streaks behind the leading edge
    if (fx.gusts && gust && gust.front !== undefined) {
        const fs = gust.front - camX, col = p.snowy ? "255,255,255" : p.sandy ? "236,208,156" : "236,246,226";
        ctx.lineWidth = 0.8; ctx.lineCap = "round";
        for (const s of gust.streaks) {
            const x = fs - s.o - s.l * 0.3;
            if (x < -60 || x > VIEW_W + 60) continue;
            ctx.globalAlpha = 0.34 * gust.s * fade; ctx.strokeStyle = `rgb(${col})`;
            ctx.beginPath(); ctx.moveTo(x - s.l, s.y); ctx.quadraticCurveTo(x - s.l * 0.4, s.y - 3, x, s.y + 1); ctx.stroke();
        }
    }

    // dragonflies: hover, then dart to a new spot over the water
    if (fx.dragonflies && sc2.dragonflies && sc2.dragonflies.length && L.rain < 0.2 && L.blizzard < 0.2) {
        const n = Math.max(1, Math.round(sc2.dragonflies.length * Q)), vis = fade * (1 - L.rain * 5);
        for (let i = 0; i < n; i++) {
            const d = sc2.dragonflies[i];
            if (now >= d.until) { d.tx = d.hx + (sc2.rand() - 0.5) * 120; d.ty = d.hy + (sc2.rand() - 0.5) * 70; d.until = now + 900 + sc2.rand() * 2200; }
            const dx = d.tx - d.x, dy = d.ty - d.y, dist = Math.hypot(dx, dy);
            if (dist > 1) { const v = Math.min(dist, 95 * dt * (dist > 18 ? 1 : 0.15)); d.x += dx / dist * v; d.y += dy / dist * v; }
            const hx = d.x + Math.sin(t * 9 + d.ph) * 0.7, hy = d.y + Math.cos(t * 7 + d.ph) * 0.9 - 6;
            const sx = hx - camX, sy = hy - camY;
            if (sx < -8 || sx > VIEW_W + 8 || sy < -8 || sy > VIEW_H + 8) continue;
            const ang = Math.atan2(dy, dx);
            ctx.save(); ctx.translate(sx, sy); ctx.rotate(dist > 4 ? ang : 0);
            ctx.globalAlpha = 0.9 * vis; ctx.strokeStyle = d.col; ctx.lineWidth = 1.3; ctx.lineCap = "round";
            ctx.beginPath(); ctx.moveTo(-3.2, 0); ctx.lineTo(3.2, 0); ctx.stroke();
            ctx.globalAlpha = 0.42 * vis * (0.5 + 0.5 * Math.abs(Math.sin(t * 38 + d.ph))); ctx.fillStyle = "#e8f6ff";
            ctx.beginPath(); ctx.ellipse(0.4, -1.8, 3, 0.9, 0, 0, 6.2832); ctx.ellipse(0.4, 1.8, 3, 0.9, 0, 0, 6.2832); ctx.fill();
            ctx.restore();
            ctx.globalAlpha = 0.1 * vis; ctx.fillStyle = "#000";
            ctx.beginPath(); ctx.ellipse(hx - camX, hy + 8 - camY, 3, 1, 0, 0, 6.2832); ctx.fill();
        }
    }

    // jumping fish: now and then one leaps out of a patch of water that is in view
    if (fx.fish && sc2.waterPts && sc2.waterPts.length >= 12 && p.open && !p.snowy && L.blizzard < 0.2) {
        if (now >= nextFish) {
            nextFish = now + 4500 + sc2.rand() * 7500;
            const vis = sc2.waterPts.filter(([x, y]) => x - camX > 10 && x - camX < VIEW_W - 10 && y - camY > 20 && y - camY < VIEW_H - 10);
            if (vis.length && fishes.length < 2) {
                const [x, y] = vis[(sc2.rand() * vis.length) | 0];
                fishes.push({ x, y, born: now, dir: sc2.rand() < 0.5 ? -1 : 1 });
                rings.push({ x, y, born: now, life: 1100 });
            }
        }
        for (let i = fishes.length - 1; i >= 0; i--) {
            const f = fishes[i], k = (now - f.born) / 750;
            if (k >= 1) { rings.push({ x: f.x + f.dir * 14, y: f.y, born: now, life: 1100 }); fishes.splice(i, 1); continue; }
            const fx2 = f.x + f.dir * 14 * k - camX, fy = f.y - camY - 15 * 4 * k * (1 - k);
            const slope = f.dir * (1 - 2 * k) * -1.0;
            ctx.save(); ctx.translate(fx2, fy); ctx.rotate(Math.atan2(-4 * (1 - 2 * k) * 0.9, f.dir * 8) + (f.dir < 0 ? Math.PI : 0));
            ctx.globalAlpha = 0.95 * fade; ctx.fillStyle = "#c9d8e6";
            ctx.beginPath(); ctx.ellipse(0, 0, 4.4, 1.7, 0, 0, 6.2832); ctx.fill();
            ctx.fillStyle = "#8fa9c4"; ctx.beginPath(); ctx.moveTo(-4, 0); ctx.lineTo(-7, -2); ctx.lineTo(-7, 2); ctx.closePath(); ctx.fill();
            ctx.globalAlpha = 0.8 * fade; ctx.fillStyle = "#fff"; ctx.fillRect(0.5, -1.4, 2, 0.8);
            ctx.restore();
            void slope;
        }
    }
    // splash rings (fish)
    if (rings.length) {
        ctx.strokeStyle = "#e6f2ff"; ctx.lineWidth = 0.6;
        for (let i = rings.length - 1; i >= 0; i--) {
            const r = rings[i], k = (now - r.born) / r.life;
            if (k >= 1) { rings.splice(i, 1); continue; }
            ctx.globalAlpha = (1 - k) * 0.7 * fade;
            ctx.beginPath(); ctx.ellipse(r.x - camX, r.y - camY, 2 + k * 14, 0.9 + k * 5.5, 0, 0, 6.2832); ctx.stroke();
        }
    }

    // critters: something small darts through the grass in a few hops, then is gone
    if (fx.critters && sc2.meadow && sc2.meadow.length && L.rain < 0.3) {
        if (now >= nextCritter) {
            nextCritter = now + 5000 + sc2.rand() * 9000;
            const vis = sc2.meadow.filter(([x, y]) => x - camX > 20 && x - camX < VIEW_W - 20 && y - camY > 40 && y - camY < VIEW_H - 10);
            if (vis.length && critters.length < 2) {
                const [x, y] = vis[(sc2.rand() * vis.length) | 0], a = sc2.rand() * 6.283;
                critters.push({ x, y, born: now, vx: Math.cos(a) * 30, vy: Math.sin(a) * 18, col: ["#8a6a4a", "#7d7f86", "#b08b5a"][(sc2.rand() * 3) | 0], hops: 4 });
            }
        }
        for (let i = critters.length - 1; i >= 0; i--) {
            const c = critters[i], age = (now - c.born) / 1000, life = c.hops * 0.42;
            if (age >= life + 0.5) { critters.splice(i, 1); continue; }
            const ph = (age / 0.42) % 1, hop = 4 * ph * (1 - ph) * 7;
            const x = c.x + c.vx * Math.min(age, life) - camX, y = c.y + c.vy * Math.min(age, life) - camY;
            const a = (age > life ? 1 - (age - life) / 0.5 : Math.min(1, age / 0.15)) * fade;
            if (a <= 0 || x < -8 || x > VIEW_W + 8) continue;
            ctx.globalAlpha = 0.18 * a; ctx.fillStyle = "#000";
            ctx.beginPath(); ctx.ellipse(x, y + 1, 3.4, 1.2, 0, 0, 6.2832); ctx.fill();
            ctx.globalAlpha = a; ctx.fillStyle = c.col;
            ctx.beginPath(); ctx.ellipse(x, y - hop - 2, 3.2, 2.3, 0, 0, 6.2832); ctx.fill();
            const f = c.vx >= 0 ? 1 : -1;
            ctx.beginPath(); ctx.arc(x + f * 3, y - hop - 3, 1.5, 0, 6.2832); ctx.fill();
            ctx.fillRect(x + f * 3 - 0.8, y - hop - 6, 0.9, 2.2); ctx.fillRect(x + f * 3 + 0.4, y - hop - 6, 0.9, 2.2);
            ctx.strokeStyle = c.col; ctx.lineWidth = 0.9; ctx.beginPath(); ctx.moveTo(x - f * 3, y - hop - 2); ctx.quadraticCurveTo(x - f * 6, y - hop - 5, x - f * 7, y - hop - 2); ctx.stroke();
        }
    }

    // dust devil and tumbleweed in the desert
    if (fx.devils && p.devils) {
        if (!devil && now >= nextDevil && L.sand < 0.7) {
            const r = sc2.rand;
            devil = { x: camX + 30 + r() * (VIEW_W - 60), y: camY + 90 + r() * 120, vx: (r() < 0.5 ? -1 : 1) * (14 + r() * 14), vy: (r() - 0.5) * 8, born: now, life: 16000 + r() * 12000 };
        }
        if (devil) {
            const age = now - devil.born;
            if (age > devil.life) { devil = null; nextDevil = now + 12000 + sc2.rand() * 18000; }
            else {
                devil.x += devil.vx * dt; devil.y += devil.vy * dt;
                const k = Math.min(1, age / 2500, (devil.life - age) / 2500), sx = devil.x - camX, sy = devil.y - camY;
                if (sx > -60 && sx < VIEW_W + 60 && sy > -20 && sy < VIEW_H + 90) {
                    ctx.globalAlpha = 0.16 * k * fade; ctx.fillStyle = "#000";
                    ctx.beginPath(); ctx.ellipse(sx + 4, sy + 2, 12, 3.4, 0, 0, 6.2832); ctx.fill();
                    for (let j = 0; j < 18; j++) {
                        const h = j * 4.6, w = 3.5 + j * 1.15, off = Math.sin(t * 3.2 - j * 0.55) * (1.5 + j * 0.5);
                        ctx.globalAlpha = (0.30 - j * 0.012) * k * fade;
                        ctx.fillStyle = j % 2 ? "rgb(220,188,134)" : "rgb(196,162,112)";
                        ctx.beginPath(); ctx.ellipse(sx + off, sy - h, w, w * 0.34, 0, 0, 6.2832); ctx.fill();
                    }
                    ctx.fillStyle = "#f1dcae";
                    for (let q = 0; q < 14; q++) {
                        const ang = t * 5.5 + q * 0.9, hh = ((t * 26 + q * 13) % 82);
                        ctx.globalAlpha = 0.6 * k * fade * (1 - hh / 90);
                        ctx.fillRect(sx + Math.cos(ang) * (5 + hh * 0.2), sy - hh + Math.sin(ang) * 1.2, 1.2, 1.2);
                    }
                }
            }
        }
        if (!weed && now >= nextWeed && L.sand < 0.7) {
            const r = sc2.rand;
            weed = { x: camX - 20, y: camY + 90 + r() * 130, vx: 52 + r() * 36, born: now, ph: r() * 6.28 };
        }
        if (weed) {
            weed.x += weed.vx * dt;
            const sx = weed.x - camX;
            if (sx > VIEW_W + 30) { weed = null; nextWeed = now + 14000 + sc2.rand() * 22000; }
            else {
                const bounce = Math.abs(Math.sin(weed.x * 0.07 + weed.ph)) * 7, sy = weed.y - camY;
                ctx.globalAlpha = 0.2 * fade; ctx.fillStyle = "#000";
                ctx.beginPath(); ctx.ellipse(sx, sy + 1, 5.5 - bounce * 0.3, 1.7, 0, 0, 6.2832); ctx.fill();
                ctx.save(); ctx.translate(sx, sy - 4.5 - bounce); ctx.rotate(weed.x * 0.22);
                ctx.globalAlpha = 0.95 * fade; ctx.strokeStyle = "#7a5a34"; ctx.lineWidth = 0.9;
                for (let k2 = 0; k2 < 9; k2++) {
                    const a = k2 * 0.7; ctx.beginPath(); ctx.arc(0, 0, 2.5 + (k2 % 3) * 1.2, a, a + 2.1); ctx.stroke();
                }
                ctx.restore();
            }
        }
    }

    // cold breath: little clouds from each party member's mouth
    if (fx.breath && p.snowy) {
        const feet = S.feet || [];
        for (let i = 0; i < Math.min(feet.length, 3); i++) {
            const f = feet[i];
            const moving = i === 0 ? S.moving : S.moving;
            if (now >= nextBreath[i] || (i === 0 && wasMoving && !S.moving && now >= nextBreath[i] - 1500)) {
                const left = /left/.test(S.dir || ""), right = /right/.test(S.dir || "");
                breath.push({ x: f.x + (left ? -4 : right ? 4 : 0), y: f.y - (/up/.test(S.dir || "") ? 30 : 24), born: now, life: 1700 + Math.random() * 500, big: !S.moving && i === 0, vx: (left ? -3 : right ? 3 : 0) });
                nextBreath[i] = now + (moving ? 1700 : 2600) + i * 450 + Math.random() * 500;
            }
        }
        wasMoving = S.moving;
        if (breath.length > 40) breath.splice(0, breath.length - 40);
        for (let i = breath.length - 1; i >= 0; i--) {
            const b = breath[i], k = (now - b.born) / b.life;
            if (k >= 1) { breath.splice(i, 1); continue; }
            const sx = b.x + b.vx * k * 4 + S.wind * 0.18 * k - camX, sy = b.y - 9 * k - camY;
            const rad = (b.big ? 3.4 : 2.4) + k * (b.big ? 8.5 : 6);
            const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, rad);
            const a = (1 - k) * (b.big ? 0.62 : 0.46) * fade;
            g.addColorStop(0, `rgba(196,214,236,${(a * 1.25).toFixed(3)})`); g.addColorStop(0.6, `rgba(210,226,244,${(a * 0.7).toFixed(3)})`); g.addColorStop(1, "rgba(210,226,244,0)");
            ctx.globalAlpha = 1; ctx.fillStyle = g; ctx.fillRect(sx - rad, sy - rad, rad * 2, rad * 2);
        }
    }

    // frost creeping in from the screen edges in a blizzard
    if (fx.frost && p.snowy && L.blizzard > 0.05) {
        if (!frost) frost = makeFrost();
        ctx.globalAlpha = clamp01(L.blizzard) * 0.95 * fade;
        ctx.drawImage(frost, 0, 0);
    }
    ctx.globalAlpha = 1;
    window.__sc2Debug = { dragonflies: sc2.dragonflies ? sc2.dragonflies.length : 0, fishes: fishes.length, critters: critters.length, devil: !!devil, weed: !!weed, breath: breath.length, lamps: sc2.lamps ? sc2.lamps.length : 0, water: sc2.waterPts ? sc2.waterPts.length : 0, meadow: sc2.meadow ? sc2.meadow.length : 0, gust: !!gust };
}

// for scenery3.js: the lamps and lit windows found in the current map's picture
export const lampPoints = () => (sc2 && sc2.lamps) || [];
export const windowRects = () => (sc2 && sc2.windows) || [];
