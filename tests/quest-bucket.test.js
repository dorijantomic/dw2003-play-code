// The quest scenes' draw-bucket step (web/quest-scenes.js -> web/game.js): the PLAYER draws behind the map band
// (bucket 8 -- the Protocol Ruins tunnel's own trick, where the ground covers them as they walk) or back in front of
// it (bucket 4, the disc's entity bucket). The writer already exists: setup op 5 puts a step record's param 0 into the
// player actor's +0x78 draw-layer word (engine/systems/scene-step-ops.ts `actor78`), and the host applies that word
// every frame in `stepSetupBucketTick`. A scene's step therefore cannot just write the bucket once -- the per-frame
// tick would take it back on an op-5 tile, and a scene that ended on 8 would leave the player behind the map. So the
// step sets an override the tick respects, and every scene exit restores the player to ENTITY_BUCKET.
//
// The disc's own numbers (docs/research/scripting/field-script-engine-verified.md:488): +0x78 is the field actor's
// ordering-table bucket; the five stages that author op 5 use exactly 8 (behind the ground) and 4 (the entity bucket).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compileScene, validateScene } from "../web/quest-scenes.js";

const GAME = readFileSync(new URL("../web/game.js", import.meta.url), "utf8");
const pos = () => ({ x: 0, y: 0 });
const compile = (steps) => compileScene(steps, { playerId: 2, pos });

/** One function declaration out of web/game.js, braces balanced (the field has template literals and nested blocks). */
function bodyOf(name) {
  const begin = GAME.indexOf(`function ${name}(`);
  assert.ok(begin >= 0, `web/game.js still declares ${name}()`);
  let depth = 0;
  let i = GAME.indexOf("{", begin);
  for (; i < GAME.length; i++) {
    if (GAME[i] === "{") depth++;
    else if (GAME[i] === "}" && --depth === 0) break;
  }
  return GAME.slice(begin, i + 1);
}

/**
 * The real `stepSetupBucketTick`, lifted out of web/game.js and wired to a stub field: the tile under the player's
 * feet (or none), the scene's override, and the map-change default. It closes over `stepSetupBucketMap`, which is
 * bound the same way so its "new map resets the bucket" arm is exercised too.
 */
function makeBucketTick({ questBucket = null, effect = null } = {}) {
  const state = { _questBucket: questBucket, playerDrawBucket: 1 };
  const world = { state, map: "s261", effect, stepSetupBucketMap: null };
  world.tick = new Function(
    "state", "currentMap", "stepSetup", "fade", "ENTITY_BUCKET", "stepSetupBucketMap",
    `${bodyOf("stepSetupBucketTick")}\nreturn stepSetupBucketTick;`,
  )(
    state,
    () => ({ id: world.map }),
    () => (world.effect ? { effect: world.effect } : null),
    { dir: 0 },
    4,
    null,
  );
  return world;
}

test("one step becomes one host event carrying the bucket number", () => {
  for (const n of [8, 4]) {
    const { opcodes, events, errors } = compile([{ bucket: n }]);
    assert.deepEqual(errors, []);
    assert.deepEqual(events, [{ kind: "bucket", value: n }], `bucket ${n}: one event, the number untouched`);
    assert.deepEqual(opcodes, ["FN6A 1 2", "SCENEEVENT 0", "END"], "the step waits for nothing");
  }
});

test("only a whole number 0 to 15 is a bucket: anything else is exactly one error and emits nothing", () => {
  for (const v of [16, -1, "8", 4.5, true, null, undefined, NaN, Infinity]) {
    const { events, errors } = compile([{ bucket: v }]);
    assert.equal(errors.length, 1, `${String(v)} is refused once`);
    assert.equal(events.length, 0, `no half-played bucket for ${String(v)}`);
  }
  // the whole range is accepted, with the scene's own validation agreeing
  for (const n of [0, 15]) {
    assert.deepEqual(compile([{ bucket: n }]).errors, []);
    assert.deepEqual(validateScene([{ bucket: n }]), []);
  }
  assert.equal(validateScene([{ bucket: 16 }]).length, 1, "validation reports a bad bucket with the switch off");
});

test("the disc's own op-5 records: 8 of them, only 4 or 8, on exactly the five stages that author the word", () => {
  const { stages } = JSON.parse(readFileSync("web/assets/data/story_steps.json", "utf8"));
  const rows = [];
  for (const [stage, rec] of Object.entries(stages)) {
    for (const s of rec.steps ?? []) if (s.op === 5) rows.push({ stage, value: s.params?.[0] });
  }
  assert.equal(rows.length, 8, "setup op 5 is authored 8 times over the whole story");
  for (const r of rows) {
    assert.ok(r.value === 4 || r.value === 8, `stage ${r.stage}: params[0] = ${r.value}, a shipped bucket`);
  }
  assert.deepEqual([...new Set(rows.map((r) => r.stage))].sort(),
    ["261", "375", "376", "934", "949"], "the five stages that use the tunnel trick");
});

test("the per-frame tick respects the scene override and keeps the op-5 write when there is none", () => {
  const tick = bodyOf("stepSetupBucketTick");
  assert.match(tick, /state\._questBucket/, "the tick reads the scene's override");
  assert.match(tick, /eff\.actor78/, "and still applies a step program's own op-5 word");
  assert.match(tick, /state\.playerDrawBucket = state\._questBucket/, "the override is what the player draws with");
});

test("every scene exit puts the player back in front of the map and clears the override", () => {
  const reset = bodyOf("questSceneFxReset");
  assert.match(reset, /state\.playerDrawBucket = ENTITY_BUCKET/, "back to the entity bucket (4) on every exit");
  assert.match(reset, /delete state\._questBucket/, "the override does not outlive the scene");
});

test("the game performs the event: case \"bucket\" sets the override and the bucket at once", () => {
  const run = bodyOf("runQuestSceneEvent");
  assert.match(run, /case "bucket":/, "the event reaches the scene's host");
  assert.match(run, /state\._questBucket = ev\.value/, "the scene's number becomes the override");
  assert.match(run, /state\.playerDrawBucket = ev\.value/, "and the player draws that way on this very frame");
});

test("fixture: the override beats an op-5 tile that writes 4; with no override the tile's own word applies", () => {
  const scene = makeBucketTick({ questBucket: 8, effect: { actor78: 4 } });
  assert.equal(scene.tick(), 8, "the tick returns 8 while the scene holds it");
  assert.equal(scene.state.playerDrawBucket, 8, "on a tile whose op-5 record writes 4");
  assert.equal(scene.tick(), 8, "and every frame after it");

  const tile = makeBucketTick({ questBucket: null, effect: { actor78: 4 } });
  assert.equal(tile.tick(), 4, "with no override the disc's own op-5 word is what the player draws with");
  const behind = makeBucketTick({ questBucket: null, effect: { actor78: 8 } });
  assert.equal(behind.tick(), 8, "a tile that writes 8 still puts the player behind the ground");
});

test("authoring: a bucket(n) helper in the DSL and the fx brief's row name the two shipped values", () => {
  const dsl = readFileSync(new URL("../data/authored/quests/dsl.py", import.meta.url), "utf8");
  assert.match(dsl, /^def bucket\(n\):/m, "dsl.py offers bucket(n)");
  assert.match(dsl, /return \{"bucket": int\(n\)\}/, "the helper writes the step the compiler reads");
  const brief = readFileSync(new URL("../docs/quests-fx-brief.md", import.meta.url), "utf8");
  assert.match(brief, /\| `bucket` \|/, "the step has its row in the brief");
  assert.match(brief, /`bucket\(8\)`/, "the brief shows 8, behind the map band");
  assert.match(brief, /`bucket\(4\)`/, "and 4, back in front");
});
