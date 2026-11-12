// The online arena runs the same rule as single player: no counter stance exists. A foe using a record whose
// effect is "counter" (f7 == 10) builds none, whether it is its own Fight or a named technique.
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

const namedRows = [
  { comparator: 4, value: 0 }, { comparator: 4, value: 0 }, { comparator: 4, value: 0 }, { action: 2 },
];

test("online: a foe's own Fight or named record with effect counter builds no stance", () => {
  for (const rows of [undefined, namedRows]) {
    const { foe, res } = foeTurn(rows);
    assert.ok(res.sk === 335 || res.sk === 63, "the foe used one of its records");
    assert.equal(foe.counterStance, undefined);
  }
});
