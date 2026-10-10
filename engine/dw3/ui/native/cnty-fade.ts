// The language-select screen's fade-out object, translated bit-exactly from the
// original pro/cnty_sel overlay bodies.
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/lane-b/cnty-fade.test.js runs the original through engine/native
// and compares fields, the row draw's intents, the fade curve result fed to the
// F0x80083000 prim and the ordered base-method calls.
//
// F0x80083184 is the object's per-state handler. It reuses the row draw
// translated in cnty-draw.ts (F0x80082EF0), whose phase is +0x50:
//
//   state 1       phase = s16(phase+1) % 192; draw the row.
//   state 2       if +0x10 == 0 { +0x52 = 0; +0x10 = 1; }
//                 phase = s16(phase+1) % 192; draw the row;
//                 old = +0x52; +0x52 = old+1;
//                 emitPrim(F0x80082FC4(s16(old)));
//                 if s16(+0x52) >= 30: +0x28(obj, 3).
//   state 3       nothing.
//   state 0/<=0/>=4  +0x38(obj); +0x50 = 0.
//
// F0x80082FC4 (ported here as countrySelectFadeCurve) is the fade curve:
// value < 30 -> value * 255 / 30 (MIPS signed division), else 255.
//
// F0x80083000 (the display-list prim that consumes the curve) is a host
// boundary: it builds a GPU primitive through the resident display service and
// touches no object state. This module is lane B (engine/dw3/ui/native/**);
// lane A owns the shared engine/dw3/ui/index.ts barrel and the registry.

import { countrySelectDrawRow } from "./cnty-draw.ts";
import type { CntDrawHost } from "./cnty-draw.ts";

export interface CntFadeMemory {
    read16(addr: number): number;
    read32(addr: number): number;
    write16(addr: number, value: number): void;
    write32(addr: number, value: number): void;
}

export interface CntFadeHost extends CntDrawHost {
    /** F0x80083000(alpha): the resident fade primitive boundary. */
    emitFadePrim(alpha: number): void;
    /** obj->+0x28(obj, 3): the base method fired when the fade completes. */
    baseMethod28(obj: number, value: number): void;
    /** obj->+0x38(obj): the parked base method. */
    baseMethod38(obj: number): void;
}

export const CNT_FADE_STATE = 0x0c;
export const CNT_FADE_GATE = 0x10;
export const CNT_FADE_PHASE = 0x50;
export const CNT_FADE_PROGRESS = 0x52;

function s16(v: number): number {
    return (v << 16) >> 16;
}

/** MIPS signed `div` quotient (truncate toward zero). */
function divLo(a: number, b: number): number {
    if (b === 0) return a >= 0 ? -1 : 1;
    if (a === -0x80000000 && b === -1) return -0x80000000;
    return (a / b) | 0;
}

/** F0x80082FC4: the fade curve. value >= 30 saturates at 255. */
export function countrySelectFadeCurve(value: number): number {
    const v = value | 0;
    if (v < 0x1e) return divLo(Math.imul(v, 0xff), 30) | 0;
    return 0xff;
}

/** The shared phase advance: s16(phase+1) % 192, stored back to +0x50. */
function advancePhase(mem: CntFadeMemory, obj: number): void {
    const next = s16((mem.read16(obj + CNT_FADE_PHASE) + 1) & 0xffff);
    mem.write16(obj + CNT_FADE_PHASE, (next % 192) & 0xffff);
}

/** F0x80083184: the fade object's per-state handler. */
export function countrySelectFadeTick(mem: CntFadeMemory, obj: number, host: CntFadeHost): void {
    const state = mem.read32(obj + CNT_FADE_STATE) | 0;

    if (state === 1) {
        advancePhase(mem, obj);
        countrySelectDrawRow(mem, obj, host);
        return;
    }

    if (state === 2) {
        if ((mem.read32(obj + CNT_FADE_GATE) | 0) === 0) {
            mem.write16(obj + CNT_FADE_PROGRESS, 0);
            mem.write32(obj + CNT_FADE_GATE, 1);
        }
        advancePhase(mem, obj);
        countrySelectDrawRow(mem, obj, host);

        const old = mem.read16(obj + CNT_FADE_PROGRESS);
        mem.write16(obj + CNT_FADE_PROGRESS, (old + 1) & 0xffff);
        host.emitFadePrim(countrySelectFadeCurve(s16(old)));
        if (s16((old + 1) & 0xffff) >= 0x1e) host.baseMethod28(obj, 3);
        return;
    }

    // state 3 is a no-op; state 0 and state >= 4 park the object.
    if (state === 3) return;

    host.baseMethod38(obj);
    mem.write16(obj + CNT_FADE_PHASE, 0);
}
