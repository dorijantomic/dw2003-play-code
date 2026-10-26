// A14 probe 5: the projectile packs' mesh extents and their drawn size over the clip.
import fs from "node:fs";
import path from "node:path";
const REPO = "/home/dorij/dw2003-play-anim";
const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
for (const id of [210, 221, 218, 205]) {
  const d = readJson(path.join(REPO, `web/assets/battle/effects/proj/${id}.json`));
  d.layers.forEach((L, i) => {
    let lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
    for (const v of L.verts) for (let k = 0; k < 3; k++) { if (v[k] < lo[k]) lo[k] = v[k]; if (v[k] > hi[k]) hi[k] = v[k]; }
    console.log(`proj ${id} L${i}: verts=${L.verts.length} bbox=${lo.map(Math.round)}..${hi.map(Math.round)} size=${hi.map((v, k) => Math.round(v - lo[k]))} prims=${L.prims.length}`);
  });
}
