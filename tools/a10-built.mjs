// A10 built-script probe: resolve clip 9 for the given folders and print the script shape.
import fs from "node:fs";
import path from "node:path";
const REPO = "/home/dorij/dw2003-play-anim";
const MODELS = path.join(REPO, "web/assets/battle/models");
const read = (f) => JSON.parse(fs.readFileSync(path.join(MODELS, f, "anim.json"), "utf8"));
const cb = await import(path.join(REPO, "web/fight/clip-fallback.js"));
const { donorRow } = await import(path.join(REPO, "web/fight/anim-donor-map.js"));
cb.setFallbackDonor(read("m005grey").actions);
const skills = JSON.parse(fs.readFileSync(path.join(REPO, "web/assets/data/digimon.json"), "utf8")).skills;
for (const folder of process.argv.slice(2)) {
  const model = read(folder);
  const row9 = donorRow(folder, 9);
  if (row9) cb.registerDonorAnim(row9.d, read(row9.d));
  await cb.prepareModelDonors(model);
  console.log(folder, "castBakes", JSON.stringify(model.castBakes ?? null));
  for (const clip of [9, 13]) {
    if (model.actions?.[clip]?.ops?.length) continue;
    if (!donorRow(folder, clip)) continue;
    const tech = skills.find((s) => s.clip === clip && s.type === "attack");
    const s = cb.resolveClipScript(model, clip, { element: 1, target: "enemy", hits: tech?.hits ?? 1 });
    if (!s) { console.log(folder, clip, "NO SCRIPT"); continue; }
    const ops = s.ops.map((o) => `${o.op}[${(o.words || []).join(",")}]`).join(" ");
    const loco = s.ops.filter((o) => o.op === 2 && [3, 5, 8].includes(o.words?.[0] | 0)).length;
    const n98 = s.ops.filter((o) => o.op === 10 && (o.words?.[0] | 0) === 98).length;
    const n99 = s.ops.filter((o) => o.op === 10 && (o.words?.[0] | 0) === 99).length;
    const shot = s.ops.find((o) => o.op === 6 && (o.words?.[0] | 0) === 0);
    console.log(`\n${folder} clip ${clip} kind=${s.buildKind} retargeted=${!!s.retargeted} hits=${tech?.hits ?? 1} loco=${loco} 98=${n98} 99=${n99}`);
    console.log(`  shot=${shot ? JSON.stringify(shot.words) : "none"} tables=${JSON.stringify(cb.scriptTableSeq(s))}`);
    console.log("  " + ops);
  }
}
