// web/fight/body-loadout.js — what a body really throws, and how its clip is built.
//
// A body's animation pack carries 18 action scripts (`anim.json` `actions[clip].ops`, the
// disc's own bytecode for that slot). This module reads ONE script and says, in rows a fan
// can follow, what it binds and what it fires. Everything is read, nothing is named from a
// species table:
//
//   op 2  [0,0,table]   bind the model's own timeline table (`table > 1`). [0,0,1] is the
//                       return-to-base marker and [0,0,0] the rest pose — recorded
//                       separately. This is the same rule `scriptTableSeq()` applies
//                       (web/fight/clip-fallback.js), so a built clip and this page agree.
//   op 3  [0,type,x,y,z]  spawn sprite effect `type` at the authored offset. 9999 is the
//                       VM's current-effect sentinel: the technique record's own `effect`.
//   op 6  [0,id,x,y,z,…]  launch mesh projectile `id` (MEFT pack) from the authored
//                       offset. The words are the pack's own triple; the battle VM negates
//                       y/z when it builds its world-space `from` (action-vm.js `_lunge`),
//                       so the page quotes the authored numbers, never a converted pose.
//   op 10 [id,…]        a cue: the sound table's id (0..89), or 98/99 = the contact and
//                       the damage strike. A script with none of 98/99 marks no strike.
//   op 11 [frames]      a wait — the clip's rhythm.
//
// The module is PURE: no DOM, no fetch, no filesystem, no storage. A caller hands it the
// parsed tables; tests/body-loadout.test.js reads them from the packs on disk.
//
// The species join: a species' moves are `tech_basic`, `tech_signature` and `tech_slots`,
// resolved through `fight_tech_table.json` (`clip`, `elem1`, `elem2`, `effect`) and named
// through digimon.json's `skills`. Two moves can share one clip and one mesh and still look
// different — the technique record's own `effect` byte is what changes (Meramon's Flame
// Ball effect 4 vs Flame Lance effect 5, both mesh 371).
//
// The two corpus lines on the page (one mesh serving moves of two elements; authored attack
// clips with no strike marker) cannot be recomputed in a browser: 249 packs are 39.9 MB.
// CORPUS_FACTS carries the numbers this module's own test computes over every pack, and the
// test fails if the packs stop agreeing — the page never invents its own total.

/** The disc's eight technique elements (engine/dw3/battle-formulas.ts ELEMENT_ID; the
 *  skills table spells every one of the 426 techniques' own element this way). */
export const ELEMENT_NAMES = {
  1: "normal", 2: "fire", 3: "water", 4: "ice", 5: "wind", 6: "thunder", 7: "machine", 8: "dark",
};

/** What each of the 18 slots is for (knowledge/clips.md §5). Only labels: nothing here
 *  changes what a clip plays. */
export const CLIP_KINDS = {
  0: "idle", 1: "flinch", 2: "survive", 3: "death", 4: "evade",
  5: "basic attack", 6: "combo 2", 7: "combo 3", 8: "combo 4",
  9: "spell cast", 10: "item use", 11: "signature", 12: "DNA presentation",
  13: "volley cast", 14: "item arm", 15: "field cast", 16: "throw cast", 17: "item arm",
};
export function clipKind(clip) {
  const n = Number(clip);
  return CLIP_KINDS[n] ?? `clip ${n}`;
}

/** The slots that are neither idle/reactions nor the DNA presentation: the attack clips a
 *  technique can name, and the ones the silent-clip line counts. */
export const ATTACK_CLIPS = [5, 6, 7, 8, 9, 10, 11, 13, 14, 15, 16, 17];
const IS_ATTACK_CLIP = new Set(ATTACK_CLIPS);

const num = (v) => Number(v) | 0;

/**
 * One clip's loadout, from the body's own action script. Pure.
 *
 * `anim` is an anim.json-shaped object (`{actions, clips, timeline, …}`); a missing script
 * is an empty loadout (`strike: false`), never a guess. Returned:
 *   clip, ops (how many ops the script has), tables (the timeline tables it binds),
 *   ret/rest (op indices of the return-to-base and rest-pose markers),
 *   waits (the op11 frame waits, in order), shots ([{id, at:[x,y,z]}], the op6 launches),
 *   effects (the op3 sprite types it spawns), contacts (every op10 cue id),
 *   strike (does it mark 98/99 at all).
 */
export function loadoutFor(anim, clip) {
  const index = num(clip);
  const ops = anim?.actions?.[index]?.ops ?? [];
  const out = {
    clip: index, ops: ops.length, tables: [], ret: [], rest: [],
    waits: [], shots: [], effects: [], contacts: [], strike: false,
  };
  ops.forEach((o, i) => {
    const w = Array.isArray(o?.words) ? o.words : [];
    switch (o?.op) {
      case 2:
        if (num(w[0]) !== 0 || w.length < 3) break;
        if (num(w[2]) > 1) out.tables.push(num(w[2]));
        else if (num(w[2]) === 1) out.ret.push(i);
        else out.rest.push(i);
        break;
      case 3:
        if (num(w[0]) === 0 && w.length >= 2) out.effects.push(num(w[1]));
        break;
      case 6:
        if (num(w[0]) === 0 && w.length >= 2) {
          out.shots.push({ id: num(w[1]), at: [num(w[2]), num(w[3]), num(w[4])] });
        }
        break;
      case 10:
        if (w.length) {
          out.contacts.push(num(w[0]));
          if (num(w[0]) === 98 || num(w[0]) === 99) out.strike = true;
        }
        break;
      case 11:
        if (w.length) out.waits.push(num(w[0]));
        break;
      default:
        break;
    }
  });
  return out;
}

// ── the species join ─────────────────────────────────────────────────────────────

/** A species' technique ids in play order: basic, signature, then the six slots, deduped. */
export function techniqueIds(species) {
  const ids = [];
  const add = (id) => {
    const n = num(id);
    if (n > 0 && !ids.includes(n)) ids.push(n);
  };
  add(species?.tech_basic);
  add(species?.tech_signature);
  for (const id of species?.tech_slots ?? []) add(id);
  return ids;
}

const tableRow = (table, id) =>
  table instanceof Map ? table.get(id) ?? table.get(String(id)) : table?.[id] ?? table?.[String(id)];

const skillRow = (skills, id) => {
  if (!skills) return null;
  if (skills instanceof Map) return skills.get(id) ?? skills.get(String(id)) ?? null;
  if (Array.isArray(skills)) return skills.find((s) => num(s?.id) === id) ?? null;
  return skills[id] ?? skills[String(id)] ?? null;
};

/** A loadout the caller already computed for `clip`, a function of it, or the body's own. */
function loadoutAt(loadout, anim, clip) {
  if (typeof loadout === "function") return loadout(clip) ?? loadoutFor(anim, clip);
  if (loadout instanceof Map) {
    const hit = loadout.get(clip) ?? loadout.get(String(clip));
    return hit ?? loadoutFor(anim, clip);
  }
  if (loadout && typeof loadout === "object") {
    const hit = loadout[clip] ?? loadout[String(clip)];
    return hit ?? loadoutFor(anim, clip);
  }
  return loadoutFor(anim, clip);
}

/**
 * The species' moves joined to the body's own scripts. One row per technique:
 * `{techId, name, element, clip, mesh, strike, effect, own}`.
 *   name    the disc's own technique name (from digimon.json `skills`; a `name` on the
 *           technique row is used when no skill table is given, otherwise null),
 *   element the technique table's own `elem1`, spelled with ELEMENT_NAMES,
 *   clip    the slot the technique plays,
 *   mesh    the first projectile that clip launches on this body (null when it throws none),
 *   strike  does that clip mark a strike,
 *   effect  the technique record's own effect byte (the 9999 sentinel's value),
 *   own     does the body author that clip at all (false = the battle builds/borrows it).
 * `loadout` may be a per-clip cache (Map or object), a `(clip) => loadout` function, or
 * null to read the body's script directly. Pure.
 */
export function moveRows(species, techTable, anim, loadout = null, skills = null) {
  const rows = [];
  for (const techId of techniqueIds(species)) {
    const row = tableRow(techTable, techId);
    if (!row) continue;                       // no technique record: nothing to claim
    const clip = num(row.clip);
    const lo = loadoutAt(loadout, anim, clip);
    const skill = skillRow(skills, techId);
    rows.push({
      techId,
      name: skill?.name ?? (typeof row.name === "string" ? row.name : null),
      element: ELEMENT_NAMES[num(row.elem1)] ?? `element ${num(row.elem1)}`,
      clip,
      mesh: lo.shots.length ? lo.shots[0].id : null,
      strike: !!lo.strike,
      effect: num(row.effect),
      own: !!anim?.actions?.[clip]?.ops?.length,
    });
  }
  return rows;
}

/** How a caller hands over models: a `(folder) => anim | null` reader, a Map, or an object. */
function makeReader(present) {
  if (typeof present === "function") return (folder) => present(folder) ?? null;
  if (present instanceof Map) return (folder) => present.get(folder) ?? null;
  if (present && typeof present === "object") return (folder) => present[folder] ?? null;
  return () => null;
}

/** The clips of one species' moves that serve two or more elements, with the one mesh they
 *  launch (the move-row view; `sharedMeshCases` is the same joined over a roster). */
function sharedMeshOf(rows, folder, speciesName) {
  const byClip = new Map();
  for (const r of rows) {
    if (!Number.isFinite(r.clip)) continue;
    let slot = byClip.get(r.clip);
    if (!slot) byClip.set(r.clip, (slot = { names: new Set(), mesh: null }));
    slot.names.add(r.element);
    if (r.mesh != null) slot.mesh = r.mesh;
  }
  const out = [];
  for (const [clip, slot] of byClip) {
    if (slot.names.size < 2 || slot.mesh == null) continue;
    out.push({
      species: speciesName,
      folder,
      clip,
      mesh: slot.mesh,
      elements: [...slot.names].sort(),
    });
  }
  return out;
}

/**
 * Every live case where one mesh projectile serves moves of two or more elements: a
 * species whose own body launches `mesh` on a clip that its techniques read with different
 * `elem1` values. `present` is the model reader (folder -> anim.json). Pure.
 */
export function sharedMeshCases(speciesList, techTable, modelMap, present) {
  const read = makeReader(present);
  const cases = [];
  for (const sp of speciesList ?? []) {
    if (!sp || typeof sp.name !== "string") continue;
    const folder = modelMap?.[sp.name] ?? null;      // a display name with no body is no case
    if (!folder) continue;
    const anim = read(folder);
    if (!anim) continue;
    const rows = moveRows(sp, techTable, anim, null, null);
    cases.push(...sharedMeshOf(rows, folder, sp.name));
  }
  return cases;
}

/**
 * The authored attack clips that mark no strike. A clip counts when the pack says the slot
 * is present, its script has ops, the slot is an attack clip (5..17, not the DNA
 * presentation 12), and no op10 record is 98 or 99 — so the blow never resolves on the
 * defender's side. `casts` is the subset on the cast/signature slots (9 and 11).
 * `present` is the model reader (folder -> anim.json). Pure.
 */
export function silentClips(folders, present) {
  const read = makeReader(present);
  const clips = [];
  for (const folder of folders ?? []) {
    const anim = read(folder);
    if (!anim) continue;
    const list = anim.clips ?? [];
    const acts = anim.actions ?? [];
    for (let i = 0; i < list.length; i++) {
      if (!IS_ATTACK_CLIP.has(i)) continue;
      if (!list[i]?.present) continue;
      const ops = acts[i]?.ops ?? [];
      if (!ops.length) continue;
      const strike = ops.some((o) => o?.op === 10 && (num(o.words?.[0]) === 98 || num(o.words?.[0]) === 99));
      if (!strike) clips.push({ folder, clip: i, cast: i === 9 || i === 11, kind: clipKind(i) });
    }
  }
  return { clips, casts: clips.filter((c) => c.cast), count: clips.length };
}

/**
 * The corpus numbers the page prints, measured over the 249 packs by
 * tests/body-loadout.test.js (which recomputes every one of them from the files and fails
 * if they move). Nothing here is a guess and nothing is a pose or a sound.
 */
export const CORPUS_FACTS = {
  sharedMeshCases: 23,
  sharedMeshExamples: [
    { species: "ExVeemon", folder: "m259exvm", clip: 9, mesh: 201 },
    { species: "SkullGreymon", folder: "m026skul", clip: 9, mesh: 212 },
    { species: "SkullGreymon", folder: "m026skul", clip: 13, mesh: 212 },
  ],
  silentClips: 76,
  silentCasts: [
    ["m014monz", 9], ["m059houo", 11], ["m070waru", 9],
    ["m410ved2", 9], ["m437bast", 9], ["m440sijn", 9],
  ],
};

// ── the page's lines ─────────────────────────────────────────────────────────────

const soundName = (sounds, id) => {
  if (id === 98) return "98 contact";
  if (id === 99) return "99 strike";
  const name = sounds?.[String(id)] ?? sounds?.[id];
  return name ? `${id} ${name}` : `${id} (not in the sound table)`;
};
const effectName = (type) => (type === 9999 ? "9999 the technique's own effect" : String(type));

/**
 * The LOADOUT tab's text, as plain lines (the draw wraps them; tests read them directly).
 * Everything comes from the opened body's own anim.json plus the tables the caller hands
 * in; `sounds` is sfx/op10_map.json and only names cues, never invents one. Pure.
 *
 * Returns {title, sub, moves, clips, odd}: `moves` are the species' joined move rows,
 * `clips` one block per authored clip it owns, `odd` the two corpus lines (and this body's
 * own shared-mesh case, when it has one).
 */
export function loadoutReport({ folder, names = [], species = [], anim = null, techTable = null, skills = null, sounds = null } = {}) {
  const title = names.length ? `${names.join(" / ")}  ${folder}` : String(folder ?? "");
  const clips = anim?.clips ?? [];
  const acts = anim?.actions ?? [];
  const present = clips.filter((c) => c?.present).length;
  const speciesLine = species.length === 0
    ? "no obtainable species stages it"
    : species.length === 1
      ? `${species[0].name} plays it`
      : `${species.length} species play it`;
  const sub = anim
    ? `${anim.num_bones ?? "?"} bones · ${present} clips present · ${speciesLine}`
    : "this pack has no anim.json";

  const moves = [];
  const rowsBySpecies = [];
  for (const sp of species) {
    const rows = moveRows(sp, techTable, anim, null, skills);
    rowsBySpecies.push([sp, rows]);
    for (const r of rows) {
      const who = species.length > 1 ? `${sp.name} · ` : "";
      const mesh = r.mesh != null ? `mesh ${r.mesh}` : "no mesh";
      const own = r.own ? "" : ` · clip ${r.clip} not authored`;
      const strike = r.strike ? "" : " · no strike marker";
      moves.push(`${who}${r.name ?? `technique ${r.techId}`} · ${r.element} · clip ${r.clip} · ${mesh} · effect ${r.effect}${own}${strike}`);
    }
  }
  if (!species.length) moves.push("no obtainable species stages this body");

  const clipLines = [];
  const compactLines = [];
  for (let i = 0; i < clips.length; i++) {
    if (!clips[i]?.present) continue;
    const ops = acts[i]?.ops ?? [];
    if (!ops.length) continue;
    const lo = loadoutFor(anim, i);
    const shot = lo.shots.length
      ? lo.shots.map((s) => `mesh ${s.id} @ ${s.at.join(",")}`).join(" + ")
      : "no projectile";
    const strike = lo.strike ? "STRIKE" : "no strike marker";
    if (!IS_ATTACK_CLIP.has(i)) {
      // idle / the four reactions / the DNA presentation: one compact line, no rhythm
      compactLines.push(`c${i} ${clipKind(i)} · ${lo.ops} ops · ${shot} · ${strike}`);
      continue;
    }
    const head = `c${i} ${clipKind(i)} · ${lo.ops} ops · tables ${lo.tables.length ? lo.tables.join(",") : "none"}`;
    const cues = lo.contacts.length ? lo.contacts.map((id) => soundName(sounds, id)).join(", ") : "no cue";
    const fx = lo.effects.length ? lo.effects.map(effectName).join(", ") : "none";
    clipLines.push(
      head,
      `  waits ${lo.waits.length ? lo.waits.join(",") : "0"} · ${shot}`,
      `  fx ${fx} · ${cues} · ${strike}`,
    );
  }
  // The attack clips come first: they are what the tab is for, and a full 18-clip pack
  // overruns the column — the reactions can be the ones cut.
  const allClipLines = [...clipLines, ...compactLines];
  if (!allClipLines.length) allClipLines.push("this body authors no action script");

  const odd = [];
  odd.push(`one mesh, many elements: ${CORPUS_FACTS.sharedMeshCases} cases on the disc`);
  odd.push(`  ${CORPUS_FACTS.sharedMeshExamples.map((e) => `${e.species} c${e.clip} m${e.mesh}`).join(" · ")}`);
  const mine = rowsBySpecies.flatMap(([sp, rows]) => sharedMeshOf(rows, folder, sp.name));
  if (mine.length) {
    odd.push(`this body: ${mine.map((c) => `mesh ${c.mesh} serves ${c.elements.join(" and ")} on clip ${c.clip}`).join(" · ")}`);
  }
  odd.push(`no strike marker: ${CORPUS_FACTS.silentClips} authored attack clips`);
  odd.push(`  cast/signature: ${CORPUS_FACTS.silentCasts.map(([f, c]) => `${f} c${c}`).join(", ")}`);

  return { title, sub, moves, clips: allClipLines, odd };
}
