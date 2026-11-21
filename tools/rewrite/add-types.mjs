#!/usr/bin/env node
// add-types.mjs: the mechanical type pass over the converted web tree.
//
// Everything this writes is TYPE SYNTAX, erased again by node's strip mode, so the shipped .js
// stays token-identical (tools/rewrite/same-js.mjs proves it). Three passes:
//
//   objects  a value created empty (or as a literal) and filled in later gets an interface with
//            every property the code puts on it, plus `as ThatInterface` on the literal. Factory
//            parameters that receive the same object get the interface too ("import type").
//   class    `this.x = ...` with no field declaration gets `declare x: T;` at the top of the
//            class body. `declare` fields are erased; a field WITHOUT declare would create the
//            property at construction time and change behaviour, so that is never written.
//   globals  window.X / globalThis.X live in one ambient file, web/types/globals.d.ts.
//
// Property types are the checker's own widened type of the assigned expressions (a union when
// several). A property the object already has in its literal is required; one that only appears
// later is optional, because it really is absent until then. A type text that would not survive on
// its own — longer than 100 chars, an inferred import(), an empty object, or a name that does not
// resolve where the declaration lands — is written as `any`: the property is known, its type is
// not guessed.
//
//   node tools/rewrite/add-types.mjs --dry            # summary only, nothing written
//   node tools/rewrite/add-types.mjs                  # apply
//   node tools/rewrite/add-types.mjs --only=objects   # one pass (objects | class | globals)
//   node tools/rewrite/add-types.mjs --list           # every root, then every file it touches
//   node tools/rewrite/add-types.mjs --write-names    # record a name for every root in type-names.json
//
// Interface names come from tools/rewrite/type-names.json: { "web/battle.ts:B": "BattleContext" }.
// A root without an entry falls back to a generated name and is listed as auto-named.
//
// Run it twice: a second pass is expected (a parameter typed in pass 1 could reveal writes in
// pass 2). On the converted tree it is a no-op — the checker already knows every assignment — and
// that no-op is the proof that the pass is stable and re-runnable.
import ts from "typescript";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

const ROOT = process.cwd();
const POSIX = (p) => p.split(sep).join("/");
const rel = (absPath) => POSIX(relative(ROOT, absPath));
const abs = (r) => join(ROOT, r);

const argv = process.argv.slice(2);
const dry = argv.includes("--dry");
const list = argv.includes("--list");
const verbose = argv.includes("--verbose");
const writeNames = argv.includes("--write-names");
let only = null;
let namesPath = "tools/rewrite/type-names.json";
for (const a of argv) {
  if (a.startsWith("--only=")) only = a.slice(7);
  else if (a.startsWith("--names=")) namesPath = a.slice(8);
}
const want = (pass) => !only || only === pass;

// ─────────────────────────────────────────────── project ───────────────────────────────────────
const configPath = resolve(ROOT, "tsconfig.web.json");
const cfg = ts.readConfigFile(configPath, ts.sys.readFile);
if (cfg.error) {
  console.error(ts.flattenDiagnosticMessageText(cfg.error.messageText, "\n"));
  process.exit(2);
}
const parsed = ts.parseJsonConfigFileContent(cfg.config, ts.sys, dirname(configPath));
const program = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options });
const checker = program.getTypeChecker();

const webFiles = program.getSourceFiles()
  .filter((sf) => !sf.isDeclarationFile && rel(sf.fileName).startsWith("web/") && /\.(ts|mts)$/.test(sf.fileName))
  .sort((a, b) => rel(a.fileName).localeCompare(rel(b.fileName)));
const webSet = new Set(webFiles);

const names = existsSync(abs(namesPath)) ? JSON.parse(readFileSync(abs(namesPath), "utf8")) : {};

// ───────────────────────────────────────────────────── symbols ─────────────────────────────────
const symIds = new Map();
let symNext = 0;
function sid(sym) {
  if (!sym) return 0;
  let id = symIds.get(sym);
  if (id === undefined) {
    id = ++symNext;
    symIds.set(sym, id);
  }
  return id;
}
function deref(sym) {
  let guard = 0;
  while (sym && sym.flags & ts.SymbolFlags.Alias && guard++ < 16) {
    const next = checker.getAliasedSymbol(sym);
    if (!next || next === sym) break;
    sym = next;
  }
  return sym;
}
const symAt = (node) => (node ? deref(checker.getSymbolAtLocation(node)) : undefined);

function enclosingClass(node) {
  for (let n = node.parent; n; n = n.parent) {
    if (ts.isClassDeclaration(n) || ts.isClassExpression(n)) return n;
  }
  return null;
}
function unwrap(node) {
  let n = node;
  for (;;) {
    if (!n) return n;
    if (ts.isParenthesizedExpression(n) || ts.isAsExpression(n) || ts.isNonNullExpression(n) ||
        ts.isTypeAssertionExpression(n) || (ts.isSatisfiesExpression && ts.isSatisfiesExpression(n))) {
      n = n.expression;
      continue;
    }
    return n;
  }
}
const isAssignmentOp = (kind) => kind >= ts.SyntaxKind.FirstAssignment && kind <= ts.SyntaxKind.LastAssignment;
const isArithmeticAssign = (kind) =>
  kind === ts.SyntaxKind.PlusEqualsToken || kind === ts.SyntaxKind.MinusEqualsToken ||
  kind === ts.SyntaxKind.AsteriskEqualsToken || kind === ts.SyntaxKind.SlashEqualsToken ||
  kind === ts.SyntaxKind.PercentEqualsToken;

// A property path: "sym#12", "sym#12.player", "this#7.gain". Only identifiers, `this`, static
// property names and string keys take part; anything else (a call, an index by variable) has no
// stable identity and returns null.
function pathOf(expr) {
  const e = unwrap(expr);
  if (!e) return null;
  if (ts.isIdentifier(e)) {
    const s = symAt(e);
    return s ? "sym#" + sid(s) : null;
  }
  if (e.kind === ts.SyntaxKind.ThisKeyword) {
    const c = enclosingClass(e);
    if (!c) return null;
    const s = c.name ? symAt(c.name) : undefined;
    return "this#" + (s ? sid(s) : "anon" + c.pos);
  }
  if (ts.isPropertyAccessExpression(e)) {
    const base = pathOf(e.expression);
    return base ? base + "." + e.name.text : null;
  }
  if (ts.isElementAccessExpression(e)) {
    const a = unwrap(e.argumentExpression);
    if (a && (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a))) {
      const base = pathOf(e.expression);
      return base ? base + "." + a.text : null;
    }
  }
  return null;
}

// ─────────────────────────────────────────────── type text ─────────────────────────────────────
// Names that resolve wherever a generated declaration can land: the ECMAScript/DOM lib files.
const libNames = new Set();
for (const sf of program.getSourceFiles()) {
  const p = POSIX(sf.fileName);
  if (!sf.isDeclarationFile) continue;
  if (!(sf.hasNoDefaultLib || p.includes("typescript/lib/") || p.includes("/node_modules/typescript/"))) continue;
  for (const st of sf.statements) {
    if (st.name && ts.isIdentifier(st.name)) libNames.add(st.name.text);
    if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) if (ts.isIdentifier(d.name)) libNames.add(d.name.text);
    }
  }
}
const BUILTIN = new Set(["any", "unknown", "never", "void", "null", "undefined", "string", "number",
  "boolean", "object", "symbol", "bigint", "true", "false", "this", "Array"]);

const widenText = (text) => {
  if (/^".*"$/.test(text) || /^'.*'$/.test(text)) return "string";
  if (/^-?\d+(\.\d+)?$/.test(text)) return "number";
  if (text === "true" || text === "false") return "boolean";
  // a value that is only ever null/undefined says nothing about the property
  if (text === "null" || text === "undefined" || text === "void") return "";
  return text;
};

// A literal type printed inside an inline object type is just as specialised as one printed on its
// own, and assigning the next value to it would fail: widen those too ({ a: 0 } -> { a: number }).
function widenInline(text) {
  return text
    .replace(/(:\s*)(true|false)(?=\s*[;,}]|$)/g, "$1boolean")
    .replace(/(:\s*)(-?\d+(?:\.\d+)?)(?=\s*[;,}]|$)/g, "$1number")
    .replace(/(:\s*)("[^"]*"|'[^']*')(?=\s*[;,}]|$)/g, "$1string");
}

const usable = (text) => {
  if (!text || text === "{}" || text === "any") return false;
  if (text.length > 100 || text.includes("import(")) return false;
  // the checker prints a destructured parameter's type as `?: {}`, which is not a type at all
  if (/\?\s*:\s*\{\s*\}/.test(text)) return false;
  return true;
};

// `allowed` holds the extra names that resolve where this text will be written.
function textOfType(type, node, allowed) {
  if (!type) return "any";
  let widened;
  try {
    widened = checker.getWidenedType(type);
  } catch {
    widened = type;
  }
  let text;
  try {
    text = checker.typeToString(widened, node, ts.TypeFormatFlags.NoTruncation);
  } catch {
    return "any";
  }
  text = widenInline(widenText(`${text}`.trim()));
  if (text === "") return ""; // null/undefined only: no information
  if (!usable(text)) return "any";
  // Every capitalized word has to resolve where the declaration lands, else the new annotation
  // would itself be an error (or worse, silently bind to another module's type).
  for (const word of text.match(/[A-Za-z_$][\w$]*/g) ?? []) {
    if (!/^[A-Z]/.test(word)) continue;
    if (BUILTIN.has(word) || libNames.has(word) || allowed.has(word)) continue;
    return "any";
  }
  return text;
}
const typeText = (node, allowed) => {
  if (!node) return "any";
  try {
    return textOfType(checker.getTypeAtLocation(node), node, allowed);
  } catch {
    return "any";
  }
};
const union = (texts) => {
  const seen = [];
  for (const raw of texts) {
    if (!raw) continue; // no information (null/undefined only)
    if (raw === "any") return "any";
    for (const part of raw.split(" | ")) {
      const t = widenText(part.trim());
      if (!t) continue;
      if (!seen.includes(t)) seen.push(t);
    }
  }
  if (!seen.length) return "any";
  // Two different call signatures for the same property cannot be called at all; the object is
  // really `any`-typed there, and a union of functions would only produce noise at every call site.
  if (seen.length > 1 && seen.some((s) => s.includes("=>"))) return "any";
  const text = seen.join(" | ");
  if (!usable(text)) return "any";
  return text;
};

const isIdentifierName = (n) => /^[A-Za-z_$][\w$]*$/.test(n);
const propKey = (n) => (isIdentifierName(n) ? n : JSON.stringify(n));

// ──────────────────────────────────────────── collection ───────────────────────────────────────
const creates = new Map(); // rootKey -> { key, file, init, node, nameNode }
const writes = [];         // { key, prop, rhs, op, file, node }
const assignCalls = [];    // { key, srcs, file, node }
const calls = [];          // { node, file }
const winAccess = [];      // { name, how, kind, rhs, file, node }
const destructures = [];   // { key, names, file }
const classes = [];        // { node, file }

const WINDOW_HEADS = new Set(["window", "globalThis", "self", "top"]);

function isWindowHead(node) {
  const e = unwrap(node);
  if (!e || !ts.isIdentifier(e) || !WINDOW_HEADS.has(e.text)) return false;
  const s = symAt(e);
  if (!s) return true;
  // shadowed by a local of the same name: leave it alone
  const decl = s.declarations?.[0];
  return !decl || decl.getSourceFile().isDeclarationFile;
}

function propName(node) {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  const a = unwrap(node.argumentExpression);
  if (a && (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a))) return a.text;
  return null;
}

function addWindow(access, kind, rhs, file, node) {
  const name = propName(access);
  if (name === null) return;
  const head = unwrap(access.expression);
  const how = head.text === "globalThis" ? "globalThis" : "window";
  winAccess.push({ name, how, kind, rhs, file, node });
}

function remember(c) {
  if (!c.key) return;
  if (!c.label) c.label = c.nameNode && ts.isIdentifier(c.nameNode) ? c.nameNode.text : safeText(c.nameNode);
  const prev = creates.get(c.key);
  if (!prev) creates.set(c.key, c);
  else if (prev.node.kind === ts.SyntaxKind.BinaryExpression && c.node.kind === ts.SyntaxKind.VariableDeclaration) {
    creates.set(c.key, c);
  }
}

// Position of the first template literal with a `${}` substitution in each file. Node's strip mode
// and tools/rewrite/erase-types.mjs disagree about where such a literal ends, and a parameter
// annotation placed after one comes back erased together with the code in between (the tests read
// the sources through erase-types), so parameters after one are left untyped. See the report.
const firstTemplate = new Map(); // fileAbs -> start of the first `${}` template

function visit(node, file) {
  if (ts.isTemplateExpression(node)) {
    const at = firstTemplate.get(file.fileName);
    if (at === undefined || node.getStart() < at) firstTemplate.set(file.fileName, node.getStart());
  }
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
    remember({ key: pathOf(node.name), file, init: unwrap(node.initializer), node, nameNode: node.name, label: node.name.text });
  }
  if (ts.isBinaryExpression(node) && isAssignmentOp(node.operatorToken.kind)) {
    const left = unwrap(node.left);
    if (ts.isIdentifier(left) && ts.isObjectLiteralExpression(unwrap(node.right))) {
      remember({ key: pathOf(left), file, init: unwrap(node.right), node, nameNode: left });
    } else if (ts.isPropertyAccessExpression(left) || ts.isElementAccessExpression(left)) {
      const prop = propName(left);
      if (isWindowHead(left.expression)) {
        addWindow(left, "write", node.right, file, node);
      } else if (ts.isObjectLiteralExpression(unwrap(node.right)) && pathOf(left)) {
        // `P.player = { muted: false }` creates the object just as `const player = {...}` does,
        // and still gives its owner a property of that name
        remember({ key: pathOf(left), file, init: unwrap(node.right), node, nameNode: left });
        const base = pathOf(left.expression);
        if (base && prop !== null) {
          writes.push({ key: base, prop, rhs: node.right, op: ts.SyntaxKind.EqualsToken, file, node });
        }
      } else {
        const base = pathOf(left.expression);
        if (base && prop !== null) {
          writes.push({ key: base, prop, rhs: node.right, op: node.operatorToken.kind, file, node });
        }
      }
    }
  }
  if ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
      (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken)) {
    const target = unwrap(node.operand);
    if (target && (ts.isPropertyAccessExpression(target) || ts.isElementAccessExpression(target))) {
      const prop = propName(target);
      if (isWindowHead(target.expression)) {
        addWindow(target, "write", null, file, node);
      } else {
        const base = pathOf(target.expression);
        if (base && prop !== null) {
          writes.push({ key: base, prop, rhs: null, op: node.operator, file, node });
        }
      }
    }
  }
  if (ts.isCallExpression(node)) {
    calls.push({ node, file });
    const e = unwrap(node.expression);
    if (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.expression) && e.expression.text === "Object" &&
        (e.name.text === "assign" || e.name.text === "defineProperty") && node.arguments.length >= 2) {
      const key = pathOf(node.arguments[0]);
      if (key && e.name.text === "assign") {
        assignCalls.push({ key, srcs: node.arguments.slice(1), file, node });
      } else if (key) {
        const a1 = unwrap(node.arguments[1]);
        if (a1 && (ts.isStringLiteral(a1) || ts.isNoSubstitutionTemplateLiteral(a1))) {
          writes.push({ key, prop: a1.text, rhs: node.arguments[2] ?? null, op: ts.SyntaxKind.EqualsToken, file, node });
        }
      }
    }
  }
  if (ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name) && node.initializer) {
    const key = pathOf(node.initializer);
    const props = [];
    for (const el of node.name.elements) {
      if (el.dotDotDotToken) continue;
      const p = el.propertyName ?? el.name;
      if (ts.isIdentifier(p) || ts.isStringLiteral(p)) props.push(p.text);
    }
    if (key && props.length) destructures.push({ key, names: props, file });
  }
  if (ts.isPropertyAccessExpression(node) && isWindowHead(node.expression) &&
      !(ts.isBinaryExpression(node.parent) && node.parent.left === node &&
        isAssignmentOp(node.parent.operatorToken.kind)) &&
      !ts.isPrefixUnaryExpression(node.parent) && !ts.isPostfixUnaryExpression(node.parent)) {
    addWindow(node, "read", null, file, node);
  }
  if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) classes.push({ node, file });
  ts.forEachChild(node, (c) => visit(c, file));
}

for (const f of webFiles) visit(f, f);

// nested object literals get roots of their own, so a write two levels deep lands on the value it
// really changes instead of becoming a dotted property name.
function registerLiteral(key, literal, file, node, nameNode, label) {
  if (!creates.has(key)) creates.set(key, { key, file, init: literal, node, nameNode, nested: true, label });
  for (const p of literal.properties) {
    if (!ts.isPropertyAssignment(p)) continue;
    const v = unwrap(p.initializer);
    const pn = ts.isIdentifier(p.name) || ts.isStringLiteral(p.name) ? p.name.text : null;
    if (pn && v && ts.isObjectLiteralExpression(v) && !creates.has(key + "." + pn)) {
      registerLiteral(key + "." + pn, v, file, p, p.name, (label ? label + "." : "") + pn);
    }
  }
}
for (const [key, c] of [...creates]) if (!c.nested && ts.isObjectLiteralExpression(c.init)) registerLiteral(key, c.init, c.file, c.node, c.nameNode, c.label);

// ─────────────────────────────────────── aliases and root set ─────────────────────────────────
const alias = new Map(); // "sym#12" -> rootKey of the object that parameter receives

// `P.player.play` where `P` is a parameter that receives the audio engine: the alias has to be
// expanded at the front of the path, the way `P` really refers to the caller's object.
function expandAlias(pathKey) {
  let key = pathKey;
  for (let guard = 0; guard < 16; guard++) {
    const seg = key.split(".");
    let replaced = false;
    for (let i = seg.length; i >= 1; i--) {
      const a = alias.get(seg.slice(0, i).join("."));
      if (a) {
        key = a + (seg.length > i ? "." + seg.slice(i).join(".") : "");
        replaced = true;
        break;
      }
    }
    if (!replaced) break;
  }
  return key;
}
function resolveRoot(pathKey) {
  if (!pathKey) return null;
  const seg = expandAlias(pathKey).split(".");
  for (let i = seg.length; i >= 1; i--) {
    const cand = seg.slice(0, i).join(".");
    if (roots.has(cand)) return { rootKey: cand, chain: seg.slice(i) };
  }
  return null;
}

const writeKeys = new Set(writes.map((w) => w.key));
const assignKeys = new Set(assignCalls.map((a) => a.key));
const destructuredKeys = new Set(destructures.map((d) => d.key));
const roots = new Map(); // rootKey -> create record
for (const [key, c] of creates) {
  if (!ts.isObjectLiteralExpression(c.init)) continue; // a call result is typed at its factory
  if (writeKeys.has(key) || assignKeys.has(key) || destructuredKeys.has(key)) roots.set(key, c);
}

function fnOfCallee(node) {
  const e = unwrap(node.expression);
  if (!e) return [];
  const sym = ts.isIdentifier(e) ? symAt(e) : ts.isPropertyAccessExpression(e) ? symAt(e.name) : undefined;
  return (sym?.declarations ?? []).filter((d) => d && d.parameters &&
    (ts.isFunctionDeclaration(d) || ts.isFunctionExpression(d) || ts.isArrowFunction(d) ||
     ts.isMethodDeclaration(d) || ts.isConstructorDeclaration(d)));
}

function aliasPass() {
  let changed = false;
  const setAlias = (symKey, rootKey) => {
    if (!symKey || !rootKey || symKey === rootKey || alias.get(symKey) === rootKey) return;
    alias.set(symKey, rootKey);
    changed = true;
  };
  for (const call of calls) {
    for (const fn of fnOfCallee(call.node)) {
      for (let i = 0; i < call.node.arguments.length && i < fn.parameters.length; i++) {
        const p = fn.parameters[i];
        if (!ts.isIdentifier(p.name)) continue;
        const hit = resolveRoot(pathOf(call.node.arguments[i]));
        if (!hit || hit.chain.length) continue;
        const psym = symAt(p.name);
        if (psym) setAlias("sym#" + sid(psym), hit.rootKey);
      }
    }
  }
  for (const [key, c] of creates) {
    const init = c.node.initializer ? unwrap(c.node.initializer) : null;
    if (!init || !ts.isIdentifier(init) || !c.nameNode) continue;
    const hit = resolveRoot(pathOf(init));
    if (!hit || hit.chain.length) continue;
    const s = symAt(c.nameNode);
    if (s) setAlias("sym#" + sid(s), hit.rootKey);
  }
  return changed;
}
for (let i = 0; i < 10 && aliasPass(); i++);

// writes reach their root through the alias map too
for (const w of writes) {
  const seg = expandAlias(w.key).split(".");
  for (let i = seg.length; i >= 1; i--) {
    const cand = seg.slice(0, i).join(".");
    if (roots.has(cand)) {
      w.rootKey = cand;
      w.parts = seg.slice(i).concat([w.prop]);
      break;
    }
  }
}
for (const a of assignCalls) {
  const hit = resolveRoot(a.key);
  a.rootKey = hit ? hit.rootKey : null;
  a.chain = hit ? hit.chain : [];
}
for (const d of destructures) {
  const hit = resolveRoot(d.key);
  d.rootKey = hit && !hit.chain.length ? hit.rootKey : null;
}

// A literal that never gains a property of its own needs no interface: TypeScript already knows
// every property it has. Only values that are loaded with new properties later are worth a name
// (and only those can produce the "property does not exist" errors this pass exists for).
for (const [key, root] of [...roots]) {
  if (!ts.isObjectLiteralExpression(root.init)) continue;
  if (root.init.properties.some((p) => ts.isSpreadAssignment(p))) continue; // could bring anything
  const have = new Set(root.init.properties
    .filter((p) => p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)))
    .map((p) => p.name.text));
  const extra = writes.some((w) => w.rootKey === key && w.parts.length === 1 && !have.has(w.parts[0]));
  const assigned = assignCalls.some((a) => a.rootKey === key && !a.chain.length &&
    a.srcs.some((s) => checker.getPropertiesOfType(checker.getTypeAtLocation(s))
      .some((ps) => !have.has(ps.getName()) && !ps.getName().startsWith("__@"))));
  const read = destructures.some((d) => d.rootKey === key && d.names.some((nm) => !have.has(nm)));
  if (!extra && !assigned && !read) roots.delete(key);
}

// ─────────────────────────────────────────── naming ───────────────────────────────────────────
const pascal = (s) => s.replace(/[^A-Za-z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean)
  .map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join("");
// The name the source gives this value: `const player = ...` -> "player", `P.player = {...}` ->
// "P.player". Used for the type-names.json key and for a fallback interface name.
function labelOf(root) {
  if (root.label) return root.label;
  const n = root.nameNode;
  if (n && ts.isIdentifier(n)) return n.text;
  if (n && (ts.isPropertyAccessExpression(n) || ts.isElementAccessExpression(n))) return safeText(n);
  return null;
}
function safeText(node) {
  if (!node) return null;
  const t = node.getText().replace(/\s+/g, "");
  return t.length <= 40 ? t : t.slice(0, 40);
}
function autoName(fileRel, key, root) {
  const dir = fileRel.replace(/^web\//, "").replace(/\/[^/]*$/, "");
  const base = pascal(dir);
  const label = labelOf(root);
  const last = label ? label.split(".").pop() : key.split(".").pop();
  const tail = /^[\d#]/.test(last) ? "Obj" : pascal(last);
  return (base + tail).replace(/^\d/, "T$&") || "Ctx";
}

const typesFileFor = (fileRel) => POSIX(join(dirname(fileRel), "types.ts"));

const usedNames = new Map(); // name -> rootKey
function shortOf(rootKey, root) {
  // every create carries the readable path the source gives it ("player", "P.player",
  // "env.shared.leafTex"), so the key is just that path
  return labelOf(root) ?? rootKey;
}

const plans = new Map();
const autoNamed = [];
// two locals can share a name and even a file (`const spec = {...}` five times over), so a
// repeated "file:name" is numbered in declaration order to tell them apart.
const baseCount = new Map();
const baseKeyOf = (root) => rel(root.file.fileName) + ":" + shortOf(root.key, root);
const orderedRoots = [...roots].sort((a, b) =>
  a[1].file.fileName === b[1].file.fileName
    ? a[1].node.getStart() - b[1].node.getStart()
    : a[1].file.fileName.localeCompare(b[1].file.fileName));
for (const [, root] of orderedRoots) {
  const b = baseKeyOf(root);
  baseCount.set(b, (baseCount.get(b) || 0) + 1);
}
const baseSeen = new Map();
for (const [key, root] of orderedRoots) {
  const fileRel = rel(root.file.fileName);
  const base = baseKeyOf(root);
  let mapKey = base;
  if (baseCount.get(base) > 1) {
    const n = (baseSeen.get(base) || 0) + 1;
    baseSeen.set(base, n);
    mapKey = base + "#" + n;
  }
  let name = names[mapKey];
  const auto = !name;
  if (!name) name = autoName(fileRel, key, root);
  if (usedNames.has(name) && usedNames.get(name) !== key) {
    let i = 2;
    while (usedNames.has(name + i)) i++;
    name = name + i;
  }
  usedNames.set(name, key);
  if (auto) autoNamed.push([mapKey, name]);
  plans.set(key, { key, root, name, mapKey, auto, typesFile: typesFileFor(fileRel), props: new Map() });
}

// name -> the types.ts that will carry the interface, for imports and cross-references
const nameToTypesFile = new Map();
for (const [, plan] of plans) nameToTypesFile.set(plan.name, plan.typesFile);
// a types.ts that mentions an interface of another folder has to import it
const typesFileRefs = new Map(); // typesFile -> Set(name)

// ─────────────────────────────────────────── property fills ───────────────────────────────────
// A type text may mention names that resolve where the declaration lands: the interfaces of that
// folder's types.ts, and (for class fields) the class file's own scope.
const fileScopeCache = new Map();
function scopeOf(fileAbs) {
  let set = fileScopeCache.get(fileAbs);
  if (set) return set;
  set = new Set();
  const sf = program.getSourceFile(fileAbs);
  if (sf) {
    for (const st of sf.statements) {
      if (st.name && ts.isIdentifier(st.name)) set.add(st.name.text);
      if (ts.isImportDeclaration(st) && st.importClause) {
        const nc = st.importClause.namedBindings;
        if (st.importClause.name) set.add(st.importClause.name.text);
        if (nc && ts.isNamedImports(nc)) for (const e of nc.elements) set.add(e.name.text);
        if (nc && ts.isNamespaceImport(nc)) set.add(nc.name.text);
      }
    }
  }
  fileScopeCache.set(fileAbs, set);
  return set;
}

// Declarations the whole web tree exports, so a class field can import a type it needs:
// name -> the one file that declares it (ambiguous names stay `any`).
const webDecls = new Map();
for (const f of webFiles) {
  for (const st of f.statements) {
    if (!st.name || !ts.isIdentifier(st.name)) continue;
    if (!(ts.isClassDeclaration(st) || ts.isInterfaceDeclaration(st) || ts.isTypeAliasDeclaration(st) ||
          ts.isEnumDeclaration(st))) continue;
    let list = webDecls.get(st.name.text);
    if (!list) webDecls.set(st.name.text, (list = new Set()));
    list.add(rel(f.fileName));
  }
}
function importableName(name) {
  const list = webDecls.get(name);
  return list && list.size === 1 ? [...list][0] : null;
}

const allowedByTypesFile = new Map(); // typesFile -> Set(name)
function allowedFor(typesFile) {
  let set = allowedByTypesFile.get(typesFile);
  if (set) return set;
  set = new Set();
  const sf = program.getSourceFile(abs(typesFile));
  if (sf) for (const st of sf.statements) if (ts.isInterfaceDeclaration(st)) set.add(st.name.text);
  allowedByTypesFile.set(typesFile, set);
  return set;
}
for (const [, plan] of plans) allowedFor(plan.typesFile).add(plan.name);

const stats = { roots: 0, typed: 0, props: 0, required: 0, optional: 0, literalProps: 0, assignProps: 0,
  params: 0, unionParams: 0, splitParams: 0, templatedParams: 0, asAnnotations: 0, alreadyTyped: 0, destructuredUnknown: 0 };

for (const [, plan] of plans) {
  const allowed = allowedFor(plan.typesFile);
  const add = (name, text, required) => {
    let p = plan.props.get(name);
    if (!p) plan.props.set(name, (p = { texts: [], required: false }));
    if (text && !p.texts.includes(text)) p.texts.push(text);
    if (required) p.required = true;
  };
  // a value that is itself one of these objects is named, not spelled out inline: a copy of the
  // interfaces' shape would not follow the other file's future fields.
  const refText = (node) => {
    const hit = resolveRoot(pathOf(node));
    if (hit && !hit.chain.length) {
      const target = plans.get(hit.rootKey);
      if (target && target.name && target !== plan) {
        if (target.typesFile !== plan.typesFile) {
          let s = typesFileRefs.get(plan.typesFile);
          if (!s) typesFileRefs.set(plan.typesFile, (s = new Set()));
          s.add(target.name);
        }
        return target.name;
      }
    }
    return typeText(node, allowed);
  };
  const lit = plan.root.init;
  if (ts.isObjectLiteralExpression(lit)) {
    for (const p of lit.properties) {
      const pn = p.name ? (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name) ? p.name.text : null) : null;
      if (!pn) continue;
      if (ts.isPropertyAssignment(p)) {
        const child = plans.get(plan.key + "." + pn);
        add(pn, child && child.name ? child.name : refText(p.initializer), true);
        stats.literalProps++;
      } else if (ts.isShorthandPropertyAssignment(p)) {
        add(pn, refText(p.name), true);
      } else {
        add(pn, "any", true);
      }
    }
  }
  for (const w of writes) {
    if (w.rootKey !== plan.key || w.parts.length !== 1) continue;
    const name = w.parts[0];
    if (w.op === ts.SyntaxKind.PlusPlusToken || w.op === ts.SyntaxKind.MinusMinusToken) add(name, "number", false);
    else {
      const child = plans.get(w.rootKey + "." + name);
      add(name, child && child.name ? child.name : w.rhs ? refText(w.rhs) : "any", false);
    }
  }
  for (const a of assignCalls) {
    if (a.rootKey !== plan.key || a.chain.length) continue;
    for (const src of a.srcs) {
      const t = checker.getTypeAtLocation(src);
      if (!t) continue;
      for (const psym of checker.getPropertiesOfType(t)) {
        const nm = psym.getName();
        if (nm.startsWith("__@")) continue;
        let pt;
        try {
          pt = checker.getTypeOfSymbolAtLocation(psym, src);
        } catch {
          pt = undefined;
        }
        add(nm, textOfType(pt, src, allowed), false);
        stats.assignProps++;
      }
    }
  }
  for (const d of destructures) {
    if (d.rootKey !== plan.key) continue;
    for (const nm of d.names) {
      if (!plan.props.has(nm)) {
        add(nm, "any", false);
        stats.destructuredUnknown++;
      }
    }
  }
  for (const [, p] of plan.props) p.text = union(p.texts);
}

// ───────────────────────────────────────────── edits model ────────────────────────────────────
const edits = new Map(); // fileAbs -> [{pos, text}]
const newFiles = new Map(); // fileAbs -> text
function insert(fileAbs, pos, text) {
  let l = edits.get(fileAbs);
  if (!l) edits.set(fileAbs, (l = []));
  l.push({ pos, text });
}

// ─────────────────────────────────────────────── objects ──────────────────────────────────────
const paramPlans = [];
const typeFiles = new Map(); // fileRel -> { fileRel, isNew, interfaces, have: Map<name, Set<prop>>, extended }
function typeFile(fileRel) {
  let tf = typeFiles.get(fileRel);
  if (tf) return tf;
  const fileAbs = abs(fileRel);
  tf = { fileRel, isNew: !existsSync(fileAbs), interfaces: new Map(), have: new Map(), extended: false };
  if (!tf.isNew) {
    const sf = program.getSourceFile(fileAbs);
    if (sf) {
      for (const st of sf.statements) {
        if (!ts.isInterfaceDeclaration(st)) continue;
        const props = new Set();
        for (const m of st.members) if (m.name && ts.isIdentifier(m.name)) props.add(m.name.text);
        tf.have.set(st.name.text, props);
      }
    }
  }
  typeFiles.set(fileRel, tf);
  return tf;
}

if (want("objects")) {
  for (const [, plan] of plans) {
    stats.roots++;
    if (!plan.props.size) continue;
    stats.typed++;
    const tf = typeFile(plan.typesFile);
    const have = tf.have.get(plan.name);
    const own = new Map();
    for (const [nm, p] of plan.props) {
      if (have && have.has(nm)) continue;
      own.set(nm, p);
      if (p.required) stats.required++; else stats.optional++;
    }
    if (!have) tf.interfaces.set(plan.name, own);
    else if (own.size) tf.extended = true;
    stats.props += own.size;

    // `as X` on the literal that creates it
    const lit = plan.root.init;
    if (ts.isObjectLiteralExpression(lit) && !ts.isAsExpression(lit.parent)) {
      insert(plan.root.file.fileName, lit.getEnd(), " as " + plan.name);
      stats.asAnnotations++;
    } else stats.alreadyTyped++;
  }
}

// parameters that receive one of these objects get the interface — but only when every call site
// passes that same object. A parameter that sometimes receives something else keeps its old
// (implicit) type: typing it would break the other callers instead of fixing the reads here.
if (want("objects")) {
  const seen = new Map(); // paramSymKey -> { fileAbs, nameNode, names:Set, unresolved }
  const note = (p, plan, hit) => {
    if (p.dotDotDotToken || p.questionToken) return; // rest/optional: `...a: T` would change the type
    const psym = symAt(p.name);
    if (!psym) return;
    const k = "sym#" + sid(psym);
    let rec = seen.get(k);
    if (!rec) seen.set(k, (rec = { fileAbs: p.getSourceFile().fileName, nameNode: p.name, names: new Set(), unresolved: 0 }));
    if (plan) rec.names.add(plan.name);
    else rec.unresolved++;
  };
  for (const call of calls) {
    for (const fn of fnOfCallee(call.node)) {
      for (let i = 0; i < fn.parameters.length; i++) {
        const p = fn.parameters[i];
        if (!ts.isIdentifier(p.name)) continue;
        const paramFile = p.getSourceFile().fileName;
        if (!rel(paramFile).startsWith("web/") || !/\.(ts|mts)$/.test(paramFile)) continue;
        const arg = call.node.arguments[i];
        const hit = arg ? resolveRoot(pathOf(arg)) : null;
        const plan = hit && !hit.chain.length ? plans.get(hit.rootKey) : null;
        note(p, plan && plan.name ? plan : null, hit);
      }
    }
  }
  for (const [, rec] of seen) {
    if (!rec.names.size) continue; // never receives one of these objects: not our business
    if (rec.names.size > 1) {
      stats.unionParams++;
      continue;
    }
    if (rec.unresolved) stats.splitParams++;
    const list = [...rec.names];
    const decl = rec.nameNode.parent;
    if (decl.type) continue;
    const tpl = firstTemplate.get(rec.fileAbs);
    if (tpl !== undefined && tpl < rec.nameNode.getStart()) {
      stats.templatedParams++;
      continue;
    }
    stats.params++;
    insert(rec.fileAbs, rec.nameNode.getEnd(), ": " + list[0]);
    paramPlans.push({ ...rec, text: list[0] });
    if (verbose) console.log(`  param ${rel(rec.fileAbs)}:${rec.nameNode.text}: ${list[0]}`);
  }
}

// imports for what a file now mentions but does not own
const needed = new Map(); // fileAbs -> Set("name\0fromRel")
const need = (fileAbs, name, fromRel) => {
  if (scopeOf(fileAbs).has(name)) return;
  let s = needed.get(fileAbs);
  if (!s) needed.set(fileAbs, (s = new Set()));
  s.add(name + "\u0000" + fromRel);
};
// an interface is imported from the types.ts that declares it, which is the folder of the object,
// not always the folder of the file that mentions it
if (want("objects")) {
  for (const [, plan] of plans) {
    if (!plan.name || !plan.props.size) continue;
    if (!ts.isObjectLiteralExpression(plan.root.init)) continue;
    need(plan.root.file.fileName, plan.name, plan.typesFile);
  }
  for (const p of paramPlans) {
    for (const nm of p.text.split(" | ")) need(p.fileAbs, nm, nameToTypesFile.get(nm) ?? typesFileFor(rel(p.fileAbs)));
  }
}

function writeImports() {
  for (const [fileAbs, set] of needed) {
    const byFrom = new Map();
    for (const s of set) {
      const [nm, from] = s.split("\u0000");
      let l = byFrom.get(from);
      if (!l) byFrom.set(from, (l = []));
      l.push(nm);
    }
    let text = "";
    for (const [from, arr] of [...byFrom].sort((a, b) => a[0].localeCompare(b[0]))) {
      let spec = POSIX(relative(dirname(fileAbs), abs(from))).replace(/\.(ts|mts)$/, ".js");
      if (!spec.startsWith(".")) spec = "./" + spec;
      text += `\nimport type { ${[...arr].sort().join(", ")} } from "${spec}";`;
    }
    const sf = program.getSourceFile(fileAbs);
    const lastImport = sf ? [...sf.statements].filter((s) => ts.isImportDeclaration(s)).pop() : null;
    insert(fileAbs, lastImport ? lastImport.getEnd() : 0, text);
  }
}

// write the interfaces (new types.ts files, or a block appended to an existing one)
if (want("objects")) {
  for (const [, tf] of typeFiles) {
    if (!tf.interfaces.size) continue;
    const blocks = [];
    for (const [name, members] of tf.interfaces) {
      const lines = [...members].sort((a, b) => a[0].localeCompare(b[0]))
        .map(([p, info]) => "  " + propKey(p) + (info.required ? "" : "?") + ": " + info.text + ";");
      blocks.push(`export interface ${name} {\n${lines.join("\n")}\n}`);
    }
    const body = blocks.join("\n\n");
    const refs = typesFileRefs.get(tf.fileRel);
    let head = "";
    if (refs && refs.size) {
      const grouped = new Map();
      for (const nm of [...refs].sort()) {
        const from = nameToTypesFile.get(nm);
        if (!from || from === tf.fileRel) continue;
        let l = grouped.get(from);
        if (!l) grouped.set(from, (l = []));
        l.push(nm);
      }
      for (const [from, names] of [...grouped].sort((a, b) => a[0].localeCompare(b[0]))) {
        let spec = POSIX(relative(dirname(abs(tf.fileRel)), abs(from))).replace(/\.(ts|mts)$/, ".js");
        if (!spec.startsWith(".")) spec = "./" + spec;
        head += `import type { ${names.join(", ")} } from "${spec}";\n`;
      }
      if (head) head += "\n";
    }
    if (tf.isNew) {
      newFiles.set(abs(tf.fileRel),
        "// Types only: one interface per object the converted code creates empty and fills in later\n" +
        "// (see tools/rewrite/add-types.mjs). Nothing here is emitted — node's strip mode erases the\n" +
        "// declarations — so this file must never hold runtime code.\n\n" + head + body + "\n");
    } else {
      const fileAbs = abs(tf.fileRel);
      insert(fileAbs, readFileSync(fileAbs, "utf8").length, "\n" + head + body + "\n");
    }
  }
}

// ──────────────────────────────────────────────── classes ─────────────────────────────────────
const classStats = { classes: 0, fields: 0, skipped: 0 };
if (want("class")) {
  for (const c of classes) {
    const fileAbs = c.file.fileName;
    if (!rel(fileAbs).startsWith("web/")) continue;
    const node = c.node;
    if (!node.members || !node.name) continue;
    const declared = new Set();
    for (const m of node.members) {
      if (!m.name) continue;
      const n = ts.isIdentifier(m.name) || ts.isStringLiteral(m.name) ? m.name.text : null;
      if (n) declared.add(n);
    }
    const selfType = checker.getTypeAtLocation(node.name);
    // a field may name a type the file does not import yet: those get an `import type` below
    const allowed = new Set(scopeOf(fileAbs));
    for (const [nm, files] of webDecls) if (files.size === 1) allowed.add(nm);
    const fills = new Map();
    const walk = (n) => {
      if (ts.isBinaryExpression(n) && isAssignmentOp(n.operatorToken.kind)) {
        const left = unwrap(n.left);
        if (ts.isPropertyAccessExpression(left) && left.expression.kind === ts.SyntaxKind.ThisKeyword) {
          const nm = left.name.text;
          if (!declared.has(nm)) {
            let rec = fills.get(nm);
            if (!rec) fills.set(nm, (rec = []));
            if (n.operatorToken.kind === ts.SyntaxKind.EqualsToken || isArithmeticAssign(n.operatorToken.kind)) {
              rec.push(typeText(n.right, allowed));
            } else rec.push("any");
          }
        }
      }
      if ((ts.isPrefixUnaryExpression(n) || ts.isPostfixUnaryExpression(n)) &&
          (n.operator === ts.SyntaxKind.PlusPlusToken || n.operator === ts.SyntaxKind.MinusMinusToken)) {
        const t = unwrap(n.operand);
        if (ts.isPropertyAccessExpression(t) && t.expression.kind === ts.SyntaxKind.ThisKeyword) {
          const nm = t.name.text;
          if (!declared.has(nm)) {
            let rec = fills.get(nm);
            if (!rec) fills.set(nm, (rec = []));
            rec.push("number");
          }
        }
      }
      ts.forEachChild(n, walk);
    };
    walk(node);
    // an inherited or already-known member of that name must not be declared again
    for (const nm of [...fills.keys()]) {
      const p = selfType ? checker.getPropertyOfType(selfType, nm) : undefined;
      if (p) {
        const d = p.valueDeclaration ?? p.declarations?.[0];
        if (d && d.getSourceFile() === c.file) {
          fills.delete(nm);
          classStats.skipped++;
        }
      }
    }
    if (!fills.size) continue;
    classStats.classes++;
    const fields = [...fills].map(([nm, t]) => [nm, union(t)]).sort((a, b) => a[0].localeCompare(b[0]));
    classStats.fields += fields.length;
    for (const [, t] of fields) {
      for (const word of t.match(/[A-Za-z_$][\w$]*/g) ?? []) {
        if (!/^[A-Z]/.test(word) || scopeOf(fileAbs).has(word)) continue;
        const from = importableName(word);
        if (from) need(fileAbs, word, from);
      }
    }
    const memberList = node.members;
    const fileText = readFileSync(fileAbs, "utf8");
    const lineStart = fileText.lastIndexOf("\n", node.getStart()) + 1;
    const indent = /^[ \t]*/.exec(fileText.slice(lineStart))[0] + "  ";
    const anchor = memberList.find((m) => ts.getModifiers?.(m)?.some((mo) => mo.kind === ts.SyntaxKind.DeclareKeyword));
    const text = fields.map(([nm, t]) => "declare " + propKey(nm) + ": " + t + ";").join("\n" + indent);
    insert(fileAbs, anchor ? anchor.getEnd() : memberList.pos, "\n" + indent + text);
  }
}

// every `import type` the passes asked for, written after the last existing import
writeImports();

// ──────────────────────────────────────────────── globals ─────────────────────────────────────
const globalStats = { names: 0, onWindow: 0, declaredVars: 0 };
const touchedExtra = new Set();
if (want("globals")) {
  const probe = (() => {
    let found = null;
    const look = (n) => {
      if (found) return;
      if (ts.isIdentifier(n) && n.text === "window" && isWindowHead(n)) {
        found = n;
        return;
      }
      ts.forEachChild(n, look);
    };
    for (const f of webFiles) {
      look(f);
      if (found) break;
    }
    return found;
  })();
  const known = new Set();
  if (probe) for (const p of checker.getPropertiesOfType(checker.getTypeAtLocation(probe))) known.add(p.getName());
  const globals = new Map();
  for (const a of winAccess) {
    if (known.has(a.name)) continue;
    let rec = globals.get(a.name);
    if (!rec) globals.set(a.name, (rec = { texts: [], via: new Set() }));
    rec.via.add(a.how);
    rec.texts.push(a.kind === "write" && a.rhs ? typeText(a.rhs, new Set()) : "any");
  }
  const entries = [...globals].sort((a, b) => a[0].localeCompare(b[0]))
    .map(([nm, rec]) => [nm, { ...rec, text: union(rec.texts) }]);
  for (const [nm, rec] of entries) {
    globalStats.names++;
    if (rec.via.has("window")) globalStats.onWindow++; else globalStats.declaredVars++;
  }
  if (entries.length) globalsFile(entries);
}

function globalsFile(entries) {
  const fileRel = "web/types/globals.d.ts";
  const fileAbs = abs(fileRel);
  const existing = existsSync(fileAbs) ? readFileSync(fileAbs, "utf8") : "";
  const have = new Set();
  if (existing) {
    const sf = ts.createSourceFile(fileAbs, existing, ts.ScriptTarget.Latest, true);
    for (const st of sf.statements) {
      if (ts.isInterfaceDeclaration(st) && st.name.text === "Window") {
        for (const m of st.members) if (m.name && ts.isIdentifier(m.name)) have.add(m.name.text);
      }
      if (ts.isVariableStatement(st)) {
        for (const d of st.declarationList.declarations) if (ts.isIdentifier(d.name)) have.add(d.name.text);
      }
    }
  }
  const win = [];
  const vars = [];
  for (const [nm, rec] of entries) {
    if (have.has(nm)) continue;
    if (rec.via.has("window")) win.push(`  ${propKey(nm)}: ${rec.text};`);
    else vars.push(`declare var ${nm}: ${rec.text};`);
  }
  if (!win.length && !vars.length) return;
  let text = existing;
  if (!text) {
    text = "// Ambient types for what the game and its tools hang off `window` (dev hooks, options, the\n" +
      "// debug panels). Type-only: node's strip mode and tools/rewrite/build-web.mjs both skip .d.ts,\n" +
      "// so nothing here ships. Written by tools/rewrite/add-types.mjs.\n";
  }
  if (win.length) {
    const sf = text ? ts.createSourceFile(fileAbs, text, ts.ScriptTarget.Latest, true) : null;
    let at = null;
    if (sf) for (const st of sf.statements) if (ts.isInterfaceDeclaration(st) && st.name.text === "Window") at = st.members.end;
    if (at === null) text += (text.endsWith("\n") ? "" : "\n") + "\ninterface Window {\n" + win.join("\n") + "\n}\n";
    else text = text.slice(0, at) + "\n" + win.join("\n") + text.slice(at);
  }
  if (vars.length) text += (text.endsWith("\n") ? "" : "\n") + vars.join("\n") + "\n";
  if (!dry) {
    mkdirSync(dirname(fileAbs), { recursive: true });
    writeFileSync(fileAbs, text);
    touchedExtra.add(fileRel);
  } else touchedExtra.add(fileRel);
}

// ───────────────────────────────────────────────────── apply ──────────────────────────────────
let changed = 0, inserted = 0;
const touched = [];
const warnings = [];
for (const [fileAbs, item] of edits) {
  let text = readFileSync(fileAbs, "utf8");
  const before = text;
  for (const e of [...item].sort((a, b) => b.pos - a.pos)) {
    text = text.slice(0, e.pos) + e.text + text.slice(e.pos);
    inserted++;
  }
  const sf = ts.createSourceFile(fileAbs, text, ts.ScriptTarget.Latest, true);
  if (sf.parseDiagnostics && sf.parseDiagnostics.length) {
    warnings.push(`${rel(fileAbs)}: parse error after edit: ` +
      ts.flattenDiagnosticMessageText(sf.parseDiagnostics[0].messageText, "\n"));
    continue;
  }
  if (before !== text) {
    changed++;
    touched.push(rel(fileAbs));
    if (!dry) writeFileSync(fileAbs, text);
  }
}
for (const [fileAbs, text] of newFiles) {
  touched.push(rel(fileAbs));
  if (!dry) {
    mkdirSync(dirname(fileAbs), { recursive: true });
    writeFileSync(fileAbs, text);
  }
}

if (writeNames && plans.size) {
  // exactly the roots this run found: names filled in, keys that no longer exist dropped
  const out = {};
  for (const [, plan] of plans) out[plan.mapKey] = plan.name;
  const sorted = {};
  for (const k of Object.keys(out).sort()) sorted[k] = out[k];
  writeFileSync(abs(namesPath), JSON.stringify(sorted, null, 2) + "\n");
}

// ───────────────────────────────────────────────────── summary ────────────────────────────────
const tag = dry ? "[dry] " : "";
console.log(`${tag}add-types: ${webFiles.length} web files in program${only ? ` (pass: ${only})` : ""}`);
if (want("objects")) {
  console.log(`${tag}objects: ${stats.typed} values typed of ${stats.roots} roots — ${stats.props} properties ` +
    `(${stats.required} required, ${stats.optional} optional), ${stats.asAnnotations} "as X" annotations`);
  console.log(`${tag}         ${stats.literalProps} literal, ${stats.assignProps} merged by Object.assign, ` +
    `${stats.destructuredUnknown} from destructuring with no visible source`);
  console.log(`${tag}         ${stats.params} parameters annotated` +
    (stats.unionParams ? ` (${stats.unionParams} skipped: several different contexts at different call sites` : "") +
    (stats.splitParams ? ` (${stats.splitParams} skipped: some call sites pass something else)` : "") +
    (stats.templatedParams ? ` (${stats.templatedParams} skipped: after a template literal, see the erase-types note)` : "") +
    `, ${stats.alreadyTyped} values already typed`);
  if (autoNamed.length) {
    console.log(`${tag}         ${autoNamed.length} auto-named (name them in ${namesPath}):`);
    for (const [k, v] of (list ? autoNamed : autoNamed.slice(0, 25))) console.log(`${tag}           ${k} -> ${v}`);
    if (!list && autoNamed.length > 25) console.log(`${tag}           ... (--list for all)`);
  }
}
if (want("class")) console.log(`${tag}class: ${classStats.classes} classes, ${classStats.fields} declare fields` +
  (classStats.skipped ? `, ${classStats.skipped} skipped (already declared)` : ""));
if (want("globals")) console.log(`${tag}globals: ${globalStats.names} names for web/types/globals.d.ts ` +
  `(${globalStats.onWindow} on window, ${globalStats.declaredVars} as global vars)`);
console.log(`${tag}${changed} files changed, ${inserted} insertions, ${newFiles.size} new types files` +
  (touchedExtra.size ? `, ${touchedExtra.size} touched by the globals pass` : ""));
for (const w of warnings) console.error("  ! " + w);

if (list) {
  console.log("\nroots:");
  for (const [, plan] of plans) {
    const props = [...plan.props.keys()];
    console.log(`  ${plan.name} ${rel(plan.root.file.fileName)}:${plan.mapKey.split(":").slice(1).join(":")} ` +
      `${props.length}p ${props.slice(0, 10).join(",")}${props.length > 10 ? ",..." : ""}`);
  }
  console.log("\nfiles:");
  for (const t of touched) console.log("  " + t);
}
