#!/usr/bin/env node
// split-types: undo the one-big-types-file. web/types.ts held every interface that the
// conversion added, so every module imported from it and nothing said which module a type
// belonged to. This moves each declaration into web/types/<module>.ts, where <module> is the
// module the type was generated from (tools/rewrite/type-names.json holds those pairs; a type
// with no entry goes to the web file that imports it most), rewrites the importers to point at
// the new files, and deletes web/types.ts.
//
//   node tools/rewrite/split-types.mjs [--dry] [--quiet]
//
// WHAT CHANGES
//   web/types.ts                       deleted
//   web/types/<module path>.ts         one type-only file per module (folders mirrored, because
//                                      web/built/spires.ts and web/built/place/spires.ts would
//                                      otherwise both want web/types/spires.ts)
//   web/types/MAP.md                   one table row per new file
//   importers of web/types.ts          each `import type { ... } from "./types.js"` becomes one
//                                      `import type { ... } from "./types/<module>.js"` per
//                                      target file; nothing else in those files is touched
//
// WHAT DOES NOT CHANGE
//   Runtime JavaScript: type-only imports are erased by node's strip mode, so the stripped token
//   stream of every rewritten file is identical (tools/rewrite/same-js.mjs is the proof).
//   Type checking: web/types.ts was one module, so every declaration could see every other. The
//   new files get exactly the `import type` statements needed to keep that true, computed from
//   the type references in each declaration — so tsc reports the same errors, moved around.
//
// The script is safe to re-run: with no web/types.ts there is nothing to do.
import ts from "typescript";
import { createRequire } from "node:module";
import {
  existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync,
} from "node:fs";
import { dirname, join, posix, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = (() => {
  const arg = process.argv.slice(2).find((a) => a.startsWith("--root="));
  return arg ? resolve(arg.slice("--root=".length)) : join(dirname(fileURLToPath(import.meta.url)), "..", "..");
})();
const WEB = join(ROOT, "web");
const TYPES = join(WEB, "types.ts");
const OUT = join(WEB, "types");
const TYPE_NAMES = join(ROOT, "tools", "rewrite", "type-names.json");

const argv = process.argv.slice(2);
const dry = argv.includes("--dry");
const quiet = argv.includes("--quiet");
const log = (...a) => { if (!quiet) console.log("split-types:", ...a); };
const rel = (p) => relative(ROOT, p).split(sep).join("/");
const die = (msg) => { console.error("split-types: " + msg); process.exit(1); };

if (!existsSync(TYPES)) { fixStragglers(); syncMap(); log("no web/types.ts — nothing to split"); process.exit(0); }

// After the split, `web/types.ts` no longer exists, so an import written against it later (a file
// converted or edited by hand after the split) is a dangling module. Point its names at their
// real home; leave alone the statements whose names are not in web/types/ at all.
function fixStragglers() {
  if (!existsSync(OUT)) return;
  const home = new Map(); // declaration name -> file under web/types
  const scan = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) { scan(p); continue; }
      if (!e.name.endsWith(".ts") || e.name.endsWith(".d.ts")) continue;
      const sf = ts.createSourceFile(p, readFileSync(p, "utf8"), ts.ScriptTarget.Latest, true);
      for (const st of sf.statements) {
        if (ts.isInterfaceDeclaration(st) || ts.isTypeAliasDeclaration(st)) home.set(st.name.text, p);
      }
    }
  };
  scan(OUT);

  let fixed = 0, unknown = [];
  const SKIP = new Set(["lib3d", "vendor", "node_modules"]);
  const files = [];
  const collect = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (SKIP.has(e.name) || e.name.startsWith("assets") || e.isSymbolicLink()) continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) { if (p !== OUT) collect(p); }
      else if (/\.m?ts$/.test(e.name) && !/\.d\.m?ts$/.test(e.name)) files.push(p);
    }
  };
  collect(WEB);
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    if (!text.includes("types.js")) continue;
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const spans = [];
    for (const st of sf.statements) {
      if (!ts.isImportDeclaration(st) || !st.importClause || !ts.isStringLiteral(st.moduleSpecifier)) continue;
      const spec = st.moduleSpecifier.text;
      if (!spec.endsWith("types.js")) continue;
      if (existsSync(resolve(dirname(file), spec.replace(/\.js$/, ".ts")))) continue; // its own types.ts, fine
      const nb = st.importClause.namedBindings;
      if (!nb || !ts.isNamedImports(nb)) continue;
      const groups = new Map(), keep = [];
      for (const el of nb.elements) {
        const target = home.get(el.name.text);
        if (target) groups.set(target, [...(groups.get(target) || []), el.getText(sf)]);
        else keep.push(el.getText(sf));
      }
      if (!groups.size) { unknown.push(...keep.map((n) => `${file}: ${n}`)); continue; }
      const eol = text.includes("\r\n") ? "\r\n" : "\n";
      const stmts = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([to, names]) => {
        let specOut = posix.relative(posix.dirname(rel(file)), rel(to)).replace(/\.ts$/, ".js");
        specOut = specOut.startsWith(".") ? specOut : "./" + specOut;
        return `import type { ${[...new Set(names)].sort().join(", ")} } from "${specOut}";`;
      });
      if (keep.length) stmts.push(`import type { ${keep.join(", ")} } from "${spec}";`);
      spans.push({ start: st.getStart(sf), end: st.getEnd(), text: stmts.join(eol) });
    }
    if (!spans.length) continue;
    if (dry) { log(`would repoint ${spans.length} dangling import(s) in ${rel(file)}`); continue; }
    let out = readFileSync(file, "utf8"); // re-read: another agent may have saved
    const sf2 = ts.createSourceFile(file, out, ts.ScriptTarget.Latest, true);
    const fresh = [];
    for (const span of spans) {
      const st = sf2.statements.find((s) => s.getStart(sf2) === span.start && ts.isImportDeclaration(s));
      if (st) fresh.push({ start: st.getStart(sf2), end: st.getEnd(), text: span.text });
    }
    for (const s of fresh.sort((a, b) => b.start - a.start)) out = out.slice(0, s.start) + s.text + out.slice(s.end);
    writeFileSync(file, out);
    fixed += fresh.length;
  }
  if (fixed) log(`repointed ${fixed} import statement(s) that still named web/types.ts`);
  if (unknown.length) log(`left ${unknown.length} name(s) that no longer live in web/types/: ${unknown.slice(0, 5).join(", ")}`);
}

// With web/types.ts gone there is nothing to split, but web/types/ may still gain a file by hand
// (a type two modules need but neither owns). Keep MAP.md honest for those, or the folders test
// reports them as unmapped. Docs only.
function syncMap() {
  if (!existsSync(OUT)) return;
  const mapPath = join(OUT, "MAP.md");
  const map = existsSync(mapPath) ? readFileSync(mapPath, "utf8") : "# web/types/\n\n| file | types | job |\n|---|---|---|\n";
  const listed = new Set([...map.matchAll(/^\| ([^ |]+\.ts) \|/gm)].map((m) => m[1]));
  const found = [];
  const scan = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) { scan(p); continue; }
      if (!e.name.endsWith(".ts") || e.name.endsWith(".d.ts")) continue;
      const relPath = relative(OUT, p).split(sep).join("/");
      if (listed.has(relPath)) continue;
      const n = (readFileSync(p, "utf8").match(/^export (interface|type) /gm) || []).length;
      found.push(`| ${relPath} | ${n} | types added after the split — see the file's own header |`);
    }
  };
  scan(OUT);
  if (!found.length) return;
  const rows = map.split("\n");
  let last = -1;
  rows.forEach((l, i) => { if (l.trim().startsWith("|")) last = i; });
  rows.splice(last + 1, 0, ...found);
  writeFileSync(mapPath, rows.join("\n"));
  log(`MAP.md: added ${found.length} row(s) for file(s) added after the split`);
}

// ---- walk web/, the same skips as tsconfig.web.json and build-web.mjs ------------------------
const SKIP_DIRS = new Set(["lib3d", "vendor", "node_modules"]);
const skipDir = (name) => SKIP_DIRS.has(name) || name.startsWith("assets");
function* walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (skipDir(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isSymbolicLink()) continue;
    if (e.isDirectory()) yield* walk(p);
    else if (/\.m?ts$/.test(e.name) && !/\.d\.m?ts$/.test(e.name)) yield p;
  }
}

const parse = (path, text) => ts.createSourceFile(path, text, ts.ScriptTarget.Latest, /*parents*/ true, ts.ScriptKind.TS);

// ---- the declarations, with their comments, in source order ---------------------------------
const source = readFileSync(TYPES, "utf8");
const sf = parse(rel(TYPES), source);

const isTypeDecl = (n) => ts.isInterfaceDeclaration(n) || ts.isTypeAliasDeclaration(n);
const decls = [];
for (const st of sf.statements) {
  if (!isTypeDecl(st)) die(`${rel(TYPES)}: unexpected statement ${JSON.stringify(source.slice(st.getStart(), st.getStart() + 40))} — types only`);
  decls.push({
    name: st.name.text,
    node: st,
    // getFullStart() reaches back over the declaration's own comment; a blank line before it
    // (or the file's banner comment) is not part of it.
    text: source.slice(st.getFullStart(), st.getEnd()).replace(/^\s*\n/, "").trimEnd(),
  });
}
if (!decls.length) die(`${rel(TYPES)}: no interface/type declarations`);

// ---- which module owns each declaration -----------------------------------------------------
// type-names.json: "web/<module>.ts:<var>" -> interface name. A name can appear under several
// vars; a name that appears under vars in different modules is ambiguous and must not be guessed.
const typeNames = createRequire(import.meta.url)(TYPE_NAMES);
const owners = new Map(); // name -> Set(module)
for (const [key, name] of Object.entries(typeNames)) {
  const mod = key.split(":")[0];
  if (!owners.has(name)) owners.set(name, new Set());
  owners.get(name).add(mod);
}

// For a declaration with no entry: the web file that imports it most.
const importersBy = new Map(); // name -> Map(file -> count)
function countImporters() {
  const declNames = new Set(decls.map((d) => d.name));
  for (const file of walk(WEB)) {
    if (resolve(file) === TYPES) continue;
    const text = readFileSync(file, "utf8");
    if (!text.includes("types.js")) continue;
    const f = parse(rel(file), text);
    for (const st of f.statements) {
      if (!ts.isImportDeclaration(st) || !st.importClause) continue;
      if (!ts.isStringLiteral(st.moduleSpecifier)) continue;
      const resolved = resolve(dirname(file), st.moduleSpecifier.text.replace(/\.js$/, ".ts"));
      if (resolved !== TYPES) continue;
      const nb = st.importClause.namedBindings;
      if (!nb || !ts.isNamedImports(nb)) continue;
      for (const el of nb.elements) {
        const n = el.name.text;
        if (!declNames.has(n)) continue;
        if (!importersBy.has(n)) importersBy.set(n, new Map());
        const m = importersBy.get(n);
        m.set(rel(file), (m.get(rel(file)) || 0) + 1);
      }
    }
  }
}

const problems = [];
const moduleOf = new Map(); // decl name -> module ("web/shop.ts")
for (const d of decls) {
  const set = owners.get(d.name);
  if (set && set.size === 1) { moduleOf.set(d.name, [...set][0]); continue; }
  if (set && set.size > 1) {
    problems.push(`${d.name}: type-names.json puts it in ${[...set].sort().join(" and ")} — cannot pick one`);
    continue;
  }
  if (!importersBy.size) countImporters();
  const counts = importersBy.get(d.name);
  if (!counts) { problems.push(`${d.name}: no type-names.json entry and nobody imports it`); continue; }
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
  moduleOf.set(d.name, best);
}
if (problems.length) die(`cannot place ${problems.length} declaration(s):\n  ` + problems.join("\n  "));

// module "web/shop.ts" -> web/types/shop.ts, "web/built/place/ground.ts" -> web/types/built/place/ground.ts
const targetOf = (mod) => join(WEB, "types", mod.replace(/^web\//, ""));
const byTarget = new Map(); // target path -> module
for (const d of decls) {
  const mod = moduleOf.get(d.name);
  if (!byTarget.has(targetOf(mod))) byTarget.set(targetOf(mod), mod);
}

// ---- type references between moved declarations ---------------------------------------------
const moved = new Set(decls.map((d) => d.name));
// A name used as a type: `X` in `: X`, `: X[]`, `: A | X`, `extends X`, generic arguments — all
// reach the tree as a TypeReferenceNode (or an ExpressionWithTypeArguments in a heritage clause).
// `typeof X` is a value position, and identifiers that are not in a type position (property
// names, parameter names of call signatures) are not collected.
function refsOf(node, out = new Set()) {
  const visit = (n) => {
    if (ts.isTypeReferenceNode(n)) {
      let tn = n.typeName;
      while (ts.isQualifiedName(tn)) tn = tn.left;
      if (ts.isIdentifier(tn)) out.add(tn.text);
    } else if (ts.isExpressionWithTypeArguments(n) && ts.isIdentifier(n.expression)) {
      out.add(n.expression.text);
    }
    ts.forEachChild(n, visit);
  };
  ts.forEachChild(node, visit);
  return out;
}

// ---- write the new type files ----------------------------------------------------------------
const files = []; // { path, module, decls, imports }
for (const [target, mod] of [...byTarget.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  const own = decls.filter((d) => targetOf(moduleOf.get(d.name)) === target);
  const ownNames = new Set(own.map((d) => d.name));
  const imports = new Map(); // target path -> Set(names)
  for (const d of own) {
    for (const name of refsOf(d.node)) {
      if (name === d.name || ownNames.has(name) || !moved.has(name)) continue;
      const to = targetOf(moduleOf.get(name));
      if (!imports.has(to)) imports.set(to, new Set());
      imports.get(to).add(name);
    }
  }
  files.push({ path: target, module: mod, decls: own, imports });
}

const render = (file) => {
  const lines = [];
  for (const [to, names] of [...file.imports.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    let spec = posix.relative(posix.dirname(rel(file.path)), rel(to)).replace(/\.ts$/, ".js");
    spec = spec.startsWith(".") ? spec : "./" + spec;
    lines.push(`import type { ${[...names].sort().join(", ")} } from "${spec}";`);
  }
  if (lines.length) lines.push("");
  lines.push(file.decls.map((d) => d.text).join("\n\n"));
  return lines.join("\n") + "\n";
};

// ---- rewrite the importers -------------------------------------------------------------------
// Only statements that actually resolve to web/types.ts (web/battle/core/types.ts and friends
// have the same file name and stay alone). Each file is read, rewritten and written in one go so
// the window in which another agent's save could be overwritten stays as small as possible, and
// only the import statement's own characters are replaced: the rest of the line, the file's
// line count and every other byte stay as they were.
let importerCount = 0;
let importStmtCount = 0;
for (const file of walk(WEB)) {
  if (resolve(file) === TYPES) continue;
  const text = readFileSync(file, "utf8");
  if (!text.includes("types.js")) continue;
  const mod = parse(rel(file), text);
  const lineOf = (node) => mod.getLineAndCharacterOfPosition(node.getStart(mod)).line + 1;
  const fileEdits = [];
  for (const st of mod.statements) {
    if (!ts.isImportDeclaration(st) || !st.importClause) continue;
    if (!ts.isStringLiteral(st.moduleSpecifier)) continue;
    const resolved = resolve(dirname(file), st.moduleSpecifier.text.replace(/\.js$/, ".ts"));
    if (resolved !== TYPES) continue;
    const clause = st.importClause;
    const nb = clause.namedBindings;
    if (!clause.isTypeOnly) die(`${rel(file)}:${lineOf(st)} imports from web/types.ts without \`import type\``);
    if (clause.name || !nb || !ts.isNamedImports(nb)) die(`${rel(file)}:${lineOf(st)}: unsupported import shape from web/types.ts`);
    const groups = new Map(); // target -> names
    for (const el of nb.elements) {
      const name = el.name.text;
      if (!moved.has(name)) die(`${rel(file)}:${lineOf(st)}: ${name} is not declared in web/types.ts`);
      const to = targetOf(moduleOf.get(name));
      if (!groups.has(to)) groups.set(to, []);
      groups.get(to).push(el.propertyName ? `${el.propertyName.text} as ${name}` : name);
    }
    const from = posix.dirname(rel(file));
    // join with the file's own line ending: some files are CRLF and a bare "\n" there would
    // leave a line the rest of the file does not have
    const eol = text.includes("\r\n") ? "\r\n" : "\n";
    const stmts = [...groups.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([to, names]) => {
        let spec = posix.relative(from, rel(to)).replace(/\.ts$/, ".js");
        spec = spec.startsWith(".") ? spec : "./" + spec;
        return `import type { ${[...new Set(names)].sort().join(", ")} } from "${spec}";`;
      });
    if (stmts.length === 1 && stmts[0] === text.slice(st.getStart(mod), st.getEnd())) continue; // already split
    fileEdits.push({ start: st.getStart(mod), end: st.getEnd(), text: stmts.join(eol) });
    importStmtCount++;
  }
  if (!fileEdits.length) continue;
  if (!dry) {
    let out = text;
    for (const ed of [...fileEdits].sort((a, b) => b.start - a.start)) {
      out = out.slice(0, ed.start) + ed.text + out.slice(ed.end);
    }
    writeFileSync(file, out);
  }
  importerCount++;
}

// ---- plan / apply ----------------------------------------------------------------------------
const summary = () => {
  const bytes = files.reduce((n, f) => n + render(f).length, 0);
  log(`${decls.length} declarations -> ${files.length} files, ${bytes} bytes of types`);
};
if (dry) {
  for (const f of files) log(`would write ${rel(f.path)} (${f.decls.length}: ${f.decls.map((d) => d.name).join(", ")}${f.imports.size ? `; needs ${[...f.imports.keys()].map(rel).join(", ")}` : ""})`);
  log(`would rewrite ${importerCount} importer(s), ${importStmtCount} import statement(s); would delete web/types.ts`);
  summary();
  process.exit(0);
}

for (const f of files) {
  mkdirSync(dirname(f.path), { recursive: true });
  writeFileSync(f.path, render(f));
}

// ---- the map ---------------------------------------------------------------------------------
const mapRows = files.map((f) => `| ${rel(f.path).replace(/^web\/types\//, "")} | ${f.decls.length} | types of ${f.module} |`);
const mapText = [
  "# web/types/",
  "TypeScript declarations only: nothing here is emitted, node's strip mode erases the whole file,",
  "so a broken import in this folder can never change the game. One file per module, named after the",
  "module the declarations came from (tools/rewrite/type-names.json), split out of web/types.ts by",
  "tools/rewrite/split-types.mjs.",
  "",
  "| file | types | job |",
  "|---|---|---|",
  ...mapRows,
  "",
  "Where to look for:",
  "- the shape of an object a module builds and fills in -> that module's file here",
  "- who imports a type -> `grep -rn \"types/<module>.js\" web/`",
  "",
].join("\n");
writeFileSync(join(OUT, "MAP.md"), mapText);

rmSync(TYPES);
log(`${decls.length} declarations -> ${files.length} files, ${importerCount} importer(s) rewritten, web/types.ts deleted`);
if (process.env.SPLIT_TYPES_VERBOSE) summary();
