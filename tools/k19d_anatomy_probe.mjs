// What the research says each exemplar's arms end in, what the shots rule is, and the body's
// motion class — the three inputs that decide the exemplar's emitter class.
import fs from "node:fs";
import path from "node:path";
const ROOT = "/home/dorij/dw2003-play-anim";
const A = await import(path.join(ROOT, "web/fight/digimon-anatomy.js"));
const auto = ["m228piem", "m178kngt", "m050coca"];
const more = process.argv.slice(2);
for (const folder of [...auto, ...more]) {
  const a = A.anatomy(folder) || {};
  console.log(folder, JSON.stringify({
    plan: a.plan, arm: a.arm, armament: a.armament, armEquip: A.armEquipSides(folder),
    emitters: A.emitters(folder).map((e) => ({ id: e.id, part: e.part, kind: e.kind, primary: !!e.primary })),
    size: A.sizeClass(folder),
  }));
  for (const t of (a.techs || []).slice(0, 40)) { /* not used */ }
}
