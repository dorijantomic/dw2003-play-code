import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const anim = JSON.parse(readFileSync(
  resolve("web/assets/battle/models/m373rena/anim.json"), "utf8"));

test("m373rena anim.json carries a timeline with the game's markers", () => {
  assert.ok(Array.isArray(anim.timeline), "timeline missing");
  const entries = anim.timeline.flatMap(p => p.table);
  const loops = entries.filter(e => e.value === 0x8000).length;
  const ends  = entries.filter(e => e.value === 0xffff).length;
  assert.equal(loops, 14);
  assert.equal(ends, 25);
});
