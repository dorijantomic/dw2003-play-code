import fs from "node:fs";
import path from "node:path";
const REPO = "/home/dorij/dw2003-play-anim";
const MODELS = path.join(REPO, "web/assets/battle/models");
const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const b3 = await import(path.join(REPO, "web/battle3d.js"));
const folder = process.argv[2] || "m190bolt";
const m = readJson(path.join(MODELS, folder, "anim.json"));
const frames = (m.timeline?.[0]?.table || []).filter((e) => (e.value | 0) < 0x8000).map((e) => e.value | 0);
console.log("idle table", JSON.stringify(m.timeline?.[0]?.table));
console.log("idle frames", frames.slice(0, 30), "n", frames.length);
for (const b of [18, 19]) {
  const bone = m.bones[b];
  console.log("bone", b, "ch3", JSON.stringify(bone.anim?.ch3));
  const vals = frames.slice(0, 20).map((f) => { const s = b3.interpChannel(bone.anim?.ch3, f); return [f, Math.round(Math.max(...s.map(Math.abs)) / 4096 * 100) / 100]; });
  console.log("  scale per idle frame", JSON.stringify(vals));
}
