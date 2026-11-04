// web/codex.js — the Digimon Codex, part 1: the book and the partner pages;
// part 2: the wild pages; part 3: the encounter finder.
//
// A paged in-game book of every partner profile the game can hold, and every real
// wild record on the disc. It has no table of its own: each partner row is read from
// the same digimon.json the battle reads, after web/extra-roster.js has merged the
// 135 enemy-only species the project made obtainable, so tonight the partner book
// lists 190 rows and a build with ?noextras=1 lists the disc's 55. The line page's
// list of learnable forms comes from evolutions.json, again after the extra roster's
// merge.
//
// The wild tab has one row per real record in enemies.json — the same table
// web/battle.js fights with — minus the disc's one `Null` placeholder row, so it
// lists 193 enemies, not 194. It never shows the `+0x04` steal factor (that is the
// separate Steal-Factor Bestiary; web/bestiary.js does not exist, so there is no
// link to it).
//
// Row data, all from the profile the battle uses:
//   id, name, added (id > 55), hp, mp, family, is_starter,
//   stats ({str, def, spt, wis, spd, chr} — the six core-stat halfwords),
//   resistances + resistanceGrowth (seven elements), statusResist (five statuses),
//   signature ({id, name, power, element} resolved through skills),
//   blasts (the five target forms' names, resolved through the profile ids),
//   techSlots (six skill ids), learnLevels (six), loadLevels (five).
//
// Wild row data, all from the record the battle reads:
//   number, name, digimonId, family (digimon_type), model (the folder the battle
//   draws it with, from model_map.json), stats ({str, def, spt, wis, spd} — the five
//   the record carries), resists (seven elements), status (five statuses),
//   attack / move1 / move2 ({id, name} resolved through skills; id 0 = no technique),
//   drop + dropRate, and aiRows (the four rows: action + comparator + value, plus
//   the plain-words condition and action; the fourth row is the unconditional
//   fallback — its condition byte is never tested, so it is labelled as such).
//
// The encounter finder (part 3) is the third tab. It has no table of its own either:
// it reads the two the encounter driver reads (web/battle.js / engine/dw3/encounters.ts) —
// stage_encounters.json picks a global screen id from a stage's zone pool, and
// field_encounters.json's `screens` turns that screen id into the 1..3-enemy party —
// plus the manifest's `maps` for each stage's own name. A row is therefore a real roll:
// stage number, stage name, the 1-based geographic zone (each selector group is four
// zones of eight slots; multi-group stages simply carry several groups), the slot,
// the screen id, the species, and the party's level / HP / stat scale, plus the zone
// block's own rate byte. The same party stored twice (screen 5) is kept twice.
//
// The Loadout tab (the fourth) is the fight's backstage: one row per model pack (249 of
// them, from battle/models/index.json), and for the body under the cursor its OWN action
// scripts read by web/fight/body-loadout.js — every authored clip's timeline tables, waits,
// projectile mesh and launch offset, sprite effect types, contact cues and whether it marks
// a strike at all — then the moves of the species that play those clips (real technique
// names, element, mesh, the technique's own effect byte). The two odd-case lines at the
// bottom carry the corpus numbers the Loadout test measures over every pack (one mesh
// serving two elements; authored attack clips with no strike marker). The 249 packs are
// 39.9 MB, so the tab builds its list from index.json and fetches ONE body's anim.json
// when a row is opened (plus the small technique and sound tables once).
//
// The Clips tab (the fifth) is the glossary the game never printed: the developers' own 62
// battle animation names from their hidden scene-test tool (web/fight/clip-names.js), one
// row per animation with its engine clip id, its timeline table, a plain-English gloss and
// how many of the 249 model packs author that table. Its header states the caveat: the tool
// passes its list position + 1 as the engine animation id, and the join against fightstg's
// own selectors (SCENE-Q002) is still needs_evidence. The rows are a typed fact table; no
// anim.json is fetched for this tab.
//
// OFF unless F2 -> Extras -> "Digimon Codex (new)" is switched on (web/ambience.js).
// It opens on that switch's rising edge, owns the pad while it is up (L1/R1 tab,
// Left/Right page, Up/Down row, Cross/Start close; the ENCOUNTERS tab also takes
// single-character keys and Backspace as a name filter) and draws over everything. With
// the switch off nothing exists and the frame loop pays one comparison. The module is
// DOM-free at the top level so node tests import it; drawing takes a canvas context.

import { loadoutReport } from "./fight/body-loadout.js";
import { CLIP_ID_CAVEAT, CLIP_NAMES_62 } from "./fight/clip-names.js";

const DISC_LAST_ID = 55;          // digimon.json ships ids 1..55; extra_species.json starts at 56
const PER_PAGE = 24;              // rows on one book page
const BODY_CACHE_LIMIT = 8;       // Loadout: how many opened anim.json files stay in memory
const ELEMENTS = ["fire", "water", "ice", "wind", "thunder", "machine", "dark"];
const STATUSES = ["poison", "paralyze", "confuse", "sleep", "ko"];
const ELEMENT_LABELS = { fire: "Fire", water: "Water", ice: "Ice", wind: "Wind", thunder: "Thunder", machine: "Machine", dark: "Dark" };
const STATUS_LABELS = { poison: "Poison", paralyze: "Paralyze", confuse: "Confuse", sleep: "Sleep", ko: "KO" };
const WILD_STATS = ["str", "def", "spt", "wis", "spd"];   // the enemy record's five core stats (no CHR)
const TAB_NAMES = ["partners", "wild", "encounters", "loadout", "clips"];
const TAB_LABELS = { partners: "PARTNERS", wild: "WILD", encounters: "ENCOUNTERS", loadout: "LOADOUT", clips: "CLIPS" };

const pick = (source, keys) =>
  Object.fromEntries(keys.map((k) => [k, Number(source?.[k] ?? 0)]));

/**
 * One row per profile in a digimon.json-shaped table (`digimon` rows + `skills`). Pure.
 * `digimon` may be the whole JSON object or just the profile array; `skills` overrides the
 * JSON's own list when given.
 */
export function partnerRows(digimon, skills) {
  const profiles = Array.isArray(digimon) ? digimon : digimon?.digimon ?? [];
  const skillList = Array.isArray(skills) ? skills : Array.isArray(digimon) ? [] : digimon?.skills ?? [];
  const skillById = new Map(skillList.map((s) => [s.id, s]));
  const nameById = new Map(profiles.map((p) => [p.id, p.name]));
  return profiles.map((p) => {
    const skill = skillById.get(p.tech_signature) ?? null;
    return {
      id: p.id,
      name: p.name,
      added: p.id > DISC_LAST_ID,
      hp: p.hp,
      mp: p.mp,
      family: p.family,
      is_starter: !!p.is_starter,
      stats: { str: p.str, def: p.def, spt: p.spt, wis: p.wis, spd: p.spd, chr: p.chr },
      resistances: pick(p.resistances, ELEMENTS),
      resistanceGrowth: pick(p.resistance_growth, ELEMENTS),
      statusResist: pick(p.status_resist, STATUSES),
      signature: skill
        ? { id: skill.id, name: skill.name, power: skill.power, element: skill.element }
        : null,
      // the five Blast forms are profile ids: resolve them through the same profile table
      blasts: (p.blasts ?? [])
        .map((id) => nameById.get(id))
        .filter((name) => typeof name === "string"),
      techSlots: [...(p.tech_slots ?? [])],
      learnLevels: [...(p.tech_learn_levels ?? [])],
      loadLevels: [...(p.tech_load_levels ?? [])],
    };
  });
}

/**
 * The names of one digivolution line's records (evolutions.json's `lines[slot].records`, each
 * record's `to` is a profile id). Pure. An unknown slot is an empty list, never a guess.
 * `profiles` may be the profile array or a digimon.json-shaped object.
 */
export function lineTargets(evolutions, slot, profiles) {
  const list = Array.isArray(profiles) ? profiles : profiles?.digimon ?? [];
  const nameById = new Map(list.map((p) => [p.id, p.name]));
  const line = evolutions?.lines?.[slot];
  if (!line) return [];
  return (line.records ?? [])
    .map((record) => nameById.get(record.to))
    .filter((name) => typeof name === "string");
}

/** Cut the roster into book pages. The last page holds the remainder; no page is ever empty. */
export function codexPages(rows, perPage = PER_PAGE) {
  const size = Math.max(1, Math.floor(Number(perPage)) || PER_PAGE);
  const pages = [];
  for (let i = 0; i < rows.length; i += size) pages.push(rows.slice(i, i + size));
  return pages;
}

// The Clips tab's pages: the 62 animation rows are a fixed fact table, so they are cut once.
const CLIP_PAGES = codexPages(CLIP_NAMES_62, PER_PAGE);

// ---------------------------------------------------------------- wild pages

// The field-element ids the disc stores at 0x800a4530 (engine/dw3/battle-formulas.ts ELEMENT_ID).
const FIELD_ELEMENT_NAMES = { 1: "normal", 2: "Fire", 3: "Water", 4: "Ice", 5: "Wind", 6: "Thunder", 7: "Machine", 8: "Dark" };

/** 1 -> "1st", 2 -> "2nd", 3 -> "3rd", 11 -> "11th". */
function ordinal(n) {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  const suffix = abs >= 11 && abs <= 13 ? "th" : last === 1 ? "st" : last === 2 ? "nd" : last === 3 ? "rd" : "th";
  return `${n}${suffix}`;
}

/**
 * One AI row's condition in plain words. The 19 comparators and their predicates are
 * the decoded FIGHTSTG_check_move_cond table (ddw3-walker
 * docs/research/battle/enemy-ai-move-conditions.md); nothing here is guessed.
 */
function conditionText(comparator, value) {
  switch (comparator) {
    case 0: return "always";
    case 1: return `a random ${value} in 128 chance`;
    case 2: return `own HP under ${value}/128 of max`;
    case 3: return `own HP at least ${value}/128 of max`;
    case 4: return `own MP under ${value}`;
    case 5: return `own MP at least ${value}`;
    case 6: return `target HP under ${value}/128 of max`;
    case 7: return `target HP at least ${value}/128 of max`;
    case 8: return "the player is in one of the 8 starters";
    case 9: return "the player is asleep";
    case 10: return value ? `species #${value} alive in another slot` : "another enemy is still alive";
    case 11: return `the field is ${FIELD_ELEMENT_NAMES[value] ?? `element ${value}`}`;
    case 12: return `battle screen ${value}`;
    case 13: return `encounter gate ${value}`;
    case 14: return "its affinity is set";
    case 15: return "its STR is lowered";
    case 16: return "its DEF is lowered";
    case 17: return "its SPD is lowered";
    case 18: return value ? `every ${ordinal(value)} turn` : "never (it would divide by zero)";
    default: return "always (the disc's out-of-table default)";
  }
}

/**
 * One AI row's action in plain words: FIGHTSTG_F0x80089148 maps 1 -> the basic
 * attack, 2/3 -> the record's move_1/move_2 techniques, 4 -> the flee special,
 * 5..8 -> the enemy-slot switch (which a one-enemy fight can only fail).
 */
function actionText(action, row) {
  switch (action) {
    case 1: return "basic attack";
    case 2: return row.move1.name ? `special 1: ${row.move1.name}` : "special 1 (no technique set)";
    case 3: return row.move2.name ? `special 2: ${row.move2.name}` : "special 2 (no technique set)";
    case 4: return "tries to flee";
    case 5: case 6: case 7: return `switch to slot ${action - 4}`;
    case 8: return "switch to any free slot";
    default: return "no action";
  }
}

/**
 * One row per real wild record in an enemies.json-shaped table (`{enemies: [...]}` or
 * the array itself). The disc's single `enemy_id === "Null"` placeholder record is
 * skipped, so 194 records become 193 rows. `skills` may be digimon.json's `skills`
 * array (or the whole object) and resolves attack / move_1 / move_2 names; `models`
 * is model_map.json (species -> model folder). Pure.
 */
export function wildRows(enemies, skills = [], models = null) {
  const list = Array.isArray(enemies) ? enemies : enemies?.enemies ?? [];
  const skillList = Array.isArray(skills)
    ? skills
    : skills instanceof Map
      ? [...skills.values()]
      : skills?.skills ?? [];
  const skillById = new Map(skillList.map((s) => [s.id, s]));
  const modelMap = models && typeof models === "object" ? models : null;
  const skill = (id) => {
    const n = Number(id) || 0;
    const s = skillById.get(n);
    return { id: n, name: s ? s.name : null };
  };
  const rows = [];
  for (const e of list) {
    if (!e || e.enemy_id === "Null") continue;   // the disc's one placeholder record
    const row = {
      number: rows.length + 1,
      name: e.enemy_id,
      digimonId: e.digimon_id,
      family: Number(e.digimon_type ?? 0),
      model: modelMap ? modelMap[e.enemy_id] ?? null : null,
      stats: pick(e, WILD_STATS),
      resists: pick(e.resistances, ELEMENTS),
      status: pick(e.status_resist, STATUSES),
      attack: skill(e.attack),
      move1: skill(e.move_1),
      move2: skill(e.move_2),
      drop: e.drop_item ?? "Null",
      dropRate: Number(e.drop_rate) || 0,
    };
    row.aiRows = (Array.isArray(e.ai_moves) ? e.ai_moves : []).slice(0, 4).map((a, i) => {
      const action = Number(a?.action) || 0;
      const comparator = Number(a?.comparator) || 0;
      const value = Number(a?.value) || 0;
      // The selection loop tests rows 0..2 and reads row 3 without ever evaluating
      // its condition byte (fightstg.s:6038-6061), so row 4 is the fallback.
      const fallback = i === 3;
      const condition = fallback ? "FALLBACK (no condition checked)" : conditionText(comparator, value);
      const act = actionText(action, row);
      return {
        index: i, action, comparator, value, fallback, condition,
        actionText: act,
        line: `${i + 1}. ${condition} -> ${act}`,
      };
    });
    rows.push(row);
  }
  return rows;
}

/** The wild rows whose name contains `query`, ignoring case and surrounding spaces. Pure. */
export function wildSearch(rows, query) {
  const q = String(query ?? "").trim().toLowerCase();
  const list = Array.isArray(rows) ? rows : [];
  if (!q) return list.slice();
  return list.filter((r) => String(r?.name ?? "").toLowerCase().includes(q));
}

// ------------------------------------------------------------ encounter finder

/**
 * A `{ key: table }` object (the extracted JSON ships a header key) or the table itself.
 * Anything else is an empty table, never a guess.
 */
function innerTable(value, key) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const inner = value[key];
  if (inner && typeof inner === "object" && !Array.isArray(inner)) return inner;
  return value;
}

/** The manifest's map list (the whole manifest object or the array). */
function mapList(value) {
  if (Array.isArray(value)) return value;
  return Array.isArray(value?.maps) ? value.maps : [];
}

/**
 * Every real encounter roll in the two tables the driver reads, indexed by species.
 *
 * `stages` is stage_encounters.json (or its `stages` object) and `screens`
 * field_encounters.json (or its `screens` map); `maps` is web/assets/manifest.json
 * (or its `maps` array) and names each stage `s<key>`. Pure.
 *
 * The stage's `zones[]` is group-major / zone-minor: flat index i is zone `(i % 4) + 1`
 * of selector group `floor(i / 4)` (engine/dw3/encounters.ts documents the four-zone
 * selector record). A non-zero slot is a screen id; the screen's array is the 1..3-enemy
 * party, and the party is kept entry by entry, so a party stored twice is two rows.
 *
 * Row = {stage, stageName, zone, slot, screen, name, level, hp, statScale, rateLevel},
 * all 1-based where the game counts from 1 (zone, slot). `stage` is the numeric key.
 */
export function encounterIndex(stages, screens, maps = null) {
  const stageTable = innerTable(stages, "stages") ?? {};
  const screenTable = innerTable(screens, "screens") ?? {};
  const nameById = new Map(
    mapList(maps).filter((m) => m && typeof m.id === "string").map((m) => [m.id, m.name]),
  );
  const rows = [];
  const bySpecies = new Map();
  for (const [key, stage] of Object.entries(stageTable)) {
    const zones = Array.isArray(stage?.zones) ? stage.zones : null;
    const stageNo = Number(key);
    if (!zones || !Number.isFinite(stageNo)) continue;
    const stageName = nameById.get(`s${key}`) ?? null;
    for (let i = 0; i < zones.length; i++) {
      const zone = zones[i];
      const slots = Array.isArray(zone?.slots) ? zone.slots : null;
      if (!slots) continue;
      const rateLevel = Number(zone.rate_level) || 0;
      const zoneNo = (i % 4) + 1;
      for (let j = 0; j < slots.length; j++) {
        const screen = Number(slots[j]) || 0;
        if (!screen) continue;                       // an empty slot rolls no encounter
        const party = screenTable[String(screen)] ?? screenTable[screen];
        if (!Array.isArray(party)) continue;
        for (const member of party) {
          if (!member || typeof member.name !== "string") continue;
          const row = {
            stage: stageNo,
            stageName,
            zone: zoneNo,
            slot: j + 1,
            screen,
            name: member.name,
            level: Number(member.level) || 0,
            hp: Number(member.hp) || 0,
            statScale: Number(member.stat_scale) || 0,
            rateLevel,
          };
          rows.push(row);
          const list = bySpecies.get(row.name);
          if (list) list.push(row);
          else bySpecies.set(row.name, [row]);
        }
      }
    }
  }
  return { bySpecies, rows };
}

/**
 * The species names matching `query`, alphabetically. An exact name (ignoring case and
 * surrounding spaces) wins outright, so "Kunemon" never drags in a numbered variant;
 * otherwise every name containing the text is returned. An empty query is every name. Pure.
 */
export function encounterSpecies(index, query = "") {
  const names = index?.bySpecies instanceof Map ? [...index.bySpecies.keys()].sort() : [];
  const q = String(query ?? "").trim().toLowerCase();
  if (!q) return names;
  const exact = names.filter((n) => n.toLowerCase() === q);
  if (exact.length) return exact;
  return names.filter((n) => n.toLowerCase().includes(q));
}

/** Every real row of the species matching `query`; an unknown or empty query is []. Pure. */
export function encounterSearch(index, query) {
  if (!String(query ?? "").trim()) return [];
  const rows = [];
  for (const name of encounterSpecies(index, query)) rows.push(...(index.bySpecies.get(name) ?? []));
  return rows;
}

/** The tab's entries: one per species, with its rows and the stages they land on. */
function encounterEntries(index, query = "") {
  const out = [];
  for (const name of encounterSpecies(index, query)) {
    const rows = index?.bySpecies?.get(name) ?? [];
    if (!rows.length) continue;
    out.push({
      name,
      rows,
      stages: [...new Set(rows.map((r) => r.stage))].sort((a, b) => a - b),
    });
  }
  return out;
}

/** The drop as the page prints it: the disc's `Null` placeholder means no item. */
export function dropText(row) {
  const name = row?.drop ?? "Null";
  return name === "Null" ? "none" : name;
}

const S = {
  open: false,          // the book is up
  wasOn: false,         // the F2 flag last frame: the book opens on its rising edge only
  tab: "partners",      // which half of the book is up
  page: 0,
  cursor: 0,
  rows: [],             // the partner rows
  pages: [],
  wild: [],             // the wild rows (the Null placeholder already skipped)
  wildPages: [],
  enc: null,            // {bySpecies, rows} from stage_encounters + field_encounters
  encQuery: "",         // the encounter finder's name filter
  encEntries: [],       // one {name, rows, stages} per species matching the filter
  loadoutRows: [],      // one {folder, names} per model pack (battle/models/index.json)
  loadoutLoading: null, // the small tables' load (index.json + the technique/sound tables)
  loadoutFetch: null,   // the fetch the tab was installed with (tests); null = globalThis.fetch
  techTable: null,      // fight_tech_table.json: technique id -> clip/elem1/elem2/effect
  sounds: null,         // sfx/op10_map.json: op10 cue id -> the disc's sound name
  body: null,           // {folder, anim, error} the body on screen
  bodyPending: new Map(), // folder -> the in-flight anim.json read
  bodyCache: new Map(), // folder -> {folder, anim, error} for every body opened this session
  models: null,         // model_map.json: species -> model folder
  skills: new Map(),
  profiles: [],         // the raw digimon.json rows (basic / signature / slots for the join)
  evolutions: null,
  lineByRoot: new Map(),   // profile id -> the line slot it roots (the eight starters)
  linesOf: new Map(),      // profile id -> the line slots whose records can reach it
  loading: null,
  error: null,
};

/** Close and forget everything (tests, and ?noextras reloads in a browser console). */
export function codexReset() {
  S.open = false;
  S.wasOn = false;
  S.tab = "partners";
  S.page = 0;
  S.cursor = 0;
  S.rows = [];
  S.pages = [];
  S.wild = [];
  S.wildPages = [];
  S.enc = null;
  S.encQuery = "";
  S.encEntries = [];
  S.loadoutRows = [];
  S.loadoutLoading = null;
  S.loadoutFetch = null;
  S.techTable = null;
  S.sounds = null;
  S.body = null;
  S.bodyPending = new Map();
  S.bodyCache = new Map();
  S.models = null;
  S.skills = new Map();
  S.profiles = [];
  S.evolutions = null;
  S.lineByRoot = new Map();
  S.linesOf = new Map();
  S.loading = null;
  S.error = null;
  syncFinderKeys();
}

/**
 * Install the loaded tables (the browser load and the node test both land here).
 * `enemies` is enemies.json (the whole object or its array), `models` model_map.json;
 * both are optional so a partner-only caller keeps working. `encounters` is
 * `{stages, screens, maps}` — stage_encounters.json, field_encounters.json and the
 * manifest — and is optional for the same reason: no finder tab, no index.
 */
export function setCodexData(digimon, evolutions, enemies = null, models = null, encounters = null) {
  const rows = partnerRows(digimon, Array.isArray(digimon) ? [] : digimon?.skills);
  S.rows = rows;
  S.pages = codexPages(rows, PER_PAGE);
  S.page = 0;
  S.cursor = 0;
  S.tab = "partners";
  S.skills = new Map((Array.isArray(digimon) ? [] : digimon?.skills ?? []).map((s) => [s.id, s]));
  S.profiles = Array.isArray(digimon) ? digimon.slice() : (digimon?.digimon ?? []).slice();
  S.evolutions = evolutions;
  S.models = models && typeof models === "object" ? models : null;
  const enemyList = Array.isArray(enemies) ? enemies : enemies?.enemies ?? [];
  S.wild = wildRows(enemyList, S.skills, S.models);
  S.wildPages = codexPages(S.wild, PER_PAGE);
  const enc = encounters && typeof encounters === "object" ? encounters : {};
  S.enc = encounterIndex(enc.stages ?? null, enc.screens ?? null, enc.maps ?? null);
  S.encQuery = "";
  S.encEntries = encounterEntries(S.enc);

  const lineByRoot = new Map();
  const linesOf = new Map();
  for (const [slot, line] of (evolutions?.lines ?? []).entries()) {
    if (line?.digimonId != null) lineByRoot.set(line.digimonId, slot);
    for (const record of line?.records ?? []) {
      if (!linesOf.has(record.to)) linesOf.set(record.to, []);
      const slots = linesOf.get(record.to);
      if (!slots.includes(slot)) slots.push(slot);
    }
  }
  S.lineByRoot = lineByRoot;
  S.linesOf = linesOf;
  return rows;
}

const asJson = (value) => (typeof value?.json === "function" ? value.json() : value);

/**
 * Fetch and install the tables through the page's own fetch, so the extra roster's
 * wrapped fetch has already merged the added species and their line records. The wild
 * tables (enemies.json + model_map.json) and the finder tables (stage_encounters.json,
 * field_encounters.json and manifest.json's map names) ride the same load. Cached per
 * book load. `fetchJson` is injectable for tests.
 */
export function codexLoad(fetchJson = globalThis.fetch) {
  if (S.loading) return S.loading;
  if (typeof fetchJson !== "function") return Promise.resolve(false);
  S.loading = (async () => {
    try {
      const [digimon, evolutions, enemies, models, stageEncounters, fieldEncounters, manifest] = await Promise.all([
        Promise.resolve(fetchJson("assets/data/digimon.json")).then(asJson),
        Promise.resolve(fetchJson("assets/data/evolutions.json")).then(asJson),
        Promise.resolve(fetchJson("assets/data/enemies.json")).then(asJson),
        Promise.resolve(fetchJson("assets/battle/model_map.json")).then(asJson),
        Promise.resolve(fetchJson("assets/data/stage_encounters.json")).then(asJson),
        Promise.resolve(fetchJson("assets/data/field_encounters.json")).then(asJson),
        Promise.resolve(fetchJson("assets/manifest.json")).then(asJson),
      ]);
      setCodexData(digimon, evolutions, enemies, models, {
        stages: stageEncounters,
        screens: fieldEncounters,
        maps: manifest,
      });
      S.error = null;
      return true;
    } catch (err) {
      S.error = String(err?.message ?? err);
      return false;
    } finally {
      S.loading = null;
    }
  })();
  return S.loading;
}

// ---------------------------------------------------------------- the Loadout tab

/** The reverse of model_map.json: folder -> the display names that stage it. */
function namesByFolder() {
  const byFolder = new Map();
  for (const [name, folder] of Object.entries(S.models ?? {})) {
    if (typeof folder !== "string") continue;
    if (!byFolder.has(folder)) byFolder.set(folder, []);
    byFolder.get(folder).push(name);
  }
  return byFolder;
}

/**
 * Install the Loadout tab's small tables (the browser's load and the node test both land
 * here). `index` is battle/models/index.json (the 249 folder names), `techTable`
 * fight_tech_table.json and `sounds` sfx/op10_map.json; every one is optional so a caller
 * can install only what it has. `fetchJson` pins the fetch the tab uses (tests).
 */
export function setLoadoutData({ index = null, techTable = null, sounds = null, fetchJson = undefined } = {}) {
  if (index != null) {
    const list = Array.isArray(index) ? index : Array.isArray(index?.models) ? index.models : [];
    const folders = [...new Set(list.filter((f) => typeof f === "string"))].sort();
    const byFolder = namesByFolder();
    S.loadoutRows = folders.map((folder) => ({ folder, names: byFolder.get(folder) ?? [] }));
    S.body = null;
    S.bodyPending = new Map();
    S.bodyCache = new Map();
    const pages = Math.max(1, Math.ceil(S.loadoutRows.length / PER_PAGE));
    S.page = Math.max(0, Math.min(S.page, pages - 1));
    S.cursor = Math.max(0, Math.min(S.cursor, PER_PAGE - 1));
  }
  if (techTable !== null) S.techTable = techTable && typeof techTable === "object" ? techTable : null;
  if (sounds !== null) S.sounds = sounds && typeof sounds === "object" ? sounds : null;
  if (fetchJson !== undefined) S.loadoutFetch = typeof fetchJson === "function" ? fetchJson : null;
  if (S.tab === "loadout" && S.loadoutRows.length) codexLoadoutBody();
}

/**
 * Fetch the Loadout tab's small tables once: battle/models/index.json, the technique table
 * and the op10 sound names. None of them is an anim.json — the bodies come one at a time
 * (codexLoadoutBody). Cached per book load; `fetchJson` is injectable for tests.
 */
export function codexLoadLoadout(fetchJson = undefined) {
  if (S.loadoutLoading) return S.loadoutLoading;
  const fetcher = fetchJson ?? S.loadoutFetch ?? globalThis.fetch;
  if (typeof fetcher !== "function") return Promise.resolve(false);
  const read = (url) => Promise.resolve(fetcher(url)).then(asJson).catch(() => null);
  S.loadoutLoading = (async () => {
    try {
      const [index, techTable, sounds] = await Promise.all([
        read("assets/battle/models/index.json"),
        read("assets/data/fight_tech_table.json"),
        read("assets/sfx/op10_map.json"),
      ]);
      if (index == null) {
        S.error = "battle/models/index.json did not load";
        return false;
      }
      setLoadoutData({ index, techTable, sounds });
      S.error = null;
      return true;
    } catch (err) {
      S.error = String(err?.message ?? err);
      return false;
    } finally {
      S.loadoutLoading = null;
    }
  })();
  return S.loadoutLoading;
}

/** The body row under the cursor (only while the Loadout tab is up). */
function loadoutRow() {
  if (S.tab !== "loadout") return null;
  return codexPageRows()[Math.max(0, Math.min(S.cursor, codexPageRows().length - 1))] ?? null;
}

/**
 * Read the selected body's own anim.json — the tab's one big fetch, one body at a time.
 * The last few bodies stay cached (a small LRU) so stepping back and forth costs nothing
 * while 249 packs never sit in memory at once; a body that fails to load keeps its error.
 * `fetchJson` is injectable for tests. Resolves to the anim (or null).
 */
export function codexLoadoutBody(fetchJson = undefined) {
  const row = loadoutRow();
  if (!row) return Promise.resolve(null);
  const folder = row.folder;
  const cached = S.bodyCache.get(folder);
  if (cached) {
    if (loadoutRow()?.folder === folder) S.body = cached;
    return Promise.resolve(cached.anim ?? null);
  }
  if (S.bodyPending.has(folder)) return S.bodyPending.get(folder);
  const fetcher = fetchJson ?? S.loadoutFetch ?? globalThis.fetch;
  if (typeof fetcher !== "function") return Promise.resolve(null);
  const pending = (async () => {
    let entry;
    try {
      const anim = await asJson(fetcher(`assets/battle/models/${folder}/anim.json`));
      entry = { folder, anim: anim ?? null, error: anim ? null : "the pack returned no JSON" };
    } catch (err) {
      entry = { folder, anim: null, error: String(err?.message ?? err) };
    }
    S.bodyPending.delete(folder);
    S.bodyCache.set(folder, entry);
    // keep only the last few bodies: the 249 packs are 39.9 MB, so the page must not hold
    // them all just because a player scrolled the list
    while (S.bodyCache.size > BODY_CACHE_LIMIT) S.bodyCache.delete(S.bodyCache.keys().next().value);
    if (loadoutRow()?.folder === folder) S.body = entry;
    return entry.anim;
  })();
  S.bodyPending.set(folder, pending);
  return pending;
}

/** The body the page is showing ({folder, anim, error}), or null. */
export function codexLoadoutBodyState() {
  return S.body;
}

/** The anim.json the page has loaded for the selected body, or null. */
export function codexLoadoutAnim() {
  return S.body?.anim ?? null;
}

/** Is the book up? (web/game.js freezes the field and routes the pad to it while true.) */
export function codexOpen() {
  return S.open;
}

/** Which part of the book is up: "partners", "wild", "encounters", "loadout" or "clips". */
export function codexTab() {
  return S.tab;
}

/** The pages of the tab that is up. */
function tabPages() {
  if (S.tab === "wild") return S.wildPages;
  if (S.tab === "encounters") return codexPages(S.encEntries, PER_PAGE);
  if (S.tab === "clips") return CLIP_PAGES;
  if (S.tab === "loadout") return codexPages(S.loadoutRows, PER_PAGE);
  return S.pages;
}
/** The rows of the tab that is up (the finder's entries hold one species each). */
function tabRows() {
  if (S.tab === "wild") return S.wild;
  if (S.tab === "encounters") return S.encEntries;
  if (S.tab === "clips") return CLIP_NAMES_62;
  if (S.tab === "loadout") return S.loadoutRows;
  return S.rows;
}

/** The page on screen, 0-based; how many pages; the rows of the page; where the cursor is. */
export function codexPageIndex() {
  return S.page;
}
export function codexPageCount() {
  return tabPages().length;
}
export function codexPageRows() {
  return tabPages()[S.page] ?? [];
}
export function codexCursor() {
  return S.cursor;
}
export function codexRows() {
  return tabRows();
}

/**
 * Follow F2 -> Extras -> "Digimon Codex (new)". It opens once when the switch turns on (the
 * rising edge) and closes when it turns off; closing with Cross while the switch stays on does
 * not reopen it, switching the switch off and on again does. With it off no data is fetched.
 */
export function tickCodex(enabled) {
  const on = enabled === true;
  if (on && !S.wasOn) {
    S.open = true;
    S.tab = "partners";
    S.page = 0;
    S.cursor = 0;
    S.encQuery = "";
    S.encEntries = encounterEntries(S.enc);
    if (!S.rows.length && !S.loading) codexLoad();
  } else if (!on && S.wasOn) {
    S.open = false;
  }
  S.wasOn = on;
  syncFinderKeys();
  return S.open;
}

/** True when a tab has something to show; an empty tab is skipped while cycling. */
function tabHasContent(tab) {
  if (tab === "encounters") return S.encEntries.length > 0;
  if (tab === "wild") return S.wild.length > 0;
  // The Clips tab is the typed 62-row glossary: always there, no fetch.
  if (tab === "clips") return true;
  // The Loadout tab is always reachable: its list is one small index.json, fetched the
  // first time the tab lands, so skipping it while empty would make it unreachable.
  if (tab === "loadout") return true;
  return S.rows.length > 0;
}

/** Turn to the next/previous part of the book, landing on its first row of its first page. */
function switchTab(delta) {
  let i = TAB_NAMES.indexOf(S.tab);
  if (i < 0) i = 0;
  // R1 walks PARTNERS -> WILD -> ENCOUNTERS -> LOADOUT -> CLIPS and L1 walks the same ring
  // backwards. A tab with no rows (e.g. the finder before its tables have loaded) is
  // skipped, so the pad never lands on a blank page.
  for (let step = 0; step < TAB_NAMES.length; step++) {
    i = (i + delta + TAB_NAMES.length) % TAB_NAMES.length;
    if (tabHasContent(TAB_NAMES[i])) break;
  }
  S.tab = TAB_NAMES[i];
  S.page = 0;
  S.cursor = 0;
  if (S.tab === "loadout") {
    if (!S.loadoutRows.length) codexLoadLoadout(S.loadoutFetch ?? undefined);
    else codexLoadoutBody(S.loadoutFetch ?? undefined);
  }
}

function setPage(page) {
  const n = tabPages().length;
  if (!n) return;
  S.page = ((page % n) + n) % n;
  const rows = codexPageRows();
  S.cursor = Math.max(0, Math.min(S.cursor, rows.length - 1));
  if (S.tab === "loadout") codexLoadoutBody(S.loadoutFetch ?? undefined);
}

function moveCursor(delta) {
  const rows = codexPageRows();
  if (!rows.length) return;
  const next = S.cursor + delta;
  if (next < 0 && S.page > 0) {
    setPage(S.page - 1);
    S.cursor = codexPageRows().length - 1;
    if (S.tab === "loadout") codexLoadoutBody(S.loadoutFetch ?? undefined);
    return;
  }
  if (next >= rows.length && S.page < tabPages().length - 1) {
    setPage(S.page + 1);
    S.cursor = 0;
    if (S.tab === "loadout") codexLoadoutBody(S.loadoutFetch ?? undefined);
    return;
  }
  S.cursor = Math.max(0, Math.min(rows.length - 1, next));
  if (S.tab === "loadout") codexLoadoutBody(S.loadoutFetch ?? undefined);
}

/** The encounter finder's current name filter (lowercase; "" is every species). */
export function codexQuery() {
  return S.encQuery;
}

// The keyboard's raw letters, captured before game.js's own key map translates them, so
// the finder can be typed into. A letter with a pad binding (W/A/S/D, K, E, ...) would
// otherwise arrive as a direction or a shoulder and move the page. The listener exists
// only while the book is open on the ENCOUNTERS tab; with it off (or on any other tab)
// the page receives exactly what it received before. Arrow keys, Enter and Escape are
// left alone, so the pad still pages, confirms, closes and goes back.
let finderKeyHandler = null;
function syncFinderKeys() {
  if (typeof window === "undefined" || typeof window.addEventListener !== "function") return;
  const want = S.open && S.tab === "encounters";
  if (want && !finderKeyHandler) {
    finderKeyHandler = (event) => {
      if (!S.open || S.tab !== "encounters") return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const key = typeof event.key === "string" ? event.key : "";
      const back = key === "Backspace";
      if (!back && !(key.length === 1 && /^[a-z0-9 '-]$/i.test(key))) return;
      codexType(back ? "backspace" : key);
      event.preventDefault?.();
      event.stopImmediatePropagation?.();
    };
    window.addEventListener("keydown", finderKeyHandler, true);
  } else if (!want && finderKeyHandler) {
    window.removeEventListener("keydown", finderKeyHandler, true);
    finderKeyHandler = null;
  }
}

/**
 * Type into the encounter finder. `text` is one printable character (letters, digits,
 * space, apostrophe or hyphen) or "backspace". In the browser the finder's own key
 * listener above feeds this; node tests and the console hook call it directly. Off the
 * finder tab (or with the book closed) nothing is edited. Returns false on a press it
 * cannot use, so a caller can fall through.
 */
export function codexType(text) {
  if (!S.open || S.tab !== "encounters") return false;
  const key = String(text ?? "");
  if (key === "backspace") {
    if (!S.encQuery) return true;
    S.encQuery = S.encQuery.slice(0, -1);
  } else if (key.length === 1 && /^[a-z0-9 '-]$/i.test(key)) {
    if (S.encQuery.length < 24) S.encQuery += key.toLowerCase();
  } else {
    return false;
  }
  S.encEntries = encounterEntries(S.enc, S.encQuery);
  S.page = 0;
  S.cursor = 0;
  return true;
}

/**
 * The pad while the book is up: L1/R1 turn between PARTNERS, WILD and ENCOUNTERS,
 * Left/Right turn a page (wrapping), Up/Down move the row cursor (walking over a page
 * edge), Cross/Start close it, every other press is swallowed. On the ENCOUNTERS tab a
 * single character or Backspace edits the name filter instead and Triangle goes back to
 * WILD. Returns false when the book is closed, so the press falls through exactly as before.
 */
export function codexPress(button) {
  if (!S.open) return false;
  if (S.tab === "encounters" && (button === "backspace" || (typeof button === "string" && button.length === 1))) {
    codexType(button);
    return true;
  }
  if (button === "l1") switchTab(-1);
  else if (button === "r1") switchTab(1);
  else if (button === "left") setPage(S.page - 1);
  else if (button === "right") setPage(S.page + 1);
  else if (button === "up") moveCursor(-1);
  else if (button === "down") moveCursor(1);
  else if (button === "triangle" && S.tab === "encounters") switchTab(-1);
  else if (button === "cross" || button === "start") S.open = false;
  return true;
}

/** Break text into lines no longer than `cols` characters, on spaces. */
function wrapText(text, cols) {
  const out = [];
  let line = "";
  for (const word of String(text).split(/\s+/)) {
    if (!word) continue;
    if (!line) line = word;
    else if (line.length + 1 + word.length <= cols) line += " " + word;
    else {
      out.push(line);
      line = word;
    }
  }
  if (line) out.push(line);
  return out;
}

/** One partner's detail as ready-to-draw strings (pure; the draw uses it). */
function detailLines(row) {
  if (!row) return null;
  const lineSlot = S.lineByRoot.get(row.id);
  const reachable = S.linesOf.get(row.id) ?? [];
  const lineNamesOf = (slot) => lineTargets(S.evolutions, slot, S.rows);
  let lineTitle;
  let lineNames;
  if (lineSlot != null) {
    lineNames = lineNamesOf(lineSlot);
    lineTitle = `${row.name}'s line: ${lineNames.length} forms it can learn`;
  } else if (reachable.length) {
    const roots = reachable
      .map((slot) => S.rows.find((r) => r.id === S.evolutions?.lines?.[slot]?.digimonId)?.name)
      .filter(Boolean);
    const total = S.evolutions?.lines?.length ?? reachable.length;
    lineTitle = reachable.length === total
      ? `Can be reached from any of the ${total} lines`
      : `Can be reached from: ${roots.join(", ") || `${reachable.length} lines`}`;
    lineNames = reachable.length === 1 ? lineNamesOf(reachable[0]) : [];
  } else {
    lineTitle = "No digivolution line names this form";
    lineNames = [];
  }
  const stat = (k, label) => `${label} ${row.stats[k]}`;
  const res = (k) => `${ELEMENT_LABELS[k]} ${row.resistances[k]}`;
  const st = (k) => `${STATUS_LABELS[k]} ${row.statusResist[k]}`;
  return {
    name: row.name,
    id: row.id,
    sub: `Family ${row.family}  ·  ${row.is_starter ? "starter" : "form"}  ·  ${row.added ? "new species" : "disc species"}`,
    hpmp: `HP ${row.hp}   MP ${row.mp}`,
    statsA: [stat("str", "STR"), stat("def", "DEF"), stat("spt", "SPT")].join("   "),
    statsB: [stat("wis", "WIS"), stat("spd", "SPD"), stat("chr", "CHR")].join("   "),
    resA: [res("fire"), res("water"), res("ice")].join("   "),
    resB: [res("wind"), res("thunder"), res("machine")].join("   "),
    resC: res("dark"),
    stA: [st("poison"), st("paralyze"), st("confuse")].join("   "),
    stB: [st("sleep"), st("ko")].join("   "),
    signature: row.signature
      ? `${row.signature.name} (${row.signature.element}, power ${row.signature.power})`
      : "none",
    blasts: row.blasts.length ? wrapText(row.blasts.join(", "), 44) : ["none"],
    lineTitle: wrapText(lineTitle, 46)[0],
    lineMore: lineNames.length ? wrapText(lineNames.slice(0, 8).join(", ") + (lineNames.length > 8 ? ", …" : ""), 46) : [],
  };
}

function drawEmpty(ctx, W, H, message) {
  ctx.save();
  ctx.fillStyle = "rgba(4,6,12,0.96)";
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = "#c9a54a";
  ctx.lineWidth = 2;
  ctx.strokeRect(12, 10, W - 24, H - 20);
  ctx.textBaseline = "top";
  ctx.textAlign = "center";
  ctx.font = "bold 16px monospace";
  ctx.fillStyle = "#ffd34d";
  ctx.fillText("DIGIMON CODEX", W / 2, 24);
  ctx.font = "13px monospace";
  ctx.fillStyle = "#d8e2f0";
  ctx.fillText(message, W / 2, H / 2 - 10);
  ctx.restore();
}

/** One wild record's detail as ready-to-draw strings (pure; the draw uses it). */
function wildDetailLines(row) {
  if (!row) return null;
  const stat = (k, label) => `${label} ${row.stats[k]}`;
  const res = (k) => `${ELEMENT_LABELS[k]} ${row.resists[k]}`;
  const st = (k) => `${STATUS_LABELS[k]} ${row.status[k]}`;
  const move = (label, m) => `${label} ${m.name ? `${m.name} (#${m.id})` : `none (#${m.id})`}`;
  const drop = row.drop === "Null"
    ? "none (the disc's Null placeholder)"
    : `${row.drop} (rate ${row.dropRate} of 1024)`;
  return {
    name: row.name,
    sub: `#${row.number} of 193  ·  Family ${row.family}  ·  ${row.model ? `drawn as ${row.model}` : "no model folder"}`,
    statsA: [stat("str", "STR"), stat("def", "DEF"), stat("spt", "SPT")].join("   "),
    statsB: [stat("wis", "WIS"), stat("spd", "SPD")].join("   "),
    resA: [res("fire"), res("water"), res("ice")].join("   "),
    resB: [res("wind"), res("thunder"), res("machine")].join("   "),
    resC: res("dark"),
    stA: [st("poison"), st("paralyze"), st("confuse")].join("   "),
    stB: [st("sleep"), st("ko")].join("   "),
    basic: move("Basic:", row.attack),
    special1: move("Special 1:", row.move1),
    special2: move("Special 2:", row.move2),
    drop: `Drop: ${drop}`,
    aiLines: row.aiRows.map((a) => a.line),
  };
}

/** The partner detail column (right half of the page). */
function drawPartnerDetail(ctx, row, tx, top) {
  const d = detailLines(row);
  if (!d) return;
  let ty = top + 8;
  const step = 15;
  ctx.textAlign = "left";

  ctx.font = "bold 14px monospace";
  ctx.fillStyle = "#ffd34d";
  ctx.fillText(`${d.name}  #${d.id}`, tx, ty);
  ty += 19;
  ctx.font = "10px monospace";
  ctx.fillStyle = "#8a93a8";
  ctx.fillText(d.sub, tx, ty);
  ty += 16;
  ctx.fillStyle = "#d8e2f0";
  ctx.fillText(d.hpmp, tx, ty);
  ty += 18;

  const label = (text) => {
    ctx.font = "9px monospace";
    ctx.fillStyle = "#6fd0a8";
    ctx.fillText(text, tx, ty);
    ty += 13;
    ctx.font = "10px monospace";
    ctx.fillStyle = "#d8e2f0";
  };
  label("CORE STATS");
  ctx.fillText(d.statsA, tx, ty); ty += step;
  ctx.fillText(d.statsB, tx, ty); ty += step + 3;
  label("RESISTANCES");
  ctx.fillText(d.resA, tx, ty); ty += step;
  ctx.fillText(d.resB, tx, ty); ty += step;
  ctx.fillText(d.resC, tx, ty); ty += step + 3;
  label("STATUS RESIST");
  ctx.fillText(d.stA, tx, ty); ty += step;
  ctx.fillText(d.stB, tx, ty); ty += step + 3;
  label("SIGNATURE");
  ctx.fillStyle = "#ffd34d";
  ctx.fillText(d.signature, tx, ty); ty += step + 3;
  label("BLASTS");
  for (const line of d.blasts) {
    ctx.fillText(line, tx, ty);
    ty += step;
  }
  ty += 3;
  label("LINE");
  ctx.fillText(d.lineTitle, tx, ty); ty += step;
  ctx.fillStyle = "#9ad0a8";
  for (const line of d.lineMore) {
    ctx.fillText(line, tx, ty);
    ty += step;
  }
}

/** The wild detail column (right half of the page). */
function drawWildDetail(ctx, row, tx, top) {
  const d = wildDetailLines(row);
  if (!d) return;
  let ty = top + 8;
  const step = 14;
  ctx.textAlign = "left";

  ctx.font = "bold 14px monospace";
  ctx.fillStyle = "#ffd34d";
  ctx.fillText(d.name, tx, ty);
  ty += 18;
  ctx.font = "10px monospace";
  ctx.fillStyle = "#8a93a8";
  ctx.fillText(d.sub, tx, ty);
  ty += 16;

  const label = (text) => {
    ctx.font = "9px monospace";
    ctx.fillStyle = "#6fd0a8";
    ctx.fillText(text, tx, ty);
    ty += 12;
    ctx.font = "10px monospace";
    ctx.fillStyle = "#d8e2f0";
  };
  label("CORE STATS (the five the record carries)");
  ctx.fillText(d.statsA, tx, ty); ty += step;
  ctx.fillText(d.statsB, tx, ty); ty += step + 3;
  label("RESISTANCES");
  ctx.fillText(d.resA, tx, ty); ty += step;
  ctx.fillText(d.resB, tx, ty); ty += step;
  ctx.fillText(d.resC, tx, ty); ty += step + 3;
  label("STATUS RESIST");
  ctx.fillText(d.stA, tx, ty); ty += step;
  ctx.fillText(d.stB, tx, ty); ty += step + 3;
  label("MOVES (ids from the record)");
  ctx.fillStyle = "#d8e2f0";
  ctx.fillText(d.basic, tx, ty); ty += step;
  ctx.fillText(d.special1, tx, ty); ty += step;
  ctx.fillText(d.special2, tx, ty); ty += step + 3;
  label("DROP");
  ctx.fillText(d.drop, tx, ty); ty += step + 3;
  label("AI ROWS (first passing row wins; row 4 is the fallback)");
  ctx.font = "9px monospace";
  ctx.fillStyle = "#9fd0ff";
  for (const line of d.aiLines) {
    for (const part of wrapText(line, 60)) {
      ctx.fillText(part, tx, ty);
      ty += 12;
    }
  }
}

/** The tab labels, the one that is up lit and underlined. */
function drawTabs(ctx, left, y, right) {
  let tx = left;
  for (const id of TAB_NAMES) {
    const label = TAB_LABELS[id];
    ctx.font = "bold 11px monospace";
    ctx.fillStyle = S.tab === id ? "#ffd34d" : "#5f6b80";
    ctx.fillText(label, tx, y);
    if (S.tab === id) {
      ctx.fillStyle = "#ffd34d";
      ctx.fillRect(tx, y + 11, label.length * 7, 2);
    }
    tx += label.length * 7 + 16;
  }
  ctx.font = "9px monospace";
  ctx.fillStyle = "#5f6b80";
  ctx.textAlign = "right";
  ctx.fillText("L1 / R1: tab", right, y + 1);
  ctx.textAlign = "left";
}

/** The finder's right column: the species, its stages, and its first real pools. */
function drawEncounterDetail(ctx, entry, tx, top) {
  let ty = top + 8;
  ctx.textAlign = "left";
  ctx.font = "bold 14px monospace";
  ctx.fillStyle = "#ffd34d";
  ctx.fillText(entry.name, tx, ty);
  ty += 18;
  ctx.font = "10px monospace";
  ctx.fillStyle = "#8a93a8";
  ctx.fillText(`${entry.rows.length} pools on ${entry.stages.length} stages`, tx, ty);
  ty += 14;
  ctx.fillStyle = "#9ad0a8";
  for (const line of wrapText(`Stages: ${entry.stages.join(", ")}`, 56)) {
    ctx.fillText(line, tx, ty);
    ty += 12;
  }
  ty += 4;
  ctx.font = "9px monospace";
  ctx.fillStyle = "#6fd0a8";
  ctx.fillText("WHERE IT CAN BE ROLLED", tx, ty);
  ty += 12;
  ctx.font = "9px monospace";
  const shown = entry.rows.slice(0, 10);
  for (const row of shown) {
    const line = `s${row.stage} ${row.stageName ?? "unnamed stage"} · zone ${row.zone} · slot ${row.slot}`
      + ` · screen ${row.screen} · Lv ${row.level} · HP ${row.hp} · x${row.statScale} · rate ${row.rateLevel}`;
    ctx.fillStyle = "#c8d2e2";
    for (const part of wrapText(line, 58)) {
      ctx.fillText(part, tx, ty);
      ty += 11;
    }
    ty += 2;
  }
  if (entry.rows.length > shown.length) {
    ctx.fillStyle = "#5f6b80";
    ctx.fillText(`+${entry.rows.length - shown.length} more pools`, tx, ty);
  }
}

/** The ENCOUNTERS tab: a searchable species list on the left, the chosen species' pools on the right. */
function drawEncounters(ctx, W, H) {
  const x = Math.round(W * 0.03);
  const y = Math.round(H * 0.02);
  const w = W - 2 * x;
  const h = H - 2 * y;
  const left = x + 14;
  const pages = tabPages();
  const pageRows = pages[S.page] ?? [];

  ctx.save();
  ctx.fillStyle = "rgba(4,6,12,0.96)";
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = "#c9a54a";
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, w, h);
  ctx.strokeStyle = "rgba(201,165,74,0.35)";
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 5, y + 5, w - 10, h - 10);
  ctx.textBaseline = "top";
  ctx.textAlign = "left";

  // header
  ctx.font = "bold 16px monospace";
  ctx.fillStyle = "#ffd34d";
  ctx.fillText("DIGIMON CODEX", left, y + 12);
  ctx.font = "11px monospace";
  ctx.fillStyle = "#8a93a8";
  ctx.fillText("ENCOUNTERS — where each species can be met", left + 172, y + 17);
  ctx.textAlign = "right";
  ctx.fillStyle = "#9fd0ff";
  ctx.fillText(`${Math.min(S.page + 1, Math.max(pages.length, 1))} / ${pages.length}`, x + w - 16, y + 16);
  ctx.textAlign = "left";
  drawTabs(ctx, left, y + 31, x + w - 16);

  const top = y + 58;
  const bottom = y + h - 30;
  const listX = left;
  const listW = Math.round(w * 0.36);

  // the name filter
  ctx.font = "10px monospace";
  ctx.fillStyle = "#9fd0ff";
  ctx.fillText(`Search: ${S.encQuery || "(all species)"}`, listX, top);
  ctx.font = "9px monospace";
  ctx.fillStyle = "#5f6b80";
  ctx.textAlign = "right";
  ctx.fillText("letters: filter   Backspace: delete", x + w - 16, top + 1);
  ctx.textAlign = "left";

  const listTop = top + 20;
  const listBottom = bottom - 18;
  if (!S.enc || !S.enc.rows.length) {
    ctx.font = "10px monospace";
    ctx.fillStyle = "#d8e2f0";
    ctx.fillText("The encounter tables are not loaded.", listX, listTop + 4);
  } else if (!pageRows.length) {
    ctx.font = "10px monospace";
    ctx.fillStyle = "#d8e2f0";
    ctx.fillText(`No species matches "${S.encQuery}".`, listX, listTop + 4);
  } else {
    const rowH = Math.floor((listBottom - listTop) / Math.max(pageRows.length, 1));
    const lh = Math.max(11, Math.min(14, rowH));
    ctx.font = "10px monospace";
    let ry = listTop;
    for (let i = 0; i < pageRows.length; i++) {
      const entry = pageRows[i];
      const hit = i === S.cursor;
      if (hit) {
        ctx.fillStyle = "rgba(201,165,74,0.22)";
        ctx.fillRect(listX - 2, ry - 2, listW - 4, lh);
      }
      const tag = `${hit ? ">" : " "} ${entry.name}  (${entry.stages.length})`;
      ctx.fillStyle = hit ? "#ffe9a8" : "#c8d2e2";
      ctx.fillText(tag, listX, ry);
      ry += lh;
    }
    ctx.font = "9px monospace";
    ctx.fillStyle = "#5f6b80";
    ctx.fillText(`${S.encEntries.length} species with a pool`, listX, bottom - 2);
  }

  // the open species (right)
  const dx = listX + listW + 14;
  const dw = x + w - 16 - dx;
  ctx.strokeStyle = "rgba(201,165,74,0.35)";
  ctx.strokeRect(dx - 8, listTop, dw, bottom - listTop);
  const entry = pageRows[Math.max(0, Math.min(S.cursor, pageRows.length - 1))];
  if (entry) drawEncounterDetail(ctx, entry, dx + 2, listTop);

  // controls, in the book's own margin
  ctx.font = "10px monospace";
  ctx.fillStyle = "#7a90b0";
  ctx.textAlign = "left";
  ctx.fillText("L1 / R1: tab    Left / Right: page    Up / Down: species    Triangle: back    Cross / Start: close", left, bottom + 8);
  ctx.restore();
  return true;
}

/** The species whose model_map folder is `folder` — the join the move rows come from. */
function loadoutSpecies(folder) {
  const out = [];
  for (const p of S.profiles) if (S.models?.[p.name] === folder) out.push(p);
  return out;
}

/**
 * The LOADOUT tab: every model pack on the left (one row per folder), the open body's own
 * scripts on the right. The odd-case lines (one mesh/many elements; silent attack clips)
 * are pinned above the box's bottom edge so they are always readable, and the clip block
 * is cut with a "+N more lines" when a full 18-clip pack overruns the column.
 */
function drawLoadout(ctx, W, H) {
  const x = Math.round(W * 0.03);
  const y = Math.round(H * 0.02);
  const w = W - 2 * x;
  const h = H - 2 * y;
  const left = x + 14;
  const pages = tabPages();
  const pageRows = pages[S.page] ?? [];

  ctx.save();
  ctx.fillStyle = "rgba(4,6,12,0.96)";
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = "#c9a54a";
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, w, h);
  ctx.strokeStyle = "rgba(201,165,74,0.35)";
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 5, y + 5, w - 10, h - 10);
  ctx.textBaseline = "top";
  ctx.textAlign = "left";

  ctx.font = "bold 16px monospace";
  ctx.fillStyle = "#ffd34d";
  ctx.fillText("DIGIMON CODEX", left, y + 12);
  ctx.font = "11px monospace";
  ctx.fillStyle = "#8a93a8";
  ctx.fillText("LOADOUT — what each body really throws", left + 172, y + 17);
  ctx.textAlign = "right";
  ctx.fillStyle = "#9fd0ff";
  ctx.fillText(`${Math.min(S.page + 1, Math.max(pages.length, 1))} / ${pages.length}`, x + w - 16, y + 16);
  ctx.textAlign = "left";
  drawTabs(ctx, left, y + 31, x + w - 16);

  const top = y + 58;
  const bottom = y + h - 30;
  const listX = left;
  const listW = Math.round(w * 0.36);
  const listTop = top;
  const listBottom = bottom - 18;

  if (!S.loadoutRows.length) {
    ctx.font = "10px monospace";
    ctx.fillStyle = "#d8e2f0";
    ctx.fillText(
      S.error ? `The model index could not be read: ${S.error}` : "Loading the model index…",
      listX,
      listTop + 4,
    );
  } else {
    const rowH = Math.floor((listBottom - listTop) / Math.max(pageRows.length, 1));
    const lh = Math.max(11, Math.min(14, rowH));
    ctx.font = "10px monospace";
    let ry = listTop;
    for (let i = 0; i < pageRows.length; i++) {
      const entry = pageRows[i];
      const hit = i === S.cursor;
      if (hit) {
        ctx.fillStyle = "rgba(201,165,74,0.22)";
        ctx.fillRect(listX - 2, ry - 2, listW - 4, lh);
      }
      const who = entry.names.length ? ` ${entry.names.join("/")}` : "";
      ctx.fillStyle = hit ? "#ffe9a8" : entry.names.length ? "#c8d2e2" : "#7a90b0";
      ctx.fillText(`${hit ? ">" : " "} ${entry.folder}${who}`, listX, ry);
      ry += lh;
    }
    ctx.font = "9px monospace";
    ctx.fillStyle = "#5f6b80";
    ctx.fillText(`${S.loadoutRows.length} pack ${S.loadoutRows.length === 1 ? "body" : "bodies"} · one anim.json at a time`, listX, bottom - 2);
  }

  // the open body
  const dx = listX + listW + 14;
  const dw = x + w - 16 - dx;
  ctx.strokeStyle = "rgba(201,165,74,0.35)";
  ctx.strokeRect(dx - 8, top, dw, bottom - top);
  const row = pageRows[Math.max(0, Math.min(S.cursor, pageRows.length - 1))];
  const cols = Math.max(24, Math.floor(dw / 5.3));
  if (row) {
    const body = S.body && S.body.folder === row.folder ? S.body : null;
    let ty = top + 6;
    if (!body) {
      ctx.font = "10px monospace";
      ctx.fillStyle = "#d8e2f0";
      ctx.fillText(`opening ${row.folder}/anim.json…`, dx + 2, ty + 4);
    } else if (body.error) {
      ctx.font = "10px monospace";
      ctx.fillStyle = "#ff9a8a";
      for (const line of wrapText(`could not read ${row.folder}: ${body.error}`, cols)) {
        ctx.fillText(line, dx + 2, ty);
        ty += 12;
      }
    } else {
      const report = loadoutReport({
        folder: row.folder,
        names: row.names,
        species: loadoutSpecies(row.folder),
        anim: body.anim,
        techTable: S.techTable,
        skills: S.skills,
        sounds: S.sounds,
      });
      const oddLines = report.odd.flatMap((line) => wrapText(line, cols));
      const oddTop = bottom - 6 - oddLines.length * 10;
      ctx.font = "bold 13px monospace";
      ctx.fillStyle = "#ffd34d";
      for (const line of wrapText(report.title, cols)) {
        ctx.fillText(line, dx + 2, ty);
        ty += 15;
      }
      ctx.font = "9px monospace";
      ctx.fillStyle = "#8a93a8";
      for (const line of wrapText(report.sub, cols)) {
        ctx.fillText(line, dx + 2, ty);
        ty += 11;
      }
      ty += 4;
      ctx.fillStyle = "#6fd0a8";
      if (ty < oddTop - 12) {
        ctx.fillText("MOVES OF THE SPECIES THAT PLAYS THIS BODY", dx + 2, ty);
        ty += 12;
      }
      ctx.fillStyle = "#d8e2f0";
      for (const line of report.moves.flatMap((l) => wrapText(l, cols))) {
        if (ty > oddTop - 12) break;
        ctx.fillText(line, dx + 2, ty);
        ty += 10;
      }
      ty += 3;
      if (ty < oddTop - 12) {
        ctx.fillStyle = "#6fd0a8";
        ctx.fillText("PER CLIP — the body's own action script", dx + 2, ty);
        ty += 12;
      }
      ctx.fillStyle = "#c8d2e2";
      const clipLines = report.clips.flatMap((l) => wrapText(l, cols));
      let shown = 0;
      for (const line of clipLines) {
        if (ty > oddTop - 20) break;         // keep one line for the "+N more" notice
        ctx.fillText(line, dx + 2, ty);
        ty += 10;
        shown++;
      }
      if (shown < clipLines.length) {
        ctx.fillStyle = "#5f6b80";
        ctx.fillText(`+${clipLines.length - shown} more lines`, dx + 2, Math.min(ty, oddTop - 10));
      }
      ctx.font = "9px monospace";
      ctx.fillStyle = "#9fd0ff";
      let oy = oddTop;
      for (const line of oddLines) {
        ctx.fillText(line, dx + 2, oy);
        oy += 10;
      }
    }
  }

  ctx.font = "10px monospace";
  ctx.fillStyle = "#7a90b0";
  ctx.textAlign = "left";
  ctx.fillText("L1 / R1: tab    Left / Right: page    Up / Down: body    Cross / Start: close", left, bottom + 8);
  ctx.restore();
  return true;
}

/**
 * One clip row's detail as ready-to-draw strings (pure; the draw uses it). The family line
 * gives the group's real id range, and the packs line never rounds a zero away.
 */
function clipsDetailLines(row) {
  if (!row) return null;
  const group = CLIP_NAMES_62.filter((r) => r.family === row.family);
  const first = group[0]?.id ?? row.id;
  const last = group[group.length - 1]?.id ?? row.id;
  return {
    name: `${row.jp}  (engine id ${row.id})`,
    en: row.en,
    family: group.length > 1 ? `Family ${row.family} — clips ${first}..${last}` : `Family ${row.family} — this one clip`,
    table: `Timeline table ${row.table} of the body's 62-entry timeline`,
    packs: row.packs === 0
      ? "0 of the 249 model packs author this table"
      : `${row.packs} of the 249 model packs author this table`,
  };
}

/**
 * The CLIPS tab: the developers' own 62 animation names on the left, one row per animation
 * with its engine id, timeline table, gloss and pack count; the open row's own facts on the
 * right; the caveat across the top, because the id join is still needs_evidence.
 */
function drawClips(ctx, W, H) {
  const x = Math.round(W * 0.03);
  const y = Math.round(H * 0.02);
  const w = W - 2 * x;
  const h = H - 2 * y;
  const left = x + 14;
  const right = x + w - 16;
  const pages = CLIP_PAGES;
  const pageRows = pages[S.page] ?? [];

  ctx.save();
  ctx.fillStyle = "rgba(4,6,12,0.96)";
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = "#c9a54a";
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, w, h);
  ctx.strokeStyle = "rgba(201,165,74,0.35)";
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 5, y + 5, w - 10, h - 10);
  ctx.textBaseline = "top";
  ctx.textAlign = "left";

  ctx.font = "bold 16px monospace";
  ctx.fillStyle = "#ffd34d";
  ctx.fillText("DIGIMON CODEX", left, y + 12);
  ctx.font = "11px monospace";
  ctx.fillStyle = "#8a93a8";
  ctx.fillText("CLIPS — the developers' own 62 animation names", left + 172, y + 17);
  ctx.textAlign = "right";
  ctx.fillStyle = "#9fd0ff";
  ctx.fillText(`${Math.min(S.page + 1, Math.max(pages.length, 1))} / ${pages.length}`, right, y + 16);
  ctx.textAlign = "left";
  drawTabs(ctx, left, y + 31, right);

  // the header caveat: what the id list does and does not settle
  const caveatCols = Math.max(32, Math.floor((right - left) / 5.4));
  let cy = y + 58;
  ctx.font = "9px monospace";
  ctx.fillStyle = "#6fd0a8";
  ctx.fillText("THE CAVEAT", left, cy);
  cy += 12;
  ctx.fillStyle = "#9fd0ff";
  const sentences = CLIP_ID_CAVEAT.split("; ");
  for (const sentence of sentences) {
    for (const line of wrapText(sentence, caveatCols)) {
      ctx.fillText(line, left, cy);
      cy += 11;
    }
  }
  ctx.fillStyle = "#5f6b80";
  ctx.fillText("t = timeline table in the body's anim.json · N/249 = the model packs that author it", left, cy + 2);
  cy += 15;

  const top = cy;
  const bottom = y + h - 30;
  const listX = left;
  const listW = Math.round(w * 0.36);
  const listTop = top;
  const listBottom = bottom - 18;

  // the 62 rows (24 a page), the cursor's row lit
  const rowH = Math.floor((listBottom - listTop) / Math.max(pageRows.length, 1));
  const lh = Math.max(11, Math.min(14, rowH));
  ctx.font = "10px monospace";
  let ry = listTop;
  for (let i = 0; i < pageRows.length; i++) {
    const entry = pageRows[i];
    const hit = i === S.cursor;
    if (hit) {
      ctx.fillStyle = "rgba(201,165,74,0.22)";
      ctx.fillRect(listX - 2, ry - 2, listW - 4, lh);
    }
    ctx.fillStyle = hit ? "#ffe9a8" : entry.packs === 0 ? "#7a90b0" : "#c8d2e2";
    ctx.fillText(`${hit ? ">" : " "} ${String(entry.id).padStart(2, "0")} ${entry.jp}  t${entry.table} ${entry.packs}/249`, listX, ry);
    ry += lh;
  }
  ctx.font = "9px monospace";
  ctx.fillStyle = "#5f6b80";
  ctx.fillText(`62 names, ids 1..62 · ${CLIP_NAMES_62.length - CLIP_NAMES_62.filter((r) => r.packs > 0).length} tables no pack authors`, listX, bottom - 2);

  // the open animation (right)
  const dx = listX + listW + 14;
  const dw = right - dx;
  ctx.strokeStyle = "rgba(201,165,74,0.35)";
  ctx.strokeRect(dx - 8, listTop, dw, bottom - listTop);
  const row = pageRows[Math.max(0, Math.min(S.cursor, pageRows.length - 1))];
  const d = clipsDetailLines(row);
  if (d) {
    const cols = Math.max(24, Math.floor(dw / 5.3));
    let ty = listTop + 6;
    ctx.font = "bold 14px monospace";
    ctx.fillStyle = "#ffd34d";
    for (const line of wrapText(d.name, cols)) {
      ctx.fillText(line, dx + 2, ty);
      ty += 16;
    }
    ctx.font = "10px monospace";
    ctx.fillStyle = "#c8d2e2";
    for (const line of wrapText(d.en, cols)) {
      ctx.fillText(line, dx + 2, ty);
      ty += 12;
    }
    ty += 6;
    const label = (text) => {
      ctx.font = "9px monospace";
      ctx.fillStyle = "#6fd0a8";
      ctx.fillText(text, dx + 2, ty);
      ty += 12;
      ctx.font = "10px monospace";
      ctx.fillStyle = "#d8e2f0";
    };
    label("GROUP");
    ctx.fillText(d.family, dx + 2, ty); ty += 15;
    label("TIMELINE");
    ctx.fillText(d.table, dx + 2, ty); ty += 15;
    label("AUTHORED BY");
    ctx.fillStyle = row.packs === 0 ? "#ff9a8a" : "#d8e2f0";
    for (const line of wrapText(d.packs, cols)) {
      ctx.fillText(line, dx + 2, ty);
      ty += 12;
    }
    ty += 6;
    ctx.font = "9px monospace";
    ctx.fillStyle = "#5f6b80";
    for (const line of wrapText("The name is the tool's own label. The table and the pack count come from the shipped anim.json files.", cols)) {
      ctx.fillText(line, dx + 2, ty);
      ty += 11;
    }
  }

  // controls, in the book's own margin
  ctx.font = "10px monospace";
  ctx.fillStyle = "#7a90b0";
  ctx.textAlign = "left";
  ctx.fillText("L1 / R1: tab    Left / Right: page    Up / Down: name    Cross / Start: close", left, bottom + 8);
  ctx.restore();
  return true;
}

/**
 * Draw the book over the whole view. `page` is a page index, a page (array of rows), or null for
 * the page the pad is on. `W`/`H` are the canvas box (640x480 in the game), so the panel also
 * reads correctly in a smaller test canvas. Returns false when the book is closed.
 */
export function codexDraw(ctx, page = null, W = 640, H = 480) {
  if (!S.open) return false;
  if (S.tab === "encounters") return drawEncounters(ctx, W, H);
  if (S.tab === "clips") return drawClips(ctx, W, H);
  if (S.tab === "loadout") return drawLoadout(ctx, W, H);
  const tabName = S.tab;
  if (!tabRows().length) {
    drawEmpty(ctx, W, H, S.error ? `The book could not be opened: ${S.error}` : "Opening the book…");
    return true;
  }

  let rows;
  let index;
  if (Array.isArray(page)) {
    rows = page;
    index = S.page;
  } else if (Number.isInteger(page)) {
    rows = tabPages()[page] ?? [];
    index = page;
  } else {
    rows = codexPageRows();
    index = S.page;
  }
  if (!rows.length) {
    drawEmpty(ctx, W, H, "This page is empty.");
    return true;
  }

  const x = Math.round(W * 0.03);
  const y = Math.round(H * 0.02);
  const w = W - 2 * x;
  const h = H - 2 * y;
  const left = x + 14;

  ctx.save();
  // the page
  ctx.fillStyle = "rgba(4,6,12,0.96)";
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = "#c9a54a";
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, w, h);
  ctx.strokeStyle = "rgba(201,165,74,0.35)";
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 5, y + 5, w - 10, h - 10);
  ctx.textBaseline = "top";
  ctx.textAlign = "left";

  // header
  ctx.font = "bold 16px monospace";
  ctx.fillStyle = "#ffd34d";
  ctx.fillText("DIGIMON CODEX", left, y + 12);
  ctx.font = "11px monospace";
  ctx.fillStyle = "#8a93a8";
  ctx.fillText(tabName === "wild" ? "WILD — every real wild record" : "PARTNERS — every form the game can hold", left + 172, y + 17);
  ctx.textAlign = "right";
  ctx.fillStyle = "#9fd0ff";
  ctx.fillText(`${index + 1} / ${tabPages().length}`, x + w - 16, y + 16);
  ctx.textAlign = "left";

  // the section's tab strip, the one that is up lit and underlined
  drawTabs(ctx, left, y + 31, x + w - 16);

  const top = y + 50;
  const bottom = y + h - 30;

  // ---- the roster (left): the page's rows, the cursor's row lit
  const listX = left;
  const listW = Math.round(w * 0.36);
  const rowH = Math.floor((bottom - top - 22) / Math.max(rows.length, 1));
  const lh = Math.max(11, Math.min(14, rowH));
  ctx.font = "10px monospace";
  let ry = top + 18;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const hit = i === S.cursor;
    if (hit) {
      ctx.fillStyle = "rgba(201,165,74,0.22)";
      ctx.fillRect(listX - 2, ry - 2, listW - 4, lh);
    }
    const tag = tabName === "wild"
      ? `${hit ? ">" : " "} ${String(r.number).padStart(3, "0")} ${r.name}`
      : `${hit ? ">" : " "} ${String(r.id).padStart(3, "0")} ${r.name}${r.added ? " +" : ""}`;
    ctx.fillStyle = hit ? "#ffe9a8" : tabName === "wild" ? "#c8d2e2" : r.added ? "#9ad0a8" : "#c8d2e2";
    ctx.fillText(tag, listX, ry);
    ry += lh;
  }
  ctx.font = "9px monospace";
  ctx.fillStyle = "#5f6b80";
  ctx.fillText(tabName === "wild" ? "193 real records, the Null placeholder skipped" : "+ new species", listX, bottom - 2);

  // ---- the open record (right)
  const dx = listX + listW + 14;
  const dw = x + w - 16 - dx;
  ctx.strokeStyle = "rgba(201,165,74,0.35)";
  ctx.strokeRect(dx - 8, top, dw, bottom - top);
  const row = rows[Math.max(0, Math.min(S.cursor, rows.length - 1))];
  if (tabName === "wild") drawWildDetail(ctx, row, dx + 2, top);
  else drawPartnerDetail(ctx, row, dx + 2, top);

  // controls, in the book's own margin
  ctx.font = "10px monospace";
  ctx.fillStyle = "#7a90b0";
  ctx.textAlign = "left";
  ctx.fillText("L1 / R1: tab    Left / Right: page    Up / Down: row    Cross / Start: close", left, bottom + 8);
  ctx.restore();
  return true;
}

// Browser-only debug hook: what the page is showing right now (console: __codex.page()).
if (typeof window !== "undefined") {
  window.__codex = {
    open: () => S.open,
    tab: () => S.tab,
    page: () => S.page,
    pages: () => tabPages().length,
    cursor: () => S.cursor,
    row: () => codexPageRows()[S.cursor] ?? null,
    rows: () => tabRows(),
    wild: () => S.wild,
    wildSearch: (text) => wildSearch(S.wild, text),
    encounters: () => S.enc?.rows ?? [],
    encounterSpecies: (text) => encounterSpecies(S.enc, text),
    encounterSearch: (text) => encounterSearch(S.enc, text),
    entry: () => codexPageRows()[S.cursor] ?? null,
    query: () => S.encQuery,
    type: (text) => codexType(text),
    loadout: () => S.loadoutRows,
    clips: () => CLIP_NAMES_62,
    body: () => S.body,
    loadBody: () => codexLoadoutBody(),
    error: () => S.error,
    reload: () => codexLoad(),
  };
}
