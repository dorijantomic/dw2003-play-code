// Posed triangles of a battle model for tools/digimon_tex_views.py, from the game's OWN code (battle3d.js:
// loadSkeletalModel, buildBoneWorldMatrices, updateSkeletalVBO), no browser.
//   node tools/digimon_tex_views_mesh.mjs <model folder> <out.json> [idle|arms|mouth|<frame number>]
// idle  = the battle idle: lowest plain frame of timeline[0] (the rest pose rule of ~/dw3-knowledge, dwr.mjs neutralFrame).
// arms  = the idle with each ARM chain turned out to the side about its first bone's origin (abduction about the
//         forward axis), to show armpits and inner arms. Arm chains = ~/dw3-knowledge/bodies.json limb chains (arm*,
//         leg*, wing*; the atlas swaps arms and legs on some bodies, e.g. m003agum) whose last bone stays > 0.05 H above
//         the idle floor (measured; a limb standing on the floor is a leg), with chains on both sides. Angle = smallest of 10..80 deg (step 5) where every lifted arm part (all but its first bone)
//         is >= 0.10 H from the rest of the body (vertex distance), else the angle with the largest clearance.
// mouth = the played attack frame (timeline tables 2.., plain frames) where the jaw opens most: the full 3-axis
//         rotation angle of each child bone of the head (the bone holding the eye patch triangles, else the atlas
//         head site) relative to the head, against the same angle at idle. No child bone = no mouth pose.
// out: {model, pose, frame, pos:[x,y,z per face corner, PS1 battle world], uv:[u,v per corner], bone:[per face], parent, info}
import { readFile, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../web");
globalThis.fetch = async (url) => {
  const p = path.join(WEB, String(url).split("?")[0]);
  try {
    const t = await readFile(p, "utf8");
    return { ok: true, status: 200, json: async () => JSON.parse(t), text: async () => t };
  } catch { return { ok: false, status: 404, json: async () => null, text: async () => "" }; }
};
const [folder, out, poseArg = "idle"] = process.argv.slice(2);
if (!folder || !out) { console.error("usage: node tools/digimon_tex_views_mesh.mjs <model> <out.json> [idle|arms|mouth|frame]"); process.exit(2); }
const b3d = await import("../web/battle3d.js");
const m = await b3d.loadSkeletalModel(folder);
if (!m) { console.error(`${folder}: no anim.json`); process.exit(1); }

const plain = (t) => (m.timeline?.[t]?.table ?? []).map((e) => e?.value | 0).filter((v) => v >= 0 && v < 0x8000);
const idle = (() => { const f = plain(0); return f.length ? Math.min(...f) : 0; })();
let nTri = 0;
for (const b of m.bones) nTri += (b.faces || []).length;
const faceBone = [];
m.bones.forEach((b, bi) => (b.faces || []).forEach(() => faceBone.push(bi)));
const parent = m.bones.map((b) => Number(b.parent_slot) - 1);
const posed = (mats) => { const p = new Float32Array(nTri * 9); b3d.updateSkeletalVBO(m, 0, { mats }, p); return p; };
const R3 = (M) => [[M[0], M[4], M[8]], [M[1], M[5], M[9]], [M[2], M[6], M[10]]];
const mul = (A, B) => A.map((r) => [0, 1, 2].map((j) => r[0] * B[0][j] + r[1] * B[1][j] + r[2] * B[2][j]));
const T = (A) => [0, 1, 2].map((i) => [0, 1, 2].map((j) => A[j][i]));
const ang = (A) => Math.acos(Math.max(-1, Math.min(1, (A[0][0] + A[1][1] + A[2][2] - 1) / 2))) * 180 / Math.PI;
const subtree = (r) => { const s = new Set([r]); let ch = true; while (ch) { ch = false; parent.forEach((p, i) => { if (s.has(p) && !s.has(i)) { s.add(i); ch = true; } }); } return s; };
const done = async (r) => { console.log(JSON.stringify(r)); await writeFile(out, JSON.stringify(r)); process.exit(0); };

const idleMats = b3d.buildBoneWorldMatrices(m, idle).mats.map((x) => Array.from(x));
const idlePos = posed(idleMats);
let ylo = Infinity, yhi = -Infinity;
for (let i = 1; i < idlePos.length; i += 3) { ylo = Math.min(ylo, idlePos[i]); yhi = Math.max(yhi, idlePos[i]); }
const H = yhi - ylo, floorY = yhi;                     // PS1 y points DOWN: the floor is the largest y
const vertsOf = (pos, bones) => { const v = []; for (let f = 0; f < nTri; f++) if (bones.has(faceBone[f])) for (let c = 0; c < 3; c++) v.push(pos.subarray(f * 9 + c * 3, f * 9 + c * 3 + 3)); return v; };

let frame = idle, mats = idleMats, info = { idle_frame: idle, H: Math.round(H) };
const pose = /^\d+$/.test(poseArg) ? "frame" : poseArg;
if (pose === "frame") { frame = Number(poseArg); mats = b3d.buildBoneWorldMatrices(m, frame).mats; }

if (pose === "arms") {
  const atlasPath = path.join(os.homedir(), "dw3-knowledge/bodies.json");
  const chains = existsSync(atlasPath) ? (JSON.parse(readFileSync(atlasPath, "utf8")).models?.[folder]?.chains ?? {}) : {};
  const arms = [], refused = [];
  for (const [name, bones] of Object.entries(chains)) {
    if (!/^(arm|leg|wing)/.test(name) || !bones?.length) continue;   // atlas names can be swapped: the floor test decides
    const leaf = vertsOf(idlePos, new Set([bones[bones.length - 1]]));
    const all = vertsOf(idlePos, subtree(bones[0]));
    if (!leaf.length || !all.length) { refused.push(`${name}: no mesh`); continue; }
    const leafGap = (floorY - Math.max(...leaf.map((v) => v[1]))) / H;
    const side = Math.sign(all.reduce((s, v) => s + v[0], 0) / all.length);
    if (leafGap <= 0.05) { refused.push(`${name}: last bone ${leafGap.toFixed(3)} H above the floor (stands on it)`); continue; }
    if (!side) { refused.push(`${name}: on the midline`); continue; }
    arms.push({ name, bones, side, leafGap: +leafGap.toFixed(3) });
  }
  if (arms.length && new Set(arms.map((a) => a.side)).size < 2) { refused.push("arm chains all on one side"); arms.length = 0; }
  if (!arms.length) await done({ model: folder, pose, skipped: true, refused });
  const F = [[-1, 0, 0], [0, 1, 0], [0, 0, -1]];
  const armSets = arms.map((a) => subtree(a.bones[0]));
  const allArm = new Set(armSets.flatMap((s) => [...s]));
  const lift = (deg) => {
    const M = idleMats.map((x) => x.slice());
    arms.forEach((a, k) => {
      // turn about the forward (z) axis, in the true world: the arm's far end goes out to its own side and up
      const th = -a.side * deg * Math.PI / 180, c = Math.cos(th), s = Math.sin(th);
      const Q = [[c, -s, 0], [s, c, 0], [0, 0, 1]];
      const FQF = mul(mul(F, Q), F);
      const p = idleMats[a.bones[0]].slice(12, 15);
      for (const b of armSets[k]) {
        const R = mul(FQF, R3(idleMats[b]));
        const t = idleMats[b].slice(12, 15).map((v, i) => v - p[i]);
        const t2 = [0, 1, 2].map((i) => Q[i][0] * t[0] + Q[i][1] * t[1] + Q[i][2] * t[2] + p[i]);
        for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) M[b][j * 4 + i] = R[i][j];
        M[b][12] = t2[0]; M[b][13] = t2[1]; M[b][14] = t2[2];
      }
    });
    return M;
  };
  const restBones = new Set(parent.map((_, i) => i).filter((i) => !allArm.has(i)));
  const clearance = (pos) => {
    const body = vertsOf(pos, restBones);
    return Math.min(...arms.map((a, k) => {
      const part = vertsOf(pos, new Set([...armSets[k]].filter((b) => b !== a.bones[0])));
      let best = Infinity;
      for (const v of part) for (const w of body) { const d = Math.hypot(v[0] - w[0], v[1] - w[1], v[2] - w[2]); if (d < best) best = d; }
      return best / H;
    }));
  };
  // the far end really moves out and up? (sign check of the turn, measured, not assumed)
  const leafC = (pos, a) => { const v = vertsOf(pos, new Set([a.bones[a.bones.length - 1]])); return [0, 1].map((i) => v.reduce((s, q) => s + q[i], 0) / v.length); };
  const CLEAR = 0.10;
  const c0 = clearance(idlePos);
  let pick = null, bestC = -1, bestDeg = 10;
  for (let deg = 10; deg <= 80; deg += 5) {
    const c = clearance(posed(lift(deg)));
    if (c > bestC) { bestC = c; bestDeg = deg; }
    if (c >= CLEAR) { pick = deg; bestC = c; break; }
  }
  const deg = pick ?? bestDeg;
  mats = lift(deg);
  const lp = posed(mats);
  const moved = arms.map((a) => { const [x0, y0] = leafC(idlePos, a), [x1, y1] = leafC(lp, a); return { name: a.name, out_H: +((x1 - x0) * a.side / H).toFixed(3), up_H: +((y0 - y1) / H).toFixed(3) }; });
  info = { ...info, arms: arms.map((a) => ({ name: a.name, bones: a.bones, side: a.side, leaf_above_floor_H: a.leafGap })), refused,
    lift_deg: deg, clearance_idle_H: +c0.toFixed(3), clearance_H: +bestC.toFixed(3), reached_clearance: pick !== null, clearance_goal_H: CLEAR, leaf_moved: moved };
}

if (pose === "mouth") {
  // the head = bone with the most triangles inside the eye patch rectangle (texture_anim dst), else the atlas head site
  const key = /^\d+$/.test(folder.slice(1, 4)) ? String(Number(folder.slice(1, 4))) : null;
  const pl = JSON.parse(readFileSync(path.join(WEB, "assets/battle/model_placement.json"), "utf8")).models?.[key] ?? {};
  const cnt = new Map();
  m.bones.forEach((b, bi) => (b.faces || []).forEach((f) => {
    const u = (f[3] + f[5] + f[7]) / 3 % 256, v = (f[4] + f[6] + f[8]) / 3 % 256;
    for (const e of pl.texture_anim ?? []) {
      const [x, y] = e.dst;
      if (u >= x * 4 && u < x * 4 + e.size[0] * 4 && v >= y && v < y + e.size[1]) cnt.set(bi, (cnt.get(bi) ?? 0) + 1);
    }
  }));
  let head = [...cnt.entries()].sort((a, b) => b[1] - a[1])[0]?.[0], headBy = "eye patch";
  if (head === undefined) {
    const atlasPath = path.join(os.homedir(), "dw3-knowledge/bodies.json");
    head = existsSync(atlasPath) ? JSON.parse(readFileSync(atlasPath, "utf8")).models?.[folder]?.sites?.head?.bone : undefined;
    headBy = "atlas head site";
  }
  const kids = parent.map((p, i) => (p === head ? i : -1)).filter((i) => i >= 0 && (m.bones[i].faces || []).length);
  if (head === undefined || !kids.length) await done({ model: folder, pose, skipped: true, refused: [`no jaw: head bone ${head} (${headBy}) has no child part with a mesh`] });
  const rel = (M, k) => mul(T(R3(M[head])), R3(M[k]));
  const rel0 = kids.map((k) => rel(idleMats, k));
  const frames = new Map();
  for (let t = 2; t < (m.timeline ?? []).length; t++) for (const f of plain(t)) if (!frames.has(f)) frames.set(f, t);
  let best = { deg: -1 };
  for (const [f, t] of frames) {
    const M = b3d.buildBoneWorldMatrices(m, f).mats;
    kids.forEach((k, i) => { const d = ang(mul(T(rel0[i]), rel(M, k))); if (d > best.deg) best = { deg: d, frame: f, table: t, bone: k }; });
  }
  if (best.deg < 0) await done({ model: folder, pose, skipped: true, refused: ["no attack frames"] });
  frame = best.frame;
  mats = b3d.buildBoneWorldMatrices(m, frame).mats;
  info = { ...info, head_bone: head, head_by: headBy, jaw_bones: kids, jaw_bone: best.bone, jaw_open_deg: +best.deg.toFixed(1),
    table: best.table, frames_scanned: frames.size };
}

const pos = posed(mats);
const uv = [];
m.bones.forEach((b) => (b.faces || []).forEach((f) => uv.push(f[3], f[4], f[5], f[6], f[7], f[8])));
await writeFile(out, JSON.stringify({ model: folder, pose, frame, pos: Array.from(pos, (v) => Math.round(v * 1000) / 1000), uv, bone: faceBone, parent, info }));
console.log(JSON.stringify({ model: folder, pose, frame, triangles: nTri, info }));
