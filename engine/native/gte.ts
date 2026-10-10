// COP2 (GTE) coprocessor model for the native interpreter.
//
// The fight overlays' 3-D core runs on the console's geometry coprocessor, which
// the interpreter only partly modelled before (one MVMVA form and GPF, enough
// for the memory-card helper). This adds the register file the original uses
// (rotation matrix, translation vector, light/colour matrices, projection plane,
// screen offset, the IR/MAC/SXY/SZ/colour/FLAG accumulators) and the commands
// the 3-D core executes:
//
//   RTPS  0180001h  the vertex projection F0x80084a54 and the on-screen test
//                   F0x80085000
//   MVMVA 0400012h+ the layer builder F0x80083e0c's passes, the display-list
//                   interpreter F0x80085110 and the resident libgte helper
//                   F0x8002b1dc (ApplyMatrixSV)
//   GPF   190003Dh  the resident libgte matrix helper F0x8002b65c
//   NCLIP 1400006h  the display-list interpreter's orientation test
//   AVSZ3 158002Dh  ordering-table Z
//   AVSZ4 168002Eh  ordering-table Z (quads)
//   NCS   0C8041Eh  the effect-mesh colour path
//
// Every command word the fightstg overlay contains is one of these: the
// complete set is `c2 0x198003d`, `c2 0x486012`, `c2 0x49e012`, `c2 0x480012`,
// `c2 0x180001`, `c2 0xc8041e`, `c2 0x1400006`, `c2 0x168002e`, `c2 0x158002d`.
// The arithmetic lives in engine/dw3/gte-math.ts so the ported routines and this
// model cannot drift; see that file for the psx-spx derivation.
//
// Register numbers here are the raw COP2 register indices: data 0..31
// (cop2r0..31), control 0..31 (cop2r32..63).

import {
  avsz,
  finalizeFlag,
  FLAG,
  gpf,
  mvmva,
  nclip,
  ncs,
  rtps,
  s16,
  type Mat3,
  type RtpsView,
  type Vec3,
} from "../dw3/gte-math.ts";

/** COP2 data-register indices the original reads back as 16-bit values. */
const DATA_16BIT = new Set([1, 3, 5, 9, 10, 11]);
/** COP2 control-register indices stored as 16-bit and sign-extended on read. */
const CTRL_16BIT = new Set([4, 12, 20, 27, 29, 30]);

export class Gte {
  /** Data registers cop2r0..31 (V, RGBC, OTZ, IR, SXY, SZ, RGB, MAC...). */
  readonly data = new Int32Array(32);
  /** Control registers cop2r32..63 stored as 0..31. */
  readonly ctrl = new Int32Array(32);
  private flag = 0;

  /** MFC2 read: 16-bit registers sign-extend, the rest read as stored. */
  readData(reg: number): number {
    const r = reg & 31;
    const v = this.data[r] as number;
    return DATA_16BIT.has(r) ? s16(v) : v;
  }

  writeData(reg: number, v: number): void {
    this.data[reg & 31] = v | 0;
  }

  /** CFC2 read. FLAG is computed; H has the hardware's sign-extension bug. */
  readCtrl(reg: number): number {
    const r = reg & 31;
    if (r === 31) return this.flag | 0;
    const v = this.ctrl[r] as number;
    if (r === 26) return s16(v & 0xffff); // H read bug (u16 returned sign-extended)
    return CTRL_16BIT.has(r) ? s16(v) : v;
  }

  writeCtrl(reg: number, v: number): void {
    const r = reg & 31;
    if (r === 31) {
      // FLAG writes are masked; bit 31 is recomputed from the error bits.
      this.flag = finalizeFlag(v & 0x7ffff000);
      return;
    }
    this.ctrl[r] = v | 0;
  }

  /** LWC2: a full 32-bit word into a data register. */
  loadData(reg: number, word: number): void {
    this.data[reg & 31] = word | 0;
  }

  /** SWC2: the stored 32-bit data register. */
  storeData(reg: number): number {
    return this.data[reg & 31] as number;
  }

  // ── register-derived operands ────────────────────────────────────────────

  /** Rotation matrix RT from ctrl 0-4 (row-major 9 x s16). */
  private matrix(select: number): Mat3 {
    const c = this.ctrl;
    if (select === 3) {
      // Reserved matrix: the hardware reads a garbage matrix built from RGBC.
      const r = (this.data[6] as number) & 0xff;
      const g = (this.data[8] as number);
      const rt13 = (c[1] as number) >> 16;
      const rt22 = s16(c[2] as number);
      return [-(r * 0x10), r * 0x10, g, rt13, rt13, rt13, rt22, rt22, rt22];
    }
    const base = select === 0 ? 0 : select === 1 ? 8 : 16; // RT / LLM / LCM
    const a = c[base] as number;
    const b = c[base + 1] as number;
    const d = c[base + 2] as number;
    const e = c[base + 3] as number;
    const f = c[base + 4] as number;
    return [s16(a), a >> 16, s16(b), b >> 16, s16(d), d >> 16, s16(e), e >> 16, s16(f)];
  }

  private translation(select: number): Vec3 | null {
    const c = this.ctrl;
    if (select === 0) return { x: c[5] as number, y: c[6] as number, z: c[7] as number };
    if (select === 1) return { x: c[13] as number, y: c[14] as number, z: c[15] as number };
    return null; // None (cv=3); the FC path (cv=2) is handled via the bug flag.
  }

  private vector(select: number): Vec3 {
    const d = this.data;
    if (select === 0) return { x: s16(d[0] as number), y: (d[0] as number) >> 16, z: s16(d[1] as number) };
    if (select === 1) return { x: s16(d[2] as number), y: (d[2] as number) >> 16, z: s16(d[3] as number) };
    if (select === 2) return { x: s16(d[4] as number), y: (d[4] as number) >> 16, z: s16(d[5] as number) };
    return { x: s16(d[9] as number), y: s16(d[10] as number), z: s16(d[11] as number) };
  }

  /** The RTPS view from the control registers. */
  rtpsView(): RtpsView {
    return {
      rt: this.matrix(0),
      tr: { x: this.ctrl[5] as number, y: this.ctrl[6] as number, z: this.ctrl[7] as number },
      ofx: this.ctrl[24] as number,
      ofy: this.ctrl[25] as number,
      h: (this.ctrl[26] as number) & 0xffff,
      dqa: s16(this.ctrl[27] as number),
      dqb: this.ctrl[28] as number,
    };
  }

  // ── command dispatch ─────────────────────────────────────────────────────

  /** Dispatch a GTE command word. Unknown commands stay no-ops (fail-soft). */
  command(w: number): void {
    const fn = w & 0x3f;
    const sf = (w >>> 19) & 1;
    const lm = (w >>> 10) & 1;
    let flag = 0;
    switch (fn) {
      case 0x01: flag = this.rtpsCmd(sf, lm); break;
      case 0x06: flag = this.nclipCmd(); break;
      case 0x12: flag = this.mvmvaCmd(w); break;
      case 0x1e: flag = this.ncsCmd(sf, lm); break;
      case 0x2d: flag = this.avszCmd(sf, lm, 3); break;
      case 0x2e: flag = this.avszCmd(sf, lm, 4); break;
      case 0x3d: flag = this.gpfCmd(sf, lm); break;
      default: return;
    }
    this.flag = finalizeFlag(flag);
  }

  private rtpsCmd(sf: number, lm: number): number {
    const d = this.data;
    const v0 = this.vector(0);
    const r = rtps(this.rtpsView(), v0.x, v0.y, v0.z, sf, lm);
    d[8] = r.ir0 | 0;
    d[9] = r.ir1 | 0;
    d[10] = r.ir2 | 0;
    d[11] = r.ir3 | 0;
    // SZ FIFO shifts down; SZ3 is the new entry.
    d[16] = d[17] as number;
    d[17] = d[18] as number;
    d[18] = d[19] as number;
    d[19] = r.sz3 | 0;
    // SXY FIFO shifts down; SXY2 packed (SX low, SY high), SXYP mirrors it.
    const packed = ((r.sy2 & 0xffff) << 16) | (r.sx2 & 0xffff);
    d[12] = d[13] as number;
    d[13] = d[14] as number;
    d[14] = packed | 0;
    d[15] = packed | 0;
    d[24] = r.mac0 | 0;
    d[25] = r.mac1 | 0;
    d[26] = r.mac2 | 0;
    d[27] = r.mac3 | 0;
    return r.flags;
  }

  private mvmvaCmd(w: number): number {
    const sf = (w >>> 19) & 1;
    const lm = (w >>> 10) & 1;
    const mx = (w >>> 17) & 3;
    const v = (w >>> 15) & 3;
    const cv = (w >>> 13) & 3;
    const fcBug = cv === 2;
    const r = mvmva(this.matrix(mx), this.vector(v), this.translation(cv), sf, lm, fcBug);
    const d = this.data;
    d[9] = r.ir1 | 0;
    d[10] = r.ir2 | 0;
    d[11] = r.ir3 | 0;
    d[25] = r.mac1 | 0;
    d[26] = r.mac2 | 0;
    d[27] = r.mac3 | 0;
    return r.flags;
  }

  private gpfCmd(sf: number, lm: number): number {
    const d = this.data;
    const ir0 = s16(d[8] as number);
    let flags = 0;
    let m1 = 0;
    let m2 = 0;
    let m3 = 0;
    for (let k = 1; k <= 3; k++) {
      const res = gpf(ir0, s16(d[8 + k] as number), sf, lm);
      flags |= res.flags;
      d[8 + k] = res.ir | 0;
      d[24 + k] = res.mac | 0;
      if (k === 1) m1 = res.mac;
      else if (k === 2) m2 = res.mac;
      else m3 = res.mac;
    }
    // GPF's Color FIFO entry also carries RGBC's code byte (psx-spx GPF "CODE=MSB
    // of RGBC"; DuckStation Execute_GPF -> PushRGBFromMAC reads REGS.RGBC[3]).
    this.pushColor(m1, m2, m3, ((d[6] as number) >>> 24) & 0xff);
    return flags;
  }

  private nclipCmd(): number {
    const d = this.data;
    const sxy = [s16(d[12] as number), s16(d[13] as number), s16(d[14] as number),
      (d[12] as number) >> 16, (d[13] as number) >> 16, (d[14] as number) >> 16];
    const mac0 = nclip(sxy);
    d[24] = mac0 | 0;
    let flags = 0;
    if (mac0 > 0x7fffffff || mac0 < -0x80000000) flags |= FLAG.MAC0_POS;
    return flags;
  }

  private avszCmd(_sf: number, _lm: number, n: number): number {
    const d = this.data;
    const zsf = s16(this.ctrl[n === 3 ? 29 : 30] as number);
    const szs = n === 3
      ? [d[17] as number, d[18] as number, d[19] as number]
      : [d[16] as number, d[17] as number, d[18] as number, d[19] as number];
    const r = avsz(zsf, szs);
    d[24] = r.mac0 | 0;
    d[7] = r.otz | 0;
    return r.flags;
  }

  private ncsCmd(sf: number, lm: number): number {
    const d = this.data;
    const rgbc = d[6] as number;
    const r = ncs(
      this.matrix(1),
      this.vector(0),
      this.matrix(2),
      { x: this.ctrl[13] as number, y: this.ctrl[14] as number, z: this.ctrl[15] as number },
      rgbc,
      sf,
      lm,
    );
    d[9] = r.ir1 | 0;
    d[10] = r.ir2 | 0;
    d[11] = r.ir3 | 0;
    // The Color FIFO takes MACn>>4, NOT the saturated IRn/16: hardware pushes the
    // raw MAC (`Color FIFO = [MAC1/16,...]`, psx-spx; DuckStation PushRGBFromMAC
    // `REGS.MAC1 >> 4`). IR and MAC diverge when the IR saturates.
    this.pushColor(r.mac1, r.mac2, r.mac3, (rgbc >>> 24) & 0xff);
    return r.flags;
  }

  /**
   * Push [R,G,B,CODE] to the top of the 3-stage colour FIFO. Per psx-spx ("the
   * older Fifo entries are moved downwards", the top stage is RGB2), mednafen's
   * `MAC_to_RGB_FIFO` (`RGB_FIFO[0]=RGB_FIFO[1]; RGB_FIFO[1]=RGB_FIFO[2];
   * RGB_FIFO[2]=new`) and DuckStation's `PushRGBFromMAC` (`RGB0=RGB1;
   * RGB1=RGB2; RGB2=new`), the NEWEST entry lands in RGB2 and the older entries
   * shift down toward RGB0. The effect-mesh colour path stores `swc2 $22`
   * (RGB2, fightstg.s L1905/L1921), so a newest-to-RGB0 FIFO hands it a stale
   * entry. `m1..m3` are the MAC1..MAC3 values; each is SHRed by 4 and clipped to
   * a byte (psx-spx: the FIFO holds `MACn/16`).
   */
  private pushColor(m1: number, m2: number, m3: number, code = 0): void {
    const d = this.data;
    const sat = (v: number): number => (v < 0 ? 0 : v > 0xff ? 0xff : v);
    const r = sat(Math.floor(m1 / 16));
    const g = sat(Math.floor(m2 / 16));
    const b = sat(Math.floor(m3 / 16));
    d[20] = d[21] as number; // RGB0 <- old RGB1 (oldest)
    d[21] = d[22] as number; // RGB1 <- old RGB2
    d[22] = (((code & 0xff) << 24) | (b << 16) | (g << 8) | r) | 0; // RGB2 <- newest
  }
}
