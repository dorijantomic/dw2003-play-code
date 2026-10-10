// The item shop list object's constructor, translated from pro/stitshop
// F0x800889A8.
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/shop-list-create-oracle.test.js runs the original through
// engine/native and compares the whole 0x704-byte object to the port.
//
// DECODED: exe-decomp/stitshop_c/F0x800889a8.c and the raw body at
// exe-decomp/stitshop.fns.s L0x5cf8-L0x5db0, which agree; accepted
// shop-stock-source answer UNIT 1. Claims: UI-TASKOBJ-STATEMACHINE-001
// (base table +0x28..+0x4C, +0x20/+0x24 secondary block),
// UI-DISPATCH-TABLE-CENSUS-001.
//
//   F0x800889A8(parent, shopArg, mode):
//     obj = alloc(0x704) zeroed, extra = alloc(0x50) zeroed
//     obj+0x24 = extra, obj+0x20 = 0x50>>2 = 0x14     (factory F0x800143DC)
//     base table +0x28..+0x4C, +0x48 = the tick F0x80087EC0
//     obj+0x6E8..+0x700 = the seven class slots
//     obj+0x54 = 0x1000; obj+0x58 = 4
//     obj+0x50 = parent; obj+0x5C = mode; obj+0x60 = shopArg
//
// All three arguments are stored RAW (the raw asm stores $a0/$a1/$a2 with sw,
// no sign extension). The tick F0x80087EC0 and the seven class slots are the
// still-native list behaviour; this constructor only builds the object.

export interface ShopListMemory {
    read32(addr: number): number;
    write32(addr: number, value: number): void;
}

export interface ShopListHost {
    /** Allocate `size` zero-filled bytes, as allocZeroed does. */
    alloc(size: number): number;
}

/** Object size F0x800889A8 allocates. */
export const SHOP_LIST_SIZE = 0x704;
/** Secondary buffer size the factory allocates (stored at +0x24). */
export const SHOP_LIST_EXTRA_SIZE = 0x50;
/** The list object's per-frame tick, installed at +0x48. */
export const SHOP_LIST_TICK = 0x80087ec0;

/** The factory's base object table, +0x28..+0x4C. */
export const SHOP_LIST_BASE_TABLE: ReadonlyArray<readonly [number, number]> = [
    [0x28, 0x80014274],
    [0x2c, 0x80014288],
    [0x30, 0x80014298],
    [0x34, 0x800142a4],
    [0x38, 0x800142ac],
    [0x3c, 0x800142c8],
    [0x40, 0x800142e0],
    [0x44, 0x800142f4],
    [0x48, SHOP_LIST_TICK],
    [0x4c, 0x80014308],
];

/** The seven class slots this constructor installs, in machine write order. */
export const SHOP_LIST_METHODS: ReadonlyArray<readonly [number, number]> = [
    [0x6e8, 0x800887c4],
    [0x6ec, 0x800887ec],
    [0x6f0, 0x80088830],
    [0x6f4, 0x80088714],
    [0x6f8, 0x80088670],
    [0x6fc, 0x80088878],
    [0x700, 0x800888e4],
];

/** F0x800889A8(parent, shopArg, mode): build and return the shop list object. */
export function shopListCreate(
    mem: ShopListMemory,
    host: ShopListHost,
    parent: number,
    shopArg: number,
    mode: number,
): number {
    const obj = host.alloc(SHOP_LIST_SIZE) >>> 0;
    const extra = host.alloc(SHOP_LIST_EXTRA_SIZE) >>> 0;
    mem.write32(obj + 0x24, extra);
    mem.write32(obj + 0x20, SHOP_LIST_EXTRA_SIZE >> 2);
    for (const [off, value] of SHOP_LIST_BASE_TABLE) mem.write32(obj + off, value >>> 0);
    for (const [off, value] of SHOP_LIST_METHODS) mem.write32(obj + off, value >>> 0);
    mem.write32(obj + 0x54, 0x1000);
    mem.write32(obj + 0x58, 4);
    mem.write32(obj + 0x50, parent | 0);
    mem.write32(obj + 0x5c, mode | 0);
    mem.write32(obj + 0x60, shopArg | 0);
    return obj;
}
