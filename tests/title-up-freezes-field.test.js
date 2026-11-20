// While the title is up over a still-loaded field (after a lost fight) play time and field input
// must stop; the place card must not draw behind an open book. Source-shape test; the live run
// measures the behaviour.
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";
import { readSource } from "./helpers/source.js";
const src = readSource(new URL("../web/game.js", import.meta.url));
test("play clock only ticks while started", () => {
  assert.match(src, /if \(state\.started\) state\.playSeconds = \(state\.playSeconds \|\| 0\) \+ dt;/);
  assert.doesNotMatch(src, /^\s*state\.playSeconds = \(state\.playSeconds \|\| 0\) \+ dt;/m);
});
test("field input guard includes the title-is-up test", () => {
  const i = src.indexOf("state.titleScreen ||\n        !state.started ||");
  assert.ok(i > 0);
  assert.ok(src.lastIndexOf("textbox.isOpen() ||", i) > i - 1500);
});
test("place card draw skipped while a book is open", () => {
  assert.match(src, /if \(!books\.isOpen\(\)\) placeCard\.draw\(ctx, VIEW_W, VIEW_H\);/);
});
