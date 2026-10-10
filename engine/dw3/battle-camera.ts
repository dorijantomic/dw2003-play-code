// The battle camera's look-at (F0x8002a1ac) and the close-up face box's camera
// worker family (FIGHTSTG_F0x80091b8c / F0x80091c1c / F0x80091cf4 / F0x80091dac).
//
// These are the shared systems of the original, so they are ported once here and
// the browser adapter (web/fight/battle-camera.js) consumes them, as the
// slot-motion controller is consumed from engine/dw3/battle-slot-motion.ts.
//
// Ported from the DISASSEMBLY, not the lifted C: every routine below drives the
// GTE (COP2) and the lifted C replaces each coprocessor word with
// `M2C_ERROR(/* unknown instruction: ... */)`. The sub-routines the view builder
// calls (the resident libgte helpers) are ported here too, over the same
// arithmetic engine/dw3/gte-math.ts already provides for the mesh chain.
//
//   F0x8002a1ac  lookAtView      the world->view builder (a standard look-at with
//                                an optional roll and an optional anchor frame)
//   F0x80091c1c  faceBoxShotRead the close-up shot read out of the fighter record
//   F0x80091b8c  faceBoxLookAt   the close-up worker's per-tick view build + H handoff
//   F0x80091cf4  faceBoxTick     the close-up worker's tick (its own state machine)
//   F0x80091dac  faceBoxSpawn    the close-up worker's allocation
//
// The oracle in tests/engine/unit/battle-camera-oracle.test.ts runs the ORIGINAL
// instruction words out of the committed images
// web/assets/native/screens/resident.bin (base 0x80010000, the resident exe code)
// and web/assets/native/screens/pro_fightstg.bin (base 0x80082cb0, the fight
// overlay) through engine/native and compares every observable.
//
// See docs/research/fight-3d/battle-camera.md for the reading; the arithmetic
// below follows the store sites in exe/fns.s and pro/fightstg.s named per helper.

import { mvmva, s16, type Vec3 } from "./gte-math.ts";

/** A PS1 MATRIX: 9 row-major signed-16 rotation elements + a 32-bit translation. */
export interface Ps1Matrix {
  /** m11,m12,m13,m21,m22,m23,m31,m32,m33 (row-major), signed 16. */
  readonly rot: readonly number[];
  /** The 32-bit translation at +0x14/+0x18/+0x1c. */
  readonly tr: readonly [number, number, number];
}

export interface ViewBuild {
  /** The view matrix the builder published (D0x80081338). */
  readonly view: Ps1Matrix;
  /** 0 on success, 1 when the eye and target coincide (the original's return). */
  readonly code: number;
}

// ── resident libgte integer helpers the view builder drives ────────────────

/** Signed 16-bit. */
const i16 = (v: number): number => ((v << 16) >> 16);
/** Signed 32-bit wrap. */
const i32 = (v: number): number => v | 0;

/**
 * F0x8002a668 — the largest absolute value among the six words (the overflow
 * normalizer's probe). Read at exe/fns.s:28952.
 */
function maxAbs6(a: readonly number[]): number {
  let m = Math.abs(a[0]!);
  for (let i = 1; i < 6; i++) m = Math.max(m, Math.abs(a[i]!));
  return m;
}

/**
 * F0x8002a730 — the bit length: the count of `>>1` steps to reach zero (0 for a
 * non-positive input). Read at exe/fns.s:29006.
 */
function bitLength(v: number): number {
  let a = v | 0;
  if (a <= 0) return 0;
  let n = 0;
  do { a >>= 1; n++; } while (a > 0);
  return n;
}

/**
 * The resident square-root table at D0x800568a8: `floor(4096 * sqrt(1 + i/64))`.
 * The oracle asserts it reproduces the committed image's own halfwords (the
 * formula holds for all 0xC0 entries the routine can reach).
 */
export const SQRT_TABLE: readonly number[] = (() => {
  const t = new Array<number>(0xc0);
  for (let i = 0; i < 0xc0; i++) t[i] = Math.floor(4096 * Math.sqrt(1 + i / 64));
  return t;
})();

/**
 * F0x8002adcc — the integer square root, driven by the GTE leading-zero-count
 * registers. Read at exe/fns.s:29462. The GTE's LZCS (ctrl 30) / LZCR (ctrl 31)
 * give the leading zeros of a non-negative word (leading ones of a negative one);
 * the routine folds the result into [0x40, 0x100) and reads SQRT_TABLE.
 */
export function gteSqrt(v: number): number {
  const x = v | 0;
  if (x === 0) return 0; // the `LZCR == 0x20` early return
  // LZCR: leading zeros when the word is non-negative, leading ones when it is not.
  const lz = x > 0 ? Math.clz32(x) : Math.clz32(~x);
  const t2 = lz & ~1;
  const t1 = (0x1f - t2) >> 1;
  const t4 = t2 - 0x18 >= 0 ? i32(x << (t2 - 0x18)) : x >> (0x18 - t2);
  const idx = t4 - 0x40;
  const val = SQRT_TABLE[idx] as number;
  return (val << t1) >>> 0xc;
}

/**
 * The resident sin table the angle helpers read (D0x80056088 and its three
 * quadrant neighbours): `round(sin(2*pi*i/4096) * 0x1000)`, i in 0..0xfff. The
 * oracle asserts it reproduces the committed image's table exactly.
 */
export const SIN_TABLE: readonly number[] = (() => {
  const t = new Array<number>(0x1000);
  const rnd = (x: number): number => (x >= 0 ? Math.floor(x + 0.5) : -Math.ceil(-x - 0.5));
  for (let i = 0; i < 0x1000; i++) t[i] = rnd(Math.sin((2 * Math.PI * i) / 0x1000) * 0x1000);
  return t;
})();

/**
 * F0x8002ac9c — the cosine over the 4096-unit turn (even: the sign of the angle
 * is dropped). Read at exe/fns.s:29378.
 */
export function cosInt(angle: number): number {
  return SIN_TABLE[(angle + 0x400) & 0xfff] as number;
}

/**
 * F0x8002abcc — the sine over the 4096-unit turn (odd: the result takes the
 * angle's sign). Read at exe/fns.s:29318.
 */
export function sinInt(angle: number): number {
  return SIN_TABLE[angle & 0xfff] as number;
}

/**
 * F0x8002a0dc — build a rotation matrix from a precomputed sine and cosine along
 * one axis, starting from the identity the resident D0x80081378 holds. Read at
 * exe/fns.s:28573. `axis` is the libgte axis code (0x78 = X, 0x79 = Y, 0x7a = Z;
 * the +0x20 variants select the same bodies).
 */
export function rotAxisMatrix(sin: number, cos: number, axis: number): number[] {
  const m = [0x1000, 0, 0, 0, 0x1000, 0, 0, 0, 0x1000];
  const sVal = s16(sin);
  const cVal = s16(cos);
  switch (axis) {
    case 0x78: case 0x98:
      m[4] = cVal; m[8] = cVal; m[5] = -sVal; m[7] = sVal;
      return m;
    case 0x79: case 0x99:
      m[0] = cVal; m[8] = cVal; m[2] = sVal; m[6] = -sVal;
      return m;
    case 0x7a: case 0x9a:
      m[0] = cVal; m[4] = cVal; m[1] = -sVal; m[3] = sVal;
      return m;
    default:
      return m;
  }
}

/**
 * F0x8002afbc / F0x8002b0cc — MulMatrix, rotation only: `out = a * b`. Each
 * column of `b` is run through MVMVA against `a` (the same three passes the
 * layer builder runs); the matrix elements are the saturated IR words. Read at
 * exe/fns.s:29594 and :29666.
 */
export function mulMatrix(a: readonly number[], b: readonly number[]): number[] {
  const out = new Array<number>(9);
  for (let j = 0; j < 3; j++) {
    const col: Vec3 = { x: s16(b[j]!), y: s16(b[3 + j]!), z: s16(b[6 + j]!) };
    const r = mvmva(a, col, null, 1, 0);
    out[j] = s16(r.ir1);
    out[3 + j] = s16(r.ir2);
    out[6 + j] = s16(r.ir3);
  }
  return out;
}

/**
 * F0x8002ae5c — matrix x vector, rotation only. The original splits each 32-bit
 * component into a 15-bit low half and a high half so the GTE can multiply a
 * full 32-bit vector; the two passes are added as `mac_lo + 8*mac_hi`. Read at
 * exe/fns.s:29502.
 */
export function rotVecMul(m: readonly number[], v: readonly [number, number, number]): [number, number, number] {
  const hi: number[] = [];
  const lo: number[] = [];
  for (let k = 0; k < 3; k++) {
    const x = v[k]! | 0;
    if (x < 0) {
      hi[k] = -((-x) >> 15);
      lo[k] = -((-x) & 0x7fff);
    } else {
      hi[k] = x >> 15;
      lo[k] = x & 0x7fff;
    }
  }
  const out: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    let macHi = 0;
    let macLo = 0;
    for (let k = 0; k < 3; k++) {
      const e = s16(m[i * 3 + k]!);
      macHi = i32(macHi + e * hi[k]!);      // sf=0: no shift
      macLo = i32(macLo + e * lo[k]!);      // accumulated, shifted once below
    }
    out[i] = i32((macLo >> 12) + 8 * macHi);
  }
  return out;
}

/** F0x8002b41c — the rotation transpose (elements read back signed 16). Read at exe/fns.s:29910. */
export function transposeRot(m: readonly number[]): number[] {
  return [s16(m[0]!), s16(m[3]!), s16(m[6]!), s16(m[1]!), s16(m[4]!), s16(m[7]!), s16(m[2]!), s16(m[5]!), s16(m[8]!)];
}

/**
 * F0x8002a74c — the affine compose `m1 := m0 . m1`: `m1.rot = m0.rot * m1.rot`
 * (F0x8002b0cc) and `m1.tr = m0.rot * m1.tr + m0.tr`, with the translation
 * product taken before m1's rotation is overwritten. Read at exe/fns.s:29017.
 */
export function affineCompose(m0: Ps1Matrix, m1: Ps1Matrix): Ps1Matrix {
  const tr = rotVecMul(m0.rot, [m1.tr[0], m1.tr[1], m1.tr[2]]);
  const rot = mulMatrix(m0.rot, m1.rot);
  return {
    rot,
    tr: [i32(tr[0] + m0.tr[0]), i32(tr[1] + m0.tr[1]), i32(tr[2] + m0.tr[2])],
  };
}

/**
 * F0x8002a57c — the overflow normalizer: when the largest of the six eye/target
 * words needs more than 15 bits, all six are shifted right by the excess (a
 * uniform power-of-two downscale preserves direction). Read at exe/fns.s:28889.
 */
export function normalize6(a: readonly number[]): number[] {
  const bits = bitLength(maxAbs6(a));
  const shift = bits - 0xf;
  const out = new Array<number>(6);
  if (bits >= 0x10) for (let i = 0; i < 6; i++) out[i] = a[i]! >> shift;
  else for (let i = 0; i < 6; i++) out[i] = a[i]!;
  return out;
}

/**
 * F0x8002a7cc — pre-multiply a Z rotation by the roll, in degrees through the
 * original's own integer angle: `turns = arg1/360`, then the 4096-unit cos/sin
 * tables. Read at exe/fns.s:29053.
 */
export function applyRollZ(m: readonly number[], rollWord: number): number[] {
  if ((rollWord | 0) === 0) return [...m];
  const turns = Math.trunc(rollWord / 360) | 0;
  const c = cosInt(turns);
  const s = sinInt(turns);
  const rz = [c, -s, 0, s, c, 0, 0, 0, 0x1000];
  return mulMatrix(m, rz);
}

// ── F0x8002a1ac: the world->view builder ───────────────────────────────────

/** The 14-field op5 record / camera-struct eye-target-anchor layout, as the port reads it. */
export interface LookAtShot {
  /** +0x00: eye, relative to the anchor frame. */
  readonly eye: readonly [number, number, number];
  /** +0x0c: the point looked at, relative to the anchor frame. */
  readonly target: readonly [number, number, number];
  /** +0x18: the roll word (the op5 record shifts degrees left 12 before it lands here). */
  readonly roll?: number;
  /**
   * +0x1c: the shot's anchor frame (GsCOORDINATE2 world matrix), or null for an
   * absolute shot. When present the finished view is `V_local . W^-1`.
   */
  readonly coord?: Ps1Matrix | null;
}

/**
 * F0x8002a1ac — build the world->view matrix and publish it. Read at
 * exe/fns.s:28644.
 *
 * The eye and target are first normalised to 15 bits, then the pitch and yaw
 * that carry the eye to the target are built as elementary rotations
 * (F0x8002a0dc, axes 0x78/0x79) and multiplied onto the working matrix; the
 * translation is the negated eye rotated into place; and, when an anchor frame is
 * supplied, its rigid inverse is composed on. The roll word pre-multiplies a Z
 * rotation of the finished screen (F0x8002a7cc).
 *
 * Returns `code: 1` and no view when the eye and target coincide, exactly as the
 * original returns 1 without writing D0x80081338.
 */
export function lookAtView(shot: LookAtShot): ViewBuild {
  const roll = shot.roll ?? 0;
  let work = [0x1000, 0, 0, 0, 0x1000, 0, 0, 0, 0x1000];
  // D0x80081358 starts as the resident identity (D0x80081398, built by F0x800293e4),
  // then the roll pre-multiplies its own Z rotation.
  work = applyRollZ(work, -roll);

  const n = normalize6([
    shot.eye[0], shot.eye[1], shot.eye[2],
    shot.target[0], shot.target[1], shot.target[2],
  ]);
  const ex = n[0]!, ey = n[1]!, ez = n[2]!;
  const tx = n[3]!, ty = n[4]!, tz = n[5]!;

  const dx = tx - ex;
  const dy = ty - ey;
  const dz = tz - ez;
  const r = gteSqrt(i32(dx * dx + dy * dy + dz * dz));
  if (r === 0) return { view: { rot: work, tr: [0, 0, 0] }, code: 1 };

  const hd = gteSqrt(i32(dx * dx + dz * dz));
  // Pitch about X (axis 0x78): s16(-((ey-ty)<<12)/r), s16((hd<<12)/r).
  work = mulMatrix(work, rotAxisMatrix(s16(i32(Math.trunc(i32(-((ey - ty) << 12)) / r))), s16(i32(Math.trunc(i32(hd << 12) / r))), 0x78));
  if (hd !== 0) {
    // Yaw about Y (axis 0x79): s16(-((tx-ex)<<12)/hd), s16((tz-ez)<<12)/hd).
    work = mulMatrix(work, rotAxisMatrix(s16(i32(Math.trunc(i32(-(dx << 12)) / hd))), s16(i32(Math.trunc(i32(dz << 12) / hd))), 0x79));
  }

  // Translation: R * (-eye), using the UNScaled eye (F0x8002ae5c).
  const tr = rotVecMul(work, [-shot.eye[0], -shot.eye[1], -shot.eye[2]]);
  work = [...work];
  let view: Ps1Matrix = {
    rot: work,
    tr: [tr[0], tr[1], tr[2]],
  };

  if (shot.coord) {
    // V = V_local . W^-1: transpose the anchor rotation, negate the rotated anchor
    // into the inverse's translation, and compose.
    const rt = transposeRot(shot.coord.rot);
    const tinv = rotVecMul(rt, [shot.coord.tr[0], shot.coord.tr[1], shot.coord.tr[2]]);
    const winv: Ps1Matrix = {
      rot: rt,
      tr: [i32(-tinv[0]), i32(-tinv[1]), i32(-tinv[2])],
    };
    view = affineCompose(view, winv);
  }
  return { view, code: 0 };
}

/** A PS1 view matrix as a right-handed, column-major 4x4 (the renderer's convention). */
export function viewToColumnMajor(view: Ps1Matrix, scale = 1 / 0x1000): Float32Array {
  const r = view.rot;
  const t = view.tr;
  const m = new Float32Array(16);
  m[0] = s16(r[0]!) * scale; m[4] = s16(r[1]!) * scale; m[8] = s16(r[2]!) * scale;
  m[1] = s16(r[3]!) * scale; m[5] = s16(r[4]!) * scale; m[9] = s16(r[5]!) * scale;
  m[2] = s16(r[6]!) * scale; m[6] = s16(r[7]!) * scale; m[10] = s16(r[8]!) * scale;
  m[12] = t[0] * scale; m[13] = t[1] * scale; m[14] = t[2] * scale;
  m[15] = 1;
  return m;
}

// ── the close-up face box's camera worker (FIGHTSTG_F0x80091c1c + family) ───

/** The box's layer key: the rectangle service and the 3D picture request both use it. */
export const FACE_BOX_LAYER_KEY = 0x1009;
/** The two framings the fighter record carries: group 6 = player line, group 7 = enemy line. */
export const FACE_BOX_GROUPS = { player: 6, enemy: 7 } as const;

export interface FaceBoxShot {
  readonly eye: [number, number, number];
  readonly target: [number, number, number];
  readonly H: number;
  readonly group: number;
}

/**
 * F0x80091c1c — read the close-up shot out of a fighter's model record. Read at
 * pro/fightstg.s:15355.
 *
 * `group` is 6 when the fighter record's +0x18 flag is zero and 7 when it is not
 * (the speaker picks only which of the record's two framings is used). It reads
 * three vectors — eye at record+0x1A+6g, the point looked at at record+0x62+6g,
 * and H at record+0xAA+2g — as signed halfwords, negating the Y and Z of both
 * vectors; the angle triple at +0xCC and the offset triple at +0xD4 are zeroed.
 *
 * The record is the raw byte view the original addresses; a 0x48 record is three
 * shots long, so groups 6 and 7 read past its end into its neighbour, exactly as
 * the console does. `bytes` is the record block (a Uint8Array or number[]).
 */
export function faceBoxShotRead(record: ArrayLike<number> | null | undefined, side: "player" | "enemy"): FaceBoxShot | null {
  if (!record) return null;
  const group = side === "enemy" ? FACE_BOX_GROUPS.enemy : FACE_BOX_GROUPS.player;
  const lh = (off: number): number => {
    const lo = (record[off] ?? 0) & 0xff;
    const hi = (record[off + 1] ?? 0) & 0xff;
    return s16(lo | (hi << 8));
  };
  const eyeBase = 0x1a + 6 * group;
  const tgtBase = 0x62 + 6 * group;
  return {
    eye: [lh(eyeBase), -lh(eyeBase + 2), -lh(eyeBase + 4)],
    target: [lh(tgtBase), -lh(tgtBase + 2), -lh(tgtBase + 4)],
    H: lh(0xaa + 2 * group),
    group,
  };
}

/** One parsed shot row from the placement table (tools/extract_smdldata.py emits it). */
export interface FaceBoxRow {
  readonly group: number;
  readonly eye: readonly [number, number, number];
  readonly target: readonly [number, number, number];
  readonly H: number;
}

/**
 * The same shot rule against the PARSED placement rows the browser already has
 * (tools/extract_smdldata.py reproduces the console's own read, neighbours and
 * all, so a row's group is the group F0x80091c1c would select). One place owns
 * the group rule, so the browser adapter cannot pick a different group.
 */
export function faceBoxShotFromRows(rows: readonly FaceBoxRow[] | null | undefined, side: "player" | "enemy"): FaceBoxShot | null {
  const group = side === "enemy" ? FACE_BOX_GROUPS.enemy : FACE_BOX_GROUPS.player;
  const row = Array.isArray(rows) ? rows.find((r) => r && r.group === group) : null;
  if (!row || !row.eye || !row.target) return null;
  return { eye: [row.eye[0], row.eye[1], row.eye[2]], target: [row.target[0], row.target[1], row.target[2]], H: row.H, group: row.group };
}

/** What F0x80091b8c publishes: the view plus the projection distance handed to the layer. */
export interface FaceBoxViewBuild {
  readonly view: Ps1Matrix;
  readonly H: number;
  /** The layer key F0x80091b8c hands the H to (0x1009). */
  readonly layerKey: number;
}

/**
 * F0x80091b8c — build the close-up view from the shot read into the box object
 * and hand its H to the picture layer. Read at pro/fightstg.s:15316.
 *
 * It runs F0x8002b65c (RotMatrixYXZ) on the box's angle triple — which
 * F0x80091c1c zeroes and nothing else ever writes, so it is the identity — then
 * F0x8002a1ac on the stored eye/target. The offset triple is zeroed by the same
 * read, so the shot carries no anchor; the view is the ordinary look-at.
 */
export function faceBoxLookAt(shot: FaceBoxShot): FaceBoxViewBuild | null {
  const built = lookAtView({ eye: shot.eye, target: shot.target, roll: 0, coord: null });
  if (built.code !== 0) return null;
  return { view: built.view, H: shot.H, layerKey: FACE_BOX_LAYER_KEY };
}

/** The box worker object's own state, as F0x80091cf4 reads it. */
export interface FaceBoxWorker {
  /** +0x0c: the exe object's state field. */
  state: number;
  /** +0x14: the sub-state. */
  sub: number;
  /** +0x50: the fighter record index (the model key). */
  recordIndex: number | null;
  /** +0x54: the fighter record the shot is read from. */
  record: ArrayLike<number> | null;
  /** +0xe4: the frame countdown F0x80091b8c decrements (0 hides the view). */
  countdown: number;
  /** +0x58 self+0x78: the shot read this tick, when one was read. */
  shot: FaceBoxShot | null;
  /** The view F0x80091b8c published this tick, when it built one. */
  view: Ps1Matrix | null;
}

/** The console services F0x80091cf4 reaches through the object's method table and a layer lookup. */
export interface FaceBoxWorkerHost {
  /** +0x38 the object's base step (advances the state field). */
  objectStep?(box: FaceBoxWorker): void;
  /** +0x40 the picture submit (the model instance into the 0x1009 layer). */
  submitPicture?(box: FaceBoxWorker): void;
  /** [0x8004df8c](0x1009): the picture-request layer, or null when it is not up. */
  pictureLayer(key: number): unknown | null | undefined;
}

export interface FaceBoxTickResult {
  /** True while the worker is alive (its state is not 2 or 3). */
  readonly alive: boolean;
  /** The shot read this tick, if the sub-state arm ran and the layer was up. */
  readonly shot: FaceBoxShot | null;
  /** The view built this tick, if the countdown was non-zero. */
  readonly view: Ps1Matrix | null;
}

/**
 * F0x80091cf4 — the close-up worker's per-tick step. Read at
 * pro/fightstg.s:15412.
 *
 * State +0x0c: state 1 falls straight through; states 2 and 3 are terminal (the
 * original returns); every other state calls +0x38 first. Sub-state +0x14: the
 * arm for a value other than 1 reads the shot (F0x80091c1c) when the 0x1009 layer
 * is up, sets the countdown to 2, and calls +0x40 to submit the picture. Finally,
 * while the countdown is non-zero, F0x80091b8c builds the view and decrements it.
 */
export function faceBoxTick(box: FaceBoxWorker, host: FaceBoxWorkerHost): FaceBoxTickResult {
  const state = box.state | 0;
  if (state !== 1 && (state < 2 || state >= 4)) host.objectStep?.(box);
  if (state === 2 || state === 3) return { alive: false, shot: null, view: null };

  if ((box.sub | 0) !== 1) {
    if (host.pictureLayer(FACE_BOX_LAYER_KEY) != null) {
      box.shot = faceBoxShotRead(box.record, speakerSide(box));
      box.countdown = 2;
      host.submitPicture?.(box);
    }
  }
  let view: Ps1Matrix | null = null;
  if ((box.countdown | 0) !== 0) {
    if (box.shot) {
      const built = faceBoxLookAt(box.shot);
      view = built ? built.view : null;
    }
    box.view = view;
    box.countdown = (box.countdown | 0) - 1;
  }
  return { alive: true, shot: box.shot, view };
}

/**
 * The speaker's side, as F0x80091c1c reads it: group 6 when the fighter record's
 * +0x18 flag is zero, 7 when it is not. The worker knows it only through the
 * record, so this is the port's own reader of that byte.
 */
function speakerSide(box: FaceBoxWorker): "player" | "enemy" {
  const rec = box.record;
  const flag = rec ? ((rec[0x18] ?? 0) | ((rec[0x19] ?? 0) << 8)) | ((rec[0x1a] ?? 0) << 16) | ((rec[0x1b] ?? 0) << 24) : 0;
  return flag !== 0 ? "enemy" : "player";
}

/**
 * F0x80091dac — allocate the close-up worker and store its two arguments: the
 * record index at +0x50 and the record pointer at +0x54. Read at
 * pro/fightstg.s:15461. The object factory (F0x80014504, tick F0x80091cf4, size
 * 0xE8, no children) is a console service, so it is injected.
 */
export function faceBoxSpawn(
  createObject: (tick: number, size: number, childCount: number) => { obj: unknown; ptr: number },
  recordIndex: number,
  record: ArrayLike<number> | null,
): FaceBoxWorker & { obj: unknown; ptr: number } {
  const { obj, ptr } = createObject(FACE_BOX_TICK, FACE_BOX_WORKER_SIZE, 0);
  return {
    obj, ptr,
    state: 0,
    sub: 0,
    recordIndex: recordIndex | 0,
    record,
    countdown: 0,
    shot: null,
    view: null,
  };
}

/** The worker tick F0x80091dac installs (F0x80091cf4). */
export const FACE_BOX_TICK = 0x80091cf4;
/** The worker object's size (0xE8), F0x80091dac's factory argument. */
export const FACE_BOX_WORKER_SIZE = 0xe8;

/**
 * The face-box look-at's own angle triple (box+0xCC..0xD0) is zeroed by
 * F0x80091c1c and nothing else writes it, so the RotMatrixYXZ (F0x8002b65c) the
 * box object runs over it is the identity. Kept as a named constant so a reader
 * can see the step was read, not skipped.
 */
export const FACE_BOX_ANGLE_TRIPLE = Object.freeze([0, 0, 0]);
