import fs from "node:fs";
import path from "node:path";
const REPO = "/home/dorij/dw2003-play-anim";
const b3 = await import(path.join(REPO, "web/battle3d.js"));
const folder = process.argv[2] || "m190bolt";
const frame = Number(process.argv[3] || 0);
const m = JSON.parse(fs.readFileSync(path.join(REPO, "web/assets/battle/models", folder, "anim.json"), "utf8"));
const { mats } = b3.buildBoneWorldMatrices(m, frame, null);
const rows = [];
for (let i = 0; i < m.bones.length; i++) {
  const b = m.bones[i], M = mats[i];
  const pts = [];
  for (const [x, y, z] of b.verts || []) {
    pts.push([-(M[0] * x + M[4] * y + M[8] * z) + M[12], M[1] * x + M[5] * y + M[9] * z + M[13], -(M[2] * x + M[6] * y + M[10] * z) + M[14]]);
  }
  if (!pts.length) { rows.push({ bone: i, verts: 0 }); continue; }
  const lo = [0, 1, 2].map((k) => Math.min(...pts.map((p) => p[k])));
  const hi = [0, 1, 2].map((k) => Math.max(...pts.map((p) => p[k])));
  const c = [0, 1, 2].map((k) => +((lo[k] + hi[k]) / 2).toFixed(0));
  const size = [0, 1, 2].map((k) => +(hi[k] - lo[k]).toFixed(0));
  rows.push({ bone: i, verts: (b.verts || []).length, faces: (b.faces || []).length, cen: [M[12], M[13], M[14]].map((v) => +v.toFixed(0)), c, size });
}
for (const r of rows) console.log(JSON.stringify(r));
