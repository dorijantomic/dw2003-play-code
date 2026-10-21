// K19d exemplar selection - the rule, printed with its candidates.
// Rule (BRIEF6): one exemplar per emitter class among models whose spell clips have no authored
// script (a gap) and whose current output is the planted own-body cast; the emitter class comes
// from the technique's OWN shot record (digimon-anatomy SHOTS) + the body's researched armament.
// Writes /home/dorij/scratch-research/anim-k19d-select.json
import fs from "node:fs";
import path from "node:path";
const REPO = "/home/dorij/dw2003-play-anim";
const MODELS = path.join(REPO, "web/assets/battle/models");
const A = await import(path.join(REPO, "web/fight/digimon-anatomy.js"));
const V = await import(path.join(REPO, "web/anim-viewer-data.js"));
const { prepareModelDonors, setDonorLoader, resolveClipScript } = await import(path.join(REPO, "web/fight/clip-fallback.js"));
const { ANIM_DONOR_GAPS } = await import(path.join(REPO, "web/fight/anim-donor-map.js"));

const dj = JSON.parse(fs.readFileSync(path.join(REPO, "web/assets/data/digimon.json"), "utf8"));
const extra = JSON.parse(fs.readFileSync(path.join(REPO, "web/assets/data/extra_species.json"), "utf8"));
const extraCanon = JSON.parse(fs.readFileSync(path.join(REPO, "web/assets/data/extra_species_canon.json"), "utf8"));
const modelMap = JSON.parse(fs.readFileSync(path.join(REPO, "web/assets/battle/model_map.json"), "utf8"));
const folders = (() => { const j = JSON.parse(fs.readFileSync(path.join(MODELS, "index.json"), "utf8")); return Array.isArray(j) ? j : j.models; })();
const index = V.buildModelIndex({ digimon: dj, extraSpecies: extra, extraCanon, modelMap, folders, gaps: ANIM_DONOR_GAPS });
const skills = new Map((dj.skills || []).map((s) => [s.id | 0, s]));
const cache = new Map();
setDonorLoader((folder) => {
  if (!cache.has(folder)) { const f = path.join(MODELS, folder, "anim.json"); cache.set(folder, fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : null); }
  return Promise.resolve(cache.get(folder));
});

const SPELL_CLIPS = new Set([9, 10, 11, 13, 16]);
const HEAD_PARTS = new Set(["mouth", "head", "eyes"]);
const ARM_PARTS = new Set(["left-arm", "right-arm"]);
// What an arm ENDS IN, from the body research's own `arm` field ([side, kind, ...]). A held implement
// (a sword, an axe, a staff) or a built-in gun makes the arm a PROP arm; a hand/claw/fist/tentacle/pincer
// is the body's own limb. The third field of the record is not a weapon flag (it is false on Knightmon's
// sword and true on Agumon's claw), so the KIND is the only honest source.
const PROP_KINDS = new Set(["sword", "axe", "cannon", "gun", "staff", "rod", "hammer", "spear", "blade", "whip", "scythe", "lance"]);

function armKinds(folder) {
  const out = { left: null, right: null };
  for (const a of A.anatomy(folder)?.arm || []) {
    const [side, kind] = a;
    if (side === "left" || side === "right") { if (!out[side]) out[side] = kind; }
  }
  return out;
}

function classify(folder, techName) {
  const ems = A.emitters(folder);
  const byId = new Map(ems.map((e) => [e.id, e]));
  const shot = A.shotsFor(folder, techName);
  const ids = (shot.emitters || []).slice();
  const parts = ids.map((id) => byId.get(id)?.part).filter(Boolean);
  const kinds = ids.map((id) => byId.get(id)?.kind).filter(Boolean);
  if (!parts.length) { const p = A.primaryEmitter(folder); if (p) { parts.push(p.part); kinds.push(p.kind); } }
  const kindsOfArm = armKinds(folder);
  const armed = (side) => PROP_KINDS.has(kindsOfArm[side]);
  const armParts = parts.filter((p) => ARM_PARTS.has(p));
  const headParts = parts.filter((p) => HEAD_PARTS.has(p));
  const ranged = kinds.some((k) => k !== "melee");
  if (headParts.length && (headParts.length === parts.length || !armParts.length) && ranged) return "mouth-head";
  if (armParts.length) {
    // both-arms: a prop only when BOTH hands carry the same implement (Piedmon's swords are on its back
    // and its hands are hands; a body that fires from two swords is a prop body)
    if (parts.includes("both-arms")) return armed("left") && armed("right") ? "prop-arm" : "bare-hands";
    return armParts.some((p) => armed(/left/.test(p) ? "left" : "right")) ? "prop-arm" : "bare-hands";
  }
  if (headParts.length) return "mouth-head";
  return "other:" + (parts.join("+") || "none");
}

const rows = [];
for (const entry of index) {
  const folder = entry.folder;
  if (!folder) continue;
  const gaps = Object.keys(ANIM_DONOR_GAPS[folder] || {}).map(Number);
  if (!gaps.length) continue;
  const model = JSON.parse(fs.readFileSync(path.join(MODELS, folder, "anim.json"), "utf8"));
  await prepareModelDonors(model);
  const spells = [];
  for (const id of entry.techs || []) {
    const s = skills.get(id | 0);
    if (!s || s.type !== "attack" || !SPELL_CLIPS.has(s.clip | 0)) continue;
    const clip = s.clip | 0;
    if (!gaps.includes(clip)) continue;
    const script = resolveClipScript(model, clip, {});
    const shot = A.shotsFor(folder, A.techKey(s.name));
    spells.push({ techId: id | 0, name: s.name, clip, element: s.element, hits: s.hits | 0 || 1,
                  power: s.power ?? null, mp: s.mp_cost ?? null,
                  planted: !script?.retargeted, buildKind: script?.buildKind || null,
                  shots: shot.mode, shotsN: shot.shots, emitters: shot.emitters,
                  emitterClass: classify(folder, s.name) });
  }
  if (!spells.length) continue;
  const a = A.anatomy(folder) || {};
  rows.push({ folder, name: entry.name, id: entry.id, ownership: entry.ownership, gaps,
              plan: a.plan, size: A.sizeClass(folder), arm: a.arm ?? null, armament: a.armament ?? [],
              armEquip: A.armEquipSides(folder), spells });
}
fs.writeFileSync("/home/dorij/scratch-research/anim-k19d-select.json", JSON.stringify(rows, null, 1));

const byClass = new Map();
for (const r of rows) for (const s of r.spells) {
  const k = s.emitterClass;
  if (!byClass.has(k)) byClass.set(k, []);
  byClass.get(k).push({ folder: r.folder, name: r.name, techId: s.techId, tech: s.name, clip: s.clip,
                        planted: s.planted, shots: s.shots, shotsN: s.shotsN, emitters: s.emitters, size: r.size });
}
console.log("RULE: a model is a candidate when one of its own attack spells uses a clip the model has no authored");
console.log("script for (a gap, so the cast must be generated), split by the emitter the technique's own shot record");
console.log("fires from. One exemplar per class, preferring the user's named examples, then the bigger body and the");
console.log("most visible shot. Rows below are techniques (one model can own several).\n");
for (const [k, list] of [...byClass.entries()].sort((a, b) => b[1].length - a[1].length)) {
  const planted = list.filter((x) => x.planted);
  console.log(`== ${k}: ${list.length} rows across ${new Set(list.map((x) => x.folder)).size} models; ${planted.length} rows still planted, ${list.length - planted.length} retargeted`);
  const seen = new Set();
  for (const x of planted) {
    if (seen.has(x.folder)) continue; seen.add(x.folder);
    console.log(`   planted  ${x.folder.padEnd(9)} ${String(x.name).padEnd(20)} tech ${String(x.techId).padEnd(4)} clip ${x.clip} ${x.tech.padEnd(18)} shots=${x.shots}/${x.shotsN} emitters=${JSON.stringify(x.emitters)} size=${x.size}`);
  }
  for (const x of list.filter((y) => !y.planted)) {
    if (seen.has(x.folder)) continue; seen.add(x.folder);
    if (seen.size > 12) break;
    console.log(`   retarget ${x.folder.padEnd(9)} ${String(x.name).padEnd(20)} tech ${String(x.techId).padEnd(4)} clip ${x.clip} ${x.tech.padEnd(18)} shots=${x.shots}/${x.shotsN}`);
  }
  console.log();
}
console.log("models with spell gaps:", rows.length);
