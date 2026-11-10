// Card 05-online-counter-gate: the online arena runs the SAME enemy counter-stance gate as
// single player (web/battle.js setEnemyCounterStance, disc fightstg.s:28440-28463). A foe's
// own basic technique (action 1) sets no stance even when the skill record says effect
// "counter"; a named technique (action 2) still sets one.
import test from "node:test";
import assert from "node:assert/strict";
import { Arena } from "../web/mpbattle-rules.js";

const FIGHT = { id: 335, name: "Fight", mp_cost: 0, attack_category: "physical", effect: "counter", power: 20, hits: 1 };
const TECH = { id: 63, name: "Sharp Claw", mp_cost: 0, attack_category: "physical", effect: "counter", power: 25, hits: 1 };

const kit = { skillDB: () => ({ 335: FIGHT, 63: TECH }), techRecord: () => null };

function mon(over = {}) {
  return {
    profile: { id: 7, name: "T" }, hp: 400, maxHp: 400, mp: 60, maxMp: 60, level: 5,
    str: 30, def: 20, spd: 25, wit: 20, ailments: {}, ...over,
  };
}

function foeTurn(aiMoves) {
  const foe = mon({ eStats: { attack: 335, move_1: 63, ai_moves: aiMoves } });
  const ar = new Arena({
    kit, players: [{ id: 0, name: "P", rec: mon() }], foes: [{ name: "E", rec: foe }], rng: () => 3,
  });
  return { foe, res: ar.foeAction("e0") };
}

// Three rows whose condition fails (mp < 0), so the pick falls through to row 3, action 2.
const namedRows = [
  { comparator: 4, value: 0 }, { comparator: 4, value: 0 }, { comparator: 4, value: 0 }, { action: 2 },
];

test("online: a foe's own Fight carrying effect counter sets no stance", () => {
  const { foe, res } = foeTurn(undefined);
  assert.equal(res.sk, 335, "the foe used its own Fight record");
  assert.equal(foe.counterStance, undefined);
});

test("online: a foe's named counter technique still sets the stance", () => {
  const { foe, res } = foeTurn(namedRows);
  assert.equal(res.sk, 63, "the foe used its named technique");
  assert.deepEqual(foe.counterStance, { uses: 3 });
});
