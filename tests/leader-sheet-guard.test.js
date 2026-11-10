// The field must never throw when the leader sheet is not ready (drawImage on undefined ended the frame loop).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../web/game.js", import.meta.url), "utf8");

test("drawPlayerActor skips the leader and re-requests the sheet when it is not loaded", () => {
  const body = src.slice(src.indexOf("function drawPlayerActor()"));
  const guard = body.indexOf("if (!isLoadedAsset(sheet))");
  const draw = body.indexOf("c, sheet, state.clipImgs[c.id]");
  assert.ok(guard > 0 && draw > guard, "guard comes before the leader drawEntitySprite");
  const g = body.slice(guard, draw);
  assert.match(g, /requestLeaderSheet\(c\.id\)/);
  assert.match(g, /return;/);
  assert.match(g, /if \(cutRow != null\) ctx\.restore\(\)/, "the saddle clip is undone on the skip");
});

test("requestLeaderSheet retains the id, throttles to 2 s and calls ensureSpriteAssets", () => {
  const start = src.indexOf("function requestLeaderSheet");
  const fn = src.slice(start, src.indexOf("\n}\n", start) + 3);
  const calls = [];
  const retained = new Set();
  const retryAt = new Map();
  const run = new Function("retainedSpriteIds", "leaderSheetRetryAt", "ensureSpriteAssets", "performance",
    fn + "; return requestLeaderSheet;")(retained, retryAt, (id) => calls.push(id), { now: () => 0 });
  run("p002play", 100); run("p002play", 1000); run("p002play", 2200);
  assert.deepEqual(calls, ["p002play", "p002play"]);
  assert.ok(retained.has("p002play"));
  run(undefined, 9999);
  assert.equal(calls.length, 2);
});
