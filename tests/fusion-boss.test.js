// The fusion boss, battle half (NEW content, fan lore: Kimeramon + Machinedramon = Millenniummon).
//
// The numbers here are the build card's: each stat blends as `max + a quarter of the
// smaller`, the fused record scales that blend by the boss screen's own stat scale
// (18/16), and its HP is the two encounter screens' HP added (1176 + 1248 = 2424). The
// new technique is built on the real row 167 and carries the real sleep applier's byte.
//
// Everything is OFF unless F2 -> Extras -> "Fusion bosses" is on (key `fusionbosses`):
// with the switch off the authored skill never joins the skill map, a party entry keeps
// no `fuseInto`, no fuse happens and no fighter is tinted.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// web/battle.js's gauge writer reads localStorage; importing the module must not need a DOM.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};

const here = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = join(here, "web/assets/data");

const {
  blendStats, enemyDisplayName, fusedRecord, fusionOnDefeat, mergeFusionSkills, partyEntriesFor,
} = await import("../web/fusion.js");
const { battleHudPlateLabels } = await import("../web/battlehud-translated.js");
const { battleHudPlateLabelsFor } = await import("../web/battle.js");
const { FIGHTER_TINT, fighterTint, setFighterTint } = await import("../web/battle3d.js");

const enemies = JSON.parse(readFileSync(join(dataDir, "enemies.json"), "utf8")).enemies;
const row = (name) => enemies.find((e) => e.enemy_id === name);
const built = JSON.parse(readFileSync(join(here, "web/fusion_bosses.json"), "utf8"));
const boss = built.bosses.millenniummon;

test("the authored boss resolves the two screens' HP and the boss screen's scale + 2", () => {
  // 1176 (screen 121, Kimeramon L44) + 1248 (screen 139, Machinedramon L47) = 2424;
  // the fused stat scale is screen 139's own 16 + the authored 2.
  assert.equal(boss.hp, 2424);
  assert.equal(boss.statScale, 18);
  assert.deepEqual(boss.halves, ["Kimeramon", "Machinedramon"]);
  assert.equal(boss.body, "Kimeramon");
  assert.equal(boss.displayName, "Millenniummon");
  assert.deepEqual(boss.moves, [325, 166, 9001]);
  assert.deepEqual(boss.tint, [0.62, 0.42, 0.85, 1]);
  assert.equal(boss.transform, "whiteout");
});

test("the blend: each stat is the larger plus a quarter of the smaller", () => {
  const k = row("Kimeramon");
  const m = row("Machinedramon");
  const blend = blendStats(k, m);
  assert.equal(blend.str, 643, "520 + 490 / 4");
  assert.equal(blend.def, 865, "735 + 520 / 4");
  assert.equal(blend.spd, 514, "416 + 392 / 4");
});

test("the fused record: the card's HP, the scaled blend and the three moves", () => {
  const k = row("Kimeramon");
  const m = row("Machinedramon");
  const fused = fusedRecord({
    halves: [k, m], body: boss.body, level: boss.level, hp: boss.hp,
    statScale: boss.statScale, moves: boss.moves,
  });
  assert.equal(fused.hp, 2424);
  assert.equal(fused.maxHp, 2424);
  assert.equal(fused.statScale, 18);
  assert.deepEqual(fused.stats, { str: 723, def: 973, spt: 655, wis: 835, spd: 578 },
    "the blend times 18/16, rounded");
  assert.equal(fused.attack, 325, "Machinedramon's two-hit Fight");
  assert.equal(fused.move_1, 166, "Kimeramon's Dark Elemental");
  assert.equal(fused.move_2, 9001, "the new Time Unlimited");
  assert.ok(fused.ai_moves.some((r) => r.action === 3),
    "action 3 is move_2; without an action-3 row Time Unlimited never fires");
});

test("the authored skill joins the skill map only with the toggle on", () => {
  const base = { 167: { id: 167, name: "Darkness Chaos" } };
  const on = mergeFusionSkills(base, built.skills, true);
  assert.equal(on[9001].name, "Time Unlimited");
  assert.equal(on[9001].power, 750);
  assert.equal(on[9001].mp_cost, 180);
  assert.equal(on[9001].element, "dark");
  assert.equal(on[9001].attack_category, "magical");
  assert.equal(on[9001].clip, 9);
  assert.equal(on[9001].effect_id, 5, "the sleep applier's byte");
  assert.equal(on[9001].effect, "sleep", "the ailment the walker's tryInflict reads");
  assert.equal(on[9001].effect_power, 96);
  const off = mergeFusionSkills(base, built.skills, false);
  assert.equal(off[9001], undefined, "with the toggle off the new skill does not exist");
  assert.deepEqual(off, base, "and the map is the same one it was handed");
});

test("the last body of a two-member party fuses into the authored boss", () => {
  const party = [
    { name: "Kimeramon", level: 44, hp: 1176 },
    { name: "Machinedramon", level: 47, hp: 1248, fuseInto: boss },
  ];
  assert.deepEqual(fusionOnDefeat({ party, partyIndex: 1, fxOn: true }),
    { fuse: true, hp: 2424, boss });
  assert.equal(fusionOnDefeat({ party, partyIndex: 1, fxOn: false }).fuse, false,
    "the toggle off refuses the fusion");
  assert.equal(fusionOnDefeat({ party, partyIndex: 0, fxOn: true }).fuse, false,
    "a fallen first half never fuses");
  assert.equal(fusionOnDefeat({ party: [party[0]], partyIndex: 0, fxOn: true }).fuse, false,
    "a body with no fuseInto never fuses");
});

test("a three-member party: only the last member can fuse", () => {
  const party = [
    { name: "Kimeramon", level: 44, hp: 1176 },
    { name: "Machinedramon", level: 47, hp: 1248 },
    { name: "Millenniummon", level: 50, hp: 2424, fuseInto: boss },
  ];
  assert.equal(fusionOnDefeat({ party, partyIndex: 0, fxOn: true }).fuse, false);
  assert.equal(fusionOnDefeat({ party, partyIndex: 1, fxOn: true }).fuse, false,
    "a middle body never fuses");
  assert.equal(fusionOnDefeat({ party, partyIndex: 2, fxOn: true }).fuse, true);
});

test("a fuseInto id resolves through the built boss table", () => {
  const party = [{ name: "Kimeramon" }, { name: "Machinedramon", fuseInto: "millenniummon" }];
  const got = fusionOnDefeat({ party, partyIndex: 1, fxOn: true, bosses: built.bosses });
  assert.equal(got.fuse, true);
  assert.equal(got.hp, 2424);
  assert.equal(got.boss.displayName, "Millenniummon");
});

test("party entries keep the authored fields and ordinary entries come back untouched", () => {
  const ordinary = { name: "Kunemon", level: 3, hp: 90, mp: 20, stat_scale: 16 };
  const authored = {
    name: "Machinedramon", level: 47, hp: 1248, mp: 9999, stat_scale: 16,
    displayName: "Millenniummon", fuseInto: boss,
  };
  const out = partyEntriesFor([ordinary, authored]);
  assert.equal(out[0], ordinary, "an ordinary entry is the same object it was handed");
  assert.notEqual(out[1], authored, "an authored entry is copied, never mutated");
  assert.equal(out[1].displayName, "Millenniummon");
  assert.equal(out[1].fuseInto, boss);
  assert.equal(out[1].hp, 1248, "the encounter fields survive the copy");
  const off = partyEntriesFor([authored], false);
  assert.equal(off[0].fuseInto, undefined, "with the toggle off no entry carries fuseInto");
  assert.equal(off[0].displayName, undefined);
  assert.equal(off[0].name, "Machinedramon", "the rest of the entry survives");
});

test("the plate says Millenniummon, not the body species", () => {
  const labels = battleHudPlateLabels({ enemyName: "Millenniummon" });
  assert.equal(labels.enemy.text, "Millenniummon");
  // The live record is still the body species (Kimeramon) — the display name is the only
  // thing that says Millenniummon, and the plate adapter must read it.
  const fused = {
    displayName: "Millenniummon",
    eStats: { enemy_id: "Kimeramon", digimon_id: "Kimeramon" },
    profile: { name: "Kimeramon" },
  };
  assert.equal(enemyDisplayName(fused), "Millenniummon");
  assert.equal(enemyDisplayName({ eStats: { digimon_id: "Kimeramon" } }), "Kimeramon",
    "a record with no display name keeps its species name");
  const plate = battleHudPlateLabelsFor({
    enemy: fused, playerRoster: [{ name: "Kotemon" }], activePlayerIndex: 0, enemySlot: 0,
  });
  assert.equal(plate.enemy.text, "Millenniummon");
});

test("a fighter's tint is per side and defaults to the untinted colour", () => {
  const purple = [0.62, 0.42, 0.85, 1];
  assert.deepEqual(setFighterTint("enemy", purple), purple);
  assert.deepEqual(fighterTint("enemy"), purple);
  assert.deepEqual(fighterTint("player"), FIGHTER_TINT, "the player keeps the game's own tint");
  assert.deepEqual(setFighterTint("enemy", null), FIGHTER_TINT, "clearing restores the default");
  assert.deepEqual(fighterTint("enemy"), FIGHTER_TINT);
});
