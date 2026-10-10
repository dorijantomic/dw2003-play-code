// The card duel's pooled card sprites, translated from pro/cardgame:
//   F0x8009B890 cardSpriteUpdate      — the 12-state per-sprite machine
//   F0x8009B76C drawSpinningCardBack  — the settle-state shine (board clip 9)
//   F0x8009BAC8 cardSpritesTickAll    — update all 40, then two draw passes
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/card-sprites-oracle.test.js runs the originals through
// engine/native on the shipped pro_cardgame.bin + resident.bin.
//
// DECODED: authority-2 closures `_asm/F0x8009b890.s`, `_asm/F0x8009b76c.s`,
// `_asm/F0x8009bac8.s` and the accepted cardgame-executed-symbol-map rows. The
// pool is 40 sprites of stride 0x4C at view+0xF8; state is +0x42, render kind
// +0x45, animation accumulator +0x2C, layer flag +0x26.
//
// The twelve state arms call seven per-state bodies (F0x80099FFC for states 2
// and 3, F0x8009A75C, F0x8009A1A0, F0x8009A62C, F0x8009A454, F0x8009A540 and
// F0x8009A5B0), none of which is reached in the idle census, so they go through
// the host.

import { cardSpriteDraw } from "./card-layers.ts";
import type { CardLayerMemory, CardLayerHost } from "./card-layers.ts";

export interface CardSpriteMemory extends CardLayerMemory {
    write8(addr: number, value: number): void;
    write32(addr: number, value: number): void;
}

export interface CardSpriteHost extends CardLayerHost {
    /** `[0x8004DF9C]` = resident F0x8001D704: the frame delta. */
    frameDelta(): number;
    /** ctx+0x88 (F0x8001ECEC): set the sprite frame index. */
    setFrame(n: number): void;
    /** A per-state body call: `addr(view, sprite, arg)`; returns $v0. */
    callSpriteStateBody(addr: number, view: number, sprite: number, arg: number): number;
}

export const CARD_SPRITE_POOL_BASE = 0x0108;
export const CARD_SPRITE_STRIDE = 0x4c;
export const CARD_SPRITE_COUNT = 40;
export const CARD_SPRITE_FIELDS = {
    layerFlag: 0x26,   // s16: which draw pass paints it
    anim: 0x2c,        // s32: the shine's accumulator
    state: 0x42,       // u8: the 12-state machine
    renderKind: 0x45,  // u8
} as const;
export const CARD_SPRITE_STATE_BODIES = {
    states23: 0x80099ffc,
    state4: 0x8009a75c,
    state5: 0x8009a1a0,
    state6: 0x8009a62c,
    state7: 0x8009a454,
    state8: 0x8009a540,
    states910: 0x8009a5b0,
} as const;
export const CARD_SHINE_SHEET = 0x025d0003;
export const CARD_SHINE_CLIP = 9;
export const CARD_SPRITE_LAYER = 0x100;
export const CARD_SPRITE_ORIGIN = { x: 0x340, y: 0 } as const;
export const CARD_SHINE_FRAMES = 5;
export const CARD_SPRITE_STATE_MAX = 0x0c;
export const CARD_SPRITE_ANIM_LIMIT = 11;
export const CARD_SPRITE_STATE_SETTLED = 1;
export const CARD_SPRITE_SCALE_Z = 0x1000;
export const CARD_SPRITE_PIVOT_DX = 0x14;
export const CARD_SPRITE_PIVOT_DY = 0x17;

const s16 = (v: number): number => (v << 16) >> 16;
const s32 = (v: number): number => v | 0;

/** The sprite address for pool slot `i`. */
export function cardSpriteEntry(view: number, i: number): number {
    return (view + CARD_SPRITE_POOL_BASE + i * CARD_SPRITE_STRIDE) >>> 0;
}

/** F0x8009B890(view, sprite): one tick of the 12-state per-sprite machine. */
export function cardSpriteUpdate(
    mem: CardSpriteMemory, view: number, sprite: number, host: CardSpriteHost,
): void {
    const state = mem.read8(sprite + CARD_SPRITE_FIELDS.state);
    if (state >= CARD_SPRITE_STATE_MAX) return;
    const bump = (bits: number) => {
        mem.write32(view + 0x54, (mem.read32(view + 0x54) | bits) >>> 0);
    };
    switch (state) {
        case 0:
            mem.write8(sprite + CARD_SPRITE_FIELDS.renderKind, 0);
            return;
        case 1:
            return;
        case 2:
        case 3:
            bump(1);
            host.callSpriteStateBody(CARD_SPRITE_STATE_BODIES.states23, view, sprite, sprite);
            return;
        case 4:
            bump(1);
            host.callSpriteStateBody(CARD_SPRITE_STATE_BODIES.state4, view, sprite, sprite);
            return;
        case 5:
            bump(1);
            if (s32(host.callSpriteStateBody(CARD_SPRITE_STATE_BODIES.state5, view, sprite, sprite)) === 0) return;
            bump(2);
            return;
        case 6:
            bump(1);
            host.callSpriteStateBody(CARD_SPRITE_STATE_BODIES.state6, view, sprite, sprite);
            return;
        case 7:
            bump(1);
            host.callSpriteStateBody(CARD_SPRITE_STATE_BODIES.state7, view, sprite, sprite);
            return;
        case 8:
            bump(1);
            host.callSpriteStateBody(CARD_SPRITE_STATE_BODIES.state8, view, sprite, sprite);
            return;
        case 9:
            host.callSpriteStateBody(CARD_SPRITE_STATE_BODIES.states910, view, sprite, 0x24);
            bump(1);
            return;
        case 10:
            host.callSpriteStateBody(CARD_SPRITE_STATE_BODIES.states910, view, sprite, 0x1c);
            bump(1);
            return;
        default: // state 11
            bump(1);
            {
                const acc = (mem.read32(sprite + CARD_SPRITE_FIELDS.anim) + s32(host.frameDelta())) | 0;
                mem.write32(sprite + CARD_SPRITE_FIELDS.anim, acc >>> 0);
                if (acc >= CARD_SPRITE_ANIM_LIMIT) {
                    mem.write8(sprite + CARD_SPRITE_FIELDS.state, CARD_SPRITE_STATE_SETTLED);
                }
            }
            return;
    }
}

/**
 * F0x8009B76C(view, sprite): a settled card's shine. Gated on render kind and
 * state 11 (0xB); the frame is `(s32(sprite+0x2C)/2) % 5`.
 */
export function drawSpinningCardBack(mem: CardSpriteMemory, sprite: number, host: CardSpriteHost): void {
    if (mem.read8(sprite + CARD_SPRITE_FIELDS.renderKind) === 0) return;
    if (mem.read8(sprite + CARD_SPRITE_FIELDS.state) !== CARD_SPRITE_ANIM_LIMIT) return;
    const half = Math.trunc(s32(mem.read32(sprite + CARD_SPRITE_FIELDS.anim)) / 2);
    host.setFrame(half % CARD_SHINE_FRAMES);
    host.setPos((s32(mem.read32(sprite + 0x00)) >> 8) + CARD_SPRITE_PIVOT_DX,
        (s32(mem.read32(sprite + 0x04)) >> 8) + CARD_SPRITE_PIVOT_DY);
    host.setScale(s16(mem.read16s(sprite + 0x18)), s16(mem.read16s(sprite + 0x1a)), CARD_SPRITE_SCALE_Z);
    host.setLayer(CARD_SPRITE_LAYER, 1);
    host.setOrigin(CARD_SPRITE_ORIGIN.x, CARD_SPRITE_ORIGIN.y);
    const handle = host.packResolve(CARD_SHINE_SHEET) >>> 0;
    host.drawSprite(handle, CARD_SHINE_CLIP,
        s32(mem.read32(sprite + 0x00)) >> 8, s32(mem.read32(sprite + 0x04)) >> 8);
}

/**
 * F0x8009BAC8(view, param): update all 40 pooled sprites (index 39 down to 0),
 * then two draw passes over the same order — the layer flag set first, then the
 * flag clear.
 */
export function cardSpritesTickAll(mem: CardSpriteMemory, view: number, host: CardSpriteHost): void {
    for (let i = CARD_SPRITE_COUNT - 1; i >= 0; i--) {
        const sprite = cardSpriteEntry(view, i);
        cardSpriteUpdate(mem, view, sprite, host);
        drawSpinningCardBack(mem, sprite, host);
    }
    for (let layer = 0; layer < 2; layer++) {
        for (let i = CARD_SPRITE_COUNT - 1; i >= 0; i--) {
            const sprite = cardSpriteEntry(view, i);
            const flag = mem.read16s(sprite + CARD_SPRITE_FIELDS.layerFlag);
            const draw = layer === 0 ? flag !== 0 : flag === 0;
            if (draw) cardSpriteDraw(mem, view, sprite, host);
        }
    }
}
