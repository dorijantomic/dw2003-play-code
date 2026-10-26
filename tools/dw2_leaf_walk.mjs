// Print every clip's plant map for a model's foot leaves (no browser, no picture).
//
//   node tools/dw2_leaf_walk.mjs <model.gltf>
//
// FEET = every leaf joint (no children) whose bind-pose height is in the lower 40% of the model, i.e. the ends of
// the leg chains. For each clip, each foot's plant map over the ticks: P planted (at its lowest, nearly still),
// o low but sliding, . lifted. A walk shows the P blocks rotating through the feet, spread over the whole clip.
import fs from "node:fs";
import { parseGltf, samplePose, poseBounds } from "/home/dorij/dw2003-play-anim/web/anim-viewer-dw2.js";

const file = process.argv[2];
const model = parseGltf(JSON.parse(fs.readFileSync(file, "utf8")));
const nodes = model.json.nodes;
const bind = samplePose(model, -1, 0);
const b = poseBounds(model, bind);
const H = b.size[1] || 1;
const lowCut = b.min[1] + H * 0.62;
const joints = (model.json.skins?.[0]?.joints ?? nodes.map((_, i) => i)).filter((i) => nodes[i]?.mesh == null);
const leaves = joints.filter((i) => (nodes[i].children || []).every((c) => nodes[c]?.mesh != null) && bind.world[i * 16 + 13] <= lowCut);
const steps = new Map();
for (const a of model.anims) for (const ch of a.channels) for (let i = 1; i < ch.times.length; i++) {
  const d = ch.times[i] - ch.times[i - 1];
  if (d > 1e-6) steps.set(+d.toFixed(6), (steps.get(+d.toFixed(6)) || 0) + 1);
}
const fps = Math.round(1 / ([...steps.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? 1 / 30)) || 30;
console.log(`${file}`);
console.log(`  H ${H.toFixed(0)}  feet: ${leaves.map((i) => `${nodes[i].name ?? i}@y${bind.world[i * 16 + 13].toFixed(0)},z${bind.world[i * 16 + 14].toFixed(0)}`).join(" ")}`);
for (const clip of model.anims) {
  const nticks = Math.max(4, Math.round(clip.dur * fps));
  const P = [];
  for (let t = 0; t <= nticks; t++) {
    const pose = samplePose(model, clip.index, t / fps);
    P.push(leaves.map((n) => [pose.world[n * 16 + 12], pose.world[n * 16 + 13], pose.world[n * 16 + 14]]));
  }
  const maps = leaves.map((n, fi) => {
    const ys = P.map((f) => f[fi][1]);
    const yMin = Math.min(...ys), yMax = Math.max(...ys);
    const lift = yMax - yMin;
    const xs = P.map((f) => f[fi][0]), zs = P.map((f) => f[fi][2]);
    const xr = Math.max(...xs) - Math.min(...xs), zr = Math.max(...zs) - Math.min(...zs);
    const axis = xr >= zr ? 0 : 2;
    const vs = P.map((f, t) => (t ? f[fi][axis] - P[t - 1][fi][axis] : 0));
    const vMax = Math.max(...vs.map(Math.abs), 1e-9);
    const lowBand = yMin + Math.max(0.06 * lift, 1e-6);
    let map = "";
    for (let t = 0; t < P.length; t++) {
      const low = P[t][fi][1] <= lowBand;
      map += low && Math.abs(vs[t]) <= 0.3 * vMax ? "P" : low ? "o" : ".";
    }
    return { map, lift, swing: axis ? zr : xr };
  });
  console.log(`  ${clip.name.padEnd(8)} ${clip.dur.toFixed(2)}s ${String(P.length).padStart(3)}t   ` + maps.map((m, i) => `${nodes[leaves[i]].name}:${m.map}`).join("  "));
}
