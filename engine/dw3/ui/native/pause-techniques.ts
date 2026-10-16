// The TECHNIQUES pause page (the field heal list), translated from the original
// pro/ststatus bodies.
//
// Part D of docs/plans/2026-09-28-translated-game-completion-plan.md. Oracle:
// tests/lane-b/pause-techniques.test.js runs each original through engine/native.
//
//   F0x80096548 techniquesFactory     build the page object (0x1F4 bytes, 0xB4 extra).
//   F0x80096380 techniquesRoot        count the party, open the card folds, list each
//                                     member's heal techniques, build, then tick and draw.
//   F0x80093E84 techniquesCtor        the party cards, prompts, technique rows, cursor.
//   F0x800937A4 techniquesHealList    a member's distinct heal techniques (up to five).
//   F0x80093930 techniquesMpGate      the chosen technique, or 0 when MP is short.
//   F0x800939E8 techniquesHealAmount  the HP a technique restores for a member.
//   F0x80093A58 techniquesApplyHeal   spend the MP and heal one member or the party.
//   F0x80094388 techniquesNamesFill   the member's technique names.
//   F0x80094558 techniquesMpCostFill  the chosen technique's name and MP cost.
//   F0x80094FBC techniquesTick        open, pick a member, pick a technique, choose a
//                                     target, heal, close.
//   F0x800946BC techniquesDraw        cards, portraits, cursors and folds.
//   F0x80017A1C formEntryCopy         (resident) copy one ledger entry.
//
// Object fields: +0x5C party size; +0x60.. per-member portrait frame; +0x6C/+0x70/+0x74
// clocks; +0x78 the technique list is showing; +0x7C member; +0x80 target picker
// showing; +0x84 target; +0x88 technique; +0xD0/+0xDC per-member heal list and count
// (0x54 apart, from +0x8C the validated forms); folds at +0x184.. and +0x1E4.
import { PAUSE_CTX, PAUSE_LANGUAGE_CELL, type PauseMemory, type PauseServices } from "./pause-services.ts";
import { buildEffectiveStats } from "../../effective-stats.ts";
import { itemRecord } from "../../item-record.ts";
import { findFormLedgerIndex, validateEquippedForm } from "../../form-ledger.ts";
import { partyPositionToRosterSlot, persistentRosterSlot, rosterContextBase } from "../../party-context.ts";
import { partyCardRows, ROWS_TECHNIQUES } from "./party-card-rows.ts";
import type { PartyCardFillHost } from "../party-card-fill.ts";

export const TECH_HANDLER = 0x80096380;
export const TECH_SIZE = 0x1f4;
export const TECH_EXTRA = 0xb4;
export const TECH_TABLE = 0x80042bdc;
export const TECH_ICON_TABLE = 0x8009a950;

const s16 = (v: number): number => (v << 16) >> 16;
const lang = (mem: PauseMemory): number => mem.read32(PAUSE_LANGUAGE_CELL) | 0;
const LAYOUT = 0x8009af6c;
const LISTS = 0x8009af68;

export interface TechniquesHost extends PauseServices {
    alloc(handler: number, size: number, extra: number): number;
    /** The party-card fill's service host (roster, stats, record, text, widgets). */
    cards: PartyCardFillHost;
    /** A scratch block for the effective-stat copy (0x2C bytes). */
    scratch(): number;
}

const rowFill = (mem: PauseMemory, obj: number, ui: number, row: number, show: number, host: TechniquesHost): void =>
    partyCardRows(mem, ui, row, show, host.scratch(), ROWS_TECHNIQUES, host.cards);

/** F0x80017A1C(slot, form, dst): copy the ledger entry for `form`; its index, or -1. */
export function formEntryCopy(mem: PauseMemory, slot: number, form: number, dst: number): number {
    const index = findFormLedgerIndex(mem, slot, form);
    if (index !== -1) {
        const src = rosterContextBase(slot) + 0x7b8 + index * 0x14;
        for (let i = 0; i < 5; i++) mem.write32(dst + i * 4, mem.read32(src + i * 4));
    }
    return index;
}

/** F0x80096548(parent): build the page object. */
export function techniquesFactory(mem: PauseMemory, parent: number, host: TechniquesHost): number {
    const obj = host.alloc(TECH_HANDLER, TECH_SIZE, TECH_EXTRA);
    mem.write32(obj + 0x54, 0x1000);
    mem.write32(obj + 0x58, 6);
    mem.write32(obj + 0x50, parent);
    return obj;
}

/** F0x800937A4(obj, member): the member's distinct heal techniques; returns the count. */
export function techniquesHealList(mem: PauseMemory, obj: number, member: number): number {
    let count = 0;
    const slot = partyPositionToRosterSlot(mem, member);
    const block = obj + member * 0x54 + 0x8c;
    validateEquippedForm(mem, slot, block);
    for (let form = 0; form < 3; form++) {
        const id = s16(mem.read16(block + form * 2));
        if (id < 3) continue;
        const entry = block + 8 + form * 0x14;
        formEntryCopy(mem, slot, id, entry);
        for (let t = 0; t < 6; t++) {
            const tech = mem.read16(entry + 8 + t * 2) & 0x1fff;
            if (((tech - 0xb8) >>> 0) < 5) {
                let seen = false;
                for (let i = 0; i < 5; i++) {
                    if (tech === mem.read16(block + 0x44 + i * 2)) { seen = true; break; }
                }
                if (!seen) {
                    mem.write16(obj + member * 0x54 + 0xd0 + count * 2, tech);
                    count += 1;
                    if (count >= 5) return count;
                }
            }
        }
    }
    return count;
}

/** F0x80093930(obj): the chosen technique id, or 0 when the member lacks the MP. */
export function techniquesMpGate(mem: PauseMemory, obj: number): number {
    const member = mem.read32(obj + 0x7c) | 0;
    const tech = s16(mem.read16(obj + (mem.read32(obj + 0x88) | 0) * 2 + member * 0x54 + 0xd0));
    const rec = persistentRosterSlot(partyPositionToRosterSlot(mem, member));
    if (s16(mem.read16(rec + 0x24)) < mem.read16(TECH_TABLE + (tech - 1) * 0x12)) return 0;
    return tech;
}

/** F0x800939E8(slot, tech): the HP a technique restores. */
export function techniquesHealAmount(mem: PauseMemory, slot: number, tech: number, scratch: number): number {
    buildEffectiveStats(mem, { definitionRecord: (k) => itemRecord(k) }, slot, scratch);
    const power = mem.read8(0x80042bca + tech * 0x12 + 0xc);
    let product = power * s16(mem.read16(scratch + 0x12));
    if (product < 0) product += 7;
    return ((power << 6) + (product >> 3)) | 0;
}

/** F0x80093A58(obj, ui, sound): spend the MP and heal; 1 when it healed. */
export function techniquesApplyHeal(
    mem: PauseMemory, obj: number, ui: number, sound: number, host: TechniquesHost,
): number {
    const at = (off: number) => mem.read32(ui + off) | 0;
    const bank = () => host.languageBank(lang(mem) + 0xb0);
    const member = mem.read32(obj + 0x7c) | 0;
    const tech = s16(mem.read16(obj + (mem.read32(obj + 0x88) | 0) * 2 + member * 0x54 + 0xd0));
    const slotA = partyPositionToRosterSlot(mem, member);
    const recA = persistentRosterSlot(slotA);
    const amount = techniquesHealAmount(mem, slotA, tech, host.scratch());
    const entry = TECH_TABLE + (tech - 1) * 0x12;
    const size = mem.read32(obj + 0x5c) | 0;
    if (mem.read8(entry + 5) === 3) {
        const recB = persistentRosterSlot(partyPositionToRosterSlot(mem, mem.read32(obj + 0x84) | 0));
        if (s16(mem.read16(recB + 0x20)) < s16(mem.read16(recB + 0x22))) {
            mem.write16(recA + 0x24, mem.read16(recA + 0x24) - mem.read16(entry));
            const v = (mem.read16(recB + 0x20) + amount) | 0;
            mem.write16(recB + 0x20, v);
            if (s16(mem.read16(recB + 0x22)) < v) {
                mem.write16(recB + 0x20, mem.read16(recB + 0x22));
                host.callMethod(at(0x88), 0x114, [bank(), 0x52]);
            } else {
                host.callMethod(at(0x88), 0x114, [bank(), 0x53]);
                host.callMethod(at(0x88), 0x118, [1, amount]);
            }
            for (let i = 0; i < size; i++) rowFill(mem, obj, ui, i, 1, host);
            host.playSound(0x40014);
            return 1;
        }
        host.playSound(sound);
        host.callMethod(at(0x88), 0x114, [bank(), 0x6a]);
        return 0;
    }
    let healed = 0;
    let full = 0;
    for (let i = 0; i < size; i++) {
        const slot = partyPositionToRosterSlot(mem, i);
        if (slot >= 0) {
            const rec = persistentRosterSlot(slot);
            const v = (mem.read16(rec + 0x20) + amount) | 0;
            if (s16(mem.read16(rec + 0x20)) < s16(mem.read16(rec + 0x22))) {
                mem.write16(rec + 0x20, v);
                healed = 1;
                if (s16(mem.read16(rec + 0x22)) < v) {
                    mem.write16(rec + 0x20, mem.read16(rec + 0x22));
                    full += 1;
                }
            } else {
                full += 1;
            }
        }
    }
    if (healed !== 0) {
        mem.write16(recA + 0x24, mem.read16(recA + 0x24) - mem.read16(TECH_TABLE + (tech - 1) * 0x12));
        for (let i = 0; i < size; i++) rowFill(mem, obj, ui, i, 1, host);
        if (full === size) {
            host.callMethod(at(0x88), 0x114, [bank(), 0x52]);
        } else {
            host.callMethod(at(0x88), 0x114, [bank(), 0x53]);
            host.callMethod(at(0x88), 0x118, [1, amount]);
        }
        host.playSound(0x40014);
        return 1;
    }
    host.playSound(sound);
    host.callMethod(at(0x88), 0x114, [bank(), 0x6a]);
    return 0;
}

/** F0x80094388(obj, ui, show): the member's technique names. */
export function techniquesNamesFill(mem: PauseMemory, obj: number, ui: number, show: number, host: TechniquesHost): void {
    const at = (off: number) => mem.read32(ui + off) | 0;
    const member = mem.read32(obj + 0x7c) | 0;
    const count = mem.read32(obj + member * 0x54 + 0xdc) | 0;
    if (show !== 0) {
        host.callMethod(at(0x98), 0x114, [host.languageBank(lang(mem) + 0xb0), 9]);
        for (let i = 0; i < count; i++) {
            host.callMethod(at(0x9c + i * 4), 0x114, [
                host.languageBank(lang(mem) + 0xa2),
                mem.read16(obj + i * 2 + member * 0x54 + 0xd0) & 0x1fff,
            ]);
        }
        return;
    }
    host.callMethod(at(0x98), 0x144, [0]);
    for (let i = 0; i < count; i++) host.callMethod(at(0x9c + i * 4), 0x144, [0]);
}

/** F0x80094558(obj, ui, show): the chosen technique's name and MP cost. */
export function techniquesMpCostFill(mem: PauseMemory, obj: number, ui: number, show: number, host: TechniquesHost): void {
    const at = (off: number) => mem.read32(ui + off) | 0;
    if (show !== 0) {
        const member = mem.read32(obj + 0x7c) | 0;
        const tech = mem.read16(obj + (mem.read32(obj + 0x88) | 0) * 2 + member * 0x54 + 0xd0) & 0x1fff;
        host.callMethod(at(0x88), 0x114, [host.languageBank(lang(mem) + 0x9b), tech]);
        host.callMethod(at(0x90), 0x114, [host.languageBank(lang(mem) + 0xb0), 3]);
        host.callMethod(at(0x94), 0x118, [0, mem.read16(TECH_TABLE + (tech - 1) * 0x12)]);
        host.callMethod(at(0x94), 0x148, [1]);
        return;
    }
    host.callMethod(at(0x88), 0x144, [0]);
    host.callMethod(at(0x90), 0x144, [0]);
    host.callMethod(at(0x94), 0x144, [0]);
}

/** F0x80093E84(obj, ui): the page's widgets. */
export function techniquesCtor(mem: PauseMemory, obj: number, ui: number, host: TechniquesHost): void {
    const layer = () => mem.read32(obj + 0x54) | 0;
    const layout = () => mem.read32(LAYOUT) | 0;
    const t0 = layout() + 0x84;
    mem.write32(ui, host.createText(layer(), 1, s16(mem.read16(t0 + 4)), s16(mem.read16(t0 + 8))));
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
    const l = layout();
    const a = l + 0x90;
    const w88 = host.createText(layer(), 1, s16(mem.read16(a + 4)), s16(mem.read16(a + 8)));
    mem.write32(ui + 0x88, w88);
    host.callMethod(w88, 0x160, [2]);
    mem.write32(ui + 0x8c, host.createText(layer(), 1, s16(mem.read16(a + 4)), s16(mem.read16(a + 8) + 0xe)));
    const b = l + 0x9c;
    mem.write32(ui + 0x90, host.createText(layer(), 1, s16(mem.read16(b + 4)), s16(mem.read16(b + 8))));
    const c = l + 0xa8;
    mem.write32(ui + 0x94, host.createText(layer(), 1, s16(mem.read16(c + 4)), s16(mem.read16(c + 8))));
    mem.write32(ui + 0x98, host.createText(layer(), 1, 0x9c, 0x31));
    for (let k = 0; k < 5; k++) mem.write32(ui + 0x9c + k * 4, host.createText(layer(), 1, 0xb1, 0x41 + k * 0xe));
    const cursor = host.createIcon(layer(), (mem.read32(obj + 0x58) | 0) - 1, 0xa6, s16((mem.read32(obj + 0x88) | 0) * 0xe + 0x41));
    mem.write32(ui + 0xb0, cursor);
    host.callMethod(cursor, 0x80, [0]);
}

/** F0x800946BC(obj): the cards, portraits, cursors and folds. */
export function techniquesDraw(mem: PauseMemory, obj: number, host: TechniquesHost): void {
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
            const frames = mem.read32(LISTS) | 0;
            if ((mem.read32(frames + slot * 7 * 4 + idx * 4) | 0) === -1 || idx >= 7) w(0x60 + i * 4, 0);
        }
    }
    let y = 0x13;
    let py = 0x27;
    for (let i = 0; i < size; i++) {
        const fold = r(i * 0x10 + 0x19c);
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
                mem.read32((mem.read32(LISTS) | 0) + slot * 0x1c + r(0x60 + i * 4) * 4) | 0, 0x6b, y);
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
        const fold = r(i * 0x10 + 0x19c);
        if (fold !== 0) {
            if (fold !== 0x1000) {
                host.draw8C(fold, 0x1000, 0x1000);
                host.draw94(0, d);
                host.drawSprite(pack(0x02860000), 0x15, 0, b);
                host.draw8C(r(i * 0x10 + 0x19c), r(i * 0x10 + 0x19c), 0x1000);
                host.draw94(0x7c, c);
                host.drawSprite(pack(0x02860000), 0x16, 0x67, a);
                host.draw8C(r(i * 0x10 + 0x19c), 0x1000, 0x1000);
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
    const foldT = r(0x1cc);
    if (foldT !== 0) {
        if (foldT !== 0x1000) {
            host.draw8C(foldT, 0x1000, 0x1000);
            host.draw94(0x140, 0x19);
        } else {
            host.draw8C(0x1000, 0x1000, 0x1000);
        }
        host.drawSprite(host.packHandle(0x02860000), 0x18, 0x22, 0xd);
    }
    if (r(0x1dc) !== 0) {
        if (r(0x188) !== 0) {
            if (host.frameCount() - r(0x190) >= 4) {
                w(0x190, host.frameCount());
                const v = r(0x18c) + 1;
                w(0x18c, v);
                if (v >= 5) w(0x18c, 0);
            }
            host.draw74(0x140, 0);
            host.draw88(r(0x18c));
            host.drawSprite(host.packHandle(0x02860000), 0xa, 0x123, 0xd6);
            host.draw88(0);
        }
        const foldB = r(0x1dc);
        if (foldB !== 0x1000) {
            host.draw8C(foldB, 0x1000, 0x1000);
            host.draw94(0, 0xd3);
        } else {
            host.draw8C(0x1000, 0x1000, 0x1000);
        }
        host.draw74(0x280, 0x100);
        host.drawSprite(host.packHandle(0x04040000), 0x20, 0, 0xc2);
    }
    if (host.frameCount() - r(0x74) >= 9) {
        w(0x74, host.frameCount());
        const v = r(0x70) + 1;
        w(0x70, v);
        if (v >= 8) w(0x70, 0);
    }
    if (r(0x80) !== 0) {
        host.drawInit();
        host.draw7C(r(0x54), r(0x58) - 1);
        host.draw74(0x280, 0x100);
        host.draw88(r(0x70));
        host.drawSprite(host.packHandle(0x04040000), 0x1e, 0, r(0x84) * 0x2e + 0x11);
    }
    if (r(0x78) !== 0) {
        host.drawInit();
        host.draw7C(r(0x54), r(0x58) - 1);
        host.draw74(0x280, 0x100);
        host.draw88(r(0x10) >= 0x1e ? 8 : r(0x70));
        host.drawSprite(host.packHandle(0x04040000), 0x1e, 0, r(0x7c) * 0x2e + 0x11);
    }
    if (r(0x1ec) !== 0) {
        host.drawInit();
        host.draw7C(r(0x54), r(0x58));
        host.draw74(0x280, 0x100);
        const foldC = r(0x1ec);
        if (foldC !== 0x1000) {
            host.draw8C(foldC, 0x1000, 0x1000);
            host.draw94(0x140, 0x63);
        }
        const tech = mem.read32(TECH_ICON_TABLE + (mem.read32(obj + r(0x7c) * 0x54 + 0xdc) - 1) * 4) | 0;
        host.drawSprite(host.packHandle(0x04040000), tech, 0x94, 0x2f);
    }
}

/** F0x80094FBC(obj, ui): open, pick a member and a technique, choose a target, close. */
export function techniquesTick(mem: PauseMemory, obj: number, ui: number, host: TechniquesHost): void {
    const r = (off: number) => mem.read32(obj + off) | 0;
    const w = (off: number, v: number) => mem.write32(obj + off, v | 0);
    const at = (off: number) => mem.read32(ui + off) | 0;
    const bank = () => host.languageBank(lang(mem) + 0xb0);
    const bit = (bits: number, code: number) => (bits >> host.padBit(0, code)) & 1;
    const pressed = (code: number) => bit(host.padPressed(0), code) !== 0;
    const pressedOrRepeat = (code: number) =>
        bit(host.padPressed(0), code) !== 0 || bit(host.padRepeat(0), code) !== 0;
    const fill = (row: number, show: number) => rowFill(mem, obj, ui, row, show, host);
    const advance = () => w(0x10, r(0x10) + 1);
    const done = (fold: number) => host.foldTick(obj + fold) !== 0;
    const start = (fold: number, open: number) => host.foldStart(obj + fold, open);
    const say = (target: number, id: number) => host.callMethod(at(target), 0x114, [bank(), id]);
    const hide = (target: number) => host.callMethod(at(target), 0x144, [0]);
    const heals = () => mem.read32(obj + (mem.read32(obj + 0x7c) | 0) * 0x54 + 0xdc) | 0;

    switch (r(0x10)) {
        default:
            start(0x194, 1);
            start(0x1c4, 1);
            if (r(0x5c) === 1) start(0x1d4, 1);
            w(0x10, r(0x5c));
            return;
        case 1:
            host.foldTick(obj + 0x194);
            host.foldTick(obj + 0x1c4);
            if (done(0x1d4)) {
                say(0, 0x27);
                fill(0, 1);
                w(0x10, 0xa);
            }
            return;
        case 2:
            host.foldTick(obj + 0x194);
            if (done(0x1c4)) {
                start(0x1a4, 1);
                start(0x1d4, 1);
                say(0, 0x27);
                fill(0, 1);
                w(0x10, 4);
            }
            return;
        case 4:
            host.foldTick(obj + 0x1a4);
            if (done(0x1d4)) {
                fill(1, 1);
                w(0x10, 0xa);
            }
            return;
        case 3:
            host.foldTick(obj + 0x194);
            if (done(0x1c4)) {
                start(0x1a4, 1);
                say(0, 0x27);
                fill(0, 1);
                w(0x10, 5);
            }
            return;
        case 5:
            if (done(0x1a4)) {
                start(0x1b4, 1);
                start(0x1d4, 1);
                fill(1, 1);
                advance();
            }
            return;
        case 6:
            host.foldTick(obj + 0x1b4);
            if (done(0x1d4)) {
                fill(2, 1);
                w(0x10, 0xa);
            }
            return;
        case 0xa:
            w(0x78, 1);
            say(0x88, 0x28);
            say(0x8c, 0x15);
            advance();
            return;
        case 0xb: {
            const before = r(0x7c);
            if (pressedOrRepeat(4)) {
                w(0x7c, r(0x7c) - 1);
                if (r(0x7c) < 0) w(0x7c, 0);
            } else if (pressedOrRepeat(6)) {
                w(0x7c, r(0x7c) + 1);
                const last = r(0x5c) - 1;
                if (last < r(0x7c)) w(0x7c, last);
            }
            if (before !== r(0x7c)) {
                host.playSound(0x4001b);
                return;
            }
            if (pressed(0xd)) {
                host.playSound(0x4001c);
                w(0x10, 0xf);
                return;
            }
            if (pressed(0xe)) {
                host.playSound(0x800450bd);
                w(0x10, 0x32);
            }
            return;
        }
        case 0xf:
            if (heals() !== 0) {
                w(0x1e4, 8);
                start(0x1e4, 1);
                say(0, 0x2a);
                hide(0x88);
                hide(0x8c);
                w(0x10, 0x1e);
                return;
            }
            w(0x10, 0x10);
            return;
        case 0x10:
            w(0x78, 0);
            say(0x88, 0x29);
            hide(0x8c);
            w(0x188, 1);
            advance();
            return;
        case 0x11:
            if (pressed(0xd)) {
                host.playSound(0x4001c);
                w(0x78, 1);
                say(0x88, 0x28);
                host.callMethod(at(0x8c), 0x144, [1]);
                w(0x188, 0);
                w(0x10, 0xb);
            }
            return;
        case 0x1e:
            if (done(0x1e4)) {
                w(0x88, 0);
                techniquesNamesFill(mem, obj, ui, 1, host);
                techniquesMpCostFill(mem, obj, ui, 1, host);
                host.callMethod(at(0xb0), 0x84, [0xa6, r(0x88) * 0xe + 0x41]);
                host.callMethod(at(0xb0), 0x80, [1]);
                advance();
            }
            return;
        case 0x1f: {
            const before = r(0x88);
            if (pressedOrRepeat(4)) {
                w(0x88, r(0x88) - 1);
                if (r(0x88) < 0) w(0x88, 0);
            } else if (pressedOrRepeat(6)) {
                w(0x88, r(0x88) + 1);
                const last = heals() - 1;
                if (last < r(0x88)) w(0x88, last);
            }
            if (before !== r(0x88)) {
                host.callMethod(at(0xb0), 0x84, [0xa6, r(0x88) * 0xe + 0x41]);
                techniquesMpCostFill(mem, obj, ui, 1, host);
                host.playSound(0x8004513e);
                return;
            }
            if (pressed(0xd)) {
                const tech = techniquesMpGate(mem, obj);
                const stop = () => {
                    host.callMethod(at(0xb0), 0x88, [7]);
                    host.callMethod(at(0xb0), 0x94, [1]);
                };
                if (tech !== 0) {
                    if (mem.read8(TECH_TABLE + (tech - 1) * 0x12 + 5) === 3) {
                        host.playSound(0x8004503c);
                        w(0x80, 1);
                        stop();
                        say(0, 0x2b);
                        advance();
                        return;
                    }
                    stop();
                    techniquesMpCostFill(mem, obj, ui, 0, host);
                    w(0x14, r(0x10));
                    techniquesApplyHeal(mem, obj, ui, 0x8004503c, host);
                    w(0x10, 0x24);
                    w(0x188, 1);
                    return;
                }
                host.playSound(0x8004503c);
                stop();
                techniquesMpCostFill(mem, obj, ui, 0, host);
                say(0x88, 0x69);
                w(0x10, 0x23);
                w(0x188, 1);
                return;
            }
            if (pressed(0xe)) {
                host.playSound(0x800450bd);
                host.foldStart(obj + 0x1e4, 0);
                techniquesNamesFill(mem, obj, ui, 0, host);
                techniquesMpCostFill(mem, obj, ui, 0, host);
                host.callMethod(at(0xb0), 0x80, [0]);
                say(0, 0x27);
                w(0x10, 0x28);
            }
            return;
        }
        case 0x20: {
            const before = r(0x84);
            if (pressedOrRepeat(4)) {
                w(0x84, r(0x84) - 1);
                if (r(0x84) < 0) w(0x84, 0);
            } else if (pressedOrRepeat(6)) {
                w(0x84, r(0x84) + 1);
                const last = r(0x5c) - 1;
                if (last < r(0x84)) w(0x84, last);
            }
            if (before !== r(0x84)) {
                host.playSound(0x4001b);
                return;
            }
            if (pressed(0xd)) {
                techniquesMpCostFill(mem, obj, ui, 0, host);
                if (techniquesMpGate(mem, obj) !== 0) {
                    w(0x80, 0);
                    w(0x14, r(0x10));
                    techniquesApplyHeal(mem, obj, ui, 0x4001c, host);
                    w(0x10, 0x24);
                    w(0x188, 1);
                    return;
                }
                host.playSound(0x4001c);
                w(0x78, 0);
                w(0x80, 0);
                say(0x88, 0x69);
                w(0x10, 0x23);
                w(0x188, 1);
                return;
            }
            if (pressed(0xe)) {
                host.playSound(0x800450bd);
                w(0x10, 0x1f);
                w(0x80, 0);
                host.callMethod(at(0xb0), 0x88, [0]);
                host.callMethod(at(0xb0), 0x94, [0]);
                say(0, 0x2a);
            }
            return;
        }
        case 0x23:
            if (pressed(0xd)) {
                host.playSound(0x4001c);
                techniquesMpCostFill(mem, obj, ui, 1, host);
                host.callMethod(at(0xb0), 0x88, [0]);
                host.callMethod(at(0xb0), 0x94, [0]);
                w(0x10, 0x1f);
                w(0x188, 0);
            }
            return;
        case 0x24:
            if (pressed(0xd)) {
                host.playSound(0x4001c);
                techniquesMpCostFill(mem, obj, ui, 1, host);
                const back = r(0x14);
                w(0x10, back);
                if (back === 0x1f) {
                    host.callMethod(at(0xb0), 0x88, [0]);
                    host.callMethod(at(0xb0), 0x94, [0]);
                    w(0x188, 0);
                    return;
                }
                w(0x80, 1);
                w(0x188, 0);
            }
            return;
        case 0x28:
            if (done(0x1e4)) host.callMethod(obj, 0x2c, [0xa]);
            return;
        case 0x32:
            w(0x78, 0);
            hide(0x8c);
            start(0x1d4, 0);
            techniquesMpCostFill(mem, obj, ui, 0, host);
            host.foldStart(obj + r(0x5c) * 0x10 + 0x184, 0);
            fill(r(0x5c) - 1, 0);
            if (r(0x5c) === 1) {
                hide(0);
                start(0x1c4, 0);
            }
            w(0x10, r(0x5c) + 0x32);
            return;
        case 0x33:
            host.foldTick(obj + 0x194);
            host.foldTick(obj + 0x1c4);
            if (done(0x1d4)) w(0xc, 3);
            return;
        case 0x34:
            host.foldTick(obj + 0x1a4);
            if (done(0x1d4)) {
                start(0x194, 0);
                fill(0, 0);
                start(0x1c4, 0);
                hide(0);
                w(0x10, 0x36);
            }
            return;
        case 0x35:
            host.foldTick(obj + 0x1b4);
            if (done(0x1d4)) {
                start(0x1a4, 0);
                fill(1, 0);
                w(0x10, 0x37);
            }
            return;
        case 0x37:
            if (done(0x1a4)) {
                start(0x194, 0);
                start(0x1c4, 0);
                hide(0);
                fill(0, 0);
                advance();
            }
            return;
        case 0x36:
        case 0x38:
            host.foldTick(obj + 0x194);
            if (done(0x1c4)) w(0xc, 3);
            return;
    }
}

/** F0x80096380(obj, ui): the page's lifecycle. */
export function techniquesRoot(mem: PauseMemory, obj: number, ui: number, host: TechniquesHost): void {
    const state = mem.read32(obj + 0xc) | 0;
    if (state === 1) {
        techniquesTick(mem, obj, ui, host);
        techniquesDraw(mem, obj, host);
        return;
    }
    if (state >= 2 && state < 4) return;
    host.callMethod(obj, 0x38, []);
    for (let i = 0; i < 3; i++) {
        if (partyPositionToRosterSlot(mem, i) >= 0) mem.write32(obj + 0x5c, (mem.read32(obj + 0x5c) | 0) + 1);
    }
    const size = mem.read32(obj + 0x5c) | 0;
    for (let i = 0; i < size; i++) {
        mem.write32(obj + 0x194 + i * 0x10, 0xa);
        host.foldStart(obj + 0x194 + i * 0x10, 1);
    }
    for (let i = 0; i < 2; i++) {
        mem.write32(obj + 0x1c4 + i * 0x10, 0xa);
        host.foldStart(obj + 0x1c4 + i * 0x10, 1);
    }
    for (let i = 0; i < size; i++) mem.write32(obj + i * 0x54 + 0xdc, techniquesHealList(mem, obj, i));
    techniquesCtor(mem, obj, ui, host);
}
