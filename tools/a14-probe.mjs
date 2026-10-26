// A14 probe: which op6 projectile ids exist in the effects manifest, and what does the built
// script for m172mtar tech 150 actually contain?
import fs from "node:fs";

const man = JSON.parse(fs.readFileSync("web/assets/battle/effects/manifest.json", "utf8"));
const ids = Object.keys(man.projectiles || {});
console.log("projectile ids:", ids.length);
console.log(ids.sort((a, b) => a - b).join(","));
const sample = ids[0];
console.log("sample", sample, JSON.stringify(man.projectiles[sample]).slice(0, 400));
