// The card album screen's three remaining overlay bodies, translated from
// pro/stcrdabm:
//   F0x80084BC8 albumPageMask    — refresh the page's twelve collected flags
//   F0x800840AC albumCellPaint   — fill the detail widgets for the cell under
//                                  the cursor
//   F0x80083008 albumMakePopup   — build the selection/anchor popup object
//
// DECODED: authority-2 `exe-decomp/stcrdabm.norm.s` F0x80084BC8 (:1319-:1420),
// F0x800840AC (:1319-:1595) and F0x80083008 (`exe-decomp/stcrdabm_c/F0x80083008.c`)
// against the driver `exe-decomp/stcrdabm_c/`. The album tick
// (engine/dw3/ui/native/album-tick.ts) and lifecycle
// (engine/dw3/ui/native/album-lifecycle.ts) call all three; the port preserves
// their exact call order and arguments.
//
//   pageMask(obj): obj+0x7C = 0. Walk the page's twelve cells (page = obj+0x60):
//     each card = page*12 + i + 1. A card below the resident bound 0x13B whose
//     ever-obtained flag (0x80048D34 + 0x4DF + card) is set writes 1 into the
//     cell's slot flag (obj+0x80 + i*4) and sets obj+0x7C; every other cell
//     writes 0. The increment is in the loop head, so the first card is
//     page*12 + 1.
//
//   cellPaint(obj, ctx, show): obj+0x78 = page*12 + cell + 1 (page = obj+0x60,
//     cell = obj+0x74). When that card was ever obtained AND show != 0, build
//     the resident text context (F0x8001EBF8), set its card (ctx+0x2C), then fill
//     the detail widgets at slots ctx+0x1C..+0x40 through their +0x114 (line),
//     +0x118 (number), +0x144 (hide) and +0x148 (show) methods. The badge test
//     ctx+0x50 splits two layouts; five special card ids take the compact one.
//     Otherwise the six widgets ctx+0x1C,0x28,0x2C,0x20,0x24,0x30 are hidden.
//     Every path then hides ctx+0x34/0x38/0x3C and sets ctx+0x40's flag, except
//     the full Digimon layout, which fills those three and shows ctx+0x40. The
//     widget method set is the shared text-widget one; the resident resource
//     getters [0x80044B38]+0x414 (line) and [0x80044F4C] (get) are host
//     boundaries. The collection count is a SIGNED byte read (`lb`, :1380).
//
//   makePopup(): F0x80014504(0x80082F54, 0x68, 0) then +0x64 = 0x80082D88,
//     +0x50 = 0x1000, +0x54 = 0. The factory is the shared object allocator
//     (engine/dw3/ui/task-object.ts registers its class), so it is a host
//     boundary here and the port only states the three stores.
//
// This module is lane B (engine/dw3/ui/native/**); lane A owns the shared
// engine/dw3/ui/index.ts barrel and data/translated_functions.json.

import { ALBUM_COLLECTION_BYTE, ALBUM_COLLECTION_TABLE, ALBUM_CARD_MAX } from "./album-grid.ts";

/** The save-global block; cellPaint's line ids and collection count read from it. */
export const ALBUM_SAVE_PTR = 0x8005cca8;
/** The ever-obtained count array offset inside the save block (+0x3A2). */
export const ALBUM_COUNT_OFF = 0x3a2;
/** The page-mask slot flags and its any-flag (album-tick.ts ALBUM_TICK_FIELDS). */
export const ALBUM_MASK_SLOT_FLAGS = 0x80;
export const ALBUM_MASK_ANY = 0x7c;
/** The page / cell / card fields cellPaint reads. */
export const ALBUM_CELL_PAGE = 0x60;
export const ALBUM_CELL_CELL = 0x74;
export const ALBUM_CELL_CARD = 0x78;
export const ALBUM_PAGE_CELLS = 12;

/** The popup's factory arguments and its three stores. */
export const ALBUM_POPUP_HANDLER = 0x80082f54;
export const ALBUM_POPUP_SIZE = 0x68;
export const ALBUM_POPUP_FIELDS = { method64: 0x64, depth50: 0x50, scale54: 0x54 } as const;
export const ALBUM_POPUP_METHOD64 = 0x80082d88;

/** The five card ids that take cellPaint's compact layout (:1447-:1458). */
export const ALBUM_SPECIAL_CARDS: ReadonlyArray<number> = [0x45, 0x70, 0x9b, 0xc6, 0xf1];

export interface AlbumLeavesMemory {
    read8(addr: number): number;
    read32(addr: number): number;
    write32(addr: number, value: number): void;
}

/** F0x80084BC8(obj): refresh the page's twelve collected slot flags. */
export function albumPageMask(mem: AlbumLeavesMemory, obj: number): void {
    mem.write32(obj + ALBUM_MASK_ANY, 0);
    let card = Math.imul(mem.read32(obj + ALBUM_CELL_PAGE) | 0, 0xc);
    for (let i = 0; i < ALBUM_PAGE_CELLS; i++) {
        card = (card + 1) | 0;
        const obtained =
            card < ALBUM_CARD_MAX &&
            mem.read8(ALBUM_COLLECTION_TABLE + card + ALBUM_COLLECTION_BYTE) !== 0;
        if (obtained) {
            mem.write32(obj + ALBUM_MASK_SLOT_FLAGS + i * 4, 1);
            mem.write32(obj + ALBUM_MASK_ANY, 1);
        } else {
            mem.write32(obj + ALBUM_MASK_SLOT_FLAGS + i * 4, 0);
        }
    }
}

export interface AlbumCellPaintMemory {
    read8(addr: number): number;
    read32(addr: number): number;
    write32(addr: number, value: number): void;
}

export interface AlbumCellPaintHost {
    /** F0x8001EBF8(&ctx): build the resident text context. */
    initTextContext(): void;
    /** textctx+0x2C(card): set the context's card. */
    textSetCard(card: number): void;
    /** textctx+0x50(): nonzero when the card shows its badge. */
    textBadge(): number;
    /** textctx+0x01: a card level byte. */
    textByte1(): number;
    /** textctx+0x02: a card level byte. */
    textByte2(): number;
    /** textctx+0x05: a card level byte. */
    textByte5(): number;
    /** [0x80044F4C](id): the resident line/get service (the same cell both call). */
    resourceGet(id: number): number;
    /** widget+0x114(widget, source, index): set a line from a bank. */
    setWidgetLine(widget: number, source: number, index: number): void;
    /** widget+0x118(widget, line, value): set a numeric line. */
    setWidgetNumber(widget: number, line: number, value: number): void;
    /** widget+0x144(widget, value): the hide/toggle flag. */
    setWidgetFlag144(widget: number, value: number): void;
    /** widget+0x148(widget, value): the show/measure flag. */
    setWidgetFlag148(widget: number, value: number): void;
}

/** The ten detail-widget slots, in the order cellPaint uses them. */
export const ALBUM_CELL_SLOTS = {
    card: 0x1c, program: 0x28, count: 0x2c, level: 0x20, levelValue: 0x24,
    text: 0x30, ap: 0x34, apValue: 0x38, hp: 0x3c, hpValue: 0x40,
} as const;

/** F0x800840AC(obj, ctx, show): fill the detail widgets for the cell. */
export function albumCellPaint(
    mem: AlbumCellPaintMemory,
    obj: number,
    ctx: number,
    show: number,
    host: AlbumCellPaintHost,
): void {
    const card = (Math.imul(mem.read32(obj + ALBUM_CELL_PAGE) | 0, 0xc) +
        (mem.read32(obj + ALBUM_CELL_CELL) | 0) + 1) | 0;
    mem.write32(obj + ALBUM_CELL_CARD, card);

    const save = mem.read32(ALBUM_SAVE_PTR) | 0;
    const obtained = mem.read8(ALBUM_COLLECTION_TABLE + card + ALBUM_COLLECTION_BYTE) !== 0;
    const widget = (slot: number): number => mem.read32(ctx + slot) >>> 0;

    // A full Digimon layout (not a special id) leaves the tail flags alone;
    // every other path runs the common hide tail that sets those three hidden
    // and shows slot 0x40 as hidden.
    let fullLayout = false;

    if (obtained && (show | 0) !== 0) {
        host.initTextContext();
        host.textSetCard(card);
        host.setWidgetLine(widget(ALBUM_CELL_SLOTS.card), host.resourceGet(save + 0x16), card);
        host.setWidgetLine(widget(ALBUM_CELL_SLOTS.program), host.resourceGet(save + 0x24), 8);
        // The count is a SIGNED byte (`lb`, :1380) at 0x80048D34 + 0x3A2 + card.
        const count = mem.read8(ALBUM_COLLECTION_TABLE + ALBUM_COUNT_OFF + card);
        host.setWidgetNumber(widget(ALBUM_CELL_SLOTS.count), 0, (count << 24) >> 24);
        host.setWidgetFlag148(widget(ALBUM_CELL_SLOTS.count), 1);
        if ((host.textBadge() | 0) !== 0) {
            host.setWidgetFlag144(widget(ALBUM_CELL_SLOTS.level), 0);
            host.setWidgetFlag144(widget(ALBUM_CELL_SLOTS.levelValue), 0);
            host.setWidgetLine(widget(ALBUM_CELL_SLOTS.text), host.resourceGet(save + 0x1d), card);
        } else {
            host.setWidgetLine(widget(ALBUM_CELL_SLOTS.level), host.resourceGet(save + 0x24), 8);
            host.setWidgetNumber(widget(ALBUM_CELL_SLOTS.levelValue), 0, host.textByte5());
            host.setWidgetFlag148(widget(ALBUM_CELL_SLOTS.levelValue), 1);
            if (ALBUM_SPECIAL_CARDS.includes(card)) {
                host.setWidgetLine(widget(ALBUM_CELL_SLOTS.text), host.resourceGet(save + 0x1d), card);
            } else {
                host.setWidgetFlag144(widget(ALBUM_CELL_SLOTS.text), 0);
                host.setWidgetLine(widget(ALBUM_CELL_SLOTS.ap), host.resourceGet(save + 0x24), 6);
                host.setWidgetNumber(widget(ALBUM_CELL_SLOTS.apValue), 0, host.textByte1());
                host.setWidgetFlag148(widget(ALBUM_CELL_SLOTS.apValue), 1);
                host.setWidgetLine(widget(ALBUM_CELL_SLOTS.hp), host.resourceGet(save + 0x24), 7);
                host.setWidgetNumber(widget(ALBUM_CELL_SLOTS.hpValue), 0, host.textByte2());
                host.setWidgetFlag148(widget(ALBUM_CELL_SLOTS.hpValue), 1);
                fullLayout = true;
            }
        }
    } else {
        for (const slot of [ALBUM_CELL_SLOTS.card, ALBUM_CELL_SLOTS.program, ALBUM_CELL_SLOTS.count,
            ALBUM_CELL_SLOTS.level, ALBUM_CELL_SLOTS.levelValue, ALBUM_CELL_SLOTS.text]) {
            host.setWidgetFlag144(widget(slot), 0);
        }
    }

    if (!fullLayout) {
        host.setWidgetFlag144(widget(ALBUM_CELL_SLOTS.ap), 0);
        host.setWidgetFlag144(widget(ALBUM_CELL_SLOTS.apValue), 0);
        host.setWidgetFlag144(widget(ALBUM_CELL_SLOTS.hp), 0);
        host.setWidgetFlag144(widget(ALBUM_CELL_SLOTS.hpValue), 0);
    }
}

export interface AlbumPopupMemory {
    read32(addr: number): number;
    write32(addr: number, value: number): void;
}

export interface AlbumPopupHost {
    /** F0x80014504(handler, size, extra) -> the new task object. */
    allocate(handler: number, size: number, extra: number): number;
}

/** F0x80083008(): build the album popup object and return it. */
export function albumMakePopup(mem: AlbumPopupMemory, host: AlbumPopupHost): number {
    const obj = host.allocate(ALBUM_POPUP_HANDLER, ALBUM_POPUP_SIZE, 0) >>> 0;
    mem.write32(obj + ALBUM_POPUP_FIELDS.method64, ALBUM_POPUP_METHOD64);
    mem.write32(obj + ALBUM_POPUP_FIELDS.depth50, 0x1000);
    mem.write32(obj + ALBUM_POPUP_FIELDS.scale54, 0);
    return obj;
}

// ── the popup's fade start and tick (F0x80082D88 / F0x80082F54) ─────────────
// The same 0..0xFF00 accumulator family as the fight report's fade and the
// pause menu's dim quad: a direction-0 start rises from 0, any other direction
// falls from 0xFF00, by 0xFF00 / frames per frame, and the level saturates at
// its end (state 2). The claim is `stcrdabm-fader-lerp-addresses-2026-10-11`;
// the oracle is tests/lane-b/album-popup-fade.test.js.

export interface AlbumPopupFadeHost {
    /** obj+0x28(1): the base start method. */
    callMethod(target: number, slot: number, args: number[]): void;
    /** obj+0x38(obj): the parked base method. */
    baseMethod38(obj: number): void;
    /** F0x80082E10(obj): submit the fade quad and its draw-mode word. */
    drawFade(obj: number): void;
}

/** F0x80082D88(obj, direction, frames): start the popup's fade ramp. */
export function albumPopupFadeStart(
    mem: AlbumPopupMemory,
    obj: number,
    direction: number,
    frames: number,
    host: Pick<AlbumPopupFadeHost, "callMethod">,
): void {
    host.callMethod(obj, 0x28, [1]);
    mem.write32(obj + 0x10, 1);
    mem.write32(obj + 0x58, direction | 0);
    // MIPS signed div: a zero divisor yields -1 for a positive dividend.
    const step = frames === 0 ? -1 : Math.trunc(0xff00 / (frames | 0));
    if ((direction | 0) === 0) {
        mem.write32(obj + 0x5c, 0);
        mem.write32(obj + 0x60, step | 0);
        return;
    }
    mem.write32(obj + 0x5c, 0xff00);
    mem.write32(obj + 0x60, (-step) | 0);
}

/** F0x80082F54(obj): one frame of the popup fade. */
export function albumPopupFadeTick(mem: AlbumPopupMemory, obj: number, host: AlbumPopupFadeHost): void {
    const state = mem.read32(obj + 0x0c) | 0;
    if (state === 1) {
        if ((mem.read32(obj + 0x10) | 0) === 0) return;
        const value = ((mem.read32(obj + 0x5c) | 0) + (mem.read32(obj + 0x60) | 0)) | 0;
        mem.write32(obj + 0x5c, value);
        if ((mem.read32(obj + 0x58) | 0) === 0) {
            if (value > 0xff00) {
                mem.write32(obj + 0x5c, 0xff00);
                mem.write32(obj + 0x0c, 2);
            }
        } else if (value < 0) {
            mem.write32(obj + 0x5c, 0);
            mem.write32(obj + 0x0c, 2);
        }
        host.drawFade(obj);
        return;
    }
    if (state === 2) {
        host.drawFade(obj);
        return;
    }
    if (state === 3) return;
    // State 0, a negative state and every state from 4 up park the object.
    host.baseMethod38(obj);
}
