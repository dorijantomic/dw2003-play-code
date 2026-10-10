// The cursor / selection-pointer constructor, translated from the resident EXE
// F0x8001B364 (spawnUiIconWidget) and its six +0x80..+0x94 method bodies.
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/spawn-ui-icon-oracle.test.js runs the original constructor
// through engine/native and compares the whole 0x98-byte object to the port.
//
// DECODED: the accepted spawn-ui-icon answer (2026-09-14), verified against
// exe-decomp/c/F0x8001b364.c, _asm/F0x8001b364.s and the method bodies.
// Claims: UI-CURSORCLASS-B364-001 (partially_verified), UI-TASKOBJ-STATEMACHINE-001
// (base table +0x28..+0x4C and the +0x20/+0x24 secondary buffer),
// UI-DISPATCH-TABLE-CENSUS-001 (the six installed slots), resident-fourth-
// argument-zero-wrapper (F0x80014504 forwards a0-a2 and zeroes a3).
//
// Constructor, machine order:
//   1. obj = alloc(0x98) (zeroed), then extra = alloc(4) (zeroed);
//      obj+0x24 = extra, obj+0x20 = 0x04>>2 = 1  (factory F0x800143DC).
//   2. base table +0x28..+0x4C, +0x48 = the per-frame handler F0x8001B0A4.
//   3. +0x64 = 1; +0x74 = 0x20; +0x78 = 6; the six +0x80..+0x94 slots;
//      +0x50 = (s16)a0; +0x54 = a1 RAW WORD; +0x58 = (s16)a2; +0x5C = (s16)a3.
//
// a1 is stored untouched (the answer corrects UI-CURSORCLASS-B364-001's
// "four sign-extended s16 arguments"); a0/a2/a3 are sign-extended.
//
// The handler at +0x48 (F0x8001B0A4) is NOT translated here; it is an explicit
// boundary. Everything this constructor reaches is the allocator.

export interface UiIconMemory {
    read32(addr: number): number;
    write32(addr: number, value: number): void;
}

export interface UiIconHost {
    /** Allocate `size` zero-filled bytes, as allocZeroed does. */
    alloc(size: number): number;
}

/** Object size F0x8001B364 allocates. */
export const UI_ICON_SIZE = 0x98;
/** Secondary buffer size the factory allocates (stored at +0x24). */
export const UI_ICON_EXTRA_SIZE = 4;
/** The per-frame handler installed at +0x48 (still native). */
export const UI_ICON_HANDLER = 0x8001b0a4;

/** The factory's base object table, +0x28..+0x4C. */
export const UI_ICON_BASE_TABLE: ReadonlyArray<readonly [number, number]> = [
    [0x28, 0x80014274],
    [0x2c, 0x80014288],
    [0x30, 0x80014298],
    [0x34, 0x800142a4],
    [0x38, 0x800142ac],
    [0x3c, 0x800142c8],
    [0x40, 0x800142e0],
    [0x44, 0x800142f4],
    [0x48, UI_ICON_HANDLER],
    [0x4c, 0x80014308],
];

/** The class's six method slots, +0x80..+0x94 (in the original's install order). */
export const UI_ICON_METHOD_TABLE: ReadonlyArray<readonly [number, number]> = [
    [0x80, 0x8001b04c],
    [0x84, 0x8001b068],
    [0x8c, 0x8001b08c],
    [0x90, 0x8001b094],
    [0x88, 0x8001b07c],
    [0x94, 0x8001b09c],
];

/** Cursor object field offsets touched by this family. */
export const UI_ICON_FIELDS = {
    state: 0x10,
    secondaryCount: 0x20,
    secondaryPtr: 0x24,
    target: 0x50,
    order: 0x54,
    x: 0x58,
    y: 0x5c,
    unk60: 0x60,
    visible: 0x64,
    dirty: 0x68,
    lastFrame: 0x70,
    restTicks: 0x74,
    cycleTicks: 0x78,
    unk7c: 0x7c,
} as const;

/** F0x8001B364(target, order, x, y): build and return the cursor object. */
export function spawnUiIcon(
    mem: UiIconMemory,
    host: UiIconHost,
    target: number,
    order: number,
    x: number,
    y: number,
): number {
    const obj = host.alloc(UI_ICON_SIZE) >>> 0;
    const extra = host.alloc(UI_ICON_EXTRA_SIZE) >>> 0;
    mem.write32(obj + UI_ICON_FIELDS.secondaryPtr, extra);
    mem.write32(obj + UI_ICON_FIELDS.secondaryCount, UI_ICON_EXTRA_SIZE >> 2);
    for (const [off, value] of UI_ICON_BASE_TABLE) mem.write32(obj + off, value >>> 0);
    mem.write32(obj + UI_ICON_FIELDS.visible, 1);
    mem.write32(obj + UI_ICON_FIELDS.restTicks, 0x20);
    mem.write32(obj + UI_ICON_FIELDS.cycleTicks, 6);
    mem.write32(obj + 0x80, 0x8001b04c);
    mem.write32(obj + 0x84, 0x8001b068);
    mem.write32(obj + 0x8c, 0x8001b08c);
    mem.write32(obj + 0x90, 0x8001b094);
    mem.write32(obj + 0x88, 0x8001b07c);
    mem.write32(obj + UI_ICON_FIELDS.target, (target << 16) >> 16);
    mem.write32(obj + UI_ICON_FIELDS.order, order | 0);
    mem.write32(obj + UI_ICON_FIELDS.x, (x << 16) >> 16);
    mem.write32(obj + UI_ICON_FIELDS.y, (y << 16) >> 16);
    mem.write32(obj + 0x94, 0x8001b09c);
    return obj;
}

/** F0x8001B04C(self, v): slot +0x80. The visible byte is +0x64. */
export function uiIconSetVisible(mem: UiIconMemory, self: number, v: number): void {
    mem.write32(self + UI_ICON_FIELDS.visible, v | 0);
    if ((v | 0) === 0) {
        mem.write32(self + UI_ICON_FIELDS.state, 0);
        mem.write32(self + UI_ICON_FIELDS.lastFrame, 0);
    }
    mem.write32(self + UI_ICON_FIELDS.dirty, 1);
}

/** F0x8001B068(self, x, y): slot +0x84 (the move pair setter). */
export function uiIconSetPos(mem: UiIconMemory, self: number, x: number, y: number): void {
    mem.write32(self + UI_ICON_FIELDS.x, x | 0);
    mem.write32(self + UI_ICON_FIELDS.y, y | 0);
    mem.write32(self + UI_ICON_FIELDS.dirty, 1);
}

/** F0x8001B07C(self, v): slot +0x88. */
export function uiIconSetUnk60(mem: UiIconMemory, self: number, v: number): void {
    mem.write32(self + UI_ICON_FIELDS.unk60, v | 0);
    mem.write32(self + UI_ICON_FIELDS.dirty, 1);
}

/** F0x8001B08C(self, v): slot +0x8C. */
export function uiIconSetRestTicks(mem: UiIconMemory, self: number, v: number): void {
    mem.write32(self + UI_ICON_FIELDS.restTicks, v | 0);
}

/** F0x8001B094(self, v): slot +0x90. */
export function uiIconSetCycleTicks(mem: UiIconMemory, self: number, v: number): void {
    mem.write32(self + UI_ICON_FIELDS.cycleTicks, v | 0);
}

/** F0x8001B09C(self, v): slot +0x94. */
export function uiIconSetUnk7c(mem: UiIconMemory, self: number, v: number): void {
    mem.write32(self + UI_ICON_FIELDS.unk7c, v | 0);
}
