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

// ------------------------------------------------------------------ the scene events: our own art, screen, fight, warp
import { questFxSpawn, questFxClear, questFxDrawables, questFxState, defineQuestFxSheet } from "../web/quest-fx.js";

test("pan is the game's own camera op: FN6B to a point, FN6A back to a character", () => {
  const { opcodes, errors } = compileScene([
    { pan: [640, 320] },
    { pan: [640, 320], snap: true },
    { pan: "player" },
    { pan: 27 },
  ], { playerId: 2, pos });
  assert.deepEqual(errors, []);
  assert.deepEqual(opcodes, ["FN6A 1 2", "FN6B 0 640 320", "FN6B 1 640 320", "FN6A 0 2", "FN6A 0 27", "END"]);
});

test("every effect step compiles to one SCENEEVENT and its own event spec", () => {
  const steps = [
    { fx: "crate", at: [1056, 120], clip: "fall", fall: { floor: 424, step: 0.7 } },
    { fxplay: "crate", clip: "settle" },
    { fxmove: "crate", slide: { to: [1100, 200], frames: 20 } },
    { fxwait: "crate" },
    { fxremove: "crate", fade: 12 },
    { fx: "shard", at: { near: "player", dx: 20, dy: -30 }, layer: "front", clip: "appear" },
  ];
  const { opcodes, events, errors } = compileScene(steps, { playerId: 2, pos });
  assert.deepEqual(errors, []);
  assert.deepEqual(opcodes.slice(1, -1), [0, 1, 2, 3, 4, 5].map((n) => `SCENEEVENT ${n}`));
  assert.deepEqual(events[0], { kind: "fx", name: "crate", sheet: "crate", x: 1056, y: 120, clip: "fall", fall: { floor: 424, step: 0.7 } });
  assert.deepEqual(events[1], { kind: "fxplay", name: "crate", clip: "settle" });
  assert.deepEqual(events[2], { kind: "fxmove", name: "crate", slide: { to: [1100, 200], frames: 20 } });
  assert.deepEqual(events[3], { kind: "fxwait", name: "crate" });
  assert.deepEqual(events[4], { kind: "fxremove", name: "crate", fade: 12 });
  assert.deepEqual(events[5], { kind: "fx", name: "shard", sheet: "shard", x: 120, y: 170, clip: "appear", layer: "front" },
    "a relative place resolves against where the character stands when the scene starts");
});

test("drop, rise, fade, battle and warp become their events, a warp keeping its map and spot", () => {
  const { events, errors } = compileScene([
    { drop: 100, step: 0.4 },
    { rise: 60 },
    { fade: "out", frames: 18 },
    { battle: 12 },
    { warp: { map: "s320", at: [576, 448], dir: 2 } },
    { warp: "s330", at: [100, 200] },
  ], { playerId: 2, pos });
  assert.deepEqual(errors, []);
  assert.deepEqual(events[0], { kind: "drop", pixels: 100, step: 0.4 });
  assert.deepEqual(events[1], { kind: "rise", pixels: -60, step: 0.25 });
  assert.deepEqual(events[2], { kind: "fade", to: "out", frames: 18 });
  assert.deepEqual(events[3], { kind: "battle", screen: 12 });
  assert.deepEqual(events[4], { kind: "warp", to: "s320", at: [576, 448], dir: 2 });
  assert.deepEqual(events[5], { kind: "warp", to: "s330", at: [100, 200] });
});

test("a malformed event is reported, never half-run", () => {
  assert.ok(validateScene([{ fx: "crate" }]).length, "an effect needs a place");
  assert.ok(validateScene([{ fx: "crate", at: [1, 2], fall: {} }]).length, "a fall needs a floor");
  assert.ok(validateScene([{ fx: "crate", at: [1, 2], fall: { floor: 9 }, slide: { to: [1, 2] } }]).length, "one motion only");
  assert.ok(validateScene([{ fx: "crate", at: [1, 2], layer: "somewhere" }]).length, "a layer is entity, behind or front");
  assert.ok(validateScene([{ fxplay: "crate" }]).length);
  assert.ok(validateScene([{ fxmove: "crate" }]).length);
  assert.ok(validateScene([{ fxwait: null }]).length);
  assert.ok(validateScene([{ pan: {} }]).length);
  assert.ok(validateScene([{ drop: 0 }]).length);
  assert.ok(validateScene([{ fade: "sideways" }]).length);
  assert.ok(validateScene([{ battle: 0 }]).length);
  assert.ok(validateScene([{ warp: "s330" }]).length, "a warp needs a spot on the new map");
  assert.ok(validateScene([{ warp: {} }]).length);
});

test("castOf names the characters an effect or a pan is placed relative to", () => {
  assert.deepEqual(castOf([{ fx: "crate", at: { near: 58, dx: 10 } }, { pan: 27 }, { pan: "player" }]).sort((a, b) => a - b), [27, 58]);
});

test("an event a scene cannot run is skipped, and no effect art is left behind", () => {
  const { events } = compileScene([{ fx: "nothing", at: [0, 0] }, { fxwait: "nothing" }], { playerId: 2, pos });
  assert.equal(events.length, 2);
  // no sheet registered under that name: nothing is placed, so nothing can be left on the map
  assert.equal(questFxSpawn(events[0]), null);
  assert.deepEqual(questFxState(), []);
  assert.deepEqual(questFxDrawables(0, 0), []);
  // and a sheet that WAS placed is cleared by the same call every scene exit runs
  defineQuestFxSheet("demo", { frame: [8, 8], clips: { idle: { frames: [0], hold: 4 } } }, { naturalWidth: 8 });
  assert.ok(questFxSpawn({ name: "demo", sheet: "demo", x: 5, y: 6 }));
  assert.equal(questFxDrawables(0, 0).length, 1);
  questFxClear();
  assert.deepEqual(questFxDrawables(0, 0), [], "cleanup on skip: the draw list is empty again");
});
