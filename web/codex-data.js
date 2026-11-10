// web/codex-data.js - the data half of the retired Digimon Codex screen: pure row builders
// that turn the game tables into rows. No DOM, no fetch, no state, no drawing.
//
//   partnerRows / lineTargets   digimon.json (+ evolutions.json) -> one row per partner profile
//   wildRows / wildSearch       enemies.json -> one row per real wild record (193, minus the `Null` placeholder)
//   encounterIndex / ...        stage_encounters.json + field_encounters.json -> every real encounter roll
//   dropIndex / dropItems / dropEntry / dropSearch / dropOdds / enemyStages / itemByName
//                               item -> droppers (enemy, rate, the disc's odds) -> stages; the item's own record
//
// web/glossary-digimon.js reads these rows; the future glossary ITEMS page reads the drop index.
// The odds are the disc's, not a percentage: a rate byte of 128 means 129 in 1024 per win.

const DISC_LAST_ID = 55;          // digimon.json ships ids 1..55; extra_species.json starts at 56
const ELEMENTS = ["fire", "water", "ice", "wind", "thunder", "machine", "dark"];
const STATUSES = ["poison", "paralyze", "confuse", "sleep", "ko"];
const WILD_STATS = ["str", "def", "spt", "wis", "spd"];   // the enemy record's five core stats (no CHR)

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

/** The drop as the page prints it: the disc's `Null` placeholder means no item. */
export function dropText(row) {
  const name = row?.drop ?? "Null";
  return name === "Null" ? "none" : name;
}

// --------------------------------------------------------------- drop finder

/** Plain code-unit order, so the list is the same on every machine. */
const nameOrder = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The disc's drop odds for one rate byte: the fight rolls `rate + 1` in 1024, so the
 * byte 128 is 129 in 1024 per win, never "12.8%". Pure.
 */
export function dropOdds(rate) {
  return { n: (Number(rate) || 0) + 1, of: 1024 };
}

/** Every stage number a species' real encounter pools can roll, ascending. Pure. */
export function enemyStages(stageIndex, enemy) {
  const rows = stageIndex?.bySpecies instanceof Map ? stageIndex.bySpecies.get(enemy) ?? [] : [];
  const stages = [];
  for (const row of rows) {
    const stage = Number(row?.stage);
    if (Number.isFinite(stage) && !stages.includes(stage)) stages.push(stage);
  }
  return stages.sort((a, b) => a - b);
}

/**
 * Every real dropped item in an enemies.json-shaped table (`{enemies: [...]}` or the array
 * itself), indexed by item name:
 *
 *   byItem: Map<item, {droppers: [{enemy, rate, odds}], stages: [stage, ...]}>
 *
 * The disc's one `Null` placeholder and the eight Cardmon rows are skipped, as is every
 * enemy whose `drop_item` is the `Null` placeholder: those 92 rows name the 78 real items.
 * A dropper's `odds` is `{n: rate + 1, of: 1024}` (the fight's own roll, not a percentage),
 * and the entry's `stages` is the union of its droppers' real pools from `stageIndex`
 * (part 3's encounterIndex). Nothing is invented: no pool means an empty stage list. Pure.
 */
export function dropIndex(enemies, stageIndex = null) {
  const list = Array.isArray(enemies) ? enemies : Array.isArray(enemies?.enemies) ? enemies.enemies : [];
  const byItem = new Map();
  for (const e of list) {
    const enemy = typeof e?.enemy_id === "string" ? e.enemy_id : "";
    const item = typeof e?.drop_item === "string" ? e.drop_item : "Null";
    if (!enemy || enemy === "Null" || /^Cardmon\d*$/.test(enemy)) continue;  // placeholder + Cardmon rows
    if (item === "Null") continue;                                           // this enemy drops nothing
    const rate = Number(e.drop_rate) || 0;
    let entry = byItem.get(item);
    if (!entry) {
      entry = { droppers: [], stages: [] };
      byItem.set(item, entry);
    }
    entry.droppers.push({ enemy, rate, odds: dropOdds(rate) });
    for (const stage of enemyStages(stageIndex, enemy)) {
      if (!entry.stages.includes(stage)) entry.stages.push(stage);
    }
  }
  for (const entry of byItem.values()) entry.stages.sort((a, b) => a - b);
  return { byItem };
}

/** The item names the index holds, alphabetically. Pure. */
export function dropItems(index) {
  const names = index?.byItem instanceof Map ? [...index.byItem.keys()] : [];
  return names.sort(nameOrder);
}

/**
 * One item's entry as the tab lists it: `{item, droppers, stages}`, or null for a name the
 * index does not hold. The lookup ignores case and surrounding spaces. Pure.
 */
export function dropEntry(index, item) {
  if (!(index?.byItem instanceof Map)) return null;
  const wanted = String(item ?? "").trim();
  if (!wanted) return null;
  const name = dropItems(index).find((n) => n.toLowerCase() === wanted.toLowerCase());
  if (!name) return null;
  const entry = index.byItem.get(name);
  return { item: name, droppers: entry.droppers, stages: entry.stages };
}

/**
 * The item entries matching `query`: an exact name (ignoring case and spaces) wins outright,
 * otherwise every name containing the text; an empty query is every item. An invented item
 * is an empty list, never a made-up row. Pure.
 */
export function dropSearch(index, query = "") {
  const names = dropItems(index);
  const q = String(query ?? "").trim().toLowerCase();
  if (!q) return names.map((n) => dropEntry(index, n));
  const exact = names.filter((n) => n.toLowerCase() === q);
  const hit = exact.length ? exact : names.filter((n) => n.toLowerCase().includes(q));
  return hit.map((n) => dropEntry(index, n));
}

/**
 * One item's record from items.json (`{catalog, items}` — the 402 key items and the 83
 * consumables — or a bare array). Both lists are name sources; the richer `items` record
 * wins when a name is in both. An unknown name is null, never a guessed record. Pure.
 */
export function itemByName(items, name) {
  const wanted = String(name ?? "").trim();
  if (!wanted) return null;
  const list = Array.isArray(items)
    ? items
    : [
      ...(Array.isArray(items?.catalog) ? items.catalog : []),
      ...(Array.isArray(items?.items) ? items.items : []),
    ];
  let found = null;
  for (const record of list) {
    if (!record || typeof record.name !== "string") continue;
    if (record.name === wanted) found = record;
    else if (!found && record.name.toLowerCase() === wanted.toLowerCase()) found = record;
  }
  return found;
}
