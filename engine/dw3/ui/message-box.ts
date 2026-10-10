// The card duel's prompt window, translated from pro/cardgame:
//   F0x80097ACC messageBoxTick   — the open / hold / slide / close state machine
//   F0x80097958 messagePlateDraw — the scaled plate sprite
//   F0x80097A24 messageIconDraw  — the fixed-size plate icon
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/message-box-oracle.test.js runs all three originals through
// engine/native on the shipped pro_cardgame.bin + resident.bin with the draw
// context, the pack resolver, the frame delta, the bank getter, the resident
// measure and the widget method table recorded.
//
// DECODED: authority-2 closure `_asm/F0x80097acc.s` (1251 instructions, which
// carries both draw callees) and the m2c bodies
// `exe-decomp/cardgame_c/F0x80097acc.c`, `F0x80097958.c`, `F0x80097a24.c`.
//
// Player-visible result: the duel's question window. view+0xDFA runs
// 0 (idle) -> 1 (open ramp) -> 2 (hold) -> 4 (slide out) -> 5 (dismiss) -> 0,
// with view+0xDF0 the frame countdown and +0xDF2 the duration. view+0xDFB picks
// the content: kind 1 a short line (string 0x18), kinds 2/3 the two-line
// question (strings 0x45 and 0x46, kind 3 with flag 7), anything else just
// closes the plate. view+0xDE4 selects the lane (0..3, the same 0x800A59B0
// records the banners use), view+0xDF4 the vertical layout row, and view+0xDE8
// the message id, which ids 0x13 and 0x3E expand into the measured multi-line
// forms. The window is drawn as sprite 0x1A from pack 0x025D0002, scaled, with
// the lane record's y.
//
// The host boundary is the same as the other duel windows: the draw context
// (F0x8001F648 + its 0x70..0x9C method table), the resident pack resolver
// [0x80044F5C], the frame delta [0x8004DF9C], the bank getter [0x80044F4C]
// (reached here through the language object at 0x80044B38 + 0x414, which is the
// same address), the resident text measure (F0x8001FCC0 plus its dispatch) and
// the widget method table. view+0xEE8 is the close-prompt function pointer.

import { rsin } from "../rsin.ts";
import { type CardDrawHost } from "./cardgame-draw.ts";

export interface MessageBoxMemory {
    read8(addr: number): number;
    read16(addr: number): number;
    read16s(addr: number): number;
    read32(addr: number): number;
    write8(addr: number, value: number): void;
    write16(addr: number, value: number): void;
}

export interface MessageBoxHost extends CardDrawHost {
    /** `[0x80044F4C](handle)`: the text-bank getter. */
    bankGet(handle: number): number;
    /** An indirect widget method call: `obj+method(obj, a1, a2)`. */
    callWidgetMethod(obj: number, method: number, a1: number, a2: number): number;
    /** F0x8001FCC0 + its fetch dispatch: measure a text widget, returning a width. */
    measureText(ptr: number, arg1: number, arg2: number): number;
    /** `view+0xEE8`(view): the close-prompt callback (a plain function pointer). */
    callViewClose(fn: number, view: number): void;
}

/** The window's fields on the duel view. */
export const MESSAGE_BOX = {
    state: 0x0dfa,
    kind: 0x0dfb,
    timer: 0x0df0,
    duration: 0x0df2,
    layout: 0x0df4,
    lane: 0x0de4,
    id: 0x0de8,
    close: 0x0ee8,
    value5c: 0x005c,
    value5e: 0x005e,
    valueA4: 0x00a4,
    valueStride: 0x0054,
} as const;

/** The per-lane records (s16 x, s16 y) the banners and this window share. */
export const MESSAGE_BOX_TABLE = 0x800a59b0;
export const MESSAGE_BOX_TABLE_STRIDE = 8;
/** `[0x8005CCA8]`: the language pointer the bank ids are added to. */
export const MESSAGE_BOX_LANGUAGE_PTR = 0x8005cca8;
/** The resident pack both draws resolve. */
export const MESSAGE_BOX_PACK = 0x025d0002;
export const MESSAGE_BOX_FULL_SCALE = 0x1000;
export const MESSAGE_BOX_LAYER = 0x100;
export const MESSAGE_BOX_DRAW_LAYER = 1;
export const MESSAGE_BOX_ORIGIN_X = 0x280;
export const MESSAGE_BOX_PLATE_X = 0x14;
export const MESSAGE_BOX_PLATE_Y_BASE = 0x11;
export const MESSAGE_BOX_LAYOUT_STRIDE = 0x0e;
export const MESSAGE_BOX_PLATE_CLIP = 0x1a;
export const MESSAGE_BOX_ICON_CLIP = 0x18;
export const MESSAGE_BOX_PLATE_REST = { x: 0, y: 0x78 } as const;
export const MESSAGE_BOX_FRAME_DOWN = 0x20;
export const MESSAGE_BOX_SLIDE_DIVISOR = 20;
export const MESSAGE_BOX_TEXT_BASE = 0x1b;
export const MESSAGE_BOX_TEXT_BASE_Y = 0x12;
export const MESSAGE_BOX_TEXT2_Y = 0x20;
export const MESSAGE_BOX_LABEL_X = 0x40;
export const MESSAGE_BOX_LABEL_Y = 0x04;
export const MESSAGE_BOX_PAIR_Y = 0x04;
export const MESSAGE_BOX_PAIR_STRIDE = 0x0e;
export const MESSAGE_BOX_PAIR_COUNT = 2;
export const MESSAGE_BOX_SHORT_ID = 0x18;
export const MESSAGE_BOX_QUESTION_ID = 0x45;
export const MESSAGE_BOX_ANSWER_ID = 0x46;
export const MESSAGE_BOX_FLAG_DOWN = 7;
export const MESSAGE_BOX_ID_13 = 0x13;
export const MESSAGE_BOX_ID_3E = 0x3e;

/** Widget method offsets. */
export const MESSAGE_BOX_PLATE_MODE = 0x80;
export const MESSAGE_BOX_PLATE_POS = 0x84;
export const MESSAGE_BOX_PLATE_FRAME = 0x8c;
export const MESSAGE_BOX_W_SET_STRING = 0x114;
export const MESSAGE_BOX_W_SET_VALUE = 0x118;
export const MESSAGE_BOX_W_SET_POS = 0x134;
export const MESSAGE_BOX_W_SET_FLAG = 0x138;
export const MESSAGE_BOX_W_VISIBILITY = 0x144;
export const MESSAGE_BOX_W_COMMIT = 0x148;

/** The arg1 widget slots. */
export const MESSAGE_BOX_PLATE = 0x00;
export const MESSAGE_BOX_W4 = 0x04;
export const MESSAGE_BOX_W8 = 0x08;
export const MESSAGE_BOX_WC = 0x0c;
export const MESSAGE_BOX_W1C = 0x1c;
export const MESSAGE_BOX_W34 = 0x34;

const s16 = (v: number): number => (v << 16) >> 16;
const s32 = (v: number): number => v | 0;

/** F0x80097958(view, para, scale, x, y): draw the scaled plate sprite. */
export function messagePlateDraw(
    mem: MessageBoxMemory, scale: number, x: number, y: number, host: CardDrawHost,
): void {
    host.setLayer(MESSAGE_BOX_LAYER, MESSAGE_BOX_DRAW_LAYER);
    host.setOrigin(MESSAGE_BOX_ORIGIN_X, 0);
    host.setPos(MESSAGE_BOX_PLATE_REST.x, MESSAGE_BOX_PLATE_REST.y);
    host.setScale(s16(scale), MESSAGE_BOX_FULL_SCALE, MESSAGE_BOX_FULL_SCALE);
    host.drawSprite(host.packResolve(MESSAGE_BOX_PACK) >>> 0, MESSAGE_BOX_PLATE_CLIP, x, y);
}

/** F0x80097A24(view, para, x, y): draw the plate icon at full scale. */
export function messageIconDraw(x: number, y: number, host: CardDrawHost): void {
    host.setLayer(MESSAGE_BOX_LAYER, MESSAGE_BOX_DRAW_LAYER);
    host.setOrigin(MESSAGE_BOX_ORIGIN_X, 0);
    host.setScale(MESSAGE_BOX_FULL_SCALE, MESSAGE_BOX_FULL_SCALE, MESSAGE_BOX_FULL_SCALE);
    host.drawSprite(host.packResolve(MESSAGE_BOX_PACK) >>> 0, MESSAGE_BOX_ICON_CLIP, x, y);
}

/**
 * F0x80097ACC(view, para): one tick of the duel's prompt window.
 */
export function messageBoxTick(
    mem: MessageBoxMemory, view: number, para: number, host: MessageBoxHost,
): void {
    const state = mem.read8(view + MESSAGE_BOX.state);
    if (state === 0) return;
    const lane = s32(mem.read32(view + MESSAGE_BOX.lane));
    const table = MESSAGE_BOX_TABLE + lane * MESSAGE_BOX_TABLE_STRIDE;
    const layout = s16(mem.read16s(view + MESSAGE_BOX.layout));
    const bank = s32(mem.read32(MESSAGE_BOX_LANGUAGE_PTR));
    let published = 0;

    const plate = mem.read32(para + MESSAGE_BOX_PLATE) >>> 0;
    const widget = (off: number): number => mem.read32(para + off) >>> 0;
    const call = (obj: number, method: number, a1: number, a2: number): number =>
        host.callWidgetMethod(obj, method, a1, a2);
    const hide = (off: number): void => {
        call(widget(off), MESSAGE_BOX_W_VISIBILITY, 0, 0);
    };
    const plateMode = (mode: number): void => { call(plate, MESSAGE_BOX_PLATE_MODE, mode, 0); };
    const platePos = (x: number, y: number): void => { call(plate, MESSAGE_BOX_PLATE_POS, x, y); };
    // The plate y is a 32-bit add of the record's y word, not a sign-extended
    // halfword (the asm adds the lw result).
    const rowY = (): number =>
        (s32(mem.read32(table + 4)) + layout * MESSAGE_BOX_LAYOUT_STRIDE + MESSAGE_BOX_PLATE_Y_BASE) | 0;
    const setText = (off: number, id: number): void => {
        const handle = host.bankGet((bank + 0x0f) | 0) >>> 0;
        call(widget(off), MESSAGE_BOX_W_SET_STRING, handle, id);
    };
    const tail = (): void => {
        messagePlateDraw(mem, s16(published), s32(mem.read32(table)), s32(mem.read32(table + 4)), host);
    };

    if (state === 2) {
        published = MESSAGE_BOX_FULL_SCALE;
        if (lane === 3) messageIconDraw(0x1c, 0x64, host);
        if (mem.read8(view + MESSAGE_BOX.kind) !== 0) platePos(MESSAGE_BOX_PLATE_X, rowY());
        tail();
        return;
    }

    if (state === 4) {
        published = MESSAGE_BOX_FULL_SCALE;
        const angle = Math.trunc((s16(mem.read16s(view + MESSAGE_BOX.timer)) << 12) / MESSAGE_BOX_SLIDE_DIVISOR);
        let shift = rsin(angle | 0) | 0;
        if (shift < 0) shift += 0x1ff;
        shift >>= 9;
        platePos(MESSAGE_BOX_PLATE_X - shift, rowY());
        const timer = (mem.read16s(view + MESSAGE_BOX.timer) - (host.frameDelta() | 0)) & 0xffff;
        mem.write16(view + MESSAGE_BOX.timer, timer);
        if (s16(timer) <= 0) {
            plateMode(0);
            host.callViewClose(mem.read32(view + MESSAGE_BOX.close) >>> 0, view);
            call(plate, MESSAGE_BOX_PLATE_FRAME, MESSAGE_BOX_FRAME_DOWN, 0);
            mem.write8(view + MESSAGE_BOX.state, 5);
        }
        tail();
        return;
    }

    if (state === 5) {
        plateMode(0);
        hide(MESSAGE_BOX_W1C);
        call(widget(MESSAGE_BOX_W34), MESSAGE_BOX_W_SET_FLAG, 0, 0);
        hide(MESSAGE_BOX_W34);
        hide(MESSAGE_BOX_W4);
        hide(MESSAGE_BOX_W8);
        hide(MESSAGE_BOX_WC);
        const timer = (mem.read16s(view + MESSAGE_BOX.timer) - (host.frameDelta() | 0)) & 0xffff;
        mem.write16(view + MESSAGE_BOX.timer, timer);
        if (s16(timer) <= 0) mem.write8(view + MESSAGE_BOX.state, 0);
        const duration = s16(mem.read16s(view + MESSAGE_BOX.duration));
        const t = s16(mem.read16s(view + MESSAGE_BOX.timer));
        // No zero guard in the original: the console's DIV leaves lo = sign(t).
        published = duration !== 0 ? Math.trunc((t << 12) / duration) : (t >= 0 ? -1 : 1);
        tail();
        return;
    }

    // States 1, 3 and above 5: ramp the scale, then open the window.
    const timer0 = s16(mem.read16s(view + MESSAGE_BOX.timer));
    const duration0 = s16(mem.read16s(view + MESSAGE_BOX.duration));
    const ramp = duration0 !== 0 ? Math.trunc((timer0 << 12) / duration0) : (timer0 << 12);
    published = MESSAGE_BOX_FULL_SCALE - ramp;
    const timer = (mem.read16s(view + MESSAGE_BOX.timer) - (host.frameDelta() | 0)) & 0xffff;
    mem.write16(view + MESSAGE_BOX.timer, timer);
    if (s16(timer) > 0) {
        tail();
        return;
    }
    const kind = mem.read8(view + MESSAGE_BOX.kind);
    mem.write8(view + MESSAGE_BOX.state, 2);
    if (kind === 1) {
        plateMode(1);
        platePos(MESSAGE_BOX_PLATE_X, rowY());
        setText(MESSAGE_BOX_W34, MESSAGE_BOX_SHORT_ID);
        call(widget(MESSAGE_BOX_W34), MESSAGE_BOX_W_SET_POS,
            s16(mem.read16(table) + MESSAGE_BOX_TEXT_BASE), s16(mem.read16(table + 4) + MESSAGE_BOX_TEXT_BASE_Y));
    } else if (kind === 2 || kind === 3) {
        plateMode(1);
        platePos(MESSAGE_BOX_PLATE_X, rowY());
        const handle = host.bankGet((bank + 0x0f) | 0) >>> 0;
        call(widget(MESSAGE_BOX_W34), MESSAGE_BOX_W_SET_STRING, handle, MESSAGE_BOX_QUESTION_ID);
        if (kind === 3) call(widget(MESSAGE_BOX_W34), MESSAGE_BOX_W_SET_FLAG, MESSAGE_BOX_FLAG_DOWN, 0);
        call(widget(MESSAGE_BOX_W34), MESSAGE_BOX_W_SET_POS,
            s16(mem.read16(table) + MESSAGE_BOX_TEXT_BASE), s16(mem.read16(table + 4) + MESSAGE_BOX_TEXT_BASE_Y));
        const handle2 = host.bankGet((bank + 0x0f) | 0) >>> 0;
        call(widget(MESSAGE_BOX_W4), MESSAGE_BOX_W_SET_STRING, handle2, MESSAGE_BOX_ANSWER_ID);
        call(widget(MESSAGE_BOX_W4), MESSAGE_BOX_W_COMMIT, 0, 0);
        call(widget(MESSAGE_BOX_W4), MESSAGE_BOX_W_SET_POS,
            s16(mem.read16(table) + MESSAGE_BOX_TEXT_BASE), s16(mem.read16(table + 4) + MESSAGE_BOX_TEXT2_Y));
    } else {
        hide(MESSAGE_BOX_W34);
        plateMode(0);
    }

    if (lane === 3) {
        const label = MESSAGE_BOX_TABLE + 3 * MESSAGE_BOX_TABLE_STRIDE;
        call(widget(MESSAGE_BOX_W1C), MESSAGE_BOX_W_SET_POS,
            s16(mem.read16(label) + MESSAGE_BOX_LABEL_X), s16(mem.read16(label + 4) + MESSAGE_BOX_LABEL_Y));
        const handle = host.bankGet((bank + 0x0f) | 0) >>> 0;
        call(widget(MESSAGE_BOX_W1C), MESSAGE_BOX_W_SET_STRING, handle, 0x42);
        const handle2 = host.bankGet((bank + 0x6a) | 0) >>> 0;
        call(widget(MESSAGE_BOX_W34), MESSAGE_BOX_W_SET_STRING, handle2, s32(mem.read32(view + MESSAGE_BOX.id)));
        call(widget(MESSAGE_BOX_W34), MESSAGE_BOX_W_SET_POS,
            s16(mem.read16(table) + MESSAGE_BOX_LABEL_X), s16(mem.read16(table + 4) + MESSAGE_BOX_TEXT_BASE_Y));
        tail();
        return;
    }

    const id = s32(mem.read32(view + MESSAGE_BOX.id));
    if (id === 0) {
        hide(MESSAGE_BOX_W1C);
        tail();
        return;
    }
    call(widget(MESSAGE_BOX_W1C), MESSAGE_BOX_W_SET_POS,
        s16(mem.read16(table) + MESSAGE_BOX_TEXT_BASE), s16(mem.read16(table + 4) + MESSAGE_BOX_PAIR_Y));
    const handle = host.bankGet((bank + 0x0f) | 0) >>> 0;
    call(widget(MESSAGE_BOX_W1C), MESSAGE_BOX_W_SET_STRING, handle, id);

    if (id === MESSAGE_BOX_ID_13) {
        const handle2 = host.bankGet((bank + 0x0f) | 0) >>> 0;
        call(widget(MESSAGE_BOX_W34), MESSAGE_BOX_W_SET_STRING, handle2, 0x2b);
        call(widget(MESSAGE_BOX_W34), MESSAGE_BOX_W_SET_POS,
            s16(mem.read16(table) + MESSAGE_BOX_TEXT_BASE), s16(mem.read16(table + 4) + MESSAGE_BOX_TEXT_BASE_Y));
        const w34 = widget(MESSAGE_BOX_W34);
        const width = host.measureText((w34 + 0x5c) >>> 0, mem.read32(w34 + 0x50) >>> 0,
            s16(mem.read16s(w34 + 0xb4))) | 0;
        const xBase = width + MESSAGE_BOX_TEXT_BASE;
        let y = MESSAGE_BOX_TEXT_BASE_Y;
        for (let i = 0; i < MESSAGE_BOX_PAIR_COUNT; i++) {
            const w = widget(i === 0 ? MESSAGE_BOX_W4 : MESSAGE_BOX_W8);
            call(w, MESSAGE_BOX_W_SET_POS, s16(xBase + mem.read16(table) + MESSAGE_BOX_PAIR_STRIDE),
                s16(mem.read16(table + 4) + y));
            call(w, MESSAGE_BOX_W_SET_VALUE, 0,
                s32(mem.read32(view + MESSAGE_BOX.valueA4 + i * MESSAGE_BOX.valueStride)));
            call(w, MESSAGE_BOX_W_COMMIT, 0, 0);
            y += MESSAGE_BOX_PAIR_STRIDE;
        }
        tail();
        return;
    }

    if (id === MESSAGE_BOX_ID_3E) {
        call(widget(MESSAGE_BOX_W4), MESSAGE_BOX_W_SET_POS,
            s16(mem.read16(table) + MESSAGE_BOX_ID_3E), s16(mem.read16(table + 4) + MESSAGE_BOX_PAIR_Y));
        call(widget(MESSAGE_BOX_W4), MESSAGE_BOX_W_SET_VALUE, 0, s16(mem.read16s(view + MESSAGE_BOX.value5e)));
        call(widget(MESSAGE_BOX_W4), MESSAGE_BOX_W_COMMIT, 1, 0);
        const half = Math.trunc((s16(mem.read16s(view + MESSAGE_BOX.value5c)) + 1) / 2);
        const handle2 = host.bankGet((bank + 0x2b) | 0) >>> 0;
        call(widget(MESSAGE_BOX_W8), MESSAGE_BOX_W_SET_STRING, handle2, half);
        call(widget(MESSAGE_BOX_W8), MESSAGE_BOX_W_SET_POS,
            s16(mem.read16(table) + MESSAGE_BOX_TEXT_BASE), s16(mem.read16(table + 4) + MESSAGE_BOX_TEXT_BASE_Y));
        tail();
        return;
    }

    tail();
}
