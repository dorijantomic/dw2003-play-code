// Fusion Lab bosses (NEW content): the N-donor stat rule, the AI rows for refilled technique slots,
// and the private-file merge. Pure rules of web/fusion.js; no disc data, no private file needed.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  blendStats, blendValues, ensureAiRows, fusedAiMoves, fusedRecord, fusionOnDefeat, labBossParty, labBossValid,
  mergeLabBosses, partyEntriesFor,
} from "../web/fusion.js";

const row = (str, def, spt, wis, spd) => ({ str, def, spt, wis, spd });

test("two Digimon: the original rule, max + a quarter of the smaller", () => {
  const out = blendStats(row(520, 735, 329, 612, 392), row(490, 520, 500, 520, 416));
  assert.deepEqual(out, { str: 643, def: 865, spt: 582, wis: 742, spd: 514 });
  assert.deepEqual(blendStats([row(520, 735, 329, 612, 392), row(490, 520, 500, 520, 416)]), out);
});

test("three or more: max + a quarter of the SECOND largest, the rest add nothing", () => {
  assert.equal(blendValues([100, 400, 200, 300]), 475);
  assert.equal(blendValues([7]), 7);
  assert.equal(blendValues([]), 0);
  const out = blendStats(row(100, 1, 1, 1, 1), row(400, 1, 1, 1, 1), row(200, 1, 1, 1, 1));
  assert.equal(out.str, 450);
});

test("fusedRecord keeps its authored-boss behaviour and takes any number of halves", () => {
  const a = row(100, 100, 100, 100, 100), b = row(200, 200, 200, 200, 200), c = row(50, 50, 50, 50, 50);
  const two = fusedRecord({ halves: [a, b], body: "A", level: 10, hp: 500, statScale: 16, moves: [1, 2, 3] });
  assert.equal(two.stats.str, 225);
  const three = fusedRecord({ halves: [a, b, c], body: "A", level: 10, hp: 500, statScale: 32, moves: [1, 2, 3] });
  assert.equal(three.stats.str, 450, "(200 + 25) * 32/16");
  assert.deepEqual(two.ai_moves, fusedAiMoves(undefined));
});

test("ensureAiRows adds a row only for a refilled slot nobody calls", () => {
  const rows = [{ action: 1, comparator: 0, value: 0 }, { action: 2, comparator: 1, value: 5 }, { action: 2, comparator: 0, value: 0 }, { action: 1, comparator: 0, value: 0 }];
  assert.deepEqual(ensureAiRows(rows, [10, 20, 0]).map((r) => r.action), [1, 2, 2, 1], "every filled slot already called: unchanged");
  const out = ensureAiRows(rows, [10, 20, 30]);
  assert.deepEqual(out.map((r) => r.action), [1, 2, 2, 3], "move_2 gets the last repeated row");
  assert.equal(out[3].comparator, 0, "the row keeps its own condition");
  assert.deepEqual(rows.map((r) => r.action), [1, 2, 2, 1], "input untouched");
  const onlyOnes = Array.from({ length: 4 }, () => ({ action: 1, comparator: 0, value: 0 }));
  assert.deepEqual(ensureAiRows(onlyOnes, [1, 2, 3]).map((r) => r.action), [1, 1, 3, 2]);
});

const rec = (over = {}) => ({
  id: "lab_m899test1", lab: true, displayName: "Testmon", body: "Kimeramon", modelFolder: "m899test1",
  halves: ["Kimeramon", "Meramon"], level: 60, hp: 3000, statScale: 20, moves: [298, 166, 138],
  party: { id: 237, level: 60, hp: 2000, mp: 9999, stat_scale: 20 }, ...over,
});

test("labBossValid: shape and model folder only", () => {
  assert.equal(labBossValid(rec()), true);
  assert.equal(labBossValid(rec({ modelFolder: "../evil" })), false);
  assert.equal(labBossValid(rec({ hp: 0 })), false);
  assert.equal(labBossValid(rec({ moves: [1, 2] })), false);
  assert.equal(labBossValid(null), false);
});

test("mergeLabBosses: absent or empty file changes nothing; authored ids are never replaced", () => {
  const table = { millenniummon: { id: "millenniummon", hp: 1 } };
  assert.equal(mergeLabBosses(table, null), table);
  assert.equal(mergeLabBosses(table, { bosses: {} }), table);
  assert.equal(mergeLabBosses(table, { bosses: { x: { id: "x" } } }), table);
  const out = mergeLabBosses(table, { bosses: { a: rec(), b: rec({ id: "millenniummon" }) } });
  assert.deepEqual(Object.keys(out), ["millenniummon", "lab_m899test1"]);
  assert.equal(out.millenniummon.hp, 1);
  assert.equal(out.lab_m899test1.aiFill, true);
  assert.equal(table.lab_m899test1, undefined, "the authored table is not mutated");
});

test("a Lab boss is fought as its body species, fuses on defeat, and only with the switch on", () => {
  const table = mergeLabBosses({}, { bosses: { a: rec() } });
  const party = labBossParty(rec());
  assert.deepEqual(party, [{ name: "Kimeramon", id: 237, level: 60, hp: 2000, mp: 9999, stat_scale: 20, fuseInto: "lab_m899test1" }]);
  assert.equal(partyEntriesFor(party, false)[0].fuseInto, undefined);
  assert.equal(fusionOnDefeat({ party, partyIndex: 0, fxOn: false, bosses: table }).fuse, false);
  const on = fusionOnDefeat({ party, partyIndex: 0, fxOn: true, bosses: table });
  assert.equal(on.fuse, true);
  assert.equal(on.hp, 3000);
});

test("a body with no enemies.json row (a partner form) is fought by its digimon id; other bodies are unchanged", () => {
  const withId = labBossParty(rec({ body: "WarGreymon", party: { id: 36, level: 40, hp: 398, mp: 254, stat_scale: 16, digimonId: 36 } }));
  assert.equal(withId[0].digimonId, 36);
  assert.equal(withId[0].name, "WarGreymon");
  assert.equal("digimonId" in labBossParty(rec())[0], false);
});
