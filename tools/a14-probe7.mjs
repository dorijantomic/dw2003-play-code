// A14 probe 7: compare the two packs' prims / textures — why does 210 draw a sliver and 221 a ball?
import fs from "node:fs";
const REPO = "/home/dorij/dw2003-play-anim";
const read = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
for (const id of [210, 221]) {
  const d = read(`${REPO}/web/assets/battle/effects/proj/${id}.json`);
  const L = d.layers[0];
  const tex = new Set(), clut = new Set(), abr = new Set();
  let untex = 0, noUv = 0, tri = 0, quad = 0, zeroArea = 0;
  for (const p of L.prims) {
    if (!p.textured) untex++;
    if (!p.uv) noUv++;
    if (p.idx?.length === 4) quad++; else tri++;
    if (p.clut) clut.add(p.clut.join("_")); else clut.add("none");
    if (p.abr != null) abr.add(p.abr);
    if (p.tex != null) tex.add(p.tex);
    if (p.idx) {
      const v = p.idx.map((i) => L.verts[i]);
      const a = [v[1][0] - v[0][0], v[1][1] - v[0][1], v[1][2] - v[0][2]];
      const b = [v[2][0] - v[0][0], v[2][1] - v[0][1], v[2][2] - v[0][2]];
      const c = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
      if (Math.hypot(...c) < 1) zeroArea++;
    }
  }
  console.log(`proj ${id}: prims=${L.prims.length} tri=${tri} quad=${quad} untxt=${untex} noUv=${noUv} zeroArea=${zeroArea}`);
  console.log(`  clut=${[...clut].join(",")} abr=${[...abr].join(",")} tex_by_clut=${JSON.stringify(L.tex_by_clut)} tex=${JSON.stringify(L.tex)}`);
  console.log(`  prim0=${JSON.stringify(L.prims[0]).slice(0, 300)}`);
  console.log(`  verts0..3=${JSON.stringify(L.verts.slice(0, 4))}`);
}
