// CAN THIS BODY PLAY ITS KIT? — every obtainable species, every technique slot, labelled the way the
// shipped renderer really plays it.
//
// A technique row carries one `clip` (web/assets/data/fight_tech_table.json, the disc's 18 action
// slots). The renderer resolves that clip in three ways (web/fight/clip-fallback.js):
//
//   OWN     the model's own pack authors the clip (anim.json clips[].present);
//   BORROW  the model lacks it and web/fight/anim-donor-map.js names a donor body and its tables;
//   BUILT   neither: the runtime constructs the presentation from the model's own tables.
//
// Borrowing is the design of the shipped renderer (199 models / 336 donor rows), so a borrow is never
// a fault. Only four things in the shipped data would make a technique unplayable:
//
//   * a species with no model folder (no model_map row, or a folder outside models/index.json);
//   * a technique id that is not in fight_tech_table.json;
//   * a clip outside the disc's 0..17 slots (a technique row or a present-clip list);
//   * a donor folder named by the donor map that is not in the model index.
//
// The kit is the species' own profile: its basic attack, its signature, and the six ledger slots
// (web/form-tech-slots.js — five ordinary techniques then the signature at slot 5). The signature is
// therefore named twice — once as the `tech_signature` field, once as slot 5 — and a few extra
// species repeat a learned move inside `techs`; `kitTechIds` drops every repeated id, because one
// technique has one clip however many slots point at it.
//
// The three display names that differ from their model_map key ("BK War Greymon",
// "Imperialdramon-F", "Imperialdramon-P") resolve through the same alias the battle and the animation
// viewer use (web/anim-viewer-data.js canonicalName). Without it those three read as folder-less and
// their 8 slot entries each (24 in all) would be counted as BUILT; with it they own their kits.
//
// Pure: no fs, no fetch, no DOM. The caller supplies the tables it read (tools/check_playability.mjs
// does the reading for Node; the battle and the labs can pass what they already hold).
import { canonicalName } from "../anim-viewer-data.js";

export const CLIP_MIN = 0;
export const CLIP_MAX = 17;

export const KIND = { OWN: "own", BORROW: "borrow", BUILT: "built" };

/** The model folder a species name resolves to (through the three display-name aliases), or null. */
export function modelFolderFor(species, modelMap) {
  const name = typeof species === "string" ? species : species?.name;
  if (!name || !modelMap) return null;
  return modelMap[canonicalName(name)] ?? null;
}

/**
 * The technique ids of one species' kit, in profile order: basic, signature, then the six ledger
 * slots (five ordinary + the signature again). `dedupe` drops every repeated id — the same technique
 * has the same clip, so it is one row.
 */
export function kitTechIds(species, dedupe = true) {
  const ids = [];
  const add = (t) => {
    const n = Number(t);
    if (Number.isInteger(n) && n > 0) ids.push(n);
  };
  add(species?.tech_basic);
  add(species?.tech_signature);
  for (const t of species?.tech_slots ?? []) add(t);
  return dedupe ? [...new Set(ids)] : ids;
}

/** A folder's present-clip indices as a Set (an array from anim.json, or a Set from a caller). */
export function presentClips(present, folder) {
  const v = folder ? present?.[folder] : null;
  if (!v) return new Set();
  return v instanceof Set ? v : new Set(v);
}

/** The donor row for (folder, clip) from a lookup function (donorRow) or a plain table, or null. */
export function donorOf(donors, folder, clip) {
  if (!donors || !folder || !Number.isInteger(clip)) return null;
  let row = null;
  try {
    row = typeof donors === "function" ? donors(folder, clip) : donors?.[folder]?.[clip];
  } catch {
    row = null;
  }
  return row || null;
}

/** True when `folder` is in the model index; true when no index is given (the check is skipped). */
function inIndex(modelIndex, folder) {
  if (!modelIndex) return true;
  if (modelIndex instanceof Set) return modelIndex.has(folder);
  if (Array.isArray(modelIndex)) return modelIndex.includes(folder);
  return true;
}

/**
 * One species' kit rows and counts.
 *   playability(species, modelMap, present, donors, techTable)
 *     -> { rows: [{techId, clip, kind, donor}], counts: {own, borrow, built} }
 * `present` is { folder: [indices] } (anim.json clips[].present), `donors` a lookup as above.
 */
export function playability(species, modelMap, present, donors, techTable) {
  const folder = modelFolderFor(species, modelMap);
  const here = presentClips(present, folder);
  const rows = [];
  const counts = { [KIND.OWN]: 0, [KIND.BORROW]: 0, [KIND.BUILT]: 0 };
  for (const techId of kitTechIds(species)) {
    const row = techTable?.[techId] ?? null;
    const clip = row && Number.isInteger(Number(row.clip)) ? Number(row.clip) : null;
    let kind = KIND.BUILT;
    let donor = null;
    if (clip !== null && clip >= CLIP_MIN && clip <= CLIP_MAX && here.has(clip)) {
      kind = KIND.OWN;
    } else {
      const borrow = donorOf(donors, folder, clip);
      if (borrow) { kind = KIND.BORROW; donor = borrow.d ?? null; }
    }
    counts[kind]++;
    rows.push({ techId, clip, kind, donor });
  }
  return { rows, counts };
}

/**
 * The four genuine data faults, nothing else. A borrow is not one: the donor map is the renderer's
 * design. Each entry names what a fixer needs:
 *   { kind: "model-folder", species, folder }            no model_map row, or folder not in index
 *   { kind: "unknown-tech", species, techId }            technique id not in fight_tech_table.json
 *   { kind: "clip-range", species, techId, clip }        a technique row's clip outside 0..17
 *   { kind: "clip-range", species, folder, clip }        a present-clip index outside 0..17
 *   { kind: "donor-folder", species, folder, clip, donor } the donor body is not in the model index
 */
export function faults(speciesList, modelMap, present, donors, techTable, modelIndex = null) {
  const out = [];
  for (const species of speciesList ?? []) {
    const name = species?.name ?? String(species);
    const folder = modelFolderFor(species, modelMap);
    if (!folder) {
      out.push({ kind: "model-folder", species: name, folder: null, why: "no model_map row" });
      continue;
    }
    if (!inIndex(modelIndex, folder)) {
      out.push({ kind: "model-folder", species: name, folder });
      continue;
    }
    const here = presentClips(present, folder);
    for (const clip of here) {
      if (!Number.isInteger(clip) || clip < CLIP_MIN || clip > CLIP_MAX) {
        out.push({ kind: "clip-range", species: name, folder, clip });
      }
    }
    for (const techId of kitTechIds(species)) {
      const row = techTable?.[techId];
      if (!row) {
        out.push({ kind: "unknown-tech", species: name, techId });
        continue;
      }
      const clip = Number(row.clip);
      if (!Number.isInteger(clip) || clip < CLIP_MIN || clip > CLIP_MAX) {
        out.push({ kind: "clip-range", species: name, techId, clip: row.clip });
        continue;
      }
      if (here.has(clip)) continue;
      const borrow = donorOf(donors, folder, clip);
      if (borrow?.d && !inIndex(modelIndex, borrow.d)) {
        out.push({ kind: "donor-folder", species: name, folder, clip, donor: borrow.d });
      }
    }
  }
  return out;
}

/**
 * Every species at once: `{species, pairs, own, borrow, built, faults, builtRows}`.
 * `pairs` is after the per-species dedupe (one row per technique id); `builtRows` carries the rows
 * the runtime would have to construct, so a checker can print them.
 */
export function playabilityCensus(speciesList, modelMap, present, donors, techTable, modelIndex = null) {
  const census = { species: speciesList?.length ?? 0, pairs: 0, own: 0, borrow: 0, built: 0, faults: [], builtRows: [] };
  for (const species of speciesList ?? []) {
    const { rows } = playability(species, modelMap, present, donors, techTable);
    for (const row of rows) {
      census.pairs++;
      census[row.kind]++;
      if (row.kind === KIND.BUILT) census.builtRows.push({ species: species?.name ?? null, ...row });
    }
  }
  census.faults = faults(speciesList, modelMap, present, donors, techTable, modelIndex);
  return census;
}

/** The display names the model map does not carry: [{name, key, folder}] — the alias audit. */
export function displayAliases(speciesList, modelMap) {
  const out = [];
  for (const species of speciesList ?? []) {
    const name = species?.name;
    if (!name || !modelMap || modelMap[name] !== undefined) continue;
    const key = canonicalName(name);
    if (key === name) continue;
    const folder = modelMap[key];
    if (folder) out.push({ name, key, folder });
  }
  return out;
}
