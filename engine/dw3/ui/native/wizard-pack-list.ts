// The registration wizard's starter-pack list, translated from the original
// pro/stplnmet bodies.
//
// Part D of docs/plans/2026-09-28-translated-game-completion-plan.md. Oracle:
// tests/lane-b/wizard-pack-list.test.js runs each original through
// engine/native and compares the ordered calls and the object memory.
//
//   F0x80086FC0 packListWidgetsBuild  the title, three pack rows, the header and
//                                     the three Digimon name / blurb pairs.
//   F0x80087190 packListTextBind      fill (or hide) every label for the chosen
//                                     pack.
//   F0x80087774 packListMove          up / down pick A, B or C; confirm accepts,
//                                     back leaves.
//   F0x80087444 packListDraw          the three portraits of the chosen pack,
//                                     the backing plates and the cursor arrow.
//   F0x80087A30 packListTick          first-frame build, then move and draw.
//
// Object fields (list object, 0x8C bytes; ui block, 0x30 bytes): +0x10 panel
// state (0x64 accepted, 0xC8 backed out); +0x5C..+0x64 the three portrait
// frames; +0x68 portrait clock; +0x6C the chosen pack (0..2); +0x70 / +0x74 the
// cursor arrow's frame and clock.
import { WIZARD_LANGUAGE_CELL, WIZARD_TABLES } from "./wizard-confirm.ts";

export interface PackListMemory {
    read32(addr: number): number;
    write32(addr: number, value: number): void;
}

/** The cursor arrow's frame table (overlay data). */
export const PACK_ARROW_FRAMES = 0x80089a68;

export interface PackListHost {
    createWidget(layer: number, kind: number, x: number, y: number): number;
    callMethod(target: number, slot: number, args: number[]): void;
    languageBank(id: number): number;
    padPressed(pad: number): number;
    padRepeat(pad: number): number;
    padBit(pad: number, code: number): number;
    playSound(id: number): void;
    packHandle(id: number): number;
    frameCount(): number;
    /** F0x80087190 (installed as the list's +0x88 show method target). */
    show(obj: number, on: number): void;
    drawInit(): void;
    draw74(x: number, y: number): void;
    draw7C(a: number, b: number): void;
    drawSprite(handle: number, clip: number, x: number, y: number): void;
    draw88(n: number): void;
}

/** F0x80086FC0(obj, ui): build the list's widgets. */
export function packListWidgetsBuild(
    mem: PackListMemory, obj: number, ui: number, host: PackListHost,
): void {
    const layer = () => mem.read32(obj + 0x54) | 0;
    let w = host.createWidget(layer(), 1, 0x20, 0x1a);
    mem.write32(ui + 0x0, w);
    host.callMethod(w, 0x138, [4]);
    for (let i = 0; i < 3; i++) {
        w = host.createWidget(layer(), 1, 0x1a, 0x34 + i * 0x18);
        mem.write32(ui + 0x4 + i * 4, w);
        host.callMethod(w, 0x138, [1]);
    }
    w = host.createWidget(layer(), 1, 0x3a, 0x32);
    mem.write32(ui + 0x10, w);
    host.callMethod(w, 0x138, [4]);
    w = host.createWidget(layer(), 1, 0x3a, 0xc2);
    mem.write32(ui + 0x14, w);
    host.callMethod(w, 0x160, [3]);
    host.callMethod(mem.read32(ui + 0x14) | 0, 0x138, [1]);
    for (let i = 0; i < 3; i++) {
        w = host.createWidget(layer(), 2, 0x72, 0x43 + i * 0x2a);
        mem.write32(ui + 0x18 + i * 8, w);
        host.callMethod(w, 0x138, [5]);
        w = host.createWidget(layer(), 1, 0x72, 0x4f + i * 0x2a);
        mem.write32(ui + 0x1c + i * 8, w);
        host.callMethod(w, 0x160, [2]);
        host.callMethod(mem.read32(ui + 0x1c + i * 8) | 0, 0x138, [1]);
    }
}

/** F0x80087190(obj, ui, show): fill the labels for the chosen pack, or hide them. */
export function packListTextBind(
    mem: PackListMemory, obj: number, ui: number, show: number, host: PackListHost,
): void {
    const at = (off: number) => mem.read32(ui + off) | 0;
    const language = () => mem.read32(WIZARD_LANGUAGE_CELL) | 0;
    if (show !== 0) {
        const packs = mem.read32(WIZARD_TABLES.packs) | 0;
        const members = packs + (mem.read32(obj + 0x6c) | 0) * 0xc;
        host.callMethod(at(0), 0x114, [host.languageBank(language() + 0x8d), 6]);
        for (let i = 0; i < 3; i++) {
            host.callMethod(at(4 + i * 4), 0x114, [host.languageBank(language() + 0x8d), i + 7]);
        }
        host.callMethod(at(0x10), 0x114, [host.languageBank(language() + 0x8d), (mem.read32(obj + 0x6c) | 0) + 0xa]);
        host.callMethod(at(0x14), 0x114, [host.languageBank(language() + 0x8d), (mem.read32(obj + 0x6c) | 0) + 0x1a]);
        for (let i = 0; i < 3; i++) {
            const member = mem.read32(members + i * 4) | 0;
            host.callMethod(at(0x18 + i * 8), 0x114, [host.languageBank(language() + 0x4e), member + 1]);
            host.callMethod(at(0x1c + i * 8), 0x114, [host.languageBank(language() + 0x8d), member + 0xd]);
        }
        return;
    }
    host.callMethod(at(0), 0x144, [0]);
    for (let i = 0; i < 3; i++) host.callMethod(at(4 + i * 4), 0x144, [0]);
    host.callMethod(at(0x10), 0x144, [0]);
    host.callMethod(at(0x14), 0x144, [0]);
    for (let i = 0; i < 3; i++) {
        host.callMethod(at(0x18 + i * 8), 0x144, [0]);
        host.callMethod(at(0x1c + i * 8), 0x144, [0]);
    }
}

/** F0x80087774(obj, ui): move the pack cursor; confirm or back leaves the list. */
export function packListMove(
    mem: PackListMemory, obj: number, ui: number, host: PackListHost,
): void {
    const before = mem.read32(obj + 0x6c) | 0;
    const bit = (bits: number, code: number) => (bits >> host.padBit(0, code)) & 1;
    const pressedOrRepeat = (code: number) =>
        bit(host.padPressed(0), code) !== 0 || bit(host.padRepeat(0), code) !== 0;
    if (pressedOrRepeat(4)) {
        const v = (mem.read32(obj + 0x6c) | 0) - 1;
        mem.write32(obj + 0x6c, v);
        if (v < 0) mem.write32(obj + 0x6c, 0);
    } else if (pressedOrRepeat(6)) {
        const v = (mem.read32(obj + 0x6c) | 0) + 1;
        mem.write32(obj + 0x6c, v);
        if (v >= 3) mem.write32(obj + 0x6c, 2);
    }
    if (before !== (mem.read32(obj + 0x6c) | 0)) {
        host.playSound(0x4001b);
        packListTextBind(mem, obj, ui, 1, host);
        for (let i = 2; i >= 0; i--) mem.write32(obj + 0x5c + i * 4, 0);
    }
    if (bit(host.padPressed(0), 0xd) !== 0) {
        host.playSound(0x4001c);
        mem.write32(obj + 0x10, 0x64);
        return;
    }
    if (bit(host.padPressed(0), 0xe) !== 0) {
        host.playSound(0x800450bd);
        mem.write32(obj + 0x10, 0xc8);
        mem.write32(obj + 0x6c, 0);
    }
}

/** F0x80087444(obj): draw the chosen pack's portraits and the cursor arrow. */
export function packListDraw(mem: PackListMemory, obj: number, host: PackListHost): void {
    const r = (off: number) => mem.read32(obj + off) | 0;
    const w = (off: number, v: number) => mem.write32(obj + off, v | 0);
    const frames = () => mem.read32(WIZARD_TABLES.frames) | 0;
    const members = (mem.read32(WIZARD_TABLES.packs) | 0) + r(0x6c) * 0xc;
    host.drawInit();
    host.draw7C(r(0x54), r(0x58));
    if (host.frameCount() - r(0x68) >= 0xd) {
        w(0x68, host.frameCount());
        for (let i = 0; i < 3; i++) {
            const idx = r(0x5c + i * 4) + 1;
            w(0x5c + i * 4, idx);
            const member = mem.read32(members + i * 4) | 0;
            if (idx >= 8 || (mem.read32(frames() + member * 0x1c + idx * 4) | 0) === -1) w(0x5c + i * 4, 0);
        }
    }
    host.draw74(0x140, 0x100);
    for (let i = 0; i < 3; i++) {
        const member = mem.read32(members + i * 4) | 0;
        const clip = mem.read32(frames() + member * 0x1c + r(0x5c + i * 4) * 4) | 0;
        host.drawSprite(host.packHandle(0x07700000), clip, 0x41, 0x40 + i * 0x2a);
    }
    host.draw74(0x280, 0x100);
    host.drawSprite(host.packHandle(0x028a0000), 7, 0x10, 0x2c);
    host.draw7C(r(0x54), r(0x58) - 1);
    host.drawSprite(host.packHandle(0x028a0000), 8, 0x10, 0x2c);
    if (host.frameCount() - r(0x74) >= 9) {
        w(0x74, host.frameCount());
        const v = r(0x70) + 1;
        w(0x70, v);
        if (v >= 6) w(0x70, 0);
    }
    host.draw88(mem.read32(PACK_ARROW_FRAMES + r(0x70) * 4) | 0);
    host.drawSprite(host.packHandle(0x028a0000), 0x32, 0x10, r(0x6c) * 0x18 + 0x30);
}

/** F0x80087A30(obj, ui): first-frame build, then move and draw. */
export function packListTick(
    mem: PackListMemory, obj: number, ui: number, host: PackListHost,
): void {
    const state = mem.read32(obj + 0xc) | 0;
    if (state === 1) {
        packListMove(mem, obj, ui, host);
        packListDraw(mem, obj, host);
        return;
    }
    if (state >= 2 && state < 4) return;
    host.callMethod(obj, 0x38, []);
    packListWidgetsBuild(mem, obj, ui, host);
    host.show(obj, 1);
}
