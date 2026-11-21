// Files got split into folders, so each folder carries a MAP.md saying what is in it and where
// each file went. That documentation rots the moment someone adds a file and forgets the map, or
// renames a file and leaves the old name in a table. Two checks, per MAP.md:
//
//   1. Every .ts/.mts directly in that folder is named somewhere in the MAP.md text (a .d.ts is a
//      generated declaration, not a source file, so it is exempt).
//   2. Every word ending in ".ts" that appears inside a markdown table row actually resolves —
//      either inside that folder or from the repo root. A table row is the "here is the file
//      list" part, so a stale name there is the exact failure this catches.
//
// Folders with no MAP.md are not an error: documentation is added as a folder is understood, and
// this test only keeps what exists honest.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const SKIP_DIRS = new Set(["lib3d", "vendor", "node_modules"]);
const skipDir = (name) => SKIP_DIRS.has(name) || name.startsWith("assets");

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (skipDir(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isSymbolicLink()) continue;
    if (e.isDirectory()) yield* walk(p);
    else if (e.name === "MAP.md") yield p;
  }
}

const maps = [...walk(join(ROOT, "web")), ...walk(join(ROOT, "engine"))]
  .map((p) => relative(ROOT, p).split(sep).join("/"))
  .sort();

// a path in prose: backticks, links, parenthesised — take the word, drop trailing punctuation
const tsWord = /[A-Za-z0-9_@./-]+\.ts\b/g;
const isTableRow = (line) => line.trim().startsWith("|");
const stripTableMarkup = (line) => line.replace(/\|/g, " ");

test("every MAP.md names every source file beside it", () => {
  const failures = [];
  for (const rel of maps) {
    const dir = dirname(join(ROOT, rel));
    const text = readFileSync(join(ROOT, rel), "utf8");
    const files = readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && /\.m?ts$/.test(e.name) && !/\.d\.m?ts$/.test(e.name))
      .map((e) => e.name)
      .sort();
    for (const file of files) {
      // by file name; "state.ts" must appear, "web/x/state.ts" also counts
      if (!new RegExp(`(^|[^A-Za-z0-9_.-])${file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9_.-])`).test(text)) {
        failures.push(`${rel}: ${file} is not named in the map`);
      }
    }
  }
  if (failures.length) assert.fail(`${failures.length} unmapped file(s):\n  ${failures.join("\n  ")}`);
  console.log(`maps-current: ${maps.length} MAP.md file(s) cover every source file beside them`);
});

test("every .ts named in a MAP.md table row exists", () => {
  const failures = [];
  let checked = 0;
  // A MAP.md for a folder often lists files in its subfolders (engine/MAP.md describes
  // engine/systems/*.ts), so a bare name resolves if it sits anywhere under the map's folder,
  // or as a path from the repo root.
  const underCache = new Map();
  const under = (dir) => {
    if (underCache.has(dir)) return underCache.get(dir);
    const names = new Set();
    const stack = [dir];
    while (stack.length) {
      const cur = stack.pop();
      let entries;
      try {
        entries = readdirSync(cur, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const e of entries) {
        if (e.isSymbolicLink()) continue;
        if (e.isDirectory()) {
          if (!skipDir(e.name)) stack.push(join(cur, e.name));
        } else names.add(e.name);
      }
    }
    underCache.set(dir, names);
    return names;
  };
  for (const rel of maps) {
    const dir = dirname(join(ROOT, rel));
    const lines = readFileSync(join(ROOT, rel), "utf8").split("\n");
    for (const line of lines) {
      if (!isTableRow(line)) continue;
      for (const word of stripTableMarkup(line).match(tsWord) ?? []) {
        const clean = word.replace(/\.$/, "");
        if (/\.d\.ts$/.test(clean)) continue; // declarations are generated
        checked++;
        if (existsSync(join(dir, clean))) continue;
        if (existsSync(join(ROOT, clean))) continue;
        if (!clean.includes("/") && under(dir).has(clean)) continue;
        failures.push(`${rel}: table row names ${clean}, which exists neither in that folder, under it, nor at the repo root`);
      }
    }
  }
  if (failures.length) assert.fail(`${failures.length} stale reference(s):\n  ${failures.join("\n  ")}`);
  console.log(`maps-current: ${checked} table-row .ts reference(s) resolve`);
});
