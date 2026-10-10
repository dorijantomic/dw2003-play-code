// The DRI evolution lab's "Digivolve / Select Action" picker tick, translated
// bit-exactly from the original pro/stgdglab state machine F0x80088B5C.
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/lane-b/select-action-tick.test.js runs the original through
// engine/native and compares the ordered calls and object fields.
//
// The function is dispatched on obj+0x10 through the 32-entry table at
// 0x80082DDC. Its jump-table case bodies (0x80088BB4/BD8/D44/E4C/9210/9A50/9AA8)
// are states, not separate functions. It builds the picker's widget lists
// (F0x8001AE38 / F0x8001B364), starts and polls the folds ([0x8008FD98] /
// [0x8008FD9C]), reads the pad ([0x8004B7D0+0x3F4/0x3FC/0x408]), plays packed
// sounds ([0x80055C48]), resolves a party position through [0x8004B44C] and the
// species helper F0x8008EABC, and rebuilds the lists through F0x80088808. All of
// those are host boundaries; the port preserves the exact guard, write and call
// order. The state-machine's own selection/lifecycle counters live in the
// object; the widget pointers live in the arg1 struct.
//
// This is lane B (engine/dw3/ui/native/**); lane A owns the shared
// engine/dw3/ui/index.ts barrel and data/translated_functions.json.

import {
    PAD_BLOCK,
    PAD_CELL_BUTTON_MAP,
    PAD_CELL_PRESSED,
    PAD_CELL_REPEAT,
} from "../../../systems/pad-block.ts";

export const SELECT_TICK = 0x80088b5c;
/** State dispatch table (32 entries) at 0x80082DDC. */
export const SELECT_ACTION_STATE_TABLE = 0x80082ddc;
/** Fold pointer cells: start at +0x30 / status at +0x34 of 0x8008FD68. */
export const SELECT_FOLD_START_CELL = 0x8008fd98;
export const SELECT_FOLD_STATUS_CELL = 0x8008fd9c;
/** Pad service cells. */
export { PAD_BLOCK as SELECT_PAD_BASE };
export {
    PAD_CELL_PRESSED as SELECT_PAD_READ_SLOT,
    PAD_CELL_REPEAT as SELECT_PAD_HELD_SLOT,
    PAD_CELL_BUTTON_MAP as SELECT_PAD_SHIFT_SLOT,
};
/** Packed-sound entry point. */
export const SELECT_SOUND_CELL = 0x80055c48;
/** Party-position -> roster-slot service (distinct from [0x80048D34+0x2728]). */
export const SELECT_PARTY_SLOT_CELL = 0x8004b44c;
/** Record helper and the slot global it is asked about. */
export const SELECT_RECORD_HELPER_CELL = 0x80044f4c;
export const SELECT_SLOT_GLOBAL = 0x8005cca8;
/** Widget factories. */
export const SELECT_WIDGET_FACTORY = 0x8001ae38;
export const SELECT_WIDGET_FACTORY2 = 0x8001b364;
/** List rebuild. */
export const SELECT_BUILD_LISTS = 0x80088808;
/** Species helper. */
export const SELECT_SPECIES_HELPER = 0x8008eabc;
/** Free-running counter used by the state-3/15 gates. */
export const SELECT_FRAME_START_CELL = 0x8004df98;

export interface SelectTickMemory {
    read32(addr: number): number;
    write32(addr: number, value: number): void;
}

export interface SelectTickHost {
    /** [0x8008FD98]: start (flag 1) or clear (flag 0) a fold at `target`. */
    foldStart(target: number, value: number): void;
    /** [0x8008FD9C]: nonzero while the fold at `target` is running. */
    foldStatus(target: number): number;
    /** [0x8004B7D0+0x3F4](port): the pad word. */
    padRead(port: number): number;
    /** [0x8004B7D0+0x3FC](port): the second pad word. */
    padHeld(port: number): number;
    /** [0x8004B7D0+0x408](port, button): the bit index for a logical button. */
    padShift(port: number, button: number): number;
    /** [0x80055C48](id): play a packed sound. */
    playSound(id: number): void;
    /** [0x8004B44C](position): party position -> roster slot. */
    partySlot(position: number): number;
    /** F0x8008EABC(slot, 1, 1). */
    speciesHelper(slot: number, a: number, b: number): number;
    /** F0x8001AE38(scale, kind, x, y): a widget. */
    widgetFactory(scale: number, kind: number, x: number, y: number): number;
    /** F0x8001B364(scale, kind, x, y): a second widget. */
    widgetFactory2(scale: number, kind: number, x: number, y: number): number;
    /** [0x80044F4C](arg): the shared record helper. */
    recordHelper(arg: number): number;
    /** F0x80088808(obj, arg1): rebuild the widget lists. */
    buildLists(obj: number, arg1: number): void;
    /** An object method through its own pointer slot. */
    callMethod(target: number, slot: number, args: number[]): void;
}

/** arg1 struct fields (widget pointers). */
export const SELECT_ARG1 = {
    a: 0x00,
    b: 0x04,
    c: 0x08,
    d: 0x10,
    e: 0x14,
    f: 0x28,
    g: 0x3c,
    h: 0x40,
    i: 0x44,
    j: 0x48,
} as const;

const u32 = (v: number): number => v >>> 0;
const s32 = (v: number): number => v | 0;
const s16 = (v: number): number => (v << 16) >> 16;

function recordHelperArg(mem: SelectTickMemory): number {
    return u32(mem.read32(SELECT_SLOT_GLOBAL) + 0x39);
}

function padPressed(
    host: SelectTickHost,
    button: number,
): boolean {
    const a = u32(host.padRead(0));
    const shiftA = s32(host.padShift(0, button));
    if (s32(a >> shiftA) & 1) return true;
    const b = u32(host.padHeld(0));
    const shiftB = s32(host.padShift(0, button));
    return (s32(b >> shiftB) & 1) !== 0;
}

/** The confirm/cancel/select checks read only the first pad word. */
function padDown(host: SelectTickHost, button: number): boolean {
    const v = u32(host.padRead(0));
    const shift = s32(host.padShift(0, button));
    return (s32(v >> shift) & 1) !== 0;
}

/**
 * F0x80088B5C(obj, arg1): the Select Action / Digivolve picker tick.
 */
export function selectActionTick(
    mem: SelectTickMemory,
    obj: number,
    arg1: number,
    host: SelectTickHost,
): void {
    const r = (off: number): number => u32(mem.read32(obj + off));
    const s = (off: number): number => s32(mem.read32(obj + off));
    const ar = (off: number): number => u32(mem.read32(arg1 + off));
    const parent = u32(mem.read32(obj + 0x50));
    const pr = (off: number): number => u32(mem.read32(parent + off));
    const advState = (): void => {
        mem.write32(obj + 0x10, u32(s32(mem.read32(obj + 0x10)) + 1));
    };

    switch (s(0x10)) {
        case 1: {
            let count = 0;
            if (s32(host.foldStatus((obj + 0x64) >>> 0)) !== 0) {
                if (ar(SELECT_ARG1.a) === 0) {
                    const w = host.widgetFactory(s16(r(0x58)), 1, 0xae, 0x15);
                    mem.write32(arg1 + SELECT_ARG1.a, w);
                    host.callMethod(w, 0x15c, [s32(r(0x5c)) - 1]);
                }
                const w = ar(SELECT_ARG1.a);
                count = 1;
                host.callMethod(w, 0x134, [0xae, 0x15]);
                host.callMethod(w, 0x114, [host.recordHelper(recordHelperArg(mem)), 1]);
            }
            if (s32(host.foldStatus((obj + 0x84) >>> 0)) !== 0) {
                if (ar(SELECT_ARG1.d) === 0) {
                    const w = host.widgetFactory(s16(r(0x58)), 1, 0xd3, 0xcc);
                    mem.write32(arg1 + SELECT_ARG1.d, w);
                    host.callMethod(w, 0x15c, [s32(r(0x5c)) - 1]);
                }
                const w = ar(SELECT_ARG1.d);
                count += 1;
                host.callMethod(w, 0x134, [0xd3, 0xcc]);
                host.callMethod(w, 0x114, [host.recordHelper(recordHelperArg(mem)), 5]);
            }
            if (count === 2) {
                host.foldStart((obj + 0x74) >>> 0, 1);
                advState();
            }
            return;
        }
        case 2: {
            if (s32(host.foldStatus((obj + 0x74) >>> 0)) !== 0) {
                let i = 0;
                let y = 0x310000;
                let p = arg1;
                do {
                    if (s32(mem.read32(p + SELECT_ARG1.b)) === 0) {
                        const w = host.widgetFactory(s16(r(0x58)), 1, 0xa7, s32(y >> 16));
                        mem.write32(p + SELECT_ARG1.b, w);
                        host.callMethod(w, 0x15c, [s32(r(0x5c)) - 1]);
                    }
                    const w = u32(mem.read32(p + SELECT_ARG1.b));
                    const index = i + 2;
                    p += 4;
                    i += 1;
                    host.callMethod(w, 0x114, [host.recordHelper(recordHelperArg(mem)), index]);
                    y += 0xe0000;
                } while (i < 3);
                if (ar(SELECT_ARG1.i) === 0) {
                    mem.write32(
                        arg1 + SELECT_ARG1.i,
                        host.widgetFactory2(
                            s16(r(0x58)),
                            1,
                            0x9a,
                            s16(s32(r(0x60)) * 0xe + 0x31),
                        ),
                    );
                }
                const w = ar(SELECT_ARG1.i);
                host.callMethod(w, 0x80, [1]);
                advState();
            }
            return;
        }
        case 3: {
            const before = s(0x60);
            if (padPressed(host, 4)) {
                const next = s(0x60) - 1;
                mem.write32(obj + 0x60, u32(next < 0 ? 0 : next));
            } else if (padPressed(host, 6)) {
                const next = s(0x60) + 1;
                mem.write32(obj + 0x60, u32(next >= 3 ? 2 : next));
            }
            if (before !== s(0x60)) {
                host.playSound(0x8004513e);
                host.callMethod(ar(SELECT_ARG1.i), 0x84, [0x9a, u32(s(0x60) * 0xe + 0x31)]);
            }
            if (padDown(host, 0xd)) {
                host.playSound(0x8004503c);
                mem.write32(obj + 0x14, 0);
                advState();
                return;
            }
            if (padDown(host, 0xe)) {
                host.playSound(0x800450bd);
                mem.write32(obj + 0x14, 1);
                advState();
                host.callMethod(parent, 0x78, []);
                return;
            }
            return;
        }
        case 4: {
            const n = s32(r(0x20)) - 2;
            let arr = r(0x24);
            for (let i = 0; i < n; i++) {
                const w = u32(mem.read32(arr));
                if (w !== 0) host.callMethod(w, 0x144, [0]);
                arr = u32(arr + 4);
            }
            host.callMethod(ar(SELECT_ARG1.i), 0x80, [0]);
            host.foldStart((obj + 0x64) >>> 0, 0);
            host.foldStart((obj + 0x74) >>> 0, 0);
            host.foldStart((obj + 0x84) >>> 0, 0);
            advState();
            return;
        }
        case 5: {
            let sum = 0;
            let off = 0x64;
            for (let i = 0; i < 3; i++) {
                sum += s32(host.foldStatus((obj + off) >>> 0));
                if (sum === 3) {
                    if (s(0x14) === 0) {
                        host.callMethod(obj, 0x2c, [0xa]);
                        host.foldStart((obj + 0x94) >>> 0, 1);
                        mem.write32(parent + 0x64, 0);
                        mem.write32(obj + 0x110, s32(r(0x60)) === 0 ? pr(0x5c) : pr(0x60));
                    } else {
                        host.callMethod(obj, 0x28, [3]);
                    }
                }
                off += 0x10;
            }
            return;
        }
        case 10: {
            host.foldStart((obj + 0xa4) >>> 0, 1);
            host.foldStart((obj + 0xb4) >>> 0, 1);
            host.foldStart((obj + 0xc4) >>> 0, 1);
            host.foldStart((obj + 0xd4) >>> 0, 1);
            if (s(0x60) === 0) host.foldStart((obj + 0xe4) >>> 0, 1);
            advState();
            return;
        }
        case 11: {
            host.foldStatus((obj + 0x94) >>> 0);
            if (s32(host.foldStatus((obj + 0xa4) >>> 0)) !== 0) {
                host.buildLists(obj, arg1);
                if (ar(SELECT_ARG1.d) === 0) {
                    const w = host.widgetFactory(s16(r(0x58)), 1, 0xa1, 0x17);
                    mem.write32(arg1 + SELECT_ARG1.d, w);
                    host.callMethod(w, 0x15c, [s32(r(0x5c)) - 1]);
                }
                const w = ar(SELECT_ARG1.d);
                host.callMethod(w, 0x134, [0xa1, 0x17]);
                host.callMethod(w, 0x114, [host.recordHelper(recordHelperArg(mem)), 6]);
                advState();
            }
            return;
        }
        case 12: {
            if (s(0x60) === 0 && s32(host.foldStatus((obj + 0xe4) >>> 0)) !== 0) {
                if (ar(SELECT_ARG1.h) === 0) {
                    const w = host.widgetFactory(s16(r(0x58)), 1, 0x0f, 0x55);
                    mem.write32(arg1 + SELECT_ARG1.h, w);
                    host.callMethod(w, 0x15c, [s32(r(0x5c)) - 1]);
                }
                const w = ar(SELECT_ARG1.h);
                host.callMethod(w, 0x114, [host.recordHelper(recordHelperArg(mem)), 0x14]);
            }
            host.foldStatus((obj + 0xb4) >>> 0);
            if (s32(host.foldStatus((obj + 0xc4) >>> 0)) !== 0) {
                if (ar(SELECT_ARG1.a) === 0) {
                    mem.write32(arg1 + SELECT_ARG1.a, host.widgetFactory(s16(r(0x58)), 1, 0xae, 0x49));
                }
                const w = ar(SELECT_ARG1.a);
                host.callMethod(w, 0x134, [0xae, 0x49]);
                host.callMethod(w, 0x114, [
                    host.recordHelper(recordHelperArg(mem)),
                    u32(s(0x60) + 0x18),
                ]);
                advState();
            }
            return;
        }
        case 14: {
            if (s32(host.foldStatus((obj + 0xd4) >>> 0)) !== 0) advState();
            return;
        }
        case 15: {
            const before = s32(pr(0x64));
            if (padPressed(host, 7)) {
                const next = s32(pr(0x64)) - 1;
                mem.write32(parent + 0x64, u32(next < 0 ? s(0x110) - 1 : next));
            } else if (padPressed(host, 5)) {
                const next = s32(pr(0x64)) + 1;
                mem.write32(parent + 0x64, u32(s(0x110) - 1 < next ? 0 : next));
            }
            if (before !== s32(pr(0x64))) {
                host.playSound(0x4001b);
                host.buildLists(obj, arg1);
                return;
            }
            if (padDown(host, 0xd)) {
                host.playSound(0x4001c);
                mem.write32(obj + 0x14, 1);
                advState();
                return;
            }
            if (padDown(host, 0xe)) {
                host.playSound(0x800450bd);
                mem.write32(obj + 0x14, 0);
                advState();
                return;
            }
            if (padDown(host, 0xc) && s(0x60) === 0 && s32(host.partySlot(s32(pr(0x64)))) >= 0) {
                mem.write32(obj + 0x14, 2);
                advState();
                host.playSound(0x4001c);
            }
            return;
        }
        case 16: {
            host.foldStart((obj + 0xd4) >>> 0, 0);
            advState();
            return;
        }
        case 17: {
            if (s32(host.foldStatus((obj + 0xd4) >>> 0)) !== 0) {
                if (s(0x14) === 0) {
                    host.foldStart((obj + 0x94) >>> 0, 0);
                    for (let i = 0; i < 5; i++) {
                        const w1 = u32(mem.read32(arg1 + i * 4 + SELECT_ARG1.e));
                        if (w1 !== 0) host.callMethod(w1, 0x144, [0]);
                        const w2 = u32(mem.read32(arg1 + i * 4 + SELECT_ARG1.f));
                        if (w2 !== 0) host.callMethod(w2, 0x144, [0]);
                    }
                    const g = ar(SELECT_ARG1.g);
                    if (g !== 0) host.callMethod(g, 0x144, [0]);
                }
                host.foldStart((obj + 0xa4) >>> 0, 0);
                host.foldStart((obj + 0xb4) >>> 0, 0);
                host.foldStart((obj + 0xc4) >>> 0, 0);
                if (s(0x60) === 0) host.foldStart((obj + 0xe4) >>> 0, 0);
                const a = ar(SELECT_ARG1.a);
                if (a !== 0) host.callMethod(a, 0x144, [0]);
                const d = ar(SELECT_ARG1.d);
                if (d !== 0) host.callMethod(d, 0x144, [0]);
                const h = ar(SELECT_ARG1.h);
                if (h !== 0) host.callMethod(h, 0x144, [0]);
                advState();
            }
            return;
        }
        case 18: {
            let sum = 0;
            const startIndex = s32(r(0x14)) > 0 ? 1 : 0;
            for (let i = startIndex; i < 6; i++) {
                sum += s32(host.foldStatus((obj + 0x94 + i * 0x10) >>> 0));
            }
            const kind = s(0x14);
            if (kind === 1) {
                if (sum === 5) {
                    host.callMethod(obj, 0x3c, []);
                    mem.write32(obj + 0x54, u32(kind));
                }
            } else if (kind === 2) {
                if (sum === 5) host.callMethod(obj, 0x2c, [0x1e]);
            } else if (sum === 6) {
                host.callMethod(obj, 0x2c, [0]);
            }
            return;
        }
        case 19: {
            if (s32(r(0x54)) === 0) {
                host.callMethod(obj, 0x2c, [0xa]);
                if (s32(r(0x9c)) === 0) host.foldStart((obj + 0x94) >>> 0, 1);
            }
            return;
        }
        case 30: {
            if (ar(SELECT_ARG1.j) === 0) {
                mem.write32(
                    arg1 + SELECT_ARG1.j,
                    host.speciesHelper(s32(host.partySlot(s32(pr(0x64)))), 1, 1),
                );
            }
            advState();
            return;
        }
        case 31: {
            if (ar(SELECT_ARG1.j) === 0) host.callMethod(obj, 0x2c, [0xa]);
            return;
        }
        default: {
            host.foldStart((obj + 0x64) >>> 0, 1);
            host.foldStart((obj + 0x84) >>> 0, 1);
            advState();
            return;
        }
    }
}
