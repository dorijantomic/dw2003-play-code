#!/usr/bin/env node
// same-js: "did this TypeScript change the JavaScript?" — compare the tokens of a file at a
// git ref with the tokens of the working-tree file, both stripped of types.
//
//   node tools/rewrite/same-js.mjs [--base REF] [paths...]
//
// Default base is HEAD. Default paths are every .ts/.mts under web/ and engine/ that differs
// from that ref or is untracked:
//
//   git diff --name-only REF -- web engine
//   git ls-files --others --exclude-standard web engine
//
// Why tokens and not text: the conversion inserted types, and different tools delete them
// differently. Stripping both sides with node's own module.stripTypeScriptTypes (the same
// function tools/rewrite/build-web.mjs ships with) puts both on the same footing, and comparing
// kind+text per token ignores the whitespace that stripping moves around. Empty statements are
// dropped first: a stripped interface leaves ";" behind, which is not a runtime difference.
//
// A file that does not exist at the base ref is new. Its stripped form must be token-free — a
// new file may only add types (an interface/type module); runtime code has to modify an
// existing file, where this tool shows exactly which tokens appeared.
//
// Exit code: 0 when every file is token-identical, 1 when anything differs or cannot be read.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { createRequire } from "node:module";
import { relative, resolve } from "node:path";

const ts = createRequire(import.meta.url)("typescript");
const ROOT = process.cwd();
const CTX = 40;

const argv = process.argv.slice(2);
let base = "HEAD";
const paths = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--base") base = argv[++i];
  else if (a.startsWith("--base=")) base = a.slice("--base=".length);
  else if (a === "-h" || a === "--help") {
    console.log("usage: node tools/rewrite/same-js.mjs [--base REF] [paths...]");
    process.exit(0);
  } else paths.push(a);
}
if (!base) {
  console.error("same-js: --base needs a ref");
  process.exit(2);
}

const git = (args) => execFileSync("git", args, {
  cwd: ROOT,
  encoding: "utf8",
  maxBuffer: 256 * 1024 * 1024,
  stdio: ["ignore", "pipe", "pipe"],
});

let files;
if (paths.length) {
  files = paths;
} else {
  const changed = git(["diff", "--name-only", base, "--", "web", "engine"]).split("\n");
  const untracked = git(["ls-files", "--others", "--exclude-standard", "web", "engine"]).split("\n");
  files = [...new Set([...changed, ...untracked])];
}
files = files
  .map((f) => f.trim())
  .filter(Boolean)
  .filter((f) => /\.m?ts$/.test(f) && !/\.d\.m?ts$/.test(f));
files.sort();

// Parens left by stripping "(x as T)" around a plain reference or call: (a.b).c, (f(x))[0] mean the same as without.
// Not when the inner is an optional chain ((a?.b).c differs) or the parens are a new-callee (new (f())() differs).
function redundantParens(n) {
  if (n.kind !== ts.SyntaxKind.ParenthesizedExpression) return false;
  const e = n.expression;
  const plain = ts.isIdentifier(e) || e.kind === ts.SyntaxKind.ThisKeyword || ts.isPropertyAccessExpression(e) || ts.isElementAccessExpression(e) || ts.isCallExpression(e) || ts.isParenthesizedExpression(e);
  const dotted = (x) => ts.isIdentifier(x) || (ts.isPropertyAccessExpression(x) && !x.questionDotToken && dotted(x.expression));
  const newCallee = ts.isNewExpression(n.parent) && n.parent.expression === n;
  // new (THREE.Raycaster)() is new THREE.Raycaster(); new (f())() is not new f()()
  if (plain && !ts.isOptionalChain(e) && (!newCallee || dotted(e))) return true;
  // Any non-comma expression in a slot that binds looser than everything: const v = (await p); x = (a ? b : c); f((y as T)).
  if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.CommaToken) return false;
  const p = n.parent;
  if (ts.isVariableDeclaration(p) && p.initializer === n) return true;
  if (ts.isBinaryExpression(p) && p.right === n && p.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && p.operatorToken.kind <= ts.SyntaxKind.LastAssignment) return true;
  if (ts.isReturnStatement(p) || ts.isArrayLiteralExpression(p) || ts.isParenthesizedExpression(p)) return true;
  if (ts.isPropertyAssignment(p) && p.initializer === n) return true;
  if ((ts.isCallExpression(p) || ts.isNewExpression(p)) && p.arguments?.includes(n)) return true;
  return false;
}

function tokens(text) {
  // Leaf tokens of the parsed tree (a plain scanner splits template literals and regexes wrongly).
  const sf = ts.createSourceFile("x.js", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const raw = [];
  const walk = (n) => {
    if (n.kind >= ts.SyntaxKind.FirstJSDocNode && n.kind <= ts.SyntaxKind.LastJSDocNode) return;
    if (redundantParens(n)) { walk(n.expression); return; }
    if (ts.isShorthandPropertyAssignment(n) && !n.objectAssignmentInitializer) {
      // { landed } is { landed: landed }
      const name = { kind: ts.SyntaxKind.Identifier, text: n.name.text, pos: n.getStart(sf) };
      raw.push(name, { kind: ts.SyntaxKind.ColonToken, text: ":", pos: name.pos }, name);
      return;
    }
    const kids = n.getChildren(sf);
    if (!kids.length) {
      if (n.kind !== ts.SyntaxKind.EndOfFileToken && n.kind !== ts.SyntaxKind.SyntaxList) raw.push({ kind: n.kind, text: n.getText(sf), pos: n.getStart(sf) });
      return;
    }
    for (const k of kids) walk(k);
  };
  walk(sf);
  // an empty statement left where a type used to be is not a runtime token
  const out = [];
  for (const t of raw) {
    if (t.kind === ts.SyntaxKind.SemicolonToken) {
      const prev = out[out.length - 1];
      if (!prev || prev.text === "{" || prev.text === "}" || prev.text === ";") continue;
    }
    out.push(t);
  }
  return out;
}

const lineCol = (text, pos) => {
  const before = text.slice(0, pos);
  const line = before.split("\n").length;
  return `${line}:${pos - (before.lastIndexOf("\n") + 1) + 1}`;
};

const context = (text, pos) =>
  JSON.stringify(text.slice(Math.max(0, pos - CTX), Math.min(text.length, pos + CTX)).replace(/\s+/g, " "));

function baseText(file) {
  try {
    return git(["show", `${base}:${file}`]);
  } catch {
    return null; // not at the base ref: a new file
  }
}

let same = 0;
const problems = [];
const skipped = [];

for (const file of files) {
  const abs = resolve(ROOT, file);
  if (!existsSync(abs)) { skipped.push(`${file} (deleted, not compared)`); continue; }
  const now = readFileSync(abs, "utf8");
  const was = baseText(file);

  let nowTokens;
  try {
    nowTokens = tokens(stripTypeScriptTypes(now, { mode: "strip" }));
  } catch (e) {
    problems.push(`${file}: cannot strip working tree: ${e.message}`);
    continue;
  }

  if (was === null) {
    if (nowTokens.length === 0) { same++; continue; }
    const t = nowTokens[0];
    problems.push(
      `${file}, new file (not at ${base}), first runtime token at ${lineCol(now, t.pos)} ` +
      `${JSON.stringify(t.text)} — ${context(now, t.pos)}\n` +
      `    ${nowTokens.length} runtime token${nowTokens.length === 1 ? "" : "s"} in a new file; types only, please`,
    );
    continue;
  }

  let wasTokens;
  try {
    wasTokens = tokens(stripTypeScriptTypes(was, { mode: "strip" }));
  } catch (e) {
    problems.push(`${file}: cannot strip ${base} version: ${e.message}`);
    continue;
  }

  const n = Math.max(wasTokens.length, nowTokens.length);
  let diffAt = -1;
  for (let i = 0; i < n; i++) {
    const a = wasTokens[i], b = nowTokens[i];
    if (a && b && a.kind === b.kind && a.text === b.text) continue;
    diffAt = i;
    break;
  }
  if (diffAt < 0) { same++; continue; }

  const a = wasTokens[diffAt], b = nowTokens[diffAt];
  const where = (t, text) => (t ? `${lineCol(text, t.pos)} ${JSON.stringify(t.text)}` : "end of file");
  problems.push(
    `${file}, base ${where(a, was)}, new ${where(b, now)}\n` +
    `    base: ${a ? context(was, a.pos) : "<none>"}\n` +
    `    new : ${b ? context(now, b.pos) : "<none>"}`,
  );
}

for (const s of skipped) console.log(`same-js: skipped ${s}`);
for (const p of problems) console.log(`same-js: MISMATCH ${p}`);
if (problems.length) {
  console.log(`same-js: ${problems.length} of ${files.length} files differ from ${base}`);
  process.exit(1);
}
console.log(`same-js: ${same} files same`);
