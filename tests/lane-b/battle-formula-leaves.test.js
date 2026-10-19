// Lane B oracle for the battle-formula leaves that had no dedicated oracle file.
//
// Every function below is a pure port in engine/dw3/battle-formulas.ts (one in
// battle-status-events.ts, and the effStats supplier in battle-combat.ts) of a decoded
// pro/fightstg routine. The comments in the module name the original address; each
// test here pins ONE boundary, clamp or ordering of that routine rather than
// restating the body:
//
//   0x8009f644  elementalFieldAdjustment   the active-field adjustment (3 arms)
//   0x8009f97c  physicalBase               STR*power/DEF, DEF floored at 1
//   0x8009fab4  magicalBase                SPT-ratio base, clamped to [power/2, 2*power]
//   0x800a02ac  critProc                   the crit byte only on plain attacks; family + ailment arms
//   0x800a06ac  rollHit (physical)        per-side formula, enemy-only 0x20 floor, kind-6 fixed roll
//   0x800a08c8  rollMagicHit (magical)   WIS/level shape for both sides, no floor, player-only kind 6
//   0x800a0514  magicalCritProc            the 100x scalar capped at 0x40; family 0x40/4; target-side terms
//   0x8009f6dc  resolveDamage              x1.5 family boost, 0x40 element curve, caps
//   0x800a1c18  gaugeGain                  ratio^2/20, cap 1000
//   0x800a1608  enemyFleeProc              Binder halving, SPD term truncates toward zero;
//                                             Sleep refuses, Frozen halves the base
//   0x800a0a18  statusInflictionRoll       clamp [1,127]
//   0x800a1308  drainProcRoll              rand%128 < effect_p1
//   0x8009fe1c  poisonTimelineDamage       clamp [1, maxHP/2]
//   0x800a01ac  regenTick                  R = rand%5 + 4, cap 9999
//   0x800a19d8  frozenBlockRoll            the 0x20 floor
//   0x800a1d3c  techniqueMpCost            enemy list price; +20% min +1 for loaned
//   0x8009d4b8  basicAttackHitCount        +0x0a dispatch: 9 -> +0x11 hits, <2 -> 3 only with Multi Crest
//   0x800a89148 enemyActionSkillId         1/2/3 -> attack/A/B, else null
//   0x8009bda4  statusEventDelay           the timeline delay clamp

import { test } from "node:test";
import assert from "node:assert/strict";
import {
    elementalFieldAdjustment, physicalBase, magicalBase, critProc, magicalCritProc,
    resolveDamage, rollHit, rollMagicHit, gaugeGain, enemyFleeProc, statusInflictionRoll,
    drainProcRoll, poisonTimelineDamage, regenTick, frozenBlockRoll, techniqueMpCost,
    basicAttackHitCount, enemyActionSkillId, actionTimelineDelay,
} from "../../engine/dw3/battle-formulas.ts";
import { effStats } from "../../engine/dw3/battle-combat.ts";
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

test("0x800a02ac critProc: the crit byte only on a plain attack, the effect power on a CRITICAL technique", () => {
    // Plain attack (f7 < 2): the +0x38 crit byte replaces the base 4.
    assert.equal(critProc({ crit: 30 }, {}, {}, at(33)), true);
    assert.equal(critProc({ crit: 30 }, {}, {}, at(34)), false);
    // AuraPlug's +0x1B doubles that byte AT THE ROLL (F0x800a02ac .L0x800a03b4
    // `lbu $v0, 0x1b($a0)` / .L0x800a03cc `sll $v0, 0x1`): 30 -> chance 64, not 34.
    assert.equal(critProc({ crit: 30, aura: true }, {}, {}, at(63)), true);
    assert.equal(critProc({ crit: 30, aura: true }, {}, {}, at(64)), false);
    // The doubling is the plain-attack arm's alone: a technique's chance is unchanged.
    assert.equal(critProc({ crit: 30, aura: true }, {}, { effect: "drain" }, at(3)), true);
    assert.equal(critProc({ crit: 30, aura: true }, {}, { effect: "drain" }, at(4)), false);
    // The arm is gated on the byte itself: zero stays zero under Aura.
    assert.equal(critProc({ crit: 0, aura: true }, {}, {}, at(3)), true);
    assert.equal(critProc({ crit: 0, aura: true }, {}, {}, at(4)), false);
    // No crit byte and no effect -> chance 4.
    assert.equal(critProc({ crit: 0 }, {}, {}, at(3)), true);
    assert.equal(critProc({ crit: 0 }, {}, {}, at(4)), false);
    // A technique (f7 >= 2) NEVER adds the crit byte: chance stays 4.
    assert.equal(critProc({ crit: 30 }, {}, { effect: "drain" }, at(3)), true);
    assert.equal(critProc({ crit: 30 }, {}, { effect: "drain" }, at(4)), false);
    // TECH_EFFECT_CRITICAL (f7 = 0xb, "precision") adds its +0xC effect power: 4 + 60.
    assert.equal(critProc({ crit: 0 }, {}, { effect: "precision", effect_p2: 60 }, at(63)), true);
    assert.equal(critProc({ crit: 0 }, {}, { effect: "precision", effect_p2: 60 }, at(64)), false);
    // The raw +0x0A / +0x0C bytes win over the name fallback.
    assert.equal(critProc({ crit: 0 }, {}, { effect_id: 0x0b, effect_power: 10 }, at(13)), true);
    assert.equal(critProc({ crit: 0 }, {}, { effect_id: 0x0b, effect_power: 10 }, at(14)), false);
    assert.equal(critProc({ crit: 30 }, {}, { effect_id: 2 }, at(3)), true);
    assert.equal(critProc({ crit: 30 }, {}, { effect_id: 2 }, at(4)), false);
});

test("0x800a02ac critProc: the 0x3C/0x10 family arms and the TARGET's ailment terms", () => {
    // skill+0x9 (target_family) >= 2 matching the defender's +0x25 adds 0x3C.
    assert.equal(critProc({ crit: 0 }, { family: 4 }, { effect: "drain", target_family: 4 }, at(63)), true);
    assert.equal(critProc({ crit: 0 }, { family: 4 }, { effect: "drain", target_family: 4 }, at(64)), false);
    // A nonmatch adds nothing.
    assert.equal(critProc({ crit: 0 }, { family: 3 }, { effect: "drain", target_family: 4 }, at(3)), true);
    assert.equal(critProc({ crit: 0 }, { family: 3 }, { effect: "drain", target_family: 4 }, at(4)), false);
    // f7 < 2 scans the attacker's worn families (+0x28..+0x2A): a match adds 0x10.
    assert.equal(critProc({ crit: 0, weaponFamilies: [4] }, { family: 4 }, {}, at(19)), true);
    assert.equal(critProc({ crit: 0, weaponFamilies: [4] }, { family: 4 }, {}, at(20)), false);
    // ... and a tag below 2 is never a match, even when it equals the defender byte.
    assert.equal(critProc({ crit: 0, weaponFamilies: [1] }, { family: 1 }, {}, at(3)), true);
    assert.equal(critProc({ crit: 0, weaponFamilies: [1] }, { family: 1 }, {}, at(4)), false);
    // The target's own +0x1d>>3 / +0x1e>>3 / +0x1f>>1 sum (effStats on the defender).
    assert.equal(critProc({ crit: 0 }, { critStatusBonus: 9 }, {}, at(12)), true);
    assert.equal(critProc({ crit: 0 }, { critStatusBonus: 9 }, {}, at(13)), false);
});

test("0x800a0514 magicalCritProc: the scalar term caps at 0x40; a family match uses 0x40", () => {
    // The scalar chain is ((a<<1 + a)<<3 + a)<<2 = 100*a (fightstg.s:30812-30820),
    // so scalar 2 against resist 100 gives trunc(200/100) = 2: chance 2 + 4 = 6.
    assert.equal(magicalCritProc({}, { resistances: { fire: 100 } },
        { element: "fire", damage_scalar: 2, target_family: 0 }, at(5)), true);
    assert.equal(magicalCritProc({}, { resistances: { fire: 100 } },
        { element: "fire", damage_scalar: 2, target_family: 0 }, at(6)), false);
    // A matching target family replaces the base 4 with 0x40 -> chance 66.
    assert.equal(magicalCritProc({}, { family: 2, resistances: { fire: 100 } },
        { element: "fire", damage_scalar: 2, target_family: 2 }, at(65)), true);
    assert.equal(magicalCritProc({}, { family: 2, resistances: { fire: 100 } },
        { element: "fire", damage_scalar: 2, target_family: 2 }, at(66)), false);
    // The scalar term itself caps at 0x40, so the chance tops out at 128 (always fires).
    assert.equal(magicalCritProc({}, { family: 2, resistances: { fire: 1 } },
        { element: "fire", damage_scalar: 100, target_family: 2 }, at(127)), true);
    // A NON-matching family keeps the small base even when target_family >= 2.
    assert.equal(magicalCritProc({}, { family: 5, resistances: { fire: 100 } },
        { element: "fire", damage_scalar: 2, target_family: 2 }, at(5)), true);
    assert.equal(magicalCritProc({}, { family: 5, resistances: { fire: 100 } },
        { element: "fire", damage_scalar: 2, target_family: 2 }, at(6)), false);
});

test("0x800a0514 magicalCritProc: the scalar is the assembly's 100x chain, not 9*4", () => {
    // ((64<<1 + 64)<<3 + 64)<<2 = 6400; /100 = 64; chance = 64 + 4 = 68.
    // The old *9*4 reading gave trunc(64*36/100) = 23 -> chance 27.
    assert.equal(magicalCritProc({}, { resistances: { fire: 100 } },
        { element: "fire", damage_scalar: 64, target_family: 0 }, at(67)), true);
    assert.equal(magicalCritProc({}, { resistances: { fire: 100 } },
        { element: "fire", damage_scalar: 64, target_family: 0 }, at(68)), false);
});

test("0x800a0514 magicalCritProc: the intensity terms are the TARGET's", () => {
    // The status block selects fighters[side == 0] (fightstg.s:30838-30874), so
    // only the DEFENDER's field feeds the roll; the attacker's own value is ignored.
    const skill = { element: "fire", damage_scalar: 2, target_family: 0 };
    assert.equal(magicalCritProc({ magicalCritStatusBonus: 50 }, { resistances: { fire: 100 } }, skill, at(5)), true);
    assert.equal(magicalCritProc({ magicalCritStatusBonus: 50 }, { resistances: { fire: 100 } }, skill, at(6)), false);
    // The defender's value adds: scalar 2 + 4 + 50 = 56.
    assert.equal(magicalCritProc({}, { resistances: { fire: 100 }, magicalCritStatusBonus: 50 }, skill, at(55)), true);
    assert.equal(magicalCritProc({}, { resistances: { fire: 100 }, magicalCritStatusBonus: 50 }, skill, at(56)), false);
});

test("0x800a0514 magicalCritProc: effStats supplies the target's intensity sum", () => {
    // The supplier half of the fact above: the target's own frozen / asleep /
    // confused magnitudes (+0x1d/+0x1e/+0x1f, gated by +0x1c bits 0x2/0x8/0x4) become
    // the defender's `magicalCritStatusBonus` — the same sum the physical roll
    // consumes as `critStatusBonus`, because the two status blocks are word-identical
    // (0x800a0620..0x800a067c vs 0x800a0484..0x800a04e0).
    const mk = (ailments) => ({
        str: 120, def: 60, spt: 80, wis: 50, spd: 40, hp: 500, maxHp: 500,
        ailments, profile: { resistances: {} }, elemBonuses: {},
    });
    const target = effStats(mk({ frozen: { power: 64 }, sleep: { power: 16 }, confuse: { power: 3 } }));
    assert.equal(target.magicalCritStatusBonus, 11); // 64>>3 + 16>>3 + 3>>1
    assert.equal(target.magicalCritStatusBonus, target.critStatusBonus);
    assert.equal(effStats(mk({})).magicalCritStatusBonus, 0);
    // And the roll reads it: base chance 4 -> 15 against the frozen target, while the
    // same draw never crits against a clean one (element "normal" adds no scalar term).
    const skill = { element: "normal", damage_scalar: 2, target_family: 0 };
    assert.equal(magicalCritProc({}, target, skill, at(14)), true);
    assert.equal(magicalCritProc({}, target, skill, at(15)), false);
    assert.equal(magicalCritProc({}, effStats(mk({})), skill, at(14)), false);
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

test("0x800a06ac rollHit: the player path has no 0x20 floor; the enemy path does", () => {
    const skill = { base_acc: 100 };
    const slow = { spd: 0, crit: 0, level: 0 };
    const fast = { spd: 10000, level: 0 };
    // Player: chance = 100 + trunc(100 * -1250 / 128) = -876 — every roll misses.
    assert.equal(rollHit({ ...slow, sideByte: 0 }, fast, skill, at(0)), false);
    assert.equal(rollHit({ ...slow, sideByte: 0 }, fast, skill, at(31)), false);
    // Enemy: the same inputs floor at 0x20 — 31 lands, 32 misses.
    assert.equal(rollHit({ ...slow, sideByte: 0x10 }, fast, skill, at(31)), true);
    assert.equal(rollHit({ ...slow, sideByte: 0x10 }, fast, skill, at(32)), false);
});

test("0x800a06ac rollHit: the player's plain-attack +0x38 subtraction reads the byte UNDOUBLED, aura or not", () => {
    // acc 64, spd 0 vs 8, level 0, crit 4: term = -1 + 0 - 4 = -5 -> chance 62.
    const atk = { spd: 0, crit: 4, level: 0, sideByte: 0 };
    const def = { spd: 8, level: 0 };
    const skill = { base_acc: 64 };
    assert.equal(rollHit(atk, def, skill, at(61)), true);
    assert.equal(rollHit(atk, def, skill, at(62)), false);
    // AuraPlug's +0x1B doubling belongs to the CRIT roll; the accuracy leaf reads the
    // raw byte (fightstg.s:30960 `lbu $v0, 0x38($a2)`), so the hit chance is unchanged.
    assert.equal(rollHit({ ...atk, aura: true }, def, skill, at(61)), true);
    assert.equal(rollHit({ ...atk, aura: true }, def, skill, at(62)), false);
    // A technique skips the subtraction entirely: term = -1, chance 64.
    assert.equal(rollHit({ ...atk, aura: true }, def, { base_acc: 64, effect: "precision" }, at(63)), true);
    assert.equal(rollHit({ ...atk, aura: true }, def, { base_acc: 64, effect: "precision" }, at(64)), false);
});

test("0x800a06ac rollHit: the enemy path folds evasion into the SPD difference and never subtracts crit", () => {
    const base = { spd: 0, crit: 0, level: 0, sideByte: 0x10 };
    // diff = 0 - 0 - 1024, /8 = -128; acc 64: chance 0 -> floored to 32.
    const evasive = { spd: 0, level: 0, evadeBonus: 1024 };
    assert.equal(rollHit(base, evasive, { base_acc: 64 }, at(31)), true);
    assert.equal(rollHit(base, evasive, { base_acc: 64 }, at(32)), false);
    // Without the evasion pool the same attack is certain.
    assert.equal(rollHit(base, { spd: 0, level: 0, evadeBonus: 0 }, { base_acc: 64 }, at(63)), true);
    assert.equal(rollHit(base, { spd: 0, level: 0, evadeBonus: 0 }, { base_acc: 64 }, at(64)), false);
    // A plain attack's +0x38 crit byte is NOT read on the enemy path: chance stays 64.
    assert.equal(rollHit({ ...base, crit: 30 }, { spd: 0, level: 0, evadeBonus: 0 }, { base_acc: 64 }, at(63)), true);
    assert.equal(rollHit({ ...base, crit: 30 }, { spd: 0, level: 0, evadeBonus: 0 }, { base_acc: 64 }, at(64)), false);
});

test("0x800a06ac rollHit: the final battle's fixed roll (kind 6, player side)", () => {
    const atk = { spd: 40, crit: 0, level: 0, sideByte: 0, battleKind: 6 };
    const def = { spd: 25, level: 0 };
    const skill = { base_acc: 100 };
    // (RAND & 0x7f) >= 0x2b: 0x2a misses, 0x2b lands.
    assert.equal(rollHit(atk, def, skill, at(0x2a)), false);
    assert.equal(rollHit(atk, def, skill, at(0x2b)), true);
    // The enemy side is never short-circuited.
    assert.equal(rollHit({ ...atk, sideByte: 0x10 }, def, skill, at(0x2a)), true);
    // ... and neither is an ordinary battle on the player's side.
    assert.equal(rollHit({ ...atk, battleKind: 0 }, def, skill, at(0x2a)), true);
});

test("0x800a08c8 rollMagicHit: the WIS shape, no floor, and no SPD read", () => {
    // WIS 80 vs 40 -> trunc(40/8) = 5; levels equal; acc 100: chance 100 + trunc(500/128) = 103.
    const atk = { wis: 80, spd: 0, level: 0, sideByte: 0 };
    const def = { wis: 40, spd: 0, level: 0 };
    const skill = { base_acc: 100 };
    assert.equal(rollMagicHit(atk, def, skill, at(102)), true);
    assert.equal(rollMagicHit(atk, def, skill, at(103)), false);
    // SPD is never read: a huge defender SPD cannot push the magical chance down.
    assert.equal(rollMagicHit(atk, { ...def, spd: 10000 }, skill, at(102)), true);
    assert.equal(rollMagicHit(atk, { ...def, spd: 10000 }, skill, at(103)), false);
    // NO floor: a hopeless WIS deficit drives the chance negative on BOTH sides, where
    // the physical leaf's enemy path would still land on its 0x20 floor.
    const hopeless = { wis: 0, spd: 0, level: 0, sideByte: 0x10 };
    const wise = { wis: 10000, spd: 0, level: 0 };
    assert.equal(rollMagicHit(hopeless, wise, skill, at(0)), false);
    assert.equal(rollMagicHit(hopeless, wise, skill, at(31)), false);
    // The level difference adds AFTER the WIS difference's /8: 0/8 + 8 -> chance 106.
    assert.equal(rollMagicHit({ ...atk, wis: 40, level: 8 }, def, skill, at(105)), true);
    assert.equal(rollMagicHit({ ...atk, wis: 40, level: 8 }, def, skill, at(106)), false);
    // The WIS division truncates toward zero (the +7 fixup): -9/8 = -1, so a 64-accuracy
    // cast keeps chance 64 — a JS `>>` (floor: -9>>3 = -2, chance 63) would miss at 63.
    assert.equal(rollMagicHit({ wis: 31, spd: 0, level: 0, sideByte: 0 }, { wis: 40, level: 0 }, { base_acc: 64 }, at(63)), true);
    assert.equal(rollMagicHit({ wis: 31, spd: 0, level: 0, sideByte: 0 }, { wis: 40, level: 0 }, { base_acc: 64 }, at(64)), false);
});

test("0x800a08c8 rollMagicHit: the kind-6 short-circuit is the player side's alone", () => {
    const atk = { wis: 80, spd: 0, level: 0, sideByte: 0, battleKind: 6 };
    const def = { wis: 40, spd: 0, level: 0 };
    const skill = { base_acc: 100 };
    // (RAND & 0x7f) >= 0x2b, whatever the stats say: 0x2a misses, 0x2b lands.
    assert.equal(rollMagicHit(atk, def, skill, at(0x2a)), false);
    assert.equal(rollMagicHit(atk, def, skill, at(0x2b)), true);
    // The enemy side is never short-circuited (the formula gives chance 103 here).
    assert.equal(rollMagicHit({ ...atk, sideByte: 0x10 }, def, skill, at(0x2a)), true);
    // ... and neither is an ordinary battle on the player's side.
    assert.equal(rollMagicHit({ ...atk, battleKind: 0 }, def, skill, at(0x2a)), true);
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

test("0x8009d4b8 basicAttackHitCount: +0x0a below 2 diverts to 3, clip 0x0b/0x0c refuses", () => {
    assert.equal(basicAttackHitCount(true, { effect_id: 1, clip: 0x0a }), 3);
    assert.equal(basicAttackHitCount(true, { effect_id: 1, clip: 0x0b }), 1);
    assert.equal(basicAttackHitCount(true, { effect_id: 1, clip: 0x0c }), 1);
    assert.equal(basicAttackHitCount(false, { effect_id: 1, clip: 0x0a }), 1);
    // The diversion needs the plain-attack shape: a technique record never takes it.
    assert.equal(basicAttackHitCount(true, { effect_id: 2, clip: 0x0a }), 1);
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
