// A14 probe 13: the plan AFTER the tip extension — where does the muzzle sit relative to the body?
import fs from "node:fs";
import path from "node:path";
const REPO = "/home/dorij/dw2003-play-anim";
const MODELS = path.join(REPO, "web/assets/battle/models");
const read = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const lp = await import(path.join(REPO, "web/fight/launch-plan.js"));
const rt = await import(path.join(REPO, "web/fight/anim-retarget.js"));
const bm = await import(path.join(REPO, "web/fight/digimon-bonemap.js"));
for (const folder of ["m172mtar", "m138delt", "m005grey"]) {
  const m = read(path.join(MODELS, folder, "anim.json"));
  const plan = lp.launchPointsFor(m, { tech: null, tables: [14, 15, 16, 17, 18].filter((t) => m.timeline?.[t]) });
  console.log(`\n${folder} plan:`, JSON.stringify(plan.points.map((p) => ({ id: p.id, bone: p.bone, frame: p.frame, x: p.x, y: p.y, z: p.z }))));
  for (const p of plan.points.slice(0, 1)) {
    const pos = rt.restPose(m, p.frame).pos;
    let lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
    for (const v of pos) if (v) for (let k = 0; k < 3; k++) { if (v[k] < lo[k]) lo[k] = v[k]; if (v[k] > hi[k]) hi[k] = v[k]; }
    const joint = pos[p.bone];
    console.log(` bone joint=${JSON.stringify(joint?.map(Math.round))} tip=(${p.x},${p.y},${p.z})  bones bbox=${lo.map(Math.round)}..${hi.map(Math.round)}`);
    console.log(` arm chain positions:`, JSON.stringify(bm.armChains(folder, "left")[0]?.map((b) => pos[b]?.map(Math.round))));
  }
}
