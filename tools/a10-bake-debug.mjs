// A10 debug: why does a retarget show no travel?
import fs from "node:fs";
import path from "node:path";
import { bakeRetarget, castGate, restPose } from "../web/fight/anim-retarget.js";
const MODELS = "/home/dorij/dw2003-play-anim/web/assets/battle/models";
const read = (f) => JSON.parse(fs.readFileSync(path.join(MODELS, f, "anim.json"), "utf8"));
const [tf, df, clipS] = process.argv.slice(2);
const clip = Number(clipS ?? 9);
const target = read(tf), donor = read(df);
const bake = bakeRetarget(target, donor, clip, { offset: 6000 });
bake.source = donor;
const tab = bake.model.timeline[bake.table].table.map((e) => e.value | 0).filter((v) => v < 0x8000);
const lo = Math.min(...tab), hi = Math.max(...tab);
console.log(`${tf} <- ${df} clip ${clip} table ${bake.table} lo ${lo} hi ${hi} covered ${bake.covered.toFixed(2)}`);
for (const i of [1, 2, 6, 10, 14]) {
  const b = bake.model.bones[i], m = bake.map[i];
  const ch = b.anim?.ch2 ?? [];
  const keys = ch.slice(Math.max(0, ch.length - 6)).map((r) => r[3]);
  const p0 = restPose(bake.model, lo).pos[i], p1 = restPose(bake.model, (lo + hi) / 2).pos[i];
  const s0 = m >= 0 ? restPose(donor, (lo + hi) / 2 - 6000).pos[m] : null;
  console.log(` bone ${i} -> ${m} keys(last) ${keys.join(",")} pos@lo ${p0.map((v) => Math.round(v))} pos@mid ${p1.map((v) => Math.round(v))} donorpos@mid ${s0 && s0.map((v) => Math.round(v))}`);
}
const gate = castGate(bake);
console.log(JSON.stringify(gate));
