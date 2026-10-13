// EXPERIMENT: ambience layer for the 2D overworld maps — rain, snow, falling
// leaves and fireflies — plus the Effects settings panel that switches every
// experimental effect (grass, water, seam fixes and these) on and off.
//
// WHERE / WHEN / HOW is decided per map from data the game already has:
//   * where  — map name (open-air vs indoor) and a pixel scan of the map image
//              (how much of it is grass-coloured; grass lives on the base map
//              of a day/night variant, see mapclass.js).
//   * when   — a night variant (map-variants.json) that is also dark gets
//              fireflies instead of leaves; rain comes and goes on a slow clock
//              unless the panel says "always".
//   * how    — one small particle system per effect, drawn in view space on top
//              of everything (weather falls over the party), fading in when a
//              map loads. Density scales with the map's own grass share.
import { classSource, variantBase } from "./mapclass.js";
import { resetScenery, drawScenery, groundScenery, tickWet, wetLevel } from "./scenery.js";
import { syncVillagers, removeVillagers } from "./crowd.js";
import { setSound, thunder, footstep, setAmbience, setMusic } from "./fxaudio.js";
import { resetScenery3, drawScenery3 } from "./scenery3.js";
import { resetScenery2, drawScenery2, gustLevel, hasLights } from "./scenery2.js";
import { isWaterAt, isWaterStage, waterPixelTest } from "./water3d.js";

const VIEW_W = 320;
const VIEW_H = 240;

// ---------------------------------------------------------------- settings
export const FX_GROUPS = [
    ["Terrain", [["sway", "Swaying trees"], ["grass", "Grass"], ["grasspush", "Grass parts around feet"], ["water", "Water"], ["reflect", "Water reflections"], ["mirror", "Characters reflect in water"], ["wetlook", "Wet / dusty look on characters"], ["seam", "Seam fixes"]]],
    ["Weather", [["rain", "Rain"], ["rainwater", "Rain on water"], ["snow", "Snow & blizzards"], ["sand", "Sandstorm"], ["lightning", "Lightning"], ["gusts", "Wind gusts"], ["breath", "Cold breath"], ["frost", "Frost edges"], ["screenfx", "Screen rain & storm feel"]]],
    ["Atmosphere", [["tod", "Time of day"], ["nightlight", "Night lighting (lit circles)"], ["clouds", "Cloud shadows"], ["lamps", "Lamp glow"], ["lightpool", "Light pools around lamps"], ["lightreveal", "Lamps restore true colours"], ["indoor", "Indoor mood lighting"], ["hd2d", "HD-2D look (tilt-shift, bloom, grade)"], ["fog", "Fog & mist"], ["shafts", "Light shafts"], ["heat", "Heat shimmer"], ["sparkle", "Ice sparkle"], ["pollen", "Pollen"]]],
    ["Life", [["leaves", "Falling leaves"], ["fireflies", "Fireflies"], ["butterflies", "Butterflies"], ["birds", "Birds"], ["dragonflies", "Dragonflies"], ["fish", "Jumping fish"], ["critters", "Critters"], ["wildlife", "Frogs, gulls, bats, lizards"], ["devils", "Dust devils & tumbleweeds"], ["villagers", "Ambient villagers (experimental)"]]],
    ["Ground", [["steps", "Footprints, dust & ripples"], ["puddles", "Puddles & ice"]]],
    ["Sound", [["sound", "Weather sounds"], ["ambience", "Place sounds (water, birds, city)"], ["musicfx", "Music reacts to weather"], ["footsteps", "Footstep sounds"]]],
];
export const FX_DEFS = FX_GROUPS.flatMap(([, list]) => list);
window.__fxKeys = FX_DEFS.map(([k]) => k);
const QUALITY = { low: 0.4, medium: 0.7, high: 1 };
// "Time" setting: pins the time-of-day phase (0 = daylight, 0.77 = deepest dusk); auto = the slow cycle
const TODMODES = { auto: undefined, day: 0, golden: 0.55, dusk: 0.7, night: 0.77 };
const STORE_KEY = "dw.fx.v1";
export const fx = { weatherMode: "auto", quality: "high", todMode: "auto" };
for (const [k] of FX_DEFS) fx[k] = true;
const EXPERIMENTAL = ["villagers", "hd2d"];     // off until you switch them on by hand; "All on" and the presets leave them alone
for (const k of EXPERIMENTAL) fx[k] = false;
fx.lightGain = 1;            // Light strength slider (0 to 2)
fx.hd2dStrength = 1;         // HD-2D strength slider (0 to 2)        // experimental: off until you switch it on
try { Object.assign(fx, JSON.parse(localStorage.getItem(STORE_KEY) || "{}")); } catch { }
const stored = { ...fx };   // what the panel last saved; URL flags below never reach it

// game.js and the labs read these flags; the panel owns them now.
function syncLegacyFlags() {
    window.__noGrass3d = !fx.grass;
    window.__noWater3d = !fx.water;
    window.__noSeamFix = !fx.seam;
    window.__noWaterRefl = !fx.reflect;
    window.__grassPush = !!fx.grasspush;
    window.__todForce = TODMODES[fx.todMode];
    window.__lightGain = fx.lightGain;        // read by scenery2.js (lamp strength)
}
function save(keys = null) {
    for (const k of keys || Object.keys(fx)) stored[k] = fx[k];
    try { localStorage.setItem(STORE_KEY, JSON.stringify(stored)); } catch { }
}
export function setNum(key, value) {
    fx[key] = value;
    syncLegacyFlags();
    save([key]);
}
export function setFx(key, value) {
    fx[key] = value;
    syncLegacyFlags();
    save([key]);
    refreshPanel();
}
window.__fx = fx;
window.__isWaterAt = (x, y) => isWaterAt(S.map ? S.map.id : "", x, y);
window.__setFx = setFx;
// URL flags from the older experiments still win for the session.
{
    const q = new URLSearchParams(location.search);
    if (q.has("nograss3d")) fx.grass = false;
    if (q.has("nowater3d")) fx.water = false;
    if (q.has("norain")) fx.rain = false;
    if (q.has("nosnow")) fx.snow = false;
    if (q.has("nosand")) fx.sand = false;
    if (q.has("noambience")) for (const k of ["rain", "snow", "sand", "lightning", "sound", "gusts", "breath", "frost", "tod", "clouds", "lamps", "fog", "shafts", "heat", "sparkle", "pollen", "leaves", "fireflies", "butterflies", "birds", "dragonflies", "fish", "critters", "devils", "steps", "puddles", "footsteps", "ambience", "musicfx", "nightlight", "windows", "screenfx", "wildlife", "rainwater", "sway", "wetlook", "mirror", "villagers"]) fx[k] = false;
    if (q.has("nosound")) fx.sound = false;
    if (q.get("quality") in QUALITY) fx.quality = q.get("quality");
    if (q.get("weather") === "always" || q.get("rain") === "always") fx.weatherMode = "always";
}
syncLegacyFlags();

// Which effects can show on which map; the panel greys out the others so a toggle that
// cannot change anything here does not look broken.
const APPLIES = {
    rain: (p) => p.rainy, lightning: (p) => p.rainy, snow: (p) => p.snowy, sand: (p) => p.sandy,
    gusts: (p) => p.open, breath: (p) => p.snowy, frost: (p) => p.snowy, sparkle: (p) => p.snowy,
    indoor: (p) => p.indoorLit, tod: (p) => p.tod, clouds: (p) => p.clouds, lamps: (p) => p.lamps, fog: (p) => p.fog, shafts: (p) => p.shafts,
    heat: (p) => p.heat, pollen: (p) => p.pollen, leaves: (p) => p.leaves, fireflies: (p) => p.fireflies,
    butterflies: (p) => p.butterflies, critters: (p) => p.butterflies, birds: (p) => p.birds, devils: (p) => p.devils,
    dragonflies: (p, map) => p.open && !p.snowy && isWaterStage(map.id), fish: (p, map) => p.open && !p.snowy && isWaterStage(map.id),
    steps: (p) => p.open, puddles: (p) => p.rainy || p.snowy, reflect: (p, map) => isWaterStage(map.id),
    sway: (p) => p.sway, wetlook: (p) => p.open, mirror: (p, map) => isWaterStage(map.id), villagers: (p) => p.villagers,
    nightlight: (p) => p.open, windows: (p) => p.lamps, screenfx: (p) => p.open, rainwater: (p, map) => p.rainy && isWaterStage(map.id),
    wildlife: (p) => p.swamp || p.coast || p.sandy || p.bats, musicfx: (p) => p.open, ambience: (p) => p.open,
};
let lastMarked = null;
function markApplicable(map, p) {
    if (!panel) return;
    lastMarked = map.id;
    for (const [k] of FX_DEFS) {
        const box = panel.querySelector(`[data-fx="${k}"]`);
        if (!box) continue;
        const ok = APPLIES[k] ? !!APPLIES[k](p, map) : true;
        const lab = box.closest("label");
        lab.classList.toggle("na", !ok);
        lab.title = ok ? "" : "This effect does not apply on this map";
    }
}

// ----------------------------------------------------------------- profile
const OPEN_AIR = [
    /^Central Sector — (Asuka City|Amaterasu City|Asuka Bridge|Amaterasu Bridge|Central Park|Wire Forest Entrance|Shell Beach|Plug Cape)/,
    /^East Sector — (West Wire Forest|East Wire Forest|Protocol Forest|Divermon's Lake|Duel Island|Wind Prairie|Kicking Forest|Seiryu City|Qing Long City)/,
    /^South Sector — (Bulk Swamp|Bulk Bridge|Bios Swamp|Tranquil Swamp|Jungle Grave|Phoenix Bay|Ether Jungle|South Cape|Suzaku City|Zhu Que City)/,
    /^West Sector — (Pelche Oasis|Bullet Valley|Byakko City|Bai Hu City)/,
    /^North Sector — (Boot Mountain|Genbu City|Xuan Wu City)/,
    /^Kusanagi City — Street Corner/,
];
const SNOWY = [
    /^North Sector — (Snow Mountain|Freeze Mountain|Lake of Ice|Battle Gate)/,
    /^East Sector — Tyranno Valley/,
];
// Dry places get a sandstorm instead of rain.
const SANDY = [
    /^West Sector — (Pelche Oasis|Bullet Valley|South Badland|North Badland W|North Badland E|Noise Desert|S Noise Desert|Mobius Desert)/,
];
const FOGGY = [
    /^South Sector — (Bulk Swamp|Bios Swamp|Tranquil Swamp|Jungle Grave|Phoenix Bay|Ether Jungle)/,
    /^East Sector — (Protocol Forest|Kicking Forest|West Wire Forest|East Wire Forest)/,
    /^Central Sector — Wire Forest Entrance/,
];
const SHAFTY = [
    /^Central Sector — (Central Park|Wire Forest Entrance|Plug Cape)/,
    /^East Sector — (West Wire Forest|East Wire Forest|Kicking Forest|Divermon's Lake)/,
    /^South Sector — (Ether Jungle|Jungle Grave)/,
];
const profiles = new Map(); // stageId -> profile

function scan(img) {
    // 64-wide downsample: mean luminance and grass share are all we need.
    const w = 64, h = Math.max(1, Math.round(64 * img.naturalHeight / img.naturalWidth));
    const cv = document.createElement("canvas");
    cv.width = w; cv.height = h;
    const cx = cv.getContext("2d", { willReadFrequently: true });
    cx.drawImage(img, 0, 0, w, h);
    const d = cx.getImageData(0, 0, w, h).data;
    let lum = 0, grass = 0, n = 0, room = 0, rn = 0;
    for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] < 128) continue;
        n++;
        const l = d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11;
        lum += l;
        if (l > 14) { room += l; rn++; }                 // the room itself, not the black void around it
        if (d[i + 1] >= 105 && d[i + 1] > d[i] * 1.22 && d[i + 1] > d[i + 2] * 1.7 && d[i + 1] - d[i + 2] >= 55) grass++;
    }
    return { lum: n ? lum / n : 0, grass: n ? grass / n : 0, room: rn ? room / rn : 0 };
}

function profileOf(map, mapImg) {
    let p = profiles.get(map.id);
    if (p !== undefined) return p;
    const cls = classSource(map.id, mapImg);
    if (!cls) return null;                         // variant list / base map still loading
    const here = scan(mapImg);
    const base = cls === mapImg ? here : scan(cls);
    const snowy = SNOWY.some((r) => r.test(map.name));
    const sandy = SANDY.some((r) => r.test(map.name));
    const open = snowy || sandy || OPEN_AIR.some((r) => r.test(map.name));
    const night = open && !!variantBase(map.id) && here.lum < 80;
    p = {
        open, snowy, sandy, night,
        rainy: !snowy && !sandy && RAINY.some((r) => r.test(map.name)),
        grassShare: base.grass, lum: here.lum, room: here.room,
        leaves: open && !snowy && !sandy && !night && base.grass >= 0.05,
        fireflies: night && !sandy,
        tod: open && !night,
        fog: FOGGY.some((r) => r.test(map.name)),
        shafts: !night && !snowy && SHAFTY.some((r) => r.test(map.name)),
        heat: sandy && !night,
        pollen: open && !night && !snowy && !sandy && base.grass >= 0.1,
        butterflies: open && !night && !snowy && !sandy && base.grass >= 0.1,
        birds: open && !night,
        breath: snowy,
        sway: open && !snowy && !sandy && (base.grass >= 0.05 || /Forest|Jungle|Park|Prairie|Lake|Island|Cape|Beach|Swamp|Valley/.test(map.name)),
        villagers: open && /City|Street Corner|Station/.test(map.name),
        swamp: open && /Swamp|Jungle|Oasis|Phoenix Bay|Ether/.test(map.name),
        coast: open && /Beach|Cape|Bay|Lake|Island/.test(map.name),
        bats: open && !snowy && !sandy && (base.grass >= 0.05 || /Forest|Jungle/.test(map.name)),
        clouds: open && !night,
        lamps: open && (hasLights(map.id) || (!sandy && !snowy && /City|Bridge|Street Corner/.test(map.name))),
        devils: sandy && !night,
        w: mapImg.naturalWidth, h: mapImg.naturalHeight,
        seed: [...map.id].reduce((a, c) => a * 31 + c.charCodeAt(0), 7) >>> 0,
        cls,
    };
    profiles.set(map.id, p);
    console.log(`ambience: ${map.id} ${map.name} -> ${JSON.stringify({ ...p, cls: undefined })}`);
    return p;
}
window.__ambienceProfile = (id) => { const p = profiles.get(id); return p && { ...p, cls: undefined }; };

// ------------------------------------------------------------------ helpers
function rng(seed) {
    let s = seed >>> 0 || 1;
    return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const smooth = (v) => { v = clamp01(v); return v * v * (3 - 2 * v); };

// World-anchored particles: each keeps a map-pixel position and is drawn wrapped
// onto a torus slightly larger than the view (M px margin), so the camera moving
// never drags them along and the newly uncovered strip is already populated.
const M = 40, DW = VIEW_W + 2 * M, DH = VIEW_H + 2 * M;
const wrapX = (x, cam) => (((x - cam + M) % DW) + DW) % DW - M;
const wrapY = (y, cam) => (((y - cam + M) % DH) + DH) % DH - M;
const MB = 200, DWB = VIEW_W + 2 * MB, DHB = VIEW_H + 2 * MB;       // big soft shapes (dust)
const wrapXB = (x, cam) => (((x - cam + MB) % DWB) + DWB) % DWB - MB;
const wrapYB = (y, cam) => (((y - cam + MB) % DHB) + DHB) % DHB - MB;

const wrapRange = (v, period, margin) => (((v + margin) % period) + period) % period - margin;

// pixels of the current map's classification picture, read once per map visit
let pixCache = null;
function pixOf(p) {
    if (pixCache && pixCache.p === p) return pixCache.px;
    let px = null;
    try {
        const cv = document.createElement("canvas");
        cv.width = p.w; cv.height = p.h;
        const cx = cv.getContext("2d", { willReadFrequently: true });
        cx.drawImage(p.cls, 0, 0);
        px = { data: cx.getImageData(0, 0, p.w, p.h).data, w: p.w, h: p.h };
    } catch { px = null; }
    pixCache = { p, px };
    return px;
}
let pixImgCache = null;
function pixOfImg(img) {
    if (!img) return null;
    if (pixImgCache && pixImgCache.img === img) return pixImgCache.px;
    let px = null;
    try {
        const cv = document.createElement("canvas");
        cv.width = img.naturalWidth; cv.height = img.naturalHeight;
        const cx = cv.getContext("2d", { willReadFrequently: true });
        cx.drawImage(img, 0, 0);
        px = { data: cx.getImageData(0, 0, cv.width, cv.height).data, w: cv.width, h: cv.height };
    } catch { px = null; }
    pixImgCache = { img, px };
    return px;
}
// everything scenery.js needs, in one reusable object
const S = {
    DW, DH, DWB, DHB, wrapX, wrapY, wrapXB, wrapYB, wrapRange,
    fx, map: null, p: null, L: null, t: 0, dt: 0, now: 0, fade: 1, camX: 0, camY: 0, Q: 1,
    pix: () => pixOf(S.p),
    pixMap: () => pixOfImg(S.img),
    feet: [], moving: false, dir: "down", wind: 18, img: null,
    grid: () => window.__state?.collision?.[S.map.id] ?? null,
    isWater: (x, y) => isWaterAt(S.map.id, x, y),
    waterStage: () => isWaterStage(S.map.id),
    waterTest: () => waterPixelTest(S.map.id),
    onThunder: (ms) => thunder(fx.sound, ms, (Math.random() * 2 - 1) * 0.85),
    onStep: (type, vol) => { window.__lastStep = { type, vol, n: (window.__lastStep?.n || 0) + 1 }; footstep(fx.footsteps, type, vol); },
};
function fillS(map, p, L, now, dt, fade, camX, camY, img) {
    S.img = img ?? S.img;
    S.feet = window.__feet || [];
    S.moving = !!(S.feet[0] && S.feet[0].moving); S.dir = S.feet[0]?.dir ?? "down";
    S.map = map; S.p = p; S.L = L; S.now = now; S.t = now / 1000; S.dt = dt; S.fade = fade;
    S.camX = camX; S.camY = camY; S.Q = QUALITY[fx.quality] ?? 1;
    return S;
}

// sound follows the weather and the place of the map being shown
function silenceAll() {
    window.__bodyFx = null;
    setSound(false, { rain: 0, wind: 0, sand: 0, night: 0 });
    setAmbience(false, {});
    setMusic(window.__bgm?.el, false, 0, 0);
}
function soundTick(p, L) {
    if (!p.open) { silenceAll(); return; }
    const rain = fx.rain ? L.rain : 0, storm = fx.snow ? L.blizzard : 0, sandL = fx.sand ? L.sand : 0;
    const bad = Math.max(rain, storm, sandL);
    setSound(fx.sound, {
        rain, sand: sandL, night: p.night && fx.fireflies ? 1 : 0,
        wind: clamp01(0.10 + storm * 0.9 + sandL * 0.55 + rain * 0.3 + (fx.snow ? L.snow * 0.15 : 0)),
    });
    const calm = 1 - clamp01(bad * 1.4);
    setAmbience(fx.ambience, {
        water: (isWaterStage(S.map?.id) || p.coast ? 0.7 : 0) * (1 - 0.5 * bad),
        forest: (p.grassShare >= 0.05 || p.swamp ? 0.7 : 0.2) * calm,
        city: /City|Street|Bridge/.test(S.map?.name || "") ? 0.8 : 0,
        birds: p.birds && !p.night ? calm * 0.9 : 0,
    });
    setMusic(window.__bgm?.el, fx.musicfx, clamp01(rain * 0.7 + storm + sandL * 0.8), clamp01(rain * 0.35 + storm * 0.85 + sandL * 0.6));
}
export function ambienceSilence() { silenceAll(); }

// ------------------------------------------------------------------- state
let curId = null, curSince = 0, lastT = 0;
let drops = [], splashes = [], flakes = [], leaves = [], flies = [], grit = [], dust = [], storm = [];
let glow = null;

function glowSprite() {
    if (glow) return glow;
    glow = document.createElement("canvas");
    glow.width = glow.height = 24;
    const g = glow.getContext("2d");
    const grd = g.createRadialGradient(12, 12, 0, 12, 12, 12);
    grd.addColorStop(0, "rgba(255,255,190,1)");
    grd.addColorStop(0.25, "rgba(210,255,120,0.55)");
    grd.addColorStop(1, "rgba(160,255,80,0)");
    g.fillStyle = grd; g.fillRect(0, 0, 24, 24);
    return glow;
}

function resetFor(map, p) {
    curId = map.id; curSince = performance.now();
    pixCache = null; pixImgCache = null; S.p = p; S.map = map;
    resetScenery(map, p, S);
    resetScenery2(map, p, S);
    resetScenery3(map, p);
    const r = rng(p.seed ^ 0x9e3779b9);
    drops = Array.from({ length: 170 }, () => ({
        gx: r() * DW, gy: r() * DH, h: r() * 180, v: 230 + r() * 150, l: 7 + r() * 7, a: 0.45 + r() * 0.4,
    }));
    splashes = [];
    grit = Array.from({ length: 260 }, () => ({
        x: r() * DW, y: r() * DH, v: 240 + r() * 200, l: 8 + r() * 14, a: 0.45 + r() * 0.4,
    }));
    dust = Array.from({ length: 9 }, () => ({
        x: r() * DWB, y: r() * DHB, rad: 70 + r() * 100, v: 30 + r() * 40, a: 0.22 + r() * 0.18,
    }));
    storm = Array.from({ length: 260 }, () => ({ x: r() * DW, y: r() * DH, v: 40 + r() * 50, a: 0.3 + r() * 0.4 }));
    flakes = Array.from({ length: 230 }, () => ({
        x: r() * DW, y: r() * DH, v: 16 + r() * 30, s: 0.7 + r() * 1.3, ph: r() * 6.28, sw: 6 + r() * 14,
    }));
    const nLeaves = Math.round(24 + 50 * Math.min(1, p.grassShare / 0.3));
    leaves = Array.from({ length: nLeaves }, () => ({
        x: r() * DW, y: r() * DH, v: 12 + r() * 14, d: 14 + r() * 22, ph: r() * 6.28,
        rot: r() * 6.28, spin: (r() - 0.5) * 4, hue: r(), kx: 0, ky: 0,
    }));
    // Fireflies live on the map, not the screen: scatter them over grass-coloured
    // ground when there is any (the base map's), anywhere otherwise.
    flies = [];
    if (p.fireflies) {
        const count = Math.min(280, Math.round(p.w * p.h / 5000));
        const data = pixOf(p)?.data ?? null;
        const wantGrass = p.grassShare > 0.02 && data;
        for (let tries = 0; flies.length < count && tries < count * 60; tries++) {
            const x = r() * p.w, y = r() * p.h;
            if (wantGrass) {
                const o = ((y | 0) * p.w + (x | 0)) * 4;
                const gR = data[o], gG = data[o + 1], gB = data[o + 2];
                if (!(gG >= 105 && gG > gR * 1.22 && gG > gB * 1.7)) continue;
            }
            flies.push({ x, y, ax: 6 + r() * 14, ay: 4 + r() * 8, fx: 0.2 + r() * 0.5, fy: 0.3 + r() * 0.6,
                         ph: r() * 6.28, bl: 0.4 + r() * 0.9, bp: r() * 6.28 });
        }
    }
}

// ----------------------------------------------------------------- weather
// Each map can only have the weather that suits it, and nothing is on all the
// time: every BUCKET ms a map rolls a new state from its own weighted list and
// cross-fades into it over FADE ms, so a visit may be clear, drizzly, leafy or
// stormy. The panel switches are master on/off per effect; "always on" skips the
// rolls. window.__weatherForce ("rain", "leaves", "snow+leaves", "") pins it.
const RAINY = [
    /^Central Sector — (Central Park|Wire Forest Entrance|Shell Beach|Plug Cape)/,
    /^East Sector — (West Wire Forest|East Wire Forest|Protocol Forest|Divermon's Lake|Duel Island|Wind Prairie|Kicking Forest)/,
    /^South Sector — (Bulk Swamp|Bios Swamp|Tranquil Swamp|Jungle Grave|Phoenix Bay|Ether Jungle|South Cape)/,
];
const WEIGHTS = {
    snowy: [["snow", 4], ["blizzard", 2], ["clear", 1]],
    sandy: [["sand", 3], ["clear", 2]],
    rainy: [["rain", 2], ["clear", 3]],
};
const BUCKET = 40000, FADE = 5000;
const sessionSalt = (Math.random() * 4e9) >>> 0;
const mix = (a, b) => (((a >>> 0) ^ Math.imul((b | 0) + 0x9e3779b9, 2654435761)) >>> 0) || 1;

function pickState(p, bucket) {
    const list = p.snowy ? WEIGHTS.snowy : p.sandy ? WEIGHTS.sandy : p.rainy ? WEIGHTS.rainy : null;
    if (!list) return "clear";
    const r = rng(mix(mix(p.seed, bucket), sessionSalt)); r(); r();
    let x = r() * list.reduce((s, e) => s + e[1], 0);
    for (const [st, w] of list) if ((x -= w) < 0) return st;
    return "clear";
}
function leavesOn(p, bucket) {
    const r = rng(mix(mix(p.seed ^ 0x5bd1e995, bucket), sessionSalt)); r(); r();
    return r() < 0.55;
}
// How strongly each effect is blowing right now, 0..1, for this map.
function levels(p, now) {
    const L = { rain: 0, snow: 0, blizzard: 0, sand: 0, leaves: 0 };
    const add = (k, w) => { if (k in L) L[k] += w; };
    const force = window.__weatherForce;
    if (typeof force === "string") {
        for (const s of force.split("+")) add(s, 1);
    } else if (fx.weatherMode === "clear") {
        // clear skies: nothing falls, though leaves may still drift on grassy maps
        if (p.leaves) L.leaves = 1;
    } else if (fx.weatherMode === "storm") {
        add(p.snowy ? "blizzard" : p.sandy ? "sand" : p.rainy ? "rain" : "", 1);
    } else if (fx.weatherMode === "always") {
        add(p.snowy ? "snow" : p.sandy ? "sand" : p.rainy ? "rain" : "", 1);
        if (p.leaves) L.leaves = 1;
    } else {
        const b = Math.floor(now / BUCKET), k = smooth((now % BUCKET) / FADE);
        add(pickState(p, b - 1), 1 - k); add(pickState(p, b), k);
        if (p.leaves) L.leaves = (leavesOn(p, b - 1) ? 1 - k : 0) + (leavesOn(p, b) ? k : 0);
    }
    if (!p.rainy) L.rain = 0;
    if (!p.snowy) { L.snow = 0; L.blizzard = 0; }
    if (!p.sandy) L.sand = 0;
    if (!p.leaves) L.leaves = 0;
    return L;
}

// ------------------------------------------------------------------- frame
// Returns a draw(ctx) closure for this frame (or null when nothing applies).
export function ambienceFor(map, mapImg, camX, camY) {
    if (!(mapImg instanceof Image) || !mapImg.complete || !mapImg.naturalWidth) return null;
    const p = profileOf(map, mapImg);
    if (!p) return null;
    // Stages that are not outdoors but carry the game's own light records get a mood dim, so their lights show.
    // Decided every call (the light list loads after the first profile), switchable in F2.
    if (p.baseLamps === undefined) p.baseLamps = p.lamps;
    // Indoor mood only helps a DARK room (shrine, sewers, the Amaterasu versions of the inns): a bright, warmly lit
    // room (the Asuka inns, lobbies, labs) already looks right, so it is left exactly as the game draws it.
    p.indoorK = Math.max(0, Math.min(1, (95 - (p.room || 0)) / 20));
    p.indoorLit = !p.open && hasLights(map.id) && p.indoorK > 0.02;
    p.lamps = p.baseLamps || (fx.indoor && p.indoorLit);
    if (panel && lastMarked !== map.id) markApplicable(map, p);
    const now = performance.now();
    const L = levels(p, now);
    bodyFxTick(map, p, L, now);
    const wantRain = fx.rain && L.rain > 0.01;
    const wantSnow = fx.snow && (L.snow > 0.01 || L.blizzard > 0.01);
    const wantSand = fx.sand && L.sand > 0.01;
    const wantLeaves = fx.leaves && L.leaves > 0.01;
    const wantFlies = fx.fireflies && p.fireflies;
    soundTick(p, L);
    const sceneryOn = (fx.tod && p.tod) || (fx.fog && p.fog) || (fx.shafts && p.shafts) || (fx.heat && p.heat)
        || (fx.pollen && p.pollen) || (fx.butterflies && p.butterflies) || (fx.birds && p.birds)
        || (fx.sparkle && p.snowy) || (fx.lightning && fx.rain && p.rainy)
        || (fx.clouds && p.clouds) || (fx.indoor && p.indoorLit) || (fx.lamps && p.lamps) || (fx.gusts && p.open) || (fx.breath && p.snowy)
        || (p.open && (fx.nightlight || fx.windows || fx.screenfx || fx.wildlife || fx.rainwater))
        || (fx.frost && p.snowy) || (fx.devils && p.devils) || ((fx.dragonflies || fx.fish || fx.critters) && p.open);
    if (!(wantRain || wantSnow || wantSand || wantLeaves || wantFlies || sceneryOn)) return null;
    if (curId !== map.id) resetFor(map, p);
    const dt = Math.min(0.05, lastT ? (now - lastT) / 1000 : 0);
    lastT = now;
    const fade = smooth((now - curSince) / 1500);
    const Q = QUALITY[fx.quality] ?? 1;
    fillS(map, p, L, now, dt, fade, camX, camY, mapImg);
    const rain = wantRain ? L.rain * fade : 0;
    const t = now / 1000;
    const gl = gustLevel(S);                  // a passing gust boosts every wind-driven effect
    const wind = (18 + 10 * Math.sin(t / 7)) * (1 + 1.8 * gl);   // px/s, leaves and rain slant share it
    S.wind = wind;

    return (ctx) => {
        ctx.save();
        ctx.beginPath(); ctx.rect(0, 0, VIEW_W, VIEW_H); ctx.clip();
        drawScenery(ctx, S);
        drawScenery2(ctx, S);
        drawScenery3(ctx, S);
        if (wantFlies) {
            const g = glowSprite();
            ctx.globalCompositeOperation = "lighter";
            for (const f of flies) {
                const x = f.x + Math.sin(t * f.fx + f.ph) * f.ax - camX;
                const y = f.y + Math.sin(t * f.fy + f.ph * 1.7) * f.ay - camY;
                if (x < -12 || x > VIEW_W + 12 || y < -12 || y > VIEW_H + 12) continue;
                const b = Math.pow(Math.max(0, Math.sin(t * f.bl + f.bp)), 2) * fade;
                if (b < 0.03) continue;
                ctx.globalAlpha = Math.min(1, b * 1.2);
                ctx.drawImage(g, x - 9, y - 9, 18, 18);
            }
            ctx.globalCompositeOperation = "source-over";
        }
        // Every particle below lives in WORLD space (map pixels) on a torus a little
        // bigger than the view, so it keeps its own motion (wind, fall) whatever the
        // camera does, and the strip of world the camera uncovers is already populated.
        if (wantLeaves) {
            const nLf = Math.round(leaves.length * Q);
            for (let li = 0; li < leaves.length; li++) {
                const lf = leaves[li];
                lf.y += (lf.v + lf.ky) * dt; lf.x += (wind * 0.6 + lf.d * Math.sin(t * 0.9 + lf.ph) * 0.5 + lf.kx) * dt; lf.rot += lf.spin * dt;
                const damp = Math.exp(-3 * dt); lf.kx *= damp; lf.ky *= damp;
                const sx = wrapX(lf.x, camX), sy = wrapY(lf.y, camY);
                for (const ft of S.feet) {            // anyone walking through the leaves scatters them
                    if (!ft.moving) continue;
                    const dx = sx - (ft.x - camX), dy = sy - (ft.y - camY - 10), d2 = dx * dx + dy * dy;
                    if (d2 < 256) { const d = Math.sqrt(d2) || 1; lf.kx += dx / d * 55; lf.ky += dy / d * 25 - 38; }
                }
                if (li >= nLf || sx < -6 || sx > VIEW_W + 6 || sy < -6 || sy > VIEW_H + 6) continue;
                ctx.save();
                ctx.translate(sx, sy); ctx.rotate(lf.rot);
                ctx.scale(1, 0.4 + 0.6 * Math.abs(Math.sin(t * 2 + lf.ph)));
                ctx.globalAlpha = 0.85 * fade * L.leaves;
                ctx.fillStyle = lf.hue < 0.5 ? "#6fae3e" : lf.hue < 0.8 ? "#a8b83a" : "#c98a2e";
                ctx.beginPath(); ctx.ellipse(0, 0, 3.4, 1.9, 0, 0, 6.2832); ctx.fill();
                ctx.restore();
            }
        }
        if (wantSnow) {
            const lt = L.snow, bz = L.blizzard, any = Math.min(1, lt + bz);
            const speedK = 1 + 2.2 * bz;
            const drift = 4 + 170 * bz * (0.7 + 0.3 * Math.sin(t / 2.1));   // blizzards blow sideways
            const shown = Math.round(flakes.length * any * Q);
            ctx.fillStyle = "#fff";
            for (let i = 0; i < flakes.length; i++) {
                const s = flakes[i];
                s.y += s.v * speedK * dt; s.x += (Math.sin(t * 0.8 + s.ph) * s.sw * (1 - 0.6 * bz) + drift) * dt;
                if (i >= shown) continue;
                const sx = wrapX(s.x, camX), sy = wrapY(s.y, camY);
                if (sx < -3 || sx > VIEW_W + 3 || sy < -3 || sy > VIEW_H + 3) continue;
                ctx.globalAlpha = (0.55 + 0.4 * (s.s / 2)) * fade;
                ctx.beginPath(); ctx.arc(sx, sy, s.s * 0.6, 0, 6.2832); ctx.fill();
            }
            if (bz > 0.01) {
                ctx.lineCap = "round"; ctx.lineWidth = 1; ctx.strokeStyle = "#f4f8ff";
                for (const s of storm) {
                    s.x += (150 + drift * 1.5) * dt * (0.6 + s.v / 70); s.y += s.v * 1.5 * dt;
                    const sx = wrapX(s.x, camX), sy = wrapY(s.y, camY);
                    if (sx < -12 || sx > VIEW_W + 12 || sy < -4 || sy > VIEW_H + 4) continue;
                    ctx.globalAlpha = s.a * bz * fade;
                    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx - 9, sy - 2.2); ctx.stroke();
                }
                ctx.globalAlpha = (0.22 + 0.10 * Math.sin(t * 1.7)) * bz * fade;
                ctx.fillStyle = "#dfe9f7"; ctx.fillRect(0, 0, VIEW_W, VIEW_H);
            }
            ctx.globalAlpha = 0.06 * any * fade; ctx.fillStyle = "#cfe0ff"; ctx.fillRect(0, 0, VIEW_W, VIEW_H);
        }
        if (wantSand) {
            const gust = 0.7 + 0.3 * Math.sin(t / 4.3) * Math.sin(t / 9.1 + 1);   // 0.4 .. 1
            const I = fade * gust * L.sand;
            ctx.globalAlpha = 0.30 * I; ctx.fillStyle = "#c9a165"; ctx.fillRect(0, 0, VIEW_W, VIEW_H);
            for (const b of dust) {
                b.x += (b.v + wind * 2) * dt * gust;
                const bx = wrapXB(b.x, camX), by = wrapYB(b.y, camY);
                const g = ctx.createRadialGradient(bx, by, 0, bx, by, b.rad);
                g.addColorStop(0, "rgba(222,190,135," + (b.a * I).toFixed(3) + ")");
                g.addColorStop(1, "rgba(222,190,135,0)");
                ctx.globalAlpha = 1; ctx.fillStyle = g; ctx.fillRect(bx - b.rad, by - b.rad, b.rad * 2, b.rad * 2);
            }
            ctx.lineWidth = 1.4; ctx.lineCap = "round"; ctx.strokeStyle = "#f0d8a6";
            for (const d of grit) {
                d.x += d.v * dt * (0.6 + 0.6 * gust); d.y += d.v * 0.10 * dt;
                const sx = wrapX(d.x, camX), sy = wrapY(d.y, camY);
                if (sx < -20 || sx > VIEW_W + 20 || sy < -4 || sy > VIEW_H + 4) continue;
                ctx.globalAlpha = d.a * I;
                ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx - d.l, sy - d.l * 0.10); ctx.stroke();
            }
        }
        if (rain > 0.01) {
            ctx.globalAlpha = 0.14 * rain; ctx.fillStyle = "#0a1630"; ctx.fillRect(0, 0, VIEW_W, VIEW_H);
            ctx.lineWidth = 0.9; ctx.lineCap = "round";
            const slant = (wind + 40) / 380;
            const shown = Math.round(drops.length * rain * Q);
            ctx.strokeStyle = "#c4d6ff";
            for (let i = 0; i < drops.length; i++) {
                const d = drops[i];
                d.h -= d.v * dt;                                   // height above its ground spot
                if (d.h <= 0) {
                    // it lands where it lands: the splash is planted in the world and stays put
                    if (i < shown && Math.random() < 0.35 && splashes.length < 60) splashes.push({ x: d.gx, y: d.gy, age: 0 });
                    d.h = 140 + Math.random() * 60; d.gx += Math.random() * DW; d.gy += Math.random() * DH;
                }
                if (i >= shown) continue;
                const x = wrapX(d.gx, camX) - d.h * slant, y = wrapY(d.gy, camY) - d.h;
                if (x < -10 || x > VIEW_W + 10 || y < -16 || y > VIEW_H + 4) continue;
                ctx.globalAlpha = d.a * rain;
                ctx.beginPath(); ctx.moveTo(x - d.l * slant, y - d.l); ctx.lineTo(x, y); ctx.stroke();
            }
            ctx.lineWidth = 0.5; ctx.strokeStyle = "#dbe7ff";
            for (let i = splashes.length - 1; i >= 0; i--) {
                const s = splashes[i]; s.age += dt;
                if (s.age > 0.35) { splashes.splice(i, 1); continue; }
                const sx = wrapX(s.x, camX), sy = wrapY(s.y, camY);
                if (sx < -10 || sx > VIEW_W + 10 || sy < -4 || sy > VIEW_H + 4) continue;
                ctx.globalAlpha = (1 - s.age / 0.35) * 0.5 * rain;
                ctx.beginPath(); ctx.ellipse(sx, sy, 1 + s.age * 9, 0.4 + s.age * 3.5, 0, 0, 6.2832); ctx.stroke();
            }
        }
        ctx.restore();
    };
}

// ------------------------------------------------- bodies: look, reflection, crowd
let lastBody = 0;
function bodyFxTick(map, p, L, now) {
    const dt = Math.min(0.1, lastBody ? (now - lastBody) / 1000 : 0);
    lastBody = now;
    tickWet(fx.rain ? L.rain : 0, dt);
    const w = wetLevel();
    let filter = "";
    if (fx.wetlook && p.open) {
        if (w > 0.06) filter = `brightness(${(1 - 0.22 * w).toFixed(3)}) contrast(${(1 + 0.1 * w).toFixed(3)}) saturate(${(1 + 0.15 * w).toFixed(3)})`;
        else if (fx.sand && L.sand > 0.2) filter = `sepia(${(0.38 * L.sand).toFixed(2)}) brightness(0.95)`;
    }
    let reflect = null;
    if (fx.mirror && !window.__noWaterRefl && isWaterStage(map.id)) {
        reflect = (x, y) => {
            if (!isWaterAt(map.id, x, y + 8)) return 0;
            const cover = (isWaterAt(map.id, x, y + 8) + isWaterAt(map.id, x, y + 18) + isWaterAt(map.id, x, y + 28)) / 3;
            return 0.58 * cover;
        };
    }
    window.__bodyFx = filter || reflect ? { filter, reflect } : null;
    const st = window.__state;
    if (st && st.scenes) syncVillagers(fx.villagers, map, p, st);
}
// swaying trees: the foreground layer redrawn with the canopies moving (null = draw it normally)
export function swayFor(map, mapImg) {
    if (!fx.sway || window.__hideProps || !(mapImg instanceof Image)) return null;
    const p = profiles.get(map.id) || profileOf(map, mapImg);
    if (!p || !p.sway) return null;
    const gu = window.__grassGust;
    return { gust: gu ? { x: gu.x, s: gu.s } : null };
}

// The ground layer (puddles, footprints, dust, ripples): drawn after the map, under the sprites.
let lastG = 0;
export function groundFxFor(map, mapImg, camX, camY) {
    if (!(mapImg instanceof Image) || !mapImg.complete || !mapImg.naturalWidth) return null;
    const p = profileOf(map, mapImg);
    if (!p || !p.open) return null;
    if (!(fx.steps || fx.footsteps || (fx.puddles && (p.rainy || p.snowy)))) return null;
    if (curId !== map.id) resetFor(map, p);
    const now = performance.now();
    const dt = Math.min(0.05, lastG ? (now - lastG) / 1000 : 0);
    lastG = now;
    const fade = smooth((now - curSince) / 1500);
    fillS(map, p, levels(p, now), now, dt, fade, camX, camY, mapImg);
    return (ctx) => groundScenery(ctx, S);
}

// ------------------------------------------------------- presets & profiles
const BASE = ["grass", "grasspush", "water", "reflect", "seam", "sway", "wetlook", "mirror"];
const PRESETS = {
    cinematic: { tod: "golden", mode: "auto", all: true },
    clear: { tod: "day", mode: "clear", on: [...BASE, "indoor", "gusts", "clouds", "shafts", "pollen", "butterflies", "birds", "dragonflies", "fish", "critters", "leaves", "sparkle", "steps", "puddles", "ambience", "footsteps", "wildlife", "tod"] },
    cozyrain: { tod: "dusk", mode: "always", on: [...BASE, "indoor", "rain", "rainwater", "fog", "puddles", "screenfx", "sound", "ambience", "musicfx", "steps", "footsteps", "lamps", "lightpool", "lightreveal", "nightlight", "tod", "leaves", "wildlife", "clouds"] },
    storm: { tod: "day", mode: "storm", on: [...BASE, "indoor", "rain", "rainwater", "lightning", "snow", "sand", "gusts", "frost", "breath", "screenfx", "puddles", "sound", "musicfx", "steps", "footsteps", "clouds", "tod"] },
    night: { tod: "night", mode: "auto", on: [...BASE, "indoor", "tod", "lamps", "lightpool", "lightreveal", "nightlight", "fireflies", "fog", "wildlife", "ambience", "sound", "footsteps", "steps", "sparkle", "gusts"] },
};
function applyPreset(name) {
    const d = PRESETS[name];
    if (!d) return;
    for (const [k] of FX_DEFS) fx[k] = !EXPERIMENTAL.includes(k) && (d.all ? true : d.on.includes(k));
    fx.todMode = d.tod; fx.weatherMode = d.mode;
    syncLegacyFlags(); save(); refreshPanel();
}
window.__applyPreset = applyPreset;
const PROFILE_KEY = "dw.fx.profiles";
function snapshot() {
    const o = {};
    for (const [k] of FX_DEFS) o[k] = !!fx[k];
    o.weatherMode = fx.weatherMode; o.todMode = fx.todMode; o.quality = fx.quality;
    return o;
}
function profileAct(kind, slot) {
    let all = {};
    try { all = JSON.parse(localStorage.getItem(PROFILE_KEY) || "{}"); } catch { }
    if (kind === "save") {
        all[slot] = snapshot();
        try { localStorage.setItem(PROFILE_KEY, JSON.stringify(all)); } catch { }
        toast(`Saved as profile ${slot}`);
    } else if (all[slot]) {
        Object.assign(fx, all[slot]); syncLegacyFlags(); save(); refreshPanel();
        toast(`Loaded profile ${slot}`);
    } else toast(`Profile ${slot} is empty`);
}

// ------------------------------------------------------------ photo mode
// F8 hides the chrome (header, effects button and panel) and goes fullscreen; F9 saves a
// PNG of the game picture; F10 starts and stops a clip of the game canvas (a .webm).
// The recording is of the canvas alone, so no window, panel or label is ever in it.
let photoOn = false, recorder = null, recChunks = [], toastEl = null, toastTimer = 0, recDot = null;
function gameCanvas() {
    return [...document.querySelectorAll("#stage canvas")].find((c) => c.width > 0 && c.offsetParent !== null) || null;
}
function toast(msg, ms = 2600) {
    if (!toastEl) return;
    toastEl.textContent = msg; toastEl.style.opacity = "1";
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { toastEl.style.opacity = "0"; }, ms);
}
function stamp() { return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19); }
function download(blob, name) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
}
export function screenshot() {
    const cv = gameCanvas();
    if (!cv) return false;
    cv.toBlob((b) => { if (b) { download(b, `walkabout-${stamp()}.png`); toast("Screenshot saved"); } }, "image/png");
    return true;
}
export function toggleRecord() {
    if (recorder) { recorder.stop(); return false; }
    const cv = gameCanvas();
    if (!cv || !cv.captureStream || typeof MediaRecorder === "undefined") { toast("Recording is not supported here"); return false; }
    const mime = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find((m) => MediaRecorder.isTypeSupported(m));
    recChunks = [];
    recorder = new MediaRecorder(cv.captureStream(30), { mimeType: mime, videoBitsPerSecond: 12e6 });
    recorder.ondataavailable = (e) => { if (e.data && e.data.size) recChunks.push(e.data); };
    recorder.onstop = () => {
        const blob = new Blob(recChunks, { type: "video/webm" });
        recorder = null; if (recDot) recDot.style.display = "none";
        window.__lastClip = { bytes: blob.size };
        download(blob, `walkabout-${stamp()}.webm`); toast("Clip saved");
    };
    recorder.start(1000);
    if (recDot) recDot.style.display = "";
    toast("Recording... press F10 to stop", 3500);
    return true;
}
function setPhoto(on) {
    photoOn = on;
    const header = document.querySelector("header");
    if (header) header.style.display = on ? "none" : "";
    if (gear) gear.style.visibility = on ? "hidden" : "";
    if (panel && on) panel.hidden = true;
    if (on) {
        const st = document.getElementById("stage");
        if (st && st.requestFullscreen && !document.fullscreenElement) st.requestFullscreen().catch(() => { });
        toast("Photo mode:  F9 screenshot  |  F10 record clip  |  F8 exit", 4200);
    } else if (document.fullscreenElement) document.exitFullscreen().catch(() => { });
}
window.__photo = { screenshot, toggleRecord, setPhoto };

// ------------------------------------------------------------------- panel
let panel = null, gear = null;
function refreshPanel() {
    if (!panel) return;
    for (const [k] of FX_DEFS) { const c = panel.querySelector(`[data-fx="${k}"]`); if (c) c.checked = !!fx[k]; }
    const w = panel.querySelector("[data-mode]"); if (w) w.value = fx.weatherMode;
    const q = panel.querySelector("[data-quality]"); if (q) q.value = fx.quality;
    const td = panel.querySelector("[data-tod]"); if (td) td.value = fx.todMode;
    for (const k of ["lightGain", "hd2dStrength"]) {
        const r = panel.querySelector(`[data-slider="${k}"]`), v = panel.querySelector(`[data-val="${k}"]`);
        if (r) r.value = fx[k]; if (v) v.textContent = (+fx[k]).toFixed(2);
    }
}
export function installFxPanel(stageEl) {
    if (panel || !stageEl) return;
    const css = document.createElement("style");
    css.textContent = `
      #fx-gear { position:absolute; top:8px; right:8px; z-index:40; width:30px; height:30px; border-radius:15px;
        border:1px solid #565680; background:#1d1d2bcc; color:#ffd34d; cursor:pointer; font-size:16px; opacity:0; transition:opacity .2s; }
      #stage:hover #fx-gear:hover, #fx-gear:focus-visible, #fx-gear.open { opacity:.95; }
      #fx-panel { position:absolute; top:44px; right:8px; z-index:40; width:252px; max-height:calc(100% - 60px); overflow-y:auto;
        padding:10px 14px 12px; border:2px solid #45456a; border-radius:10px; background:#1d1d2bf2; color:#e8e8f0;
        font:13px/1.75 "Segoe UI",system-ui,sans-serif; box-shadow:0 8px 30px #000; }
      #fx-panel[hidden] { display:none; }
      #fx-panel h3 { margin:0 0 2px; font-size:13px; color:#ffd34d; letter-spacing:1px; }
      #fx-panel h4 { margin:8px 0 0; font-size:11px; color:#8a8ab0; letter-spacing:1.5px; text-transform:uppercase; }
      #fx-panel label { display:flex; gap:8px; align-items:center; cursor:pointer; }
      #fx-panel select, #fx-panel button { background:#2a2a40; color:#e8e8f0; border:1px solid #45456a; border-radius:4px; padding:2px 6px; font:inherit; }
      #fx-panel .row { display:flex; gap:6px; margin-top:8px; }
      #fx-toast { position:absolute; left:50%; bottom:22px; transform:translateX(-50%); z-index:50; padding:6px 14px; border-radius:8px; background:#000b; color:#fff; font:600 14px 'Segoe UI',system-ui,sans-serif; pointer-events:none; opacity:0; transition:opacity .3s; }
      #fx-rec { position:absolute; top:14px; left:14px; z-index:50; width:14px; height:14px; border-radius:7px; background:#e33; box-shadow:0 0 8px #e33; pointer-events:none; display:none; }
      #fx-panel input[type=range] { width:84px; }
      #fx-panel span[data-val] { min-width:28px; color:#8a8ab0; font-size:11px; }
      #fx-panel label.na { opacity:.42; }
      #fx-panel label.na::after { content:"(not here)"; font-size:10px; color:#8a8aa8; margin-left:auto; }
      #fx-panel .hint { color:#707090; font-size:11px; line-height:1.4; margin-top:6px; }`;
    document.head.appendChild(css);
    gear = document.createElement("button");
    gear.id = "fx-gear"; gear.type = "button"; gear.title = "Effects (F2)"; gear.textContent = "\u2699";
    panel = document.createElement("div");
    panel.id = "fx-panel"; panel.hidden = true;
    panel.innerHTML = `<h3>EFFECTS</h3>` + FX_GROUPS.map(([name, list]) =>
        `<h4>${name}</h4>` + list.map(([k, label]) => `<label><input type="checkbox" data-fx="${k}"> ${label}</label>`).join("")).join("") +
        `<h4>Mood</h4>
         <label>Preset <select data-preset><option value="">choose...</option><option value="cinematic">Cinematic</option><option value="clear">Clear day</option><option value="cozyrain">Cozy rain</option><option value="storm">Storm</option><option value="night">Night</option></select></label>
         <div class="row"><button data-act="save:1">Save 1</button><button data-act="save:2">Save 2</button><button data-act="save:3">Save 3</button></div>
         <div class="row"><button data-act="load:1">Load 1</button><button data-act="load:2">Load 2</button><button data-act="load:3">Load 3</button></div>
         <div class="row"><button data-act="photo">Photo mode F8</button><button data-act="shot">Shot F9</button><button data-act="rec">Rec F10</button></div>
         <h4>Settings</h4>
         <label>Weather <select data-mode><option value="auto">random</option><option value="always">always on</option><option value="storm">stormy</option><option value="clear">clear skies</option></select></label>
         <label>Time <select data-tod><option value="auto">auto cycle</option><option value="day">day</option><option value="golden">golden hour</option><option value="dusk">dusk</option><option value="night">night</option></select></label>
         <label>Light strength <input type="range" min="0" max="2" step="0.05" data-slider="lightGain"> <span data-val="lightGain"></span></label>
         <label>HD-2D strength <input type="range" min="0" max="2" step="0.05" data-slider="hd2dStrength"> <span data-val="hd2dStrength"></span></label>
         <label>Quality <select data-quality><option value="low">low</option><option value="medium">medium</option><option value="high">high</option></select></label>
         <div class="row"><button data-all="1">All on</button><button data-all="0">All off</button></div>
         <div class="hint">F2 opens this. Choices are remembered.</div>`;
    toastEl = document.createElement("div"); toastEl.id = "fx-toast";
    recDot = document.createElement("div"); recDot.id = "fx-rec";
    stageEl.append(gear, panel, toastEl, recDot);
    const toggle = () => { panel.hidden = !panel.hidden; if (!panel.hidden) lastMarked = null; gear.classList.toggle("open", !panel.hidden); gear.blur(); };
    gear.addEventListener("click", toggle);
    panel.addEventListener("input", (e) => {
        const t = e.target;
        if (t.dataset && t.dataset.slider) {
            setNum(t.dataset.slider, +t.value);
            const v = panel.querySelector(`[data-val="${t.dataset.slider}"]`); if (v) v.textContent = (+t.value).toFixed(2);
        }
    });
    panel.addEventListener("change", (e) => {
        const t = e.target;
        if (t.dataset.fx) setFx(t.dataset.fx, t.checked);
        else if ("mode" in t.dataset) setFx("weatherMode", t.value);
        else if ("quality" in t.dataset) setFx("quality", t.value);
        else if ("tod" in t.dataset) setFx("todMode", t.value);
        else if ("preset" in t.dataset) { if (t.value) applyPreset(t.value); t.value = ""; }
        t.blur();
    });
    panel.addEventListener("click", (e) => {
        const act = e.target.closest("[data-act]");
        if (act) {
            const [kind, arg] = act.dataset.act.split(":");
            if (kind === "save" || kind === "load") profileAct(kind, arg);
            else if (kind === "photo") setPhoto(!photoOn);
            else if (kind === "shot") screenshot();
            else if (kind === "rec") toggleRecord();
            act.blur(); return;
        }
        const b = e.target.closest("[data-all]");
        if (!b) return;
        for (const [k] of FX_DEFS) fx[k] = b.dataset.all === "1" && !EXPERIMENTAL.includes(k);
        syncLegacyFlags(); save(); refreshPanel();
        b.blur();
    });
    panel.addEventListener("keydown", (e) => e.stopPropagation());
    window.addEventListener("keydown", (e) => {
        if (e.key === "F2") { e.preventDefault(); toggle(); }
        else if (e.key === "F8") { e.preventDefault(); setPhoto(!photoOn); }
        else if (e.key === "F9") { e.preventDefault(); screenshot(); }
        else if (e.key === "F10") { e.preventDefault(); toggleRecord(); }
    });
    refreshPanel();
}
