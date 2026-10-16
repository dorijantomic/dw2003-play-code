// The CARD FOLDERS pause page (pick a partner for the folder or deck screens), translated
// from the original pro/ststatus bodies, with the dim-quad fade it hands over with.
//
// Part D of docs/plans/2026-09-28-translated-game-completion-plan.md. Oracle:
// tests/lane-b/pause-card-folders.test.js runs each original through engine/native.
//
//   F0x80084C48 cardFoldersFactory  build the page object (0xD4 bytes, 0xA0 extra).
//   F0x80084A98 cardFoldersRoot     count the party, open the folds, build, tick, draw.
//   F0x80083680 cardFoldersCtor     the party-card rows, prompts and cursor.
//   F0x80083B58 cardFoldersChoice   the two choices (folders, deck) and their cursor.
//   F0x80083C94 cardFoldersDraw     cards, portraits and panels.
//   F0x80084238 cardFoldersTick     open, pick a partner, choose, fade out and hand over.
//   F0x80084F10 dimQuadFactory      build the fade object (0x68 bytes).
//   F0x80084E5C dimQuadTick         ramp the level and draw.
//   F0x80084D18 dimQuadDraw         submit the fade quad and its draw-mode word.
//   F0x80084C90 dimQuadStart        start the ramp up (0) or down (1).
//
// Object fields: +0x10 sub-state; +0x14 the chosen screen (1 folders, 2 deck); +0x5C
// party size; +0x60.. portrait frames; +0x6C timer; +0x70 choice; +0x74/+0x84/+0x94
// card folds; +0xA4/+0xB4 the two panel folds; +0xC4 the choice panel fold (scale +8).
// Widget block: +0..+0x83 three 0x2C card rows; +0x84/+0x88 prompts; +0x8C title;
// +0x90 two choices; +0x98 the choice cursor; +0x9C the fade object.
import { PAUSE_LANGUAGE_CELL, type PauseMemory, type PauseServices } from "./pause-services.ts";
import { partyPositionToRosterSlot } from "../../party-context.ts";
import { partyCardRows, ROWS_CARD_FOLDERS } from "./party-card-rows.ts";
import { digimonPictureAt, digimonPictureRowEnded } from "../digimon-picture.ts";
import { findRegisteredHandleByKey } from "../../display-service.ts";
import type { PartyCardFillHost } from "../party-card-fill.ts";

export const CARD_FOLDERS_HANDLER = 0x80084a98;
export const CARD_FOLDERS_SIZE = 0xd4;
export const CARD_FOLDERS_EXTRA = 0xa0;
export const DIM_QUAD_HANDLER = 0x80084e5c;
export const DIM_QUAD_START = 0x80084c90;
const LAYOUT = 0x8009af6c;
const FRAMES = 0x8009af68;

const s16 = (v: number): number => (v << 16) >> 16;
const lang = (mem: PauseMemory): number => mem.read32(PAUSE_LANGUAGE_CELL) | 0;

export interface CardFoldersHost extends PauseServices {
    alloc(handler: number, size: number, extra: number): number;
    cards: PartyCardFillHost;
    scratch(): number;
    /** F0x80084F10(): build the fade object. */
    dimQuadFactory(): number;
    /** [0x8004B440](screen, 0): switch to another screen. */
    changeScreen(screen: number, arg: number): void;
}

const bankOf = (mem: PauseMemory, host: CardFoldersHost, offset: number): number => host.languageBank(lang(mem) + offset);

/** F0x80084C48(parent): build the page object. */
export function cardFoldersFactory(mem: PauseMemory, parent: number, host: CardFoldersHost): number {
    const obj = host.alloc(CARD_FOLDERS_HANDLER, CARD_FOLDERS_SIZE, CARD_FOLDERS_EXTRA);
    mem.write32(obj + 0x54, 0x1000);
    mem.write32(obj + 0x58, 6);
    mem.write32(obj + 0x50, parent);
    return obj;
}

/** F0x80083680(obj, ui): the page's widgets. */
export function cardFoldersCtor(mem: PauseMemory, obj: number, ui: number, host: CardFoldersHost): void {
    const layer = () => mem.read32(obj + 0x54) | 0;
    const order = () => (mem.read32(obj + 0x58) | 0) - 1;
    const layout = () => mem.read32(LAYOUT) | 0;
    const text = (kind: number, x: number, y: number) => host.createText(layer(), kind, s16(x), s16(y));
    const put = (off: number, widget: number) => mem.write32(ui + off, widget);
    for (let row = 0; row < 3; row++) {
        const yoff = row * 0x2e;
        const l = layout();
        put(row * 0x2c, text(1, mem.read16(l + 4), mem.read16(l + 8) + yoff));
        for (let k = 0; k < 5; k++) {
            const e = layout() + 0x14 + k * 0xc;
            put(row * 0x2c + 4 + k * 4, text(3, mem.read16(e - 4), mem.read16(e) + yoff));
        }
        for (let k = 0; k < 5; k++) {
            const e = layout() + 0x50 + k * 0xc;
            put(row * 0x2c + 0x18 + k * 4, text(3, mem.read16(e - 4), mem.read16(e) + yoff));
        }
    }
    const b = layout() + 0x90;
    const head = host.createText(layer(), 1, mem.read16s(b + 4), mem.read16s(b + 8));
    put(0x84, head);
    host.callMethod(head, 0x160, [2]);
    put(0x88, text(1, mem.read16(b + 4), mem.read16(b + 8) + 0xe));
    put(0x8c, text(1, 0xb2, 0x2a));
    for (let i = 0; i < 2; i++) put(0x90 + i * 4, text(1, 0xc5, 0x3a + i * 0xe));
    const cursor = host.createIcon(layer(), order(), 0xb8, 0x3a);
    put(0x98, cursor);
    host.callMethod(cursor, 0x80, [0]);
    const block = mem.read32(obj + 0x24) | 0;
    const count = (mem.read32(obj + 0x20) | 0) - 2;
    for (let i = 0; i < count; i++) host.callMethod(mem.read32(block + i * 4) | 0, 0x15c, [order()]);
}

/** F0x80083B58(obj, ui, show): the two choices and their cursor. */
export function cardFoldersChoice(mem: PauseMemory, ui: number, show: number, host: CardFoldersHost): void {
    const w = (off: number) => mem.read32(ui + off) | 0;
    if (show !== 0) {
        host.callMethod(w(0x8c), 0x114, [bankOf(mem, host, 0xb0), 0xb]);
        for (let i = 0; i < 2; i++) host.callMethod(w(0x90 + i * 4), 0x114, [bankOf(mem, host, 0xb0), 0x4a + i]);
        host.callMethod(w(0x98), 0x80, [1]);
        return;
    }
    host.callMethod(w(0x8c), 0x144, [0]);
    for (let i = 0; i < 2; i++) host.callMethod(w(0x90 + i * 4), 0x144, [0]);
    host.callMethod(w(0x98), 0x80, [0]);
}

/** F0x80083C94(obj): cards, portraits and panels. */
export function cardFoldersDraw(mem: PauseMemory, obj: number, host: CardFoldersHost): void {
    const r = (off: number) => mem.read32(obj + off) | 0;
    const w = (off: number, v: number) => mem.write32(obj + off, v | 0);
    const pack = (id: number) => host.packHandle(id);
    const size = r(0x5c);
    host.drawInit();
    host.draw7C(r(0x54), r(0x58));
    if (host.frameCount() - r(0x6c) >= 0xd) {
        w(0x6c, host.frameCount());
        for (let i = 0; i < size; i++) {
            const idx = r(0x60 + i * 4) + 1;
            const slot = partyPositionToRosterSlot(mem, i);
            w(0x60 + i * 4, idx);
            const frames = mem.read32(FRAMES) | 0;
            if (digimonPictureRowEnded(mem, frames, slot, idx) || idx >= 7) w(0x60 + i * 4, 0);
        }
    }
    let y = 0x13;
    let py = 0x27;
    for (let i = 0; i < size; i++) {
        const fold = r(0x7c + i * 0x10);
        if (fold !== 0) {
            if (fold !== 0x1000) {
                host.draw8C(fold, fold, 0x1000);
                host.draw94(0x7c, py);
            } else {
                host.draw8C(0x1000, 0x1000, 0x1000);
            }
            const slot = partyPositionToRosterSlot(mem, i);
            host.draw74(0x280, 0x100);
            host.drawSprite(pack(0x04040000),
                digimonPictureAt(mem, FRAMES, slot, r(0x60 + i * 4)), 0x6b, y);
        }
        y += 0x2e;
        py += 0x2e;
    }
    host.draw74(0x140, 0);
    let a = 0x13;
    let b = 0x11;
    let c = 0x27;
    let d = 0x25;
    for (let i = 0; i < size; i++) {
        const fold = r(0x7c + i * 0x10);
        if (fold !== 0) {
            if (fold !== 0x1000) {
                host.draw8C(fold, 0x1000, 0x1000);
                host.draw94(0, d);
                host.drawSprite(pack(0x02860000), 0x15, 0, b);
                host.draw8C(r(0x7c + i * 0x10), r(0x7c + i * 0x10), 0x1000);
                host.draw94(0x7c, c);
                host.drawSprite(pack(0x02860000), 0x16, 0x67, a);
                host.draw8C(r(0x7c + i * 0x10), 0x1000, 0x1000);
                host.draw94(0, d);
            } else {
                host.draw8C(0x1000, 0x1000, 0x1000);
                host.drawSprite(pack(0x02860000), 0x15, 0, b);
                host.drawSprite(pack(0x02860000), 0x16, 0x67, a);
            }
            host.drawSprite(pack(0x02860000), 0x17, 0, b);
        }
        a += 0x2e;
        b += 0x2e;
        c += 0x2e;
        d += 0x2e;
    }
    const panel = r(0xbc);
    if (panel !== 0) {
        if (panel !== 0x1000) {
            host.draw8C(panel, 0x1000, 0x1000);
            host.draw94(0, 0xd3);
        } else {
            host.draw8C(0x1000, 0x1000, 0x1000);
        }
        host.draw74(0x280, 0x100);
        host.drawSprite(pack(0x04040000), 0x20, 0, 0xc2);
    }
    if (r(0xcc) !== 0) {
        host.drawInit();
        host.draw7C(r(0x54), r(0x58));
        host.draw74(0x280, 0x100);
        const fold = r(0xcc);
        if (fold !== 0x1000) {
            host.draw8C(fold, 0x1000, 0x1000);
            host.draw94(0x140, 0x40);
        }
        host.drawSprite(pack(0x04040000), 0x3a, 0xa8, 0x28);
    }
}

/** F0x80084238(obj, ui): open, pick a partner, choose, fade out and hand over. */
export function cardFoldersTick(mem: PauseMemory, obj: number, ui: number, host: CardFoldersHost): void {
    const r = (off: number) => mem.read32(obj + off) | 0;
    const w = (off: number, v: number) => mem.write32(obj + off, v | 0);
    const at = (off: number) => mem.read32(ui + off) | 0;
    const bit = (bits: number, code: number) => (bits >> host.padBit(0, code)) & 1;
    const pressed = (code: number) => bit(host.padPressed(0), code) !== 0;
    const pressedOrRepeat = (code: number) =>
        bit(host.padPressed(0), code) !== 0 || bit(host.padRepeat(0), code) !== 0;
    const start = (fold: number, open: number) => host.foldStart(obj + fold, open);
    const tick = (fold: number) => host.foldTick(obj + fold) !== 0;
    const rows = (row: number, show: number) =>
        partyCardRows(mem, ui, row, show, host.scratch(), ROWS_CARD_FOLDERS, host.cards);
    const say = (target: number, id: number) => host.callMethod(at(target), 0x114, [bankOf(mem, host, 0xb0), id]);
    const hide = (target: number) => host.callMethod(at(target), 0x144, [0]);
    const advance = () => w(0x10, r(0x10) + 1);
    const prompts = () => {
        say(0x84, 0x4c);
        say(0x88, 0x15);
        cardFoldersChoice(mem, ui, 1, host);
        w(0x10, 0xa);
    };
    switch (r(0x10)) {
        default:
            start(0x74, 1);
            if (r(0x5c) === 1) {
                start(0xb4, 1);
                start(0xc4, 1);
            }
            w(0x10, r(0x5c));
            return;
        case 1:
            host.foldTick(obj + 0x74);
            host.foldTick(obj + 0xc4);
            if (tick(0xb4)) {
                rows(0, 1);
                prompts();
            }
            return;
        case 2:
            if (tick(0x74)) {
                start(0x84, 1);
                start(0xb4, 1);
                rows(0, 1);
                w(0x10, 4);
            }
            return;
        case 4:
            host.foldTick(obj + 0x84);
            host.foldTick(obj + 0xc4);
            if (tick(0xb4)) {
                rows(1, 1);
                prompts();
            }
            return;
        case 3:
            if (tick(0x74)) {
                start(0x84, 1);
                rows(0, 1);
                w(0x10, 5);
            }
            return;
        case 5:
            if (tick(0x84)) {
                start(0x94, 1);
                start(0xb4, 1);
                rows(1, 1);
                advance();
            }
            return;
        case 6:
            host.foldTick(obj + 0x94);
            host.foldTick(obj + 0xc4);
            if (tick(0xb4)) {
                rows(2, 1);
                prompts();
            }
            return;
        case 0xa: {
            const before = r(0x70);
            if (pressedOrRepeat(4)) w(0x70, 0);
            else if (pressedOrRepeat(6)) w(0x70, 1);
            if (before !== r(0x70)) {
                host.playSound(0x8004513e);
                host.callMethod(at(0x98), 0x84, [0xb8, r(0x70) * 0xe + 0x3a]);
            }
            if (pressed(0xd)) {
                host.playSound(0x8004503c);
                host.callMethod(obj, 0x2c, [0x64]);
                w(0x14, r(0x70) === 0 ? 1 : 2);
                return;
            }
            if (pressed(0xe)) {
                host.playSound(0x800450bd);
                host.callMethod(obj, 0x2c, [0x32]);
            }
            return;
        }
        case 0x64:
            if (at(0x9c) === 0) mem.write32(ui + 0x9c, host.dimQuadFactory());
            advance();
            return;
        case 0x65:
            host.callMethod(at(0x9c), 0x64, [0, 0xa]);
            advance();
            return;
        case 0x66:
            if ((mem.read32(at(0x9c) + 0xc) | 0) === 2) w(0x10, 0x39);
            return;
        case 0x32:
            start(r(0x5c) * 0x10 + 0x64, 0);
            rows(r(0x5c) - 1, 0);
            start(0xb4, 0);
            hide(0x84);
            hide(0x88);
            start(0xc4, 0);
            cardFoldersChoice(mem, ui, 0, host);
            w(0x10, r(0x5c) + 0x32);
            return;
        case 0x33:
            host.foldTick(obj + 0x74);
            host.foldTick(obj + 0xc4);
            if (tick(0xb4)) w(0x10, 0x39);
            return;
        case 0x34:
            host.foldTick(obj + 0x84);
            host.foldTick(obj + 0xc4);
            if (tick(0xb4)) {
                start(0x74, 0);
                rows(0, 0);
                w(0x10, 0x36);
            }
            return;
        case 0x35:
            host.foldTick(obj + 0x94);
            host.foldTick(obj + 0xc4);
            if (tick(0xb4)) {
                start(0x84, 0);
                rows(1, 0);
                w(0x10, 0x37);
            }
            return;
        case 0x37:
            if (tick(0x84)) {
                start(0x74, 0);
                rows(0, 0);
                advance();
            }
            return;
        case 0x36:
        case 0x38:
            if (tick(0x74)) w(0x10, 0x39);
            return;
        case 0x39:
            if (r(0x14) === 1) {
                host.changeScreen(0x1200, 0);
                return;
            }
            if (r(0x14) === 2) {
                host.changeScreen(0x400, 0);
                return;
            }
            w(0xc, 3);
            return;
    }
}

/** F0x80084A98(obj, ui): the page's lifecycle. */
export function cardFoldersRoot(mem: PauseMemory, obj: number, ui: number, host: CardFoldersHost): void {
    const state = mem.read32(obj + 0xc) | 0;
    if (state === 1) {
        cardFoldersTick(mem, obj, ui, host);
        cardFoldersDraw(mem, obj, host);
        return;
    }
    if (state >= 2 && state < 4) return;
    host.callMethod(obj, 0x38, []);
    for (let i = 0; i < 3; i++) {
        if (partyPositionToRosterSlot(mem, i) >= 0) mem.write32(obj + 0x5c, (mem.read32(obj + 0x5c) | 0) + 1);
    }
    const size = mem.read32(obj + 0x5c) | 0;
    for (let i = 0; i < size; i++) {
        mem.write32(obj + 0x74 + i * 0x10, 0xa);
        host.foldStart(obj + 0x74 + i * 0x10, 1);
    }
    for (let i = 0; i < 2; i++) {
        mem.write32(obj + 0xa4 + i * 0x10, 0xa);
        host.foldStart(obj + 0xa4 + i * 0x10, 1);
    }
    mem.write32(obj + 0xc4, 0xa);
    host.foldStart(obj + 0xc4, 1);
    cardFoldersCtor(mem, obj, ui, host);
}

/** F0x80084F10(): build the fade object. */
export function dimQuadFactory(mem: PauseMemory, host: Pick<CardFoldersHost, "alloc">): number {
    const obj = host.alloc(DIM_QUAD_HANDLER, 0x68, 0);
    mem.write32(obj + 0x64, DIM_QUAD_START);
    mem.write32(obj + 0x50, 0x1000);
    mem.write32(obj + 0x54, 0);
    return obj;
}

/** F0x80084C90(obj, direction, frames): start the ramp up (0) or down (1). */
export function dimQuadStart(mem: PauseMemory, obj: number, direction: number, frames: number,
    host: Pick<CardFoldersHost, "callMethod">): void {
    host.callMethod(obj, 0x28, [1]);
    mem.write32(obj + 0x10, 1);
    mem.write32(obj + 0x58, direction);
    // MIPS `div` with a zero divisor: -1 (the dividend 0xff00 is positive).
    const step = frames === 0 ? -1 : (0xff00 / frames) | 0;
    if (direction === 0) {
        mem.write32(obj + 0x5c, 0);
        mem.write32(obj + 0x60, step);
        return;
    }
    mem.write32(obj + 0x5c, 0xff00);
    mem.write32(obj + 0x60, -step);
}

export interface DimQuadHost extends Pick<CardFoldersHost, "callMethod"> {
    /** [view+0x138](view, depth): the ordering-table bucket head cell. */
    otBucket(view: number, depth: number): number;
    /** [0x8004DE10+0x158](): the primitive cursor. */
    cursor(): number;
    /** [0x8004DE10+0x15C](p): move the primitive cursor. */
    setCursor(p: number): void;
}

/** F0x80084D18(obj): submit the fade quad and its draw-mode word. */
export function dimQuadDraw(mem: PauseMemory, obj: number, host: DimQuadHost): void {
    const view = findRegisteredHandleByKey(mem, mem.read32(obj + 0x50) | 0);
    const bucket = host.otBucket(view, mem.read32(obj + 0x54) | 0);
    const prim = host.cursor() >>> 0;
    mem.write8(prim + 3, 5);
    mem.write8(prim + 7, 0x2a);
    mem.write16(prim + 0x14, 0x140);
    mem.write16(prim + 0xc, 0x140);
    mem.write16(prim + 0x10, 0);
    mem.write16(prim + 8, 0);
    mem.write16(prim + 0xe, 0);
    mem.write16(prim + 0xa, 0);
    mem.write16(prim + 0x16, 0x100);
    mem.write16(prim + 0x12, 0x100);
    const level = (mem.read32(obj + 0x5c) | 0) >> 8;
    mem.write8(prim + 6, level);
    mem.write8(prim + 5, level);
    mem.write8(prim + 4, level);
    mem.write32(prim, ((mem.read32(prim) & 0xff000000) | (mem.read32(bucket) & 0xffffff)) | 0);
    mem.write32(bucket, ((mem.read32(bucket) & 0xff000000) | (prim & 0xffffff)) | 0);
    const mode = prim + 0x18;
    mem.write8(mode + 3, 1);
    mem.write32(mode + 4, 0xe1000245 | 0);
    mem.write32(prim + 0x18, ((mem.read32(prim + 0x18) & 0xff000000) | (mem.read32(bucket) & 0xffffff)) | 0);
    const tail = mode & 0xffffff;
    mem.write32(bucket, ((mem.read32(bucket) & 0xff000000) | tail) | 0);
    host.setCursor(prim + 0x20);
}

/** F0x80084E5C(obj): ramp the level and draw. */
export function dimQuadTick(mem: PauseMemory, obj: number, host: DimQuadHost): void {
    const state = mem.read32(obj + 0xc) | 0;
    if (state === 3) return;
    if (state === 2) {
        dimQuadDraw(mem, obj, host);
        return;
    }
    if (state !== 1) {
        host.callMethod(obj, 0x38, [obj]);
        return;
    }
    if ((mem.read32(obj + 0x10) | 0) === 0) return;
    const level = ((mem.read32(obj + 0x5c) | 0) + (mem.read32(obj + 0x60) | 0)) | 0;
    mem.write32(obj + 0x5c, level);
    if ((mem.read32(obj + 0x58) | 0) === 0) {
        if (level > 0xff00) {
            mem.write32(obj + 0x5c, 0xff00);
            mem.write32(obj + 0xc, 2);
        }
    } else if (level < 0) {
        mem.write32(obj + 0x5c, 0);
        mem.write32(obj + 0xc, 2);
    }
    dimQuadDraw(mem, obj, host);
}
