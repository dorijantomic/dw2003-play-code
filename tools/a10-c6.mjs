// A10 debug 6: the C6 failures in detail
import fs from "node:fs";
const j = JSON.parse(fs.readFileSync("/home/dorij/scratch-research/anim-a10-contract.json", "utf8"));
const bad = j.rows.filter((r) => r.C6 === false).slice(0, 12);
for (const r of bad) console.log(r.model, r.case, r.built, "tables", r.tables, "d", r.c6d, "ops", r.ops, "98/99", r.h98, r.h99);
console.log("total C6 bad", j.rows.filter((r) => r.C6 === false).length);
