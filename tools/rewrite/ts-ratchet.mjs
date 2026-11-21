#!/usr/bin/env node
// ts-ratchet: the type checker may not get worse. Files that are clean today are listed in
// tools/rewrite/ts-clean.json; if any of them has an error tomorrow, this exits 1.
//
//   node tools/rewrite/ts-ratchet.mjs             # check (exit 1 on regression)
//   node tools/rewrite/ts-ratchet.mjs --update    # grow the clean list to today's reality
//
// It runs the type checker once, over the whole web tree:
//
//   npx tsc -p tsconfig.web.json --noEmit --pretty false
//
// Errors in files that are already dirty are ignored — someone else's agent is mid-migration in
// that file, and the count is the interesting number, not a gate. The gate is the clean list:
// a file cannot go from 0 errors to 5 without this failing, so new code cannot quietly arrive
// dirty and finished files cannot quietly rot.
//
// --update is additive by design: it adds every web .ts that is now at 0 errors, and drops
// entries for files that no longer exist. It never removes a file that still has errors, because
// that file got dirty and the failure is the point.
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const CLEAN = join(HERE, "ts-clean.json");
const TSCONFIG = "tsconfig.web.json";

const SKIP_DIRS = new Set(["lib3d", "vendor", "node_modules"]);
const skipDir = (name) => SKIP_DIRS.has(name) || name.startsWith("assets");

const args = process.argv.slice(2);
const update = args.includes("--update");

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (skipDir(name)) continue;
    const p = join(dir, name);
    const st = lstatSync(p);
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) yield* walk(p);
    else if (/\.m?ts$/.test(name) && !/\.d\.m?ts$/.test(name)) yield p;
  }
}

const webFiles = [...walk(join(ROOT, "web"))]
  .map((p) => relative(ROOT, p).split(sep).join("/"))
  .sort();

function typecheck() {
  const started = Date.now();
  let out = "";
  let status = 0;
  try {
    out = execFileSync("npx", ["tsc", "-p", TSCONFIG, "--noEmit", "--pretty", "false"], {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 512 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });
  } catch (e) {
    status = e.status ?? 1;
    out = `${e.stdout ?? ""}${e.stderr ?? ""}`;
  }
  return { out, status, ms: Date.now() - started };
}

const ERROR_LINE = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/;

function parse(text) {
  const byFile = new Map();
  const other = [];
  for (const line of text.split("\n")) {
    const m = ERROR_LINE.exec(line.trimEnd());
    if (!m) {
      if (line.trim()) other.push(line);
      continue;
    }
    const file = m[1].split(sep).join("/").replace(/^\.\//, "");
    if (!byFile.has(file)) byFile.set(file, []);
    byFile.get(file).push({ line: Number(m[2]), col: Number(m[3]), code: m[4], message: m[5] });
  }
  return { byFile, other };
}

const { out, status, ms } = typecheck();
const { byFile, other } = parse(out);

const totalErrors = [...byFile.values()].reduce((n, list) => n + list.length, 0);
const clean = webFiles.filter((f) => !byFile.has(f));
const dirty = webFiles.filter((f) => byFile.has(f));

console.log(`ts-ratchet: tsc ${TSCONFIG} in ${(ms / 1000).toFixed(1)}s (exit ${status})`);
console.log(`ts-ratchet: ${totalErrors} total errors in ${byFile.size} files`);
console.log(`ts-ratchet: clean files ${clean.length}/${webFiles.length}`);

const readClean = () => {
  if (!existsSync(CLEAN)) return [];
  const parsed = JSON.parse(readFileSync(CLEAN, "utf8"));
  if (!Array.isArray(parsed)) throw new Error(`${relative(ROOT, CLEAN)} must be a JSON array of file paths`);
  return parsed;
};

if (update) {
  const existing = readClean();
  const kept = existing.filter((f) => !byFile.has(f) && existsSync(join(ROOT, f)));
  const next = [...new Set([...kept, ...clean])].sort();
  writeFileSync(CLEAN, `${JSON.stringify(next, null, 2)}\n`);
  const added = next.length - kept.length;
  console.log(`ts-ratchet: wrote ${next.length} clean files to ${relative(ROOT, CLEAN)} (+${added})`);
  process.exit(0);
}

const listed = readClean();
const regressions = [];
const stale = [];
for (const file of listed) {
  const errors = byFile.get(file);
  if (errors) regressions.push({ file, errors });
  else if (!existsSync(join(ROOT, file))) stale.push(file);
}

console.log(`ts-ratchet: ${listed.length} files must stay clean`);

if (regressions.length) {
  console.log(`ts-ratchet: FAIL ${regressions.length} of ${listed.length} clean files have errors`);
  for (const { file, errors } of regressions) {
    console.log(`  ${file}: ${errors.length} error${errors.length === 1 ? "" : "s"}`);
    for (const e of errors.slice(0, 5)) console.log(`    ${file}(${e.line},${e.col}): ${e.code} ${e.message}`);
    if (errors.length > 5) console.log(`    ... ${errors.length - 5} more in ${file}`);
  }
}
if (stale.length) {
  console.log(`ts-ratchet: FAIL ${stale.length} listed file${stale.length === 1 ? "" : "s"} no longer exist:`);
  for (const f of stale) console.log(`  ${f}`);
  console.log(`  run: node tools/rewrite/ts-ratchet.mjs --update`);
}
if (regressions.length || stale.length) process.exit(1);

if (other.length) {
  console.log(`ts-ratchet: ${other.length} tsc lines that are not per-file errors (ignored):`);
  for (const line of other.slice(0, 5)) console.log(`  ${line}`);
}
console.log(`ts-ratchet: ok — ${dirty.length} files still dirty (${totalErrors} errors), none of them listed clean`);
