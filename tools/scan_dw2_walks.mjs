// Find a real WALK clip in DW2 models, from joint data alone (no browser, no picture).
//
//   node tools/scan_dw2_walks.mjs <dir-or-file> [...]
//
// A clip is a walk when ALL of these hold, each measured:
//   1. IN-PLACE: the skeleton root's horizontal travel is under 4% of the model's height.
//   2. LOOPS: every joint's pose at the last tick is within 3% of the height of its pose at tick 0.
//   3. FEET: at least two joints in the lower half of the model have >= 2 PLANT runs each (on their own
//      lowest point and nearly still), a lift of >= 4% of the height, and a duty cycle of 10-75%.
//   4. ALTERNATION: for the two most-used feet, >= 30% of the ticks have exactly one of them planted.
//   5. STANCE SLIDE: the planted foot travels along the ground (>= 0.2% of the height per tick), i.e. the
//      body passes over a foot that stays put.
// The score counts feet (2 / 4), alternation, plant runs and a consistent slide direction; the printed
// pattern is the top two feet's plant map ("A" plant, "a" lifted) so the cycle can be read off.
import fs from "node:fs";
import path from "node:path";
import { parseGltf, samplePose, poseBounds } from "/home/dorij/dw2003-play-anim/web/anim-viewer-dw2.js";

const roots = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (!roots.length) { console.error("usage: node tools/scan_dw2_walks.mjs <dir-or-file> [...]"); process.exit(2); }
const MIN_SCORE = Number((process.argv.find((a) => a.startsWith("--min=")) || "--min=8").slice(6)) || 8;

function* walkFiles(p) {
  const st = fs.statSync(p);
  if (st.isFile()) { if (/\.gltf$/i.test(p)) yield p; return; }
  for (const e of fs.readdirSync(p, { withFileTypes: true })) {
    const q = path.join(p, e.name);
    if (e.isDirectory()) yield* walkFiles(q); else if (/\.gltf$/i.test(e.name)) yield q;
  }
}

function descendants(nodes, i) {
  let n = 0;
  for (const c of nodes[i]?.children || []) n += 1 + descendants(nodes, c);
  return n;
}

const results = [];
let clipsSeen = 0;
for (const root of roots) for (const file of walkFiles(root)) {
  let model;
  try { model = parseGltf(JSON.parse(fs.readFileSync(file, "utf8"))); } catch { continue; }
  const nodes = model.json.nodes;
  const b = poseBounds(model, samplePose(model, -1, 0));
  const H = b.size[1] || 1;
  const steps = new Map();
  for (const a of model.anims) for (const ch of a.channels) for (let i = 1; i < ch.times.length; i++) {
    const d = ch.times[i] - ch.times[i - 1];
    if (d > 1e-6) steps.set(+d.toFixed(6), (steps.get(+d.toFixed(6)) || 0) + 1);
  }
  const fps = Math.round(1 / ([...steps.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? 1 / 30)) || 30;
  const joints = (model.json.skins?.[0]?.joints ?? nodes.map((_, i) => i)).filter((i) => nodes[i]?.mesh == null);
  if (joints.length < 3) continue;
  // the skeleton root = the joint that carries the most descendants
  let bodyRoot = joints[0], best = -1;
  for (const j of joints) { const d = descendants(nodes, j); if (d > best) { best = d; bodyRoot = j; } }
  const bi = joints.indexOf(bodyRoot);
  for (const clip of model.anims) {
    clipsSeen++;
    const nticks = Math.max(4, Math.round(clip.dur * fps));
    const P = [];
    for (let t = 0; t <= nticks; t++) {
      const pose = samplePose(model, clip.index, t / fps);
      P.push(joints.map((n) => [pose.world[n * 16 + 12], pose.world[n * 16 + 13], pose.world[n * 16 + 14]]));
    }
    const bodyTravel = Math.max(...P.map((f) => f[bi][0])) - Math.min(...P.map((f) => f[bi][0]))
      + Math.max(...P.map((f) => f[bi][2])) - Math.min(...P.map((f) => f[bi][2]));
    const inPlace = bodyTravel <= 0.04 * H;
    const loopErr = Math.max(...joints.map((n, fi) => Math.hypot(
      P[P.length - 1][fi][0] - P[0][fi][0], P[P.length - 1][fi][1] - P[0][fi][1], P[P.length - 1][fi][2] - P[0][fi][2])));
    const loops = loopErr <= 0.03 * H;
    const yLow = Math.min(...P.flatMap((f) => f.map((p) => p[1])));
    const lowCut = yLow + H * 0.5;
    const feet = [];
    joints.forEach((n, fi) => {
      if (!P.some((f) => f[fi][1] <= lowCut)) return;
      const ys = P.map((f) => f[fi][1]);
      const yMin = Math.min(...ys), yMax = Math.max(...ys);
      const lift = yMax - yMin;
      if (lift < 0.04 * H) return;
      const xs = P.map((f) => f[fi][0]), zs = P.map((f) => f[fi][2]);
      const xr = Math.max(...xs) - Math.min(...xs), zr = Math.max(...zs) - Math.min(...zs);
      const axis = xr >= zr ? 0 : 2;
      const vs = P.map((f, t) => (t ? f[fi][axis] - P[t - 1][fi][axis] : 0));
      const vMax = Math.max(...vs.map(Math.abs), 1e-9);
      const lowBand = yMin + Math.max(0.06 * lift, 1e-6);
      const planted = P.map((f, t) => f[fi][1] <= lowBand && Math.abs(vs[t]) <= 0.3 * vMax);
      let runs = 0, was = false;
      for (const p of planted) { if (p && !was) runs++; was = p; }
      const duty = planted.filter(Boolean).length / planted.length;
      if (runs < 2 || duty < 0.1 || duty > 0.75) return;
      const slide = vs.filter((_, t) => planted[t]).reduce((s, v) => s + v, 0) / Math.max(1, planted.filter(Boolean).length);
      feet.push({ fi, name: nodes[n].name ?? String(n), lift, runs, duty, planted, slide, vs, axis });
    });
    clipsSeen = clipsSeen;
    if (feet.length < 2) continue;
    feet.sort((a, c) => c.runs - a.runs || c.duty - a.duty);
    const [A, B] = feet;
    let onlyA = 0, onlyB = 0, both = 0;
    for (let t = 0; t < P.length; t++) {
      if (A.planted[t] && !B.planted[t]) onlyA++;
      else if (B.planted[t] && !A.planted[t]) onlyB++;
      else if (A.planted[t] && B.planted[t]) both++;
    }
    const alt = (onlyA + onlyB) / P.length;
    const slideOk = Math.max(Math.abs(A.slide), Math.abs(B.slide)) >= 0.002 * H;
    const sameDir = Math.sign(A.slide) === Math.sign(B.slide) || Math.min(Math.abs(A.slide), Math.abs(B.slide)) < 0.002 * H;
    let score = 0;
    if (inPlace) score += 2;
    if (loops) score += 2;
    score += Math.min(4, Math.max(0, feet.length - 2) * 2);       // 4 feet = +4
    if (alt >= 0.3) score += 2;
    if (alt >= 0.5) score += 1;
    if (slideOk) score += 1;
    if (sameDir) score += 1;
    if (A.runs >= 3 && B.runs >= 3) score += 1;
    if (!inPlace || !loops) score -= 3;
    const pattern = P.map((_, t) => `${A.planted[t] ? "A" : "a"}${B.planted[t] ? "B" : "b"}`).join("");
    results.push({
      score, file, clip: clip.name, dur: clip.dur, H, ticks: P.length,
      inPlace, loops, loopErr, bodyTravel, alt, feet, pattern,
    });
  }
}
results.sort((a, c) => c.score - a.score);
for (const r of results.slice(0, 30)) {
  const f = r.feet.map((q) => `${q.name}:${q.runs}r/${(100 * q.duty).toFixed(0)}%/l${q.lift.toFixed(0)}`).join(" ");
  console.log(`${String(r.score).padStart(2)} ${path.basename(r.file).padEnd(12)} ${r.clip.padEnd(8)} ${r.dur.toFixed(2)}s  H${r.H.toFixed(0).padStart(5)}  alt ${(100 * r.alt).toFixed(0).padStart(3)}%  loop ${r.loopErr.toFixed(1).padStart(6)}  body ${r.bodyTravel.toFixed(0).padStart(5)}  ${r.loops ? "loop" : "NOloop"} ${r.inPlace ? "inplace" : "TRAVELS"}  ${f}`);
  if (r.score >= MIN_SCORE) console.log(`   ${r.pattern}`);
}
console.log(`\n${clipsSeen} clips scored; ${results.filter((r) => r.score >= MIN_SCORE).length} at or above ${MIN_SCORE}`);
