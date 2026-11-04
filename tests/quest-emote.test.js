// The quest scenes' reaction-bubble step (web/quest-scenes.js): one step compiles to the story's own bubble commands and
// the cutscene VM the game runs pops the resident bubble actor with it. The original's vocabulary is
// `SETANIM <slot> <cmd> <actor>`: slot 803 is a bubble actor, cmd 805 opens glyph row 0 (the red "!"), 807 opens row 1
// (the silent smoke puffs) and 806 closes (wstag-script-decode.md: `SETANIM 803 (805,57)` / WAIT / `SETANIM 803 (806,57)`).
// The step is behind F2 -> Extras -> Quest emotes (off by default): with the switch off it is refused at compile time
// instead of half-playing.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compileScene, castOf, validateScene } from "../web/quest-scenes.js";
import { createCutscene } from "../engine/systems/cutscene-manager.ts";

const ON = { fx: { questemotes: true } };
const pos = () => ({ x: 0, y: 0 });
const compile = (steps, extra = ON) => compileScene(steps, { playerId: 2, pos, ...extra });
const bubblesOf = (steps, extra) => compile(steps, extra).opcodes.filter((op) => /^(SETANIM 803 80[567]|WAIT)\b/.test(op));

test("exclaim pops the red ! bubble, holds, and closes it", () => {
  const { opcodes, errors } = compile([{ bubble: "exclaim", who: 27, hold: 48 }]);
  assert.deepEqual(errors, []);
  assert.deepEqual(opcodes, ["FN6A 1 2", "SETANIM 803 805 27", "WAIT 48", "SETANIM 803 806 27", "END"]);
});

test("puffs opens the silent row; open steps close themselves after the hold, 48 by default", () => {
  assert.deepEqual(bubblesOf([{ bubble: "puffs", who: 27, hold: 30 }]),
    ["SETANIM 803 807 27", "WAIT 30", "SETANIM 803 806 27"]);
  assert.deepEqual(bubblesOf([{ bubble: "exclaim", who: 27 }]),
    ["SETANIM 803 805 27", "WAIT 48", "SETANIM 803 806 27"], "the default hold is 48 frames");
});

test("close shuts a bubble on the spot: no wait", () => {
  const { opcodes, errors } = compile([{ bubble: "close", who: 27 }]);
  assert.deepEqual(errors, []);
  assert.deepEqual(opcodes, ["FN6A 1 2", "SETANIM 803 806 27", "END"]);
  assert.ok(!opcodes.some((op) => op.startsWith("WAIT")));
});

test("with the F2 switch off the step is refused at compile time and emits nothing", () => {
  for (const opts of [{}, { fx: {} }, { fx: { questemotes: false } }]) {
    const { opcodes, errors } = compile([{ bubble: "exclaim", who: 27, hold: 48 }], opts);
    assert.equal(errors.length, 1, JSON.stringify(opts));
    assert.match(errors[0], /Quest emotes/, "the error names the switch to turn on");
    assert.deepEqual(opcodes, ["FN6A 1 2", "END"], "no half-played bubble");
    assert.deepEqual(bubblesOf([{ bubble: "exclaim", who: 27 }], opts), []);
  }
});

test("in the game the F2 settings object (window.__fx) is what the gate reads", () => {
  globalThis.window = { __fx: { questemotes: true } };
  try {
    assert.deepEqual(compile([{ bubble: "exclaim", who: 27, hold: 12 }], {}).errors, []);
  } finally {
    delete globalThis.window;
  }
  globalThis.window = { __fx: { questemotes: false } };
  try {
    assert.equal(compile([{ bubble: "exclaim", who: 27 }], {}).errors.length, 1, "off stays off");
  } finally {
    delete globalThis.window;
  }
});

test("the cutscene VM the game runs pops the bubble over who and closes it after the hold", () => {
  const textbox = { isOpen: () => false, open: () => {} };
  const player = { x: 10, y: 20 }, npc = { x: 50, y: 60 };
  const vm = () => createCutscene(textbox, () => player, (id) => (id === 27 ? npc : null), {});
  let done = false;
  const cs = vm();
  cs.start(compile([{ bubble: "exclaim", who: 27, hold: 30 }]).opcodes, null, () => { done = true; });
  cs.step(1 / 60);
  const open = cs.bubbles.get(803);
  assert.ok(open, "the VM configured the story's own bubble actor (slot 803)");
  assert.equal(open.row, 0, "row 0 is the red !");
  assert.equal(open.actor, 27, "and it rides on the named character");
  assert.equal(open.sound, true, "the ! row plays FUKIDASH");
  assert.equal(open.closedAt, null, "still up");
  for (let i = 0; i < 40 && !done; i++) cs.step(1 / 60);
  assert.equal(done, true, "the scene went on");
  assert.ok(cs.bubbles.get(803).closedAt != null, "the bubble closed after the hold");

  const silent = vm();
  silent.start(compile([{ bubble: "puffs", who: 27, hold: 1 }]).opcodes, null, () => {});
  silent.step(1 / 60);
  assert.equal(silent.bubbles.get(803).row, 1, "row 1 is the silent puff row");
  assert.equal(silent.bubbles.get(803).sound, false, "and it is silent, unlike the !");
});

test("only the three bubble names exist: an invented icon is an error, never a guess", () => {
  for (const name of ["sparkle", "ellipsis", "ladder", "arrow", "party", "805", true]) {
    const { errors } = compile([{ bubble: name, who: 27 }]);
    assert.equal(errors.length, 1, String(name));
    assert.match(errors[0], /exclaim, puffs, close/i, "the error lists the palette");
  }
});

test("who must name a character; hold is 1 to 600 frames", () => {
  for (const step of [
    { bubble: "exclaim" },
    { bubble: "exclaim", who: "nobody" },
    { bubble: "exclaim", who: NaN },
    { bubble: "exclaim", who: Infinity },
  ]) {
    assert.equal(compile([step]).errors.length, 1, JSON.stringify(step));
  }
  assert.equal(compile([{ bubble: "exclaim", who: 27, hold: 0 }]).errors.length, 1);
  assert.equal(compile([{ bubble: "exclaim", who: 27, hold: 601 }]).errors.length, 1);
  assert.deepEqual(bubblesOf([{ bubble: "exclaim", who: 27, hold: 600 }]),
    ["SETANIM 803 805 27", "WAIT 600", "SETANIM 803 806 27"], "600 frames is the ceiling and it is accepted");
});

test("the bubble's actor is scene cast, like a speaker, and validateScene checks the shape with the switch off", () => {
  assert.deepEqual(castOf([{ bubble: "exclaim", who: 27 }, { bubble: "close", who: 58 }]).sort((a, b) => a - b), [27, 58]);
  assert.deepEqual(validateScene([{ put: 27, at: [10, 10] }, { bubble: "exclaim", who: 27 }]), []);
  assert.ok(validateScene([{ bubble: "sparkle", who: 27 }]).length, "validation still reports a bad step");
});

test("source: the compiler emits the three command numbers and reads the F2 key; no art, no game.js edit", () => {
  const sceneSrc = readFileSync(new URL("../web/quest-scenes.js", import.meta.url), "utf8");
  for (const n of ["805", "807", "806"]) assert.ok(sceneSrc.includes(n), `the compiler knows the command ${n}`);
  assert.ok(sceneSrc.includes("803"), "and the story's bubble slot it sends it to");
  assert.ok(sceneSrc.includes("questemotes") && sceneSrc.includes("opts.fx"), "the gate reads opts.fx");
  const branch = sceneSrc.slice(sceneSrc.indexOf('"bubble" in s'), sceneSrc.indexOf('"face" in s'));
  assert.ok(branch.includes("SETANIM") && !/\.png|fieldcom/i.test(branch),
    "the bubble branch is opcodes only: the story's bubble actor draws it, no art of ours");
  const gameSrc = readFileSync(new URL("../web/game.js", import.meta.url), "utf8");
  assert.match(gameSrc, /compileScene\(steps, \{ playerId, pos, free, walk, paths: questPaths \}\)/,
    "the game's scene call is untouched");
  assert.ok(!gameSrc.includes("questemotes"), "the switch lives in the compiler, not in game.js");
  const ambSrc = readFileSync(new URL("../web/ambience.js", import.meta.url), "utf8");
  assert.match(ambSrc, /\["questemotes", "Quest emotes"\]/, "the Extras row carries the pair");
  assert.match(ambSrc, /const EXPERIMENTAL = \[[^\]]*"questemotes"/, "and the key starts OFF with the experimental switches");
});
