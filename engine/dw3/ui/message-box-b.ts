// The duel's second message box, translated from pro/cardgame F0x80098558.
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/message-box-b-oracle.test.js runs the original through
// engine/native on the shipped pro_cardgame.bin + resident.bin.
//
// DECODED: authority-2 `_asm/F0x80098558.s` and the accepted
// cardgame-hud-message-content contract. The window is driven by the view's
// fields: +0xE00 timer, +0xE02 duration, +0xE04 layout, +0xE0A state, +0xEF8
// close_prompt_b. The plate widget is bank[0] (mode +0x80, position +0x84,
// frame +0x8C); the text is bank[0x30] (+0x114 string, +0x134 pen, +0x144
// visibility). The tail draw F0x8009848C is not in the idle census, so it goes
// through the host. The content string is the fixed es-cardgm entry 0x20, the
// five-row in-duel menu text, placed at (0x18, 0x65) while the plate sits at
// (0xA, layout*0xE + 0x65).

import { rsin } from "../rsin.ts";

export interface MessageBoxBMemory {
    read16(addr: number): number;
    read16s(addr: number): number;
    read32(addr: number): number;
    write16(addr: number, value: number): void;
}

export interface MessageBoxBHost {
    /** `[0x8004DF9C]` = resident F0x8001D704: the frame delta. */
    frameDelta(): number;
    /** `[0x80044F4C](handle)`: the text-bank getter. */
    bankGet(handle: number): number;
    /** An indirect widget method call: `obj+method(obj, a1, a2)`. */
    callWidgetMethod(obj: number, method: number, a1: number, a2: number): number;
    /** F0x8009848C(view, bank, scale, arg3, arg4): draw the message plate. */
    drawMessagePlate(view: number, bank: number, scale: number, arg3: number, arg4: number): void;
    /** `view+0xEF8`(view): the close-prompt callback (a plain function, not a widget method). */
    callViewCloseFunction(fn: number, view: number): void;
}

export const MESSAGE_B = {
    timer: 0xe00,
    duration: 0xe02,
    layout: 0xe04,
    state: 0xe0a,
    closePrompt: 0xef8,
    plate: 0x00,
    text: 0x30,
} as const;
export const MESSAGE_B_PLATE_MODE = 0x80;
export const MESSAGE_B_PLATE_POS = 0x84;
export const MESSAGE_B_PLATE_FRAME = 0x8c;
export const MESSAGE_B_SET_STRING = 0x114;
export const MESSAGE_B_PEN = 0x134;
export const MESSAGE_B_VISIBILITY = 0x144;
export const MESSAGE_B_LANGUAGE_PTR = 0x8005cca8;
export const MESSAGE_B_BANK = 0x0f;
export const MESSAGE_B_STRING_ID = 0x20;
export const MESSAGE_B_TEXT_X = 0x18;
export const MESSAGE_B_TEXT_Y = 0x65;
export const MESSAGE_B_PLATE_X = 0x0a;
export const MESSAGE_B_PLATE_BASE_Y = 0x65;
export const MESSAGE_B_LAYOUT_STRIDE = 0x0e;
export const MESSAGE_B_FULL_SCALE = 0x1000;
export const MESSAGE_B_SLIDE_DIVISOR = 20;
export const MESSAGE_B_PLATE_FRAME_DOWN = 0x20;

const s16 = (v: number): number => (v << 16) >> 16;
const s32 = (v: number): number => v | 0;

/** The plate's y for a layout index. */
function plateY(mem: MessageBoxBMemory, view: number): number {
    return s16(mem.read16s(view + MESSAGE_B.layout)) * MESSAGE_B_LAYOUT_STRIDE + MESSAGE_B_PLATE_BASE_Y;
}

function positionPlate(
    mem: MessageBoxBMemory, view: number, bank: number, x: number, host: MessageBoxBHost,
): number {
    const y = plateY(mem, view);
    host.callWidgetMethod(mem.read32(bank + MESSAGE_B.plate) >>> 0, MESSAGE_B_PLATE_POS, x, y);
    return y;
}

/** F0x80098558(view, bank): one tick of the second message window. */
export function messageBoxTickB(
    mem: MessageBoxBMemory, view: number, bank: number, host: MessageBoxBHost,
): void {
    const state = s16(mem.read16s(view + MESSAGE_B.state));
    if (state === 0) return;
    const plate = mem.read32(bank + MESSAGE_B.plate) >>> 0;
    if (state === 2) {
        positionPlate(mem, view, bank, MESSAGE_B_PLATE_X, host);
        host.drawMessagePlate(view, bank, MESSAGE_B_FULL_SCALE, 0, 0x60);
        return;
    }
    if (state === 4) {
        const angle = Math.trunc((s16(mem.read16s(view + MESSAGE_B.timer)) << 12) / MESSAGE_B_SLIDE_DIVISOR);
        let shift = rsin(angle) | 0;
        if (shift < 0) shift += 0x1ff;
        shift >>= 9;
        const y = positionPlate(mem, view, bank, MESSAGE_B_PLATE_X - shift, host);
        const timer = (mem.read16s(view + MESSAGE_B.timer) - (host.frameDelta() | 0)) & 0xffff;
        mem.write16(view + MESSAGE_B.timer, timer);
        if (s16(timer) > 0) {
            host.drawMessagePlate(view, bank, MESSAGE_B_FULL_SCALE, 0, 0x60);
            return;
        }
        // The mode and frame calls carry the leftover a2 = the plate y.
        host.callWidgetMethod(plate, MESSAGE_B_PLATE_MODE, 0, y);
        host.callViewCloseFunction(mem.read32(view + MESSAGE_B.closePrompt) >>> 0, view);
        host.callWidgetMethod(plate, MESSAGE_B_PLATE_FRAME, MESSAGE_B_PLATE_FRAME_DOWN, y);
        mem.write16(view + MESSAGE_B.state, 5);
        host.drawMessagePlate(view, bank, MESSAGE_B_FULL_SCALE, 0, 0x60);
        return;
    }
    if (state === 5) {
        host.callWidgetMethod(plate, MESSAGE_B_PLATE_MODE, 0, 0);
        host.callWidgetMethod(mem.read32(bank + MESSAGE_B.text) >>> 0, MESSAGE_B_VISIBILITY, 0, 0);
        const timer = (mem.read16s(view + MESSAGE_B.timer) - (host.frameDelta() | 0)) & 0xffff;
        mem.write16(view + MESSAGE_B.timer, timer);
        if (s16(timer) <= 0) mem.write16(view + MESSAGE_B.state, 0);
        const duration = s16(mem.read16s(view + MESSAGE_B.duration));
        host.drawMessagePlate(view, bank, Math.trunc((s16(mem.read16s(view + MESSAGE_B.timer)) << 12) / duration), 0, 0x60);
        return;
    }
    // States 1, 3, negative and above 5: ramp, then land into state 2.
    const timer = s16(mem.read16s(view + MESSAGE_B.timer));
    const duration = s16(mem.read16s(view + MESSAGE_B.duration));
    const ramp = duration !== 0 ? Math.trunc((timer << 12) / duration) : (timer << 12);
    const scale = MESSAGE_B_FULL_SCALE - ramp;
    const next = (mem.read16s(view + MESSAGE_B.timer) - (host.frameDelta() | 0)) & 0xffff;
    mem.write16(view + MESSAGE_B.timer, next);
    if (s16(next) > 0) {
        host.drawMessagePlate(view, bank, scale, 0, 0x60);
        return;
    }
    mem.write16(view + MESSAGE_B.state, 2);
    host.callWidgetMethod(plate, MESSAGE_B_PLATE_MODE, 1, 0);
    positionPlate(mem, view, bank, MESSAGE_B_PLATE_X, host);
    const handle = host.bankGet((mem.read32(MESSAGE_B_LANGUAGE_PTR) + MESSAGE_B_BANK) | 0) >>> 0;
    host.callWidgetMethod(mem.read32(bank + MESSAGE_B.text) >>> 0, MESSAGE_B_SET_STRING,
        handle, MESSAGE_B_STRING_ID);
    host.callWidgetMethod(mem.read32(bank + MESSAGE_B.text) >>> 0, MESSAGE_B_PEN,
        MESSAGE_B_TEXT_X, MESSAGE_B_TEXT_Y);
    host.drawMessagePlate(view, bank, scale, 0, 0x60);
}
