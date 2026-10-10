// Oracle for the enemy-id resolver (engine/dw3/battle-enemy-id.ts).
//
// Runs the ORIGINAL words of FIGHTSTG_F0x8009b864 (the index scan) and FIGHTSTG_F0x8009b8d0
// (the resolver) out of the committed fightstg overlay through engine/native, with the
// resource accessor [0x80044f4c] pointed at a table this test lays down. The oracle compares
// the scan's index and the resolver's returned record pointer to the port. A negative control
// mutates the record stride (0x46 -> 0x45) and shows the comparison FAILS.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { NativeStageRuntime } from "../../../engine/native/runtime.ts";
import {
  enemyStatsIndex, enemyStatsBlock, ENEMY_STATS_PACK, ENEMY_STATS_STRIDE,
} from "../../../engine/dw3/battle-enemy-id.ts";

const BASE = 0x80082cb0;
const BIN = "web/assets/native/screens/pro_fightstg.bin";
const EXE_TABLES = "web/assets/native/exe_tables.json";
const available = existsSync(BIN) && existsSync(EXE_TABLES);
const SKIP = { skip: !available && "committed fightstg overlay image not present" };

const SCAN = 0x8009b864;
const RESOLVE = 0x8009b8d0;
const RESOURCE_CELL = 0x80044f4c;
const TABLE = 0x80120000;
const IDS = [0x33, 0x10, 0x01, 0x00];   // the last is the zero terminator

const overlay: Buffer = available ? readFileSync(BIN) : Buffer.alloc(0);
const exeTables = available
  ? JSON.parse(readFileSync(EXE_TABLES, "utf8")) as { sin_table_base: number; halfwords: number[] }
  : undefined;

function runtime(): NativeStageRuntime {
  const rt = new NativeStageRuntime(
    overlay,
    { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] },
    { setFlag() {}, getFlag: () => 0, rand16: () => 0 },
    exeTables, undefined, BASE,
  );
  for (let i = 0; i < IDS.length; i++) rt.mem.write16(TABLE + i * ENEMY_STATS_STRIDE, IDS[i]! & 0xffff);
  const fetch = rt.mem.read32(RESOURCE_CELL) >>> 0;
  assert.notEqual(fetch, 0, "the runtime seeded the resource accessor cell");
  rt.cpu.setStub(fetch, () => TABLE);
  return rt;
}

const readId = (rt: NativeStageRuntime) => (i: number) =>
  rt.mem.read16s(TABLE + i * ENEMY_STATS_STRIDE) & 0xffff;

test("enemy-id scan F0x8009b864: index of every id, and -1 past the terminator", SKIP, () => {
  const rt = runtime();
  assert.equal(ENEMY_STATS_PACK, 0x1cf);
  for (const id of [0x33, 0x10, 0x01]) {
    const orig = rt.cpu.call(SCAN, [id], 300_000) | 0;
    const port = enemyStatsIndex(readId(rt), id);
    assert.equal(orig, port, `scan id ${id}: original ${orig} vs port ${port}`);
  }
  // An id not in the table: the original walks to the zero terminator and returns -1.
  for (const id of [0x99, 0x02]) {
    const orig = rt.cpu.call(SCAN, [id], 300_000) | 0;
    assert.equal(orig, -1, `scan id ${id} not found`);
    assert.equal(enemyStatsIndex(readId(rt), id), -1);
  }
});

test("enemy-id resolver F0x8009b8d0: base + index*0x46, or 0 when not found", SKIP, () => {
  const rt = runtime();
  assert.equal(ENEMY_STATS_STRIDE, 0x46);
  for (const id of [0x33, 0x10, 0x01]) {
    const orig = rt.cpu.call(RESOLVE, [id], 300_000) >>> 0;
    const port = enemyStatsBlock(TABLE, readId(rt), id) >>> 0;
    assert.equal(orig, port, `resolve id ${id}: original ${orig} vs port ${port}`);
    assert.ok(orig >= TABLE, `the record is inside the table (${orig.toString(16)})`);
  }
  for (const id of [0x99, 0x02]) {
    assert.equal(rt.cpu.call(RESOLVE, [id], 300_000) | 0, 0, `resolve id ${id} not found -> 0`);
  }
});

test("NEGATIVE CONTROL: a mutated stride no longer matches the original", SKIP, () => {
  const rt = runtime();
  const id = 0x01;          // the third record: index 2, so stride matters
  const orig = rt.cpu.call(RESOLVE, [id], 300_000) >>> 0;
  const mutated = (TABLE + 2 * 0x45) >>> 0;   // one byte short
  assert.notEqual(orig, mutated, "mutation must disagree with the original");
});
