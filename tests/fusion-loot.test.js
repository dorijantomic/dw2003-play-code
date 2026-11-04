// Both halves' loot — a fusion carries what both halves carried (web/fusion-loot.js).
//
// NEW content, fan lore: Kimeramon + Machinedramon = Millenniummon. The body's own row
// is already rolled when that half falls (web/battle.js's defeatCurrentEnemy runs for it
// at the swap), so when the FUSED body falls the battle must roll only the OTHER halves'
// real drops: Kimeramon pays DevilChip (rate 16) as itself, and the fused body pays
// Machinedramon's MetalPowerS (rate 32) — never DevilChip a second time.
//
// The chance text follows the live roll the F2 "Disc-accurate hit & drop rolls" switch
// selects: off -> Math.random() * 255 < rate, i.e. rate/255; on -> dropPasses, i.e.
// (rate + 1)/1024. Everything rides F2 -> Extras -> "Fusion bosses" (off by default).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  fusionDrops, fusionLootRows, rollFusionDrops, dropChanceText,
} from "../web/fusion-loot.js";
import { dropPasses } from "../web/tech-record.js";

const ROOT = resolve(import.meta.dirname, "..");
const readJSON = (p) => JSON.parse(readFileSync(resolve(ROOT, p), "utf8"));

// The battle's own shape: enemiesDB is a name-keyed map of the data file's rows.
const enemies = Object.fromEntries(
  readJSON("web/assets/data/enemies.json").enemies.map((e) => [e.enemy_id, e]),
);
const boss = readJSON("web/fusion_bosses.json").bosses.millenniummon;

test("the authored boss is Kimeramon's body over both halves, and the two rows are real", () => {
  assert.deepEqual(boss.halves, ["Kimeramon", "Machinedramon"]);
  assert.equal(boss.body, "Kimeramon");
  assert.equal(enemies.Kimeramon.drop_item, "DevilChip");
  assert.equal(enemies.Kimeramon.drop_rate, 16);
  assert.equal(enemies.Machinedramon.drop_item, "MetalPowerS");
  assert.equal(enemies.Machinedramon.drop_rate, 32);
});

test("the fused body carries only the OTHER half's drop — the body's row was already paid", () => {
  // Kimeramon fell before the fusion; defeatCurrentEnemy rolled its DevilChip then.
  assert.deepEqual(
    fusionDrops(boss.halves, boss.body, enemies),
    [{ item: "MetalPowerS", rate: 32 }],
  );
  // With no body to skip, both halves' real rows come through, in halves order.
  assert.deepEqual(
    fusionDrops(boss.halves, null, enemies),
    [{ item: "DevilChip", rate: 16 }, { item: "MetalPowerS", rate: 32 }],
  );
});

test("halves sharing an item make one row at the max rate; Null and unknown halves make none", () => {
  const fake = {
    A: { enemy_id: "A", drop_item: "Same", drop_rate: 16 },
    B: { enemy_id: "B", drop_item: "Same", drop_rate: 64 },
    C: { enemy_id: "C", drop_item: "Null", drop_rate: 128 },
    Body: { enemy_id: "Body", drop_item: "Same", drop_rate: 255 },
  };
  assert.deepEqual(fusionDrops(["A", "B", "C"], "Body", fake), [{ item: "Same", rate: 64 }]);
  assert.deepEqual(fusionDrops(["A", "B", "C"], null, fake), [{ item: "Same", rate: 64 }],
    "two halves carrying one item still pay it once, at the larger rate");
  assert.deepEqual(fusionDrops(["Ghost", "Kimeramon"], null, enemies), [{ item: "DevilChip", rate: 16 }],
    "a name the enemy table does not have contributes nothing");
  assert.deepEqual(fusionDrops([], null, enemies), [], "no halves, no loot");
});

test("the raw data file and a bare row array resolve the same rows as the battle's map", () => {
  const raw = readJSON("web/assets/data/enemies.json");
  assert.deepEqual(fusionDrops(boss.halves, boss.body, raw), [{ item: "MetalPowerS", rate: 32 }]);
  assert.deepEqual(fusionDrops(boss.halves, boss.body, raw.enemies), [{ item: "MetalPowerS", rate: 32 }],
    "the parsed file's own array shape works too");
});

test("the chance text is the live roll's own odds, one decimal", () => {
  assert.equal(dropChanceText(32, false), "12.5%", "Math.random() * 255 < 32");
  assert.equal(dropChanceText(32, true), "3.2%", "(32 + 1) / 1024");
  assert.equal(dropChanceText(16, false), "6.3%");
  assert.equal(dropChanceText(16, true), "1.7%");
  // Rate 0 is not "never" on the disc: draw 0 still lands, 1 in 1024.
  assert.equal(dropChanceText(0, false), "0.0%");
  assert.equal(dropChanceText(0, true), "0.1%");
  // And a rate past the float roll's ceiling can never read over 100%.
  assert.equal(dropChanceText(256, false), "100.0%");
});

test("fusionLootRows carries the same rows plus the chance text the switch selects", () => {
  assert.deepEqual(
    fusionLootRows(boss.halves, boss.body, enemies, false),
    [{ item: "MetalPowerS", rate: 32, chance: "12.5%" }],
  );
  assert.deepEqual(
    fusionLootRows(boss.halves, boss.body, enemies, true),
    [{ item: "MetalPowerS", rate: 32, chance: "3.2%" }],
  );
});

test("rollFusionDrops draws once per row: the float roll off, the disc's own word on", () => {
  // Off: Math.random() * 255 < rate (0 and 1 are the two ends of a [0,1) draw).
  assert.deepEqual(rollFusionDrops(boss.halves, boss.body, enemies, () => 0, false), ["MetalPowerS"]);
  assert.deepEqual(rollFusionDrops(boss.halves, boss.body, enemies, () => 1, false), []);
  // One live draw per row, never one shared draw for the body.
  let calls = 0;
  const counting = () => { calls++; return 0; };
  assert.deepEqual(
    rollFusionDrops(boss.halves, null, enemies, counting, false),
    ["DevilChip", "MetalPowerS"],
    "two rows, both land at draw 0",
  );
  assert.equal(calls, 2, "one draw per row");
  // On: the disc's `draw % 1024 < rate + 1`.
  assert.equal(dropPasses(32, () => 0), true);
  assert.equal(dropPasses(32, () => 1023), false);
  assert.deepEqual(rollFusionDrops(boss.halves, boss.body, enemies, () => 0, true), ["MetalPowerS"]);
  assert.deepEqual(rollFusionDrops(boss.halves, boss.body, enemies, () => 1023, true), []);
});

test("source gate: the fused branch sits on bossId, pays the other halves, and never re-rolls the body", () => {
  const battle = readFileSync(resolve(ROOT, "web/battle.js"), "utf8");
  const block = battle.match(/function defeatCurrentEnemy\(\) \{[\s\S]*?\n  \}/)?.[0] ?? "";
  assert.ok(block, "defeatCurrentEnemy is still a function");
  // The fused record is the only thing that writes bossId (fuseIntoBoss, 6253) ...
  assert.equal((battle.match(/\.bossId = /g) ?? []).length, 1, "bossId is written only by fuseIntoBoss");
  assert.match(battle, /en\.bossId = boss\.id \?\? null;/, "fuseIntoBoss stamps the authored id");
  // ... and the fusion is only reachable with the F2 `fusionbosses` switch on.
  assert.match(block, /fusionOnDefeat\(\{[\s\S]*?fxOn: fusionEnabled\(\)/, "the fusion asks the F2 key");
  assert.match(block, /if \(fusion\.fuse\) \{\s*fuseIntoBoss\(b, fusion\.boss\);/, "only a won fusion swaps");
  // The loot branch reads the fused record's authored halves/body.
  assert.match(block, /b\.enemy\?\.bossId \? fusionBossesDB\?\.\[b\.enemy\.bossId\] \?\? null : null/,
    "the branch sits on bossId + the authored boss table");
  assert.match(block, /rollFusionDrops\(fusionBoss\.halves, fusionBoss\.body, enemiesDB/,
    "the fused body rolls the OTHER halves' drops");
  assert.match(block, /enemiesDB, RAND_U16, true\)/, "the stream is the disc roll, always on");
  // The ordinary path is byte-for-byte today's, and it is what the fused body skips.
  assert.match(block, /const drop = rollDrop\(b\.enemy\.eStats\);/);
  assert.match(block, /if \(drop\) b\._loot\.drops\.push\(drop\);/);
  const fusedArm = block.match(/if \(fusionBoss\) \{[\s\S]*?\n    \} else \{/)?.[0] ?? "";
  assert.ok(fusedArm, "the fusion guard and the ordinary path are an if/else");
  assert.doesNotMatch(fusedArm, /rollDrop\(/, "rollDrop is not called for the fused boss");
  assert.match(fusedArm, /b\._loot\.drops\.push\(item\)/, "every dropped item joins the loot list");
  // One ordinary call site, unchanged.
  assert.equal((battle.match(/rollDrop\(b\.enemy\.eStats\)/g) ?? []).length, 1);
});
