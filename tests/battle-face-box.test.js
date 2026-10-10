// The close-up face box (the original's layer key 0x1009) on the walker's shipped path:
// web/battle.js hands the object rule the HUD's facts each frame, and web/battle3d.js draws
// the box only when the rule says the object exists. The rule itself is
// engine/dw3/ui/native/battle-face-box.ts; the five frames that decided it are in
// docs/research/battle/captures/face-box-rounds-2026-10-03/.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { faceBoxHudEvents } from "../web/battle.js";
import { ui } from "../web/vendor/engine.js";

// web/battle.js:527 — the battle phase table. Kept as numbers here because ST is module
// private; PLAYER_MENU is the command menu, PLAYER_ACT an ordinary action beat.
const ST = { PLAYER_MENU: 2, PLAYER_ACT: 5, ENEMY_ACT: 6, RESULT_MSG: 7, WIN: 8 };

function visible(events) {
  return ui.battleFaceBoxVisible(box, faceBoxHudEvents(events.b, events.lineUp));
}

let box;

test("the box is up at the command menu and down while a line is up", () => {
  box = ui.createBattleFaceBox();
  assert.equal(visible({ b: { state: ST.PLAYER_MENU }, lineUp: false }), true);
  assert.equal(visible({ b: { state: ST.PLAYER_ACT }, lineUp: true }), false);
});

test("it comes back at the next round's menu, and the finished battle takes it away", () => {
  box = ui.createBattleFaceBox();
  const seen = [];
  const beat = (state, lineUp) => seen.push(visible({ b: { state }, lineUp }));
  // One round: menu, an ordinary action line, then the next round's menu.
  beat(ST.PLAYER_MENU, false);
  beat(ST.ENEMY_ACT, true);
  beat(ST.RESULT_MSG, true);
  beat(ST.PLAYER_MENU, false);
  assert.deepEqual(seen, [true, false, false, true]);
  // The report screen is past the HUD: the actor's tear-down arm frees the box there.
  assert.equal(visible({ b: { state: ST.WIN }, lineUp: false }), false);
});

test("the renderer draws the box from the rule, not from an always-on switch", () => {
  const src = readFileSync(new URL("../web/battle3d.js", import.meta.url), "utf8");
  assert.doesNotMatch(src, /faceCamEnabled\s*=\s*true/,
    "the old rule started the box enabled and nothing ever turned it off");
  assert.match(src, /battleFaceBoxVisible\(faceBox, events\)/,
    "web/battle3d.js must ask the object rule each frame");
  assert.match(src, /faceBoxOnScreen && !faceBoxSuppressed/,
    "the draw gate reads the rule's answer");
  assert.match(readFileSync(new URL("../web/battle.js", import.meta.url), "utf8"),
    /syncFaceBox\?\.\(faceBoxHudEvents\(b, msgHoldsTurn\(b\)\)\)/,
    "the battle loop feeds the rule the same line-up fact the turn is held on");
});