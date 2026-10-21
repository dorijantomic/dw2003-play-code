// A15: why does a mesh the idle keeps hidden show up during a built clip? Prints, per sampled tick,
// the frame/table the animator draws and the scale of every idle-hidden part, plus the bone's ch3 keys.
import fs from "node:fs";
import path from "node:path";
const REPO = "/home/dorij/dw2003-play-anim";
const MODELS = path.join(REPO, "web/assets/battle/models");
const DATA = path.join(REPO, "web/assets/data");
const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const techTable = readJson(path.join(DATA, "fight_tech_table.json"));
const b3 = await import(path.join(REPO, "web/battle3d.js"));
const ft = await import(path.join(REPO, "web/fight/fight-tables.js"));
const cb = await import(path.join(REPO, "web/fight/clip-fallback.js"));
const { ActorAnimator } = await import(path.join(REPO, "web/fight/actor-animator.js"));
ft.setTechTable(techTable);
const cache = new Map();
const getModel = (f) => { if (!cache.has(f)) cache.set(f, readJson(path.join(MODELS, f, "anim.json"))); return cache.get(f); };
cb.setFallbackDonor(getModel("m005grey").actions);
cb.setDonorLoader((f) => Promise.resolve(getModel(f)));

const folder = process.argv[2] || "m190bolt";
const tech = Number(process.argv[3] || 159);
const idleFrames = (m) => (m.timeline?.[0]?.table || []).filter((e) => (e.value | 0) < 0x8000).map((e) => e.value | 0);
function hiddenParts(m) {
  const frames = idleFrames(m); const out = [];
  for (let b = 0; b < m.bones.length; b++) {
    const ch3 = m.bones[b].anim?.ch3; if (!ch3 || !(m.bones[b].faces || []).length) continue;
    let lo = Infinity;
    for (const f of (frames.length ? frames : [0])) { const s = b3.interpChannel(ch3, f); lo = Math.min(lo, Math.max(Math.abs(s[0]), Math.abs(s[1]), Math.abs(s[2])) / 4096); }
    if (lo < 0.05) out.push({ b, lo, ch3 });
  }
  return out;
}
const model = structuredClone(getModel(folder));
model.folder = folder;
await cb.prepareModelDonors(model);
const hid = hiddenParts(model);
console.log("hidden parts", hid.map((h) => ({ bone: h.b, minScale: +h.lo.toFixed(3), verts: model.bones[h.b].verts?.length, faces: model.bones[h.b].faces?.length, ch3len: h.ch3.length, ch3head: h.ch3.slice(0, 4), ch3tail: h.ch3.slice(-3) })));
const a = new ActorAnimator(model);
a.resetSlotPlacement({ x: 0, y: -900, z: -5120, side: "player" });
const clip = ft.techToClip(tech);
const t = techTable[String(tech)];
const script = cb.resolveClipScript(model, clip, { element: t.elem1, target: ft.techTargetClass(tech), tech: null });
console.log("kind", script?.buildKind, "retargeted", script?.retargeted, "bakeTable", model.castBakes?.[clip]?.table);
a.setAction(clip, {}, { element: t.elem1, target: ft.techTargetClass(tech), tech: null });
for (let tick = 0; tick < 130; tick++) {
  a.tick(2);
  const f = a.currentFrame();
  const sc = hid.map((h) => { const s = b3.interpChannel(model.bones[h.b].anim?.ch3, f); return { b: h.b, s: +(Math.max(Math.abs(s[0]), Math.abs(s[1]), Math.abs(s[2])) / 4096).toFixed(3) }; });
  if (tick % 4 === 0 || sc.some((x) => x.s > 0.05)) console.log(JSON.stringify({ tick, f, table: a.timelineTable, blend: !!a.currentBlend(), sc, vm: !!a.vm }));
  if (!a.vm) break;
}
console.log("--- after end");
for (let k = 0; k < 20; k++) {
  a.tick(2);
  const f = a.currentFrame();
  const sc = hid.map((h) => { const s = b3.interpChannel(model.bones[h.b].anim?.ch3, f); return { b: h.b, s: +(Math.max(Math.abs(s[0]), Math.abs(s[1]), Math.abs(s[2])) / 4096).toFixed(3) }; });
  if (k % 3 === 0) console.log(JSON.stringify({ k, f, table: a.timelineTable, blend: !!a.currentBlend(), sc, vm: !!a.vm }));
}
