// A14 probe 12: where is the emitter bone, really? m172mtar (failing) vs m138delt (visible-but-backwards).
import fs from "node:fs";
import path from "node:path";
const REPO = "/home/dorij/dw2003-play-anim";
const MODELS = path.join(REPO, "web/assets/battle/models");
const read = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const lp = await import(path.join(REPO, "web/fight/launch-plan.js"));
const bm = await import(path.join(REPO, "web/fight/digimon-bonemap.js"));
const anat = await import(path.join(REPO, "web/fight/digimon-anatomy.js"));
const cb = await import(path.join(REPO, "web/fight/clip-fallback.js"));
const rt = await import(path.join(REPO, "web/fight/anim-retarget.js"));
const sm = await import(path.join(REPO, "web/fight/side-mirror.js"));

for (const folder of ["m172mtar", "m138delt"]) {
  const m = read(path.join(MODELS, folder, "anim.json"));
  const map = bm.BONEMAP[folder];
  console.log(`\n=== ${folder} bones=${m.bones.length} authoredSide=${sm.authoredSide(m)}`);
  console.log("bonemap:", JSON.stringify({ f: map?.f, aLe: map?.aLe, aRe: map?.aRe, t: map?.t, r: map?.r, h: map?.h }));
  console.log("arms left:", JSON.stringify(bm.armChains(folder, "left")), "right:", JSON.stringify(bm.armChains(folder, "right")), "conf:", bm.sideConfidence(folder));
  console.log("emitters:", JSON.stringify(anat.emitters(folder)));
  const plan = lp.launchPointsFor(m, { tech: "Ice Shower", tables: cb.scriptTableSeq(m.actions?.[5] ?? { ops: [] }) });
  console.log("plan(Ice Shower):", JSON.stringify(plan.points.map((p) => ({ id: p.id, bone: p.bone, frame: p.frame, x: p.x, y: p.y, z: p.z }))));
  for (const p of plan.points.slice(0, 1)) {
    const pos = rt.restPose(m, p.frame).pos;
    let lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
    for (const v of pos) if (v) for (let k = 0; k < 3; k++) { if (v[k] < lo[k]) lo[k] = v[k]; if (v[k] > hi[k]) hi[k] = v[k]; }
    console.log(` body bbox at frame ${p.frame}: ${lo.map(Math.round)}..${hi.map(Math.round)}  size ${hi.map((v, k) => Math.round(v - lo[k]))}`);
    const out = []; let b = p.bone;
    while (b != null && b >= 0) { out.push(`${b}@${JSON.stringify(pos[b]?.map(Math.round))}`); b = m.bones[b]?.parent_slot; }
    console.log(" emitter bone chain:", out.join(" <- "));
  }
}
