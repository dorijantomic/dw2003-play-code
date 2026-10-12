// EXPERIMENT: scenery layer 3 — real night lighting (lit circles around the party, lamps
// and windows), window glow, screen-space rain and storm feel, rain rings on water, and
// biome wildlife (frogs, gulls, bats, lizards). Same rules as scenery.js / scenery2.js:
// everything in the world is anchored to map pixels, nothing is dragged by the camera.
// The only screen-space things are the ones that belong to the lens (raindrops on the
// "camera", the storm vignette and the blizzard desaturation).
import { darkness } from "./scenery.js";
import { lampPoints, windowRects } from "./scenery2.js";

const VIEW_W = 320;
const VIEW_H = 240;

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const smooth = (v) => { v = clamp01(v); return v * v * (3 - 2 * v); };
function rng(seed) {
    let s = seed >>> 0 || 1;
    return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

let id3 = null, r3 = Math.random, built3 = false;
let nl = null, nlx = null;
let lens = [], nextLens = 0;
let rings3 = [], nextRing = 0;
let frogs = [], lizards = [], gulls = [], bats = [];

export function resetScenery3(map, p) {
    id3 = map.id; built3 = false; r3 = rng(p.seed ^ 0x51ed270b);
    lens = []; rings3 = []; frogs = []; lizards = []; gulls = []; bats = [];
    nextLens = 0; nextRing = 0;
}

function scatterOn(S, count, test, tries = 90) {
    const px = S.pix();
    if (!px) return [];
    const out = [];
    for (let n = 0; out.length < count && n < count * tries; n++) {
        const x = r3() * px.w, y = r3() * px.h, o = ((y | 0) * px.w + (x | 0)) * 4;
        if (px.data[o + 3] < 128) continue;
        if (test(px.data[o], px.data[o + 1], px.data[o + 2])) out.push([x, y]);
    }
    return out;
}
function build(S) {
    const { p } = S;
    if (!S.pix()) return;
    built3 = true;
    if (p.swamp) frogs = scatterOn(S, 7, (r, g, b) => g > 70 && g > r * 1.12 && g > b * 1.08 && g < 190).map(([x, y]) => ({ x, y, hx: x, hy: y, hop: 0, until: 0, dir: 1, croak: 0 }));
    if (p.sandy) lizards = scatterOn(S, 6, (r, g, b) => r > 140 && g > 100 && b < 120 && r > b + 50).map(([x, y]) => ({ x, y, vx: 0, vy: 0, until: 0, dash: 0, face: 1 }));
    if (p.coast) {
        const cx = p.w * (0.35 + r3() * 0.3), cy = p.h * (0.35 + r3() * 0.3);
        gulls = Array.from({ length: 3 }, (_, i) => ({ cx, cy, rx: 110 + r3() * 90, ry: 50 + r3() * 40, sp: 0.16 + r3() * 0.08, ph: i * 2.1 + r3(), flap: r3() * 6 }));
    }
    if (p.bats) bats = Array.from({ length: 6 }, () => ({ x: r3() * p.w, y: r3() * p.h, vx: 0, vy: 0, ph: r3() * 6.28, home: [r3() * p.w, r3() * p.h] }));
}

// ----------------------------------------------------------------- lighting
function drawNightLight(ctx, S) {
    const { fx, p, now, fade, camX, camY, t } = S;
    const dark = darkness(p, fx, now);
    if (dark < 0.06) return;
    if (!nl) { nl = document.createElement("canvas"); nl.width = VIEW_W; nl.height = VIEW_H; nlx = nl.getContext("2d"); }
    nlx.globalCompositeOperation = "source-over";
    nlx.clearRect(0, 0, VIEW_W, VIEW_H);
    nlx.fillStyle = `rgba(5,9,28,${(0.5 * dark * fade).toFixed(3)})`;
    nlx.fillRect(0, 0, VIEW_W, VIEW_H);
    nlx.globalCompositeOperation = "destination-out";
    const hole = (x, y, rad, a) => {
        const g = nlx.createRadialGradient(x, y, 0, x, y, rad);
        g.addColorStop(0, `rgba(0,0,0,${a})`); g.addColorStop(0.55, `rgba(0,0,0,${(a * 0.6).toFixed(3)})`); g.addColorStop(1, "rgba(0,0,0,0)");
        nlx.fillStyle = g; nlx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    };
    for (const f of S.feet || []) {
        const x = f.x - camX, y = f.y - camY - 14;
        if (x < -90 || x > VIEW_W + 90 || y < -90 || y > VIEW_H + 90) continue;
        hole(x, y, f.leader ? 78 : 50, f.leader ? 0.96 : 0.7);
    }
    if (fx.lamps && p.lamps) for (const m of lampPoints()) {
        const x = m.x - camX, y = m.y - camY;
        if (x < -70 || x > VIEW_W + 70 || y < -70 || y > VIEW_H + 70) continue;
        hole(x, y, 30 + 34 * m.size + 2 * Math.sin(t * 7 + m.ph), 0.9);
    }
    if (fx.windows && p.lamps) for (const w of windowRects()) {
        const x = w.x - camX, y = w.y - camY;
        if (x < -80 || x > VIEW_W + 80 || y < -80 || y > VIEW_H + 80) continue;
        hole(x, y, 24 + Math.max(w.w, w.h) * 0.8, 0.82);
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
    ctx.drawImage(nl, 0, 0);
}

function drawWindows(ctx, S) {
    const { p, fx, now, t, fade, camX, camY } = S;
    const dark = darkness(p, fx, now);
    if (dark < 0.05) return;
    ctx.globalCompositeOperation = "lighter";
    for (const w of windowRects()) {
        const x = w.x - camX, y = w.y - camY;
        if (x < -60 || x > VIEW_W + 60 || y < -60 || y > VIEW_H + 60) continue;
        const fl = 0.9 + 0.06 * Math.sin(t * 3.1 + w.ph) + 0.04 * Math.sin(t * 11 + w.ph * 2);
        const a = dark * fade * fl;
        const rx = w.w * 0.5 + 6, ry = w.h * 0.5 + 6;
        // warm light spilling out of the window, then the window itself
        const g = ctx.createRadialGradient(x, y, 0, x, y, Math.max(rx, ry) * 2.3);
        g.addColorStop(0, `rgba(255,205,120,${(0.5 * a).toFixed(3)})`); g.addColorStop(1, "rgba(255,160,60,0)");
        ctx.globalAlpha = 1; ctx.fillStyle = g; ctx.fillRect(x - rx * 2.4, y - ry * 2.4, rx * 4.8, ry * 4.8);
        // the window itself: a soft warm glow, never a hard flat rectangle
        const ww = Math.min(w.w, 30), wh = Math.min(w.h, 26);
        const wg = ctx.createRadialGradient(x, y, 0, x, y, Math.max(ww, wh) * 0.75);
        wg.addColorStop(0, `rgba(255,226,160,${Math.min(0.55, 0.5 * a).toFixed(3)})`);
        wg.addColorStop(1, "rgba(255,200,110,0)");
        ctx.globalAlpha = 1; ctx.fillStyle = wg; ctx.fillRect(x - ww, y - wh, ww * 2, wh * 2);
    }
    ctx.globalCompositeOperation = "source-over";
}

// ------------------------------------------------------------- the lens
function drawLens(ctx, S) {
    const { fx, L, t, dt, now, fade } = S;
    const storm = Math.max(L.rain, L.blizzard), cold = L.blizzard, grit = L.sand;
    if (storm > 0.05 || grit > 0.05) {
        // storm vignette: darkens the corners while it is bad out
        const v = Math.max(storm * 0.34, grit * 0.2) * fade;
        const g = ctx.createRadialGradient(VIEW_W / 2, VIEW_H / 2, VIEW_H * 0.42, VIEW_W / 2, VIEW_H / 2, VIEW_W * 0.68);
        g.addColorStop(0, "rgba(6,12,28,0)"); g.addColorStop(1, `rgba(6,12,28,${v.toFixed(3)})`);
        ctx.globalAlpha = 1; ctx.fillStyle = g; ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    }
    if (cold > 0.05) {          // a blizzard drains the colour
        ctx.globalCompositeOperation = "saturation"; ctx.globalAlpha = 0.5 * cold * fade; ctx.fillStyle = "#808080";
        ctx.fillRect(0, 0, VIEW_W, VIEW_H); ctx.globalCompositeOperation = "source-over";
    }
    if (L.rain > 0.3) {         // raindrops on the lens, sliding down in fits and starts
        if (now >= nextLens && lens.length < 16) {
            nextLens = now + 380 + r3() * 700 / L.rain;
            const edge = r3();
            lens.push({ x: edge < 0.35 ? r3() * 54 : edge < 0.7 ? VIEW_W - r3() * 54 : r3() * VIEW_W, y: edge < 0.7 ? r3() * VIEW_H : r3() * 34,
                r: 1.2 + r3() * 2, born: now, life: 4500 + r3() * 3500, ph: r3() * 6.28 });
        }
        for (let i = lens.length - 1; i >= 0; i--) {
            const d = lens[i], k = (now - d.born) / d.life;
            if (k >= 1) { lens.splice(i, 1); continue; }
            const run = Math.max(0, Math.sin(t * 0.9 + d.ph));
            d.y += (2 + 14 * run * run) * dt;
            const a = Math.min(1, k * 8, (1 - k) * 3) * L.rain * fade;
            ctx.globalAlpha = 0.20 * a; ctx.fillStyle = "#cfe0ff";
            ctx.beginPath(); ctx.ellipse(d.x, d.y, d.r, d.r * 1.25, 0, 0, 6.2832); ctx.fill();
            ctx.globalAlpha = 0.55 * a; ctx.fillStyle = "#ffffff";
            ctx.beginPath(); ctx.arc(d.x - d.r * 0.35, d.y - d.r * 0.45, d.r * 0.32, 0, 6.2832); ctx.fill();
            if (run > 0.5) { ctx.globalAlpha = 0.12 * a; ctx.fillRect(d.x - 0.35, d.y - d.r * 4, 0.7, d.r * 4); }
        }
    } else lens.length = 0;
}

// ------------------------------------------------------------- wildlife
function drawWildlife(ctx, S) {
    const { p, L, t, dt, now, fade, camX, camY, Q } = S;
    const calm = L.rain < 0.35 && L.blizzard < 0.2 && L.sand < 0.4;
    // frogs: sit still, puff their throats, now and then hop
    for (let i = 0; i < Math.max(1, Math.round(frogs.length * Q)) && i < frogs.length; i++) {
        const f = frogs[i];
        if (now >= f.until) {
            f.until = now + 2500 + r3() * 5500;
            if (r3() < 0.55) { const a = r3() * 6.283; f.tx = f.hx + Math.cos(a) * 16; f.ty = f.hy + Math.sin(a) * 9; f.hop = 1; f.dir = Math.cos(a) >= 0 ? 1 : -1; f.t0 = now; }
            else f.croak = now;
        }
        let x = f.x, y = f.y, lift = 0;
        if (f.hop) {
            const k = (now - f.t0) / 420;
            if (k >= 1) { f.x = f.tx; f.y = f.ty; f.hop = 0; x = f.x; y = f.y; }
            else { x = f.x + (f.tx - f.x) * k; y = f.y + (f.ty - f.y) * k; lift = 4 * k * (1 - k) * 12; }
        }
        const sx = x - camX, sy = y - camY;
        if (sx < -8 || sx > VIEW_W + 8 || sy < -8 || sy > VIEW_H + 8) continue;
        const puff = Math.max(0, 1 - (now - f.croak) / 700) * Math.sin(((now - f.croak) / 700) * 18) ** 2;
        ctx.globalAlpha = 0.18 * fade; ctx.fillStyle = "#000";
        ctx.beginPath(); ctx.ellipse(sx, sy + 1, 3.6, 1.2, 0, 0, 6.2832); ctx.fill();
        ctx.globalAlpha = fade; ctx.fillStyle = "#5f9a46";
        ctx.beginPath(); ctx.ellipse(sx, sy - 2 - lift, 3.4, 2.4 + puff * 0.8, 0, 0, 6.2832); ctx.fill();
        ctx.fillStyle = "#4a7f37"; ctx.beginPath(); ctx.arc(sx + f.dir * 2.4, sy - 3.4 - lift, 1.7, 0, 6.2832); ctx.fill();
        ctx.fillStyle = "#f4f0b0"; ctx.fillRect(sx + f.dir * 2.6 - 0.7, sy - 4.6 - lift, 1.2, 1.1);
        if (puff > 0.1) { ctx.globalAlpha = 0.7 * puff * fade; ctx.fillStyle = "#d8e8a0"; ctx.beginPath(); ctx.arc(sx + f.dir * 1.2, sy - 0.6 - lift, 1.1 + puff * 1.2, 0, 6.2832); ctx.fill(); }
    }
    // lizards: freeze, then dash a short way over the sand
    for (const z of lizards) {
        if (now >= z.until) {
            if (z.dash) { z.dash = 0; z.until = now + 1800 + r3() * 4200; }
            else { const a = r3() * 6.283, v = 70 + r3() * 40; z.vx = Math.cos(a) * v; z.vy = Math.sin(a) * v * 0.5; z.face = z.vx >= 0 ? 1 : -1; z.dash = 1; z.until = now + 330 + r3() * 220; }
        }
        if (z.dash) { z.x += z.vx * dt; z.y += z.vy * dt; }
        const sx = z.x - camX, sy = z.y - camY;
        if (sx < -10 || sx > VIEW_W + 10 || sy < -10 || sy > VIEW_H + 10) continue;
        const wig = z.dash ? Math.sin(t * 40) * 0.8 : 0;
        ctx.globalAlpha = 0.18 * fade; ctx.fillStyle = "#000"; ctx.beginPath(); ctx.ellipse(sx, sy + 0.5, 4, 1.1, 0, 0, 6.2832); ctx.fill();
        ctx.globalAlpha = fade; ctx.strokeStyle = "#8c7448"; ctx.lineWidth = 1.5; ctx.lineCap = "round";
        ctx.beginPath(); ctx.moveTo(sx - z.face * 7, sy + wig); ctx.quadraticCurveTo(sx - z.face * 3, sy - wig, sx, sy); ctx.stroke();
        ctx.fillStyle = "#a28a58"; ctx.beginPath(); ctx.ellipse(sx + z.face * 1.5, sy - 0.4, 3.2, 1.6, 0, 0, 6.2832); ctx.fill();
        ctx.beginPath(); ctx.arc(sx + z.face * 4.6, sy - 0.5, 1.4, 0, 6.2832); ctx.fill();
    }
    // gulls: slow patrols high over the water, with their shadows far below
    if (calm) for (const g of gulls) {
        const a = t * g.sp + g.ph, wx = g.cx + Math.cos(a) * g.rx, wy = g.cy + Math.sin(a) * g.ry;
        const sx = wx - camX, sy = wy - camY - 46;
        const hd = Math.sign(-Math.sin(a)) || 1, flap = Math.sin(t * (3 + g.flap * 0.2) + g.flap);
        if (sx > -24 && sx < VIEW_W + 24 && wy - camY > -30 && wy - camY < VIEW_H + 30) {
            ctx.globalAlpha = 0.13 * fade; ctx.fillStyle = "#000"; ctx.beginPath(); ctx.ellipse(sx, wy - camY, 6, 1.8, 0, 0, 6.2832); ctx.fill();
        }
        if (sx < -24 || sx > VIEW_W + 24 || sy < -24 || sy > VIEW_H + 24) continue;
        ctx.globalAlpha = 0.95 * fade; ctx.strokeStyle = "#f6f6f2"; ctx.lineWidth = 1.5; ctx.lineCap = "round";
        ctx.beginPath(); ctx.moveTo(sx - 7, sy - flap * 2.4); ctx.quadraticCurveTo(sx - 3, sy - 3 - flap, sx, sy); ctx.quadraticCurveTo(sx + 3, sy - 3 - flap, sx + 7, sy - flap * 2.4); ctx.stroke();
        ctx.fillStyle = "#e4e4de"; ctx.fillRect(sx - 1.2 + hd, sy - 0.5, 3, 1.4);
    }
    // bats: erratic, fast, only once it is properly dusk
    const dusk = darkness(p, S.fx, now);
    if (dusk > 0.3 && calm) for (const b of bats) {
        const tx = b.home[0] + Math.sin(t * 0.31 + b.ph) * 150 + Math.sin(t * 0.77 + b.ph * 2) * 60, ty = b.home[1] + Math.cos(t * 0.27 + b.ph) * 90;
        b.vx += (tx - b.x) * 0.9 * dt + (r3() - 0.5) * 220 * dt; b.vy += (ty - b.y) * 0.9 * dt + (r3() - 0.5) * 220 * dt;
        const sp = Math.hypot(b.vx, b.vy); if (sp > 90) { b.vx *= 90 / sp; b.vy *= 90 / sp; }
        b.x += b.vx * dt; b.y += b.vy * dt;
        const sx = b.x - camX, sy = b.y - camY - 28;
        if (sx < -12 || sx > VIEW_W + 12 || sy < -12 || sy > VIEW_H + 12) continue;
        const flap = Math.sin(t * 24 + b.ph) * 2.6;
        ctx.globalAlpha = Math.min(1, (dusk - 0.3) * 3) * 0.92 * fade; ctx.fillStyle = "#16121c";
        ctx.beginPath(); ctx.moveTo(sx - 5, sy - flap); ctx.quadraticCurveTo(sx - 2, sy + 1.5, sx, sy + 0.5); ctx.quadraticCurveTo(sx + 2, sy + 1.5, sx + 5, sy - flap);
        ctx.lineTo(sx + 2, sy + 1); ctx.lineTo(sx, sy + 2.2); ctx.lineTo(sx - 2, sy + 1); ctx.closePath(); ctx.fill();
    }
}

// rain pocking the water: rings at random water pixels in view
function drawWaterRain(ctx, S) {
    const { L, fade, camX, camY, now, Q } = S;
    if (L.rain < 0.25) { rings3.length = 0; return; }
    if (now >= nextRing && rings3.length < 40) {
        nextRing = now + 70 / Math.max(0.3, L.rain * Q);
        for (let tries = 0; tries < 6; tries++) {
            const x = camX + r3() * VIEW_W, y = camY + r3() * VIEW_H;
            if (S.isWater(x, y)) { rings3.push({ x, y, born: now, life: 800 + r3() * 500 }); break; }
        }
    }
    ctx.lineWidth = 0.5; ctx.strokeStyle = "#e8f2ff";
    for (let i = rings3.length - 1; i >= 0; i--) {
        const r = rings3[i], k = (now - r.born) / r.life;
        if (k >= 1) { rings3.splice(i, 1); continue; }
        ctx.globalAlpha = (1 - k) * 0.55 * L.rain * fade;
        ctx.beginPath(); ctx.ellipse(r.x - camX, r.y - camY, 1 + k * 8, 0.4 + k * 3.2, 0, 0, 6.2832); ctx.stroke();
    }
}

export function drawScenery3(ctx, S) {
    if (id3 !== S.map.id) return;
    const { fx, p } = S;
    if (!built3) build(S);
    if (fx.rainwater && p.rainy) drawWaterRain(ctx, S);
    if (fx.wildlife) drawWildlife(ctx, S);
    if (fx.windows && p.lamps) drawWindows(ctx, S);
    if (fx.nightlight && p.open) drawNightLight(ctx, S);
    if (fx.screenfx && p.open) drawLens(ctx, S);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
}
