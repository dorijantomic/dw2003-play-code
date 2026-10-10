// Headless visual check for the type-0x17 launch pads, rendered by the real
// web/game.js through the web/ui-lab.html harness (no mock renderer).
//
// Decode: docs/research/field/launch-pad-actor-decoded.md. What this asserts,
// all against the shipped extraction rather than hand-copied numbers:
//
//   1. s735's pad table reaches the browser and the pad the 2026-07-28 runtime
//      capture homed in on, (444,652), is among the pads the renderer draws.
//   2. Every enabled pad's idle disc actually paints: the pad's own pixels
//      appear on the live canvas at the pad's map position.
//   3. Driving the controller through its state-2 window makes the strobe
//      column appear ABOVE the pad (wstag735 draws index 1 at y - 0x20) and
//      makes the pad's painted height grow — a pad that only ever draws its
//      disc fails here.
//   4. The pad's IDLE COLOUR PULSE: with nothing touching it, the disc cycles
//      exactly three palette rows, and the run lengths on the canvas are the
//      idle script's own 68/4/10/6 ticks.
//   5. The strobe is gone again once the script ends and the pad is back in
//      state 1.
//
// Run with a web server on port 8742:
//   python3 -m http.server 8742 --directory web
//   tools/run-playwright.sh tools/verify_launch_pad.mjs [output-directory]
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { baseUrl } from "./verify-base-url.mjs";

const STAGE = "s735";
// The pad the controlled replay latched onto, and the op-13 record it fired.
const TRACED_PAD = { x: 444, y: 652 };
const RECORD_DEST = { x: 960, y: 80 };

const pads = JSON.parse(
    await readFile(new URL("../web/assets/data/launch_pads.json", import.meta.url)),
);
const s735 = pads["735"];
assert.ok(s735, "launch_pads.json must carry s735");
const enabled = s735.pads.filter((p) => p.enabled);
assert.ok(
    enabled.some((p) => p.x === TRACED_PAD.x && p.y === TRACED_PAD.y),
    "s735 must carry the traced pad (444,652)",
);

let idleZoom = 1;
const outDir = resolve(process.argv[2] ?? "/tmp/launch-pad-verification");
await mkdir(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(`${baseUrl(8742)}/ui-lab.html`, { waitUntil: "load" });
await page.waitForFunction(() => {
    const f = document.getElementById("game");
    return f?.contentWindow?.__labOpen && f.contentWindow.__state?.started;
}, null, { timeout: 30000 });
await page.waitForTimeout(1200);
const frame = page.frames().find((f) => f.url().includes("index.html"));

// Warp to the ice dungeon. The pad's own centre is a trigger cell, and setup op
// 13 fires on contact, so arriving there starts a pad walk within a frame or two —
// which is the behaviour under tested elsewhere and pure noise here. Step off it
// again straight away: this check is about how a pad DRAWS, not how it fires.
//
// The warp used to be given a flat 8 frames before reading `state.launch`. That
// races the stage-change wipe: `stepSetupTick()` (web/game.js) returns early
// while `window.__fade.dir !== 0`, and a warp raises the wipe, so on a loaded
// box the pad contact is not evaluated until the wipe finishes — sometimes
// within the 8 frames, sometimes 20 frames later. Three different assertions
// failed across five runs of this file on 2026-10-04 for that one reason: the
// pad had not fired yet, or (the other way round) it fired *after* the sample
// cleared `state.launch` and its strobe column was still on the canvas, which is
// what "must draw nothing above the disc" then saw. Same pattern as
// tools/verify_step_launch_handoff.mjs:119 — wait for the wipe to finish, then
// wait for the thing the check is actually about.
const placed = await frame.evaluate(async ([stage, pad]) => {
    const maps = window.__state.manifest.maps;
    const idx = maps.findIndex((m) => m.id === stage);
    if (idx < 0) return { ok: false, reason: `no map ${stage}` };
    const raf = () => new Promise((r) => requestAnimationFrame(r));
    window.__setMap(idx, { x: pad.x + 20, y: pad.y + 13 });
    let waited = 0;
    while (window.__fade.dir !== 0 && waited < 300) {
        await raf();
        waited++;
    }
    // Now poll for the pad contact itself, bounded.
    let fired = false;
    waited = 0;
    while (!fired && waited < 60) {
        await raf();
        fired = !!window.__state.launch;
        waited++;
    }
    window.__state.launch = null;
    window.__state.handoffHold = null;
    window.__teleport(pad.x - 96, pad.y - 12);
    for (let i = 0; i < 8; i++) {
        await raf();
    }
    // Stepping off the pad must also stay off it: with the launch cleared there
    // is nothing left to re-enter the pad, and the strobe column must be gone
    // before any of the measurements below read the canvas.
    for (let i = 0; i < 8 && window.__state.launch; i++) await raf();
    return {
        ok: true, map: window.__state.manifest.maps[window.__state.mapIdx].id,
        firedOnContact: fired, launch: !!window.__state.launch,
        fadeFrames: waited,
    };
}, [STAGE, TRACED_PAD]);
assert.ok(placed.ok, placed.reason);
assert.equal(placed.map, STAGE);
assert.equal(placed.firedOnContact, true,
    "stepping onto s735's pad cell starts the pad walk with no button pressed");
assert.equal(placed.launch, false, "and stepping off it again lets the pad go idle");
await page.waitForTimeout(600);

// Sample the canvas over the pad. `box` is in MAP space; the probe converts to
// canvas space through the live camera the renderer used this frame, and
// returns the raw pixels so the checks below are differential and exact rather
// than colour-guessing (the ice dungeon's floor is itself blue).
const sample = async (box) =>
    frame.evaluate((b) => {
        const cv = document.querySelector("canvas");
        const cam = window.__lastCam ?? { x: 0, y: 0, zoom: 1 };
        const z = cam.zoom ?? 1;
        const cx = Math.round((b.x - cam.x) * z);
        const cy = Math.round((b.y - cam.y) * z);
        const w = Math.round(b.w * z);
        const h = Math.round(b.h * z);
        if (cx < 0 || cy < 0 || cx + w > cv.width || cy + h > cv.height) return null;
        return {
            w, h, z,
            data: Array.from(cv.getContext("2d").getImageData(cx, cy, w, h).data),
        };
    }, box);

// Rows in which two samples of the same window differ, and by how many pixels.
const diff = (a, b) => {
    const rows = [];
    let total = 0;
    for (let y = 0; y < a.h; y++) {
        let n = 0;
        for (let x = 0; x < a.w; x++) {
            const i = (y * a.w + x) * 4;
            if (a.data[i] !== b.data[i] || a.data[i + 1] !== b.data[i + 1] ||
                a.data[i + 2] !== b.data[i + 2]) n++;
        }
        if (n) rows.push(y);
        total += n;
    }
    return { total, top: rows.length ? rows[0] : -1, bottom: rows.at(-1) ?? -1 };
};

// Everything below measures the PAD LAYER, not the frame: each measurement
// A/Bs the same frame with the pad layer drawn and not drawn. Comparing whole
// frames was tried and rejected twice — against the stage's background PNG (a
// plain-floor control patch came back 96% "differing", so that measures the
// renderer's tone handling) and across frames (the player's own walk animation
// left a 3000px residual). Toggling the layer cancels both out exactly.
// The player is PARKED on every rAF for the whole A/B, including the two
// waits between samples. s735 is an ice stage: a parked player keeps sliding
// and drags the camera, so a map-space window would resample different world
// pixels in the `on` and `off` frames and a pad-free patch would read as a
// huge difference (528 px before this; 0 after).
// The park spot is `pad.x - 96, pad.y - 12`. Two earlier spots failed. It used to
// be `pad.x + 20, pad.y + 40`, which is a PAD cell: setup op 13 fires on contact
// (fieldstg.s:5c94-:5cb8 has no button in it), so parking there launched the
// player and dragged the camera off the probe. It was then moved 64px left, and
// that cell re-fires: a launch left `state.moving` true, so clearing
// `state.launch` alone let the normal movement path walk the player back onto
// the pad within a few frames, and a live launch draws the strobe column 32px
// above the disc — which is exactly what "must draw NOTHING above the disc"
// then measures (it failed on 2026-10-04 at top rows 26, 36 and 40 on five runs
// of this file). 96px left is neutral: 60 parked frames there fire the pad 0
// times, against 1 for the 64px cell, and the pad is still 96px from the player
// so the probe rect stays on the 640px canvas. `parkIsNeutral` below re-measures
// that on every run, so a change to the floor cannot bring the flake back.
//
// `keepLaunch` is off by default and the A/B clears `state.launch` first, because
// the ice keeps sliding the parked player and a pad cell is only ~64px away: the
// park spot can drift onto a pad between two phases, and a live launch draws the
// strobe column 32px above the disc, which is exactly what "must draw NOTHING
// above the disc" then measures. That happened on 2026-10-04 (top row 26 and 36
// on two runs of this file). Each phase states the state it wants; the idle ones
// want no launch.
const padLayer = async (box, keepLaunch = false) => frame.evaluate(async ([b, pad, keep]) => {
    const raf = () => new Promise((r) => requestAnimationFrame(r));
    const park = () => window.__teleport(pad.x - 96, pad.y - 12);
    if (!keep) {
        window.__state.launch = null;
        window.__state.handoffHold = null;
        // A launch also leaves `moving` set, and the movement path then walks the
        // player back onto the pad cell within a few frames -- which starts a new
        // launch, drags the camera off the probe and puts the strobe column back
        // in the window. Clear it with the launch itself.
        window.__state.moving = false;
        park(); await raf();
    }
    const cv = document.querySelector("canvas");
    const g = cv.getContext("2d");
    const sample1 = () => {
        const cam = window.__lastCam ?? { x: 0, y: 0, zoom: 1 };
        const z = cam.zoom ?? 1;
        const x = Math.round((b.x - cam.x) * z);
        const y = Math.round((b.y - cam.y) * z);
        const w = Math.round(b.w * z);
        const h = Math.round(b.h * z);
        if (x < 0 || y < 0 || x + w > cv.width || y + h > cv.height) return null;
        return { w, h, data: Array.from(g.getImageData(x, y, w, h).data) };
    };
    // The camera must be at rest, or the two samples below map this map-space
    // window onto different world pixels and the diff measures the camera, not
    // the pad. This matters most right after a launch: the flight leaves the
    // camera somewhere else and it eases back, and a window sampled mid-ease
    // reads as extra content above the pad (the same colours appear and
    // disappear between the two samples, which a layer toggle cannot do).
    // Park until the camera repeats itself, as the pulse phase already does.
    const settleCamera = async () => {
        let camKey = null, still = 0, waited = 0;
        while (still < 20 && waited < 600) {
            park();
            await raf();
            waited++;
            const c = window.__lastCam;
            const k = `${c.x},${c.y},${c.zoom}`;
            still = k === camKey ? still + 1 : 0;
            camKey = k;
        }
        return waited;
    };
    let settle = await settleCamera();
    // A sample is only usable when the frame it came from is STILL: two
    // consecutive samples with the layer in the same state must be identical,
    // or the A/B below is measuring whatever else moved in between. That is not
    // hypothetical at (444,652) -- the pad sits inside a stage object that
    // animates and blends additively, so two "pads on" samples two frames
    // apart differed by 360-1204 px reaching 26px above the disc (measured,
    // .bunny-scratch/lp_probe6.mjs), and that residue landed in the on/off diff
    // as "the pad drew a column". Waiting for a still frame first, every one of
    // s735's ten pads then measures its disc alone (probe7).
    const stillSample = async () => {
        let a = null, b = null, tries = 0;
        do {
            park(); await raf(); a = sample1();
            park(); await raf(); b = sample1();
            tries += 1;
            if (!a || !b) break;
            let n = 0;
            for (let i = 0; i < a.data.length; i += 4) {
                if (a.data[i] !== b.data[i] || a.data[i + 1] !== b.data[i + 1] ||
                    a.data[i + 2] !== b.data[i + 2]) { n += 1; if (n > 4) break; }
            }
            if (n === 0) return { sample: a, tries };
        } while (tries < 40);
        return { sample: b, tries };
    };
    const same = (a, b) => {
        if (!a || !b) return false;
        for (let i = 0; i < a.data.length; i += 4) {
            if (a.data[i] !== b.data[i] || a.data[i + 1] !== b.data[i + 1] ||
                a.data[i + 2] !== b.data[i + 2]) return false;
        }
        return true;
    };
    // Full A/B with a round-trip gate: on -> on (must match) -> off -> off
    // (must match) -> on again, and the closing sample must equal the opening
    // one. Only then is the whole window known to have been still, so the diff
    // is the pad layer and nothing else. The co-located object's animation
    // repeats on a multi-frame cycle, so a per-pair gate is not enough: with
    // one, three of five runs still measured "a column above the disc".
    let on = null, off = null, cycles = 0;
    if (keep) {
        // The strobe leg asks for a LIVE launch, and the strobe is an animation
        // by design, so a still-frame gate can never converge there. Take the
        // pair directly; that leg asserts a footprint that GROWS, so a moving
        // neighbour cannot hide a missing column.
        park(); await raf(); park(); await raf();
        on = sample1();
        window.__launchPads.setEnabled(false);
        park(); await raf(); park(); await raf();
        off = sample1();
        window.__launchPads.setEnabled(true);
        park(); await raf();
    } else while (cycles < 12) {
        cycles += 1;
        window.__launchPads.setEnabled(true);
        const onR = await stillSample();
        window.__launchPads.setEnabled(false);
        const offR = await stillSample();
        window.__launchPads.setEnabled(true);
        // A window that fell off the canvas is a camera that had not come back
        // (the pulse phase walks the player across the stage), not a pad that
        // drew nothing: settle again and try the whole A/B once more.
        if (!onR.sample || !offR.sample) {
            settle = await settleCamera();
            continue;
        }
        const backR = await stillSample();
        if (same(onR.sample, backR.sample)) {
            on = onR.sample;
            off = offR.sample;
            break;
        }
    }
    window.__launchPads.setEnabled(true);
    park(); await raf();
    if (!on || !off) return null;
    let total = 0, top = -1, bottom = -1;
    for (let y = 0; y < on.h; y++) {
        let n = 0;
        for (let x = 0; x < on.w; x++) {
            const i = (y * on.w + x) * 4;
            if (on.data[i] !== off.data[i] || on.data[i + 1] !== off.data[i + 1] ||
                on.data[i + 2] !== off.data[i + 2]) n++;
        }
        if (n) { if (top < 0) top = y; bottom = y; }
        total += n;
    }
    return { total, top, bottom, settle, cycles };
}, [box, TRACED_PAD, keepLaunch]);

// ── 1. The idle disc actually paints, and only where a pad is ───────────────
const padA = { x: TRACED_PAD.x, y: TRACED_PAD.y, w: 40, h: 24 };
const control = { x: TRACED_PAD.x - 96, y: TRACED_PAD.y, w: 40, h: 24 };

// The park spot must be a cell the pad cannot fire from, or every idle
// measurement below is really measuring a launch. Measure it here rather than
// trusting the comment: park 60 frames and count the frames a launch starts.
const parkIsNeutral = await frame.evaluate(async (pad) => {
    const raf = () => new Promise((r) => requestAnimationFrame(r));
    window.__state.launch = null;
    window.__state.handoffHold = null;
    window.__state.moving = false;
    let fired = 0;
    for (let i = 0; i < 60; i++) {
        window.__teleport(pad.x - 96, pad.y - 12);
        await raf();
        if (window.__state.launch) {
            fired++;
            window.__state.launch = null;
        }
    }
    return fired;
}, TRACED_PAD);
assert.equal(parkIsNeutral, 0,
    "the park spot must not re-fire the pad: a live launch draws the strobe " +
    "column above the disc and every idle measurement would be measuring it");

// Park the player off the pad so he is not sitting in the probe window.
await frame.evaluate(async (pad) => {
    window.__teleport(pad.x - 96, pad.y - 12);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
}, TRACED_PAD);
// s735's floor keeps sliding the parked player, and the camera follows, so the
// "same" map-space window lands on different world pixels between the on/off
// samples and a plain patch of floor reads as a huge difference. Park him each
// frame until the camera is identical for 20 frames before measuring.
await frame.evaluate(async (pad) => {
    let last = null, still = 0, waited = 0;
    while (still < 20 && waited < 600) {
        window.__teleport(pad.x - 96, pad.y - 12);
        await new Promise((r) => requestAnimationFrame(r));
        waited++;
        const c = window.__lastCam;
        const k = `${c.x},${c.y},${c.zoom}`;
        still = k === last ? still + 1 : 0;
        last = k;
    }
    return waited;
}, TRACED_PAD);
await page.locator("#game").screenshot({ path: resolve(outDir, "pad-idle.png") });

// The disc's footprint depends on the idle pulse PHASE: it is drawn additively
// from a semi sheet, so a dim palette row shifts fewer floor pixels than the
// held bright row. Take the MAXIMUM over a full pulse period (the script is 88
// frames) rather than one arbitrary frame; the control is measured once, and
// the camera is parked on every rAF throughout.
let discFootprint = { total: 0, top: -1, bottom: -1 };
for (let i = 0; i < 12; i++) {
    const m = await padLayer(padA);
    if (m && m.total > discFootprint.total) discFootprint = m;
    await frame.evaluate(async ([pad]) => {
        for (let k = 0; k < 8; k++) {
            window.__teleport(pad.x - 96, pad.y - 12);
            await new Promise((r) => requestAnimationFrame(r));
        }
    }, [TRACED_PAD]);
}
const controlFootprint = await padLayer(control);
if (!discFootprint.total || !controlFootprint) assert.fail("probe rects off screen");
const area = Math.round(40 * 24 * (idleZoom = (await sample(padA)).z) ** 2);
console.log(`idle pad layer — disc rect max ${discFootprint.total}/${area} px, ` +
            `empty-floor control ${controlFootprint.total} px`);
assert.equal(controlFootprint.total, 0,
    "toggling the pad layer must not touch a patch of floor with no pad on it");
// The additive sem sheet's exact-equality diff counts only the texels that
// shift the floor colour, not all 466 opaque texels (ceiling ~466*zoom^2 =
// 1864 at zoom 2); the camera-settled bright phase measures ~344 of 3840.
assert.ok(discFootprint.total > area * 0.05,
    `the idle disc must be what the layer draws (${discFootprint.total}/${area})`);

// ── 2. Driving the controller adds the strobe column ABOVE the disc ─────────
// The probe now covers disc + column: the disc is 40x24 at the pad origin and
// wstag735 draws the strobe 0x20 px higher (0x800a609c), so row 32*zoom of this
// window is the disc's top edge.
const probe = { x: TRACED_PAD.x, y: TRACED_PAD.y - 0x20, w: 40, h: 72 };
const idleFootprint = await padLayer(probe);
assert.ok(idleFootprint, "pad probe window must be on screen");
const discTop = Math.round(32 * idleZoom);
console.log(`idle footprint over disc+column window: ${idleFootprint.total} px, ` +
            `rows ${idleFootprint.top}..${idleFootprint.bottom} (disc top ${discTop})`);
assert.ok(idleFootprint.top >= discTop,
    `an idle pad must draw NOTHING above the disc (top row ${idleFootprint.top})`);

const strobe = await frame.evaluate(async ([pad, dest, ticks]) => {
    const eng = await import("./vendor/engine.js");
    const st = eng.startLaunch(
        { stepOp: 13, transition: "launch", spawnX: dest.x, spawnY: dest.y, dir: "up" },
        { x: pad.x + 20, y: pad.y + 13 },
        pad,
    );
    eng.stepLaunch(st, ticks); // past the 18-tick dark wind-up
    window.__state.launch = st;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return { phase: st.phase, padClip: st.padClip, padFrame: Math.round(st.padFrame) };
}, [TRACED_PAD, RECORD_DEST, 60]);
console.log(`strobe state: ${JSON.stringify(strobe)}`);
assert.equal(strobe.phase, "charge");
assert.ok(strobe.padClip > 0, "the pad must be strobing at tick 60");

const strobeFootprint = await padLayer(probe, true);
await page.locator("#game").screenshot({ path: resolve(outDir, "pad-strobe.png") });
console.log(`strobing footprint: ${strobeFootprint.total} px, ` +
            `rows ${strobeFootprint.top}..${strobeFootprint.bottom}`);
assert.ok(strobeFootprint.total > idleFootprint.total * 1.5,
    `the strobe must add to the disc (${strobeFootprint.total} vs ${idleFootprint.total})`);
assert.ok(strobeFootprint.top < discTop,
    `the strobe column must reach ABOVE the disc (top row ${strobeFootprint.top})`);

// ── 3. The idle colour pulse: the disc cycles palette rows on its own ───────
// The pad's second (looping) animator script writes a CLUT-row offset every
// frame, so an untouched pad's disc changes colour with nothing touching it.
// Sampled per rendered frame over more than one 88-tick cycle; the control
// patch is sampled in the same loop, so a stage that animated on its own would
// show up there rather than being mistaken for the pulse.
// s735 is an ICE stage: a parked player keeps sliding, which drags the camera
// and makes a map-space probe window resample every frame. Pinning the player
// each frame stops the slide, and the camera then comes to rest exactly — the
// control patch below is what proves it did.
// The cursor is read DIRECTLY (write side), because the canvas reads an
// averaged signature that cannot separate a 3-row script from an aliased
// 6-value one when the camera is sub-pixel — the 2026-09-13 investigation left
// exactly that ambiguity. The canvas control patch is still sampled to prove
// the camera is at rest.
const padIndex = await frame.evaluate((pad) => {
    const list = window.__launchPads.list("735");
    return list.findIndex((p) => p.x === pad.x && p.y === pad.y);
}, TRACED_PAD);
assert.ok(padIndex >= 0, "the traced pad must be in the s735 list");

const pulse = await frame.evaluate(async ([pad, ctl, idx, frames]) => {
    window.__state.launch = null;
    const park = () => window.__teleport(pad.x - 96, pad.y - 12);
    const cv = document.querySelector("canvas");
    const g = cv.getContext("2d");
    const sig = (b) => {
        const cam = window.__lastCam ?? { x: 0, y: 0, zoom: 1 };
        const z = cam.zoom ?? 1;
        const x = Math.round((b.x - cam.x) * z);
        const y = Math.round((b.y - cam.y) * z);
        const w = Math.round(b.w * z);
        const h = Math.round(b.h * z);
        if (x < 0 || y < 0 || x + w > cv.width || y + h > cv.height) return null;
        const d = g.getImageData(x, y, w, h).data;
        let r = 0, gg = 0, bb = 0;
        for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; bb += d[i + 2]; }
        return `${r},${gg},${bb}`;
    };
    let last = null, still = 0, waited = 0;
    while (still < 20 && waited < 600) {
        park();
        await new Promise((r) => requestAnimationFrame(r));
        waited++;
        const c = window.__lastCam;
        const k = `${c.x},${c.y},${c.zoom}`;
        still = k === last ? still + 1 : 0;
        last = k;
    }
    const ctrs = [], ctls = [], callDeltas = [];
    for (let i = 0; i < frames; i++) {
        const before = window.__launchPads.debug().calls;
        park();
        await new Promise((r) => requestAnimationFrame(r));
        const dbg = window.__launchPads.debug();
        callDeltas.push(dbg.calls - before);
        ctrs.push(dbg.palette[idx]);
        ctls.push(sig(ctl));
    }
    return { ctrs, ctls, callDeltas, waited, cam: last };
}, [TRACED_PAD, control, padIndex, 220]);

assert.ok(!pulse.ctls.includes(null), "probe window must stay on the canvas for the whole sample");
const ctlStates = new Set(pulse.ctls);
assert.equal(ctlStates.size, 1,
    `the empty-floor control must be static while sampling (${ctlStates.size} states)`);
const callStates = [...new Set(pulse.callDeltas)];
console.log(`drawLaunchPads calls per rAF: ${callStates.join("/")}`);

// Run-length encode the emitted CLUT row over the sampled frames.
const runs = [];
for (const s of pulse.ctrs) {
    if (runs.length && runs.at(-1).k === s) runs.at(-1).n++;
    else runs.push({ k: s, n: 1 });
}
const states = [...new Set(pulse.ctrs)];
console.log(`idle pulse (camera at rest after ${pulse.waited} frames): ` +
            `${states.length} palette rows, runs ${runs.map((r) => r.n).join("/")}`);
assert.equal(states.length, 3,
    `the idle disc must cycle exactly the script's 3 palette rows (saw ${states.length})`);

// The script is {0,6} {1,6} {2,68} {1,4} {0,4}, looping — so a full cycle reads
// off the canvas as runs of 68 (row 2), 4 (row 1), 10 (row 0: the trailing 4
// and the next cycle's leading 6), 6 (row 1). Anything else is not this table.
const CYCLE = [68, 4, 10, 6];
const inner = runs.slice(1, -1).map((r) => r.n); // clip the partial end runs
assert.ok(inner.length >= CYCLE.length,
    `sample must cover a full 88-tick cycle (runs ${inner.join("/")})`);
const start = CYCLE.indexOf(inner[0]);
assert.ok(start >= 0, `run lengths must come from the idle script (${inner.join("/")})`);
for (let i = 0; i < inner.length; i++) {
    assert.equal(inner[i], CYCLE[(start + i) % CYCLE.length],
        `idle run ${i} of ${inner.join("/")} must match the 68/4/10/6 cycle`);
}
// The three palette rows run 0..2 as a brightness ramp of one hue (the disc's
// colour is its clip base — s735's 0x1c is blue), and the script holds row 2
// for 68 ticks. Read from the cursor, the row index IS that ramp's step.
const lum = (s) => String(s).split(",").reduce((a, b) => a + Number(b), 0);
const brightest = states.reduce((a, b) => (lum(a) >= lum(b) ? a : b));
assert.equal(runs.find((r) => r.n === 68).k, brightest,
    "the 68-tick hold must be the highest palette row");
assert.ok(lum(states.reduce((a, b) => (lum(a) <= lum(b) ? a : b))) < lum(brightest),
    "the palette rows must differ in brightness");

// ── 4. And it goes away again when the pad returns to state 1 ───────────────
// Re-enter the stage rather than measuring whatever the driven launch left
// behind: `stepLaunch` was stepped 60 ticks past the wind-up, and the game's own
// update can carry that through to the destination stage, which moves the camera
// off the pad for good (that is what made this leg return a null probe window on
// 2026-10-04, two runs in five). Entering s735 again at the pad is the state the
// leg actually claims: the pad is back in state 1 with no launch, so the column
// must be gone.
await frame.evaluate(async ([stage, pad]) => {
    const raf = () => new Promise((r) => requestAnimationFrame(r));
    const maps = window.__state.manifest.maps;
    window.__setMap(maps.findIndex((m) => m.id === stage), { x: pad.x + 20, y: pad.y + 13 });
    for (let i = 0; i < 8; i++) await raf();
    window.__state.launch = null;
    window.__state.handoffHold = null;
    window.__state.moving = false;
    // The pad cell is under the arrival point, so step off it again straight
    // away, exactly as the prelude does.
    window.__teleport(pad.x - 96, pad.y - 12);
    for (let i = 0; i < 40; i++) await raf();
}, [STAGE, TRACED_PAD]);
const afterFootprint = await padLayer(probe);
assert.ok(afterFootprint, "probe window must be back on screen");
console.log(`after: ${afterFootprint.total} px, rows ${afterFootprint.top}..` +
            `${afterFootprint.bottom}`);
// The camera does not land on exactly the same sub-pixel offset as the first
// idle pass, so the disc's rasterised pixel count moves a little; what must hold
// is that the column is gone and the footprint is back to disc scale.
assert.ok(afterFootprint.top >= discTop,
    `with the launch over the pad must draw nothing above the disc (top ${afterFootprint.top})`);
assert.ok(Math.abs(afterFootprint.total - idleFootprint.total) < idleFootprint.total * 0.2,
    `pad layer must be back to its idle disc (${afterFootprint.total} vs ${idleFootprint.total})`);

assert.deepEqual(errors, [], `page errors: ${errors.join("; ")}`);
console.log(`OK — ${enabled.length} enabled s735 pads, screenshots in ${outDir}`);
await browser.close();
