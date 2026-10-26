// A16 step 1 probe: what packs look like and how the authored scripts time their strike.
import fs from "node:fs";
import path from "node:path";
const REPO = "/home/dorij/dw2003-play-anim";
const MODELS = path.join(REPO, "web/assets/battle/models");
const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const index = readJson(path.join(MODELS, "index.json"));
console.log("index type", Array.isArray(index) ? "array" : Object.keys(index).slice(0, 6));
const sample = Array.isArray(index) ? index[0] : index[Object.keys(index)[0]];
console.log("entry", JSON.stringify(sample).slice(0, 400));
const man = readJson(path.join(REPO, "web/assets/battle/effects/manifest.json"));
const proj = man.projectiles || {};
const ids = Object.keys(proj).map(Number);
console.log("packs", ids.length);
let rows = [];
for (const id of ids) {
  const rec = proj[String(id)];
  const p = path.join(REPO, "web/assets/battle/effects/proj", `${id}.json`);
  if (!fs.existsSync(p)) continue;
  const pack = readJson(p);
  const root = (pack.layers || [])[0];
  const t = root?.tracks?.t || [];
  rows.push({ id, ticks: rec.ticks, dur: rec.dur, seg: rec.clip?.segments?.length, keys: t.length, t: t.slice(0, 6) });
}
console.log("pack rows sample");
for (const r of rows.slice(0, 8)) console.log(JSON.stringify(r));
// how many have a parks-then-travels root track
let parkRun = 0, moving = 0, noTrack = 0;
for (const r of rows) {
  const zs = r.t.map((k) => k[3]);
  if (!r.keys) { noTrack++; continue; }
  const z0 = zs[0], zLast = zs[zs.length - 2] ?? zs[zs.length - 1];
  const parked = Math.abs(zs[1] - z0) < 1 && r.keys >= 3;
  if (Math.abs(zLast - z0) > 500) { moving++; if (parked) parkRun++; }
}
console.log({ total: rows.length, parkRun, moving, noTrack });
const tickHist = {};
for (const r of rows) tickHist[r.ticks] = (tickHist[r.ticks] || 0) + 1;
console.log("tick histogram", JSON.stringify(Object.entries(tickHist).sort((a, b) => a[0] - b[0])));
