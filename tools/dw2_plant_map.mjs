// Which bones stand still in each clip of a DW2 model: a plant/step map per joint (no browser, no picture).
//
//   node tools/dw2_plant_map.mjs <model.gltf> [--clip=name]
//
// For every joint node: its bind-pose world y, its y range and horizontal travel over the clip, and a one-character
// per tick map:  P = on its lowest point and nearly still (a planted foot),  . = lifted or moving,  o = near its own
// lowest point but sliding. A walk cycle shows two or four bones alternating P runs.
import fs from "node:fs";
import { parseGltf, samplePose, poseBounds } from "/home/dorij/dw2003-play-anim/web/anim-viewer-dw2.js";

const file = process.argv[2];
const only = (process.argv.slice(3).find((a) => a.startsWith("--clip=")) || "").slice(7) || null;
const model = parseGltf(JSON.parse(fs.readFileSync(file, "utf8")));
const nodes = model.json.nodes;
const bind = samplePose(model, -1, 0);
const b = poseBounds(model, bind);
const height = b.size[1];
const steps = new Map();
for (const a of model.anims) for (const ch of a.channels) for (let i = 1; i < ch.times.length; i++) {
  const d = ch.times[i] - ch.times[i - 1];
  if (d > 1e-6) steps.set(+d.toFixed(6), (steps.get(+d.toFixed(6)) || 0) + 1);
}
const fps = Math.round(1 / ([...steps.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? 1 / 30));
const joints = (model.json.skins?.[0]?.joints ?? []).filter((i) => nodes[i]?.mesh == null);
const cutoff = b.min[1] + height * 0.55;                  // bones below this are legs/tail candidates
const legs = joints.filter((i) => bind.world[i * 16 + 13] < cutoff);
console.log(`${file}  height ${height.toFixed(0)}  bind feet band < ${cutoff.toFixed(0)}`);
console.log("leg candidate joints:", legs.map((i) => `${nodes[i].name ?? i}@y${bind.world[i * 16 + 13].toFixed(0)}`).join(" "));
for (const clip of model.anims) {
  if (only && clip.name !== only && `anim_${only}` !== clip.name) continue;
  const nticks = Math.max(2, Math.round(clip.dur * fps));
  const P = [];
  for (let t = 0; t <= nticks; t++) {
    const pose = samplePose(model, clip.index, t / fps);
    P.push(legs.map((n) => [pose.world[n * 16 + 12], pose.world[n * 16 + 13], pose.world[n * 16 + 14]]));
  }
  console.log(`\nclip ${clip.index} ${clip.name} ${clip.dur.toFixed(3)}s ${nticks + 1} ticks`);
  legs.forEach((n, fi) => {
    const ys = P.map((f) => f[fi][1]);
    const yMin = Math.min(...ys), yMax = Math.max(...ys);
    const xs = P.map((f) => f[fi][0]), zs = P.map((f) => f[fi][2]);
    const xr = Math.max(...xs) - Math.min(...xs), zr = Math.max(...zs) - Math.min(...zs);
    const axis = xr >= zr ? 0 : 2;
    const vs = P.map((f, t) => (t ? f[fi][axis] - P[t - 1][fi][axis] : 0));
    const vMax = Math.max(...vs.map(Math.abs), 1e-9);
    const lowBand = yMin + Math.max(0.06 * (yMax - yMin), 1e-6);
    let map = "";
    for (let t = 0; t < P.length; t++) {
      const low = P[t][fi][1] <= lowBand;
      const slow = Math.abs(vs[t]) <= 0.3 * vMax;
      map += low && slow ? "P" : low ? "o" : ".";
    }
    console.log(`  ${String(nodes[n].name ?? n).padEnd(10)} y ${ys[0].toFixed(0).padStart(6)}  yRange ${(yMax - yMin).toFixed(0).padStart(6)}  travel ${(axis ? "z" : "x")} ${(axis ? zr : xr).toFixed(0).padStart(6)}  ${map}`);
  });
}
