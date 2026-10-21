// A15: watch the ActionVM's timeline sampler during a built cast — which frame is drawn, and why.
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

const folder = process.argv[2] || "m172mtar";
const tech = Number(process.argv[3] || 150);
const model = structuredClone(getModel(folder));
model.folder = folder;
await cb.prepareModelDonors(model);
const a = new ActorAnimator(model);
a.resetSlotPlacement({ x: 0, y: -900, z: -5120, side: "player" });
const clip = ft.techToClip(tech);
const t = techTable[String(tech)];
const script = cb.resolveClipScript(model, clip, { element: t.elem1, target: ft.techTargetClass(tech), tech: null });
console.log("kind", script?.buildKind, "binds", JSON.stringify(script?.ops?.filter((o) => o.op === 2 && o.words[0] === 0)));
const bakeTable = script?.retargeted ? model.castBakes?.[clip]?.table : null;
console.log("bakeTable", bakeTable, "range", bakeTable != null ? (() => {
  const tab = model.timeline[bakeTable].table;
  return [tab[0], tab[tab.length - 3], tab[tab.length - 2], tab[tab.length - 1]];
})() : null);
a.setAction(clip, {}, { element: t.elem1, target: ft.techTargetClass(tech), tech: null });
for (let tick = 0; tick < 240 && a.vm && !a.vm.ended; tick++) {
  a.tick(2);
  const p = a.vm?.player;
  const s = p?._s;
  if (tick % 2 === 0 || tick > 100)
    console.log(JSON.stringify({ tick, frame: a.currentFrame(), table: a.timelineTable,
      player: p ? { len: p.length, head: p.playhead, frozen: !!s?.frozen, loopSeg: !!s?.loopSeg, sf: s?.frame, blend: p.blend } : null }));
}
