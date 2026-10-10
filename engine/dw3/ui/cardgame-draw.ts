// Two card-duel draw bodies, translated from pro/cardgame:
//   F0x80096950 waitingSpinnerDraw — the duel's waiting spinner
//   F0x80096A94 drawDigitSprites   — a number drawn as decimal digit sprites
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/cardgame-draw-oracle.test.js runs both originals through
// engine/native on the shipped pro_cardgame.bin + resident.bin with the draw
// context recorded, and compares the ordered intents and every touched field.
//
// DECODED: authority-2 closures `_asm/F0x80096950.s` and `_asm/F0x80096a94.s`.
// Both build their own draw context (F0x8001F648) and resolve the same resident
// sheet handle 0x025D0003 through `[0x80044F5C]` before drawing.
//
// The census name `waitingSpinnerDraw` matches the body: a three-state spinner
// on obj+0xE9E that holds marker-sheet clip 0 and cycles its frame 0..11 (one
// step every four ticks), then parks on frame 11. obj+0x58 selects the draw
// position, `((obj+0x58) >> 1) & 0x3F`, used for both x and y.

export interface CardDrawMemory {
    read8(addr: number): number;
    write8(addr: number, value: number): void;
    read16s(addr: number): number;
    read32(addr: number): number;
}

export interface CardDrawHost {
    /** ctx+0x74 (F0x8001ECBC): set the draw origin. */
    setOrigin(x: number, y: number): void;
    /** ctx+0x7C (F0x8001ED34): set the draw layer target and bucket. */
    setLayer(target: number, bucket: number): void;
    /** ctx+0x88 (F0x8001ECEC): set the sprite frame index. */
    setFrame(n: number): void;
    /** ctx+0x94 (F0x8001F608): set the sprite position. */
    setPos(x: number, y: number): void;
    /** ctx+0x8C (F0x8001F5D0): set the sprite scale. */
    setScale(sx: number, sy: number, sz: number): void;
    /** ctx+0x84 (F0x8001ED6C): draw a sprite from the resolved pack. */
    drawSprite(packPtr: number, clip: number, x: number, y: number): void;
    /** `[0x80044F5C]` = F0x800140D8: resolve a pack handle to its image. */
    packResolve(handle: number): number;
    /** `[0x8004DF9C]` = resident F0x8001D704: the frame delta. */
    frameDelta(): number;
}

/** The resident sheet both bodies resolve. */
export const CARD_SHEET = 0x025d0003;
export const CARD_DRAW_LAYER = 0x100;
export const CARD_DRAW_ORIGIN = { x: 0x340, y: 0 } as const;

/** waitingSpinnerDraw's fields. */
export const SPINNER = { pos: 0x58, frame: 0xe9c, counter: 0xe9d, state: 0xe9e } as const;
export const SPINNER_FRAME_MAX = 11;
export const SPINNER_STEP_TICKS = 4;

/** drawDigitSprites' fields. */
export const DIGIT = {
    value: 0x00,
    x: 0x02,
    y: 0x04,
    scaleX: 0x06,
    scaleY: 0x08,
    posX: 0x0a,
    posY: 0x0c,
    count: 0x0e,
    force: 0x0f,
    layer: 0x10,
} as const;
export const DIGIT_CLIP_BASE = 0x14;
export const DIGIT_SPACING = 7;
export const DIGIT_SCALE_Z = 0x1000;

const s32 = (v: number): number => v | 0;
const s16 = (v: number): number => (v << 16) >> 16;

/** F0x80096950(obj): one waiting-spinner frame. */
export function waitingSpinnerDraw(mem: CardDrawMemory, obj: number, host: CardDrawHost): void {
    host.setLayer(CARD_DRAW_LAYER, 2);
    host.setOrigin(CARD_DRAW_ORIGIN.x, CARD_DRAW_ORIGIN.y);
    const state = mem.read8(obj + SPINNER.state);
    let frame: number;
    if (state === 1) {
        let counter = mem.read8(obj + SPINNER.counter);
        if (counter >= SPINNER_STEP_TICKS) {
            counter = (counter - SPINNER_STEP_TICKS) & 0xff;
            mem.write8(obj + SPINNER.counter, counter);
            const next = (mem.read8(obj + SPINNER.frame) + 1) & 0xff;
            mem.write8(obj + SPINNER.frame, next);
            if (next >= SPINNER_FRAME_MAX) {
                mem.write8(obj + SPINNER.frame, SPINNER_FRAME_MAX);
                mem.write8(obj + SPINNER.state, 2);
            }
        }
        frame = mem.read8(obj + SPINNER.frame);
        mem.write8(obj + SPINNER.counter, (mem.read8(obj + SPINNER.counter) + s32(host.frameDelta())) & 0xff);
    } else if (state === 2) {
        frame = SPINNER_FRAME_MAX;
    } else {
        frame = 0;
    }
    host.setFrame(frame);
    const pos = ((mem.read32(obj + SPINNER.pos) >>> 0) >>> 1) & 0x3f;
    const handle = host.packResolve(CARD_SHEET) >>> 0;
    host.drawSprite(handle, 0, pos, pos);
}

/**
 * F0x80096A94(obj, flag): draw obj+0x00 as decimal digit sprites, right to
 * left, suppressing leading zeros unless obj+0x0F is set. When `flag` is
 * nonzero the object's own position and scale are applied first.
 */
export function drawDigitSprites(mem: CardDrawMemory, obj: number, flag: number, host: CardDrawHost): void {
    host.setLayer(CARD_DRAW_LAYER, mem.read8(obj + DIGIT.layer));
    host.setOrigin(CARD_DRAW_ORIGIN.x, CARD_DRAW_ORIGIN.y);
    if (flag !== 0) {
        host.setPos(s16(mem.read16s(obj + DIGIT.posX)), s16(mem.read16s(obj + DIGIT.posY)));
        host.setScale(s16(mem.read16s(obj + DIGIT.scaleX)), s16(mem.read16s(obj + DIGIT.scaleY)), DIGIT_SCALE_Z);
    }
    let value = s16(mem.read16s(obj + DIGIT.value));
    const count = mem.read8(obj + DIGIT.count);
    const force = mem.read8(obj + DIGIT.force);
    const xBase = s16(mem.read16s(obj + DIGIT.x));
    const y = s16(mem.read16s(obj + DIGIT.y));
    let index = 0;
    while (index < count) {
        const quotient = Math.trunc(value / 10);
        const digit = value - quotient * 10; // C-style: sign follows the dividend
        const draw = index === 0 || force !== 0 || digit !== 0 || quotient !== 0;
        if (draw) {
            const handle = host.packResolve(CARD_SHEET) >>> 0;
            host.drawSprite(handle, digit + DIGIT_CLIP_BASE, xBase + (count - index - 1) * DIGIT_SPACING, y);
        }
        index += 1;
        value = quotient;
    }
}
