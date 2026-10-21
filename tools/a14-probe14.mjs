// A14 probe 14: with a chain-based tip, where does the muzzle land for m172mtar / m138delt?
import fs from "node:fs";
import path from "node:path";
const REPO = "/home/dorij/dw2003-play-anim";
const read = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const MODELS = path.join(REPO, "web/assets/battle/models");
const rt = await import(path.join(REPO, "web/fight/anim-retarget.js"));
const bm = await import(path.join(REPO, "web/fight/digimon-bonemap.js"));
for (const folder of ["m172mtar", "m138delt"]) {
  const m = read(path.join(MODELS, folder, "anim.json"));
  const chain = bm.armChains(folder, "left")[0];
  const pos = rt.restPose(m, 533).pos;
  const hand = chain.at(-1), prev = chain.at(-2);
  const p = pos[hand], q = pos[prev];
  console.log(folder, "chain", chain, "hand", p?.map(Math.round), "elbow", q?.map(Math.round), "ext", [2 * p[0] - q[0], 2 * p[1] - q[1], 2 * p[2] - q[2]].map(Math.round));
}
