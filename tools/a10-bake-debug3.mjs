// A10 debug 3: the role map and the arm chains for one pair
import fs from "node:fs";
import path from "node:path";
import { rolesOf, buildBoneMap, restPose, bakeRetarget } from "../web/fight/anim-retarget.js";
const MODELS = "/home/dorij/dw2003-play-anim/web/assets/battle/models";
const read = (f) => JSON.parse(fs.readFileSync(path.join(MODELS, f, "anim.json"), "utf8"));
const [tf, df, clipS] = process.argv.slice(2);
const target = read(tf), donor = read(df);
const clip = Number(clipS ?? 9);
for (const [name, m] of [[tf, target], [df, donor]]) {
  const r = rolesOf(m);
  console.log(name, "n", r.n, "h", Math.round(r.box.h));
  console.log("  arms", JSON.stringify(r.arms.map((a) => [a.side, a.chain])), "legs", JSON.stringify(r.legs.map((l) => [l.side, l.chain])),
    "props", JSON.stringify(r.props.map((p) => [p.bone, p.side, Math.round(p.len)])), "head", r.head, "cape", r.cape);
}
const { map } = buildBoneMap(target, donor);
const bake = bakeRetarget(target, donor, clip, { offset: 6000 });
console.log("map", map.join(","));
const p = restPose(bake.model, 6600), s = restPose(donor, 600);
for (const [name, mm, pp, boni] of [[tf, target, p, null], [df, donor, s, null]]) {
  console.log(name, "hand-ish bones:", pp.pos.map((v, i) => `${i}:${v.map((x) => Math.round(x)).join("/")}`).slice(0, 14).join(" "));
}
