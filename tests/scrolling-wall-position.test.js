// The scrolling backdrop wall, measured by POSITION rather than by pixels.
//
// Two screens of the original draw the same shape and the check in
// tools/verify_scrolling_walls.mjs only ever saw the pixels:
//
//   pro/ststatus.s:23264-23291  the pause screen's diamond room, clip 0x1D, its
//       counter at +0x54 and the frame toggle at +0x58:
//         lw    $v0, 0x58($s0)        <- the toggle
//         beqz  $v0, <set it>         <- not set: set it, do NOT advance
//         addiu $v1, $v0, 0x1
//         slti  $v0, $v1, 0x60        <- +1 only while it stays under 0x60
//         beqz  $v0, <store zero>     <- otherwise 0; it never HOLDS 0x60
//         lw    $a2, 0x54($s0)        <- x = counter
//         move_ $a3, $a2              <- y = counter, in the jalr DELAY SLOT
//
//   pro/stgmcard.s:4950-4977  the memory card's wall, clip 0x1E, counter +0x58
//       and toggle +0x5C, byte for byte the same shape.
//
// So the wall's phase after N frames is a number, not a picture: +1 on every
// SECOND frame, wrapping 0x5F -> 0x00, which is 0.5 px per vsync = 25 px/s at
// PAL 50 Hz and one full 96 px period every 96/25 = 3.84 s. This test drives
// each port for N frames through a stub host and reads the offset the port
// actually asked for.
//
// It is deliberately position-based. A pixel diff cannot tell a wall that
// wrapped from a wall that is frozen behind an opaque window, which is exactly
// how tools/verify_scrolling_walls.mjs came to report two walls that never loop
// (see docs/research/ui/scrolling-backdrop-walls-2026-08-14.md and the sweep of
// 2026-10-04).
//
// The last section is about the MEASUREMENT rather than the ports: the check
// reads the same numbers this file computes, so the reading of a phase trace is
// pinned here too, including the trace a long browser frame produces.

import { test } from "node:test";
import assert from "node:assert/strict";

import { pauseBackdropDraw } from "../engine/dw3/ui/native/pause-host.ts";
import { memcardRootTick, MEMCARD_ROOT } from "../engine/dw3/ui/memcard-root.ts";
import {
    measureWallPhase, wallPhaseFaults, WALL_RATE_PX_S, WALL_LOOP_SEC,
} from "../tools/scrolling-walls.mjs";

/** 400 frames is two whole 96 px periods plus eight, so the wrap is unavoidable. */
const FRAMES = 400;
/** The period: 0x60 values, 0x00..0x5F. The counter never HOLDS 0x60. */
const PERIOD = 0x60;

function flatMemory() {
    const cells = new Map();
    return {
        read8: (a) => cells.get(a) & 0xff,
        read16: (a) => cells.get(a) & 0xffff,
        read32: (a) => cells.get(a) >>> 0,
        write32: (a, v) => { cells.set(a, v >>> 0); },
        cells,
    };
}

/** Records only the wall draw: clip, x, y. Every other call is swallowed. */
function wallRecorder(clip) {
    const seen = [];
    return {
        seen,
        initDrawContext() {},
        setLayer() {},
        setOrigin() {},
        setScale() {},
        setPos() {},
        paletteShift() {},
        drawSprite(_pack, id, x, y) { if ((id & 0xff) === clip) seen.push([x >>> 0, y >>> 0]); },
        packResolve: (id) => id >>> 0,
        // memcardRootTick's non-draw services, kept inert.
        advancePhase() {}, advanceSubstate() {}, buildIdentity() {},
        banksReady: () => 0, audioPending: () => 0, playSound() {}, playSoundExit() {},
        createMessageWindow: () => 0x80182000, fadeCtor: () => 0x80183000,
        fadeStart() {}, requestTransition() {}, selectorMethod: () => 0,
        saveSelector: () => 0, freeIconTitle() {},
    };
}

/** The shared shape, asserted against the numbers the two ports produce. */
function checkWall(name, offsets) {
    assert.equal(offsets.length, FRAMES, `${name}: one wall draw per frame`);

    // The delay-slot `move_ $a3, $a2`: x and y are the same number, always.
    for (const [x, y] of offsets) assert.equal(x, y, `${name}: x and y are the same counter`);

    // After N frames the phase is floor(N / 2) mod 0x60 — +1 on every SECOND
    // frame (the toggle), and never 0x60 itself.
    for (let n = 1; n <= FRAMES; n++) {
        const want = Math.floor(n / 2) % PERIOD;
        assert.equal(offsets[n - 1][0], want,
            `${name}: frame ${n} draws offset ${want} (0x${want.toString(16)})`);
    }

    // The wrap happened, in the decoded direction and nowhere else.
    const values = offsets.map(([x]) => x);
    assert.deepEqual([...new Set(values)].sort((a, b) => a - b),
        Array.from({ length: PERIOD }, (_, i) => i),
        `${name}: every phase 0x00..0x5F is used`);
    assert.ok(!values.includes(PERIOD), `${name}: the counter never holds 0x60`);

    // Every advance is +1 MODULO the period, so the 0x5F -> 0x00 crossing is a
    // step like any other and nothing else may move. The number of steps is the
    // number of frames the toggle let through: one in two.
    const steps = Math.floor(FRAMES / 2);
    const deltas = new Set();
    let moved = 0;
    let seams = 0;
    for (let i = 1; i < values.length; i++) {
        const delta = (values[i] - values[i - 1] + PERIOD) % PERIOD;
        deltas.add(delta);
        if (delta === 0) continue;
        moved++;
        if (values[i - 1] === PERIOD - 1 && values[i] === 0) seams++;
    }
    assert.deepEqual([...deltas].sort((a, b) => a - b), [0, 1],
        `${name}: every move is +1 modulo 0x60, every other frame it holds`);
    assert.equal(moved, steps, `${name}: one step every second frame`);
    assert.equal(moved / FRAMES, 0.5,
        `${name}: 0.5 px per frame of travel = 25 px/s at PAL 50 Hz`);
    assert.equal(seams, Math.floor(steps / PERIOD),
        `${name}: 0x5F -> 0x00 once per 96 steps`);
    assert.ok(values.includes(0), `${name}: the counter reaches 0`);
}

test("the pause screen's diamond room holds its 96 px phase for N frames", () => {
    const mem = flatMemory();
    const host = wallRecorder(0x1d);
    const obj = 0x80150000;
    mem.write32(obj + 0x50, 0x1000);   // the layer the constructor stores
    for (let n = 0; n < FRAMES; n++) pauseBackdropDraw(mem, obj, host);
    checkWall("ststatus clip 0x1D", host.seen);
    assert.equal(mem.read32(obj + 0x54) >>> 0, Math.floor(FRAMES / 2) % PERIOD,
        "the counter itself is left on its phase");
});

test("the memory card's wall holds its 96 px phase for N frames", () => {
    const mem = flatMemory();
    const host = wallRecorder(0x1e);
    const screen = 0x80180000;
    const aux = 0x80181000;
    mem.write32(screen + MEMCARD_ROOT.state, 1);
    mem.write32(screen + MEMCARD_ROOT.substate, 0);
    mem.write32(screen + MEMCARD_ROOT.target, 0x1000);
    for (let n = 0; n < FRAMES; n++) memcardRootTick(mem, screen, aux, host);
    checkWall("stgmcard clip 0x1E", host.seen);
    assert.equal(mem.read32(screen + MEMCARD_ROOT.ambient) >>> 0, Math.floor(FRAMES / 2) % PERIOD,
        "the counter itself is left on its phase");
});

// ---------------------------------------------------------------------------
// The reading of a phase trace, which tools/verify_scrolling_walls.mjs shares.
//
// A phase trace is [seconds, x, y] samples in the order the check took them:
// the check samples on requestAnimationFrame (about every 16.7 ms here) and the
// screen counts PAL blanks (every 20 ms), so most samples repeat the last phase
// and some carry none at all. `buildTrace` models exactly that, and a long
// browser frame as the extra blanks `NativeVblankClock` then owes at once.

/** PAL: one vertical blank every 20 ms; the browser samples every 16.7 ms. */
const BLANK_SEC = 0.02;
const SAMPLE_SEC = 1 / 60;

/**
 * @param {object} [opts]
 * @param {number} [opts.seconds] how long to sample for.
 * @param {number} [opts.blanksPerStep] blanks the counter waits between steps;
 *   2 is the disc (0.5 px per blank = 25 px/s at PAL 50 Hz), 1 is a screen
 *   stepped once per browser frame on a 60 Hz monitor (50 px/s).
 * @param {number} [opts.frozen] 1 to hold the phase where it starts.
 * @param {number} [opts.skipEvery] every Nth sample, run this many extra
 *   blanks first — what a stalled frame does to the host's catch-up.
 * @param {number} [opts.skipWidth] how many extra blanks that frame owes.
 */
function buildTrace({ seconds = 4.2, blanksPerStep = 2, frozen = 0, skipEvery = 0, skipWidth = 3 } = {}) {
    const out = [];
    let blank = 0;
    let phase = 0;
    let blanksSinceStep = 0;
    let last = null;
    const step = () => {
        if (frozen) return;
        if (++blanksSinceStep >= blanksPerStep) {
            blanksSinceStep = 0;
            phase = phase + 1 < PERIOD ? phase + 1 : 0;
        }
    };
    for (let sample = 0; sample * SAMPLE_SEC < seconds; sample++) {
        const target = sample * SAMPLE_SEC;
        const due = Math.floor(target / BLANK_SEC + 1e-9) - blank;
        for (let i = 0; i < due + (skipEvery && sample % skipEvery === 0 ? skipWidth : 0); i++) {
            step();
            blank++;
        }
        // The check's sampler records a sample only when the phase CHANGED, so a
        // browser frame that owes no blank contributes nothing.
        if (phase === last) continue;
        last = phase;
        // The delay slot makes x and y one number; they are recorded separately
        // only because that is what a screen's draw call holds.
        out.push([+target.toFixed(4), phase, phase]);
    }
    return out;
}

/** The check's arithmetic as it stood before 2026-10-04: +1 steps and seams. */
function legacyFaults(samples) {
    const phases = samples.filter(([, x, y]) => Number.isFinite(x) && Number.isFinite(y));
    const skewed = phases.filter(([, x, y]) => x !== y).length;
    let seams = 0;
    let strides = 0;
    for (let i = 1; i < phases.length; i++) {
        const d = phases[i][1] - phases[i - 1][1];
        if (d === 1) strides++;
        else if (d < 0 && phases[i - 1][1] === PERIOD - 1 && phases[i][1] === 0) seams++;
    }
    const span = phases.at(-1)[0] - phases[0][0];
    const rate = (strides + seams) / span;
    const faults = [];
    if (phases.length === 0 || skewed > 0) faults.push("not one wall");
    if (seams < 1) faults.push("never wrapped");
    if (Math.abs(rate - 25) > 2) faults.push(`${rate.toFixed(1)} px/s`);
    return faults;
}

test("a wall that scrolls at the decoded rate reports no fault", () => {
    const m = measureWallPhase(buildTrace());
    assert.ok(m.wraps >= 1, `the ${WALL_LOOP_SEC}s window must contain a wrap`);
    assert.equal(m.skew, 0);
    assert.ok(Math.abs(m.rate - WALL_RATE_PX_S) <= 0.5, `${m.rate.toFixed(2)} px/s`);
    assert.deepEqual(wallPhaseFaults(m), []);
});

test("a browser frame that ran long is not a broken wall", () => {
    // What the check reported on 2026-10-04 for the card folder editor:
    // 101 phases, no wrap, 22.6 px/s, while its own pixel row for the same
    // screen read 3.85 s.
    const trace = buildTrace({ skipEvery: 19, skipWidth: 3 });
    const m = measureWallPhase(trace);
    assert.ok(m.skipped > 0, "the trace must contain phases that were stepped over");
    assert.ok(m.phases >= 80, `${m.phases} phases; the failing run saw 101 in 4.2 s`);
    assert.deepEqual(wallPhaseFaults(m), [], "a dropped browser frame must not read as a wall fault");
    assert.ok(Math.abs(m.rate - WALL_RATE_PX_S) <= 0.5, `${m.rate.toFixed(2)} px/s over ${m.span.toFixed(2)}s`);
    // The arithmetic this replaced called exactly this trace a broken wall, so
    // the old reading is what failed, not the screen.
    const legacy = legacyFaults(trace);
    assert.equal(legacy.length, 2, `the old reading must fault on this trace: ${legacy.join("; ")}`);
    assert.ok(legacy.includes("never wrapped"), legacy.join("; "));
    const legacyRate = Number.parseFloat(legacy.find((f) => f.endsWith("px/s")));
    assert.ok(legacyRate < WALL_RATE_PX_S - 2, `the old reading's ${legacyRate} px/s is below the disc's rate`);
});

test("a frozen wall, a wall at the monitor's rate and a wall with x != y all still fail", () => {
    const frozen = measureWallPhase(buildTrace({ frozen: 1 }));
    assert.ok(frozen.phases >= 1, "a frozen wall is still drawn; it is drawn in one place");
    assert.ok(wallPhaseFaults(frozen).includes("the phase never moved"), wallPhaseFaults(frozen).join("; "));

    // One pixel EVERY blank: 50 px/s, what a host stepping the overlay once per
    // requestAnimationFrame on a 60 Hz monitor produced until 2026-10-04.
    const fast = measureWallPhase(buildTrace({ blanksPerStep: 1 }));
    assert.ok(Math.abs(fast.rate - 50) < 1, `${fast.rate.toFixed(1)} px/s`);
    assert.ok(wallPhaseFaults(fast).some((f) => /px\/s/.test(f)), "a wall at the wrong rate must still fail");

    const skewed = buildTrace().map(([t, x, y], i) => [t, x, i % 7 === 0 ? y + 1 : y]);
    assert.ok(wallPhaseFaults(measureWallPhase(skewed)).some((f) => /x != y/.test(f)));

    assert.deepEqual(wallPhaseFaults(measureWallPhase([])), ["no wall draw was found at all"]);

    const brief = measureWallPhase(buildTrace({ seconds: 2 }));
    assert.ok(wallPhaseFaults(brief).some((f) => /needs 3\.84s/.test(f)),
        "a window shorter than one period cannot say anything about the rate");
});

test("the memory card's port still reads 25 px/s when the host catches up blanks", () => {
    // The browser asks for one sample, the host owes four blanks, and the port
    // is stepped four times before the sample is read: what
    // NativeVblankClock does on a long frame, and what the old reading called a
    // wall at 22.6 px/s that never wrapped.
    const mem = flatMemory();
    const host = wallRecorder(0x1e);
    const screen = 0x80180000;
    const aux = 0x80181000;
    mem.write32(screen + MEMCARD_ROOT.state, 1);
    mem.write32(screen + MEMCARD_ROOT.substate, 0);
    mem.write32(screen + MEMCARD_ROOT.target, 0x1000);
    const trace = [];
    for (let n = 0; n < 64; n++) {
        for (let b = 0; b < 4; b++) memcardRootTick(mem, screen, aux, host);
        const [x, y] = host.seen[host.seen.length - 1];
        trace.push([+(n * 4 * BLANK_SEC).toFixed(4), x, y]);
    }
    const m = measureWallPhase(trace);
    assert.equal(m.skew, 0, "x and y are one number");
    assert.deepEqual(wallPhaseFaults(m), []);
    assert.ok(Math.abs(m.rate - WALL_RATE_PX_S) <= 0.2, `${m.rate.toFixed(2)} px/s`);
    assert.ok(m.wraps >= 1, `one wrap in ${m.span.toFixed(2)}s of 4-blank frames`);
});
