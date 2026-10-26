import fs from "node:fs";
import path from "node:path";
const REPO = "/home/dorij/dw2003-play-anim";
const b3 = await import(path.join(REPO, "web/battle3d.js"));
const folder = process.argv[2] || "m190bolt";
const m = JSON.parse(fs.readFileSync(path.join(REPO, "web/assets/battle/models", folder, "anim.json"), "utf8"));
const b19 = m.bones[19], b7 = m.bones[7];
console.log("bone7 keys", JSON.stringify({ ch1: (b7.anim?.ch1 || []).length, ch2: (b7.anim?.ch2 || []).length, ch3: b7.anim?.ch3?.length ?? null }));
console.log("bone19 keys", JSON.stringify({ ch1: (b19.anim?.ch1 || []).length, ch2: (b19.anim?.ch2 || []).length, ch3: b19.anim?.ch3?.length ?? null }));
console.log("bone19 ch1 head", JSON.stringify((b19.anim?.ch1 || []).slice(0, 4)));
console.log("bone19 ch2 head", JSON.stringify((b19.anim?.ch2 || []).slice(0, 4)));
console.log("bone19 ch1 tail", JSON.stringify((b19.anim?.ch1 || []).slice(-3)));
console.log("bone19 ch2 tail", JSON.stringify((b19.anim?.ch2 || []).slice(-3)));
for (const f of [0, 10, 40, 70, 100, 130, 140, 260]) {
  const { mats } = b3.buildBoneWorldMatrices(m, f, null);
  const box = (i) => {
    const b = m.bones[i], M = mats[i];
    const pts = [];
    for (const [x, y, z] of b.verts || []) pts.push([-(M[0] * x + M[4] * y + M[8] * z) + M[12], M[1] * x + M[5] * y + M[9] * z + M[13], -(M[2] * x + M[6] * y + M[10] * z) + M[14]]);
    const lo = [0, 1, 2].map((k) => Math.min(...pts.map((p) => p[k])));
    const hi = [0, 1, 2].map((k) => Math.max(...pts.map((p) => p[k])));
    return { lo: lo.map((v) => Math.round(v)), hi: hi.map((v) => Math.round(v)), diag: +Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]).toFixed(0) };
  };
  console.log("frame", f, "axe7", JSON.stringify(box(7)), "axe19", JSON.stringify(box(19)), "scale19", JSON.stringify(mats[19] ? [mats[19][0], mats[19][5], mats[19][10]].map((v) => +v.toFixed(3)) : null));
}
