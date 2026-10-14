// Battle-class item effects (engine/dw3/battle-items.ts) — the decoded FIGHTSTG
// jump-table dispatch (0x80082f1c, ItemId−43). Characterizes the instruction-traced
// semantics, including the decoded amount producers for CrimsonCable, TNTBall,
// and CursedPuppet.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  useBattleItem, isBattleEffectItem, fieldMessageId, chargeHealPage, chargeNoEffectPage,
  ITEM_PAGE_KIND_ONE_LINE, ITEM_PAGE_KIND_OUTCOME, ITEM_PAGE_KIND_DAMAGE,
  ITEM_PAGE_KIND_NAME_LINE, ITEM_PAGE_KIND_SILENT, ITEM_PAGE_KIND_HEALED,
  ITEM_NO_EFFECT_ID, ITEM_CONFUSED_ID, ITEM_EVADED_ID, ITEM_NAME_ENEMY,
} from "../engine/dw3/battle-items.ts";
import {
  emptyStatusEventPool, enqueueStatusEvent, findStatusEvent, stageStatusEventLock,
} from "../engine/dw3/battle-status-events.ts";

const ESMFIGHT = JSON.parse(readFileSync(
  new URL("../web/assets/data/battlecmd/esmfight.json", import.meta.url), "utf8")).strings;

const mk = (over = {}) => ({
  hp: 100, maxHp: 400, mp: 10, maxMp: 60,
  str: 100, def: 80, spd: 64, ailments: {}, ...over,
});

test("AntidoteDisk cures poison only; no effect when clean", () => {
  const u = mk({ ailments: { poison: { power: 80 }, confuse: { power: 64 } } });
  const r = useBattleItem(66, u, mk());
  assert.equal(r.ok, true);
  assert.deepEqual(Object.keys(u.ailments), ["confuse"]);
  assert.equal(useBattleItem(66, mk(), mk()).ok, false);
});

test("EnergyDisk clears every ailment", () => {
  const u = mk({ ailments: { poison: {}, frozen: {}, confuse: {}, sleep: {} }, regeneration: true });
  assert.equal(useBattleItem(69, u, mk()).ok, true);
  assert.deepEqual(u.ailments, {});
  assert.equal(u.regeneration, true); // Recover Crest's recurring source is not a status bit
});

test("EnergyDisk's all-status cure lifts the two tech-abort locks as well", () => {
  // The disk's own row is 0x800a3364 — mask 0x3f, cure code 0xc4 — so it reaches
  // FIGHTSTG_F0x8009c330's `which` 3 arm, whose cancel walks SIX codes out of
  // .L0x800a43d4 (its low half at .L0x800a43d8 included, `slti $v0, $s0, 0x6` :26464):
  // [9, 10, 11, 12, 16, 17] = the four ailment recoveries AND the two locks 0x10/0x11.
  // The port freed the four recoveries only, so a cannot-flee lock survived the disk.
  const pool = emptyStatusEventPool();
  const u = mk({ statusEvents: pool, sideByte: 0, slot: 0 });
  stageStatusEventLock(pool, 0, 0, 24, () => 0);
  enqueueStatusEvent(pool, { code: 0x09, time: 1000, side: 0, slot: 0, payload: 30, payload2: 0 });
  enqueueStatusEvent(pool, { code: 0x11, time: 900, side: 0, slot: 0, payload: 1, payload2: 0 });
  assert.equal(useBattleItem(69, u, mk()).ok, true);
  assert.equal(findStatusEvent(pool, 0x10, 0, 0), -1, "the cannot-flee lock is freed");
  assert.equal(findStatusEvent(pool, 0x11, 0, 0), -1, "so is the cannot-digivolve lock");
  assert.equal(findStatusEvent(pool, 0x09, 0, 0), -1, "and the poison recovery");
  // A SINGLE-ailment disk must not touch a lock: `which` 0 frees code 0x09 alone.
  const pool2 = emptyStatusEventPool();
  const u2 = mk({ statusEvents: pool2, sideByte: 0, slot: 0, ailments: { poison: { power: 10 } } });
  stageStatusEventLock(pool2, 0, 0, 24, () => 0);
  assert.equal(useBattleItem(66, u2, mk()).ok, true);
  assert.ok(findStatusEvent(pool2, 0x10, 0, 0) >= 0, "the lock survives an AntidoteDisk");
});

test("LifeDisk revives fallen party members to FULL HP", () => {
  const a = mk({ hp: 0 }), b = mk({ hp: 50 }), c = mk({ hp: 0, maxHp: 900 });
  const r = useBattleItem(70, a, mk(), { party: [a, b, c] });
  assert.equal(r.ok, true);
  assert.equal(a.hp, 400);
  assert.equal(b.hp, 50);
  assert.equal(c.hp, 900);
});

test("LifePlug restores half max HP and MP, clamped; no effect at full", () => {
  const u = mk();
  assert.equal(useBattleItem(71, u, mk()).ok, true);
  assert.equal(u.hp, 300); // 100 + 400/2
  assert.equal(u.mp, 40);  // 10 + 60/2
  assert.equal(useBattleItem(71, mk({ hp: 400, mp: 60 }), mk()).ok, false);
});

test("MachPlug: +25% SPD, re-use replaces (no stacking past cap)", () => {
  const u = mk();
  useBattleItem(72, u, mk());
  assert.equal(u.spd, 80); // 64 + 64*32/128 = 64+16
  useBattleItem(72, u, mk());
  assert.equal(u.spd, 96); // buff 16 → 16 + 64*32/128 = 32 (base stays 64)
});

test("PowerPlug: STR +50% (cap +100%), DEF −12.5% (floor −50%)", () => {
  const u = mk();
  useBattleItem(73, u, mk());
  assert.equal(u.str, 150);
  assert.equal(u.def, 70); // 80 − 80*16/128 = 80−10
  // repeated use approaches the caps, never exceeds them
  for (let i = 0; i < 10; i++) useBattleItem(73, u, mk());
  assert.equal(u.str, 200);        // +100% cap
  assert.ok(u.def >= 40);          // −50% floor
});

test("DVPlug adds 200 gauge but saturates at 999 below the automatic Blast threshold", () => {
  const u = mk({ gauge: 9 });
  useBattleItem(76, u, mk());
  assert.equal(u.gauge, 209);
  u.gauge = 950;
  useBattleItem(76, u, mk());
  assert.equal(u.gauge, 999);
});

test("Field items set the arena field (element by id, power 64; Unknown=random/127)", () => {
  let field = null;
  useBattleItem(77, mk(), mk(), { setField: (element, power) => { field = { element, power }; } });
  assert.deepEqual(field, { element: "fire", power: 64 });
  useBattleItem(83, mk(), mk(), { setField: (element, power) => { field = { element, power }; } });
  assert.deepEqual(field, { element: "dark", power: 64 });
  useBattleItem(84, mk(), mk(), { setField: (element, power) => { field = { element, power }; }, rng: () => 3 });
  assert.deepEqual(field, { element: "wind", power: 127 });
});

test("ChaosWave: coin-flip gate; enemy confused; rand&3==0 also confuses user", () => {
  // gate, enemy recovery delay, follow-up, ally recovery delay
  const rolls = [1, 0, 0, 0];
  // The side bytes the original's stagers are handed (`andi $s2, $a0, 0xff`: 0 the player,
  // 0x10 the enemy) and each side's active fighter slot.
  const u = mk({ sideByte: 0, slot: 0 }), e = mk({ sideByte: 0x10, slot: 0 });
  const r = useBattleItem(86, u, e, { rng: () => rolls.shift() ?? 1 });
  assert.equal(r.ok, true);
  assert.ok(e.ailments.confuse);
  assert.equal(e.ailments.confuse.power, 96);
  // The confusion recovery is a QUEUED ENTRY now, not a counter on the record: its time is
  // code 0x0b's `+0x02`, and `FIGHTSTG_F0x8009c9c0` refreshes that entry in place.
  const confuseEntry = (rec) => rec.statusEvents.find((p2) => p2.code === 0x0b);
  assert.ok(confuseEntry(e), "the confusion recovery is queued under code 0x0b");
  assert.ok(confuseEntry(e).time >= 2000 && confuseEntry(e).time <= 6000,
    `opcode 8 clamps into [2000, 6000]; got ${confuseEntry(e).time}`);
  assert.equal(confuseEntry(e).side, 0x10, "the enemy's side byte");
  assert.equal(confuseEntry(u).side, 0, "the user's own side byte");
  assert.ok(u.ailments.confuse);
  // gate fails on even roll
  const e2 = mk();
  assert.equal(useBattleItem(86, mk(), e2, { rng: () => 0 }).ok, false);
  assert.ok(!e2.ailments.confuse);
});

test("SpiderWeb: enemy SPD −25%, floored at −50%", () => {
  const e = mk();
  useBattleItem(89, mk(), e);
  assert.equal(e.spd, 48); // 64 − 16
  for (let i = 0; i < 10; i++) useBattleItem(89, mk(), e);
  assert.equal(e.spd, 32); // −50% floor
});

test("TNTBall deals direct damage through the supplied hit resolver, KO at 0", () => {
  const e = mk({ hp: 30 });
  let input;
  const r = useBattleItem(90, mk(), e, { magicalHit: (power, element) => {
    input = { power, element };
    return 50;
  } });
  assert.deepEqual(input, { power: 100, element: "fire" });
  assert.equal(r.ok, true);
  assert.equal(r.dealtDamage, true);
  assert.equal(e.hp, 0);
});

test("TNTBall obeys special modes 1/2 HP floor and mode 3 zero-damage branch", () => {
  const floorTarget = mk({ hp: 150, maxHp: 1100 });
  useBattleItem(90, mk(), floorTarget, { magicalHit: () => 80, specialMode: 1 });
  assert.equal(floorTarget.hp, 100);
  const protectedTarget = mk({ hp: 150, maxHp: 1100 });
  assert.equal(useBattleItem(90, mk(), protectedTarget, {
    magicalHit: () => 80, specialMode: 3,
  }).ok, false);
  assert.equal(protectedTarget.hp, 150);
});

test("per-encounter item gates reject their effects independently", () => {
  assert.equal(useBattleItem(85, mk(), mk(), { effectGates: { direct_hp: 1 } }).ok, false);
  assert.equal(useBattleItem(86, mk(), mk(), { effectGates: { confuse: 1 }, rng: () => 1 }).ok, false);
  assert.equal(useBattleItem(87, mk(), mk(), { effectGates: { charm_gas: 1 } }).ok, false);
  assert.equal(useBattleItem(88, mk(), mk({ str: 120 }), { effectGates: { cursed_puppet: 1 } }).ok, false);
  assert.equal(useBattleItem(89, mk(), mk(), { effectGates: { spider_web: 1 } }).ok, false);
});

test("CrimsonCable moves exactly maxHP/5 HP, and a KO moves nothing at all", () => {
  // fightstg.s:11854 `lh $v0,8($s0)` / :11858 `subu $v0,$v1` / :11859 `bgtz $v0,
  // .L0x8008e650`. The drain that survives leaves the enemy at `hp - maxHP/5` and adds
  // the SAME figure to the user, clamped at the user's max HP (:11877-:11899). The
  // drain that would reach zero takes the other arm: it shows the same figure, stores 0
  // into the enemy in the delay slot of the KO call (:11844) and returns without ever
  // touching the user's HP.
  const drained = useBattleItem(85, mk({ hp: 100 }), mk({ hp: 40, maxHp: 100 }));
  assert.deepEqual([drained.pages[0].payload, drained.pages[0].slots], [[0x10, 20], ["20"]]);

  const u = mk({ hp: 100 }), e = mk({ hp: 40, maxHp: 100 });
  useBattleItem(85, u, e);
  assert.equal(e.hp, 20);
  assert.equal(u.hp, 120); // exactly maxHP/5 = 20, not "what the enemy had"

  // The clamp on the user is the original's own `slt $v1,$v0` test at :11896.
  const capped = mk({ hp: 395, maxHp: 400 }), target = mk({ hp: 60, maxHp: 100 });
  useBattleItem(85, capped, target);
  assert.equal(target.hp, 40);
  assert.equal(capped.hp, 400);

  // Below one fifth of its max HP the enemy is KO'd and the user is NOT healed.
  const victim = mk({ hp: 100 }), prey = mk({ hp: 15, maxHp: 100 });
  const ko = useBattleItem(85, victim, prey);
  assert.equal(prey.hp, 0);
  assert.equal(victim.hp, 100, "a KO drain hands the user nothing");
  assert.deepEqual([ko.pages[0].payload, ko.pages[0].slots], [[0x10, 20], ["20"]],
    "the message still shows the item's maxHP/5 figure");
});

test("CursedPuppet lowers only the larger STR/DEF by their difference, with a -50% floor", () => {
  const highStr = mk({ str: 120, def: 80 });
  assert.equal(useBattleItem(88, mk(), highStr).ok, true);
  assert.equal(highStr.str, 80);
  assert.equal(highStr.def, 80);

  const highDef = mk({ str: 40, def: 120 });
  useBattleItem(88, mk(), highDef);
  assert.equal(highDef.str, 40);
  assert.equal(highDef.def, 60); // requested -80 is clamped to half the clean base

  assert.equal(useBattleItem(88, mk(), mk({ str: 80, def: 80 })).ok, false);
});

test("isBattleEffectItem covers the decoded FIGHTSTG band 66-90 only", () => {
  assert.equal(isBattleEffectItem(66), true);   // AntidoteDisk
  assert.equal(isBattleEffectItem(69), true);   // EnergyDisk
  assert.equal(isBattleEffectItem(90), true);   // TNTBall
  assert.equal(isBattleEffectItem(65), false);  // a chip, generic heal path
  assert.equal(isBattleEffectItem(91), false);
  assert.equal(isBattleEffectItem(0), false);
});

// ---------------------------------------------------------------------------
// WHAT EACH HANDLER PRINTS (2026-10-04). Every handler in the band ends by making a
// battle message line and calling the shared panel's `+0xac` with a kind and a payload;
// none of them types a sentence. These tests read the disc's own `esmfight` bank back
// and pin the call each handler makes. All of them fail on the code before this change:
// the result carried `messages: ["Cured!"]` and friends, sentences typed in this file.

test("a cure disk gives the disc's kind-2 page for the word its own record holds", () => {
  const u = mk({ ailments: { poison: { power: 80 } } });
  const r = useBattleItem(66, u, mk(), { userName: "Kotemon" });
  assert.equal(r.pages.length, 1);
  const page = r.pages[0];
  assert.equal(page.kind, ITEM_PAGE_KIND_OUTCOME, "fightstg.s:11319, li $a1, 0x2");
  assert.equal(ESMFIGHT[page.payload[0]], "Cured!");
  assert.equal(page.payload[1], 0,
    "payload[1] is the shared tail's side test; 0 names the acting Digimon");
  assert.equal(page.name, "Kotemon");
});

test("each of the four cure disks prints its own bank word", () => {
  const words = [
    [66, "poison", "Cured!"],
    [67, "frozen", "Defrost!"],
    [68, "confuse", "Conscious!"],
    [69, "sleep", "All status cured!"],
  ];
  for (const [id, ailment, word] of words) {
    const r = useBattleItem(id, mk({ ailments: { [ailment]: { power: 1 } } }), mk(),
      { userName: "Kotemon" });
    assert.equal(r.ok, true, "item " + id);
    assert.equal(ESMFIGHT[r.pages[0].payload[0]], word, "item " + id);
    assert.equal(r.pages[0].kind, ITEM_PAGE_KIND_OUTCOME);
  }
});

test("a cure disk with nothing to cure is the one-line \"No effect!\" page", () => {
  const r = useBattleItem(66, mk(), mk(), { userName: "Kotemon" });
  assert.equal(r.ok, false);
  assert.equal(r.pages.length, 1);
  const page = r.pages[0];
  assert.equal(page.kind, ITEM_PAGE_KIND_ONE_LINE, "fightstg.s:11322, li $a1, 0x1");
  assert.equal(ESMFIGHT[page.payload[0]], "No effect!");
  assert.equal(page.name, null, "kind 1 jumps past the shared tail, so no name is drawn");
  assert.equal(ITEM_NO_EFFECT_ID, 0x2f);
});

test("an item that cures an ailment never reads the failure page as its own", () => {
  // The walker's old code answered `ok: false` with the typed string "No effect!", which
  // is the same word as the disc's — the check that matters is that the refusal is a
  // page of its own with no name, not a sentence glued onto a line that already had one.
  const clean = useBattleItem(69, mk(), mk(), { userName: "Kotemon" });
  assert.equal(clean.ok, false);
  assert.equal(clean.pages.every((page) => page.name === null), true);
});

test("LifePlug prints \"HP & MP restored!\" and LifeDisk prints nothing at all", () => {
  const plug = useBattleItem(71, mk(), mk(), { userName: "Kotemon" });
  assert.equal(plug.pages[0].kind, ITEM_PAGE_KIND_OUTCOME);
  assert.equal(ESMFIGHT[plug.pages[0].payload[0]], "HP & MP restored!");
  assert.equal(useBattleItem(71, mk({ hp: 400, mp: 60 }), mk()).ok, false);

  // LifeDisk's handler asks for kind 9, whose arm makes no +0x114/+0x118 call at all
  // (.L0x80099a04) and whose helper returns at once for its payload[0] = 0
  // (F0x80099140 `.L0x8009917c beqz $v0, .L0x8009951c`). The disc has no "Revived!"
  // page here: esmfight has no such entry either.
  const fallen = mk({ hp: 0 });
  const disk = useBattleItem(70, fallen, mk(), { party: [fallen] });
  assert.equal(disk.ok, true);
  assert.equal(disk.pages[0].kind, ITEM_PAGE_KIND_SILENT, "fightstg.s:11351, li $a1, 0x9");
  assert.equal(disk.pages[0].name, null);
  assert.equal(ESMFIGHT.some((s) => /Revived/i.test(s)), false,
    "and the disc's bank has no word for it either, so nothing is invented");
});

test("the plug handlers print the bank's arrow words, not \"Speed up!\"", () => {
  const mach = useBattleItem(72, mk(), mk(), { userName: "Kotemon", userIndex: 2 });
  assert.equal(mach.pages[0].kind, ITEM_PAGE_KIND_NAME_LINE, "fightstg.s:11513, li $a1, 0x7");
  assert.equal(ESMFIGHT[mach.pages[0].payload[0]], "Speed [arrow-up]!");
  assert.deepEqual(mach.pages[0].payload, [0x32, 0, 2], "kind 7's tail reads payload[2] as the index");
  assert.equal(ESMFIGHT[useBattleItem(73, mk(), mk()).pages[0].payload[0]], "Focus on attack!");
  assert.equal(ESMFIGHT[useBattleItem(74, mk(), mk()).pages[0].payload[0]], "Focus on guard!");
  assert.equal(ESMFIGHT[useBattleItem(75, mk(), mk()).pages[0].payload[0]], "Special effect up!");
  assert.equal(ESMFIGHT[useBattleItem(76, mk(), mk()).pages[0].payload[0]], "Blast gauge up!");
});

test("ChaosWave prints \"Confused!\" twice, once over each Digimon's own name", () => {
  const rolls = [1, 0, 0, 0];
  const u = mk(), e = mk();
  const r = useBattleItem(86, u, e, {
    rng: () => rolls.shift() ?? 1, userName: "Kotemon", enemyName: "Numemon",
  });
  assert.equal(r.pages.length, 2, "the rand&3 follow-up is a second page, not a second clause");
  assert.equal(ESMFIGHT[r.pages[0].payload[0]], "Confused!");
  assert.equal(r.pages[0].payload[1], ITEM_NAME_ENEMY, "names the enemy");
  assert.equal(r.pages[0].name, "Numemon");
  assert.equal(ESMFIGHT[r.pages[1].payload[0]], "Confused!");
  assert.equal(r.pages[1].payload[1], 0, "the follow-up names the acting Digimon");
  assert.equal(r.pages[1].name, "Kotemon");
  assert.equal(ITEM_CONFUSED_ID, 0x20);

  // The failed roll is the shared refusal page, and nothing else.
  const blocked = useBattleItem(86, mk(), mk(), { rng: () => 0, userName: "Kotemon" });
  assert.equal(blocked.pages.length, 1);
  assert.equal(blocked.pages[0].kind, ITEM_PAGE_KIND_ONE_LINE);
  assert.equal(ESMFIGHT[blocked.pages[0].payload[0]], "No effect!");
});

test("the debuff items print the enemy's arrow-down words and the enemy's name", () => {
  const gas = useBattleItem(87, mk(), mk({ str: 100, def: 100 }),
    { userName: "Kotemon", enemyName: "Numemon" });
  assert.equal(ESMFIGHT[gas.pages[0].payload[0]], "Excited!");
  assert.equal(gas.pages[0].payload[1], ITEM_NAME_ENEMY);
  assert.equal(gas.pages[0].name, "Numemon");

  const strDown = useBattleItem(88, mk(), mk({ str: 120, def: 80 }),
    { userName: "Kotemon", enemyName: "Numemon" });
  assert.equal(ESMFIGHT[strDown.pages[0].payload[0]], "Strength [arrow-down]!");
  const defDown = useBattleItem(88, mk(), mk({ str: 40, def: 120 }),
    { userName: "Kotemon", enemyName: "Numemon" });
  assert.equal(ESMFIGHT[defDown.pages[0].payload[0]], "Defense [arrow-down]!");
  assert.equal(useBattleItem(88, mk(), mk({ str: 80, def: 80 })).pages[0].kind,
    ITEM_PAGE_KIND_ONE_LINE, "equal stats select no arm, so nothing but the refusal");

  const web = useBattleItem(89, mk(), mk(), { userName: "Kotemon", enemyName: "Numemon" });
  assert.equal(ESMFIGHT[web.pages[0].payload[0]], "Speed [arrow-down]!");
  assert.equal(web.pages[0].name, "Numemon");
});

test("the two damage items print the damage page, not a sentence about draining", () => {
  const cable = useBattleItem(85, mk({ hp: 100 }), mk({ hp: 200, maxHp: 400 }),
    { userName: "Kotemon", enemyName: "Numemon" });
  const page = cable.pages[0];
  assert.equal(page.kind, ITEM_PAGE_KIND_DAMAGE, "fightstg.s:11861, li $a1, 0x4");
  assert.equal(ESMFIGHT[0x0b], "{1} damage!", "kind 4's line two is the damage sentence");
  assert.equal(page.payload[0], 0x10, "payload[0] is the side test, never a string index");
  assert.deepEqual(page.slots, ["80"], "slot 1 holds the drain figure, maxHP/5 = 80");
  assert.equal(page.name, "Numemon", "the enemy is what took the damage");

  const bomb = useBattleItem(90, mk(), mk({ hp: 500, maxHp: 500 }),
    { userName: "Kotemon", enemyName: "Numemon", magicalHit: () => 50 });
  assert.equal(bomb.pages[0].kind, ITEM_PAGE_KIND_DAMAGE);
  assert.deepEqual(bomb.pages[0].slots, ["50"]);

  // A stored result of 0 or less falls to the shared missed tail, which is "Evade!".
  const missed = useBattleItem(90, mk(), mk({ hp: 500, maxHp: 500 }),
    { userName: "Kotemon", enemyName: "Numemon", magicalHit: () => 0 });
  assert.equal(missed.ok, false);
  assert.equal(missed.pages[0].kind, ITEM_PAGE_KIND_OUTCOME, "fightstg.s:12326");
  assert.equal(ESMFIGHT[missed.pages[0].payload[0]], "Evade!");
  assert.equal(ITEM_EVADED_ID, 0x1d);
});

test("a field item prints the bank's own field word", () => {
  const fire = useBattleItem(77, mk(), mk());
  assert.equal(fire.pages[0].kind, ITEM_PAGE_KIND_ONE_LINE, "fightstg.s:11801, li $a1, 0x1");
  assert.equal(ESMFIGHT[fire.pages[0].payload[0]], "Fire field!");
  assert.equal(fire.pages[0].payload[0], 77 + 0x16, "addiu $v0, 0x16 at fightstg.s:11798");
  const dark = useBattleItem(83, mk(), mk());
  assert.equal(ESMFIGHT[dark.pages[0].payload[0]], "Dark field!");
  assert.equal(ESMFIGHT[fieldMessageId(8)], "Dark field!");
  // Item 84's handler builds the same seven words from the pre-rolled element code.
  const rolled = useBattleItem(84, mk(), mk(), { rng: () => 5 });
  assert.equal(ESMFIGHT[rolled.pages[0].payload[0]], "Machine field!");
});

test("the generic charge handler's pages are kind 8 and kind 1", () => {
  const healed = chargeHealPage("Kotemon", 500);
  assert.equal(healed.kind, ITEM_PAGE_KIND_HEALED, "fightstg.s:11258, li $a1, 0x8");
  assert.deepEqual(healed.payload, [0, 500], "payload[0] names the actor, payload[1] the amount");
  assert.deepEqual(healed.slots, ["500"], "esmfight[0x22] is \"{1}HP healed!\"");
  assert.equal(ESMFIGHT[0x22], "{1}HP healed!");
  assert.equal(chargeNoEffectPage().kind, ITEM_PAGE_KIND_ONE_LINE);
  assert.equal(ESMFIGHT[chargeNoEffectPage().payload[0]], "No effect!");
});

test("no item handler carries a typed sentence any more", () => {
  const src = readFileSync(new URL("../engine/dw3/battle-items.ts", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  // Every remaining quoted string in the file is a comment-free code literal: check the
  // result type no longer has the field the sentences lived in.
  assert.ok(!/messages\s*:/.test(src), "BattleItemResult has no typed message list");
  for (const word of ["is confused!", "got confused too", "field appears!", "Speed up!",
    "Absorbed ", "damage to ", "is excited!", "fell!", "Revived!", "HP & MP restored!"]) {
    assert.ok(!src.includes(word), "no typed sentence left: " + word);
  }
});
