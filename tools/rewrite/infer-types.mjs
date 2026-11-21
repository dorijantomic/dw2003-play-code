#!/usr/bin/env node
// infer-types: machine pass that adds parameter / variable types to web/*.ts using the TypeScript
// language service fix "inferFromUsage" under the strict config (tsconfig.web.strict.json).
// Type syntax only. Kept edits are pure ": Type" insertions (and brand-new imports, written as
// `import type`). Any type that is or contains bare `any` / `never`, an import(...) type, or is
// only null / undefined / {} / object / unknown is rejected, so that parameter stays untyped.
// Parameters of arrow functions written without parentheses are skipped (adding parens would
// change the JS text). A file whose own error count rises is put back; a round that does not
// lower the strict error count is undone.
//
//   node tools/rewrite/infer-types.mjs              # rounds until the count stops dropping
//   node tools/rewrite/infer-types.mjs --rounds 1   # one round
//   node tools/rewrite/infer-types.mjs --dry        # report only, write nothing
//
// After it: node tools/rewrite/same-js.mjs (all same) and npx tsc -p tsconfig.web.json (0 errors).
import ts from "typescript";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = process.argv.slice(2);
const dry = args.includes("--dry");
const ri = args.indexOf("--rounds");
const maxRounds = ri >= 0 ? Number(args[ri + 1]) : 8;
const CFG = resolve(ROOT, "tsconfig.web.strict.json");
// the "untyped" codes the fix handles
const INFER_CODES = new Set([7006, 7005, 7034, 7031, 7008, 7010, 7019, 7016]);
const BAD = /(?<![\w$.])(any|never)(?![\w$])/;
const NAME_ERRORS = new Set([2304, 2552, 2503, 2694, 2724, 2749, 2693]);
const WEAK = /^(null|undefined|null \| undefined|undefined \| null|object|Function|unknown|\{\})$/;
const TYPE_EDIT = /^\??: /;
const IMPORT_LINE = /^import \{[^}]*\} from "[^"]+";?\r?\n?$/;

const cfgFile = ts.readConfigFile(CFG, ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(cfgFile.config, ts.sys, ROOT);
const files = new Map(); // fileName -> { version, text }
for (const f of parsed.fileNames) files.set(f, { version: 0, text: null });
const host = {
  getCompilationSettings: () => parsed.options,
  getScriptFileNames: () => [...files.keys()],
  getScriptVersion: (f) => String(files.get(f)?.version ?? 0),
  getScriptSnapshot: (f) => {
    const e = files.get(f);
    const text = e ? (e.text ??= readFileSync(f, "utf8")) : ts.sys.readFile(f);
    return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text);
  },
  getCurrentDirectory: () => ROOT,
  getDefaultLibFileName: (o) => ts.getDefaultLibFilePath(o),
  fileExists: ts.sys.fileExists,
  readFile: ts.sys.readFile,
  readDirectory: ts.sys.readDirectory,
  directoryExists: ts.sys.directoryExists,
  getDirectories: ts.sys.getDirectories,
};
const ls = ts.createLanguageService(host, ts.createDocumentRegistry());

function countErrors() {
  const prog = ls.getProgram();
  let n = 0;
  const per = new Map();
  for (const sf of prog.getSourceFiles()) {
    if (!files.has(sf.fileName)) continue;
    const d = prog.getSemanticDiagnostics(sf).length + prog.getSyntacticDiagnostics(sf).length;
    if (d) { per.set(sf.fileName, d); n += d; }
  }
  return { n, per };
}

const fmt = ts.getDefaultFormatCodeSettings("\n");
const prefs = { includeCompletionsForModuleExports: false };
const setText = (f, t) => { const e = files.get(f); e.text = t; e.version++; };

// is this insertion at p the name end of a parameter of an arrow function written without parens?
function bareArrowParam(sf, p) {
  let found = false;
  const visit = (n) => {
    if (found || n.end < p || n.pos > p) return;
    if (ts.isParameter(n) && n.name.end === p && ts.isArrowFunction(n.parent)) {
      found = !n.parent.getChildren(sf).some((c) => c.kind === ts.SyntaxKind.OpenParenToken);
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return found;
}

function collectEdits() {
  const prog = ls.getProgram();
  const out = new Map(); // fileName -> [{start,end,text,id}]
  const stat = { rejected: 0, bare: 0, imports: 0 };
  for (const sf of prog.getSourceFiles()) {
    if (!files.has(sf.fileName)) continue;
    const diags = ls.getSemanticDiagnostics(sf.fileName).filter((d) => INFER_CODES.has(d.code));
    if (!diags.length) continue;
    let fix;
    try {
      fix = ls.getCombinedCodeFix({ type: "file", fileName: sf.fileName }, "inferFromUsage", fmt, prefs);
    } catch (e) { console.log(`  skip ${sf.fileName}: ${e.message}`); continue; }
    const list = [];
    for (const ch of fix.changes) {
      if (ch.fileName !== sf.fileName) continue;
      for (const t of ch.textChanges) {
        const start = t.span.start, end = start + t.span.length;
        const txt = t.newText;
        if (t.span.length === 0 && TYPE_EDIT.test(txt)) {
          const ty = txt.replace(TYPE_EDIT, "");
          if (BAD.test(ty) || /import\(/.test(ty) || WEAK.test(ty.trim()) || /\n/.test(ty)) { stat.rejected++; continue; }
          if (bareArrowParam(sf, start)) { stat.bare++; continue; }
          list.push({ start, end, text: txt, id: list.length });
        } else if (t.span.length === 0 && IMPORT_LINE.test(txt) && !BAD.test(txt)) {
          list.push({ start, end, text: txt.replace(/^import \{/, "import type {"), id: list.length, imp: true });
          stat.imports++;
        } else stat.rejected++;
      }
    }
    if (list.length) out.set(sf.fileName, list);
  }
  return { out, stat };
}

// apply edits (non-overlapping), return new text and where each edit landed
function applyEdits(text, list) {
  list = [...list].sort((a, b) => a.start - b.start || a.end - b.end);
  let res = "", pos = 0, shift = 0;
  const spans = [];
  for (const e of list) {
    if (e.start < pos) continue;
    res += text.slice(pos, e.start) + e.text;
    spans.push({ id: e.id, from: e.start + shift, to: e.start + shift + e.text.length, imp: e.imp });
    shift += e.text.length - (e.end - e.start);
    pos = e.end;
  }
  res += text.slice(pos);
  return { text: res, spans };
}

// ---- second checker: the real (non-strict) config must stay at 0 errors ----
const nsCfg = ts.parseJsonConfigFileContent(ts.readConfigFile(resolve(ROOT, "tsconfig.web.json"), ts.sys.readFile).config, ts.sys, ROOT);
const nsHost = { ...host, getCompilationSettings: () => nsCfg.options };
const nsLs = ts.createLanguageService(nsHost, ts.createDocumentRegistry());

function nsErrors() {
  const prog = nsLs.getProgram();
  const out = [];
  for (const sf of prog.getSourceFiles()) {
    if (!files.has(sf.fileName)) continue;
    for (const d of [...prog.getSyntacticDiagnostics(sf), ...prog.getSemanticDiagnostics(sf)]) out.push({ file: sf.fileName, d });
  }
  return out;
}

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

// which "name end" positions (file + position) hold an edit that may be to blame for error `d`?
function blame(prog, file, d) {
  const sf = prog.getSourceFile(file);
  const checker = prog.getTypeChecker();
  const hits = [];
  if (!sf || d.start === undefined) return hits;
  const node = innermost(sf, d.start, d.start + (d.length ?? 0));
  let top = node;
  for (let i = 0; i < 3 && top.parent && !ts.isStatement(top.parent) && !isFnLike(top.parent); i++) top = top.parent;
  const addDecl = (decl) => {
    if (decl && decl.name && decl.getSourceFile()) hits.push({ file: decl.getSourceFile().fileName, at: decl.name.end });
    for (const p of decl?.parameters ?? decl?.initializer?.parameters ?? []) if (p.name) hits.push({ file: p.getSourceFile().fileName, at: p.name.end });
  };
  const seen = new Set();
  const visit = (n, depth) => {
    if (ts.isIdentifier(n)) {
      const sym = checker.getSymbolAtLocation(n);
      for (const decl of sym?.declarations ?? []) {
        addDecl(decl);
        if (depth < 4 && decl.initializer && !seen.has(decl)) { seen.add(decl); visit(decl.initializer, depth + 1); }
        const fo = decl.parent?.parent;
        if (depth < 4 && fo && (ts.isForOfStatement(fo) || ts.isForInStatement(fo)) && !seen.has(fo)) { seen.add(fo); visit(fo.expression, depth + 1); }
      }
      if (ts.isShorthandPropertyAssignment(n.parent)) {
        const vs = checker.getShorthandAssignmentValueSymbol(n.parent);
        for (const decl of vs?.declarations ?? []) addDecl(decl);
      }
    }
    if (ts.isCallExpression(n) || ts.isNewExpression(n)) {
      const sig = checker.getResolvedSignature(n);
      for (const p of sig?.declaration?.parameters ?? []) addDecl(p);
    }
    ts.forEachChild(n, (c) => visit(c, depth));
  };
  visit(top, 0);
  // a call: the callee's parameters
  let c = node;
  while (c && !isFnLike(c)) {
    if (ts.isCallExpression(c) || ts.isNewExpression(c)) {
      const sig = checker.getResolvedSignature(c);
      for (const p of sig?.declaration?.parameters ?? []) addDecl(p);
      const sym = checker.getSymbolAtLocation(c.expression);
      for (const decl of sym?.declarations ?? []) {
        for (const p of decl.parameters ?? decl.initializer?.parameters ?? []) addDecl(p);
        if (decl.type === undefined) addDecl(decl);
      }
    }
    c = c.parent;
  }
  return hits;
}

console.log(`infer-types: web config baseline errors ${nsErrors().length}`);
let cur = countErrors();
console.log(`infer-types: start ${cur.n} strict errors`);
for (let round = 1; round <= maxRounds; round++) {
  const { out, stat } = collectEdits();
  const plan = new Map(); // file -> { before, list, drop:Set, spans }
  for (const [f, list] of out) {
    const before = (files.get(f).text ??= readFileSync(f, "utf8"));
    plan.set(f, { before, list, drop: new Set(), spans: [] });
  }
  const applyAll = () => {
    for (const [f, p] of plan) {
      const r = applyEdits(p.before, p.list.filter((e) => !p.drop.has(e.id)));
      p.spans = r.spans;
      setText(f, r.text);
    }
  };
  let unblamed = 0;
  applyAll();
  {
    const now = countErrors();
    for (const [f, p] of plan) if ((now.per.get(f) ?? 0) > (cur.per.get(f) ?? 0)) for (const e of p.list) p.drop.add(e.id);
  }
  for (let pass = 0; pass < 10; pass++) {
    applyAll();
    const errs = nsErrors();
    if (!errs.length) break;
    const prog = nsLs.getProgram();
    let progress = 0;
    for (const { file, d } of errs) {
      let hit = false;
      const p = plan.get(file);
      if (p) for (const sp of p.spans) if (d.start !== undefined && d.start >= sp.from && d.start < sp.to && !p.drop.has(sp.id)) { p.drop.add(sp.id); hit = true; progress++; }
      if (hit) continue;
      for (const b of blame(prog, file, d)) {
        const bp = plan.get(b.file);
        if (!bp) continue;
        for (const sp of bp.spans) if (sp.from === b.at && !bp.drop.has(sp.id)) { bp.drop.add(sp.id); hit = true; progress++; }
      }
      if (!hit) unblamed++;
    }
    if (!progress) {
      // last resort: put whole files with errors back
      const prog2 = nsLs.getProgram();
      for (const { file } of errs) {
        const sfE = prog2.getSourceFile(file);
        const names = [file];
        for (const imp of sfE?.imports ?? []) {
          const df = prog2.getTypeChecker().getSymbolAtLocation(imp)?.declarations?.[0]?.getSourceFile().fileName;
          if (df) names.push(df);
        }
        for (const nme of names) { const q = plan.get(nme); if (q) for (const e of q.list) q.drop.add(e.id); }
      }
      applyAll();
      break;
    }
  }
  applyAll();
  const left = nsErrors();
  if (left.length) {
    // still dirty: put back every plan file that has an error, then every plan file that blame points at
    for (const { file } of left) { const q = plan.get(file); if (q) for (const e of q.list) q.drop.add(e.id); }
    applyAll();
  }
  const finalLeft = nsErrors().length;
  const backup = new Map();
  let applied = 0, droppedN = 0;
  for (const [f, p] of plan) {
    droppedN += p.drop.size;
    if (files.get(f).text !== p.before) { backup.set(f, p.before); applied += p.spans.filter((s) => !p.drop.has(s.id)).length; }
  }
  let next = countErrors();
  let worse = 0;
  for (const [f, before] of [...backup]) {
    if ((next.per.get(f) ?? 0) > (cur.per.get(f) ?? 0)) { setText(f, before); backup.delete(f); worse++; }
  }
  if (worse) next = countErrors();
  const nsNow = nsErrors().length;
  console.log(`infer-types: round ${round}: ${applied} edits in ${backup.size} files (${stat.rejected} rejected, ${stat.bare} bare-arrow skipped, ${droppedN} dropped by blame, ${worse} files put back), web errors ${nsNow}, strict ${cur.n} -> ${next.n}`);
  if (nsNow > 0) for (const { file, d } of nsErrors().slice(0, 12)) console.log('   web error', file.replace(ROOT, ''), d.start, ts.flattenDiagnosticMessageText(d.messageText, ' ').slice(0, 140));
  if (next.n >= cur.n || backup.size === 0 || nsNow > 0) {
    for (const [f, t] of backup) setText(f, t);
    console.log("infer-types: no gain or web config not clean, round undone, stopping");
    break;
  }
  cur = next;
  if (!dry) for (const f of backup.keys()) writeFileSync(f, files.get(f).text);
  if (dry) break;
}
console.log(`infer-types: end ${cur.n} strict errors`);
