// Oracle for the steal roll (engine/dw3/battle-steal-roll.ts).
//
// Runs the ORIGINAL words of FIGHTSTG_F0x800a1114 out of the committed fightstg overlay
// through engine/native. The routine reaches its numbers through services, so the oracle
// installs them where the routine looks: the effective stat block 0x800a4580 (written by the
// stubbed effective-stat builder F0x8009ec94), the technique record at 0x80042bca + 0x12*tech,
// the enemy id at ctx+0x70 (resolved by the stubbed [0x800a37fc]) and the RNG through
// [0x8004dc0c]. It then compares the boolean the original returns to the port over the same
// numbers, over a spread that exercises the ratio clamp, the weight shift and the roll
// boundary. A negative control mutates the threshold divisor (10000 -> 1000) and shows the
// comparison FAILS.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { NativeStageRuntime } from "../../../engine/native/runtime.ts";
import {
  stealProc, stealRatio, stealWeight, stealThreshold,
  STEAL_TECH_TABLE, STEAL_TECH_STRIDE, STEAL_TECH_WEIGHT_OFFSET, STEAL_BONUS_OFFSET,
} from "../../../engine/dw3/battle-steal-roll.ts";

const BASE = 0x80082cb0;
const BIN = "web/assets/native/screens/pro_fightstg.bin";
const EXE_TABLES = "web/assets/native/exe_tables.json";
const available = existsSync(BIN) && existsSync(EXE_TABLES);
const SKIP = { skip: !available && "committed fightstg overlay image not present" };

const STEAL = 0x800a1114;
const EFF_BUILDER = 0x8009ec94;
const CTX = 0x800a4460;
const EFF_BLOCK = 0x800a4580;
const GATE = 0x80042b61;
const RESOLVER_CELL = 0x800a37fc;
const RNG_CELL = 0x8004dc0c;   // 0x8005_0000 - 0x23f4
const RESOLVER_STUB = 0x80104020;
const RNG_STUB = 0x80104024;
const STATS = 0x80130000;
const TECH_INDEX = 7;

const overlay: Buffer = available ? readFileSync(BIN) : Buffer.alloc(0);
const exeTables = available
  ? JSON.parse(readFileSync(EXE_TABLES, "utf8")) as { sin_table_base: number; halfwords: number[] }
  : undefined;

interface Setup { level: number; effNum: number; effDen: number; techWeight: number; stealBonus: number; rng: number }

function runtime(s: Setup): NativeStageRuntime {
  const rt = new NativeStageRuntime(
    overlay,
    { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] },
    { setFlag() {}, getFlag: () => 0, rand16: () => 0 },
    exeTables, undefined, BASE,
  );
  rt.mem.write8(GATE, 0);                                    // 0x80042b61 gate byte = 0
  rt.mem.write32(CTX + 0xc, 0);                              // active slot index 0
  rt.mem.write16(CTX + 0x88, 1);                             // slot gate > 0
  rt.mem.write16(CTX + 0x70, 0x33);                          // the slot's enemy id
  // effective stat builder: write the routine's own fields into 0x800a4580 and return it.
  rt.cpu.setStub(EFF_BUILDER, () => {
    rt.mem.write16(EFF_BLOCK + 0xa, s.effNum & 0xffff);
    rt.mem.write16(EFF_BLOCK + 0x4a, s.effDen & 0xffff);
    rt.mem.write16(EFF_BLOCK + STEAL_BONUS_OFFSET, s.stealBonus & 0xffff);
    return EFF_BLOCK;
  });
  // technique record: weight at 0x80042bca + 0x12*tech + 0xb.
  rt.mem.write8(STEAL_TECH_TABLE + TECH_INDEX * STEAL_TECH_STRIDE + STEAL_TECH_WEIGHT_OFFSET, s.techWeight & 0xff);
  // enemy id -> stats (level at +4).
  rt.mem.write16(STATS + 4, s.level & 0xffff);
  rt.mem.write32(RESOLVER_CELL, RESOLVER_STUB);
  rt.cpu.setStub(RESOLVER_STUB, () => STATS);
  // RNG.
  rt.mem.write32(RNG_CELL, RNG_STUB);
  rt.cpu.setStub(RNG_STUB, () => s.rng | 0);
  return rt;
}

function runOriginal(s: Setup): number {
  return runtime(s).cpu.call(STEAL, [0, TECH_INDEX], 300_000) | 0;
}

const CASES: Setup[] = [
  { level: 10, effNum: 128, effDen: 64, techWeight: 30, stealBonus: 0, rng: 8 },      // ratio 200, thr 9 -> hit
  { level: 10, effNum: 128, effDen: 64, techWeight: 30, stealBonus: 0, rng: 9 },      // thr 9 -> miss
  { level: 10, effNum: 128, effDen: 64, techWeight: 30, stealBonus: 0, rng: 0x3ff },  // miss
  { level: 50, effNum: 40, effDen: 80, techWeight: 10, stealBonus: 32, rng: 15 },     // ratio 50, w 42, thr 16 -> hit
  { level: 50, effNum: 40, effDen: 80, techWeight: 10, stealBonus: 32, rng: 16 },     // thr 16 -> miss
  { level: 99, effNum: 128, effDen: 1, techWeight: 255, stealBonus: 64, rng: 985 },   // clamp 200, thr 986 -> hit
  { level: 99, effNum: 128, effDen: 1, techWeight: 255, stealBonus: 64, rng: 986 },   // miss
  { level: 1, effNum: 100, effDen: 100, techWeight: 4, stealBonus: 64, rng: 5 },      // ratio 100, thr 6 -> hit
  { level: 1, effNum: 100, effDen: 100, techWeight: 4, stealBonus: 64, rng: 6 },      // miss
];

test("steal roll F0x800a1114: the original's boolean equals the port's, per case", SKIP, () => {
  for (const s of CASES) {
    const orig = runOriginal(s);
    const port = stealProc(s.level, s.effNum, s.effDen, s.techWeight, s.stealBonus, s.rng) ? 1 : 0;
    const label = `level=${s.level} eff=${s.effNum}/${s.effDen} w=${s.techWeight}+${s.stealBonus} rng=${s.rng}`;
    assert.equal(orig, port, `${label}: original ${orig} vs port ${port}`);
  }
});

test("steal roll: the ratio clamps at 200 and the weight is (100*w)>>6", SKIP, () => {
  assert.equal(stealRatio(128, 64), 200);
  assert.equal(stealRatio(128, 1), 200, "ratio clamped to 200");
  assert.equal(stealRatio(40, 80), 50);
  assert.equal(stealWeight(30, 0), 46, "(100*30)/64 truncated");
  assert.equal(stealWeight(10, 32), 65, "(100*42)/64 truncated");
  assert.equal(stealThreshold(10, 200, 30, 0), 9);
  // Drive the clamp through the original: effNum/effDen far above 2 rolls the CAPPED threshold.
  const s: Setup = { level: 10, effNum: 4000, effDen: 1, techWeight: 30, stealBonus: 0, rng: 8 };
  assert.equal(runOriginal(s), 1, "8 < the capped threshold 9");
  assert.equal(stealProc(s.level, s.effNum, s.effDen, s.techWeight, s.stealBonus, s.rng), true);
});

test("NEGATIVE CONTROL: a mutated divisor (10000 -> 1000) no longer matches the original", SKIP, () => {
  const s: Setup = { level: 10, effNum: 128, effDen: 64, techWeight: 30, stealBonus: 0, rng: 50 };
  const orig = runOriginal(s);                                    // threshold 9 at /10000 -> miss
  const mutantThreshold = Math.trunc((s.level * 200 * stealWeight(s.techWeight, s.stealBonus)) / 1000);  // 90
  const mutant = ((s.rng & 0x3ff) < mutantThreshold) ? 1 : 0;     // 50 < 90 -> hit
  assert.equal(orig, 0, "original misses at rng 50 (threshold 9)");
  assert.notEqual(orig, mutant, `mutation must disagree with the original (mutant ${mutant})`);
});
