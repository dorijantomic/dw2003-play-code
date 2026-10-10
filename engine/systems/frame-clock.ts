// The one frame clock every screen reads: the resident display service's two
// published words, behind the two getters the overlays dispatch through.
//
//   [0x8004DF9C] -> F0x8001D704 -> [0x8004DE28]  this displayed frame's delta
//   [0x8004DF98] -> F0x8001D6F4 -> [0x8004DE20]  the free-running tick
//
// Both getters are `lui`/`lw`/`jr` over one word of the display table at
// 0x8004DE10 and read no argument: `exe/fns.s:14743-14746` and `:14751-14754`.
// No screen increments either word. Two resident routines publish them:
//
//   F0x8001D3F4, the vertical-blank feeder (exe/fns.s:14538-14595), reads the
//   video-mode word `D0x8005CCAC` (`:14539-14540`) and adds the region step to
//   two 8.8 accumulators: `+0x14` on the NTSC arm (`:14547`/`:14550`) and the
//   PAL arm (`:14558`/`:14561`), `+0x1C` on both (`:14551`, `:14562`,
//   `:14666`). The step is `addiu $v0, 0x100` when `D0x8005CCAC` is nonzero
//   (`:14556`, `:14560`) and `addiu $v0, 0x133` when it is zero (`:14565`,
//   `:14569`); 0x133 is the PAL 6:5 case, the shipped one. The same step also
//   goes to `D0x80048D34+0x48` (`:14552`, `:14563`, `:14567`), the party
//   context's own counter, which is not part of this table.
//
//   F0x8001D504, the once-per-frame publisher (exe/fns.s:14612-14734), adds the
//   same step to a third accumulator `+0x0C` (`:14684`-`:14690`), publishes
//   `sra 8` of `+0x0C` into `+0x08` (`:14692`-`:14695`, read by `F0x8001D6E4`),
//   `sra 8` of `+0x14` into `+0x10` (`:14696`-`:14699`) and `sra $v0, $v1, 8` of
//   `+0x1C` into `+0x18` (`:14697`, `:14700`, `:14701`), then REWRITES `+0x1C`
//   to the accumulator's low byte: `andi $v1, 0xff` (`:14704`) and the delay-slot
//   `sw $v1, 0x1c($s0)` of the `jalr` at `:14705` (`:14706`). That carry is the
//   only clamp in the clock, and it is why the published delta is not forced to
//   one: `+0x14` keeps every bit it has, so the tick is a free-running 8.8
//   counter, while `+0x1C` keeps its remainder, so the delta carries.
//
// Nothing else writes `+0x10` or `+0x18`. `grep -rn "D0x8004de20\|D0x8004de28"`
// over `~/ddw3/asm/dw2003/` names them only in the two getters, and
// over the publisher's own lines (`:14612-14734`) the only stores to those two
// offsets are `:14699` and `:14701`; the other `0x10(`/`0x18(` stores in that
// range are the stack words `sw $s1, 0x14($sp)` / `sw $s2, 0x18($sp)`.
//
// 0x133 / 0x100 is 1.1992: the game runs 60Hz logic on a 50Hz display, so the
// published delta is 1 on most frames and 2 on the frame that crosses the 256
// boundary, and the tick crosses at the same rate. 51 of every 256 PAL frames
// publish 2.

/** The display table the published words are fields of. */
export const DISPLAY_TABLE = 0x8004de10;
/** `F0x8001D6F4` (exe/fns.s:14743-14746): the free-running tick. */
export const TICK_CELL = DISPLAY_TABLE + 0x10;  // 0x8004DE20
/** `F0x8001D704` (exe/fns.s:14751-14754): this displayed frame's delta. */
export const DELTA_CELL = DISPLAY_TABLE + 0x18; // 0x8004DE28
/** The two 8.8 accumulators the feeder adds the region step to. */
export const TICK_ACCUMULATOR = DISPLAY_TABLE + 0x14;   // 0x8004DE24
export const DELTA_ACCUMULATOR = DISPLAY_TABLE + 0x1c;  // 0x8004DE2C
/** The third accumulator the publisher steps, and its published word. */
export const AUX_ACCUMULATOR = DISPLAY_TABLE + 0x0c;    // 0x8004DE1C
export const AUX_CELL = DISPLAY_TABLE + 0x08;           // 0x8004DE18
/** `D0x8005CCAC`, the video-mode word the feeder and the publisher branch on. */
export const VIDEO_MODE_WORD = 0x8005ccac;
/** `addiu $v0, 0x100` — the step when `D0x8005CCAC` is nonzero. */
export const STEP_NTSC = 0x100;
/** `addiu $v0, 0x133` — the step when it is zero; PAL, the shipped region. */
export const STEP_PAL = 0x133;
/** `sra $v0, 0x8`: a published word is its accumulator's top byte. */
export const PUBLISH_SHIFT = 8;
/** `andi $v1, 0xff`: the remainder the publisher carries in the delta word. */
export const REMAINDER_MASK = 0xff;

/**
 * The port of the display table's two published words. One instance is the
 * game's clock; `frameDelta()` and `frameTick()` read it and `advanceFrame()`
 * is the one place a browser frame becomes a displayed frame of it.
 */
export class FrameClock {
    private step: number;
    private tickAccumulator = 0;
    private deltaAccumulator = 0;
    private auxAccumulator = 0;
    private tickValue = 0;
    private deltaValue = 0;
    private auxValue = 0;

    /** `step` is the region step: `STEP_PAL` for the shipped `D0x8005CCAC === 0`. */
    constructor(step: number = STEP_PAL) {
        this.step = step;
    }

    /** The region step the feeder would take for a video-mode word. */
    static stepFor(videoModeWord: number): number {
        return videoModeWord === 0 ? STEP_PAL : STEP_NTSC;
    }

    /**
     * The vertical-blank feeder `F0x8001D3F4` (exe/fns.s:14538-14595): add the
     * region step to the tick and delta accumulators.
     */
    feedVerticalBlank(): void {
        this.tickAccumulator = (this.tickAccumulator + this.step) | 0;
        this.deltaAccumulator = (this.deltaAccumulator + this.step) | 0;
    }

    /**
     * The publisher `F0x8001D504` (exe/fns.s:14612-14734): step the third
     * accumulator, publish `sra 8` of each of the three, and keep the delta
     * accumulator's low byte. Returns the delta it published.
     */
    publish(): number {
        this.auxAccumulator = (this.auxAccumulator + this.step) | 0;
        this.auxValue = this.auxAccumulator >> PUBLISH_SHIFT;
        this.tickValue = this.tickAccumulator >> PUBLISH_SHIFT;
        this.deltaValue = this.deltaAccumulator >> PUBLISH_SHIFT;
        this.deltaAccumulator &= REMAINDER_MASK;
        return this.deltaValue;
    }

    /**
     * One displayed frame: the feeder, then the publisher. This is the whole
     * rule — a browser frame that took one field's worth of time is one
     * vertical blank of the original, and the word it published is what every
     * screen reads.
     */
    advanceFrame(): number {
        this.feedVerticalBlank();
        return this.publish();
    }

    /**
     * One displayed frame the host has already measured, in the same sixtieths
     * the publisher works in. This is the seam `NativeStageRuntime.tick` already
     * opens for the native path (engine/native/runtime.ts:978-985 writes both
     * words), and a browser frame that took longer than one field is worth more
     * than one — the place card's hold test drives its screen at a delta of
     * seven this way. The remainder the publisher carries survives, so the next
     * `advanceFrame()` publishes the region's own step on top of it.
     */
    feedFrame(delta: number): void {
        const worth = (delta | 0) << PUBLISH_SHIFT;
        this.tickAccumulator = (this.tickAccumulator + worth) | 0;
        this.auxAccumulator = (this.auxAccumulator + worth) | 0;
        this.deltaAccumulator = (worth | (this.deltaAccumulator & REMAINDER_MASK)) >>> 0;
        this.tickValue = this.tickAccumulator >> PUBLISH_SHIFT;
        this.auxValue = this.auxAccumulator >> PUBLISH_SHIFT;
        this.deltaValue = delta | 0;
    }

    /** `[0x8004DF9C]()` — this displayed frame's delta. */
    frameDelta(): number {
        return this.deltaValue;
    }

    /** `[0x8004DF98]()` — the free-running tick. */
    tick(): number {
        return this.tickValue;
    }

    /** `[0x8004DE18]` (`F0x8001D6E4`), the third published word. */
    aux(): number {
        return this.auxValue;
    }

    /** The three accumulators, for a check against the original's RAM. */
    accumulators(): { tick: number; delta: number; aux: number } {
        return {
            tick: this.tickAccumulator,
            delta: this.deltaAccumulator,
            aux: this.auxAccumulator,
        };
    }

    /** The region step, so a caller can read which arm this clock is on. */
    regionStep(): number {
        return this.step;
    }

    setRegionStep(step: number): void {
        this.step = step;
    }

    /** Back to the state the display table is in before the first blank. */
    reset(): void {
        this.tickAccumulator = 0;
        this.deltaAccumulator = 0;
        this.auxAccumulator = 0;
        this.tickValue = 0;
        this.deltaValue = 0;
        this.auxValue = 0;
    }
}

/**
 * The one clock. Every screen's host method `frameDelta` is this function, so a
 * screen cannot answer with a delta of its own.
 */
export const frameClock = new FrameClock(STEP_PAL);

/** One displayed frame of the whole game. */
export function advanceFrameClock(): number {
    return frameClock.advanceFrame();
}

/** One displayed frame the host measured at `delta` sixtieths. */
export function feedFrameClock(delta: number): void {
    frameClock.feedFrame(delta);
}

/** `[0x8004DF9C]()` — `F0x8001D704` returns `[0x8004DE28]`. */
export function frameDelta(): number {
    return frameClock.frameDelta();
}

/** `[0x8004DF98]()` — `F0x8001D6F4` returns `[0x8004DE20]`. */
export function frameTick(): number {
    return frameClock.tick();
}

/** Back to the pre-first-blank state. */
export function resetFrameClock(): void {
    frameClock.reset();
}