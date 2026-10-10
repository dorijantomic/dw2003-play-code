// The move resolver's dispatch-byte-0x1f arm (FIGHTSTG_F0x8009ddd8, `multiHitReset`) is
// wired onto the ordinary route, not left exported-but-unconsumed.
//
// docs/research/battle/battle-multihit-reset-wired-2026-10-06.md pins what the browser did
// before this change (it treated technique 406 as a single hit through `resolveAttack`) and
// what it now runs (the port, reached through `resolveRepeatDispatch` in web/battle.js on
// BOTH the player and enemy technique paths).
//
// The oracle is in two halves, and each half carries a MUTATION it must catch:
//   - the WIRING half reads the ordinary route's source: the port is imported and used, the
//     dispatch-0x1f gate is the shared `DAMAGE_TERM_REPEAT_WORD`, and the disc census holds
//     (exactly one technique on the disc carries dispatch 0x1f — 406 — and it is a reachable
//     enemy move, Raijinmon's `move_2`);
//   - the PORT half drives `multiHitReset` against a gate-less mutation that must differ.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  MULTI_HIT_MSG_IDS, MULTI_HIT_SLOTS, multiHitReset,
} from "../engine/dw3/battle-actor-lifecycle.ts";
import { DAMAGE_TERM_REPEAT_WORD } from "../engine/dw3/battle-damage-terms.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
const parse = (rel) => JSON.parse(read(rel));

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

// ── the WIRING: the ordinary route consumes the port ─────────────────────────────────────

test("web/battle.js imports and uses the multi-hit reset port", () => {
  assert.ok(importsFromEngine("web/battle.js", "multiHitReset"),
    "web/battle.js must import multiHitReset from the engine bundle");
  assert.ok(importsFromEngine("web/battle.js", "DAMAGE_TERM_REPEAT_WORD"),
    "web/battle.js must import the shared dispatch-0x1f word");
  const src = read("web/battle.js");
  assert.match(src, /function resolveRepeatDispatch\(/, "the resolver helper must exist");
  // Both ordinary technique paths (player side 0, enemy side 1) must gate on the record's
  // dispatch byte and hand the action to the port.
  const gateCalls = src.match(/restoreRecord\?\.dispatch === DAMAGE_TERM_REPEAT_WORD/g) ?? [];
  assert.equal(gateCalls.length, 2, "both the player and the enemy technique paths gate on 0x1f");
  assert.match(src, /resolveRepeatDispatch\(b\.player, b\.enemy, skill, 0, b\.field\)/,
    "the player path drives the port with side 0");
  assert.match(src, /resolveRepeatDispatch\(en, b\.player, skill, 1, b\.field\)/,
    "the enemy path drives the port with side 1");
});

test("the disc census: exactly one technique has dispatch 0x1f, and it is reachable", () => {
  // The census over the shipped 443-row table. `every`+filter is the whole denominator.
  const tech = parse("web/assets/data/fight_tech_table.json");
  const ids = Object.keys(tech);
  assert.equal(ids.length, 443, "the shipped technique table carries all 443 rows");
  const repeat = ids.filter((id) => (tech[id].dispatch | 0) === DAMAGE_TERM_REPEAT_WORD);
  assert.deepEqual(repeat, ["406"], "the only record with dispatch byte 0x1f is 406");
  assert.equal(DAMAGE_TERM_REPEAT_WORD, 0x1f, "the repeat word is the assembly's 0x1f");

  // Reachable: an enemy uses it, so the port runs in ordinary play.
  const enemies = parse("web/assets/data/enemies.json").enemies;
  const users = enemies.filter((e) => [e.attack, e.move_1, e.move_2].includes(406));
  assert.ok(users.some((e) => e.enemy_id === "Raijinmon" && e.move_2 === 406),
    "Raijinmon's move_2 is Back Storm (406), so the dispatch-0x1f arm is reachable");
});

// ── the PORT: the gate and the two-slot sum ──────────────────────────────────────────────

/** Drive the port, four predicate answers, and report the accumulated state. */
function runPort(answers) {
  const damages = [0, 0];
  const flags = [0, 0];
  const slots = [0, 1].map((i) => ({
    setFlag: (v) => { flags[i] = v; },
    setCaption: (v) => { damages[i] = v | 0; },
  }));
  let call = 0;
  const manager = {
    predicate: () => answers[call++] ?? 0,
    // The producer is asked with each SLOT's own technique id — the assembly passes
    // 0x1b9/0x1ba, the last two rows of the 443-row table.
    produce: (side, slotTechId) => side * 1000 + slotTechId,
  };
  const state = { count: 0, total: 0, done: 0 };
  multiHitReset(slots, { side: () => 7, id: () => 406 }, manager, state);
  return { flags, damages, count: state.count, total: state.total, done: state.done };
}

test("the port sums one damage per live slot and counts the live slots", () => {
  assert.equal(MULTI_HIT_SLOTS, 2);
  assert.deepEqual(MULTI_HIT_MSG_IDS, [0x1b9, 0x1ba]);
  const both = runPort([1, 1]);
  assert.deepEqual(both.flags, [1, 1]);
  assert.deepEqual(both.damages, [7 * 1000 + 0x1b9, 7 * 1000 + 0x1ba]);
  assert.equal(both.count, 2);
  assert.equal(both.done, 1);
  const one = runPort([1, 0]);
  assert.deepEqual(one.flags, [1, 0], "a missed slot is not flagged");
  assert.deepEqual(one.damages, [7 * 1000 + 0x1b9, 0], "a missed slot contributes no damage");
  assert.equal(one.count, 1);
  const none = runPort([0, 0]);
  assert.deepEqual(none.damages, [0, 0]);
  assert.equal(none.count, 0, "all-whiff is zero hits and zero damage");
});

/** A MUTATION: drops the predicate gate, so a missed slot contributes damage. */
function mutatedReset(slots, manager, state) {
  state.count = 0; state.total = MULTI_HIT_SLOTS; state.done = 0;
  for (let i = 0; i < MULTI_HIT_SLOTS; i++) {
    slots[i].setFlag(1);
    slots[i].setCaption(manager.produce(7, MULTI_HIT_MSG_IDS[i]) | 0);
    state.count++;
  }
  state.done = 1;
}

test("a gate-less mutation fails the port comparison", () => {
  const original = runPort([1, 0]);
  const damages = [0, 0], flags = [0, 0];
  const slots = [0, 1].map((i) => ({
    setFlag: (v) => { flags[i] = v; }, setCaption: (v) => { damages[i] = v; },
  }));
  const state = { count: 0, total: 0, done: 0 };
  mutatedReset(slots, { produce: (s, t) => s * 1000 + t }, state);
  const mutant = { flags, damages, count: state.count, total: state.total, done: state.done };
  assert.notDeepEqual(mutant, original, "the mutation must differ");
  assert.equal(mutant.count, 2, "the mutation counts a missed slot as live");
  assert.equal(original.count, 1, "the original counts one live slot");
  assert.equal(mutant.damages[1], 7 * 1000 + 0x1ba, "the mutation gives damage to a missed slot");
  assert.equal(original.damages[1], 0, "the original gives a missed slot no damage");
});
