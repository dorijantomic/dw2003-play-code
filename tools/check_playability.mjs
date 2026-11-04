#!/usr/bin/env node
// CAN THIS BODY PLAY ITS KIT? — the build checker for web/fight/playability.js.
//
//   node tools/check_playability.mjs
//
// Prints one screen: the census (species, pairs after dedupe, own / borrow / built, faults), every
// BUILT pair the runtime would have to construct, the display-name alias audit, and each genuine
// data fault. Exit 0 when there is no fault; exit 1 only on a fault (a borrow is never one).
//
// Reads only: digimon.json, extra_species.json, model_map.json, fight_tech_table.json,
// models/index.json, and each species' models/<folder>/anim.json. Writes nothing.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { displayAliases, kitTechIds, modelFolderFor, playabilityCensus } from "../web/fight/playability.js";
import { donorRow } from "../web/fight/anim-donor-map.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const readJson = (root, rel) => JSON.parse(fs.readFileSync(path.join(root, rel), "utf8"));

/** Load the six shipped tables and the present-clip list of every species' own model pack. */
export function loadPlayabilityData(root = ROOT) {
  const speciesList = [
    ...readJson(root, "web/assets/data/digimon.json").digimon,
    ...readJson(root, "web/assets/data/extra_species.json").digimon,
  ];
  const modelMap = readJson(root, "web/assets/battle/model_map.json");
  const techTable = readJson(root, "web/assets/data/fight_tech_table.json");
  const modelIndex = new Set(readJson(root, "web/assets/battle/models/index.json"));
  const present = {};
  for (const species of speciesList) {
    const folder = modelFolderFor(species, modelMap);
    if (!folder || folder in present) continue;
    const file = path.join(root, "web/assets/battle/models", folder, "anim.json");
    if (!fs.existsSync(file)) continue;
    present[folder] = JSON.parse(fs.readFileSync(file, "utf8")).clips.filter((c) => c.present).map((c) => c.index);
  }
  return { speciesList, modelMap, present, techTable, modelIndex };
}

/**
 * Run the census over `data` (a bundle as above) and print it through `log`.
 * Returns the exit code: 0 when there is no fault, 1 otherwise. Never writes.
 */
export function checkPlayability({ data, donors = donorRow, log = console.log } = {}) {
  const d = data ?? loadPlayabilityData();
  const census = playabilityCensus(d.speciesList, d.modelMap, d.present, donors, d.techTable, d.modelIndex);
  const slots = d.speciesList.reduce((n, s) => n + kitTechIds(s, false).length, 0);
  log(`playability: ${census.species} species, ${census.pairs} pairs after dedupe (${slots} slot entries before it), `
    + `${census.own} own / ${census.borrow} borrow / ${census.built} built, ${census.faults.length} faults`);
  for (const row of census.builtRows) {
    log(`  built  ${row.species} tech ${row.techId} clip ${row.clip}${row.donor ? ` donor ${row.donor}` : ""}`);
  }
  const aliases = displayAliases(d.speciesList, d.modelMap);
  if (aliases.length) {
    const entries = aliases.reduce((n, a) => {
      const species = d.speciesList.find((s) => s.name === a.name);
      return n + kitTechIds(species, false).length;
    }, 0);
    log(`alias: ${aliases.length} display names resolve through model_map `
      + `(${aliases.map((a) => `${a.name} -> ${a.folder}`).join(", ")}); their ${entries} slot entries are `
      + `own/borrow here — without the alias they would read as ${entries} built rows`);
  }
  for (const f of census.faults) {
    const where = f.donor ? `${f.folder ?? ""} -> ${f.donor}` : (f.folder ?? "");
    const what = f.techId != null ? `tech ${f.techId}` : (f.clip != null ? `clip ${f.clip}` : "model folder");
    log(`FAULT ${f.kind}: ${f.species} ${what}${where ? ` (${where})` : ""}${f.why ? ` — ${f.why}` : ""}`);
  }
  return census.faults.length ? 1 : 0;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) process.exitCode = checkPlayability();
