// Opcode-level unit tests for the R3000 integer core (engine/native/mips.ts).
// Programs are hand-assembled word arrays loaded into a flat NativeMemory; each test
// runs via cpu.call() (which links $ra to the exit sentinel) and asserts registers/RAM.
// The core exists to run wstag overlay ambience callbacks byte-faithfully — see
// docs/specs/2026-07-04-wstag-native-interpreter-design.md (P0).

import { test } from "node:test";
import assert from "node:assert/strict";
import { NativeMemory } from "../engine/native/memory.ts";
import { R3000, NativeTrap } from "../engine/native/mips.ts";

const BASE = 0x800a5de0; // wstag overlay load base — same place real code runs

// ── tiny assembler helpers (only what the tests need) ──
const R = { zero: 0, at: 1, v0: 2, v1: 3, a0: 4, a1: 5, a2: 6, a3: 7, t0: 8, t1: 9, s0: 16, sp: 29, ra: 31 };
const sp3 = (rs, rt, rd, fn) => (rs << 21) | (rt << 16) | (rd << 11) | fn;
const imm = (op, rs, rt, i) => (op << 26) | (rs << 21) | (rt << 16) | (i & 0xffff);
const ADDU = (rd, rs, rt) => sp3(rs, rt, rd, 0x21);
const SUBU = (rd, rs, rt) => sp3(rs, rt, rd, 0x23);
const AND = (rd, rs, rt) => sp3(rs, rt, rd, 0x24);
const OR = (rd, rs, rt) => sp3(rs, rt, rd, 0x25);
const XOR = (rd, rs, rt) => sp3(rs, rt, rd, 0x26);
const NOR = (rd, rs, rt) => sp3(rs, rt, rd, 0x27);
const SLT = (rd, rs, rt) => sp3(rs, rt, rd, 0x2a);
const SLTU = (rd, rs, rt) => sp3(rs, rt, rd, 0x2b);
const SLL = (rd, rt, sa) => (rt << 16) | (rd << 11) | (sa << 6) | 0x00;
const SRL = (rd, rt, sa) => (rt << 16) | (rd << 11) | (sa << 6) | 0x02;
const SRA = (rd, rt, sa) => (rt << 16) | (rd << 11) | (sa << 6) | 0x03;
const SLLV = (rd, rt, rs) => sp3(rs, rt, rd, 0x04);
const SRAV = (rd, rt, rs) => sp3(rs, rt, rd, 0x07);
const JR = (rs) => sp3(rs, 0, 0, 0x08);
const JALR = (rs, rd = R.ra) => sp3(rs, 0, rd, 0x09);
const MULT = (rs, rt) => sp3(rs, rt, 0, 0x18);
const MULTU = (rs, rt) => sp3(rs, rt, 0, 0x19);
const DIV = (rs, rt) => sp3(rs, rt, 0, 0x1a);
const MOVZ = (rd, rs, rt) => sp3(rs, rt, rd, 0x0a);
const MOVN = (rd, rs, rt) => sp3(rs, rt, rd, 0x0b);
const DIVU = (rs, rt) => sp3(rs, rt, 0, 0x1b);
const MFHI = (rd) => sp3(0, 0, rd, 0x10);
const MFLO = (rd) => sp3(0, 0, rd, 0x12);
const ADDIU = (rt, rs, i) => imm(0x09, rs, rt, i);
const SLTI = (rt, rs, i) => imm(0x0a, rs, rt, i);
const SLTIU = (rt, rs, i) => imm(0x0b, rs, rt, i);
const ANDI = (rt, rs, i) => imm(0x0c, rs, rt, i);
const ORI = (rt, rs, i) => imm(0x0d, rs, rt, i);
const XORI = (rt, rs, i) => imm(0x0e, rs, rt, i);
const LUI = (rt, i) => imm(0x0f, 0, rt, i);
const LB = (rt, off, rs) => imm(0x20, rs, rt, off);
const LH = (rt, off, rs) => imm(0x21, rs, rt, off);
const LWL = (rt, off, rs) => imm(0x22, rs, rt, off);
const LW = (rt, off, rs) => imm(0x23, rs, rt, off);
const LBU = (rt, off, rs) => imm(0x24, rs, rt, off);
const LHU = (rt, off, rs) => imm(0x25, rs, rt, off);
const LWR = (rt, off, rs) => imm(0x26, rs, rt, off);
const SB = (rt, off, rs) => imm(0x28, rs, rt, off);
const SH = (rt, off, rs) => imm(0x29, rs, rt, off);
const SW = (rt, off, rs) => imm(0x2b, rs, rt, off);
const BEQ = (rs, rt, words) => imm(0x04, rs, rt, words);
const BNE = (rs, rt, words) => imm(0x05, rs, rt, words);
const BLEZ = (rs, words) => imm(0x06, rs, 0, words);
const BGTZ = (rs, words) => imm(0x07, rs, 0, words);
const BLTZ = (rs, words) => imm(0x01, rs, 0x00, words);
const BGEZ = (rs, words) => imm(0x01, rs, 0x01, words);
const J = (target) => (0x02 << 26) | ((target >>> 2) & 0x03ffffff);
const JAL = (target) => (0x03 << 26) | ((target >>> 2) & 0x03ffffff);
const JR_RA = JR(R.ra);
const NOP = 0;

function boot(words, at = BASE) {
  const mem = new NativeMemory();
  const bytes = new Uint8Array(words.length * 4);
  words.forEach((w, i) => new DataView(bytes.buffer).setUint32(i * 4, w >>> 0, true));
  mem.load(bytes, at);
  return { mem, cpu: new R3000(mem) };
}

test("ALU: addiu/addu/subu/logic/lui materialize constants", () => {
  const { cpu } = boot([
    LUI(R.v0, 0x800a), ADDIU(R.v0, R.v0, 0x5de0),
    ADDIU(R.t0, R.zero, -5), ADDU(R.v1, R.v0, R.t0),
    ORI(R.t1, R.zero, 0xf0f0), XOR(R.t1, R.t1, R.t1), NOR(R.t1, R.t1, R.t1),
    JR_RA, NOP,
  ]);
  cpu.call(BASE, []);
  assert.equal(cpu.reg(R.v0) >>> 0, 0x800a5de0);
  assert.equal(cpu.reg(R.v1) >>> 0, 0x800a5ddb);
  assert.equal(cpu.reg(R.t1), -1);
});

test("ALU: negative addiu wraps 32-bit (lui-carry form)", () => {
  // lui 0x800b / addiu -0x7ae8 = 0x800a8518 — the census address form that broke greps
  const { cpu } = boot([LUI(R.v0, 0x800b), ADDIU(R.v0, R.v0, -0x7ae8), JR_RA, NOP]);
  cpu.call(BASE, []);
  assert.equal(cpu.reg(R.v0) >>> 0, 0x800a8518);
});

test("shifts: sll/srl/sra/sllv/srav incl. sign behavior", () => {
  const { cpu } = boot([
    ADDIU(R.t0, R.zero, -8),          // 0xfffffff8
    SRA(R.v0, R.t0, 2),               // -2
    SRL(R.v1, R.t0, 28),              // 0xf
    ADDIU(R.t1, R.zero, 3), SLLV(R.a0, R.t0, R.t1), // -8<<3 = -64
    SRAV(R.a1, R.t0, R.t1),           // -1
    SLL(R.a2, R.t0, 8),               // 0xfffff800
    JR_RA, NOP,
  ]);
  cpu.call(BASE, []);
  assert.equal(cpu.reg(R.v0), -2);
  assert.equal(cpu.reg(R.v1), 0xf);
  assert.equal(cpu.reg(R.a0), -64);
  assert.equal(cpu.reg(R.a1), -1);
  assert.equal(cpu.reg(R.a2) >>> 0, 0xfffff800);
});

test("slt/slti/sltu/sltiu signed vs unsigned", () => {
  const { cpu } = boot([
    ADDIU(R.t0, R.zero, -1),
    SLTI(R.v0, R.t0, 0),      // -1 < 0 → 1
    SLTIU(R.v1, R.t0, 5),     // 0xffffffff < 5 unsigned → 0
    ADDIU(R.t1, R.zero, 3),
    SLT(R.a0, R.t0, R.t1),    // 1
    SLTU(R.a1, R.t0, R.t1),   // 0
    JR_RA, NOP,
  ]);
  cpu.call(BASE, []);
  assert.equal(cpu.reg(R.v0), 1);
  assert.equal(cpu.reg(R.v1), 0);
  assert.equal(cpu.reg(R.a0), 1);
  assert.equal(cpu.reg(R.a1), 0);
});

test("movz/movn: conditional moves", () => {
  const { cpu } = boot([
    ADDIU(R.t0, R.zero, 7),
    ADDIU(R.t1, R.zero, 0),
    ADDIU(R.v0, R.zero, -1),
    MOVZ(R.v0, R.t0, R.t1),   // t1 == 0 → v0 = 7
    ADDIU(R.v1, R.zero, 0),
    ADDIU(R.t1, R.zero, 1),
    MOVN(R.v1, R.t0, R.t1),   // t1 != 0 → v1 = 7
    ADDIU(R.a0, R.zero, 9),
    ADDIU(R.t1, R.zero, 0),
    MOVN(R.a0, R.t0, R.t1),   // unchanged
    JR_RA, NOP,
  ]);
  cpu.call(BASE, []);
  assert.equal(cpu.reg(R.v0), 7);
  assert.equal(cpu.reg(R.v1), 7);
  assert.equal(cpu.reg(R.a0), 9);
});

test("mult/div: hi/lo incl. signed division and remainder signs", () => {
  const { cpu } = boot([
    ADDIU(R.t0, R.zero, -7), ADDIU(R.t1, R.zero, 2),
    DIV(R.t0, R.t1), MFLO(R.v0), MFHI(R.v1),     // -7/2 = -3 rem -1
    MULT(R.t0, R.t1), MFLO(R.a0),                 // -14
    ADDIU(R.t0, R.zero, -1), MULTU(R.t0, R.t0), MFHI(R.a1), // hi=0xfffffffe
    JR_RA, NOP,
  ]);
  cpu.call(BASE, []);
  assert.equal(cpu.reg(R.v0), -3);
  assert.equal(cpu.reg(R.v1), -1);
  assert.equal(cpu.reg(R.a0), -14);
  assert.equal(cpu.reg(R.a1) >>> 0, 0xfffffffe);
});

test("loads/stores: byte/half sign+zero extension, word rw", () => {
  const data = BASE + 0x100;
  const { cpu, mem } = boot([
    LUI(R.t0, data >>> 16), ORI(R.t0, R.t0, data & 0xffff),
    ADDIU(R.t1, R.zero, -2), SB(R.t1, 0, R.t0), SH(R.t1, 2, R.t0), SW(R.t1, 4, R.t0),
    LB(R.v0, 0, R.t0), LBU(R.v1, 0, R.t0),
    LH(R.a0, 2, R.t0), LHU(R.a1, 2, R.t0), LW(R.a2, 4, R.t0),
    JR_RA, NOP,
  ]);
  cpu.call(BASE, []);
  assert.equal(cpu.reg(R.v0), -2);
  assert.equal(cpu.reg(R.v1), 0xfe);
  assert.equal(cpu.reg(R.a0), -2);
  assert.equal(cpu.reg(R.a1), 0xfffe);
  assert.equal(cpu.reg(R.a2), -2);
  assert.equal(mem.read32(data + 4) >>> 0, 0xfffffffe);
});

test("lwl/lwr unaligned word load pair", () => {
  const data = BASE + 0x100;
  const { cpu, mem } = boot([
    LUI(R.t0, data >>> 16), ORI(R.t0, R.t0, data & 0xffff),
    LWL(R.v0, 4 + 3, R.t0), LWR(R.v0, 4, R.t0), // unaligned load at data+1..data+4? no: classic pair on addr data+1
    JR_RA, NOP,
  ]);
  // memory bytes at data+1..data+7: little-endian word 0x44332211 spread unaligned
  mem.write32(data, 0x33221100);
  mem.write32(data + 4, 0x77665544);
  cpu.call(BASE, []);
  // lwl rt,7(t0)/lwr rt,4(t0) loads the aligned word at data+4 fully
  assert.equal(cpu.reg(R.v0) >>> 0, 0x77665544);
});

test("branches with delay slots: beq/bne/bgtz/bltz taken + not-taken, delay slot always runs", () => {
  const { cpu } = boot([
    ADDIU(R.t0, R.zero, 1),
    BEQ(R.t0, R.zero, 2),          // not taken
    ADDIU(R.v0, R.v0, 1),          // delay slot: runs → v0=1
    ADDIU(R.v0, R.v0, 2),          // runs → v0=3
    BNE(R.t0, R.zero, 2),          // taken, skips the +8
    ADDIU(R.v0, R.v0, 4),          // delay slot: runs → v0=7
    ADDIU(R.v0, R.v0, 8),          // skipped
    ADDIU(R.v0, R.v0, 16),         // target → v0=23
    JR_RA, NOP,
  ]);
  cpu.call(BASE, []);
  assert.equal(cpu.reg(R.v0), 23);
});

test("backward-branch loop terminates with the right count", () => {
  const { cpu } = boot([
    ADDIU(R.t0, R.zero, 5),
    // loop: v0++ ; t0-- ; bnez t0 → loop (delay: nop)
    ADDIU(R.v0, R.v0, 1),
    ADDIU(R.t0, R.t0, -1),
    BNE(R.t0, R.zero, -3),
    NOP,
    JR_RA, NOP,
  ]);
  cpu.call(BASE, []);
  assert.equal(cpu.reg(R.v0), 5);
});

test("jal/jalr call and return; nested call preserves link via stack", () => {
  const sub = BASE + 0x40;
  const { cpu } = boot([
    ADDIU(R.sp, R.sp, -0x18), SW(R.ra, 0x10, R.sp),
    JAL(sub), NOP,
    ADDIU(R.v0, R.v0, 100),
    LW(R.ra, 0x10, R.sp), NOP,
    JR_RA, ADDIU(R.sp, R.sp, 0x18),
  ]);
  // sub at BASE+0x40: v0 = 7; jr ra
  const { mem } = { mem: cpu.mem };
  const w = [ADDIU(R.v0, R.zero, 7), JR_RA, NOP];
  const bytes = new Uint8Array(w.length * 4);
  w.forEach((x, i) => new DataView(bytes.buffer).setUint32(i * 4, x >>> 0, true));
  mem.load(bytes, sub);
  cpu.call(BASE, []);
  assert.equal(cpu.reg(R.v0), 107);
});

test("call(): args land in a0..a3, v0 returned, budget counts down", () => {
  const { cpu } = boot([ADDU(R.v0, R.a0, R.a1), JR_RA, ADDU(R.v0, R.v0, R.a2)]);
  const r = cpu.call(BASE, [10, 20, 3]);
  assert.equal(r, 33);
});

test("budget exhaustion traps", () => {
  const { cpu } = boot([J(BASE), NOP]); // infinite loop
  assert.throws(() => cpu.call(BASE, [], 1000), NativeTrap);
});

test("COP2 (GTE) is served as a no-op; COP0/1/3 still trap", () => {
  // save-screen-card-and-gte (accepted 2026-09-22): the memory-card slot
  // transition's rotation helper uses mtc2/ctc2/lwc2/swc2 and the GTE geometry
  // commands, and nothing in that path branches on the result, so COP2 is
  // host-served (register reads return 0). The other coprocessors are still
  // unsupported and must trap.
  const { cpu } = boot([(0x12 << 26) | 1, NOP, JR_RA, NOP]); // mfc2 $zero, $1
  assert.equal(cpu.call(BASE, []), 0);
  for (const op of [0x10, 0x11, 0x13]) {
    const b = boot([(op << 26) | 1, NOP, JR_RA, NOP]);
    assert.throws(() => b.cpu.call(BASE, []), NativeTrap, `COP${op - 0x10} must still trap`);
  }
});

test("unknown opcode traps with pc in the error", () => {
  const { cpu } = boot([(0x3b << 26), NOP, JR_RA, NOP]);
  try {
    cpu.call(BASE, []);
    assert.fail("should trap");
  } catch (e) {
    assert.ok(e instanceof NativeTrap);
    assert.equal(e.pc >>> 0, BASE);
  }
});

test("stub hook: pc-hooked JS function returns like jr $ra", () => {
  const STUB = 0x80014504;
  const { cpu } = boot([
    ADDIU(R.sp, R.sp, -0x18), SW(R.ra, 0x10, R.sp),
    JAL(STUB), ADDIU(R.a0, R.zero, 0x42), // delay slot sets a0
    ADDIU(R.v0, R.v0, 1),
    LW(R.ra, 0x10, R.sp), NOP,
    JR_RA, ADDIU(R.sp, R.sp, 0x18),
  ]);
  let seen = -1;
  cpu.setStub(STUB, (c) => {
    seen = c.reg(R.a0);
    return 0x99; // v0
  });
  const r = cpu.call(BASE, []);
  assert.equal(seen, 0x42);
  assert.equal(r, 0x9a);
});

test("jalr through a register hits stubs too", () => {
  const STUB = 0x8001d704;
  // a proper function: jalr links $ra, so the caller must save/restore it
  const { cpu } = boot([
    ADDIU(R.sp, R.sp, -0x18), SW(R.ra, 0x10, R.sp),
    LUI(R.t0, 0x8001), ORI(R.t0, R.t0, 0xd704),
    JALR(R.t0), NOP,
    LW(R.ra, 0x10, R.sp), NOP,
    JR_RA, ADDIU(R.sp, R.sp, 0x18),
  ]);
  cpu.setStub(STUB, () => 4);
  assert.equal(cpu.call(BASE, []), 4);
});
