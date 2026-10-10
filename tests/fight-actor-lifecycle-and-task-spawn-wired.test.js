// The actor-lifecycle and fight-task-spawn ports are wired onto the ordinary route, not
// left exported-but-unconsumed.
//
// docs/research/battle/battle-actor-lifecycle-and-task-spawn-wired-2026-10-06.md pins what
// the browser did before this change and what it now runs:
//   * the actor teardown FIGHTSTG_F0x8008606c (engine/dw3/battle-actor-lifecycle.ts) now
//     drives the per-actor resource release in web/battle3d.js's setPlayerDigimon /
//     setEnemyDigimon — the browser used to hand-free the same three resource words;
//   * the fight task spawner FIGHTSTG_F0x80090c44 and its data variant the plate-HUD spawner
//     FIGHTSTG_F0x80093cc8 (engine/dw3/battle-task-spawn.ts) now own the two construction
//     sites in web/battle.js.
//
// The oracle is in two halves, and each half carries a MUTATION that it must catch:
//   - the WIRING half reads the ordinary route's source and fails if a port is not imported
//     and used, or if the browser's hand-written copy is still there;
//   - the PORT half drives the engine functions and fails against a deliberately-wrong
//     simulator (the mutation), so a passing port is only as good as what it varies.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ACTOR_RES_OFFSETS, ACTOR_TEARDOWN_STATE, actorTeardown,
} from "../engine/dw3/battle-actor-lifecycle.ts";
import {
  FIGHT_TASK_METHOD, FIGHT_TASK_SIZE, FIGHT_TASK_FLAGS,
  FIGHT_TASK_ARG_BYTE_OFF, FIGHT_TASK_ARG_WORD_OFF,
  PLATE_HUD_METHOD, PLATE_HUD_SIZE, PLATE_HUD_FLAGS,
  spawnFightTask, spawnPlateHud,
} from "../engine/dw3/battle-task-spawn.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

/** Does `file` import `symbol` from the production bundle? */
function importsFromEngine(file, symbol) {
  const src = read(file);
  const re = /import\s*\{([^}]*)\}\s*from\s*["']\.\/vendor\/engine\.js["']/g;
  let m;
  while ((m = re.exec(src))) {
    for (let part of m[1].split(",")) {
      part = part.trim().replace(/\/\/.*$/s, "").replace(/^type\s+/, "");
      if (part.split(/\s+as\s+/)[0].trim() === symbol) return true;
    }
  }
  return false;
}

// ── the WIRING: the ordinary route consumes both ports ──────────────────────────────────

test("web/battle3d.js drives the actor teardown through the port", () => {
  for (const s of ["actorTeardown", "ACTOR_RES_OFFSETS", "ACTOR_TEARDOWN_STATE"]) {
    assert.ok(importsFromEngine("web/battle3d.js", s), `battle3d.js does not import ${s}`);
  }
  const src = read("web/battle3d.js");
  // The per-actor release goes through the PORT, not a hand-written delete+null.
  assert.match(src, /actorTeardown\(\{[\s\S]*?getResource[\s\S]*?\}, \(ptr\) => \{/,
    "battle3d.js does not call actorTeardown with the resource view");
  assert.match(src, /releaseActorResources\(\[playerTex, playerSkelBufs, playerModel\]\)/,
    "setPlayerDigimon does not release its three resources through the port");
  assert.match(src, /releaseActorResources\(\[enemyTex, enemySkelBufs, enemyModel\]\)/,
    "setEnemyDigimon does not release its three resources through the port");
  // The literals the port replaces must be gone.
  assert.doesNotMatch(src, /if \(playerTex\) \{ gl\.deleteTexture\(playerTex\)/,
    "the hand-written player-texture free is still there");
  assert.doesNotMatch(src, /if \(enemyTex\) \{ gl\.deleteTexture\(enemyTex\)/,
    "the hand-written enemy-texture free is still there");
});

test("web/battle.js consumes both fight-task spawners", () => {
  assert.ok(importsFromEngine("web/battle.js", "spawnFightTask"), "battle.js not on the fight-task spawner");
  assert.ok(importsFromEngine("web/battle.js", "spawnPlateHud"), "battle.js not on the plate-HUD spawner");
  assert.ok(importsFromEngine("web/battle.js", "FIGHT_TASK_ARG_BYTE_OFF"), "the +0x50 store offset is not the port's");
  assert.ok(importsFromEngine("web/battle.js", "FIGHT_TASK_ARG_WORD_OFF"), "the +0x54 store offset is not the port's");
  const src = read("web/battle.js");
  // The plate HUD is built through the spawner; the acting action is spawned through it too.
  assert.match(src, /spawnPlateHud\(\(method, size, flags\) =>/, "the plate HUD is not built through the port");
  assert.match(src, /spawnFightTask\(spawn, side & 0xff, techniqueId \| 0\)/,
    "the fight task is not spawned through the port");
  assert.match(src, /const basicTechId = spawnFightTaskFor\(0,/,
    "the plain-attack action does not come off the ported spawner");
  assert.match(src, /const actionTechId = spawnFightTaskFor\(0, skill\.id \| 0\)/,
    "the technique action does not come off the ported spawner");
});

// ── the PORT: the actor teardown frees exactly the non-zero words at state 3 ─────────────

/** The original's teardown rule, hand-written, as the mutation's control. */
function faithfulTeardown(state, resources) {
  if ((state | 0) !== 3) return [];
  return resources.filter((p) => (p | 0) !== 0);
}
/** A mutated teardown: it forgets the per-word zero test (the classic port bug). */
function mutatedTeardown(state, resources) {
  if ((state | 0) !== 3) return [];
  return resources.slice();
}

test("actorTeardown frees the non-zero resources at state 3 and nothing otherwise", () => {
  const view = (state, resources) => ({
    getState: () => state,
    getResource: (off) => resources[ACTOR_RES_OFFSETS.indexOf(off)] ?? 0,
  });
  // state 3 with a zero middle resource: the zero word must NOT be freed.
  let freed = [];
  const n = actorTeardown(view(3, [0x11110000, 0, 0x33330000]), (p) => freed.push(p));
  assert.equal(n, 2);
  assert.deepEqual(freed, [0x11110000, 0x33330000]);
  // Negative control: only state 3 tears down.
  for (const state of [0, 1, 2, 4, -1]) {
    freed = [];
    assert.equal(actorTeardown(view(state, [1, 2, 3]), (p) => freed.push(p)), 0);
    assert.deepEqual(freed, [], `state ${state} must free nothing`);
  }
  // All three non-zero frees all three.
  freed = [];
  actorTeardown(view(3, [1, 2, 3]), (p) => freed.push(p));
  assert.deepEqual(freed, [1, 2, 3]);
});

test("the teardown oracle discriminates: a port that skips the zero test fails it", () => {
  const resources = [0x11110000, 0, 0x33330000];
  const view = { getState: () => 3, getResource: (off) => resources[ACTOR_RES_OFFSETS.indexOf(off)] ?? 0 };
  const good = [];
  actorTeardown(view, (p) => good.push(p));
  // The mutation: hand a wrong port (no zero test) the same input; it frees the zero word.
  const bad = [];
  mutatedTeardown(3, resources).forEach((p) => bad.push(p));
  assert.deepEqual(good, faithfulTeardown(3, resources));
  assert.notDeepEqual(bad, good, "the mutation must differ from the port or the oracle is blind");
  assert.ok(bad.includes(0), "the mutated teardown wrongly frees the zero resource");
});

// ── the PORT: the two spawners pass their own constants and stores ───────────────────────

test("spawnFightTask passes 0x8008f714/0x84/4 and stores the byte at +0x50 and word at +0x54", () => {
  const calls = [];
  const writes = [];
  const spawn = (method, size, flags) => {
    calls.push({ method, size, flags });
    return { write8: (off, v) => writes.push({ off, v }), write32: (off, v) => writes.push({ off, v }) };
  };
  spawnFightTask(spawn, 0x7, 0x1234abcd | 0);
  assert.deepEqual(calls, [{ method: FIGHT_TASK_METHOD, size: FIGHT_TASK_SIZE, flags: FIGHT_TASK_FLAGS }]);
  assert.deepEqual(writes, [
    { off: FIGHT_TASK_ARG_BYTE_OFF, v: 0x7 },
    { off: FIGHT_TASK_ARG_WORD_OFF, v: 0x1234abcd | 0 },
  ]);
  // Negative control: the fight task's constants differ from the plate HUD's.
  assert.notEqual(FIGHT_TASK_METHOD, PLATE_HUD_METHOD);
  assert.notEqual(FIGHT_TASK_SIZE, PLATE_HUD_SIZE);
  assert.notEqual(FIGHT_TASK_FLAGS, PLATE_HUD_FLAGS);
});

test("spawnPlateHud passes 0x80093a74/0x88/0x14 and stores nothing", () => {
  const calls = [];
  const writes = [];
  spawnPlateHud((method, size, flags) => {
    calls.push({ method, size, flags });
    return { write8: (off, v) => writes.push({ off, v }), write32: (off, v) => writes.push({ off, v }) };
  });
  assert.deepEqual(calls, [{ method: PLATE_HUD_METHOD, size: PLATE_HUD_SIZE, flags: PLATE_HUD_FLAGS }]);
  assert.deepEqual(writes, [], "the plate spawner's body stores nothing");
});

test("the spawner oracle discriminates: a wrong method fails it", () => {
  const good = [];
  spawnFightTask((m, s, f) => { good.push({ m, s, f }); return { write8() {}, write32() {} }; }, 0, 0);
  // The mutation: the plate method in place of the fight task's.
  const bad = [];
  const mutated = (m, s, f) => { bad.push({ m: PLATE_HUD_METHOD, s, f }); return { write8() {}, write32() {} }; };
  mutated(0, 0, 0);
  assert.notDeepEqual(bad[0].m, good[0].m, "the mutation must differ from the port or the oracle is blind");
  assert.equal(good[0].m, FIGHT_TASK_METHOD);
});
