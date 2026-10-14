// The category-4 arm of the technique record machine: every member, decided.
//
// THE SHARED SYSTEM. `FIGHTSTG_F0x8008f714`'s category-4 handler is ONE routine,
// `0x8008fbec` (~/ddw3/asm/dw2003/pro/fightstg.s:13269-:13664), reached through the
// five-word table at `.L0x80083004` (:205) on record byte 4. It has SIX arms, picked by
// its own five id comparisons (:13272-:13290):
//
//   0x8008fe94  technique 100   three SIDE-0 records at 0 HP put back to their maximum
//   0x8008fc38  technique 189   the gradual-HP-recovery status
//   0x8008fca8  190..197        the cure window, even half kind 2, odd half kind 9
//   0x8008ff10  technique 375   full HP, ailment byte zeroed, six events cancelled
//   0x80090070  184..186        the ACTING record's own heal, kind 8
//   0x8008fff8  187..188        the three-slot party heal, kind 9
//
// The CENSUS is the point of this file: every technique id whose shipped record says
// category 4 must be on exactly one decided arm, the arm list must equal the disc's own
// id list, and the walker must reach the arm instead of the attack resolver — the
// original's applier rolls for accuracy on categories 2 and 3 alone
// (pro/fightstg.s:28465 `lbu $v1, 0x4($s4)` / :28466-:28472), so a heal or a cure can
// never miss and never damages the other side.
//
// Every test here fails on the code before this change: `damageTermCategory4Arm`,
// `category4RestorePlan`, `DAMAGE_TERM_CURE_BITS`, `DAMAGE_TERM_KIND9_EFFECT_WORDS`,
// `DAMAGE_TERM_KIND9_SCAN_TESTS`, `DAMAGE_TERM_ROLLED_CATEGORIES` and
// `damageTermCategoryRolls` did not exist; web/battle.js had no category-4 path at all
// and sent every technique through `resolveAttack`, so using Antidote hit the enemy and
// using Giga Heal healed only the acting Digimon.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  DAMAGE_TERM_ARMS_CATEGORY4, DAMAGE_TERM_CLEARED_EVENT_CODES, DAMAGE_TERM_CURE_BITS,
  DAMAGE_TERM_CURE_MASKS, DAMAGE_TERM_CURE_WORDS, DAMAGE_TERM_EVADE_WORD,
  DAMAGE_TERM_HANDLERS, DAMAGE_TERM_KIND9_EFFECT_WORDS, DAMAGE_TERM_KIND9_SCAN_TESTS,
  DAMAGE_TERM_NO_EFFECT_WORD, DAMAGE_TERM_ROLLED_CATEGORIES, category4RestorePlan,
  damageTermCategory4Arm, damageTermCategoryRolls, damageTermHealAmount,
  damageTermPage, damageTermTechniqueIds,
  STATUS_EVENT_ALL_CURE_CODES, emptyStatusEventPool, enqueueStatusEvent, findStatusEvent,
  stageStatusEventLock,
} from "../web/vendor/engine.js";
import {
  applyBattleRestorePlan, battleRestoreParty, battleRestorePlanFor, restoreWalkerSentence,
} from "../web/battle.js";

const TECH_TABLE = JSON.parse(readFileSync(
  new URL("../web/assets/data/fight_tech_table.json", import.meta.url), "utf8"));
const ESMFIGHT = JSON.parse(readFileSync(
  new URL("../web/assets/data/battlecmd/esmfight.json", import.meta.url), "utf8")).strings;
const SKILLS = JSON.parse(readFileSync(
  new URL("../web/assets/data/digimon.json", import.meta.url), "utf8")).skills;
const BATTLE_JS = readFileSync(new URL("../web/battle.js", import.meta.url), "utf8");

/** The sixteen ids the disc's own records put in category 4, read from the data. */
const CATEGORY4_IDS = damageTermTechniqueIds(TECH_TABLE, 4);

const rec = (id) => TECH_TABLE[String(id)];

/** Three party records for the plan: a hurt lead, a poisoned second, an empty third. */
const PARTY = [
  { present: true, hp: 40, maxHp: 100, ailments: 0x00 },
  { present: true, hp: 60, maxHp: 60, ailments: 0x01 },
  { present: false, hp: 0, maxHp: 0, ailments: 0 },
];

const sides = (player = PARTY, enemy = [{ present: true, hp: 10, maxHp: 50, ailments: 0x02 },
  { present: false, hp: 0, maxHp: 0, ailments: 0 },
  { present: false, hp: 0, maxHp: 0, ailments: 0 }]) => ({ 0: player, 1: enemy });

const plan = (id, opts = {}, side = 0) => category4RestorePlan(
  rec(id), id, { side, name: "Kotemon", activeSlot: 0, ...opts }, sides(opts.player, opts.enemy),
);

// ---------------------------------------------------------------------------
// The census.

test("CENSUS: the disc's sixteen category-4 ids are the ids the arm table lists", () => {
  assert.deepEqual(CATEGORY4_IDS,
    [100, 184, 185, 186, 187, 188, 189, 190, 191, 192, 193, 194, 195, 196, 197, 375]);
  const listed = DAMAGE_TERM_ARMS_CATEGORY4.flatMap((a) => a.ids).sort((a, b) => a - b);
  assert.deepEqual(listed, [...CATEGORY4_IDS],
    "the arm table must cover exactly the disc's category-4 population, once each");
  assert.equal(new Set(listed).size, listed.length, "an id may not sit on two arms");
  // Every arm list entry must name an arm that exists in the handler's own instruction
  // stream, and every id on it must agree with the classifier.
  for (const arm of DAMAGE_TERM_ARMS_CATEGORY4) {
    // The handler is one routine, `.L0x8008fbec` .. `.L0x8009021c`.
    assert.ok(arm.arm >= 0x8008fbec && arm.arm < 0x8009021c,
      `${arm.arm.toString(16)} is not inside the category-4 handler`);
    for (const id of arm.ids) {
      assert.ok(damageTermCategory4Arm(id), `technique ${id} has no classifier arm`);
      assert.equal(rec(id).category, 4, `technique ${id} is not a category-4 record`);
    }
  }
});

test("CENSUS: every category-4 id reaches a decided arm, on both sides", () => {
  for (const id of CATEGORY4_IDS) {
    for (const side of [0, 1]) {
      const p = plan(id, {}, side);
      assert.ok(p, `technique ${id} has no restore plan on side ${side}`);
      assert.ok(p.arm && Number.isInteger(p.arm.arm), `technique ${id} has no arm address`);
      assert.ok(p.page, `technique ${id} builds no page`);
      // A plan must be fully decided: three slots, no undefined number, no undefined flag.
      for (const field of [p.heal, p.cure]) {
        assert.equal(field.length, 3, `technique ${id} on side ${side} has ${field.length} slots`);
        field.forEach((v, i) => assert.ok(Number.isFinite(v),
          `slot ${i} of technique ${id} is ${v}`));
      }
      assert.equal(p.fullRestore.length, 3);
      p.fullRestore.forEach((v, i) => assert.equal(typeof v, "boolean",
        `slot ${i} of technique ${id} is ${v}`));
      assert.equal(typeof p.regen, "boolean");
      assert.equal(typeof p.acted, "boolean");
      assert.ok([1, 2, 8, 9].includes(p.page.kind),
        `technique ${id} asks for page kind ${p.page.kind}`);
    }
  }
});

test("CENSUS: the record's own f3 byte agrees with which arm the id reaches", () => {
  // A SECOND, INDEPENDENT WITNESS. The handler reaches its arms by comparing the
  // technique ID (fightstg.s:13272-:13286), so nothing in the data has to know about it.
  // But the disc's records carry an f3 byte that splits the same population the same way:
  // the arms that act on ONE member (189, 184..186, and the even half of the cure window)
  // are f3 = 3, and the arms that act on the WHOLE party (100, 375, 187..188, and the odd
  // half of the cure window) are f3 = 4. Read straight out of the shipped table, so a
  // wrong id in either classifier shows up here.
  const partyArms = new Set(["restoreFallen", "bestCondition", "healParty"]);
  for (const id of CATEGORY4_IDS) {
    const arm = damageTermCategory4Arm(id);
    const expected = partyArms.has(arm.name)
      || (arm.name === "cureWindow" && arm.oddHalf) ? 4 : 3;
    assert.equal(rec(id).f3, expected,
      `technique ${id} is ${arm.name}${arm.oddHalf ? " (odd half)" : ""}, so f3 must be ${expected}`);
  }
  // And the whole population: no f3 = 3 record anywhere in the table is a category-4 heal
  // that this census missed, and every f3 = 4 record that IS category 4 is in the list.
  const f3four = Object.keys(TECH_TABLE).map(Number)
    .filter((i) => TECH_TABLE[String(i)].f3 === 4).sort((a, b) => a - b);
  for (const id of f3four) {
    if (TECH_TABLE[String(id)].category === 4) {
      assert.ok(CATEGORY4_IDS.includes(id),
        `technique ${id} is category 4 with f3 = 4 but is on no arm`);
    }
  }
});

test("the arm addresses are the six the handler's own jumps name", () => {
  // 0x8008fbec is the category-4 handler in the dispatch table at .L0x80083004 (:205).
  assert.equal(DAMAGE_TERM_HANDLERS[4 - 2], 0x8008fbec);
  const arms = new Map(CATEGORY4_IDS.map((id) => [id, damageTermCategory4Arm(id).arm]));
  assert.equal(arms.get(100), 0x8008fe94);   // fightstg.s:13277 beq ... .L0x8008fe94
  assert.equal(arms.get(189), 0x8008fc38);   // :13279 beq ... .L0x8008fc38
  assert.equal(arms.get(190), 0x8008fca8);   // :13275 beqz ... .L0x8008fca8
  assert.equal(arms.get(197), 0x8008fca8);
  assert.equal(arms.get(375), 0x8008ff10);   // :13284 beq ... .L0x8008ff10
  assert.equal(arms.get(184), 0x8008ff90);   // :13281 / :13286 j .L0x8008ff90
  assert.equal(arms.get(188), 0x8008ff90);
  // The heal arm's own split: 184..186 the active record, 187..188 the three slots.
  assert.equal(damageTermCategory4Arm(186).name, "healActive");
  assert.equal(damageTermCategory4Arm(187).name, "healParty");
  assert.equal(damageTermCategory4Arm(187).partyHeal, true);
  // The cure window's slot from the eight-word table at .L0x8008301c, and its odd half
  // from `andi $v0, 0x1` (fightstg.s:13353).
  for (const [id, slot, odd] of [[190, 0, false], [191, 0, true], [192, 1, false],
    [193, 1, true], [194, 2, false], [195, 2, true], [196, 3, false], [197, 3, true]]) {
    const arm = damageTermCategory4Arm(id);
    assert.equal(arm.cureSlot, slot, `technique ${id} slot`);
    assert.equal(arm.oddHalf, odd, `technique ${id} half`);
  }
  // 100 and 375 hard-code side 0 (`sw $zr, 0x64($s4)` :13480 / `addiu $a0, $v0, 0x4470`
  // :13443), so they restore the PLAYER's party whichever side cast them.
  assert.equal(damageTermCategory4Arm(100, 1).side, 0);
  assert.equal(damageTermCategory4Arm(375, 1).side, 0);
  assert.equal(damageTermCategory4Arm(184, 1).side, 1);
});

// ---------------------------------------------------------------------------
// No accuracy roll: the applier, not the page, decides.

test("a category-4 technique cannot miss — the applier rolls on 2 and 3 only", () => {
  // pro/fightstg.s:28463 `lbu $v1, 0x4($s4)` then :28465/:28467 branch to the accuracy
  // getter for category 2 (:28475 `lw $v0, 0x9c($s2)`) and category 3 (:28557
  // `lw $v0, 0xa0($s0)`), and :28470 `j .L0x8009e3c8` for everything else.
  assert.deepEqual([...DAMAGE_TERM_ROLLED_CATEGORIES], [2, 3]);
  assert.equal(damageTermCategoryRolls(2), true);
  assert.equal(damageTermCategoryRolls(3), true);
  for (const id of CATEGORY4_IDS) {
    assert.equal(damageTermCategoryRolls(rec(id).category), false,
      `technique ${id} must not roll`);
  }
  // The walker's own rule: one gate, keyed on the record's category byte, both sides.
  const gates = BATTLE_JS.match(/battleRestorePlanFor\(b, [01],/g) ?? [];
  assert.equal(gates.length, 2,
    "both the player's and the enemy's technique paths must run the category-4 arm");
  // And neither of them may reach the resolver first.
  const playerBlock = BATTLE_JS.slice(
    BATTLE_JS.indexOf("const restore = battleRestorePlanFor(b, 0,"),
    BATTLE_JS.indexOf("// Every remaining technique on this path is an ORDINARY attack"));
  assert.ok(playerBlock.length > 0 && !playerBlock.includes("resolveAttack"),
    "the player's category-4 path must not call resolveAttack");
  const enemyBlock = BATTLE_JS.slice(
    BATTLE_JS.indexOf("const restore = battleRestorePlanFor(b, 1,"),
    BATTLE_JS.indexOf("// F0x8009d4b8: the multi-hit applier re-rolls only accuracy on one computed\n    // damage value. Miss only if all whiff.\n    let total = 0, healTotal = 0, anyHit = false;\n    if (restoreRecord?.dispatch === DAMAGE_TERM_REPEAT_WORD) {"));
  assert.ok(enemyBlock.length > 0 && !enemyBlock.includes("resolveAttack"),
    "the enemy's category-4 path must not call resolveAttack");
});

// ---------------------------------------------------------------------------
// 184..186 — the acting Digimon's own heal, capped at its missing HP.

test("184..186 heal the ACTIVE record, and the number shown is capped at the wound", () => {
  // The getter is FIGHTSTG_F0x800a0108 (fightstg.s:30516, body :30517-:30556), called
  // through the ONE word at [0x800a4614] (`lw $v0, 0x4614($v0)` :13516 / `jalr` :13518) —
  // one routine, not a table.
  const amount = damageTermHealAmount(rec(184).power, 40);
  assert.equal(amount, (8 << 6) + ((40 * 8) >> 3));
  // A party member missing MORE than the heal gets the number on the box. The active slot
  // is the first (40 of 100), so the gap is 60 and 552 > 60 — the "fits" branch needs a
  // bigger wound or a smaller heal, so use the gap itself as the boundary below.
  // 186's power is 127, so at wisdom 40 its amount is 8128 + 635 = 8763. The wound has to
  // be bigger than that for the number to fit, hence the 10000-point maximum here.
  const HURT = 30;
  const ROOMY = 10000;
  for (const id of [184, 185, 186]) {
    const gap = ROOMY - HURT;
    const amt = damageTermHealAmount(rec(id).power, 40);
    assert.ok(amt < gap, `technique ${id}: ${amt} must fit inside ${gap}`);
    const p = category4RestorePlan(rec(id), id, { side: 0, name: "Kotemon", wisdom: 40 },
      { 0: [{ present: true, hp: HURT, maxHp: ROOMY, ailments: 0 },
        { present: true, hp: 500, maxHp: 500, ailments: 0 },
        { present: false, hp: 0, maxHp: 0, ailments: 0 }] });
    assert.equal(p.arm.name, "healActive");
    assert.equal(p.heal[0], amt, `technique ${id} amount`);
    assert.equal(p.heal[1], 0, "only the ACTIVE record is healed");
    assert.equal(p.heal[2], 0);
    // `slt $v0, $a0, $a2` :13577 passed, so `li $s0, 0x8` :13579 fired: kind 8, and the
    // number on line two is the RAW amount, not a capped one.
    assert.equal(p.page.kind, 8);
    assert.deepEqual(p.page.slots, [String(amt)]);
    assert.equal(p.page.payload[1], amt);
    // Word 0 is the raw side, so the shared tail names the healer (:13586/:13588).
    assert.equal(p.page.payload[0], 0);
  }
  // THE DELAY SLOT. `li $s0, 0x8` (fightstg.s:13579 `.L0x800900c4`) is the delay slot of
  // `beqz $v0, .L0x800900cc` (:13578), and a MIPS delay slot executes whether or not the
  // branch is taken — so kind 8 is asked for on EVERY pass that reaches the page build,
  // and what `slt $v0, $a0, $a2` (:13577) actually decides is only `move_ $a2, $a0`
  // (:13580). The number on line two is therefore min(raw amount, missing HP).
  for (const hp of [1, 40]) {
    const big = category4RestorePlan(rec(186), 186, { side: 0, name: "Kotemon" },
      { 0: [{ present: true, hp, maxHp: 100, ailments: 0 },
        { present: false, hp: 0, maxHp: 0, ailments: 0 },
        { present: false, hp: 0, maxHp: 0, ailments: 0 }] });
    const amt = damageTermHealAmount(rec(186).power, 40);
    assert.ok(amt >= 100 - hp, `the fixture needs ${amt} >= ${100 - hp}`);
    assert.equal(big.heal[0], 100 - hp, "the Digimon is still filled");
    assert.equal(big.page.kind, 8, "a heal at least as big as the gap still asks kind 8");
    assert.deepEqual(big.page.slots, [String(100 - hp)],
      "and the number is the missing HP, not the raw amount");
    assert.equal(big.page.payload[1], 100 - hp);
  }
  // Exactly at the boundary the amount equals the gap: still kind 8, still the gap.
  const exactAmount = damageTermHealAmount(rec(186).power, 40);
  const exact = category4RestorePlan(rec(186), 186,
    { side: 0, name: "Kotemon", wisdom: 40 },
    { 0: [{ present: true, hp: 100 - exactAmount, maxHp: 100, ailments: 0 },
      { present: false, hp: 0, maxHp: 0, ailments: 0 },
      { present: false, hp: 0, maxHp: 0, ailments: 0 }] });
  assert.equal(exact.page.kind, 8, "an exactly-sized heal still asks kind 8");
  assert.equal(exact.heal[0], exactAmount);
  assert.deepEqual(exact.page.slots, [String(exactAmount)]);
  // Nothing missing at all: `beqz $a2, .L0x800900d4` (:13576) never reaches the page build,
  // `$s0` is still the -1 loaded at :13519, and the shared tail at :13654 asks kind 2 with
  // `esmfight[0x2f]` — the one and only way this arm answers "No effect!".
  const full = category4RestorePlan(rec(186), 186,
    { side: 0, name: "Kotemon", healAmount: 999 },
    { 0: [{ present: true, hp: 100, maxHp: 100, ailments: 0 },
      { present: false, hp: 0, maxHp: 0, ailments: 0 },
      { present: false, hp: 0, maxHp: 0, ailments: 0 }] });
  assert.equal(full.page.kind, 2);
  assert.equal(full.page.payload[0], DAMAGE_TERM_NO_EFFECT_WORD);
  assert.equal(full.heal[0], 0);
  // The enemy's side uses the enemy's wisdom and heals the enemy.
  const enemyHeal = plan(184, { side: 1, wisdom: 10, enemy: [
    { present: true, hp: 20, maxHp: 90, ailments: 0 },
    { present: false, hp: 0, maxHp: 0, ailments: 0 },
    { present: false, hp: 0, maxHp: 0, ailments: 0 }] });
  assert.equal(enemyHeal.side, 1);
  // The getter returns (8 << 6) + ((10 * 8) >> 3) = 522, and 522 is bigger than the
  // enemy's missing HP (90 - 20 = 70), so the enemy is filled and the number shown is 70.
  assert.equal(damageTermHealAmount(rec(184).power, 10), (8 << 6) + ((10 * 8) >> 3));
  assert.equal(enemyHeal.heal[0], 70);
  assert.equal(enemyHeal.page.kind, 8);
  assert.deepEqual(enemyHeal.page.slots, ["70"]);
  // A wounded ENEMY big enough for the raw number to fit gets the kind-8 page on side 1.
  const roomy = category4RestorePlan(rec(184), 184,
    { side: 1, name: "Greymon", wisdom: 10 },
    { 1: [{ present: true, hp: 20, maxHp: 5000, ailments: 0 },
      { present: false, hp: 0, maxHp: 0, ailments: 0 },
      { present: false, hp: 0, maxHp: 0, ailments: 0 }] });
  assert.equal(roomy.page.kind, 8);
  assert.deepEqual(roomy.page.slots, ["522"]);
  assert.equal(roomy.page.payload[0], 1, "the heal's word 0 is the raw side");
});

// ---------------------------------------------------------------------------
// 187..188 — the three-slot party heal.

test("187..188 heal every standing party member and cap the word at the largest gap", () => {
  const party = [
    { present: true, hp: 40, maxHp: 100, ailments: 0 },   // 60 missing
    { present: true, hp: 30, maxHp: 50, ailments: 0 },    // 20 missing
    { present: true, hp: 0, maxHp: 80, ailments: 0 },     // fallen: skipped (`beqz $v1` :13532)
  ];
  for (const id of [187, 188]) {
    const amount = damageTermHealAmount(rec(id).power, 10);
    // 187's power is 32 and 188's is 64, so at wisdom 10 both amounts exceed the 60 the
    // fixture's worst-off member is missing. Widen the wound so the number fits and the
    // kind-9 page exists, then narrow it below to check the refusal.
    const roomy = [40, 30, 0].map((hp, i) => (i === 0
      ? { present: true, hp, maxHp: 5000, ailments: 0 }
      : i === 1 ? { present: true, hp, maxHp: 50, ailments: 0 }
        : { present: false, hp: 0, maxHp: 0, ailments: 0 }));
    const p = category4RestorePlan(rec(id), id, { side: 0, name: "Kotemon", wisdom: 10 },
      { 0: roomy });
    assert.equal(p.arm.name, "healParty");
    assert.ok(amount < 5000 - 40, `${amount} must fit inside 4960`);
    assert.equal(p.heal[0], amount, `technique ${id} slot 0`);
    assert.equal(p.heal[1], Math.min(amount, 20), `technique ${id} slot 1`);
    assert.equal(p.heal[2], 0, "a fallen member is not healed (fightstg.s:13534)");
    assert.equal(p.page.kind, 9, "a gap exists, so :13553's delay slot asked for kind 9");
    // Word 1 is 0 (:13555) and word 2 min(raw amount, largest gap): here the amount is the
    // smaller of the two, so `move_ $a2, $v1` :13554 took it.
    assert.equal(p.page.payload[1], 0);
    assert.equal(p.page.payload[2], amount);
    // An EMPTY slot is skipped too (`beqz $v0, .L0x80090034` :13530).
    const withEmpty = category4RestorePlan(rec(id), id,
      { side: 0, name: "Kotemon", wisdom: 10 },
      { 0: [roomy[0], { present: false, hp: 0, maxHp: 999, ailments: 0 }, roomy[2]] });
    assert.equal(withEmpty.heal[1], 0, "an empty slot is not healed");
    // The narrow party: the heal covers the worst-off member, so the arm heals everyone it
    // can, asks kind 9 like every other pass with a gap, and the NUMBER is the 60 the
    // worst-off member is missing — `slt $v0, $v1, $a2` :13551 is false, `move_ $a2, $v1`
    // :13554 does not run, and `sw $a2, 0x6c($s4)` :13557 stores the gap.
    const narrow = category4RestorePlan(rec(id), id,
      { side: 0, name: "Kotemon", wisdom: 10 }, { 0: party });
    assert.equal(narrow.heal[0], Math.min(amount, 60));
    assert.equal(narrow.heal[1], Math.min(amount, 20));
    assert.equal(narrow.acted, true, "the party WAS touched");
    assert.equal(narrow.page.kind, 9);
    assert.deepEqual(narrow.page.payload, [0, 0, 60]);
  }
  // Nothing missing anywhere: `beqz $a2, .L0x800900d4` (:13547) skips the page build, so
  // `$s0` keeps the -1 loaded at :13519 and the tail answers the kind-2 "No effect!".
  const nothing = category4RestorePlan(rec(187), 187, { side: 0, name: "Kotemon", wisdom: 10 },
    { 0: [{ present: true, hp: 100, maxHp: 100, ailments: 0 },
      { present: true, hp: 50, maxHp: 50, ailments: 0 },
      { present: false, hp: 0, maxHp: 0, ailments: 0 }] });
  assert.equal(nothing.page.kind, 2);
  assert.equal(nothing.page.payload[0], DAMAGE_TERM_NO_EFFECT_WORD);
  assert.equal(nothing.acted, false);
});

// ---------------------------------------------------------------------------
// 190..197 — the cure window.

test("the even half of the cure window cures the side and prints the cure word", () => {
  // The four cure words (.L0x800a3460) and the four masks it tests the ACTIVE record's
  // ailment byte against (.L0x800a3434 / .L0x800a43dc, both 0x3f040201).
  assert.deepEqual([...DAMAGE_TERM_CURE_WORDS], [0x28, 0x29, 0x2a, 0x2c]);
  assert.deepEqual([...DAMAGE_TERM_CURE_MASKS], [0x01, 0x02, 0x04, 0x3f]);
  assert.deepEqual([...DAMAGE_TERM_CURE_BITS], [0x01, 0x02, 0x04, 0x3f]);
  const cases = [
    [190, 0x01, 0x28, "Cured!"], [192, 0x02, 0x29, "Defrost!"],
    [194, 0x04, 0x2a, "Conscious!"], [196, 0x3f, 0x2c, "All status cured!"],
  ];
  for (const [id, mask, word, text] of cases) {
    const afflicted = [
      { present: true, hp: 50, maxHp: 100, ailments: mask },
      { present: true, hp: 50, maxHp: 100, ailments: mask },
      { present: true, hp: 50, maxHp: 100, ailments: mask },
    ];
    const p = category4RestorePlan(rec(id), id, { side: 0, name: "Kotemon" }, { 0: afflicted });
    assert.equal(p.page.kind, 2, `technique ${id}`);
    assert.equal(p.page.payload[0], word);
    assert.equal(ESMFIGHT[p.page.payload[0]], text);
    // Step 1 runs the cure on slot indices 0, 1 AND 2 (:13433 `addiu $s0, 0x1` /
    // :13434 `slt $v0, $s0, $v0`), so all three records are cured whatever the page said.
    assert.deepEqual(p.cure, [0x01, 0x01, 0x01].map(() => mask),
      `technique ${id} must cure every party record`);
    // A record with no such ailment is left alone.
    const mixed = category4RestorePlan(rec(id), id, { side: 0, name: "Kotemon" },
      { 0: [afflicted[0], { present: true, hp: 50, maxHp: 100, ailments: 0 }, afflicted[2]] });
    assert.equal(mixed.cure[1], 0);
    // The page tests the ACTIVE record only (`lw $v1, 0x8($v0)` :13378 picks the record,
    // `lbu $v0, ($v0)` :13382 reads `.L0x800a3434[slot]`): active clean, second afflicted
    // -> the kind-1 refusal.
    const refused = category4RestorePlan(rec(id), id, { side: 0, name: "Kotemon" },
      { 0: [{ present: true, hp: 50, maxHp: 100, ailments: 0 }, afflicted[1], afflicted[2]] });
    assert.equal(refused.page.kind, 1, `technique ${id} with a clean active record`);
    assert.equal(refused.page.payload[0], DAMAGE_TERM_NO_EFFECT_WORD);
    assert.equal(ESMFIGHT[refused.page.payload[0]], "No effect!");
  }
});

test("the odd half of the cure window is party-wide and its page is kind 9", () => {
  // 197's scan row is index 4 — `beqz $v0, .L0x80098ff0` (:22967), i.e. the WHOLE byte
  // non-zero — while the bit it clears is still `.L0x800a43dc[3]` = 0x3f.
  for (const [id, mask, word] of [[191, 0x01, 0x28], [193, 0x02, 0x29],
    [195, 0x04, 0x2a], [197, 0x0f, 0x2c]]) {
    const p = category4RestorePlan(rec(id), id, { side: 0, name: "Kotemon" }, { 0: [
      { present: true, hp: 50, maxHp: 100, ailments: mask },
      { present: true, hp: 50, maxHp: 100, ailments: mask },
      { present: true, hp: 50, maxHp: 100, ailments: 0 },
    ] });
    assert.equal(p.arm.oddHalf, true);
    assert.equal(p.page.kind, 9, `technique ${id}`);
    // Word 0 is the SIDE and word 1 is `.L0x800a3450[slot]` = [1, 2, 3, 4] (:13357-:13363).
    assert.equal(p.page.payload[0], 0);
    assert.equal(p.page.payload[1], [191, 193, 195, 197].indexOf(id) + 1);
    // LINE TWO of the kind-9 page is that index through the ten-row table at
    // .L0x80083164 (:291-:300).
    assert.equal(DAMAGE_TERM_KIND9_EFFECT_WORDS[p.page.payload[1]], word);
    assert.equal(ESMFIGHT[word], ["Cured!", "Defrost!", "Conscious!",
      "All status cured!"][[191, 193, 195, 197].indexOf(id)]);
    // Only the records the page's own scan matched are cured — the scan row's test, not
    // the whole mask, and it also needs current HP non-zero (:22863 / :22865 `beqz $v1`).
    assert.equal(p.cure[0], id === 197 ? 0x3f : mask);
    assert.equal(p.cure[1], id === 197 ? 0x3f : mask);
    assert.equal(p.cure[2], 0, "a clean record is not in the page's scan");
    // The enemy side writes the SIDE into word 0.
    const enemySide = category4RestorePlan(rec(id), id, { side: 1, name: "Greymon" }, { 1: [
      { present: true, hp: 50, maxHp: 100, ailments: mask },
      { present: false, hp: 0, maxHp: 0, ailments: 0 },
      { present: false, hp: 0, maxHp: 0, ailments: 0 },
    ] });
    assert.equal(enemySide.page.payload[0], 1);
  }
  // Nobody afflicted: the kind-9 page's own scan records nothing, so nothing is cured.
  const clean = category4RestorePlan(rec(191), 191, { side: 0, name: "Kotemon" }, { 0: [
    { present: true, hp: 50, maxHp: 100, ailments: 0 },
    { present: true, hp: 50, maxHp: 100, ailments: 0 },
    { present: true, hp: 50, maxHp: 100, ailments: 0 },
  ] });
  assert.deepEqual(clean.cure, [0, 0, 0]);
  assert.equal(clean.acted, false);
});

test("the ten scan rows and the ten page words are the disc's two tables", () => {
  assert.equal(DAMAGE_TERM_KIND9_SCAN_TESTS.length, 10);
  assert.equal(DAMAGE_TERM_KIND9_EFFECT_WORDS.length, 10);
  // pro/fightstg.s:281-:290 (the scan) and :291-:300 (the page words).
  assert.deepEqual([...DAMAGE_TERM_KIND9_EFFECT_WORDS],
    [0x22, 0x28, 0x29, 0x2a, 0x2c, 0x2d, 0x2e, 0x30, 0x31, 0x32]);
  const hurt = { present: true, hp: 40, maxHp: 100, ailments: 0 };
  assert.equal(DAMAGE_TERM_KIND9_SCAN_TESTS[0](hurt), true, "index 0 is the damaged scan");
  assert.equal(DAMAGE_TERM_KIND9_SCAN_TESTS[0]({ ...hurt, hp: 100 }), false);
  assert.equal(DAMAGE_TERM_KIND9_SCAN_TESTS[0]({ ...hurt, present: false }), false);
  assert.equal(DAMAGE_TERM_KIND9_SCAN_TESTS[0]({ ...hurt, hp: 0 }), false,
    "a fallen member is not in the damaged scan");
  assert.equal(DAMAGE_TERM_KIND9_SCAN_TESTS[1]({ ...hurt, ailments: 0x01 }), true);
  assert.equal(DAMAGE_TERM_KIND9_SCAN_TESTS[2]({ ...hurt, ailments: 0x02 }), true);
  assert.equal(DAMAGE_TERM_KIND9_SCAN_TESTS[3]({ ...hurt, ailments: 0x04 }), true);
  assert.equal(DAMAGE_TERM_KIND9_SCAN_TESTS[4]({ ...hurt, ailments: 0x40 }), true,
    "index 4 is `beqz` on the whole byte (:22989)");
  assert.equal(DAMAGE_TERM_KIND9_SCAN_TESTS[4](hurt), false);
  assert.equal(DAMAGE_TERM_KIND9_SCAN_TESTS[5]({ ...hurt, hp: 0 }), true, "index 5 is the fallen scan");
  assert.equal(DAMAGE_TERM_KIND9_SCAN_TESTS[5](hurt), false);
  assert.equal(DAMAGE_TERM_KIND9_SCAN_TESTS[6](hurt), true, "index 6 is present-only");
  assert.equal(DAMAGE_TERM_KIND9_SCAN_TESTS[6]({ present: false, hp: 1, maxHp: 2, ailments: 0 }), false);
  for (const i of [7, 8, 9]) assert.equal(DAMAGE_TERM_KIND9_SCAN_TESTS[i](hurt), true);
});

// ---------------------------------------------------------------------------
// 100, 189 and 375.

test("technique 100 puts a fallen party member back on its feet, on the PLAYER side", () => {
  assert.equal(damageTermCategory4Arm(100).side, 0);
  // :13453 `lh $v0, ($s0)` skips an empty slot, :13459 `bnez` skips one already standing.
  const p = plan(100, {}, 1);
  assert.equal(p.side, 0, "the arm hard-codes side 0");
  assert.equal(p.heal[0], 0);
  assert.deepEqual(p.fullRestore, [false, false, false],
    "nobody in the fixture is at 0 HP yet");
  const fallen = category4RestorePlan(rec(100), 100, { side: 1, name: "Greymon" }, sides(
    [{ present: true, hp: 0, maxHp: 120, ailments: 0x04 },
      { present: true, hp: 50, maxHp: 50, ailments: 0 },
      { present: false, hp: 0, maxHp: 0, ailments: 0 }]));
  assert.deepEqual(fallen.fullRestore, [true, false, false],
    "only the member at 0 HP is restored");
  assert.equal(fallen.side, 0, "an enemy's technique 100 restores the player's party");
  assert.equal(fallen.page.kind, 9);
  assert.equal(fallen.page.payload[0], 0, "word 0 is `sw $zr, 0x64($s4)` (:13480)");
  assert.equal(fallen.page.payload[1], 5, "word 1 is 5 (`li $v0, 0x5` :13451)");
  assert.equal(ESMFIGHT[DAMAGE_TERM_KIND9_EFFECT_WORDS[5]], "Restored!");
  assert.deepEqual(fallen.cure, [0, 0, 0], "100 touches no ailment");
});

test("technique 189 turns the gradual-HP-recovery status on for the acting record", () => {
  const p = plan(189, {}, 1);
  assert.equal(p.arm.name, "regen");
  assert.equal(p.side, 1, "189 acts on the CASTING side");
  assert.equal(p.regen, true);
  assert.equal(p.page.kind, 2);
  assert.equal(ESMFIGHT[p.page.payload[0]], "HP gradually recovers.");
  assert.deepEqual(p.heal, [0, 0, 0], "the HP arrives on the status-event queue");
  assert.deepEqual(p.cure, [0, 0, 0]);
  // No record in the slot: nothing to attach the status to.
  const empty = category4RestorePlan(rec(189), 189, { side: 0, name: "Kotemon" }, sides(
    [{ present: false, hp: 0, maxHp: 0, ailments: 0 },
      { present: false, hp: 0, maxHp: 0, ailments: 0 },
      { present: false, hp: 0, maxHp: 0, ailments: 0 }]));
  assert.equal(empty.regen, false);
});

test("technique 375 fills HP and clears every ailment on the PLAYER side", () => {
  assert.equal(damageTermCategory4Arm(375).side, 0);
  const p = category4RestorePlan(rec(375), 375, { side: 1, name: "Greymon" }, sides(
    [{ present: true, hp: 5, maxHp: 90, ailments: 0x0f },
      { present: true, hp: 0, maxHp: 70, ailments: 0x01 },
      { present: false, hp: 0, maxHp: 0, ailments: 0 }]));
  assert.equal(p.side, 0);
  assert.deepEqual(p.fullRestore, [true, true, false],
    "every record that HOLDS a Digimon is filled (FIGHTSTG_F0x8008f5d4 :12896/:12898 " +
    "skip an empty slot, :12931/:12934 fill HP)");
  assert.deepEqual(p.cure, [0xff, 0xff, 0],
    "`sb $zr, 0x1c($s0)` (:12933) zeroes the whole ailment byte");
  assert.equal(p.page.kind, 9);
  assert.equal(p.page.payload[1], 6, "word 1 is 6 (`li $v0, 0x6` :13479)");
  assert.equal(ESMFIGHT[DAMAGE_TERM_KIND9_EFFECT_WORDS[6]], "Best condition!");
  // The six pending status events the arm cancels: .L0x800a3438 (:33882-:33887) =
  // [9, 10, 11, 12, 16, 17], read a word at a time (:12906 / :12921).
  assert.deepEqual([...DAMAGE_TERM_CLEARED_EVENT_CODES], [9, 10, 11, 12, 16, 17]);
});

// ---------------------------------------------------------------------------
// The walker's own records: the three 0x20-stride slots, mapped.

test("the walker's three party records ARE the original's three combatant records", () => {
  const b = {
    activePlayerIndex: 1,
    playerRecords: [
      { hp: 40, maxHp: 100, ailments: {}, wis: 10 },
      { hp: 30, maxHp: 50, ailments: { poison: true }, wis: 12 },
      { hp: 0, maxHp: 80, ailments: { confuse: true }, wis: 8 },
    ],
    enemy: { hp: 20, maxHp: 90, ailments: { frozen: true }, wis: 30 },
  };
  assert.deepEqual(battleRestoreParty(b, 0), [
    { present: true, hp: 40, maxHp: 100, ailments: 0 },
    { present: true, hp: 30, maxHp: 50, ailments: 0x01 },
    { present: true, hp: 0, maxHp: 80, ailments: 0x04 },
  ]);
  // The enemy side is the walker's ONE fighter, as record 0; slots 1 and 2 are empty,
  // which is exactly what the original's walk does with a slot that holds no Digimon.
  assert.deepEqual(battleRestoreParty(b, 1), [
    { present: true, hp: 20, maxHp: 90, ailments: 0x02 },
    { present: false, hp: 0, maxHp: 0, ailments: 0 },
    { present: false, hp: 0, maxHp: 0, ailments: 0 },
  ]);
});

test("applying the plan writes HP and cures ailments on the walker's own records", () => {
  const b = {
    activePlayerIndex: 1,
    playerRecords: [
      { hp: 40, maxHp: 100, ailments: {}, wis: 10 },
      { hp: 30, maxHp: 50, ailments: { poison: true }, wis: 12 },
      { hp: 0, maxHp: 80, ailments: { confuse: true }, wis: 8 },
    ],
    enemy: { hp: 20, maxHp: 90, ailments: { frozen: true }, wis: 30 },
  };
  // Antidote on the second party member: 191 is the party-wide poison cure.
  const p = battleRestorePlanFor(b, 0, TECH_TABLE["191"], 191, { name: "Agumon" });
  assert.ok(p, "191 must reach the category-4 arm");
  assert.deepEqual(p.healed, []);
  assert.deepEqual(b.playerRecords.map((r) => ({ ...r.ailments })), [{}, {}, { confuse: true }]);
  // Anti-Magic (196) on the third: every ailment on every standing record goes.
  const all = battleRestorePlanFor(b, 0, TECH_TABLE["196"], 196, { name: "Agumon" });
  assert.equal(all.arm.name, "cureWindow");
  // FIGHTSTG_F0x8009c330 skips only an EMPTY slot, so the even half cures a fallen
  // member too (fightstg.s:26413 `lh $v0, ($a2)` / :26415 `beqz` is the only test).
  assert.equal(b.playerRecords[2].ailments.confuse, undefined,
    "196 cures the confused member too");
  // Small Heal (184) on the ACTIVE member, which is index 1 here.
  const amount = damageTermHealAmount(TECH_TABLE["184"].power, b.playerRecords[1].wis);
  const heal = battleRestorePlanFor(b, 0, TECH_TABLE["184"], 184, { name: "Agumon" });
  assert.equal(heal.arm.name, "healActive");
  assert.equal(b.playerRecords[1].hp, 30 + Math.min(amount, 20));
  assert.equal(b.playerRecords[0].hp, 40, "only the active member is healed");
  // Auto Recover (189) sets the walker's own gradual-recovery flag on the active record.
  const regen = battleRestorePlanFor(b, 0, TECH_TABLE["189"], 189, { name: "Agumon" });
  assert.equal(regen.regen, true);
  assert.equal(b.playerRecords[1].regeneration, true);
  // Crimson Flame (100) restores only the member at 0 HP.
  const revive = battleRestorePlanFor(b, 0, TECH_TABLE["100"], 100, { name: "Agumon" });
  assert.deepEqual(revive.fullRestore, [false, false, true]);
  assert.equal(b.playerRecords[2].hp, 80);
  assert.equal(b.playerRecords[0].hp, 40, "a standing member is untouched");
  // The enemy's own heal: the enemy's record is slot 0 of the enemy side.
  const enemy = battleRestorePlanFor(b, 1, TECH_TABLE["184"], 184, { name: "Garurumon" });
  assert.equal(enemy.side, 1);
  assert.ok(b.enemy.hp > 20, "the enemy's HP rose");
  assert.ok(b.enemy.hp <= 90);
});

test("an ALL-status cure releases the pool's lock entries; a single cure does not", () => {
  // The disc's cure is a record-bit clear AND a pool-entry free, both inside
  // FIGHTSTG_F0x8009c330 (`sb $v1, 0x1c($a2)` :26425 / `sh $zr, ($v0)` :26443), and its
  // `which` 3 arm cancels SIX codes — the two tech-abort locks among them. Technique 196
  // is the cure window's slot 3 (mask 0x3f), 375 zeroes the whole byte, and 191 is the
  // single poison cure (mask 0x01), which must leave a lock alone.
  const mkBattle = () => {
    const pool = emptyStatusEventPool();
    const b = {
      activePlayerIndex: 1,
      statusEvents: pool,
      playerRecords: [
        { hp: 40, maxHp: 100, ailments: { poison: { power: 30 } }, statusEvents: pool, sideByte: 0, slot: 0 },
        { hp: 30, maxHp: 50, ailments: {}, statusEvents: pool, sideByte: 0, slot: 0 },
        { hp: 0, maxHp: 80, ailments: {}, statusEvents: pool, sideByte: 0, slot: 0 },
      ],
      enemy: { hp: 20, maxHp: 90, ailments: {} },
    };
    // The player's own lock lives on the ACTIVE slot — `stageStatusEventLock` is handed
    // `activeSlotOf(b, 0)`, which is 1 here — beside a poison recovery at slot 0.
    stageStatusEventLock(pool, 0, 1, 24, () => 0);
    enqueueStatusEvent(pool, { code: 0x09, time: 1000, side: 0, slot: 0, payload: 30, payload2: 0 });
    return { b, pool };
  };
  const all = mkBattle();
  const plan = battleRestorePlanFor(all.b, 0, TECH_TABLE["196"], 196, { name: "Kotemon" });
  assert.equal(plan.arm.name, "cureWindow");
  assert.equal(findStatusEvent(all.pool, 0x10, 0, 1), -1, "Anti-Magic lifts the flee lock");
  assert.equal(findStatusEvent(all.pool, 0x09, 0, 0), -1, "and frees the poison recovery");
  const best = mkBattle();
  battleRestorePlanFor(best.b, 0, TECH_TABLE["375"], 375, { name: "Kotemon" });
  assert.equal(findStatusEvent(best.pool, 0x10, 0, 1), -1, "Best Condition lifts it too");
  const single = mkBattle();
  battleRestorePlanFor(single.b, 0, TECH_TABLE["191"], 191, { name: "Kotemon" });
  assert.equal(findStatusEvent(single.pool, 0x09, 0, 0), -1, "the single cure frees its entry");
  assert.ok(findStatusEvent(single.pool, 0x10, 0, 1) >= 0, "and leaves the lock alone");
  // The two constants that name the same six codes cannot drift apart.
  assert.deepEqual([...STATUS_EVENT_ALL_CURE_CODES], [...DAMAGE_TERM_CLEARED_EVENT_CODES]);
});

test("battleRestorePlanFor declines anything that is not a category-4 record", () => {
  const b = { activePlayerIndex: 0, playerRecords: [], enemy: null };
  for (const id of [1, 104, 198, 213]) {
    assert.equal(battleRestorePlanFor(b, 0, TECH_TABLE[String(id)], id, {}), null,
      `technique ${id} is an ordinary attack and must not reach the restore arm`);
  }
  assert.equal(battleRestorePlanFor(b, 0, null, 0, {}), null);
  assert.equal(battleRestorePlanFor(b, 0, TECH_TABLE["184"], 184, {}).arm.name, "healActive");
});

test("the walker's own legacy sentence follows the PAGE, never the reverse", () => {
  // A wound the heal fits: the page names the healer's own amount.
  const roomy = [{ present: true, hp: 30, maxHp: 1000, ailments: 0 },
    { present: false, hp: 0, maxHp: 0, ailments: 0 },
    { present: false, hp: 0, maxHp: 0, ailments: 0 }];
  const p = category4RestorePlan(rec(184), 184, { side: 0, name: "Kotemon", wisdom: 40 },
    { 0: roomy });
  assert.equal(p.page.kind, 8);
  assert.match(restoreWalkerSentence(p, { name: "Small Heal" }, "Kotemon"),
    /^Kotemon uses Small Heal! \d+ HP restored\.$/);
  // The narrow party: the original caps the page's number at the missing HP, so the walker
  // must say the same number the box does and not the raw amount it actually applied.
  const narrow = plan(184, { wisdom: 40 });
  assert.ok(narrow.heal[0] > 0, "the Digimon was healed");
  assert.equal(narrow.page.kind, 8);
  assert.equal(restoreWalkerSentence(narrow, { name: "Small Heal" }, "Kotemon"),
    "Kotemon uses Small Heal! 60 HP restored.");
  // Nothing missing at all: this is the arm's one "No effect!" and the walker says so.
  const nothing = category4RestorePlan(rec(184), 184, { side: 0, name: "Kotemon", healAmount: 10 },
    { 0: [{ present: true, hp: 100, maxHp: 100, ailments: 0 },
      { present: false, hp: 0, maxHp: 0, ailments: 0 },
      { present: false, hp: 0, maxHp: 0, ailments: 0 }] });
  assert.equal(nothing.page.kind, 2);
  assert.equal(restoreWalkerSentence(nothing, { name: "Small Heal" }, "Kotemon"),
    "Kotemon uses Small Heal! No effect!");
});

test("an ordinary attack's page is unchanged by this work", () => {
  // Category 2/3 keep the hit page and the evasion page; nothing here moved them.
  const page = damageTermPage(TECH_TABLE["1"], {
    techniqueId: 1, side: 0, name: "Kotemon", damage: 619, hitCount: 1,
    landed: true, applied: false, retaliated: false, suppressed: false,
  });
  assert.equal(page.kind, 4);
  assert.deepEqual(page.slots, ["619"]);
  const missed = damageTermPage(TECH_TABLE["1"], {
    techniqueId: 1, side: 0, name: "Kotemon", damage: 0, hitCount: 1,
    landed: false, applied: false, retaliated: false, suppressed: false,
  });
  assert.equal(missed.kind, 2);
  assert.equal(missed.payload[0], DAMAGE_TERM_EVADE_WORD);
});

test("the shipped skill bank labels every category-4 record a support technique", () => {
  // digimon.json's own `attack_cat` / `type` columns are a second, independent witness
  // that these ids are heals: no ordinary attack carries attack_cat 4.
  const named = SKILLS.filter((s) => CATEGORY4_IDS.includes(s.id));
  assert.ok(named.length >= 10, `only ${named.length} category-4 ids are in the skill bank`);
  for (const s of named) {
    assert.equal(s.attack_cat, 4, `skill ${s.id} is not a category-4 technique`);
    assert.ok(["heal", "support"].includes(s.type), `skill ${s.id} is typed ${s.type}`);
    assert.equal(s.damage_scalar, 0, `skill ${s.id} carries a damage scalar`);
  }
});