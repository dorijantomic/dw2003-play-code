// The battle scenery/effect class's tint feed — the one FIGHTSTG routine that
// sets the arena view's clear colour during a signature effect.
//
// This is a port of one original pro/fightstg routine, read from the disc:
//   FIGHTSTG_F0x800861f4   fightstg.norm.s L3477-L3544  the effect-tint feed
//
// WHY THIS IS A SHARED SYSTEM. The fight screen's clear colour is a view colour,
// not place data: a normal battle sets it black (wfightmn.s:2110 calls view+0x12C
// with 0,0,0), and the only other FIGHTSTG writer of that colour is this routine
// (docs/research/battle/battle-stage-backdrop-decode-2026-10-04.md §2). Both of
// its callers are inside FIGHTSTG_F0x80086304, the motion/effect-pack rebuild. So
// the arena's colour during a signature is the effect object's own element colour,
// fed to the view here; there is no per-battle colour table.
//
// WHAT THE ORIGINAL DOES.
//   F0x800861f4(obj, holder):
//     - build two pose passes through [0x800a46a0], the shared pose routine:
//         (obj+0xb4, obj+0xbc, w[obj+0xa4], obj+0xc4)
//         (obj+0xcc, obj+0xd4, w[obj+0xa4], obj+0xdc)
//     - submit a three-byte descriptor (bytes obj+0xc4, +0xc6, +0xc8) to the
//       owner object w[holder] through its +0x262c method, selector 1;
//     - take the arena view *(0x8004df8c)(0x1000) and set its colour through
//       view+0x12c. The colour is (byte +0xdc, +0xde, +0xe0) when the word at
//       +0xdc is non-zero, or the signed halfword at +0xe0 is non-zero; otherwise
//       it is (1,1,1) white.
//
// The oracle tests/engine/unit/battle-effect-tint-oracle.test.ts runs the original
// words out of the committed fightstg overlay through engine/native, stubbing the
// pose routine, the owner submit, the view lookup and the view colour setter, and
// checks every argument the routine passes, with negative controls.

/** The fallback colour when the effect object carries none (asm `li $a1,1`). */
export const EFFECT_TINT_DEFAULT = 1;
/** The arena view id the feed looks up (asm `li $a0, 0x1000`). */
export const ARENA_VIEW_ID = 0x1000;

/** A view over the effect object's pose/colour words, addressed absolutely. */
export interface EffectFeedObject {
  /** The object's base address; the pose passes receive base-relative addresses. */
  readonly base: number;
  /** The 32-bit word at obj+off. */
  readWord(off: number): number;
  /** The byte at obj+off. */
  readByte(off: number): number;
  /** The 32-bit word at an absolute address (the owner pointer at w[holder]). */
  readCell(addr: number): number;
}

/** The sink the feed drives: the pose routine, the owner submit, and the view. */
export interface EffectTintFeedSink {
  /** [0x800a46a0]: (dst0, dst1, src, dst2) -> void. */
  pose(dst0: number, dst1: number, src: number, dst2: number): void;
  /** w[holder]+0x262c: submit (selector, 3-byte descriptor). */
  submit(target: number, selector: number, rgb: readonly [number, number, number]): void;
  /** *(0x8004df8c)(id): resolve the view object. */
  view(id: number): { setTint(r: number, g: number, b: number): void };
}

/**
 * The colour the feed writes, isolated so an oracle can grid it: the object's own
 * bytes when the word at +0xdc is non-zero or the signed halfword at +0xe0 is
 * non-zero, else the (1,1,1) default. Matches asm L3608-L3628.
 */
export function effectTintColour(obj: EffectFeedObject): [number, number, number] {
  const wordDC = obj.readWord(0xdc) | 0; // lw 0xdc
  if (wordDC !== 0) return [obj.readByte(0xdc), obj.readByte(0xde), obj.readByte(0xe0)];
  const halfE0 = (obj.readWord(0xe0) << 16) >> 16; // lh 0xe0 (signed)
  if (halfE0 !== 0) return [obj.readByte(0xdc), obj.readByte(0xde), obj.readByte(0xe0)];
  return [EFFECT_TINT_DEFAULT, EFFECT_TINT_DEFAULT, EFFECT_TINT_DEFAULT];
}

/**
 * FIGHTSTG_F0x800861f4: build the two pose passes, submit the colour descriptor,
 * and set the arena view's tint. `holder` is the pointer the original loads the
 * owner object from (w[holder] is the submit target).
 */
export function effectTintFeed(obj: EffectFeedObject, holder: number, sink: EffectTintFeedSink): void {
  const src = obj.readWord(0xa4) | 0;
  sink.pose(obj.base + 0xb4, obj.base + 0xbc, src, obj.base + 0xc4);
  const desc: [number, number, number] = [obj.readByte(0xc4), obj.readByte(0xc6), obj.readByte(0xc8)];
  const owner = obj.readCell(holder) | 0; // lw (s1)
  sink.submit(owner, 1, desc);
  sink.pose(obj.base + 0xcc, obj.base + 0xd4, src, obj.base + 0xdc);
  const [r, g, b] = effectTintColour(obj);
  sink.view(ARENA_VIEW_ID).setTint(r, g, b);
}
