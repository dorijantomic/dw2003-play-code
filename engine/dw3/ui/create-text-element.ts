// The text widget constructor, translated from the resident EXE F0x8001AE38.
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/create-text-element-oracle.test.js runs the original through
// engine/native and compares the whole 0x174-byte object.
//
// DECODED: the accepted text-element-create researcher answer (U1-U3) and
// fns.norm.s F0x8001AE38 / F0x800143DC. Claims: resident-text-element-constructor
// (partially_verified), resident-fourth-argument-zero-wrapper,
// UI-TASKOBJ-STATEMACHINE-001, UI-DISPATCH-TABLE-CENSUS-001.
//
// Flow:
//   1. alloc(0x174, 2) -> zeroed object (the factory F0x80014504 -> F0x800143DC
//      allocates through allocZeroed and writes the base object table below).
//   2. 25 method slots at +0x110..+0x170.
//   3. fontKind clamped: ((kind-1)&0xFFFF) < 3 ? kind : 1.
//   4. +0x54 = (s16)target; +0xAC = 0x140; +0xB0 = x; +0xB2 = y; +0xAE = 0;
//      fontPtr = [0x8004DE00] + kind*0x18; +0x50 = fontPtr; +0xBF = 1;
//      +0xD8/+0xD4/+0xD0 = 0x1000; +0xBE = first byte of the font record.
//   5. return the object.
//
// The allocation is the host boundary; the object contains no run-specific
// pointer of its own, so the whole block is comparable byte for byte.

export interface CreateTextElementMemory {
    read8(addr: number): number;
    read32(addr: number): number;
    write8(addr: number, value: number): void;
    write16(addr: number, value: number): void;
    write32(addr: number, value: number): void;
}

export interface CreateTextElementHost {
    /** Allocate `size` zeroed bytes aligned as the original asks. */
    alloc(size: number, align: number): number;
}

/** Object size the constructor allocates. */
export const TEXT_ELEMENT_SIZE = 0x174;
/** The cell holding the font table base (0x8004DD74 in the shipped data). */
export const FONT_TABLE_CELL = 0x8004de00;
/** The class handler the factory installs at +0x48. */
export const TEXT_ELEMENT_HANDLER = 0x8001ac14;

/** The factory's base object table, +0x28..+0x4C. */
export const BASE_TABLE: ReadonlyArray<readonly [number, number]> = [
    [0x28, 0x80014274],
    [0x2c, 0x80014288],
    [0x30, 0x80014298],
    [0x34, 0x800142a4],
    [0x38, 0x800142ac],
    [0x3c, 0x800142c8],
    [0x40, 0x800142e0],
    [0x44, 0x800142f4],
    [0x48, TEXT_ELEMENT_HANDLER],
    [0x4c, 0x80014308],
];

/** The widget's 25 method slots, +0x110..+0x170 in install order. */
export const METHOD_TABLE: ReadonlyArray<readonly [number, number]> = [
    [0x110, 0x800194c4], // setWidgetString
    [0x114, 0x800194e8],
    [0x118, 0x800195b0], // widgetSetLineNumber
    [0x11c, 0x8001968c],
    [0x120, 0x800196e4],
    [0x124, 0x800197a4], // drawTextElement
    [0x128, 0x80019fb0],
    [0x12c, 0x8001a180],
    [0x130, 0x8001a1b8], // setTextScroll
    [0x134, 0x8001a1e8], // setTextWidgetOrigin
    [0x138, 0x8001a1f4],
    [0x13c, 0x8001a1fc],
    [0x140, 0x8001a204], // setVectorAndActiveFlag
    [0x144, 0x8001a23c], // setTextElementFlagC1
    [0x148, 0x8001a25c], // measureTextWidth
    [0x14c, 0x8001a2ac],
    [0x150, 0x8001a418],
    [0x154, 0x8001a420],
    [0x158, 0x8001a43c],
    [0x15c, 0x8001a448], // set_unk_0x58
    [0x160, 0x8001a450], // set_unk_0xbf
    [0x164, 0x8001a458],
    [0x168, 0x8001a460],
    [0x16c, 0x8001a46c],
    [0x170, 0x8001a478],
];

/** F0x8001AE38(target, fontKind, x, y): build and return a text widget. */
export function createTextElement(
    mem: CreateTextElementMemory,
    host: CreateTextElementHost,
    target: number,
    fontKind: number,
    x: number,
    y: number,
): number {
    const obj = host.alloc(TEXT_ELEMENT_SIZE, 2) >>> 0;
    for (const [off, value] of BASE_TABLE) mem.write32(obj + off, value >>> 0);
    for (const [off, value] of METHOD_TABLE) mem.write32(obj + off, value >>> 0);
    // Clamp the font kind exactly as the original: ((kind-1) & 0xFFFF) < 3.
    const kind = (((fontKind - 1) & 0xffff) >>> 0) < 3 ? fontKind | 0 : 1;
    mem.write32(obj + 0x54, (target << 16) >> 16);
    const fontPtr = (mem.read32(FONT_TABLE_CELL) >>> 0) + Math.imul(kind, 0x18);
    mem.write16(obj + 0xac, 0x140);
    mem.write16(obj + 0xb0, x & 0xffff);
    mem.write16(obj + 0xb2, y & 0xffff);
    mem.write16(obj + 0xae, 0);
    mem.write32(obj + 0x50, fontPtr >>> 0);
    mem.write8(obj + 0xbf, 1);
    mem.write32(obj + 0xd8, 0x1000);
    mem.write32(obj + 0xd4, 0x1000);
    mem.write32(obj + 0xd0, 0x1000);
    mem.write8(obj + 0xbe, mem.read8(fontPtr >>> 0) & 0xff);
    return obj;
}
