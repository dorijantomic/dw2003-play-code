// The card duel's six HUD info banners, translated from pro/cardgame:
//   F0x800978F0 hudSlotTextTickAll — tick all six slots
//   F0x80097508 hudSlotTextTick    — one slot's open / hold / close machine
//   F0x80096E8C bannerContentDraw  — the per-slot icon/face drawer
//   F0x80097310 bannerPlaceText    — place and fill one text line
//   F0x800973E4 bannerPlaceTextPair — place and fill the measured pair line
//   F0x80097238 bannerDrawPair     — draw the two-line value row
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/hud-banners-oracle.test.js runs all six originals through
// engine/native on the shipped pro_cardgame.bin + resident.bin with the draw
// context, the pack resolver, the frame delta, the bank getter, the resident
// measure and the widget method table recorded, and compares the ordered
// intents and every field the bodies write.
//
// DECODED: authority-2 closures `_asm/F0x80097508.s` (which carries all four
// callees), `_asm/F0x800978f0.s` and `_asm/F0x80096e8c.s`; the m2c bodies
// `exe-decomp/cardgame_c/F0x80096e8c.c`, `F0x80097238.c`, `F0x80097310.c`,
// `F0x800973e4.c`, `F0x80097508.c`, `F0x800978f0.c` agree.
//
// Player-visible result: the six slot banners on the duel HUD. Each slot is a
// 0x18-byte record at view+0xE0C; its byte +0x17 runs 0 (idle) -> 1 (ramp up)
// -> 2 (hold, text placed) -> 3 (ramp down) -> 0, its +0x04 is the 0x1000-based
// scale, its +0x08 the countdown in frames and its +0x0A the duration. When the
// ramp expires the slot picks its own line: lane 0 the left player strip, lane
// 2 the card row, lane 3 the item row, lane 5 the right strip or the measured
// pair line. The content drawer stages the slot's icon or card face from the
// 0x800A5984 table (six 6-byte records) over the resident pack 0x025D0002
// (icon) or 0x025D0003 (face), and for the third lane's value it first draws
// the number as decimal digit sprites.
//
// The host boundary is the draw context (F0x8001F648 + its 0x70..0x9C method
// table), the resident pack resolver [0x80044F5C], the bank getter
// [0x80044F4C], the frame delta [0x8004DF9C] and the widget method table. The
// resident text measure (F0x8001FCC0 plus its fetch dispatch) is a host call.

import { drawDigitSprites, type CardDrawHost, type CardDrawMemory } from "./cardgame-draw.ts";

export interface BannerMemory extends CardDrawMemory {
    read16(addr: number): number;
    read16s(addr: number): number;
    write8(addr: number, value: number): void;
    write16(addr: number, value: number): void;
    write32(addr: number, value: number): void;
}

export interface BannerHost extends CardDrawHost {
    /** `[0x80044F4C](handle)`: the text-bank getter. */
    bankGet(handle: number): number;
    /** An indirect widget method call: `obj+method(obj, a1, a2)`. */
    callWidgetMethod(obj: number, method: number, a1: number, a2: number): number;
    /** F0x8001FCC0 + its fetch dispatch: measure a text widget, returning a width. */
    measureText(ptr: number, arg1: number, arg2: number): number;
    /** A host-owned scratch buffer (the original builds its digit record on the stack). */
    scratch(bytes: number): number;
}

/** The slot record at view+0xE0C, stride 0x18. */
export const BANNER_SLOT = {
    base: 0x0e0c,
    stride: 0x18,
    count: 6,
    x: 0x00,
    y: 0x02,
    scale: 0x04,
    timer: 0x08,
    duration: 0x0a,
    index: 0x0c,
    value: 0x0e,
    stringId: 0x10,
    b14: 0x14,
    b15: 0x15,
    b16: 0x16,
    state: 0x17,
} as const;

/** The per-slot icon/face table: six records of {s16 x, s16 y, u8 clip, u8 kind}. */
export const BANNER_TABLE = 0x800a5984;
export const BANNER_TABLE_STRIDE = 6;
/** `[0x8005CCA8]`: the language pointer the bank ids are added to. */
export const BANNER_LANGUAGE_PTR = 0x8005cca8;
/** The flag-indexed s16 x offset table bannerPlaceText reads. */
export const BANNER_X_OFFSETS = 0x800a59a8;
/** Resident packs: the slot icon and the card face. */
export const BANNER_ICON_PACK = 0x025d0002;
export const BANNER_FACE_PACK = 0x025d0003;
export const BANNER_FULL_SCALE = 0x1000;
export const BANNER_LAYER = 0x100;
export const BANNER_DRAW_LAYER = 1;
export const BANNER_ICON_ORIGIN = { x: 0x280, y: 0 } as const;
export const BANNER_FACE_ORIGIN = { x: 0x340, y: 0 } as const;
export const BANNER_BLANK = 0x1f4;
export const BANNER_BLANK_ID = 0x2a;
export const BANNER_PAIR_ID = 0x1f;
export const BANNER_ICON_CLIP_BASE = 0x1d;
export const BANNER_PAIR_X = 0x67;
export const BANNER_PAIR_Y = 4;
export const BANNER_PAIR_Y_STRIDE = 0x0d;
export const BANNER_PAIR_CENTER = 0xa0;
export const BANNER_SHIFTED_X = 0x45;

/** Widget method offsets (the resident text element's table). */
export const BANNER_W_SET_STRING = 0x114;
export const BANNER_W_SET_VALUE = 0x118;
export const BANNER_W_SET_POS = 0x134;
export const BANNER_W_SET_FLAG = 0x138;
export const BANNER_W_VISIBILITY = 0x144;
export const BANNER_W_COMMIT = 0x148;

const s16 = (v: number): number => (v << 16) >> 16;
const s32 = (v: number): number => v | 0;

/**
 * F0x80097238(para, slot): draw the two-line value row. Sets the value line
 * objects [para+4] and [para+8] to the slot's b14 / b15 bytes and returns the
 * last commit call's result (the caller stores it as the slot's string id).
 */
export function bannerDrawPair(mem: BannerMemory, para: number, slot: number, host: BannerHost): number {
    const x = s16((mem.read16(slot + BANNER_SLOT.x) + BANNER_PAIR_X) & 0xffff);
    let pen = BANNER_PAIR_Y;
    let ret = 0;
    for (let i = 0; i < 2; i++) {
        const widget = mem.read32(para + 4 + i * 4) >>> 0;
        const y = s16((mem.read16(slot + BANNER_SLOT.y) + pen) & 0xffff);
        host.callWidgetMethod(widget, BANNER_W_SET_POS, x, y);
        const value = i === 0 ? mem.read8(slot + BANNER_SLOT.b14) : mem.read8(slot + BANNER_SLOT.b15);
        host.callWidgetMethod(widget, BANNER_W_SET_VALUE, 0, value);
        ret = host.callWidgetMethod(widget, BANNER_W_COMMIT, 1, value) | 0;
        pen += BANNER_PAIR_Y_STRIDE;
    }
    return ret;
}

/**
 * F0x80097310(textWidget, slot, bankId, flag): place one text line at the
 * slot's position plus the flag-indexed x offset, then fill it from the bank.
 * An empty string id hides the line instead.
 */
export function bannerPlaceText(
    mem: BannerMemory, textWidget: number, slot: number, bankId: number, flag: number, host: BannerHost,
): void {
    const sid = mem.read32(slot + BANNER_SLOT.stringId) >>> 0;
    if (sid === 0) {
        host.callWidgetMethod(textWidget >>> 0, BANNER_W_VISIBILITY, 0, textWidget >>> 0);
        return;
    }
    const offset = mem.read16(BANNER_X_OFFSETS + flag * 2);
    const x = s16((mem.read16(slot + BANNER_SLOT.x) + offset) & 0xffff);
    const y = s16((mem.read16(slot + BANNER_SLOT.y) + 4) & 0xffff);
    host.callWidgetMethod(textWidget >>> 0, BANNER_W_SET_POS, x, y);
    const handle = host.bankGet(s32(bankId)) >>> 0;
    host.callWidgetMethod(textWidget >>> 0, BANNER_W_SET_STRING, handle, sid);
}

/**
 * F0x800973E4(textWidget, slot, bankId): fill one measured text line. The
 * resident measure returns a width; the line is centred at 0xA0 - width/2.
 */
export function bannerPlaceTextPair(
    mem: BannerMemory, textWidget: number, slot: number, bankId: number, host: BannerHost,
): void {
    const sid = mem.read32(slot + BANNER_SLOT.stringId) >>> 0;
    if (sid === 0) {
        // The hide call carries the entry a2, which is the slot for this body.
        host.callWidgetMethod(textWidget >>> 0, BANNER_W_VISIBILITY, 0, slot);
        return;
    }
    const handle = host.bankGet(s32(bankId)) >>> 0;
    host.callWidgetMethod(textWidget >>> 0, BANNER_W_SET_STRING, handle, sid);
    const measureA1 = mem.read32(textWidget + 0x50) >>> 0;
    const measureA2 = s16(mem.read16s(textWidget + 0xb4));
    const width = host.measureText((textWidget + 0x5c) >>> 0, measureA1, measureA2) | 0;
    const flag = sid === BANNER_PAIR_ID ? 3 : 0;
    host.callWidgetMethod(textWidget >>> 0, BANNER_W_SET_FLAG, flag, measureA2);
    host.callWidgetMethod(textWidget >>> 0, BANNER_W_VISIBILITY, 1, measureA2);
    const x = s16((BANNER_PAIR_CENTER - Math.trunc(width / 2)) & 0xffff);
    const y = s16((mem.read16(slot + BANNER_SLOT.y) + 4) & 0xffff);
    host.callWidgetMethod(textWidget >>> 0, BANNER_W_SET_POS, x, y);
}

/**
 * F0x80096E8C(slot): stage the slot's content. Draws the value as digit sprites
 * when the slot holds a non-blank value at lane 3, then draws the slot's icon
 * or card face from the 0x800A5984 table over the resident pack.
 */
export function bannerContentDraw(
    mem: BannerMemory, slot: number, host: BannerHost, drawHost: CardDrawHost,
): void {
    const index = s16(mem.read16s(slot + BANNER_SLOT.index));
    const rec = BANNER_TABLE + index * BANNER_TABLE_STRIDE;
    const state = mem.read8(slot + BANNER_SLOT.state);
    const x0 = s16(mem.read16s(slot + BANNER_SLOT.x));
    const y0 = s16(mem.read16s(slot + BANNER_SLOT.y));
    let shift = 0;
    if (index === 2 && mem.read8(slot + BANNER_SLOT.b16) === 1) shift = BANNER_SHIFTED_X;

    if (state === 2 && index === 3 && s16(mem.read16s(slot + BANNER_SLOT.value)) !== 0) {
        const d = host.scratch(0x12);
        mem.write16(d + 0x00, mem.read16(slot + BANNER_SLOT.stringId) & 0x0f);
        mem.write16(d + 0x02, (mem.read16(slot + BANNER_SLOT.x) + 0x18) & 0xffff);
        mem.write16(d + 0x04, (mem.read16(slot + BANNER_SLOT.y) + 4) & 0xffff);
        mem.write16(d + 0x06, mem.read16(slot + BANNER_SLOT.scale) & 0xffff);
        mem.write16(d + 0x08, BANNER_FULL_SCALE);
        mem.write16(d + 0x0a, (mem.read16(slot + BANNER_SLOT.x) + mem.read16(rec)) & 0xffff);
        mem.write16(d + 0x0c, (mem.read16(slot + BANNER_SLOT.y) + mem.read16(rec + 2)) & 0xffff);
        mem.write8(d + 0x0e, 2);
        mem.write8(d + 0x0f, 0);
        mem.write8(d + 0x10, BANNER_DRAW_LAYER);
        drawDigitSprites(mem, d, 1, drawHost);

        const scale = s16(mem.read16s(slot + BANNER_SLOT.scale));
        const recX = s16(mem.read16s(rec));
        const recY = s16(mem.read16s(rec + 2));
        drawHost.setLayer(BANNER_LAYER, BANNER_DRAW_LAYER);
        drawHost.setOrigin(BANNER_ICON_ORIGIN.x, BANNER_ICON_ORIGIN.y);
        drawHost.setPos(x0 + recX, y0 + recY);
        drawHost.setScale(scale, BANNER_FULL_SCALE, BANNER_FULL_SCALE);
        const clip = ((s32(mem.read32(slot + BANNER_SLOT.stringId)) >> 4) * 3) + BANNER_ICON_CLIP_BASE;
        drawHost.drawSprite(drawHost.packResolve(BANNER_ICON_PACK) >>> 0, clip, x0 + 6, y0 + 2);
    }

    const kind = mem.read8(rec + 5);
    const scale = s16(mem.read16s(slot + BANNER_SLOT.scale));
    const recX = s16(mem.read16s(rec));
    const recY = s16(mem.read16s(rec + 2));
    const origin = kind === 2 ? BANNER_FACE_ORIGIN : BANNER_ICON_ORIGIN;
    const pack = kind === 2 ? BANNER_FACE_PACK : BANNER_ICON_PACK;
    drawHost.setLayer(BANNER_LAYER, BANNER_DRAW_LAYER);
    drawHost.setOrigin(origin.x, origin.y);
    if (scale !== BANNER_FULL_SCALE) {
        drawHost.setPos(x0 + recX, y0 + recY);
        drawHost.setScale(scale, BANNER_FULL_SCALE, BANNER_FULL_SCALE);
    }
    drawHost.drawSprite(drawHost.packResolve(pack) >>> 0, mem.read8(rec + 4), x0 + shift, y0);
}

/**
 * F0x80097508(view, para, slot, index): one tick of one HUD slot's banner.
 * The state byte +0x17 selects the ramp / hold / dismiss arm; index selects
 * which line of the para block the slot drives.
 */
export function hudSlotTextTick(
    mem: BannerMemory, view: number, para: number, slot: number, index: number, host: BannerHost,
): void {
    const state = mem.read8(slot + BANNER_SLOT.state);
    if (state === 0) return;
    const bank = s32(mem.read32(BANNER_LANGUAGE_PTR));
    const tail = (): void => bannerContentDraw(mem, slot, host, host);
    const hide = (widgetOff: number): void => {
        host.callWidgetMethod(mem.read32(para + widgetOff) >>> 0, BANNER_W_VISIBILITY, 0, slot);
    };

    if (state === 2) {
        mem.write16(slot + BANNER_SLOT.scale, BANNER_FULL_SCALE);
        if (index === 3) {
            bannerPlaceText(mem, mem.read32(para + 0x24) >>> 0, slot, bank + 0x0f, 0, host);
        } else if (index < 4) {
            // The original compares index against the state byte, which is 2 here.
            if (index === state) bannerPlaceText(mem, mem.read32(para + 0x28) >>> 0, slot, bank + 0x16, 0, host);
        } else if (index === 4) {
            if ((mem.read32(slot + BANNER_SLOT.stringId) >>> 0) === BANNER_BLANK) {
                if (mem.read8(slot + BANNER_SLOT.b16) === 0) {
                    mem.write32(slot + BANNER_SLOT.stringId, BANNER_BLANK_ID);
                    bannerPlaceText(mem, mem.read32(para + 0x2c) >>> 0, slot, bank + 0x0f, 1, host);
                } else {
                    mem.write32(slot + BANNER_SLOT.stringId, bannerDrawPair(mem, para, slot, host) >>> 0);
                    bannerPlaceText(mem, mem.read32(para + 0x2c) >>> 0, slot, bank + 0x0f, 2, host);
                }
            } else {
                hide(0x04);
                hide(0x08);
                bannerPlaceText(mem, mem.read32(para + 0x2c) >>> 0, slot, bank + 0x1d, 0, host);
            }
        }
        tail();
        return;
    }

    if (state === 3) {
        if (index < BANNER_SLOT.count) {
            switch (index) {
                case 0: hide(0x20); break;
                case 2: hide(0x28); break;
                case 3: hide(0x24); break;
                case 4: hide(0x04); hide(0x08); hide(0x2c); break;
                case 5: hide(0x18); break;
                default: break;
            }
        }
        const timer = (mem.read16s(slot + BANNER_SLOT.timer) - (host.frameDelta() | 0)) & 0xffff;
        mem.write16(slot + BANNER_SLOT.timer, timer);
        if (s16(timer) <= 0) mem.write8(slot + BANNER_SLOT.state, 0);
        const duration = s16(mem.read16s(slot + BANNER_SLOT.duration));
        const t = s16(mem.read16s(slot + BANNER_SLOT.timer));
        mem.write16(slot + BANNER_SLOT.scale, s16(duration !== 0 ? Math.trunc((t << 12) / duration) : (t << 12)));
        tail();
        return;
    }

    // States 1 and above 3: ramp the scale down, then land in state 2.
    const t0 = s16(mem.read16s(slot + BANNER_SLOT.timer));
    const duration0 = s16(mem.read16s(slot + BANNER_SLOT.duration));
    const ramp = duration0 !== 0 ? Math.trunc((t0 << 12) / duration0) : (t0 << 12);
    mem.write16(slot + BANNER_SLOT.scale, (BANNER_FULL_SCALE - ramp) & 0xffff);
    const timer = (mem.read16s(slot + BANNER_SLOT.timer) - (host.frameDelta() | 0)) & 0xffff;
    mem.write16(slot + BANNER_SLOT.timer, timer);
    if (s16(timer) > 0) {
        tail();
        return;
    }
    // The state store sits in the branch delay slot, so it happens even when
    // the lane index is out of range.
    mem.write8(slot + BANNER_SLOT.state, 2);
    if (index >= BANNER_SLOT.count) {
        tail();
        return;
    }
    switch (index) {
        case 0:
            bannerPlaceText(mem, mem.read32(para + 0x20) >>> 0, slot, bank + 0x0f, 1, host);
            break;
        case 2:
            bannerPlaceText(mem, mem.read32(para + 0x28) >>> 0, slot, bank + 0x16, 0, host);
            break;
        case 3:
            bannerPlaceText(mem, mem.read32(para + 0x24) >>> 0, slot, bank + 0x0f, 0, host);
            break;
        case 5:
            if (s16(mem.read16s(slot + BANNER_SLOT.index)) === 5) {
                bannerPlaceTextPair(mem, mem.read32(para + 0x18) >>> 0, slot, bank + 0x0f, host);
            } else {
                const flag = (mem.read32(slot + BANNER_SLOT.stringId) >>> 0) === 0x24 ? 0 : 1;
                bannerPlaceText(mem, mem.read32(para + 0x18) >>> 0, slot, bank + 0x0f, flag, host);
            }
            break;
        default:
            break;
    }
    tail();
}

/** F0x800978F0(view, para): tick all six HUD slot banners. */
export function hudSlotTextTickAll(mem: BannerMemory, view: number, para: number, host: BannerHost): void {
    for (let i = 0; i < BANNER_SLOT.count; i++) {
        hudSlotTextTick(mem, view, para, (view + BANNER_SLOT.base + i * BANNER_SLOT.stride) >>> 0, i, host);
    }
}
