// The DIGIVOLVE pause page (a partner's forms, their stat boosts and the techniques a
// form teaches), translated from the original pro/ststatus bodies, with the linear
// tween it slides its panel with.
//
// Part D of docs/plans/2026-09-28-translated-game-completion-plan.md. Oracle:
// tests/lane-b/pause-digivolve.test.js runs each original through engine/native.
//
//   F0x8008B4CC digivolveFactory   build the page object (0xFC bytes, 0x90 extra).
//   F0x8008B3C8 digivolveRoot      build, tick and draw.
//   F0x8008833C digivolveCtor      the form list, stat and technique widgets.
//   F0x8008865C digivolveForms     the three form names and the current-form mark.
//   F0x8008886C digivolveChoice    the chosen form's name and the two choices.
//   F0x80088A44 digivolveStats     the form's stat boosts and technique names.
//   F0x800891A4 digivolveSlide     move the stat widgets with the panel slide.
//   F0x8008933C digivolveTechInfo  the highlighted technique's name and cost.
//   F0x800895C8 digivolveDraw      panels, icons and the blink.
//   F0x80089BF0 digivolveTick      pick a form, choose, list techniques, close.
//   F0x80099E5C tweenStart         start a linear tween with its sound.
//   F0x80099EF0 tweenTick          step it; nonzero once landed.
//
// Object fields: +0x10 sub-state; +0x5C form row; +0x60 choice; +0x64 technique row;
// +0x68 technique count; +0x6C the technique list is showing; +0x70 the partner's
// party position; +0x74 the three form ids; +0x7C form count; +0x80 the stats are
// showing; +0x84 the slide tween (value at +0x8C); +0xA0 the blink is on; +0xA4/+0xA8
// blink frame and timer; +0xAC.. panel folds at 0xAC, 0xBC, 0xCC, 0xDC, 0xEC.
import { PAUSE_CTX, PAUSE_LANGUAGE_CELL, type PauseMemory, type PauseServices } from "./pause-services.ts";
import { formEntryCopy } from "./pause-techniques.ts";
import { PROFILE_STRIDE, PROFILE_TABLE_BASE, profileRecord, rosterSlotProfileAddress } from "./pause-status.ts";
import { partyPositionToRosterSlot, rosterContextBase } from "../../party-context.ts";
import { validateEquippedForm } from "../../form-ledger.ts";

export const DIGIVOLVE_HANDLER = 0x8008b3c8;
export const DIGIVOLVE_SIZE = 0xfc;
export const DIGIVOLVE_EXTRA = 0x90;
const LAYOUT = 0x8009af6c;
const LEFT_STATS = 0x8009a7fc;
const RIGHT_STATS = 0x8009a814;
const TECHNIQUES = 0x80042bdc;
const TECHNIQUE_STRIDE = 0x12;

const s16 = (v: number): number => (v << 16) >> 16;
const lang = (mem: PauseMemory): number => mem.read32(PAUSE_LANGUAGE_CELL) | 0;

export interface DigivolveHost extends PauseServices {
    alloc(handler: number, size: number, extra: number): number;
    /** [0x80048D34+0x2734](slot, dest): the effective stat copy. */
    copyStats(slot: number, dest: number): void;
    /** 0x100 scratch bytes: the stat copy at +0, the form entry at +0x30. */
    scratch(): number;
}

const bankOf = (mem: PauseMemory, host: DigivolveHost, offset: number): number => host.languageBank(lang(mem) + offset);
const cardWord = (slot: number): number => rosterContextBase(slot) + 0x75c + 8;

/** F0x80099E5C(tween, from, to, frames): start a linear tween. */
export function tweenStart(mem: PauseMemory, tween: number, from: number, to: number, frames: number,
    host: Pick<PauseServices, "playSound">): void {
    if (from === to) return;
    host.playSound(0x40019);
    mem.write32(tween, frames);
    mem.write32(tween + 0xc, (from << 8) | 0);
    mem.write32(tween + 8, from);
    mem.write32(tween + 0x10, to);
    mem.write32(tween + 0x18, 1);
    mem.write32(tween + 0x14, ((((to - from) << 8) | 0) / frames) | 0);
}

/** F0x80099EF0(tween): step the tween; nonzero once it has landed. */
export function tweenTick(mem: PauseMemory, tween: number): number {
    if ((mem.read32(tween + 0x18) | 0) === 0) return 1;
    const step = mem.read32(tween + 0x14) | 0;
    const c = ((mem.read32(tween + 0xc) | 0) + step) | 0;
    mem.write32(tween + 0xc, c);
    const v = c >> 8;
    mem.write32(tween + 8, v);
    const over = step > 0 ? (mem.read32(tween + 0x10) | 0) < v : v < (mem.read32(tween + 0x10) | 0);
    if (!over) return 0;
    mem.write32(tween + 8, mem.read32(tween + 0x10));
    mem.write32(tween + 0x18, 0);
    return 1;
}

/** F0x8008B4CC(parent): build the page object. */
export function digivolveFactory(mem: PauseMemory, parent: number, host: DigivolveHost): number {
    const obj = host.alloc(DIGIVOLVE_HANDLER, DIGIVOLVE_SIZE, DIGIVOLVE_EXTRA);
    mem.write32(obj + 0x54, 0x1000);
    mem.write32(obj + 0x58, 6);
    mem.write32(obj + 0x50, parent);
    mem.write32(obj + 0x70, mem.read32(parent + 0x7c));
    return obj;
}

/** F0x8008833C(obj, ui): the page's widgets. */
export function digivolveCtor(mem: PauseMemory, obj: number, ui: number, host: DigivolveHost): void {
    const layer = () => mem.read32(obj + 0x54) | 0;
    const order = () => (mem.read32(obj + 0x58) | 0) - 1;
    const text = (x: number, y: number) => host.createText(layer(), 1, x, y);
    const put = (off: number, widget: number) => mem.write32(ui + off, widget);
    for (let i = 0; i < 3; i++) put(i * 4, text(0xbd, 0x31 + i * 0xe));
    const formCursor = host.createIcon(layer(), order(), 0xb0, s16((mem.read32(obj + 0x5c) | 0) * 0xe + 0x31));
    put(0xc, formCursor);
    host.callMethod(formCursor, 0x80, [0]);
    put(0x10, text(0x5e, 0x4d));
    put(0x14, text(0xb2, 0x2a));
    for (let i = 0; i < 2; i++) put(0x18 + i * 4, text(0xbd, 0x3a + i * 0xe));
    const choiceCursor = host.createIcon(layer(), order(), 0xb4, s16((mem.read32(obj + 0x60) | 0) * 0xe + 0x3a));
    put(0x20, choiceCursor);
    host.callMethod(choiceCursor, 0x80, [0]);
    put(0x28, text(0x4f, 0x68));
    put(0x30, text(0xeb, 0x68));
    put(0x2c, text(0x12f, 0x68));
    for (let i = 0; i < 6; i++) put(0x34 + i * 4, text(0x71, 0x7c + i * 0xe));
    for (let i = 0; i < 7; i++) put(0x4c + i * 4, text(0x9b, 0x7c + i * 0xe));
    for (let i = 0; i < 6; i++) put(0x68 + i * 4, text(0xc4, 0x88 + i * 0xe));
    const techCursor = host.createIcon(layer(), order(), 0xa9, 0x88);
    put(0x24, techCursor);
    host.callMethod(techCursor, 0x80, [0]);
    put(0x80, text(0x98, 0x13));
    const layout = mem.read32(LAYOUT) | 0;
    const at = (base: number) => text(mem.read16s(layout + base + 4), mem.read16s(layout + base + 8));
    put(0x84, at(0x90));
    put(0x88, at(0x9c));
    put(0x8c, at(0xa8));
}

/** F0x8008865C(obj, ui, show): the three form names and the current-form mark. */
export function digivolveForms(mem: PauseMemory, obj: number, ui: number, show: number, host: DigivolveHost): void {
    const w = (off: number) => mem.read32(ui + off) | 0;
    if (show === 0) {
        for (let i = 0; i < 3; i++) host.callMethod(w(i * 4), 0x144, [0]);
        host.callMethod(w(0x10), 0x144, [0]);
        return;
    }
    const slot = partyPositionToRosterSlot(mem, mem.read32(obj + 0x70) | 0);
    for (let i = 0; i < 3; i++) {
        const form = mem.read16s(obj + 0x74 + i * 2);
        if (form > 0) {
            const record = profileRecord(mem, form);
            host.callMethod(w(i * 4), 0x114, [bankOf(mem, host, 0x4e), mem.read8(record + 0x55)]);
            host.callMethod(w(i * 4), 0x138, [(mem.read32(cardWord(slot)) | 0) === form ? 1 : 0]);
        } else {
            host.callMethod(w(i * 4), 0x144, [0]);
        }
    }
    host.callMethod(w(0x10), 0x114, [host.languageBank(lang(mem) + 0x4e), mem.read8(rosterSlotProfileAddress(mem, slot) + 0x55)]);
}

/** F0x8008886C(obj, ui, show): the chosen form's name and the two choices. */
export function digivolveChoice(mem: PauseMemory, obj: number, ui: number, show: number, host: DigivolveHost): void {
    const w = (off: number) => mem.read32(ui + off) | 0;
    if (show === 0) {
        host.callMethod(w(0x14), 0x144, [0]);
        for (let i = 0; i < 2; i++) host.callMethod(w(0x18 + i * 4), 0x144, [0]);
        return;
    }
    const slot = partyPositionToRosterSlot(mem, mem.read32(obj + 0x70) | 0);
    const form = mem.read16s(obj + 0x74 + (mem.read32(obj + 0x5c) | 0) * 2);
    host.callMethod(w(0x14), 0x114, [bankOf(mem, host, 0x4e), mem.read8(profileRecord(mem, form) + 0x55)]);
    const current = (mem.read32(cardWord(slot)) | 0) === form;
    host.callMethod(w(0x18), 0x114, [bankOf(mem, host, 0xb0), current ? 0x3a : 0x39]);
    host.callMethod(w(0x1c), 0x114, [host.languageBank(lang(mem) + 0xb0), 0x3b]);
}

const clamp = (v: number): number => (v >= 0x3e8 ? 0x3e7 : v);

/** F0x80088A44(obj, ui, show): the form's stat boosts and technique names. */
export function digivolveStats(mem: PauseMemory, obj: number, ui: number, show: number, host: DigivolveHost): void {
    const w = (off: number) => mem.read32(ui + off) | 0;
    if (show === 0) {
        host.callMethod(w(0x28), 0x144, [0]);
        host.callMethod(w(0x30), 0x144, [0]);
        host.callMethod(w(0x2c), 0x144, [0]);
        for (let i = 0; i < 13; i++) host.callMethod(w(0x34 + i * 4), 0x144, [0]);
        for (let i = 0; i < 6; i++) host.callMethod(w(0x68 + i * 4), 0x144, [0]);
        mem.write32(obj + 0x80, 0);
        return;
    }
    const stats = host.scratch();
    const entry = stats + 0x30;
    const slot = partyPositionToRosterSlot(mem, mem.read32(obj + 0x70) | 0);
    const statAt = (id: number) => mem.read16s(stats + id * 2);
    if ((mem.read32(obj + 0x6c) | 0) !== 0) {
        const form = mem.read16s(obj + 0x74 + (mem.read32(obj + 0x5c) | 0) * 2);
        formEntryCopy(mem, slot, form, entry);
        host.copyStats(slot, stats);
        const record = profileRecord(mem, form);
        host.callMethod(w(0x28), 0x114, [bankOf(mem, host, 0x4e), mem.read8(record + 0x55)]);
        host.callMethod(w(0x30), 0x114, [bankOf(mem, host, 0xb0), 0x38]);
        host.callMethod(w(0x2c), 0x118, [0, (mem.read8(entry + 2) << 24) >> 24]);
        host.callMethod(w(0x2c), 0x148, [1]);
        for (let i = 0; i < 6; i++) {
            const v = clamp(statAt(mem.read32(LEFT_STATS + i * 4) | 0) + mem.read16(record + 2 + i * 2));
            host.callMethod(w(0x34 + i * 4), 0x118, [0, v]);
            if (i === 0 && mem.read16s(stats + 0x26) !== 0) host.callMethod(w(0x34), 0x138, [6]);
            else if (i === 1 && mem.read16s(stats + 0x28) !== 0) host.callMethod(w(0x38), 0x138, [6]);
            else if (i === 4 && mem.read16s(stats + 0x2a) !== 0) host.callMethod(w(0x44), 0x138, [6]);
        }
        for (let i = 0; i < 7; i++) {
            const v = clamp(statAt(mem.read32(RIGHT_STATS + i * 4) | 0) + mem.read16(record + 0xe + i * 2));
            host.callMethod(w(0x4c + i * 4), 0x118, [0, v]);
        }
        for (let i = 0; i < 13; i++) host.callMethod(w(0x34 + i * 4), 0x148, [1]);
        for (let i = 0; i < 6; i++) {
            const t = mem.read16s(entry + 8 + i * 2);
            if (t !== 0) {
                host.callMethod(w(0x68 + i * 4), 0x114, [bankOf(mem, host, 0xa2), t & 0x1fff]);
                host.callMethod(w(0x68 + i * 4), 0x138, [(t & 0x8000) !== 0 ? 3 : (t & 0x4000) !== 0 ? 4 : 0]);
            } else {
                host.callMethod(w(0x68 + i * 4), 0x144, [0]);
            }
        }
    } else {
        const record = rosterSlotProfileAddress(mem, slot);
        host.copyStats(slot, stats);
        host.callMethod(w(0x28), 0x114, [bankOf(mem, host, 0x4e), mem.read8(record + 0x55)]);
        host.callMethod(w(0x30), 0x114, [bankOf(mem, host, 0xb0), 0x38]);
        host.callMethod(w(0x2c), 0x114, [bankOf(mem, host, 0xb0), 0xd]);
        host.callMethod(w(0x2c), 0x148, [1]);
        for (let i = 0; i < 6; i++) {
            const v = clamp(statAt(mem.read32(LEFT_STATS + i * 4) | 0));
            host.callMethod(w(0x34 + i * 4), 0x118, [0, v]);
            if (i === 0 && mem.read16s(stats + 0x26) !== 0) host.callMethod(w(0x34), 0x138, [6]);
            else if (i === 1 && mem.read16s(stats + 0x28) !== 0) host.callMethod(w(0x38), 0x138, [6]);
            else if (i === 4 && mem.read16s(stats + 0x2a) !== 0) host.callMethod(w(0x44), 0x138, [6]);
        }
        for (let i = 0; i < 7; i++) {
            const v = clamp(statAt(mem.read32(RIGHT_STATS + i * 4) | 0));
            host.callMethod(w(0x4c + i * 4), 0x118, [0, v]);
        }
        for (let i = 0; i < 13; i++) host.callMethod(w(0x34 + i * 4), 0x148, [1]);
        for (let i = 0; i < 6; i++) {
            const t = mem.read16(record + 2 + i * 2 + 0x1c);
            if (t !== 0) {
                host.callMethod(w(0x68 + i * 4), 0x114, [bankOf(mem, host, 0xa2), t]);
                host.callMethod(w(0x68 + i * 4), 0x138, [3]);
            } else {
                host.callMethod(w(0x68 + i * 4), 0x144, [0]);
            }
        }
    }
    mem.write32(obj + 0x80, 1);
}

/** F0x800891A4(obj, ui): move the stat widgets with the panel slide. */
export function digivolveSlide(mem: PauseMemory, obj: number, ui: number, host: DigivolveHost): void {
    const w = (off: number) => mem.read32(ui + off) | 0;
    const slide = () => mem.read16(obj + 0x8c);
    host.callMethod(w(0x28), 0x134, [0x4f, s16(slide() + 0x68)]);
    host.callMethod(w(0x30), 0x134, [0xeb, s16(slide() + 0x68)]);
    host.callMethod(w(0x2c), 0x134, [0x12f, s16(slide() + 0x68)]);
    for (let i = 0; i < 6; i++) host.callMethod(w(0x34 + i * 4), 0x134, [0x71, s16(i * 0xe + slide() + 0x7c)]);
    for (let i = 0; i < 7; i++) host.callMethod(w(0x4c + i * 4), 0x134, [0x9b, s16(i * 0xe + slide() + 0x7c)]);
    for (let i = 0; i < 6; i++) host.callMethod(w(0x68 + i * 4), 0x134, [0xc4, s16(i * 0xe + slide() + 0x88)]);
}

/** F0x8008933C(obj, ui, show): the highlighted technique's name and cost. */
export function digivolveTechInfo(mem: PauseMemory, obj: number, ui: number, show: number, host: DigivolveHost): void {
    const w = (off: number) => mem.read32(ui + off) | 0;
    const hide = () => {
        host.callMethod(w(0x84), 0x144, [0]);
        host.callMethod(w(0x88), 0x144, [0]);
        host.callMethod(w(0x8c), 0x144, [0]);
    };
    if (show === 0) return hide();
    const slot = partyPositionToRosterSlot(mem, mem.read32(obj + 0x70) | 0);
    let tech: number;
    if ((mem.read32(obj + 0x6c) | 0) !== 0) {
        const entry = host.scratch();
        formEntryCopy(mem, slot, mem.read16s(obj + 0x74 + (mem.read32(obj + 0x5c) | 0) * 2), entry);
        tech = mem.read16(entry + 8 + (mem.read32(obj + 0x64) | 0) * 2) & 0x1fff;
    } else {
        tech = mem.read16(rosterSlotProfileAddress(mem, slot) + (((mem.read32(obj + 0x64) | 0) + 1) * 2) + 0x1c);
    }
    if (tech <= 0) return hide();
    host.callMethod(w(0x84), 0x114, [bankOf(mem, host, 0x9b), tech]);
    host.callMethod(w(0x88), 0x114, [bankOf(mem, host, 0xb0), 3]);
    host.callMethod(w(0x8c), 0x118, [0, mem.read16(TECHNIQUES + (tech - 1) * TECHNIQUE_STRIDE)]);
    host.callMethod(w(0x8c), 0x148, [1]);
}

/** F0x800895C8(obj): panels, icons and the blink. */
export function digivolveDraw(mem: PauseMemory, obj: number, host: DigivolveHost): void {
    const r = (off: number) => mem.read32(obj + off) | 0;
    const pack = (id: number) => host.packHandle(id);
    const clip = (tech: number) => mem.read8(TECHNIQUES + (tech - 1) * TECHNIQUE_STRIDE + 4) + 0x37;
    host.drawInit();
    host.draw7C(r(0x54), r(0x58));
    host.draw74(0x280, 0x100);
    const a = r(0xc4);
    if (a !== 0) {
        if (a !== 0x1000) {
            host.draw8C(a, 0x1000, 0x1000);
            host.draw94(0x140, 0x44);
        }
        host.drawSprite(pack(0x04040000), 0x24, 0xa8, 0x28);
    }
    const b = r(0xd4);
    if (b !== 0) {
        if (b !== 0x1000) {
            host.draw8C(b, 0x1000, 0x1000);
            host.draw94(0x140, 0x41);
        } else {
            host.draw8C(0x1000, 0x1000, 0x1000);
        }
        host.drawSprite(pack(0x04040000), 0x26, 0xa8, 0x28);
    }
    const c = r(0xe4);
    if (c !== 0) {
        if (c !== 0x1000) {
            host.draw8C(c, 0x1000, 0x1000);
            host.draw94(0x140, 0xa2);
        } else {
            host.draw8C(0x1000, 0x1000, 0x1000);
        }
        host.draw74(0x140, 0);
        host.drawSprite(pack(0x02860000), 0x14, 0x4f, r(0x8c) + 0x7c);
        if (r(0x80) !== 0) {
            const slot = partyPositionToRosterSlot(mem, r(0x70));
            if (r(0x6c) !== 0) {
                const entry = host.scratch();
                formEntryCopy(mem, slot, mem.read16s(obj + 0x74 + r(0x5c) * 2), entry);
                for (let i = 0; i < 6; i++) {
                    const t = mem.read16s(entry + 8 + i * 2) & 0x1fff;
                    if (t !== 0) host.drawSprite(pack(0x02860000), clip(t), 0xb6, r(0x8c) + 0x88 + i * 0xe);
                }
            } else {
                // Six passes, the last reading the word at +0x28 (the loop tests before it increments).
                for (let i = 1; i <= 6; i++) {
                    const t = mem.read16(rosterSlotProfileAddress(mem, slot) + i * 2 + 0x1c);
                    if (t > 0) host.drawSprite(pack(0x02860000), clip(t), 0xb6, r(0x8c) + ((i - 1) * 0xe + 0x88));
                }
            }
        }
        host.draw74(0x280, 0x100);
        host.drawSprite(pack(0x04040000), 0x27, 0x48, r(0x8c) + 0x61);
    }
    const d = r(0xf4);
    if (d !== 0) {
        if (r(0xa0) !== 0) {
            if (host.frameCount() - r(0xa8) >= 4) {
                mem.write32(obj + 0xa8, host.frameCount());
                const v = r(0xa4) + 1;
                mem.write32(obj + 0xa4, v);
                if (v >= 5) mem.write32(obj + 0xa4, 0);
            }
            host.draw74(0x140, 0);
            host.draw88(r(0xa4));
            host.drawSprite(pack(0x02860000), 0xa, 0x123, 0xd6);
            host.draw88(0);
        }
        const fold = r(0xf4);
        if (fold !== 0x1000) {
            host.draw8C(fold, 0x1000, 0x1000);
            host.draw94(0, 0xd3);
        } else {
            host.draw8C(0x1000, 0x1000, 0x1000);
        }
        host.draw74(0x280, 0x100);
        host.drawSprite(pack(0x04040000), 0x20, 0, 0xc2);
    }
    const e = r(0xb4);
    if (e !== 0) {
        if (e !== 0x1000) {
            host.draw8C(e, 0x1000, 0x1000);
            host.draw94(0x140, 0xd);
        } else {
            host.draw8C(0x1000, 0x1000, 0x1000);
        }
        host.draw74(0x140, 0);
        host.drawSprite(pack(0x02860000), 0x18, 0x22, 0xd);
    }
}

/** F0x80089BF0(obj, ui): pick a form, choose, list techniques, close. */
export function digivolveTick(mem: PauseMemory, obj: number, ui: number, host: DigivolveHost): void {
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
    const say = (target: number, id: number) => host.callMethod(at(target), 0x114, [host.languageBank(lang(mem) + 0xb0), id]);
    const slideIn = () => tweenStart(mem, obj + 0x84, 0, -0x22, 4, host);
    const slideOut = () => tweenStart(mem, obj + 0x84, -0x22, 0, 4, host);
    const slot = () => partyPositionToRosterSlot(mem, r(0x70));
    const form = () => mem.read16s(obj + 0x74 + r(0x5c) * 2);
    const entryAt = () => host.scratch();
    const techAt = (index: number) => mem.read16(entryAt() + 8 + index * 2) & 0x1fff;
    const slideAndAdvance = (open: number) => {
        if (open) {
            start(0xec, 1);
            advance();
        }
        digivolveSlide(mem, obj, ui, host);
    };
    const formMove = () => {
        digivolveStats(mem, obj, ui, 1, host);
        host.callMethod(at(0xc), 0x84, [0xb0, r(0x5c) * 0xe + 0x31]);
        host.playSound(0x8004513e);
    };
    switch (r(0x10)) {
        default:
            start(0xac, 1);
            advance();
            return;
        case 1:
            if (tick(0xac)) {
                say(0x80, 0x37);
                start(0xbc, 1);
                advance();
            }
            return;
        case 2:
            if (tick(0xbc)) {
                digivolveForms(mem, obj, ui, 1, host);
                start(0xdc, 1);
                advance();
            }
            return;
        case 3:
            if (tick(0xdc)) {
                digivolveStats(mem, obj, ui, 1, host);
                host.callMethod(at(0xc), 0x84, [0x50, 0x4d]);
                host.callMethod(at(0xc), 0x80, [1]);
                advance();
            }
            return;
        case 4: {
            if (r(0x6c) !== 0) {
                const before = r(0x5c);
                if (pressed(7)) {
                    w(0x6c, 0);
                    digivolveStats(mem, obj, ui, 1, host);
                    host.callMethod(at(0xc), 0x84, [0x50, 0x4d]);
                    host.playSound(0x8004513e);
                    return;
                }
                if (pressedOrRepeat(4)) {
                    const v = r(0x5c) - 1;
                    w(0x5c, v);
                    if (v < 0) w(0x5c, 0);
                } else if (pressedOrRepeat(6)) {
                    const v = r(0x5c) + 1;
                    const limit = r(0x7c) - 1;
                    w(0x5c, v);
                    if (limit < v) w(0x5c, limit);
                }
                if (before !== r(0x5c)) {
                    formMove();
                    return;
                }
                if (pressed(0xd)) {
                    host.playSound(0x8004503c);
                    w(0x10, 0xa);
                    return;
                }
                if (pressed(0xe)) {
                    host.playSound(0x800450bd);
                    w(0x10, 0x32);
                }
                return;
            }
            if (r(0x7c) > 0 && pressed(5)) {
                w(0x6c, 1);
                formMove();
                return;
            }
            if (pressed(0xd)) {
                host.playSound(0x8004503c);
                w(0x10, 0x3c);
                return;
            }
            if (pressed(0xe)) {
                host.playSound(0x800450bd);
                w(0x10, 0x32);
            }
            return;
        }
        case 0xa:
            start(0xbc, 0);
            digivolveForms(mem, obj, ui, 0, host);
            host.callMethod(at(0xc), 0x80, [0]);
            say(0x80, 0x2c);
            advance();
            return;
        case 0xb:
            if (tick(0xbc)) {
                start(0xcc, 1);
                advance();
            }
            return;
        case 0xc:
            if (tick(0xcc)) {
                digivolveChoice(mem, obj, ui, 1, host);
                host.callMethod(at(0x20), 0x80, [1]);
                advance();
            }
            return;
        case 0xd: {
            const before = r(0x60);
            if (pressedOrRepeat(4)) w(0x60, 0);
            else if (pressedOrRepeat(6)) w(0x60, 1);
            if (before !== r(0x60)) {
                host.playSound(0x8004513e);
                host.callMethod(at(0x20), 0x84, [0xb4, r(0x60) * 0xe + 0x3a]);
            }
            if (pressed(0xd)) {
                host.playSound(0x8004503c);
                let next = 0x28;
                if (r(0x60) === 0) {
                    const word = cardWord(slot());
                    const chosen = mem.read16s(obj + 0x74 + r(0x5c) * 2);
                    if ((mem.read32(word) | 0) === chosen) mem.write32(word, 0);
                    else mem.write32(word, chosen);
                    next = 0x19;
                }
                w(0x10, next);
                return;
            }
            if (pressed(0xe)) {
                host.playSound(0x800450bd);
                w(0x10, 0x14);
            }
            return;
        }
        case 0x14:
            start(0xcc, 0);
            digivolveChoice(mem, obj, ui, 0, host);
            host.callMethod(at(0x20), 0x80, [0]);
            say(0x80, 0x37);
            advance();
            return;
        case 0x15:
            if (tick(0xcc)) {
                start(0xbc, 1);
                advance();
            }
            return;
        case 0x19:
            start(0xac, 0);
            host.callMethod(at(0x80), 0x144, [0]);
            start(0xcc, 0);
            digivolveChoice(mem, obj, ui, 0, host);
            host.callMethod(at(0x20), 0x80, [0]);
            advance();
            return;
        case 0x1a:
            host.foldTick(obj + 0xac);
            if (tick(0xcc)) {
                slideIn();
                advance();
            }
            return;
        case 0x1b:
            if (tweenTick(mem, obj + 0x84) !== 0) slideAndAdvance(1);
            else slideAndAdvance(0);
            return;
        case 0x1c:
            if (tick(0xec)) {
                if ((mem.read32(rosterContextBase(slot()) + 0x764) | 0) !== 0) say(0x84, 0x3c);
                else say(0x84, 0x3d);
                w(0xa0, 1);
                advance();
            }
            return;
        case 0x1d:
            if (pressed(0xd)) {
                host.playSound(0x4001c);
                w(0xa0, 0);
                advance();
            }
            return;
        case 0x1e:
            start(0xec, 0);
            host.callMethod(at(0x84), 0x144, [0]);
            start(0xdc, 0);
            digivolveStats(mem, obj, ui, 0, host);
            advance();
            return;
        case 0x1f:
            host.foldTick(obj + 0xec);
            if (tick(0xdc)) {
                w(0x6c, 0);
                slideIn();
                digivolveSlide(mem, obj, ui, host);
                w(0x10, 0);
            }
            return;
        case 0x28:
            start(0xcc, 0);
            digivolveChoice(mem, obj, ui, 0, host);
            host.callMethod(at(0x20), 0x80, [0]);
            say(0x80, 0x2a);
            advance();
            return;
        case 0x29:
            if (tick(0xcc)) {
                slideIn();
                advance();
            }
            return;
        case 0x2a:
            if (tweenTick(mem, obj + 0x84) !== 0) slideAndAdvance(1);
            else slideAndAdvance(0);
            return;
        case 0x2b:
            if (tick(0xec)) {
                const entry = entryAt();
                formEntryCopy(mem, slot(), form(), entry);
                w(0x64, -1);
                w(0x68, 0);
                for (let i = 0; i < 6; i++) {
                    if (techAt(i) !== 0) {
                        w(0x68, r(0x68) + 1);
                        if (r(0x64) === -1) w(0x64, i);
                    }
                }
                if (r(0x68) !== 0) {
                    host.callMethod(at(0x24), 0x84, [0xa9, r(0x64) * 0xe + r(0x8c) + 0x88]);
                    host.callMethod(at(0x24), 0x80, [1]);
                    digivolveTechInfo(mem, obj, ui, 1, host);
                } else {
                    say(0x84, 0x3e);
                }
                advance();
            }
            return;
        case 0x2c: {
            if (r(0x68) !== 0) {
                const before = r(0x64);
                formEntryCopy(mem, slot(), form(), entryAt());
                if (pressedOrRepeat(4)) {
                    w(0x64, r(0x64) - 1);
                    if (r(0x64) >= 0) {
                        for (;;) {
                            const here = r(0x64);
                            if (techAt(here) > 0) break;
                            w(0x64, here - 1);
                            if (r(0x64) < 0) {
                                w(0x64, before);
                                break;
                            }
                        }
                    } else {
                        w(0x64, before);
                    }
                } else if (pressedOrRepeat(6)) {
                    let v = r(0x64) + 1;
                    for (;;) {
                        w(0x64, v);
                        if (v >= 6) {
                            w(0x64, before);
                            break;
                        }
                        const here = r(0x64);
                        v = here + 1;
                        if (techAt(here) > 0) break;
                    }
                }
                if (before !== r(0x64)) {
                    host.playSound(0x8004513e);
                    host.callMethod(at(0x24), 0x84, [0xa9, r(0x64) * 0xe + r(0x8c) + 0x88]);
                    digivolveTechInfo(mem, obj, ui, 1, host);
                }
            }
            if (pressed(0xd)) {
                host.playSound(0x8004503c);
                advance();
                return;
            }
            if (pressed(0xe)) {
                host.playSound(0x800450bd);
                advance();
            }
            return;
        }
        case 0x2d:
            say(0x80, 0x2c);
            host.callMethod(at(0x24), 0x80, [0]);
            digivolveTechInfo(mem, obj, ui, 0, host);
            slideOut();
            start(0xec, 0);
            advance();
            return;
        case 0x2e:
            tweenTick(mem, obj + 0x84);
            if (tick(0xec)) {
                start(0xcc, 1);
                advance();
            }
            digivolveSlide(mem, obj, ui, host);
            return;
        case 0x2f:
            if (tick(0xcc)) {
                host.callMethod(at(0x20), 0x80, [1]);
                digivolveChoice(mem, obj, ui, 1, host);
                w(0x10, 0xd);
            }
            return;
        case 0x32:
            start(0xac, 0);
            start(0xbc, 0);
            start(0xdc, 0);
            digivolveForms(mem, obj, ui, 0, host);
            digivolveStats(mem, obj, ui, 0, host);
            host.callMethod(at(0xc), 0x80, [0]);
            host.callMethod(at(0x80), 0x144, [0]);
            advance();
            return;
        case 0x33:
            host.foldTick(obj + 0xac);
            host.foldTick(obj + 0xbc);
            if (tick(0xdc)) w(0xc, 3);
            return;
        case 0x3c:
            start(0xbc, 0);
            digivolveForms(mem, obj, ui, 0, host);
            host.callMethod(at(0xc), 0x80, [0]);
            say(0x80, 0x2a);
            advance();
            return;
        case 0x3d:
            if (tick(0xbc)) {
                slideIn();
                advance();
            }
            return;
        case 0x3e:
            if (tweenTick(mem, obj + 0x84) !== 0) slideAndAdvance(1);
            else slideAndAdvance(0);
            return;
        case 0x3f:
            if (tick(0xec)) {
                const tech = mem.read16(rosterSlotProfileAddress(mem, partyPositionToRosterSlot(mem, r(0x70))) + 0x28);
                w(0x64, 5);
                host.callMethod(at(0x24), 0x84, [0xa9, r(0x8c) + 0xce]);
                host.callMethod(at(0x24), 0x80, [1]);
                host.callMethod(at(0x84), 0x114, [bankOf(mem, host, 0x9b), tech]);
                host.callMethod(at(0x88), 0x114, [bankOf(mem, host, 0xb0), 3]);
                host.callMethod(at(0x8c), 0x118, [0, mem.read16(TECHNIQUES + (tech - 1) * TECHNIQUE_STRIDE)]);
                host.callMethod(at(0x8c), 0x148, [1]);
                advance();
            }
            return;
        case 0x40:
            if (pressed(0xd)) {
                host.playSound(0x8004503c);
                advance();
                return;
            }
            if (pressed(0xe)) {
                host.playSound(0x800450bd);
                advance();
            }
            return;
        case 0x41:
            say(0x80, 0x37);
            host.callMethod(at(0x24), 0x80, [0]);
            digivolveTechInfo(mem, obj, ui, 0, host);
            slideOut();
            start(0xec, 0);
            advance();
            return;
        case 0x42:
            tweenTick(mem, obj + 0x84);
            if (tick(0xec)) {
                start(0xbc, 1);
                advance();
            }
            digivolveSlide(mem, obj, ui, host);
            return;
        case 0x16:
        case 0x43:
            if (tick(0xbc)) {
                digivolveForms(mem, obj, ui, 1, host);
                host.callMethod(at(0xc), 0x80, [1]);
                w(0x10, 4);
            }
            return;
    }
}

/** F0x8008B3C8(obj, ui): the page's lifecycle. */
export function digivolveRoot(mem: PauseMemory, obj: number, ui: number, host: DigivolveHost): void {
    const state = mem.read32(obj + 0xc) | 0;
    if (state === 1) {
        digivolveTick(mem, obj, ui, host);
        digivolveDraw(mem, obj, host);
        return;
    }
    if (state >= 2 && state < 4) return;
    host.callMethod(obj, 0x38, []);
    digivolveCtor(mem, obj, ui, host);
    validateEquippedForm(mem, partyPositionToRosterSlot(mem, mem.read32(obj + 0x70) | 0), obj + 0x74);
    for (let i = 0; i < 3; i++) {
        if (mem.read16s(obj + 0x74 + i * 2) >= 4) mem.write32(obj + 0x7c, (mem.read32(obj + 0x7c) | 0) + 1);
    }
    for (const off of [0xac, 0xbc, 0xcc, 0xdc, 0xec]) mem.write32(obj + off, 0xa);
}
