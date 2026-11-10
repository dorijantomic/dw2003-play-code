// Loadout — what a body really throws, and how its clip is built (web/fight/body-loadout.js;
// the in-game Codex tab that showed it is gone, the module stays).
//
// Every number here is read from the packs the battle plays, never typed in:
//   actions[clip].ops  the disc's own action script for one slot
//     op 2  [0,0,table]        bind a timeline table (table > 1); [0,0,1] = return to
//                              base, [0,0,0] = the rest pose (clip-fallback.js
//                              scriptTableSeq is the code's own rule)
//     op 3  [0,type,x,y,z]     spawn sprite effect `type` (9999 = the technique's own
//                              effect byte, the VM's current-effect sentinel)
//     op 6  [0,id,x,y,z,…]     launch mesh projectile `id` from the authored offset
//     op 10 [id,…]             a cue: the sound table's id, or 98/99 = the contact and
//                              the damage strike
//     op 11 [frames]           the script's waits (the clip's rhythm)
//   fight_tech_table.json    clip / elem1 / elem2 / effect per technique
//   digimon.json + extra_species.json  tech_basic / tech_signature / tech_slots
//   effects/manifest.json, effects/proj/, sfx/op10_map.json  what the ids resolve to
//
// The card's own example numbers came from a probe that sliced the op lists
// (`f3d_body.py`: op2 records `[:4]`, op3/op10 `[:3]`); where that slice differs from
// the whole script the whole script is pinned and the slice is pinned beside it, so the
// figure stays traceable (see the Agumon clip 5/11 tests).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  CORPUS_FACTS,
  ELEMENT_NAMES,
  clipKind,
  loadoutFor,
  moveRows,
  sharedMeshCases,
  silentClips,
  techniqueIds,
} from "../web/fight/body-loadout.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const ASSETS = path.join(ROOT, "web/assets");
const read = (p) => JSON.parse(fs.readFileSync(path.join(ASSETS, p), "utf8"));

const MODELS = path.join(ASSETS, "battle/models");
const HAVE_PACKS = fs.existsSync(path.join(MODELS, "index.json"));
const skip = HAVE_PACKS ? false : "model packs are not installed";

const anim = (folder) => read(`battle/models/${folder}/anim.json`);
const folders = HAVE_PACKS ? read("battle/models/index.json") : [];
const disc = read("data/digimon.json");
const extra = read("data/extra_species.json");
const speciesList = [...disc.digimon, ...extra.digimon];
const techTable = read("data/fight_tech_table.json");
const modelMap = read("battle/model_map.json");
const manifest = read("battle/effects/manifest.json");
const sounds = read("sfx/op10_map.json");
const skills = disc.skills;
const skillById = new Map(skills.map((s) => [s.id, s]));
const profile = (name) => speciesList.find((p) => p.name === name);

/** Every pack's ops summary, read once per test run (the same shapes the function reads). */
let corpus = null;
function corpusScan() {
  if (corpus) return corpus;
  const anims = new Map();
  const op3 = new Set(), op6 = new Set(), op10 = new Set();
  for (const folder of folders) {
    const a = anim(folder);
    anims.set(folder, a);
    for (const act of a.actions ?? []) {
      for (const o of act?.ops ?? []) {
        const w = o.words ?? [];
        if (o.op === 3 && w[0] === 0 && w.length >= 2) op3.add(w[1] | 0);
        else if (o.op === 6 && w[0] === 0 && w.length >= 2) op6.add(w[1] | 0);
        else if (o.op === 10 && w.length) op10.add(w[0] | 0);
      }
    }
  }
  const projPacks = new Set(
    fs.readdirSync(path.join(ASSETS, "battle/effects/proj"))
      .filter((f) => f.endsWith(".json"))
      .map((f) => Number(f.split(".")[0])),
  );
  corpus = { anims, op3, op6, op10, projPacks, reader: (f) => anims.get(f) ?? null };
  return corpus;
}

// ── one body's clip ───────────────────────────────────────────────────────────────

test("Meramon clip 9: mesh 371 thrown from 0,2816,-2944 with effects 1013/2/5 and sounds 51/38/99", { skip }, () => {
  const lo = loadoutFor(anim("m009mera"), 9);
  assert.deepEqual(lo, {
    clip: 9,
    ops: 25,
    tables: [38],
    ret: [22],              // the op2 [0,0,1] return-to-base marker
    rest: [],
    waits: [25, 50, 21, 10, 100],
    shots: [{ id: 371, at: [0, 2816, -2944] }],
    effects: [1013, 2, 5],
    contacts: [51, 38, 99],
    strike: true,
  });
  // the idea's own sentence: Flame Ball is mesh 371 from that offset
  assert.equal(skillById.get(137).name, "Flame Ball");
  assert.equal(techTable["137"].clip, 9);
});

test("Agumon clip 5 binds five tables, not three: the card's [14,15,16] is the critic's first-four slice", { skip }, () => {
  const a = anim("m003agum");
  const lo = loadoutFor(a, 5);
  assert.equal(lo.ops, 23);
  assert.deepEqual(lo.tables, [14, 15, 16, 17, 18], "scriptTableSeq's rule (clip-fallback.js) over the whole script");
  assert.deepEqual(lo.rest, [4, 14, 20], "the three [0,0,0] rest-pose records");
  assert.deepEqual(lo.ret, []);
  assert.deepEqual(lo.waits, [20]);
  assert.deepEqual(lo.shots, [], "the basic attack is body only");
  assert.deepEqual(lo.effects, [2]);
  assert.deepEqual(lo.contacts, [10, 99, 10], "two cue records and the damage strike");
  assert.equal(lo.strike, true);
  // the card's figure, reproduced exactly: the probe kept only the first four
  // mode-0 op2 records (14, rest 0, 15, 16) before filtering tables out of them.
  const firstFourOp2 = a.actions[5].ops
    .filter((o) => o.op === 2 && o.words?.[0] === 0)
    .slice(0, 4)
    .filter((o) => (o.words[2] | 0) > 1)
    .map((o) => o.words[2] | 0);
  assert.deepEqual(firstFourOp2, [14, 15, 16]);
});

test("Agumon clip 11: shot 101, six effect spawns and six cues; the probe's first-three slice is the card's figure", { skip }, () => {
  const lo = loadoutFor(anim("m003agum"), 11);
  assert.equal(lo.ops, 43);
  assert.deepEqual(lo.tables, [50, 51]);
  assert.deepEqual(lo.shots, [{ id: 101, at: [0, 768, 4992] }]);
  assert.deepEqual(lo.effects, [1020, 1009, 1013, 2, 4, 4], "every op3 spawn the script writes");
  assert.deepEqual(lo.contacts, [89, 28, 23, 35, 99, 91]);
  assert.equal(lo.strike, true);
  // the card's figures are the first three DISTINCT records of each list (the probe sliced [:3])
  const distinct = (list) => [...new Set(list)];
  assert.deepEqual(distinct(lo.effects).slice(0, 3), [1020, 1009, 1013]);
  assert.deepEqual(distinct(lo.contacts).slice(0, 3), [89, 28, 23]);
  assert.deepEqual(distinct(loadoutFor(anim("m003agum"), 5).contacts), [10, 99]);
});

test("VenomMyotismon clip 5 throws mesh 354 from 0,9856,-5376: a basic attack can shoot", { skip }, () => {
  const lo = loadoutFor(anim("m236vvnd"), 5);
  assert.deepEqual(lo.shots, [{ id: 354, at: [0, 9856, -5376] }]);
  assert.equal(lo.strike, true);
  assert.deepEqual(lo.tables, [14]);
});

test("a clip the body does not author is an empty loadout with strike false, never a guess", { skip }, () => {
  const lo = loadoutFor(anim("m009mera"), 12);
  assert.deepEqual(lo, {
    clip: 12, ops: 0, tables: [], ret: [], rest: [], waits: [], shots: [], effects: [], contacts: [], strike: false,
  });
  assert.deepEqual(loadoutFor(null, 9).tables, []);
});

test("the effect sentinel 9999 and the element ids are printed with the game's own names", () => {
  assert.deepEqual(
    ELEMENT_NAMES,
    { 1: "normal", 2: "fire", 3: "water", 4: "ice", 5: "wind", 6: "thunder", 7: "machine", 8: "dark" },
  );
  // the ids are the skill rows' own element strings (counted over all 426 techniques)
  const pairs = new Set();
  for (const s of skills) {
    const t = techTable[String(s.id)];
    if (t) pairs.add(`${t.elem1}=${s.element}`);
  }
  for (const [id, name] of Object.entries(ELEMENT_NAMES)) assert.ok(pairs.has(`${id}=${name}`), `${id} is ${name}`);
  assert.equal(clipKind(0), "idle");
  assert.equal(clipKind(5), "basic attack");
  assert.equal(clipKind(9), "spell cast");
  assert.equal(clipKind(11), "signature");
  assert.equal(clipKind(12), "DNA presentation");
  assert.equal(clipKind(13), "volley cast");
});

// ── the corpus ────────────────────────────────────────────────────────────────────

test("the packs' corpus: 125 meshes (373 has no pack), 124 effect types, 55 sound ids", { skip }, () => {
  const c = corpusScan();
  assert.equal(c.op6.size, 125, "distinct op6 projectile ids");
  const missing = [...c.op6].filter((id) => !c.projPacks.has(id));
  assert.deepEqual(missing, [373], "exactly one mesh is referenced and absent");
  assert.deepEqual(
    [...c.projPacks].filter((id) => !c.op6.has(id)).sort((a, b) => a - b),
    [114, 312, 313, 314, 362],
    "five extracted packs are never launched",
  );
  assert.equal(c.projPacks.size, 129);

  const real3 = [...c.op3].filter((t) => t !== 9999);
  assert.equal(c.op3.size, 125, "124 real types plus the 9999 sentinel");
  assert.equal(real3.length, 124);
  assert.equal(Object.keys(manifest.types).length, 148);
  for (const t of real3) assert.ok(manifest.types[String(t)], `effect ${t} resolves in the 148-type manifest`);

  assert.equal(c.op10.size, 55, "distinct op10 cue ids over every script");
  const inMap = [...c.op10].filter((id) => sounds[String(id)] != null);
  assert.equal(inMap.length, 50, "50 of the 89 sound entries are emitted");
  assert.equal(Object.keys(sounds).length - inMap.length, 39, "39 entries are never emitted");
  assert.deepEqual([...c.op10].filter((id) => id <= 89 && sounds[String(id)] == null).sort((a, b) => a - b), [66],
    "66 is handled in code, not by the sound table");
});

test("shared meshes: 23 live cases, ExVeemon 201 and SkullGreymon 212 among them — computed, not hardcoded", { skip }, () => {
  const c = corpusScan();
  const cases = sharedMeshCases(speciesList, techTable, modelMap, c.reader);
  console.log(`shared mesh cases: ${cases.length} · silent attack clips: see the next test`);
  assert.equal(cases.length, 23, "one mesh serving moves of two or more elements");
  assert.equal(CORPUS_FACTS.sharedMeshCases, cases.length, "the page's number is this number");
  const exv = cases.find((x) => x.folder === "m259exvm" && x.clip === 9);
  assert.ok(exv, "ExVeemon clip 9 is one case");
  assert.equal(exv.mesh, 201);
  assert.equal(exv.elements.length, 2, "two distinct elements");
  const skul = cases.filter((x) => x.folder === "m026skul").map((x) => [x.clip, x.mesh]);
  assert.deepEqual(skul, [[9, 212], [13, 212]], "SkullGreymon's two casts share mesh 212");
  // data-driven: the disc's own 55 species alone give fewer cases
  const fewer = sharedMeshCases(disc.digimon, techTable, modelMap, c.reader);
  assert.ok(fewer.length > 0 && fewer.length < cases.length, `${fewer.length} < ${cases.length}`);
  assert.ok(fewer.every((x) => cases.some((y) => y.folder === x.folder && y.clip === x.clip)));
});

test("silent clips: 76 authored attack clips carry no strike; six of them are cast/signature", { skip }, () => {
  const c = corpusScan();
  const silent = silentClips(folders, c.reader);
  console.log(`silent authored attack clips: ${silent.count} (${silent.casts.length} cast/signature)`);
  assert.equal(silent.count, 76, "present clips 5..17 minus the DNA presentation, with no op10 98/99");
  assert.equal(CORPUS_FACTS.silentClips, silent.count, "the page's number is this number");
  const casts = silent.casts.map((x) => `${x.folder} ${x.clip}`);
  assert.deepEqual(casts, [
    "m014monz 9", "m059houo 11", "m070waru 9", "m410ved2 9", "m437bast 9", "m440sijn 9",
  ]);
  assert.deepEqual(CORPUS_FACTS.silentCasts, silent.casts.map((x) => [x.folder, x.clip]));
  assert.ok(silent.clips.every((x) => !(x.clip >= 0 && x.clip <= 4)), "the reaction/idle clips are not attack clips");
  assert.ok(silent.clips.every((x) => x.clip !== 12), "clip 12 is the DNA presentation, not an attack");
});

// ── the species join ─────────────────────────────────────────────────────────────

test("moveRows: Meramon's five moves join their clips, names, elements, meshes and their own effect byte", { skip }, () => {
  assert.deepEqual(techniqueIds(profile("Meramon")), [298, 138, 137, 202, 139], "basic, signature, then the slots, deduped");
  const rows = moveRows(profile("Meramon"), techTable, anim("m009mera"), null, skillById);
  assert.deepEqual(rows.map((r) => [r.techId, r.name, r.element, r.clip, r.mesh, r.strike]), [
    [298, "Fight", "fire", 5, null, true],
    [138, "Flame Lance", "fire", 9, 371, true],
    [137, "Flame Ball", "fire", 9, 371, true],
    [202, "Speed Up", "normal", 10, null, false],   // this body authors no clip 10
    [139, "Flame Breath", "fire", 9, 371, true],
  ]);
  // why two fire moves look different on one Digimon: same mesh, different effect byte
  assert.equal(rows.find((r) => r.techId === 137).effect, 4);
  assert.equal(rows.find((r) => r.techId === 138).effect, 5);
  assert.equal(rows.find((r) => r.techId === 137).own, true, "meramon authors clip 9");

  const agum = moveRows(profile("Agumon"), techTable, anim("m003agum"), null, skillById);
  assert.deepEqual(agum.map((r) => [r.techId, r.name, r.clip, r.mesh]), [
    [4, "Fight", 5, null],
    [56, "Pepper Breath", 11, 101],
  ]);
});

// ── purity ───────────────────────────────────────────────────────────────────────

test("the module is pure", () => {
  const src = fs.readFileSync(path.join(ROOT, "web/fight/body-loadout.js"), "utf8");
  assert.ok(!/fetch\s*\(/.test(src), "no fetch");
  assert.ok(!/node:fs|require\(/.test(src), "no filesystem");
  assert.ok(!/window\.|document\./.test(src), "no DOM");
  assert.ok(!/localStorage/.test(src), "the page stores nothing");
});
