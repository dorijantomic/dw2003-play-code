// Where the walker publishes the route pair — the two writer sites, wired.
//
// The disc writes [D0x80048D34+0x44] / [+0x46] from a type-7 step record's own
// params[5] / params[6], and only when the step opcode is 1, 9 or 10
// (engine/systems/route-pair.ts carries the decode). The walker's two jobs are:
//
//   1. the ported playback executor must publish the pair for those three opcodes and
//      for no other, so `activeExitAt` can hand the record's own numbers to the warp;
//   2. the warp must publish exactly that pair, and a transition that NO publishing step
//      produced must leave both halves alone.
//
// This file checks (1) against the shipped step programs and (2) against the shipped
// route-gated NPCs, i.e. against the data a player actually walks into.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import {
  execPlaybackRecord, isDivePlayback, isStageChangePlayback, launcherRouteWords,
} from "../engine/systems/scene-step-ops.ts";
import { routePairCommit, routePairPredicate, publishesRoutePair }
  from "../engine/systems/route-pair.ts";

const read = (p) => JSON.parse(readFileSync(p, "utf8"));
const STEPS = read("web/assets/data/story_steps.json").stages;
const NPC_FLAGS = read("web/assets/data/npc_flag_sets.json").flag_sets;

/** Every op-1/9/10 record the disc ships, with the pair its handler would publish. */
function publishingRecords() {
  const out = [];
  for (const [stage, program] of Object.entries(STEPS)) {
    for (const record of program.steps ?? []) {
      if (!publishesRoutePair(record.op)) continue;
      const effect = execPlaybackRecord(record, 0);
      // Site A is the executor's own body; site B is one call deeper, in the dive
      // launcher's chain. Both read the same two fields of this record.
      const pair = effect.routeWords ?? launcherRouteWords(record.op, record.params);
      out.push({ stage, op: record.op, pair });
    }
  }
  return out;
}

/** Every maze exit record's pair, read out of the shipped scene JSON. */
function mazeExitPairs() {
  const pairs = new Set();
  for (const file of readdirSync("web/assets/scenes")) {
    if (!file.endsWith(".json")) continue;
    const scene = read(`web/assets/scenes/${file}`);
    for (const section of scene.mazeSections ?? []) {
      for (const exit of section.exits ?? []) {
        if (exit.key || exit.companion) pairs.add(`${exit.key | 0}:${exit.companion | 0}`);
      }
    }
  }
  return pairs;
}

/** Each route-gated NPC dialogue, as the (key, companion) its two 0x7E gates name. */
function gatedNpcs() {
  const byDialogue = new Map();
  for (const row of NPC_FLAGS) {
    const gates = (row.gate ?? []).filter(([id]) => ((id >> 8) & 0xfe) === 0x7e);
    if (!gates.length) continue;
    let key = null;
    let companion = null;
    for (const [id, expected] of gates) {
      if (expected !== 1) continue;
      const index = id & 0x1ff;
      if (index < 0x1e) key = index + 1;
      else companion = index - 0x1d;
    }
    if (key === null || companion === null) continue;
    const id = `${row.stage}/${row.npc_id}/${row.slot}/${row.dialogue_id}`;
    if (!byDialogue.has(id)) byDialogue.set(id, []);
    byDialogue.get(id).push({ key, companion });
  }
  return byDialogue;
}

test("every publishing step carries the pair its record names, and nothing else does", () => {
  const records = publishingRecords();
  assert.ok(records.length > 700, `the shipped op-1/9/10 programs (${records.length} records)`);
  for (const { stage, op, pair } of records) {
    assert.ok(pair, `${stage} op ${op} published no pair`);
    assert.deepEqual(pair, {
      d78: pair.d78 & 0xffff,
      d7a: pair.d7a & 0xffff,
    });
  }
  // And an op that does not publish cannot be mistaken for one that publishes zero.
  for (const op of [0, 2, 3, 4, 5, 6, 7, 8, 11, 12, 13, 14, 15, 99]) {
    assert.equal(execPlaybackRecord({ op, params: [1, 2, 3, 4, 5, 6, 7] }, 0).routeWords,
      undefined, `op ${op} writes neither half in the executor's body`);
    assert.equal(launcherRouteWords(op, [1, 2, 3, 4, 5, 6, 7]), undefined,
      `op ${op} reaches no launcher chain either`);
  }
});

test("161 shipped step records publish a non-zero pair, and they are dives and doors", () => {
  // The ledger's 161 family-B route-gated NPCs hang off exactly this many records.
  const keyed = publishingRecords().filter((r) => r.pair.d78 !== 0 || r.pair.d7a !== 0);
  assert.equal(keyed.length, 161);
  for (const { op } of keyed) {
    assert.ok(isStageChangePlayback(op) || isDivePlayback(op),
      `op ${op} is one of the two writer chains`);
  }
  // Ops 9 and 10 really are among them: the Submarimon water entrances are op 10.
  assert.ok(keyed.some((r) => r.op === 10), "op 10 publishes a pair");
});

test("every route-gated NPC's pair is published by a step record or a maze exit record", () => {
  // This is the player-visible statement: entering an underground screen by one door
  // puts one cast in the room, and by another door a different cast. The two scalars
  // the disc writes are exactly what decides which, so every gate the data ships must
  // be answerable by a pair the walker now publishes.
  const stepPairs = new Set(publishingRecords().map((r) => `${r.pair.d78}:${r.pair.d7a}`));
  const mazePairs = mazeExitPairs();
  const gated = gatedNpcs();
  let byStep = 0;
  let byMaze = 0;
  const missing = [];
  for (const [dialogue, pairs] of gated) {
    for (const pair of pairs) {
      const key = `${pair.key}:${pair.companion}`;
      if (stepPairs.has(key)) byStep++;
      else if (mazePairs.has(key)) byMaze++;
      else missing.push(`${dialogue} ${key}`);
    }
  }
  assert.deepEqual(missing, [], "no route-gated NPC is left without a published pair");
  assert.equal(byStep, 104);
  assert.equal(byMaze, 69);
});

test("a published pair answers its own two gates and nothing else", () => {
  // The two gates an NPC carries are one from each side of the 0x1e boundary, so a
  // correct publication satisfies exactly that pair's two ids among the 38 shipped.
  for (const [, pairs] of gatedNpcs()) {
    for (const pair of pairs) {
      const state = { key: pair.key, companion: pair.companion };
      assert.equal(routePairPredicate(pair.key - 1, state), 1, "its key-side gate");
      assert.equal(routePairPredicate(0x1e + pair.companion - 1, state), 1, "its companion-side gate");
      assert.equal(routePairPredicate(0x1e + pair.companion, state), 0, "the next companion slot");
    }
  }
});

test("web/game.js writes the pair only through the ported commit", () => {
  // The commit itself is ported and unit-tested below; what is left to check in the
  // shipped source is that the page has no second, hand-rolled way to set the pair —
  // no `?? 0` clear of its own, and no write outside the one guarded block.
  const src = readFileSync("web/game.js", "utf8");
  const writes = src.match(/state\.entryKey\s*=[^=]|state\.entryCompanion\s*=[^=]/g) ?? [];
  assert.equal(writes.length, 2,
    `the two halves, and only inside the one block that a published pair guards: ${writes.length}`);
  assert.match(src,
    /const routeCommit = routePairCommit\(ex\);\s*if \(routeCommit\) \{\s*state\.entryKey = routeCommit\.key;\s*state\.entryCompanion = routeCommit\.companion;/,
    "the pair the warp publishes is the ported decision, not a row written here");
  assert.ok(!/state\.entryKey = ex\.entryKey \?\? 0/.test(src),
    "no transition clears the pair by writing a zero of its own");
  // `activeExitAt` is what attaches the record's pair to the exit row. The row also
  // may have its `to` swapped for the one screen id the disc resolves at story point
  // 45 (the s9xx shadow record, pro/fieldstg.s:0xf460); the pair itself is still the
  // record's own two words, attached from whichever writer site reached it.
  assert.match(src,
    /const dest = swappedStepDestination\(pb\);\s*return \{ \.\.\.hit, \.\.\.\(dest \? \{ to: dest \} : \{\}\), routeWords: pb\.routeWords \};/,
    "the exit row carries the step's pair, from whichever writer site reached it");
  assert.match(src, /if \(!pb\.routeWords\) return hit;/,
    "a step that publishes nothing leaves the exit row alone");
  // The destination swap is the one thing that must stay behind the post-game test.
  assert.match(src,
    /function swappedStepDestination\(pb\) \{\s*if \(!screenRouterOptions\.useAlt\(\)\) return null;/,
    "a door's destination is re-decided only at the post-game ordinal, the one test fieldstg's screen-table base makes (0xf468/0xf46c/0xf478)");
});

test("a transition publishes a pair only when a writer site ran for it", () => {
  // The ported decision, asked the four ways a real transition arrives.
  // 1. a dive (site B): the record's own two fields, read verbatim.
  assert.deepEqual(routePairCommit({ routeWords: { d78: 2, d7a: 1 } }), { key: 2, companion: 1 });
  assert.deepEqual(routePairCommit({ routeWords: { d78: 12, d7a: 1 } }), { key: 12, companion: 1 });
  // 2. an unkeyed door (site A): the stores have no zero test, so (0,0) is published —
  //    and a cleared half answers no index on either band.
  const cleared = routePairCommit({ routeWords: { d78: 0, d7a: 0 } });
  assert.deepEqual(cleared, { key: 0, companion: 0 }, "an unkeyed step really publishes (0,0)");
  for (const index of [0, 1, 0x1d, 0x1e, 0x25]) {
    assert.equal(routePairPredicate(index, cleared), 0, `index ${index} on a cleared pair`);
  }
  // 3. a transition no writer site reached: nothing at all, which is NOT a clear.
  for (const exit of [{}, { selfWarp: false }, { selfWarp: true },
                      { selfWarp: true, entryKey: null }, { selfWarp: true, entryKey: null, entryCompanion: 3 }]) {
    assert.equal(routePairCommit(exit), null,
      `a handoff / pad / plain door publishes nothing (${JSON.stringify(exit)})`);
  }
  // 4. a maze self-warp: the pair out of the disc's own exit table, both halves or none.
  assert.deepEqual(routePairCommit({ selfWarp: true, entryKey: 4, entryCompanion: 1 }),
    { key: 4, companion: 1 });
  assert.deepEqual(routePairCommit({ selfWarp: true, entryKey: 7 }),
    { key: 7, companion: 0 }, "a hop whose table row carries no companion publishes 0 for it");
});

test("every warp the shipped data builds answers the ported commit as the disc does", () => {
  // Walk the shipped scenes. A tile a publishing record names publishes that record's
  // own pair; a stage with no publishing record at all publishes nothing on any of its
  // doors. No shape invents a zero of its own.
  const GRIDS = read("web/assets/data/story_trigger_grids.json").stages;
  let keyed = 0;
  let silent = 0;
  let tiles = 0;
  for (const file of readdirSync("web/assets/scenes")) {
    if (!file.endsWith(".json")) continue;
    const stage = file.slice(1, -5);
    const scene = read(`web/assets/scenes/${file}`);
    const program = STEPS[stage]?.steps ?? [];
    const grid = GRIDS[stage];
    // The publishing records this stage's own grid names, and the pair each publishes.
    const named = [];
    if (grid) {
      for (let r = 0; r < grid.h; r++) {
        for (let c = 0; c < grid.w; c++) {
          const cell = grid.grid[r * grid.w + c] | 0;
          if (!cell) continue;
          const record = program[cell & 0x1f];
          if (!record || !publishesRoutePair(record.op)) continue;
          // The executor, run on the cell's own group bit — the path the page takes.
          const effect = execPlaybackRecord(record, cell >> 5);
          const pair = routePairCommit({
            routeWords: effect.routeWords ?? launcherRouteWords(record.op, record.params),
          });
          assert.deepEqual(pair,
            { key: (record.params?.[5] ?? 0) & 0xffff, companion: (record.params?.[6] ?? 0) & 0xffff },
            `${stage} cell ${r},${c} (op ${record.op}) publishes its record's own two fields`);
          named.push(record);
          tiles++;
        }
      }
    }
    if (!named.length) {
      // No step record on this stage reaches a writer site, so every one of its exits
      // leaves both halves exactly as the last writer left them. (A maze self-warp is
      // the one exit that carries a pair of its own — out of the disc's exit table.)
      for (const exit of scene.exits ?? []) {
        assert.equal(routePairCommit({ to: exit.to }), null,
          `${stage} -> ${exit.to} reaches no writer site`);
        silent++;
      }
    }
    keyed += named.filter((r) => (r.params?.[5] | 0) || (r.params?.[6] | 0)).length;
  }
  assert.ok(tiles > 700, `the publishing tiles in the shipped grids (${tiles})`);
  assert.ok(keyed > 100, `the ones that name a non-zero route (${keyed})`);
  assert.ok(silent > 0, `warps that publish nothing (${silent})`);
});
