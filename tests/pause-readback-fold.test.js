// The pause pages' read-back must fold every stat group the original's item applier
// (F0x8008F584) raises back into the walker's own stored stat fields, and it must do
// it BEFORE it copies the record's block over, on BOTH pause routes.
//
// This is the wiring half of tests/record-stat-fold.test.js: the fold itself is
// unit-tested there, and here we only prove the ONE place every pause page hands its
// writes back actually calls it. Since 2026-10-04 that place is the shared close
// commit (engine/dw3/ui/pause-close-commit.ts `commitPauseClose`), which the
// translated route (web/status-translated.js) and the original-code reference route
// (web/status-native.js) both call -- before this they each carried their own copy of
// the read-back, which is how the two drifted apart once already.
//
// The order assertions read the sources rather than loading them, because loading
// web/status-translated.js needs the browser's fetch for the pause data banks. The
// pattern is the same one tests/packed-sound.test.js uses to keep a hand table out of
// web/.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const translated = readFileSync(new URL("../web/status-translated.js", import.meta.url), "utf8");
const reference = readFileSync(new URL("../web/status-native.js", import.meta.url), "utf8");
const commit = readFileSync(
  new URL("../engine/dw3/ui/pause-close-commit.ts", import.meta.url), "utf8");

test("the shared commit folds the record's stat groups before it copies them over", () => {
  const fold = commit.indexOf("foldRecordStatsIntoBonuses(rec as StatCarrier, record, {");
  assert.ok(fold >= 0, "commitPauseClose must fold the record's stat groups into the walker's own");
  // The three copies that land on `rec`. Order matters both ways round: the fold
  // measures the rise against the values the page OPENED with, and `rec` still holds
  // those until the copy; the copy then has to land so `rec` ends on the number the
  // original left in the record.
  const copies = ["rec.maxHp = ", "rec.core = ", "rec.elements = "].map((needle) => commit.indexOf(needle));
  for (const at of copies) assert.ok(at >= 0, `commitPauseClose must still copy ${at}`);
  for (const at of copies) {
    assert.ok(fold < at,
      "the fold must run before rec.maxHp/rec.core/rec.elements are assigned, or it would "
      + "diff the written block instead of the chip's rise");
  }
  // The element group needs the seven values the page was seeded with: the record's
  // element block carries the species base, which `rec` does not store separately.
  assert.match(commit, /elements: input\.openedElements\?\.\[rosterSlot\] \?\? null,/,
    "the third argument is the element group seed");
  assert.equal(commit.split("foldRecordStatsIntoBonuses(").length - 1, 1,
    "exactly one fold call: this is the shared seam, not a per-screen patch");
});

test("both routes hand their page's numbers to that one commit", () => {
  for (const [name, src] of [["web/status-translated.js", translated], ["web/status-native.js", reference]]) {
    assert.match(src, /import \{[^}]*commitPauseClose[^}]*\} from "\.\/vendor\/engine\.js"/,
      `${name} must call the shared commit`);
    assert.equal(src.split("commitPauseClose(").length - 1, 1, `${name}: one call site`);
    assert.doesNotMatch(src, /foldRecordStatsIntoBonuses/,
      `${name} must not fold for itself; the shared commit owns that order`);
  }
  // Each route supplies only its own VIEW of one record -- the translated session's
  // snapshot row, and the save block the original wrote -- which is the whole of what
  // the two routes may disagree about.
  assert.match(translated, /recordAt: \(rosterSlot\) => snap\.records\[rosterSlot\] \?\? null,/);
  assert.match(reference, /recordAt: \(rosterSlot\) => \{/);
  assert.match(reference, /for \(const \[name, off\] of RECORD_EQUIP_OFFSETS\)/,
    "the reference route reads the six worn halfwords at the original's own offsets");
});

test("the fold has one home, in the engine", () => {
  assert.match(commit, /import \{ foldRecordStatsIntoBonuses, type StatCarrier \} from "\.\.\/party-context\.ts";/);
  for (const src of [translated, reference]) {
    assert.doesNotMatch(src, /function foldRecordStatsIntoBonuses/,
      "the fold must have one home: engine/dw3/party-context.ts");
  }
});