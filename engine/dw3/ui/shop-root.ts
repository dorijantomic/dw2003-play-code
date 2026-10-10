// The item shop's root scene object and two of its methods, translated from
// pro/stitshop F0x8008C118 (constructor), F0x8008B524 (labels/cursor builder)
// and F0x8008C0C4 (the BIT readout refresh at object +0xA8).
//
// Phase 6 translation (docs/plans/2026-09-21-native-screen-production-integration-plan.md).
// Oracle: tests/shop-root-oracle.test.js runs each original through
// engine/native and compares the built object, the labels block and the ordered
// callee stream.
//
// DECODED: exe-decomp/stitshop_c/{F0x8008c118,F0x8008b524,F0x8008c0c4}.c and
// their raw bodies. The real scene root is F0x8008C118 -- the manifest's
// 0x8008596C is the BUY tab sub-object (web/shop-native.js passes this root).
//
//   F0x8008C118():
//     obj = factory(0x8008BFB0, 0xAC, 0x24); obj+0xA8 = 0x8008C0C4
//     obj+0x50 = 0x1000; obj+0x60 = [0x8004B43C]()   (getCurrentShopId)
//
//   F0x8008B524(owner, labels): six text labels + one cursor icon into `labels`
//     (slot order 0x4, 0x0, 0x8, 0xC, 0x10, 0x14, cursor 0x18); the target is
//     the sign-extended halfword at owner+0x50; the cursor is then hidden
//     through its +0x80 slot. All callees are already translated and bridged.
//
//   F0x8008C0C4(owner): ctx = owner+0x24; widget = ctx+0x8;
//     widget->+0x118(widget, 0, [0x80048DA0]);  (widgetSetLineNumber, the BIT)
//     widget->+0x148(widget, 1);                (measureTextWidth, re-read)
//
// The bridge now reproduces the text widget's caller-stack scratch and measure
// pointer. Direct differential tests compare the labels and BIT refresh against
// the shipped bodies; the production shop route checks their visible result.

import { getCurrentShopId } from "../party-context.ts";

export interface ShopRootMemory {
    read16(addr: number): number;
    read32(addr: number): number;
    write32(addr: number, value: number): void;
}

export interface ShopRootHost {
    /** Allocate `size` zero-filled bytes, as the factory does. */
    alloc(size: number): number;
}

/** The root object's handler (installed at +0x48) and sizes. */
export const SHOP_ROOT_HANDLER = 0x8008bfb0;
export const SHOP_ROOT_SIZE = 0xac;
export const SHOP_ROOT_EXTRA = 0x24;
/** The BIT readout refresh installed at +0xA8. */
export const SHOP_ROOT_BIT_REFRESH = 0x8008c0c4;
/** The BIT value cell F0x8008C0C4 renders (0x80048D34 + 0x6C). */
export const SHOP_ROOT_BIT_CELL = 0x80048da0;

/** The factory's base object table, +0x28..+0x4C (the handler replaces +0x48). */
export function shopRootBaseTable(): ReadonlyArray<readonly [number, number]> {
    return [
        [0x28, 0x80014274],
        [0x2c, 0x80014288],
        [0x30, 0x80014298],
        [0x34, 0x800142a4],
        [0x38, 0x800142ac],
        [0x3c, 0x800142c8],
        [0x40, 0x800142e0],
        [0x44, 0x800142f4],
        [0x48, SHOP_ROOT_HANDLER],
        [0x4c, 0x80014308],
    ];
}

/** F0x8008C118(): build the item shop's root scene object. */
export function shopRootCreate(mem: ShopRootMemory, host: ShopRootHost): number {
    const obj = host.alloc(SHOP_ROOT_SIZE) >>> 0;
    const extra = host.alloc(SHOP_ROOT_EXTRA) >>> 0;
    mem.write32(obj + 0x24, extra);
    mem.write32(obj + 0x20, SHOP_ROOT_EXTRA >> 2);
    for (const [off, value] of shopRootBaseTable()) mem.write32(obj + off, value >>> 0);
    mem.write32(obj + 0xa8, SHOP_ROOT_BIT_REFRESH);
    mem.write32(obj + 0x50, 0x1000);
    mem.write32(obj + 0x60, getCurrentShopId(mem) | 0);
    return obj;
}

/** The six text labels F0x8008B524 builds, as [labels offset, font kind, x, y]. */
export const SHOP_ROOT_LABEL_CALLS: ReadonlyArray<readonly [number, number, number, number]> = [
    [0x4, 1, 0xd3, 0xcc],   // footer text
    [0x0, 1, 0x1d, 0x14],   // shop-name text
    [0x8, 3, 0x117, 0x17],  // BIT digits
    [0xc, 3, 0x11a, 0x17],  // "BIT"
    [0x10, 1, 0xbe, 0x2f],  // BUY row
    [0x14, 1, 0xbe, 0x3d],  // SELL row
];
/** The cursor icon's slot and position. */
export const SHOP_ROOT_CURSOR_SLOT = 0x18;
export const SHOP_ROOT_CURSOR = { order: 0, x: 0xb0, y: 0x2f } as const;
/** The target handle's halfword offset on the owner (read sign-extended). */
export const SHOP_ROOT_TARGET = 0x50;
/**
 * The BIT digits widget's pointer slot on the root's extra block: the refresh
 * dereferences ctx + 0x8 once to get the widget. The labels builder writes the
 * same kind-3 widget into its own labels block at +0x8; which writer fills the
 * extra block's slot is not established here.
 */
export const SHOP_ROOT_BIT_WIDGET = 0x8;

export interface ShopRootLabelsHost {
    /** F0x8001AE38(target, kind, x, y): resident text widget (bridged). */
    createTextElement(target: number, kind: number, x: number, y: number): number;
    /** F0x8001B364(target, order, x, y): resident cursor widget (bridged). */
    spawnUiIcon(target: number, order: number, x: number, y: number): number;
    /** Resident cursor slot +0x80 (F0x8001B04C): show/hide. */
    uiIconSetVisible(icon: number, visible: number): void;
}

/** F0x8008B524(owner, labels): build the six labels and the cursor icon. */
export function shopRootLabels(
    mem: ShopRootMemory,
    host: ShopRootLabelsHost,
    owner: number,
    labels: number,
): void {
    for (const [off, kind, x, y] of SHOP_ROOT_LABEL_CALLS) {
        const target = (mem.read16(owner + SHOP_ROOT_TARGET) << 16) >> 16;
        mem.write32(labels + off, host.createTextElement(target, kind, x, y) >>> 0);
    }
    const target = (mem.read16(owner + SHOP_ROOT_TARGET) << 16) >> 16;
    const icon = host.spawnUiIcon(target, SHOP_ROOT_CURSOR.order, SHOP_ROOT_CURSOR.x, SHOP_ROOT_CURSOR.y) >>> 0;
    mem.write32(labels + SHOP_ROOT_CURSOR_SLOT, icon);
    host.uiIconSetVisible(icon, 0);
}

export interface ShopRootBitHost {
    /** Widget slot +0x118 (F0x800195B0): write line 0 of the readout. */
    widgetSetLineNumber(widget: number, line: number, value: number): void;
    /** Widget slot +0x148 (F0x8001A25C): the justification toggle. */
    measureTextWidth(widget: number, enable: number): void;
}

/** F0x8008C0C4(owner): refresh the BIT readout from [0x80048DA0]. */
export function shopRootBitRefresh(
    mem: ShopRootMemory,
    host: ShopRootBitHost,
    owner: number,
): void {
    const ctx = mem.read32(owner + 0x24) >>> 0;
    const bit = mem.read32(SHOP_ROOT_BIT_CELL) | 0;
    host.widgetSetLineNumber(mem.read32(ctx + SHOP_ROOT_BIT_WIDGET) >>> 0, 0, bit);
    host.measureTextWidth(mem.read32(ctx + SHOP_ROOT_BIT_WIDGET) >>> 0, 1);
}
