// Measure a DW2 glTF's clips from the joint data alone (no browser, no picture).
//
//   node tools/measure_dw2_clips.mjs <model.gltf> [--feet=9,13,18,22] [--rows=clip]
//
// FEET: the joints whose ends are the feet (a four-legged rig has four; default = the hip/knee chain ends found by
// following each depth-1 node down its longest child chain). Per clip the summary gives, for every foot, the height
// range above the clip's lowest point, the number of PLANT runs (on the ground and not moving), and the stance slide
// along the swing axis. A WALK is a loop where feet alternate planted runs, with real lift and a non-zero stance slide.
//
// The rig is RIGID (no JOINTS_0/WEIGHTS_0): a pose is the node TRS walk, which is what anim-viewer-dw2.js samples.
import fs from "node:fs";
import {
  parseGltf, samplePose, poseBounds, modelStats,
} from "/home/dorij/dw2003-play-anim/web/anim-viewer-dw2.js";

const args = process.argv.slice(2);
const file = args[0];
if (!file) { console.error("usage: node tools/measure_dw2_clips.mjs <model.gltf> [--feet=a,b,c] [--rows=clip]"); process.exit(2); }
const rowsFor = (args.find((a) => a.startsWith("--rows=")) || "").slice(7) || null;
const feetArg = (args.find((a) => a.startsWith("--feet=")) || "").slice(7);

const json = JSON.parse(fs.readFileSync(file, "utf8"));
const model = parseGltf(json);
const stats = modelStats(model);
const nodes = model.json.nodes;
const nodeNames = nodes.map((n, i) => n.name || `node${i}`);

const steps = new Map();
for (const a of model.anims) for (const ch of a.channels) {
  for (let i = 1; i < ch.times.length; i++) {
    const d = ch.times[i] - ch.times[i - 1];
    if (d > 1e-6) steps.set(+d.toFixed(6), (steps.get(+d.toFixed(6)) || 0) + 1);
  }
}
const keyStep = [...steps.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
const fps = keyStep ? Math.round(1 / keyStep) : 30;

function leafChain(start) {
  let i = start, guard = 0;
  while ((nodes[i].children || []).length && guard++ < 12) {
    // the longest child chain is the limb; all children of these rigs are one limb
    const kids = nodes[i].children;
    i = kids.reduce((best, c) => (chainLength(c) > chainLength(best) ? c : best), kids[0]);
  }
  return i;
}
function chainLength(i) {
  let n = 1;
  for (const c of nodes[i].children || []) n += chainLength(c);
  return n;
}

let feet;
if (feetArg) feet = feetArg.split(",").map((n) => (n.includes("bone_") ? nodes.findIndex((x) => x.name === n) : Number(n)));
else feet = (nodes[0]?.children || []).map(leafChain);

console.log(`${file}`);
console.log(`  generator ${stats.gen} nodes ${stats.nodes} meshes ${stats.meshes} tris ${stats.tris} skins ${model.json.skins?.length ?? 0} joints ${stats.joints}`);
console.log(`  clips ${stats.clips} key step ${keyStep}s -> fps ${fps}`);
console.log(`  feet joints: ${feet.map((f) => `${nodeNames[f]}(#${f})`).join(", ")}`);
console.log("");

const summary = [];
for (const clip of model.anims) {
  const nticks = Math.max(2, Math.round(clip.dur * fps));
  const all = [];
  for (let t = 0; t <= nticks; t++) {
    const pose = samplePose(model, clip.index, t / fps);
    all.push(feet.map((n) => [pose.world[n * 16 + 12], pose.world[n * 16 + 13], pose.world[n * 16 + 14]]));
  }
  const ground = Math.min(...all.flatMap((P) => P.map((p) => p[1])));
  const lifts = feet.map((_, fi) => Math.max(...all.map((P) => P[fi][1])) - ground);
  const lift = Math.max(...lifts);
  // the horizontal axis the feet swing along
  const spread = (k) => Math.max(...feet.map((_, fi) => Math.max(...all.map((P) => P[fi][k])) - Math.min(...all.map((P) => P[fi][k]))));
  const swing = spread(0) >= spread(2) ? 0 : 2;
  const rows = all.map((P, t) => feet.map((_, fi) => ({
    h: P[fi][1] - ground,
    v: t ? P[fi][swing] - all[t - 1][fi][swing] : 0,
  })));
  const topSpeed = Math.max(...rows.flatMap((r) => r.map((q) => Math.abs(q.v))), 1e-9);
  const lowBand = Math.max(0.04 * lift, 1e-4);
  const isPlanted = (q) => q.h <= lowBand && Math.abs(q.v) <= 0.35 * topSpeed;
  const runs = feet.map((_, fi) => {
    let n = 0, was = false;
    for (const r of rows) { const p = isPlanted(r[fi]); if (p && !was) n++; was = p; }
    return n;
  });
  const stance = rows.flatMap((r) => r.filter(isPlanted).map((q) => q.v));
  const stanceMean = stance.length ? stance.reduce((a, c) => a + c, 0) / stance.length : 0;
  const duty = stance.length / (rows.length * feet.length);
  const alt = Math.min(...runs);
  const rec = { name: clip.name, dur: clip.dur, ticks: nticks, lift, stanceMean, duty, alt, runs, lifts };
  summary.push(rec);
  console.log(`clip ${String(clip.index).padStart(2)} ${clip.name.padEnd(8)} ${clip.dur.toFixed(3)}s ${String(nticks + 1).padStart(3)} ticks  lift ${lift.toFixed(1).padStart(7)}  stanceSlide ${(stanceMean >= 0 ? "+" : "") + stanceMean.toFixed(2)}  duty ${(100 * duty).toFixed(0).padStart(2)}%  plantRuns ${runs.join("/")}  perFootLift ${lifts.map((v) => v.toFixed(0)).join("/")}`);
  if (rowsFor && (rowsFor === clip.name || rowsFor === `anim_${clip.name}`)) {
    for (let t = 0; t < rows.length; t++) {
      console.log(`  tick ${String(t).padStart(2)}  ` + rows[t].map((q, fi) => `${fi}: h ${q.h.toFixed(2).padStart(7)} v ${(q.v >= 0 ? "+" : "") + q.v.toFixed(2).padStart(7)}${isPlanted(q) ? " PLANT" : "      "}`).join("  "));
    }
  }
}
console.log("");
const walks = summary.filter((r) => r.alt >= 2 && r.lift > 1 && Math.abs(r.stanceMean) > 0.05);
console.log(`walk candidates (every foot >=2 plant runs, lift > 1 unit, stance slide): ${walks.map((r) => `${r.name}(${r.stanceMean.toFixed(2)})`).join(", ") || "none"}`);
