// web/damage-lab.js — the Damage Lab, part 1: the disc's damage pipeline, walked
// stage by stage.
//
// One page, one hit. You pick your form, an enemy, a technique, a field, the crit
// roll and the defender's armour, and the page prints what each stage of the real
// damage tail did to the running number:
//
//   1 base      physicalBase (STR x power / DEF) or magicalBase (the SPT curve)
//   2 field     the elemental field's bonus / penalty on the base
//   3 family    a technique- or weapon-family match adds half (physical records)
//   4 affinity  the attacker's charged +0x26 byte adds running x byte / 64
//   5 element   the target's resistance: the magical curve or the physical
//               2 x running x scalar / element term
//   6 special-op a Multi Crest plain attack's x2/5 (0.4x) special-op scale
//   7 crit      the disc's crit roll, and the 32..95 / 64 extra it pays
//   8 armour    the defender's flat armour, then the 5 x base and 9999 caps
//
// Every number comes from the same leaves the battle calls
// (engine/dw3/battle-formulas.ts, bundled into web/vendor/engine.js — the page is
// plain ES modules in the browser and cannot import a .ts file): physicalBase,
// magicalBase, resolveDamage, elementalFieldAdjustment, critProc,
// magicalCritProc and multiCrestPlainAttack. The node tests import the .ts module
// directly and hold the page to it, fixture by fixture.
//
// OFF unless F2 -> Extras -> "Damage Lab (new)" is switched on (web/ambience.js).
// With the switch off there is no page, no data fetch and no key handling. The
// module is DOM-free at the top level: node imports it, and drawing takes a canvas
// context.

import {
  physicalBase,
  magicalBase,
  resolveDamage,
  formulas,
} from "./vendor/engine.js";

export { physicalBase, magicalBase, resolveDamage };

const { elementalFieldAdjustment, critProc, magicalCritProc, multiCrestPlainAttack, magicalElementalFactor } = formulas;

const ELEMENTS = ["fire", "water", "ice", "wind", "thunder", "machine", "dark"];
const FIELD_POWER = 64;   // the field techniques' own +0x0C byte (records 213..219)

const num = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
};

/**
 * Walk one hit through the disc's eight damage stages. Pure; `rng` is the roll
 * stream (RAND_U16 scale in the game, any 16-bit function here). `multiCrest` is the
 * attacker's effective +0x37 gate (the Multi Crest item). Returns:
 *
 *   stages  [{ name, value, note }] — `value` is the running damage after that
 *           stage, so the last entry is `total`
 *   total   what lands (the same number `resolveDamage` returns for the fixture)
 *
 * The walk mirrors `resolveDamage` line for line; tests/damage-lab.test.js holds the
 * two together for every one of the disc's 443 technique records.
 */
export function damageStages({ atk = {}, def = {}, skill = {}, field = null, rng = Math.random, multiCrest = false } = {}) {
  const A = { ...atk };
  for (const key of ["str", "def", "spt", "wis", "spd"]) if (A[key] == null) A[key] = 0;
  A.multiAttack = atk?.multiAttack ?? (multiCrest === true);
  const D = { ...def };
  for (const key of ["str", "def", "spt", "wis", "spd"]) if (D[key] == null) D[key] = 0;
  const S = { ...skill };
  const power = num(S.power);
  const magical = !!S.magical;
  const base = magical ? magicalBase(A, D, power) : physicalBase(A, D, power);
  const stages = [];
  let running = base;

  // 1 — base
  if (magical) {
    const mid = Math.floor((50 * num(A.spt)) / Math.max(1, num(D.spt))) + 50;
    stages.push({
      name: "base",
      value: running,
      note: `SPT ${num(A.spt)} vs the target's ${num(D.spt)}: mid ${mid}, power ${power} -> `
        + `${Math.floor((power * mid) / 100)}, held to ${Math.floor(power / 2)}..${power * 2} = ${base}`,
    });
  } else {
    stages.push({
      name: "base",
      value: running,
      note: `STR ${num(A.str)} x power ${power} / DEF ${Math.max(1, num(D.def))} = ${base}`,
    });
  }

  // 2 — field
  const fieldAdj = elementalFieldAdjustment(base, S.element, field);
  running += fieldAdj;
  let fieldNote;
  const element = S.element && S.element !== "normal" ? S.element : null;
  if (!field || num(field.power) <= 0) {
    fieldNote = "no elemental field: the base is unchanged";
  } else if (!element) {
    fieldNote = "a non-elemental technique ignores the field: unchanged";
  } else if (fieldAdj > 0) {
    fieldNote = `${field.element} field ${num(field.power)}: +base x ${num(field.power)} / 128 = +${fieldAdj}`;
  } else if (fieldAdj < 0) {
    fieldNote = `${field.element} field ${num(field.power)}: the opposing element, -base x ${num(field.power)} / 256 = ${fieldAdj}`;
  } else {
    fieldNote = `${field.element} field ${num(field.power)}: neither this technique's element nor its opposite: unchanged`;
  }
  stages.push({ name: "field", value: running, note: fieldNote });

  // 3 — family (physical). The magical arm's bonus lands after the element stage
  // (the engine's own order), so here it only explains itself.
  const familyBefore = running;
  let familyNote;
  if (magical) {
    familyNote = "a magical technique takes its family bonus after the element stage";
  } else {
    const targetFamily = num(S.target_family);
    let arm = null;
    if (targetFamily >= 2) {
      if (targetFamily === num(D.family)) arm = { kind: "technique", tag: targetFamily };
    } else {
      for (const tag of (A.weaponFamilies ?? []).slice(0, 3)) {
        if (num(tag) >= 2 && num(tag) === num(D.family)) { arm = { kind: "weapon", tag: num(tag) }; break; }
      }
    }
    if (arm) {
      running += (running + (running >>> 31)) >> 1;
      familyNote = arm.kind === "technique"
        ? `the technique's target family ${arm.tag} is the target's family: +half (${familyBefore} -> ${running})`
        : `a worn weapon family ${arm.tag} is the target's family: +half (${familyBefore} -> ${running})`;
    } else if (targetFamily >= 2) {
      familyNote = `the technique's target family ${targetFamily} is not the target's (${num(D.family)}): unchanged`;
    } else {
      familyNote = "no technique family and no worn weapon family matches: unchanged";
    }
  }
  stages.push({ name: "family", value: running, note: familyNote });

  // 4 — affinity (physical only)
  const affinityBefore = running;
  const affinity = num(A.affinity);
  if (!magical && affinity) {
    running += Math.trunc((running * affinity) / 64);
    stages.push({
      name: "affinity",
      value: running,
      note: `the attacker's charged affinity ${affinity}: +running x ${affinity} / 64 (${affinityBefore} -> ${running})`,
    });
  } else {
    stages.push({
      name: "affinity",
      value: running,
      note: magical
        ? "a magical technique takes no affinity stage"
        : "the attacker carries no charged affinity: unchanged",
    });
  }

  // 5 — element
  const elementBefore = running;
  let elementNote;
  if (!element) {
    elementNote = "a normal technique carries no element stage";
  } else if (magical) {
    const raw = num(D.resistances?.[element] ?? 100);
    const factor = magicalElementalFactor(raw);
    running = Math.trunc((running * factor) / 100);
    elementNote = `the target's ${element} resistance ${raw}: x${factor} / 100 (${elementBefore} -> ${running})`;
  } else if (D.resistances) {
    const raw = Math.max(1, num(D.resistances?.[element] ?? 100));
    const scalar = num(S.damage_scalar);
    const delta = Math.trunc((2 * running * scalar) / raw);
    running += delta;
    elementNote = `the target's ${element} resistance ${raw}, scalar ${scalar}: +2 x ${elementBefore} x ${scalar} / ${raw} = +${delta}`;
  } else {
    elementNote = "the target carries no resistance table: unchanged";
  }
  // The engine's own statement, outside the element branch: a magical technique whose
  // family matches the target's gains half AFTER the element curve (F0x8009fab4).
  if (magical) {
    const targetFamily = num(S.target_family);
    if (targetFamily >= 2 && targetFamily === num(D.family)) {
      const beforeFamily = running;
      running += Math.trunc(running / 2);
      elementNote += `; the matching target family ${targetFamily} adds half (${beforeFamily} -> ${running})`;
    }
  }
  stages.push({ name: "element", value: running, note: elementNote });

  // 6 — special op (Multi Crest plain attack x2/5)
  const specialBefore = running;
  // Every physical row with dispatch < 2 takes it (F0x8009f6dc 0x8009f868-0x8009f8c0), not
  // only basic attacks; the magical leaf never reaches this stage.
  const special = !magical && multiCrestPlainAttack(!!A.multiAttack, S);
  if (special) {
    running = Math.trunc((running * 2) / 5);
    stages.push({
      name: "special-op",
      value: running,
      note: `Multi Crest plain attack: x2/5 (0.4x), ${specialBefore} -> ${running}`,
    });
  } else {
    stages.push({
      name: "special-op",
      value: running,
      note: A.multiAttack && !magical && num(S.effect_id) < 2
        ? "Multi Crest is on, but this record's clip is 0x0b or 0x0c: one full hit"
        : "not a Multi Crest plain attack: unchanged",
    });
  }

  // 7 — crit (the disc's own roll; a forced stream can land or miss it)
  const critBefore = running;
  let critRoll = null;
  const capture = () => {
    const value = rng();
    if (critRoll === null) critRoll = value;
    return value;
  };
  const critical = magical ? magicalCritProc(A, D, S, capture) : critProc(A, D, S, capture);
  let critNote;
  if (critical) {
    // physical leaf: (RAND & 0x3f) + 0x20; magical leaf (0x8009fd54-0x8009fda4): RAND % 65 + 0x20
    const r = (magical ? rng() % 65 : rng() & 0x3f) + 0x20;
    running += Math.floor((running * r) / 64);
    critNote = `roll ${critRoll & 0x7f}: crit, +${r}/64 (${critBefore} -> ${running})`;
  } else {
    critNote = `roll ${critRoll & 0x7f}: no crit`;
  }
  stages.push({ name: "crit", value: running, note: critNote });

  // 8 — armour, then the two caps
  const armourBefore = running;
  const armour = num(D.armor);
  if (armour) {
    running -= armour;
    if (running <= 0) running = 0;
  }
  const cap = 5 * base;
  let capNote = "";
  if (running > cap) {
    running = cap;
    capNote = `; capped at 5 x base = ${cap}`;
  }
  if (running >= 10000) {
    running = 9999;
    capNote = `${capNote}; capped at 9999`;
  }
  if (!capNote) capNote = `; under the caps (5 x base = ${cap}, 9999)`;
  stages.push({
    name: "armour",
    value: running,
    note: armour
      ? `armour ${armour}: -${armour} (${armourBefore} -> ${Math.max(0, armourBefore - armour)})${capNote}`
      : `no armour to stop this hit${capNote}`,
  });

  return { stages, total: running };
}

// ---------------------------------------------------------------------------
// The page: the tables, the pickers, the pad and the draw.
// ---------------------------------------------------------------------------

const CATEGORY_WORDS = { 2: "physical attack", 3: "magical attack", 4: "heal or cure", 5: "stat or MP move", 6: "field technique" };
const OPTION_KEYS = ["form", "enemy", "technique", "field", "crit", "armour", "multi"];
const OPTION_LABELS = { form: "FORM", enemy: "ENEMY", technique: "TECHNIQUE", field: "FIELD", crit: "CRIT", armour: "ARMOUR", multi: "MULTI CREST" };
const CRIT_MODES = ["roll", "lands", "misses"];
const CRIT_LABELS = { roll: "roll the disc's dice", lands: "the crit lands", misses: "no crit" };
const ARMOUR_STEPS = [0, 8, 16, 32, 64];
const FIELD_LABELS = ["none (no field)", ...ELEMENTS.map((e) => `${e} field ${FIELD_POWER}`)];

const defaultRng = () => (Math.random() * 0x10000) | 0;

const S = {
  open: false,
  wasOn: false,
  loading: null,
  error: null,
  sel: 0,
  forms: [],
  enemies: [],
  techniques: [],
  pick: { form: 0, enemy: 0, technique: 0, field: 0, crit: 0, armour: 0, multi: 0 },
  result: null,
  notDamage: null,
  rng: defaultRng,
};

/** One form row from digimon.json (the profile the battle reads). */
function formRows(digimon) {
  const profiles = Array.isArray(digimon) ? digimon : digimon?.digimon ?? [];
  return profiles.map((p) => ({
    id: p.id,
    name: p.name,
    family: num(p.family),
    str: num(p.str), def: num(p.def), spt: num(p.spt), wis: num(p.wis), spd: num(p.spd),
    resistances: p.resistances ?? {},
  }));
}

/** One enemy row from enemies.json. `digimon_type` is the record's family byte. */
function enemyRows(enemies) {
  const list = Array.isArray(enemies) ? enemies : enemies?.enemies ?? [];
  return list.map((e) => ({
    id: e.enemy_id,
    name: e.enemy_id,
    family: num(e.digimon_type),
    str: num(e.str), def: num(e.def), spt: num(e.spt), wis: num(e.wis), spd: num(e.spd),
    resistances: e.resistances ?? {},
  }));
}

/**
 * One technique row from fight_tech_table.json (443 rows, 16 fields each), with the
 * skill bank's name where the disc has one and the skill-shaped fields the damage
 * leaves read: `effect_id` is the record's +0x0A opcode (`dispatch`), `effect_power`
 * its +0x0C byte (`crit`), `target_family` its +0x09 (`elem2`), `damage_scalar` its
 * +0x08 (`scalar`), `clip` its +0x10 and `hits` its +0x11 (`f14`). `basic_attack`
 * marks the plain-attack shape (opcode < 2), which is what the Multi Crest x2/5
 * special op gates on. The element name comes from the skill bank's own pairing, the
 * same id→name map web/battle.js builds.
 */
function techniqueRows(techTable, skills) {
  const list = Array.isArray(skills) ? skills : [];
  const skillById = new Map(list.map((s) => [s.id, s]));
  const elementName = {};
  for (const skill of list) {
    const rec = techTable?.[String(skill.id)];
    if (rec && skill.element) elementName[num(rec.elem1)] = skill.element;
  }
  return Object.keys(techTable ?? {})
    .map(Number)
    .sort((a, b) => a - b)
    .map((id) => {
      const rec = techTable[String(id)];
      const named = skillById.get(id) ?? null;
      const dispatch = num(rec.dispatch);
      return {
        id,
        name: named?.name ?? `Tech ${id}`,
        named: !!named,
        mp: num(rec.mp),
        power: num(rec.power),
        category: num(rec.category),
        element: elementName[num(rec.elem1)] ?? "normal",
        target_family: num(rec.elem2),
        damage_scalar: num(rec.scalar),
        effect_id: dispatch,
        effect_power: num(rec.crit),
        clip: num(rec.clip),
        hits: num(rec.f14),
        basic_attack: dispatch < 2,
      };
    });
}

function setLabData(digimon, enemies, techTable) {
  S.forms = formRows(digimon);
  S.enemies = enemyRows(enemies);
  S.techniques = techniqueRows(techTable, digimon?.skills ?? []);
  S.pick = { form: 0, enemy: 0, technique: 0, field: 0, crit: 0, armour: 0, multi: 0 };
  S.sel = 0;
  recompute();
}

const asJson = (value) => (typeof value?.json === "function" ? value.json() : value);

/**
 * Fetch and install the three tables the page reads: digimon.json (forms and the
 * skill names), enemies.json (the 194 records) and fight_tech_table.json (the 443
 * technique records). `fetchJson` is injectable for tests. Nothing is fetched with
 * the switch off — this is only called from the switch's rising edge.
 */
export function damageLabLoad(fetchJson = globalThis.fetch) {
  if (S.loading) return S.loading;
  if (typeof fetchJson !== "function") return Promise.resolve(false);
  S.loading = (async () => {
    try {
      const [digimon, enemies, techTable] = await Promise.all([
        Promise.resolve(fetchJson("assets/data/digimon.json")).then(asJson),
        Promise.resolve(fetchJson("assets/data/enemies.json")).then(asJson),
        Promise.resolve(fetchJson("assets/data/fight_tech_table.json")).then(asJson),
      ]);
      setLabData(digimon, enemies, techTable);
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

/** Is the page up? (web/game.js freezes the field and routes the pad to it while true.) */
export function damageLabOpen() {
  return S.open;
}

/** The loaded rows of one picker: "forms", "enemies" or "techniques". */
export function damageLabTable(kind) {
  if (kind === "forms") return S.forms;
  if (kind === "enemies") return S.enemies;
  if (kind === "techniques") return S.techniques;
  return [];
}

/** One row by id, or null when the id is not in that table. */
export function damageLabRow(kind, id) {
  const key = String(id);
  return damageLabTable(kind).find((row) => String(row.id) === key) ?? null;
}

/** Test/demo hook: the roll stream the page hands `damageStages` in "roll" mode. */
export function damageLabSetRng(fn) {
  S.rng = typeof fn === "function" ? fn : defaultRng;
  if (S.open) recompute();
}

/** Which technique record is selected. */
function currentTechnique() {
  return S.techniques[S.pick.technique] ?? null;
}

/** A fresh roll stream for the chosen crit pick. "lands": draw 0 (passes every
 *  roll) then 63 (the biggest crit step). "misses": draw 127, which fails every
 *  chance under 128 — a family-matched precision record whose chance reaches 128
 *  still crits, and the stage's note says so instead of lying. */
function rollStream() {
  const mode = CRIT_MODES[S.pick.crit] ?? "roll";
  if (mode === "lands") {
    let draw = 0;
    return () => (draw++ === 0 ? 0 : 63);
  }
  if (mode === "misses") {
    let draw = 0;
    return () => (draw++ === 0 ? 127 : 63);
  }
  return S.rng;
}

/** The skill object the damage leaves read, built from the selected record. */
function skillOf(row) {
  return {
    id: row.id,
    name: row.name,
    power: row.power,
    element: row.element,
    magical: row.category === 3,
    effect_id: row.effect_id,
    effect_power: row.effect_power,
    target_family: row.target_family,
    damage_scalar: row.damage_scalar,
    clip: row.clip,
    hits: row.hits,
    basic_attack: row.basic_attack,
  };
}

/** Walk the selected fight again (on open, on every pick change, on Triangle). */
function recompute() {
  S.result = null;
  S.notDamage = null;
  const form = S.forms[S.pick.form];
  const enemy = S.enemies[S.pick.enemy];
  const tech = currentTechnique();
  if (!form || !enemy || !tech) return;
  if (tech.category !== 2 && tech.category !== 3) {
    S.notDamage = `${tech.name} is a category-${tech.category} ${CATEGORY_WORDS[tech.category] ?? "record"}: `
      + "the disc's damage leaves never run on it. Pick a category 2 or 3 technique.";
    return;
  }
  const multiCrest = S.pick.multi === 1;
  const atk = {
    str: form.str, def: form.def, spt: form.spt, wis: form.wis, spd: form.spd,
    family: form.family, multiAttack: multiCrest,
  };
  const def = {
    str: enemy.str, def: enemy.def, spt: enemy.spt, wis: enemy.wis, spd: enemy.spd,
    family: enemy.family,
    resistances: enemy.resistances,
    armor: ARMOUR_STEPS[S.pick.armour] ?? 0,
  };
  const field = S.pick.field === 0 ? null : { element: ELEMENTS[S.pick.field - 1], power: FIELD_POWER };
  S.result = damageStages({ atk, def, skill: skillOf(tech), field, rng: rollStream(), multiCrest });
}

/** How many values one picker has. */
function optionLength(key) {
  switch (key) {
    case "form": return S.forms.length;
    case "enemy": return S.enemies.length;
    case "technique": return S.techniques.length;
    case "field": return ELEMENTS.length + 1;
    case "crit": return CRIT_MODES.length;
    case "armour": return ARMOUR_STEPS.length;
    case "multi": return 2;
    default: return 1;
  }
}

function changePick(key, delta) {
  const n = optionLength(key);
  if (n <= 0) return;
  S.pick[key] = ((S.pick[key] + delta) % n + n) % n;
  recompute();
}

/**
 * The pad while the page is up: Up/Down the picker row, Left/Right its value,
 * L1/R1 jump ten techniques, Triangle walks the fight again (a reroll in "roll"
 * mode), Cross/Start close, every other press is swallowed. Returns false when the
 * page is closed, so the press falls through exactly as before.
 */
export function damageLabPress(button) {
  if (!S.open) return false;
  const key = OPTION_KEYS[S.sel];
  if (button === "up") S.sel = (S.sel + OPTION_KEYS.length - 1) % OPTION_KEYS.length;
  else if (button === "down") S.sel = (S.sel + 1) % OPTION_KEYS.length;
  else if (button === "left") changePick(key, -1);
  else if (button === "right") changePick(key, 1);
  else if (button === "l1") changePick(key, -10);
  else if (button === "r1") changePick(key, 10);
  else if (button === "triangle") recompute();
  else if (button === "cross" || button === "start") S.open = false;
  return true;
}

/** Open the page (the F2 button "Open the Damage Lab"). Fetches data on first open. */
export function openDamageLab() {
  S.open = true;
  S.sel = 0;
  if (!S.forms.length && !S.loading) damageLabLoad();
  else recompute();
  return S.open;
}

/** Follow F2 -> Extras -> "Damage Lab (new)": the switch only ENABLES the page, it never opens
 *  it (openDamageLab does, from the F2 button); it closes when the switch goes off. Off means
 *  no page, no data fetch and no key handling. */
export function tickDamageLab(enabled) {
  const on = enabled === true;
  if (!on && S.open) S.open = false;
  S.wasOn = on;
  return S.open;
}

/** Wipe the page and its tables (tests, and a switch-off that forgets the load). */
export function damageLabReset() {
  S.open = false;
  S.wasOn = false;
  S.loading = null;
  S.error = null;
  S.sel = 0;
  S.forms = [];
  S.enemies = [];
  S.techniques = [];
  S.pick = { form: 0, enemy: 0, technique: 0, field: 0, crit: 0, armour: 0, multi: 0 };
  S.result = null;
  S.notDamage = null;
  S.rng = defaultRng;
}

/** The picker rows as ready-to-draw strings (pure; the draw and the tests use it). */
export function damageLabOptions() {
  const form = S.forms[S.pick.form];
  const enemy = S.enemies[S.pick.enemy];
  const tech = currentTechnique();
  return OPTION_KEYS.map((key) => {
    let value;
    if (key === "form") {
      value = form
        ? `${form.name}  STR ${form.str} DEF ${form.def} SPT ${form.spt} WIS ${form.wis} SPD ${form.spd}`
        : "opening the tables...";
    } else if (key === "enemy") {
      value = enemy ? `${enemy.name}  DEF ${enemy.def}  family ${enemy.family}` : "opening the tables...";
    } else if (key === "technique") {
      value = tech
        ? `${S.pick.technique + 1}/${S.techniques.length} ${tech.name}  power ${tech.power}  `
          + `${CATEGORY_WORDS[tech.category] ?? "record"}  ${tech.element}`
        : "opening the tables...";
    } else if (key === "field") {
      value = FIELD_LABELS[S.pick.field] ?? FIELD_LABELS[0];
    } else if (key === "crit") {
      value = CRIT_LABELS[CRIT_MODES[S.pick.crit]] ?? CRIT_LABELS.roll;
    } else if (key === "armour") {
      value = `${ARMOUR_STEPS[S.pick.armour] ?? 0}`;
    } else {
      value = S.pick.multi === 1 ? "on" : "off";
    }
    return { key, label: OPTION_LABELS[key], value };
  });
}

/** Cut a note to what one line of the page can hold. */
function shorten(text, max) {
  const s = String(text);
  return s.length > max ? `${s.slice(0, max - 3)}...` : s;
}

/** Break a sentence into lines no longer than `cols`, on spaces. */
function wrapText(text, cols) {
  const out = [];
  let line = "";
  for (const word of String(text).split(/\s+/)) {
    if (!word) continue;
    if (!line) line = word;
    else if (line.length + 1 + word.length <= cols) line += ` ${word}`;
    else { out.push(line); line = word; }
  }
  if (line) out.push(line);
  return out;
}

/**
 * Draw the page over the whole view. `W`/`H` are the canvas box (640x480 in the
 * game). Returns false when the page is closed — and then it makes no canvas call
 * at all, so the frame loop pays one comparison.
 */
export function damageLabDraw(ctx, W = 640, H = 480) {
  if (!S.open) return false;
  const x = Math.round(W * 0.03);
  const y = Math.round(H * 0.02);
  const w = W - 2 * x;
  const h = H - 2 * y;
  const left = x + 14;

  ctx.save();
  ctx.fillStyle = "rgba(4,6,12,0.97)";
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
  ctx.fillText("DAMAGE LAB", left, y + 8);
  ctx.font = "10px monospace";
  ctx.fillStyle = "#8a93a8";
  ctx.fillText("one hit, the disc's damage pipeline stage by stage", left + 176, y + 13);
  const tech = currentTechnique();
  ctx.textAlign = "right";
  ctx.fillStyle = "#9fd0ff";
  ctx.fillText(tech ? `${CATEGORY_WORDS[tech.category] ?? "record"} ${tech.id}` : "", x + w - 16, y + 13);
  ctx.textAlign = "left";

  // the pickers
  const opts = damageLabOptions();
  let ry = y + 34;
  ctx.font = "11px monospace";
  for (let i = 0; i < opts.length; i++) {
    const hit = i === S.sel;
    if (hit) {
      ctx.fillStyle = "rgba(201,165,74,0.22)";
      ctx.fillRect(left - 4, ry - 1, w - 20, 14);
    }
    ctx.fillStyle = hit ? "#ffe9a8" : "#c8d2e2";
    ctx.fillText(shorten(`${hit ? ">" : " "} ${opts[i].label.padEnd(11)} ${opts[i].value}`, 104), left, ry);
    ry += 15;
  }

  // the stages
  let sy = ry + 10;
  ctx.strokeStyle = "rgba(201,165,74,0.35)";
  ctx.lineWidth = 1;
  ctx.strokeRect(left - 4, sy - 4, w - 16, 252);
  if (!S.result) {
    ctx.font = "11px monospace";
    ctx.fillStyle = "#c8d2e2";
    const lines = S.notDamage
      ? wrapText(S.notDamage, 84)
      : [S.error ? `The tables could not be read: ${S.error}` : "Reading the tables..."];
    for (let i = 0; i < lines.length; i++) ctx.fillText(lines[i], left + 4, sy + 8 + i * 15);
  } else {
    const stages = S.result.stages;
    for (let i = 0; i < stages.length; i++) {
      const stage = stages[i];
      const last = i === stages.length - 1;
      ctx.font = "bold 11px monospace";
      ctx.fillStyle = last ? "#ffd34d" : "#9fd0ff";
      ctx.fillText(`${i + 1} ${stage.name}`, left + 2, sy);
      ctx.textAlign = "right";
      ctx.fillStyle = "#ffe9a8";
      ctx.fillText(String(stage.value), x + w - 20, sy);
      ctx.textAlign = "left";
      ctx.font = "9px monospace";
      ctx.fillStyle = "#7a90b0";
      ctx.fillText(shorten(stage.note, 104), left + 24, sy + 11);
      sy += 28;
    }
    sy += 4;
    ctx.font = "bold 14px monospace";
    ctx.fillStyle = "#ffd34d";
    ctx.fillText("TOTAL", left + 2, sy);
    ctx.textAlign = "right";
    ctx.fillText(String(S.result.total), x + w - 20, sy);
    ctx.textAlign = "left";
    ctx.font = "10px monospace";
    ctx.fillStyle = "#c8d2e2";
    const line = `the fight as picked: ${opts[0].value.split("  ")[0]} -> ${opts[1].value.split("  ")[0]}`
      + `  |  ${tech?.named ? "" : "unnamed record  "}${tech ? tech.name : ""}`;
    ctx.fillText(shorten(line, 100), left + 2, sy + 18);
  }

  // controls, in the page's own margin
  ctx.font = "10px monospace";
  ctx.fillStyle = "#7a90b0";
  ctx.fillText("Up / Down: picker    Left / Right: value    L1 / R1: ten techniques    Triangle: walk it again    Cross / Start: close", left, y + h - 16);
  ctx.restore();
  return true;
}

// Browser-only debug hook: what the page is showing right now (console: __damagelab).
if (typeof window !== "undefined") {
  window.__damagelab = {
    open: () => S.open,
    options: () => damageLabOptions(),
    result: () => S.result,
    rows: (kind) => damageLabTable(kind),
    row: (kind, id) => damageLabRow(kind, id),
    pick: () => ({ ...S.pick }),
    error: () => S.error,
    reload: () => damageLabLoad(),
  };
}
