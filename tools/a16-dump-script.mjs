// A16: dump authored scripts (ops + op11 waits + timeline table windows).
import fs from "node:fs";
import path from "node:path";
const REPO = "/home/dorij/dw2003-play-anim";
const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const MODELS = path.join(REPO, "web/assets/battle/models");
const [folder, ...clips] = process.argv.slice(2);
const anim = readJson(path.join(MODELS, folder, "anim.json"));
for (const clip of clips) {
  const script = anim.actions?.[String(clip)];
  console.log(`\n== ${folder} clip ${clip}: ${script?.ops?.length ?? 0} ops`);
  let t = 0;
  for (const o of script?.ops ?? []) {
    if (o.op === 11) t += o.words?.[0] | 0;
    const w = (o.words || []).join(",");
    console.log(String(t).padStart(4), `op${o.op}`, w.length > 70 ? w.slice(0, 70) + "…" : w);
  }
  const tabs = [...new Set((script?.ops ?? []).filter((o) => o.op === 2 && o.words?.[0] === 0 && (o.words[2] | 0) > 1).map((o) => o.words[2] | 0))];
  for (const tb of tabs) {
    const tab = anim.timeline?.[tb]?.table ?? [];
    const vals = tab.map((e) => e.value | 0).filter((v) => v >= 0 && v < 0x8000);
    console.log(`   table ${tb}: ${tab.length} entries, frames ${Math.min(...vals)}..${Math.max(...vals)}, loop=${tab.some((e) => (e.value | 0) >= 0x8000)}`);
  }
}
