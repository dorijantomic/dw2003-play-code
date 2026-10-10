// Field-actor billboard per-frame registration — the one shared definition of
// where a field actor's own sprite quad lands on screen.
//
// Decode: docs/research/field/field-actor-sprite-anchor-decoded-2026-08-17.md
// (the Y axis and the mirrored facings, closed 2026-10-05) and
// docs/research/field/field-actor-anim-engine.md (the frame lists).
// Authority: ~/ddw3/asm/dw2003/pro/fieldstg.s, the field-actor
// renderer at file 0xc87c (RAM 0x8008f52c) — the same routine that emits the
// drop shadow, one OT bucket further back.
//
// What a player sees: every actor's sprite is hung off a per-frame number the
// disc registers for that frame, not off the frame's own bounding box. The
// number is a signed offset from the actor's world anchor to the quad's LEFT
// edge (X) and to the quad's TOP edge (Y), and it is why an actor's shadow can
// sit a few pixels away from the middle of the sprite standing in it.

/**
 * `entity+0x60` is the facing-group value. Facings below this are drawn from
 * their own texture as-is; facings at or above it are the right-hand side, and
 * the renderer reflects the offset+width pair — not just the pixels.
 *
 * fieldstg.s:12892-12895 (`slti v0,5` / `bnez .L0x0000c978`) for X, and the
 * same test again at fieldstg.s:12941-12944 for the texture coordinates.
 */
export const BILLBOARD_MIRROR_FACING_FROM = 5;

export interface FieldBillboardInput {
  /** Actor's world X projected to screen (the shadow's centre column too). */
  screenX: number;
  /**
   * Actor's world Y projected to screen, AFTER the 8.8 height lift
   * (`entity+0x64`) was subtracted — i.e. the row the actor's own billboard is
   * registered against. The shadow deliberately undoes that term first, so this
   * row is above the ground row for a lifted actor.
   */
  screenY: number;
  /** `entity+0x60`, the facing group. */
  facing: number;
  /**
   * `entity+0xDC` — the frame's registered X offset, the frame-list record's
   * third word. Signed, in pixels, from the actor's anchor to the quad's left
   * edge.
   */
  xOffset: number;
  /**
   * `entity+0xE0` — the frame's registered Y offset, the record's fourth word.
   * Signed, in pixels, from the actor's screen row to the quad's TOP edge.
   */
  yOffset: number;
  /** `entity+0xE4` — the frame's texture width, from its TIM header. */
  textureWidth: number;
  /** `entity+0xE6` — the frame's texture height, from its TIM header. */
  textureHeight: number;
}

export interface FieldBillboardQuad {
  /** Left column of the quad. */
  x0: number;
  /**
   * Right edge as the PS1 primitive stores it: `x0 + width` on a left-side
   * facing, `x0 + width - 1` on a mirrored one.
   */
  x1: number;
  /** Top row of the quad (shared by both top corners). */
  y0: number;
  /** Bottom edge of the quad (shared by both bottom corners). */
  y1: number;
  /** True when the facing is a right-hand one and the texture row is flipped. */
  mirrored: boolean;
}

/**
 * The billboard quad, straight out of fieldstg.s:12892-12940.
 *
 *   facing <  5 :  x0 = screenX + xOffset                     (left  side)
 *   facing >= 5 :  x0 = screenX - (textureWidth + xOffset)    (mirrored)
 *   both        :  y0 = screenY + yOffset,  y1 = y0 + textureHeight
 *
 * Three details worth naming because they are easy to get backwards:
 *
 * - **Y is never mirrored.** The mirrored branch touches only the X columns and
 *   the U texture coordinates; every `lhu 0xe0($s1)` on the Y side is
 *   unconditional (fieldstg.s:12919-12940). A sprite facing right stands on the
 *   same row it stands on facing left.
 * - **The Y sum is truncated to 16 bits** by the primitive's `sh` store
 *   (fieldstg.s:12923), so a negative registered offset behaves as a negative
 *   offset rather than as a huge positive one. The disc's offsets are mostly
 *   negative, so this matters.
 * - **The two facings part at 12959, not at 12961.** Facing < 5 stores the
 *   forward U row and then leaves at `j 0x8008f770`; the `addu $v0, $v1` in that
 *   jump's DELAY SLOT always runs, which is where the left-side u3 comes from.
 *   Facing >= 5 branches to 12961, takes the far column one short
 *   (`addiu $v1, -0x1`, 12962-12966) and stores the reversed U row instead. Read
 *   as a fall-through you would invert every mirror case.
 */
export function fieldBillboardQuad(input: FieldBillboardInput): FieldBillboardQuad {
  const { screenX, screenY, facing, xOffset, yOffset, textureWidth, textureHeight } = input;
  const mirrored = facing >= BILLBOARD_MIRROR_FACING_FROM;
  const x0 = mirrored ? screenX - (textureWidth + xOffset) : screenX + xOffset;
  const y0 = (screenY + yOffset) << 16 >> 16;
  return {
    x0,
    x1: mirrored ? x0 + textureWidth - 1 : x0 + textureWidth,
    y0,
    y1: y0 + textureHeight,
    mirrored,
  };
}

/**
 * Where the bottom of a frame's quad sits relative to the actor's ground screen
 * row: `yOffset + textureHeight`, i.e. `y1 - groundRow`.
 *
 * This is the quantity the browser renderer needs, because its baked sheets are
 * bottom-aligned on the actor's ground row rather than registered per frame —
 * so the walker's per-frame draw offset is this number, not the raw `yOffset`.
 * On the disc it is a small positive number for almost every field sprite (the
 * character's feet sit a few rows below the centre of its own drop shadow), and
 * it is not constant across every frame of every clip.
 */
export function billboardBottomShift(yOffset: number, textureHeight: number): number {
  return yOffset + textureHeight;
}
