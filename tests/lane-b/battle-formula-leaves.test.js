// Lane B oracle for the battle-formula leaves that had no dedicated oracle file.
//
// Every function below is a pure port in engine/dw3/battle-formulas.ts (and one in
// battle-status-events.ts) of a decoded pro/fightstg routine. The comments in the
// module name the original address; each test here pins ONE boundary, clamp or
// ordering of that routine rather than restating the body:
//
//   0x8009f644  elementalFieldAdjustment   the active-field adjustment (3 arms)
//   0x8009f97c  physicalBase               STR*power/DEF, DEF floored at 1
//   0x8009fab4  magicalBase                SPT-ratio base, clamped to [power/2, 2*power]
//   0x800a02ac  critProc                   4 + crit stat + skill crit bonus
//   0x800a0514  magicalCritProc            scalar term capped at 0x40; family 0x40/4
//   0x8009f6dc  resolveDamage              x1.5 family boost, 0x40 element curve, caps
//   0x800a06ac  rollHit (physical)
//   0x800a08c8  rollHit (magical)          the 0x20 hit floor, crit only on plain attacks
//   0x800a1c18  gaugeGain                  ratio^2/20, cap 1000
//   0x800a1608  enemyFleeProc              Binder halving, SPD term truncates toward zero;
//                                             Sleep refuses, Frozen halves the base
//   0x800a0a18  statusInflictionRoll       clamp [1,127]
//   0x800a1308  drainProcRoll              rand%128 < effect_p1
//   0x8009fe1c  poisonTimelineDamage       clamp [1, maxHP/2]
//   0x800a01ac  regenTick                  R = rand%5 + 4, cap 9999
//   0x800a19d8  frozenBlockRoll            the 0x20 floor
//   0x800a1d3c  techniqueMpCost            enemy list price; +20% min +1 for loaned
//   0x8009d4b8  basicAttackHitCount        3 hits unless the clip byte is 0x0b/0x0c
//   0x800a89148 enemyActionSkillId         1/2/3 -> attack/A/B, else null
//   0x8009bda4  statusEventDelay           the timeline delay clamp

import { test } from "node:test";
import assert from "node:assert/strict";
import {
    elementalFieldAdjustment, physicalBase, magicalBase, critProc, magicalCritProc,
    resolveDamage, rollHit, gaugeGain, enemyFleeProc, statusInflictionRoll,
    drainProcRoll, poisonTimelineDamage, regenTick, frozenBlockRoll, techniqueMpCost,
    basicAttackHitCount, enemyActionSkillId, actionTimelineDelay,
} from "../../engine/dw3/battle-formulas.ts";
import { statusEventDelay, STATUS_EVENT_OPCODE_PARAMS } from "../../engine/dw3/battle-status-events.ts";

const at = (v) => () => v;

test("0x8009f644 elementalFieldAdjustment: same element adds, the countered element subtracts", () => {
    const base = 1000, power = 64;
    // Same element: base * power / 128.
    assert.equal(elementalFieldAdjustment(base, "fire", { element: "fire", power }), 500);
    // FIELD_COUNTER[fire=2] = ice=4 -> attack fire into an ICE field is the penalty.
    assert.equal(elementalFieldAdjustment(base, "fire", { element: "ice", power }), -250);
    // Unrelated field: no adjustment at all.
    assert.equal(elementalFieldAdjustment(base, "fire", { element: "water", power }), 0);
    // No field, power 0, or a normal (id 1) attack: nothing.
    assert.equal(elementalFieldAdjustment(base, "fire", null), 0);
    assert.equal(elementalFieldAdjustment(base, "fire", { element: "fire", power: 0 }), 0);
    assert.equal(elementalFieldAdjustment(base, "normal", { element: "fire", power }), 0);
});

test("0x8009f97c physicalBase: divert by DEF, but DEF 0 divides by 1", () => {
    assert.equal(physicalBase({ str: 300 }, { def: 120 }, 75), 187); // floor(22500/120)
    assert.equal(physicalBase({ str: 300 }, { def: 0 }, 75), 22500);  // floored at 1
});

test("0x8009fab4 magicalBase: the SPT ratio, clamped to [power/2, 2*power]", () => {
    const power = 100;
    assert.equal(magicalBase({ spt: 100 }, { spt: 100 }, power), 100);
    // A huge SPT advantage is capped at twice the power.
    assert.equal(magicalBase({ spt: 10000 }, { spt: 1 }, power), 200);
    // A huge deficit is floored at half the power.
    assert.equal(magicalBase({ spt: 1 }, { spt: 10000 }, power), 50);
});

test("0x800a02ac critProc: 4 + crit stat + the skill's crit bonus", () => {
    // Default skill bonus 0x10 -> chance 20.
    assert.equal(critProc({ crit: 0 }, {}, at(19)), true);
    assert.equal(critProc({ crit: 0 }, {}, at(20)), false);
    // A skill with no bonus and no crit stat -> chance 4.
    assert.equal(critProc({ crit: 0 }, { crit_bonus: 0 }, at(3)), true);
    assert.equal(critProc({ crit: 0 }, { crit_bonus: 0 }, at(4)), false);
    // The crit stat raises it one for one.
    assert.equal(critProc({ crit: 30 }, { crit_bonus: 0 }, at(33)), true);
    assert.equal(critProc({ crit: 30 }, { crit_bonus: 0 }, at(34)), false);
});

test("0x800a0514 magicalCritProc: the scalar term caps at 0x40; a family match uses 0x40", () => {
    // No matching family, negligible scalar: base chance 4.
    assert.equal(magicalCritProc({}, { resistances: { fire: 100 } },
        { element: "fire", damage_scalar: 2, target_family: 0 }, at(3)), true);
    assert.equal(magicalCritProc({}, { resistances: { fire: 100 } },
        { element: "fire", damage_scalar: 2, target_family: 0 }, at(4)), false);
    // A matching target family replaces the base 4 with 0x40 -> chance 64.
    assert.equal(magicalCritProc({}, { family: 2, resistances: { fire: 100 } },
        { element: "fire", damage_scalar: 2, target_family: 2 }, at(63)), true);
    assert.equal(magicalCritProc({}, { family: 2, resistances: { fire: 100 } },
        { element: "fire", damage_scalar: 2, target_family: 2 }, at(64)), false);
    // The scalar term itself caps at 0x40, so the chance tops out at 128 (always fires).
    assert.equal(magicalCritProc({}, { family: 2, resistances: { fire: 1 } },
        { element: "fire", damage_scalar: 100, target_family: 2 }, at(127)), true);
    // A NON-matching family keeps the small base even when target_family >= 2.
    assert.equal(magicalCritProc({}, { family: 5, resistances: { fire: 100 } },
        { element: "fire", damage_scalar: 2, target_family: 2 }, at(4)), false);
});

test("0x8009f6dc resolveDamage: the attacker family match adds half again", () => {
    const atk = { str: 1, def: 1, spt: 1, wis: 1, spd: 1, crit: 0, armor: 0 };
    const def = { str: 1, def: 1, spt: 1, wis: 1, spd: 1, crit: 0, armor: 0, family: 2, resistances: {} };
    const noCrit = at(0x7f); // 127 is never under a chance below 127
    const plain = { element: "normal", power: 1, target_family: 0 };
    assert.equal(resolveDamage(100, atk, def, plain, noCrit), 100);
    assert.equal(resolveDamage(100, atk, def, { ...plain, target_family: 2 }, noCrit), 150);
    // A different defender family gets no boost.
    assert.equal(resolveDamage(100, atk, { ...def, family: 5 }, { ...plain, target_family: 2 }, noCrit), 100);
});

test("0x8009f6dc resolveDamage: the magical element curve, the family term and the 5x cap", () => {
    const atk = { str: 1, def: 1, spt: 1, wis: 1, spd: 1, crit: 0, armor: 0 };
    const def = { str: 1, def: 1, spt: 1, wis: 1, spd: 1, crit: 0, armor: 0, family: 2, resistances: { fire: 1 } };
    const noCrit = at(0x7f);
    // magicalElementalFactor(1) = 397, then the family +50%, capped at 5*base.
    const skill = { element: "fire", power: 1, magical: true, target_family: 2 };
    assert.equal(resolveDamage(100, atk, def, skill, noCrit), 500); // 100*397/100=397, +198=595 -> cap 500
});

test("0x8009f6dc resolveDamage: armor floors at 0 and 10000 clamps to 9999", () => {
    const atk = { str: 1, def: 1, spt: 1, wis: 1, spd: 1, crit: 0, armor: 0 };
    const def = { str: 1, def: 1, spt: 1, wis: 1, spd: 1, crit: 0, armor: 1000, resistances: {} };
    const noCrit = at(0x7f);
    assert.equal(resolveDamage(100, atk, def, { element: "normal", power: 1 }, noCrit), 0);
    assert.equal(resolveDamage(10000, atk, { ...def, armor: 0 }, { element: "normal", power: 1 }, noCrit), 9999);
});

test("0x800a06ac/0x800a08c8 rollHit: the 0x20 floor, crit penalty only on a plain attack", () => {
    const skill = { base_acc: 100, element: "normal" };
    // A hopeless attacker is floored at 32, and never lower.
    const slow = { str: 1, def: 1, spt: 1, wis: 1, spd: 0, crit: 0, level: 0 };
    const fast = { str: 1, def: 1, spt: 1, wis: 1, spd: 10000, crit: 0, level: 0 };
    assert.equal(rollHit(slow, fast, skill, at(31)), true);
    assert.equal(rollHit(slow, fast, skill, at(32)), false);
});

test("0x800a1c18 gaugeGain: ratio^2/20 capped at 1000; a nonpositive stat gives 0", () => {
    assert.equal(gaugeGain(10, 100), 5);        // ratio 10 -> 100/20
    assert.equal(gaugeGain(1000, 100), 1000);   // ratio 1000 -> capped
    assert.equal(gaugeGain(200, 100), 1000);    // ratio 200 -> 2000 -> capped
    assert.equal(gaugeGain(100, 0), 0);
});

test("0x800a1608 enemyFleeProc: Binder halves the base; the SPD term truncates toward zero", () => {
    assert.equal(enemyFleeProc(0, 100, false, at(73)), true);  // 64 + 10
    assert.equal(enemyFleeProc(0, 100, false, at(74)), false);
    assert.equal(enemyFleeProc(0, 100, true, at(41)), true);   // 32 + 10
    assert.equal(enemyFleeProc(100, 0, false, at(53)), true);  // 64 - 10 (trunc toward 0)
    assert.equal(enemyFleeProc(100, 0, false, at(54)), false);
});

test("0x800a1608 enemyFleeProc: Sleep refuses the flee; Frozen halves the base", () => {
    // Sleep (0x08) returns 0 outright -- even a 0 roll cannot pass (fightstg.s:31991-31995).
    assert.equal(enemyFleeProc(0, 100, false, at(0), 0x08), false);
    assert.equal(enemyFleeProc(0, 100, true, at(0), 0x08), false);
    // Frozen (0x02) halves the base before the SPD term: 64 -> 32 (fightstg.s:32001-32004).
    assert.equal(enemyFleeProc(0, 0, false, at(31), 0x02), true);
    assert.equal(enemyFleeProc(0, 0, false, at(32), 0x02), false);
    // ... and 32 -> 16 with Binder Crest.
    assert.equal(enemyFleeProc(0, 0, true, at(15), 0x02), true);
    assert.equal(enemyFleeProc(0, 0, true, at(16), 0x02), false);
    // The gates compose: Sleep still refuses even alongside Frozen.
    assert.equal(enemyFleeProc(0, 100, false, at(0), 0x0a), false);
    // No ailment = the ungated base (regression guard for the added parameter).
    assert.equal(enemyFleeProc(0, 0, false, at(63), 0), true);
    assert.equal(enemyFleeProc(0, 0, false, at(64), 0), false);
});

test("0x800a0a18 statusInflictionRoll: the chance clamps to [1, 127]", () => {
    // Overpowered attack clamps high.
    assert.equal(statusInflictionRoll(200, 0, 0, 0, 0, at(126)), true);
    assert.equal(statusInflictionRoll(200, 0, 0, 0, 0, at(127)), false);
    // An impossible attack still fires on a 0 roll (floor 1).
    assert.equal(statusInflictionRoll(0, 0, 100000, 100000, 100000, at(0)), true);
    assert.equal(statusInflictionRoll(0, 0, 100000, 100000, 100000, at(1)), false);
});

test("0x800a1308 drainProcRoll: rand%128 below effect_p1", () => {
    assert.equal(drainProcRoll(50, at(49)), true);
    assert.equal(drainProcRoll(50, at(50)), false);
});

test("0x8009fe1c poisonTimelineDamage: clamped to [1, maxHP/2]", () => {
    assert.equal(poisonTimelineDamage(1000, 50, 0, 0), 250);   // rate 25 -> 250
    assert.equal(poisonTimelineDamage(1000, 400, 0, 0), 500);  // clamped to maxHP/2
    assert.equal(poisonTimelineDamage(1000, 0, 0, 0), 1);      // floored at 1
});

test("0x800a01ac regenTick: R = rand%5 + 4, floor(maxHP*R/128), cap 9999", () => {
    assert.equal(regenTick(128, at(2)), 6);   // R=6
    assert.equal(regenTick(128, at(6)), 5);   // R=5
    assert.equal(regenTick(999999, at(4)), 9999); // capped
});

test("0x800a19d8 frozenBlockRoll: the 0x20 floor", () => {
    assert.equal(frozenBlockRoll(100, 0, at(99)), true);
    assert.equal(frozenBlockRoll(100, 0, at(100)), false);
    assert.equal(frozenBlockRoll(10, 800, at(31)), true);  // floored at 0x20
    assert.equal(frozenBlockRoll(10, 800, at(32)), false);
});

test("0x800a1d3c techniqueMpCost: the enemy list price and the loaned premium", () => {
    assert.equal(techniqueMpCost(10, 0x4000, { enemySide: true }), 10); // enemy pays list
    assert.equal(techniqueMpCost(10, 0x4000, {}), 12);                  // +20%
    // Cost reduction floors at 1 BEFORE the premium, so the minimum premium is +1.
    assert.equal(techniqueMpCost(3, 0x4000, { mpCostDown: 5 }), 2);
    assert.equal(techniqueMpCost(3, 0, { mpCostDown: 5 }), 1);
});

test("0x8009d4b8 basicAttackHitCount: 3 hits unless the clip byte is 0x0b or 0x0c", () => {
    assert.equal(basicAttackHitCount(true, 0x0a), 3);
    assert.equal(basicAttackHitCount(true, 0x0b), 1);
    assert.equal(basicAttackHitCount(true, 0x0c), 1);
    assert.equal(basicAttackHitCount(false, 0x0a), 1);
});

test("0x80089148 enemyActionSkillId: 1/2/3 -> Fight / Tech A / Tech B, else null", () => {
    const skills = { attack: 11, move_1: 22, move_2: 33 };
    assert.equal(enemyActionSkillId(1, skills), 11);
    assert.equal(enemyActionSkillId(2, skills), 22);
    assert.equal(enemyActionSkillId(3, skills), 33);
    assert.equal(enemyActionSkillId(4, skills), null);
    assert.equal(enemyActionSkillId(1, { attack: 0 }), null);
});

test("0x8009bda4 statusEventDelay: the timeline clamp and a faster side acting sooner", () => {
    const params = STATUS_EVENT_OPCODE_PARAMS[0];
    const base = params[0];
    // Equal speeds land on the base, clamped by the opcode's own floor/ceiling.
    const same = statusEventDelay(0, { own: 100, opp: 100 });
    assert.ok(same >= params[1] && same <= params[2]);
    // A much faster own side is clamped to the opcode's floor.
    assert.equal(statusEventDelay(0, { own: 400, opp: 100 }), params[1]);
    // A much slower own side is clamped to the opcode's ceiling.
    assert.equal(statusEventDelay(0, { own: 25, opp: 100 }), params[2]);
    assert.equal(base, 1000);
});

test("0x8009bda4 actionTimelineDelay: the 707/1414 opcode-0 clamps", () => {
    assert.equal(actionTimelineDelay(100, 100), 1000);
    assert.equal(actionTimelineDelay(400, 100), 707);
    assert.equal(actionTimelineDelay(25, 100), 1414);
});
