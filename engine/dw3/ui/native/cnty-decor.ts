// The language-select screen's breathing background decorations, translated
// bit-exactly from the original pro/cnty_sel overlay bodies.
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/lane-b/cnty-decor.test.js runs the original overlay addresses
// through engine/native (the interpreter) and compares every touched field, the
// return value and the ordered boundary calls against this port.
//
// The screen the player sees is "Country Select / Language Select": three
// decorative strips (left, right, bottom) gently pulse. Each strip is one
// object whose +0x0C state selects a branch:
//
//   state 1  animate: while the object's +0x10 gate equals 1, advance +0x52
//            and step through a two-entry keyframe table; when the current
//            keyframe's duration is passed, toggle the table index (+0x50) and
//            snap the animated size to that entry's end value. Then draw.
//   state 2  restart: reset +0x52, run the two +0x28 / +0x2C base methods with
//            argument 1, then draw.
//   state 3  idle: nothing.
//   state 0 or >= 4 (default): run +0x38, then park the strip at full size
//            (+0x54 = 0x1000 for left, +0x56 = 0x1000 for right/bottom).
//
// The keyframe table entry is 8 bytes (left/right) or 12 bytes (bottom):
//   +0x0  s32 duration
//   +0x4  s16 value at/after duration  (the "end" value)
//   +0x6  s16 value at progress 0      (the "start" value)
// and the eased value is start + (end - start) * progress / duration, with the
// MIPS signed `div` (truncate toward zero). That easing is the same body in all
// three strips; only the table base and the stride differ:
//
//   left   F0x800835CC  table 0x800843EC  stride 8   animates +0x56
//   right  F0x80083830  table 0x800843FC  stride 8   animates +0x54
//   bottom F0x80083A94  table 0x8008440C  stride 12  animates +0x54
//
// The per-state handlers are F0x800836DC (left), F0x80083940 (right) and
// F0x80083BC0 (bottom). Their draw callees F0x80083630 / F0x80083894 /
// F0x80083B00 and the +0x28 / +0x2C / +0x38 base methods are host boundaries:
// the port preserves the exact call order and the host serves the drawing.
//
// This module is lane B (engine/dw3/ui/native/**); lane A owns the shared
// engine/dw3/ui/index.ts barrel and data/translated_functions.json.

export interface DecorMemory {
    read16(addr: number): number;
    read32(addr: number): number;
    write16(addr: number, value: number): void;
}

export interface DecorHost {
    /** obj->+0x28(obj, 1): the shared base method pair on restart. */
    baseMethod28(obj: number, value: number): void;
    /** obj->+0x2C(obj, value): base method called with 0 on keyframe toggle, 1 on restart. */
    baseMethod2C(obj: number, value: number): void;
    /** obj->+0x38(obj): the parked base method. */
    baseMethod38(obj: number): void;
    /** The strip's draw callee (F0x80083630 / F0x80083894 / F0x80083B00). */
    draw(obj: number): void;
}

/** Object field offsets shared by all three strip objects (size 0x58). */
export const DECOR_STATE = 0x0c;
export const DECOR_GATE = 0x10;
export const DECOR_METHOD_28 = 0x28;
export const DECOR_METHOD_2C = 0x2c;
export const DECOR_METHOD_38 = 0x38;
export const DECOR_INDEX = 0x50;
export const DECOR_PROGRESS = 0x52;
export const DECOR_FIELD_54 = 0x54;
export const DECOR_FIELD_56 = 0x56;

/** 0x1000 is the strip's full size in 12.4 fixed point. */
export const DECOR_FULL = 0x1000;

// The three keyframe tables live inside the overlay image; the original reads
// them by absolute address. The port reads the same bytes through the memory
// interface so the caller supplies the loaded overlay.
export const DECOR_TABLE_LEFT = 0x800843ec;
export const DECOR_TABLE_RIGHT = 0x800843fc;
export const DECOR_TABLE_BOTTOM = 0x8008440c;

function s16(v: number): number {
    return (v << 16) >> 16;
}

/**
 * MIPS signed `div` quotient, as engine/native/mips.ts computes it: truncation
 * toward zero, plus the hardware's defined quotients for divide-by-zero and the
 * INT_MIN / -1 overflow case. Kept local so the port is independent of the
 * interpreter it is checked against.
 */
function divLo(a: number, b: number): number {
    if (b === 0) return a >= 0 ? -1 : 1;
    if (a === -0x80000000 && b === -1) return -0x80000000;
    return (a / b) | 0;
}

function interpolate(
    mem: DecorMemory,
    obj: number,
    index: number,
    tableBase: number,
    stride: number,
): number {
    const base = (tableBase + Math.imul(index | 0, stride)) >>> 0;
    const progress = s16(mem.read16(obj + DECOR_PROGRESS));
    const duration = mem.read32(base) | 0;
    const atEnd = s16(mem.read16(base + 4));
    const atZero = s16(mem.read16(base + 6));
    if (progress < duration) {
        const span = Math.imul(atEnd - atZero, progress) | 0;
        return (atZero + divLo(span, duration)) | 0;
    }
    return atEnd;
}

/** F0x800835CC: the left strip's easing (table 0x800843EC, stride 8). */
export function decorLeftProgress(mem: DecorMemory, obj: number, index: number): number {
    return interpolate(mem, obj, index, DECOR_TABLE_LEFT, 8);
}

/** F0x80083830: the right strip's easing (table 0x800843FC, stride 8). */
export function decorRightProgress(mem: DecorMemory, obj: number, index: number): number {
    return interpolate(mem, obj, index, DECOR_TABLE_RIGHT, 8);
}

/** F0x80083A94: the bottom strip's easing (table 0x8008440C, stride 12). */
export function decorBottomProgress(mem: DecorMemory, obj: number, index: number): number {
    return interpolate(mem, obj, index, DECOR_TABLE_BOTTOM, 12);
}

interface BreatheSpec {
    /** The animated size field: 0x56 for left, 0x54 for right/bottom. */
    readonly animated: number;
    /** The field parked at 0x1000 when the strip is idle: 0x54 left, 0x56 right/bottom. */
    readonly parked: number;
    readonly tableBase: number;
    readonly stride: number;
}

function breathe(
    mem: DecorMemory,
    obj: number,
    host: DecorHost,
    spec: BreatheSpec,
): void {
    const state = mem.read32(obj + DECOR_STATE) | 0;

    if (state === 1) {
        const gate = mem.read32(obj + DECOR_GATE) | 0;
        if (gate !== 0 && gate === state) {
            const progress = mem.read16(obj + DECOR_PROGRESS);
            const index = s16(mem.read16(obj + DECOR_INDEX));
            mem.write16(obj + DECOR_PROGRESS, (progress + 1) & 0xffff);
            const entry = (spec.tableBase + Math.imul(index | 0, spec.stride)) >>> 0;
            const duration = mem.read32(entry) | 0;
            if (duration < s16(progress)) {
                // Keyframe spent: flip to the other entry and snap to its end.
                mem.write16(obj + DECOR_INDEX, (mem.read16(obj + DECOR_INDEX) ^ 1) & 0xffff);
                host.baseMethod2C(obj, 0);
                mem.write16(obj + spec.animated, mem.read16(entry + 4));
            } else {
                mem.write16(
                    obj + spec.animated,
                    interpolate(mem, obj, index, spec.tableBase, spec.stride) & 0xffff,
                );
            }
        }
        host.draw(obj);
        return;
    }

    if (state === 2) {
        mem.write16(obj + DECOR_PROGRESS, 0);
        host.baseMethod28(obj, 1);
        host.baseMethod2C(obj, 1);
        host.draw(obj);
        return;
    }

    // state 3 is a no-op; state 0 and state >= 4 park the strip.
    if (state === 3) return;

    host.baseMethod38(obj);
    mem.write16(obj + spec.parked, DECOR_FULL);
    mem.write16(obj + spec.animated, 0);
    mem.write16(obj + DECOR_INDEX, 0);
}

const LEFT_SPEC: BreatheSpec = {
    animated: DECOR_FIELD_56,
    parked: DECOR_FIELD_54,
    tableBase: DECOR_TABLE_LEFT,
    stride: 8,
};
const RIGHT_SPEC: BreatheSpec = {
    animated: DECOR_FIELD_54,
    parked: DECOR_FIELD_56,
    tableBase: DECOR_TABLE_RIGHT,
    stride: 8,
};
const BOTTOM_SPEC: BreatheSpec = {
    animated: DECOR_FIELD_54,
    parked: DECOR_FIELD_56,
    tableBase: DECOR_TABLE_BOTTOM,
    stride: 12,
};

/** F0x800836DC: the left strip's per-state handler. */
export function decorLeftBreatheTick(mem: DecorMemory, obj: number, host: DecorHost): void {
    breathe(mem, obj, host, LEFT_SPEC);
}

/** F0x80083940: the right strip's per-state handler. */
export function decorRightBreatheTick(mem: DecorMemory, obj: number, host: DecorHost): void {
    breathe(mem, obj, host, RIGHT_SPEC);
}

/** F0x80083BC0: the bottom strip's per-state handler. */
export function decorBottomBreatheTick(mem: DecorMemory, obj: number, host: DecorHost): void {
    breathe(mem, obj, host, BOTTOM_SPEC);
}
