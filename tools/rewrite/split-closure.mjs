#!/usr/bin/env node
// split-closure.mjs - split the inner functions of ONE exported factory/closure
// into separate files behind a shared context object, preserving behaviour.
//
//   node tools/rewrite/split-closure.mjs <map.json> [--dry] [--out-dir <dir>] [--root <dir>]
//
// Mapping JSON:
//   {
//     "source": "web/battle.ts",
//     "closure": "createBattle",
//     "ctx": "B",                      // name of the shared context object (auto-renamed if it collides)
//     "targets": { "web/battle/hud.ts": ["drawHud", "layoutHud"], ... }
//   }
//
// What it does (design, followed exactly):
//   * the first statement of the closure body becomes `const B = {};`, then every parameter is
//     copied (`B.canvas = canvas;`) while the parameters themselves stay unchanged;
//   * every closure top-level let/const/var is "shared": its declaration becomes `B.x = init;`
//     in place (or `B.x = undefined;` when uninitialised) and every reference to it in the whole
//     closure - including moved functions - becomes `B.x` (symbol based, locals that shadow it are
//     untouched); parameter references inside MOVED functions become `B.param`, in stayed code they
//     stay unchanged;
//   * each listed inner function declaration moves into its target file inside a factory
//     `export function makeHud(B) { ... return { drawHud, layoutHud }; }`; inside a moved function,
//     calls to functions in the same target stay bare and calls to other closure functions become
//     `B.fn(...)`;
//   * at the top of the closure, right after the parameter copies:
//       Object.assign(B, makeHud(B), ...);
//       Object.assign(B, { stayedFn1, stayedFn2 });   // stayed fns used by moved code
//       const { drawHud, ... } = B;                    // moved fns still called by stayed code
//   * module-level identifiers (imports / top-level decls of the source) used by moved code are
//     imported in the target file (paths always end in .js, top-level decls import from "../x.js");
//     dynamic import()/new URL()/new Worker() path literals are re-pointed at the new folder;
//   * a moved function that uses `this`, `arguments`, is a generator referenced as a value, or
//     assigns to a module-level top-level declaration is kept in the closure with a warning;
//   * the closure's return value and statement order stay identical.
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
let OUT_DIR = null;
{
  const i = args.indexOf("--out-dir");
  if (i >= 0) OUT_DIR = path.resolve(args[i + 1]);
}
const mapFile = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--root" && args[i - 1] !== "--out-dir");
if (!mapFile) {
  console.error("usage: split-closure.mjs <map.json> [--dry] [--out-dir dir] [--root dir]");
  process.exit(2);
}
const DRY = flag("--dry");
const posix = (p) => p.split(path.sep).join("/");
const fail = (m) => { console.error("ERROR: " + m); process.exit(1); };

// ---------- mapping ----------
const map = JSON.parse(fs.readFileSync(path.resolve(ROOT, mapFile), "utf8"));
const SRC_REL = posix(map.source);
const SRC_ABS = path.resolve(ROOT, SRC_REL);
const CLOSURE = map.closure;
if (!CLOSURE) fail("map needs a \"closure\" name");
const targets = {};
for (const [f, names] of Object.entries(map.targets || {})) targets[posix(f)] = names;
const nameToTarget = new Map();
for (const [f, names] of Object.entries(targets)) {
  for (const n of names) {
    if (nameToTarget.has(n)) fail(`name ${n} is listed twice (${nameToTarget.get(n)} and ${f})`);
    nameToTarget.set(n, f);
  }
}
const IMPORT_EXT = ".js";

// ---------- program ----------
const options = {
  allowJs: true, checkJs: false, noResolve: true, noLib: true, types: [],
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, skipLibCheck: true,
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
const lineOf = (n) => sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;

// ---------- helpers ----------
const SK = ts.SyntaxKind;
function hasMod(node, kind) {
  return !!node.modifiers && node.modifiers.some((m) => m.kind === kind);
}
function walk(node, fn) {
  fn(node);
  ts.forEachChild(node, (c) => walk(c, fn));
}
function symOf(id) {
  const p = id.parent;
  if (p && ts.isShorthandPropertyAssignment(p) && p.name === id) return checker.getShorthandAssignmentValueSymbol(p);
  return checker.getSymbolAtLocation(id);
}
function leadStart(node) {
  const cr = ts.getLeadingCommentRanges(text, node.getFullStart());
  return cr && cr.length ? cr[0].pos : node.getStart();
}
function stmtEnd(node) {
  const tr = ts.getTrailingCommentRanges(text, node.getEnd());
  return tr && tr.length ? tr[tr.length - 1].end : node.getEnd();
}
function remEnd(node) {
  let e = stmtEnd(node);
  const m = /^[ \t]*\r?\n(?:[ \t]*\r?\n)*/.exec(text.slice(e));
  return m ? e + m[0].length : e;
}

// ---------- locate the closure ----------
let closureNode = null;
for (const st of sf.statements) {
  if (ts.isFunctionDeclaration(st) && st.name && st.name.text === CLOSURE) closureNode = st;
}
if (!closureNode) fail("no top-level function named " + CLOSURE + " in " + SRC_REL);
if (!closureNode.body || !ts.isBlock(closureNode.body)) fail(CLOSURE + " has no block body");
const body = closureNode.body;
const statements = [...body.statements];

// ---------- ctx name (collision-safe) ----------
const requestedCtx = map.ctx || "B";
let ctx = requestedCtx;
{
  const used = new Set();
  walk(body, (n) => { if (ts.isIdentifier(n)) used.add(n.text); });
  if (used.has(ctx)) {
    let fresh = ctx;
    while (used.has(fresh)) fresh += "$";
    ctx = fresh;
    console.warn(`WARN: ctx name "${requestedCtx}" collides with an identifier inside the closure; using "${ctx}" instead`);
  }
}
const factoryName = (targetRel) => {
  const base = path.basename(targetRel, path.extname(targetRel));
  const cap = base.split(/[^A-Za-z0-9]+/).filter(Boolean).map((s) => s[0].toUpperCase() + s.slice(1)).join("");
  return "make" + (cap || "Target");
};
const targetFactory = new Map();
for (const f of Object.keys(targets)) targetFactory.set(f, factoryName(f));
{
  const seen = new Map();
  for (const [f, fn] of targetFactory) {
    if (seen.has(fn) && seen.get(fn) !== f) fail(`factory name collision: ${f} and ${seen.get(fn)} both want ${fn}; rename one target file`);
    seen.set(fn, f);
  }
}

// ---------- classify body statements ----------
const innerFns = new Map();     // name -> FunctionDeclaration
const sharedVarStmts = [];      // VariableStatement[]
const otherStmts = [];          // everything else (expr, if, for, block, return)
for (const s of statements) {
  if (ts.isFunctionDeclaration(s) && s.name) innerFns.set(s.name.text, s);
  else if (ts.isVariableStatement(s)) sharedVarStmts.push(s);
  else otherStmts.push(s);
}

// ---------- symbol tables ----------
const paramSyms = new Map();    // symbol -> name
for (const p of closureNode.parameters) {
  if (ts.isIdentifier(p.name)) paramSyms.set(checker.getSymbolAtLocation(p.name), p.name.text);
}
const sharedVarSyms = new Map(); // symbol -> name
for (const s of sharedVarStmts) {
  for (const d of s.declarationList.declarations) {
    if (ts.isIdentifier(d.name)) {
      const sym = checker.getSymbolAtLocation(d.name);
      if (sym) sharedVarSyms.set(sym, d.name.text);
    }
  }
}
const fnSymToName = new Map();   // symbol -> name (inner functions)
for (const [name, node] of innerFns) {
  const sym = checker.getSymbolAtLocation(node.name);
  if (sym) fnSymToName.set(sym, name);
}
// module-level imports
const importSyms = new Map();    // symbol -> { spec, kind, imported, local, typeOnly }
for (const st of sf.statements) {
  if (!ts.isImportDeclaration(st)) continue;
  const c = st.importClause;
  const spec = st.moduleSpecifier.text;
  if (!c) continue;
  const tOnly = c.isTypeOnly;
  if (c.name) importSyms.set(checker.getSymbolAtLocation(c.name), { spec, kind: "default", imported: "default", local: c.name.text, typeOnly: tOnly });
  if (c.namedBindings && ts.isNamespaceImport(c.namedBindings))
    importSyms.set(checker.getSymbolAtLocation(c.namedBindings.name), { spec, kind: "ns", imported: "*", local: c.namedBindings.name.text, typeOnly: tOnly });
  else if (c.namedBindings)
    for (const e of c.namedBindings.elements)
      importSyms.set(checker.getSymbolAtLocation(e.name), { spec, kind: "named", imported: (e.propertyName || e.name).text, local: e.name.text, typeOnly: tOnly || e.isTypeOnly });
}
// module-level top-level declarations (functions / vars / classes / types)
// a name counts as exported when it carries `export` OR is listed in an `export { ... }` statement
const exportedViaList = new Set();
for (const st of sf.statements) {
  if (ts.isExportDeclaration(st) && !st.moduleSpecifier && st.exportClause && ts.isNamedExports(st.exportClause)) {
    for (const e of st.exportClause.elements) {
      const sym = checker.getExportSpecifierLocalTargetSymbol(e);
      if (sym) exportedViaList.add(sym);
    }
  }
}
const topDeclSyms = new Map();   // symbol -> { name, typeDecl, exported }
for (const st of sf.statements) {
  const isType = ts.isInterfaceDeclaration(st) || ts.isTypeAliasDeclaration(st);
  if (ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st) || ts.isEnumDeclaration(st) || isType) {
    if (!st.name) continue;
    const sym = checker.getSymbolAtLocation(st.name);
    if (sym) topDeclSyms.set(sym, { name: st.name.text, typeDecl: isType, exported: hasMod(st, SK.ExportKeyword) || exportedViaList.has(sym) });
  } else if (ts.isVariableStatement(st)) {
    for (const d of st.declarationList.declarations) {
      if (!ts.isIdentifier(d.name)) continue;
      const sym = checker.getSymbolAtLocation(d.name);
      if (sym) topDeclSyms.set(sym, { name: d.name.text, typeDecl: false, exported: hasMod(st, SK.ExportKeyword) || exportedViaList.has(sym) });
    }
  }
}

// ---------- decide moved vs stayed ----------
const moved = new Set();        // function names that move
const keptReasons = new Map();  // name -> reason (warn)
const assignedModuleLets = new Set(); // module-level symbols assigned inside the closure (to flag)
function collectAssignTargets(node, set) {
  walk(node, (n) => {
    let e = null;
    if (ts.isBinaryExpression(n) && n.operatorToken.kind >= SK.FirstAssignment && n.operatorToken.kind <= SK.LastAssignment) e = n.left;
    else if ((ts.isPrefixUnaryExpression(n) || ts.isPostfixUnaryExpression(n)) && (n.operator === SK.PlusPlusToken || n.operator === SK.MinusMinusToken)) e = n.operand;
    else if ((ts.isForInStatement(n) || ts.isForOfStatement(n)) && !ts.isVariableDeclarationList(n.initializer)) e = n.initializer;
    if (e) {
      while (ts.isParenthesizedExpression(e)) e = e.expression;
      if (ts.isIdentifier(e)) {
        const sym = symOf(e);
        if (sym) set.add(sym);
      }
    }
  });
}
const moduleAssignedSyms = new Set();
{
  for (const [name, fn] of innerFns) {
    const s = new Set();
    collectAssignTargets(fn.body, s);
    for (const sym of s) if (topDeclSyms.has(sym)) moduleAssignedSyms.add(sym);
  }
}
for (const [name, target] of nameToTarget) {
  const fn = innerFns.get(name);
  if (!fn) { console.warn(`WARN: ${name} is not an inner function of ${CLOSURE}; skipped`); continue; }
  // step 6 safety checks: a moved function must not use `this`, `arguments`,
  // be a generator (referenced as a value), or assign a module-level declaration.
  let reason = null;
  let hasThis = false, hasArgs = false;
  walk(fn.body, (n) => {
    if (n.kind === SK.ThisKeyword) hasThis = true;
    if (ts.isIdentifier(n) && n.text === "arguments") hasArgs = true;
  });
  const assignsModule = [...moduleAssignedSyms].some((sym) => {
    const s = new Set();
    collectAssignTargets(fn.body, s);
    return s.has(sym);
  });
  if (hasThis) reason = "uses `this`";
  else if (hasArgs) reason = "uses `arguments`";
  else if (fn.asteriskToken) reason = "is a generator (kept to avoid value-reference ordering changes)";
  else if (assignsModule) reason = "assigns to a module-level declaration (" + [...moduleAssignedSyms].filter((sym) => { const s = new Set(); collectAssignTargets(fn.body, s); return s.has(sym); }).map((sym) => topDeclSyms.get(sym).name).join(", ") + ")";
  if (reason) {
    keptReasons.set(name, reason);
    console.warn(`WARN: keeping ${name} in the closure: ${reason}`);
    continue;
  }
  moved.add(name);
}

// ---------- cross references: stayed<->moved ----------
function refsOf(node) {
  const out = new Set();
  walk(node, (n) => {
    if (!ts.isIdentifier(n)) return;
    if (isNonRefPosition(n)) return;
    const sym = symOf(n);
    if (sym && fnSymToName.has(sym)) out.add(fnSymToName.get(sym));
  });
  return out;
}
function isNonRefPosition(n) {
  const p = n.parent;
  if (!p) return false;
  if (ts.isPropertyAccessExpression(p) && p.name === n) return true;
  if (ts.isQualifiedName(p) && p.right === n) return true;
  if ((ts.isPropertyAssignment(p) || ts.isMethodDeclaration(p) || ts.isPropertyDeclaration(p) ||
       ts.isPropertySignature(p) || ts.isMethodSignature(p) || ts.isGetAccessor(p) ||
       ts.isSetAccessor(p) || ts.isEnumMember(p) || ts.isModuleDeclaration(p)) && p.name === n) return true;
  if (ts.isBindingElement(p) && p.propertyName === n) return true;
  if (ts.isImportSpecifier(p) || ts.isExportSpecifier(p)) return true;
  if (ts.isImportClause(p) && p.name === n) return true;
  if (ts.isNamespaceImport(p)) return true;
  if (ts.isVariableDeclaration(p) && p.name === n) return true;
  if (ts.isParameter(p) && p.name === n) return true;
  if ((ts.isFunctionDeclaration(p) || ts.isClassDeclaration(p) || ts.isInterfaceDeclaration(p) ||
       ts.isTypeAliasDeclaration(p) || ts.isEnumDeclaration(p) || ts.isEnumMember(p)) && p.name === n) return true;
  if (ts.isCatchClause(p) && p.variableDeclaration && p.variableDeclaration.name === n) return true;
  if (ts.isLabeledStatement(p) && p.label === n) return true;
  if (ts.isTypeParameterDeclaration(p) && p.name === n) return true;
  return false;
}
// stayed fns used by moved code -> Object.assign(B, { ... })
const stayedUsedByMoved = new Set();
for (const [name, fn] of innerFns) {
  if (!moved.has(name)) continue;
  for (const r of refsOf(fn)) if (!moved.has(r)) stayedUsedByMoved.add(r);
}
// moved fns used by stayed code -> const { ... } = B
const movedUsedByStayed = new Set();
{
  const stayedNodes = [...otherStmts];
  for (const [name, fn] of innerFns) if (!moved.has(name)) stayedNodes.push(fn);
  for (const s of sharedVarStmts) for (const d of s.declarationList.declarations) if (d.initializer) stayedNodes.push(d.initializer);
  for (const node of stayedNodes) for (const r of refsOf(node)) if (moved.has(r)) movedUsedByStayed.add(r);
}

// ---------- module-level refs used by moved code ----------
function isTypePos(id, fnNode) {
  for (let a = id.parent; a; a = a.parent) {
    if (ts.isExpressionWithTypeArguments(a)) return true;
    if (ts.isInterfaceDeclaration(a) || ts.isTypeAliasDeclaration(a)) return true;
    if (ts.isTypeNode(a)) return true;
    if (a === fnNode) break;
  }
  return false;
}
const targetNeeds = new Map(); // target -> { imports: Map(sym -> {typeOnly}), decls: Map(sym -> {typeOnly}) }
const needExport = new Set();  // top-decl syms
function needFor(f) { if (!targetNeeds.has(f)) targetNeeds.set(f, { imports: new Map(), decls: new Map() }); return targetNeeds.get(f); }
for (const [name, fn] of innerFns) {
  if (!moved.has(name)) continue;
  const f = nameToTarget.get(name);
  const need = needFor(f);
  walk(fn, (n) => {
    if (!ts.isIdentifier(n)) return;
    if (isNonRefPosition(n)) return;
    const sym = symOf(n);
    if (!sym) return;
    if (sharedVarSyms.has(sym) || paramSyms.has(sym) || fnSymToName.has(sym)) return;
    const tp = isTypePos(n, fn);
    if (importSyms.has(sym)) {
      const prev = need.imports.get(sym);
      need.imports.set(sym, { typeOnly: prev === undefined ? tp : prev.typeOnly && tp });
    } else if (topDeclSyms.has(sym)) {
      const prev = need.decls.get(sym);
      need.decls.set(sym, { typeOnly: prev === undefined ? tp : prev.typeOnly && tp });
      needExport.add(sym);
    }
  });
}

// ---------- reference rewriting ----------
function addRefEdit(sink, id, name) {
  const p = id.parent;
  if (p && ts.isShorthandPropertyAssignment(p) && p.name === id) {
    sink.push({ pos: id.getStart(), end: id.getEnd(), text: `${name}: ${ctx}.${name}` });
  } else {
    sink.push({ pos: id.getStart(), end: id.getEnd(), text: `${ctx}.${name}` });
  }
}
// rewrite references inside `node`; sink receives edits.
// moved mode: params -> B.p, other closure fns (different target / stayed) -> B.fn.
// stayed mode: only shared vars -> B.x.
function rewriteRegion(node, sink, movedMode, targetFile) {
  walk(node, (n) => {
    if (!ts.isIdentifier(n)) return;
    if (isNonRefPosition(n)) return;
    const sym = symOf(n);
    if (!sym) return;
    if (sharedVarSyms.has(sym)) { addRefEdit(sink, n, sharedVarSyms.get(sym)); return; }
    if (movedMode) {
      if (paramSyms.has(sym)) { addRefEdit(sink, n, paramSyms.get(sym)); return; }
      if (fnSymToName.has(sym)) {
        const fnName = fnSymToName.get(sym);
        if (nameToTarget.get(fnName) !== targetFile) addRefEdit(sink, n, fnName);
        return;
      }
    }
  });
}

// ---------- edits ----------
const origEdits = [];          // edits applied to the original file text
// 1. remove moved function declarations
for (const [name, fn] of innerFns) {
  if (!moved.has(name)) continue;
  origEdits.push({ pos: leadStart(fn), end: remEnd(fn), text: "" });
}
// 2. shared var statements -> B.x = init;
for (const s of sharedVarStmts) {
  const lines = [];
  let allIdent = true;
  for (const d of s.declarationList.declarations) if (!ts.isIdentifier(d.name)) allIdent = false;
  if (!allIdent) {
    console.warn(`WARN: destructuring declaration at line ${lineOf(s)} kept as-is; its names are NOT shared`);
    continue; // leave as an ordinary statement; its refs are handled by the stayed walk below
  }
  for (const d of s.declarationList.declarations) {
    const nm = d.name.text;
    let initText = "undefined";
    if (d.initializer) {
      const sink = [];
      rewriteRegion(d.initializer, sink, false, null);
      initText = render(sink, d.initializer.getStart(), d.initializer.getEnd());
    }
    lines.push(`${ctx}.${nm} = ${initText};`);
  }
  const before = text.slice(0, s.getStart());
  const indent = (before.match(/\n([ \t]*)$/) || ["", ""])[1] ?? "";
  origEdits.push({ pos: s.getStart(), end: s.getEnd(), text: lines.join("\n" + indent) });
}
// 3. rewrite stayed statements (other statements + stayed fns)
for (const s of otherStmts) rewriteRegion(s, origEdits, false, null);
for (const [name, fn] of innerFns) {
  if (moved.has(name)) continue;
  rewriteRegion(fn.body, origEdits, false, null);
}

// ---------- render helper (applies edits within [from,to]) ----------
function render(sink, from, to) {
  let out = "";
  let cur = from;
  for (const e of [...sink].sort((a, b) => a.pos - b.pos)) {
    if (e.pos < from || e.end > to) continue;
    out += text.slice(cur, e.pos) + e.text;
    cur = e.end;
  }
  return out + text.slice(cur, to);
}

// ---------- header block ----------
const headerLines = [`const ${ctx} = {};`];
for (const p of closureNode.parameters) {
  if (ts.isIdentifier(p.name)) headerLines.push(`${ctx}.${p.name.text} = ${p.name.text};`);
}
const movedTargets = [...Object.keys(targets)].filter((f) => targets[f].some((n) => moved.has(n)));
if (movedTargets.length) headerLines.push(`Object.assign(${ctx}, ${movedTargets.map((f) => targetFactory.get(f) + `(${ctx})`).join(", ")});`);
if (stayedUsedByMoved.size) {
  const names = [...stayedUsedByMoved].sort();
  headerLines.push(`Object.assign(${ctx}, { ${names.join(", ")} });`);
}
if (movedUsedByStayed.size) {
  const names = [...movedUsedByStayed].sort();
  headerLines.push(`const { ${names.join(", ")} } = ${ctx};`);
}

// ---------- imports for the original (factories + retained top-decl exports) ----------
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
function fmtNamed(items, from, typeAll) {
  const body = items.join(", ");
  const head = `import ${typeAll ? "type " : ""}{ `;
  const line = `${head}${body} } from "${from}";`;
  if (line.length <= 110) return line;
  return `${head.trimEnd()}\n${items.map((i) => "  " + i + ",").join("\n")}\n} from "${from}";`;
}

// ---------- build target files ----------
const targetContent = new Map(); // target -> string
for (const f of Object.keys(targets)) {
  const fnsIn = [];
  for (const name of targets[f]) if (moved.has(name)) fnsIn.push(name);
  if (!fnsIn.length) continue;
  const need = targetNeeds.get(f);
  const impLines = [];
  if (need) {
    // module imports (re-pathed), grouped by spec
    const bySpec = new Map();
    for (const [sym, acc] of need.imports) {
      const info = importSyms.get(sym);
      const spec = respec(info.spec, SRC_ABS, f);
      const effTypeOnly = info.typeOnly || acc.typeOnly;
      if (!bySpec.has(spec)) bySpec.set(spec, []);
      bySpec.get(spec).push({ info: { ...info, typeOnly: effTypeOnly } });
    }
    for (const [spec, list] of bySpec) {
      const def = list.filter((x) => x.info.kind === "default");
      const ns = list.filter((x) => x.info.kind === "ns");
      const named = list.filter((x) => x.info.kind === "named");
      for (const x of def) impLines.push(`import ${x.info.typeOnly ? "type " : ""}${x.info.local} from "${spec}";`);
      for (const x of ns) impLines.push(`import ${x.info.typeOnly ? "type " : ""}* as ${x.info.local} from "${spec}";`);
      if (named.length) {
        const all = named.every((x) => x.info.typeOnly);
        const items = named.map((x) => (x.info.typeOnly && !all ? "type " : "") + (x.info.imported === x.info.local ? x.info.local : `${x.info.imported} as ${x.info.local}`));
        impLines.push(fmtNamed(items, spec, all));
      }
    }
    // top-decl imports from the source file
    if (need.decls.size) {
      const all = [...need.decls.values()].every((v) => v.typeOnly);
      const items = [];
      for (const [sym, v] of need.decls) items.push((v.typeOnly && !all ? "type " : "") + topDeclSyms.get(sym).name);
      impLines.push(fmtNamed(items, specTo(f, SRC_REL), all));
    }
  }
  const parts = [];
  for (const name of fnsIn) {
    const fn = innerFns.get(name);
    const sink = [];
    rewriteRegion(fn.body, sink, true, f);
    // rewrite default parameter values and type-only param references inside the moved fn
    for (const p of fn.parameters) if (p.initializer) rewriteRegion(p.initializer, sink, true, f);
    parts.push(render(sink, leadStart(fn), stmtEnd(fn)));
  }
  const factory = targetFactory.get(f);
  const head = impLines.length ? impLines.join("\n") + "\n\n" : "";
  const content = head + `// moved by tools/rewrite/split-closure.mjs\n` +
    `export function ${factory}(${ctx}) {\n` +
    parts.join("\n") + "\n" +
    `  return { ${fnsIn.join(", ")} };\n` +
    `}\n`;
  targetContent.set(f, content);
}

// ---------- factory imports for the original ----------
const factoryImports = [];
for (const f of movedTargets) {
  factoryImports.push(`import { ${targetFactory.get(f)} } from "${specTo(SRC_REL, f)}";`);
}

// ---------- apply original edits ----------
// header insertion (right before the first statement)
{
  let insertPos, headerText;
  if (statements.length) {
    insertPos = statements[0].getStart();
    const before = text.slice(0, insertPos);
    const m = /\n([ \t]*)$/.exec(before);
    const indent = m ? m[1] : "";
    headerText = headerLines.map((l, i) => (i === 0 ? "" : indent) + l).join("\n") + "\n" + indent;
  } else {
    insertPos = body.getStart();
    headerText = headerLines.join("\n") + "\n";
  }
  origEdits.push({ pos: insertPos, end: insertPos, text: headerText });
}
// factory imports after the last import
{
  const lastImport = [...sf.statements].filter((s) => ts.isImportDeclaration(s)).pop();
  const block = factoryImports.join("\n");
  if (block) {
    if (lastImport) origEdits.push({ pos: lastImport.getEnd(), end: lastImport.getEnd(), text: "\n" + block });
    else origEdits.push({ pos: 0, end: 0, text: block + "\n" });
  }
}
// export top-level decls used by moved code
for (const sym of needExport) {
  const info = topDeclSyms.get(sym);
  if (info.exported) continue;
  // find the node
  let node = null;
  for (const st of sf.statements) {
    if ((ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st) || ts.isEnumDeclaration(st) || ts.isInterfaceDeclaration(st) || ts.isTypeAliasDeclaration(st)) && st.name && st.name.text === info.name) node = st;
    else if (ts.isVariableStatement(st) && st.declarationList.declarations.some((d) => ts.isIdentifier(d.name) && d.name.text === info.name)) node = st;
    if (node) break;
  }
  if (!node) { console.warn(`WARN: could not locate top-level declaration ${info.name} to export`); continue; }
  origEdits.push({ pos: node.getStart(), end: node.getStart(), text: "export " });
}

origEdits.sort((a, b) => b.pos - a.pos || b.end - a.end);
let outText = text;
let lastPos = Infinity;
for (const e of origEdits) {
  if (e.end > lastPos) fail("overlapping edits in the original at " + e.pos);
  outText = outText.slice(0, e.pos) + e.text + outText.slice(e.end);
  lastPos = e.pos;
}

// ---------- write ----------
const lines = (s) => s.split("\n").length - (s.endsWith("\n") ? 1 : 0);
function writeRel(rel, content) {
  const base = OUT_DIR || ROOT;
  const abs = path.resolve(base, rel);
  if (!DRY) {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
}
const beforeLines = lineOf(closureNode.body.getLastToken()) - lineOf(closureNode) + 1;

console.log(`split-closure ${SRC_REL} :: ${CLOSURE}${DRY ? " (dry run)" : ""}`);
console.log(`ctx = ${ctx}${ctx !== requestedCtx ? ` (requested ${requestedCtx})` : ""}`);
console.log(`closure lines before: ${beforeLines}`);
if (!DRY) {
  writeRel(SRC_REL, outText);
  for (const [f, content] of targetContent) writeRel(f, content);
}
let afterClosureLines = beforeLines;
{
  // approximate the closure line count after removal: compute from the rewritten text is hard;
  // report the original minus moved function line spans instead.
  let removed = 0;
  for (const [name, fn] of innerFns) if (moved.has(name)) removed += (lineOf(fn.body.getLastToken()) - lineOf(fn) + 1);
  afterClosureLines = beforeLines - removed;
}
console.log(`closure lines after (approx): ${afterClosureLines}`);
console.log(`functions moved: ${moved.size} / ${innerFns.size}`);
console.log(`shared vars rewritten: ${sharedVarSyms.size}`);
let totalMovedLines = 0;
for (const f of Object.keys(targets)) {
  if (!targetContent.has(f)) continue;
  const movedHere = targets[f].filter((n) => moved.has(n));
  let span = 0;
  for (const n of movedHere) { const fn = innerFns.get(n); span += lineOf(fn.body.getLastToken()) - lineOf(fn) + 1; }
  totalMovedLines += span;
  console.log(`  ${f}: ${lines(targetContent.get(f))} lines, ${movedHere.length} functions (source span ${span})`);
}
console.log(`total source lines moved: ${totalMovedLines} (${(100 * totalMovedLines / beforeLines).toFixed(1)}% of closure)`);
console.log(`stayed fns re-exposed via Object.assign: ${[...stayedUsedByMoved].join(", ") || "(none)"}`);
console.log(`moved fns re-exposed via destructuring: ${[...movedUsedByStayed].join(", ") || "(none)"}`);
console.log(`top-level decls newly exported: ${[...needExport].filter((s) => !topDeclSyms.get(s).exported).map((s) => topDeclSyms.get(s).name).join(", ") || "(none)"}`);
for (const [name, reason] of keptReasons) console.log(`  - kept ${name}: ${reason}`);
if (DRY) console.log("(dry run: nothing written)");
