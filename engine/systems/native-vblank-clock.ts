// The vertical blanks a shipped overlay is stepped by, and the delta each blank
// publishes.
//
// Every screen of the original runs on the console's vertical blank: the main
// loop (F0x80018140 -> D0x8004b7c4 = F0x80018230) hands every live object one
// turn per blank, so a screen's OWN frame counters count blanks and nothing
// else. The scrolling backdrop wall is the plain case: its phase counter
// advances by 1 only on every SECOND blank and wraps at 0x60, and both its x
// and its y arguments are that counter (pro/stcrdabm.s:1583-1611, the album's
// clip 0x08; pro/stcrddek.s:6286-6314; pro/stcrdshp.s:5406-5434 — the same
// shape as pro/ststatus.s:23264-23291 and pro/stgmcard.s:4950-4977), so it
// travels half a pixel per blank and one 96 px period every 3.84 s.
//
// The browser's refresh is not the console's. requestAnimationFrame fires at
// 60, 120 or 144 Hz here, and a host that steps the overlay once per browser
// frame runs every one of those counters 20% (or 2.4x) fast — the card screens'
// wall came round every 3.2 s instead of 3.84 s, which is what
// tools/verify_scrolling_walls.mjs measured on 2026-10-04. That is not a
// per-screen question: one screen's cadence is the cadence every screen the
// host owns would have shared, had it asked.
//
// The translated screens already convert a browser frame into displayed frames
// through `MenuDisplayClock` (engine/dw3/ui/pad-words.ts) and the field through
// `consumeFieldTicks` (engine/systems/field-movement.ts). This is the same
// conversion for the screens that still run the shipped overlay, so a blank is
// worth the same everywhere and a 144 Hz monitor sees the same wall as a 60 Hz
// one.
//
// Each blank also publishes the display service's own delta, which is the other
// half of the same rule and is decoded in engine/systems/frame-clock.ts: the
// vertical-blank feeder F0x8001D3F4 adds the PAL step 0x133 (exe/fns.s:14558,
// :14561) to two 8.8 accumulators and the publisher F0x8001D504 (exe/fns.s:
// 14612-14734) publishes `sra 8` of them, keeping the delta accumulator's low
// byte (:14704). So the game runs 60 Hz logic on a 50 Hz display: the free
// running tick [0x8004DE20] and this frame's delta [0x8004DE28] both step by 1
// on most blanks and by 2 on 51 of every 256. `advance()` returns exactly that
// sequence, and the host hands each delta to the runtime, which is where those
// two words are written (engine/native/runtime.ts:978-985).
//
// It uses its OWN FrameClock rather than the module-level one: `advanceFrameClock()`
// is the translated screens' clock (engine/dw3/ui/pad-words.ts:29-31), and a
// native blank must not advance it a second time on the same browser frame.
//
// EVERY OWNER OF A SHIPPED OVERLAY STEPS IT THROUGH THIS ONE CLOCK: the
// production screen host (web/native-screen-host.js), the screen lab
// (web/native-screen-lab.js) and the field's stage driver (web/native-stage.js).
// A second conversion anywhere else is the same fault this file was written for.

import { FrameClock, STEP_PAL } from "./frame-clock.ts";
import { consumeFieldTicks, FIELD_TICK_SECONDS } from "./field-movement.ts";

/** PAL is the shipped region: one vertical blank every 1/50 s. */
export const PAL_BLANK_SECONDS = FIELD_TICK_SECONDS;

/**
 * Most blanks one host call may catch up on. A browser tab that stalls (or a
 * hidden one that wakes) would otherwise fire every blank it owed in a single
 * frame; the backlog is dropped instead, exactly as a console that missed its
 * deadline would have dropped it.
 */
export const MAX_CATCH_UP_BLANKS = 4;

/** Longest elapsed time one call believes, matching the walker's own dt clamp. */
const MAX_ELAPSED_SECONDS = 0.25;

export class NativeVblankClock {
    private elapsed = PAL_BLANK_SECONDS; // one blank is due the moment it opens
    private display = new FrameClock(STEP_PAL);
    private stamp: number | null = null;

    /**
     * The blanks `seconds` of elapsed time are worth, as the delta each one
     * publishes. Empty when the time is not worth a blank yet — a 240 Hz
     * browser gets an empty list on most calls and two blanks on one in six,
     * and the overlay is stepped the same 50 times either way.
     */
    advance(seconds: number): number[] {
        const dt = Number.isFinite(seconds)
            ? Math.min(Math.max(seconds, 0), MAX_ELAPSED_SECONDS)
            : 0;
        const due = consumeFieldTicks(this.elapsed, dt);
        this.elapsed = due.accumulator;
        if (due.ticks > MAX_CATCH_UP_BLANKS) {
            // Drop the frames that are already late; keep the remainder.
            this.elapsed -= (due.ticks - MAX_CATCH_UP_BLANKS) * PAL_BLANK_SECONDS;
        }
        const deltas: number[] = [];
        for (let i = 0; i < Math.min(due.ticks, MAX_CATCH_UP_BLANKS); i++) {
            deltas.push(this.display.advanceFrame());
        }
        return deltas;
    }

    /** The free running 60 Hz tick word [0x8004DE20] this clock has published. */
    tick(): number {
        return this.display.tick();
    }

    /**
     * The blanks the time between two stamps is worth. `stampMs` is whatever
     * the caller already has: a `requestAnimationFrame` timestamp, or
     * `performance.now()`. This is the shape a screen driven by its OWN
     * animation-frame loop has, because such a loop has no `dt` of its own to
     * offer and would otherwise hand the overlay one frame per browser frame —
     * 120 overlay frames a second on a 120 Hz monitor. Same conversion, same
     * clock, so a lab and the game cannot drift apart: the first call after
     * `reset()` is worth one blank and measures no time, exactly like
     * `advance(0)`.
     *
     * A caller that measures time here and passes explicit `dt` to `advance()`
     * on the same clock is double-feeding it; give one owner one of the two.
     */
    advanceFromStamp(stampMs: number): number[] {
        const now = Number.isFinite(stampMs) ? stampMs : 0;
        const seconds = this.stamp === null ? 0 : (now - this.stamp) / 1000;
        this.stamp = now;
        return this.advance(seconds);
    }

    /** Back to the state before the first blank. */
    reset(): void {
        this.elapsed = PAL_BLANK_SECONDS;
        this.display.reset();
        this.stamp = null;
    }
}
