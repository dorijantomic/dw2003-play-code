// NPC confirm-box target (fieldstg F0x8008E210).
//
// The talk/kick button computes an action point a step in front and takes the
// first actor whose box contains it: half-width +0x80, half-height +0x80>>1,
// where +0x80 = the per-npc_id size table >> 1 (tools/extract_npc_confirm_box.py).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { boxTarget } from "../engine/systems/map-manager.ts";

const BOX = JSON.parse(readFileSync("web/assets/data/npc_confirm_box.json", "utf8"));

test("the extracted size table covers the shipped npc ids", () => {
  const ids = Object.keys(BOX);
  assert.ok(ids.length >= 250, `expected ~255 ids, got ${ids.length}`);
  assert.equal(BOX["1"], 16);   // the common half-width: a 32x16 box
  assert.equal(BOX["12"], 16);
  for (const hw of Object.values(BOX))
    assert.ok(Number.isInteger(hw) && hw >= 0, `bad half-width ${hw}`);
});

test("boxTarget takes the first actor whose box contains the point", () => {
  const a = { id: "a", x: 100, y: 100 };
  const b = { id: "b", x: 100, y: 120 };
  const half = () => 16; // box x±16, y±8
  assert.equal(boxTarget([a, b], 100, 104, half)?.id, "a"); // 4 below a
  assert.equal(boxTarget([a, b], 100, 116, half)?.id, "b"); // 16 below a (skip), 4 below b
  assert.equal(boxTarget([a, b], 100, 124, half)?.id, "b"); // 24 below a (skip), 4 below b
  assert.equal(boxTarget([a, b], 100, 130, half), null);    // below both
  assert.equal(boxTarget([a, b], 117, 100, half), null);    // outside both in x
});

test("the half-height is half the half-width", () => {
  const a = { x: 0, y: 0 };
  const hw = () => 16; // box x±16, y±8
  assert.equal(boxTarget([a], 15, 0, hw), a);   // inside x
  assert.equal(boxTarget([a], 17, 0, hw), null); // outside x
  assert.equal(boxTarget([a], 0, 8, hw), a);     // inside y
  assert.equal(boxTarget([a], 0, 9, hw), null);  // outside y
});

test("actors with no box entry are skipped", () => {
  const a = { id: "a", x: 0, y: 0 };
  const b = { id: "b", x: 0, y: 0 };
  const half = (n) => n.id === "a" ? null : 16;
  assert.equal(boxTarget([a, b], 0, 0, half), b);
  assert.equal(boxTarget([a], 0, 0, half), null);
});
