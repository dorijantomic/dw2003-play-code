import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const anim = JSON.parse(readFileSync(
  resolve("web/assets/battle/models/m373rena/anim.json"), "utf8"));

test("m373rena anim.json carries 18 action scripts", () => {
  assert.ok(Array.isArray(anim.actions), "actions missing");
  assert.equal(anim.actions.length, 18);
});

test("the basic-attack script (clip 5) is well-formed and has a PLAY-MOTION", () => {
  const a = anim.actions[5];
  assert.ok(a && Array.isArray(a.ops), "clip 5 script missing");
  const last = a.ops.at(-1).op;
  assert.ok(last === 0 || last === 255, "clip 5 does not end in a terminator");
  assert.ok(a.ops.some(o => o.op === 4), "clip 5 has no PLAY-MOTION (op 4)");
});
