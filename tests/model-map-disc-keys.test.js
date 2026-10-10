// The battle model of a boss/variant species must be its OWN disc model, not the
// ordinary one it was aliased onto.
//
// `resolveModelFolder(name)` (web/battle3d.js:3922-3932) is the one place a fight
// picks a model, and it reads web/assets/battle/model_map.json. That table was
// hand-authored and mapped `MasterTyrannomon`, `MetalTyrannomon` and
// `Tyrannomon` all onto `m008tyra`, so both boss variants rendered as the
// ordinary Tyrannomon.
//
// The disc gives each species its own model number (`EnemyId` in
// ~/ddw3/rust/types/src/enemy_id.rs; the smdldata key field matches it —
// docs/research/battle/smdldata-container-2026-08-05.md). The model pack is
// `m<NNN><mnemonic>`. web/assets/battle/model_id_map.json carries that rule and
// tools/build_model_map.py derives model_map.json from it; this test pins the
// reported case and the whole derived family so a hand row cannot creep back.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = resolve(import.meta.dirname, "..");
const readJSON = (p) => JSON.parse(readFileSync(resolve(ROOT, p), "utf8"));

const MAP = readJSON("web/assets/battle/model_map.json");
const ID_MAP = readJSON("web/assets/battle/model_id_map.json");
const FOLDERS = new Set(readJSON("web/assets/battle/models/index.json"));
const PARTNERS = new Set(readJSON("web/assets/data/digimon.json").digimon.map((d) => d.name));

const folderFor = (n) => ID_MAP.modelFolderForNumber[String(n)];
const enemyId = (name) => {
  const key = ID_MAP.aliases?.[name] ?? name;
  return Object.prototype.hasOwnProperty.call(ID_MAP.enemyId, key) ? ID_MAP.enemyId[key] : null;
};

test("the reported boss variants resolve to their own disc models", () => {
  assert.equal(MAP.MasterTyrannomon, "m124tirs",
    "Master Tyrannomon (disc enemy id 0x7c = 124) has its own pack m124tirs");
  assert.equal(MAP.MetalTyrannomon, "m140mtrn",
    "Metal Tyrannomon (disc enemy id 0x8c = 140) has its own pack m140mtrn");
  // Tyrannomon keeps its own pack — the ordinary one is not a fallback for the two.
  assert.equal(MAP.Tyrannomon, "m008tyra");
  assert.notEqual(MAP.MasterTyrannomon, MAP.Tyrannomon);
  assert.notEqual(MAP.MetalTyrannomon, MAP.Tyrannomon);
});

test("every disc enemy species maps to its own model number", () => {
  const wrong = [];
  for (const [name, folder] of Object.entries(MAP)) {
    if (name.endsWith("2") && PARTNERS.has(name.slice(0, -1)) && enemyId(name) === null) {
      // Wild form of a partner ("MetalGreymon2"): enemy_id.rs names it after the partner.
      const want = folderFor(enemyId(name.slice(0, -1)));
      if (want && want !== folder) wrong.push(`${name}: ${folder} (want ${want})`);
      continue;
    }
    const id = enemyId(name);
    if (id === null || PARTNERS.has(name)) continue;
    const want = folderFor(id);
    if (want && want !== folder) wrong.push(`${name}: ${folder} (want ${want}, enemy id ${id})`);
  }
  assert.deepEqual(wrong, [], "species aliased onto another species' model");
});

test("every mapped folder is an extracted, renderable model", () => {
  const missing = [];
  for (const [name, folder] of Object.entries(MAP)) {
    if (!FOLDERS.has(folder)) missing.push(`${name} -> ${folder} (no pack)`);
  }
  assert.deepEqual(missing, []);
});

test("model_map.json matches the species -> model-number rule (no hand rows)", () => {
  // The tool is the single source; a hand edit that the rule would override fails here.
  const py = spawnSync("python3", ["tools/build_model_map.py", "--check"], {
    cwd: ROOT, encoding: "utf8",
  });
  if (py.error && py.error.code === "ENOENT") return; // no python: covered by the tests above
  assert.equal(py.status, 0, `${py.stdout}${py.stderr}`);
});
