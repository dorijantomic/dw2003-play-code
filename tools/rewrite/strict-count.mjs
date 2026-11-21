#!/usr/bin/env node
// strict-count: how far web/ is from strict. Runs tsc with tsconfig.web.strict.json (full: strict +
// noUncheckedIndexedAccess + exactOptionalPropertyTypes + noImplicitOverride + noFallthroughCasesInSwitch)
// and prints total errors, errors per code, errors per folder, explicit-any count.
//   node tools/rewrite/strict-count.mjs              # full strict config
//   node tools/rewrite/strict-count.mjs --alone      # strict only (tsconfig.web.strict-only.json)
//   node tools/rewrite/strict-count.mjs --json out   # also write per-file counts to out
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, lstatSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

export function runStrict(config = "tsconfig.web.strict.json") {
  let out = "";
  try {
    out = execFileSync("npx", ["tsc", "-p", config, "--noEmit", "--pretty", "false"], {
      cwd: ROOT, encoding: "utf8", maxBuffer: 1024 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e) { out = `${e.stdout ?? ""}${e.stderr ?? ""}`; }
  const re = /^(.+?)\((\d+),(\d+)\): error (TS\d+): /;
  const files = new Map(), codes = new Map();
  let total = 0;
  for (const line of out.split("\n")) {
    const m = re.exec(line);
    if (!m) continue;
    const f = m[1].split(sep).join("/").replace(/^\.\//, "");
    files.set(f, (files.get(f) ?? 0) + 1);
    codes.set(m[4], (codes.get(m[4]) ?? 0) + 1);
    total++;
  }
  return { total, files, codes };
}

// explicit any: `any` as a word in code, per file (comments and strings stripped roughly)
export function countAny() {
  const per = new Map();
  const walk = (d) => {
    for (const n of readdirSync(d)) {
      if (n === "lib3d" || n === "vendor" || n === "node_modules" || n.startsWith("assets")) continue;
      const p = join(d, n);
      const st = lstatSync(p);
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) walk(p);
      else if (/\.m?ts$/.test(n)) {
        const src = readFileSync(p, "utf8")
          .replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:\\])\/\/.*$/gm, "$1")
          .replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g, '""');
        const c = (src.match(/(?<![\w$.])any(?![\w$])/g) ?? []).length;
        if (c) per.set(relative(ROOT, p).split(sep).join("/"), c);
      }
    }
  };
  walk(join(ROOT, "web"));
  return per;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const alone = process.argv.includes("--alone");
  const r = runStrict(alone ? "tsconfig.web.strict-only.json" : "tsconfig.web.strict.json");
  const any = countAny();
  console.log(`strict-count (${alone ? "strict only" : "full strict"}): ${r.total} errors in ${r.files.size} files`);
  console.log("per code:");
  for (const [c, n] of [...r.codes].sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`  ${c} ${n}`);
  const folders = new Map();
  for (const [f, n] of r.files) {
    const parts = f.split("/");
    const k = parts.length > 2 ? parts[1] : "(web root)";
    folders.set(k, (folders.get(k) ?? 0) + n);
  }
  console.log("per folder:");
  for (const [k, n] of [...folders].sort((a, b) => b[1] - a[1])) console.log(`  ${k} ${n}`);
  console.log(`explicit any (word in code): ${[...any.values()].reduce((a, b) => a + b, 0)} in ${any.size} files`);
  const ji = process.argv.indexOf("--json");
  if (ji > 0) writeFileSync(process.argv[ji + 1], JSON.stringify({ errors: Object.fromEntries(r.files), any: Object.fromEntries(any) }, null, 1));
}
