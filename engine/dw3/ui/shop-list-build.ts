// The item shop list builder, translated from pro/stitshop F0x80087428.
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/shop-list-build-oracle.test.js stubs createTextElement /
// spawnUiIcon on the original side and matches them with callbacks on the port
// side, then compares the slot array and every widget's +0x58 value.
//
// DECODED: exe-decomp/stitshop_c/F0x80087428.c and _asm/F0x80087428.s, agreeing
// line for line. It builds the 14 row widgets and the five fixed labels into
// the caller's slot array `slots`, then the cursor:
//
//   for i = 0 .. 0xD:
//     slots[i] = createTextElement(target, 1, (i&1)*0x83 + 0x37,
//                                  (i>>1)*0xE + 0x24)
//     slots[i]+0x15C = order-1           (set_unk_0x58, F0x8001A448)
//   rows   = mode*0x28
//   slots+0x38 = create(target, 1, 0x9B, rows+0x60)
//   slots+0x3C = create(target, 1, 0x9C, rows+0x60)
//   slots+0x40 = create(target, 1, 0xB0, rows+0x60)
//   slots+0x44 = create(target, 1, 0x2D, rows + mode*2 + 0x5C)
//   slots+0x48 = create(target, 1, 0x102, rows + mode*2 + 0x5C)
//   slots+0x4C = spawnUiIcon(target, order-1, 0x1D, 0x24)
//   cursor+0x80(cursor, 0)
//
// target = obj+0x54, order = obj+0x58, mode = obj+0x5C.
// createTextElement (F0x8001AE38) and spawnUiIcon (F0x8001B364) are host
// boundaries; the cursor activation and the widget +0x15C store run the
// already-translated set_unk_0x58.

import { set_unk_0x58_fns_8001a448 } from "./text-element-setters.ts";

export interface ShopListBuildMemory {
    read16(addr: number): number;
    read32(addr: number): number;
    write8(addr: number, value: number): void;
    write16(addr: number, value: number): void;
    write32(addr: number, value: number): void;
}

export interface ShopListBuildHost {
    /** F0x8001AE38(target, kind, x, y) -> widget pointer. */
    createTextElement(target: number, kind: number, x: number, y: number): number;
    /** F0x8001B364(target, order, x, y) -> cursor pointer. */
    spawnUiIcon(target: number, order: number, x: number, y: number): number;
    /** The cursor's +0x80(self, 0) activation. */
    cursorActivate(cursor: number): void;
}

/** Report-build order, 0x0E row widgets. */
export const SHOP_LIST_ROWS = 0x0e;
/** Slot-array offsets of the five fixed labels and the cursor. */
export const SHOP_LIST_SLOTS = {
    label: 0x38,
    count: 0x3c,
    total: 0x40,
    prev: 0x44,
    next: 0x48,
    cursor: 0x4c,
} as const;

/** F0x80087428(obj, slots): build the shop list's widgets and cursor. */
export function shopListBuild(
    mem: ShopListBuildMemory,
    obj: number,
    slots: number,
    host: ShopListBuildHost,
): void {
    const mode = mem.read32(obj + 0x5c) | 0;
    const order = mem.read32(obj + 0x58) | 0;
    const target = mem.read32(obj + 0x54) | 0;
    const rows = Math.imul(mode, 0x28);

    for (let i = 0; i < SHOP_LIST_ROWS; i++) {
        const half = i >> 1;
        const x = (i - half * 2) * 0x83 + 0x37;
        const y = half * 0x0e + 0x24;
        const widget = host.createTextElement(target, 1, x, y) >>> 0;
        mem.write32(slots + Math.imul(i, 4), widget);
        set_unk_0x58_fns_8001a448(mem, widget, (order - 1) | 0);
    }

    const labelY = (rows + 0x60) | 0;
    mem.write32(slots + SHOP_LIST_SLOTS.label, host.createTextElement(target, 1, 0x9b, labelY) >>> 0);
    mem.write32(slots + SHOP_LIST_SLOTS.count, host.createTextElement(target, 1, 0x9c, labelY) >>> 0);
    mem.write32(slots + SHOP_LIST_SLOTS.total, host.createTextElement(target, 1, 0xb0, labelY) >>> 0);
    const arrowY = (rows + (Math.imul(mode, 2) + 0x5c)) | 0;
    mem.write32(slots + SHOP_LIST_SLOTS.prev, host.createTextElement(target, 1, 0x2d, arrowY) >>> 0);
    mem.write32(slots + SHOP_LIST_SLOTS.next, host.createTextElement(target, 1, 0x102, arrowY) >>> 0);

    const cursor = host.spawnUiIcon(target, (order - 1) | 0, 0x1d, 0x24) >>> 0;
    mem.write32(slots + SHOP_LIST_SLOTS.cursor, cursor);
    host.cursorActivate(cursor);
}
