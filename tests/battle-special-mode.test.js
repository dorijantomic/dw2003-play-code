// The disc's special-encounter damage finalizer is one rule, and every player→enemy hit
// must meet it.
//
// WFIGHTMN 0x800aabf0 (asm/dw2003/pro/wfightmn.s:5003-5072, file .L0x00004e10) runs in the
// sub-action attack runner's damage tail and reads the battle-mode word 0x800a4536:
//
//   modes 1/2, player→enemy: the enemy's HP is FLOORED at max/11, so a scripted boss the
//       story needs alive (s415 Bulbmon, s480 Jungle Grave Zanbamon) cannot be killed;
//   mode 3, player→enemy: the player's damage is nullified (s206 Amaterasu Knightmon);
//   mode 0 and 4, and every enemy→player hit: unchanged.
//
// The mode is chosen from the exact field-screen/battle-id pair (0x23a + 0x0b -> 2).
// The rule was ported (engine/dw3/battle-formulas.ts) but wired only into the item path
// (engine/dw3/battle-items.ts), so an ordinary Fight / technique / DNA hit never met it and
// every special encounter could be WON in our build. `finalizePlayerDamage` in
// web/battle.js is the one shared point all three player→enemy damage sites now go
// through. This file pins the rule AND the wiring so a future edit cannot quietly drop it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { specialBattleMode, specialModeDamage, specialModeLowHpEscape } from "../engine/index.ts";

const battleJs = () => readFileSync("web/battle.js", "utf8");

test("specialBattleMode selects mode 2 for the Jungle Grave / Zanbamon encounter", () => {
  // 0x23a is the field screen, 0x00b the battle id — the exact pair WFIGHTMN 0xfdc..0x10a8
  // compares (EV-battle-special-mode-map).
  assert.equal(specialBattleMode("s480", 0x00b), 2, "Jungle Grave / Zanbamon is mode 2");
  assert.equal(specialBattleMode("s415", 0x143), 1, "Deeper Crevice / Bulbmon is mode 1");
  assert.equal(specialBattleMode("s206", 0x01e), 3, "Amaterasu Bridge / Knightmon is mode 3");
  assert.equal(specialBattleMode("s820", 0x144), 4, "the Galacticmon sequence is mode 4");
  // The same stage but a different battle id is NOT the special fight.
  assert.equal(specialBattleMode("s480", 0x143), 0);
  assert.equal(specialBattleMode("s200", 0x00b), 0);
});

test("specialModeDamage floors modes 1/2 at maxHP/11, nullifies 3, passes 0 and 4", () => {
  // floor = trunc(1100 / 11) = 100.
  assert.equal(specialModeDamage(0, true, 100, 1100, 80), 80, "mode 0 is ordinary damage");
  assert.equal(specialModeDamage(1, true, 150, 1100, 80), 50, "mode 1 clamps to cur - floor");
  assert.equal(specialModeDamage(2, true, 150, 1100, 80), 50, "mode 2 clamps to cur - floor");
  // At the floor, further damage is refused entirely.
  assert.equal(specialModeDamage(2, true, 100, 1100, 80), 0, "cannot pass the floor");
  assert.equal(specialModeDamage(2, true, 60, 1100, 80), 0, "already below the floor");
  assert.equal(specialModeDamage(3, true, 150, 1100, 80), 0, "mode 3 nullifies the player's damage");
  assert.equal(specialModeDamage(4, true, 150, 1100, 80), 80, "mode 4 passes through");
  // The finalizer never touches the enemy's hit on the player.
  assert.equal(specialModeDamage(2, false, 150, 1100, 80), 80, "enemy→player is unchanged");
  assert.equal(specialModeDamage(3, false, 150, 1100, 80), 80);
});

test("web/battle.js runs the finalizer at every player→enemy damage site, and only there", () => {
  const src = battleJs();
  // One definition + the three commits: the basic attack, the player's technique, the DNA.
  const calls = src.match(/finalizePlayerDamage\(/g) || [];
  assert.equal(calls.length, 4, "defined once and called at the three player→enemy commits");
  assert.ok(
    src.includes("function finalizePlayerDamage(b, total)"),
    "the shared helper exists",
  );
  // The helper must route through the ported rule, not re-implement it.
  assert.ok(
    src.includes("specialModeDamage(mode, true, b.enemy.hp, b.enemy.maxHp, total, 1);"),
    "the helper is the disc's own finalizer (player→enemy, mode-keyed)",
  );
  // The enemy→player commit (b.player.hp) must NOT be clamped.
  const combat = src.match(/b\.player\.hp = Math\.max\(0, b\.player\.hp - total\)/g) || [];
  assert.equal(combat.length, 1, "exactly one enemy→player commit");
  assert.ok(
    !/finalizePlayerDamage[^;]*\n[^;]*b\.player\.hp/.test(src),
    "the finalizer must not sit in front of the enemy→player commit",
  );
});

test("specialModeLowHpEscape fires only for mode 1 below maxHP/10", () => {
  // fightstg F0x80088564 (.L0x800885bc): mode 1 and the enemy's curHP < maxHP/10 writes
  // esmfight[0x5f] "Fleeing!" and commits the battle result byte 0 (flee).
  assert.equal(specialModeLowHpEscape(1, 95, 960), true, "mode 1, 95/960 (10% = 96) escapes");
  assert.equal(specialModeLowHpEscape(1, 96, 960), false, "at the threshold it does NOT (strict <)");
  assert.equal(specialModeLowHpEscape(1, 200, 960), false, "well above the threshold, no");
  // The mode-1 damage floor maxHP/11 = 87 sits BELOW the threshold, so a floored boss
  // always escapes instead of dying.
  assert.equal(specialModeLowHpEscape(1, 87, 960), true, "the maxHP/11 floor is below maxHP/10");
  // Gated on mode 1 alone: mode 2 (Zanbamon) never takes this arm (his is Cross Slash).
  assert.equal(specialModeLowHpEscape(2, 87, 960), false, "mode 2 does not escape this way");
  assert.equal(specialModeLowHpEscape(0, 87, 960), false);
  assert.equal(specialModeLowHpEscape(3, 87, 960), false);
  assert.equal(specialModeLowHpEscape(4, 87, 960), false);
  // A dead enemy is not "escaping".
  assert.equal(specialModeLowHpEscape(1, 0, 960), false);
});

test("web/battle.js runs the mode-1 low-HP escape from the shared advance point", () => {
  const src = battleJs();
  assert.ok(src.includes("specialModeLowHpEscape"), "the shared rule is imported");
  assert.match(
    src,
    /!b\._mode1EscapeShown && specialModeLowHpEscape\(b\.specialMode \?\? 0, b\.enemy\.hp, b\.enemy\.maxHp\)/,
    "the escape reads the battle's own mode and the enemy's HP — never a battle id or name",
  );
  assert.match(src, /b\._mode1EscapeShown = true;/, "it fires once");
  assert.match(src, /MSG\.FLEEING/, "it puts up the disc's esmfight[0x5f] \"Fleeing!\" page");
  assert.match(src, /if \(battle === b\) endBattle\("enemy-fled"\)/,
    "it closes as the enemy-flee outcome (result 0: back to the field, no rewards)");
  // Never a per-battle case: the rule is keyed on the mode word, not the encounter.
  assert.doesNotMatch(src, /_mode1EscapeShown[^\n]*\bBulbmon\b/);
});
