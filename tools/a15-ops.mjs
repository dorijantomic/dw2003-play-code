import fs from "node:fs";
const p = "/home/dorij/dw2003-play-anim/web/assets/battle/models/" + (process.argv[2] || "m190bolt") + "/anim.json";
const a = JSON.parse(fs.readFileSync(p, "utf8"));
for (const c of ["5", "9"]) {
  const s = a.actions?.[c];
  console.log("clip", c, s ? s.ops.length : "none");
  if (s) for (const o of s.ops) console.log("  ", o.op, JSON.stringify(o.words), o.side ?? "");
}
