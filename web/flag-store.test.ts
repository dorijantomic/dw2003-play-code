// web/flag-store.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { createFlagStore } from "./flag-store.js";

// A spy backend standing in for the engine FlagManager adapter: stored bits only.
function makeBackend(initial = {}) {
  const bits = { ...initial };
  return {
    get: (id) => (bits[id] ? 1 : 0),
    set: (id, val) => { bits[id] = val ? 1 : 0; },
    _bits: bits,
  };
}

test("stored bank (<=0x40) delegates get/set to the backend", () => {
  const be = makeBackend();
  const s = createFlagStore(be);
  assert.equal(s.get(0x400d), 0);
  s.set(0x400d, 1);
  assert.equal(s.get(0x400d), 1);
  assert.equal(be._bits[0x400d], 1);     // wrote through to the backend
});

test("bank 0x60 = ordinal equality (1 when ordinal == NN, else 0)", () => {
  let ord = 4;
  const s = createFlagStore(makeBackend(), { getOrdinal: () => ord });
  assert.equal(s.get(0x6004), 1);
  assert.equal(s.get(0x6005), 0);
  ord = 5;
  assert.equal(s.get(0x6005), 1);
});

test("bank 0x60 = null when no ordinal source (dormant, not a false 0)", () => {
  const s = createFlagStore(makeBackend());
  assert.equal(s.get(0x6004), null);
});

test("bank 0x70 op0x30 = ordinal-in-range, inclusive; open upper bound", () => {
  const table = { 0x05: { op: 0x30, ordinal_lo: 3, ordinal_hi: 8 },
                  0x06: { op: 0x30, ordinal_lo: 10, ordinal_hi: null } };
  let ord = 5;
  const s = createFlagStore(makeBackend(), { getOrdinal: () => ord, rosterTable: table });
  assert.equal(s.get(0x7005), 1);   // 3<=5<=8
  ord = 9;
  assert.equal(s.get(0x7005), 0);   // 9 > 8
  ord = 50;
  assert.equal(s.get(0x7006), 1);   // open-ended upper bound
});

test("bank 0x70 non-op30 (party/currency) = null when unmodelled (no pack source)", () => {
  const table = { 0x05: { op: 0x10, param2: 0 } };
  const s = createFlagStore(makeBackend(), { getOrdinal: () => 5, rosterTable: table });
  assert.equal(s.get(0x7005), null);
});

// bank 0x70 op0x10 case-0 (F0x80015754 case 0): get_flag(0x700N) = (DIGIMON_CUR_STATS[+0x1ED8]
// == param2). That field is the chosen starter-pack selector (0/1/2); the s212 download gate
// uses flags 0x7000/1/2 to pick the pack's variant. The walker's packIndex IS that selector.
const packRec = (v) => ({ op: 0x10, op_lo: 0, param2: v,
                          semantics: { kind: "pack_selector_equals", effect: "read", value: v } });

test("bank 0x70 op0x10 case-0 = chosen-pack selector (== param2)", () => {
  const table = { 0x00: packRec(0), 0x01: packRec(1), 0x02: packRec(2) };
  let pack = 1;                                    // pack B chosen
  const s = createFlagStore(makeBackend(), { rosterTable: table, packIndex: () => pack });
  assert.equal(s.get(0x7000), 0);                  // selector 1 != 0
  assert.equal(s.get(0x7001), 1);                  // selector 1 == 1  → pack-B download fires
  assert.equal(s.get(0x7002), 0);
  pack = 2;
  assert.equal(s.get(0x7002), 1);                  // pack-C download fires
  assert.equal(s.get(0x7001), 0);
});

test("bank 0x70 op0x10 = null when no pack chosen yet (dormant, not a false 0)", () => {
  const table = { 0x00: packRec(0) };
  assert.equal(createFlagStore(makeBackend(), { rosterTable: table, packIndex: () => -1 }).get(0x7000), null);
  assert.equal(createFlagStore(makeBackend(), { rosterTable: table }).get(0x7000), null);   // no source
});

// ── The opcodes decoded from fns.s in the 2026-07-27 pass (get-flag-banked-predicate-system.md).
// Each record's `semantics` block is what tools/extract_roster_predicate_table.py emits.

test("bank 0x70 op0x00 = AND over bank-0x80 collection entries", () => {
  // F0x8001561c subop 0 reads the pairs (A+7,B+7),(A+89,B+89),(A+167,B+167) — the same two
  // parallel arrays behind the bank-0x80 possession predicate, so hasItem answers it exactly.
  const table = { 0x3a: { op: 0x00, op_lo: 0, param2: 0,
                          semantics: { kind: "collection_all", effect: "read",
                                       collection_indices: [7, 89, 167] } } };
  const owned = new Set([7, 89]);
  const s = createFlagStore(makeBackend(), { rosterTable: table, hasItem: (b) => owned.has(b) });
  assert.equal(s.get(0x703a), 0);                  // 167 missing
  owned.add(167);
  assert.equal(s.get(0x703a), 1);
  // no inventory source at all → dormant, not a false 0
  assert.equal(createFlagStore(makeBackend(), { rosterTable: table }).get(0x703a), null);
});

test("bank 0x70 op0x10 cases 1/6/9 = obtained-partner slot tests", () => {
  const table = {
    0x10: { op: 0x11, op_lo: 1, param2: 0, semantics: { kind: "roster_owned", effect: "read", slot: 0 } },
    0x2e: { op: 0x16, op_lo: 6, param2: 0, semantics: { kind: "roster_not_owned", effect: "read", slot: 0 } },
    0x55: { op: 0x19, op_lo: 9, param2: 0, semantics: { kind: "every_slot_owned", effect: "read", slots: 8 } },
  };
  let mask = 0;
  const s = createFlagStore(makeBackend(), { rosterTable: table, ownedSlots: () => mask });
  assert.equal(s.get(0x7010), 0);
  assert.equal(s.get(0x702e), 1);                  // not owned
  mask = 0x01;
  assert.equal(s.get(0x7010), 1);
  assert.equal(s.get(0x702e), 0);
  assert.equal(s.get(0x7055), 0);
  mask = 0xff;
  assert.equal(s.get(0x7055), 1);                  // all 8 roster slots obtained
  // no roster source → dormant
  assert.equal(createFlagStore(makeBackend(), { rosterTable: table }).get(0x7010), null);
});

test("bank 0x70 op0x40 = stored-bit tallies on banks 0x1c / 0x10", () => {
  const tallyIds = [0x1c27, 0x1c28, 0x1c29, 0x1c2a, 0x1c2b, 0x1c2c, 0x1c2d];
  const table = {
    0x71: { op: 0x40, op_lo: 0, param2: 0,
            semantics: { kind: "stored_bit_tally", effect: "read", flag_ids: tallyIds,
                         test: "set_count_at_least", n: 1 } },
    0x70: { op: 0x40, op_lo: 0, param2: 1,
            semantics: { kind: "stored_bit_tally", effect: "read", flag_ids: tallyIds,
                         test: "clear_count_at_least", n: 2 } },
    0x73: { op: 0x40, op_lo: 0, param2: 2,
            semantics: { kind: "stored_bit_tally", effect: "read", flag_ids: tallyIds,
                         test: "clear_count_equals", n: 1 } },
    0x54: { op: 0x41, op_lo: 1, param2: 0,
            semantics: { kind: "stored_bits_all_set", effect: "read",
                         flag_ids: [0x100d, 0x100e, 0x100f, 0x1010] } },
  };
  const be = makeBackend();
  const s = createFlagStore(be, { rosterTable: table });
  assert.equal(s.get(0x7071), 0);                  // nothing set yet
  assert.equal(s.get(0x7070), 1);                  // 7 clear >= 2
  assert.equal(s.get(0x7073), 0);                  // 7 clear != 1
  for (const id of tallyIds) be.set(id, 1);
  assert.equal(s.get(0x7071), 1);
  assert.equal(s.get(0x7070), 0);                  // 0 clear
  be.set(0x1c2d, 0);
  assert.equal(s.get(0x7073), 1);                  // exactly 1 clear
  assert.equal(s.get(0x7054), 0);
  for (const id of [0x100d, 0x100e, 0x100f, 0x1010]) be.set(id, 1);
  assert.equal(s.get(0x7054), 1);
});

test("bank 0x70 op0x50 reads as always-true; write-effect records stay dormant", () => {
  const table = {
    0x13: { op: 0x50, op_lo: 0, param2: 0,
            semantics: { kind: "object_action", effect: "write", object_type: 0x16, returns: 1 } },
    0x31: { op: 0x13, op_lo: 3, param2: 3,
            semantics: { kind: "grant_partner", effect: "write", slot: 3, species_id: 6 } },
    0x72: { op: 0x40, op_lo: 0, param2: 3, semantics: null },   // provably constant 0 → dormant
  };
  const s = createFlagStore(makeBackend(), { rosterTable: table, ownedSlots: () => 0xff });
  assert.equal(s.get(0x7013), 1);                  // F0x80015d4c ends in `li $v0,0x1`
  assert.equal(s.get(0x7031), null);               // a write, never read as a gate
  assert.equal(s.get(0x7072), null);
});

test("banks 0x80/0x92/0x7e = null (unmodelled, not a false 0)", () => {
  const s = createFlagStore(makeBackend(), { getOrdinal: () => 5 });
  assert.equal(s.get(0x8000), null);
  assert.equal(s.get(0x9200), null);
  assert.equal(s.get(0x7e00), null);
});
