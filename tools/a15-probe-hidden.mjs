// A15: idle-hidden mesh parts and the authored frame windows in which the pack SHOWS them.
import fs from "node:fs";
import path from "node:path";
const REPO = "/home/dorij/dw2003-play-anim";
const MODELS = path.join(REPO, "web/assets/battle/models");
const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const b3 = await import(path.join(REPO, "web/battle3d.js"));
for (const folder of process.argv.slice(2).length ? process.argv.slice(2) : ["m190bolt", "m200blsa", "m245infr", "m227garb", "m443sgr2", "m171goki"]) {
  const m = readJson(path.join(MODELS, folder, "anim.json"));
  const frames = (m.timeline?.[0]?.table || []).filter((e) => (e.value | 0) < 0x8000).map((e) => e.value | 0);
  const hid = [];
  for (let b = 0; b < m.bones.length; b++) {
    const ch3 = m.bones[b].anim?.ch3; if (!ch3 || !(m.bones[b].faces || []).length) continue;
    const vals = frames.map((f) => { const s = b3.interpChannel(ch3, f); return Math.max(Math.abs(s[0]), Math.abs(s[1]), Math.abs(s[2])) / 4096; });
    const lo = Math.min(...vals), hi = Math.max(...vals);
    if (lastTiny(vals)) hid.push({ bone: b, idleMin: +lo.toFixed(2), idleMax: +hi.toFixed(2), ch3: ch3.map((k) => [Math.round(k[3]), Math.max(Math.abs(k[0]), Math.abs(k[1]), Math.abs(k[2])) / 4096]) });
  }
  function lastTiny(vals) { let ok = true; for (const v of vals) if (v >= 0.05) ok = false; return ok; }
  // own actions + their bound tables and frame ranges
  const acts = [];
  for (const [c, act] of Object.entries(m.actions || {})) {
    if (!act) { acts.push({ clip: c, table: null, frames: "null-action" }); continue; }
    const bt = (act.ops || []).find((o) => o.op === 2 && o.words?.[0] === 0 && (o.words[2] | 0) > 1)?.words[2] | 0;
    const tab = bt ? m.timeline?.[bt]?.table : null;
    const fr = tab ? tab.filter((e) => (e.value | 0) < 0x8000).map((e) => e.value | 0) : [];
    acts.push({ clip: c, table: bt || null, frames: fr.length ? `${Math.min(...fr)}..${Math.max(...fr)}` : "-" });
  }
  console.log(JSON.stringify({ folder, hidden: hid, actions: acts }));
  // which own clips' tables cover the hidden part's visible windows
  for (const h of hid) {
    const vis = [];
    const ch3 = m.bones[h.bone].anim.ch3;
    for (let f = 0; f <= 30000; f += 1) { const s = b3.interpChannel(ch3, f); if (Math.max(Math.abs(s[0]), Math.abs(s[1]), Math.abs(s[2])) / 4096 >= 0.05) vis.push(f); }
    const ranges = [];
    let start = null;
    for (let i = 0; i < vis.length; i++) { if (start == null) start = vis[i]; else if (vis[i] !== vis[i - 1] + 1) { ranges.push([start, vis[i - 1]]); start = vis[i]; } }
    if (start != null) ranges.push([start, vis[vis.length - 1]]);
    console.log(`  bone ${h.bone} visible windows ${JSON.stringify(ranges.slice(0, 8))}`);
  }
}
