// Quest scenes (web/quest-scenes.js): data steps -> the game's cutscene opcodes, and the shipped quests' scenes are well formed.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compileScene, castOf, validateScene } from "../web/quest-scenes.js";

const pos = (id) => (id === 2 ? { x: 100, y: 200 } : id === 27 ? { x: 923, y: 374 } : null);

test("walk, arrive, wait, face and put become the VM's own commands", () => {
  const { opcodes, errors } = compileScene([
    { walk: 27, to: [10, 20], face: "up" },
    { arrive: 27 },
    { wait: 30 },
    { face: 27, dir: "left" },
    { put: 27, at: [5, 6] },
  ], { playerId: 2, pos });
  assert.deepEqual(errors, []);
  assert.deepEqual(opcodes, ["FN6A 1 2", "WALKTO 27 10 20 4", "WAITIDLE 27", "WAIT 30", "WALKTO 27 923 374 2", "SETPOS 27 5 6", "END"]);
});

test("a walk without a facing keeps the walking direction (no facing operand)", () => {
  const { opcodes } = compileScene([{ walk: 27, to: [1, 2] }], { playerId: 2, pos });
  assert.equal(opcodes[1], "WALKTO 27 1 2");
});

test("relative targets and 'origin' resolve against where people stand when the scene starts", () => {
  const { opcodes, errors } = compileScene([
    { walk: 27, to: { near: "player", dx: 30, dy: -20 } },
    { walk: 27, to: "origin" },
    { walk: "player", to: "origin" },
  ], { playerId: 2, pos });
  assert.deepEqual(errors, []);
  assert.deepEqual(opcodes.slice(1, 4), ["WALKTO 27 130 180", "WALKTO 27 923 374", "WALKTO 2 100 200"]);
});

test("a gap walk stops short of the target on the line from the walker, looking at it", () => {
  const { opcodes, errors } = compileScene([{ walk: 27, to: { near: "player", gap: 34 } }], { playerId: 2, pos: (id) => (id === 2 ? { x: 923, y: 474 } : { x: 923, y: 374 }) });
  assert.deepEqual(errors, []);
  assert.equal(opcodes[1], "WALKTO 27 923 440 0");     // 34 short of the player, straight down the line, facing down
  const side = compileScene([{ walk: 27, to: { near: "player", gap: 10 } }], { playerId: 2, pos: (id) => (id === 2 ? { x: 1023, y: 374 } : { x: 923, y: 374 }) });
  assert.equal(side.opcodes[1], "WALKTO 27 1013 374 6");  // coming from the left, facing right
});

test("together: walks both side by side on free ground, apart: back to where they began", () => {
  const free = (x, y) => y > 300 && y < 600 && x > 0 && x < 2000;          // a corridor 300 px tall
  const at = (id) => (id === 2 ? { x: 500, y: 450 } : { x: 500, y: 410 });
  const { opcodes, errors } = compileScene([{ together: 27, dist: 100 }, { apart: 27 }], { playerId: 2, pos: at, free });
  assert.deepEqual(errors, []);
  assert.equal(opcodes.filter((o) => o.startsWith("WALKTO")).length, 4);
  const player = opcodes.find((o) => o.startsWith("WALKTO 2 "));
  const [, , px, py] = player.split(" ").map(Number);
  assert.ok(free(px, py), "the player ends on free ground");
  assert.ok(Math.hypot(px - 500, py - 450) >= 48, "and has actually walked");
  assert.equal(opcodes.at(-5), "WALKTO 2 500 450");
  assert.equal(opcodes.at(-4), "WALKTO 27 500 410");
});

test("together does nothing when there is no room or no collision data", () => {
  const at = (id) => (id === 2 ? { x: 500, y: 450 } : { x: 500, y: 410 });
  assert.deepEqual(compileScene([{ together: 27 }], { playerId: 2, pos: at }).opcodes, ["FN6A 1 2", "END"]);
  assert.deepEqual(compileScene([{ together: 27 }], { playerId: 2, pos: at, free: () => false }).opcodes, ["FN6A 1 2", "END"]);
});

test("speech and questions are numbered, balloon over an NPC, plain window for narration", () => {
  const { opcodes, speech } = compileScene([
    { say: 27, name: "Leomon", text: "Hello." },
    { say: null, text: "Narration." },
    { ask: "Ready?", options: ["Yes", "No"] },
  ], { playerId: 2, pos });
  assert.deepEqual(opcodes.slice(1, 7), ["SAY 0 1 27 0", "WAITCTX", "SAY 0 2 0 4", "WAITCTX", "SAY 0 3 0 4", "WAITCTX"]);
  assert.equal(speech[1].name, "Leomon");
  assert.deepEqual(speech[3].options, ["Yes", "No"]);
});

test("bad steps are reported, not guessed", () => {
  assert.ok(validateScene([{ walk: 27 }]).length);
  assert.ok(validateScene([{ say: 27 }]).length);
  assert.ok(validateScene([{ ask: "x", options: ["only one"] }]).length);
  assert.ok(validateScene([{ dance: 1 }]).length);
  assert.ok(validateScene([]).length);
});

test("castOf lists every character a scene needs", () => {
  assert.deepEqual(castOf([{ walk: 27, to: { near: 58 } }, { say: "player", text: "x" }, { arrive: 102 }]).sort((a, b) => a - b), [27, 58, 102]);
});

test("every scene in quests.json compiles", () => {
  const quests = JSON.parse(readFileSync(new URL("../web/quests.json", import.meta.url), "utf8")).quests;
  let scenes = 0;
  for (const q of quests) {
    for (const sc of [q.offer?.scene, q.acceptScene, q.doneScene, q.turnIn?.scene, ...q.objectives.map((o) => o.scene)]) {
      if (!sc) continue;
      scenes++;
      assert.deepEqual(validateScene(sc), [], `scene of ${q.id}`);
    }
  }
  assert.ok(scenes >= 8, `expected the new scenes, found ${scenes}`);
});
