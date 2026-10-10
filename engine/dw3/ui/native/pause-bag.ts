// The ITEMS page's bag (tabbed item grid) and the description / owned-count
// panels, translated from the original pro/ststatus bodies.
//
// Part D of docs/plans/2026-09-28-translated-game-completion-plan.md. Oracle:
// tests/lane-b/pause-bag.test.js runs each original through engine/native.
//
//   F0x80093678 pauseBagFactory     build the bag object (0x70C bytes, 0x6C extra).
//   F0x800936EC pauseBagLoadCategory list the tab's items into the bag.
//   F0x800934E0 pauseBagRoot        the bag's lifecycle: build, then tick and draw.
//   F0x80091E94 pauseBagCtor        the bag's widgets and cursor.
//   F0x80092094 pauseBagTabGridFill the tab title, the 8x2 item names and arrows.
//   F0x80092340 pauseBagArrowsFill  page arrows, then the panels for the pointed item.
//   F0x80092524 pauseBagCursorTick  page and cell movement.
//   F0x80092BC8 pauseBagTick        open, browse, choose or back out, close.
//   F0x80092FAC pauseBagDraw        the grid, cursor, arrows and item icons.
//   F0x8008F0DC itemsOwnedCountsFill the item name, owned and worn counts.
//   F0x8008F2B4 itemsDescOrSortFill the item description, or the use prompt.
//   F0x8008F4E8 itemsDescPanelFold  open or close the description panel.
//   F0x8008F55C itemsWindowReady    the description panel's fold has landed.
import { PAUSE_CTX, PAUSE_LANGUAGE_CELL, type PauseMemory, type PauseServices } from "./pause-services.ts";
import { inventoryCopy } from "./pause-inventory.ts";
import { itemIconClip, itemRecord } from "../../item-record.ts";
import { partyPositionToRosterSlot, persistentRosterSlot } from "../../party-context.ts";
import {
    applyFieldItemEffect, fieldItemMessageId, MESSAGE_NO_EFFECT, MESSAGE_SUCCESS_BASE,
    SOUND_APPLIED, SOUND_NO_EFFECT,
    type FieldItemBoostEntry,
} from "../../item-effect.ts";

export const BAG_HANDLER = 0x800934e0;
export const BAG_SIZE = 0x70c;
export const BAG_EXTRA = 0x6c;
/** The tab table (a category index a tab, bit 31 = list worn items too). */
export const BAG_TAB_TABLE = 0x8009a890;
/** The family-label table indexed by an item's family. */
export const BAG_FAMILY_LABELS = 0x8009a8b8;

const s16 = (v: number): number => (v << 16) >> 16;
const lang = (mem: PauseMemory): number => mem.read32(PAUSE_LANGUAGE_CELL) | 0;
const record = (mem: PauseMemory, item: number): number => itemRecord(item);
const descriptor = (mem: PauseMemory, item: number): number => mem.read32(record(mem, item)) >>> 0;

export interface BagHost extends PauseServices {
    alloc(handler: number, size: number, extra: number): number;
    /** F0x8008ED04(obj, ui, row, show): fill one party row of the items page. */
    rowFill(obj: number, ui: number, row: number, show: number): void;
}

/** The stat-boost table the default arm of the item effect reads (6-byte entries, -1 ends). */
export const ITEM_BOOST_TABLE = 0x8009a8dc;

/** F0x80093678(parent, index, choice): build the bag object. */
export function pauseBagFactory(
    mem: PauseMemory, parent: number, index: number, choice: number, host: BagHost,
): number {
    const obj = host.alloc(BAG_HANDLER, BAG_SIZE, BAG_EXTRA);
    mem.write32(obj + 0x54, 0x1000);
    mem.write32(obj + 0x58, 3);
    mem.write32(obj + 0x50, parent);
    if ((choice | 0) !== 0) mem.write32(obj + 0x60, choice);
    mem.write32(obj + 0x5c, index);
    return obj;
}

/** F0x800936EC(obj): list the chosen tab's items. */
export function pauseBagLoadCategory(mem: PauseMemory, obj: number): void {
    const tab = mem.read32(obj + 0x5c) | 0;
    if (tab === 0) {
        const count = inventoryCopy(mem, mem.read32(BAG_TAB_TABLE) | 0, obj + 0x394);
        mem.write32(obj + 0x68, count);
        for (let i = 0; i < count; i++) mem.write16(obj + 0x6c + i * 2, mem.read16(obj + 0x394 + i * 2));
        return;
    }
    mem.write32(obj + 0x68, inventoryCopy(mem, mem.read32(BAG_TAB_TABLE + tab * 4) | 0, obj + 0x6c));
}

/** F0x800934E0(obj, ui): the bag's lifecycle. */
export function pauseBagRoot(mem: PauseMemory, obj: number, ui: number, host: BagHost): void {
    const state = mem.read32(obj + 0xc) | 0;
    if (state === 1) {
        pauseBagTick(mem, obj, ui, host);
        pauseBagDraw(mem, obj, host);
        return;
    }
    if (state >= 2 && state < 4) return;
    host.callMethod(obj, 0x38, []);
    pauseBagLoadCategory(mem, obj);
    const count = mem.read32(obj + 0x68) | 0;
    const pages = count >> 4;
    mem.write32(obj + 0x6cc, pages !== 0 ? pages + ((count & 0xf) !== 0 ? 1 : 0) : 1);
    const choice = mem.read32(obj + 0x60) | 0;
    if (choice !== 0) {
        let found = false;
        for (let i = 0; mem.read16(obj + 0x6c + i * 2) !== 0; i++) {
            if (choice === s16(mem.read16(obj + 0x6c + i * 2))) {
                mem.write32(obj + 0x6bc, i);
                mem.write32(obj + 0x6c8, i >> 4);
                found = true;
                break;
            }
        }
        if (!found) {
            const parent = mem.read32(obj + 0x50) | 0;
            const at = mem.read32(parent + 0x7c) | 0;
            if (mem.read16(obj + 0x6c + at * 2) > 0) {
                mem.write32(obj + 0x6bc, at);
                mem.write32(obj + 0x6c8, (mem.read32(mem.read32(obj + 0x50) + 0x7c) | 0) >> 4);
            } else if (at - 1 > 0) {
                mem.write32(obj + 0x6bc, at - 1);
                mem.write32(obj + 0x6c8, (at - 1) >> 4);
            }
        }
    }
    pauseBagCtor(mem, obj, ui, host);
}

/** F0x80091E94(obj, ui): the bag's widgets. */
export function pauseBagCtor(mem: PauseMemory, obj: number, ui: number, host: BagHost): void {
    const layer = () => mem.read32(obj + 0x54) | 0;
    mem.write32(ui + 0x0, host.createText(layer(), 1, 0x13, 0x14));
    for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 2; col++) {
            const w = host.createText(layer(), 1, (0x38 + col * 0x83) & 0xffff, 0x25 + row * 0xe);
            mem.write32(ui + row * 8 + col * 4 + 4, w);
            host.callMethod(w, 0x15c, [(mem.read32(obj + 0x58) | 0) - 1]);
        }
    }
    mem.write32(ui + 0x44, host.createText(layer(), 1, 0x9b, 0x9c));
    mem.write32(ui + 0x48, host.createText(layer(), 1, 0x9e, 0x9c));
    mem.write32(ui + 0x4c, host.createText(layer(), 1, 0xb2, 0x9c));
    mem.write32(ui + 0x50, host.createText(layer(), 1, 0x2d, 0x97));
    mem.write32(ui + 0x54, host.createText(layer(), 1, 0x102, 0x97));
    const idx = mem.read32(obj + 0x6bc) | 0;
    const cursor = host.createIcon(layer(), (mem.read32(obj + 0x58) | 0) - 1,
        s16(((idx % 2) * 0x83) + 0x1e), s16(Math.trunc((idx - ((idx >> 4) * 0x10)) / 2) * 0xe + 0x25));
    mem.write32(ui + 0x58, cursor);
    host.callMethod(cursor, 0x80, [0]);
}

/** F0x80092094(obj, ui, show): the tab title, item names and page arrows. */
export function pauseBagTabGridFill(
    mem: PauseMemory, obj: number, ui: number, show: number, host: BagHost,
): void {
    const at = (off: number) => mem.read32(ui + off) | 0;
    const bank = (id: number) => host.languageBank(lang(mem) + id);
    if (show !== 0) {
        host.callMethod(at(0), 0x114, [bank(0xb0), (mem.read32(obj + 0x5c) | 0) + 0x16]);
        let base = (mem.read32(obj + 0x6c8) | 0) * 0x10;
        for (let row = 0; row < 8; row++) {
            for (let col = 0; col < 2; col++) {
                const item = mem.read16(obj + 0x6c + (base + col) * 2);
                const widget = at(row * 8 + col * 4 + 4);
                if (item !== 0) host.callMethod(widget, 0x114, [bank(0x6a), item]);
                else host.callMethod(widget, 0x144, [0]);
            }
            base += 2;
        }
        if ((mem.read32(obj + 0x6c8) | 0) === 0) {
            mem.write32(obj + 0x6d0, 0);
            host.callMethod(at(0x50), 0x144, [0]);
        } else {
            mem.write32(obj + 0x6d0, 1);
            host.callMethod(at(0x50), 0x114, [bank(0xb0), 0x22]);
        }
        if ((mem.read32(obj + 0x6c8) | 0) !== (mem.read32(obj + 0x6cc) | 0) - 1) {
            mem.write32(obj + 0x6d4, 1);
            host.callMethod(at(0x54), 0x114, [bank(0xb0), 0x23]);
            return;
        }
        mem.write32(obj + 0x6d4, 0);
        host.callMethod(at(0x54), 0x144, [0]);
        return;
    }
    host.callMethod(at(0), 0x144, [0]);
    for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 2; col++) host.callMethod(at(row * 8 + col * 4 + 4), 0x144, [0]);
    }
    mem.write32(obj + 0x6d0, 0);
    host.callMethod(at(0x50), 0x144, [0]);
    mem.write32(obj + 0x6d4, 0);
    host.callMethod(at(0x54), 0x144, [0]);
}

/** F0x80092340(obj, ui): page arrows, then the panels for the pointed item. */
export function pauseBagArrowsFill(mem: PauseMemory, obj: number, ui: number, host: BagHost): void {
    const at = (off: number) => mem.read32(ui + off) | 0;
    const bank = (id: number) => host.languageBank(lang(mem) + id);
    if ((mem.read32(obj + 0x6c8) | 0) === 0) {
        mem.write32(obj + 0x6d0, 0);
        host.callMethod(at(0x50), 0x144, [0]);
    } else {
        mem.write32(obj + 0x6d0, 1);
        host.callMethod(at(0x50), 0x114, [bank(0xb0), 0x22]);
    }
    if ((mem.read32(obj + 0x6c8) | 0) === (mem.read32(obj + 0x6cc) | 0) - 1) {
        mem.write32(obj + 0x6d4, 0);
        host.callMethod(at(0x54), 0x144, [0]);
    } else {
        mem.write32(obj + 0x6d4, 1);
        host.callMethod(at(0x54), 0x114, [bank(0xb0), 0x23]);
    }
    pauseBagTabGridFill(mem, obj, ui, 1, host);
    const parent = mem.read32(obj + 0x50) | 0;
    mem.write32(parent + 0x78, mem.read16(obj + 0x6c + (mem.read32(obj + 0x6bc) | 0) * 2));
    itemsOwnedCountsFill(mem, parent, 1, host);
    itemsDescOrSortFill(mem, parent, 1, host);
    host.callMethod(at(0x44), 0x118, [0, (mem.read32(obj + 0x6c8) | 0) + 1]);
    host.callMethod(at(0x44), 0x148, [1]);
    host.callMethod(at(0x48), 0x114, [bank(0xb0), 4]);
    host.callMethod(at(0x4c), 0x118, [0, mem.read32(obj + 0x6cc) | 0]);
    host.callMethod(at(0x4c), 0x148, [1]);
}

const cellX = (idx: number): number => (idx % 2) * 0x83 + 0x1e;
const cellY = (idx: number): number => Math.trunc((idx - ((idx < 0 ? idx + 15 : idx) >> 4) * 16) / 2) * 0xe + 0x25;

/** F0x80092524(obj, ui): page and cell movement; 1 when the cursor moved. */
export function pauseBagCursorTick(mem: PauseMemory, obj: number, ui: number, host: BagHost): number {
    const r = (off: number) => mem.read32(obj + off) | 0;
    const w = (off: number, v: number) => mem.write32(obj + off, v | 0);
    const bit = (bits: number, code: number) => (bits >> host.padBit(0, code)) & 1;
    // `next` is the held word's answer for one shoulder button, the second the
    // pressed or repeat word's for the other, in the original's call order.
    const shoulder = (want: number, other: number): boolean => {
        const heldOther = bit(host.padHeld(0), other) !== 0;
        if (!heldOther && bit(host.padPressed(0), want) !== 0) return true;
        const heldOther2 = bit(host.padHeld(0), other) !== 0;
        return !heldOther2 && bit(host.padRepeat(0), want) !== 0;
    };
    const page = r(0x6c8);
    const idx = r(0x6bc);
    if (shoulder(0xa, 0xb)) {
        w(0x6c8, r(0x6c8) - 1);
        if (r(0x6c8) < 0) w(0x6c8, 0);
    } else if (shoulder(0xb, 0xa)) {
        w(0x6c8, r(0x6c8) + 1);
        const last = r(0x6cc) - 1;
        if (last < r(0x6c8)) w(0x6c8, last);
    }
    if (page !== r(0x6c8)) {
        host.playSound(0x8004513e);
        w(0x6bc, r(0x6c8) * 0x10);
        host.callMethod(mem.read32(ui + 0x58) | 0, 0x84, [0x1e, cellY(r(0x6bc))]);
        pauseBagArrowsFill(mem, obj, ui, host);
        return 1;
    }
    const base = page * 0x10;
    let limit = base | 0xf;
    const last = r(0x68) - 1;
    if (last < limit) limit = last;
    const pressedOrRepeat = (code: number): boolean =>
        bit(host.padPressed(0), code) !== 0 || bit(host.padRepeat(0), code) !== 0;
    if (pressedOrRepeat(4)) {
        w(0x6bc, r(0x6bc) - 2);
        if (r(0x6bc) < base) w(0x6bc, base);
    } else if (pressedOrRepeat(6)) {
        w(0x6bc, r(0x6bc) + 2);
        if (limit < r(0x6bc)) w(0x6bc, limit);
    }
    if (pressedOrRepeat(7)) {
        if (bit(host.padHeld(0), 6) === 0) {
            w(0x6bc, r(0x6bc) - 1);
            if (r(0x6bc) < base) w(0x6bc, base);
        }
    } else if (pressedOrRepeat(5)) {
        if (bit(host.padHeld(0), 4) === 0) {
            w(0x6bc, r(0x6bc) + 1);
            if (limit < r(0x6bc)) w(0x6bc, limit);
        }
    }
    if (idx !== r(0x6bc)) {
        host.playSound(0x8004513e);
        host.callMethod(mem.read32(ui + 0x58) | 0, 0x84, [cellX(r(0x6bc)), cellY(r(0x6bc))]);
        const parent = r(0x50);
        mem.write32(parent + 0x78, mem.read16(obj + 0x6c + r(0x6bc) * 2));
        itemsOwnedCountsFill(mem, parent, 1, host);
        itemsDescOrSortFill(mem, parent, 1, host);
        return 1;
    }
    return 0;
}

/** F0x80092BC8(obj, ui): open, browse, choose or back out, close. */
export function pauseBagTick(mem: PauseMemory, obj: number, ui: number, host: BagHost): void {
    const r = (off: number) => mem.read32(obj + off) | 0;
    const w = (off: number, v: number) => mem.write32(obj + off, v | 0);
    const pressed = (code: number) => ((host.padPressed(0) >> host.padBit(0, code)) & 1) !== 0;
    const advance = () => w(0x10, r(0x10) + 1);
    const at = (off: number) => mem.read32(ui + off) | 0;
    switch (r(0x10)) {
        default:
            w(0x6dc, 0xa);
            w(0x6ec, 0xa);
            host.foldStart(obj + 0x6dc, 1);
            host.foldStart(obj + 0x6ec, 1);
            advance();
            return;
        case 1:
            host.foldTick(obj + 0x6dc);
            if (host.foldTick(obj + 0x6ec) !== 0) {
                host.callMethod(at(0x58), 0x80, [1]);
                pauseBagArrowsFill(mem, obj, ui, host);
                host.callMethod(at(0x58), 0x84, [cellX(r(0x6bc)), cellY(r(0x6bc))]);
                w(0x64, 1);
                advance();
            }
            return;
        case 2:
            if (pauseBagCursorTick(mem, obj, ui, host) === 0) {
                if (pressed(0xd)) {
                    if (r(0x5c) === 0) {
                        const parent = r(0x50);
                        mem.write32(parent + 0x7c, r(0x6bc));
                        mem.write32(parent + 0x78, mem.read16(obj + 0x6c + r(0x6bc) * 2));
                        if ((mem.read8(descriptor(mem, mem.read32(parent + 0x78))) & 1) !== 0) {
                            host.playSound(0x8004503c);
                            itemsDescOrSortFill(mem, r(0x50), -1, host);
                            advance();
                        }
                    }
                } else if (pressed(0xe)) {
                    host.playSound(0x800450bd);
                    mem.write32(r(0x50) + 0x7c, -1);
                    itemsDescPanelFold(mem, r(0x50), 0, host);
                    advance();
                }
            }
            return;
        case 3:
            pauseBagTabGridFill(mem, obj, ui, 0, host);
            host.callMethod(at(0x58), 0x80, [0]);
            host.callMethod(at(0x44), 0x144, [0]);
            host.callMethod(at(0x48), 0x144, [0]);
            host.callMethod(at(0x4c), 0x144, [0]);
            host.foldStart(obj + 0x6dc, 0);
            host.foldStart(obj + 0x6ec, 0);
            w(0x6d0, 0);
            w(0x6d4, 0);
            w(0x64, 0);
            advance();
            return;
        case 4:
            itemsWindowReady(mem, r(0x50), host);
            host.foldTick(obj + 0x6dc);
            if (host.foldTick(obj + 0x6ec) !== 0) w(0xc, 3);
            return;
    }
}

/** F0x80092FAC(obj): the grid, cursor, arrows and item icons. */
export function pauseBagDraw(mem: PauseMemory, obj: number, host: BagHost): void {
    const r = (off: number) => mem.read32(obj + off) | 0;
    const w = (off: number, v: number) => mem.write32(obj + off, v | 0);
    const pack = (id: number) => host.packHandle(id);
    host.drawInit();
    host.draw74(0x280, 0x100);
    host.draw7C(r(0x54), r(0x58));
    if (r(0x6cc) >= 2) {
        if (host.frameCount() - r(0x6c4) >= 0xb) {
            w(0x6c4, host.frameCount());
            const v = r(0x6c0) + 1;
            w(0x6c0, v);
            if (v >= 4) w(0x6c0, 0);
        }
        host.draw88(r(0x6c0));
    }
    if (r(0x6d0) !== 0) host.drawSprite(pack(0x04040000), 0x34, 0x1e, 0x98);
    if (r(0x6d4) !== 0) host.drawSprite(pack(0x04040000), 0x35, 0xfd, 0x98);
    host.draw88(0);
    if (r(0x64) !== 0) {
        const rec = record(mem, mem.read16(obj + 0x6c + r(0x6bc) * 2));
        let row = 0;
        if (((mem.read8(rec + 9) - 0x19) >>> 0) < 2 && (mem.read8(mem.read32(rec)) & 1) !== 0) {
            host.draw74(0x140, 0);
            host.drawSprite(host.packHandle(0x02860000), 0x40, cellX(r(0x6bc)) + 0xb, cellY(r(0x6bc)));
            row = 0;
        }
        let y = 0x25;
        let base = r(0x6c8) * 0x10;
        for (row = 0; row < 8; row++) {
            let x = 0x29;
            for (let col = 0; col < 2; col++) {
                const item = mem.read16(obj + (base + col) * 2 + 0x6c);
                if (item !== 0) {
                    host.draw74(0x140, 0);
                    host.drawSprite(pack(0x02860000), itemIconClip(mem, item), x, y);
                    host.draw74(0x280, 0x100);
                    host.drawSprite(pack(0x04040000), 0x31, x, y);
                }
                x += 0x83;
            }
            y += 0xe;
            base += 2;
        }
    }
    const foldA = r(0x6f4);
    if (foldA !== 0x1000) {
        host.draw8C(foldA, 0x1000, 0x1000);
        host.draw94(0xc, 0x17);
    }
    host.drawSprite(host.packHandle(0x04040000), 0x30, 0xc, 0x12);
    const foldB = r(0x6e4);
    if (foldB !== 0x1000) {
        host.draw8C(0x1000, foldB, 0x1000);
        host.draw94(0xa0, 0x60);
    } else {
        host.draw8C(0x1000, 0x1000, 0x1000);
    }
    host.drawSprite(pack(0x04040000), 0x2e, 0, 0x1e);
    if (r(0x704) !== 0) {
        host.draw7C(r(0x54), r(0x58) - 2);
        const foldC = r(0x704);
        if (foldC !== 0x1000) {
            host.draw8C(foldC, 0x1000, 0x1000);
            host.draw94(0x140, 0x26);
        } else {
            host.draw8C(0x1000, 0x1000, 0x1000);
        }
        host.drawSprite(pack(0x04040000), 0x26, 0xa0, 0x12);
    }
}

/** F0x8008F0DC(obj, show): the item name, owned and worn counts. */
export function itemsOwnedCountsFill(mem: PauseMemory, obj: number, show: number, host: BagHost): void {
    const ui = mem.read32(obj + 0x24) | 0;
    const at = (off: number) => mem.read32(ui + off) | 0;
    const bank = (id: number) => host.languageBank(lang(mem) + id);
    const item = mem.read32(obj + 0x78) | 0;
    if (show !== 0) {
        host.callMethod(at(0xbc), 0x114, [bank(0x6a), item]);
        host.callMethod(at(0xc0), 0x114, [bank(0xb0), 0x20]);
        host.callMethod(at(0xc4), 0x118, [0, mem.read8(PAUSE_CTX + item + 0x20f)]);
        host.callMethod(at(0xc4), 0x148, [1]);
        host.callMethod(at(0xc8), 0x114, [bank(0xb0), 0x16]);
        host.callMethod(at(0xcc), 0x118, [0, mem.read8(PAUSE_CTX + item + 0x7c)]);
        host.callMethod(at(0xcc), 0x148, [1]);
        mem.write32(obj + 0x80, 1);
        return;
    }
    for (const off of [0xbc, 0xc0, 0xc4, 0xc8, 0xcc]) host.callMethod(at(off), 0x144, [0]);
    mem.write32(obj + 0x80, 0);
}

/** F0x8008F2B4(obj, mode): the description (mode 1), the use prompt (2), or hide it. */
export function itemsDescOrSortFill(mem: PauseMemory, obj: number, mode: number, host: BagHost): void {
    const ui = mem.read32(obj + 0x24) | 0;
    const at = (off: number) => mem.read32(ui + off) | 0;
    const bank = (id: number) => host.languageBank(lang(mem) + id);
    if (mode === 1) {
        const item = mem.read32(obj + 0x78) | 0;
        host.callMethod(at(0x88), 0x114, [bank(0x63), item]);
        const rec = record(mem, item);
        if (((mem.read8(rec + 9) - 2) >>> 0) < 0xd) {
            const d = mem.read32(rec) | 0;
            host.callMethod(at(0x8c), 0x114, [bank(0xb0), mem.read32(BAG_FAMILY_LABELS + mem.read8(d + 2) * 4)]);
        }
        return;
    }
    if (mode !== -1) {
        if (mode === 2) {
            host.callMethod(at(0x88), 0x114, [bank(0xb0), 0x31]);
            host.callMethod(at(0x90), 0x114, [bank(0xb0), 0x32]);
            host.callMethod(at(0x94), 0x114, [bank(0xb0), 0x33]);
            host.callMethod(at(0x98), 0x80, [1]);
            return;
        }
        if (mode === -2) {
            host.callMethod(at(0x90), 0x144, [0]);
            host.callMethod(at(0x94), 0x144, [0]);
            host.callMethod(at(0x98), 0x80, [0]);
            return;
        }
        host.callMethod(at(0x88), 0x144, [0]);
    }
    host.callMethod(at(0x8c), 0x144, [0]);
}

/** F0x8008F4E8(obj, open): open or close the description panel. */
export function itemsDescPanelFold(mem: PauseMemory, obj: number, open: number, host: BagHost): void {
    if (open !== 0) {
        host.foldStart(obj + 0x43c, 1);
        return;
    }
    host.foldStart(obj + 0x43c, 0);
    itemsOwnedCountsFill(mem, obj, 0, host);
    itemsDescOrSortFill(mem, obj, 0, host);
}

/** F0x8008F55C(obj): nonzero once the description panel's fold has landed. */
export function itemsWindowReady(_mem: PauseMemory, obj: number, host: BagHost): number {
    return host.foldTick(obj + 0x43c) !== 0 ? 1 : 0;
}

/**
 * The stat block the effect writes into, as the shared applier sees it.
 *
 * `$a0` in F0x8008F584 is the member's stats block - roster record + 0x08, which is
 * why the original's `+0x20` for HP is record +0x28 (see engine/dw3/item-effect.ts's
 * index table). `read`/`write` are the original's `lh`/`sh`: signed reads, so the
 * cap comparisons at `:12898` and `:12959` compare the same way they do there.
 */
function statsBlockTarget(mem: PauseMemory, block: number) {
    return {
        read: (index: number) => s16(mem.read16(block + 0x1c + index * 2)),
        write: (index: number, value: number) => mem.write16(block + 0x1c + index * 2, value),
    };
}

/**
 * The applier's own boost table, read out of the overlay's bytes
 * (`pro/ststatus.s` file 0x17C2C = RAM 0x8009A8DC): six-byte
 * `{selector, index, cap}` entries, a `-1` selector terminating the walk
 * (`:12955` `lh $v1, -0x5724($a2)`, the `$a2` pair `lui 0x800a`).
 *
 * The memory page keeps reading the disc's own table rather than the decoded copy
 * in engine/dw3/item-effect.ts; tests/item-effect-codes.test.js holds the two equal.
 */
export function itemBoostTable(mem: PauseMemory): FieldItemBoostEntry[] {
    const out: FieldItemBoostEntry[] = [];
    for (let at2 = ITEM_BOOST_TABLE; s16(mem.read16(at2)) !== -1; at2 += 6) {
        out.push({
            selector: mem.read16(at2),
            index: mem.read16(at2 + 2),
            cap: s16(mem.read16(at2 + 4)),
        });
    }
    return out;
}

/** F0x8008F584(obj, ui): use the chosen item on the chosen partner. */
export function itemsApplyEffect(mem: PauseMemory, obj: number, ui: number, host: BagHost): void {
    const at = (off: number) => mem.read32(ui + off) | 0;
    const bank = (id: number) => host.languageBank(lang(mem) + id);
    const item = mem.read32(obj + 0x78) | 0;
    const d = descriptor(mem, item);
    const member = mem.read32(obj + 0x3b0) | 0;
    const rec = persistentRosterSlot(partyPositionToRosterSlot(mem, member));
    const type = mem.read8(d + 1);
    // A halfword: `lhu $v0, 0x2($s2)` in F0x8008F584. A byte read cut a Power Charge's 500 to 244.
    const amount = mem.read16(d + 2);
    // The decision itself is shared with the walker's own route
    // (engine/dw3/item-effect.ts); this routine owns the page around it: the two
    // message calls, the sound, and the one consume.
    const outcome = applyFieldItemEffect(
        statsBlockTarget(mem, rec), type, amount, host.rand, itemBoostTable(mem),
    );
    let sound: number;
    if (outcome.flag !== 0) {
        if (outcome.flag === 1) {
            host.callMethod(at(0x88), 0x114, [bank(0xb0), fieldItemMessageId(type)]);
            host.callMethod(at(0x88), 0x118, [1, outcome.used]);
        } else {
            // A heal max HP clipped prints the constant 0x52 and NO amount: that
            // arm makes its own call at `:12935`-`:12936` before it jumps to the
            // tail, so the message id is a literal there and not selector + 0x52.
            host.callMethod(at(0x88), 0x114, [bank(0xb0), MESSAGE_SUCCESS_BASE]);
        }
        const held = PAUSE_CTX + item + 0x7c;
        mem.write8(held, (mem.read8(held) - 1) & 0xff);
        host.rowFill(obj, ui, mem.read32(obj + 0x3b0) | 0, 1);
        sound = SOUND_APPLIED;
    } else {
        host.callMethod(at(0x88), 0x114, [bank(0xb0), MESSAGE_NO_EFFECT]);
        sound = SOUND_NO_EFFECT;
    }
    host.playSound(sound);
}
