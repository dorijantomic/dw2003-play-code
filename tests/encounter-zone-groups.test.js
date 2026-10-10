// Zone GROUPS — scene_struct+0x20 holds ONE selector record, not a flat zone array.
//
// Authority: original SLES-03936 assembly, ~/ddw3/asm/dw2003/pro/wstagNNN.s
// (overlay RAM base 0x800a5de0), re-derived per stage by interpreting the init MIPS in
// tools/extract_stage_encounters.py. The record is
//     { u32 tag; u32 key; u32 zero; ZoneBlock *zone[4]; }   // 0x1c
// so the flat overlay-order block list is group-major:  index = group*4 + (zone-1).
//
// These tests run against the SHIPPED web/assets/data/stage_encounters.json, so they
// lock the real numbers, not a fixture.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  encounterGroupIndex, stageZoneBlocks, selectScreenId, zoneRateLevel,
} from "../engine/index.ts";

const DB = JSON.parse(readFileSync("web/assets/data/stage_encounters.json", "utf8"));
const stage = (n) => DB.stages[String(n)];

// slot 0 every time — we are testing WHICH block is read, not the rand()&7 pick.
const slot0 = () => 0;

// --------------------------------------------------------------------------
// s335 (Wire Forest) — the keystone multi-group stage: 12 blocks = 3 records.
// wstag335.s file 0x1cc-0x224:  lw $v1, -0x4c90($v0){lui 0x8005} = [0x8004b370]
//   slti $v0, $v1, 0xb   -> record 0x800a664c   (group 0)
//   slti $v0, $v1, 0x18  -> record 0x800a6668   (group 1)
//   else                    record 0x800a6684   (group 2)
//   sw   $v0, 0x20($s1)
// --------------------------------------------------------------------------

test("s335 ships three group-major selector records with the literal slti bands", () => {
  const s = stage(335);
  assert.equal(s.zones.length, 12);
  assert.deepEqual(s.groups.map((g) => g.blocks),
                   [[0, 1, 2, 3], [4, 5, 6, 7], [8, 9, 10, 11]]);
  assert.deepEqual(s.groups.map((g) => g.key), [0, 1, 2]);
  assert.deepEqual(s.selector, {
    family: "progress_ordinal", var: "0x8004b370", site: "0x1d0",
    thresholds: [11, 24], groups: [0, 1, 2],
  });
});

test("s335 zone 1 resolves to a different pool per story ordinal", () => {
  const s = stage(335);
  // The three records' zone-1 pools, as shipped (group-major flat indices 0/4/8).
  assert.deepEqual(s.zones[0].slots, [34, 34, 34, 34, 35, 35, 35, 35]);
  assert.deepEqual(s.zones[4].slots, [48, 48, 48, 48, 48, 48, 35, 35]);
  assert.deepEqual(s.zones[8].slots, [48, 48, 146, 146, 146, 146, 146, 146]);

  const at = (ord) => selectScreenId(s.zones, 1, slot0, stageZoneBlocks(s, ord));
  for (const ord of [0, 1, 10]) assert.equal(at(ord), 34, `ordinal ${ord} -> group 0`);
  for (const ord of [11, 12, 23]) assert.equal(at(ord), 48, `ordinal ${ord} -> group 1`);
  for (const ord of [24, 45, 63]) assert.equal(at(ord), 48, `ordinal ${ord} -> group 2`);
  // group 1 and group 2 share slot 0; slot 2 separates them (48 vs 146).
  const slot2 = () => 2;
  assert.equal(selectScreenId(s.zones, 1, slot2, stageZoneBlocks(s, 11)), 48);
  assert.equal(selectScreenId(s.zones, 1, slot2, stageZoneBlocks(s, 24)), 146);
});

test("s335 group index is the exact threshold step function", () => {
  const s = stage(335);
  for (let ord = 0; ord < 64; ord++)
    assert.equal(encounterGroupIndex(s, ord), ord < 11 ? 0 : ord < 24 ? 1 : 2,
                 `ordinal ${ord}`);
});

test("s335 rate level follows the live group, not the flat array", () => {
  const s = stage(335);
  // Every record's zone 3 is the all-empty level-0 block; zones 1/2 are level 3.
  for (const [ord, base] of [[0, 0], [11, 4], [24, 8]]) {
    const blocks = stageZoneBlocks(s, ord);
    assert.deepEqual(blocks, [base, base + 1, base + 2, base + 3]);
    assert.equal(zoneRateLevel(s.zones, 1, blocks), 3);
    assert.equal(zoneRateLevel(s.zones, 3, blocks), 0);
    assert.equal(zoneRateLevel(s.zones, 5, blocks), 0); // past the record's four zones
  }
});

// --------------------------------------------------------------------------
// Single-group stages: STRICTLY unchanged. 164 of the 203 stages.
// --------------------------------------------------------------------------

test("single-group stages ship no groups/selector key at all", () => {
  const single = Object.entries(DB.stages).filter(([, s]) => !s.groups);
  assert.equal(single.length, 164);
  for (const [id, s] of single) {
    assert.equal(s.selector, undefined, `s${id}`);
    assert.equal(s.zones.length, 4, `s${id}`);
    assert.deepEqual(Object.keys(s), ["zones"], `s${id}`);
  }
});

test("single-group stages are ordinal-invariant and index positionally", () => {
  for (const [id, s] of Object.entries(DB.stages)) {
    if (s.groups) continue;
    for (const ord of [0, 10, 11, 24, 45]) {
      assert.equal(encounterGroupIndex(s, ord), 0, `s${id} @${ord}`);
      assert.equal(stageZoneBlocks(s, ord), undefined, `s${id} @${ord}`);
    }
    for (let zone = 1; zone <= 4; zone++) {
      // Same result as the pre-group call form (no `blocks` argument).
      assert.equal(selectScreenId(s.zones, zone, slot0, stageZoneBlocks(s, 45)),
                   selectScreenId(s.zones, zone, slot0), `s${id} zone ${zone}`);
      assert.equal(zoneRateLevel(s.zones, zone, stageZoneBlocks(s, 45)),
                   zoneRateLevel(s.zones, zone), `s${id} zone ${zone}`);
    }
  }
});

test("s200 keystone is untouched by the group change", () => {
  const s = stage(200);
  assert.equal(s.groups, undefined);
  assert.ok(s.zones.some((z) => z.slots.join() === [188, 200, 272, 0, 0, 0, 0, 0].join()));
});

// --------------------------------------------------------------------------
// FAMILY B — runtime_key. Decoded family, UNDECODED selecting value: the init
// hands the record table to the fieldstg scene_struct+0x7c helper, which matches
// a record by its `key` word, and that key's writer is not identified. These
// stages must keep the pre-2026-07-27 behaviour (first record) — never a guess.
// --------------------------------------------------------------------------

test("runtime_key stages are marked unresolved and default to the first record", () => {
  const keyed = Object.entries(DB.stages)
    .filter(([, s]) => s.selector?.family === "runtime_key");
  assert.equal(keyed.length, 27);
  for (const [id, s] of keyed) {
    assert.equal(s.selector.unresolved, true, `s${id}`);
    assert.equal(s.selector.thresholds, undefined, `s${id}`);
    assert.equal(s.selector.var, "0x80048d78", `s${id}`);  // the bank-0x7E scalar
    for (const ord of [0, 11, 24, 45]) {
      assert.equal(encounterGroupIndex(s, ord), 0, `s${id} @${ord}`);
      assert.deepEqual(stageZoneBlocks(s, ord), [0, 1, 2, 3], `s${id} @${ord}`);
      // Identical to the flat positional read the walker did before.
      for (let zone = 1; zone <= 4; zone++)
        assert.equal(selectScreenId(s.zones, zone, slot0, stageZoneBlocks(s, ord)),
                     selectScreenId(s.zones, zone, slot0), `s${id} zone ${zone}`);
    }
  }
});

// --------------------------------------------------------------------------
// Whole-table structural invariants (the extractor asserts these too).
// --------------------------------------------------------------------------

test("every stage partitions into group-major records of exactly four blocks", () => {
  let multi = 0;
  for (const [id, s] of Object.entries(DB.stages)) {
    assert.equal(s.zones.length % 4, 0, `s${id} block count`);
    if (!s.groups) { assert.equal(s.zones.length, 4, `s${id}`); continue; }
    multi++;
    assert.equal(s.groups.length * 4, s.zones.length, `s${id}`);
    s.groups.forEach((g, i) => assert.deepEqual(
      g.blocks, [4 * i, 4 * i + 1, 4 * i + 2, 4 * i + 3], `s${id} group ${i}`));
    const sel = s.selector;
    assert.ok(sel, `s${id} has groups but no selector`);
    if (sel.family === "progress_ordinal") {
      assert.equal(sel.var, "0x8004b370", `s${id}`);
      assert.equal(sel.groups.length, sel.thresholds.length + 1, `s${id}`);
      assert.deepEqual(sel.groups, s.groups.map((_, i) => i), `s${id}`);
      // Thresholds strictly increasing, inside the ordinal ladder's 1..45 domain.
      sel.thresholds.forEach((t, i) => {
        assert.ok(t > (sel.thresholds[i - 1] ?? 0) && t <= 46, `s${id} threshold ${t}`);
      });
    }
  }
  assert.equal(multi, 39);
});

test("progress_ordinal stages are exactly the twelve verified wstag overlays", () => {
  const fam = Object.entries(DB.stages)
    .filter(([, s]) => s.selector?.family === "progress_ordinal")
    .map(([id]) => Number(id)).sort((a, b) => a - b);
  assert.deepEqual(fam, [335, 340, 345, 350, 355, 370, 375, 380, 400, 445, 450, 480]);
});

// The literal `slti` constants, transcribed from each overlay's disassembly. A
// change here means the extractor's MIPS interpretation drifted from the ROM.
test("verified slti thresholds per stage", () => {
  const expected = {
    335: [11, 24], 340: [11], 345: [11], 350: [11, 24], 355: [11, 24],
    370: [14], 375: [14], 380: [11, 24], 400: [14], 445: [24], 450: [24],
    480: [10, 24],
  };
  for (const [id, thresholds] of Object.entries(expected))
    assert.deepEqual(stage(id).selector.thresholds, thresholds, `s${id}`);
});
