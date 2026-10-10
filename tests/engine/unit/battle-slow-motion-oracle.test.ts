// Oracle for the battle's slow-motion stepper (engine/dw3/battle-slow-motion.ts).
//
// Runs the ORIGINAL words of FIGHTSTG_F0x8009e428 (and the setter F0x8009e510) out of the
// committed fightstg overlay through engine/native, with the raw-delta accessor at
// 0x8004df9c stubbed, then drives the port over the SAME memory model and compares the word
// the routine publishes (0x800a4464) and the accumulator it carries (0x800a4540), frame by
// frame so the 1..4 remainder is exercised. A negative control mutates the accumulator cost
// and shows the comparison FAILS, so the oracle discriminates.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { NativeStageRuntime } from "../../../engine/native/runtime.ts";
import {
  slowMotionStep, setSlowMotion,
  SLOW_MO_LEVEL, SLOW_MO_ACCUM, SLOW_MO_PUBLISH, FRAME_DELTA_CELL,
} from "../../../engine/dw3/battle-slow-motion.ts";

const BASE = 0x80082cb0;
const BIN = "web/assets/native/screens/pro_fightstg.bin";
const EXE_TABLES = "web/assets/native/exe_tables.json";
const available = existsSync(BIN) && existsSync(EXE_TABLES);
const SKIP = { skip: !available && "committed fightstg overlay image not present" };

const STEPPER = 0x8009e428;
const SETTER = 0x8009e510;
const DELTA_STUB = 0x80104000;

const overlay: Buffer = available ? readFileSync(BIN) : Buffer.alloc(0);
const exeTables = available
  ? JSON.parse(readFileSync(EXE_TABLES, "utf8")) as { sin_table_base: number; halfwords: number[] }
  : undefined;

function runtime(delta: number): NativeStageRuntime {
  const rt = new NativeStageRuntime(
    overlay,
    { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] },
    { setFlag() {}, getFlag: () => 0, rand16: () => 0 },
    exeTables, undefined, BASE,
  );
  rt.mem.write32(FRAME_DELTA_CELL, DELTA_STUB);
  rt.cpu.setStub(DELTA_STUB, () => delta);
  return rt;
}

/** Run the original stepper one frame and return [publish, accum]. */
function originalFrame(rt: NativeStageRuntime, level: number): [number, number] {
  rt.mem.write32(SLOW_MO_LEVEL, level);
  rt.mem.write32(SLOW_MO_PUBLISH, 0xdeadbeef | 0);
  rt.cpu.call(STEPPER, [], 300_000);
  return [rt.mem.read32(SLOW_MO_PUBLISH) | 0, rt.mem.read32(SLOW_MO_ACCUM) | 0];
}

test("slow-motion F0x8009e428: each level publishes the port's word, frame by frame", SKIP, () => {
  const delta = 1;
  for (const level of [0, 1, 2, 3]) {
    const rt = runtime(delta);
    rt.mem.write32(SLOW_MO_ACCUM, 0);
    let acc = 0;
    for (let frame = 0; frame < 12; frame++) {
      const [pub, oacc] = originalFrame(rt, level);
      const p = slowMotionStep(level, delta, acc);
      assert.equal(pub, p.delta, `level ${level} frame ${frame}: publish word`);
      assert.equal(oacc, p.acc, `level ${level} frame ${frame}: accumulator`);
      assert.equal(oacc, rt.mem.read32(SLOW_MO_ACCUM) | 0, "the original carried it in memory");
      acc = p.acc;
    }
  }
});

test("slow-motion level 2: one unit every fourth frame at delta 1", SKIP, () => {
  const rt = runtime(1);
  rt.mem.write32(SLOW_MO_ACCUM, 0);
  const pub: number[] = [];
  let acc = 0;
  for (let frame = 0; frame < 9; frame++) {
    const [p, oa] = originalFrame(rt, 2);
    acc = slowMotionStep(2, 1, acc).acc;
    pub.push(p);
    assert.equal(oa, acc);
  }
  assert.deepEqual(pub, [0, 0, 0, 0, 1, 0, 0, 0, 1], `original publishes ${pub}`);
});

test("slow-motion setter F0x8009e510 stores the level, resets the accumulator, runs one step", SKIP, () => {
  for (const level of [0, 1, 2, 3]) {
    const rt = runtime(1);
    rt.mem.write32(SLOW_MO_LEVEL, 0x7f);
    rt.mem.write32(SLOW_MO_ACCUM, 0x7f);
    rt.mem.write32(SLOW_MO_PUBLISH, 0);
    rt.cpu.call(SETTER, [level], 300_000);
    const s = setSlowMotion(level, 1);
    assert.equal(rt.mem.read32(SLOW_MO_LEVEL) | 0, level, "level stored");
    // The setter zeroes the accumulator and then runs one step, so what remains is the
    // step's own carried accumulator (1 at level 2 with delta 1), not 0.
    assert.equal(rt.mem.read32(SLOW_MO_ACCUM) | 0, s.acc, "accumulator after the arming step");
    assert.equal(rt.mem.read32(SLOW_MO_PUBLISH) | 0, s.delta, "published word");
  }
});

test("NEGATIVE CONTROL: a mutated accumulator cost no longer matches the original", SKIP, () => {
  // A one-line mutation of the stepper: emit one unit every THREE accumulated, not four.
  const mutated = (level: number, delta: number, acc: number) => {
    if ((level | 0) === 1) return { delta: 0, acc };
    if ((level | 0) === 3) return { delta: delta * 2, acc };
    if ((level | 0) !== 2) return { delta, acc };
    let a = (acc | 0) + delta;
    let out = 0;
    while (a >= 5) { out += 1; a -= 3; }
    return { delta: out, acc: a };
  };
  const rt = runtime(1);
  rt.mem.write32(SLOW_MO_ACCUM, 0);
  let acc = 0, mismatches = 0;
  for (let frame = 0; frame < 12; frame++) {
    const [pub, oacc] = originalFrame(rt, 2);
    const m = mutated(2, 1, acc);
    if (pub !== m.delta || oacc !== m.acc) mismatches++;
    acc = m.acc;
  }
  assert.ok(mismatches > 0, `mutation must disagree with the original (mismatches=${mismatches})`);
});
