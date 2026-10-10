// Oracle for the battle actor lifecycle's teardown and the multi-hit reset
// (engine/dw3/battle-actor-lifecycle.ts).
//
// The strongest check runs the ORIGINAL instruction words out of the committed
// fightstg overlay image (web/assets/native/screens/pro_fightstg.bin, base
// 0x80082cb0) through engine/native and compares the result to the port:
//   - FIGHTSTG_F0x8008606c  the actor teardown (state 3 frees +0x78/+0x7c/+0x80)
//   - FIGHTSTG_F0x8009ddd8  the multi-hit applier's reset
// A negative control in each case proves the comparison would catch a wrong port.
//
//   F0x8008606c reads its free routine through the runtime cell [0x8004b5ec];
//   F0x8009ddd8 reads its predicate at [0x800a4580+0xa0] and its message producer
//   at [0x800a4580+0x88]. Both cells are stubbed, and the recorded call arguments
//   and the writes into the battle workspace are compared to the port's.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { NativeStageRuntime } from "../../../engine/native/runtime.ts";
import {
  ACTOR_RES_OFFSETS, MULTI_HIT_MSG_IDS, MULTI_HIT_SLOTS,
  actorTeardown, multiHitReset,
  type ActorTeardownView, type MultiHitSlot, type MultiHitState, type MultiHitManager,
} from "../../../engine/dw3/battle-actor-lifecycle.ts";

const BASE = 0x80082cb0;
const BIN = "web/assets/native/screens/pro_fightstg.bin";
const available = existsSync(BIN);
const SKIP = { skip: !available && "committed fightstg overlay image not present" };

const TEARDOWN = 0x8008606c;
const MULTIHIT = 0x8009ddd8;

const FREE_CELL = 0x8004b5ec; // [0x8005 - 0x4a14]
const MULTIHIT_BASE = 0x800a43f4;
const PRED_CELL = 0x800a4580 + 0xa0; // [0x800a4620]
const PROD_CELL = 0x800a4580 + 0x88; // [0x800a4608]
const DONE_CELL = 0x800a4435;

const OBJ = 0x80100000;
const FREE_STUB = 0x801e0000;
const PRED_STUB = 0x801e0004;
const PROD_STUB = 0x801e0008;

const overlay: Buffer = available ? readFileSync(BIN) : Buffer.alloc(0);

function runtime(): NativeStageRuntime {
  return new NativeStageRuntime(
    overlay,
    { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] },
    { setFlag() {}, getFlag: () => 0, rand16: () => 0 },
    undefined, undefined, BASE,
  );
}

// ── 1. the actor teardown F0x8008606c ───────────────────────────────────────

function runTeardown(state: number, p78: number, p7c: number, p80: number) {
  const rt = runtime();
  const m = rt.mem;
  m.write32(FREE_CELL, FREE_STUB);
  const freed: number[] = [];
  rt.cpu.setStub(FREE_STUB, (c) => { freed.push(c.reg(4) | 0); return 0; });
  m.write32(OBJ + 0x0c, state);
  m.write32(OBJ + 0x78, p78);
  m.write32(OBJ + 0x7c, p7c);
  m.write32(OBJ + 0x80, p80);
  rt.cpu.call(TEARDOWN, [OBJ], 100000);

  // The port over a matching view.
  const portFreed: number[] = [];
  const view: ActorTeardownView = {
    getState: () => state,
    getResource: (off) => (off === 0x78 ? p78 : off === 0x7c ? p7c : p80),
  };
  actorTeardown(view, (p) => portFreed.push(p));
  return { freed, portFreed };
}

test("F0x8008606c teardown: state 3 frees exactly the non-zero pointers", SKIP, () => {
  const { freed, portFreed } = runTeardown(3, 0x11110000, 0, 0x33330000);
  assert.deepEqual(freed, [0x11110000, 0x33330000], "the original frees +0x78 and +0x80");
  assert.deepEqual(portFreed, freed);
  // Negative control: the zero pointer at +0x7c is NOT freed (a port that ignored
  // the per-pointer zero test would hand 0 to free() and diverge here).
  assert.ok(!freed.includes(0), "the zero resource must not be freed");
  assert.equal(freed.length, 2);
  assert.equal(ACTOR_RES_OFFSETS.length, 3, "the teardown owns three resource slots");
});

test("F0x8008606c teardown: any state other than 3 frees nothing", SKIP, () => {
  for (const state of [0, 1, 2, 4, -1]) {
    const { freed, portFreed } = runTeardown(state, 0x11110000, 0x22220000, 0x33330000);
    assert.equal(freed.length, 0, `state ${state} must not free (original)`);
    assert.equal(portFreed.length, 0, `state ${state} must not free (port)`);
  }
  // Negative control: state 3 DOES free all three, so the guard is real.
  const all = runTeardown(3, 0x11110000, 0x22220000, 0x33330000);
  assert.deepEqual(all.freed, [0x11110000, 0x22220000, 0x33330000]);
  assert.deepEqual(all.portFreed, all.freed);
});

// ── 2. the multi-hit reset F0x8009ddd8 ──────────────────────────────────────

function runMultiHit(predAnswers: [number, number], side: number, id: number) {
  const rt = runtime();
  const m = rt.mem;
  m.write32(PRED_CELL, PRED_STUB);
  m.write32(PROD_CELL, PROD_STUB);
  let call = 0;
  rt.cpu.setStub(PRED_STUB, (c) => {
    assert.equal(c.reg(4) | 0, side, "predicate side arg");
    assert.equal(c.reg(5) | 0, id, "predicate id arg");
    return predAnswers[call++] ?? 0;
  });
  const produced: { id: number; side: number }[] = [];
  rt.cpu.setStub(PROD_STUB, (c) => {
    produced.push({ side: c.reg(4) | 0, id: c.reg(5) | 0 });
    return ((c.reg(4) | 0) * 1000 + (c.reg(5) | 0)) | 0;
  });
  m.write8(MULTIHIT_BASE + 0x20, side);
  m.write32(MULTIHIT_BASE + 0x24, id);
  m.write16(MULTIHIT_BASE + 0x34, 0x55);
  m.write8(MULTIHIT_BASE + 0x30, 0xaa);
  m.write8(MULTIHIT_BASE + 0x31, 0xaa);
  m.write32(MULTIHIT_BASE + 0x60, 0xdeadbeef | 0);
  m.write32(MULTIHIT_BASE + 0x64, 0xdeadbeef | 0);
  m.write8(DONE_CELL, 0);
  rt.cpu.call(MULTIHIT, [], 100000);

  const orig = {
    flags: [m.read8(MULTIHIT_BASE + 0x30), m.read8(MULTIHIT_BASE + 0x31)],
    captions: [m.read32(MULTIHIT_BASE + 0x60), m.read32(MULTIHIT_BASE + 0x64)],
    count: m.read16(MULTIHIT_BASE + 0x34),
    total: m.read16(MULTIHIT_BASE + 0x36),
    done: m.read8(DONE_CELL),
  };

  // The port, driven with the same predicate answers and producer.
  let pc2 = 0;
  const portFlags = [0xaa, 0xaa];
  const portCaps = [0xdeadbeef | 0, 0xdeadbeef | 0];
  const slots: MultiHitSlot[] = [0, 1].map((i) => ({
    setFlag: (v) => { portFlags[i] = v; },
    setCaption: (v) => { portCaps[i] = v; },
  }));
  const manager: MultiHitManager = {
    predicate: () => predAnswers[pc2++] ?? 0,
    produce: (s, mid) => (s * 1000 + mid) | 0,
  };
  const state: MultiHitState = { count: 0x55, total: 0, done: 0 };
  multiHitReset(slots, { side: () => side, id: () => id }, manager, state);

  const port = {
    flags: portFlags,
    captions: portCaps,
    count: state.count,
    total: state.total,
    done: state.done,
  };
  return { orig, port, produced };
}

test("F0x8009ddd8 multi-hit reset: both slots live matches the port", SKIP, () => {
  const { orig, port, produced } = runMultiHit([1, 1], 7, 42);
  assert.deepEqual(orig, port, "the original state equals the port");
  assert.deepEqual(orig.flags, [1, 1]);
  assert.deepEqual(orig.captions, [7 * 1000 + MULTI_HIT_MSG_IDS[0]!, 7 * 1000 + MULTI_HIT_MSG_IDS[1]!]);
  assert.deepEqual(produced, [
    { side: 7, id: MULTI_HIT_MSG_IDS[0]! }, { side: 7, id: MULTI_HIT_MSG_IDS[1]! },
  ]);
  assert.equal(orig.count, MULTI_HIT_SLOTS);
  assert.equal(orig.done, 1);
});

test("F0x8009ddd8 multi-hit reset: one live slot and none live match the port", SKIP, () => {
  const one = runMultiHit([1, 0], 5, 9);
  assert.deepEqual(one.orig, one.port);
  assert.deepEqual(one.orig.flags, [1, 0xaa], "only slot 0 is flagged");
  assert.deepEqual(one.orig.captions, [5 * 1000 + MULTI_HIT_MSG_IDS[0]!, 0xdeadbeef | 0]);
  assert.equal(one.orig.count, 1);

  // Negative control: no live slot writes no flags and leaves the count at 0.
  const none = runMultiHit([0, 0], 5, 9);
  assert.deepEqual(none.orig, none.port);
  assert.deepEqual(none.orig.flags, [0xaa, 0xaa], "predicate 0 must not flag a slot");
  assert.equal(none.orig.count, 0);
  assert.equal(none.orig.done, 1, "the workspace flag is set regardless");
});

/**
 * A MUTATION of the port that must fail the comparison: it drops the predicate gate,
 * producing a value and bumping the count for a slot the machine skipped. Driven with
 * the SAME stubs and the SAME predicate answers ([1,0]) as `runMultiHit`, so the two
 * must differ — which proves the oracle's equality check has teeth.
 */
function mutatedMultiHitReset(
  slots: readonly MultiHitSlot[],
  side: number,
  id: number,
  manager: MultiHitManager,
  state: MultiHitState,
): void {
  state.count = 0;
  state.total = MULTI_HIT_SLOTS;
  state.done = 0;
  for (let i = 0; i < MULTI_HIT_SLOTS; i++) {
    // MUTATION: no `manager.predicate(...) === 0` gate — every slot is written.
    slots[i]!.setFlag(1);
    slots[i]!.setCaption(manager.produce(side, MULTI_HIT_MSG_IDS[i]!) | 0);
    state.count = (state.count + 1) & 0xffff;
  }
  state.done = 1;
}

test("F0x8009ddd8 multi-hit reset: a gate-less mutation fails the oracle", SKIP, () => {
  const { orig } = runMultiHit([1, 0], 5, 9);
  const mutFlags = [0xaa, 0xaa];
  const mutCaps = [0xdeadbeef | 0, 0xdeadbeef | 0];
  const slots: MultiHitSlot[] = [0, 1].map((i) => ({
    setFlag: (v) => { mutFlags[i] = v; },
    setCaption: (v) => { mutCaps[i] = v; },
  }));
  const manager: MultiHitManager = {
    predicate: () => 0, // never consulted by the mutation
    produce: (s, mid) => (s * 1000 + mid) | 0,
  };
  const state: MultiHitState = { count: 0, total: 0, done: 0 };
  mutatedMultiHitReset(slots, 5, 9, manager, state);
  const mutant = {
    flags: mutFlags, captions: mutCaps, count: state.count, total: state.total, done: state.done,
  };
  assert.notDeepEqual(mutant, orig, "the gate-less mutation must differ from the original");
  assert.deepEqual(mutant.flags, [1, 1], "the mutation wrongly flags the dead slot 1");
  assert.equal(mutant.count, 2, "the mutation wrongly counts 2 live slots");
  assert.equal(orig.count, 1, "the original counts only the one live slot");
});
