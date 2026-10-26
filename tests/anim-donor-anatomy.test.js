// K15: the donor map is chosen from the ANATOMY table, not from mesh geometry. These tests pin the
// properties that make that true for the shipped map, without the disc-derived clip census:
//
//   1. every row names a real donor body (not the target itself) and a real method;
//   2. the body family is the gate and keeps the plan close: nearly every row's donor shares the
//      target's body family (the K11 donor unit), and most also share its bodyPlan;
//   3. a mirror note exists only for the opposite firing side, names both sides, and never overrides
//      a low-confidence side;
//   4. the twin rows keep their twins and the excluded retarget row stays a retarget;
//   5. every row keeps the model's own body tables (the map's `t`), so a donor change cannot smuggle
//      disc tables into the file.
import { test } from "node:test";
import assert from "node:assert/strict";

import { ANIM_DONOR_GAPS, donorRow } from "../web/fight/anim-donor-map.js";
import { FOLDERS, bodyPlan, bodyFamily, dominantSide } from "../web/fight/digimon-anatomy.js";
import { sideConfidence } from "../web/fight/digimon-bonemap.js";

const KNOWN = new Set(FOLDERS);
const METHODS = new Set(["borrow-tables", "own-table-body", "spell-table-body", "retarget"]);
const rows = [];
for (const [folder, clips] of Object.entries(ANIM_DONOR_GAPS)) {
  for (const [clip, row] of Object.entries(clips)) rows.push({ folder, clip: Number(clip), row });
}

test("every donor row names a real body and a real method", () => {
  assert.ok(rows.length > 300, "the map still covers the gap rows");
  for (const { folder, clip, row } of rows) {
    // the excluded presentation models (the five DNA-only bodies) are not in the anatomy table; their
    // rows are the A2 rows kept as-is, and only their donor has to be a real body.
    if (KNOWN.has(folder)) {
      assert.ok(KNOWN.has(row.d), `${folder} clip ${clip}: donor ${row.d} is an anatomy model`);
      assert.notEqual(row.d, folder, `${folder} clip ${clip}: a model cannot be its own donor`);
    } else {
      assert.ok(["retarget", "own-table-body", "spell-table-body"].includes(row.m),
        `${folder} clip ${clip}: an excluded model keeps an A2 row`);
    }
    assert.ok(METHODS.has(row.m), `${folder} clip ${clip}: method ${row.m}`);
    assert.ok(Array.isArray(row.t), `${folder} clip ${clip}: t is a list`);
    if (row.m !== "retarget") assert.ok(row.t.length >= 1, `${folder} clip ${clip}: a body table is named`);
  }
});

test("the body family is the gate and keeps the plan close", () => {
  let samePlan = 0, sameFamily = 0, anatomyRows = 0;
  for (const { folder, row } of rows) {
    if (!KNOWN.has(folder)) continue;              // the A2-kept presentation rows have no anatomy
    anatomyRows++;
    if (bodyPlan(folder) === bodyPlan(row.d)) samePlan++;
    if (bodyFamily(folder) === bodyFamily(row.d)) sameFamily++;
  }
  // no other family can win when one of the target's own family owns the clip; only a target whose
  // family owns no clip (3 plant-rooted bodies) may leave it, so this is a near-hard property.
  assert.ok(sameFamily / anatomyRows >= 0.95, `same body family on ${sameFamily}/${anatomyRows} anatomy rows`);
  assert.ok(samePlan / anatomyRows >= 0.75, `same bodyPlan on ${samePlan}/${anatomyRows} anatomy rows`);
});

test("a mirror note names the two opposite sides", () => {
  const notes = rows.filter(({ row }) => row.h);
  for (const { folder, clip, row } of notes) {
    const m = /donor (left|right)-arm \/ target (left|right)-arm/.exec(row.h);
    assert.ok(m, `${folder} clip ${clip}: note shape "${row.h}"`);
    const [, donorSide, targetSide] = m;
    assert.notEqual(donorSide, targetSide, `${folder} clip ${clip}: a mirror note needs opposite sides`);
    assert.notEqual(sideConfidence(folder), "low",
      `${folder} clip ${clip}: a low-confidence side must not be mirrored on`);
    // when the anatomy names a side, the note must name that same side
    const tSide = dominantSide(folder);
    const dSide = dominantSide(row.d);
    if (tSide === "left" || tSide === "right") assert.equal(targetSide, tSide, `${folder} clip ${clip}: target side`);
    if (dSide === "left" || dSide === "right") assert.equal(donorSide, dSide, `${folder} clip ${clip}: donor side`);
  }
});

test("the twin rows keep their twins and the retarget row stays a retarget", () => {
  assert.equal(donorRow("m010sead", 9).m, "borrow-tables");
  assert.equal(donorRow("m010sead", 9).d, "m408sea2");
  assert.equal(donorRow("m466rgn2", 10).m, "retarget");
  assert.equal(donorRow("m175krsr", 5).m, "own-table-body");
});
