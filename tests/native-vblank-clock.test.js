// The vertical blanks a shipped overlay is stepped by.
//
// The six screens that still run the shipped overlay count the console's
// vertical blanks in their own fields, not browser frames. The plain case is the
// card screens' backdrop wall: its phase counter at root+0x58 advances by 1 only
// on every SECOND blank and wraps at 0x60, and its x and y draw arguments are
// that counter (pro/stcrdabm.s:1583-1611, pro/stcrddek.s:6286-6314,
// pro/stcrdshp.s:5406-5434 — byte for byte the shape at pro/ststatus.s:
// 23264-23291 and pro/stgmcard.s:4950-4977), so the wall travels half a pixel
// per blank and one 96 px period comes round every 96/25 = 3.84 s.
//
// The host that steps those overlays used to run one overlay frame per
// requestAnimationFrame, so at the browser's 60 Hz the wall came round every
// 3.2 s — 20% fast, and 2.4x fast on a 144 Hz monitor. `NativeVblankClock` is
// the conversion: one blank is worth 1/50 s of elapsed time whatever the
// refresh is, and each blank publishes the display service's own delta word.

import { test } from "node:test";
import assert from "node:assert/strict";

import { NativeVblankClock, MAX_CATCH_UP_BLANKS } from "../engine/systems/native-vblank-clock.ts";

const BLANK_SECONDS = 1 / 50;
/** Browser refresh rates a page is actually driven at. */
const REFRESH_RATES = [30, 50, 60, 90, 120, 144, 240];
/** The period every one of the nine walls shares: 0x60 phases of one pixel. */
const LOOP_SECONDS = 96 / 25;

/** Drive `seconds` of browser frames at `hz`, returning the deltas published. */
function publish(hz, seconds, clock = new NativeVblankClock()) {
    const deltas = [];
    const frames = Math.round(seconds * hz);
    for (let i = 0; i < frames; i++) deltas.push(...clock.advance(1 / hz));
    return deltas;
}

/**
 * The decoded card wall, driven by the clock's blanks: the frame toggle at +0x5C
 * and the phase counter at +0x58, drawn at (counter, counter).
 */
function wallDraws(hz, seconds) {
    const clock = new NativeVblankClock();
    const draws = [];
    let counter = 0;
    let toggle = 0;
    const frames = Math.round(seconds * hz);
    for (let i = 0; i < frames; i++) {
        for (const _ of clock.advance(1 / hz)) {
            if (toggle === 0) {
                toggle = 1;                      // beqz $v0, <set it>: no advance
            } else {
                const next = counter + 1;         // addiu $v1, $v0, 0x1
                counter = next < 0x60 ? next : 0; // slti $v0, $v1, 0x60
                toggle = 0;                      // sw $zr, 0x5c
            }
            draws.push({ t: (i + 1) / hz, x: counter, y: counter });
        }
    }
    return draws;
}

test("a blank is worth the same 20 ms at every browser refresh rate", () => {
    for (const hz of REFRESH_RATES) {
        // Four seconds is 200 blanks, plus the one the constructor's own draw
        // spends (the clock starts with a blank already due, so a screen's first
        // update is its first frame). A per-browser-frame host would have
        // published 121 at 30 Hz, 241 at 60 Hz and 961 at 240 Hz. One blank of
        // slack, because four seconds ends exactly on a blank and the
        // accumulator drifts by a fraction of one.
        const count = publish(hz, 4).length;
        assert.ok(Math.abs(count - 200) <= 1, `${hz} Hz published ${count} blanks, not 200`);
    }
});

test("each blank publishes the PAL delta: 1 on most, 2 on 51 of every 256", () => {
    // F0x8001D3F4 adds the PAL step 0x133 to two 8.8 accumulators and
    // F0x8001D504 publishes `sra 8` of them, keeping the delta accumulator's low
    // byte (engine/systems/frame-clock.ts). 256 blanks are 256 * 0x133 / 0x100 =
    // 307 logic ticks, so 51 of them publish 2.
    const deltas = publish(50, 256 * BLANK_SECONDS).slice(1);
    assert.equal(deltas.length, 256);
    assert.ok(deltas.every((d) => d === 1 || d === 2), "a blank published something else");
    assert.equal(deltas.filter((d) => d === 2).length, 51);
    assert.equal(deltas.reduce((a, b) => a + b, 0), 307);
});

test("the card screens' wall comes round every 3.84 s at every refresh rate", () => {
    for (const hz of REFRESH_RATES) {
        const draws = wallDraws(hz, 4.8);
        // One whole period is 0x60 phases, each held for two blanks: the wall
        // is back where it started on the 193rd blank. Two blanks of slack on
        // the clock, because a browser frame is not a blank and the accumulator
        // drifts by a fraction of one.
        const back = draws.findIndex((d, i) => i > 1 && d.x === draws[0].x && d.t > 1);
        assert.ok(back > 0, `${hz} Hz: the wall never returned to its first phase`);
        assert.ok(Math.abs(back - 192) <= 2,
            `${hz} Hz: the wall came round on blank ${back}, not 192`);
        assert.ok(Math.abs(draws[back].t - LOOP_SECONDS) <= 2 * BLANK_SECONDS,
            `${hz} Hz: the wall came round after ${draws[back].t.toFixed(2)}s, not ${LOOP_SECONDS}s`);
        // And it is the same wall the disc draws: x and y are one number, the
        // counter never holds 0x60, and every second blank it steps once.
        assert.ok(draws.every((d) => d.x === d.y));
        assert.ok(!draws.some((d) => d.x === 0x60));
        const steps = draws.filter((d, i) => i > 0 && d.x !== draws[i - 1].x).length;
        assert.ok(Math.abs(steps - (draws.length - 1) / 2) <= 1,
            `${hz} Hz: ${steps} steps over ${draws.length} blanks is not one per second blank`);
    }
});

test("a screen that opened draws its first blank on its first update", () => {
    // 60 Hz has not finished a 20 ms blank yet, so without a blank already due
    // at the start the player would see one empty frame before the screen's own
    // first draw. After that the cadence is the console's: five blanks in every
    // six browser frames at 60 Hz, which is the 50 a second the disc publishes.
    const clock = new NativeVblankClock();
    assert.equal(clock.advance(1 / 60).length, 1);
    let blanks = 0;
    for (let i = 0; i < 60; i++) blanks += clock.advance(1 / 60).length;
    assert.ok(Math.abs(blanks - 50) <= 1, `60 blanks worth of frames published ${blanks}`);
});

test("a stalled tab drops the frames it owes instead of firing them all at once", () => {
    const clock = new NativeVblankClock();
    clock.advance(1 / 60);
    assert.equal(clock.advance(5).length, MAX_CATCH_UP_BLANKS);
    // The backlog is gone, not deferred: an ordinary frame is one blank away.
    assert.equal(clock.advance(1 / 60).length, 0);
    assert.equal(clock.advance(1 / 60).length, 1);
});

test("a nonsense elapsed time never publishes a frame", () => {
    const clock = new NativeVblankClock();
    for (const bad of [NaN, -1, Infinity]) {
        const due = clock.advance(bad);
        assert.ok(Array.isArray(due), `advance(${bad}) did not return a list`);
        assert.ok(due.length <= MAX_CATCH_UP_BLANKS, `advance(${bad}) published ${due.length}`);
    }
});
