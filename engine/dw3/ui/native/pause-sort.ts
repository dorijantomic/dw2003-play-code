// The SORT pause page (the party formation swap), translated from the original
// pro/ststatus bodies.
//
// Part D of docs/plans/2026-09-28-translated-game-completion-plan.md. Oracle:
// tests/lane-b/pause-sort.test.js runs each original through engine/native.
//
//   F0x8009824C sortFactory   build the page object (0xF4 bytes, 0x8C extra).
//   F0x800980B0 sortRoot      count the party, open the card folds, build, tick, draw.
//   F0x80096590 sortCtor      the party-card widgets and the two prompt lines.
//   F0x8009744C sortTick      open, pick the first partner, pick the second, swap.
//   F0x80096988 sortDraw      cards, portraits, the two selection cursors and folds.
//
// Object fields: +0x5C party size; +0x60.. portrait frames; +0x70 the pick cursor is
// showing; +0x7C the first prompt is showing; +0x80 browsing row; +0x84 / +0x88 the two
// picked rows; +0x94.. card folds; +0xE4 the swap fold.
import { PAUSE_CTX, PAUSE_LANGUAGE_CELL, type PauseMemory, type PauseServices } from "./pause-services.ts";
import { partyPositionToRosterSlot } from "../../party-context.ts";
import { partyCardRows, ROWS_SORT } from "./party-card-rows.ts";
import type { PartyCardFillHost } from "../party-card-fill.ts";

export const SORT_HANDLER = 0x800980b0;
export const SORT_SIZE = 0xf4;
export const SORT_EXTRA = 0x8c;
const LAYOUT = 0x8009af6c;
const FRAMES = 0x8009af68;
const PARTY_MAP = PAUSE_CTX + 0x70;

const s16 = (v: number): number => (v << 16) >> 16;
const lang = (mem: PauseMemory): number => mem.read32(PAUSE_LANGUAGE_CELL) | 0;

export interface SortHost extends PauseServices {
    alloc(handler: number, size: number, extra: number): number;
    cards: PartyCardFillHost;
    scratch(): number;
}

const rowFill = (mem: PauseMemory, ui: number, row: number, show: number, host: SortHost): void =>
    partyCardRows(mem, ui, row, show, host.scratch(), ROWS_SORT, host.cards);

/** F0x8009824C(parent): build the page object. */
export function sortFactory(mem: PauseMemory, parent: number, host: SortHost): number {
    const obj = host.alloc(SORT_HANDLER, SORT_SIZE, SORT_EXTRA);
    mem.write32(obj + 0x54, 0x1000);
    mem.write32(obj + 0x58, 2);
    mem.write32(obj + 0x50, parent);
    return obj;
}

/** F0x80096590(obj, ui): the page's widgets. */
export function sortCtor(mem: PauseMemory, obj: number, ui: number, host: SortHost): void {
    const layer = () => mem.read32(obj + 0x54) | 0;
    const layout = () => mem.read32(LAYOUT) | 0;
    const a = layout() + 0x84;
    mem.write32(ui, host.createText(layer(), 1, s16(mem.read16(a + 4)), s16(mem.read16(a + 8))));
    const b = layout() + 0x90;
    mem.write32(ui + 0x88, host.createText(layer(), 1, s16(mem.read16(b + 4)), s16(mem.read16(b + 8))));
    for (let row = 0; row < 3; row++) {
        const yoff = row * 0x2e;
        const l = layout();
        mem.write32(ui + row * 0x2c + 4, host.createText(layer(), 1, s16(mem.read16(l + 4)), s16(mem.read16(l + 8) + yoff)));
        for (let k = 0; k < 5; k++) {
            const e = l + 0x14 + k * 0xc;
            mem.write32(ui + row * 0x2c + 8 + k * 4,
                host.createText(layer(), 3, s16(mem.read16(e - 4)), s16(mem.read16(e) + yoff)));
        }
        for (let k = 0; k < 5; k++) {
            const e = l + 0x50 + k * 0xc;
            mem.write32(ui + row * 0x2c + 0x1c + k * 4,
                host.createText(layer(), 3, s16(mem.read16(e - 4)), s16(mem.read16(e) + yoff)));
        }
    }
}

/** F0x800980B0(obj, ui): the page's lifecycle. */
export function sortRoot(mem: PauseMemory, obj: number, ui: number, host: SortHost): void {
    const state = mem.read32(obj + 0xc) | 0;
    if (state === 1) {
        sortTick(mem, obj, ui, host);
        sortDraw(mem, obj, host);
        return;
    }
    if (state >= 2 && state < 4) return;
    host.callMethod(obj, 0x38, []);
    for (let i = 0; i < 3; i++) {
        if (partyPositionToRosterSlot(mem, i) >= 0) mem.write32(obj + 0x5c, (mem.read32(obj + 0x5c) | 0) + 1);
    }
    const size = mem.read32(obj + 0x5c) | 0;
    for (let i = 0; i < size; i++) mem.write32(obj + 0x94 + i * 0x10, 0xa);
    host.foldStart(obj + 0x94, 1);
    for (let i = 0; i < 2; i++) {
        mem.write32(obj + 0xc4 + i * 0x10, 0xa);
        host.foldStart(obj + 0xc4 + i * 0x10, 1);
        mem.write32(obj + 0xe4, 8);
        host.foldStart(obj + 0xe4, 0);
    }
    sortCtor(mem, obj, ui, host);
}

/** F0x8009744C(obj, ui): open, pick, swap, close. */
export function sortTick(mem: PauseMemory, obj: number, ui: number, host: SortHost): void {
    const r = (off: number) => mem.read32(obj + off) | 0;
    const w = (off: number, v: number) => mem.write32(obj + off, v | 0);
    const at = (off: number) => mem.read32(ui + off) | 0;
    const bank = () => host.languageBank(lang(mem) + 0xb0);
    const bit = (bits: number, code: number) => (bits >> host.padBit(0, code)) & 1;
    const pressed = (code: number) => bit(host.padPressed(0), code) !== 0;
    const pressedOrRepeat = (code: number) =>
        bit(host.padPressed(0), code) !== 0 || bit(host.padRepeat(0), code) !== 0;
    const fill = (row: number, show: number) => rowFill(mem, ui, row, show, host);
    const say = (target: number, id: number) => host.callMethod(at(target), 0x114, [bank(), id]);
    const hide = (target: number) => host.callMethod(at(target), 0x144, [0]);
    const done = (fold: number) => host.foldTick(obj + fold) !== 0;
    const start = (fold: number, open: number) => host.foldStart(obj + fold, open);
    const advance = () => w(0x10, r(0x10) + 1);
    const last = () => r(0x5c) - 1;

    switch (r(0x10)) {
        default:
            host.foldTick(obj + (r(0x5c) === 1 ? 0xd4 : 0xc4));
            if (done(0x94)) {
                fill(0, 1);
                if (r(0x5c) === 1) {
                    w(0x10, 0xf);
                    say(0x88, 0x10);
                    return;
                }
                advance();
                say(0, 0x11);
                start(0xa4, 1);
            }
            return;
        case 1:
            if (r(0x5c) === 2) host.foldTick(obj + 0xd4);
            if (done(0xa4)) {
                fill(1, 1);
                if (r(0x5c) === 2) {
                    w(0x10, 5);
                    say(0x88, 0xf);
                    return;
                }
                advance();
                start(0xb4, 1);
            }
            return;
        case 2:
            host.foldTick(obj + 0xb4);
            if (done(0xd4)) {
                fill(2, 1);
                say(0x88, 0xf);
                w(0x10, 5);
            }
            return;
        case 5:
            w(0x7c, 1);
            advance();
            return;
        case 6: {
            const before = r(0x80);
            if (pressedOrRepeat(4)) {
                w(0x80, r(0x80) - 1);
                if (r(0x80) < 0) w(0x80, last());
            } else if (pressedOrRepeat(6)) {
                w(0x80, r(0x80) + 1);
                if (last() < r(0x80)) w(0x80, 0);
            }
            if (before !== r(0x80)) host.playSound(0x4001b);
            if (pressed(0xd)) {
                host.playSound(0x4001c);
                w(0x70, 1);
                advance();
                say(0, 0x12);
                w(0x88, r(0x80));
                w(0x84, r(0x80));
                let v = r(0x88) + 1;
                for (;;) {
                    w(0x88, v);
                    if (last() < v) w(0x88, 0);
                    const now = r(0x88);
                    v = now + 1;
                    if (r(0x84) !== now) break;
                }
                return;
            }
            if (pressed(0xe)) {
                host.playSound(0x800450bd);
                w(0x7c, 0);
                w(0x10, 0x14);
            }
            return;
        }
        case 7: {
            const before = r(0x88);
            if (pressedOrRepeat(4)) {
                let v = r(0x88) - 1;
                for (;;) {
                    w(0x88, v);
                    if (v < 0) w(0x88, last());
                    const now = r(0x88);
                    v = now - 1;
                    if (r(0x84) !== now) break;
                }
            } else if (pressedOrRepeat(6)) {
                let v = r(0x88) + 1;
                for (;;) {
                    w(0x88, v);
                    if (last() < v) w(0x88, 0);
                    const now = r(0x88);
                    v = now + 1;
                    if (r(0x84) !== now) break;
                }
            }
            if (before !== r(0x88)) host.playSound(0x4001b);
            if (pressed(0xd)) {
                host.playSound(0x4001c);
                fill(r(0x84), 0);
                fill(r(0x88), 0);
                host.foldStart(obj + 0xe4, 0);
                say(0, 0x11);
                advance();
                return;
            }
            if (pressed(0xe)) {
                host.playSound(0x800450bd);
                w(0x70, 0);
                say(0, 0x11);
                w(0x10, r(0x10) - 1);
            }
            return;
        }
        case 8:
            if (done(0xe4)) {
                start(0xe4, 1);
                w(0x70, 0);
                const first = partyPositionToRosterSlot(mem, r(0x84));
                mem.write32(PARTY_MAP + r(0x84) * 4, partyPositionToRosterSlot(mem, r(0x88)));
                mem.write32(PARTY_MAP + r(0x88) * 4, first);
                w(0x60 + r(0x84) * 4, 0);
                w(0x60 + r(0x88) * 4, 0);
                advance();
            }
            return;
        case 9:
            if (done(0xe4)) {
                fill(r(0x84), 1);
                fill(r(0x88), 1);
                w(0x10, 6);
            }
            return;
        case 0xf:
            w(0x7c, 1);
            advance();
            return;
        case 0x10:
            if (pressed(0xe)) w(0x10, 0x14);
            return;
        case 0x14:
            switch (r(0x5c)) {
                default:
                    hide(0x88);
                    start(0x94, 0);
                    fill(0, 0);
                    start(0xd4, 0);
                    break;
                case 2:
                    start(0xa4, 0);
                    start(0xd4, 0);
                    hide(0x88);
                    fill(1, 0);
                    break;
                case 3:
                    start(0xb4, 0);
                    start(0xd4, 0);
                    hide(0x88);
                    fill(2, 0);
                    break;
            }
            w(0x10, r(0x5c) + 0x14);
            return;
        case 0x15:
            if (done(0x94)) w(0xc, 3);
            host.foldTick(obj + 0xd4);
            return;
        case 0x16:
        case 0x19:
            if (r(0x10) === 0x16) host.foldTick(obj + 0xa4);
            if (done(r(0x10) === 0x16 ? 0xd4 : 0xa4)) {
                start(0x94, 0);
                start(0xc4, 0);
                hide(0);
                fill(0, 0);
                w(0x10, 0x18);
            }
            return;
        case 0x18:
            host.foldTick(obj + 0x94);
            if (done(0xc4)) w(0xc, 3);
            return;
        case 0x17:
            host.foldTick(obj + 0xb4);
            if (done(0xd4)) {
                start(0xa4, 0);
                fill(1, 0);
                w(0x10, 0x19);
            }
            return;
    }
}

/** F0x80096988(obj): cards, portraits, cursors and folds. */
export function sortDraw(mem: PauseMemory, obj: number, host: SortHost): void {
    const r = (off: number) => mem.read32(obj + off) | 0;
    const w = (off: number, v: number) => mem.write32(obj + off, v | 0);
    const pack = (id: number) => host.packHandle(id);
    const size = r(0x5c);
    host.drawInit();
    host.draw7C(r(0x54), r(0x58));
    if (host.frameCount() - r(0x90) >= 8) {
        w(0x90, host.frameCount());
        const v = r(0x8c) + 1;
        w(0x8c, v);
        if (v >= 8) w(0x8c, 0);
    }
    host.draw74(0x280, 0x100);
    if (r(0x7c) !== 0) {
        const sub = r(0x10);
        if (sub === 6) {
            host.draw88(r(0x8c));
            host.drawSprite(host.packHandle(0x04040000), 0x1e, 0, r(0x80) * 0x2e + 0x11);
        } else if (sub === 7) {
            host.draw88(r(0x8c));
            host.drawSprite(pack(0x04040000), 0x1e, 0, r(0x88) * 0x2e + 0x11);
            host.draw88(8);
            host.drawSprite(pack(0x04040000), 0x1e, 0, r(0x84) * 0x2e + 0x11);
        } else if (sub === 8) {
            host.draw8C(0x1000, r(0xec), 0x1000);
            host.draw94(0, r(0x84) * 0x2e + 0x25);
            host.draw88(8);
            host.drawSprite(pack(0x04040000), 0x1e, 0, r(0x84) * 0x2e + 0x11);
            host.draw94(0, r(0x88) * 0x2e + 0x25);
            host.drawSprite(pack(0x04040000), 0x1e, 0, r(0x88) * 0x2e + 0x11);
        }
        host.draw88(0);
    }
    if (host.frameCount() - r(0x6c) >= 0xd) {
        w(0x6c, host.frameCount());
        for (let i = 0; i < size; i++) {
            const idx = r(0x60 + i * 4) + 1;
            const slot = partyPositionToRosterSlot(mem, i);
            w(0x60 + i * 4, idx);
            const frames = mem.read32(FRAMES) | 0;
            if ((mem.read32(frames + slot * 7 * 4 + idx * 4) | 0) === -1 || idx >= 7) w(0x60 + i * 4, 0);
        }
    }
    let y = 0x13;
    let py = 0x27;
    for (let i = 0; i < size; i++) {
        const fold = r(0x9c + i * 0x10);
        if (fold !== 0) {
            let a = fold;
            let b = fold;
            let scaled = true;
            if (fold === 0x1000) {
                a = 0x1000;
                const sub = r(0x10);
                if (((sub - 8) >>> 0) < 2 && (i === r(0x84) || i === r(0x88))) {
                    b = r(0xec);
                } else {
                    scaled = false;
                }
            }
            if (scaled) {
                host.draw8C(a, b, 0x1000);
                host.draw94(0x7c, py);
            } else {
                host.draw8C(0x1000, 0x1000, 0x1000);
            }
            const slot = partyPositionToRosterSlot(mem, i);
            host.drawSprite(pack(0x04040000),
                mem.read32((mem.read32(FRAMES) | 0) + slot * 0x1c + r(0x60 + i * 4) * 4) | 0, 0x6b, y);
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
        const fold = r(0x9c + i * 0x10);
        if (fold !== 0) {
            if (fold !== 0x1000) {
                host.draw8C(fold, 0x1000, 0x1000);
                host.draw94(0, d);
                host.drawSprite(pack(0x02860000), 0x15, 0, b);
                host.draw8C(r(0x9c + i * 0x10), r(0x9c + i * 0x10), 0x1000);
                host.draw94(0x7c, c);
                host.drawSprite(pack(0x02860000), 0x16, 0x67, a);
                host.draw8C(r(0x9c + i * 0x10), 0x1000, 0x1000);
                host.draw94(0, d);
            } else if (((r(0x10) - 8) >>> 0) < 2 && (i === r(0x84) || i === r(0x88))) {
                host.draw8C(0x1000, r(0xec), 0x1000);
                host.draw94(0, d);
                host.drawSprite(pack(0x02860000), 0x15, 0, b);
                host.draw94(0x7c, c);
                host.drawSprite(pack(0x02860000), 0x16, 0x67, a);
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
    const foldT = r(0xcc);
    if (foldT !== 0) {
        if (foldT !== 0x1000) {
            host.draw8C(foldT, 0x1000, 0x1000);
            host.draw94(0x140, 0x19);
        } else {
            host.draw8C(0x1000, 0x1000, 0x1000);
        }
        host.drawSprite(host.packHandle(0x02860000), 0x18, 0x22, 0xd);
    }
    const foldB = r(0xdc);
    if (foldB !== 0) {
        if (foldB !== 0x1000) {
            host.draw8C(foldB, 0x1000, 0x1000);
            host.draw94(0, 0xd3);
        } else {
            host.draw8C(0x1000, 0x1000, 0x1000);
        }
        host.draw74(0x280, 0x100);
        host.drawSprite(host.packHandle(0x04040000), 0x20, 0, 0xc2);
    }
    if (r(0x70) !== 0) {
        if (host.frameCount() - r(0x78) >= 0xb) {
            w(0x78, host.frameCount());
            const v = r(0x74) + 1;
            w(0x74, v);
            if (v >= 8) w(0x74, 0);
        }
        host.draw7C(r(0x54), 0);
        host.draw88(r(0x74));
        let clip: number;
        let y2: number;
        const first = r(0x84);
        const second = r(0x88);
        if (first === 1) {
            if (second === 0) { clip = 0x29; y2 = 0x22; } else { clip = 0x29; y2 = 0x4f; }
        } else if (first === 2) {
            if (second === 0) { clip = 0x28; y2 = 0x22; } else { clip = 0x29; y2 = 0x4f; }
        } else if (second === 1) {
            clip = 0x29; y2 = 0x22;
        } else {
            clip = 0x28; y2 = 0x22;
        }
        host.drawSprite(host.packHandle(0x04040000), clip, 0x93, y2);
    }
}
