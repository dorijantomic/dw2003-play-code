// Playability — can this body play its kit? (card t_b3f30a77)
//
// The renderer plays every technique slot one of three ways: the model authors the clip (OWN), the
// model lacks it but the donor map names a donor body (BORROW), or nothing covers it and the runtime
// constructs one (BUILT, web/fight/clip-fallback.js). Borrowing is the design of the shipped renderer,
// so it is never a fault.
//
// These tests pin:
//   * the shipped census — 190 species, 1,295 kit slot entries before dedupe, 1,059 (species,
//     technique) pairs after the repeated ids are dropped, and 0 BUILT once the three display names
//     resolve through the model_map alias (the alias is also why a raw name lookup would report 24);
//   * the three named species (Agumon 2 rows both own; Kunemon's six, five borrowed from two donors;
//     ExVeemon all own);
//   * the four genuine data faults and nothing else (missing model folder, unknown technique id,
//     clip outside 0..17, donor folder outside the model index);
//   * purity — the module has no fs/fetch/DOM and the CLI writes nothing.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import {
  CLIP_MAX, CLIP_MIN, faults, kitTechIds, modelFolderFor, playability, playabilityCensus,
} from "../web/fight/playability.js";
import { donorRow } from "../web/fight/anim-donor-map.js";
import { checkPlayability } from "../tools/check_playability.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const MODELS = path.join(ROOT, "web/assets/battle/models");
const HAVE_PACKS = fs.existsSync(path.join(MODELS, "m003agum/anim.json"));
const skip = HAVE_PACKS ? false : "model packs are not installed";
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8"));

let DATA = null;
/** The shipped tables, plus only the anim.json files the 190 species map to. */
function data() {
  if (DATA) return DATA;
  const speciesList = [
    ...readJson("web/assets/data/digimon.json").digimon,
    ...readJson("web/assets/data/extra_species.json").digimon,
  ];
  const modelMap = readJson("web/assets/battle/model_map.json");
  const techTable = readJson("web/assets/data/fight_tech_table.json");
  const modelIndex = new Set(readJson("web/assets/battle/models/index.json"));
  const present = {};
  for (const s of speciesList) {
    const folder = modelFolderFor(s, modelMap);
    if (!folder || folder in present) continue;
    const file = path.join(MODELS, folder, "anim.json");
    if (!fs.existsSync(file)) continue;
    present[folder] = JSON.parse(fs.readFileSync(file, "utf8")).clips.filter((c) => c.present).map((c) => c.index);
  }
  DATA = { speciesList, modelMap, present, techTable, modelIndex };
  return DATA;
}
const species = (name) => data().speciesList.find((s) => s.name === name);
const rowsFor = (name) => playability(species(name), data().modelMap, data().present, donorRow, data().techTable).rows;

test("the shipped kit: 190 species, 1,295 slot entries, 1,059 pairs after dedupe, 0 built, 0 faults", { skip }, () => {
  const d = data();
  // The card's 1,295 is the kit BEFORE the dedupe: the profile names the signature twice (the pair
  // and slot 5), and 49 extra species also repeat a learned move inside `techs`.
  const slots = d.speciesList.reduce((n, s) => n + kitTechIds(s, false).length, 0);
  assert.equal(slots, 1295, "the six slots plus the basic/signature pair");
  const c = playabilityCensus(d.speciesList, d.modelMap, d.present, donorRow, d.techTable, d.modelIndex);
  assert.equal(c.species, 190, "55 partner species + 135 made playable");
  assert.equal(c.pairs, 1059, "the repeated technique ids are dropped once per species");
  assert.equal(c.own, 595);
  assert.equal(c.borrow, 464);
  assert.equal(c.built, 0, "no shipped kit row is left to the runtime builder");
  assert.equal(c.own + c.borrow + c.built, c.pairs);
  assert.deepEqual(c.faults, []);
  assert.equal(CLIP_MIN, 0);
  assert.equal(CLIP_MAX, 17);
});

test("Agumon's two rows are own; Kunemon borrows clips 9 and 10; ExVeemon owns every clip", { skip }, () => {
  assert.deepEqual(rowsFor("Agumon"), [
    { techId: 4, clip: 5, kind: "own", donor: null },
    { techId: 56, clip: 11, kind: "own", donor: null },
  ], "the signature repeat is dropped: 2 rows, both own");
  assert.deepEqual(rowsFor("Kunemon").map((r) => [r.techId, r.clip, r.kind]), [
    [220, 5, "own"],
    [157, 9, "borrow"], [156, 9, "borrow"],
    [198, 10, "borrow"], [200, 10, "borrow"], [202, 10, "borrow"],
  ], "Kunemon authors only clips 0-5; its casts and item poses take the donor rows");
  assert.deepEqual(rowsFor("Kunemon").filter((r) => r.kind === "borrow").map((r) => r.donor),
    ["m245infr", "m245infr", "m260stng", "m260stng", "m260stng"]);
  const ex = rowsFor("ExVeemon");
  assert.equal(ex.length, 6);
  assert.ok(ex.every((r) => r.kind === "own"), "every ExVeemon row is own");
});

test("the three display names resolve through the model_map alias (the naive count calls their 24 slots built)", { skip }, () => {
  const d = data();
  const alias = [["BK WarGreymon", "m267bkwg"], ["Imperialdramon-F", "m359ipdf"], ["Imperialdramon-P", "m381ipdp"]];
  let slots = 0;
  for (const [name, folder] of alias) {
    assert.equal(d.modelMap[name], undefined, `${name} is not a model_map key`);
    assert.equal(modelFolderFor(name, d.modelMap), folder, "the alias resolves it to its real pack");
    assert.ok(rowsFor(name).every((r) => r.kind === "own"), `${name} owns its kit on ${folder}`);
    slots += kitTechIds(species(name), false).length;
  }
  assert.equal(slots, 24, "8 raw slot entries each — the card's 24 built rows");
});

test("the four genuine data faults are named and the checker exits 1; a borrow is never a fault", () => {
  const techTable = { 1: { clip: 5 }, 2: { clip: 11 }, 3: { clip: 18 }, 4: { clip: 9 }, 5: { clip: 10 } };
  const speciesList = [
    { name: "Goodmon", tech_basic: 1, tech_signature: 2, tech_slots: [5] },
    { name: "Lostmon", tech_basic: 1, tech_signature: 2, tech_slots: [] },
    { name: "Oddmon", tech_basic: 9999, tech_signature: 2, tech_slots: [] },
    { name: "Wildmon", tech_basic: 3, tech_signature: 2, tech_slots: [] },
    { name: "Thinmon", tech_basic: 4, tech_signature: 2, tech_slots: [] },
    { name: "Borrowmon", tech_basic: 5, tech_signature: 2, tech_slots: [] },
  ];
  const modelMap = {
    Goodmon: "m001good", Lostmon: "m999xxx", Oddmon: "m001good",
    Wildmon: "m001good", Thinmon: "m001good", Borrowmon: "m001good",
  };
  const present = { m001good: [0, 1, 2, 3, 4, 5, 11] };
  const donors = { m001good: { 9: { d: "m998yyy" }, 10: { d: "m002fine" } } };
  const modelIndex = new Set(["m001good", "m002fine"]);
  const data = { speciesList, modelMap, present, techTable, modelIndex };

  const list = faults(speciesList, modelMap, present, donors, techTable, modelIndex);
  assert.deepEqual(list.map((f) => f.kind).sort(), ["clip-range", "donor-folder", "model-folder", "unknown-tech"]);
  const text = JSON.stringify(list);
  for (const named of ["m999xxx", "9999", '"clip":18', "m998yyy"]) assert.ok(text.includes(named), `the fault names ${named}`);

  const out = [];
  const code = checkPlayability({ data, donors, log: (line) => out.push(line) });
  assert.equal(code, 1, "faults make the checker fail");
  const printed = out.join("\n");
  for (const named of ["m999xxx", "9999", "18", "m998yyy"]) assert.ok(printed.includes(named), `the checker prints ${named}`);
  assert.ok(!printed.includes("Goodmon"), "a clean species is not named as a fault");
  assert.ok(!printed.includes("Borrowmon"), "a borrow is never a fault");
});

test("the checker on the shipped data exits 0 and prints one screen", { skip }, () => {
  const r = spawnSync(process.execPath, ["tools/check_playability.mjs"], { cwd: ROOT, encoding: "utf8", timeout: 180_000 });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  const out = r.stdout;
  assert.match(out, /190 species/);
  assert.match(out, /1059 pairs/);
  assert.match(out, /1295/);
  assert.match(out, /0 built/);
  assert.match(out, /0 faults/);
  assert.ok(out.split("\n").filter(Boolean).length <= 12, "one screen");
});

test("the module is pure and the CLI writes nothing", () => {
  const mod = fs.readFileSync(path.join(ROOT, "web/fight/playability.js"), "utf8");
  for (const bad of ["node:fs", "readFile", "fetch(", "document.", "window.", "XMLHttpRequest", "localStorage", "process."]) {
    assert.ok(!mod.includes(bad), `web/fight/playability.js must not use ${bad}`);
  }
  const cli = fs.readFileSync(path.join(ROOT, "tools/check_playability.mjs"), "utf8");
  for (const bad of ["writeFile", "appendFile", "createWriteStream", "mkdir", "rmSync", "unlink"]) {
    assert.ok(!cli.includes(bad), `tools/check_playability.mjs must not write (${bad})`);
  }
});
