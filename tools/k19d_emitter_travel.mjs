// How far an emitter actually travels during the solver's cast (the whole table, not just before release).
// A gate can pass an aim test on a pose that never moves; this prints the movement itself.
import fs from "node:fs";
import path from "node:path";
const ROOT = "/home/dorij/dw2003-play-anim";
const FA = await import(path.join(ROOT, "web/fight/firing-axis.js"));
const S = await import(path.join(ROOT, "web/fight/anim-solver.js"));
const { prepareModelDonors, setDonorLoader } = await import(path.join(ROOT, "web/fight/clip-fallback.js"));
const MODELS = path.join(ROOT, "web/assets/battle/models");
const cache = new Map();
setDonorLoader((f) => {
  if (!cache.has(f)) { const p = path.join(MODELS, f, "anim.json"); cache.set(f, fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : null); }
  return Promise.resolve(cache.get(f));
});
const EX = [["m228piem", "Darkness Chaos"], ["m050coca", "Air Blast"], ["m178kngt", "Electro Bolt"]];
for (const [folder, tech] of EX) {
  const model = JSON.parse(fs.readFileSync(path.join(MODELS, folder, "anim.json"), "utf8"));
  model.folder = folder;
  await prepareModelDonors(model);
  const res = S.solveCast(model, { tech, apply: true });
  if (!res?.ok) { console.log(`${folder} ${tech}: refused (${res?.report ? JSON.stringify(res.report.gate) : "no cast"})`); continue; }
  const ids = (res.plan?.sites || []).map((s) => s.id);
  for (const id of ids) {
    let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    let atRel = null;
    for (let t = 0; t < res.ticks; t++) {
      const pose = FA.poseFromChannels(model, res.offset + t);
      const ax = FA.firingAxis(model, folder, id, pose);
      if (!ax) continue;
      for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], ax.origin[i]); hi[i] = Math.max(hi[i], ax.origin[i]); }
      if (t === res.tick) atRel = ax.origin;
    }
    const span = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
    const H = res.report.height;
    console.log(`${folder} ${tech} ${id}: emitter travels x${(span[0] / H).toFixed(3)} y${(span[1] / H).toFixed(3)} z${(span[2] / H).toFixed(3)} H over ${res.ticks} ticks; at release ${atRel ? atRel.map((v) => v.toFixed(0)).join(",") : "—"}`);
  }
}
