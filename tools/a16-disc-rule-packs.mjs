// A16 step 1c: per-pack grouping of the authored launch->strike gaps.
import fs from "node:fs";
const data = JSON.parse(fs.readFileSync("/home/dorij/scratch-research/a16-disc-rule.json", "utf8"));
const rows = data.rows.filter((r) => r.gap != null && r.pack);
const byPack = new Map();
for (const r of rows) {
  if (!byPack.has(r.id)) byPack.set(r.id, []);
  byPack.get(r.id).push(r);
}
const med = (a) => { const b = a.slice().sort((x, y) => x - y); return b.length ? b[b.length >> 1] : null; };
console.log("id ticks park travel arrive | n  gaps (deduped by model+gap)  gap-ticks  gap-arrive");
const lines = [...byPack.entries()].sort((a, b) => a[0] - b[0]);
for (const [id, list] of lines) {
  const p = list[0].pack;
  const gaps = [...new Set(list.map((r) => r.gap))].sort((a, b) => a - b);
  const gm = med(list.map((r) => r.gap));
  console.log(String(id).padStart(4), String(p.ticks).padStart(4), String(p.park).padStart(4), String(p.travel).padStart(4),
    String(p.arrive).padStart(4), "|", String(list.length).padStart(2), gaps.join(",").padEnd(40),
    String(gm - p.ticks).padStart(4), String(p.arrive == null ? "-" : gm - p.arrive).padStart(4));
}
