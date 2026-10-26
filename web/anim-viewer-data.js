// Data plumbing for the animation viewer (web/anim-viewer.html) — pure functions, no DOM, so
// node:test can prove the pickers are built from the shipped tables (tests/anim-viewer.test.js).
//
// Sources (all shipped JSON, loaded by the page):
//   assets/data/digimon.json          the 55 original partners ("digimon", "skills")
//   assets/data/extra_species.json    140 enemy-only species made playable (ids 56..195)
//   assets/data/extra_species_canon.json  names/stage hints for those (ids 56..190)
//   assets/battle/model_map.json      species name -> model folder (249 folders)
//   assets/battle/models/index.json   the folder list
//   web/fight/anim-donor-map.js       which clips a model LACKS (gaps) and its donor
//   web/anim-gate.json                the A10 retarget gate's per-pair verdicts
//   web/anim-contract-index.json      the A10 contract's per (folder, clip, side) verdicts
//
// Nothing here is hand-typed per species: every row is assembled from those tables. "Family" is the
// numeric family column the data carries (no name table ships), so the filter shows the numbers the
// data actually has; elements are the elements of the techniques the species owns.

// The 14 technique groups of /home/dorij/scratch-research/tech-groups.md, keyed by the three data
// columns that define them (type, clip, multi-hit), in the doc's own order, labelled in plain words.
export const TECH_GROUPS = [
  { key: "attack|5|1", type: "attack", clip: 5, multi: false, label: "Normal attack" },
  { key: "attack|9|1", type: "attack", clip: 9, multi: false, label: "Spell" },
  { key: "attack|11|1", type: "attack", clip: 11, multi: false, label: "Special / Signature" },
  { key: "attack|6|1", type: "attack", clip: 6, multi: false, label: "Combo" },
  { key: "attack|13|1", type: "attack", clip: 13, multi: false, label: "Volley" },
  { key: "heal|10|1", type: "heal", clip: 10, multi: false, label: "Heal" },
  { key: "support|10|1", type: "support", clip: 10, multi: false, label: "Support" },
  { key: "attack|11|1*", type: "attack", clip: 11, multi: true, label: "Special (multi-hit)" },
  { key: "attack|15|1", type: "attack", clip: 15, multi: false, label: "Thrown special (clip 15)" },
  { key: "attack|5|1*", type: "attack", clip: 5, multi: true, label: "Normal attack (multi-hit)" },
  { key: "attack|16|1", type: "attack", clip: 16, multi: false, label: "Special (clip 16)" },
  { key: "attack|10|1", type: "attack", clip: 10, multi: false, label: "Attack (clip 10)" },
  { key: "attack|8|1*", type: "attack", clip: 8, multi: true, label: "Combo (clip 8)" },
  { key: "support|11|1", type: "support", clip: 11, multi: false, label: "Support (clip 11)" },
];
const GROUP_ORDER = new Map(TECH_GROUPS.map((g, i) => [g.key, i]));

/** The group a skills row belongs to (by (type, clip, multi-hit) — the census' own columns). */
export function techGroup(skill) {
  if (!skill) return null;
  const type = String(skill.type || "attack");
  const clip = skill.clip | 0;
  const multi = (skill.hits | 0) > 1;
  const base = `${type}|${clip}|1`;
  const key = multi ? `${base}*` : base;
  const hit = TECH_GROUPS.find((g) => g.key === key) || TECH_GROUPS.find((g) => g.key === base);
  return hit || { key: `${base}?`, type, clip, multi, label: `Other (${type}, clip ${clip})` };
}

export const groupOrder = (g) => GROUP_ORDER.get(g?.key) ?? 99;

// Three display names differ from their model_map key; the same three that battle3d.js's
// canonicalModelName() rewrites before resolveModelFolder (the pause/report screens print the
// display name). Authored data, no disc content.
export const CANONICAL_NAME = {
  "BK WarGreymon": "BKWarGreymon",
  "Imperialdramon-F": "ImperialdramonFM",
  "Imperialdramon-P": "ImperialdramonPM",
};
export const canonicalName = (name) => CANONICAL_NAME[name] ?? name;

/** Ownership class from the species id, exactly as the data splits it. */
export function ownershipOf(id) {
  if (id <= 55) return "original";
  if (id >= 191) return "new";
  return "enemy";
}

export const OWNERSHIP_LABELS = {
  original: "original player species",
  enemy: "enemy-only species",
  new: "new partner",
  variant: "model variant (no species row)",
};

/**
 * The pickable Digimon. One entry per SPECIES plus one per model folder that has no species row,
 * so every one of the 249 folders is reachable (a viewer for all Digimon may not hide 59 of them).
 */
export function buildModelIndex({ digimon, extraSpecies, extraCanon = null, modelMap, folders, gaps = {} }) {
  const byName = new Map();
  const species = [
    ...(digimon?.digimon || []).map((d) => ({ ...d, _kind: "digimon" })),
    ...(extraSpecies?.digimon || []).map((d) => ({ ...d, _kind: "extra" })),
  ];
  const canon = new Map((extraCanon?.species || []).map((s) => [s.name, s]));
  const meta = extraSpecies?.meta || {};
  for (const s of species) {
    const folder = modelMap[canonicalName(s.name)] || null;
    const m = meta[s.name] || {};
    const c = canon.get(s.name) || {};
    byName.set(s.name, {
      name: s.name,
      folder,
      id: s.id | 0,
      family: s.family ?? m.family ?? null,
      tier: c.tier ?? m.tier ?? null,
      ownership: ownershipOf(s.id | 0),
      techs: Array.isArray(s.techs) ? s.techs.filter((t) => t > 0) : [],
      isStarter: !!(extraSpecies?.starters || []).some((x) => x.name === s.name),
      gaps: folder ? Object.keys(gaps[folder] || {}).map(Number).sort((a, b) => a - b) : [],
      source: s._kind,
    });
  }
  // Folders with no species row (enemy duplicates/variants): the manifest's own folder list, with
  // the name model_map gave it (or the folder code).
  const folderName = new Map(Object.entries(modelMap).map(([name, folder]) => [folder, name]));
  for (const folder of folders || []) {
    const name = folderName.get(folder) || folder;
    if ([...byName.values()].some((e) => e.folder === folder)) continue;
    byName.set(name, {
      name, folder, id: null, family: null, tier: null,
      ownership: "variant", techs: [], isStarter: false,
      gaps: Object.keys(gaps[folder] || {}).map(Number).sort((a, b) => a - b),
      source: "folder",
    });
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Case-insensitive substring search over the name and the folder. */
export function matchesQuery(entry, query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return true;
  return entry.name.toLowerCase().includes(q) || String(entry.folder || "").toLowerCase().includes(q);
}

/** The picker's filter set: family, tier, element, ownership, gaps. */
export function filterModels(list, { query = "", family = "", tier = "", element = "", ownership = "", gaps = "" } = {}) {
  return list.filter((e) => {
    if (!matchesQuery(e, query)) return false;
    if (family !== "" && String(e.family) !== String(family)) return false;
    if (tier !== "" && String(e.tier) !== String(tier)) return false;
    if (ownership && e.ownership !== ownership) return false;
    if (gaps === "yes" && !e.gaps.length) return false;
    if (gaps === "no" && e.gaps.length) return false;
    if (element && !(e.elements || []).includes(element)) return false;
    return true;
  });
}

const CLIP_LABELS = {
  5: "Normal attack", 6: "Combo", 8: "Combo (clip 8)", 9: "Spell", 10: "Clip 10",
  11: "Special / Signature", 13: "Volley", 15: "Thrown special", 16: "Special (clip 16)",
};

/**
 * The actions to offer for one species, grouped like the technique table:
 *   - every technique the species OWNS (its own `techs` rows), with the group, name, hits, element
 *   - the item-use motion (clip 10, the item machine's default arm)
 *   - the reactions the coordinator selects (clip 1 intermediate, 2 survive, 3 death, 4 evade)
 *   - the idle (the model's own idle table)
 * A species with no technique rows (a folder-only variant) still gets reactions + idle.
 */
export function actionsFor(entry, skills) {
  const byId = skills instanceof Map ? skills : new Map((skills || []).map((s) => [s.id | 0, s]));
  const seen = new Set();
  const out = [];
  for (const id of entry?.techs || []) {
    if (seen.has(id)) continue;
    seen.add(id);
    const skill = byId.get(id | 0);
    if (!skill) continue;
    const g = techGroup(skill);
    out.push({
      kind: "tech", techId: id | 0, clip: skill.clip | 0, name: skill.name || `tech ${id}`,
      group: g, label: `${skill.name || `tech ${id}`}`,
      element: skill.element || null, hits: skill.hits | 0 || 1, mp: skill.mp_cost ?? null,
      type: skill.type || "attack",
    });
  }
  out.sort((a, b) => groupOrder(a.group) - groupOrder(b.group) || a.techId - b.techId);
  const reactions = [
    { kind: "reaction", clip: 1, name: "Hit (intermediate combo contact)", group: { key: "reaction|1", label: "Reaction" } },
    { kind: "reaction", clip: 2, name: "Hit / survive", group: { key: "reaction|2", label: "Reaction" } },
    { kind: "reaction", clip: 3, name: "Death", group: { key: "reaction|3", label: "Reaction" } },
    { kind: "reaction", clip: 4, name: "Evade", group: { key: "reaction|4", label: "Reaction" } },
  ];
  return [
    ...out,
    { kind: "item", itemId: 43, clip: 10, name: "Item use (clip 10, self cast)", group: { key: "item|10", label: "Item use" } },
    ...reactions,
    { kind: "idle", clip: 0, name: "Idle", group: { key: "idle|0", label: "Idle" } },
  ];
}

/** Group an action list for rendering: [{group, actions}] in the table's order, reactions last. */
export function groupActions(actions) {
  const buckets = new Map();
  for (const a of actions || []) {
    const key = a.group?.key || "other";
    if (!buckets.has(key)) buckets.set(key, { key, label: a.group?.label || key, actions: [] });
    buckets.get(key).actions.push(a);
  }
  const order = (b) => {
    if (b.key.startsWith("bake|")) return -1;   // K21f: the A/B pair sits above every authored action
    if (b.key.startsWith("dw2|")) return -0.5;  // K25: the DW2 motion pair sits just below the bake pair
    const g = TECH_GROUPS.find((t) => t.key === b.key);
    if (g) return GROUP_ORDER.get(g.key);
    if (b.key === "item|10") return 90;
    if (b.key.startsWith("reaction")) return 91;
    if (b.key === "idle|0") return 92;
    return 95;
  };
  return [...buckets.values()].sort((a, b) => order(a) - order(b));
}

/** Elements a species can show (the elements of its own techniques). */
export function elementsOf(entry, skills) {
  const byId = skills instanceof Map ? skills : new Map((skills || []).map((s) => [s.id | 0, s]));
  const set = new Set();
  for (const id of entry?.techs || []) {
    const s = byId.get(id | 0);
    if (s?.element) set.add(s.element);
  }
  return [...set].sort();
}

/** The gate verdict for (folder, clip) from web/anim-gate.json, compacted. */
export function gateFor(gate, folder, clip) {
  if (!Array.isArray(gate)) return null;
  return gate.find((r) => r.folder === folder && String(r.clip) === String(clip)) || null;
}

/** The contract's per (folder, clip, side) verdict from web/anim-contract-index.json. */
export function contractFor(index, folder, clip, side) {
  const f = index?.byFolder?.[folder];
  if (!f) return null;
  const c = f[String(clip)];
  if (!c) return null;
  return c[side] || c.both || null;
}

/** A one-line, all-data description of the script the animator resolved. */
export function describeScript(script, { folder, clip, donorRow = null, castBake = null } = {}) {
  if (!script) return { kind: "none", text: "no script (the fighter idles)", donor: null };
  const donor = donorRow?.d ?? null;
  const method = donorRow?.m ?? null;
  if (script.selfCast || script.buildKind === "self") {
    return { kind: "self", text: "built: calm SELF cast (no strike, effect on the caster)", donor, method };
  }
  if (castBake) {
    return { kind: "retarget", text: `RETARGETED cast from donor ${castBake.donor || donor || "?"} (gate accepted)`, donor: castBake.donor || donor, method: "retarget" };
  }
  if (script.synthesized) {
    const kind = script.buildKind || "built";
    const plant = kind === "body" || kind === "cast" ? " (own body, planted)" : "";
    return { kind: "built", text: `built by clip-fallback: ${kind}${plant}, donor ${donor || script.donor || "?"}`, donor, method };
  }
  return { kind: "authored", text: "authored (the model's own script)", donor: null, method: "own" };
}

/** Merge a played action's clip with the model's resolved-script facts, for the info panel. */
export function actionIsBuilt(entry, clip, gaps = {}) {
  return !!(entry?.folder && gaps[entry.folder] && gaps[entry.folder][String(clip)]);
}

/** URL query for a case, e.g. ?model=m441raiz&clip=5&side=near&tech=59. */
export function caseQuery({ folder, clip, side = "near", techId = null, defender = null, outcome = "hit" }) {
  const q = new URLSearchParams();
  if (folder) q.set("model", folder);
  if (clip != null) q.set("clip", String(clip));
  if (techId != null) q.set("tech", String(techId));
  if (side) q.set("side", side);
  if (defender) q.set("defender", defender);
  if (outcome && outcome !== "hit") q.set("outcome", outcome);
  return q.toString();
}
