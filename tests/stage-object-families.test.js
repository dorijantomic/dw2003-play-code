// Checks data/stage_object_families.json against the research document that
// publishes it, so the inventory cannot drift from its own write-up.
//
// Run: node --test tests/stage-object-families.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const json = JSON.parse(
  readFileSync(resolve(ROOT, "data/stage_object_families.json"), "utf8"),
);
const doc = readFileSync(
  resolve(ROOT, "docs/research/field/stage-overlay-object-families-2026-10-04.md"),
  "utf8",
);

// The family table is the only section whose rows are "| `<hash>` | ... |".
// Section 3's ported-table rows start with a bare hash (no backticks), so the
// backtick requirement is what keeps the two apart.
function familyTableRows(markdown) {
  const start = markdown.indexOf("## 5. Family table");
  assert.notEqual(start, -1, "the document must keep its '## 5. Family table' heading");
  const section = markdown.slice(start);
  return section
    .split("\n")
    .filter((line) => /^\| `[0-9a-f]{12}` \|/.test(line))
    .map((line) => line.split("|")[1].trim().replace(/`/g, ""));
}

test("s415's falling-rock tick is in one family, and that family lists s415", () => {
  // The rockfall builders are wstag415.s:0x800a6230.. and attach the tick at
  // 0x800a5fa8 (`lui $a0, 0x800a` + `addiu $a0, 0x5fa8`, the whole pair).
  const ROCKFALL_TICK = 0x800a5fa8;
  const owners = json.families.filter((f) =>
    f.all_ticks.includes("0x800a5fa8"),
  );
  assert.equal(
    owners.length,
    1,
    `exactly one family must own tick 0x800a5fa8, found ${
      owners.map((f) => f.hash).join(", ") || "none"
    }`,
  );
  const fam = owners[0];
  assert.ok(
    fam.stages.includes("415"),
    `the rockfall family must list s415 among its stages, got ${fam.stages.join(",")}`,
  );
  // Ten builders, ten objects, one tick: s415's rockfall is ten create calls.
  const s415Calls = fam.create_calls.filter((c) => c.stage === "415");
  assert.equal(
    s415Calls.length,
    10,
    "s415 must create ten rockfall objects from one tick",
  );
  for (const call of s415Calls) {
    assert.equal(call.tick, ROCKFALL_TICK);
    assert.equal(
      call.routine,
      "F0x800143dc",
      "every rockfall builder must go through the shared allocator",
    );
    assert.equal(call.object_size, 0x74, "the rock is a 116-byte object");
  }
  assert.ok(
    doc.includes(fam.hash),
    `the research document must name the rockfall family ${fam.hash}`,
  );
});

test("the document's family table has one row per family in the JSON", () => {
  const rows = familyTableRows(doc);
  assert.equal(
    rows.length,
    json.families.length,
    `the table has ${rows.length} rows but the JSON has ${json.families.length} families`,
  );
  const jsonHashes = json.families.map((f) => f.hash);
  assert.deepEqual(
    [...rows].sort(),
    [...jsonHashes].sort(),
    "the table rows must be exactly the JSON family hashes",
  );
  assert.equal(
    new Set(rows).size,
    rows.length,
    "the table must not repeat a family",
  );
});

test("every family's own numbers match its rows in the table", () => {
  const byHash = new Map(json.families.map((f) => [f.hash, f]));
  const start = doc.indexOf("## 5. Family table");
  const lines = doc.slice(start).split("\n");
  let checked = 0;
  for (const line of lines) {
    const m = /^\| `([0-9a-f]{12})` \| (\d+) \| (\d+) \| (\d+) \| (\d+) \| (\w+) \|/
      .exec(line);
    if (!m) continue;
    checked += 1;
    const fam = byHash.get(m[1]);
    assert.ok(fam, `table row ${m[1]} is not in the JSON`);
    assert.equal(Number(m[2]), fam.stage_count, `${m[1]} stage count`);
    assert.equal(Number(m[3]), fam.members, `${m[1]} create-call count`);
    assert.equal(Number(m[4]), fam.tick_instructions, `${m[1]} tick length`);
    assert.equal(
      Number(m[5]),
      fam.distinct_raw_tick_bodies,
      `${m[1]} distinct raw bodies`,
    );
    assert.equal(m[6], fam.ported, `${m[1]} ported mark`);
  }
  assert.ok(checked > 0, "no family rows were found to check");
  assert.equal(checked, json.families.length);
});

test("the inventory is complete: every stage overlay is accounted for", () => {
  assert.equal(
    json.overlays_scanned,
    294,
    "the disc has 294 stage overlays",
  );
  assert.equal(
    json.overlays_scanned,
    json.overlays_with_create_calls + json.overlays_with_no_create_call.length,
    "every overlay is either read or listed as having no create call",
  );
  assert.equal(
    json.create_calls_total,
    json.families.reduce((n, f) => n + f.members, 0),
    "the family members must account for every create call",
  );
  assert.equal(
    json.create_calls_read,
    json.create_calls_total,
    "every create call must have been read; unread ones are reported instead",
  );
  assert.deepEqual(
    json.unread_overlays,
    [],
    "no overlay may have an unread create call",
  );
  // A count of zero is not evidence: the one overlay with no create call has to
  // be a stage whose whole body is data (wstag260.s:6-8), not a parse miss.
  assert.deepEqual(json.overlays_with_no_create_call, [260]);
});

test("a tick's family does not depend on which stage it came from", () => {
  // The 167-stage family is the proof: one hash, 167 stages, one tick shape.
  const big = json.families.find((f) => f.stage_count === 167);
  assert.ok(big, "the 167-stage family must still exist");
  assert.equal(big.members, big.stage_count, "one create call per stage");
  assert.ok(
    big.all_ticks.length >= 2,
    "the same family must hold ticks at more than one overlay address",
  );
  assert.ok(
    big.ticks_suppressed_as_load_base > 0,
    "ticks within 0x20 of the shared load base must be recorded as suppressed",
  );
  // The family must be one real code text, not a normalisation artefact: with
  // nothing masked, 167 stages still collapse to a handful of texts, because
  // the only thing that differs is local-label offsets.
  assert.ok(
    big.distinct_raw_tick_bodies > 0 &&
      big.distinct_raw_tick_bodies < big.stage_count,
    `the 167-stage family should be a few raw bodies, not 167 (got ${big.distinct_raw_tick_bodies})`,
  );
  for (const fam of json.families) {
    assert.ok(fam.distinct_raw_tick_bodies >= 1, `${fam.hash} has no raw body`);
    assert.ok(
      fam.distinct_raw_tick_bodies <= fam.members,
      `${fam.hash} claims more raw bodies than members`,
    );
  }
});