// web/battlefields.js — the Battlefields table: where a stage fights and
// which technique changes the world. Pure: no DOM, no fetch, no state.
//
// Two halves, both read from the manifests the battle itself loads:
//
//   WHERE A STAGE FIGHTS — web/assets/battle/arenas/manifest.json:
//     `byArena` holds the 29 ordinary-battle arenas the disc's fieldstg hands to
//     fightstg (arena i = the pack MEFT10<i>, its own background colour and how
//     many CLUT textures the pack carries). `byStage` holds one record per field
//     stage that carries fights (202 of them): `_default` is the arena every
//     battle screen of that stage uses unless its own screen id has an entry, and
//     the other keys are those per-screen overrides (screen 188 -> arena 18, ...).
//     Every stage record has a `_default`; the 92 maps of the 294 that never
//     fight have no record at all and are listed here as "no ordinary arena",
//     never given an invented arena.
//
//   WHICH MOVE CHANGES THE WORLD — web/assets/battle/backdrops/manifest.json:
//     a special technique's background is MEFT10<sigEffect> (sig 0 = meft1055, the data
//     fallback the battle draws when the technique carries no element signature). `bySig` is
//     the 17 packs (16 element worlds across eight elements, plus the data fallback) and
//     `byTech` lists 182 techniques: 52 carry a non-zero sig and 130 carry 0, which is the
//     ordinary arena. fight_tech_table.json has the same 443 rows the battle reads; exactly
//     52 of them have a non-zero sigEffect, so 391 techniques fight in the ordinary arena (a
//     few of the 443 have no technique name in digimon.json's 426-name skill list — they are
//     kept by id, named or not).
//
// No arena, element, pack, technique or map name is invented: a missing table
// entry resolves to null, never to a guess.
//
// Numbers pinned by tests/battlefields.test.js.

/** The label the table puts next to a map whose stage has no arena record. */
export const ORDINARY_ARENA_LABEL = "no ordinary arena";

/** The manifest's map list (the whole manifest object or its `maps` array). */
function mapList(value) {
  if (Array.isArray(value)) return value;
  return Array.isArray(value?.maps) ? value.maps : [];
}

/** The arena manifest's `byStage` table (the whole manifest or the table). */
function stageTable(arenas) {
  if (!arenas || typeof arenas !== "object" || Array.isArray(arenas)) return {};
  const byStage = arenas.byStage;
  return byStage && typeof byStage === "object" && !Array.isArray(byStage) ? byStage : {};
}

/** One map id's own name, or null (never a made-up name). */
function nameByMapId(maps) {
  const names = new Map();
  for (const map of mapList(maps)) {
    if (map && typeof map.id === "string") names.set(map.id, typeof map.name === "string" ? map.name : null);
  }
  return names;
}

/**
 * One row per field stage that carries fights, from the arena manifest's `byStage`
 * and the manifest's map names. Pure.
 *
 * Row = {stage: "s200", name, defaultArena, screens} — `stage` is the map id the
 * manifest uses (the manifest keys are numeric strings joined with "s"), `name` is
 * that map's own name (null when the manifest has no record), `defaultArena` the
 * stage's `_default` arena id, and `screens` the per-battle-screen overrides keyed
 * by the screen id the encounter driver rolls (188 -> 18).
 *
 * The stages come out in numeric order, so the book's pages are stable.
 */
export function stageRows({ arenas, maps } = {}) {
  const byStage = stageTable(arenas);
  const names = nameByMapId(maps);
  return Object.keys(byStage)
    .map(Number)
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b)
    .map((n) => {
      const record = byStage[String(n)] ?? {};
      const screens = {};
      for (const [key, value] of Object.entries(record)) {
        if (key === "_default") continue;
        const screen = Number(key);
        const arena = Number(value);
        if (!Number.isFinite(screen) || !Number.isFinite(arena)) continue;
        screens[screen] = arena;
      }
      const id = `s${n}`;
      const fallback = Number(record._default);
      return {
        stage: id,
        name: names.has(id) ? names.get(id) : null,
        defaultArena: Number.isFinite(fallback) ? fallback : null,
        screens,
      };
    });
}

/**
 * The other maps: every map record the arena manifest does not cover, in manifest
 * order. Pure. There is no arena to show, so each row says so and carries no
 * arena id. Row = {stage: "s013", name, arena: null, label: "no ordinary arena"}.
 */
export function noFightRows({ arenas, maps } = {}) {
  const byStage = stageTable(arenas);
  const rows = [];
  for (const map of mapList(maps)) {
    if (!map || typeof map.id !== "string") continue;
    const key = map.id.replace(/^s/, "");
    if (Object.prototype.hasOwnProperty.call(byStage, key)) continue;
    rows.push({
      stage: map.id,
      name: typeof map.name === "string" ? map.name : null,
      arena: null,
      label: ORDINARY_ARENA_LABEL,
    });
  }
  return rows;
}

/**
 * The 29 ordinary-battle arenas, in id order. Pure.
 * Row = {id: 1, pack: "meft1001", bg: [56, 112, 232], clutTextures: 4} — the pack
 * folder fightstg loads, the arena's own background colour, and how many CLUT
 * textures the pack carries.
 */
export function arenaRows({ arenas } = {}) {
  const byArena = arenas && typeof arenas === "object" && !Array.isArray(arenas) ? arenas.byArena ?? {} : {};
  return Object.keys(byArena)
    .map(Number)
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b)
    .map((id) => {
      const record = byArena[String(id)] ?? {};
      return {
        id,
        pack: typeof record.pack === "string" ? record.pack : null,
        bg: Array.isArray(record.bg) ? record.bg.map(Number) : [],
        clutTextures: Number(record.clutTextures) || 0,
      };
    });
}

/** digimon.json's skill list, however the caller handed it over. */
function skillList(skills) {
  if (Array.isArray(skills)) return skills;
  if (skills instanceof Map) return [...skills.values()];
  return Array.isArray(skills?.skills) ? skills.skills : [];
}

/**
 * The 17 backdrop packs and the techniques that summon each one. Pure.
 *
 * Row = {sig, pack, element, sound, fallback, techs: [{id, name}]}:
 *   `sig` the signature effect the technique carries (0 = the data fallback),
 *   `pack` the MEFT10<sig> folder the battle draws, `element` its own element
 *   (fire, water, ice, wind, thunder, machine, dark, normal, or data for the
 *   fallback), `sound` the cue the pack plays (-1 = none), `fallback` true for the
 *   one pack the battle draws when no technique summoned anything, and `techs`
 *   the techniques whose sigEffect names this sig, in id order, named through
 *   digimon.json's skill list when it has a name (null when it does not).
 *
 * The fallback row carries no techniques: no technique names sig 0 as its own signature,
 * it is the pack the battle draws when a special's technique carries no element world.
 * ordinaryCount() covers the moves that land there.
 */
export function backdropRows({ backdrops, techTable, skills } = {}) {
  const bySig = backdrops && typeof backdrops === "object" && !Array.isArray(backdrops) ? backdrops.bySig ?? {} : {};
  const fallbackSig = Number(backdrops?.fallbackSig) || 0;
  const names = new Map(skillList(skills).filter((s) => s && s.id != null).map((s) => [Number(s.id), s.name]));
  const table = techTable && typeof techTable === "object" && !Array.isArray(techTable) ? techTable : {};
  const techsBySig = new Map();
  for (const [key, row] of Object.entries(table)) {
    const sig = Number(row?.sigEffect) || 0;
    if (!sig) continue;                                  // the ordinary arena, not a world
    if (!techsBySig.has(sig)) techsBySig.set(sig, []);
    const id = Number(key);
    techsBySig.get(sig).push({ id, name: names.get(id) ?? null });
  }
  for (const list of techsBySig.values()) list.sort((a, b) => a.id - b.id);
  return Object.keys(bySig)
    .map(Number)
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b)
    .map((sig) => {
      const record = bySig[String(sig)] ?? {};
      const fallback = sig === fallbackSig;
      const sound = Number(record.sound);
      return {
        sig,
        pack: typeof record.pack === "string" ? record.pack : null,
        element: typeof record.element === "string" ? record.element : null,
        sound: Number.isFinite(sound) ? sound : null,
        fallback,
        techs: fallback ? [] : techsBySig.get(sig) ?? [],
      };
    });
}

/**
 * The backdrop one technique summons, or null when it summons none. Pure.
 *
 * `techTable` is fight_tech_table.json (technique id -> its record); a technique
 * whose `sigEffect` is 0 fights in the ordinary arena (Hot Head #53) and one the
 * table does not hold cannot be looked up, so both answer null. An entry for the
 * sig that the backdrop manifest does not carry also answers null (never a guess).
 */
export function techBackdrop(backdrops, techTable, id) {
  const table = techTable && typeof techTable === "object" ? techTable : {};
  const row = table[String(id)];
  const sig = Number(row?.sigEffect) || 0;
  if (!sig) return null;
  const record = backdrops?.bySig?.[String(sig)];
  if (!record) return null;
  const sound = Number(record.sound);
  return {
    pack: typeof record.pack === "string" ? record.pack : null,
    element: typeof record.element === "string" ? record.element : null,
    sound: Number.isFinite(sound) ? sound : null,
  };
}

/** How many of fight_tech_table.json's techniques fight in the ordinary arena (391 of 443). */
export function ordinaryCount(techTable) {
  const table = techTable && typeof techTable === "object" && !Array.isArray(techTable) ? techTable : {};
  let count = 0;
  for (const row of Object.values(table)) if (!Number(row?.sigEffect)) count += 1;
  return count;
}

/**
 * The corpus numbers the page prints, all measured from the two tables. Pure.
 *
 * `packs` 17 (every backdrop pack), `elementPacks` 16 (the ones that are an element,
 * not the data fallback), `techs` 443 (rows in the technique table; 0 when that table
 * did not load), `specialTechs` 52 (techniques with a non-zero sigEffect),
 * `ordinaryTechs` 391 (443 - 52), `listedTechs` 182 (rows in the backdrop manifest's
 * byTech) and `zeroListed` 130 (how many of those 182 point at sig 0, the ordinary
 * arena).
 */
export function backdropFacts({ backdrops, techTable } = {}) {
  const bySig = backdrops && typeof backdrops === "object" && !Array.isArray(backdrops) ? backdrops.bySig ?? {} : {};
  const byTech = backdrops && typeof backdrops === "object" && !Array.isArray(backdrops) ? backdrops.byTech ?? {} : {};
  const packs = Object.keys(bySig);
  const table = techTable && typeof techTable === "object" && !Array.isArray(techTable) ? techTable : {};
  const total = Object.keys(table).length;
  const special = Object.values(table).filter((row) => Number(row?.sigEffect) !== 0).length;
  return {
    packs: packs.length,
    elementPacks: packs.filter((key) => bySig[key]?.element !== "data").length,
    techs: total,
    specialTechs: special,
    ordinaryTechs: total - special,
    listedTechs: Object.keys(byTech).length,
    zeroListed: Object.values(byTech).filter((sig) => Number(sig) === 0).length,
  };
}

/**
 * Every row the Battlefields tab lists, in reading order: the 202 fighting stages,
 * the 92 maps with no ordinary arena, the 29 arenas, then the 17 backdrop packs.
 * Pure. Each row keeps its own fields and gains `kind` ("stage", "map", "arena" or
 * "world") so the page can draw and label it.
 */
export function battlefieldRows({ arenas, backdrops, techTable, skills, maps } = {}) {
  return [
    ...stageRows({ arenas, maps }).map((row) => ({ kind: "stage", ...row })),
    ...noFightRows({ arenas, maps }).map((row) => ({ kind: "map", ...row })),
    ...arenaRows({ arenas }).map((row) => ({ kind: "arena", ...row })),
    ...backdropRows({ backdrops, techTable, skills }).map((row) => ({ kind: "world", ...row })),
  ];
}
