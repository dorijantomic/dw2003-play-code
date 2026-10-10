// The item shop list object's init and tick, translated from pro/stitshop
// F0x80087CFC and F0x80087EC0.
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/shop-list-machine-oracle.test.js runs the original through
// engine/native on fixed pad/fixture input and compares the field writes and
// the ordered side-effect call stream to the port.
//
// DECODED: the accepted shop-list-init-tick answer (2026-09-14), verified
// against exe-decomp/stitshop_c/F0x80087cfc.c / F0x80087ec0.c and their raw
// _asm. Claims: shop-fold-duration-all-10-2026-09-10 (partially_verified),
// shop-render-helpers-2026-09-09 (candidate; its page-size pair is reversed vs
// the assembly - BUY is 8, SELL 0xE - a flagged contradiction), the pad claims,
// UI-TASKOBJ-STATEMACHINE-001.
//
// F0x80087CFC(obj, listCtx) dispatches on obj+0x10:
//   default: BUY (mode 0)  : +0x6B4 = shop_load(+0x60); +0x6D4 = 8;
//                            +0x6C0 = stock length; +0x10 += 1
//            SELL (mode !=0): sellBuild(obj); +0x6D4 = 0xE; +0x10 = 0x64
//            then +0x6C8 = ceil(+0x6C0 / +0x6D4)
//   1   : foldStart(+0x6D8, open); +0x10 += 1
//   2   : if foldTick(+0x6D8) != 0: readout(obj, listCtx, 1); setState(obj, 2)
//   0x32: foldStart(+0x6D8, close); readout(obj, listCtx, 0); +0x10 += 1
//   0x33: if foldTick(+0x6D8) != 0: setState(obj, 2)
//
// F0x80087EC0(obj, listCtx) dispatches on obj+0xC:
//   default: advanceState(obj); buildList(obj, listCtx); +0x6D8 = 0xA
//   1      : init(obj, listCtx); drawList(obj)
//   2      : if +0x6B8 != 0: page/cursor input (below); then drawList(obj)
//   3      : nothing
//
// Case-2 input: L1/R1 when the other is not held change the page (clamped to
// [0, pageCount-1]); a page change resets the flat index to page*pageSize and
// fires SFX, highlight, readout and cursor move. Otherwise Up/Down move the
// index by 2 and Left/Right by 1 in the two-column grid, clamped to
// [page*pageSize, min(count-1, (page+1)*pageSize - 1)], and an index change
// fires highlight, cursor move and SFX (SFX last here, first on a page change).
//
// Every callee is a host boundary here; the translated implementations are
// proven by their own oracles.

import { uiIconSetPos } from "./spawn-ui-icon.ts";

export interface ShopListMachineMemory {
    read16(addr: number): number;
    read32(addr: number): number;
    write32(addr: number, value: number): void;
}

export interface ShopListPad {
    /** F0x80018854: buttons pressed this frame. */
    pressed(port: number): number;
    /** F0x80018878: buttons held this frame. */
    held(port: number): number;
    /** F0x8001889C: auto-repeat pulses this frame. */
    repeat(port: number): number;
    /** F0x80018980: logical button id -> bit index. */
    buttonBit(port: number, id: number): number;
}

export interface ShopListInitHost {
    /** obj+0x28: the host-served base state setter (F0x80014274). */
    setState(obj: number, v: number): void;
    /** The word cell 0x8008D1B8: windowFoldStart(foldState, open) (F0x8008C2DC). */
    foldStart(foldState: number, open: number): void;
    /** The word cell 0x8008D1BC: windowFoldTick(foldState) -> ready (F0x8008C370). */
    foldTick(foldState: number): number;
    /** F0x800888E4: build the SELL list from the player's items. */
    sellBuild(obj: number): void;
    /** 0x8008D1AC+0x1C: the shop stock loader (F0x8008C488). */
    loadStock(shopId: number): number;
    /** F0x800875E0: the list-label readout. */
    readout(obj: number, listCtx: number, visible: number): void;
}

export interface ShopListTickHost extends ShopListInitHost {
    /** obj+0x38: the host-served base advance-phase method (F0x800142AC). */
    advanceState(obj: number): void;
    /** F0x80087428: build the list widgets and cursor. */
    buildList(obj: number, listCtx: number): void;
    /** F0x80087920: draw the list. */
    drawList(obj: number): void;
    /** obj+0x50 -> +0x50(itemId, 1): the info-band highlight forwarder. */
    highlight(parent: number, itemId: number, flag: number): void;
    /** 0x80055C48(0x8004513E): the selection blip. */
    playCursorSfx(): void;
    pad: ShopListPad;
}

/** Object field offsets. */
export const SHOP_LIST_MACHINE = {
    state: 0xc,
    state1: 0x10,
    secondary: 0x24,
    parent: 0x50,
    mode: 0x5c,
    idle: 0x68,
    stock: 0x6b4,
    cursorLatch: 0x6b8,
    defaultIndex: 0x6bc,
    count: 0x6c0,
    page: 0x6c4,
    pageCount: 0x6c8,
    pageSize: 0x6d4,
    foldState: 0x6d8,
} as const;
/** The cursor pointer lives in the list context at +0x4C. */
export const LIST_CTX_CURSOR = 0x4c;
/** Fold duration the tick's default state arms. */
export const SHOP_LIST_FOLD_TICKS = 0x0a;
/** BUY / SELL page sizes from the assembly. */
export const SHOP_LIST_BUY_PAGE = 8;
export const SHOP_LIST_SELL_PAGE = 0x0e;
/** The resident cell holding the loaded stock table (0x8008D1AC); word 0
 *  is the entry count and +0x1C the loader pointer. */
export const SHOP_STOCK_TABLE = 0x8008d1ac;
/** SFX id the selection plays. */
export const SHOP_LIST_SFX = 0x8004513e;

function selectedId(mem: ShopListMachineMemory, obj: number, idx: number): number {
    if ((mem.read32(obj + SHOP_LIST_MACHINE.mode) | 0) !== 0) {
        return (mem.read16(obj + Math.imul(idx, 2) + 0x64) << 16) >> 16;
    }
    const stock = mem.read32(obj + SHOP_LIST_MACHINE.stock) >>> 0;
    return (mem.read16((stock + Math.imul(idx, 2)) >>> 0) << 16) >> 16;
}

function moveCursor(
    mem: ShopListMachineMemory,
    obj: number,
    listCtx: number,
    idx: number,
): void {
    const pageSize = mem.read32(obj + SHOP_LIST_MACHINE.pageSize) | 0;
    const cursor = mem.read32(listCtx + LIST_CTX_CURSOR) >>> 0;
    const rem = idx % pageSize;
    uiIconSetPos(mem, cursor, (idx % 2) * 0x83 + 0x1d, Math.floor(rem / 2) * 0x0e + 0x24);
}

/** F0x80087CFC(obj, listCtx): the list's init state machine. */
export function shopListInit(
    mem: ShopListMachineMemory,
    obj: number,
    listCtx: number,
    host: ShopListInitHost,
): void {
    const state = mem.read32(obj + SHOP_LIST_MACHINE.state1) | 0;
    switch (state) {
        case 0x64:
            return;
        default: {
            if ((mem.read32(obj + SHOP_LIST_MACHINE.mode) | 0) === 0) {
                mem.write32(obj + SHOP_LIST_MACHINE.stock, host.loadStock(mem.read32(obj + 0x60) | 0) >>> 0);
                mem.write32(obj + SHOP_LIST_MACHINE.pageSize, SHOP_LIST_BUY_PAGE);
                mem.write32(obj + SHOP_LIST_MACHINE.count, mem.read32(SHOP_STOCK_TABLE) | 0);
                mem.write32(obj + SHOP_LIST_MACHINE.state1, state + 1);
            } else {
                host.sellBuild(obj);
                mem.write32(obj + SHOP_LIST_MACHINE.pageSize, SHOP_LIST_SELL_PAGE);
                mem.write32(obj + SHOP_LIST_MACHINE.state1, 0x64);
            }
            const count = mem.read32(obj + SHOP_LIST_MACHINE.count) | 0;
            const size = mem.read32(obj + SHOP_LIST_MACHINE.pageSize) | 0;
            // MIPS div/mflo/mfhi: quotient truncates toward zero, remainder
            // carries the dividend's sign; pageCount adds 1 for any remainder.
            mem.write32(
                obj + SHOP_LIST_MACHINE.pageCount,
                Math.trunc(count / size) + (count % size !== 0 ? 1 : 0),
            );
            return;
        }
        case 1:
            host.foldStart(obj + SHOP_LIST_MACHINE.foldState, 1);
            mem.write32(obj + SHOP_LIST_MACHINE.state1, state + 1);
            return;
        case 2:
            if ((host.foldTick(obj + SHOP_LIST_MACHINE.foldState) | 0) !== 0) {
                host.readout(obj, listCtx, 1);
                host.setState(obj, 2);
            }
            return;
        case 0x32:
            host.foldStart(obj + SHOP_LIST_MACHINE.foldState, 0);
            host.readout(obj, listCtx, 0);
            mem.write32(obj + SHOP_LIST_MACHINE.state1, state + 1);
            return;
        case 0x33:
            if ((host.foldTick(obj + SHOP_LIST_MACHINE.foldState) | 0) !== 0) {
                host.setState(obj, 2);
            }
            return;
    }
}

/** F0x80087EC0(obj, listCtx): the list's per-frame tick. */
export function shopListTick(
    mem: ShopListMachineMemory,
    obj: number,
    listCtx: number,
    host: ShopListTickHost,
): void {
    const state = mem.read32(obj + SHOP_LIST_MACHINE.state) | 0;
    if (state === 1) {
        shopListInit(mem, obj, listCtx, host);
        host.drawList(obj);
        return;
    }
    if (state === 3) return;
    if (state !== 2) {
        host.advanceState(obj);
        host.buildList(obj, listCtx);
        mem.write32(obj + SHOP_LIST_MACHINE.foldState, SHOP_LIST_FOLD_TICKS);
        return;
    }

    if ((mem.read32(obj + SHOP_LIST_MACHINE.cursorLatch) | 0) !== 0) {
        const pad = host.pad;
        const oldPage = mem.read32(obj + SHOP_LIST_MACHINE.page) | 0;
        const held = pad.held(0) | 0;
        const r1 = (held >>> pad.buttonBit(0, 0xb)) & 1;
        const l1Held = (held >>> pad.buttonBit(0, 0xa)) & 1;
        const pressed = pad.pressed(0) | 0;
        const repeat = pad.repeat(0) | 0;
        const l1 = ((pressed >>> pad.buttonBit(0, 0xa)) & 1) |
            ((repeat >>> pad.buttonBit(0, 0xa)) & 1);
        const r1Pressed = ((pressed >>> pad.buttonBit(0, 0xb)) & 1) |
            ((repeat >>> pad.buttonBit(0, 0xb)) & 1);

        if (r1 === 0 && l1 !== 0) {
            mem.write32(obj + SHOP_LIST_MACHINE.page, Math.max(oldPage - 1, 0));
        } else if (l1Held === 0 && r1Pressed !== 0) {
            mem.write32(
                obj + SHOP_LIST_MACHINE.page,
                Math.min(oldPage + 1, (mem.read32(obj + SHOP_LIST_MACHINE.pageCount) | 0) - 1),
            );
        }

        const page = mem.read32(obj + SHOP_LIST_MACHINE.page) | 0;
        const pageSize = mem.read32(obj + SHOP_LIST_MACHINE.pageSize) | 0;
        if (oldPage !== page) {
            host.playCursorSfx();
            const flat = Math.imul(page, pageSize);
            mem.write32(obj + SHOP_LIST_MACHINE.defaultIndex, flat);
            host.highlight(
                mem.read32(obj + SHOP_LIST_MACHINE.parent) >>> 0,
                selectedId(mem, obj, flat),
                1,
            );
            host.readout(obj, listCtx, 1);
            moveCursor(mem, obj, listCtx, flat);
        } else {
            const pageStart = Math.imul(page, pageSize);
            const oldIdx = mem.read32(obj + SHOP_LIST_MACHINE.defaultIndex) | 0;
            const countMinus1 = (mem.read32(obj + SHOP_LIST_MACHINE.count) | 0) - 1;
            let pageEnd = Math.imul(page + 1, pageSize) - 1;
            if (countMinus1 < pageEnd) pageEnd = countMinus1;

            const up = ((pressed >>> pad.buttonBit(0, 4)) & 1) |
                ((repeat >>> pad.buttonBit(0, 4)) & 1);
            const down = ((pressed >>> pad.buttonBit(0, 6)) & 1) |
                ((repeat >>> pad.buttonBit(0, 6)) & 1);
            const left = ((pressed >>> pad.buttonBit(0, 7)) & 1) |
                ((repeat >>> pad.buttonBit(0, 7)) & 1);
            const right = ((pressed >>> pad.buttonBit(0, 5)) & 1) |
                ((repeat >>> pad.buttonBit(0, 5)) & 1);

            if (up !== 0) {
                mem.write32(
                    obj + SHOP_LIST_MACHINE.defaultIndex,
                    Math.max(oldIdx - 2, pageStart),
                );
            } else if (down !== 0) {
                mem.write32(
                    obj + SHOP_LIST_MACHINE.defaultIndex,
                    Math.min(oldIdx + 2, pageEnd),
                );
            }

            const heldDown = (held >>> pad.buttonBit(0, 6)) & 1;
            const heldUp = (held >>> pad.buttonBit(0, 4)) & 1;
            const idxAfterVertical = mem.read32(obj + SHOP_LIST_MACHINE.defaultIndex) | 0;
            if (left !== 0) {
                if (heldDown === 0) {
                    mem.write32(
                        obj + SHOP_LIST_MACHINE.defaultIndex,
                        Math.max(idxAfterVertical - 1, pageStart),
                    );
                }
            } else if (right !== 0) {
                if (heldUp === 0) {
                    mem.write32(
                        obj + SHOP_LIST_MACHINE.defaultIndex,
                        Math.min(idxAfterVertical + 1, pageEnd),
                    );
                }
            }

            const idx = mem.read32(obj + SHOP_LIST_MACHINE.defaultIndex) | 0;
            if (oldIdx !== idx) {
                host.highlight(
                    mem.read32(obj + SHOP_LIST_MACHINE.parent) >>> 0,
                    selectedId(mem, obj, idx),
                    1,
                );
                moveCursor(mem, obj, listCtx, idx);
                host.playCursorSfx();
            }
        }
    }

    host.drawList(obj);
}
