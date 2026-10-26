import fs from "node:fs";
import path from "node:path";
const REPO = "/home/dorij/dw2003-play-anim";
const MODELS = path.join(REPO, "web/assets/battle/models");
const DATA = path.join(REPO, "web/assets/data");
const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const techTable = readJson(path.join(DATA, "fight_tech_table.json"));
const ft = await import(path.join(REPO, "web/fight/fight-tables.js"));
const cb = await import(path.join(REPO, "web/fight/clip-fallback.js"));
const folder = process.argv[2] || "m172mtar";
const tech = Number(process.argv[3] || 150);
const pack = readJson(path.join(MODELS, folder, "anim.json"));
const cache = new Map();
const getModel = (f) => { if (!cache.has(f)) cache.set(f, readJson(path.join(MODELS, f, "anim.json"))); return cache.get(f); };
cb.setFallbackDonor(getModel("m005grey").actions);
cb.setDonorLoader((f) => { try { return Promise.resolve(getModel(f)); } catch { return Promise.resolve(null); } });
const model = structuredClone(pack);
model.folder = folder;
await cb.prepareModelDonors(model);
console.log("castBakes", Object.keys(model.castBakes || {}), "donorClips", Object.keys(model.donorClips || {}));
const info = {
  clip: ft.techToClip(tech), target: ft.techTargetClass(tech), elem: techTable[String(tech)]?.elem1,
  planted: techTable[String(tech)]?.category,
};
console.log("info", JSON.stringify(info));
const script = cb.resolveClipScript(model, info.clip, { element: info.elem ?? 1, target: info.target, tech: null });
console.log("script", script ? { kind: script.buildKind, synth: script.synthesized, ops: script.ops.length, self: script.selfCast } : null);
if (script) console.log(JSON.stringify(script.ops).slice(0, 1200));
