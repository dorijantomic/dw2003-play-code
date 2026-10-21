// A15/C15: is the plan's launch point ON the prop mesh, and in the outer part of it?
import fs from "node:fs";
import path from "node:path";
const REPO = "/home/dorij/dw2003-play-anim";
const MODELS = path.join(REPO, "web/assets/battle/models");
const DATA = path.join(REPO, "web/assets/data");
const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const techTable = readJson(path.join(DATA, "fight_tech_table.json"));
const b3 = await import(path.join(REPO, "web/battle3d.js"));
const ft = await import(path.join(REPO, "web/fight/fight-tables.js"));
const cb = await import(path.join(REPO, "web/fight/clip-fallback.js"));
const lp = await import(path.join(REPO, "web/fight/launch-plan.js"));
const anat = await import(path.join(REPO, "web/fight/digimon-anatomy.js"));
ft.setTechTable(techTable);
const cache = new Map();
const getModel = (f) => { if (!cache.has(f)) cache.set(f, readJson(path.join(MODELS, f, "anim.json"))); return cache.get(f); };
cb.setFallbackDonor(getModel("m005grey").actions);
cb.setDonorLoader((f) => Promise.resolve(getModel(f)));

for (const [folder, tech] of [["m465snat", 158], ["m443sgr2", 160], ["m272shdr", 143], ["m104blmr", 142], ["m190bolt", 159]]) {
  const model = structuredClone(getModel(folder));
  model.folder = folder;
  await cb.prepareModelDonors(model);
  const t = techTable[String(tech)];
  const clip = ft.techToClip(tech);
  const plan = lp.launchPointsFor(model, { tech: techTable[String(tech)]?.name ?? null, volley: clip === 13, tables: [model.castBakes?.[clip]?.table].filter((x) => x != null) });
  console.log("==", folder, "tech", tech, "plan", JSON.stringify({ points: plan.points.map((q) => ({ id: q.id, bone: q.bone, frame: q.frame, point: q.point, source: q.source })), mode: plan.mode, rule: plan.rule }));
  for (const q of plan.points) {
    const side = lp.emitterSide(q.id);
    if (!side || !anat.armArmed(folder, side)) { console.log("   ", q.id, "not armed side", side); continue; }
    const equip = anat.armEquip(folder, side);
    const b = model.bones[equip.bone];
    const { mats } = b3.buildBoneWorldMatrices(model, q.frame, null);
    const M = mats[equip.bone];
    if (!M) continue;
    let best = null, bd = -1, nearest = Infinity, nearV = null;
    const p = [q.x, q.y, q.z];
    for (const v of b.verts || []) {
      const x = -(M[0] * v[0] + M[4] * v[1] + M[8] * v[2]) + M[12];
      const y = M[1] * v[0] + M[5] * v[1] + M[9] * v[2] + M[13];
      const z = -(M[2] * v[0] + M[6] * v[1] + M[10] * v[2]) + M[14];
      const d = Math.hypot(x - M[12], y - M[13], z - M[14]);
      if (d > bd) { bd = d; best = [x, y, z]; }
      if (p) { const dd = Math.hypot(x - p[0], y - p[1], z - p[2]); if (dd < nearest) { nearest = dd; nearV = [x, y, z]; } }
    }
    const dFromBone = p ? Math.hypot(p[0] - M[12], p[1] - M[13], p[2] - M[14]) : null;
    console.log("   ", { id: q.id, side, bone: equip.bone, cls: equip.class, frame: q.frame, point: p, nearestVert: Math.round(nearest), farVert: best?.map(Math.round), farDist: Math.round(bd), pointFromBone: dFromBone != null ? Math.round(dFromBone) : null, ratio: dFromBone != null ? +(dFromBone / bd).toFixed(2) : null });
  }
}
