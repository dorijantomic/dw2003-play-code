// A10 debug 2: compare the donor's root/child ch2 tracks with what the bake appended
import fs from "node:fs";
import path from "node:path";
import { bakeRetarget } from "../web/fight/anim-retarget.js";
const MODELS = "/home/dorij/dw2003-play-anim/web/assets/battle/models";
const read = (f) => JSON.parse(fs.readFileSync(path.join(MODELS, f, "anim.json"), "utf8"));
const [tf, df, clipS] = process.argv.slice(2);
const clip = Number(clipS ?? 9);
const target = read(tf), donor = read(df);
const bake = bakeRetarget(target, donor, clip, { offset: 6000 });
bake.source = donor;
console.log("map", bake.map.join(","));
for (const i of [0, 1, 2, 6, 10]) {
  const m = bake.map[i];
  const tch = bake.model.bones[i].anim?.ch2 ?? [];
  const sch = m >= 0 ? (donor.bones[m].anim?.ch2 ?? []) : [];
  console.log(`t${i} keys(${tch.length}):`, tch.slice(-10).map((r) => `${r[3]}:${r[0]},${r[1]},${r[2]}`).join(" "));
  console.log(`  s${m} keys(${sch.length}):`, sch.slice(0, 10).map((r) => `${r[3]}:${r[0]},${r[1]},${r[2]}`).join(" "));
}
