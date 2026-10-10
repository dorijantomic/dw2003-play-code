// The item shop list object's small class slots, translated from pro/stitshop
// F0x800887C4 / F0x800887EC / F0x80088830 / F0x80088714 / F0x80088670.
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/shop-list-slots-oracle.test.js runs each original slot through
// engine/native and compares the object, the secondary block and the cursor it
// drives, reusing the already-translated cursor setters on the port side.
//
// DECODED: the five raw bodies at exe-decomp/stitshop_c/_asm/ (agreeing with the
// .c files). Verified claims: overlay-stitshop-80088714-role-2026-09-12 (move)
// and stitshop-80088670-role-2026-09-12 (show/hide). The base state setter the
// first two call at self+0x28 is the already host-served core stub F0x80014274.
//
//   F0x800887C4(self)          : self+0x28(1)                (enter state 1)
//   F0x800887EC(self)          : self+0x28(1); self+0x10=0x32; F0x80088714(self, 0)
//   F0x80088830(self) -> s16   : selected id at self+0x6BC, from the stock
//                                halfword (mode 0) or the inline halfword at
//                                self+0x64 (mode != 0)
//   F0x80088714(self, vis)     : self+0x6B8 = vis; secondary=self+0x24;
//                                cursor=secondary+0x4C;
//                                cursor+0x84((idx&1)*0x83+0x1D,
//                                            floor((idx%pageSize)/2)*0xE+0x24);
//                                cursor+0x80(vis)
//   F0x80088670(self, vis)     : cursor+0x88(vis?7:0); cursor+0x94(vis?1:0);
//                                self+0x6B8 = vis?0:1
//
// The slots' lifecycle names are not established by the bodies, so the exported
// names describe what they do rather than claim a caller role.

import {
    uiIconSetPos,
    uiIconSetUnk60,
    uiIconSetUnk7c,
    uiIconSetVisible,
} from "./spawn-ui-icon.ts";

export interface ShopListSlotsMemory {
    read16(addr: number): number;
    read32(addr: number): number;
    write32(addr: number, value: number): void;
}

export interface ShopListSlotsHost {
    /** The host-served base state setter at self+0x28 (F0x80014274). */
    setState(obj: number, v: number): void;
}

/** Object field offsets touched by this family. */
export const SHOP_LIST_SLOT_FIELDS = {
    baseState: 0xc,
    state1: 0x10,
    secondary: 0x24,
    mode: 0x5c,
    stock: 0x6b4,
    cursorLatch: 0x6b8,
    selected: 0x6bc,
    pageSize: 0x6d4,
} as const;

/** The cursor pointer lives in the secondary block at +0x4C. */
export const SECONDARY_CURSOR = 0x4c;

/** F0x800887C4(self): enter state 1. */
export function shopListActivate(
    mem: ShopListSlotsMemory,
    host: ShopListSlotsHost,
    self: number,
): void {
    host.setState(self, 1);
}

/** F0x800887EC(self): enter state 1, arm +0x10 = 0x32, move the cursor to 0. */
export function shopListReset(
    mem: ShopListSlotsMemory,
    host: ShopListSlotsHost,
    self: number,
): void {
    host.setState(self, 1);
    mem.write32(self + SHOP_LIST_SLOT_FIELDS.state1, 0x32);
    shopListMoveCursor(mem, self, 0);
}

/** F0x80088830(self) -> s16: the currently selected row's item id. */
export function shopListSelectedId(mem: ShopListSlotsMemory, self: number): number {
    const idx = mem.read32(self + SHOP_LIST_SLOT_FIELDS.selected) | 0;
    if ((mem.read32(self + SHOP_LIST_SLOT_FIELDS.mode) | 0) !== 0) {
        return (mem.read16(self + Math.imul(idx, 2) + 0x64) << 16) >> 16;
    }
    const stock = mem.read32(self + SHOP_LIST_SLOT_FIELDS.stock) >>> 0;
    return (mem.read16((stock + Math.imul(idx, 2)) >>> 0) << 16) >> 16;
}

/** F0x80088714(self, visible): place and show/hide the cursor for the selection. */
export function shopListMoveCursor(
    mem: ShopListSlotsMemory,
    self: number,
    visible: number,
): void {
    const idx = mem.read32(self + SHOP_LIST_SLOT_FIELDS.selected) | 0;
    const pageSize = mem.read32(self + SHOP_LIST_SLOT_FIELDS.pageSize) | 0;
    const rem = idx % pageSize; // MIPS DIV: remainder carries the dividend's sign
    const secondary = mem.read32(self + SHOP_LIST_SLOT_FIELDS.secondary) >>> 0;
    mem.write32(self + SHOP_LIST_SLOT_FIELDS.cursorLatch, visible | 0);
    const cursor = mem.read32(secondary + SECONDARY_CURSOR) >>> 0;
    const x = (idx & 1) * 0x83 + 0x1d;
    const y = Math.floor(rem / 2) * 0x0e + 0x24;
    uiIconSetPos(mem, cursor, x, y);
    uiIconSetVisible(mem, cursor, visible | 0);
}

/** F0x80088670(self, visible): show or hide the cursor, restarting its animation. */
export function shopListSetCursorVisible(
    mem: ShopListSlotsMemory,
    self: number,
    visible: number,
): void {
    const secondary = mem.read32(self + SHOP_LIST_SLOT_FIELDS.secondary) >>> 0;
    const cursor = mem.read32(secondary + SECONDARY_CURSOR) >>> 0;
    if ((visible | 0) !== 0) {
        uiIconSetUnk60(mem, cursor, 7);
        uiIconSetUnk7c(mem, cursor, 1);
        mem.write32(self + SHOP_LIST_SLOT_FIELDS.cursorLatch, 0);
        return;
    }
    uiIconSetUnk60(mem, cursor, 0);
    uiIconSetUnk7c(mem, cursor, 0);
    mem.write32(self + SHOP_LIST_SLOT_FIELDS.cursorLatch, 1);
}
