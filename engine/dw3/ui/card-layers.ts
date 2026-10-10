// The card duel's per-card layer draws, translated from pro/cardgame:
//   F0x8009BA3C cardSpriteDraw        — the body that calls all six layers
//   F0x8009B028 drawCardStatusPips    — the power/status pips
//   F0x8009AF28 drawCardElementMark   — the element mark (top-left)
//   F0x8009B678 drawCannotUseOverlay  — the "can't use" stamp-and-bar overlay
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/card-layers-oracle.test.js runs each original through
// engine/native on the shipped pro_cardgame.bin + resident.bin with the pack
// resolver and draw context recorded.
//
// DECODED: authority-2 closures `_asm/F0x8009ba3c.s`, `_asm/F0x8009b028.s`,
// `_asm/F0x8009af28.s`, `_asm/F0x8009b678.s` and the accepted
// cardgame-card-sprite-layers contract. The three sibling draws cardSpriteDraw
// also calls — the selection glow F0x8009ACAC, the effect badge F0x8009A998 and
// the face/numbers F0x8009B168 — are not in the idle census and have no engine
// port yet, so they go through the host; they are the browser's existing draws.
//
// NOT SETTLED (the contract says so): sprite+0x46's element identity and the
// meaning of the three pip bytes at +0x3E..+0x40. The port uses the raw bytes
// as the original does and invents no element/colour table.

export interface CardLayerMemory {
    read8(addr: number): number;
    read16s(addr: number): number;
    read32(addr: number): number;
}

export interface CardLayerHost {
    /** ctx+0x94 (F0x8001F608): set the sprite position. */
    setPos(x: number, y: number): void;
    /** ctx+0x8C (F0x8001F5D0): set the sprite scale. */
    setScale(sx: number, sy: number, sz: number): void;
    /** ctx+0x7C (F0x8001ED34): set the draw layer target and bucket. */
    setLayer(target: number, bucket: number): void;
    /** ctx+0x74 (F0x8001ECBC): set the draw origin / texture page. */
    setOrigin(x: number, y: number): void;
    /** ctx+0x84 (F0x8001ED6C): draw a sprite from the resolved pack. */
    drawSprite(handle: number, clip: number, x: number, y: number): void;
    /** `[0x80044F5C]`: resolve a pack handle to its image. */
    packResolve(handle: number): number;
    /** F0x8009ACAC(view, sprite): the selection glow (not yet translated). */
    drawSelectionGlow(view: number, sprite: number): void;
    /** F0x8009A998(view, sprite): the effect badge (not yet translated). */
    drawEffectBadge(view: number, sprite: number): void;
    /** F0x8009B168(view, sprite): the face and its numbers (not yet translated). */
    drawFace(view: number, sprite: number): void;
}

export const CARD_SPRITE = {
    x: 0x00,          // s32, 8.8 fixed point
    y: 0x04,          // s32, 8.8 fixed point
    scaleX: 0x18,     // s16
    scaleY: 0x1a,     // s16
    pip0: 0x3e,       // u8
    pip1: 0x3f,       // u8
    pip2: 0x40,       // u8
    renderKind: 0x45, // u8
    elementClip: 0x46,// u8
    cannotUse: 0x49,  // u8
} as const;

/** The unit-scale word the three layers compare against (scaleX|scaleY<<16). */
export const CARD_UNIT_SCALE = 0x10001000;
export const CARD_PIPS_SHEET = 0x025d0002;
export const CARD_LOCK_SHEET = 0x025d0003;
export const CARD_PIP_CLIP_BASE = 0x37;
export const CARD_PIP_SPACING = 8;
export const CARD_ELEMENT_CLIP_BASE = 0x33;
export const CARD_LOCK_CLIP = 0x0a;
export const CARD_LAYER = 0x100;
export const CARD_LAYER_BUCKET = 1;
export const CARD_ORIGIN_280 = { x: 0x280, y: 0 } as const;
export const CARD_ORIGIN_340 = { x: 0x340, y: 0 } as const;
export const CARD_SCALE_Z = 0x1000;
export const CARD_PIVOT_DX = 0x14;
export const CARD_PIVOT_DY = 0x17;

const s32 = (v: number): number => v | 0;
const s16 = (v: number): number => (v << 16) >> 16;

/** The conditional pivot/scale pair all three layers emit at non-unit scale. */
function applyPivotAndScale(mem: CardLayerMemory, sprite: number, host: CardLayerHost): void {
    if ((mem.read32(sprite + CARD_SPRITE.scaleX) >>> 0) === CARD_UNIT_SCALE) return;
    host.setPos((s32(mem.read32(sprite + CARD_SPRITE.x)) >> 8) + CARD_PIVOT_DX,
        (s32(mem.read32(sprite + CARD_SPRITE.y)) >> 8) + CARD_PIVOT_DY);
    host.setScale(s16(mem.read16s(sprite + CARD_SPRITE.scaleX)),
        s16(mem.read16s(sprite + CARD_SPRITE.scaleY)), CARD_SCALE_Z);
}

/** F0x8009B028(sprite): draw the three power/status pips. */
export function drawCardStatusPips(mem: CardLayerMemory, sprite: number, host: CardLayerHost): void {
    if (mem.read8(sprite + CARD_SPRITE.renderKind) === 0) return;
    let drawn = 0;
    for (let i = 0; i < 3; i++) {
        if (mem.read8(sprite + CARD_SPRITE.pip0 + i) === 0) continue;
        applyPivotAndScale(mem, sprite, host);
        host.setLayer(CARD_LAYER, CARD_LAYER_BUCKET);
        host.setOrigin(CARD_ORIGIN_280.x, CARD_ORIGIN_280.y);
        const handle = host.packResolve(CARD_PIPS_SHEET) >>> 0;
        // x uses the DRAWN count, not the pip index: a skipped pip shifts the
        // later pips left (asm s2 = drawn pips).
        host.drawSprite(handle, CARD_PIP_CLIP_BASE + i,
            (s32(mem.read32(sprite + CARD_SPRITE.x)) >> 8) + 3 + drawn * CARD_PIP_SPACING,
            (s32(mem.read32(sprite + CARD_SPRITE.y)) >> 8) + 0x15);
        drawn += 1;
    }
}

/** F0x8009AF28(sprite): draw the element mark in the card's top-left. */
export function drawCardElementMark(mem: CardLayerMemory, sprite: number, host: CardLayerHost): void {
    if (mem.read8(sprite + CARD_SPRITE.renderKind) === 0) return;
    const element = mem.read8(sprite + CARD_SPRITE.elementClip);
    if (element === 0) return;
    applyPivotAndScale(mem, sprite, host);
    host.setLayer(CARD_LAYER, CARD_LAYER_BUCKET);
    host.setOrigin(CARD_ORIGIN_280.x, CARD_ORIGIN_280.y);
    const handle = host.packResolve(CARD_PIPS_SHEET) >>> 0;
    host.drawSprite(handle, CARD_ELEMENT_CLIP_BASE + element,
        (s32(mem.read32(sprite + CARD_SPRITE.x)) >> 8) + 3,
        (s32(mem.read32(sprite + CARD_SPRITE.y)) >> 8) + 2);
}

/** F0x8009B678(sprite): draw the "can't use" stamp-and-bar overlay. */
export function drawCannotUseOverlay(mem: CardLayerMemory, sprite: number, host: CardLayerHost): void {
    if (mem.read8(sprite + CARD_SPRITE.renderKind) === 0) return;
    if (mem.read8(sprite + CARD_SPRITE.cannotUse) === 0) return;
    applyPivotAndScale(mem, sprite, host);
    host.setLayer(CARD_LAYER, CARD_LAYER_BUCKET);
    host.setOrigin(CARD_ORIGIN_340.x, CARD_ORIGIN_340.y);
    const handle = host.packResolve(CARD_LOCK_SHEET) >>> 0;
    host.drawSprite(handle, CARD_LOCK_CLIP,
        s32(mem.read32(sprite + CARD_SPRITE.x)) >> 8,
        s32(mem.read32(sprite + CARD_SPRITE.y)) >> 8);
}

/**
 * F0x8009BA3C(view, sprite): draw every layer of one card, in the disc's order —
 * glow, pips, element, badge, lock, face. The gate is both scales nonzero.
 */
export function cardSpriteDraw(
    mem: CardLayerMemory, view: number, sprite: number, host: CardLayerHost,
): void {
    if (s16(mem.read16s(sprite + CARD_SPRITE.scaleX)) === 0) return;
    if (s16(mem.read16s(sprite + CARD_SPRITE.scaleY)) === 0) return;
    host.drawSelectionGlow(view, sprite);
    drawCardStatusPips(mem, sprite, host);
    drawCardElementMark(mem, sprite, host);
    host.drawEffectBadge(view, sprite);
    drawCannotUseOverlay(mem, sprite, host);
    host.drawFace(view, sprite);
}
