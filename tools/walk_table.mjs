// walk_table.mjs — per-foot footfalls for a DW2 model's clips, from the joint data alone (no browser, no picture).
//
//   node tools/walk_table.mjs <model.gltf> [--feet=a,b,c,d] [--rows=clip]
//
// Each foot is measured against ITS OWN lowest point in the clip (the rig's rear feet rest lower than the front
// ones, so one global ground would hide the front feet completely). Per clip and foot: lift, plant runs, duty
// (share of ticks planted), phase (tick of the highest lift, as a fraction of the clip) and the stance slide
// along the swing axis (the body passing over a foot that stays put).
//
// A WALK LOOP is: in place (the body root does not travel), the last tick repeats the first, every foot plants
// at least once, the feet do NOT all peak on the same tick (a gait, not a hop), and the planted feet slide.
import fs from "node:fs";
import { parseGltf, samplePose, poseBounds } from "/home/dorij/dw2003-play-anim/web/anim-viewer-dw2.js";

const args = process.argv.slice(2);
const file = args[0];
if (!file) { console.error("usage: node tools/walk_table.mjs <model.gltf> [--feet=a,b,c,d] [--rows=clip]"); process.exit(2); }
const rowsFor = (args.find((a) => a.startsWith("--rows=")) || "").slice(7) || null;
const feetArg = (args.find((a) => a.startsWith("--feet=")) || "").slice(7);

const model = parseGltf(JSON.parse(fs.readFileSync(file, "utf8")));
const nodes = model.json.nodes;
const name = (i) => nodes[i]?.name ?? `node${i}`;

// the skeleton root = the joint carrying the most descendants; its deepest leaf chains are the limbs
function descendants(i) {
  let n = 0;
  for (const c of nodes[i]?.children || []) n += 1 + descendants(c);
  return n;
}
const joints = (model.json.skins?.[0]?.joints ?? nodes.map((_, i) => i)).filter((i) => nodes[i]?.mesh == null);
let root = joints[0], best = -1;
for (const j of joints) { const d = descendants(j); if (d > best) { best = d; root = j; } }

function chainEnd(i, depth = 0) {
  const kids = nodes[i]?.children || [];
  if (!kids.length || depth > 14) return i;
  return chainEnd(kids.reduce((b, c) => (descendants(c) > descendants(b) ? c : b), kids[0]), depth + 1);
}

// feet: the chain ends of the limb subtrees, chosen as the deepest chains that end low in the rest pose
const bind = samplePose(model, -1, 0);
const b = poseBounds(model, bind);
const H = b.size[1] || 1;
let feet;
if (feetArg) feet = feetArg.split(",").map((n) => (n.includes("bone_") ? nodes.findIndex((x) => x.name === n) : Number(n)));
else {
  const cands = [];
  const visit = (i, d) => {
    const kids = nodes[i]?.children || [];
    for (const c of kids) {
      const e = chainEnd(c);
      const y = bind.world[e * 16 + 13];
      const depth = (() => { let k = 0, p = e; while (p >= 0) { k++; p = model.parent[p]; } return k; })();
      cands.push({ end: e, y, depth });
      visit(c, d + 1);
    }
  };
  visit(root, 0);
  // the four deepest chain ends, then the lowest of those by rest height (the feet of a four-legged rig)
  const deep = cands.sort((a, c) => c.depth - a.depth).slice(0, 8).sort((a, c) => a.y - c.y);
  const seen = new Set();
  feet = [];
  for (const c of deep) if (!seen.has(c.end) && feet.length < 4) { seen.add(c.end); feet.push(c.end); }
  feet.sort((a, c) => a - c);
}

const steps = new Map();
for (const a of model.anims) for (const ch of a.channels) for (let i = 1; i < ch.times.length; i++) {
  const d = ch.times[i] - ch.times[i - 1];
  if (d > 1e-6) steps.set(+d.toFixed(6), (steps.get(+d.toFixed(6)) || 0) + 1);
}
const fps = Math.round(1 / ([...steps.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? 1 / 30)) || 30;

console.log(file);
console.log(`  height ${H.toFixed(0)}  clips ${model.anims.length}  fps ${fps}  feet ${feet.map((f) => `${name(f)}(#${f})`).join(", ")}`);
const out = [];
for (const clip of model.anims) {
  const nticks = Math.max(2, Math.round(clip.dur * fps));
  const P = [];
  for (let t = 0; t <= nticks; t++) {
    const pose = samplePose(model, clip.index, t / fps);
    P.push(feet.map((n) => [pose.world[n * 16 + 12], pose.world[n * 16 + 13], pose.world[n * 16 + 14]]));
  }
  const rootP = [];
  for (let t = 0; t <= nticks; t++) {
    const pose = samplePose(model, clip.index, t / fps);
    rootP.push([pose.world[root * 16 + 12], pose.world[root * 16 + 13], pose.world[root * 16 + 14]]);
  }
  const travel = (Math.max(...rootP.map((p) => p[0])) - Math.min(...rootP.map((p) => p[0])))
    + (Math.max(...rootP.map((p) => p[2])) - Math.min(...rootP.map((p) => p[2])));
  const inPlace = travel <= 0.04 * H;
  const loopErr = Math.max(...feet.map((_, fi) => Math.hypot(
    P[P.length - 1][fi][0] - P[0][fi][0], P[P.length - 1][fi][1] - P[0][fi][1], P[P.length - 1][fi][2] - P[0][fi][2])));
  const loops = loopErr <= 0.03 * H;
  const spread = (k) => Math.max(...feet.map((_, fi) => Math.max(...P.map((Q) => Q[fi][k])) - Math.min(...P.map((Q) => Q[fi][k]))));
  const swing = spread(0) >= spread(2) ? 0 : 2;
  const f = feet.map((n, fi) => {
    const ys = P.map((Q) => Q[fi][1]);
    const yMin = Math.min(...ys);
    const lift = Math.max(...ys) - yMin;
    const vs = P.map((Q, t) => (t ? Q[fi][swing] - P[t - 1][fi][swing] : 0));
    const vMax = Math.max(...vs.map(Math.abs), 1e-9);
    const band = yMin + Math.max(0.08 * lift, 1e-6);
    const planted = P.map((Q, t) => Q[fi][1] <= band && Math.abs(vs[t]) <= 0.35 * vMax);
    let runs = 0, was = false;
    for (const p of planted) { if (p && !was) runs++; was = p; }
    const duty = planted.filter(Boolean).length / planted.length;
    const slide = vs.filter((_, t) => planted[t]).reduce((s, v) => s + v, 0) / Math.max(1, planted.filter(Boolean).length);
    const peak = ys.indexOf(Math.max(...ys));
    return { n, lift, runs, duty, slide, peak, phase: peak / nticks, planted, ys };
  });
  const peaks = new Set(f.map((q) => q.peak));
  const walk = inPlace && loops && f.every((q) => q.runs >= 1) && peaks.size >= 2
    && f.every((q) => q.duty >= 0.08 && q.duty <= 0.9);
  const rec = { clip: clip.name, dur: clip.dur, ticks: nticks, inPlace, loops, loopErr, travel, swing, f, walk, peaks: peaks.size };
  out.push(rec);
  const pat = P.map((_, t) => f.map((q) => (q.planted[t] ? String.fromCharCode(65 + f.indexOf(q)) : ".")).join("")).join("");
  console.log(`clip ${String(clip.index).padStart(2)} ${clip.name.padEnd(8)} ${clip.dur.toFixed(3)}s ${String(nticks + 1).padStart(3)}tk ` +
    `${inPlace ? "inplace" : "TRAVELS "} ${loops ? "loop  " : "NOloop"} peaks ${peaks.size}  ` +
    f.map((q) => `${name(q.n)}:${q.runs}r/${(100 * q.duty).toFixed(0)}%/l${q.lift.toFixed(0)}/p${q.phase.toFixed(2)}`).join(" ") +
    `  ${walk ? "WALK" : "-"}`);
  if (rowsFor && (rowsFor === clip.name || rowsFor === `anim_${clip.name}`)) console.log(`   plant map ${pat}`);
}
const walks = out.filter((r) => r.walk).map((r) => r.clip);
console.log(`\nwalk loops: ${walks.join(", ") || "none"}  (in place + loops + every foot plants + peaks spread + duty 8-90%)`);
