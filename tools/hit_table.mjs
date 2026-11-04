#!/usr/bin/env node
// tools/hit_table.mjs — every technique's disc accuracy byte and the hit% it produces.
//
// Reads the same two files the browser battle reads (`web/assets/data/fight_tech_table.json`
// and `digimon.json` skills for the names) and prints all 443 rows. The hit% is measured
// against a FIXED defender — SPD equal to the attacker's and level equal — so the accuracy
// term is 0 and the chance is exactly the record's +0x06 byte: `hit% = byte / 128`.
//
//   node tools/hit_table.mjs          human table + the four-value histogram
//   node tools/hit_table.mjs --json   one JSON row per technique, for tests/disc-rolls.test.js
//
// No browser, no engine import: it is the table's own numbers.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = join(ROOT, "web/assets/data");

const table = JSON.parse(readFileSync(join(DATA, "fight_tech_table.json"), "utf8"));
const names = new Map(
  (JSON.parse(readFileSync(join(DATA, "digimon.json"), "utf8")).skills ?? []).map((s) => [s.id, s.name]),
);

const rows = Object.keys(table)
  .map(Number)
  .sort((a, b) => a - b)
  .map((skill) => {
    const elemCtx = table[String(skill)].elemCtx;
    const hits = Math.min(elemCtx, 128);
    return {
      skill,
      name: names.get(skill) ?? "",
      elemCtx,
      hits,
      of: 128,
      percent: Math.round((hits / 128) * 10000) / 100,
    };
  });

if (process.argv.includes("--json")) {
  process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
} else {
  const hist = new Map();
  for (const row of rows) hist.set(row.elemCtx, (hist.get(row.elemCtx) ?? 0) + 1);
  const summary = [...hist.entries()].sort((a, b) => a[0] - b[0]).map(([v, n]) => `${v} x${n}`).join(", ");

  console.log("Technique accuracy — the record's +0x06 byte, and the hit% against a defender");
  console.log("with equal SPD and level (chance = byte / 128).");
  console.log("");
  console.log(`${"skill".padEnd(6)} ${"name".padEnd(28)} +0x06   hit`);
  for (const row of rows) {
    console.log(
      `${String(row.skill).padEnd(6)} ${row.name.padEnd(28)} ${String(row.elemCtx).padEnd(6)} ` +
        `${row.hits}/${row.of}  ${row.percent.toFixed(2)}%`,
    );
  }
  console.log("");
  console.log(`${rows.length} techniques; accuracy histogram: ${summary}.`);
}
