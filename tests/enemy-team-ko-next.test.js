// Bug (dev tools -> Bosses and tamers -> Seiryu Leader, screen 3): KO of the first member went straight to
// "Battle Won!" because the team slots read profile.id, which an enemies.json profile (enemyToProfile) never has,
// so every slot looked empty (menu.c:1088-1096 wants id != 0 && hp != 0). The disc id of an enemy comes from
// field_encounters (the party entry id: Minotarumon 172, Tyrannomon 8, Apemon 207); buildEnemyRecord keeps it as speciesId.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { firstAliveEnemySlot, enemyTeamSlots } from "../web/enemy-switch.js";

const fieldEnc = JSON.parse(readFileSync(new URL("../web/assets/data/field_encounters.json", import.meta.url), "utf8"));
const BATTLE = readFileSync(new URL("../web/battle.js", import.meta.url), "utf8");
const party = fieldEnc.screens["3"];

// A record exactly as buildEnemyRecord shapes it: enemyToProfile has name/resistances/family, no id.
const record = (entry, hp) => ({ profile: { name: entry.name, resistances: {}, family: 6 }, speciesId: entry.id, hp });

test("screen 3 is a three-member team (Minotarumon, Tyrannomon, Apemon) with disc ids", () => {
  assert.deepEqual(party.map((p) => p.name), ["Minotarumon", "Tyrannomon", "Apemon"]);
  assert.deepEqual(party.map((p) => p.id), [172, 8, 207]);
});

test("first member down: the next living slot (1) comes, not nobody left", () => {
  const recs = [record(party[0], 0), record(party[1], 576), record(party[2], 684)];
  assert.equal(firstAliveEnemySlot(enemyTeamSlots(recs)), 1);
});

test("slots 0 and 1 down: slot 2; all down: -1", () => {
  assert.equal(firstAliveEnemySlot(enemyTeamSlots([record(party[0], 0), record(party[1], 0), record(party[2], 9)])), 2);
  assert.equal(firstAliveEnemySlot(enemyTeamSlots(party.map((p) => record(p, 0)))), -1);
});

test("buildEnemyRecord stores the disc id (enemyStatIdByName) as speciesId", () => {
  const fn = BATTLE.slice(BATTLE.indexOf("function buildEnemyRecord"), BATTLE.indexOf("function buildPlayerRoster"));
  assert.match(fn, /speciesId:\s*enemyStatIdByName\?\.\[/);
});
