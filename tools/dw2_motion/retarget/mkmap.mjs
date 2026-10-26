// mkmap.mjs — build a dw2delta.mjs map from an autopair.mjs result plus the body atlas.
// In the repo since 2026-10-26 (from the private research prototype): paths come from ./paths.mjs, the logic is unchanged.
//   node mkmap.mjs <autopair.json> <out map.json> [--slot 9] [--spring 3.5]
// Fills: the paired bones, the head bone (atlas site) and its DW2 partner as the height probe, the ground-contact bones (the bones whose mesh reaches the floor
// at OUR idle pose, measured here), the facing from the atlas (still to be checked in the viewer), and one spring line.
import fs from "node:fs"; import os from "node:os";
import { RIGS, modelPath, fightModule } from "./paths.mjs";
const fa = await import(fightModule("firing-axis.js"));
const [apPath, outPath, ...rest] = process.argv.slice(2);
const opt = (k, d) => { const i = rest.indexOf(k); return i >= 0 ? rest[i + 1] : d; };
const AP = JSON.parse(fs.readFileSync(apPath, "utf8")), folder = AP.ours.folder;
const atlas = JSON.parse(fs.readFileSync(RIGS, "utf8")).models[folder];
const model = JSON.parse(fs.readFileSync(modelPath(folder), "utf8"));
const rest0 = Math.min(...model.timeline[0].table.map((e) => e.value).filter((v) => v >= 0 && v < 0x8000));
const p = fa.poseFromChannels(model, rest0);
let floor = -1e9, top = 1e9; const lowest = [];
model.bones.forEach((b, bi) => {
  const R = p.rot[bi], P = p.pos[bi]; let lo = -1e9, hi = 1e9;
  for (const v of b.verts || []) { const y = (R[1] * v[0] + R[4] * v[1] + R[7] * v[2]) + P[1]; lo = Math.max(lo, y); hi = Math.min(hi, y); }
  lowest.push(lo); if (lo > -1e8) { floor = Math.max(floor, lo); top = Math.min(top, hi); }
});
const H = floor - top;
const contact = lowest.map((y, i) => [i, y]).filter(([, y]) => y > floor - 0.03 * H).map(([i]) => i);
const headBone = atlas.sites?.head?.bone;
const partner = Object.fromEntries(AP.pairs.map(([o, d]) => [o, d]));
const map = {
  slot: +opt("--slot", 9),
  dw2: { id: AP.dw2.id, heightProbe: partner[headBone] },
  ours: { folder, facing: atlas.facing?.az ?? 0, contact, head: headBone, heightProbe: headBone },
  flipDw2: AP.flipDw2,
  pairs: AP.pairs,
  springs: [`joints ${opt("--spring", 3.5)} 1.0`],
  note: `made by mkmap.mjs from ${apPath}; contact = bones reaching the floor at our idle; facing ${atlas.facing?.az} (src: ${atlas.facing?.src}) MUST be checked in the viewer`,
};
fs.writeFileSync(outPath, JSON.stringify(map, null, 1));
console.log(`${folder}: ${AP.pairs.length} pairs, head bone ${headBone} <-> dw2 ${partner[headBone]}, contact ${contact}, facing ${map.ours.facing}`);
