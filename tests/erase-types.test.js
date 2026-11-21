// The type eraser has one job: take TypeScript that was made by ADDING types to JavaScript and
// hand back the original JavaScript. Two independent proofs, both here:
//
//   PROOF A — tools/rewrite/erase-fixtures/ holds hand-written pairs (file.js, file.ts) where the
//   .ts is the .js with types added. eraseTypes(ts) must equal js byte for byte, including the
//   negative cases (optional chaining, ternaries, labels, object literals) that must survive
//   untouched, and the statements that must vanish with their line (interface, type alias,
//   declare, overloads, import type) leaving no blank line.
//
//   PROOF B — the whole converted tree: for every .ts/.mts under web/, the TOKENS of
//   eraseTypes(text) must equal the tokens of node's own module.stripTypeScriptTypes(text)
//   (strip mode). Characters differ by design — node blanks types to spaces to keep columns,
//   we delete them — so the comparison is kind+text per token with trivia skipped. This is what
//   makes the eraser safe to hand source text to tests: whatever the build ships, this reports.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, lstatSync } from "node:fs";
import { join, dirname, relative, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { stripTypeScriptTypes } from "node:module";
import { createRequire } from "node:module";

import { eraseTypes } from "../tools/rewrite/erase-types.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const FIXTURES = join(ROOT, "tools", "rewrite", "erase-fixtures");
const ts = createRequire(import.meta.url)("typescript");

const SKIP_DIRS = new Set(["lib3d", "vendor", "node_modules"]);
const skipDir = (name) => SKIP_DIRS.has(name) || name.startsWith("assets");

test("PROOF A: every fixture pair round-trips to exactly the JavaScript it came from", () => {
  const names = readdirSync(FIXTURES).filter((f) => f.endsWith(".ts")).sort();
  assert.ok(names.length >= 30, `expected at least 30 fixture pairs, found ${names.length}`);
  const failures = [];
  for (const name of names) {
    const tsText = readFileSync(join(FIXTURES, name), "utf8");
    const jsText = readFileSync(join(FIXTURES, name.replace(/\.ts$/, ".js")), "utf8");
    const got = eraseTypes(tsText, name);
    if (got !== jsText) failures.push({ name, jsText, got });
  }
  if (failures.length) {
    const detail = failures
      .map((f) => `  ${f.name}\n    want: ${JSON.stringify(f.jsText)}\n    got : ${JSON.stringify(f.got)}`)
      .join("\n");
    assert.equal(failures.length, 0, `${failures.length}/${names.length} fixture pairs differ:\n${detail}`);
  }
  console.log(`erase-types: PROOF A ${names.length} fixture pairs exact`);
});

function* tsFiles(dir) {
  for (const name of readdirSync(dir)) {
    if (skipDir(name)) continue;
    const p = join(dir, name);
    const st = lstatSync(p);
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) yield* tsFiles(p);
    else if (/\.m?ts$/.test(extname(name) || name) && !/\.d\.m?ts$/.test(name)) yield p;
  }
}

const sourceFiles = () => [...tsFiles(join(ROOT, "web"))].sort();

function tokens(text) {
  // leaf tokens of the parsed tree (a plain scanner splits template literals and regexes wrongly)
  const sf = ts.createSourceFile("x.js", text, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS);
  const out = [];
  const walk = (n) => {
    if (n.kind >= ts.SyntaxKind.FirstJSDocNode && n.kind <= ts.SyntaxKind.LastJSDocNode) return;
    const kids = n.getChildren(sf);
    if (!kids.length) {
      if (n.kind !== ts.SyntaxKind.EndOfFileToken && n.kind !== ts.SyntaxKind.SyntaxList) out.push({ kind: n.kind, text: n.getText(sf), pos: n.getStart(sf) });
      return;
    }
    for (const k of kids) walk(k);
  };
  walk(sf);
  return out;
}

const lineOf = (text, pos) => text.slice(0, pos).split("\n").length;

test("PROOF B: the eraser's tokens match node's strip for every web/ source", () => {
  const files = sourceFiles();
  assert.ok(files.length > 0, "no .ts files found under web/");
  const failures = [];
  let checked = 0;
  for (const file of files) {
    const rel = relative(ROOT, file);
    const src = readFileSync(file, "utf8");
    let mine;
    try {
      mine = tokens(eraseTypes(src, rel));
    } catch (e) {
      failures.push(`${rel}: eraseTypes threw: ${e.message}`);
      continue;
    }
    let theirs;
    try {
      theirs = tokens(stripTypeScriptTypes(src, { mode: "strip" }));
    } catch (e) {
      failures.push(`${rel}: node strip threw: ${e.message}`);
      continue;
    }
    checked++;
    const n = Math.max(mine.length, theirs.length);
    for (let i = 0; i < n; i++) {
      const a = mine[i], b = theirs[i];
      if (a && b && a.kind === b.kind && a.text === b.text) continue;
      const where = a ? `line ${lineOf(src, a.pos)}` : "end of file";
      failures.push(`${rel}: token ${i} at ${where}: erased ${JSON.stringify(a ? a.text : "<none>")}` +
        ` vs stripped ${JSON.stringify(b ? b.text : "<none>")}`);
      break;
    }
  }
  console.log(`erase-types: PROOF B ${checked} files checked, ${failures.length} mismatches`);
  assert.equal(failures.length, 0, `${failures.length} of ${files.length} files disagree:\n  ${failures.slice(0, 10).join("\n  ")}`);
});

test("the eraser deletes rather than blanks: no spaces are left behind", () => {
  assert.equal(eraseTypes("const a: number = 1;\n"), "const a = 1;\n");
  assert.equal(eraseTypes("function f(x: string): void {}\n"), "function f(x) {}\n");
  assert.equal(eraseTypes("let v = <any>x;\n"), "let v = x;\n");
});
