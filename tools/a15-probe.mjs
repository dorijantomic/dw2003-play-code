// A15 probe: dump a model pack's actions/timeline and the fallback script+launch plan for clip 9.
import fs from "node:fs";
import path from "node:path";

const REPO = "/home/dorij/dw2003-play-anim";
const MODELS = path.join(REPO, "web/assets/battle/models");
const folder = process.argv[2] || "m190bolt";
const clip = Number(process.argv[3] || 9);
const pack = JSON.parse(fs.readFileSync(path.join(MODELS, folder, "anim.json"), "utf8"));
console.log("== pack", folder, "bones", pack.bones?.length, "num_bones", pack.num_bones, "timeline", pack.timeline?.length);
console.log("actions", Object.keys(pack.actions || {}).join(","));
for (const c of Object.keys(pack.actions || {})) {
  const ops = pack.actions[c]?.ops || [];
  const six = ops.filter((o) => o.op === 6).map((o) => `6[${(o.words || []).join(",")}]`);
  const two = ops.filter((o) => o.op === 2 && (o.words?.[0] | 0) === 0).map((o) => `2[${(o.words || []).join(",")}]`);
  console.log(`  clip ${c}: ${ops.length} ops  proj=${six.join(" ") || "-"}  tables=${two.join(" ") || "-"}`);
}
for (let i = 0; i < (pack.timeline || []).length; i++) {
  const t = pack.timeline[i]?.table;
  if (!t) continue;
  const vals = t.filter((e) => (e.value | 0) < 0x8000).map((e) => e.value | 0);
  console.log(`  table ${i}: ${t.length} entries  frames ${Math.min(...vals)}..${Math.max(...vals)}  distinct ${new Set(vals).size}  head ${vals.slice(0, 8).join(",")}`);
}
// bones with meshes / props
const mb = pack.bones.map((b, i) => [i, b.mesh_count ?? b.meshes?.length ?? b.mesh ?? null, b.parent_slot]).filter((r) => r[1]);
console.log("bone mesh counts:", JSON.stringify(mb).slice(0, 400));
console.log("bone0", JSON.stringify({ ...pack.bones[0], anim: undefined }).slice(0, 300));
console.log("ch2 sample bone0", JSON.stringify(pack.bones[0].anim?.ch2?.slice(0, 6)));

const cb = await import(path.join(REPO, "web/fight/clip-fallback.js"));
cb.registerDonorAnim(folder, pack);
const model = JSON.parse(JSON.stringify(pack));
model.folder = folder;
const donorMap = await import(path.join(REPO, "web/fight/anim-donor-map.js"));
const row = donorMap.donorRow(folder, clip);
console.log("donor row", JSON.stringify(row));
if (row) {
  const dAnim = JSON.parse(fs.readFileSync(path.join(MODELS, row.d, "anim.json"), "utf8"));
  cb.registerDonorAnim(row.d, dAnim);
  await cb.prepareModelDonors(model);
  console.log("castBakes", model.castBakes ? Object.keys(model.castBakes) : null,
    "bake table", model.castBakes?.[clip]?.table, "gate", JSON.stringify(model.castBakes?.[clip]?.gate));
}
const script = cb.resolveClipScript(model, clip, { element: 2, target: "enemy", tech: null });
console.log("script kind", script?.buildKind, "ops", script?.ops?.length);
console.log(JSON.stringify(script?.ops ?? []).slice(0, 2500));
