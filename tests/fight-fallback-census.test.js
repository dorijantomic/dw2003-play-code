// Every action clip a model lacks but a technique can ask for (an enemy-only species using a spell, a combo, a
// support move) must be built by the donor fallback into a script that finishes, binds only real timeline tables
// and spawns only registered effects. Runs tools/fight_fallback_census.mjs (exit 1 = a problem).
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));

test("the fallback builds a playable script for every missing clip", { timeout: 300000, skip: fs.existsSync(path.join(HERE, "../web/assets/battle/models/m005grey/anim.json")) ? false : "model packs are not installed" }, () => {
  const out = execFileSync("node", [path.join(HERE, "../tools/fight_fallback_census.mjs")], { encoding: "utf8" });
  assert.match(out, /0 with problems/);
});

test("a model that has its own clip is never touched", async () => {
  const { resolveClipScript, setFallbackDonor } = await import("../web/fight/clip-fallback.js");
  setFallbackDonor([null, null, null, null, null, null, { ops: [{ op: 255, words: [] }] }]);
  const own = { ops: [{ op: 2, words: [0, 0, 14] }, { op: 255, words: [] }] };
  assert.equal(resolveClipScript({ actions: [null, null, null, null, null, null, own] }, 6), own);
  setFallbackDonor(null);
  assert.equal(resolveClipScript({ actions: [] }, 6), null, "no donor, no clip: nothing to play (the fighter idles, as before)");
});

test("a missing combo is the model's own basic attack plus the clip's own contact sequence", async () => {
  const { resolveClipScript, setFallbackDonor } = await import("../web/fight/clip-fallback.js");
  setFallbackDonor([null, null, null, null, null, null, { ops: [{ op: 255, words: [] }] }]);
  const basic = { ops: [{ op: 2, words: [0, 0, 14] }, { op: 3, words: [0, 2, 0, -384, -5120] }, { op: 255, words: [] }] };
  const script = resolveClipScript({ actions: [null, null, null, null, null, basic] }, 6);
  // A12: the body is the model's own basic attack, but a clip the disc presents WITH a contact (clip 6 = one
  // strike) gets that contact even when the borrowed body carries none, in world space on the victim line and
  // with the reaction pair the op1 dispatch reads (98 -> [5], final 99 -> [0]). Before, the combo spawned a
  // spark and nobody was asked to react, so the defender took the damage standing.
  assert.deepEqual(script.ops.map((o) => [o.op, ...o.words]), [
    [3, 1, 9999], [2, 0, 0, 14], [10, 99, 0], [3, 0, 2, 0, -896, -5120], [3, 0, 9999, 0, -896, -5120], [1, 0], [255],
  ]);
  setFallbackDonor(null);
});
