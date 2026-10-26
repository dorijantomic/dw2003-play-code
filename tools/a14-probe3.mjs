// A14 probe 3: the projectile packs' own layer tracks — does the shot travel?
import fs from "node:fs";
import path from "node:path";
const REPO = "/home/dorij/dw2003-play-anim";
const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const man = readJson(path.join(REPO, "web/assets/battle/effects/manifest.json"));

for (const id of [210, 221, 218, 205, 206, 217, 220]) {
  const p = path.join(REPO, "web/assets/battle/effects/proj", `${id}.json`);
  if (!fs.existsSync(p)) { console.log(id, "NO MESH"); continue; }
  const d = readJson(p);
  const m = man.projectiles[String(id)] || {};
  console.log(`\n--- proj ${id} file=${m.file} dur=${m.dur} ticks=${m.ticks} clip=${JSON.stringify(m.clip)} layers=${d.layers.length}`);
  d.layers.forEach((L, i) => {
    const tr = L.tracks || {};
    const f = (k) => (tr[k] || []).map((r) => `[${r.join(",")}]`).join(" ");
    console.log(`  L${i} prims=${L.prims?.length ?? 0} verts=${L.verts?.length ?? 0} parent=${L.parent ?? "?"}`);
    if (tr.t) console.log(`    t: ${f("t")}`);
    if (tr.r) console.log(`    r: ${f("r")}`);
    if (tr.s) console.log(`    s: ${f("s")}`);
    if (!tr.t && !tr.r && !tr.s) console.log("    (static)");
  });
}
