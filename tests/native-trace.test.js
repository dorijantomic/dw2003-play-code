// Behaviour-lab hooks on the R3000 core (engine/native/mips.ts, memory.ts).
// The parity test proves the core runs real code byte-faithfully; these tests
// pin the observation surface tools/native_probe.ts relies on: call edges with
// their argument registers, returns, stores attributed to their pc, and the
// trace ring count. A silent break here would make every witness trace lie.

import { test } from "node:test";
import assert from "node:assert/strict";
import { NativeMemory } from "../engine/native/memory.ts";
import { R3000 } from "../engine/native/mips.ts";

const BASE = 0x800a5de0;

const R = { zero: 0, v0: 2, t0: 8, a0: 4, s0: 16, ra: 31 };
const imm = (op, rs, rt, i) => (op << 26) | (rs << 21) | (rt << 16) | (i & 0xffff);
const ADDIU = (rt, rs, i) => imm(0x09, rs, rt, i);
const SB = (rt, off, rs) => imm(0x28, rs, rt, off);
const OR = (rd, rs, rt) => (rs << 21) | (rt << 16) | (rd << 11) | 0x25;
const JAL = (target) => (0x03 << 26) | ((target >>> 2) & 0x03ffffff);
const JR = (rs) => (rs << 21) | 0x08;
const JR_RA = JR(R.ra);
const NOP = 0;

function boot(words, at = BASE) {
  const mem = new NativeMemory();
  const bytes = new Uint8Array(words.length * 4);
  words.forEach((w, i) => new DataView(bytes.buffer).setUint32(i * 4, w >>> 0, true));
  mem.load(bytes, at);
  return { mem, cpu: new R3000(mem) };
}

test("call, return and store hooks report the executing pcs and values", () => {
  const CALLEE = BASE + 0x20;
  const STORE = CALLEE + 0x4;
  const RETURN = CALLEE + 0x8;
  const CALL_SITE = BASE + 0x4;
  const OUTER_RETURN = BASE + 0xc;
  // A caller must preserve $ra across the call; s0 holds the root's return.
  const { mem, cpu } = boot([
    OR(R.s0, R.ra, R.zero), JAL(CALLEE), NOP,
    JR(R.s0), NOP,
    0, 0, 0,
    ADDIU(R.t0, R.zero, 1), SB(R.t0, 0, R.a0), JR_RA, NOP,
  ]);

  const calls = [];
  const returns = [];
  const writes = [];
  cpu.onCall = (caller, target, ret) => calls.push([caller, target, ret]);
  cpu.onReturn = (pc) => returns.push(pc);
  mem.onWrite = (pc, address, size, value) => writes.push([pc, address, size, value]);
  cpu.traceRing = new Int32Array(32);

  cpu.call(BASE, [0x80100000]);
  assert.deepEqual(calls, [[CALL_SITE, CALLEE, OUTER_RETURN]]);
  assert.deepEqual(returns, [RETURN]);
  assert.deepEqual(writes, [[STORE, 0x80100000, 1, 1]]);
  assert.equal(mem.read8(0x80100000), 1);
  assert.equal(cpu.traceWritten(), 9);

  const ring = [];
  for (let i = 0; i < cpu.traceWritten(); i++) ring.push(cpu.traceRing[i] >>> 0);
  assert.deepEqual(
    ring,
    [BASE, BASE + 4, BASE + 8, CALLEE, STORE, RETURN, RETURN + 4,
     OUTER_RETURN, OUTER_RETURN + 4],
  );
});

test("hooks are inert unless installed", () => {
  const { mem, cpu } = boot([
    ADDIU(R.t0, R.zero, 7), SB(R.t0, 0, R.a0), JR_RA, NOP,
  ]);
  cpu.call(BASE, [0x80100010]);
  assert.equal(mem.read8(0x80100010), 7);
  // No traceRing, no hooks: the counter still reports zero and nothing threw.
  assert.equal(cpu.traceWritten(), 0);
});
