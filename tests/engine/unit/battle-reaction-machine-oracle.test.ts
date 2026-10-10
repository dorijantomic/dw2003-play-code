// Oracle for the damage-reaction machine's case bodies
// (engine/dw3/battle-reaction-dispatch.ts, runReactionMachine).
//
// The check runs the ORIGINAL FIGHTSTG_F0x8008d3b4 instruction words out of the committed
// fightstg overlay image (web/assets/native/screens/pro_fightstg.bin, base 0x80082cb0) with
// the resident EXE image (resident.bin, base 0x80010000) loaded under it, through
// engine/native. The console services the machine borrows are stubbed exactly as the
// original's own runtime supplies them:
//   F0x8008c910  the action-actor allocator         -> one fixed scratch child
//   [0x8004dc0c] the signed random word             -> one fixed value
//   [0x800a4600] the two-sided push service         -> one fixed pair record
//   [0x800a4608] the kind-0x5a roll service         -> one fixed record
//   [0x80042b98] the 0x2b..0x2e motion service      -> one fixed record
//   0x800aa9f0 / 0x800aabf0 / 0x800aab10 / 0x800aaba0 recorded
// The guard bytes (0x80042b5f/62/63) and the fixed motion record (0x8004356c) are seeded
// from the disc. Every field the machine writes is compared against the port, over a grid
// of kinds and states. A mutation control proves the comparison would catch a wrong port.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { NativeStageRuntime } from "../../../engine/native/runtime.ts";
import {
  runReactionMachine, REACTION_KIND_BASE, REACTION_MOTION_RECORD,
  REACTION_GUARD_HIT, REACTION_GUARD_PUSH_A, REACTION_GUARD_PUSH_B,
  REACTION_ACTOR_TABLE, REACTION_ACTIVE_INDEX, REACTION_DEFAULT_LIST, REACTION_TURN_STATE,
  REACTION_RNG_PTR, REACTION_SERVICE_PUSH, REACTION_SERVICE_ROLL, REACTION_SERVICE_MOTION,
  type ReactionCaseHost, type ReactionCaseMemory,
} from "../../../engine/dw3/battle-reaction-dispatch.ts";

const BASE = 0x80082cb0;
const RESIDENT_BASE = 0x80010000;
const BIN = "web/assets/native/screens/pro_fightstg.bin";
const RESIDENT = "web/assets/native/screens/resident.bin";
const available = existsSync(BIN) && existsSync(RESIDENT);
const SKIP = { skip: !available && "committed fightstg/resident images not present" };

const MACHINE = 0x8008d3b4;
const ALLOC = 0x8008c910;
const FN_DAMAGE = 0x800aa9f0;
const FN_ROLL = 0x800aabf0;
const FN_EFFECT_A = 0x800aab10;
const FN_EFFECT_B = 0x800aaba0;

const PARENT = 0x80100000;
const OUT = 0x80101000;
const CHILD = 0x80102000;
const R_PTR = 0x80103000; // the service-returned record
const SVC_A = 0x801f0000; // stub for [0x800a4600]
const SVC_B = 0x801f1000; // stub for [0x800a4608]
const SVC_C = 0x801f2000; // stub for [0x80042b98]
const RNG_STUB = 0x801f3000;

const RNG = 30; // 30 % 7 = 2
const ROLL = 12; // the kind-0x5a roll amount

const overlay = available ? readFileSync(BIN) : Buffer.alloc(0);
const resident = available ? readFileSync(RESIDENT) : Buffer.alloc(0);
const MOTION_OFF = REACTION_MOTION_RECORD - RESIDENT_BASE;

/** A word memory the port writes into, seeded with the resident values it reads. */
class WordMem implements ReactionCaseMemory {
  private w = new Map<number, number>();
  read32(a: number): number { return this.w.get(a >>> 0) ?? 0; }
  read16s(a: number): number { const v = this.w.get(a >>> 0) ?? 0; return (v << 16) >> 16; }
  read16u(a: number): number { return (this.w.get(a >>> 0) ?? 0) & 0xffff; }
  read8u(a: number): number { return (this.w.get(a >>> 0) ?? 0) & 0xff; }
  write32(a: number, v: number): void { this.w.set(a >>> 0, v | 0); }
  write16(a: number, v: number): void { this.w.set(a >>> 0, v & 0xffff); }
}

interface Seed {
  kind: number; state: number; guardHit: number; guardA: number; guardB: number; turn: number;
  maxHp: number; curHp: number; rec10: number; rec12: number; pushA: number; pushB: number;
}

/** The observable set: every field the machine writes. */
interface Obs {
  out: number; side: number; clip: number; outcome: number; m68: number; m6c: number; m70: number;
  state: number; flag18: number; s74: number; s78: number; s7c: number;
  rec10: number; rec12: number; r2: number; r4: number; value: number;
  tailA: number; tailB: number;
}

/** Build the runtime with the resident image and the service stubs. */
function runtime(): { rt: NativeStageRuntime; tailA: () => number; tailB: () => number } {
  const rt = new NativeStageRuntime(
    overlay,
    { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] },
    { setFlag() {}, getFlag: () => 0, rand16: () => 0 },
    undefined, undefined, BASE,
    { image: resident, base: RESIDENT_BASE },
  );
  let tailA = 0, tailB = 0;
  rt.cpu.setStub(ALLOC, () => CHILD);
  rt.cpu.setStub(RNG_STUB, () => RNG);
  rt.cpu.setStub(SVC_A, () => R_PTR);
  rt.cpu.setStub(SVC_B, () => R_PTR);
  rt.cpu.setStub(SVC_C, () => R_PTR);
  rt.cpu.setStub(FN_DAMAGE, () => 0);
  rt.cpu.setStub(FN_ROLL, () => ROLL);
  rt.cpu.setStub(FN_EFFECT_A, () => { tailA++; return 0; });
  rt.cpu.setStub(FN_EFFECT_B, () => { tailB++; return 0; });
  rt.mem.write32(REACTION_RNG_PTR, RNG_STUB);
  rt.mem.write32(REACTION_SERVICE_PUSH, SVC_A);
  rt.mem.write32(REACTION_SERVICE_ROLL, SVC_B);
  rt.mem.write32(REACTION_SERVICE_MOTION, SVC_C);
  return { rt, tailA: () => tailA, tailB: () => tailB };
}

/** Seed both the interpreter and the port with the same scenario. */
function seed(
  w32: (a: number, v: number) => void,
  w16: (a: number, v: number) => void,
  w8: (a: number, v: number) => void,
  s: Seed,
): void {
  w32(PARENT + 0x70, s.kind | 0);
  w32(PARENT + 0x14, s.state | 0);
  w32(PARENT + 0x18, 0);
  w32(PARENT + 0x74, 0);
  w32(PARENT + 0x78, 0);
  w32(PARENT + 0x7c, 0);
  w32(OUT, 0);
  w32(REACTION_ACTIVE_INDEX, 0);
  w16(REACTION_ACTOR_TABLE + 0x6, s.maxHp | 0);
  w16(REACTION_ACTOR_TABLE + 0x8, s.curHp | 0);
  w16(REACTION_ACTOR_TABLE + 0x10, s.rec10 | 0);
  w16(REACTION_ACTOR_TABLE + 0x12, s.rec12 | 0);
  w16(R_PTR + 0x2, s.pushA | 0);
  w16(R_PTR + 0x4, s.pushB | 0);
  w8(REACTION_GUARD_HIT, s.guardHit & 0xff);
  w8(REACTION_GUARD_PUSH_A, s.guardA & 0xff);
  w8(REACTION_GUARD_PUSH_B, s.guardB & 0xff);
  w16(REACTION_TURN_STATE, s.turn | 0);
  // The per-kind default list ships zero-filled; terminate it identically in both.
  w32(REACTION_DEFAULT_LIST, 0xffff);
}

function run(s: Seed): { orig: Obs; port: Obs } {
  const { rt, tailA, tailB } = runtime();
  seed((a, v) => rt.mem.write32(a, v), (a, v) => rt.mem.write16(a, v), (a, v) => rt.mem.write8(a, v), s);
  const ret = rt.cpu.call(MACHINE, [PARENT, OUT], 400000) | 0;
  const orig = readObs((a) => rt.mem.read32(a), (a) => rt.mem.read16s(a), ret, tailA(), tailB());

  const pm = new WordMem();
  seed((a, v) => pm.write32(a, v), (a, v) => pm.write16(a, v), (a, v) => pm.write32(a, v), s);
  for (let i = 0; i < 0x12; i++) pm.write32(REACTION_MOTION_RECORD + i, resident[MOTION_OFF + i] as number);
  let pTailA = 0, pTailB = 0;
  const host: ReactionCaseHost = {
    allocateActionActor: () => CHILD,
    rng: () => RNG,
    callService: () => R_PTR,
    applyDamage: () => {},
    rollDamage: () => ROLL,
    tailEffect: (fn: number) => { if (fn === FN_EFFECT_A) pTailA++; else pTailB++; },
  };
  const res = runReactionMachine(PARENT, OUT, pm, host);
  const port = readObs((a) => pm.read32(a), (a) => pm.read16s(a), res.value, pTailA, pTailB);
  return { orig, port };
}

function readObs(
  r32: (a: number) => number, r16: (a: number) => number, value = 0, tailA = 0, tailB = 0,
): Obs {
  return {
    out: r32(OUT) >>> 0,
    side: r32(CHILD + 0x50) | 0,
    clip: r32(CHILD + 0x54) | 0,
    outcome: r32(CHILD + 0x64) | 0,
    m68: r32(CHILD + 0x68) | 0,
    m6c: r32(CHILD + 0x6c) | 0,
    m70: r32(CHILD + 0x70) | 0,
    state: r32(PARENT + 0x14) | 0,
    flag18: r32(PARENT + 0x18) | 0,
    s74: r32(PARENT + 0x74) | 0,
    s78: r32(PARENT + 0x78) | 0,
    s7c: r32(PARENT + 0x7c) | 0,
    rec10: r16(REACTION_ACTOR_TABLE + 0x10) | 0,
    rec12: r16(REACTION_ACTOR_TABLE + 0x12) | 0,
    r2: r16(R_PTR + 0x2) | 0,
    r4: r16(R_PTR + 0x4) | 0,
    value,
    tailA,
    tailB,
  };
}

const baseSeed: Seed = {
  kind: 0, state: 0, guardHit: 0, guardA: 0, guardB: 0, turn: 0,
  maxHp: 100, curHp: 100, rec10: 0, rec12: 0, pushA: 3, pushB: 9,
};

// ── the case grid: every typed kind and the default ──────────────────────────

test("F0x8008d3b4 every typed case writes the port's clip and motion slots", SKIP, () => {
  for (let i = 0; i < 14; i++) {
    const { orig, port } = run({ ...baseSeed, kind: REACTION_KIND_BASE + i });
    assert.deepEqual(port, orig, `case idx ${i} (kind 0x${(REACTION_KIND_BASE + i).toString(16)})`);
    assert.equal(orig.out >>> 0, CHILD >>> 0, `idx ${i} child`);
  }
});

test("F0x8008d3b4 the clip-14 knockback is a fifth of the fighter's max HP", SKIP, () => {
  // kind 0x55 (idx 8): the guard byte gates it and the push is maxHP/5.
  const alive = run({ ...baseSeed, kind: 0x55, maxHp: 100, curHp: 999 });
  assert.deepEqual(alive.port, alive.orig, "0x55 surviving push");
  assert.equal(alive.orig.s78, 20, "push = 100/5 = 20");
  assert.equal(alive.orig.outcome, 1, "non-lethal push -> outcome 1");

  const lethal = run({ ...baseSeed, kind: 0x55, maxHp: 100, curHp: 10 });
  assert.deepEqual(lethal.port, lethal.orig, "0x55 lethal push");
  assert.equal(lethal.orig.outcome, 2, "push would take HP below 1 -> outcome 2");
  assert.equal(lethal.orig.flag18, 1, "lethal push sets parent+0x18");

  const guarded = run({ ...baseSeed, kind: 0x55, guardHit: 1 });
  assert.deepEqual(guarded.port, guarded.orig, "0x55 guarded");
  assert.equal(guarded.orig.outcome, 3, "guard byte -> miss");
  assert.equal(guarded.orig.s78, 0, "guarded arm writes no push");
});

test("F0x8008d3b4 case 0x5a reads its motion record off the disc", SKIP, () => {
  const { orig, port } = run({ ...baseSeed, kind: 0x5a, curHp: 999 });
  assert.deepEqual(port, orig, "0x5a case");
  assert.equal(orig.m68, 0x21, "slot 0x68 = record+0x0d");
  assert.equal(orig.m6c, 0x04, "slot 0x6c = record+0x0e");
  assert.equal(orig.m70, 0x19, "slot 0x70 = record+0x0f");
  assert.equal(orig.clip, 0x0e, "clip 14");
});

test("F0x8008d3b4 case 0x54's motion is the random word modulo seven", SKIP, () => {
  const { orig, port } = run({ ...baseSeed, kind: 0x54 });
  assert.deepEqual(port, orig, "0x54 case");
  assert.equal(orig.s74, (RNG % 7) + 2, "parent+0x74 = rng%7 + 2");
  assert.equal(orig.m68, 3 * (RNG % 7) + 0x22, "slot 0x68 counts the remainder");
});

test("F0x8008d3b4 the default case and the state arms agree", SKIP, () => {
  for (const kind of [0x4c, 0x60, 0x2b, 0x47]) {
    const { orig, port } = run({ ...baseSeed, kind });
    assert.deepEqual(port, orig, `default kind 0x${kind.toString(16)}`);
    assert.equal(orig.clip, 0x0a, `default clip for 0x${kind.toString(16)}`);
  }
  const r1 = run({ ...baseSeed, kind: 0x55, state: 1 });
  assert.deepEqual(r1.port, r1.orig, "state 1 re-entry");
  const r2 = run({ ...baseSeed, kind: 0x55, state: 2 });
  assert.deepEqual(r2.port, r2.orig, "state 2 probe");
});

test("F0x8008d3b4 the two-sided push (case 0x58) matches over the push grid", SKIP, () => {
  for (const [pushA, pushB, rec10, rec12] of [
    [3, 9, 0, 0], [9, 3, 5, 5], [3, 9, 4, 0], [9, 3, 0, 4], [3, 9, -2, -2],
  ] as const) {
    const { orig, port } = run({ ...baseSeed, kind: 0x58, pushA, pushB, rec10, rec12 });
    assert.deepEqual(port, orig, `0x58 push grid (${pushA},${pushB},${rec10},${rec12})`);
  }
});

// ── the kind-source evidence: the 0x8004356c "move-data region" is a table record ──

test("the 0x8004356c region is action-record 137 of the stride-0x12 table at 0x80042bca", SKIP, () => {
  const B = 0x80042bca, STRIDE = 0x12;
  assert.equal((REACTION_MOTION_RECORD - B) % STRIDE, 0, "a record boundary");
  assert.equal((REACTION_MOTION_RECORD - B) / STRIDE, 137, "record index 137");
  // The machine reads bytes +0xd..+0xf of that record into the child's motion slots; the
  // record's own +0x0f column (the attack motion id) is NEVER in the typed reaction range
  // 0x4d..0x5a, so the region does not author the reaction kind.
  const u8 = (a: number): number => resident[a - RESIDENT_BASE] as number;
  assert.equal(u8(REACTION_MOTION_RECORD + 0xd), 0x21, "record +0x0d");
  assert.equal(u8(REACTION_MOTION_RECORD + 0xe), 0x04, "record +0x0e");
  assert.equal(u8(REACTION_MOTION_RECORD + 0xf), 0x19, "record +0x0f");
  let typed = 0;
  for (let i = 0; i < 138; i++) {
    const kind = u8(B + i * STRIDE + 0xf);
    if (kind >= 0x4d && kind <= 0x5a) typed++;
  }
  assert.equal(typed, 0, "no +0x0f column byte is a typed reaction kind");
});

test("F0x8008d3b4 the tail effect fires only at turn state 6", SKIP, () => {
  const off = run({ ...baseSeed, kind: 0x5a, turn: 0 });
  assert.deepEqual(off.port, off.orig, "turn 0: no tail effect");
  assert.equal(off.orig.tailA + off.orig.tailB, 0, "turn 0 fires nothing");

  const a = run({ ...baseSeed, kind: 0x5a, turn: 6, curHp: 999 });
  assert.deepEqual(a.port, a.orig, "turn 6, kind 0x5a");
  assert.equal(a.orig.tailA, 1, "kind 0x5a uses the 0x800aab10 hook");
  assert.equal(a.orig.tailB, 0);

  const b = run({ ...baseSeed, kind: 0x4d, turn: 6 });
  assert.deepEqual(b.port, b.orig, "turn 6, kind 0x4d");
  assert.equal(b.orig.tailB, 1, "other kinds use the 0x800aaba0 hook");
  assert.equal(b.orig.tailA, 0);
});

test("mutation control: a wrong case clip fails the comparison", SKIP, () => {
  const { orig, port } = run({ ...baseSeed, kind: 0x5a, curHp: 999 });
  assert.deepEqual(port, orig, "the honest port agrees");
  // A port that selected clip 0x12 for case 0x5a (instead of the disc record's 0x0e).
  const wrong: Obs = { ...port, clip: 0x12 };
  assert.throws(() => assert.deepEqual(wrong, orig), "a wrong clip must be caught");
  assert.notDeepEqual(wrong, orig, "the mutated arm diverges");
});
