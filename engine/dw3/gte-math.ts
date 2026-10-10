// Translated GTE (COP2 geometry coprocessor) arithmetic.
//
// The console's perspective-transform unit is one shared system: the resident
// libgte matrix helpers, the fight overlays' layer builder and vertex
// projection, and the display-list interpreter all drive the same registers and
// commands. This module ports the *arithmetic* once, as plain translated code,
// so both the interpreter model (engine/native/gte.ts) and the routine ports
// (engine/dw3/battle-mesh.ts) run the same transform.
//
// Source of the formulas and the register roles: psx-spx "Geometry
// Transformation Engine (GTE)" (nocash), cross-checked against the instruction
// words the fight overlays actually execute (read from the RAM dump and the
// disassembly). See docs/research/fight-3d/fight-mesh-geometry.md and
// docs/research/battle/3d-battle-complete-model-2026-08-19.md §6.
//
// A distance of 0 is not a guess: every constant below is the one rounded in
// the documented formula, and each command has a test with hand-computed values
// (tests/engine/unit/native-gte.test.ts) plus the FLAG bits the routine ports
// expose.

/** Signed 16-bit view of the low halfword. */
export function s16(v: number): number {
  return (v << 16) >> 16;
}

/** Signed 32-bit wrap (matches the 32-bit MAC registers). */
function toI32(v: bigint): number {
  return Number(BigInt.asIntN(32, v));
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** 16-bit signed saturation of an accumulator, per the command's `lm` bit. */
export function saturateIr(v: number, lm: number): number {
  const lo = lm ? 0 : -0x8000;
  if (v < lo) return lo;
  if (v > 0x7fff) return 0x7fff;
  return v;
}

// ── GTE division (RTPS/RTPT) ─────────────────────────────────────────────
//
// The hardware divides with an unsigned Newton-Raphson step, not a real divide;
// a plain divide can differ by one in the low bits. unrTable[i] is generated
// exactly as psx-spx gives it: max(0, (40000h/(i+100h)+1)/2 - 101h).

const UNR_TABLE: number[] = (() => {
  const t = new Array<number>(0x101);
  for (let i = 0; i <= 0x100; i++) {
    const v = Math.floor((0x40000 / (i + 0x100) + 1) / 2) - 0x101;
    t[i] = v > 0 ? v : 0;
  }
  return t;
})();

/** Leading zero count of a 16-bit value (1..16). */
function clz16(v: number): number {
  return Math.clz32(v & 0xffff) - 16;
}

/** Unsigned Newton-Raphson division used by RTPS/RTPT; result 0..0x1FFFF. */
export function unrDivide(h: number, sz3: number): number {
  const z = clz16(sz3);
  const n = (h << z) >>> 0; // 0..0x7FFF8000
  let d = (sz3 << z) & 0xffff; // 0x8000..0xFFFF
  const u = UNR_TABLE[((d - 0x7fc0) >> 7) & 0xff]! + 0x101;
  d = Math.floor((0x2000080 - d * u) / 0x100);
  d = Math.floor((0x0000080 + d * u) / 0x100);
  return Math.min(0x1ffff, Math.floor((n * d + 0x8000) / 0x10000));
}

// ── register-derived inputs ──────────────────────────────────────────────

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** A 3x3 matrix in row-major order (9 signed 16-bit elements). */
export type Mat3 = readonly number[];

/** A perspective-transform view: the GTE control registers RTPS reads. */
export interface RtpsView {
  /** Rotation matrix RT (ctrl 0-4, 9 x s16 row-major). */
  readonly rt: Mat3;
  /** Translation vector TR (ctrl 5-7, 3 x s32). */
  readonly tr: Vec3;
  /** Screen offset OFX/OFY (ctrl 24/25, 32-bit). */
  readonly ofx: number;
  readonly ofy: number;
  /** Projection plane distance H (ctrl 26, u16). */
  readonly h: number;
  /** Depth-cue A/B (ctrl 27 signed 16, ctrl 28 signed 32). */
  readonly dqa: number;
  readonly dqb: number;
}

export interface RtpsResult {
  /** Screen coordinates, saturated to -0x400..0x3FF (SX2/SY2). */
  readonly sx2: number;
  readonly sy2: number;
  /** Screen Z, unsigned 16-bit (SZ3). */
  readonly sz3: number;
  readonly ir0: number;
  readonly ir1: number;
  readonly ir2: number;
  readonly ir3: number;
  readonly mac1: number;
  readonly mac2: number;
  readonly mac3: number;
  readonly mac0: number;
  readonly flags: number;
}

// FLAG bit positions (cop2r63), from psx-spx.
export const FLAG = {
  IR0_SAT: 1 << 12,
  SY2_SAT: 1 << 13,
  SX2_SAT: 1 << 14,
  MAC0_NEG: 1 << 15,
  MAC0_POS: 1 << 16,
  DIV_OVERFLOW: 1 << 17,
  SZ3_SAT: 1 << 18,
  COLOR_B_SAT: 1 << 19,
  COLOR_G_SAT: 1 << 20,
  COLOR_R_SAT: 1 << 21,
  IR3_SAT: 1 << 22,
  IR2_SAT: 1 << 23,
  IR1_SAT: 1 << 24,
} as const;

/** Bits whose OR is reflected into FLAG bit 31 (the "any error" bit). */
const FLAG_ERROR_MASK = 0x7f800000 | 0x0007e000;

/**
 * RTPS (COP2 0180001h) — perspective transformation of one vertex.
 * `sf` shifts the fractional result (12 bits when set); `lm` selects the IR
 * saturation floor (0 vs -8000).
 */
export function rtps(view: RtpsView, x: number, y: number, z: number, sf = 1, lm = 0): RtpsResult {
  const m = view.rt;
  const rows: Mat3[] = [
    [s16(m[0]!), s16(m[1]!), s16(m[2]!)],
    [s16(m[3]!), s16(m[4]!), s16(m[5]!)],
    [s16(m[6]!), s16(m[7]!), s16(m[8]!)],
  ];
  const v = [s16(x), s16(y), s16(z)];
  const tr = [view.tr.x, view.tr.y, view.tr.z];
  const full: bigint[] = [0n, 0n, 0n];
  let flags = 0;
  for (let k = 0; k < 3; k++) {
    const row = rows[k]!;
    full[k] =
      BigInt(tr[k]!) * 0x1000n +
      BigInt(row[0]!) * BigInt(v[0]!) +
      BigInt(row[1]!) * BigInt(v[1]!) +
      BigInt(row[2]!) * BigInt(v[2]!);
  }
  const shift = sf ? 12n : 0n;
  const mac = full.map((s) => toI32(s >> shift));
  const ir = mac.map((mv, k) => {
    const saturated = mv > 0x7fff || mv < (lm ? 0 : -0x8000);
    if (saturated) flags |= FLAG.IR1_SAT << (2 - k);
    return saturateIr(mv, lm);
  });

  // SZ3 = MAC3 SAR ((1-sf)*12) == the pre-shift third sum >> 12.
  const sz3raw = full[2]! >> 12n;
  let sz3 = Number(sz3raw);
  if (sz3 < 0 || sz3 > 0xffff) {
    flags |= FLAG.SZ3_SAT;
    sz3 = clamp(sz3, 0, 0xffff);
  }

  const h = view.h & 0xffff;
  let factor: number;
  if (h < sz3 * 2) {
    factor = unrDivide(h, sz3);
  } else {
    factor = 0x1ffff;
    flags |= FLAG.DIV_OVERFLOW;
  }

  const ix = ir[0]!;
  const iy = ir[1]!;
  const mac0x = factor * ix + view.ofx;
  const mac0y = factor * iy + view.ofy;
  let sx2 = Math.floor(mac0x / 0x10000);
  let sy2 = Math.floor(mac0y / 0x10000);
  if (sx2 < -0x400 || sx2 > 0x3ff) {
    flags |= FLAG.SX2_SAT;
    sx2 = clamp(sx2, -0x400, 0x3ff);
  }
  if (sy2 < -0x400 || sy2 > 0x3ff) {
    flags |= FLAG.SY2_SAT;
    sy2 = clamp(sy2, -0x400, 0x3ff);
  }
  const mac0c = factor * view.dqa + view.dqb;
  let ir0 = Math.floor(mac0c / 0x1000);
  if (ir0 < 0 || ir0 > 0x1000) {
    flags |= FLAG.IR0_SAT;
    ir0 = clamp(ir0, 0, 0x1000);
  }
  return {
    sx2,
    sy2,
    sz3,
    ir0,
    ir1: ir[0]!,
    ir2: ir[1]!,
    ir3: ir[2]!,
    mac1: mac[0]!,
    mac2: mac[1]!,
    mac3: mac[2]!,
    mac0: mac0c,
    flags,
  };
}

// ── MVMVA ────────────────────────────────────────────────────────────────

export interface MvmvaResult {
  readonly mac1: number;
  readonly mac2: number;
  readonly mac3: number;
  readonly ir1: number;
  readonly ir2: number;
  readonly ir3: number;
  readonly flags: number;
}

/**
 * MVMVA (COP2 0400012h) — multiply a vector by a matrix and add a translation.
 * `tr` is null for cv=3 (None); `fcBug` reproduces the hardware's broken FC
 * path (the first matrix term is dropped).
 */
export function mvmva(
  m: Mat3,
  vec: Vec3,
  tr: Vec3 | null,
  sf = 1,
  lm = 0,
  fcBug = false,
): MvmvaResult {
  const v = [s16(vec.x), s16(vec.y), s16(vec.z)];
  const trv = tr === null ? [0, 0, 0] : [tr.x, tr.y, tr.z];
  const mac: number[] = [0, 0, 0];
  const ir: number[] = [0, 0, 0];
  let flags = 0;
  const shift = sf ? 12n : 0n;
  for (let k = 0; k < 3; k++) {
    const row = m;
    // fcBug: MAC = (Mx12*Vx2 + Mx13*Vx3) SAR, dropping the first product.
    let sum = BigInt(trv[k]!) * 0x1000n;
    sum += BigInt(s16(row[k * 3 + (fcBug ? 1 : 0)]!)) * BigInt(v[fcBug ? 1 : 0]!);
    if (fcBug) {
      sum += BigInt(s16(row[k * 3 + 2]!)) * BigInt(v[2]!);
    } else {
      sum += BigInt(s16(row[k * 3 + 1]!)) * BigInt(v[1]!);
      sum += BigInt(s16(row[k * 3 + 2]!)) * BigInt(v[2]!);
    }
    const mv = toI32(sum >> shift);
    mac[k] = mv;
    if (mv > 0x7fff || mv < (lm ? 0 : -0x8000)) flags |= FLAG.IR1_SAT << (2 - k);
    ir[k] = saturateIr(mv, lm);
  }
  return {
    mac1: mac[0]!,
    mac2: mac[1]!,
    mac3: mac[2]!,
    ir1: ir[0]!,
    ir2: ir[1]!,
    ir3: ir[2]!,
    flags,
  };
}

// ── GPF / GPL (used by the resident libgte matrix helpers) ─────────────────

export interface InterpResult {
  readonly mac: number;
  readonly ir: number;
  readonly flags: number;
}

/** GPF (COP2 190003Dh): MAC = (IRn*IR0) SAR (sf*12), IR = sat(MAC). */
export function gpf(ir0: number, irn: number, sf = 1, lm = 0): InterpResult {
  const full = BigInt(ir0) * BigInt(irn);
  const mv = toI32(full >> (sf ? 12n : 0n));
  const saturated = mv > 0x7fff || mv < (lm ? 0 : -0x8000);
  return { mac: mv, ir: saturateIr(mv, lm), flags: saturated ? FLAG.IR1_SAT : 0 };
}

// ── NCLIP (the display-list interpreter's polygon-orientation test) ────────

/** NCLIP (COP2 1400006h): MAC0 = the signed area of the screen triangle. */
export function nclip(sxy: readonly number[]): number {
  const sx = (i: number): number => s16(sxy[i]!);
  const sy = (i: number): number => s16(sxy[i + 3]!);
  return (
    sx(0) * sy(1) + sx(1) * sy(2) + sx(2) * sy(0) -
    sx(0) * sy(2) - sx(1) * sy(0) - sx(2) * sy(1)
  );
}

// ── AVSZ3 / AVSZ4 (ordering-table Z) ──────────────────────────────────────

export interface AvszResult {
  readonly mac0: number;
  readonly otz: number;
  readonly flags: number;
}

/** AVSZ3/AVSZ4: MAC0 = ZSF*(sum of Zs); OTZ = MAC0 SAR 12, u16. */
export function avsz(zsf: number, szs: readonly number[]): AvszResult {
  let sum = 0;
  for (const s of szs) sum += s & 0xffff;
  const mac0 = zsf * sum;
  let otz = Math.floor(mac0 / 0x1000);
  let flags = 0;
  if (otz < 0 || otz > 0xffff) {
    flags |= FLAG.SZ3_SAT;
    otz = clamp(otz, 0, 0xffff);
  }
  return { mac0, otz, flags };
}

// ── NCS (normal colour, single vector) ────────────────────────────────────

export interface NcsResult {
  /** The final saturated IR1..IR3 (psx-spx: IR = MAC). */
  readonly ir1: number;
  readonly ir2: number;
  readonly ir3: number;
  /** The raw second-stage MAC1..MAC3 — the Color FIFO's source (`MACn/16`). */
  readonly mac1: number;
  readonly mac2: number;
  readonly mac3: number;
  /** The Color FIFO bytes: MACn SHRed by 4 and saturated to a byte. */
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly flags: number;
}

/**
 * NCS (COP2 0C8041Eh, sf=1 lm=1): (LLM*V0) then (BK*1000h + LCM*IR), no further
 * colour step. Per psx-spx the `[MAC] = [R*IR1,G*IR2,B*IR3] SHL 4` and the
 * following `SAR` lines are marked "for NCDx/NCCx" **only**; NCS stops after the
 * `(BK*1000h + LCM*IR) SAR` stage, so RGBC's RGB does not scale the result.
 * DuckStation's `NCS` confirms it: it runs `MulMatVec(LLM,V0)`, then
 * `MulMatVec(LCM,BK,IR)`, then `PushRGBFromMAC` with no channel multiply.
 *
 *   [IR1,IR2,IR3] = [MAC1,MAC2,MAC3] = (LLM*V0) SAR (sf*12)
 *   [IR1,IR2,IR3] = [MAC1,MAC2,MAC3] = (BK*1000h + LCM*IR) SAR (sf*12)
 *   Color FIFO = [MAC1/16,MAC2/16,MAC3/16,CODE], [IR1,IR2,IR3] = [MAC1,MAC2,MAC3]
 *
 * `rgbc` is kept in the signature because this function belongs to the NCD/NCC
 * family and its callers pass one positionally; NCS itself reads no field of it
 * (the FIFO CODE byte is RGBC[31:24] and is applied by the caller).
 */
export function ncs(
  llm: Mat3,
  v0: Vec3,
  lcm: Mat3,
  bk: Vec3,
  rgbc: number,
  sf = 1,
  lm = 1,
): NcsResult {
  void rgbc; // NCS does not scale by RGBC's RGB (psx-spx: that step is NCDx/NCCx only).
  const first = mvmva(llm, v0, null, sf, lm);
  const ir: Vec3 = { x: first.ir1, y: first.ir2, z: first.ir3 };
  const second = mvmva(lcm, ir, bk, sf, lm);
  let flags = first.flags | second.flags;
  // Color FIFO = [MAC1/16,MAC2/16,MAC3/16,CODE], the RAW second-stage MAC values
  // divided by 16 and saturated to a byte (psx-spx; DuckStation PushRGBFromMAC's
  // `MACn >> 4` + TruncateRGB). The saturation is flagged per channel (bits 21/20/19).
  const fifo = (mac: number, bit: number): number => {
    const v = mac >> 4;
    if (v < 0 || v > 0xff) {
      flags |= bit;
      return clamp(v, 0, 0xff);
    }
    return v;
  };
  return {
    ir1: second.ir1,
    ir2: second.ir2,
    ir3: second.ir3,
    mac1: second.mac1,
    mac2: second.mac2,
    mac3: second.mac3,
    r: fifo(second.mac1, FLAG.COLOR_R_SAT),
    g: fifo(second.mac2, FLAG.COLOR_G_SAT),
    b: fifo(second.mac3, FLAG.COLOR_B_SAT),
    flags,
  };
}

// ── the libgte rotation-matrix builder (RotMatrixZYX, F0x8002b45c) ─────────
//
// The resident libgte RotMatrixZYX builds a 3x3 rotation matrix from a
// three-angle vector (4096 units per turn) by driving the GTE's GPF command as a
// fixed-point multiplier over the resident sin/cos table at 0x80056a28. The
// layer builder F0x80083e0c calls it to turn a layer's local angles (at +0x18)
// into its local matrix (at +0x28) before ScaleMatrix scales it and the four
// MVMVA passes compose it onto its parent.
//
// The arithmetic is replicated exactly, not approximated: each angle is folded
// to |angle| & 0xfff for the table (the sign of the angle is re-applied to the
// sine only), and every product is a 32-bit product shifted right 12 and
// saturated to a signed 16-bit IR. A float `cos`/`sin` reconstruction of the
// matrix differs from this in the low bit for multi-axis rotations, which is why
// the port keeps the fixed-point chain.
//
// Verified against the original instruction words through engine/native on
// tests/engine/unit/battle-mesh-oracle.test.ts.

/**
 * The resident rcossin table at 0x80056a28: 0x1000 words, word i =
 * `(round(cos(2*pi*i/0x1000) * 0x1000) << 16) | (round(sin(...) * 0x1000) & 0xffff)`.
 * Regenerated here; the oracle asserts it reproduces all 0x1000 words of the
 * pinned RAM dump exactly (round half away from zero).
 */
export const RCOSSIN: Int32Array = (() => {
  const t = new Int32Array(0x1000);
  const rnd = (x: number): number => (x >= 0 ? Math.floor(x + 0.5) : -Math.floor(-x + 0.5));
  for (let i = 0; i < 0x1000; i++) {
    const a = (2 * Math.PI * i) / 0x1000;
    const c = rnd(Math.cos(a) * 0x1000) & 0xffff;
    const s = rnd(Math.sin(a) * 0x1000) & 0xffff;
    t[i] = ((c << 16) | s) | 0;
  }
  return t;
})();

/**
 * The cos/sin a single angle reads from the table, exactly as F0x8002b45c's
 * lookup does: the word index is |angle| & 0xfff (the `(a+s)^s` fold), the high
 * half is the (even) cosine and the low half is the (odd) sine, whose sign is
 * taken from the angle's own sign bit.
 */
export function cosSin(angle: number): { c: number; s: number } {
  const a = s16(angle);
  const sign = a >> 31; // 0 or -1
  const word = RCOSSIN[((a + sign) ^ sign) & 0xfff] as number;
  const c = s16(word >> 16);
  const raw = word & 0xffff; // sin(|a|), unsigned
  return { c, s: s16(sign === 0 ? raw : -raw) };
}

/** One GPF step: MAC = (IR0*IRn) SAR 12, IR = saturate to a signed 16-bit IR. */
function gpfIr(ir0: number, irn: number): number {
  const mac = (ir0 * irn) >> 12;
  return mac > 0x7fff ? 0x7fff : mac < -0x8000 ? -0x8000 : mac;
}

/**
 * RotMatrixZYX — F0x8002b45c. Builds the 3x3 rotation matrix
 * `Rz(rz) * Ry(ry) * Rx(rx)` from a three-angle vector in 4096-units-per-turn
 * (row-major 9 signed-16 elements, 1.0 = 0x1000).
 *
 * The command sequence is four GPF passes over the three angles' cos/sin words;
 * the port folds them into the same closed form, keeping each product's
 * fixed-point truncation. `-sy` (the `neg $a3` at 0x8002b5c8) is m[6].
 */
export function rotMatrixZYX(rx: number, ry: number, rz: number): Mat3 {
  const { c: cx, s: sx } = cosSin(rx);
  const { c: cy, s: sy } = cosSin(ry);
  const { c: cz, s: sz } = cosSin(rz);
  const t0 = gpfIr(cx, sy);
  const t1 = gpfIr(cx, sz);
  const t2 = gpfIr(cx, cz);
  const t3 = gpfIr(sx, sy);
  const t4 = gpfIr(sx, sz);
  const t5 = gpfIr(sx, cz);
  return [
    s16(gpfIr(cz, cy)), // m0 = cz*cy
    s16(gpfIr(cz, t3) - t1), // m1 = cz*(sx*sy) - cx*sz
    s16(gpfIr(cz, t0) + t4), // m2 = cz*(cx*sy) + sx*sz
    s16(gpfIr(sz, cy)), // m3 = sz*cy
    s16(gpfIr(sz, t3) + t2), // m4 = sz*(sx*sy) + cx*cz
    s16(gpfIr(sz, t0) - t5), // m5 = sz*(cx*sy) - sx*cz
    s16(-sy), // m6 = -sy
    s16(gpfIr(cy, sx)), // m7 = cy*sx
    s16(gpfIr(cy, cx)), // m8 = cy*cx
  ];
}

/** Fold a FLAG word into the hardware's bit-31 "any error" summary. */
export function finalizeFlag(flag: number): number {
  const f = flag & 0x7fffffff;
  return ((f & FLAG_ERROR_MASK) !== 0 ? f | 0x80000000 : f) | 0;
}
