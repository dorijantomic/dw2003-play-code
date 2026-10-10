// The duel's inter-phase banner, translated from pro/cardgame:
//   F0x800A1AF8 queueInterPhaseBanner — arm the next inter-phase banner
//   F0x800894E4 showPhaseBanner       — raise the banner widget for a record
//   F0x80089580 tickPhaseBanner       — the banner's per-frame step machine
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/phase-banner-oracle.test.js runs each original through
// engine/native on the shipped pro_cardgame.bin + resident.bin and compares the
// duel/view fields, the widget calls and the return values.
//
// Source (assembly, authority 2): exe-decomp/cardgame.norm.s
//   F0x800894e4 @.L0x00006834, F0x80089580 @.L0x000068d0,
//   F0x800a1af8 @.L0x0001ee48.
// Existing contract reused: `cardgame-opcodes-0x9f-0xa6-draw-a-banner-then-wait-
// for-confirm` (partially_verified) names the banner table 0x800A58C4, the step
// counter duel+0x422 and the confirm as pad port 0's logical 0x0D; its own
// "what I did not establish" left steps 3-4 unread, and the listing at
// 0x80089580 is what this port follows for them (step 3 waits for the widget to
// read 0 and moves to 4; step 4 reports finished).
//
// The two pad reads are data-pointer calls in the original
// ([0x8004BBC4] = F0x80018854 and [0x8004BBD8] = F0x80018980, both decoded and
// host-served): the controller block's u16 at port*0x1C0+0x48 and the u8 at
// port*0x1C0+0xa4+code. They are pure reads of the shipped record table, so the
// port reads them directly instead of through a callback. The block's base,
// strides and field names live in engine/systems/pad-block.ts.

import {
    PAD_BLOCK,
    PAD_BUTTON_MAP_IN_PORT,
    PAD_PORT_STRIDE,
    PAD_PRESSED_IN_PORT,
    padButtonBit,
    padPressed,
} from "../../systems/pad-block.ts";

/** The byte-only memory the queue writes (the pad readers need read16). */
export interface PhaseBannerQueueMemory {
    read8(addr: number): number;
    write8(addr: number, value: number): void;
}

export interface PhaseBannerMemory extends PhaseBannerQueueMemory {
    read16(addr: number): number;
    write32(addr: number, value: number): void;
}

export interface PhaseBannerHost {
    /** view+0xEE4(view, bannerId, 0, 0, 1): raise the banner widget. */
    showBannerWidget(view: number, bannerId: number): void;
    /** view+0xEAC(view, 5, 5, record, 0, 0x42): frame the widget. */
    setBannerFrame(view: number, record: number): void;
    /** view+0xEB0(view, 5): advance the widget. */
    advanceBanner(view: number, value: number): void;
    /** view+0xEE8(view): finish the widget. */
    finishBanner(view: number): void;
}

/** The duel's banner-step byte (u8). */
export const PHASE_BANNER_STEP = 0x422;
/** The armed flag the queue writes (u8). */
export const PHASE_BANNER_ARMED = 0x2f4;
/** The opcode the queue writes for the effect VM (u8). */
export const PHASE_BANNER_OPCODE = 0x421;
/** The pending banner index the queue reads (u8). */
export const PHASE_BANNER_PENDING = 0x2f6;
/** The mode the queue writes for the mode machine (u8). */
export const PHASE_BANNER_NEXT = 0x2f7;
/** The widget's own state byte on the view (u8). */
export const PHASE_BANNER_WIDGET_STATE = 0xe9b;
/** Two-byte banner records; byte 0 is the widget record, byte 1 the id. */
export const PHASE_BANNER_TABLE = 0x800a58c4;
/** Four-byte inter-phase records; [0] is the opcode, [2] the next mode. */
export const INTER_PHASE_TABLE = 0x800a5d5c;
/** The party record table the pad reads walk. */
export { PAD_BLOCK as PAD_RECORD_TABLE };
/** Party record stride. */
export { PAD_PORT_STRIDE as PAD_RECORD_STRIDE };
/** The word the pad bit test shifts (u16 at +0x48 of the port's record). */
export { PAD_PRESSED_IN_PORT as PAD_WORD_OFFSET };
/** The bit index table's base (+0xa4; a code adds to it). */
export { PAD_BUTTON_MAP_IN_PORT as PAD_SHIFT_BASE };
/** The confirm bit codes: logical cross and circle on pad port 0. */
export const PAD_CONFIRM_CODES = [0xd, 0xe] as const;

/** The port whose record the pad reads walk (the original passes 0). */
export const PAD_PORT = 0;

/** F0x80018854(port): the u16 at the port's record +0x48. */
export function padWord(mem: PhaseBannerMemory, port: number): number {
    return padPressed(mem, port);
}

/** F0x80018980(port, code): the u8 bit index for a logical button. */
export function padBitShift(mem: PhaseBannerMemory, port: number, code: number): number {
    return padButtonBit(mem, port, code);
}

/**
 * F0x800A1AF8(duel): arm the inter-phase banner the duel's pending index names.
 * Writes the armed byte, the effect opcode and the next mode (returned in v0);
 * the table's row 0
 * reads (0, 0), a legal no-op the routine never validates. The last store sits
 * in the original's `jr` delay slot but lands after both loads either way.
 */
export function queueInterPhaseBanner(mem: PhaseBannerQueueMemory, duel: number): number {
    mem.write8(duel + PHASE_BANNER_ARMED, 1);
    const record = (mem.read8(duel + PHASE_BANNER_PENDING) * 4 + INTER_PHASE_TABLE) >>> 0;
    mem.write8(duel + PHASE_BANNER_OPCODE, mem.read8(record) & 0xff);
    const next = mem.read8(record + 2) & 0xff;
    mem.write8(duel + PHASE_BANNER_NEXT, next);
    // the original's last load is what v0 holds at return
    return next;
}

/**
 * F0x800894E4(duel, view, index): raise the banner widget for the two-byte
 * record `index` and set the step byte to 1. The widget calls carry constant
 * trailing arguments (the fifth is 1 for the raise, and the frame call passes
 * (5, 5, record, 0, 0x42)); the record byte is loaded after the raise returns.
 */
export function showPhaseBanner(
    mem: PhaseBannerMemory,
    host: PhaseBannerHost,
    duel: number,
    view: number,
    index: number,
): void {
    const record = (((index | 0) * 2 + PHASE_BANNER_TABLE) | 0) >>> 0;
    host.showBannerWidget(view, mem.read8(record + 1) & 0xff);
    host.setBannerFrame(view, mem.read8(record) & 0xff);
    mem.write8(duel + PHASE_BANNER_STEP, 1);
}

/**
 * F0x80089580(duel, view): the banner's step machine.
 *   1 -> wait for the widget state to read 2, then step 2
 *   2 -> wait for pad port 0's confirm bits (logical 0xD or 0xE); on a press set
 *        step 3, advance the widget by 5 and finish it
 *   3 -> wait for the widget state to read 0, then step 4
 *   4 -> report finished (1)
 *   anything else does nothing and reports 0
 */
export function tickPhaseBanner(
    mem: PhaseBannerMemory,
    host: PhaseBannerHost,
    duel: number,
    view: number,
): number {
    const step = mem.read8(duel + PHASE_BANNER_STEP) & 0xff;
    if (step === 2) {
        let pressed = false;
        for (const code of PAD_CONFIRM_CODES) {
            const word = padWord(mem, PAD_PORT);
            const shift = padBitShift(mem, PAD_PORT, code);
            if (((word >> shift) & 1) !== 0) {
                pressed = true;
                break;
            }
        }
        if (pressed) {
            mem.write8(duel + PHASE_BANNER_STEP, 3);
            host.advanceBanner(view, 5);
            host.finishBanner(view);
        }
        return 0;
    }
    if (step < 3) {
        if (step !== 1) return 0;
        const widget = mem.read8(view + PHASE_BANNER_WIDGET_STATE) & 0xff;
        if (widget !== 2) return 0;
        mem.write8(duel + PHASE_BANNER_STEP, widget);
        return 0;
    }
    if (step === 3) {
        if ((mem.read8(view + PHASE_BANNER_WIDGET_STATE) & 0xff) !== 0) return 0;
        mem.write8(duel + PHASE_BANNER_STEP, 4);
        return 0;
    }
    if (step === 4) return 1;
    return 0;
}
