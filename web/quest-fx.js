// web/quest-fx.js
// The quest scenes' own effects: new art of ours, placed on any map, drawn in the field's ONE y-sorted draw list (so an
// effect can stand in front of or behind the people, exactly like the game's own field sprites), plus the screen fade and
// the character-Y drive the `drop`/`rise` steps use.
//
// A sheet is two files under web/extra_fx/ (both ours, never game art -- see docs/quests-fx-brief.md):
//
//   crate.png    one strip of frames, left to right, each `frame` pixels, transparent background
//   crate.json   { "frame": [24, 24], "anchor": [0.5, 1],
//                  "clips": { "fall": { "frames": [0, 1, 0, 2], "hold": 4 },        hold = field blanks per frame
//                             "land": { "frames": [3], "hold": 30 } },             a clip without "loop" holds its last
//                  "default": "land" }                                              frame after the list runs out
//
// The scene step that uses it is documented at the top of web/quest-scenes.js. Everything here is plain data and numbers:
// no game asset is read, and the same maths the original uses is reused -- a fall adds `step` to a velocity each field
// blank and bounces as `-v/3` (the s415 rock fall), and the player's drop writes the field character's own +0x54 word
// (the s680 floor collapse, engine/systems/field-character.ts).
//
// Nothing here may outlive its scene: questFxClear() empties the list and the fade, and the host calls it when a scene ends,
// when it is skipped, on a warp, before a battle, and on every stage entry (so a load or a map change clears it too).

import { questGhostClear } from "./quest-ghost.js";

const FIELDS_PER_SECOND = 60;          // the field's own blank rate (FIELD_TICK_RATE)
const LAYERS = ["entity", "behind", "front"];

/** Loaded sheets by name: { def, img } once loaded, null when the sheet is missing (a step using it is skipped). */
const sheets = new Map();
/** Live effects by instance name (the name a scene gives the `fx` step). */
const live = new Map();
/** How many whole blanks the frame clock still owes the effect list. */
let blankAccumulator = 0;
/** The `fade` step's overlay: alpha 0..1 and where it is heading. */
const fade = { alpha: 0, target: 0, speed: 0, waiters: [] };
/** The `drop`/`rise` steps' character-Y drive, in field blanks (the s680 machine). */
let drive = null;
/** The `shake` steps: one running batch of thuds (amplitude in view px, dying out over each thud's frames). */
let shake = null;
/** Injected by the host: add a 16.8 displacement to the field character's +0x54 (fieldCharAddY). */
let addPlayerY = null;

/** The host hands us engine/systems/field-character.ts's own writer, so a drop moves the character the game moves. */
export function installQuestFxPlayerDrive(addY) {
    addPlayerY = typeof addY === "function" ? addY : null;
}

/** One sheet's address, for a host that wants to prefetch: web/extra_fx/<name>.{json,png}. */
export const questFxSheetUrl = (name) => `extra_fx/${name}`;

/**
 * Load the sheets a scene names (idempotent, cached). A sheet that fails to load is remembered as missing, so every use of
 * it is skipped for the rest of the session instead of retried per step. Never rejects.
 */
export async function loadQuestFxSheets(names) {
    const want = [...new Set((names ?? []).filter(Boolean).map(String))];
    await Promise.all(want.map(async (name) => {
        if (sheets.has(name)) return;
        try {
            const res = await fetch(`${questFxSheetUrl(name)}.json`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            let def = await res.json();
            let img = null;
            // `prefer`: a local, git-ignored sheet to play under this name when it is present; silently this one otherwise
            if (def?.prefer) {
                try {
                    const alt = await fetch(`${questFxSheetUrl(def.prefer)}.json`);
                    const altDef = alt.ok ? await alt.json() : null;
                    const altImg = altDef ? await loadSheetImage(`${questFxSheetUrl(def.prefer)}.png`) : null;
                    if (altImg && altDef?.clips) { def = altDef; img = altImg; }
                } catch { /* absent: keep this sheet */ }
            }
            img ??= await loadSheetImage(`${questFxSheetUrl(name)}.png`);
            const [fw, fh] = Array.isArray(def?.frame) ? def.frame.map(Number) : [];
            if (!img || !(fw > 0) || !(fh > 0) || !def?.clips) throw new Error("sheet needs frame:[w,h] and clips");
            defineQuestFxSheet(name, def, img);
        } catch (error) {
            console.warn(`[quest fx] sheet ${name} skipped:`, error?.message ?? error);
            sheets.set(name, null);
        }
    }));
    return sheets;
}

function loadSheetImage(url) {
    return new Promise((resolve) => {
        if (typeof Image === "undefined") return resolve(null);   // headless tests: no art, no crash
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = url;
    });
}

/** What a sheet says its cells are, for a verifier or the lab. */
export function questFxSheetInfo(name) {
    const s = sheets.get(name);
    return s ? { frame: [s.fw, s.fh], clips: Object.keys(s.def.clips ?? {}) } : null;
}

/**
 * Register a sheet directly instead of loading its two files: the loader calls this once the PNG is in, and a verifier or
 * a test with no network uses it to drive the effect list itself. `img` is anything CanvasImageSource-shaped.
 */
export function defineQuestFxSheet(name, def, img = null) {
    const key = String(name);
    const [fw, fh] = Array.isArray(def?.frame) ? def.frame.map(Number) : [];
    if (!(fw > 0) || !(fh > 0) || !def?.clips) { sheets.set(key, null); return null; }
    sheets.set(key, { def, img, fw, fh });
    return sheets.get(key);
}

/** The clip a sheet plays when a step does not name one: "default", else the first clip it holds. */
function defaultClip(sheet) {
    const clips = sheet.def.clips ?? {};
    if (sheet.def.default && clips[sheet.def.default]) return sheet.def.default;
    return Object.keys(clips)[0] ?? null;
}

/** Start a clip on a live effect: frame 0, clock 0. A clip the sheet does not hold leaves the effect as it was. */
function startClip(fx, name) {
    const clip = name != null ? fx.sheet.def.clips?.[name] : null;
    if (!clip) return false;
    fx.clip = name;
    fx.clipDef = clip;
    fx.frameIdx = 0;
    fx.frameTicks = 0;
    return true;
}

/** The current cell of a live effect's clip. */
function currentFrame(fx) {
    const frames = fx.clipDef?.frames;
    if (!Array.isArray(frames) || !frames.length) return 0;
    return frames[Math.min(fx.frameIdx, frames.length - 1)] ?? 0;
}

/**
 * Place an effect. `spec` is the `fx` step after compileScene has resolved it:
 *   { name, sheet, x, y, clip, layer, fall?, slide?, rise? }
 * Returns the live effect, or null when the sheet did not load or the spec is unusable -- the caller then just goes on
 * (a scene never blocks on art it does not have).
 */
export function questFxSpawn(spec) {
    if (!spec || typeof spec !== "object") return null;
    const name = String(spec.name ?? spec.sheet ?? "");
    if (!name) return null;
    const fx = makeFx(spec, name);
    if (!fx) return null;
    // A name is one effect. Re-using it drops the old object the way `fxremove` would, so anyone waiting on the old one
    // (a prop, a second scene) is settled instead of waiting forever on an object no longer in the live list.
    const old = live.get(name);
    if (old && old !== fx) removeFx(old);
    live.set(name, fx);
    return fx;
}

/** One fx object from a spec: the sheet it draws, its place, its layer and its first clip. Shared with the props. */
function makeFx(spec, name) {
    const sheetName = String(spec.sheet ?? name);
    const sheet = sheets.get(sheetName);
    if (!sheet) return null;
    const layer = LAYERS.includes(spec.layer) ? spec.layer : "entity";
    const fx = {
        name, sheet, sheetName,
        x: Number(spec.x) || 0,
        y: Number(spec.y) || 0,
        layer,
        // Drawn `scale` times its cell (1 = the sheet's own pixels). A giant is the same sheet several times the
        // player's height; the anchor point stays its feet, so scaling never moves where it stands.
        scale: Math.max(0.1, Math.min(8, Number(spec.scale) || 1)),
        // the draw list's key: an effect's feet, so it sorts with the people it stands between
        ysort: Number(spec.ysort) || Number(spec.y) || 0,
        clip: null, clipDef: null, frameIdx: 0, frameTicks: 0,
        motion: null,
        alpha: 1,
        fadeOut: null,
        waiters: [],
    };
    // Layer "behind"/"front" are the field's own two sentinel bands (web/draw-order.js).
    if (layer === "behind") fx.ysort = -Infinity;
    if (layer === "front") fx.ysort = Infinity;
    if (!startClip(fx, spec.clip ?? defaultClip(sheet))) {
        // no clip at all: the sheet still draws its first cell, so an effect never silently vanishes
        fx.clipDef = { frames: [0], hold: 60 };
    }
    const motion = spec.fall ? { kind: "fall", ...spec.fall }
        : spec.slide ? { kind: "slide", ...spec.slide }
            : spec.rise ? { kind: "rise", ...spec.rise }
                : null;
    if (motion) setMotion(fx, motion);
    return fx;
}

/** The effect a scene name refers to, or null. */
export function questFxGet(name) {
    return live.get(String(name)) ?? null;
}

/** Switch a live effect's clip: `{ name, clip, loop }`. Unknown effects and clips are skipped, not errors. */
export function questFxPlay(spec) {
    const fx = live.get(String(spec?.name ?? ""));
    if (!fx) return false;
    const clip = spec?.clip != null ? fx.sheet.def.clips?.[spec.clip] : null;
    if (!clip) return false;
    if (!startClip(fx, spec.clip)) return false;
    if (typeof spec.loop === "boolean") fx.clipDef = { ...fx.clipDef, loop: spec.loop };
    return true;
}

/** Start a motion on a live effect (`fall`, `slide`, `rise`), e.g. after it appeared. */
export function questFxMove(spec) {
    const fx = live.get(String(spec?.name ?? ""));
    if (!fx) return false;
    const motion = spec.fall ? { kind: "fall", ...spec.fall }
        : spec.slide ? { kind: "slide", ...spec.slide }
            : spec.rise ? { kind: "rise", ...spec.rise }
                : null;
    if (!motion) return false;
    setMotion(fx, motion);
    return true;
}

/**
 * Arm a motion. The maths are the original's: a fall adds `step` px/blank to a velocity and starts at the effect's current
 * height (the s415 ride-walker's `velocity += 0x30; y += velocity`), bounces as `-v/3` on reaching `floor`, and settles when
 * the rebound is too small to matter; a slide spreads a straight move over `frames` blanks; a rise lifts `pixels` over
 * `frames` blanks. A motion with no sane numbers does nothing.
 */
function setMotion(fx, m) {
    if (!m || typeof m !== "object") return;
    if (m.kind === "fall") {
        const floor = Number(m.floor);
        if (!Number.isFinite(floor)) return;
        fx.motion = {
            kind: "fall", v: Number(m.v0) || 0, step: Math.max(0.05, Number(m.step) || 0.75),
            floor, bounce: m.bounce !== false, bounces: 0,
        };
        return;
    }
    if (m.kind === "slide") {
        const to = Array.isArray(m.to) ? m.to.map(Number) : null;
        const frames = Math.max(1, Math.round(Number(m.frames) || 30));
        if (!to || to.length !== 2 || !to.every(Number.isFinite)) return;
        fx.motion = { kind: "slide", from: [fx.x, fx.y], to, frames, done: 0 };
        return;
    }
    if (m.kind === "rise") {
        const pixels = Number(m.pixels);
        if (!Number.isFinite(pixels) || pixels === 0) return;
        const frames = Math.max(1, Math.round(Number(m.frames) || 30));
        fx.motion = { kind: "rise", frames, done: 0, per: -pixels / frames };
    }
}

/** True when an effect has nothing left to do (no motion, no fade-out): `fxwait` resolves on it. */
const isSettled = (fx) => !fx.motion && !fx.fadeOut;

function settle(fx) {
    fx.motion = null;
    const waiting = fx.waiters.splice(0);
    for (const resolve of waiting) resolve(true);
}

/**
 * Wait for an effect to finish what it is doing (a fall reaching its floor, a slide/rise arriving, a fade-out ending or the
 * effect being removed). Resolves at once for an effect that does not exist or has already settled: a scene step waiting
 * on an effect that could not be placed must never hang the scene.
 */
export function questFxWait(name) {
    const fx = live.get(String(name ?? ""));
    if (!fx || isSettled(fx)) return Promise.resolve(false);
    return new Promise((resolve) => { fx.waiters.push(resolve); });
}

/** Remove an effect, optionally fading it out over `fade` blanks first (`{ name, fade }`). */
export function questFxRemove(spec) {
    const fx = live.get(String(spec?.name ?? ""));
    if (!fx) return false;
    const frames = Math.max(0, Math.round(Number(spec?.fade) || 0));
    if (frames > 0) {
        fx.fadeOut = { left: frames, total: frames };
        return true;
    }
    removeFx(fx);
    return true;
}

function removeFx(fx) {
    if (live.get(fx.name) === fx) live.delete(fx.name);
    const waiting = fx.waiters.splice(0);
    for (const resolve of waiting) resolve(true);
}

/**
 * The screen fade the `fade` step uses: mode "out" (to black), "in" (back to the field), "black" (already black) or
 * "clear" (no overlay). Resolves when the overlay has reached its target. It is a plain black quad over the finished frame:
 * the game's own transition wipe belongs to stage changes, and a quest must not fake one (that would fire the arrival
 * events of the map it is still on).
 */
export function questFxFade(mode, frames) {
    const m = String(mode ?? "out");
    const target = m === "in" || m === "clear" ? 0 : 1;
    if (m === "black" || m === "clear") {
        fade.alpha = target;
        fade.target = target;
        fade.speed = 0;
        return Promise.resolve(fade.alpha);
    }
    const n = Math.max(1, Math.round(Number(frames) || 30));
    fade.target = target;
    fade.speed = 1 / (n / FIELDS_PER_SECOND);
    if (fade.alpha === target) { fade.speed = 0; return Promise.resolve(fade.alpha); }
    return new Promise((resolve) => { fade.waiters.push(resolve); });
}

/** The fade overlay's current alpha (0 = off). A verifier reads this. */
export const questFxFadeAlpha = () => fade.alpha;
/** True while a quest fade is on screen: the host uses it to hold the quest mark and the step prompts. */
export const questFxFading = () => fade.alpha > 0;

/**
 * Drop (or, with a negative `pixels`, lift) the player by `pixels` world pixels through the field character's own Y word:
 * the s680 floor-collapse drive, in which the character object itself descends and the camera follows, so the room scrolls
 * instead of the sprite bobbing. Resolves when the whole distance is travelled.
 */
export function questFxDrivePlayer(pixels, step = 0.25) {
    const total = Number(pixels);
    if (!Number.isFinite(total) || total === 0) return Promise.resolve(0);
    // No field character to drive (a host without one): the step is skipped rather than waited on.
    if (!addPlayerY) return Promise.resolve(0);
    const dir = Math.sign(total);
    const per = Math.max(0.02, Math.abs(Number(step) || 0.25));
    return new Promise((resolve) => {
        drive = { left: Math.abs(total), dir, step: per, v: 0, moved: 0, resolve };
    });
}

/** Where the drop/rise drive is, for a verifier: remaining pixels, or null when none is running. `dir` is +1 down / -1 up. */
export const questFxDriveState = () => (drive ? { left: Math.round(drive.left * 100) / 100, moved: Math.round(drive.moved * 100) / 100, dir: drive.dir } : null);

/**
 * The `shake` step's screen shake: `{ amp, frames, decay?, every?, times? }`. One batch at a time (a scene asks for one);
 * the promise resolves when the last thud has died out, so the line after a giant's footstep is heard after it. A batch
 * already running is replaced (its waiter resolves at once): a scene never waits on a shake it has superseded.
 */
export function questFxShake(spec) {
    const amp = Math.max(0, Number(spec?.amp) || 0);
    const frames = Math.max(1, Math.round(Number(spec?.frames) || 20));
    const times = Math.max(1, Math.min(12, Math.round(Number(spec?.times) || 1)));
    const every = times > 1 ? Math.max(1, Math.round(Number(spec?.every) || frames)) : 0;
    if (shake) { const waiting = shake.waiters.splice(0); for (const resolve of waiting) resolve(0); }
    if (!(amp > 0)) return Promise.resolve(0);
    return new Promise((resolve) => {
        shake = { amp, frames, times, every, decay: spec?.decay !== false, t: 0, waiters: [resolve] };
    });
}

/**
 * The field's shake offset for this frame, in view pixels. Read by the renderer inside the field's own transform, so the
 * map, the people and the weather move while the text box, the menus and the quest mark stay put.
 */
export function questFxShakeOffset() {
    if (!shake) return { x: 0, y: 0 };
    const { amp, frames, times, every, decay, t } = shake;
    let ox = 0, oy = 0;
    for (let i = 0; i < times; i++) {
        const local = t - i * every;                      // this thud's own frame
        if (local < 0 || local >= frames) continue;
        const k = decay ? 1 - local / frames : 1;
        const a = amp * k;
        const x = a * (Math.sin(local * 2.1 + 0.7) * 0.6 + Math.sin(local * 4.7 + 2.1) * 0.4);
        const y = a * (Math.sin(local * 1.7 + 2.9) * 0.6 + Math.sin(local * 3.9 + 1.3) * 0.4);
        if (Math.abs(x) + Math.abs(y) > Math.abs(ox) + Math.abs(oy)) { ox = x; oy = y; }
    }
    return { x: Math.round(ox), y: Math.round(oy) };
}

/** True while a shake is on screen (a verifier reads it; nothing else needs it). */
export const questFxShaking = () => !!shake;

/** Where the shake batch is, for a verifier: its frame and its total length, or null. */
export const questFxShakeState = () => (shake ? { frame: shake.t, total: (shake.times - 1) * shake.every + shake.frames } : null);

/**
 * Remove every effect and the screen fade. Called when a scene ends, is skipped, warps, fights or the map changes.
 * Other quest-scene features hook their own cleanup in here (one line each) so this stays the single exit path.
 */
export function questFxClear() {
    for (const fx of [...live.values()]) removeFx(fx);
    live.clear();
    fade.alpha = 0;
    fade.target = 0;
    fade.speed = 0;
    const waiting = fade.waiters.splice(0);
    for (const resolve of waiting) resolve(fade.alpha);
    if (shake) {
        const thuds = shake.waiters.splice(0);
        shake = null;
        for (const resolve of thuds) resolve(0);
    }
    if (drive) {                                        // a drop/rise still running: let its scene resume, not hang
        const still = drive.resolve;
        drive = null;
        still(0);
    }
    blankAccumulator = 0;
    questGhostClear();     // a `ghost` step's faded actors: back to their own colours on every exit
}

/** One field blank of every live effect: clip timing, the motion machine, the fade-out. */
function stepBlank() {
    for (const fx of [...live.values()]) {
        // clip timing: `hold` blanks per frame, then the next frame (or the last one, still)
        const frames = fx.clipDef?.frames ?? [];
        const hold = Math.max(1, Math.round(Number(fx.clipDef?.hold) || 6));
        if (frames.length > 1) {
            fx.frameTicks += 1;
            if (fx.frameTicks >= hold) {
                fx.frameTicks = 0;
                fx.frameIdx += 1;
                const loop = fx.clipDef?.loop === true;
                if (fx.frameIdx >= frames.length) fx.frameIdx = loop ? 0 : frames.length - 1;
            }
        }
        const m = fx.motion;
        if (m?.kind === "fall") {
            m.v += m.step;
            fx.y += m.v;
            fx.ysort = fx.layer === "entity" ? fx.y : fx.ysort;
            if (fx.y >= m.floor) {
                fx.y = m.floor;
                fx.ysort = fx.layer === "entity" ? fx.y : fx.ysort;
                m.bounces += 1;
                if (m.bounce && Math.abs(m.v) >= 2.2 && m.bounces < 12) m.v = -m.v / 3;
                else settle(fx);
            }
        } else if (m?.kind === "slide") {
            m.done += 1;
            const t = Math.min(1, m.done / m.frames);
            fx.x = Math.round(m.from[0] + (m.to[0] - m.from[0]) * t);
            fx.y = Math.round(m.from[1] + (m.to[1] - m.from[1]) * t);
            if (fx.layer === "entity") fx.ysort = fx.y;
            if (t >= 1) settle(fx);
        } else if (m?.kind === "rise") {
            m.done += 1;
            fx.y += m.per;
            if (fx.layer === "entity") fx.ysort = fx.y;
            if (m.done >= m.frames) { fx.y = Math.round(fx.y); fx.ysort = fx.layer === "entity" ? fx.y : fx.ysort; settle(fx); }
        }
        if (fx.fadeOut) {
            fx.fadeOut.left -= 1;
            fx.alpha = Math.max(0, fx.fadeOut.left / fx.fadeOut.total);
            if (fx.fadeOut.left <= 0) removeFx(fx);
        }
    }
}

/**
 * Advance the effects, the player drive and the screen fade by `dt` seconds. Effects move in whole field blanks (60 a
 * second), like the stage objects they copy; the fade runs on real time so it finishes on the frame the scene asks for.
 */
export function questFxTick(dt) {
    const step = Math.max(0, Number(dt) || 0);
    blankAccumulator += step * FIELDS_PER_SECOND;
    let blanks = Math.floor(blankAccumulator);
    if (blanks > 0) blankAccumulator -= blanks;
    if (blanks > 240) blanks = 240;                 // a tab that was hidden for a while must not teleport an effect
    while (blanks-- > 0) {
        stepBlank();
        if (shake) {
            shake.t += 1;
            if (shake.t >= (shake.times - 1) * shake.every + shake.frames) {
                const thuds = shake.waiters.splice(0);
                shake = null;
                for (const resolve of thuds) resolve(1);
            }
        }
        if (drive) {
            drive.v += drive.step * drive.dir;
            const want = drive.v;                    // px this blank
            const take = Math.min(drive.left, Math.abs(want));
            if (addPlayerY) addPlayerY(take * drive.dir * 256);   // 16.8 fixed point, the field character's own word
            drive.left -= take;
            drive.moved += take;
            if (drive.left <= 0.0001) {
                const resolve = drive.resolve;
                drive = null;
                resolve(1);
            }
        }
    }
    if (fade.speed > 0) {
        const dir = Math.sign(fade.target - fade.alpha);
        fade.alpha = Math.max(0, Math.min(1, fade.alpha + dir * fade.speed * step));
        if (Math.abs(fade.target - fade.alpha) < 0.001 || dir === 0) {
            fade.alpha = fade.target;
            fade.speed = 0;
            const waiting = fade.waiters.splice(0);
            for (const resolve of waiting) resolve(fade.alpha);
        }
    }
}

/**
 * The draw list entries for this frame, in the field's own ordering list (sortDrawables y-sorts them with the people).
 * `camX`/`camY` are the frame's camera, the same numbers drawSprite subtracts.
 */
export function questFxDrawables(camX, camY) {
    const out = [];
    for (const fx of live.values()) {
        if (fx.layer === "front") continue;          // drawn after every entity instead (questFxDrawOver)
        out.push({ y: fx.ysort, draw: () => drawFx(fx, camX, camY) });
    }
    return out;
}

/** The "front" layer: effects that must cover every person on the map. */
export function questFxDrawOver(ctx, camX, camY) {
    for (const fx of live.values()) if (fx.layer === "front") drawFx(fx, camX, camY, ctx);
}

function drawFx(fx, camX, camY, ctx2 = null) {
    const g = ctx2 ?? drawContext;
    if (!g) return;
    const ax = Array.isArray(fx.sheet.def.anchor) ? Number(fx.sheet.def.anchor[0]) : 0.5;
    const ay = Array.isArray(fx.sheet.def.anchor) ? Number(fx.sheet.def.anchor[1]) : 1;
    const k = fx.scale ?? 1;
    const dw = Math.max(1, Math.round(fx.sheet.fw * k));
    const dh = Math.max(1, Math.round(fx.sheet.fh * k));
    const sx = currentFrame(fx) * fx.sheet.fw;
    const dx = Math.round(fx.x - camX - dw * ax);
    const dy = Math.round(fx.y - camY - dh * ay);
    const was = g.globalAlpha;
    if (fx.alpha < 1) g.globalAlpha = Math.max(0, Math.min(1, fx.alpha));
    g.drawImage(fx.sheet.img, sx, 0, fx.sheet.fw, fx.sheet.fh, dx, dy, dw, dh);
    g.globalAlpha = was;
}

/** The host installs the field's 2D context here, so a drawable closure does not need it passed down the list. */
let drawContext = null;
export function installQuestFxCanvas(ctx) {
    drawContext = ctx;
}

/** The screen fade, drawn last: a black quad over the finished frame, at the field's scale (640x480 device pixels). */
export function questFxDrawFade(ctx, viewW, viewH) {
    if (fade.alpha <= 0) return;
    ctx.save();
    if (typeof ctx.setTransform === "function") ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = Math.min(1, fade.alpha);
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, ctx.canvas?.width ?? viewW, ctx.canvas?.height ?? viewH);
    ctx.restore();
}

/** Test/debug view of the effect list: what is on the map right now. */
export const questFxState = () => [...live.values()].map((fx) => ({
    name: fx.name, x: Math.round(fx.x), y: Math.round(fx.y), layer: fx.layer,
    clip: fx.clip, frame: currentFrame(fx), alpha: Math.round(fx.alpha * 100) / 100,
    moving: fx.motion?.kind ?? null,
}));
