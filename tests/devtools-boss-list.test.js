// Dev toolset "Bosses & tamers" list (web/devtools-bosslist.js): one row per scripted
// screen with its FULL party, names only from data, and the start call passes lead:false.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildBossList, scriptedScreensByStage, speakersOf, esdmgStagesNeeded, filterBossList, startBossBattle, UNKNOWN,
} from "../web/devtools-bosslist.js";

const slots = (...s) => ({ slots: [...s, ...Array(8 - s.length).fill(0)], rate_level: 0 });
const stageEnc = { stages: {
  // single group: blocks 0..2 wild, block 3 scripted
  "200": { zones: [slots(), slots(10, 10), slots(), slots(200, 300)] },
  // multi group: two groups pick block 3 of different zone indexes; 200 repeats here
  "205": { groups: [{ blocks: [0, 1, 2, 3] }, { blocks: [4, 5, 6, 7] }],
    zones: [slots(10), slots(), slots(), slots(263), slots(), slots(), slots(), slots(200, 400)] },
} };
const fieldEnc = { screens: {
  "10": [{ name: "Wild", level: 3 }],
  "200": [{ name: "Kuwagamon", level: 1 }],
  "263": [{ name: "Triceramon", level: 30 }, { name: "Gabumon", level: 31 }],
  "300": [{ name: "Aaa", level: 5 }, { name: "Bbb", level: 6 }, { name: "Ccc", level: 7 }],
  "400": [{ name: "Ddd", level: 9 }],
} };
const scripted = {
  s200: { events: [{ flag_key: "k1", esdmg_stage: "200", esdmg_entry: 0 }],
    battle_candidates: [{ preFlagKey: "k1", screenId: 200, screenIdHint: null }] },
  s205: { events: [{ flag_key: "k2", esdmg_stage: "200", esdmg_entry: 1 }],
    battle_candidates: [{ preFlagKey: "k2", screenId: null, screenIdHint: 263 }] },
  s300: { events: [{ flag_key: "k3", esdmg_stage: "200", esdmg_entry: 2 }],
    battle_candidates: [{ preFlagKey: "k3", screenId: 300, screenIdHint: null }] },
};
const esdmgByStage = { "200": {
  0: { strings: ["[name]Tamer Genji[name]Ho ho.", "[name][player_name][name]Yeah!", "[name]Tamer Genji[name]Fight."] },
  1: { strings: ["[name]Keith[name]Hi", "[name]Mystery Player[name]Hm"] },
  2: { strings: ["[name][player_name][name]Huh?"] },
} };
const manifestMaps = [{ id: "s200", name: "Asuka City" }, { id: "s205", name: "Asuka Bridge" }];
const rows = buildBossList({ stageEnc, fieldEnc, scripted, esdmgByStage, manifestMaps });
const byId = (id) => rows.find((r) => r.screenId === id);

test("one row per scripted screen (block 3 of every group), wild-only screens left out", () => {
  assert.deepEqual(rows.map((r) => r.screenId), [200, 263, 300, 400]);
  assert.equal(rows.find((r) => r.screenId === 10), undefined);
  assert.deepEqual(scriptedScreensByStage(stageEnc).get(200), ["200", "205"]);
});

test("each row carries the FULL party in order with levels", () => {
  assert.deepEqual(byId(300).party, [{ name: "Aaa", level: 5 }, { name: "Bbb", level: 6 }, { name: "Ccc", level: 7 }]);
  assert.equal(byId(263).party.length, 2);
});

test("places come from the stages the screen sits in, named from the manifest", () => {
  assert.deepEqual(byId(200).places, [{ mapId: "s200", mapName: "Asuka City" }, { mapId: "s205", mapName: "Asuka Bridge" }]);
});

test("opponent name only when data holds exactly one non-player speaker; else unknown", () => {
  assert.equal(byId(200).opponent, "Tamer Genji");
  assert.equal(byId(200).hasName, true);
  assert.equal(byId(263).opponent, UNKNOWN);            // two speakers: not guessed
  assert.deepEqual(byId(263).speakers, ["Keith", "Mystery Player"]);
  assert.equal(byId(300).opponent, UNKNOWN);            // only the player speaks
  assert.equal(byId(400).opponent, UNKNOWN);            // no candidate at all
  assert.deepEqual(speakersOf({ strings: ["[name][player_name][name]x"] }), []);
});

test("esdmg files needed are exactly those the candidates point at", () => {
  assert.deepEqual(esdmgStagesNeeded(scripted), ["200"]);
});

test("search matches opponent, place, Digimon, level and screen id; all words must hit", () => {
  assert.deepEqual(filterBossList(rows, "genji").map((r) => r.screenId), [200]);
  assert.deepEqual(filterBossList(rows, "bridge").map((r) => r.screenId), [200, 263, 400]);
  assert.deepEqual(filterBossList(rows, "gabumon").map((r) => r.screenId), [263]);
  assert.deepEqual(filterBossList(rows, "screen 300").map((r) => r.screenId), [300]);
  assert.deepEqual(filterBossList(rows, "bridge kuwagamon").map((r) => r.screenId), [200]);
  assert.equal(filterBossList(rows, "").length, rows.length);
});

test("start passes the screen id and lead:false (whole party) with the current map", () => {
  const calls = [];
  const dev = { startScreenBattle: (id, opts) => { calls.push([id, opts]); return true; } };
  assert.equal(startBossBattle(dev, byId(263), "s205"), true);
  assert.deepEqual(calls, [[263, { mapId: "s205", lead: false }]]);
});

test("wiring: the page uses startBossBattle and game.js forwards lead to startScreen", () => {
  const dt = readFileSync("web/devtools.js", "utf8");
  assert.match(dt, /startBossBattle\(win\(\)\.__dev, r,/);
  const game = readFileSync("web/game.js", "utf8");
  assert.match(game, /startScreenBattle: \(screenId, opts = \{\}\) => battle\.startScreen\([\s\S]{0,260}lead: opts\.lead \?\? true/);
});

test("real data (when the assets are present): every scripted screen has a row with its whole party", { skip: !hasAssets() }, () => {
  const d = (f) => JSON.parse(readFileSync(`web/assets/data/${f}`, "utf8"));
  const se = d("stage_encounters.json"), fe = d("field_encounters.json"), sb = d("scripted_battles.json");
  const es = {};
  for (const n of esdmgStagesNeeded(sb)) es[n] = JSON.parse(readFileSync(`web/assets/events/esdmg${n}.json`, "utf8"));
  const real = buildBossList({ stageEnc: se, fieldEnc: fe, scripted: sb, esdmgByStage: es,
    manifestMaps: JSON.parse(readFileSync("web/assets/manifest.json", "utf8")).maps });
  assert.equal(real.length, scriptedScreensByStage(se).size);
  for (const r of real) assert.equal(r.party.length, fe.screens[String(r.screenId)].length);
});

function hasAssets() {
  try { readFileSync("web/assets/data/stage_encounters.json"); return true; } catch { return false; }
}
