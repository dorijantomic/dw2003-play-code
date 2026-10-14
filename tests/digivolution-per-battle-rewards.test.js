// The disc's per-battle digivolution rewards: which forms are paid, and how much
// a form learns in one fight. Both rules are read from the original assembly,
// which outranks every summary:
//
//   pro/wfightmn.s file 0x0C10 (RAM 0x800A69F0) — the mark. Byte 6 of the
//     acting position's word is set; when the live form is NOT the slot's own
//     starter (`lhu 0x8003EF5C + 0x58*slot` == `lh live+0` short-circuits,
//     .L0x00000CA8), the equipped triple is scanned and byte 7 + i is set on
//     the first row carrying the form just taken (the `j 0x800a6afc` leaves on
//     that first match).
//   pro/stfgtrep.s file 0x12C0 (state 0x14) — per marked row: dvGain, then
//     dvLadder, stored at row+0x100+formIndex*0x10.
//   pro/stfgtrep.s file 0x14E8 (state 0x16) — the F0x8008670C learn, reached only
//     when the ladder gained a level. The state-0x19 message-done dispatch LOOPS
//     back here through selector 1 (its table at 0x80082d80 points selectors 0
//     AND 1 at 0x800843f4 = state 0x16), so one battle teaches EVERY due
//     technique, one message page each.
//   pro/stfgtrep.s file 0x15E0 (state 0x17) — the F0x80086844 loadable, looping
//     the same way through selector 2.
//
// tests/report-row-oracle.test.js pins the selector dispatch against the original
// (running the shipped pro_stfgtrep.bin), including selector 1 -> state 0x16.
// The walker's browser reward path must therefore pay every form the battle
// TOOK (not only the one in the seat at the end) and teach every technique the
// new form level has passed — applyFormLearnPass loops both services to 0.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  markFormTaken, markedEquippedForms, commitBattleFormChange, applyFormLearnPass,
} from "../web/battle.js";
import { applyFormTechGates, learnOneTechnique, markOneLoadable } from "../web/form-tech-slots.js";

const digimon = JSON.parse(readFileSync(
  new URL("../web/assets/data/digimon.json", import.meta.url), "utf8"));
const byId = new Map(digimon.digimon.map((d) => [d.id, d]));
// The disc's own profile table, for the gate bytes the tests quote.
const PROFILE_BASE = 0x8003ef5c;
const IMAGE_BASE = 0x80010000;
const STRIDE = 0x58;
const image = readFileSync(new URL("../web/assets/native/screens/resident.bin", import.meta.url));
const discLearn = (id) => [...image.slice(PROFILE_BASE - IMAGE_BASE + (id - 1) * STRIDE + 0x31,
  PROFILE_BASE - IMAGE_BASE + (id - 1) * STRIDE + 0x37)];

const record = (id, level, techSlots = [0, 0, 0, 0, 0, 0]) =>
  ({ id, formLevel: level, dvexp: 0, techSlots: [...techSlots] });

// A minimal live battle for the shared form-change port (formChangeView reads
// playerRecords[position] only).
function fakeBattle(records) {
  return {
    activePlayerIndex: 0,
    playerRecords: records,
    formFlags: [],
    blast: null,
  };
}
const fakeRecord = ({ live, rookieId, savedSpeciesId = null, equipped = [], rosterIndex = 0 }) => ({
  profile: byId.get(live),
  rookieId,
  savedSpeciesId: savedSpeciesId ?? live,
  rosterIndex,
  statsRecord: { equippedForms: equipped },
});

test("learnOneTechnique fills one slot per call — the report loops the calls", () => {
  const dinohumon = byId.get(9);
  const gates = discLearn(9);
  assert.ok(gates[0] <= 99 && gates[1] <= 99, "Dinohumon's first two ordinary gates are below 99");

  // The old battle path (applyFormTechGates) fills every slot whose gate is met
  // in one pass. The disc fills ONE slot per F0x8008670C call (stfgtrep.s file
  // 0x14E8) and loops the call from the message-done dispatch (selector 1 ->
  // state 0x16) until it answers 0 — so one battle still ends with every due
  // slot filled, but through the report's own pages.
  const bulk = record(9, 99);
  applyFormTechGates(bulk, dinohumon, 99);
  const bulkLearned = bulk.techSlots.filter(Boolean).length;
  assert.ok(bulkLearned > 1, "the bulk back-fill learns several slots at once");

  const one = record(9, 99);
  const first = learnOneTechnique(one, dinohumon);
  assert.equal(first, 105, "the first ordinary technique is the one learned");
  assert.deepEqual(one.techSlots, [105, 0, 0, 0, 0, 0],
    "one call fills exactly one slot, however many gates the level has passed");

  // One per call, in profile order, until the signature (slot 5, its own gate).
  // Slot 4's profile technique is 0, so it is skipped rather than blocking the
  // signature — the disc's scan is over the profile's own six slots.
  const seen = [first];
  for (let i = 0; i < 5; i++) seen.push(learnOneTechnique(one, dinohumon));
  assert.deepEqual(seen, [105, 107, 184, 198, 61, 0],
    "each further call learns the next due slot, in profile order");
  assert.equal(one.techSlots[5] & 0x8000, 0x8000, "the signature keeps its 0x8000 flag");
});

test("the report loops the learn/load services: one battle teaches every due slot", () => {
  const dinohumon = byId.get(9);
  // The original: state 0x19's message-done dispatch re-enters state 0x16 on
  // selector 1 and state 0x17 on selector 2 (selector table 0x80082d80, proven
  // against the running overlay by tests/report-row-oracle.test.js), so
  // F0x8008670C / F0x80086844 are called until they answer 0.
  const one = record(9, 99);
  const pass = applyFormLearnPass(one, dinohumon);
  assert.deepEqual(pass.learned, [105, 107, 184, 198, 61],
    "every due ordinary slot AND the signature are learned in the one battle");
  assert.equal(one.techSlots[5] & 0x8000, 0x8000, "the signature keeps its 0x8000 flag");
  assert.deepEqual(pass.loadable, [105, 107, 184, 198],
    "the loadable pass then loops too: every learned ordinary slot whose load gate is met");
  for (const slot of [0, 1, 2, 3]) assert.equal(one.techSlots[slot] & 0x2000, 0x2000);
  assert.equal(one.techSlots[5] & 0x2000, 0, "the signature is never marked loadable");

  // A second battle finds nothing left due: the loops end on the first 0.
  const again = applyFormLearnPass(one, dinohumon);
  assert.deepEqual(again, { learned: [], loadable: [] });

  // Below the first gate nothing is learned, however many times the report loops.
  const below = record(9, discLearn(9)[0] - 1);
  assert.deepEqual(applyFormLearnPass(below, dinohumon), { learned: [], loadable: [] });
});

test("the browser reward path calls the looping pass, not one-shot services", () => {
  // The wiring itself: applyParticipantProgress must reach the services through
  // applyFormLearnPass. A one-shot pair here was the 2026-10-14 audit's
  // misreading of the loop (the selector-1 dispatch above).
  const src = readFileSync(new URL("../web/battle.js", import.meta.url), "utf8");
  assert.ok(src.includes("applyFormLearnPass(record, formProfile);"),
    "the reward path runs the looping pass");
  assert.ok(!/^\s*learnOneTechnique\(record, formProfile\);\s*$/m.test(src),
    "no one-shot learn call remains in the reward path");
  assert.ok(!/^\s*markOneLoadable\(record, formProfile\);\s*$/m.test(src),
    "no one-shot loadable call remains in the reward path");
});

test("learnOneTechnique respects the disc's own gate bytes", () => {
  const dinohumon = byId.get(9);
  const gates = discLearn(9);
  const below = record(9, gates[0] - 1);
  assert.equal(learnOneTechnique(below, dinohumon), 0,
    `nothing is learned below the first gate (${gates[0]})`);
  const at = record(9, gates[0]);
  assert.equal(learnOneTechnique(at, dinohumon), 105, "the gate is inclusive");
});

test("one loadable per battle: markOneLoadable marks only the FIRST eligible slot", () => {
  const dinohumon = byId.get(9);
  const two = record(9, 99, [105, 107, 0, 0, 0, 0]);
  const first = markOneLoadable(two, dinohumon);
  assert.equal(first, 105);
  assert.equal(two.techSlots[0] & 0x2000, 0x2000, "the first learned technique becomes loadable");
  assert.equal(two.techSlots[1] & 0x2000, 0, "the second is left for the next battle");
  const second = markOneLoadable(two, dinohumon);
  assert.equal(second, 107);
  assert.equal(markOneLoadable(two, dinohumon), 0, "nothing left to mark");

  // The signature (slot 5) is outside the five-slot loop and can never be marked.
  const signatureOnly = record(9, 99, [0, 0, 0, 0, 0, 0x8061]);
  assert.equal(markOneLoadable(signatureOnly, dinohumon), 0,
    "the signature slot has no load level (digivolution doc section 4)");
});

test("markedEquippedForms reads the report's own mark bytes (byte 7 + row)", () => {
  const equipped = [9, 27, 41];
  const flags = new Array(10).fill(0);
  assert.deepEqual(markedEquippedForms(flags, equipped), [], "no marks, no DVEXP targets");
  flags[7 + 1] = 1;
  assert.deepEqual(markedEquippedForms(flags, equipped), [27],
    "only the marked row's form is paid");
  flags[7 + 0] = 1;
  flags[7 + 2] = 1;
  assert.deepEqual(markedEquippedForms(flags, equipped), [9, 27, 41],
    "every marked row is paid, in row order");
  // The disc's `form >= 4` guard drops a row that is not an acquired form; the
  // walker's id space makes that `> 8` (the eight rookies).
  assert.deepEqual(markedEquippedForms([0, 0, 0, 0, 0, 0, 0, 1, 1, 1], [1, 5, 9]), [9],
    "rookie ids are never DVEXP targets");
});

test("a DV marks the equipped row of the form taken, even back to the configured form", () => {
  // The live record stands in form 9; the roster is configured for 27 (an
  // acquired form), and the player Digivolves back to 27. F0x800A69F0 compares
  // the live form against the SLOT'S OWN STARTER (rookie 1), so the equipped
  // row holding 27 is marked. An adapter that compares against the configured
  // form instead returns early and marks nothing — the old walker bug.
  const b = fakeBattle([fakeRecord({ live: 9, rookieId: 1, savedSpeciesId: 27, equipped: [9, 27, 0] })]);
  commitBattleFormChange(b, byId.get(27), 0);
  assert.equal(b.formFlags[0][6], 1, "byte 6 marks the position as a participant");
  assert.equal(b.formFlags[0][7 + 1], 1, "byte 7 + 1 marks the row carrying form 27");
  assert.deepEqual(markedEquippedForms(b.formFlags[0], [9, 27, 0]), [27]);
});

test("the setup and Tag marks land like F0x800A69F0 (and a rookie marks no row)", () => {
  const b = fakeBattle([
    fakeRecord({ live: 9, rookieId: 1, equipped: [9, 27, 0] }),
    fakeRecord({ live: 5, rookieId: 4, equipped: [5, 41, 0], rosterIndex: 1 }),
  ]);
  markFormTaken(b, 0, 9);                     // the lead at battle setup
  assert.equal(b.formFlags[0][6], 1);
  assert.equal(b.formFlags[0][7 + 0], 1, "the row carrying the lead's form is marked");

  markFormTaken(b, 1, 41);                    // a Tag commit on position 1
  assert.equal(b.formFlags[1][6], 1);
  assert.equal(b.formFlags[1][7 + 1], 1, "the row carrying the Tagged-in form is marked");

  // A fighter in its rookie form: byte 6 only, no equipped row (the
  // short-circuit at wfightmn.s .L0x00000CA8), so it banks no DVEXP.
  const r = fakeBattle([fakeRecord({ live: 1, rookieId: 1, equipped: [9, 27, 0] })]);
  markFormTaken(r, 0, 1);
  assert.equal(r.formFlags[0][6], 1);
  assert.deepEqual(r.formFlags[0].slice(7), [0, 0, 0],
    "no equipped row is marked for a rookie-form fighter");
  assert.deepEqual(markedEquippedForms(r.formFlags[0], [9, 27, 0]), []);
});
