// The battle effect system's flat sprite: the per-tick CHANNEL-RECORD stepper and
// the screen draw. This is a port of the original pro/fightstg routines, read from
// the disc:
//   FIGHTSTG_F0x800893dc   fightstg.s L6448  the per-tick channel-record stepper
//   FIGHTSTG_F0x8008921c   fightstg.s L6333  the screen/world sprite draw
//   FIGHTSTG_F0x8008966c   fightstg.s L6615  the sprite builder (the object the two
//                                             above read; position + clip refs)
//   F0x8001f648 (fns)                        the 0xa0 stack draw-context fill it calls
//
// Why this is a shared system and not one effect's data: every op3 effect spawn
// (F0x8008bc80) makes one of these sprite objects per program sub-record, and the
// same stepper and the same draw run all of them. The browser's renderer used to
// hand-write this mechanism inside web/fight/effect-player.js (`step`'s per-frame
// masked-channel loop and `renderList`'s position/scale/rotation resolution); this
// module is the port, and tests/engine/unit/battle-effects-oracle.test.ts runs the
// ORIGINAL instruction words through engine/native and compares them to it.
//
// WHAT THE ORIGINAL DOES.
//
// The sprite object (0x90 bytes, built by F0x8008966c) carries:
//   +0x0c state      0 = unparsed, 1 = running, 2 = landed, 3 = finished
//   +0x50 record cursor   a pointer advanced halfword by halfword
//   +0x54 x  +0x56 y  +0x58 z   the spawn point (see the draw's sentinels)
//   +0x5c clip id     +0x60/+0x64 the clip record's two words (the draw's origin)
//   +0x68 a registry key handed to the draw-callback lookup
//   +0x6c frame accumulator   +0x70 channel mask   +0x74 stride   +0x78 duration
//   +0x7c..+0x8c the nine channels:
//        0 frame/clip id   1 CLUT shift   2 dx   3 dy   4 scaleX   5 scaleY
//        6 rotX   7 rotY   8 rotZ          (the RotMatrix tip/turn/spin, 4096 = 360)
//
// STEPPER (F0x800893dc): state 0 reads three header halfwords {mask, stride,
// duration} then nine default halfwords into +0x7c..+0x8c, calls the object's own
// +0x38 advance entry and FALLS THROUGH into state 1 in the same call. State 1
// picks the frame row at `frame*stride` and overwrites only the mask-selected
// channels in channel order, then adds the global delta ([0x800a4464]) to `frame`;
// once `frame >= duration` it calls the object's +0x28 entry with 2 and ends. State
// 2 only calls +0x38; state 3 returns. One row per call — a delta above 1 SKIPS a
// row, it does not replay the frames it stepped over.
//
// DRAW (F0x8008921c): builds the 0xa0 stack draw-context (F0x8001f648), resolves
// the draw point (z == 0x7fff or z == -1 is SCREEN space: x,y verbatim and an
// ordering-table depth of 0 or 0xfff respectively; anything else is projected
// through the runtime cell [0x800a454c]), adds dx/dy, then makes the context's
// calls in order — depth, origin, scale (skipped only when both scales are exactly
// 0x1000), CLUT shift (skipped when zero), rotation (called when either the
// tip/turn word or the spin is nonzero), position, then the resolved clip.
//
// This module is DOM-free (testable in node); the host owns images, canvas and
// projection. It does NOT model the display-list bytecode loop F0x80085110 or the
// effect object family driver F0x80089cd8.

import { mvmva, ncs, type Mat3, type Vec3 } from "./gte-math.ts";

/** The nine channels, in the disc's channel order (+0x7c .. +0x8c). */
export const EFFECT_CHANNEL_COUNT = 9;
export const EFFECT_CH_FRAME = 0;
export const EFFECT_CH_CLUT = 1;
export const EFFECT_CH_DX = 2;
export const EFFECT_CH_DY = 3;
export const EFFECT_CH_SCALE_X = 4;
export const EFFECT_CH_SCALE_Y = 5;
export const EFFECT_CH_ROT_X = 6;
export const EFFECT_CH_ROT_Y = 7;
export const EFFECT_CH_ROT_Z = 8;

/** 0x1000 = 1.0 in PS1 fixed point; both scales at 1.0 skip the context's setScale. */
export const EFFECT_SCALE_ONE = 0x1000;
/** The two spawn-z sentinels that select screen space (F0x8008921c @0x80089238/0x80089244). */
export const EFFECT_SCREEN_Z_NEAR = 0x7fff;
export const EFFECT_SCREEN_Z_FAR = -1;
/** The ordering-table depth the draw stores for each sentinel (@0x8008929c / @0x80089298). */
export const EFFECT_DEPTH_NEAR = 0;
export const EFFECT_DEPTH_FAR = 0xfff;

const s16 = (v: number): number => (v << 16) >> 16;

/** A halfword record stream, as it sits in the program bin: header, 9 defaults, then rows. */
export interface EffectRecordStream {
  mask: number;
  stride: number;
  duration: number;
  defaults: number[];
  data: number[];
}

/**
 * Read the record header the way state 0 does (F0x800893dc @0x80089418-0x80089480):
 * mask, stride, duration, then nine default channel halfwords. `words` is the raw
 * halfword stream; `at` is the halfword index of the first header word. Returns the
 * parsed record and the cursor left after the defaults.
 */
export function readEffectRecord(words: readonly number[], at = 0): { record: EffectRecordStream; next: number } {
  const mask = words[at] ?? 0;
  const stride = words[at + 1] ?? 0;
  const duration = words[at + 2] ?? 0;
  const defaults: number[] = [];
  for (let i = 0; i < EFFECT_CHANNEL_COUNT; i++) defaults.push(words[at + 3 + i] ?? 0);
  return { record: { mask, stride, duration, defaults, data: words as unknown as number[] }, next: at + 3 + EFFECT_CHANNEL_COUNT };
}

/** Flatten a parsed manifest record into the disc's halfword stream. */
export function effectStreamFromRecord(rec: {
  mask: number; stride: number; duration: number; defaults: number[]; frames: number[][];
}): number[] {
  const out = [rec.mask, rec.stride, rec.duration, ...rec.defaults];
  // Each frame row carries exactly `stride` masked-channel values, in channel order.
  for (const row of rec.frames) {
    for (let c = 0; c < rec.stride; c++) out.push(row[c] ?? 0);
  }
  return out;
}

/**
 * A live sprite (the 0x90-byte object F0x8008966c builds). The oracle seeds the
 * original's memory with the same fields and drives both from one stream.
 */
export interface EffectSprite {
  stream: readonly number[];
  cursor: number;        // +0x50: halfword index into `stream`
  /** The halfword index where the frame rows begin (the cursor after state 0's parse). */
  dataStart: number;
  state: number;         // +0x0c
  mask: number;          // +0x70
  stride: number;        // +0x74
  duration: number;      // +0x78
  frame: number;         // +0x6c
  chans: number[];       // +0x7c..+0x8c (nine)
  /** Count of the object's +0x38 advance-entry calls (observable in the oracle). */
  advanceCalls: number;
  /** Count of the object's +0x28 end-entry calls, always with argument 2. */
  endCalls: number;
}

/** Create a pre-tick sprite (state 0) over a raw record stream. */
export function newEffectSprite(stream: readonly number[], cursors: { cursor?: number } = {}): EffectSprite {
  return {
    stream, cursor: cursors.cursor ?? 0, dataStart: 0, state: 0,
    mask: 0, stride: 0, duration: 0, frame: 0,
    chans: new Array(EFFECT_CHANNEL_COUNT).fill(0),
    advanceCalls: 0, endCalls: 0,
  };
}

/**
 * FIGHTSTG_F0x800893dc: one call of the per-tick stepper, the exact state machine
 * including the state-0 fall-through. Mutates `sprite`. Returns true while the
 * object can still step (state < 2); false once it has landed (state 2) or finished.
 */
export function stepEffectSprite(sprite: EffectSprite, delta: number): boolean {
  if (sprite.state >= 3) return false;

  if (sprite.state === 0) {
    let c = sprite.cursor;
    sprite.mask = sprite.stream[c++] ?? 0;
    sprite.stride = sprite.stream[c++] ?? 0;
    sprite.duration = sprite.stream[c++] ?? 0;
    for (let i = 0; i < EFFECT_CHANNEL_COUNT; i++) sprite.chans[i] = sprite.stream[c++] ?? 0;
    sprite.cursor = c;
    sprite.dataStart = c;              // the frame rows start where the cursor now sits
    sprite.advanceCalls++;             // the +0x38 entry (@0x8008947c), which sets state 1
    sprite.state = 1;                  // then falls through into state 1
  }

  if (sprite.state === 2) {
    sprite.advanceCalls++;             // state 2 only calls +0x38 (@0x8008964c), which sets state 3
    sprite.state = 3;
    return false;
  }

  // state 1: the row index is relative to the post-header cursor (@0x80089484-0x800894a4)
  const row = sprite.dataStart + (sprite.frame | 0) * (sprite.stride | 0);
  let k = 0;
  for (let ch = 0; ch < EFFECT_CHANNEL_COUNT; ch++) {
    if (sprite.mask & (1 << ch)) sprite.chans[ch] = sprite.stream[row + k++] ?? 0;
  }
  sprite.frame = (sprite.frame | 0) + (delta | 0);
  if (sprite.frame >= sprite.duration) {
    sprite.endCalls++;                 // the +0x28 entry with 2 (@0x8008963c), which sets state 2
    sprite.state = 2;
    return false;
  }
  return true;
}

/**
 * The stepper's draw-callback gate (@0x800895bc-0x8008960c): when BOTH scales are
 * nonzero the sprite asks the registry getter for its key (+0x68) and hands it the
 * draw entry F0x8008921c. Returns whether that call fires.
 */
export function effectScaleArmed(chans: readonly number[]): boolean {
  return s16(chans[EFFECT_CH_SCALE_X] ?? 0) !== 0 && s16(chans[EFFECT_CH_SCALE_Y] ?? 0) !== 0;
}

/** The three position halfwords a sprite holds, and where a world draw sends them. */
export interface EffectDrawInstance {
  pos: { x: number; y: number; z: number };
  chans: readonly number[];   // nine channels (+0x7c..+0x8c)
  clipRefA: number;           // +0x60
  clipRefB: number;           // +0x64
  clipId: number;             // +0x5c
}

export interface EffectDrawPlan {
  /** True when z was one of the two screen sentinels, so no projection ran. */
  screen: boolean;
  /** The value the draw hands the context's depth call (screen: 0/0xfff; world: projected z). */
  depth: number;
  x: number;                  // final draw x, after dx
  y: number;                  // final draw y, after dy
  scale: { x: number; y: number } | null;    // null = both 0x1000, setScale skipped
  clut: number;               // 0 = skipped
  rotation: { x: number; y: number; z: number } | null;  // null = all three zero
  clipRefA: number;
  clipRefB: number;
  clipId: number;
  frame: number;              // channel 0
}

/**
 * FIGHTSTG_F0x8008921c: resolve the draw point and the context calls it makes, in
 * order, without executing anything. `project` is the runtime cell [0x800a454c];
 * it is required for a world-space point and ignored for a screen point.
 */
export function effectDrawPlan(
  inst: EffectDrawInstance,
  project?: (pos: { x: number; y: number; z: number }) => { x: number; y: number; z: number },
): EffectDrawPlan {
  const ch = inst.chans;
  const z = s16(inst.pos.z);
  const screen = z === EFFECT_SCREEN_Z_NEAR || z === EFFECT_SCREEN_Z_FAR;

  let x: number, y: number, depth: number;
  if (screen) {
    x = inst.pos.x | 0;
    y = inst.pos.y | 0;
    depth = z === EFFECT_SCREEN_Z_NEAR ? EFFECT_DEPTH_NEAR : EFFECT_DEPTH_FAR;
  } else {
    const p = project ? project(inst.pos) : { x: 0, y: 0, z: 0 };
    x = p.x | 0; y = p.y | 0; depth = s16(p.z);
  }
  // dx/dy are added as 16-bit unsigned words then read back signed (@0x800892a0-0x800892c8).
  x = s16(x + (ch[EFFECT_CH_DX]! | 0));
  y = s16(y + (ch[EFFECT_CH_DY]! | 0));

  const sx = s16(ch[EFFECT_CH_SCALE_X] ?? 0);
  const sy = s16(ch[EFFECT_CH_SCALE_Y] ?? 0);
  const scale = sx === EFFECT_SCALE_ONE && sy === EFFECT_SCALE_ONE ? null : { x: sx, y: sy };

  const clut = s16(ch[EFFECT_CH_CLUT] ?? 0);

  const rotWord = ((ch[EFFECT_CH_ROT_Y] ?? 0) << 16) | ((ch[EFFECT_CH_ROT_X] ?? 0) & 0xffff);
  const rot = (rotWord | 0) !== 0 || s16(ch[EFFECT_CH_ROT_Z] ?? 0) !== 0
    ? { x: s16(ch[EFFECT_CH_ROT_X] ?? 0), y: s16(ch[EFFECT_CH_ROT_Y] ?? 0), z: s16(ch[EFFECT_CH_ROT_Z] ?? 0) }
    : null;

  return {
    screen, depth, x, y, scale, clut, rotation: rot,
    clipRefA: inst.clipRefA | 0, clipRefB: inst.clipRefB | 0, clipId: inst.clipId | 0,
    frame: s16(ch[EFFECT_CH_FRAME] ?? 0),
  };
}

/** One call the draw makes on its stack draw-context, in order. */
export interface EffectDrawOp {
  method: string;
  args: number[];
}

/**
 * The ordered context calls `effectDrawPlan` implies, matching the recorded method
 * stream the draw-context stubs capture. `resolvedClip` is the pointer the clip
 * resolver [0x80044f5c] returned for `plan.clipId` (the oracle passes the stub's
 * 0x801e0000; the browser passes nothing and ignores this op).
 */
export function effectDrawOps(plan: EffectDrawPlan, resolvedClip = 0): EffectDrawOp[] {
  const ops: EffectDrawOp[] = [
    { method: "m_0x80", args: [plan.depth] },
    { method: "setOrigin", args: [plan.clipRefA, plan.clipRefB] },
  ];
  if (plan.scale) ops.push({ method: "setScale", args: [plan.scale.x, plan.scale.y, 0] });
  if (plan.clut) ops.push({ method: "m_0x88", args: [plan.clut] });
  if (plan.rotation) ops.push({ method: "m_0x90", args: [plan.rotation.x, plan.rotation.y, plan.rotation.z] });
  ops.push({ method: "setPos", args: [plan.x, plan.y] });
  ops.push({ method: "drawSprite", args: [resolvedClip, plan.frame, plan.x, plan.y] });
  return ops;
}

// ── the effect-mesh colour path (FIGHTSTG_F0x800847f4) ──────────────────────
//
// Every node the display-list interpreter draws runs this once before the bytecode
// loop (FIGHTSTG_F0x80085110 @0x800852d8). It turns the node's normal records into
// the per-normal colour words the mesh arm later copies into its packets
// (node+0x80, read at 0x8008566c-0x80085680). Read from the overlay assembly,
// fightstg.s L1777-1925, never the lifted C.
//
//   * The light matrix (control $8-$12, LLM) is the node's own rotation at
//     node+0x84 composed with the resident RT constant at 0x800812f8: three MVMVA
//     passes (c2 0x49e012, sf=1 mx=0 v=3 cv=3 lm=0), one per column, written to the
//     stack and copied back into control $8-$12 (L1795-L1885).
//   * A fourth MVMVA (c2 0x480012, sf=0 cv=3) runs the node's translation at
//     node+0x98 through the same RT with the constant TR (L1858-L1875); its MAC1-3
//     go to sp+0x24 and are not consumed by the shading below.
//   * node+0x80 is allocated (count*4) then each 6-byte normal record at node+0x64
//     is run through NCS (c2 0xc8041e, sf=1 lm=1) and its RGB2 (`swc2 $22`) stored
//     as one 32-bit word (L1886-L1924).
//
// WHAT THE LIVE CAPTURE LETS US CLAIM. The 2026-10-06 capture could not read the
// coprocessor register file (BizHawk exposes only GPRs), so it recorded the exact
// GPRs the routine moves into and out of COP2. That fixes the operand order, the
// three-pass composition and the NCS command word, and it pins the three MVMVA
// passes' own GPR results. It does NOT capture the colour matrix LCM (control
// $16-$20), the background BK, or RGBC (control $6) that NCS also reads, so the
// final packed grey cannot be independently recomputed from the captured normal —
// only the MVMVA composition can be (see the colour-path oracle). The RGB2 code
// byte 0x20 is the observed value, not a derived one.

/** The resident rotation/translation constant the colour path loads (0x800812f8),
 *  in the psx-spx RT/TR register layout. */
export interface EffectMeshColourConstant {
  /** RT (control $0-$4), 9 s16 row-major. */
  readonly rt: Mat3;
  /** TR (control $5-$7), 3 s32. */
  readonly tr: Vec3;
}

export interface EffectMeshColourInput {
  /** node+0x84 — the node's 9 s16 rotation, row-major (column j read per pass). */
  readonly matrix: Mat3;
  /** node+0x98 — the node's translation SVECTOR. */
  readonly translation: Vec3;
  /** The 0x800812f8 constant. */
  readonly constant: EffectMeshColourConstant;
  /** node+0x64 — the normal records (count already resolved to the list). */
  readonly normals: readonly Vec3[];
  /** The colour matrix (control $16-$20) NCS reads. The capture did not record it. */
  readonly lcm: Mat3;
  /** The background (BK) NCS adds. The capture did not record it. */
  readonly bk: Vec3;
  /** RGBC (control $6) NCS scales the result by. The capture did not record it. */
  readonly rgbc: number;
}

export interface EffectMeshColourResult {
  /** The composed light matrix, control $8-$12 (9 s16). */
  readonly light: Mat3;
  /** The translation MVMVA MAC1-3 (sp+0x24). */
  readonly translationMac: Vec3;
  /** One packed colour word per normal (node+0x80[i] = RGB2). */
  readonly colours: number[];
}

/** The RGB2 code byte the captured colour words carry (0x20______). */
export const EFFECT_MESH_RGB_CODE = 0x20;

/**
 * The three MVMVA passes that compose the node's rotation (node+0x84) with the
 * constant RT — the light matrix the NCS pass then uses. Column j is read at
 * node+0x84+2j/+2j+6/+2j+12 (row-major), transformed, and stored back as column j.
 */
export function buildEffectMeshLight(
  constant: EffectMeshColourConstant,
  matrix: Mat3,
): Mat3 {
  const out = new Array<number>(9).fill(0);
  for (let j = 0; j < 3; j++) {
    const col: Vec3 = { x: s16(matrix[j]!), y: s16(matrix[j + 3]!), z: s16(matrix[j + 6]!) };
    const r = mvmva(constant.rt, col, null, 1, 0);
    out[j] = s16(r.ir1);
    out[j + 3] = s16(r.ir2);
    out[j + 6] = s16(r.ir3);
  }
  return out;
}

/**
 * FIGHTSTG_F0x800847f4 — the whole colour path: compose the light matrix, run the
 * translation MVMVA, then NCS-shade each normal record into one packed colour word.
 */
export function buildEffectMeshColours(input: EffectMeshColourInput): EffectMeshColourResult {
  const light = buildEffectMeshLight(input.constant, input.matrix);
  const t = mvmva(input.constant.rt, input.translation, input.constant.tr, 1, 0);
  const colours: number[] = [];
  for (const n of input.normals) {
    const c = ncs(light, n, input.lcm, input.bk, input.rgbc, 1, 1);
    colours.push((((EFFECT_MESH_RGB_CODE << 24) | (c.b << 16) | (c.g << 8) | c.r) | 0));
  }
  return { light, translationMac: { x: t.mac1, y: t.mac2, z: t.mac3 }, colours };
}
