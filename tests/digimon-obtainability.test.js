// Every Digimon of the game's 55-row species table can be had by a player, and every
// technique one of them owns has what the 3D fight needs to animate it.
//
// How each species is obtained (all disc data, nothing hand-listed):
//   rows 1-8    the eight rookies   given by the partner NPCs (bank70_partner_grants.json, one per roster slot)
//   rows 9-52   the 44 forms        unlocked on each of the eight lines by the disc's own rule
//                                   (engine/dw3/evo-trees.ts, the port of pro/stfgtrep 0x369C-0x390C)
//   rows 53-55  Agunimon, BladeGarurumon, AncientGreymon: DNA (Jogress) results, models 468-470
//                                   (jogress_scripts.json; the pairs are pinned in lane-b/dna-command.test.js)
//
// The animation half: for each species, each technique it owns resolves to a clip its model
// has, an effect type the effect registry knows, and (for a special attack) its backdrop.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { firstUnlockedTreeRecord } from "../engine/dw3/evo-trees.ts";

const A = "web/assets";
const readJson = (p) => JSON.parse(fs.readFileSync(path.join(A, p), "utf8"));
const D = readJson("data/digimon.json");
const mons = D.digimon;
const evo = readJson("data/evolutions.json");
const grants = readJson("data/bank70_partner_grants.json").grants;
const techs = readJson("data/fight_tech_table.json");
const modelMap = readJson("battle/model_map.json");
const effectTypes = new Set(Object.keys(readJson("battle/effects/manifest.json").types).map(Number));
const backdrops = new Set(fs.readdirSync(path.join(A, "battle/backdrops")));

// battle3d.js spells these two species differently from the model map (battle3d.js:4133)
const MODEL_KEY = { "Imperialdramon-F": "ImperialdramonFM", "Imperialdramon-P": "ImperialdramonPM" };
const modelFolder = (name) => modelMap[MODEL_KEY[name] ?? name] ?? modelMap[name.replace(/ /g, "")];

test("the species table is the 55 rows the trees and DNA refer to", () => {
  assert.equal(mons.length, 55);
  mons.forEach((m, i) => assert.equal(m.id, i + 1));
  assert.equal(evo.lines.length, 8, "one tree per roster slot");
});

test("all eight rookies are given out by the partner NPCs", () => {
  const slots = new Set(grants.map((g) => g.slot));
  assert.deepEqual([...slots].sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6, 7]);
});

test("each of the eight lines can learn all 44 forms, by the disc's rule", () => {
  const got = new Set();
  for (const line of evo.lines) {
    const formLevels = {};
    for (let step = 0; step < 60; step++) {
      // a line that has played long enough: top level, every learned form at its top level, stats beyond any gate
      const hit = firstUnlockedTreeRecord(evo, line.slot, {
        formLevels, level: 99,
        stats: {
          stats: { str: 999, def: 999, spt: 999, wis: 999, spd: 999, chr: 999 },
          elemBonuses: { fire: 999, water: 999, ice: 999, wind: 999, thunder: 999, machine: 999, dark: 999 },
        },
      });
      if (!hit) break;
      formLevels[hit.record.to] = 99;
    }
    const names = Object.keys(formLevels).map((id) => mons[id - 1].name);
    assert.equal(names.length, 44, `${mons[line.digimonId - 1].name}'s line reaches ${names.length} of 44`);
    for (let id = 9; id <= 52; id++) assert.ok(formLevels[id], `${mons[line.digimonId - 1].name} never learns ${mons[id - 1].name}`);
    Object.keys(formLevels).forEach((id) => got.add(+id));
  }
  assert.equal(got.size, 44);
});

test("the three forms no line learns are Jogress results with a model of their own", () => {
  const scripts = readJson("data/jogress_scripts.json").actions;
  const fused = new Set(Object.values(scripts).map((s) => s.fusedModel));
  for (const id of [53, 54, 55]) {
    const name = mons[id - 1].name;
    assert.ok(modelFolder(name), `${name} has a battle model`);
  }
  for (const model of [468, 469, 470]) assert.ok(fused.has(model), `a DNA script produces model ${model}`);
});

// ── the enemy-only Digimon (tools/build_extra_species.py, web/extra-roster.js) ──────────────────────────
const extraPath = path.join(A, "data/extra_species.json");
const haveExtra = fs.existsSync(extraPath);
const extra = haveExtra ? JSON.parse(fs.readFileSync(extraPath, "utf8")) : null;
const donorActions = readJson("battle/models/m005grey/anim.json").actions;
const donorHas = (clip) => !!donorActions[clip]?.ops?.length;
const x = { skip: haveExtra ? false : "extra_species.json is not built (python3 tools/build_extra_species.py)" };

test("every enemy-only Digimon is a form the player can learn", x, async () => {
  const { mergeEvolutions, mergeDigimon } = await import("../web/extra-roster.js");
  const trees = mergeEvolutions(evo, extra);
  const all = mergeDigimon(D, extra).digimon;
  const enemies = readJson("data/enemies.json").enemies.map((e) => e.enemy_id);
  const wanted = new Set(enemies.map((n) => n.replace(/\d+$/, "")).filter((n) => n !== "Null" && !n.startsWith("Cardmon")));
  for (const m of mons) wanted.delete(m.name);
  wanted.delete("BKWarGreymon");               // species 43, already a base form
  const byName = new Map(all.map((m) => [m.name, m]));
  for (const n of wanted) assert.ok(byName.has(n), `${n} is not a player species`);
  assert.equal(all.length, 55 + wanted.size);

  const formLevels = (line) => {
    const have = {};
    for (let step = 0; step < 400; step++) {
      const hit = firstUnlockedTreeRecord(trees, line, {
        formLevels: have, level: 99,
        stats: {
          stats: { str: 9999, def: 9999, spt: 9999, wis: 9999, spd: 9999, chr: 9999 },
          elemBonuses: { fire: 999, water: 999, ice: 999, wind: 999, thunder: 999, machine: 999, dark: 999 },
        },
      });
      if (!hit) break;
      have[hit.record.to] = 99;
    }
    return have;
  };
  for (let line = 0; line < 8; line++) {
    const have = formLevels(line);
    const missing = all.filter((m) => m.id >= 9 && m.id <= 52 || m.id >= 56).filter((m) => !have[m.id]).map((m) => m.name);
    assert.deepEqual(missing, [], `line ${line} (${mons[line].name}) never learns ${missing.join(", ")}`);
  }
});

test("a line that suits a family meets an easier gate than one that does not", x, () => {
  // Kunemon is an insect: Veemon (4) and Monmon (2) are its lines. Its line-level gate is lower there.
  const gate = (line, name) => extra.tree[line].find((r) => r.to === extra.meta[name].id);
  assert.ok(gate(4, "Kunemon").threshold < gate(0, "Kunemon").threshold);
  assert.ok(gate(4, "Okuwamon").req0Level < gate(0, "Okuwamon").req0Level);
  assert.ok(gate(4, "Okuwamon").threshold < gate(0, "Okuwamon").threshold);
});

test("every extra form has a game form id, a model, a name-bank entry and techniques the disc animates", x, () => {
  const profiles = fs.readFileSync(path.join(A, "data/extra_profiles.bin"));
  assert.equal(profiles.length, extra.digimon.length * 0x58);
  const base = fs.readFileSync(path.join(A, "data/digimon_profiles.bin"));
  const taken = new Set();
  for (let i = 0; i < 55; i++) taken.add(base.readUInt16LE(0x58 * i));
  const problems = [];
  extra.digimon.forEach((m, i) => {
    const rec = profiles.subarray(0x58 * i, 0x58 * (i + 1));
    const value0 = rec.readUInt16LE(0);
    if (taken.has(value0)) problems.push(`${m.name}: game form id ${value0} is taken`);
    taken.add(value0);
    if (extra.meta[m.name].value0 !== value0) problems.push(`${m.name}: record and meta disagree`);
    const folder = modelFolder(m.name);
    if (!folder || !fs.existsSync(path.join(A, "battle/models", folder, "anim.json"))) { problems.push(`${m.name}: no model`); return; }
    const anim = readJson(`battle/models/${folder}/anim.json`);
    const clips = new Map(anim.clips.map((c) => [c.index, c]));
    if (rec[0x55] < 58) problems.push(`${m.name}: name bank entry ${rec[0x55]}`);
    for (const id of new Set([...m.techs, ...m.tech_slots].filter(Boolean))) {
      const r = techs[String(id)];
      if (!r) { problems.push(`${m.name}: tech ${id} has no row`); continue; }
      // a clip the model lacks is built from the donor's (web/fight/clip-fallback.js), so the donor must have it
      if (!clips.get(r.clip)?.present && !donorHas(r.clip)) problems.push(`${m.name}: tech ${id} needs clip ${r.clip}, neither it nor the donor has one`);
      if (r.effect && !effectTypes.has(r.effect)) problems.push(`${m.name}: tech ${id} effect ${r.effect}`);
      if (r.sigEffect && !backdrops.has(`meft10${r.sigEffect}`)) problems.push(`${m.name}: tech ${id} backdrop ${r.sigEffect}`);
    }
  });
  assert.deepEqual(problems, []);
});

test("every species has a battle model with an animation file", () => {
  for (const m of mons) {
    const folder = modelFolder(m.name);
    assert.ok(folder, `${m.name} has no model entry`);
    assert.ok(fs.existsSync(path.join(A, "battle/models", folder, "anim.json")), `${m.name}: ${folder}/anim.json missing`);
  }
});

test("every technique a species owns has its clip, its effect and its backdrop", () => {
  const problems = [];
  for (const m of mons) {
    const folder = modelFolder(m.name);
    const anim = readJson(`battle/models/${folder}/anim.json`);
    const clips = new Map(anim.clips.map((c) => [c.index, c]));
    const owned = new Set([...(m.techs ?? []), ...(m.tech_slots ?? []), ...(m.blasts ?? []), m.tech_dna_dv ?? 0]);
    owned.delete(0);
    for (const id of owned) {
      const r = techs[String(id)];
      if (!r) { problems.push(`${m.name}: tech ${id} has no row`); continue; }
      const clip = clips.get(r.clip);
      const script = anim.actions[r.clip];
      if (!clip?.present) problems.push(`${m.name}: tech ${id} needs clip ${r.clip}, the model has none`);
      else if (!script?.ops?.length || script.ops[0].op === 255) problems.push(`${m.name}: tech ${id} clip ${r.clip} has an empty script`);
      if (r.effect && !effectTypes.has(r.effect)) problems.push(`${m.name}: tech ${id} effect ${r.effect} is not in the registry`);
      if (r.sigEffect && !backdrops.has(`meft10${r.sigEffect}`)) problems.push(`${m.name}: tech ${id} backdrop meft10${r.sigEffect} missing`);
    }
  }
  assert.deepEqual(problems, []);
});
