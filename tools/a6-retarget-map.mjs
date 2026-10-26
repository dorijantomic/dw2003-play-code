// Print the retarget bone map for a target/source pair (A6 feasibility probe).
//   node tools/a6-retarget-map.mjs m178kngt m369duke 9
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { rolesOf, buildBoneMap, bakeRetarget } from "../web/fight/anim-retarget.js";

const ROOT = resolve(import.meta.dirname, "..");
const [target, source, clipArg] = process.argv.slice(2);
const clip = Number(clipArg ?? 9);
const read = async (f) => JSON.parse(await readFile(resolve(ROOT, `web/assets/battle/models/${f}/anim.json`), "utf8"));
const t = await read(target), s = await read(source);
const { map, T, S } = buildBoneMap(t, s);
const desc = (R) => ({
  bones: R.n, box: { h: Math.round(R.box.h), w: Math.round(R.box.w), d: Math.round(R.box.d) },
  legs: R.legs.map((l) => `${l.side}:${l.chain.join("-")}`),
  arms: R.arms.map((a) => `${a.side}:${a.chain.join("-")}`),
  head: R.head, props: R.props.map((p) => `${p.side}#${p.bone}(${Math.round(p.len)})`),
  cape: R.cape ? R.cape.join("-") : null,
});
console.log("TARGET", target, JSON.stringify(desc(T)));
console.log("SOURCE", source, JSON.stringify(desc(S)));
console.log("map:", map.map((m, i) => `${i}->${m}`).join(" "));
const bake = bakeRetarget(t, s, clip);
console.log("bake:", bake ? { table: bake.table, covered: bake.covered.toFixed(2), offset: bake.offset,
  frames: bake.model.timeline[bake.table].table.length } : null);
if (bake) {
  const sc = bake.model.bones[0].anim.ch2.at(-2);
  console.log("root last donor key:", sc);
}
