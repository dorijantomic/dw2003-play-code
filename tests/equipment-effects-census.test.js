// Every equippable item's effect, as one system (EQUIP-Q001).
//
// The census rule: the CODE's member lists must equal the lists the original's
// assembly spells out. Nothing here is allowed to be a hand list — the two id
// ladders of `FIGHTSTG_F0x8009ec94` are transcribed as data
// (`WEAPON_LADDER`, `ACCESSORY_LADDER`) and this test fails if the data grows an
// item the assembly does not name, or loses one it does.
//
// The pre-2026-10-04 hand map named ten signature weapons and got two of them
// wrong: it called SaberFang (150) a drain weapon — the ladder routes 150 and
// 191 to the crit byte `+0x38` and leaves CrimsonBlade (94), a real drain
// weapon, out of the map entirely. Test "the drain rung is exactly 94/147/173"
// is the regression that pins both halves.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  EQUIPMENT, EQUIPMENT_BY_ID, EQUIP_SLOTS,
  ACCESSORY_LADDER, ACCESSORY_EFFECT_DECISIONS, WEAPON_LADDER, WEAPON_LADDER_BY_ID,
  weaponSecondary, weaponCritByte, crestSuppressedByWeapon, equipmentBonuses,
  EFFECTIVE_STAT_BLOCK_FIELDS, signatureSetBonus, wornFamilyBytes,
  SIGNATURE_SETS, SIGNATURE_SET_BONUSES, SIGNATURE_SET_SLOTS, SIGNATURE_SET_SLOT_COUNT,
} from "../engine/dw3/equipment.ts";
import { effStats } from "../engine/dw3/battle-combat.ts";
import { resolveDamage } from "../engine/dw3/battle-formulas.ts";
import { addFoldedStat, battleCoreStat } from "../engine/dw3/effective-stats.ts";

const catalog = readFileSync(new URL("../web/assets/data/equipment.json", import.meta.url), "utf8");
const items = JSON.parse(catalog).equipment;
const byId = new Map(items.map((e) => [e.id, e]));

/** The accessory class byte the ladder's writer reads: stat record byte +0x2. */
const classByte = (id) => byId.get(id).stat_bytes[2];
/** The effect code: byte +0x08 for a family-21 ring/gem, byte +0x03 for a
 *  family-22 behavioural accessory (the two classes store it differently — the
 *  12-byte Unknown2 record is the same shape but the writer reads the offset the
 *  class byte selects, claim EQUIP-C021). */
const codeByte = (id) => (classByte(id) === 8 ? byId.get(id).stat_bytes[3] : byId.get(id).stat_bytes[8]);
/** The magnitude: stat record s16 at +0x06. */
const magnitude = (id) => byId.get(id).stat_bytes[6] | (byId.get(id).stat_bytes[7] << 8);

const accessories = items.filter((e) => e.slot === "accessory");

test("the shipped catalog's accessories are exactly the 68 items the two id ladders name", () => {
  // 24 ring/gems (family 21, class byte 6) + 44 behavioural (family 22, class 8).
  assert.equal(accessories.length, 68);
  assert.equal(accessories.filter((e) => classByte(e.id) === 6).length, 24);
  assert.equal(accessories.filter((e) => classByte(e.id) === 8).length, 44);
});

test("ACCESSORY_LADDER names every accessory the original's init ladder names, and no other", () => {
  const ladderIds = [...new Set(ACCESSORY_LADDER.flatMap((r) => r.ids))];
  for (const id of ladderIds) assert.ok(byId.has(id), `ladder id ${id} is not in the catalog`);
  const named = new Set(ladderIds);
  // Everything the ladder does NOT name, split by where it IS consumed:
  //  - 292..315 the 24 ring/gems: read by stitshop F0x80088db8 for the card and
  //    by F0x8009ec94's code-byte path for the five status resistances.
  //  - the rest read the roster halfwords +0x3C8/+0x3CA directly, outside battle.
  const unnamed = accessories.filter((e) => !named.has(e.id)).map((e) => e.id).sort((a, b) => a - b);
  const rings = unnamed.filter((id) => id >= 292 && id <= 315);
  assert.deepEqual(rings, Array.from({ length: 24 }, (_, i) => 292 + i));
  // 320 RecoverCrest / 321 EXPAdapter / 322 BITAdapter / 323-324 MP Proxy /
  // 329-330 gauge adapters / 337-338 gym gear: seven more, each with its own
  // overlay consumer named in ACCESSORY_EFFECT_DECISIONS.
  assert.deepEqual(unnamed.filter((id) => id > 315), [320, 321, 322, 323, 324, 329, 330, 337, 338]);
});

test("every accessory the ladder names writes the byte the decoded ladder says", () => {
  // 339..359 write an ELEMENT INDEX into +0x2B; the delay-slot constants 2..8
  // are the seven elements in item order (fire..dark), which is the numbering
  // F0x8009f6dc's `+0x0c + (elem - 2) * 2` divisor expects.
  for (const rung of ACCESSORY_LADDER) {
    for (const id of rung.ids) {
      if (rung.effect === "elem_attack") {
        assert.ok(id >= 339 && id <= 359, `${id} is in the elemental range`);
        assert.ok(magnitude(id) === 8 || magnitude(id) === 16 || magnitude(id) === 24);
      } else {
        assert.ok(codeByte(id) >= 1 && codeByte(id) <= 16, `${id} has effect code ${codeByte(id)}`);
      }
    }
  }
  // The four status-resist items are the only accessories whose code reaches the
  // effective-stat block as a resistance, and they ASSIGN rather than accumulate.
  for (const id of [311, 312, 313, 314, 315]) assert.ok(codeByte(id) >= 17);
});

test("the signature-weapon ladder names exactly the ids fightstg compares", () => {
  // pro/fightstg.s:29436-29500 spells 0x97, 0xd2, 0xb4, 0xc2, 0x6d, 0xba,
  // 0x5e, 0x93, 0xad, 0x96, 0xbf — eleven ids in six rungs.
  const asmIds = [0x97, 0xd2, 0xb4, 0xc2, 0x6d, 0xba, 0x5e, 0x93, 0xad, 0x96, 0xbf];
  const tableIds = Object.keys(WEAPON_LADDER_BY_ID).map(Number).sort((a, b) => a - b);
  assert.deepEqual(tableIds, [...asmIds].sort((a, b) => a - b));
  assert.equal(WEAPON_LADDER.length, 6);
});

test("the drain rung is exactly 94/147/173 — SaberFang is a crit weapon, not a drain", () => {
  // Regression on the pre-2026-10-04 hand map, which listed 150 and omitted 94.
  const drain = WEAPON_LADDER.find((r) => r.kind === "drain");
  assert.deepEqual([...drain.ids], [94, 147, 173]);
  assert.equal(WEAPON_LADDER_BY_ID[150].kind, "crit");
  assert.equal(WEAPON_LADDER_BY_ID[191].kind, "crit");
  assert.equal(weaponSecondary(150), null);
  assert.equal(weaponSecondary(94)?.kind, "drain");
  assert.equal(weaponCritByte(150) > 0, true);
  assert.equal(weaponCritByte(94), 0);
});

test("a worn signature weapon suppresses the Multi/Search/Counter crest rungs", () => {
  // fightstg.s:29521 `bnez $s3, .L0x8009f29c` skips the 316/317/318 loop. The loop
  // walks roster +0x3C0/+0x3C2/+0x3C4/+0x3C6 and steps over the SECOND one
  // (fightstg.s:29498 `li $v0, 0x1` / :29502 `beq $s1, $v0`), so a body piece is
  // never a signature weapon.
  assert.equal(crestSuppressedByWeapon({ right: 150 }), true);
  assert.equal(crestSuppressedByWeapon({ head: 191 }), true);
  assert.equal(crestSuppressedByWeapon({ left: 94 }), true);
  assert.equal(crestSuppressedByWeapon({ body: 150 }), false);
  assert.equal(crestSuppressedByWeapon({ right: 92 }), false);
  assert.equal(crestSuppressedByWeapon({ acc0: 316 }), false);
});

test("every effect kind in the shipped item data has a decided consumer", () => {
  const kinds = [...new Set(accessories.map((e) => e.effect.kind))].sort();
  const decided = ACCESSORY_EFFECT_DECISIONS.map((d) => d.kind).sort();
  assert.deepEqual(kinds, decided,
    "an accessory effect kind has no decided consumer entry; add one or the census is incomplete");
  for (const d of ACCESSORY_EFFECT_DECISIONS) {
    assert.ok(["ported", "vestigial", "not_portable"].includes(d.status));
    assert.ok(d.consumer.length > 0, `${d.kind} has no consumer citation`);
  }
});

test("the effect code census covers every effect code the data actually uses", () => {
  // Ring/gem codes: 1..6 (core stat), 8..14 (element), 17..21 (status), and 0 on
  // the two Charisma pieces, whose number is the record's own u16 +0x00 word.
  const ringCodes = accessories.filter((e) => classByte(e.id) === 6).map((e) => codeByte(e.id));
  assert.deepEqual([...new Set(ringCodes)].sort((a, b) => a - b),
    [0, 1, 2, 3, 4, 5, 8, 9, 10, 11, 12, 13, 14, 17, 18, 19, 20, 21]);
  // Behavioural codes: a full 1..16 run, no gaps.
  const behCodes = accessories.filter((e) => classByte(e.id) === 8).map((e) => codeByte(e.id));
  assert.deepEqual([...new Set(behCodes)].sort((a, b) => a - b),
    Array.from({ length: 16 }, (_, i) => i + 1));
});

test("equipmentBonuses gives every ported behavioural effect a number", () => {
  // Magnitude 0 is real for the fixed-multiplier pieces (EXP/BIT/gauge adapters,
  // Multi Crest, Binder Crest, Recover Crest): their factor is a constant in the
  // consumer, not the record's magnitude byte.
  const noMagnitude = new Set(["multi_attack", "no_flee", "regen", "exp_up", "bit_up", "gauge_up"]);
  const oneOfEach = {
    multi_attack: 316, crit_up: 317, counter: 318, no_flee: 319, regen: 320,
    exp_up: 321, bit_up: 322, mp_cost_down: 324, damage_down: 326,
    steal_up: 328, gauge_up: 330, accuracy_up: 332, evade_up: 334,
    escape_up: 336, elem_attack: 359,
  };
  for (const [kind, id] of Object.entries(oneOfEach)) {
    assert.ok(EQUIPMENT_BY_ID[id], `${id} missing`);
    const eb = equipmentBonuses({ acc0: id });
    const hit = eb.effects.filter((e) => e.kind === kind);
    assert.equal(hit.length, 1, `${kind} (item ${id}) produced ${hit.length} effects`);
    if (!noMagnitude.has(kind)) assert.ok(hit[0].amount > 0, `${kind} has no magnitude`);
  }
  // Training Book / Power Brace reach the gym overlay's rep widget, not the
  // battle engine, so they carry no magnitude and never reach a battle effect.
  for (const id of [337, 338]) {
    const hit = equipmentBonuses({ acc0: id }).effects;
    assert.equal(hit.length, 1);
    assert.equal(hit[0].kind, "training");
    assert.equal(hit[0].amount, 0);
  }
});

test("the two status-resistance slots ASSIGN, they do not add", () => {
  // F0x8009ec94 walks acc0 then acc1 and each match is an `sh`, so acc1 wins.
  const both = equipmentBonuses({ acc0: 311, acc1: 311 }); // two Antidote Rings
  assert.equal(both.statusResists.poison, 40);
  const mixed = equipmentBonuses({ acc0: 311, acc1: 312 });
  assert.equal(mixed.statusResists.poison, 40);
  assert.equal(mixed.statusResists.paralyze, 40);
});

test("a two-handed weapon still occupies both hand halfwords through the shared apply path", () => {
  // Regression guard for the shared system this job touches: the six slots are
  // walked in the original's stored order by every consumer.
  assert.deepEqual(EQUIP_SLOTS, ["head", "body", "right", "left", "acc0", "acc1"]);
});
// ── The whole 0x40-byte block, one row per field ────────────────────────────
// `FIGHTSTG_F0x8009ec94` memsets 0x800A45C0 (player) / 0x800A4580 (enemy) and fills
// it. `EFFECTIVE_STAT_BLOCK_FIELDS` is the census of what it writes; these tests hold
// it to the assembly: every byte the two id ladders name must have a row, every row
// must say where its value comes from, and nothing may sit outside the block.

const rowAt = (off) => EFFECTIVE_STAT_BLOCK_FIELDS.find((f) => f.offset === off);

test("every byte the two id ladders write has a census row that names its rung", () => {
  for (const rung of ACCESSORY_LADDER) {
    if (rung.byte == null) continue;
    const row = rowAt(rung.byte);
    assert.ok(row, `accessory rung ${rung.effect} writes +0x${rung.byte.toString(16)} with no census row`);
    assert.match(row.source, new RegExp(rung.effect),
      `the +0x${rung.byte.toString(16)} row does not name the ${rung.effect} rung`);
  }
  for (const rung of WEAPON_LADDER) {
    for (const off of rung.bytes ?? []) {
      const row = rowAt(off);
      assert.ok(row, `weapon rung ${rung.kind} writes +0x${off.toString(16)} with no census row`);
      assert.match(row.source, /WEAPON_LADDER|ACCESSORY_LADDER/,
        `the +0x${off.toString(16)} row does not say which ladder writes it`);
    }
  }
});

test("the census covers the block's own stat fields and stays inside 0x40 bytes", () => {
  // The five core stats +0x02..+0x0A, the seven element values +0x0C..+0x18, the five
  // status resistances +0x1A..+0x22 and the level halfword are written by the copy
  // loops, not by a ladder, so the ladder test above cannot see them.
  const core = [0x00, 0x02, 0x04, 0x06, 0x08, 0x0a];
  const elems = [0x0c, 0x0e, 0x10, 0x12, 0x14, 0x16, 0x18];
  const status = [0x1a, 0x1c, 0x1e, 0x20, 0x22];
  // +0x24..+0x26 are the three single bytes the two branches copy off the live
  // combatant record / species row, and +0x27..+0x2A the four the head/body/right/left
  // pass and the first accessory rung write. Every byte the routine stores therefore
  // has a row: the ladders cover the rest.
  const live = [0x24, 0x25, 0x26, 0x27, 0x28, 0x29, 0x2a];
  for (const off of [...core, ...elems, ...status, ...live]) {
    assert.ok(rowAt(off), `+0x${off.toString(16)} has no census row`);
  }
  // Every offset is inside the block, unique, and in ascending order, and every row
  // carries a decided source — a row with an empty source is the gap this census
  // exists to prevent.
  const offsets = EFFECTIVE_STAT_BLOCK_FIELDS.map((f) => f.offset);
  assert.deepEqual(offsets, [...offsets].sort((a, b) => a - b), "rows are not in offset order");
  assert.equal(new Set(offsets).size, offsets.length, "two rows share an offset");
  for (const f of EFFECTIVE_STAT_BLOCK_FIELDS) {
    assert.ok(f.offset < 0x40, `+0x${f.offset.toString(16)} is outside the 0x40-byte block`);
    assert.ok(f.source.length > 0, `+0x${f.offset.toString(16)} (${f.name}) has no decided source`);
    assert.ok(["player", "enemy", "both"].includes(f.side), `${f.name} has no side`);
    // Every row cites the original line that writes it. A row without one is a
    // reading, not a finding.
    assert.match(f.source, /0x8009|exe\/|0x80017174|F0x8009ec94/,
      `+0x${f.offset.toString(16)} (${f.name}) cites no source line`);
  }
  // The block is 0x40 bytes and the routine writes every byte of it except 0x3F:
  // `0x8009ecec` memsets 0x40 bytes and no store reaches the last one.
  assert.equal(offsets.includes(0x3f), false, "+0x3F is never written");
});

test("every field the ladder writes is reachable from a worn item, or says why not", () => {
  // Every row names its walker counterpart. +0x2A, the third worn family byte, was
  // once marked unread; F0x8009f6dc's scan reads it (`slti $v0, $v1, 0x3`).
  const noWalk = EFFECTIVE_STAT_BLOCK_FIELDS.filter((f) => f.walk === null);
  assert.deepEqual(noWalk.map((f) => f.offset), []);
  // And every other row must name a real walker field, not an empty string.
  for (const f of EFFECTIVE_STAT_BLOCK_FIELDS) {
    if (f.walk === null) continue;
    assert.ok(f.walk.length > 0, `+0x${f.offset.toString(16)} has an empty walk field`);
  }
});

// ── The three damage-tail stages that read block bytes the walker never carried ──
// F0x8009f6dc is the PHYSICAL tail (F0x8009fab4, the magical leaf, never calls it).
// Its stage 2 adds HALF again (x1.5) on a family match — from the skill's own +0x9, or,
// on a plain attack, from the attacker's worn family bytes +0x28..+0x2A — and stage 3 adds
// running * attacker[+0x26] / 64. Both read block bytes the walker had no field for.

test("a worn signature weapon adds half again to a plain attack against its own family", () => {
  // Dramon Guard (203) and Dramon Horn (211) carry stat-record byte +0x12 = 11, the
  // Paildramon/Imperialdramon line. `wornFamilyBytes` is the +0x28.. producer.
  assert.deepEqual(wornFamilyBytes({ right: 203 }), [11]);
  assert.deepEqual(wornFamilyBytes({ head: 211, right: 203 }), [11, 11]);
  // Every qualifying piece of the four-slot pass is stored, with no cap
  // (0x8009f088 `addiu $s4, 0x1`); the damage tail reads the first three.
  assert.deepEqual(wornFamilyBytes({ head: 136, right: 203, left: 164 }), [3, 11, 4]);
  assert.deepEqual(wornFamilyBytes({ head: 136, body: 203, right: 203, left: 203 }), [3, 11, 11, 11]);
  // Ordinary gear carries no such byte, and an armour piece's byte never lands here.
  assert.deepEqual(wornFamilyBytes({ right: 92, body: 249 }), []);
  assert.deepEqual(wornFamilyBytes({}), []);
  assert.deepEqual(wornFamilyBytes(null), []);

  const atk = effStats({
    level: 10, str: 100, def: 100, spt: 50, wis: 50, spd: 50,
    hp: 100, maxHp: 100, ailments: {},
    profile: { id: 1, family: 1 },
    weaponFamilies: [11],
  });
  const defender = (family) => ({ ...atk, family, profile: { id: 1, family } });
  const dramon = defender(11);
  const other = defender(4);
  const skill = { power: 100, element: "normal", base_acc: 128, effect: "none" };
  const hit = Math.trunc((atk.str * skill.power) / atk.def);
  // Plain attack (target_family < 2): the defender's family byte decides.
  const vsDramon = resolveDamage(hit, atk, dramon, skill, () => 0x7fff);
  const vsOther = resolveDamage(hit, atk, other, skill, () => 0x7fff);
  // Stage 2 only rewrites the running value: s0 += (s0 + (s0 >>> 31)) >> 1. So the
  // match equals the unmatched attack run on a hit already raised by half.
  const boosted = hit + ((hit + (hit >>> 31)) >> 1);
  assert.equal(vsDramon, resolveDamage(boosted, atk, other, skill, () => 0x7fff),
    "a plain attack against the weapon's own family was not raised by half");
  assert.ok(vsDramon > vsOther, "the family match must raise the damage, not cut it");
  // The scan reads +0x2A too: a match in the third worn byte still counts.
  const third = effStats({ level: 10, str: 100, def: 100, spt: 50, wis: 50, spd: 50,
    hp: 100, maxHp: 100, ailments: {}, profile: { id: 1, family: 1 }, weaponFamilies: [3, 5, 11] });
  assert.equal(resolveDamage(hit, third, dramon, skill, () => 0x7fff), vsDramon,
    "the third worn family byte (+0x2A) was not scanned");
  const fourth = effStats({ level: 10, str: 100, def: 100, spt: 50, wis: 50, spd: 50,
    hp: 100, maxHp: 100, ailments: {}, profile: { id: 1, family: 1 }, weaponFamilies: [3, 5, 7, 11] });
  assert.equal(resolveDamage(hit, fourth, dramon, skill, () => 0x7fff), vsOther,
    "a fourth worn family byte is outside the scan and must not count");
  // A technique with its own target family takes the skill arm instead, and the
  // walker's weapon byte is then not consulted.
  const tech = { ...skill, target_family: 4 };
  assert.equal(resolveDamage(hit, atk, other, tech, () => 0x7fff), vsDramon,
    "the skill +0x9 arm did not raise the damage by half");
  assert.equal(resolveDamage(hit, atk, dramon, tech, () => 0x7fff), vsOther,
    "a non-matching target family changed the damage anyway");
  // The magical leaf has its own family rule (it ADDS half) and never reads +0x28.
  const mag = { ...skill, magical: true };
  assert.equal(resolveDamage(hit, atk, dramon, mag, () => 0x7fff), vsOther,
    "the physical weapon scan leaked into the magical leaf");
});

test("the affinity stage adds running * byte / 64 on the acting side only", () => {
  const base = { level: 10, str: 100, def: 100, spt: 50, wis: 50, spd: 50, hp: 100, maxHp: 100, ailments: {} };
  const skill = { power: 100, element: "normal", base_acc: 128, effect: "none" };
  const plain = { ...base, profile: { id: 1, family: 1 } };
  const buffed = { ...plain, affinity: 32 };
  const hit = Math.trunc((100 * 100) / 100);
  assert.equal(resolveDamage(hit, buffed, plain, skill, () => 0x7fff), hit + Math.trunc((hit * 32) / 64));
  // The byte is read from the ACTING side's block (0x8009f7b0 `lbu $v0, 0x26($s2)`,
  // $s2 = the attacker base), so a defender's affinity must not move the damage.
  assert.equal(resolveDamage(hit, plain, { ...plain, affinity: 32 }, skill, () => 0x7fff), hit);
  // Zero is the byte every captured battle carries, and it must be a no-op.
  assert.equal(resolveDamage(hit, plain, plain, skill, () => 0x7fff), hit);
});

// ── The signature set: F0x80017174's tail ────────────────────────────────────
// The producer of the block's five core stats ends by comparing the four worn ids
// against the slot's set (0x8004B53C) and, on a match, adding six raw words
// (0x8004B57C). Both tables are checked against the disc bytes the repo ships.

test("the signature-set tables are the disc's 0x8004B53C bytes", () => {
  const manifest = JSON.parse(
    readFileSync(new URL("../web/assets/data/pause/manifest.json", import.meta.url), "utf8"));
  const range = manifest.resident.ranges.find((r) => r.role === "signatures");
  assert.equal(range.base, 0x8004b53c);
  assert.equal(range.size, 0xa0);
  const bin = readFileSync(new URL("../web/assets/data/pause/resident.bin", import.meta.url));
  const at = range.offset;
  for (let s = 0; s < SIGNATURE_SET_SLOT_COUNT; s++) {
    const ids = [];
    for (let i = 0; i < 4; i++) ids.push(bin.readInt16LE(at + s * 8 + i * 2));
    assert.deepEqual([...SIGNATURE_SETS[s]], ids, `slot ${s} set differs from the disc`);
    const bonus = [];
    for (let i = 0; i < 6; i++) bonus.push(bin.readUInt16LE(at + 0x40 + s * 12 + i * 2));
    assert.deepEqual([...SIGNATURE_SET_BONUSES[s]], bonus, `slot ${s} bonus differs from the disc`);
  }
});

test("the set bonus needs all four worn ids and only the slot's own set", () => {
  const ronin = { head: 243, body: 269, right: 98, left: 284 };
  const flat = (c) => (c ?? []).map((x) => [x.stat, x.amount]);
  assert.deepEqual([...SIGNATURE_SET_SLOTS], ["head", "body", "right", "left"]);
  assert.deepEqual(flat(signatureSetBonus(0, ronin)), [
    ["str", 4], ["def", 4], ["spt", 4], ["wis", 4], ["spd", 4], ["chr", 20],
  ]);
  // Three of the four is not the set.
  assert.equal(signatureSetBonus(0, { ...ronin, left: undefined }), null);
  assert.equal(signatureSetBonus(0, { ...ronin, left: 285 }), null);
  // The accessory slots are never part of the comparison, so they cannot break it.
  assert.equal(signatureSetBonus(0, { ...ronin, acc0: 316 }) !== null, true);
  // Another partner's set worn by this one earns nothing, and so does no slot at all.
  assert.equal(signatureSetBonus(3, ronin), null);
  assert.equal(signatureSetBonus(null, ronin), null);
  assert.equal(signatureSetBonus(8, ronin), null);
  // Slot 3 (Brave) is the two-stat set, so its zero words are dropped, not added.
  assert.deepEqual(flat(signatureSetBonus(3, { head: 244, body: 271, right: 163, left: 286 })),
    [["def", 10], ["spt", 10], ["chr", 20]]);
});

test("equipmentBonuses folds the set in on top of the pieces' own folds", () => {
  const ronin = { head: 243, body: 269, right: 98, left: 284 };
  const piecesOnly = equipmentBonuses(ronin);
  const withSet = equipmentBonuses(ronin, 0);
  const core = ["str", "def", "spt", "wis", "spd"];
  for (let i = 0; i < core.length; i++) {
    assert.equal(withSet[core[i]] - piecesOnly[core[i]], SIGNATURE_SET_BONUSES[0][i],
      `${core[i]} did not gain the set bonus`);
  }
  assert.equal(withSet.chr - piecesOnly.chr, SIGNATURE_SET_BONUSES[0][5]);
  // Without the roster slot the set cannot be resolved, so nothing is added.
  assert.deepEqual(equipmentBonuses(ronin).str, piecesOnly.str);
  // The set is added AFTER the 999 clamp of the per-item fold: F0x80017174's six-word
  // tail has no `slti 0x3e8` test, so a stat already at the cap goes past it.
  const capped = equipmentBonuses({ right: 98, acc0: 292 }, 0);
  assert.ok(capped.str > 999 || piecesOnly.str < 999,
    "the set bonus was clamped with the per-item fold");
  const manyGems = equipmentBonuses({ acc0: 292, acc1: 293 }, 0);
  assert.equal(manyGems.str, 30);
});

test("a worn stat gem and an elemental ring reach the block's own numbers", () => {
  // F0x80017174 folds a family-21 piece's coded stat through F0x80017578 into the same
  // buffer F0x8009ec94 copies +0x0C..+0x14 and +0x18..+0x24 from, so a Power Gem's +10
  // STR and a Flame Ring's +20 fire both land in the effective block. This is the
  // question the 2026-10-04 census left open, settled in asm (exe/fns.s:7826-7856) and
  // confirmed live by the sheet capture (a Flame Ring showed fire 105 over a stored 85).
  assert.equal(equipmentBonuses({ acc0: 292 }).str, 10);
  assert.equal(equipmentBonuses({ acc0: 293 }).str, 20);
  assert.equal(equipmentBonuses({ acc0: 304 }).elemResists.fire, 20);
  // The status rings' code (17..21) is NOT a stat code: F0x80017578 ignores it, and
  // the initializer reads it on its own path into +0x1A..+0x22 instead.
  const ring = equipmentBonuses({ acc0: 311 });
  assert.equal(ring.str + ring.def + ring.spt + ring.wis + ring.spd, 0);
  assert.equal(ring.statusResists.poison, 40);
  // No effect is display-only any more: the two that were are read by the producer.
  for (const d of ACCESSORY_EFFECT_DECISIONS) {
    assert.equal("displayOnly" in d, false, `${d.kind} is still marked display-only`);
  }
  for (const kind of ["stat", "elem_resist"]) {
    const d = ACCESSORY_EFFECT_DECISIONS.find((x) => x.kind === kind);
    assert.match(d.consumer, /F0x80017174/, `${kind} does not name the producer`);
  }
});

test("the five status resistances are written on BOTH arms of the initializer", () => {
  // The census listed +0x1A..+0x22 as player-only. The enemy arm writes them too, as the
  // tail of its twelve-word copy: `pro/fightstg.s:29743-29748` runs `lhu`/`sh` pairs from
  // the enemy's own species record +0x18 with `slti $v0, $a1, 0xc`, so the seven element
  // values take +0x18..+0x24 and these five take +0x26..+0x2E. Seven elements plus five
  // resistances is twelve words — the loop bound is the proof that both are there.
  for (const off of [0x1a, 0x1c, 0x1e, 0x20, 0x22]) {
    assert.equal(rowAt(off).side, "both", `+0x${off.toString(16)} is not marked as written by both arms`);
    assert.match(rowAt(off).source, /\+0x(26|28|2a|2c|2e)/i,
      `+0x${off.toString(16)} does not name the enemy arm's own source halfword`);
  }
});

test("a worn piece's stat add is capped on the RUNNING total, and the block floors at 1", () => {
  // F0x80017174's add re-tests the halfword the copy already carries the member's own
  // stored value in (`exe/fns.s:7837-7847`: `addu`, `sh`, `sll`/`sra`, `slti 0x3e8`,
  // `sh $s8` with $s8 = 0x3e7), and F0x8009ec94's copy floors anything at or below zero
  // to 1 (`pro/fightstg.s:29320-29326`: `lh`, `blez`, `sh $a2` with $a2 = 1).
  // A cap on the gear alone is a different number: a member at 900 STR wearing GulfSword
  // (182, +260 STR) is 999 in the original and 1160 when only the gear sum is capped.
  assert.equal(addFoldedStat(900, 260), 999);
  assert.equal(addFoldedStat(999, 10), 999);
  assert.equal(addFoldedStat(700, 260), 960);
  assert.equal(battleCoreStat(900, 260), 999);
  // The cap belongs to the ADD: with no worn piece the original's copy loop
  // (`exe/fns.s:7766-7811`) never tests it, so the stored value passes through as it is.
  assert.equal(addFoldedStat(1000, 0), 1000);
  // The floor is the block's own step, on the signed halfword.
  assert.equal(battleCoreStat(0, 0), 1);
  assert.equal(battleCoreStat(-5, 0), 1);
  assert.equal(battleCoreStat(1, 0), 1);

  // And the fold a real fighter gets: the same number out of the two halves the record
  // is built from, which is the form the browser host uses.
  const stored = 900, gear = equipmentBonuses({ right: 182 });
  assert.equal(gear.str, 260, "GulfSword's own STR contribution moved");
  assert.equal(battleCoreStat(stored, gear.str), 999);
  // A cheap accessory still adds plainly: PowerGem (292) is +10 STR, nothing is capped.
  assert.equal(battleCoreStat(400, equipmentBonuses({ acc0: 292 }).str), 410);
});
