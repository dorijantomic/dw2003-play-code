// The EQUIPMENT pause page (choose a slot, then an item for it), translated from the
// original pro/ststatus bodies, with the scroll-bar object it borrows.
//
// Part D of docs/plans/2026-09-28-translated-game-completion-plan.md. Oracle:
// tests/lane-b/pause-equipment.test.js runs each original through engine/native.
//
//   F0x800882C8 equipFactory      build the page object (0x70C bytes, 0xA4 extra).
//   F0x80088214 equipRoot         build, tick, draw, and clear the parent's flag.
//   F0x80086498 equipCtor         the slot list, item list and info widgets.
//   F0x80086680 equipSlotNames    the six equipped item names.
//   F0x800867B8 equipItemInfo     the highlighted item's description and kind hint.
//   F0x80086900 equipListRows     up to eight rows of items with their counts.
//   F0x80086C78 equipSlotHeader   the slot title and its current item.
//   F0x80086DD4 equipDraw         panels, icons, list markers and arrows.
//   F0x8008744C equipTick         open, pick a slot, pick an item, swap, close.
//   F0x8009A344 wieldCompatible   whether a member can wield an item in a slot.
//   F0x8009A3E8 equipApply        move an item onto a member and return the old one.
//   F0x80099684 scrollBarFactory  the list scroll bar (0x9C bytes).
//   F0x80099430 / 0x8009943C / 0x80099450 / 0x80099464   its four setters.
//   F0x8009946C scrollBarTick     move the thumb and submit its quad.
//
// Object fields: +0x10 sub-state; +0x5C roster slot; +0x60 chosen slot; +0x64 cursor
// row; +0x68 list length; +0x6C scroll top; +0x70/+0x74 arrow blink; +0x78.. the item
// list (halfwords, the first -1 for "take off"); +0x3A0 the candidate items;
// +0x6C8 the slot header is up; +0x6CC/+0x6DC/+0x6EC/+0x6FC panel folds (scale at +8).
// Widget block: +0 title; +4 six slot names; +0x1C slot cursor; +0x20 slot title;
// +0x24 item cursor; +0x28 eight rows of three; +0x88/+0x8C info; +0x90/+0x94 current
// item; +0x98 the scroll bar.
import { PAUSE_CTX, PAUSE_LANGUAGE_CELL, type PauseMemory, type PauseServices } from "./pause-services.ts";
import { itemIconClip, itemRecord } from "../../item-record.ts";
import { pauseEquipAdmitsRecord } from "../../equipment.ts";
import { inventoryDispatch } from "./pause-inventory.ts";
import { findRegisteredHandleByKey } from "../../display-service.ts";
import type { PartyCardFillHost } from "../party-card-fill.ts";

export const EQUIP_HANDLER = 0x80088214;
export const EQUIP_SIZE = 0x70c;
export const EQUIP_EXTRA = 0xa4;
export const SCROLL_BAR_HANDLER = 0x8009946c;
export const SCROLL_BAR_SIZE = 0x9c;
const SLOT_TITLES = 0x8009a7ac;
const KIND_HINTS = 0x8009a7c4;
const SLOT_TABS = 0x8009a7e4;
const PARENT_PREVIEW = 0x148;

const s16 = (v: number): number => (v << 16) >> 16;
const lang = (mem: PauseMemory): number => mem.read32(PAUSE_LANGUAGE_CELL) | 0;

export interface EquipHost extends PauseServices {
    alloc(handler: number, size: number, extra: number): number;
    cards: Pick<PartyCardFillHost, "rosterSlot" | "cardRecord">;
    /** F0x80099684(): build the scroll bar object. */
    scrollBarFactory(): number;
}

const bankOf = (mem: PauseMemory, host: EquipHost, offset: number): number => host.languageBank(lang(mem) + offset);
const itemKind = (mem: PauseMemory, id: number): number => mem.read8((mem.read32(itemRecord(id)) | 0) + 2);
const itemSub = (mem: PauseMemory, id: number): number => mem.read8((mem.read32(itemRecord(id)) | 0) + 3);

/** F0x8009A344(shift, slot, item): nonzero when the member can wield the item there.
 *  The rule itself is the shared `pauseEquipAdmitsRecord` in
 *  engine/dw3/equipment.ts, which the legacy pause panel's picker also runs, so
 *  one port decides both pages' rows. Only the two bytes the original reads are
 *  fetched from RAM here: the descriptor (equip-stat +2) and the wear mask
 *  (equip-stat +4, the starter-line mask `F0x8009A344` shifts by the member's
 *  roster slot). */
export function wieldCompatible(mem: PauseMemory, shift: number, slot: number, item: number): number {
    if (item === -1) return 1;
    const record = mem.read32(itemRecord(item)) | 0;
    return pauseEquipAdmitsRecord(slot, mem.read8(record + 2), mem.read8(record + 4), shift) ? 1 : 0;
}

/** F0x8009A3E8(member, slot, item): put the item on the member and bag the old one. */
export function equipApply(mem: PauseMemory, member: number, slot: number, item: number, host: EquipHost): void {
    const card = host.cards.cardRecord(member) >>> 0;
    const own = card + 0x3c0 + slot * 2;
    const bump = (id: number, gain: number) => {
        mem.write8(PAUSE_CTX + id + 0x20f, mem.read8(PAUSE_CTX + id + 0x20f) + gain);
        mem.write8(PAUSE_CTX + id + 0x7c, mem.read8(PAUSE_CTX + id + 0x7c) - gain);
    };
    const held = mem.read16s(own);
    if (held !== 0) {
        bump(held, -1);
        if (itemKind(mem, held) === 7) {
            mem.write16(card + 0x3c4, 0);
            mem.write16(card + 0x3c6, 0);
        } else {
            mem.write16(own, 0);
        }
    }
    item = s16(item);
    if (item <= 0) return;
    const kind = itemKind(mem, item);
    if (kind === 7) {
        let at = card + 0x3c4;
        if (mem.read16s(card + 0x3c4) === 0) at = mem.read16s(card + 0x3c6) !== 0 ? card + 0x3c6 : 0;
        if (at !== 0) {
            bump(mem.read16s(at), -1);
            mem.write16(at, 0);
        }
    } else if (kind === 8) {
        const sub = itemSub(mem, item);
        for (let i = 0; i < 2; i++) {
            const p = card + 0x3c8 + i * 2;
            const other = mem.read16s(p);
            if (other !== 0 && itemSub(mem, other) === sub) {
                bump(other, -1);
                mem.write16(p, 0);
            }
        }
    }
    bump(item, 1);
    if (itemKind(mem, item) === 7) {
        mem.write16(card + 0x3c4, item);
        mem.write16(card + 0x3c6, item);
        return;
    }
    mem.write16(own, item);
}

/** F0x80099684(): build the scroll bar object. */
export function scrollBarFactory(mem: PauseMemory, host: Pick<EquipHost, "alloc">): number {
    const obj = host.alloc(SCROLL_BAR_HANDLER, SCROLL_BAR_SIZE, 0);
    mem.write32(obj + 0x8c, 0x80099430);
    mem.write32(obj + 0x90, 0x8009943c);
    mem.write32(obj + 0x94, 0x80099450);
    mem.write32(obj + 0x98, 0x80099464);
    mem.write32(obj + 0x50, 0x1000);
    mem.write32(obj + 0x54, 0);
    return obj;
}

/** F0x80099430(obj, x, width): where the bar sits. */
export function scrollBarPlace(mem: PauseMemory, obj: number, x: number, width: number): void {
    mem.write32(obj + 0x58, x);
    mem.write32(obj + 0x60, width);
}

/** F0x8009943C(obj, top, bottom): the bar's vertical run. */
export function scrollBarRun(mem: PauseMemory, obj: number, top: number, bottom: number): void {
    mem.write32(obj + 0x7c, top);
    mem.write32(obj + 0x80, bottom);
    mem.write32(obj + 0x78, 1);
}

/** F0x80099450(obj, position, length): the list position and length. */
export function scrollBarList(mem: PauseMemory, obj: number, position: number, length: number): void {
    mem.write32(obj + 0x6c, position);
    mem.write32(obj + 0x70, length);
    mem.write32(obj + 0x68, 1);
}

/** F0x80099464(obj, step): the thumb's step index. */
export function scrollBarStep(mem: PauseMemory, obj: number, step: number): void {
    mem.write32(obj + 0x74, step);
}

export interface ScrollBarHost extends PauseServices {
    /** [view+0x138](view, depth) = F0x8001DFA8: the ordering-table bucket head cell. */
    otBucket(view: number, depth: number): number;
    /** [0x8004DE10+0x158](): the primitive cursor. */
    cursor(): number;
    /** [0x8004DE10+0x15C](p): move the primitive cursor. */
    setCursor(p: number): void;
}

/** F0x8009946C(obj, arg): move the thumb and submit its quad. */
export function scrollBarTick(mem: PauseMemory, obj: number, arg: number, host: ScrollBarHost): void {
    const r = (off: number) => mem.read32(obj + off) | 0;
    const state = r(0xc);
    if (state !== 1) {
        if ((state < 2 || state >= 4) && r(0x78) !== 0 && r(0x68) !== 0) {
            const span = ((r(0x80) - r(0x7c)) << 8) | 0;
            const step = (span / r(0x70)) | 0;
            mem.write32(obj + 0x88, step);
            mem.write32(obj + 0x64, Math.imul(step, r(0x6c)));
            host.callMethod(obj, 0x38, [arg, Math.imul(step, r(0x6c))]);
        }
        return;
    }
    const view = findRegisteredHandleByKey(mem, r(0x50));
    const bucket = host.otBucket(view, r(0x54));
    const prim = host.cursor() >>> 0;
    const t = r(0x74);
    if (t < r(0x70) - 1) {
        const top = (r(0x7c) + ((Math.imul(t, r(0x88)) | 0) >> 8)) | 0;
        mem.write32(obj + 0x5c, top);
        const limit = (r(0x80) - (r(0x64) >> 8)) | 0;
        if (limit < top) mem.write32(obj + 0x5c, limit);
    } else {
        mem.write32(obj + 0x5c, (r(0x80) - (r(0x64) >> 8)) | 0);
    }
    mem.write8(prim + 3, 5);
    mem.write8(prim + 7, 0x28);
    mem.write8(prim + 6, 0xff);
    mem.write8(prim + 5, 0xff);
    mem.write8(prim + 4, 0xff);
    const left = mem.read16(obj + 0x58);
    mem.write16(prim + 0x10, left);
    mem.write16(prim + 8, left);
    const right = (mem.read16(obj + 0x58) + mem.read16(obj + 0x60)) & 0xffff;
    mem.write16(prim + 0x14, right);
    mem.write16(prim + 0xc, right);
    const top = mem.read16(obj + 0x5c);
    mem.write16(prim + 0xe, top);
    mem.write16(prim + 0xa, top);
    const bottom = (mem.read16(obj + 0x5c) + (r(0x64) >> 8)) & 0xffff;
    mem.write16(prim + 0x16, bottom);
    mem.write16(prim + 0x12, bottom);
    mem.write32(prim, ((mem.read32(prim) & 0xff000000) | (mem.read32(bucket) & 0xffffff)) | 0);
    mem.write32(bucket, ((mem.read32(bucket) & 0xff000000) | (prim & 0xffffff)) | 0);
    host.setCursor(prim + 0x18);
}

/** F0x800882C8(parent): build the page object. */
export function equipFactory(mem: PauseMemory, parent: number, host: EquipHost): number {
    const obj = host.alloc(EQUIP_HANDLER, EQUIP_SIZE, EQUIP_EXTRA);
    mem.write32(obj + 0x54, 0x1000);
    mem.write32(obj + 0x58, 4);
    mem.write32(obj + 0x50, parent);
    mem.write32(obj + 0x5c, host.cards.rosterSlot(mem.read32(parent + 0x7c) | 0));
    return obj;
}

/** F0x80086498(obj, ui): the page's widgets. */
export function equipCtor(mem: PauseMemory, obj: number, ui: number, host: EquipHost): void {
    const layer = () => mem.read32(obj + 0x54) | 0;
    const order = () => (mem.read32(obj + 0x58) | 0) - 1;
    const text = (x: number, y: number) => host.createText(layer(), 1, x, y);
    const put = (off: number, widget: number) => mem.write32(ui + off, widget);
    put(0, text(0x98, 0x13));
    const cursor = host.createIcon(layer(), order(), 0xa5, 0x31);
    put(0x1c, cursor);
    host.callMethod(cursor, 0x80, [0]);
    for (let i = 0; i < 6; i++) put(4 + i * 4, text(0xc0, 0x31 + i * 0xe));
    put(0x20, text(0x7f, 0x3b));
    const pick = host.createIcon(layer(), order(), 0x86, 0x4b);
    put(0x24, pick);
    host.callMethod(pick, 0x80, [0]);
    for (let i = 0; i < 8; i++) {
        const y = 0x4b + i * 0xe;
        put(0x28 + i * 0xc, text(0xa0, y));
        put(0x2c + i * 0xc, text(0x10d, y));
        put(0x30 + i * 0xc, text(0x120, y));
    }
    put(0x88, text(0x14, 0xc6));
    put(0x8c, text(0x14, 0xd5));
    put(0x90, text(0xa7, 0x13));
    put(0x94, text(0xc0, 0x23));
}

/** F0x80086680(obj, ui, show): the six equipped item names. */
export function equipSlotNames(mem: PauseMemory, obj: number, ui: number, show: number, host: EquipHost): void {
    const w = (off: number) => mem.read32(ui + off) | 0;
    if (show === 0) {
        for (let i = 0; i < 6; i++) host.callMethod(w(4 + i * 4), 0x144, [0]);
        return;
    }
    const card = host.cards.cardRecord(mem.read32(obj + 0x5c) | 0) >>> 0;
    for (let i = 0; i < 6; i++) {
        const item = mem.read16s(card + 0x3c0 + i * 2);
        if (item > 0) host.callMethod(w(4 + i * 4), 0x114, [bankOf(mem, host, 0x6a), item]);
        else host.callMethod(w(4 + i * 4), 0x114, [bankOf(mem, host, 0xb0), s16(mem.read32(SLOT_TITLES + i * 4))]);
    }
}

/** F0x800867B8(obj, ui, item): the highlighted item's description and kind hint. */
export function equipItemInfo(mem: PauseMemory, obj: number, ui: number, item: number, host: EquipHost): void {
    const w = (off: number) => mem.read32(ui + off) | 0;
    item = s16(item);
    if (item > 0) {
        host.callMethod(w(0x88), 0x114, [bankOf(mem, host, 0x63), item]);
        if (((mem.read32(obj + 0x60) - 2) >>> 0) < 2) {
            const kind = itemKind(mem, item);
            host.callMethod(w(0x8c), 0x114, [bankOf(mem, host, 0xb0), mem.read32(KIND_HINTS + (kind - 1) * 4) | 0]);
            return;
        }
    } else {
        host.callMethod(w(0x88), 0x114, [host.languageBank(lang(mem) + 0xb0), 0x51]);
    }
    host.callMethod(w(0x8c), 0x144, [0]);
}

/** F0x80086900(obj, ui, show): up to eight rows of items with their counts. */
export function equipListRows(mem: PauseMemory, obj: number, ui: number, show: number, host: EquipHost): void {
    const r = (off: number) => mem.read32(obj + off) | 0;
    const w = (off: number) => mem.read32(ui + off) | 0;
    if (show === 0) {
        host.callMethod(w(0x20), 0x144, [0]);
        for (let i = 0; i < 8; i++) {
            host.callMethod(w(0x28 + i * 0xc), 0x144, [0]);
            host.callMethod(w(0x2c + i * 0xc), 0x144, [0]);
            host.callMethod(w(0x30 + i * 0xc), 0x144, [0]);
        }
        host.callMethod(w(0x88), 0x144, [0]);
        host.callMethod(w(0x8c), 0x144, [0]);
        return;
    }
    host.callMethod(w(0x20), 0x114, [bankOf(mem, host, 0xb0), mem.read32(SLOT_TITLES + r(0x60) * 4) | 0]);
    for (let i = 0; i < 8; i++) {
        const at = r(0x6c) + i;
        if (r(0x68) - 1 < at) break;
        const item = mem.read16s(obj + at * 2 + 0x78);
        const row = i * 0xc;
        if (item > 0) {
            host.callMethod(w(0x28 + row), 0x138, [wieldCompatible(mem, r(0x5c), r(0x60), item) !== 0 ? 0 : 7]);
            host.callMethod(w(0x28 + row), 0x114, [bankOf(mem, host, 0x6a), item]);
            host.callMethod(w(0x2c + row), 0x114, [bankOf(mem, host, 0xb0), 0x40]);
            host.callMethod(w(0x2c + row), 0x148, [1]);
            host.callMethod(w(0x30 + row), 0x118, [0, (mem.read8(PAUSE_CTX + item + 0x7c) << 24) >> 24]);
            host.callMethod(w(0x30 + row), 0x148, [1]);
        } else {
            if (item === -1) {
                host.callMethod(w(0x28 + row), 0x114, [bankOf(mem, host, 0xb0), 0x45]);
                host.callMethod(w(0x28 + row), 0x138, [0]);
            } else {
                host.callMethod(w(0x28 + row), 0x144, [0]);
            }
            host.callMethod(w(0x88), 0x144, [0]);
            host.callMethod(w(0x8c), 0x144, [0]);
            host.callMethod(w(0x2c + row), 0x144, [0]);
            host.callMethod(w(0x30 + row), 0x144, [0]);
        }
    }
    equipItemInfo(mem, obj, ui, mem.read16s(obj + (r(0x64) + r(0x6c)) * 2 + 0x78), host);
}

/** F0x80086C78(obj, ui, show): the slot title and its current item. */
export function equipSlotHeader(mem: PauseMemory, obj: number, ui: number, show: number, host: EquipHost): void {
    const w = (off: number) => mem.read32(ui + off) | 0;
    if (show === 0) {
        host.callMethod(w(0x90), 0x144, [0]);
        host.callMethod(w(0x94), 0x144, [0]);
        return;
    }
    const slot = mem.read32(obj + 0x60) | 0;
    const held = mem.read16s(slot * 2 + (host.cards.cardRecord(mem.read32(obj + 0x5c) | 0) >>> 0) + 0x3c0);
    host.callMethod(w(0x90), 0x114, [bankOf(mem, host, 0xb0), 0x20]);
    if (held > 0) host.callMethod(w(0x94), 0x114, [bankOf(mem, host, 0x6a), held]);
    else host.callMethod(w(0x94), 0x114, [bankOf(mem, host, 0xb0), s16(mem.read32(SLOT_TITLES + slot * 4))]);
}

/** F0x80086DD4(obj): panels, icons, list markers and arrows. */
export function equipDraw(mem: PauseMemory, obj: number, host: EquipHost): void {
    const r = (off: number) => mem.read32(obj + off) | 0;
    const pack = (id: number) => host.packHandle(id);
    const card = host.cards.cardRecord(r(0x5c)) >>> 0;
    host.drawInit();
    if (r(0x6d4) !== 0) {
        host.draw74(0x140, 0);
        host.draw7C(r(0x54), 6);
        const fold = r(0x6d4);
        if (fold !== 0x1000) {
            host.draw8C(fold, 0x1000, 0x1000);
            host.draw94(0x140, 0x19);
        }
        host.drawSprite(pack(0x02860000), 0x18, 0x22, 0xd);
    }
    host.draw7C(r(0x54), r(0x58));
    const names = r(0x6e4);
    if (names !== 0) {
        if (names !== 0x1000) {
            host.draw8C(names, 0x1000, 0x1000);
            host.draw94(0x140, 0x58);
        } else {
            host.draw8C(0x1000, 0x1000, 0x1000);
            host.draw74(0x140, 0);
            let y = 0x31;
            for (let i = 0; i < 6; i++) {
                const item = mem.read16s(card + 0x3c0 + i * 2);
                if (item > 0) {
                    const sheet = pack(0x02860000);
                    host.drawSprite(sheet, itemIconClip(mem, item), 0xb2, y);
                }
                y += 0xe;
            }
        }
        host.draw74(0x280, 0x100);
        host.drawSprite(pack(0x04040000), 0x2a, 0x9d, 0x28);
    }
    const list = r(0x6f4);
    if (list !== 0) {
        if (list !== 0x1000) {
            host.draw8C(list, 0x1000, 0x1000);
            host.draw94(0x140, 0x89);
        } else {
            host.draw8C(0x1000, 0x1000, 0x1000);
            let y = 0x4b;
            for (let i = 0; i < 8; i++) {
                const at = r(0x6c) + i;
                if (at < r(0x68)) {
                    const item = mem.read16s(obj + at * 2 + 0x78);
                    if (item === -1 || item > 0) {
                        host.draw74(0x280, 0x100);
                        host.drawSprite(pack(0x04040000), 0x31, 0x91, y);
                        if (item > 0) {
                            host.draw74(0x140, 0);
                            const sheet = pack(0x02860000);
                            host.drawSprite(sheet, itemIconClip(mem, item), 0x91, y);
                        }
                    }
                }
                y += 0xe;
            }
            if (r(0x68) >= 9) {
                if (host.frameCount() - r(0x74) >= 9) {
                    mem.write32(obj + 0x74, host.frameCount());
                    mem.write32(obj + 0x70, 1 - r(0x70));
                }
                host.draw74(0x280, 0x100);
                if (r(0x70) !== 0) {
                    if (r(0x6c) > 0) host.drawSprite(pack(0x04040000), 0x32, 0x126, 0x45);
                    if (r(0x6c) < r(0x68) - 8) host.drawSprite(pack(0x04040000), 0x33, 0x126, 0xb3);
                }
            }
        }
        host.draw74(0x280, 0x100);
        host.drawSprite(pack(0x04040000), 0x2b, 0x77, 0x39);
        if (r(0x6f4) !== 0x1000) host.draw94(0, 0xd3);
        host.drawSprite(pack(0x04040000), 0x20, 0, 0xc2);
    }
    const header = r(0x704);
    if (header !== 0) {
        if (header !== 0x1000) {
            host.draw8C(header, 0x1000, 0x1000);
            host.draw94(0x140, 0x20);
        } else {
            host.draw8C(0x1000, 0x1000, 0x1000);
            if (r(0x6c8) !== 0) {
                const held = mem.read16s(r(0x60) * 2 + card + 0x3c0);
                if (held > 0) {
                    host.draw74(0x140, 0);
                    const sheet = pack(0x02860000);
                    host.drawSprite(sheet, itemIconClip(mem, held), 0xb2, 0x23);
                }
            }
        }
        host.draw74(0x280, 0x100);
        host.drawSprite(pack(0x04040000), 0x2c, 0xa0, 0x11);
    }
}

/** F0x8008744C(obj, ui): open, pick a slot, pick an item, swap, close. */
export function equipTick(mem: PauseMemory, obj: number, ui: number, host: EquipHost): void {
    const r = (off: number) => mem.read32(obj + off) | 0;
    const w = (off: number, v: number) => mem.write32(obj + off, v | 0);
    const at = (off: number) => mem.read32(ui + off) | 0;
    const bit = (bits: number, code: number) => (bits >> host.padBit(0, code)) & 1;
    const pressed = (code: number) => bit(host.padPressed(0), code) !== 0;
    const pressedOrRepeat = (code: number) =>
        bit(host.padPressed(0), code) !== 0 || bit(host.padRepeat(0), code) !== 0;
    const start = (fold: number, open: number) => host.foldStart(obj + fold, open);
    const tick = (fold: number) => host.foldTick(obj + fold) !== 0;
    const advance = () => w(0x10, r(0x10) + 1);
    const parent = () => r(0x50);
    const preview = (slot: number, item: number) => host.callMethod(parent(), PARENT_PREVIEW, [slot, item]);
    const scrollBar = () => at(0x98);
    switch (r(0x10)) {
        default:
            start(0x6cc, 1);
            advance();
            return;
        case 1:
            if (tick(0x6cc)) {
                host.callMethod(at(0), 0x114, [bankOf(mem, host, 0xb0), 0x3f]);
                start(0x6dc, 1);
                advance();
            }
            return;
        case 2:
            if (tick(0x6dc)) {
                equipSlotNames(mem, obj, ui, 1, host);
                host.callMethod(at(0x1c), 0x80, [1]);
                advance();
            }
            return;
        case 3: {
            const before = r(0x60);
            if (pressedOrRepeat(4)) {
                const v = r(0x60) - 1;
                w(0x60, v);
                if (v < 0) w(0x60, 0);
            } else if (pressedOrRepeat(6)) {
                const v = r(0x60) + 1;
                w(0x60, v);
                if (v >= 6) w(0x60, 5);
            }
            if (before !== r(0x60)) {
                host.playSound(0x8004513e);
                host.callMethod(at(0x1c), 0x84, [0xa5, r(0x60) * 0xe + 0x31]);
            } else if (pressed(0xd)) {
                host.playSound(0x8004503c);
                const count = inventoryDispatch(mem, mem.read32(SLOT_TABS + r(0x60) * 4) | 0, obj + 0x3a0);
                let next = 1;
                for (let i = 0; i < count; i++) {
                    const item = mem.read16s(obj + 0x3a0 + i * 2);
                    if (wieldCompatible(mem, r(0x5c), r(0x60), item) !== 0) {
                        mem.write16(obj + 0x78 + next * 2, item);
                        next++;
                    }
                }
                let tail = next;
                for (let i = 0; i < count; i++) {
                    const item = mem.read16s(obj + 0x3a0 + i * 2);
                    if (wieldCompatible(mem, r(0x5c), r(0x60), item) === 0) {
                        mem.write16(obj + 0x78 + tail * 2, item);
                        tail++;
                    }
                }
                w(0x68, count + 1);
                mem.write16(obj + 0x78, 0xffff);
                w(0x10, 0xa);
            }
            if (pressed(0xe)) {
                host.playSound(0x800450bd);
                w(0x10, 0x32);
            }
            return;
        }
        case 0xa:
            start(0x6dc, 0);
            equipSlotNames(mem, obj, ui, 0, host);
            host.callMethod(at(0x1c), 0x80, [0]);
            w(0x64, 0);
            w(0x6c, 0);
            advance();
            return;
        case 0xc:
            if (tick(0x6cc)) {
                start(0x6fc, 1);
                advance();
            }
            return;
        case 0xd:
            if (tick(0x6fc)) {
                w(0x6c8, 1);
                equipSlotHeader(mem, obj, ui, 1, host);
                start(0x6ec, 1);
                advance();
            }
            return;
        case 0xe:
            if (tick(0x6ec)) {
                equipListRows(mem, obj, ui, 1, host);
                host.callMethod(at(0x24), 0x84, [0x89, 0x4b]);
                host.callMethod(at(0x24), 0x80, [1]);
                preview(r(0x60), 0);
                if (r(0x68) >= 9) {
                    const bar = host.scrollBarFactory();
                    mem.write32(ui + 0x98, bar);
                    host.callMethod(bar, 0x8c, [0x125, 0xc]);
                    host.callMethod(at(0x98), 0x90, [0x4e, 0xb3]);
                    host.callMethod(at(0x98), 0x94, [8, r(0x68)]);
                    host.callMethod(at(0x98), 0x98, [0]);
                }
                advance();
            }
            return;
        case 0xf: {
            const beforeRow = r(0x64);
            const beforeTop = r(0x6c);
            if (r(0x68) >= 9) {
                const pageKey = (hold: number, key: number) =>
                    (bit(host.padHeld(0), hold) === 0 && bit(host.padPressed(0), key) !== 0)
                    || (bit(host.padHeld(0), hold) === 0 && bit(host.padRepeat(0), key) !== 0);
                if (pageKey(0xb, 0xa)) {
                    const v = r(0x6c) - 8;
                    w(0x6c, v);
                    if (v < 0) w(0x6c, 0);
                } else if (pageKey(0xa, 0xb)) {
                    const v = r(0x6c) + 8;
                    const limit = r(0x68) - 8;
                    w(0x6c, v);
                    if (limit < v) w(0x6c, limit);
                }
            }
            if (pressedOrRepeat(4)) {
                const v = r(0x64) - 1;
                w(0x64, v);
                if (v < 0) {
                    w(0x64, 0);
                    const t = r(0x6c) - 1;
                    w(0x6c, t);
                    if (t < 0) w(0x6c, 0);
                }
            } else if (pressedOrRepeat(6)) {
                if (r(0x68) < 8) {
                    const v = r(0x64) + 1;
                    const limit = r(0x68) - 1;
                    w(0x64, v);
                    if (limit < v) w(0x64, limit);
                } else {
                    const v = r(0x64) + 1;
                    w(0x64, v);
                    if (v >= 8) {
                        w(0x64, 7);
                        const t = r(0x6c) + 1;
                        const limit = r(0x68) - 8;
                        w(0x6c, t);
                        if (limit < t) w(0x6c, limit);
                    }
                }
            }
            if (beforeRow !== r(0x64)) {
                host.playSound(0x8004513e);
                host.callMethod(at(0x24), 0x84, [0x86, r(0x64) * 0xe + 0x4b]);
            }
            if (beforeTop !== r(0x6c)) {
                host.playSound(0x8004513e);
                equipListRows(mem, obj, ui, 1, host);
                if (scrollBar() !== 0) host.callMethod(scrollBar(), 0x98, [r(0x6c)]);
            }
            const row = r(0x64);
            const top = r(0x6c);
            const item = mem.read16s(obj + (row + top) * 2 + 0x78);
            if (beforeRow !== row || beforeTop !== top) {
                if (wieldCompatible(mem, r(0x5c), r(0x60), item) !== 0) preview(r(0x60), item);
                else preview(-1, 0);
                equipItemInfo(mem, obj, ui, item, host);
                return;
            }
            if (pressed(0xd)) {
                if (wieldCompatible(mem, r(0x5c), r(0x60), item) !== 0) {
                    equipApply(mem, r(0x5c), r(0x60), item, host);
                    w(0x10, 0x14);
                    w(0x6c8, 0);
                    preview(r(0x60), item);
                    if (scrollBar() !== 0) mem.write32(scrollBar() + 0xc, 3);
                    host.playSound(0x8004503c);
                }
            } else if (pressed(0xe)) {
                host.playSound(0x800450bd);
                preview(-1, 0);
                w(0x10, 0x14);
                w(0x6c8, 0);
                if (scrollBar() !== 0) mem.write32(scrollBar() + 0xc, 3);
            }
            return;
        }
        case 0x14:
            start(0x6ec, 0);
            equipListRows(mem, obj, ui, 0, host);
            host.callMethod(at(0x24), 0x80, [0]);
            advance();
            return;
        case 0x15:
            if (tick(0x6ec)) {
                start(0x6fc, 0);
                equipSlotHeader(mem, obj, ui, 0, host);
                advance();
            }
            return;
        case 0x16:
            if (tick(0x6fc)) w(0x10, 0);
            return;
        case 0x32:
            start(0x6dc, 0);
            equipSlotNames(mem, obj, ui, 0, host);
            host.callMethod(at(0x1c), 0x80, [0]);
            advance();
            return;
        case 0xb:
        case 0x33:
            if (tick(0x6dc)) {
                host.callMethod(at(0), 0x144, [0]);
                start(0x6cc, 0);
                advance();
            }
            return;
        case 0x34:
            if (tick(0x6cc)) w(0xc, 3);
            return;
    }
}

/** F0x80088214(obj, ui): the page's lifecycle. */
export function equipRoot(mem: PauseMemory, obj: number, ui: number, host: EquipHost): void {
    const state = mem.read32(obj + 0xc) | 0;
    if (state === 1) {
        equipTick(mem, obj, ui, host);
        equipDraw(mem, obj, host);
        return;
    }
    if (state === 2) return;
    if (state === 3) {
        mem.write32((mem.read32(obj + 0x50) | 0) + 0x70, 0);
        return;
    }
    host.callMethod(obj, 0x38, []);
    mem.write32(obj + 0x6c, 0);
    equipCtor(mem, obj, ui, host);
    for (const off of [0x6fc, 0x6dc, 0x6ec, 0x6cc]) mem.write32(obj + off, 0xa);
}
