#!/usr/bin/env node
// type-passes: machine passes that write type annotations only (": T"), judged in one warm checker.
//   --pass callbacks  untyped parameter that the function itself calls (cb(a, b)): type it as
//                     (a: A, b: B) => void from the argument types at those calls. Callers' inline
//                     callbacks then get their parameter types from context.
//   --pass lets       let/var/const whose start value is null / undefined / [] / {} / missing:
//                     type it from what is assigned / pushed / stored into it later.
// Per file: all edits, else edit by edit. A file is kept when its syntax is fine, the non-strict
// check (tsconfig.web.json) has 0 errors in it and its strict error count went down. At round end a
// cross-file non-strict check puts back changed files that break other files. Rounds repeat while the
// strict total drops. Type syntax only: same-js must stay "all same".
//   node tools/rewrite/type-passes.mjs --pass callbacks|lets [--rounds N] [--dry]
import ts from "typescript";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const A = process.argv.slice(2), opt = (k, d) => { const i = A.indexOf(k); return i >= 0 ? A[i + 1] : d; };
const PASS = opt("--pass", "callbacks"), ROUNDS = Number(opt("--rounds", 6)), DRY = A.includes("--dry");
const MAX_LEN = Number(opt("--max-len", 300));
const parse = (n) => ts.getParsedCommandLineOfConfigFile(join(ROOT, n), {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic() {} });
const SC = parse("tsconfig.web.strict.json"), LC = parse("tsconfig.web.json");
const mem = new Map(); let vseq = 1;
const getText = (f) => (mem.has(f) ? mem.get(f).text : existsSync(f) ? readFileSync(f, "utf8") : undefined);
const setText = (f, t) => mem.set(f, { text: t, v: ++vseq });
const host = (cfg) => ({ getScriptFileNames: () => cfg.fileNames, getScriptVersion: (f) => String(mem.get(f)?.v ?? 0),
  getScriptSnapshot: (f) => { const t = getText(f); return t === undefined ? undefined : ts.ScriptSnapshot.fromString(t); },
  getCurrentDirectory: () => ROOT, getCompilationSettings: () => cfg.options, getDefaultLibFileName: (o) => ts.getDefaultLibFilePath(o),
  fileExists: (f) => mem.has(f) || ts.sys.fileExists(f), readFile: getText, readDirectory: ts.sys.readDirectory, directoryExists: ts.sys.directoryExists, getDirectories: ts.sys.getDirectories });
const reg = ts.createDocumentRegistry();
const LS = ts.createLanguageService(host(SC), reg), LL = ts.createLanguageService(host(LC), reg);
const WEB = SC.fileNames.filter((f) => f.includes("/web/") && !f.endsWith(".d.ts"));
const strictN = (f) => LS.getSyntacticDiagnostics(f).length + LS.getSemanticDiagnostics(f).length;
const looseN = (f) => LL.getSyntacticDiagnostics(f).length + LL.getSemanticDiagnostics(f).length;
const total = () => WEB.reduce((s, f) => s + strictN(f), 0);

const F = ts.TypeFlags;
function bad(ck, t, seen = new Set(), d = 0) {
  if (seen.has(t) || d > 6) return false; seen.add(t);
  if (t.flags & (F.Any | F.Never | F.Unknown | F.TypeParameter | F.Index | F.IndexedAccess | F.Conditional | F.Substitution | F.UniqueESSymbol | F.NonPrimitive)) return true;
  if (t.isUnionOrIntersection()) return t.types.some((x) => bad(ck, x, seen, d + 1));
  if (t.flags & F.Object) {
    if (t.objectFlags & ts.ObjectFlags.Reference) for (const a of ck.getTypeArguments(t)) if (bad(ck, a, seen, d + 1)) return true;
    for (const s of t.getCallSignatures()) { for (const p of s.getParameters()) if (bad(ck, ck.getTypeOfSymbol(p), seen, d + 1)) return true; if (bad(ck, s.getReturnType(), seen, d + 1)) return true; }
  }
  return false;
}
const BADTXT = /(?<![\w$.])(any|never|unknown|object|Function)(?![\w$])|\{\s*\}|import\(/;
function show(ck, t, at) {
  t = ck.getBaseTypeOfLiteralType(t);
  if (bad(ck, t)) return null;
  const s = ck.typeToString(t, at, ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope | ts.TypeFormatFlags.UseFullyQualifiedType);
  return s.length > MAX_LEN || BADTXT.test(s) ? null : s;
}
const union = (ss) => { const u = [...new Set(ss.flatMap((s) => (s.includes("=>") ? [s] : s.split(" | "))))]; return u.length > 6 ? null : u.map((x) => (x.includes("=>") && u.length > 1 ? "(" + x + ")" : x)).join(" | "); };
const refsIn = (ck, sym, root) => { const out = []; const v = (n) => { if (ts.isIdentifier(n) && ck.getSymbolAtLocation(n) === sym) out.push(n); ts.forEachChild(n, v); }; v(root); return out; };

// ---- pass: callbacks ----
function collectCallbacks(prog, ck) {
  const edits = new Map();
  for (const f of WEB) {
    const sf = prog.getSourceFile(f); if (!sf) continue;
    const want = new Set(); for (const d of prog.getSemanticDiagnostics(sf)) if (d.code === 7006 && d.start != null) want.add(d.start);
    if (!want.size) continue;
    const visit = (n) => {
      if (ts.isFunctionLike(n) && n.body) {
        for (const p of n.parameters) {
          if (!want.has(p.name.getStart(sf)) || !ts.isIdentifier(p.name) || p.type || p.dotDotDotToken) continue;
          if (ts.isArrowFunction(n) && !/\(/.test(sf.text.slice(n.getStart(sf), p.getStart(sf)))) continue;
          const sym = ck.getSymbolAtLocation(p.name); if (!sym) continue;
          const refs = refsIn(ck, sym, n.body); if (!refs.length) continue;
          const calls = []; let ok = true, usedResult = false, maybeMissing = !!p.initializer || !!p.questionToken;
          for (const r of refs) {
            let x = r, par = r.parent;
            if (ts.isCallExpression(par) && par.expression === x) { calls.push(par); if (!ts.isExpressionStatement(par.parent)) usedResult = true; continue; }
            if (ts.isPrefixUnaryExpression(par) && par.operator === ts.SyntaxKind.ExclamationToken) { maybeMissing = true; continue; }
            if (ts.isIfStatement(par) || (ts.isBinaryExpression(par) && /&&|\|\|/.test(par.operatorToken.getText(sf)) && par.left === x)) { maybeMissing = true; continue; }
            if (ts.isTypeOfExpression(par)) { maybeMissing = true; continue; }
            ok = false; break;
          }
          if (!ok || !calls.length || usedResult) continue;
          const n0 = Math.max(...calls.map((c) => c.arguments.length));
          const cols = []; let fail = false;
          for (let i = 0; i < n0 && !fail; i++) {
            const ts_ = []; let omitted = false;
            for (const c of calls) { const a = c.arguments[i]; if (!a) { omitted = true; continue; } if (ts.isSpreadElement(a)) { fail = true; break; } const s = show(ck, ck.getTypeAtLocation(a), n); if (!s) { fail = true; break; } ts_.push(s); }
            if (fail) break; const u = union(ts_); if (!u) { fail = true; break; }
            const a0 = calls.find((c) => c.arguments[i])?.arguments[i]; let nm = a0 && ts.isIdentifier(a0) ? a0.text : a0 && ts.isPropertyAccessExpression(a0) ? a0.name.text : "a" + i;
            if (cols.some((c) => c.nm === nm) || /^(this|arguments)$/.test(nm)) nm = "a" + i;
            cols.push({ nm, t: u, opt: omitted });
          }
          if (fail) continue;
          let sig = "(" + cols.map((c, i) => c.nm + (c.opt && cols.slice(i).every((d) => d.opt) ? "?" : "") + ": " + c.t).join(", ") + ") => void";
          if (sig.length > MAX_LEN) continue;
          const pos = (p.questionToken ?? p.name).getEnd();
          const txt = p.questionToken || p.initializer ? ": " + sig : maybeMissing ? ": (" + sig + ") | undefined" : ": " + sig;
          (edits.get(f) ?? edits.set(f, []).get(f)).push({ pos, text: txt, what: p.name.text });
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return edits;
}

// ---- pass: lets ----
function collectLets(prog, ck) {
  const edits = new Map();
  for (const f of WEB) {
    const sf = prog.getSourceFile(f); if (!sf) continue;
    const ds = prog.getSemanticDiagnostics(sf); if (!ds.length) continue;
    const visit = (n) => {
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && !n.type && ts.isVariableDeclarationList(n.parent) && !(n.parent.parent && (ts.isForOfStatement(n.parent.parent) || ts.isForInStatement(n.parent.parent)))) {
        const init = n.initializer;
        const kind = !init ? "none" : init.kind === ts.SyntaxKind.NullKeyword ? "null" : ts.isIdentifier(init) && init.text === "undefined" ? "undef" : ts.isArrayLiteralExpression(init) && !init.elements.length ? "arr" : ts.isObjectLiteralExpression(init) && !init.properties.length ? "obj" : null;
        if (kind) {
          const sym = ck.getSymbolAtLocation(n.name);
          const scope = n.parent.parent?.parent ?? sf;
          const refs = sym ? refsIn(ck, sym, ts.isSourceFile(scope) ? sf : scope.parent ?? sf) : [];
          const vals = [], elems = [], keys = new Set(), stored = []; let ok = !!refs.length;
          for (const r of refs) {
            if (r === n.name) continue; const par = r.parent;
            if (ts.isBinaryExpression(par) && par.left === r && par.operatorToken.kind === ts.SyntaxKind.EqualsToken) { const s = show(ck, ck.getTypeAtLocation(par.right), n); if (!s) { ok = false; break; } vals.push(s); continue; }
            if (kind === "arr" && ts.isPropertyAccessExpression(par) && par.expression === r && /^(push|unshift)$/.test(par.name.text) && ts.isCallExpression(par.parent)) { for (const a of par.parent.arguments) { const s = ts.isSpreadElement(a) ? null : show(ck, ck.getTypeAtLocation(a), n); if (!s) { ok = false; break; } elems.push(s); } continue; }
            if (kind === "obj" && ts.isElementAccessExpression(par) && par.expression === r && ts.isBinaryExpression(par.parent) && par.parent.left === par && par.parent.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
              const kt = ck.getBaseTypeOfLiteralType(ck.getTypeAtLocation(par.argumentExpression)); keys.add(kt.flags & F.NumberLike ? "number" : "string");
              const s = show(ck, ck.getTypeAtLocation(par.parent.right), n); if (!s) { ok = false; break; } stored.push(s); continue;
            }
          }
          let ty = null;
          if (ok) {
            if (kind === "arr") { const e = union([...elems, ...vals.filter((v) => v.endsWith("[]")).map((v) => v.slice(0, -2))]); if (e && (elems.length || vals.length)) ty = (e.includes(" | ") || e.includes("=>") ? "(" + e + ")" : e) + "[]"; }
            else if (kind === "obj") { const v = union(stored); if (v && stored.length && !vals.length) ty = "Record<" + (keys.size === 1 ? [...keys][0] : "string") + ", " + v + ">"; }
            else { const v = union(vals); if (v && vals.length) ty = kind === "null" ? v + " | null" : v + " | undefined"; }
          }
          if (ty && ty.length <= MAX_LEN) (edits.get(f) ?? edits.set(f, []).get(f)).push({ pos: n.name.getEnd(), text: ": " + ty, what: n.name.text });
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return edits;
}

const apply = (text, es) => { let out = text; for (const e of [...es].sort((a, b) => b.pos - a.pos)) out = out.slice(0, e.pos) + e.text + out.slice(e.pos); return out; };
function judge(f, text, base) { setText(f, text); if (LS.getSyntacticDiagnostics(f).length) return null; if (looseN(f)) return null; const s = strictN(f); return s < base ? s : null; }

function crossCheck(changed, orig) {
  for (let it = 0; it < 10; it++) {
    const badF = WEB.filter((f) => looseN(f));
    if (!badF.length) return true;
    let rev = 0;
    for (const b of badF) {
      if (changed.has(b)) { setText(b, orig.get(b)); changed.delete(b); rev++; continue; }
      const sf = LL.getProgram().getSourceFile(b);
      for (const st of sf.statements) if (ts.isImportDeclaration(st) || (ts.isExportDeclaration(st) && st.moduleSpecifier)) { const r = ts.resolveModuleName(st.moduleSpecifier.text, b, LC.options, ts.sys).resolvedModule?.resolvedFileName; if (r && changed.has(r)) { setText(r, orig.get(r)); changed.delete(r); rev++; } }
    }
    if (!rev) { // bisect: put back changed files one by one until the bad files are clean
      for (const c of [...changed]) { setText(c, orig.get(c)); changed.delete(c); rev++; if (!badF.some((b) => looseN(b))) break; }
    }
    console.log("  crossCheck: " + badF.length + " files with non-strict errors, put back " + rev);
    if (!rev) return false;
  }
  return false;
}

let t0 = Date.now(), before = total();
console.log("type-passes " + PASS + ": start " + before + " strict errors (" + ((Date.now() - t0) / 1000).toFixed(0) + "s)");
for (let round = 1; round <= ROUNDS; round++) {
  const prog = LS.getProgram(), ck = prog.getTypeChecker();
  const edits = PASS === "lets" ? collectLets(prog, ck) : collectCallbacks(prog, ck);
  let nE = 0; for (const es of edits.values()) nE += es.length;
  const changed = new Set(), orig = new Map(); let kept = 0;
  for (const [f, es] of edits) {
    const text = getText(f); orig.set(f, text); const base = strictN(f);
    let s = judge(f, apply(text, es), base);
    if (s != null) { changed.add(f); kept += es.length; continue; }
    const acc = []; let cur = base;
    for (const e of es) { const s2 = judge(f, apply(text, [...acc, e]), cur); if (s2 != null) { acc.push(e); cur = s2; } }
    if (acc.length) { setText(f, apply(text, acc)); changed.add(f); kept += acc.length; } else setText(f, text);
  }
  crossCheck(changed, orig);
  const now = total();
  console.log("round " + round + ": " + nE + " edits proposed, " + kept + " kept in " + changed.size + " files, strict " + before + " -> " + now + " (" + ((Date.now() - t0) / 1000).toFixed(0) + "s)");
  if (now >= before || !changed.size) { for (const f of changed) setText(f, orig.get(f)); if (now >= before) console.log("  no gain, round undone"); break; }
  if (!DRY) for (const f of changed) writeFileSync(f, getText(f));
  before = now;
}
console.log("type-passes " + PASS + ": end " + before);
