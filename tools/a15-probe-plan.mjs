// A15/C15: the checker's own pipeline for one (model, tech) - script -> tables -> launch plan -> the
// geometric C15 facts - so a failing row can be read point by point.
import fs from "node:fs";
import path from "node:path";
const REPO = "/home/dorij/dw2003-play-anim";
const MODELS = path.join(REPO, "web/assets/battle/models");
const DATA = path.join(REPO, "web/assets/data");
const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const techTable = readJson(path.join(DATA, "fight_tech_table.json"));
const digimon = readJson(path.join(DATA, "digimon.json"));
const b3 = await import(path.join(REPO, "web/battle3d.js"));
const ft = await import(path.join(REPO, "web/fight/fight-tables.js"));
const cb = await import(path.join(REPO, "web/fight/clip-fallback.js"));
const lp = await import(path.join(REPO, "web/fight/launch-plan.js"));
const anat = await import(path.join(REPO, "web/fight/digimon-anatomy.js"));
ft.setTechTable(techTable);
const skills = new Map(digimon.skills.map((s) => [s.id | 0, s]));
const cache = new Map();
const getModel = (f) => { if (!cache.has(f)) cache.set(f, readJson(path.join(MODELS, f, "anim.json"))); return cache.get(f); };
cb.setFallbackDonor(getModel("m005grey").actions);
cb.setDonorLoader((f) => Promise.resolve(getModel(f)));

for (const [folder, tech] of process.argv.slice(2).map((s) => s.split(":")).map(([f, t]) => [f, Number(t)])) {
  const model = structuredClone(getModel(folder));
  model.folder = folder;
  await cb.prepareModelDonors(model);
  const t = techTable[String(tech)];
  const clip = ft.techToClip(tech);
  const script = cb.resolveClipScript(model, clip, { element: t.elem1, target: ft.techTargetClass(tech), tech: skills.get(tech)?.name ?? null });
  const tables = cb.scriptTableSeq({ ops: script.ops });
  const plan = lp.launchPointsFor(model, { tech: skills.get(tech)?.name ?? null, volley: Number(clip) === 13, tables });
  console.log("==", folder, "tech", tech, "clip", clip, "kind", script.buildKind, "tables", JSON.stringify(tables), "mode", plan.mode, "n", plan.points.length);
  for (const q of plan.points) {
    const side = lp.emitterSide(q.id);
    const armed = side ? anat.armArmed(folder, side) : false;
    const equip = side ? anat.armEquip(folder, side) : null;
    let line = { id: q.id, side, bone: q.bone, frame: q.frame, xyz: [q.x, q.y, q.z], spread: q.spread, source: q.source, propBone: q.propBone, armed, equip: equip ? { bone: equip.bone, cls: equip.class, att: equip.attachment } : null };
    if (armed && equip && (!equip.attachment || equip.attachment === "arm")) {
      const b = model.bones[equip.bone];
      const { mats } = b3.buildBoneWorldMatrices(model, q.frame, null);
      const M = mats[equip.bone];
      if (M && b?.verts?.length) {
        let near = Infinity, far = 0;
        for (const v of b.verts) {
          const x = -(M[0] * v[0] + M[4] * v[1] + M[8] * v[2]) + M[12];
          const y = M[1] * v[0] + M[5] * v[1] + M[9] * v[2] + M[13];
          const z = -(M[2] * v[0] + M[6] * v[1] + M[10] * v[2]) + M[14];
          near = Math.min(near, Math.hypot(x - q.x, y - q.y, z - q.z));
          far = Math.max(far, Math.hypot(x - M[12], y - M[13], z - M[14]));
        }
        const out = Math.hypot(q.x - M[12], q.y - M[13], q.z - M[14]);
        line.prop = { near: Math.round(near), far: Math.round(far), outward: Math.round(out), ratio: +(out / (far || 1)).toFixed(2), miss: Math.round(Math.max(0, near - (q.spread || 0))) };
      } else line.prop = "no mesh at frame";
    }
    console.log(JSON.stringify(line));
  }
}
