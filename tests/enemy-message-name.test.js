// Battle messages name an enemy by the disc name line the HUD plate reads (bank 0x4e,
// record +0x06), not by the enemies.json record key ("Goburimon2").
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/data");
const { enemyMessageName } = await import("../web/fusion.js");
const { decodeGameName } = await import("../web/nameentry-translated.js");

const bytes = readFileSync(join(dir, "wizard/80.bin"));
const count = bytes.readUInt32LE(0);
const bank = [];
for (let i = 0; i < count; i++) {
  const s = bytes.readUInt32LE(4 + i * 4);
  bank.push(decodeGameName(bytes.subarray(s, bytes.indexOf(0, s))));
}
const stats = JSON.parse(readFileSync(join(dir, "battlecmd/enemy_stats.json"), "utf8")).records;
const enemies = JSON.parse(readFileSync(join(dir, "enemies.json"), "utf8")).enemies;
const enemyAt = (key) => {
  const i = enemies.findIndex((e) => e.enemy_id === key);
  assert.ok(i >= 0, key);
  return { en: { eStats: enemies[i], profile: { name: enemies[i].digimon_id } }, record: stats[i] };
};

test("numbered records print the disc species name", () => {
  const cases = { Goburimon2: "Goburimon", Cardmon3: "Cardmon", Galacticmon2: "Galacticmon", Numemon6: "Numemon", Airdramon2: "Airdramon" };
  for (const [key, want] of Object.entries(cases)) {
    const { en, record } = enemyAt(key);
    assert.equal(en.eStats.digimon_id, key, "the record key is what used to leak");
    assert.equal(enemyMessageName(en, record, bank), want);
  }
});

test("an authored displayName wins, a missing disc line falls back to the key", () => {
  const { en, record } = enemyAt("Goburimon2");
  assert.equal(enemyMessageName({ ...en, displayName: "Millenniummon" }, record, bank), "Millenniummon");
  assert.equal(enemyMessageName(en, null, bank), "Goburimon2");
  assert.equal(enemyMessageName(en, record, null), "Goburimon2");
  assert.equal(enemyMessageName(en, record, []), "Goburimon2");
  assert.equal(enemyMessageName({}, null, null, "Enemy"), "Enemy");
});
