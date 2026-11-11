// The enemy side of the party markers: one square per enemy team member, coloured by
// state (0 full, 1 hurt, 2 knocked out, 3 afflicted), the active one on the active cel.
// Original: FIGHTSTG_F0x800934f0 draws every present enemy record unless the battle
// kind word 0x800a4536 is 4 or more (the finale draws one).
import { test } from "node:test";
import assert from "node:assert/strict";
import { battleHudPartyPips, battleHudEnemyRecords } from "../web/battlehud-translated.js";

const ok = { hp: 80, maxHp: 80 };
const down = { hp: 0, maxHp: 90 };
const poisoned = { hp: 40, maxHp: 70, statusBits: 0x01 };
const enemyPips = (pips) => pips.filter((p) => p.side === 1);

test("a three-member enemy team draws three squares with their states and the active one", () => {
    const team = battleHudEnemyRecords({ enemy: ok }, [ok, down, poisoned]);
    assert.equal(team.length, 3);
    const pips = enemyPips(battleHudPartyPips([ok, null, null], team,
        { activePlayerIndex: 0, activeEnemyIndex: 2, mode: 0 }));
    assert.deepEqual(pips.map((p) => p.index), [0, 1, 2]);
    assert.deepEqual(pips.map((p) => p.state), [0, 2, 3]);
    assert.deepEqual(pips.map((p) => p.active), [false, false, true]);
    assert.equal(new Set(pips.map((p) => p.x)).size, 3);
});

test("a one-member enemy draws one square, as before", () => {
    const rec = battleHudEnemyRecords({ enemy: ok });
    assert.equal(rec.filter(Boolean).length, 1);
    const pips = enemyPips(battleHudPartyPips([ok, null, null], rec, { activeEnemyIndex: 0 }));
    assert.equal(pips.length, 1);
    assert.equal(pips[0].active, true);
});

test("a team with an empty slot draws only the present members", () => {
    const pips = enemyPips(battleHudPartyPips([ok, null, null],
        battleHudEnemyRecords({ enemy: ok }, [ok, down]), { activeEnemyIndex: 0 }));
    assert.deepEqual(pips.map((p) => p.index), [0, 1]);
});

test("battle kind 4 or more keeps the original single enemy square", () => {
    const pips = enemyPips(battleHudPartyPips([ok, null, null],
        battleHudEnemyRecords({ enemy: ok }, [ok, ok, ok]), { activeEnemyIndex: 0, mode: 4 }));
    assert.equal(pips.length, 1);
});
