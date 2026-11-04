// The `anim` step (web/quest-scenes.js): one of the actor's own animation clips, instead of only walking and facing.
//
// The disc's own wstag scripts use SETANIM <actor> <clip> <facing>: actor->vt+0x148(clip, facing) only latches the clip
// (+0xa0) and the facing (+0x60) and resets the counters; the per-frame loader resolves the clip through the actor's own
// animation directory (docs/research/field/field-actor-anim-engine.md, wstag-script-decode.md op 1.1). The two clip
// meanings the research reads are idle = 1 and talk = 7 (a working reading, low confidence); every other clip is the
// number the actor's own sheet holds.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { compileScene, validateScene, castOf, ANIMS } from "../web/quest-scenes.js";
import { createCutscene } from "../engine/systems/cutscene-manager.ts";

const pos = (id) => (id === 2 ? { x: 100, y: 200 } : id === 27 ? { x: 923, y: 374 } : null);

test("the two clips the research knows are idle and talk, nothing else is a name", () => {
  assert.deepEqual(ANIMS, { idle: 1, talk: 7 });
});

test("a named clip with a facing is the game's own SETANIM", () => {
  const { opcodes, errors } = compileScene([{ anim: "talk", who: 27, face: "left" }], { playerId: 2, pos });
  assert.deepEqual(errors, []);
  assert.deepEqual(opcodes, ["FN6A 1 2", "SETANIM 27 7 2", "END"]);
});

test("a clip number is passed through as the actor's own sheet number, facing defaults to 0", () => {
  const { opcodes, errors } = compileScene([{ anim: 5, who: 27 }], { playerId: 2, pos });
  assert.deepEqual(errors, []);
  assert.deepEqual(opcodes, ["FN6A 1 2", "SETANIM 27 5 0", "END"]);
});

test("the player can be the actor, by the scene's own player id", () => {
  const { opcodes, errors } = compileScene([{ anim: "idle", who: "player", face: "up" }], { playerId: 2, pos });
  assert.deepEqual(errors, []);
  assert.deepEqual(opcodes.slice(1, 2), ["SETANIM 2 1 4"]);
});

test("an unknown name, a bad clip number or a bad facing is exactly one error naming the value", () => {
  for (const [step, needle] of [
    [{ anim: "sit" }, "sit"],
    [{ anim: 0 }, "0"],
    [{ anim: 256 }, "256"],
    [{ anim: 5.5 }, "5.5"],
    [{ anim: "talk", who: 27, face: 8 }, "8"],
    [{ anim: "talk", who: 27, face: "sideways" }, "sideways"],
  ]) {
    const { errors } = compileScene([step], { playerId: 2, pos });
    assert.equal(errors.length, 1, `${JSON.stringify(step)} must be one error, got ${JSON.stringify(errors)}`);
    assert.ok(errors[0].includes(needle), `${JSON.stringify(errors[0])} names the value ${needle}`);
  }
  assert.ok(validateScene([{ anim: "talk" }]).length, "a clip with nobody to play it is reported");
});

test("castOf names the character a pose is played on, and every shipped scene still compiles", () => {
  assert.deepEqual(castOf([{ anim: "talk", who: 27 }]), [27]);
  const quests = JSON.parse(readFileSync(new URL("../web/quests.json", import.meta.url), "utf8")).quests;
  for (const q of quests) {
    for (const sc of [q.offer?.scene, q.acceptScene, q.doneScene, q.turnIn?.scene, ...q.objectives.map((o) => o.scene)]) {
      if (sc) assert.deepEqual(validateScene(sc), [], `scene of ${q.id}`);
    }
  }
});

test("the VM latches the clip and the facing and stops the walk in progress", () => {
  const textbox = { isOpen: () => false, open: () => {} };
  const entity = { x: 10, y: 20, dir: "down", _cutTarget: { x: 500, y: 500 } };
  const cs = createCutscene(textbox, () => null, (id) => (id === 27 ? entity : null));
  cs.start(["SETANIM 27 7 2", "END"], null);
  assert.equal(cs.step(0.016), false, "END finishes the scene in the same step");
  assert.equal(entity.activeClip, 7, "the talk clip is latched");
  assert.equal(entity.dir, "left", "the facing operand turned the actor");
  assert.equal(entity._cutTarget, undefined, "the stale walk target is dropped (the actor's own set_anim)");
  assert.equal(entity._inCutscene, true);
});

test("the authoring DSL has an anim helper that writes the step", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  assert.match(readFileSync(new URL("../data/authored/quests/dsl.py", import.meta.url), "utf8"), /^def anim\(/m);
  const py = spawnSync("python3", ["-c",
    "import json,sys; sys.path.insert(0,'data/authored/quests'); import dsl; " +
    "print(json.dumps([dsl.anim(27,'talk','left'), dsl.anim(27,5), dsl.anim('player','idle',2)]))",
  ], { cwd: root, encoding: "utf8" });
  assert.equal(py.status, 0, py.stderr);
  assert.deepEqual(JSON.parse(py.stdout), [
    { anim: "talk", who: 27, face: "left" },
    { anim: 5, who: 27 },
    { anim: "idle", who: "player", face: 2 },
  ]);
});
