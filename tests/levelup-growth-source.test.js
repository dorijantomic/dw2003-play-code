// The level curve and the level-up stat rolls read the STARTER species' profile
// row for the member's roster slot, never the active form's row.
//
// The original, from the assembly (which outranks every summary):
//   F0x80086184 (pro/stfgtrep) adds EXP and loops the level curve. Its threshold
//     reads `growth_xp` from `0x8003EF5C + slot*0x58`: the decomp line 25
//     `((arg0 * 0x58) + 0x8003EF5C)->unk3E`; the asm builds s4 at .L0x00003548
//     (`addu $s4, $v0, $v1`, v0 = slot*0x58, v1 = 0x8003EF5C) and reads
//     .L0x000035BC `lbu $v1, 0x3e($s4)`.
//   F0x80085E3C (the per-level stat rolls) reads the growth bytes
//     +0x41/+0x42/+0x43+i/+0x49+i from the same row: .L0x000031EC builds
//     s5 = 0x8003EF5C + slot*0x58, then .L0x00003228 (`lbu 0x41($s5)`),
//     .L0x000032AC (`lbu 0x42($s5)`), .L0x0000338C (`lbu 0x43($v1)`,
//     v1 = s5 + i) and .L0x00003434 (`lbu 0x49($v1)`).
//   Runtime cross-check: slot1_ram.bin slot0 stands in Dinohumon (record +0x04
//     = 0x182, the form value of profile row 8) with exp 2985 and level 15.
//     thr(15) = 2805 < 2985 < thr(16) = 3386 holds only for the starter's
//     growth_xp 8 (Kotemon's row), not the standing form's 1 (which would put
//     exp 2985 at level 27).
//
// The walker's browser reward path (web/battle.js applyParticipantProgress) used
// to hand the record's active-form profile to levelForExp and applyLevelUp. For
// the eight starters the slot's row is exactly `rookieId - 1`
// (engine/dw3/roster.ts ROSTER_SLOT_CHARIDS + web/party.js CHARID_TO_DIGID), so
// the starter source is `digimonDB[rookieId]` — levelUpGrowthProfile.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  levelForExp, levelUpThreshold, rollLevelUpGains, applyLevelUp, levelUpGrowthProfile,
} from "../web/battle.js";

const digimon = JSON.parse(readFileSync(
  new URL("../web/assets/data/digimon.json", import.meta.url), "utf8")).digimon;
const byId = Object.fromEntries(digimon.map((d) => [d.id, d]));
const prog = JSON.parse(readFileSync(
  new URL("../web/assets/data/progression.json", import.meta.url), "utf8"));
const LU = prog.level_up;

// Deterministic rng: cycles through the given values.
const seq = (...vals) => { let i = 0; return () => vals[i++ % vals.length]; };

const member = (level, xp) => ({
  level, xp, tp: 10, hp: 400, maxHp: 400, mp: 120, maxMp: 120,
  stats: { str: 200, def: 80, spt: 60, wis: 50, spd: 90, chr: 30 },
  bonuses: {}, elemBonuses: {},
});

test("the growth source is the starter's row even while a digivolution stands", () => {
  // The empirical probe's seed: level 10, xp 500, standing in Dinohumon (id 9,
  // growth_xp 1), rookie Kotemon (id 1, growth_xp 8). Battle screen 200 pays
  // +4 EXP (500 -> 504).
  const player = { profile: byId[9], rookieId: 1, statsRecord: member(10, 500) };
  const growth = levelUpGrowthProfile(player, byId);
  assert.equal(growth.id, 1, "the starter's profile answers, not the form's");
  assert.equal(growth.growth_xp, 8, "Kotemon's growth_xp");
  assert.equal(growth.growth, byId[1].growth, "Kotemon's growth bytes");
  // Starter curve: thr(11) = 8*(1331+55-6)/10 + 50 = 1154 > 504 -> stays level 10.
  assert.equal(levelForExp(10, 504, growth.growth_xp ?? 8, LU), 10);
  // The active form's curve jumps to 16 — the divergence this pins.
  assert.equal(levelForExp(10, 504, player.profile.growth_xp, LU), 16);
  // The form's own threshold for the same step, for the record.
  assert.equal(levelUpThreshold(1, 11, LU), 188);
});

test("a level-up rolls the starter's growth bytes, not the standing form's", () => {
  const player = { profile: byId[9], rookieId: 1, statsRecord: member(10, 500) };
  const growth = levelUpGrowthProfile(player, byId);
  // The deterministic view of the byte source: rng 0, new level 11 (tier-1 adj 5,
  // rand9[0] = -4). Kotemon hp 85 -> 85 - 5 - 4 = 76; Dinohumon hp 1 -> -8.
  assert.equal(rollLevelUpGains(growth, 11, LU, seq(0)).hp, 76);
  assert.equal(rollLevelUpGains(player.profile, 11, LU, seq(0)).hp, -8);
  // The same level-up through applyLevelUp with the starter as the roll source:
  // maxHp gain lands in Kotemon's band [76, 84] (Dinohumon's is [-8, 0]).
  const ps = member(10, 504);
  applyLevelUp(ps, player.profile, 10, 11, LU, growth);
  const gain = ps.maxHp - 400;
  assert.ok(gain >= 76 && gain <= 84, `Kotemon's hp roll band (got +${gain})`);
  assert.equal(ps.level, 11);
  assert.equal(ps.tp, 15, "TP +5 for the level");
  // Passing no growth profile keeps the old call shape working (default = prof):
  // the form's own bytes answer, so the gain stays in the form's band.
  const form = member(10, 504);
  applyLevelUp(form, player.profile, 10, 11, LU);
  const formGain = form.maxHp - 400;
  assert.ok(formGain <= 0, `the form's own row rolls ~0 (got +${formGain})`);
});

test("the reward path wires the starter row into both the curve and the rolls", () => {
  const src = readFileSync(new URL("../web/battle.js", import.meta.url), "utf8");
  assert.match(src,
    /const growthProfile = levelUpGrowthProfile\(player, digimonDB\) \?\? prof;/,
    "applyParticipantProgress resolves the growth source from the record's rookieId");
  assert.match(src, /levelForExp\(oldLevel, newXp, growthProfile\.growth_xp \?\? 8, lu\)/,
    "the level curve reads the starter's growth_xp");
  assert.match(src, /applyLevelUp\(ps, prof, oldLevel, newLevel, lu, growthProfile\)/,
    "the level-up takes the starter row as its roll source");
  assert.match(src, /rollLevelUpGains\(growthProfile, lv, lu\)/,
    "applyLevelUp rolls the growth source, not the active form");
  assert.ok(!/rollLevelUpGains\(prof, lv, lu\)/.test(src),
    "the active form's row is never the roll source");
});
