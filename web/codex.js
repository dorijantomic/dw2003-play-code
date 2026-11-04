// web/codex.js — the Digimon Codex, part 1: the book and the partner pages;
// part 2: the wild pages.
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
// OFF unless F2 -> Extras -> "Digimon Codex (new)" is switched on (web/ambience.js).
// It opens on that switch's rising edge, owns the pad while it is up (L1/R1 tab,
// Left/Right page, Up/Down row, Cross/Start close) and draws over everything. With
// the switch off nothing exists and the frame loop pays one comparison. The module is
// DOM-free at the top level so node tests import it; drawing takes a canvas context.

const DISC_LAST_ID = 55;          // digimon.json ships ids 1..55; extra_species.json starts at 56
const PER_PAGE = 24;              // rows on one book page
const ELEMENTS = ["fire", "water", "ice", "wind", "thunder", "machine", "dark"];
const STATUSES = ["poison", "paralyze", "confuse", "sleep", "ko"];
const ELEMENT_LABELS = { fire: "Fire", water: "Water", ice: "Ice", wind: "Wind", thunder: "Thunder", machine: "Machine", dark: "Dark" };
const STATUS_LABELS = { poison: "Poison", paralyze: "Paralyze", confuse: "Confuse", sleep: "Sleep", ko: "KO" };
const WILD_STATS = ["str", "def", "spt", "wis", "spd"];   // the enemy record's five core stats (no CHR)
const TAB_NAMES = ["partners", "wild"];

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
  models: null,         // model_map.json: species -> model folder
  skills: new Map(),
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
  S.models = null;
  S.skills = new Map();
  S.evolutions = null;
  S.lineByRoot = new Map();
  S.linesOf = new Map();
  S.loading = null;
  S.error = null;
}

/**
 * Install the loaded tables (the browser load and the node test both land here).
 * `enemies` is enemies.json (the whole object or its array), `models` model_map.json;
 * both are optional so a partner-only caller keeps working.
 */
export function setCodexData(digimon, evolutions, enemies = null, models = null) {
  const rows = partnerRows(digimon, Array.isArray(digimon) ? [] : digimon?.skills);
  S.rows = rows;
  S.pages = codexPages(rows, PER_PAGE);
  S.page = 0;
  S.cursor = 0;
  S.tab = "partners";
  S.skills = new Map((Array.isArray(digimon) ? [] : digimon?.skills ?? []).map((s) => [s.id, s]));
  S.evolutions = evolutions;
  S.models = models && typeof models === "object" ? models : null;
  const enemyList = Array.isArray(enemies) ? enemies : enemies?.enemies ?? [];
  S.wild = wildRows(enemyList, S.skills, S.models);
  S.wildPages = codexPages(S.wild, PER_PAGE);

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
 * tables (enemies.json + model_map.json) ride the same load. Cached per book load.
 * `fetchJson` is injectable for tests.
 */
export function codexLoad(fetchJson = globalThis.fetch) {
  if (S.loading) return S.loading;
  if (typeof fetchJson !== "function") return Promise.resolve(false);
  S.loading = (async () => {
    try {
      const [digimon, evolutions, enemies, models] = await Promise.all([
        Promise.resolve(fetchJson("assets/data/digimon.json")).then(asJson),
        Promise.resolve(fetchJson("assets/data/evolutions.json")).then(asJson),
        Promise.resolve(fetchJson("assets/data/enemies.json")).then(asJson),
        Promise.resolve(fetchJson("assets/battle/model_map.json")).then(asJson),
      ]);
      setCodexData(digimon, evolutions, enemies, models);
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

/** Is the book up? (web/game.js freezes the field and routes the pad to it while true.) */
export function codexOpen() {
  return S.open;
}

/** Which half of the book is up: "partners" or "wild". */
export function codexTab() {
  return S.tab;
}

/** The pages of the tab that is up. */
function tabPages() {
  return S.tab === "wild" ? S.wildPages : S.pages;
}
/** The rows of the tab that is up. */
function tabRows() {
  return S.tab === "wild" ? S.wild : S.rows;
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
    if (!S.rows.length && !S.loading) codexLoad();
  } else if (!on && S.wasOn) {
    S.open = false;
  }
  S.wasOn = on;
  return S.open;
}

/** Turn to the next/previous half of the book, landing on its first row of its first page. */
function switchTab(delta) {
  const i = (TAB_NAMES.indexOf(S.tab) + delta + TAB_NAMES.length) % TAB_NAMES.length;
  S.tab = TAB_NAMES[i];
  S.page = 0;
  S.cursor = 0;
}

function setPage(page) {
  const n = tabPages().length;
  if (!n) return;
  S.page = ((page % n) + n) % n;
  const rows = codexPageRows();
  S.cursor = Math.max(0, Math.min(S.cursor, rows.length - 1));
}

function moveCursor(delta) {
  const rows = codexPageRows();
  if (!rows.length) return;
  const next = S.cursor + delta;
  if (next < 0 && S.page > 0) {
    setPage(S.page - 1);
    S.cursor = codexPageRows().length - 1;
    return;
  }
  if (next >= rows.length && S.page < tabPages().length - 1) {
    setPage(S.page + 1);
    S.cursor = 0;
    return;
  }
  S.cursor = Math.max(0, Math.min(rows.length - 1, next));
}

/**
 * The pad while the book is up: L1/R1 turn between the partner and the wild half,
 * Left/Right turn a page (wrapping), Up/Down move the row cursor (walking over a page
 * edge), Cross/Start close it, every other press is swallowed. Returns false when the
 * book is closed, so the press falls through exactly as before.
 */
export function codexPress(button) {
  if (!S.open) return false;
  if (button === "l1") switchTab(-1);
  else if (button === "r1") switchTab(1);
  else if (button === "left") setPage(S.page - 1);
  else if (button === "right") setPage(S.page + 1);
  else if (button === "up") moveCursor(-1);
  else if (button === "down") moveCursor(1);
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

/**
 * Draw the book over the whole view. `page` is a page index, a page (array of rows), or null for
 * the page the pad is on. `W`/`H` are the canvas box (640x480 in the game), so the panel also
 * reads correctly in a smaller test canvas. Returns false when the book is closed.
 */
export function codexDraw(ctx, page = null, W = 640, H = 480) {
  if (!S.open) return false;
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

  // the two tabs, the one that is up lit and underlined
  ctx.font = "bold 11px monospace";
  ctx.fillStyle = tabName === "partners" ? "#ffd34d" : "#5f6b80";
  ctx.fillText("PARTNERS", left, y + 31);
  ctx.fillStyle = "#3d4658";
  ctx.fillText("|", left + 62, y + 31);
  ctx.fillStyle = tabName === "wild" ? "#ffd34d" : "#5f6b80";
  ctx.fillText("WILD", left + 74, y + 31);
  ctx.fillStyle = "#ffd34d";
  ctx.fillRect(tabName === "partners" ? left : left + 72, y + 42, tabName === "partners" ? 53 : 30, 2);
  ctx.font = "9px monospace";
  ctx.fillStyle = "#5f6b80";
  ctx.textAlign = "right";
  ctx.fillText("L1 / R1: tab", x + w - 16, y + 32);
  ctx.textAlign = "left";

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
  ctx.fillText("L1 / R1: partner / wild    Left / Right: page    Up / Down: row    Cross / Start: close", left, bottom + 8);
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
    error: () => S.error,
    reload: () => codexLoad(),
  };
}
