// The BUY actor's widget builder, translated from pro/stitshop F0x8008360C.
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/shop-actor-build-oracle.test.js stubs createTextElement /
// spawnUiIcon on the original side and matches them with callbacks on the port.
//
// DECODED: exe-decomp/stitshop_c/F0x8008360c.c and the raw body at
// exe-decomp/stitshop.fns.s L0x95c-L0xa44. It builds six text widgets into the
// actor's context block and one cursor:
//
//   block+0x08 = createTextElement(target, 1, 0xB9, 0x3A)
//   block+0x0C = createTextElement(target, 1, 0x103, 0x54)
//   block+0x10 = createTextElement(target, 1, 0x11E, 0x54)
//   block+0x14 = createTextElement(target, 1, 0x9A, 0x2C)
//   block+0x18 = createTextElement(target, 1, 0xC5, 0x49)
//   block+0x1C = createTextElement(target, 1, 0xC5, 0x59)
//   cursor     = spawnUiIcon(target, obj+0x5C - 1, 0xB8, 0x49); block+0x20 = cursor
//   cursor+0x80(cursor, 0)
//
// target = (s16) obj+0x58; order = obj+0x5C. The widget ctor and the cursor ctor
// are host boundaries here; the cursor's +0x80 activation is a host callback.

export interface ShopActorBuildMemory {
    read16(addr: number): number;
    read32(addr: number): number;
    write32(addr: number, value: number): void;
}

export interface ShopActorBuildHost {
    /** F0x8001AE38(target, kind, x, y) -> widget pointer. */
    createTextElement(target: number, kind: number, x: number, y: number): number;
    /** F0x8001B364(target, order, x, y) -> cursor pointer. */
    spawnUiIcon(target: number, order: number, x: number, y: number): number;
    /** The cursor's +0x80(self, 0) activation. */
    cursorActivate(cursor: number): void;
}

/** Block slot, x and y of the six BUY widgets, in machine order. */
export const SHOP_ACTOR_BUILD_WIDGETS: ReadonlyArray<readonly [number, number, number]> = [
    [0x08, 0xb9, 0x3a],
    [0x0c, 0x103, 0x54],
    [0x10, 0x11e, 0x54],
    [0x14, 0x9a, 0x2c],
    [0x18, 0xc5, 0x49],
    [0x1c, 0xc5, 0x59],
];
/** Block slot and pen of the cursor. */
export const SHOP_ACTOR_BUILD_CURSOR = { slot: 0x20, x: 0xb8, y: 0x49 } as const;

/** F0x8008360C(obj, block): build the BUY actor's widgets and cursor. */
export function shopActorBuyBuild(
    mem: ShopActorBuildMemory,
    obj: number,
    block: number,
    host: ShopActorBuildHost,
): void {
    const target = (mem.read16(obj + 0x58) << 16) >> 16;
    for (const [slot, x, y] of SHOP_ACTOR_BUILD_WIDGETS) {
        mem.write32(block + slot, host.createTextElement(target, 1, x, y) >>> 0);
    }
    const cursor = host.spawnUiIcon(target, (mem.read32(obj + 0x5c) | 0) - 1, SHOP_ACTOR_BUILD_CURSOR.x, SHOP_ACTOR_BUILD_CURSOR.y) >>> 0;
    mem.write32(block + SHOP_ACTOR_BUILD_CURSOR.slot, cursor);
    host.cursorActivate(cursor);
}

/** Category rows and the seven other SELL labels, in constructor call order. */
export const SHOP_ACTOR_SELL_WIDGETS: ReadonlyArray<readonly [number, number, number]> = [
    [0x1c, 0xb9, 0x3a],
    [0x20, 0x103, 0x54],
    [0x24, 0x11e, 0x54],
    [0x28, 0x9a, 0x2c],
    [0x2c, 0xc5, 0x49],
    [0x30, 0xc5, 0x59],
    [0x34, 0x9a, 0x8a],
];

/** F0x800859C0: create the SELL categories, quantity and message widgets. */
export function shopActorSellBuild(
    mem: ShopActorBuildMemory,
    obj: number,
    block: number,
    host: ShopActorBuildHost,
): void {
    const target = (mem.read16(obj + 0x58) << 16) >> 16;
    const cursor = host.spawnUiIcon(target, (mem.read32(obj + 0x5c) | 0) - 1, 0, 0xb0) >>> 0;
    mem.write32(block + 0x08, cursor);
    host.cursorActivate(cursor);
    for (let i = 0; i < 4; i++) {
        mem.write32(block + 0x0c + i * 4,
            host.createTextElement(target, 1, 0xbe, 0x2f + i * 0x0e) >>> 0);
    }
    for (const [slot, x, y] of SHOP_ACTOR_SELL_WIDGETS) {
        mem.write32(block + slot, host.createTextElement(target, 1, x, y) >>> 0);
    }
}
