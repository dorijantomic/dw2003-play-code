// A16 probe: the manifest's projectile table + pack 210's own timing.
import { readFileSync } from "node:fs";
const man = JSON.parse(readFileSync("web/assets/battle/effects/manifest.json", "utf8"));
console.log("manifest keys:", Object.keys(man));
const projIds = Object.keys(man.projectiles || {});
console.log("projectile ids:", projIds.length);
console.log("210:", JSON.stringify(man.projectiles?.["210"]));
const pack = JSON.parse(readFileSync("web/assets/battle/effects/proj/210.json", "utf8"));
console.log("pack keys:", Object.keys(pack));
console.log("segments:", JSON.stringify(pack.clip?.segments ?? pack.segments));
console.log("layers:", (pack.layers || []).length);
for (let i = 0; i < Math.min(4, (pack.layers || []).length); i++) {
  const L = pack.layers[i];
  console.log(`layer ${i} parent=${L.parent} tracks=${Object.keys(L.tracks || {})} t=${JSON.stringify(L.tracks?.t)} s=${JSON.stringify(L.tracks?.s)}`);
}
