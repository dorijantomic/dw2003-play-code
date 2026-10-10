// engine/systems/field-balloon.ts
//
// The FIELDCOM balloon actor — the ONE actor class that hangs every little
// bubble over a character's head in the overworld: the step-VM's proximity
// indicator, the story/talk bubbles, and the fishing end-of-cast result bubble
// are all the same 0x6c-byte object. Decoded from the original assembly
// ~/ddw3/asm/dw2003/pro/fieldstg.s (overlay RAM base 0x80082cb0).
//
// THE FACTORY. F0x80088144 (file 0x5494) allocates the object with tick
// F0x80087F84 (file 0x52d4) and stores its two arguments at +0x4 (the geometry
// set) and +0x8 (the subtype, which IS the glyph row). Three spawn sites exist
// and they differ only in those two numbers:
//   - the step-VM's proximity indicator, F0x80088144(0, kind, 6) (file 0x5900);
//     `kind` is the step op's icon row (op 7 -> 5 = the rod-and-splash);
//   - the story bubble (registry ctor 0x80088190 -> the same factory);
//   - the fishing result bubble, F0x80088144(0, 1, 6) (file 0xDD5C).
//
// THE FACE. The tick keeps a single counter +0x60 and the draw blits
// `(u8)(+0x60 >> 2)` as the sprite cel (F0x80087E7C, file 0x52A4, pack
// 0x01600000). The counter is pinned to three checkpoints set once at spawn
// (files 0x533c-0x5374), one triple per geometry set (+0x4):
//
//   +0x4 = 0 (every bubble the game draws):  +0x54 = 0xc8  0x58 = 0xd4  0x5c = 0xdc
//   +0x4 = 1 (the second set):               +0x54 = 0x104 0x58 = 0x10c 0x5c = 0x114
//
// The counter starts at +0x54 and rises by the frame delta [0x8004df9c]():
// below +0x58 the balloon is popping (cels 0x32..0x34); at +0x58 it snaps and
// holds (cel 0x35, and phase 2 is the ONLY phase that also draws the glyph); a
// close command (the actor's +0x28, setStage(2), the arm at file 0x543C) raises
// it again toward +0x5c and, at that cap, snaps, calls setStage(3) and draws
// nothing ever again (cels 0x35..0x37 shown).
//
// +0x5c IS ALWAYS WRITTEN — the close is bounded. All three constants converge
// on ONE store, `sw $v0, 0x5c($s0)` at file 0x5374: the variant-1 path falls
// through into it with `$v0 = 0x114` (li at 0x5370), and the variant-0 path
// jumps to it with `$v0 = 0xdc` loaded in the delay slot of the `j 0x80088024`
// at 0x5358 (word 0x08022009 targets file 0x5374, exactly this store). A
// 2026-10-02 reading worried +0x5c might be left unwritten on the variant-0
// path, leaving the close unbounded; it is not — the jump target is the store.
//
// THE ANCHOR. F0x80087E7C blits at the OWNER entity, not at a rising screen
// offset:
//   x = owner+0x58
//   y = owner+0x5c - (owner+0x64 >> 8) - 0x1b
// (file 0x51e8-0x5208; `addiu $a3,-0x1b` at 0x5288/0x52bc). That is 27 px above
// the owner's feet; the height term is the owner's own 8.8 hover, so only a
// Submarimon's balloon rides up with it and everyone else passes no motion.
//
// THE GLYPH. While the phase field +0x10 == 2 the draw first blits a second
// sprite at the same spot: F0x80087DB0 (file 0x5100) returns
// `glyph_table[subtype*9 + cursor]` over the 9-stride, 0xff-terminated row
// table at RAM 0x800975c0. Row = subtype, so the fishing result bubble
// (subtype 1) shows row 1 (ids 1/2) and the spot indicator (subtype 5) shows
// row 5 (ids 10/11) — NOT the same glyph. That identity is what the corrected
// FISH-010 got wrong.
//
// Callers: web/fieldcom.js consumes this model for the story bubble, the
// proximity indicator and the fishing result balloon; engine/systems/fishing.ts
// owns the result balloon's lifetime (when it opens and when the close is
// commanded). One model of the actor, two owners of its two halves.
// Ledger: fishing-q008-balloon-draw-cel-and-owner-anchor-2026-09-13,
// fieldcom-balloon-draws-last-cel-before-state-3-2026-10-02.

import { submarimonLiftPixels, type SubmarimonMotion } from "./submarimon-motion.ts";

/** The three counters the balloon's face is pinned to, per geometry set (+0x4). */
export interface BalloonCheckpoints {
  /** +0x54 — the counter's opening value; cel `start >> 2` = 0x32. */
  start: number;
  /** +0x58 — the hold checkpoint; cel 0x35, and the only phase that draws the glyph. */
  hold: number;
  /** +0x5c — the close cap; the cels `hold >> 2` .. `gone >> 2`, then nothing. */
  gone: number;
}

/** Geometry set 0 — the one every bubble the game draws uses (file 0x533c-0x5374). */
export const BALLOON_SET_0: BalloonCheckpoints = { start: 0xc8, hold: 0xd4, gone: 0xdc };
/** Geometry set 1. No spawn site in the corpus passes +0x4 != 0. */
export const BALLOON_SET_1: BalloonCheckpoints = { start: 0x104, hold: 0x10c, gone: 0x114 };
/** Both geometry sets, indexed by the factory's first argument (+0x4). */
export const BALLOON_SETS: readonly BalloonCheckpoints[] = [BALLOON_SET_0, BALLOON_SET_1];

/** 27 px above the owner's feet (`addiu $a3,-0x1b`, files 0x5288/0x52bc). */
export const BALLOON_ANCHOR_LIFT = 0x1b;

/** Row stride of `glyph_table[subtype*9 + cursor]` (the table at RAM 0x800975c0). */
export const GLYPH_ROW_STRIDE = 9;

/** The glyph row a balloon draws: its subtype `+0x8` (F0x80087DB0, file 0x5100). */
export function glyphRowForSubtype(subtype: number): number {
  return subtype;
}

/** The fishing end-of-cast result bubble's subtype (`F0x80088144(0, 1, 6)`). */
export const RESULT_BUBBLE_SUBTYPE = 1;

/**
 * Rendered frames per counter unit. The counter is stepped by the engine frame
 * delta [0x8004df9c](); its scale is not decoded, and the one measured pair is
 * the type-0x16 orb loop (duration 8 units) running ORB_FRAMES = 6 frames
 * (web/fieldcom.js), so one unit is 0.75 rendered frames.
 */
export const BALLOON_UNIT_FRAMES = 6 / 8;

/**
 * The balloon's face for a geometry set, or null once it has closed.
 *
 * `openFrames` = rendered frames since the open; `closeFrames` = frames since
 * the close command, or null while it is still open.
 *
 * The close shows ONE frame at the third checkpoint: the tick that snaps the
 * counter to `gone` calls setStage(3) before the draw, and stage 3 returns
 * before the draw, so the cel `gone >> 2` shows for that single frame and then
 * never again — hence `c > gone`, not `>=`.
 */
export function balloonFace(
  set: BalloonCheckpoints, openFrames: number, closeFrames: number | null,
): { cel: number; glyph: boolean } | null {
  if (closeFrames != null) {
    const c = set.hold + Math.floor(closeFrames / BALLOON_UNIT_FRAMES);
    if (c > set.gone) return null;
    return { cel: c >> 2, glyph: false };
  }
  const c = set.start + Math.floor(openFrames / BALLOON_UNIT_FRAMES);
  if (c < set.hold) return { cel: c >> 2, glyph: false };
  return { cel: set.hold >> 2, glyph: true };
}

/** The balloon's screen row: `groundScreenY - (owner.height >> 8) - 0x1b`. */
export function balloonAnchorY(
  groundScreenY: number, motion: SubmarimonMotion | null | undefined,
): number {
  return groundScreenY - submarimonLiftPixels(motion) - BALLOON_ANCHOR_LIFT;
}
