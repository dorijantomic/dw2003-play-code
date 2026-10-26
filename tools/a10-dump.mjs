// A10 scratch: dump action clips of models (ops) + the tables they bind
import fs from "node:fs";
const args = process.argv.slice(2);
const root = "/home/dorij/dw2003-play-anim/web/assets/battle/models";
for (const spec of args) {
  const [folder, clips] = spec.split(":");
  const anim = JSON.parse(fs.readFileSync(`${root}/${folder}/anim.json`, "utf8"));
  const want = clips ? clips.split(",").map(Number) : Object.keys(anim.actions).map(Number);
  console.log(`== ${folder} bones=${anim.num_bones ?? anim.bones?.length} tables=${(anim.timeline || []).length}`);
  for (const c of want) {
    const s = anim.actions?.[c];
    if (!s) { console.log(` clip ${c}: -`); continue; }
    const ops = (s.ops || []).map((o) => `${o.op}[${(o.words || []).join(",")}]`).join(" ");
    console.log(` clip ${c}: ${ops}`);
  }
}
