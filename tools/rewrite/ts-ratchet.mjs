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
//
// Second gate, the strict ratchet: tsconfig.web.strict.json (strict + noUncheckedIndexedAccess +
// exactOptionalPropertyTypes + noImplicitOverride + noFallthroughCasesInSwitch) is also run. Per-file
// strict error counts and per-file explicit-`any` counts are stored in tools/rewrite/ts-strict-baseline.json.
// The strict TOTAL may only go down (one file can rise when a better type elsewhere exposes a real
// mistake in it), and per-file explicit `any` may only go down; a file not in the baseline must have no any. --update lowers the baseline to today's numbers (it
// refuses to raise any number; first run with no baseline file creates it).
import { execFileSync } from "node:child_process";
import { countAny, runStrict } from "./strict-count.mjs";
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

// ---- strict ratchet ----
const BASELINE = join(HERE, "ts-strict-baseline.json");
function strictGate(updating) {
  const started = Date.now();
  const r = runStrict("tsconfig.web.strict.json");
  const any = countAny();
  const now = {};
  for (const f of new Set([...r.files.keys(), ...any.keys()])) now[f] = { errors: r.files.get(f) ?? 0, any: any.get(f) ?? 0 };
  const sum = (o, k) => Object.values(o).reduce((n, v) => n + v[k], 0);
  console.log(`ts-ratchet: strict ${TSCONFIG_STRICT}: ${r.total} errors, ${sum(now, "any")} explicit any, in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  const had = existsSync(BASELINE);
  const base = had ? JSON.parse(readFileSync(BASELINE, "utf8")).files : {};
  const worse = [];
  for (const [f, v] of Object.entries(now)) {
    const b = base[f] ?? { errors: 0, any: 0 };
    if (!had) break;
    if (v.any > b.any) worse.push(`${f}: explicit any ${b.any} -> ${v.any}`);
  }
  const baseTotalAll = had ? JSON.parse(readFileSync(BASELINE, "utf8")).total : Infinity;
  if (had && r.total > baseTotalAll) worse.push(`strict total ${baseTotalAll} -> ${r.total}`);
  if (!had || (updating && !worse.length)) {
    const files = {};
    for (const f of Object.keys(now).sort()) if (now[f].errors || now[f].any) files[f] = now[f];
    writeFileSync(BASELINE, `${JSON.stringify({ total: r.total, any: sum(now, "any"), files }, null, 1)}\n`);
    console.log(`ts-ratchet: wrote strict baseline ${relative(ROOT, BASELINE)} (${r.total} errors, ${sum(now, "any")} any)`);
    return false;
  }
  if (worse.length) {
    console.log(`ts-ratchet: FAIL strict ratchet, ${worse.length} file numbers went up:`);
    for (const w of worse.slice(0, 20)) console.log(`  ${w}`);
    if (worse.length > 20) console.log(`  ... ${worse.length - 20} more`);
    if (updating) console.log("ts-ratchet: --update refuses to raise the strict baseline");
    return true;
  }
  const baseTotal = Object.values(base).reduce((n, v) => n + v.errors, 0);
  console.log(`ts-ratchet: strict ok (baseline ${baseTotal} errors; run --update to lower it)`);
  return false;
}
const TSCONFIG_STRICT = "tsconfig.web.strict.json";

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
  process.exit(strictGate(true) ? 1 : 0);
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
const strictFailed = strictGate(false);
if (regressions.length || stale.length || strictFailed) process.exit(1);

if (other.length) {
  console.log(`ts-ratchet: ${other.length} tsc lines that are not per-file errors (ignored):`);
  for (const line of other.slice(0, 5)) console.log(`  ${line}`);
}
console.log(`ts-ratchet: ok — ${dirty.length} files still dirty (${totalErrors} errors), none of them listed clean`);
