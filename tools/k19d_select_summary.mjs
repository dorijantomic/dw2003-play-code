// Summarise the exemplar-selection data (anim-k19d-select.json): the rule's candidates per emitter
// class, the planted ones (the slice's target: a cast that today falls back to the planted own-body
// build), and which model each class would pick.
import fs from "node:fs";
const rows = JSON.parse(fs.readFileSync("/home/dorij/scratch-research/anim-k19d-select.json", "utf8"));
const byClass = new Map();
for (const r of rows) for (const s of r.spells) {
  if (!byClass.has(s.emitterClass)) byClass.set(s.emitterClass, new Map());
  const m = byClass.get(s.emitterClass);
  if (!m.has(r.folder)) m.set(r.folder, { folder: r.folder, name: r.name, size: r.size, arm: r.arm, armEquip: r.armEquip, armament: r.armament, spells: [] });
  m.get(r.folder).spells.push(s);
}
for (const [cls, models] of [...byClass.entries()].sort()) {
  const planted = [...models.values()].filter((m) => m.spells.some((s) => s.planted));
  console.log(`\n== ${cls}: ${planted.length} models with a still-planted spell (${models.size} candidates)`);
  for (const m of planted.sort((a, b) => b.spells.filter((s) => s.planted).length - a.spells.filter((s) => s.planted).length).slice(0, 8)) {
    const ps = m.spells.filter((s) => s.planted);
    console.log(`   ${m.folder} ${m.name} [${m.size}] arm=${JSON.stringify(m.arm)} equip=${Object.fromEntries(Object.entries(m.armEquip || {}).map(([k, v]) => [k, v?.class]))}`);
    for (const s of ps.slice(0, 4)) console.log(`      tech ${s.techId} ${s.name} clip ${s.clip} shots=${s.shots}/${s.shotsN} emitters=${JSON.stringify(s.emitters)}`);
  }
}
const piem = rows.find((r) => r.folder === "m228piem");
if (piem) {
  console.log("\nm228piem spells:");
  for (const s of piem.spells) console.log(`   tech ${s.techId} ${s.name} clip ${s.clip} planted=${s.planted} shots=${s.shots}/${s.shotsN} emitters=${JSON.stringify(s.emitters)} class=${s.emitterClass}`);
}
