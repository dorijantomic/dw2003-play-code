// Oracle for the battle actor pool's four-slot scan and counter-pool arm
// (engine/dw3/battle-actor-pool.ts).
//
// The strongest check runs the ORIGINAL instruction words out of the committed
// fightstg overlay image (web/assets/native/screens/pro_fightstg.bin, base
// 0x80082cb0) through engine/native and compares the result to the port:
//   - FIGHTSTG_F0x80087bf8  the four 0x4C-stride slot scan
//   - FIGHTSTG_F0x8009d0ec  the counter-pool arm
// A negative control in each case proves the comparison would catch a wrong port.
//
//   F0x80087bf8 is pure — no external call. F0x8009d0ec reads its pool allocator
//   at [0x800a3868+0xb04]; that cell is stubbed and the entry flag it writes is
//   compared to the port's.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { NativeStageRuntime } from "../../../engine/native/runtime.ts";
import {
  FIGHTER_SLOT_COUNT, FIGHTER_SLOT_STRIDE, COUNTER_POOL_STRIDE, COUNTER_POOL_REQUEST,
  findFighterSlot, armCounterPoolSlot,
  type FighterSlotPool, type CounterPool,
} from "../../../engine/dw3/battle-actor-pool.ts";

const BASE = 0x80082cb0;
const BIN = "web/assets/native/screens/pro_fightstg.bin";
const available = existsSync(BIN);
const SKIP = { skip: !available && "committed fightstg overlay image not present" };

const SCAN = 0x80087bf8;
const ARM = 0x8009d0ec;

const COUNTER_POOL_BASE = 0x800a3868;
const ALLOC_CELL = COUNTER_POOL_BASE + 0xb04; // [0x800a436c]
const SCAN_POOL = 0x80100000;
const ALLOC_STUB = 0x801e0000;

const overlay: Buffer = available ? readFileSync(BIN) : Buffer.alloc(0);

function runtime(): NativeStageRuntime {
  return new NativeStageRuntime(
    overlay,
    { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] },
    { setFlag() {}, getFlag: () => 0, rand16: () => 0 },
    undefined, undefined, BASE,
  );
}

// ── 1. the four-slot scan F0x80087bf8 ───────────────────────────────────────

type SlotSeed = { active: number; key: number };

function runScan(slots: SlotSeed[], key: number) {
  const rt = runtime();
  const m = rt.mem;
  slots.forEach((s, i) => {
    m.write32(SCAN_POOL + i * FIGHTER_SLOT_STRIDE + 0x50, s.active);
    m.write32(SCAN_POOL + i * FIGHTER_SLOT_STRIDE + 0x54, s.key);
  });
  const orig = rt.cpu.call(SCAN, [SCAN_POOL, key], 100000) | 0;
  const view: FighterSlotPool = {
    active: (i) => slots[i]?.active ?? 0,
    key: (i) => slots[i]?.key ?? 0,
  };
  const port = findFighterSlot(view, key);
  return { orig, port };
}

test("F0x80087bf8 four-slot scan: the original equals the port over a grid", SKIP, () => {
  const slots: SlotSeed[] = [
    { active: 1, key: 0x11 },
    { active: 0, key: 0x22 },
    { active: 1, key: 0x33 },
    { active: 1, key: 0x44 },
  ];
  let checked = 0;
  for (const key of [0x11, 0x22, 0x33, 0x44, 0x0, 0xff]) {
    const { orig, port } = runScan(slots, key);
    assert.equal(orig, port, `key ${key}`);
    checked++;
  }
  assert.equal(checked, 6);
  assert.equal(FIGHTER_SLOT_COUNT, 4);
  assert.equal(FIGHTER_SLOT_STRIDE, 0x4c);
  // The live flag is tested first: key 0x22 matches slot 1's key but its flag is
  // clear, so the scan skips it and answers -1.
  assert.equal(runScan(slots, 0x22).orig, -1);
  assert.equal(runScan([], 0x11).orig, -1, "an empty pool answers -1");
});

test("F0x80087bf8 four-slot scan: a matching live key answers its index", SKIP, () => {
  // Negative control for the order: put the key on a dead slot AND a live slot and
  // confirm the live one wins (a port that compared key before flag would answer 0).
  const slots: SlotSeed[] = [
    { active: 0, key: 0x33 },
    { active: 1, key: 0x33 },
    { active: 0, key: 0 },
    { active: 0, key: 0 },
  ];
  const { orig, port } = runScan(slots, 0x33);
  assert.equal(orig, 1);
  assert.equal(port, 1);
});

// ── 2. the counter-pool arm F0x8009d0ec ─────────────────────────────────────

function runArm(allocAnswer: number) {
  const rt = runtime();
  const m = rt.mem;
  m.write32(ALLOC_CELL, ALLOC_STUB);
  const requests: number[] = [];
  rt.cpu.setStub(ALLOC_STUB, (c) => { requests.push(c.reg(4) | 0); return allocAnswer | 0; });
  // Pre-clear the pool's entry flags on a scratch copy is unnecessary: the original
  // writes into the real workspace pool. Record the target flag afterwards.
  if (allocAnswer >= 0) m.write16(COUNTER_POOL_BASE + allocAnswer * COUNTER_POOL_STRIDE + 2, 0);
  rt.cpu.call(ARM, [], 100000);

  const origFlag = allocAnswer >= 0
    ? m.read16(COUNTER_POOL_BASE + allocAnswer * COUNTER_POOL_STRIDE + 2)
    : null;

  const writes: { idx: number; v: number }[] = [];
  const pool: CounterPool = { setFlag: (idx, v) => writes.push({ idx, v }) };
  const port = armCounterPoolSlot(() => allocAnswer, pool);
  const portFlag = writes.length ? writes[0]!.v : null;
  return { requests, origFlag, port, portFlag, writes };
}

test("F0x8009d0ec counter-pool arm: a live slot's +0x02 flag is set", SKIP, () => {
  const { requests, origFlag, port, portFlag, writes } = runArm(2);
  assert.deepEqual(requests, [COUNTER_POOL_REQUEST], "the allocator request size");
  assert.equal(origFlag, 1, "the original sets the entry flag to 1");
  assert.equal(port, 2);
  assert.equal(portFlag, 1);
  assert.deepEqual(writes, [{ idx: 2, v: 1 }]);
  assert.equal(COUNTER_POOL_STRIDE, 0x1c);
});

test("F0x8009d0ec counter-pool arm: a negative answer arms nothing", SKIP, () => {
  const { origFlag, port, writes } = runArm(-1);
  assert.equal(port, -1);
  assert.equal(origFlag, null, "no index to read");
  assert.deepEqual(writes, [], "the port writes no flag on a negative answer");
});
