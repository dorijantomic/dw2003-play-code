// Regression pin for the dev toolset's 'Stage events' panel (p5).
//
// The bug: after a Jump reloaded the iframe onto a new stage, the panel kept the
// previous stage's events, so Play sent the game back to that stale stage. The
// fix moved the panel selection onto every ready transition in watchReady()
// (via selectLoadedStage) instead of a one-shot onReady() boot callback.
//
// A full behavioural check needs a browser — tools/verify_devtools.mjs jumps to
// a stage and then Plays from the panel, asserting the game stays there. This
// node pin keeps the wiring that makes that possible from silently reverting,
// in the same source-contract style as tests/lab-session.test.js
// ("the session imports no interpreter").
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync("web/devtools.js", "utf8");

// The body of a top-level `function name(...) {` found by brace matching.
function functionBody(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `function ${name}() is present`);
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") { depth--; if (depth === 0) return source.slice(open + 1, i); }
  }
  throw new Error(`unbalanced braces in ${name}()`);
}

test("the Stage-events panel re-selects the loaded stage on every ready transition", () => {
  const watch = functionBody(src, "watchReady");
  assert.match(watch, /gameReady = true/, "watchReady flips gameReady when the frame is up");
  assert.match(watch, /selectLoadedStage\(\)|selectStage\(/,
    "the ready transition must re-select the panel: a Jump reloads the iframe onto a new stage");
});

test("selectLoadedStage follows the map the iframe actually loaded", () => {
  const body = functionBody(src, "selectLoadedStage");
  assert.match(body, /__mapInfo\?\.\(\)\.id/, "it reads the loaded map id");
  assert.match(body, /selectStage\(/, "and feeds it to selectStage()");
});

test("the events panel is not selected from the one-shot onReady boot callback", () => {
  // The boot callback was the pre-fix selection site; keep it from returning,
  // because a boot-only selection never runs again after a Jump reload.
  const boot = src.slice(src.indexOf("reloadGame(null)"), src.indexOf("watchReady();"));
  assert.ok(boot.length > 0, "the boot block is present");
  assert.doesNotMatch(boot, /selectStage\(/,
    "selection belongs to the every-ready transition, not the one-shot boot callback");
});
