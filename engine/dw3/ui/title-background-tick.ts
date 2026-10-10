// The title screen's circuit-board background tick, translated from
// pro/stdwtitl F0x80086544.
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/title-background-tick-oracle.test.js runs the original through
// engine/native with the resident random source and the draw context stubbed,
// and compares the ordered calls, the draw intents and every touched field.
//
// DECODED: authority-2 `_asm/F0x80086544.s` and the accepted
// title-background-tick contract. A three-state machine on +0x0C:
//   1        draw the board only
//   0 or <0  advance0 and draw nothing
//   2        on the first tick (+0x10 == 0) seed the eight twinkle steppers and
//            setState1(1); every tick then runs the twinkle draw (F0x80086228,
//            already ported as titleTwinkleSetupDraw) and the board draw
//            (F0x80086108, titleBackgroundDraw)
//   3        nothing at all (no advance0)
//   >= 4     advance0 and draw nothing
// The eight steppers live as {s16 index, u16 timer} pairs at +0x54/+0x58/...
// +0x70 and are seeded from the eight script tables' first duration word; the
// last two timers add randU16()%300 and %240, and the two random twinkle
// positions index short tables at 0x80088214 (mod 3) and 0x80088220 (mod 5).

import { titleBackgroundDraw, titleTwinkleSetupDraw } from "./title-draw.ts";
import type { TitleDrawHost, TitleDrawMemory } from "./title-draw.ts";

export interface TitleBackgroundMemory extends TitleDrawMemory {
    write32(addr: number, value: number): void;
}

export interface TitleBackgroundHost extends TitleDrawHost {
    /** obj+0x38 (F0x800142AC): advance state0. */
    advance0(obj: number): void;
    /** obj+0x2C (F0x80014288): set state1. */
    setState1(obj: number, state: number): void;
    /** (*0x8004DC0C)() = F0x8001933C: the resident 16-bit random source. */
    randU16(): number;
}

export const TITLE_BG = {
    state0: 0x0c,
    state1: 0x10,
    setState1: 0x2c,
    advance0: 0x38,
    twinkle: 0x54,
    random7: 0x74,
    random8: 0x78,
    layer: 0x7c,
} as const;

/** The eight stepper pairs' first-timer words, in stepper order. */
export const TITLE_BG_DURATIONS: ReadonlyArray<number> = [
    0x80087dde, 0x80087e22, 0x80087e76, 0x80087f2e, 0x80087ffa, 0x800880f6,
];
/** The two randomised first timers: base word and modulus. */
export const TITLE_BG_RANDOM_TIMER_7 = 0x8008816e;
export const TITLE_BG_RANDOM_TIMER_7_MOD = 300;
export const TITLE_BG_RANDOM_TIMER_8 = 0x800881be;
export const TITLE_BG_RANDOM_TIMER_8_MOD = 240;
/** The two random twinkle-position tables and their moduli. */
export const TITLE_BG_RANDOM_POS_7 = 0x80088214;
export const TITLE_BG_RANDOM_POS_7_MOD = 3;
export const TITLE_BG_RANDOM_POS_8 = 0x80088220;
export const TITLE_BG_RANDOM_POS_8_MOD = 5;

const u16 = (v: number): number => v & 0xffff;

/** F0x80086544(obj): one circuit-board background frame. */
export function titleBackgroundTick(
    mem: TitleBackgroundMemory, obj: number, host: TitleBackgroundHost,
): void {
    const state = mem.read32(obj + TITLE_BG.state0) | 0;
    if (state === 1) {
        titleBackgroundDraw(mem, obj, host);
        return;
    }
    if (state < 2) {
        host.advance0(obj);
        return;
    }
    if (state === 2) {
        if ((mem.read32(obj + TITLE_BG.state1) | 0) === 0) titleBackgroundSeed(mem, obj, host);
        titleTwinkleSetupDraw(mem, obj, host);
        titleBackgroundDraw(mem, obj, host);
        return;
    }
    if (state === 3) return;
    host.advance0(obj);
}

/** The first state-2 tick: seed the eight steppers and start state1. */
function titleBackgroundSeed(
    mem: TitleBackgroundMemory, obj: number, host: TitleBackgroundHost,
): void {
    for (let i = 0; i < TITLE_BG_DURATIONS.length; i++) {
        mem.write16(obj + TITLE_BG.twinkle + i * 4, 0);
        mem.write16(obj + TITLE_BG.twinkle + i * 4 + 2,
            u16(mem.read16s(TITLE_BG_DURATIONS[i] as number)));
    }
    mem.write16(obj + TITLE_BG.twinkle + 6 * 4, 0);
    mem.write16(obj + TITLE_BG.twinkle + 6 * 4 + 2,
        u16(mem.read16s(TITLE_BG_RANDOM_TIMER_7) + host.randU16() % TITLE_BG_RANDOM_TIMER_7_MOD));
    mem.write16(obj + TITLE_BG.twinkle + 7 * 4, 0);
    mem.write16(obj + TITLE_BG.twinkle + 7 * 4 + 2,
        u16(mem.read16s(TITLE_BG_RANDOM_TIMER_8) + host.randU16() % TITLE_BG_RANDOM_TIMER_8_MOD));

    const pos7 = (TITLE_BG_RANDOM_POS_7 + (host.randU16() % TITLE_BG_RANDOM_POS_7_MOD) * 4) >>> 0;
    mem.write16(obj + TITLE_BG.random7, mem.read16s(pos7));
    mem.write16(obj + TITLE_BG.random7 + 2, mem.read16s(pos7 + 2));
    const pos8 = (TITLE_BG_RANDOM_POS_8 + (host.randU16() % TITLE_BG_RANDOM_POS_8_MOD) * 4) >>> 0;
    mem.write16(obj + TITLE_BG.random8, mem.read16s(pos8));
    mem.write16(obj + TITLE_BG.random8 + 2, mem.read16s(pos8 + 2));

    host.setState1(obj, 1);
}
