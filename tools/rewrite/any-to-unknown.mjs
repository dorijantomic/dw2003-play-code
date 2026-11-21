#!/usr/bin/env node
// any-to-unknown: in the given type files, replace every explicit `any` by `unknown`, then undo
// exactly those replacements that make the type checker complain (in tsconfig.web.json, which must
// stay at 0 errors) by following each error back to the declarations it reads. Type syntax only,
// so the emitted JS stays the same. Never invents a shape: `unknown` is the "truly unknown" type.
//
//   node tools/rewrite/any-to-unknown.mjs web/types/battle.ts web/fight/types.ts ...
//   node tools/rewrite/any-to-unknown.mjs --dry <files>
//
// After it: node tools/rewrite/same-js.mjs (all same) and npx tsc -p tsconfig.web.json (0 errors).
import ts from "typescript";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = process.argv.slice(2);
const dry = args.includes("--dry");
const targets = args.filter((a) => !a.startsWith("--")).map((a) => resolve(ROOT, a));
if (!targets.length) { console.error("give the type files to clean"); process.exit(2); }

const parse = (name) => ts.parseJsonConfigFileContent(ts.readConfigFile(resolve(ROOT, name), ts.sys.readFile).config, ts.sys, ROOT);
const cfgs = { ns: parse("tsconfig.web.json"), st: parse("tsconfig.web.strict.json") };
const files = new Map();
for (const f of cfgs.ns.fileNames) files.set(f, { version: 0, text: null });
const mkLs = (opts) => ts.createLanguageService({
  getCompilationSettings: () => opts,
  getScriptFileNames: () => [...files.keys()],
  getScriptVersion: (f) => String(files.get(f)?.version ?? 0),
  getScriptSnapshot: (f) => {
    const e = files.get(f);
    const text = e ? (e.text ??= readFileSync(f, "utf8")) : ts.sys.readFile(f);
    return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text);
  },
  getCurrentDirectory: () => ROOT,
  getDefaultLibFileName: (o) => ts.getDefaultLibFilePath(o),
  fileExists: ts.sys.fileExists, readFile: ts.sys.readFile, readDirectory: ts.sys.readDirectory,
  directoryExists: ts.sys.directoryExists, getDirectories: ts.sys.getDirectories,
}, ts.createDocumentRegistry());
const nsLs = mkLs(cfgs.ns.options), stLs = mkLs(cfgs.st.options);
const setText = (f, t) => { const e = files.get(f); e.text = t; e.version++; };

function errors(ls) {
  const prog = ls.getProgram();
  const out = [];
  for (const sf of prog.getSourceFiles()) {
    if (!files.has(sf.fileName)) continue;
    for (const d of [...prog.getSyntacticDiagnostics(sf), ...prog.getSemanticDiagnostics(sf)]) out.push({ file: sf.fileName, d });
  }
  return out;
}

// candidates: every `any` keyword used as a type in the target files
const cands = new Map(); // file -> [{start,end,id,drop}]
for (const f of targets) {
  if (!files.has(f)) { console.log(`skip (not in web ts set): ${f}`); continue; }
  const text = (files.get(f).text ??= readFileSync(f, "utf8"));
  const sf = ts.createSourceFile(f, text, ts.ScriptTarget.ES2022, true);
  const list = [];
  const walk = (n) => {
    if (n.kind === ts.SyntaxKind.AnyKeyword) list.push({ start: n.getStart(sf), end: n.end, id: list.length, drop: false });
    ts.forEachChild(n, walk);
  };
  walk(sf);
  cands.set(f, { before: text, list });
}
const totalCands = [...cands.values()].reduce((n, c) => n + c.list.length, 0);

function apply() {
  for (const [f, c] of cands) {
    let res = "", pos = 0;
    for (const e of c.list) {
      if (e.drop) continue;
      res += c.before.slice(pos, e.start) + "unknown";
      pos = e.end;
    }
    res += c.before.slice(pos);
    setText(f, res);
  }
}
// map positions in the new text back to candidate ids
function spansOf(f) {
  const c = cands.get(f);
  const out = [];
  let shift = 0;
  for (const e of c.list) {
    if (e.drop) continue;
    out.push({ id: e.id, from: e.start + shift, to: e.start + shift + 7 });
    shift += 7 - (e.end - e.start);
  }
  return out;
}

const baseSt = errors(stLs).length; // strict count with any (after apply this must drop or stay)
const isFnLike = (n) => ts.isFunctionLike(n) || ts.isBlock(n) || ts.isSourceFile(n);
function innermost(sf, start, end) {
  let node = sf;
  for (;;) {
    let next;
    ts.forEachChild(node, (c) => { if (!next && c.getStart(sf) <= start && end <= c.end) next = c; });
    if (!next) return node;
    node = next;
  }
}
// which declaration ranges (file, from, to) may be to blame for error d
function blame(prog, file, d) {
  const sf = prog.getSourceFile(file);
  const checker = prog.getTypeChecker();
  const hits = [];
  if (!sf || d.start === undefined) return hits;
  const node = innermost(sf, d.start, d.start + (d.length ?? 0));
  let top = node;
  for (let i = 0; i < 3 && top.parent && !ts.isStatement(top.parent) && !isFnLike(top.parent); i++) top = top.parent;
  const addDecl = (decl) => {
    if (!decl) return;
    hits.push({ file: decl.getSourceFile().fileName, from: decl.getStart(), to: decl.end });
  };
  const seen = new Set();
  const visit = (n, depth) => {
    if (ts.isIdentifier(n) || ts.isPrivateIdentifier(n)) {
      let sym = checker.getSymbolAtLocation(n);
      if (n.parent && ts.isShorthandPropertyAssignment(n.parent)) sym = checker.getShorthandAssignmentValueSymbol(n.parent) ?? sym;
      for (const decl of sym?.declarations ?? []) {
        addDecl(decl);
        if (depth < 4 && decl.initializer && !seen.has(decl)) { seen.add(decl); visit(decl.initializer, depth + 1); }
        if (ts.isBindingElement(decl) && ts.isObjectBindingPattern(decl.parent)) {
          const key = decl.propertyName ?? decl.name;
          if (ts.isIdentifier(key)) {
            // the property of the type that is being destructured
            const owner = decl.parent.parent;
            const t = ts.isParameter(owner) || ts.isVariableDeclaration(owner) ? checker.getTypeAtLocation(owner) : undefined;
            for (const d2 of t?.getProperty(key.text)?.declarations ?? []) addDecl(d2);
            if (ts.isParameter(owner) && owner.type) visit(owner.type, depth + 1);
          }
        }
        const fo = decl.parent?.parent;
        if (depth < 4 && fo && (ts.isForOfStatement(fo) || ts.isForInStatement(fo)) && !seen.has(fo)) { seen.add(fo); visit(fo.expression, depth + 1); }
      }
    }
    if (ts.isCallExpression(n) || ts.isNewExpression(n)) addDecl(checker.getResolvedSignature(n)?.declaration);
    if (ts.isTypeReferenceNode(n)) for (const decl of checker.getSymbolAtLocation(n.typeName)?.declarations ?? []) addDecl(decl);
    ts.forEachChild(n, (c) => visit(c, depth));
  };
  visit(top, 0);
  let c = node;
  while (c && !isFnLike(c)) {
    if (ts.isCallExpression(c) || ts.isNewExpression(c)) addDecl(checker.getResolvedSignature(c)?.declaration);
    c = c.parent;
  }
  return hits;
}

console.log(`any-to-unknown: ${totalCands} candidates in ${cands.size} files; strict errors before ${baseSt}`);
apply();
for (let pass = 0; pass < 25; pass++) {
  const errs = errors(nsLs);
  if (!errs.length) break;
  const prog = nsLs.getProgram();
  const spans = new Map([...cands.keys()].map((f) => [f, spansOf(f)]));
  let progress = 0;
  const unblamed = [];
  for (const { file, d } of errs) {
    let hit = false;
    for (const sp of spans.get(file) ?? []) {
      if (d.start !== undefined && d.start >= sp.from && d.start < sp.to) { const e = cands.get(file).list[sp.id]; if (!e.drop) { e.drop = true; hit = true; progress++; } }
    }
    if (hit) continue;
    for (const b of blame(prog, file, d)) {
      for (const sp of spans.get(b.file) ?? []) {
        if (sp.from >= b.from && sp.to <= b.to) { const e = cands.get(b.file).list[sp.id]; if (!e.drop) { e.drop = true; hit = true; progress++; } }
      }
    }
    if (!hit) unblamed.push({ file, d });
  }
  console.log(`  pass ${pass}: ${errs.length} errors, ${progress} replacements undone, ${unblamed.length} unblamed`);
  if (!progress) break;
  apply();
}
// what the blame could not explain: undo replacements in blocks while the error count drops
apply();
let curErrs = errors(nsLs).length;
if (curErrs > 0) {
  const keptList = [];
  for (const [f, c] of cands) for (const e of c.list) if (!e.drop) keptList.push(e);
  for (const bs of [16, 8, 4, 2, 1]) {
    for (let i = 0; i < keptList.length && curErrs > 0; i += bs) {
      const block = keptList.slice(i, i + bs).filter((e) => !e.drop);
      if (!block.length) continue;
      for (const e of block) e.drop = true;
      apply();
      const n = errors(nsLs).length;
      if (n < curErrs) curErrs = n;
      else for (const e of block) e.drop = false;
    }
    console.log(`  block ${bs}: ${curErrs} errors left`);
    if (curErrs === 0) break;
  }
  apply();
}
// strict must not get worse than before: undo blocks while the strict count drops towards the old number
let afterSt = errors(stLs).length;
if (afterSt > baseSt) {
  const keptList2 = [];
  for (const [f, c] of cands) for (const e of c.list) if (!e.drop) keptList2.push(e);
  for (const bs of [32, 16, 8, 4, 2, 1]) {
    for (let i = 0; i < keptList2.length && afterSt > baseSt; i += bs) {
      const block = keptList2.slice(i, i + bs).filter((e) => !e.drop);
      if (!block.length) continue;
      for (const e of block) e.drop = true;
      apply();
      const n = errors(stLs).length;
      if (n < afterSt) afterSt = n;
      else for (const e of block) e.drop = false;
    }
    console.log(`  strict block ${bs}: ${afterSt} strict errors (target ${baseSt})`);
    if (afterSt <= baseSt) break;
  }
  apply();
}
const left = errors(nsLs).length;
const after = errors(stLs).length;
let kept = 0;
for (const c of cands.values()) kept += c.list.filter((e) => !e.drop).length;
console.log(`any-to-unknown: kept ${kept} of ${totalCands}; web errors ${left}; strict errors ${baseSt} -> ${after}`);
if (left > 0 || after > baseSt) { console.log("any-to-unknown: not clean, nothing written"); process.exit(1); }
if (!dry) for (const [f, c] of cands) if (files.get(f).text !== c.before) writeFileSync(f, files.get(f).text);
