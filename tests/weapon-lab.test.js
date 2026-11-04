// The weapon & crest lab — the hidden on-hit effect of a signature weapon, as the one
// extra line the equipment sheet's footer shows when the player switches it on.
//
// The disc's signature-weapon ladder (pro/fightstg.s:29436-29500) tests eleven ids in
// six rungs and writes the wearer's effective-stat bytes +0x2D..+0x36 (poison / frozen /
// confuse / instant KO / drain) — or, for the SaberFang/Shuriken rung, the Search-Crest
// crit byte +0x38. engine/dw3/equipment.ts WEAPON_LADDER / weaponSecondary /
// weaponCritByte are the decode (ddw3-walker docs/research/battle/
// accessory-effects-decoded-2026-07-10.md); web/weapon-lab.js only puts those numbers
// into one plain line, and web/menu.js draws it only under F2 -> Extras -> Weapon effects.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  weaponSecondary, weaponCritByte, WEAPON_LADDER_BY_ID, EQUIPMENT,
} from "../engine/dw3/equipment.ts";
import * as bundle from "../web/vendor/engine.js";
import { weaponEffectLine } from "../web/weapon-lab.js";

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
const LADDER_IDS = Object.keys(WEAPON_LADDER_BY_ID).map(Number).sort((a, b) => a - b);

// ---------------------------------------------------------------------------
// The decoded numbers the line prints (engine census, so the lab cannot invent them).
// ---------------------------------------------------------------------------
test("the ladder's eight status weapons carry the decoded proc and value bytes", () => {
  assert.deepEqual(weaponSecondary(151), { kind: "poison", proc: 64, value: 64 });     // VenomFang
  assert.deepEqual(weaponSecondary(94), { kind: "drain", proc: 32, value: 32 });      // CrimsonBlade
  assert.deepEqual(weaponSecondary(173), { kind: "drain", proc: 64, value: 96 });     // VampireLance
  assert.deepEqual(weaponSecondary(147), { kind: "drain", proc: 64, value: 64 });     // CerberusFang
  assert.deepEqual(weaponSecondary(180), { kind: "confuse", proc: 32, value: 96 });   // RockBreaker
  assert.deepEqual(weaponSecondary(194), { kind: "confuse", proc: 24, value: 80 });   // RavenBow
  assert.deepEqual(weaponSecondary(109), { kind: "ko", proc: 24, value: 0 });         // NeedleGlove
  assert.deepEqual(weaponSecondary(186), { kind: "ko", proc: 32, value: 0 });         // SoulChopper
});

test("the frozen rung carries no effect (proc byte 0) and the crit rung writes +0x38", () => {
  assert.equal(weaponSecondary(210), null);          // ShockHorn: the frozen rung's proc byte is 0
  assert.equal(weaponSecondary(150), null);          // SaberFang: a crit rung, not a status
  assert.equal(weaponSecondary(191), null);          // Shuriken: same rung
  assert.equal(weaponCritByte(150), 64);
  assert.equal(weaponCritByte(191), 32);
  assert.equal(weaponCritByte(151), 0);              // a status weapon writes no crit byte
  assert.equal(weaponSecondary(92), null);           // ShortSword is not on the ladder at all
});

// ---------------------------------------------------------------------------
// The one line the footer prints.
// ---------------------------------------------------------------------------
test("a poison weapon reads its proc over 128 and its magnitude", () => {
  const line = weaponEffectLine(151);
  assert.match(line, /poison/, "the line names the effect");
  assert.match(line, /64/, "the line carries the proc byte");
  assert.equal(line, "On hit: poison (64/128, magnitude 64)");
});

test("a drain weapon reads its proc and the HP it gives back as a ratio", () => {
  assert.equal(weaponEffectLine(94), "On hit: drain (32/128, ratio 32/128)");
  assert.equal(weaponEffectLine(147), "On hit: drain (64/128, ratio 64/128)");
  assert.equal(weaponEffectLine(173), "On hit: drain (64/128, ratio 96/128)");
});

test("confuse, instant KO and the two crit weapons each get their own wording", () => {
  assert.equal(weaponEffectLine(180), "On hit: confuse (32/128, magnitude 96)");
  assert.equal(weaponEffectLine(194), "On hit: confuse (24/128, magnitude 80)");
  assert.equal(weaponEffectLine(109), "On hit: instant KO (24/128)");
  assert.equal(weaponEffectLine(186), "On hit: instant KO (32/128)");
  assert.equal(weaponEffectLine(150), "On hit: crit +64");
  assert.equal(weaponEffectLine(191), "On hit: crit +32");
});

test("a ladder weapon with no effect says none, and an ordinary item has no line", () => {
  assert.equal(weaponEffectLine(210), "On hit: none", "ShockHorn is on the ladder but has no effect");
  assert.equal(weaponEffectLine(92), null, "ShortSword is an ordinary weapon: no third line");
  assert.equal(weaponEffectLine(null), null);
  assert.equal(weaponEffectLine(undefined), null);
  assert.equal(weaponEffectLine(0), null);
});

test("every one of the ladder's eleven ids gets a line, and no other item does", () => {
  assert.equal(LADDER_IDS.length, 11, "the decode spells eleven ids in six rungs");
  for (const id of LADDER_IDS) {
    const line = weaponEffectLine(id);
    assert.equal(typeof line, "string", `ladder id ${id} has a line`);
    assert.match(line, /^On hit: /);
    assert.doesNotMatch(line, /\n/, "it is one line");
  }
  for (const item of EQUIPMENT) {
    if (WEAPON_LADDER_BY_ID[item.id]) continue;
    assert.equal(weaponEffectLine(item.id), null, `${item.name} (${item.id}) is not a signature weapon`);
  }
});

// ---------------------------------------------------------------------------
// The line cannot drift from the fight: it reads the same engine functions, and the
// browser bundle's copy still agrees with the TypeScript source item by item.
// ---------------------------------------------------------------------------
test("the lab imports the engine's own weaponSecondary and weaponCritByte", () => {
  const src = read("../web/weapon-lab.js");
  assert.match(src, /import \{[^}]*weaponSecondary[^}]*\} from "\.\/vendor\/engine\.js"/);
  assert.match(src, /weaponCritByte/);
  assert.match(src, /WEAPON_LADDER_BY_ID/);
  const code = src.replace(/^\s*\/\/.*$/gm, "");   // the header names the weapons on purpose
  assert.doesNotMatch(code, /\b(151|173|210)\b/, "no second copy of the ladder's ids");
  assert.doesNotMatch(src, /localStorage|fetch\(|document\./, "read-only: no store, no fetch, no DOM");
});

test("the browser bundle and the engine source agree on every item", () => {
  assert.equal(EQUIPMENT.length, 268);
  for (const item of EQUIPMENT) {
    assert.deepEqual(bundle.weaponSecondary(item.id), weaponSecondary(item.id), `secondary of ${item.name}`);
    assert.equal(bundle.weaponCritByte(item.id), weaponCritByte(item.id), `crit byte of ${item.name}`);
  }
});

// ---------------------------------------------------------------------------
// The F2 switch: the Extras pair, the off-by-default list, and the gated footer line.
// ---------------------------------------------------------------------------
test("the F2 Extras row and EXPERIMENTAL list are off by default", () => {
  const ambience = read("../web/ambience.js");
  const extrasLine = ambience.split("\n").find((line) => line.includes('["Extras"'));
  assert.ok(extrasLine, "the Extras group is still one literal");
  assert.ok(extrasLine.includes('["weaponlab", "Weapon effects (new)"]'), "the Extras pair is present");
  const experimental = ambience.match(/const EXPERIMENTAL = \[([^\]]*)\];/);
  assert.ok(experimental, "EXPERIMENTAL is still one array literal");
  assert.match(experimental[1], /"weaponlab"/, "off until the player switches it on");
  assert.doesNotMatch(ambience, /(get|has)\("weaponlab"\)/, "never a URL flag");
});

test("the equip sheet draws the line as a third footer line only under window.__fx?.weaponlab", () => {
  const src = read("../web/menu.js");
  assert.match(src, /import \{ weaponEffectLine \} from "\.\/weapon-lab\.js";/, "menu.js uses the lab");
  const gate = src.indexOf("window.__fx?.weaponlab");
  assert.ok(gate >= 0, "menu.js holds the switch");
  const call = src.indexOf("weaponEffectLine(");
  assert.ok(call > gate, "the call sits after the switch");
  assert.ok(call - gate < 600, "the switch wraps the call");
  assert.equal(src.split("weaponEffectLine(").length - 1, 1, "one call site, inside the gate");
  const between = src.slice(Math.max(0, gate - 8), call);
  assert.match(between, /if \(window\.__fx\?\.weaponlab\) \{/, "a plain if, so off changes nothing");
  assert.match(src.slice(call, call + 600), /drawText\(ctx, [^,]+, d2\.x, d2\.y \+ 9/, "drawn as the third line");
});
