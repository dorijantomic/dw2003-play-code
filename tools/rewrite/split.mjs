#!/usr/bin/env node
// split.mjs - move top-level declarations of one TS/JS module into new files.
//
//   node tools/rewrite/split.mjs tools/rewrite/maps/<name>.json [--dry] [--force] [--root <dir>]
//
// Mapping JSON:
//   { "source": "web/menu.ts",
//     "targets": { "web/menu/shop-list.ts": ["fnA", "fnB"] },
//     "stateFile": "web/menu/state.ts",   // optional; needed when moved code uses reassigned lets
//     "stateName": "S" }                   // optional, default S
//   ("ext" is accepted but sibling imports always end in ".js": the browser loads the built .js
//    next to every .ts, so a new folder must import "../x.js", never "../x.ts".)
//
// What it does (see PLAN.md): moves the listed declarations (with leading comments), writes the
// imports each new file needs, adds `export` where a moved/kept declaration is used from another
// file, moves reassigned module-level let/var into `export const S = {...}` and rewrites every
// reference to S.name (symbol based, shadowing locals are untouched), keeps non-declaration
// statements in the original, and re-exports from the original everything it exported before.
// Relative paths held in string literals - import("./x.js"), new URL("./x", import.meta.url),
// new Worker("./x") - are re-pointed at the same file from the new location ("../x.js"), because
// the browser resolves them against the module that contains them.
import ts from "typescript";
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
let ROOT = process.cwd();
{
  const i = args.indexOf("--root");
  if (i >= 0) ROOT = path.resolve(args[i + 1]);
}
const mapFile = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--root");
if (!mapFile) {
  console.error("usage: split.mjs <map.json> [--dry] [--force] [--root dir]");
  process.exit(2);
}
const DRY = flag("--dry");
const FORCE = flag("--force");
const fail = (m) => {
  console.error("ERROR: " + m);
  process.exit(1);
};
const posix = (p) => p.split(path.sep).join("/");

// ---------- mapping ----------
const map = JSON.parse(fs.readFileSync(path.resolve(ROOT, mapFile), "utf8"));
const SRC_REL = posix(map.source);
const SRC_ABS = path.resolve(ROOT, SRC_REL);
const STATE_NAME = map.stateName || "S";
const STATE_REL = map.stateFile ? posix(map.stateFile) : null;
const targets = {};
for (const [f, names] of Object.entries(map.targets || {})) targets[posix(f)] = names;
const nameToTarget = new Map();
for (const [f, names] of Object.entries(targets)) {
  for (const n of names) {
    if (nameToTarget.has(n)) fail(`name ${n} is listed twice (${nameToTarget.get(n)} and ${f})`);
    nameToTarget.set(n, f);
  }
}
for (const f of [...Object.keys(targets), ...(STATE_REL ? [STATE_REL] : [])]) {
  if (f === SRC_REL) fail("target equals source: " + f);
  if (fs.existsSync(path.resolve(ROOT, f)) && !FORCE && !DRY) fail(`${f} exists (use --force to overwrite)`);
}

// ---------- program ----------
const options = {
  allowJs: true,
  checkJs: false,
  noResolve: true,
  noLib: true,
  types: [],
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  skipLibCheck: true,
};
const program = ts.createProgram([SRC_ABS], options);
const checker = program.getTypeChecker();
const sf = program.getSourceFile(SRC_ABS);
if (!sf) fail("cannot read " + SRC_ABS);
const text = sf.text;
{
  const syn = program.getSyntacticDiagnostics(sf);
  if (syn.length) fail("source has syntax errors: " + ts.flattenDiagnosticMessageText(syn[0].messageText, "\n"));
}

// ---------- helpers ----------
const SK = ts.SyntaxKind;
function bindingNames(nameNode, out = []) {
  if (ts.isIdentifier(nameNode)) out.push(nameNode);
  else for (const el of nameNode.elements) if (ts.isBindingElement(el)) bindingNames(el.name, out);
  return out;
}
function symOf(id) {
  const p = id.parent;
  if (p && ts.isShorthandPropertyAssignment(p) && p.name === id) return checker.getShorthandAssignmentValueSymbol(p);
  if (p && ts.isExportSpecifier(p) && !p.parent.parent.moduleSpecifier) return checker.getExportSpecifierLocalTargetSymbol(p);
  return checker.getSymbolAtLocation(id);
}
function hasMod(node, kind) {
  return !!node.modifiers && node.modifiers.some((m) => m.kind === kind);
}
function walk(node, fn) {
  fn(node);
  ts.forEachChild(node, (c) => walk(c, fn));
}
const isFnLike = (n) =>
  ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n) ||
  ts.isMethodDeclaration(n) || ts.isGetAccessor(n) || ts.isSetAccessor(n) || ts.isConstructorDeclaration(n);

// ---------- top-level statements ----------
const stmts = [];
for (const node of sf.statements) {
  const s = { node, names: [], decl: false, kind: "other" };
  if (ts.isImportDeclaration(node)) s.kind = "import";
  else if (ts.isExportDeclaration(node) && node.moduleSpecifier) s.kind = "reexport";
  else if (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isEnumDeclaration(node) ||
           ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) {
    if (node.name) {
      s.decl = true;
      s.kind = ts.isFunctionDeclaration(node) ? "function" : ts.isClassDeclaration(node) ? "class" :
        ts.isEnumDeclaration(node) ? "enum" : "type";
      s.names = [node.name];
      if (hasMod(node, SK.DefaultKeyword)) fail(`export default declaration ${node.name.text}: not supported`);
    }
  } else if (ts.isModuleDeclaration(node) && ts.isIdentifier(node.name) && !(node.flags & ts.NodeFlags.GlobalAugmentation)) {
    s.decl = true; s.kind = "namespace"; s.names = [node.name];
  } else if (ts.isVariableStatement(node)) {
    s.decl = true;
    s.kind = "var";
    s.isLet = !!(node.declarationList.flags & (ts.NodeFlags.Let)) ;
    s.isConst = !!(node.declarationList.flags & ts.NodeFlags.Const);
    s.isVarKw = !s.isLet && !s.isConst;
    for (const d of node.declarationList.declarations) bindingNames(d.name, s.names);
  }
  stmts.push(s);
}
const stmtOfNode = new Map(stmts.map((s) => [s.node, s]));

// symbol tables
const declSym = new Map(); // symbol -> stmt (top-level declarations)
const importInfo = new Map(); // alias symbol -> {spec, kind, imported, local, typeOnly, decl}
const nameToStmts = new Map();
for (const s of stmts) {
  for (const id of s.names) {
    const sym = checker.getSymbolAtLocation(id);
    if (sym) declSym.set(sym, s);
    if (!nameToStmts.has(id.text)) nameToStmts.set(id.text, []);
    if (!nameToStmts.get(id.text).includes(s)) nameToStmts.get(id.text).push(s);
  }
  if (s.kind === "import") {
    const n = s.node;
    const c = n.importClause;
    const spec = n.moduleSpecifier.text;
    if (c) {
      const tOnly = c.isTypeOnly;
      if (c.name) importInfo.set(checker.getSymbolAtLocation(c.name), { spec, kind: "default", imported: "default", local: c.name.text, typeOnly: tOnly, stmt: s });
      if (c.namedBindings && ts.isNamespaceImport(c.namedBindings))
        importInfo.set(checker.getSymbolAtLocation(c.namedBindings.name), { spec, kind: "ns", imported: "*", local: c.namedBindings.name.text, typeOnly: tOnly, stmt: s });
      else if (c.namedBindings)
        for (const e of c.namedBindings.elements)
          importInfo.set(checker.getSymbolAtLocation(e.name), { spec, kind: "named", imported: (e.propertyName || e.name).text, local: e.name.text, typeOnly: tOnly || e.isTypeOnly, stmt: s });
    }
  }
}
for (const n of nameToTarget.keys()) if (!nameToStmts.has(n)) fail(`listed name ${n} is not a top-level declaration of ${SRC_REL}`);

// assigned symbols
const assigned = new Set();
function addTargets(e) {
  while (ts.isParenthesizedExpression(e)) e = e.expression;
  if (ts.isIdentifier(e)) { const s = symOf(e); if (s) assigned.add(s); }
  else if (ts.isObjectLiteralExpression(e)) {
    for (const p of e.properties) {
      if (ts.isShorthandPropertyAssignment(p)) { const s = symOf(p.name); if (s) assigned.add(s); }
      else if (ts.isPropertyAssignment(p)) addTargets(p.initializer);
      else if (ts.isSpreadAssignment(p)) addTargets(p.expression);
    }
  } else if (ts.isArrayLiteralExpression(e)) {
    for (const el of e.elements) addTargets(ts.isSpreadElement(el) ? el.expression : el);
  } else if (ts.isBinaryExpression(e) && e.operatorToken.kind === SK.EqualsToken) addTargets(e.left);
}
walk(sf, (n) => {
  if (ts.isBinaryExpression(n) && n.operatorToken.kind >= SK.FirstAssignment && n.operatorToken.kind <= SK.LastAssignment) addTargets(n.left);
  else if ((ts.isPrefixUnaryExpression(n) || ts.isPostfixUnaryExpression(n)) && (n.operator === SK.PlusPlusToken || n.operator === SK.MinusMinusToken)) addTargets(n.operand);
  else if ((ts.isForInStatement(n) || ts.isForOfStatement(n)) && !ts.isVariableDeclarationList(n.initializer)) addTargets(n.initializer);
});

// state statements: let/var whose every name... any name reassigned
for (const s of stmts) {
  if (s.kind !== "var" || s.isConst) continue;
  const syms = s.names.map((id) => checker.getSymbolAtLocation(id));
  const ass = syms.filter((x) => assigned.has(x));
  if (!ass.length) continue;
  s.stateCandidate = true;
  if (ass.length !== syms.length) s.mixedState = true;
}
// ---------- decide which statements move ----------
// file ids: "orig" or a target path or STATE_REL
const ORIG = SRC_REL;
for (const s of stmts) s.file = ORIG;
for (const s of stmts) {
  if (!s.decl) continue;
  const files = new Set(s.names.map((id) => nameToTarget.get(id.text)).filter(Boolean));
  if (files.size > 1) fail(`statement declaring ${s.names.map((i) => i.text).join(", ")} is mapped to different files`);
  if (files.size === 1) {
    if (s.names.some((id) => !nameToTarget.has(id.text))) fail(`statement declares ${s.names.map((i) => i.text).join(", ")} but only some are listed`);
    s.file = [...files][0];
  }
  if (s.stateCandidate && s.mixedState) fail(`let/var statement ${s.names.map((i) => i.text).join(", ")} mixes reassigned and read-only names: split it by hand first`);
}
// state-name collision
if (STATE_REL) {
  let clash = null;
  walk(sf, (n) => { if (ts.isIdentifier(n) && n.text === STATE_NAME && !clash) clash = n; });
  if (clash) fail(`identifier ${STATE_NAME} already used in the source (line ${sf.getLineAndCharacterOfPosition(clash.getStart()).line + 1}); set "stateName" in the mapping`);
}

// references per statement
function isTypePos(id, stmtNode) {
  for (let a = id.parent; a; a = a.parent) {
    if (ts.isExpressionWithTypeArguments(a)) {
      const hc = a.parent;
      if (ts.isHeritageClause(hc) && hc.token === SK.ExtendsKeyword && ts.isClassLike(hc.parent)) return false;
      return true;
    }
    if (ts.isInterfaceDeclaration(a) || ts.isTypeAliasDeclaration(a)) return true;
    if (ts.isTypeNode(a)) return true;
    if (a === stmtNode) break;
  }
  return false;
}
function isLoadTime(id, stmtNode) {
  for (let a = id; a; a = a.parent) {
    if (isFnLike(a)) return false;
    if (ts.isPropertyDeclaration(a) && !hasMod(a, SK.StaticKeyword)) return false;
    if (a === stmtNode) break;
  }
  return true;
}
function collectRefs(s) {
  const refs = [];
  const skipName = s.state ? new Set(s.names) : null;
  walk(s.node, (n) => {
    if (!ts.isIdentifier(n)) return;
    if (skipName && skipName.has(n)) return;
    const p = n.parent;
    // property names / member accesses are not variable references
    if (p && ts.isPropertyAccessExpression(p) && p.name === n) return;
    if (p && ts.isQualifiedName(p) && p.right === n) return;
    if (p && (ts.isPropertyAssignment(p) || ts.isMethodDeclaration(p) || ts.isPropertyDeclaration(p) || ts.isPropertySignature(p) || ts.isMethodSignature(p) || ts.isGetAccessor(p) || ts.isSetAccessor(p) || ts.isEnumMember(p)) && p.name === n) return;
    if (p && ts.isBindingElement(p) && p.propertyName === n) return;
    if (p && ts.isImportSpecifier(p)) return;
    const sym = symOf(n);
    if (!sym) return;
    refs.push({ id: n, sym, typePos: isTypePos(n, s.node), loadTime: isLoadTime(n, s.node) });
  });
  return refs;
}
for (const s of stmts) {
  if (s.kind === "import" || s.kind === "reexport") continue;
  if (ts.isExportDeclaration(s.node) && s.node.moduleSpecifier) continue;
  s.refs = collectRefs(s);
}
// whether an alias/decl was used in the original before the split
const usedBefore = new Set();
for (const s of stmts) if (s.refs) for (const r of s.refs) usedBefore.add(r.sym);

// a reassigned let/var becomes part of the state object when a statement in another file uses it
{
  let changed = true;
  while (changed) {
    changed = false;
    for (const d of stmts) {
      if (!d.stateCandidate || d.state) continue;
      const dsyms = new Set(d.names.map((id) => checker.getSymbolAtLocation(id)));
      const cross = stmts.find((s) => s !== d && s.refs && s.file !== d.file && s.refs.some((r) => dsyms.has(r.sym)));
      if (!cross) continue;
      if (!STATE_REL) fail(`${d.names[0].text} is reassigned and used from another file; the mapping needs "stateFile"`);
      d.file = STATE_REL;
      d.state = true;
      d.refs = collectRefs(d);
      changed = true;
    }
  }
}
const stateSyms = new Map(); // symbol -> name
for (const s of stmts) if (s.state) for (const id of s.names) stateSyms.set(checker.getSymbolAtLocation(id), id.text);
for (const s of stmts) {
  if (!s.state) continue;
  if (s.names.length === 0 || !s.node.declarationList.declarations.every((d) => ts.isIdentifier(d.name))) fail(`state var ${s.names.map((i) => i.text).join(",")}: destructuring declaration not supported`);
  for (const r of s.refs) if (stateSyms.has(r.sym)) fail(`state var initializer of ${s.names.map((i) => i.text).join(",")} reads another state var ${stateSyms.get(r.sym)}: reorder by hand`);
}
// a state var that is exported
const warnings = [];
for (const s of stmts) if (s.state && hasMod(s.node, SK.ExportKeyword)) warnings.push(`exported mutable ${s.names.map((i) => i.text).join(",")} moved into ${STATE_NAME}: importers must use ${STATE_NAME}.name (no re-export possible)`);

// ---------- ext and paths ----------
function detectExt() {
  if (map.ext) return map.ext;
  let js = 0, ts_ = 0;
  for (const s of stmts) if (s.kind === "import" || s.kind === "reexport") {
    const m = s.node.moduleSpecifier.text;
    if (m.startsWith(".")) { if (m.endsWith(".js")) js++; else if (m.endsWith(".ts")) ts_++; }
  }
  if (ts_ > js) return ".ts";
  if (js > ts_) return ".js";
  return path.extname(SRC_REL) === ".ts" ? ".ts" : ".js";
}
const EXT = detectExt();
// imports always name the built .js (tools/rewrite/build-web.mjs writes web/**/x.js next to x.ts).
// A ".ts" specifier in the browser is a 404, so never emit one.
const IMPORT_EXT = ".js";
function specTo(fromRel, toRel) {
  let p = posix(path.relative(path.dirname(fromRel), toRel));
  if (!p.startsWith(".")) p = "./" + p;
  const e = path.extname(p);
  if (e === ".ts" || e === ".js") p = p.slice(0, -e.length) + IMPORT_EXT;
  return p;
}
function respec(spec, fromAbsFile, toRelFile) {
  if (!spec.startsWith(".")) return spec;
  const abs = path.resolve(path.dirname(fromAbsFile), spec);
  let p = posix(path.relative(path.dirname(path.resolve(ROOT, toRelFile)), abs));
  if (!p.startsWith(".")) p = "./" + p;
  if (path.extname(p) === ".ts") p = p.slice(0, -3) + IMPORT_EXT;
  return p;
}
// same, for a path held in a string literal: "?query" and "#hash" are kept
function respecPath(spec, fromAbsFile, toRelFile) {
  const m = /^([^?#]*)([?#].*)?$/.exec(spec);
  const tail = m[2] ?? "";
  const abs = path.resolve(path.dirname(fromAbsFile), m[1]);
  let p = posix(path.relative(path.dirname(path.resolve(ROOT, toRelFile)), abs));
  if (!p.startsWith(".")) p = "./" + p;
  if (path.extname(p) === ".ts") p = p.slice(0, -3) + IMPORT_EXT;
  return p + tail;
}

// ---------- needs per file ----------
const files = [...Object.keys(targets), ...(STATE_REL ? [STATE_REL] : [])];
const needs = new Map(); // file -> {aliases:Set(sym), decls:Map(file->Map(name->typeOnly)), usesState:bool}
const getNeed = (f) => { if (!needs.has(f)) needs.set(f, { aliases: new Set(), decls: new Map() }); return needs.get(f); };
const needExport = new Set(); // stmt
const edges = new Map(); // file -> Set(file)
const loadRisks = [];
const isTypeDecl = (st) => st.kind === "type";
for (const s of stmts) {
  if (!s.refs) continue;
  const f = s.file;
  const need = getNeed(f);
  for (const r of s.refs) {
    if (importInfo.has(r.sym)) { need.aliases.add(r.sym); continue; }
    const d = declSym.get(r.sym);
    if (!d) continue;
    if (stateSyms.has(r.sym)) {
      if (f !== STATE_REL) {
        if (!need.decls.has(STATE_REL)) need.decls.set(STATE_REL, new Map());
        need.decls.get(STATE_REL).set(STATE_NAME, false);
        if (!edges.has(f)) edges.set(f, new Set());
        edges.get(f).add(STATE_REL);
        if (r.loadTime && !r.typePos) loadRisks.push({ from: f, to: STATE_REL, name: STATE_NAME + "." + stateSyms.get(r.sym), kind: "state", line: lineOf(r.id) });
      }
      continue;
    }
    if (d.file === f) continue;
    const nm = r.id.text;
    const realName = d.names.find((x) => checker.getSymbolAtLocation(x) === r.sym)?.text ?? nm;
    if (!need.decls.has(d.file)) need.decls.set(d.file, new Map());
    const prev = need.decls.get(d.file).get(realName);
    need.decls.get(d.file).set(realName, prev === false ? false : isTypeDecl(d));
    if (d.kind !== "type") {
      if (!edges.has(f)) edges.set(f, new Set());
      edges.get(f).add(d.file);
    }
    needExport.add(d);
    if (r.loadTime && !r.typePos && d.kind !== "function" && d.kind !== "type")
      loadRisks.push({ from: f, to: d.file, name: realName, kind: d.kind, line: lineOf(r.id) });
  }
}
function lineOf(n) { return sf.getLineAndCharacterOfPosition(n.getStart()).line + 1; }

// original exports that move: re-export from the original
const reexports = new Map(); // file -> Map(name -> typeOnly)
for (const s of stmts) {
  if (s.file === ORIG || s.state || !s.decl) continue;
  if (hasMod(s.node, SK.ExportKeyword)) {
    if (!reexports.has(s.file)) reexports.set(s.file, new Map());
    for (const id of s.names) reexports.get(s.file).set(id.text, isTypeDecl(s));
  }
  for (const f of []) void f;
}
// edges from orig to new files (imports and re-exports)
for (const [f, nm] of reexports) if ([...nm.values()].some((t) => !t)) {
  if (!edges.has(ORIG)) edges.set(ORIG, new Set());
  edges.get(ORIG).add(f);
}
// moved non-exported decls that the original keeps using are covered by needs. Anything referenced from
// another file must be exported.

// ---------- cycles ----------
const allFiles = [ORIG, ...files];
const reach = new Map();
for (const a of allFiles) {
  const seen = new Set();
  const st = [a];
  while (st.length) {
    const x = st.pop();
    for (const y of edges.get(x) ?? []) if (!seen.has(y)) { seen.add(y); st.push(y); }
  }
  reach.set(a, seen);
}
const cycleNotes = [];
for (const [f, set] of edges) for (const g of set) if (reach.get(g)?.has(f) && allFiles.indexOf(f) < allFiles.indexOf(g)) {
  const names = [];
  const a = needs.get(f)?.decls.get(g), b = needs.get(g)?.decls.get(f);
  cycleNotes.push(`value-import cycle ${f} <-> ${g} (${a ? a.size : 0} names one way, ${b ? b.size : 0} the other)`);
}
for (const r of loadRisks) {
  if (reach.get(r.to)?.has(r.from))
    warnings.push(`load-time use across a cycle: ${r.from} line ${r.line} uses ${r.name} (${r.kind}) from ${r.to}, which imports back; may hit TDZ at load`);
}
const notes = cycleNotes;
// initializers that run code in moved variable statements
const PURE_ROOTS = new Set(["Object", "Array", "Map", "Set", "WeakMap", "WeakSet", "Math", "Number", "String", "Symbol", "RegExp", "Uint8Array", "Uint16Array", "Uint32Array", "Int8Array", "Int16Array", "Int32Array", "Float32Array", "Float64Array", "Boolean", "BigInt", "JSON", "Error"]);
function rootName(e) { while (ts.isPropertyAccessExpression(e) || ts.isElementAccessExpression(e) || ts.isCallExpression(e) || ts.isNewExpression(e) || ts.isParenthesizedExpression(e) || ts.isNonNullExpression(e)) e = e.expression; return ts.isIdentifier(e) ? e.text : null; }
for (const s of stmts) {
  if (s.file === ORIG || s.kind !== "var") continue;
  const calls = [];
  for (const d of s.node.declarationList.declarations) {
    if (!d.initializer) continue;
    walk(d.initializer, (n) => {
      if (!(ts.isCallExpression(n) || ts.isNewExpression(n) || ts.isTaggedTemplateExpression(n))) return;
      for (let a = n.parent; a && a !== d.initializer.parent; a = a.parent) if (isFnLike(a)) return;
      const callee = ts.isTaggedTemplateExpression(n) ? n.tag : n.expression;
      const r = rootName(callee);
      if (r && PURE_ROOTS.has(r)) return;
      calls.push(callee.getText(sf).slice(0, 40));
    });
  }
  if (calls.length) warnings.push(`moved ${s.names.map((i) => i.text).join(",")} runs code in its initializer (${[...new Set(calls)].slice(0, 4).join(", ")}): its run order changed (now when ${s.file} loads)`);
}
// kept top-level statements that are not declarations stay where they are (order kept); nothing to do.

// ---------- text edits ----------
function leadStart(node) {
  const cr = ts.getLeadingCommentRanges(text, node.getFullStart());
  return cr && cr.length ? cr[0].pos : node.getStart();
}
function stmtEnd(node) {
  const tr = ts.getTrailingCommentRanges(text, node.getEnd());
  return tr && tr.length ? tr[tr.length - 1].end : node.getEnd();
}
function remEnd(node) { // end of removal: past trailing comment, newline and following blank lines
  let e = stmtEnd(node);
  const m = /^[ \t]*\r?\n(?:[ \t]*\r?\n)*/.exec(text.slice(e));
  return m ? e + m[0].length : e;
}
const edits = new Map(); // stmt -> [{pos,end,text}]
function addEdit(s, pos, end, t) { if (!edits.has(s)) edits.set(s, []); edits.get(s).push({ pos, end, text: t }); }

// ---------- relative path literals inside moved declarations ----------
// import("./x.js"), new URL("./x", import.meta.url) and new Worker("./x") hold a path that the
// browser resolves against the module the code sits in. Move the code to another folder and the
// path must follow it ("./vendor/engine.js" -> "../vendor/engine.js"), or the built .js asks for a
// file that is not there. Only literal, "./"|"../" paths are handled; anything else is left alone.
const pathRepaths = [];
function pathLiteral(n) {
  if (ts.isCallExpression(n) && n.expression.kind === SK.ImportKeyword && n.arguments.length >= 1) {
    return { arg: n.arguments[0], what: "import()" };
  }
  if (!ts.isNewExpression(n)) return null;
  const callee = n.expression;
  const name = ts.isIdentifier(callee) ? callee.text : null;
  const a = n.arguments ?? [];
  const isMetaUrl = (x) => ts.isPropertyAccessExpression(x) && ts.isMetaProperty(x.expression) &&
    x.expression.keywordToken === SK.ImportKeyword && x.name.text === "url";
  if (name === "URL" && a.length >= 2 && isMetaUrl(a[1])) return { arg: a[0], what: "new URL()" };
  if ((name === "Worker" || name === "SharedWorker") && a.length >= 1) return { arg: a[0], what: `new ${name}()` };
  return null;
}
for (const s of stmts) {
  if (s.file === ORIG || s.kind === "import" || s.kind === "reexport") continue;
  if (ts.isExportDeclaration(s.node)) continue;
  walk(s.node, (n) => {
    const hit = pathLiteral(n);
    if (!hit) return;
    const arg = hit.arg;
    if (!arg || !(ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg))) {
      if (arg && ts.isTemplateExpression(arg))
        warnings.push(`${s.file}: ${hit.what} uses a template path: check it by hand (was relative to ${SRC_REL})`);
      return;
    }
    const spec = arg.text;
    if (!spec.startsWith("./") && !spec.startsWith("../")) return;
    const to = respecPath(spec, SRC_ABS, s.file);
    if (to === spec) return;
    const q = arg.getText(sf)[0] === "'" ? "'" : '"';
    addEdit(s, arg.getStart(), arg.getEnd(), q + to + q);
    pathRepaths.push(`${hit.what} ${spec} -> ${to}   [${s.file}, line ${lineOf(arg)}]`);
  });
}
for (const s of stmts) {
  if (!s.refs || s.state) continue;
  for (const r of s.refs) {
    if (!stateSyms.has(r.sym)) continue;
    const nm = stateSyms.get(r.sym);
    const p = r.id.parent;
    if (p && ts.isExportSpecifier(p)) fail(`export list names state var ${nm}: change it by hand`);
    if (p && ts.isShorthandPropertyAssignment(p) && p.name === r.id) addEdit(s, r.id.getStart(), r.id.getEnd(), `${nm}: ${STATE_NAME}.${nm}`);
    else addEdit(s, r.id.getStart(), r.id.getEnd(), `${STATE_NAME}.${nm}`);
  }
}
for (const d of needExport) {
  if (d.state) continue;
  if (!hasMod(d.node, SK.ExportKeyword)) {
    if (d.node.modifiers && d.node.modifiers.length && ts.isDecorator(d.node.modifiers[0])) fail("decorated declaration needs export by hand: " + d.names[0].text);
    addEdit(d, d.node.getStart(), d.node.getStart(), "export ");
  }
}
function render(s, from, to) {
  let out = "";
  let cur = from;
  for (const e of (edits.get(s) ?? []).filter((e) => e.pos >= from && e.end <= to).sort((a, b) => a.pos - b.pos)) {
    out += text.slice(cur, e.pos) + e.text;
    cur = e.end;
  }
  return out + text.slice(cur, to);
}

// ---------- import line builders ----------
function fmtNamed(items, from, typeAll) {
  const body = items.join(", ");
  const head = `import ${typeAll ? "type " : ""}{ `;
  const line = `${head}${body} } from "${from}";`;
  if (line.length <= 110) return line;
  return `${head.trimEnd()}\n${items.map((i) => "  " + i + ",").join("\n")}\n} from "${from}";`;
}
function buildImports(f) {
  const lines = [];
  const need = needs.get(f);
  if (!need) return lines;
  // original imports (re-pathed), grouped by spec
  const bySpec = new Map();
  for (const sym of f === ORIG ? [] : need.aliases) {
    const info = importInfo.get(sym);
    const to = respec(info.spec, SRC_ABS, f);
    if (!bySpec.has(to)) bySpec.set(to, { def: [], ns: [], named: [] });
    const g = bySpec.get(to);
    if (info.kind === "default") g.def.push(info);
    else if (info.kind === "ns") g.ns.push(info);
    else g.named.push(info);
  }
  const order = [...bySpec.keys()];
  for (const to of order) {
    const g = bySpec.get(to);
    for (const d of g.def) lines.push(`import ${d.typeOnly ? "type " : ""}${d.local} from "${to}";`);
    for (const n of g.ns) lines.push(`import ${n.typeOnly ? "type " : ""}* as ${n.local} from "${to}";`);
    if (g.named.length) {
      const all = g.named.every((x) => x.typeOnly);
      const items = g.named.map((x) => (x.typeOnly && !all ? "type " : "") + (x.imported === x.local ? x.local : `${x.imported} as ${x.local}`));
      lines.push(fmtNamed(items, to, all));
    }
  }
  for (const [g, nm] of need.decls) {
    const names = [...nm.keys()].sort();
    const all = names.every((n) => nm.get(n));
    lines.push(fmtNamed(names.map((n) => (nm.get(n) && !all ? "type " : "") + n), specTo(f, g), all));
  }
  return lines;
}

// ---------- build new files ----------
const out = new Map(); // rel -> content
const moved = new Map(); // file -> [names]
const stateNames = [];
for (const f of Object.keys(targets)) {
  const parts = [];
  const list = [];
  for (const s of stmts) {
    if (s.file !== f) continue;
    const a = leadStart(s.node);
    parts.push(render(s, a, stmtEnd(s.node)).replace(/^\s*\n/, ""));
    for (const id of s.names) list.push(id.text);
  }
  moved.set(f, list);
  const head = buildImports(f).join("\n");
  out.set(f, (head ? head + "\n\n" : "") + parts.join("\n\n") + "\n");
}
if (STATE_REL && stmts.some((s) => s.state)) {
  const entries = [];
  for (const s of stmts) {
    if (!s.state) continue;
    const a = leadStart(s.node);
    const lead = text.slice(a, s.node.getStart()).trim();
    for (const d of s.node.declarationList.declarations) {
      const nm = d.name.text;
      stateNames.push(nm);
      let init = d.initializer ? render(s, d.initializer.getStart(), d.initializer.getEnd()) : "undefined";
      if (d.type) init = `${init} as ${d.type.getText(sf)}`;
      else if (!d.initializer) warnings.push(`state var ${nm} has no initializer and no type: S.${nm} is typed undefined; add a type in the source first`);
      else if (/^(null|\[\]|undefined|\{\})$/.test(d.initializer.getText(sf))) warnings.push(`state var ${nm} = ${d.initializer.getText(sf)} has no type: S.${nm} will be inferred too narrow; add a type in the source first`);
      entries.push((lead ? lead.split("\n").map((l) => "  " + l.trim()).join("\n") + "\n" : "") + `  ${nm}: ${init},`);
    }
  }
  const head = buildImports(STATE_REL).join("\n");
  out.set(STATE_REL, (head ? head + "\n\n" : "") + `export const ${STATE_NAME} = {\n${entries.join("\n")}\n};\n`);
}

// ---------- the original ----------
const origEdits = [];
for (const s of stmts) {
  if (s.file !== ORIG) {
    if (s.kind === "import") continue;
    origEdits.push({ pos: leadStart(s.node), end: remEnd(s.node), text: "" });
  } else for (const e of edits.get(s) ?? []) origEdits.push(e);
}
// prune imports used only by moved code
const usedInKept = new Set();
for (const s of stmts) if (s.file === ORIG && s.refs) for (const r of s.refs) usedInKept.add(r.sym);
const removedImports = new Set();
for (const s of stmts) {
  if (s.kind !== "import" || !s.node.importClause) continue;
  const c = s.node.importClause;
  const keep = (sym) => usedInKept.has(sym) || !usedBefore.has(sym);
  const defKeep = c.name ? keep(checker.getSymbolAtLocation(c.name)) : false;
  let nsKeep = false, named = [];
  if (c.namedBindings && ts.isNamespaceImport(c.namedBindings)) nsKeep = keep(checker.getSymbolAtLocation(c.namedBindings.name));
  else if (c.namedBindings) named = c.namedBindings.elements.filter((e) => keep(checker.getSymbolAtLocation(e.name)));
  const total = (c.name ? 1 : 0) + (c.namedBindings ? (ts.isNamespaceImport(c.namedBindings) ? 1 : c.namedBindings.elements.length) : 0);
  const kept = (defKeep ? 1 : 0) + (nsKeep ? 1 : 0) + named.length;
  if (kept === total) continue;
  const a = s.node.getStart();
  if (kept === 0) { removedImports.add(s); origEdits.push({ pos: leadStart(s.node), end: remEnd(s.node), text: "" }); continue; }
  const spec = s.node.moduleSpecifier.getText(sf);
  const clause = [];
  if (defKeep) clause.push(c.name.text);
  if (nsKeep) clause.push("* as " + c.namedBindings.name.text);
  else if (named.length) clause.push("{ " + named.map((e) => e.getText(sf)).join(", ") + " }");
  const attrs = s.node.attributes ? " " + s.node.attributes.getText(sf) : "";
  origEdits.push({ pos: a, end: s.node.getEnd(), text: `import ${c.isTypeOnly ? "type " : ""}${clause.join(", ")} from ${spec}${attrs};` });
}
// new import + re-export block for the original
{
  const lines = buildImports(ORIG);
  const rx = [];
  for (const [f, nm] of reexports) {
    const names = [...nm.keys()].sort();
    const all = names.every((n) => nm.get(n));
    const items = names.map((n) => (nm.get(n) && !all ? "type " : "") + n);
    const body = items.join(", ");
    const line = `export ${all ? "type " : ""}{ ${body} } from "${specTo(ORIG, f)}";`;
    rx.push(line.length <= 110 ? line : `export ${all ? "type " : ""}{\n${items.map((i) => "  " + i + ",").join("\n")}\n} from "${specTo(ORIG, f)}";`);
  }
  const block = [...lines, ...(rx.length ? ["// moved by tools/rewrite/split.mjs: still exported from here", ...rx] : [])].join("\n");
  if (block) {
    const lastImport = [...stmts].reverse().find((s) => s.kind === "import" && !removedImports.has(s));
    if (lastImport) origEdits.push({ pos: lastImport.node.getEnd(), end: lastImport.node.getEnd(), text: "\n" + block });
    else origEdits.push({ pos: 0, end: 0, text: block + "\n\n" });
  }
}
{
  origEdits.sort((a, b) => b.pos - a.pos || b.end - a.end);
  let t = text;
  let lastPos = Infinity;
  for (const e of origEdits) {
    if (e.end > lastPos) fail("overlapping edits in the original at " + e.pos);
    t = t.slice(0, e.pos) + e.text + t.slice(e.end);
    lastPos = e.pos;
  }
  out.set(ORIG, t);
}

// ---------- write + report ----------
const lines = (s) => s.split("\n").length - (s.endsWith("\n") ? 1 : 0);
console.log(`split ${SRC_REL}${DRY ? " (dry run)" : ""}  ext=${EXT}`);
console.log(`original: ${lines(text)} -> ${lines(out.get(ORIG))} lines`);
let nd = 0;
for (const f of Object.keys(targets)) {
  console.log(`  ${f}: ${lines(out.get(f))} lines, ${moved.get(f).length} declarations`);
  nd += moved.get(f).length;
}
if (STATE_REL && stateNames.length) console.log(`  ${STATE_REL}: ${lines(out.get(STATE_REL))} lines, ${stateNames.length} state vars (${stateNames.join(", ")})`);
console.log(`declarations moved: ${nd}, state vars moved: ${stateNames.length}`);
console.log(`relative path literals repathed: ${pathRepaths.length}`);
for (const r of pathRepaths) console.log("  ~ " + r);
console.log(`cycle notes (function use in cycles is safe in ESM; load-time use is a warning): ${notes.length}`);
for (const w of notes) console.log("  . " + w);
console.log(`warnings: ${warnings.length}`);
for (const w of warnings) console.log("  - " + w);
if (!DRY) {
  for (const [rel, content] of out) {
    const abs = path.resolve(ROOT, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
}
