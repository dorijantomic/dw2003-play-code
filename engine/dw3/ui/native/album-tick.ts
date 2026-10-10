// The card album screen's tick state machine, translated bit-exactly from the
// original pro/stcrdabm F0x80084C38 body.
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/lane-b/album-tick.test.js runs the original through
// engine/native and compares the ordered boundary calls, the field writes and
// the cursor-widget moves.
//
// The tick is the album's cursor/paging machine (state = obj+0x10):
//   default     start the +0xB8 fold, refresh the page mask (F0x80084BC8) and
//               build the grid object (F0x80083A78) into ctx+0x44; advance.
//   1           when the +0xB8 fold finishes, fill the headings
//               (F0x80083E14) and start the +0xC8 fold when the page has any
//               collected card; go to 0xB.
//   3           set obj+0x68 = 1; advance.
//   4           the cursor move: page left/right (obj+0x60 in 0..obj+0x64-1)
//               and cell left/right (obj+0x74 in 0..11, plus up/down on the
//               second pad object), clamped to card 0x139; a change plays
//               0x4001B, refreshes the mask and headings and moves the cursor
//               widget; the pad 0xE cancels (0x800450BD) into the popup state.
//   0xA..0x11   the anchor/selection window open and close.
//   0x32..0x35  the closing fold and cancel.
// The page mask (F0x80084BC8), the headings (F0x80083E14), the cell paint
// (F0x800840AC), the grid object (F0x80083A78), the popup (F0x80083008), the
// two fold pairs, the pad service, the widget methods and the [0x80044F4C] /
// [0x80044B38] resource services are host boundaries; the port preserves the
// exact call order and arguments. This is lane B (engine/dw3/ui/native/**).
//
// The argument array (arg1) offsets used here: +0x1C/+0x20/+0x24/+0x28/+0x2C/
// +0x30/+0x34/+0x38/+0x3C/+0x40 are the card widgets, +0x44 the grid object,
// +0x48 the popup. The reference build reads the cursor-widget pointer from
// ctx+0x44.

import { ALBUM_COLLECTION_TABLE, ALBUM_COLLECTION_BYTE, ALBUM_CARD_MAX } from "./album-grid.ts";

/** Screen fields the tick reads/writes. */
export const ALBUM_TICK_FIELDS = {
    mode: 0x0c,
    state: 0x10,
    flag14: 0x14,
    method28: 0x28,
    method2C: 0x2c,
    method3C: 0x3c,
    page: 0x60,
    pageCount: 0x64,
    flag68: 0x68,
    anchor: 0x6c,
    cell: 0x74,
    card: 0x78,
    anyFlag: 0x7c,
    slotFlags: 0x80,
    slotCount: 0xc,
    grid: 0x44,
    popup: 0x48,
    foldA: 0xb8,
    foldB: 0xc8,
} as const;

export interface AlbumTickMemory {
    read16(addr: number): number;
    read32(addr: number): number;
    write16(addr: number, value: number): void;
    write32(addr: number, value: number): void;
}

export interface AlbumTickHost {
    /** obj+0x28(obj, value). */
    baseMethod28(obj: number, value: number): void;
    /** obj+0x3C(obj). */
    baseMethod3C(obj: number): void;
    /** F0x80084BC8(obj): refresh the page's collected mask. */
    pageMask(obj: number): void;
    /** F0x80083A78(obj): build the grid object, returns it. */
    gridObject(obj: number): number;
    /** F0x80083E14(obj, ctx, show): fill or clear the panel headings. */
    fillHeadings(obj: number, ctx: number, show: number): void;
    /** F0x800840AC(obj, ctx, show): paint the selected cell's card info. */
    cellPaint(obj: number, ctx: number, show: number): void;
    /** F0x80083008(): build the popup, returns it. */
    makePopup(): number;
    /** [0x80044F4C](id): the resident resource handle getter. */
    resourceGet(id: number): number;
    /** [0x80044B38]+0x414(id): the resident resource line getter. */
    resourceLine(id: number): number;
    /** [0x8004B7D0]+0x3F4(port): the pad word pressed this frame. */
    padPressed(port: number): number;
    /** [0x8004B7D0]+0x3F8(port): the pad word held (second bank). */
    padHeld(port: number): number;
    /** [0x8004B7D0]+0x3FC(port): the pad word auto-repeat pulses. */
    padRepeat(port: number): number;
    /** [0x8004B7D0]+0x408(port, code): the keymap bit for a button. */
    padKey(port: number, code: number): number;
    /** [0x80055C48](id): play a packed sound. */
    playSound(id: number): void;
    /** [0x8008B838](sub, direction): start the album fold. */
    foldStart(sub: number, direction: number): void;
    /** [0x8008B83C](sub): advance the album fold, nonzero while running. */
    foldTick(sub: number): number;
    /** widget +0x114(widget, source, index). */
    widget114(widget: number, source: number, index: number): void;
    /** widget +0x118(widget, line, value). */
    widget118(widget: number, line: number, value: number): void;
    /** widget +0x144(widget, value). */
    widget144(widget: number, value: number): void;
    /** widget +0x148(widget, value). */
    widget148(widget: number, value: number): void;
    /** cursor widget +0x84(widget, x, y). */
    widget84(widget: number, x: number, y: number): void;
    /** popup widget +0x64(widget, a, b). */
    widget64(widget: number, a: number, b: number): void;
}

function advance(mem: AlbumTickMemory, obj: number): void {
    mem.write32(obj + ALBUM_TICK_FIELDS.state, ((mem.read32(obj + ALBUM_TICK_FIELDS.state) | 0) + 1) | 0);
}

function s16(v: number): number {
    return (v << 16) >> 16;
}

/** (pad >> key(code)) & 1 with the original's short-circuit call order. */
function padBit(host: AlbumTickHost, hkind: "pressed" | "held" | "repeat", code: number): boolean {
    const w = hkind === "pressed" ? host.padPressed(0) : hkind === "held" ? host.padHeld(0) : host.padRepeat(0);
    return (((w | 0) >> host.padKey(0, code)) & 1) !== 0;
}

/** F0x80084C38(obj, ctx): the album screen's tick state machine. */
export function albumScreenTick(
    mem: AlbumTickMemory,
    obj: number,
    ctx: number,
    host: AlbumTickHost,
): void {
    const state = mem.read32(obj + ALBUM_TICK_FIELDS.state) | 0;

    switch (state) {
        case 0x1:
            if ((host.foldTick(obj + ALBUM_TICK_FIELDS.foldA) | 0) !== 0) {
                host.fillHeadings(obj, ctx, 1);
                if ((mem.read32(obj + ALBUM_TICK_FIELDS.anyFlag) | 0) !== 0) {
                    host.foldStart(obj + ALBUM_TICK_FIELDS.foldB, 1);
                }
                mem.write32(obj + ALBUM_TICK_FIELDS.state, 0xb);
            }
            return;

        case 0x3:
            mem.write32(obj + ALBUM_TICK_FIELDS.flag68, 1);
            advance(mem, obj);
            return;

        case 0x4:
            stepCursor(mem, obj, ctx, host);
            return;

        case 0xa:
            if ((mem.read32(obj + ALBUM_TICK_FIELDS.flag14) | 0) === 0) {
                host.cellPaint(obj, ctx, 0);
            }
            host.foldStart(obj + ALBUM_TICK_FIELDS.foldB, mem.read32(obj + ALBUM_TICK_FIELDS.flag14) | 0);
            host.baseMethod3C(obj);
            return;

        case 0xb:
            if ((host.foldTick(obj + ALBUM_TICK_FIELDS.foldB) | 0) !== 0) {
                mem.write32(obj + ALBUM_TICK_FIELDS.state, 0xf);
            }
            return;

        case 0xf: {
            const grid = mem.read32(ctx + ALBUM_TICK_FIELDS.grid) >>> 0;
            if ((mem.read32(grid + 0x0c) | 0) === 1) {
                mem.write32(obj + ALBUM_TICK_FIELDS.flag68, 1);
                host.fillHeadings(obj, ctx, 1);
                if ((mem.read32(obj + 0xd0) | 0) !== 0) {
                    let cell = mem.read32(obj + ALBUM_TICK_FIELDS.cell) | 0;
                    while ((mem.read32(obj + ALBUM_TICK_FIELDS.slotFlags + cell * 4) | 0) === 0) {
                        cell += 1;
                        mem.write32(obj + ALBUM_TICK_FIELDS.cell, cell);
                    }
                    host.cellPaint(obj, ctx, 1);
                }
                mem.write32(obj + ALBUM_TICK_FIELDS.state, 3);
            }
            return;
        }

        case 0x32:
            if ((mem.read32(mem.read32(ctx + ALBUM_TICK_FIELDS.popup) + 0x0c) | 0) === 2) {
                mem.write32(obj + ALBUM_TICK_FIELDS.mode, 3);
            }
            return;

        case 0x33:
            if ((host.foldTick(obj + ALBUM_TICK_FIELDS.foldB) | 0) !== 0) {
                host.fillHeadings(obj, ctx, 0);
                host.foldStart(obj + ALBUM_TICK_FIELDS.foldA, 0);
                advance(mem, obj);
            }
            return;

        case 0x34:
            if ((host.foldTick(obj + ALBUM_TICK_FIELDS.foldA) | 0) !== 0) advance(mem, obj);
            return;

        case 0x35:
            if ((mem.read32(ctx + ALBUM_TICK_FIELDS.grid) | 0) === 0) {
                host.baseMethod28(obj, 3);
            }
            return;

        default:
            host.foldStart(obj + ALBUM_TICK_FIELDS.foldA, 1);
            host.pageMask(obj);
            mem.write32(ctx + ALBUM_TICK_FIELDS.grid, host.gridObject(obj));
            advance(mem, obj);
            return;
    }
}

function stepCursor(
    mem: AlbumTickMemory,
    obj: number,
    ctx: number,
    host: AlbumTickHost,
): void {
    const pageBefore = mem.read32(obj + ALBUM_TICK_FIELDS.page) | 0;
    const heldLeft = padBit(host, "held", 0xb);
    const pressedLeft = padBit(host, "pressed", 0xa);
    if (
        (!heldLeft && pressedLeft) ||
        (!padBit(host, "held", 0xb) && padBit(host, "repeat", 0xa))
    ) {
        const next = pageBefore - 1;
        mem.write32(obj + ALBUM_TICK_FIELDS.page, next < 0 ? 0 : next);
    } else if (
        (!padBit(host, "held", 0xa) && padBit(host, "pressed", 0xb)) ||
        (!padBit(host, "held", 0xa) && padBit(host, "repeat", 0xb))
    ) {
        const next = pageBefore + 1;
        const max = (mem.read32(obj + ALBUM_TICK_FIELDS.pageCount) | 0) - 1;
        mem.write32(obj + ALBUM_TICK_FIELDS.page, next > max ? max : next);
    }

    if (pageBefore !== (mem.read32(obj + ALBUM_TICK_FIELDS.page) | 0)) {
        host.playSound(0x4001b);
        mem.write32(obj + ALBUM_TICK_FIELDS.flag68, 0);
        mem.write32(obj + ALBUM_TICK_FIELDS.cell, 0);
        host.pageMask(obj);
        host.fillHeadings(obj, ctx, 1);
        if ((mem.read32(obj + 0xd0) | 0) === 0) {
            if ((mem.read32(obj + ALBUM_TICK_FIELDS.anyFlag) | 0) !== 0) {
                mem.write32(obj + ALBUM_TICK_FIELDS.state, 0xa);
                mem.write32(obj + ALBUM_TICK_FIELDS.flag14, 1);
                host.widget84(mem.read32(ctx + ALBUM_TICK_FIELDS.grid) >>> 0, Math.imul(mem.read32(obj + ALBUM_TICK_FIELDS.page) | 0, 0xc) | 1, 0);
            } else {
                mem.write32(obj + ALBUM_TICK_FIELDS.state, 0xf);
            }
        } else {
            host.widget84(mem.read32(ctx + ALBUM_TICK_FIELDS.grid) >>> 0, Math.imul(mem.read32(obj + ALBUM_TICK_FIELDS.page) | 0, 0xc) | 1, 0);
            if ((mem.read32(obj + ALBUM_TICK_FIELDS.anyFlag) | 0) === 0) {
                mem.write32(obj + ALBUM_TICK_FIELDS.state, 0xa);
                mem.write32(obj + ALBUM_TICK_FIELDS.flag14, 0);
            } else {
                mem.write32(obj + ALBUM_TICK_FIELDS.state, 0xf);
            }
        }
    } else {
        const cellBefore = mem.read32(obj + ALBUM_TICK_FIELDS.cell) | 0;
        if (padBit(host, "pressed", 4)) {
            if (cellBefore >= 6) mem.write32(obj + ALBUM_TICK_FIELDS.cell, cellBefore - 6);
        } else if (padBit(host, "pressed", 6)) {
            if (cellBefore < 6) mem.write32(obj + ALBUM_TICK_FIELDS.cell, cellBefore + 6);
        }
        if (padBit(host, "pressed", 7) || padBit(host, "repeat", 7)) {
            const next = cellBefore - 1;
            mem.write32(obj + ALBUM_TICK_FIELDS.cell, next < 0 ? 0 : next);
        } else if (padBit(host, "pressed", 5) || padBit(host, "repeat", 5)) {
            const next = cellBefore + 1;
            mem.write32(obj + ALBUM_TICK_FIELDS.cell, next >= 0xc ? 0xb : next);
        }
        const base = Math.imul(mem.read32(obj + ALBUM_TICK_FIELDS.page) | 0, 0xc);
        if (base + (mem.read32(obj + ALBUM_TICK_FIELDS.cell) | 0) >= ALBUM_CARD_MAX) {
            mem.write32(obj + ALBUM_TICK_FIELDS.cell, ALBUM_CARD_MAX - 1 - base);
        }

        const cellAfter = mem.read32(obj + ALBUM_TICK_FIELDS.cell) | 0;
        if (cellBefore !== cellAfter) {
            let found = -1;
            if (cellAfter < cellBefore) {
                if (cellAfter >= 0) {
                    let i = cellAfter;
                    while (i >= 0) {
                        if ((mem.read32(obj + ALBUM_TICK_FIELDS.slotFlags + i * 4) | 0) !== 0) { found = i; break; }
                        i -= 1;
                    }
                }
            } else if (cellBefore < cellAfter && cellAfter < 0xc) {
                let i = cellAfter;
                while (i < 0xc) {
                    if ((mem.read32(obj + ALBUM_TICK_FIELDS.slotFlags + i * 4) | 0) !== 0) { found = i; break; }
                    i += 1;
                }
            }
            if (found === -1) {
                mem.write32(obj + ALBUM_TICK_FIELDS.cell, cellBefore);
            } else {
                mem.write32(obj + ALBUM_TICK_FIELDS.cell, found);
                host.cellPaint(obj, ctx, 1);
                host.playSound(0x4001b);
            }
        }
    }

    if (padBit(host, "pressed", 0xe)) {
        host.playSound(0x800450bd);
        mem.write32(obj + ALBUM_TICK_FIELDS.flag68, 0);
        mem.write32(obj + ALBUM_TICK_FIELDS.state, 0x32);
        const popup = host.makePopup() >>> 0;
        mem.write32(ctx + ALBUM_TICK_FIELDS.popup, popup);
        host.widget64(popup, 0, 0xa);
    }
}

/** Unused re-exports kept for the collection mask relation. */
export const ALBUM_TICK_COLLECTION = {
    table: ALBUM_COLLECTION_TABLE,
    byte: ALBUM_COLLECTION_BYTE,
    max: ALBUM_CARD_MAX,
} as const;
