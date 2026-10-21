// A10 scratch: dump the weapon/arm facts of a few models from a6-features.json
import fs from "node:fs";
const f = JSON.parse(fs.readFileSync("/home/dorij/scratch-research/a6-features.json", "utf8"));
for (const k of process.argv.slice(2)) {
  const d = f[k];
  if (!d) { console.log(k, "MISSING"); continue; }
  console.log(k, "bones", d.bones, "size", JSON.stringify(d.size), "weapons", JSON.stringify(d.weapons));
  console.log("   chains", JSON.stringify(d.chains));
  console.log("   keys", Object.keys(d).join(","));
}
