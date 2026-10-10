// The battle HUD's cel draw — the picture routine FIGHTSTG_F0x80093fec, ported from
// pro/fightstg.s:17725-17755.
//
// This is the face-box bezel: the browser renderer re-implements it as
// `hudClip(0x0a, 246, 74)` at web/battle.js:7527 (the PGFGTC00 cel 0xA drawn around the
// 100x60 portrait window), which is exactly the draw this routine builds. The routine
// is the reference the browser's `hudClip`/`drawClip` path stands in for.
//
// The original's own words (fightstg.s):
//
//   F0x80093fec:
//     .L0x80093ff4  jal F0x8001f648 ; a0 = sp+0x10        build the 0xA0 draw context on the stack
//     .L0x80093ffc  li a0, 0x1005 ; v0 = lw 0x8c(sp) ; jalr v0   ctx+0x7c(sheet)=0x1005, the battle UI layer
//     .L0x80094010  li a0, 0x200  ; v0 = lw 0x84(sp) ; jalr v0   ctx+0x74(origin)=0x200, the CLUT/tex origin
//     .L0x80094024  v0 = [0x80044f5c](0x455)                     pack-get-entry -> PGFGTC00 base
//     .L0x80094038  a0 = pack ; a1 = 0xa ; a2 = 0xf6 ; a3 = 0x4a
//     .L0x80094044  v0 = lw 0x94(sp) ; jalr v0                   ctx+0x84(draw)= (pack, cel 0xA, x 246, y 74)
//
// The draw context is 0x10 above the object slots, so sp+0x8c is object +0x7c, sp+0x84 is
// +0x74 and sp+0x94 is +0x84 (docs/research/battle/battle-invocation.md; the same map
// engine/native/stubs.ts DRAW_CTX_METHODS uses). The picture call is authority-2 renderer
// F0x8001ed6c(sheet, id, x, y) — the ledger claim `EV-BATTLE-Q001-93fec-cel-a-2026-08-20`
// already pins the cel id 0xA and the placement (246, 74).
//
// The routine's own output is therefore a DRAW REQUEST — which layer, which CLUT origin,
// which pack, which cel, where — and the picture method under it is a service. This module
// ports the request, which is the part the browser stands in for.

/** ctx+0x7c (sp+0x8c) bind: the battle UI layer 0x1005. */
export const CEL_DRAW_LAYER = 0x1005;
/** ctx+0x74 (sp+0x84) origin: the 0x200 CLUT/texture origin the routine installs first. */
export const CEL_DRAW_ORIGIN = 0x200;
/** The pack-get-entry word `0x04550000`'s high half: PGFGTC00, the battle chrome pack. */
export const FACE_BEZEL_PACK = 0x455;
/** The cel the bezel draws, `li a1, 0xa`. */
export const FACE_BEZEL_CEL = 0x0a;
/** `li a2, 0xf6` — the bezel's x, 246. */
export const FACE_BEZEL_X = 0xf6;
/** `li a3, 0x4a` — the bezel's y, 74. */
export const FACE_BEZEL_Y = 0x4a;

export interface CelDraw {
  /** The layer the draw context is bound to (ctx+0x7c). */
  layer: number;
  /** The CLUT/texture origin installed before the picture (ctx+0x74). */
  origin: number;
  /** The pack base the picture is drawn from (here PGFGTC00, 0x455). */
  pack: number;
  /** The cel id inside the pack. */
  cel: number;
  /** Screen x of the cel's origin. */
  x: number;
  /** Screen y of the cel's origin. */
  y: number;
}

/** The exact arguments F0x80093fec hands the draw-context picture method. */
export function faceBezelCelDraw(): CelDraw {
  return {
    layer: CEL_DRAW_LAYER,
    origin: CEL_DRAW_ORIGIN,
    pack: FACE_BEZEL_PACK,
    cel: FACE_BEZEL_CEL,
    x: FACE_BEZEL_X,
    y: FACE_BEZEL_Y,
  };
}
