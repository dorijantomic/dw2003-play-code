// A14 probe 2: the built cast script for a model/tech, op by op, plus the launch plan and the
// effect-player verdict on the projectile id.
import fs from "node:fs";
import path from "node:path";

const REPO = "/home/dorij/dw2003-play-anim";
const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const MODELS = path.join(REPO, "web/assets/battle/models");
const DATA = path.join(REPO, "web/assets/data");

const b3 = await import(path.join(REPO, "web/battle3d.js"));
const ft = await import(path.join(REPO, "web/fight/fight-tables.js"));
const cb = await import(path.join(REPO, "web/fight/clip-fallback.js"));
const lp = await import(path.join(REPO, "web/fight/launch-plan.js"));
const anat = await import(path.join(REPO, "web/fight/digimon-anatomy.js"));
const { EffectPlayer } = await import(path.join(REPO, "web/fight/effect-player.js"));

const digimon = readJson(path.join(DATA, "digimon.json"));
const techTable = readJson(path.join(DATA, "fight_tech_table.json"));
ft.setTechTable(techTable);
ft.setSkillTable(digimon);
const itemDir = "/home/dorij/scratch-research/scratch";
try { ft.setItemUseEffects(readJson(path.join(itemDir, "item_use_effects.json"))); } catch {}
try { ft.setThrowItemEffects(readJson(path.join(itemDir, "throw_item_effects.json"))); } catch {}
cb.setFallbackDonor(readJson(path.join(MODELS, "m005grey/anim.json")).actions);
cb.setDonorLoader((folder) => { try { return Promise.resolve(readJson(path.join(MODELS, folder, "anim.json"))); } catch { return Promise.resolve(null); } });

const man = readJson(path.join(REPO, "web/assets/battle/effects/manifest.json"));
const skillById = new Map(digimon.skills.map((s) => [s.id | 0, s]));

function model(folder) { return readJson(path.join(MODELS, folder, "anim.json")); }
function opsFor(folder, techId, side = "near") {
  const m = model(folder);
  const rec = techTable[String(techId)] || {};
  const sk = skillById.get(techId | 0);
  const clip = ft.techToClip(techId);
  const script = cb.resolveClipScript(m, clip, {
    element: rec.elem1 ?? 1, target: ft.techTargetClass(techId),
    tech: sk?.name ?? null, planted: rec.attack_category === "magical",
  });
  return { m, rec, sk, clip, script };
}
function dump(label, folder, techId) {
  const { m, rec, sk, clip, script } = opsFor(folder, techId, "near");
  console.log(`\n=== ${label}: ${folder} tech ${techId} (${sk?.name}) clip ${clip} elem ${rec.elem1} target ${ft.techTargetClass(techId)} build=${script?.buildKind ?? script?.synthesized}`);
  console.log("own clips:", Object.keys(m.actions || {}).join(","));
  console.log("ownProjectile:", JSON.stringify((m.actions?.[9]?.ops ?? []).filter((o) => o.op === 6)));
  const rule = sk ? anat.shotsFor(folder, sk.name, { volley: clip === 13 }) : null;
  console.log("shotsFor:", JSON.stringify(rule));
  const plan = lp.launchPointsFor(m, { tech: sk?.name ?? null, volley: clip === 13, tables: cb.scriptTableSeq(script) });
  console.log("plan:", JSON.stringify({ mode: plan.mode, shots: plan.shots, points: plan.points.map((p) => ({ id: p.id, bone: p.bone, frame: p.frame, x: p.x, y: p.y, z: p.z })) }));
  for (const o of script?.ops ?? []) {
    if ([0, 2, 3, 5, 6, 10, 11, 255].includes(o.op)) console.log(" op", o.op, JSON.stringify(o.words));
    else console.log(" op", o.op, JSON.stringify(o.words));
  }
}
dump("BROKEN", "m172mtar", 150);
dump("WORKING", "m138delt", 150);
// Triple Fire id
const triple = digimon.skills.find((s) => /triple fire/i.test(s.name));
console.log("\ntriple fire skill:", triple && triple.id);
if (triple) dump("WORKING-2", "m138delt", triple.id);
// m005grey own clip 9
{
  const m = model("m005grey");
  const s = m.actions?.[9];
  console.log("\n=== m005grey own clip 9:", s ? s.ops.filter((o) => [2, 3, 6, 10, 11].includes(o.op)).map((o) => `${o.op}:[${o.words.join(",")}]`).join(" ") : "none");
}
// effect player verdict
const ep = new EffectPlayer(man);
console.log("\nmanifest has 221?", !!man.projectiles["221"], "has 218?", !!man.projectiles["218"]);
for (const id of [220, 221, 205, 210, 218, 206, 217]) {
  const f = path.join(REPO, "web/assets/battle/effects/proj", `${id}.json`);
  console.log(`proj ${id}: manifest=${!!man.projectiles[id]} mesh=${fs.existsSync(f)}`);
}
