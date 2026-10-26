// EXPERIMENT: scenery layer for the 2D overworld maps — the effects that are not
// weather: time-of-day light, fog, light shafts, heat shimmer, ice sparkle, pollen,
// butterflies, birds and lightning, plus the ground layer (puddles, footprints,
// dust and wading ripples) that sits under the party.
//
// Everything lives in WORLD space (map pixels). Particles are wrapped onto a torus a
// little bigger than the view, so the camera moving never drags them along and the
// strip of world it uncovers is already populated (see the wrap helpers in S).
// ambience.js decides which maps get which effect and calls into here.

const VIEW_W = 320;
const VIEW_H = 240;

// ------------------------------------------------------------------ helpers
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const smooth = (v) => { v = clamp01(v); return v * v * (3 - 2 * v); };
function rng(seed) {
    let s = seed >>> 0 || 1;
    return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}
const isGrassPx = (r, g, b) => g >= 105 && g > r * 1.22 && g > b * 1.7 && g - b >= 55;
const isWaterPx = (r, g, b) => b >= 62 && b > r + 28 && b > g + 6 && r < 150;

// ------------------------------------------------------------- time of day
// Keyframes over one cycle: [phase, rgb]. Drawn as a multiply layer, so white = no change.
const TOD = [
    [0.00, [255, 255, 255]], [0.38, [255, 255, 255]], [0.52, [255, 196, 128]],
    [0.64, [255, 150, 86]], [0.77, [150, 132, 196]], [0.89, [255, 196, 148]], [1.00, [255, 255, 255]],
];
const TOD_SECONDS = 240;
function todColor(phase) {
    for (let i = 1; i < TOD.length; i++) {
        if (phase <= TOD[i][0]) {
            const [p0, c0] = TOD[i - 1], [p1, c1] = TOD[i];
            const k = smooth((phase - p0) / (p1 - p0));
            return c0.map((v, j) => Math.round(v + (c1[j] - v) * k));
        }
    }
    return [255, 255, 255];
}
/** Where the day cycle is right now, 0..1 (window.__todForce pins it; the panel's Time setting writes that). */
export const todPhaseNow = () => (typeof window.__todForce === "number" ? window.__todForce : (performance.now() / 1000 / TOD_SECONDS) % 1);
/** One lightning flash on cue (a quest scene's `lightning` step): the same bolt the storm's own timer draws. */
export function cueBolt(now = performance.now()) { bolt = { t0: now }; }

// --------------------------------------------------------------- per-map state
let sc = null;               // state of the map being shown
let tmp = null;              // scratch canvas for the heat shimmer
let flock = null, nextFlock = 0;
let nextBolt = 0, bolt = null;
let wet = 0;                 // how soaked the ground is, 0..1
let todLight = 1;            // 1 in daylight, lower toward dusk
let steps = [], puffs = [], ripples = [];
let lastStep = null, nextPuff = 0, stepSide = 1;

export function resetScenery(map, p, S) {
    const r = rng(p.seed ^ 0x2545f491);
    sc = { id: map.id, built: false };
    const W = S.DWB, H = S.DHB;
    sc.fog = Array.from({ length: 9 }, () => ({
        x: r() * W, y: r() * H, rad: 90 + r() * 90, vx: 6 + r() * 10, vy: (r() - 0.5) * 4, a: 0.24 + r() * 0.18,
    }));
    sc.shafts = Array.from({ length: 6 }, () => ({ u: r() * (VIEW_W + 160), w: 40 + r() * 52, a: 0.30 + r() * 0.16, ph: r() * 6.28 }));
    sc.pollen = Array.from({ length: 80 }, () => ({
        x: r() * S.DW, y: r() * S.DH, vx: 3 + r() * 6, vy: -2 - r() * 4, ph: r() * 6.28, s: 0.7 + r() * 0.9,
    }));
    sc.rand = r;
    flock = null; nextFlock = performance.now() + 4000 + r() * 6000;
    nextBolt = performance.now() + 5000 + r() * 6000; bolt = null;
    steps = []; puffs = []; ripples = []; lastStep = null; wet = 0;
    ents.clear(); splashDrops = [];
}

// positions that need a pixel look-up (butterflies, sparkles, puddles) are built
// the first frame the map's pixels are readable
function scatter(S, count, test, tries = 80) {
    const px = S.pix();
    if (!px) return [];
    const out = [];
    const r = sc.rand;
    for (let n = 0; out.length < count && n < count * tries; n++) {
        const x = r() * px.w, y = r() * px.h, o = ((y | 0) * px.w + (x | 0)) * 4;
        if (px.data[o + 3] < 128) continue;
        if (test(px.data[o], px.data[o + 1], px.data[o + 2], x, y)) out.push([x, y]);
    }
    return out;
}
function build(S) {
    const { p, fx } = S;
    if (!S.pix()) return;
    sc.built = true;
    const r = sc.rand;
    sc.flies = p.butterflies
        ? scatter(S, 26, (R, G, B) => isGrassPx(R, G, B)).map(([x, y]) => ({
            x, y, ax: 25 + r() * 45, ay: 14 + r() * 26, fx: 0.25 + r() * 0.35, fy: 0.3 + r() * 0.4, ph: r() * 6.28,
            col: ["#ff9a3c", "#fff2c2", "#6fb7ff", "#ffd23f", "#f78fb3"][(r() * 5) | 0],
        })) : [];
    sc.sparkles = p.snowy
        ? scatter(S, 340, (R, G, B) => R > 170 && G > 195 && B > 210).map(([x, y]) => ({ x, y, ph: r(), sp: 0.25 + r() * 0.5 })) : [];
    sc.puddlesDone = false; sc.iceDone = false;
}
function buildPuddles(S, grid) {
    sc.puddlesDone = true;
    const r = sc.rand;
    const walk = (x, y) => {
        const c = (x / grid.cell) | 0, rr = (y / grid.cell) | 0;
        return c >= 0 && rr >= 0 && c < grid.cols && rr < grid.rows && grid.cells[rr * grid.cols + c] === 0;
    };
    sc.puddles = scatter(S, 46, (R, G, B, x, y) => !isGrassPx(R, G, B) && !isWaterPx(R, G, B) && walk(x, y))
        .map(([x, y]) => ({ x, y, rx: 6 + r() * 12, ph: r() * 6.28 }));
}

// ----------------------------------------------------------------- overlay
// Called with the game's 2D context (view units, clipped to the view).
// Lights register here: they get the untinted frame so they can put the real colours back around
// themselves (a lamp lights the wall, instead of adding white on top of the night tint).
let revealer = null;
export const setReveal = (r) => { revealer = r; };
let snapC = null;
function takeSnap(ctx) {
    const cv = ctx.canvas;
    if (!snapC || snapC.width !== cv.width || snapC.height !== cv.height) { snapC = document.createElement("canvas"); snapC.width = cv.width; snapC.height = cv.height; }
    const g = snapC.getContext("2d");
    g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = "copy"; g.drawImage(cv, 0, 0);
    return snapC;
}

// Indoors and underground there is no sky to dim, but the stage has its own lights: a gentle cool
// dim stands in for the night so they can show, with the same reveal that restores true colours.
function drawIndoorMood(ctx, S) {
    const { fade } = S;
    const snap = revealer && revealer.wants(S) ? takeSnap(ctx) : null;
    ctx.globalCompositeOperation = "multiply"; ctx.globalAlpha = fade;
    // full mood in a dark room, fading to nothing as the room gets brighter (see indoorK in ambience.js)
    const d = 1 - 0.33 * S.p.indoorK, c = (v) => Math.round(255 * Math.max(0, Math.min(1, v)));
    ctx.fillStyle = `rgb(${c(d + 0.005)},${c(d - 0.011)},${c(d + 0.09)})`; ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    const vg = ctx.createRadialGradient(VIEW_W / 2, VIEW_H / 2, VIEW_H * 0.4, VIEW_W / 2, VIEW_H / 2, VIEW_W * 0.7);
    vg.addColorStop(0, "rgba(14,10,36,0)"); vg.addColorStop(1, `rgba(14,10,36,${(0.35 * S.p.indoorK).toFixed(3)})`);
    ctx.globalCompositeOperation = "source-over"; ctx.fillStyle = vg; ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.globalAlpha = 1;
    if (snap) revealer.draw(ctx, snap, S);
}

export function drawScenery(ctx, S) {
    if (!sc || sc.id !== S.map.id) return;
    const { fx, p, L, t, dt, fade, camX, camY, Q, now } = S;
    if (!sc.built) build(S);

    todLight = 1;
    // time of day: a multiply tint (warm at golden hour, cool and darker at dusk)
    if (fx.indoor && p.indoorLit) drawIndoorMood(ctx, S);
    if (fx.tod && p.tod) {
        const phase = todPhaseNow();
        const [r, g, b] = todColor(phase);
        todLight = (r + g + b) / 765;
        if (r + g + b < 760) {
            const snap = revealer && revealer.wants(S) ? takeSnap(ctx) : null;
            ctx.globalCompositeOperation = "multiply"; ctx.globalAlpha = fade;
            ctx.fillStyle = `rgb(${r},${g},${b})`; ctx.fillRect(0, 0, VIEW_W, VIEW_H);
            const dusk = 1 - (r + g + b) / 765;
            if (dusk > 0.12) {
                const vg = ctx.createRadialGradient(VIEW_W / 2, VIEW_H / 2, VIEW_H * 0.35, VIEW_W / 2, VIEW_H / 2, VIEW_W * 0.68);
                vg.addColorStop(0, "rgba(20,10,50,0)"); vg.addColorStop(1, `rgba(20,10,50,${(dusk * 0.9).toFixed(3)})`);
                ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = fade; ctx.fillStyle = vg;
                ctx.fillRect(0, 0, VIEW_W, VIEW_H);
            }
            ctx.globalCompositeOperation = "source-over";
            if (snap) revealer.draw(ctx, snap, S);
        }
    }

    // heat shimmer: the finished frame is re-drawn in thin strips shifted sideways by a wave
    if (fx.heat && p.heat) {
        const cv = ctx.canvas;
        if (!tmp || tmp.width !== cv.width || tmp.height !== cv.height) { tmp = document.createElement("canvas"); tmp.width = cv.width; tmp.height = cv.height; }
        tmp.getContext("2d").drawImage(cv, 0, 0);
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        const amp = 1.7 * (0.65 + 0.35 * Math.sin(t * 0.6)) * fade, STEP = 3;
        for (let y = 0; y < cv.height; y += STEP) {
            const off = Math.sin(y * 0.11 + t * 2.4) * amp + Math.sin(y * 0.047 - t * 1.3) * amp * 0.6;
            ctx.drawImage(tmp, 0, y, cv.width, STEP, off, y, cv.width, STEP);
        }
        ctx.restore();
    }

    // light shafts through the canopy: slanted world-anchored bands, additive
    if (fx.shafts && p.shafts && L.rain < 0.5) {
        const k = 0.42, vis = (1 - L.rain * 1.6) * fade * clamp01((todLight - 0.5) * 3);
        ctx.globalCompositeOperation = "lighter";
        for (const s of sc.shafts) {
            const base = S.wrapRange(s.u + k * camY - camX, VIEW_W + 160, 80);
            const a = s.a * (0.65 + 0.35 * Math.sin(t * 0.5 + s.ph)) * vis;
            const g = ctx.createLinearGradient(base - s.w / 2, 0, base + s.w / 2, 0);
            g.addColorStop(0, "rgba(255,243,190,0)"); g.addColorStop(0.5, `rgba(255,243,190,${a.toFixed(3)})`); g.addColorStop(1, "rgba(255,243,190,0)");
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.moveTo(base - s.w / 2, 0); ctx.lineTo(base + s.w / 2, 0);
            ctx.lineTo(base + s.w / 2 + k * VIEW_H, VIEW_H); ctx.lineTo(base - s.w / 2 + k * VIEW_H, VIEW_H);
            ctx.closePath(); ctx.fill();
            // a brighter, narrower core so the beam reads as a beam, not a haze
            const w2 = s.w * 0.34, g2 = ctx.createLinearGradient(base - w2 / 2, 0, base + w2 / 2, 0);
            g2.addColorStop(0, "rgba(255,248,205,0)"); g2.addColorStop(0.5, `rgba(255,248,205,${Math.min(1, a * 1.35).toFixed(3)})`); g2.addColorStop(1, "rgba(255,248,205,0)");
            ctx.fillStyle = g2;
            ctx.beginPath();
            ctx.moveTo(base - w2 / 2, 0); ctx.lineTo(base + w2 / 2, 0);
            ctx.lineTo(base + w2 / 2 + k * VIEW_H, VIEW_H); ctx.lineTo(base - w2 / 2 + k * VIEW_H, VIEW_H);
            ctx.closePath(); ctx.fill();
        }
        ctx.globalCompositeOperation = "source-over";
    }

    // fog and morning mist: big soft blobs drifting on the wind ("fogK" is a quest scene's strength on a map that is not
    // foggy; absent on every other map, so the ordinary look is unchanged)
    if (fx.fog && p.fog) {
        const dens = (0.55 + 0.45 * Math.sin(t / 31 + (p.seed % 7))) * fade * (0.5 + 0.5 * Q) * (p.fogK ?? 1);
        const col = p.night ? "150,172,218" : "208,224,214";
        for (const b of sc.fog) {
            b.x += b.vx * dt; b.y += b.vy * dt;
            const bx = S.wrapXB(b.x, camX), by = S.wrapYB(b.y, camY);
            if (bx < -b.rad || bx > VIEW_W + b.rad || by < -b.rad || by > VIEW_H + b.rad) continue;
            const g = ctx.createRadialGradient(bx, by, 0, bx, by, b.rad);
            g.addColorStop(0, `rgba(${col},${(b.a * dens).toFixed(3)})`); g.addColorStop(1, `rgba(${col},0)`);
            ctx.globalAlpha = 1; ctx.fillStyle = g; ctx.fillRect(bx - b.rad, by - b.rad, b.rad * 2, b.rad * 2);
        }
    }

    // pollen and drifting seeds
    if (fx.pollen && p.pollen && L.rain < 0.3) {
        ctx.globalCompositeOperation = "lighter"; ctx.fillStyle = "#fff6c8";
        const n = Math.round(sc.pollen.length * Q);
        for (let i = 0; i < sc.pollen.length; i++) {
            const o = sc.pollen[i];
            o.x += (o.vx + Math.sin(t * 0.7 + o.ph) * 4) * dt; o.y += (o.vy + Math.cos(t * 0.5 + o.ph) * 3) * dt;
            if (i >= n) continue;
            const sx = S.wrapX(o.x, camX), sy = S.wrapY(o.y, camY);
            if (sx < -2 || sx > VIEW_W + 2 || sy < -2 || sy > VIEW_H + 2) continue;
            ctx.globalAlpha = (0.25 + 0.5 * Math.abs(Math.sin(t * 1.3 + o.ph))) * fade * (1 - L.rain * 2);
            ctx.beginPath(); ctx.arc(sx, sy, o.s * 0.7, 0, 6.2832); ctx.fill();
        }
        ctx.globalCompositeOperation = "source-over";
    }

    // butterflies: wander over the grass they were born on
    if (fx.butterflies && p.butterflies && sc.flies && L.rain < 0.25) {
        const n = Math.round(sc.flies.length * Q), vis = fade * (1 - L.rain * 3);
        for (let i = 0; i < n; i++) {
            const f = sc.flies[i];
            const x = f.x + Math.sin(t * f.fx + f.ph) * f.ax + Math.sin(t * f.fx * 0.37 + f.ph * 2) * f.ax * 0.6 - camX;
            const y = f.y + Math.sin(t * f.fy + f.ph * 1.7) * f.ay + Math.cos(t * f.fy * 0.41) * f.ay * 0.5 - camY;
            if (x < -6 || x > VIEW_W + 6 || y < -6 || y > VIEW_H + 6) continue;
            const flap = 0.25 + 0.75 * Math.abs(Math.sin(t * 11 + f.ph * 3));
            ctx.globalAlpha = 0.95 * vis; ctx.fillStyle = f.col;
            ctx.beginPath();
            ctx.ellipse(x - 1.7, y, 1.7 * flap + 0.2, 2.3, -0.3, 0, 6.2832);
            ctx.ellipse(x + 1.7, y, 1.7 * flap + 0.2, 2.3, 0.3, 0, 6.2832);
            ctx.fill();
            ctx.globalAlpha = 0.9 * vis; ctx.fillStyle = "#2a2230"; ctx.fillRect(x - 0.3, y - 1.4, 0.7, 2.8);
        }
    }

    // birds: an occasional small flock crosses the map high above, throwing shadows
    if (fx.birds && p.birds) {
        if (!flock && now >= nextFlock && L.rain < 0.2 && L.blizzard < 0.2 && L.sand < 0.2) {
            const r = sc.rand, dir = r() < 0.5 ? 1 : -1, n = 3 + ((r() * 3) | 0), sp = 48 + r() * 30;
            const x0 = camX + (dir > 0 ? -50 : VIEW_W + 50), y0 = camY + 40 + r() * 150;
            flock = { dir, birds: Array.from({ length: n }, (_, i) => ({ x: x0 - dir * i * 15 - r() * 8, y: y0 + (i % 2 ? 1 : -1) * i * 7 + r() * 6, ph: r() * 6.28 })), sp, vy: (r() - 0.5) * 10, age: 0 };
        }
        if (flock) {
            flock.age += dt;
            let any = false;
            for (const b of flock.birds) {
                b.x += flock.dir * flock.sp * dt; b.y += flock.vy * dt;
                const sx = b.x - camX, sy = b.y - camY;
                if (sx > -40 && sx < VIEW_W + 40) any = true;
                if (sx < -20 || sx > VIEW_W + 20 || sy < -20 || sy > VIEW_H + 20) continue;
                ctx.globalAlpha = 0.14 * fade; ctx.fillStyle = "#000";
                ctx.beginPath(); ctx.ellipse(sx + 6, sy + 34, 5, 1.8, 0, 0, 6.2832); ctx.fill();
                const flap = Math.sin(t * 9 + b.ph) * 3.2;
                ctx.globalAlpha = 0.85 * fade; ctx.strokeStyle = "#1c1b26"; ctx.lineWidth = 1.2; ctx.lineCap = "round";
                ctx.beginPath(); ctx.moveTo(sx - 5, sy - flap); ctx.quadraticCurveTo(sx - 2, sy + 1, sx, sy); ctx.quadraticCurveTo(sx + 2, sy + 1, sx + 5, sy - flap); ctx.stroke();
            }
            if (!any && flock.age > 3) { flock = null; nextFlock = now + 14000 + sc.rand() * 24000; }
        }
    }

    // ice sparkle: twinkling glints on bright snow and ice
    if (fx.sparkle && p.snowy && sc.sparkles) {
        ctx.globalCompositeOperation = "lighter"; ctx.strokeStyle = "#dff3ff"; ctx.fillStyle = "#ffffff"; ctx.lineWidth = 0.6;
        for (const s of sc.sparkles) {
            const sx = s.x - camX, sy = s.y - camY;
            if (sx < -4 || sx > VIEW_W + 4 || sy < -4 || sy > VIEW_H + 4) continue;
            const ph = (t * s.sp + s.ph) % 1;
            if (ph > 0.14) continue;
            const a = Math.sin((ph / 0.14) * Math.PI), len = 1 + 3 * a;
            ctx.globalAlpha = a * fade * (1 - L.blizzard * 0.8);
            ctx.beginPath(); ctx.moveTo(sx - len, sy); ctx.lineTo(sx + len, sy); ctx.moveTo(sx, sy - len); ctx.lineTo(sx, sy + len); ctx.stroke();
            ctx.beginPath(); ctx.arc(sx, sy, 0.7, 0, 6.2832); ctx.fill();
        }
        ctx.globalCompositeOperation = "source-over";
    }

    // lightning: only in a proper downpour; the thunder follows the flash
    if (fx.lightning && fx.rain && L.rain > 0.6) {
        if (window.__forceBolt) { window.__forceBolt = false; nextBolt = 0; }   // filming: strike on cue
        if (!bolt && now >= nextBolt) {
            bolt = { t0: now };
            nextBolt = now + 7000 + sc.rand() * 14000;
            S.onThunder(350 + sc.rand() * 1900);
        }
    }
    if (bolt) {
        const e = (now - bolt.t0) / 1000;
        const f = e < 0.07 ? 1 : e < 0.15 ? 0.25 : e < 0.21 ? 0.8 : Math.max(0, 0.8 * (1 - (e - 0.21) / 0.4));
        if (f <= 0) bolt = null;
        else {
            ctx.globalCompositeOperation = "lighter"; ctx.globalAlpha = 0.5 * f; ctx.fillStyle = "rgb(205,222,255)";
            ctx.fillRect(0, 0, VIEW_W, VIEW_H); ctx.globalCompositeOperation = "source-over";
        }
    }
}

// ------------------------------------------------------------ ground layer
// Drawn after the map and before every sprite: puddles, ice, footprints, dust,
// splashes and ripples. Works for every body in view (leader, partners and NPCs):
// S.feet is [{ id, x, y, moving, dir, leader }] gathered by game.js each frame.
const ents = new Map();          // body id -> { last, side, nextPuff, nextFoot }
let splashDrops = [];

function groundType(S, f, puddle, inWater) {
    if (inWater) return "water";
    if (puddle) return "puddle";
    const { p } = S;
    const px = S.pix();
    let r = 0, g = 0, b = 0;
    if (px) {
        const o = ((f.y | 0) * px.w + (f.x | 0)) * 4;
        if (o >= 0 && o < px.data.length) { r = px.data[o]; g = px.data[o + 1]; b = px.data[o + 2]; }
    }
    if (p.snowy && r > 165 && g > 185 && b > 200) return "snow";
    if (p.sandy) return "sand";
    if (isGrassPx(r, g, b)) return "grass";
    const brown = r > g && g > b && r - b > 30 && r < 215 && r > 70;
    if (brown && /Bridge|Bay|Dock|Inn|Island|Cape|Beach|Swamp|Forest/.test(S.map.name)) return "wood";
    if (/Bridge|Factory|Tower|Station/.test(S.map.name) && Math.abs(r - g) < 26 && Math.abs(g - b) < 40) return "metal";
    return "stone";
}

function buildIce(S, grid) {
    sc.iceDone = true;
    const r = sc.rand;
    const walk = (x, y) => {
        const c = (x / grid.cell) | 0, rr = (y / grid.cell) | 0;
        return c >= 0 && rr >= 0 && c < grid.cols && rr < grid.rows && grid.cells[rr * grid.cols + c] === 0;
    };
    sc.ice = scatter(S, 30, (R, G, B, x, y) => R > 150 && G > 175 && B > 195 && walk(x, y))
        .map(([x, y]) => ({ x, y, rx: 8 + r() * 14, ph: r() * 6.28, rot: (r() - 0.5) * 0.4 }));
}

export function groundScenery(ctx, S) {
    if (!sc || sc.id !== S.map.id) return;
    const { fx, p, L, t, dt, camX, camY, now } = S;
    if (!sc.built) build(S);
    const feet = S.feet || [];

    // soaking: rain wets the ground, it dries slowly
    // (the wetness itself is advanced every frame by tickWet(), called from ambience.js)
    const grid = S.grid();
    if (grid && fx.puddles) {
        if (p.rainy && !sc.puddlesDone && wet > 0.05) buildPuddles(S, grid);
        if (p.snowy && !sc.iceDone) buildIce(S, grid);
    }

    for (const f of feet) {
        if (!Number.isFinite(f.x) || !Number.isFinite(f.y)) continue;
        const sx0 = f.x - camX, sy0 = f.y - camY;
        if (sx0 < -40 || sx0 > VIEW_W + 40 || sy0 < -40 || sy0 > VIEW_H + 60) continue;
        let e = ents.get(f.id);
        if (!e) { e = { last: null, side: 1, nextPuff: 0, nextFoot: 0 }; ents.set(f.id, e); }
        const inWater = S.isWater(f.x, f.y);
        if (fx.steps && f.moving) {
            if (!e.last || Math.hypot(f.x - e.last[0], f.y - e.last[1]) > 9) {
                if (p.snowy) steps.push({ x: f.x + e.side * 2.4, y: f.y, born: now, life: 22000, c: "120,150,190", a: 0.5 });
                else if (p.sandy) steps.push({ x: f.x + e.side * 2.4, y: f.y, born: now, life: 11000, c: "125,92,52", a: 0.34 });
                e.side = -e.side; e.last = [f.x, f.y];
            }
            if ((p.snowy || p.sandy) && now >= e.nextPuff && !inWater) {
                e.nextPuff = now + 110;
                puffs.push({ x: f.x + (Math.random() - 0.5) * 6, y: f.y + 1, born: now, life: 650, vx: (Math.random() - 0.5) * 10, vy: -4 - Math.random() * 5,
                    c: p.snowy ? "246,251,255" : "206,176,122" });
            }
            if (inWater && now >= e.nextPuff) { e.nextPuff = now + 190; ripples.push({ x: f.x, y: f.y + 1, born: now, life: 900 }); }
        }
        if (f.moving && now >= e.nextFoot) {
            e.nextFoot = now + 300;
            let hit = null;
            if (fx.puddles && wet > 0.3 && sc.puddles) for (const d of sc.puddles) if (Math.abs(d.x - f.x) < d.rx * 0.9 && Math.abs(d.y - f.y) < d.rx * 0.5) { hit = d; break; }
            if (hit) {
                ripples.push({ x: f.x, y: f.y + 1, born: now, life: 800 });
                for (let k = 0; k < 6; k++) splashDrops.push({ x: f.x, y: f.y, born: now, life: 520, vx: (Math.random() - 0.5) * 34, vy: -(22 + Math.random() * 22) });
            }
            if (f.leader || (sx0 > 0 && sx0 < VIEW_W && sy0 > 0 && sy0 < VIEW_H)) S.onStep(groundType(S, f, hit, inWater), f.leader ? 1 : 0.4);
        }
    }
    if (ents.size > 60) ents.clear();
    if (steps.length > 160) steps.splice(0, steps.length - 160);
    if (puffs.length > 60) puffs.splice(0, puffs.length - 60);
    if (ripples.length > 30) ripples.splice(0, ripples.length - 30);
    if (splashDrops.length > 80) splashDrops.splice(0, splashDrops.length - 80);

    ctx.save();
    // frozen puddles on snow and ice maps
    if (fx.puddles && p.snowy && sc.ice) {
        for (const d of sc.ice) {
            const sx = d.x - camX, sy = d.y - camY;
            if (sx < -26 || sx > VIEW_W + 26 || sy < -14 || sy > VIEW_H + 14) continue;
            const rx = d.rx, ry = rx * 0.46;
            ctx.save(); ctx.translate(sx, sy); ctx.rotate(d.rot);
            ctx.globalAlpha = 0.5; ctx.fillStyle = "#bfe2f4";
            ctx.beginPath(); ctx.ellipse(0, 0, rx, ry, 0, 0, 6.2832); ctx.fill();
            ctx.globalAlpha = 0.5; ctx.strokeStyle = "#7fb0d4"; ctx.lineWidth = 0.7;
            ctx.beginPath(); ctx.ellipse(0, 0, rx, ry, 0, 0, 6.2832); ctx.stroke();
            const glint = 0.5 + 0.5 * Math.sin(t * 0.8 + d.ph);
            ctx.globalAlpha = 0.28 + 0.4 * glint; ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 1.1;
            ctx.beginPath(); ctx.moveTo(-rx * 0.5, -ry * 0.25); ctx.lineTo(-rx * 0.05, -ry * 0.55); ctx.stroke();
            ctx.globalAlpha = 0.3; ctx.lineWidth = 0.5; ctx.strokeStyle = "#e9f6ff";
            ctx.beginPath(); ctx.moveTo(-rx * 0.3, ry * 0.1); ctx.lineTo(rx * 0.1, -ry * 0.1); ctx.lineTo(rx * 0.35, ry * 0.3); ctx.stroke();
            ctx.restore();
        }
    }
    // puddles
    if (fx.puddles && p.rainy && wet > 0.05 && sc.puddles) {
        const a = smooth(wet) * 0.8;
        for (const d of sc.puddles) {
            const sx = d.x - camX, sy = d.y - camY;
            if (sx < -24 || sx > VIEW_W + 24 || sy < -12 || sy > VIEW_H + 12) continue;
            const rx = d.rx * (0.55 + 0.45 * smooth(wet)), ry = rx * 0.45;
            ctx.globalAlpha = a * 0.55; ctx.fillStyle = "#1b2a3e";
            ctx.beginPath(); ctx.ellipse(sx, sy, rx, ry, 0, 0, 6.2832); ctx.fill();
            ctx.globalAlpha = a * 0.30; ctx.fillStyle = "#9fc0ea";
            ctx.beginPath(); ctx.ellipse(sx - rx * 0.12, sy - ry * 0.2, rx * 0.72, ry * 0.55, 0, 0, 6.2832); ctx.fill();
            if (L.rain > 0.2) {
                const ph = (t * 1.1 + d.ph) % 1;
                ctx.globalAlpha = (1 - ph) * 0.5 * a; ctx.strokeStyle = "#e6f0ff"; ctx.lineWidth = 0.5;
                ctx.beginPath(); ctx.ellipse(sx + Math.sin(d.ph * 9) * rx * 0.4, sy, 1 + ph * rx * 0.6, 0.4 + ph * ry * 0.6, 0, 0, 6.2832); ctx.stroke();
            }
        }
    }
    // footprints
    for (let i = steps.length - 1; i >= 0; i--) {
        const s = steps[i], age = now - s.born;
        if (age > s.life) { steps.splice(i, 1); continue; }
        const sx = s.x - camX, sy = s.y - camY;
        if (sx < -4 || sx > VIEW_W + 4 || sy < -4 || sy > VIEW_H + 4) continue;
        ctx.globalAlpha = s.a * (1 - smooth((age / s.life - 0.55) / 0.45));
        ctx.fillStyle = `rgb(${s.c})`;
        ctx.beginPath(); ctx.ellipse(sx, sy, 2.1, 1.2, 0, 0, 6.2832); ctx.fill();
    }
    // wading ripples and puddle splashes
    ctx.strokeStyle = "#e6f2ff"; ctx.lineWidth = 0.6;
    for (let i = ripples.length - 1; i >= 0; i--) {
        const r = ripples[i], k = (now - r.born) / r.life;
        if (k >= 1) { ripples.splice(i, 1); continue; }
        ctx.globalAlpha = (1 - k) * 0.7;
        ctx.beginPath(); ctx.ellipse(r.x - camX, r.y - camY, 2 + k * 11, 0.9 + k * 4.6, 0, 0, 6.2832); ctx.stroke();
    }
    ctx.fillStyle = "#eaf4ff";
    for (let i = splashDrops.length - 1; i >= 0; i--) {
        const d = splashDrops[i], age = (now - d.born) / 1000, k = age / (d.life / 1000);
        if (k >= 1) { splashDrops.splice(i, 1); continue; }
        const x = d.x + d.vx * age - camX, y = d.y + d.vy * age + 90 * age * age - camY;
        ctx.globalAlpha = (1 - k) * 0.85;
        ctx.beginPath(); ctx.arc(x, y, 0.9, 0, 6.2832); ctx.fill();
    }
    // dust and snow puffs
    for (let i = puffs.length - 1; i >= 0; i--) {
        const q = puffs[i], k = (now - q.born) / q.life;
        if (k >= 1) { puffs.splice(i, 1); continue; }
        const sx = q.x + q.vx * k - camX, sy = q.y + q.vy * k - camY;
        ctx.globalAlpha = (1 - k) * 0.42; ctx.fillStyle = `rgb(${q.c})`;
        ctx.beginPath(); ctx.arc(sx, sy, 1.4 + k * 5, 0, 6.2832); ctx.fill();
    }
    ctx.restore();
}

// How dark it is, 0 (full daylight) .. 1 (night): drives lamp and window glow.
export function darkness(p, fx, now) {
    if (p.night) return 1;
    if (fx.indoor && p.indoorLit) return 0.7 * p.indoorK;   // indoor mood: the lights count as lit in the dim
    if (fx.tod && p.tod) {
        const phase = todPhaseNow();
        const [r, g, b] = todColor(phase);
        return clamp01((1 - (r + g + b) / 765) * 2.6);
    }
    return 0;
}

// how soaked the ground and everyone on it is, 0..1: rain wets it, it dries slowly
export function tickWet(rain, dt) { wet = clamp01(wet + (rain > 0.15 ? rain * dt / 14 : -dt / 75)); }
export const wetLevel = () => wet;
