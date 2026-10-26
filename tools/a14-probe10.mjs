// Is the projectile mesh planar? (a flat billboard/disc vs a sphere) — for pack 210 and 221.
import fs from "node:fs";
const REPO = "/home/dorij/dw2003-play-anim";
for (const id of [210, 221, 218, 205]) {
  const d = JSON.parse(fs.readFileSync(`${REPO}/web/assets/battle/effects/proj/${id}.json`, "utf8"));
  const V = d.layers[0].verts;
  // crude plane test: find the axis with the smallest spread
  const sd = [0, 1, 2].map((k) => {
    const vals = V.map((v) => v[k]);
    const m = vals.reduce((a, b) => a + b, 0) / vals.length;
    return Math.sqrt(vals.reduce((a, b) => a + (b - m) ** 2, 0) / vals.length);
  });
  // unique radii
  const r = V.map((v) => Math.round(Math.hypot(v[0], v[1], v[2])));
  const uniq = [...new Set(r)].sort((a, b) => a - b);
  console.log(`proj ${id}: nverts=${V.length} sd=${sd.map((x) => Math.round(x))} radii=${uniq.slice(0, 12).join(",")} (${uniq.length} distinct)`);
}
