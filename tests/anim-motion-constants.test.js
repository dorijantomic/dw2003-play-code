// K19a - the MOTION CONSTANTS the cast solver reads: where the game's own spell animations put the
// emitter at the release tick, and how the emitter got there.
//
// The module is GENERATED from the shipped packs by tools/k19a_motion_stats.mjs (scratch-research:
// anatomy/motion-stats.json), so these tests do not re-measure the disc. They pin the properties that
// make the file trustworthy for a solver:
//
//   1. every class carries a usable distribution (n > 0, p10 <= p50 <= p90) for the measures the
//      solver reads, and the phases are integers in ticks;
//   2. the file is AGGREGATE-ONLY - no model id (m###xxxx) and none of the exemplars' names appear in
//      it, so no per-model disc data can leak into the repo through it;
//   3. the resolvers behave: a thin class x size cell falls back to the class record, an unknown class
//      returns null, and a mouth/body emitter has no hand point of its own (handPoint falls back to the
//      emitter point) while an arm class has both;
//   4. the worked numbers are plausible for a solver: on a 2000-unit body every release point is above
//      the floor and inside 2.5 body heights, the forward offset is not behind the body for the mouth
//      or the prop class, and the wind-up never exceeds the class's own travel.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import * as M from "../web/fight/motion-constants.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const FILE = path.join(ROOT, "web/fight/motion-constants.js");
const SOURCE = fs.readFileSync(FILE, "utf8");

const ARMS = ["both-hands", "hand", "prop"];
const CENTRE = ["mouth", "body"];
const MEASURES = ["hH", "fH", "lH", "backH", "upH", "travelH"];

test("every class carries a usable distribution", () => {
  assert.ok(M.MOTION_CLASSES.length >= 5);
  for (const cls of M.MOTION_CLASSES) {
    const rec = M.MOTION[cls];
    if (!rec) continue;                       // "eyes" has only throws in the corpus
    assert.ok(rec.n > 0, `${cls}: n`);
    for (const k of MEASURES) {
      const d = rec[k];
      assert.ok(d, `${cls}: has ${k}`);
      assert.ok(d.p10 <= d.p50 && d.p50 <= d.p90, `${cls}.${k}: p10 <= p50 <= p90`);
      assert.ok(Number.isFinite(d.p50), `${cls}.${k}: finite`);
    }
    for (const k of ["windup", "flight", "follow", "total"]) {
      const d = rec[k];
      if (!d) continue;
      for (const q of ["p10", "p50", "p90"]) assert.ok(Number.isInteger(d[q]), `${cls}.${k}.${q} is a whole tick`);
    }
    // a height above the floor and a forward offset are physical; the class medians must be usable
    assert.ok(rec.hH.p50 > 0 && rec.hH.p50 < 1.5, `${cls}: hH p50 in the body`);
    assert.ok(rec.backH.p50 >= 0 && rec.upH.p50 >= 0, `${cls}: wind-up is a distance`);
  }
});

test("the constants file carries aggregates only (no model ids, no exemplar names)", () => {
  assert.ok(!/\bm\d{3}[a-z0-9]{3,4}\b/.test(SOURCE), "no model folder id in the constants file");
  for (const name of ["Piedmon", "Knightmon", "Valkyrimon", "Kokatorimon", "Greymon"]) {
    assert.ok(!SOURCE.includes(name), `no species name (${name}) in the constants file`);
  }
  // it must not read the disc either: no fetch/fs/paths in a constants module
  assert.ok(!/node:fs|fetch\(|assets\/battle/.test(SOURCE), "the constants file reads no data at runtime");
});

test("a thin class x size cell falls back to the class record", () => {
  const cell = M.MOTION_BY_CLASS_SIZE["both-hands"]?.medium;
  assert.ok(cell && cell.n >= 4, "both-hands medium is a real cell");
  const narrowed = M.motionFor("both-hands", "medium");
  assert.equal(narrowed.source, "class+size");
  // a cell with fewer casts than minCell must not be used
  const thin = M.motionFor("hand", "degenerate");
  assert.equal(thin.source, "class");
  assert.equal(M.motionFor("no-such-class"), null);
});

test("an arm class has a wrist point; a centre class falls back to its emitter", () => {
  for (const cls of ARMS) {
    const h = M.handPoint({ emitterClass: cls, bodyHeight: 2000 });
    assert.ok(h && h.height > 0, `${cls}: hand point`);
    const e = M.releasePoint({ emitterClass: cls, bodyHeight: 2000 });
    assert.ok(e && e.unit === "body", `${cls}: release point is in body units`);
  }
  for (const cls of CENTRE) {
    if (!M.MOTION[cls]) continue;
    const e = M.releasePoint({ emitterClass: cls, bodyHeight: 2000 });
    const h = M.handPoint({ emitterClass: cls, bodyHeight: 2000 });
    assert.equal(h.height, e.height, `${cls}: hand point falls back to the emitter`);
    assert.equal(M.armShape({ emitterClass: cls, armLength: 1000 }), null, `${cls}: no shoulder shape`);
  }
});

test("the worked release points are physical on a 2000-unit body", () => {
  const H = 2000;
  for (const cls of M.MOTION_CLASSES) {
    if (!M.MOTION[cls]) continue;
    const e = M.releasePoint({ emitterClass: cls, bodyHeight: H });
    assert.ok(e.height > 0 && e.height < 2.5 * H, `${cls}: height above the floor`);
    assert.ok(Math.abs(e.forward) < 2 * H, `${cls}: forward offset is a body-scale number`);
    const w = M.windupFor({ emitterClass: cls, bodyHeight: H });
    assert.ok(w.back >= 0 && w.up >= 0 && w.travel >= 0, `${cls}: wind-up distances`);
    assert.ok(w.windup >= 0 && w.flight >= 0, `${cls}: phase ticks`);
    const rec = M.MOTION[cls];
    assert.ok(w.travel <= rec.travelH.p90 * H + 1e-6, `${cls}: wind-up travel inside the class p90`);
  }
  // the two classes that fire forward must not read as a backward shot
  for (const cls of ["mouth", "prop", "both-hands"]) {
    const e = M.releasePoint({ emitterClass: cls, bodyHeight: 2000 });
    assert.ok(e.forward > 0, `${cls}: forward of the torso`);
  }
});

test("the shoulder-relative arm shape is in arm lengths", () => {
  const s = M.armShape({ emitterClass: "prop", armLength: 1500 });
  assert.ok(s, "prop has a shoulder shape");
  assert.ok(Math.abs(s.forward) < 4 * 1500, "forward offset is a limb-scale number");
  assert.ok(Math.abs(s.above) < 4 * 1500, "height offset is a limb-scale number");
  assert.equal(M.armShape({ emitterClass: "prop", armLength: 0 }), null);
});

test("the census agrees with itself", () => {
  const c = M.MOTION_CENSUS;
  assert.equal(c.spells + c.throws, c.usable);
  assert.ok(c.usable <= c.casts && c.usable > 200, "the flagged rows are excluded, not the corpus");
  const byClass = Object.values(c.byClass).reduce((s, n) => s + n, 0);
  assert.equal(byClass, c.spells);
  const byThrow = Object.values(c.byClassThrow).reduce((s, n) => s + n, 0);
  assert.equal(byThrow, c.throws);
  assert.equal(M.MOTION_CENSUS.models > 100, true);
});
