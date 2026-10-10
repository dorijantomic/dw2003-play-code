// Every species the disc can put in a fight must resolve, through the loader's
// own path, to a model folder that exists and can render.
//
// The battle screen resolves a fighter's model by NAME through
// web/battle3d.js `resolveModelFolder` -> `assets/battle/model_map.json`
// (web/battle3d.js:3922-3931), and only sets the fighter when it gets a folder
// back (web/battle.js:2937-2939: `if (eFolder) renderer3d.setEnemyDigimon(...)`).
// A species missing from that table therefore NEVER APPEARS — the fighter is
// silently skipped. Tapirmon and Triceramon were the reported cases.
//
// The disc SHIPS these models and they are already extracted. The model folder's
// numeric prefix is the species' enemy id (~/ddw3/rust/types/src/enemy_id.rs),
// and the folder mnemonic corroborates it: Triceramon = 0xcb = 203 -> m203trcr,
// Tapirmon (Bakumon) = 0xce = 206 -> m206baku, Apemon (Hanumon) = 0xcf = 207 ->
// m207hanu, Crabmon (Ganimon) = 0xc5 = 197 -> m197gani. So this is a MAPPING gap,
// not a missing asset.
//
// This test drives the real loader for every enemy name in the shipped battle
// data and requires a real, renderable folder.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const MAP_PATH = resolve(ROOT, "web/assets/battle/model_map.json");

// `resolveModelFolder` fetches the map; serve it from disk for the test.
const MAP_JSON = readFileSync(MAP_PATH, "utf8");
globalThis.fetch = async (url) => {
  if (String(url).includes("model_map.json")) {
    return { ok: true, json: async () => JSON.parse(MAP_JSON) };
  }
  return { ok: false, json: async () => null };
};

const { resolveModelFolder } = await import("../web/battle3d.js");

const readJSON = (p) => JSON.parse(readFileSync(resolve(ROOT, p), "utf8"));

// Every species name that can appear as a combatant, from the shipped tables.
function combatantNames() {
  const names = new Set();
  for (const e of readJSON("web/assets/data/enemies.json").enemies) {
    for (const k of ["digimon_id", "enemy_id"]) {
      const v = e[k];
      if (typeof v === "string" && v !== "None" && v !== "Null") names.add(v);
    }
  }
  const fe = readJSON("web/assets/data/field_encounters.json");
  for (const arr of Object.values(fe.screens ?? {})) {
    for (const e of arr) if (e && typeof e.name === "string") names.add(e.name);
  }
  const walk = (o) => {
    if (Array.isArray(o)) return o.forEach(walk);
    if (o && typeof o === "object") {
      for (const [k, v] of Object.entries(o)) {
        if (["digimon_id", "enemy_id", "name"].includes(k) && typeof v === "string") names.add(v);
        walk(v);
      }
    }
  };
  walk(readJSON("web/assets/data/scripted_battles.json"));
  for (const n of ["None", "Null"]) names.delete(n);
  // Player species, resolved from digimon.json.
  for (const d of readJSON("web/assets/data/digimon.json").digimon) names.add(d.name);
  return [...names];
}

function renderable(folder) {
  return existsSync(resolve(ROOT, `web/assets/battle/models/${folder}/anim.json`))
      && existsSync(resolve(ROOT, `web/assets/battle/textures/${folder}.png`));
}

test("the reported species resolve to their own disc model folders", async () => {
  assert.equal(await resolveModelFolder("Tapirmon"), "m206baku");
  assert.equal(await resolveModelFolder("Triceramon"), "m203trcr");
  assert.equal(await resolveModelFolder("Triceramon2"), "m402trc2");
});

test("every combatant species resolves to an extracted, renderable model", async () => {
  const unresolved = [];
  const unrenderable = [];
  for (const name of combatantNames()) {
    const folder = await resolveModelFolder(name);
    if (!folder) { unresolved.push(name); continue; }
    if (!renderable(folder)) unrenderable.push(`${name} -> ${folder}`);
  }
  assert.deepEqual(unresolved, [], "species with no model mapping (invisible in battle)");
  assert.deepEqual(unrenderable, [], "mapped folders missing geometry/texture");
});
