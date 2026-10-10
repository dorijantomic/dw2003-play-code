#!/usr/bin/env node
// Compiler-API census. It reports unresolved imports/callbacks as obligations
// instead of guessing reachability from matching identifier names.
import ts from "typescript";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(argValue("--root") ?? process.cwd());
const webDir = path.join(root, "web");
const sourceFiles = ["engine", "web", "tools/engine-convert"].flatMap((dir) => walk(path.join(root, dir))
  .filter((file) => /\.(ts|js)$/.test(file) && rel(file) !== "web/vendor/engine.js"));
const compilerOptions = {
  allowJs: true, checkJs: false, target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.NodeNext,
};
const program = ts.createProgram(sourceFiles, compilerOptions);
const byAbsolutePath = new Map(sourceFiles.map((file) => [path.resolve(file), rel(file)]));
const moduleRows = [];

for (const file of sourceFiles) {
  const source = program.getSourceFile(file);
  if (!source) continue;
  const row = {
    path: rel(file),
    kind: rel(file).startsWith("engine/") ? "engine" : rel(file).startsWith("web/") ? "web" : "converter",
    imports: [], exports: [], reexports: [], functions: [], calls: [], registrations: [],
    data_paths: [], unresolved_dynamic_imports: [],
  };
  walkNode(source, (node) => inspectNode(node, source, row));
  row.imports = uniqueRows(row.imports, (item) => `${item.kind}\0${item.specifier}\0${item.target ?? ""}`);
  row.exports = [...new Set(row.exports)].sort();
  row.reexports = uniqueRows(row.reexports, (item) => `${item.specifier}\0${item.names.join(",")}`);
  row.calls = uniqueRows(row.calls, (item) => `${item.callee}\0${item.line}`);
  row.data_paths = [...new Set(row.data_paths)].sort();
  row.functions.sort();
  row.registrations = uniqueRows(row.registrations, (item) => `${item.kind}\0${item.callee}\0${item.line}`);
  row.unresolved_dynamic_imports = [...new Set(row.unresolved_dynamic_imports)].sort();
  moduleRows.push(row);
}

const htmlEntrypoints = walk(webDir).filter((file) => file.endsWith(".html")).flatMap((file) => {
  const html = fs.readFileSync(file, "utf8");
  const scripts = [...html.matchAll(/<script\b[^>]*\btype=["']module["'][^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)]
    .map((match) => resolveSpecifier(match[1], file));
  return [{ html: rel(file), category: rel(file) === "web/index.html" ? "production" : "lab_or_test", scripts }];
});
const productionRoots = htmlEntrypoints.filter((row) => row.category === "production").flatMap((row) => row.scripts);
const labRoots = htmlEntrypoints.filter((row) => row.category === "lab_or_test").flatMap((row) => row.scripts);
const edges = new Map(moduleRows.map((row) => [row.path, row.imports.flatMap((item) => item.target ? [item.target] : [])]));
// The generated browser bundle has exactly one authored source owner. It is a
// bridge edge, not a second population of engine symbols.
if (productionRoots.includes("web/game.js")) edges.get("web/game.js")?.push("engine/index.ts");
const productionReachable = closure(productionRoots, edges);
const labReachable = closure(labRoots, edges);

for (const row of moduleRows) {
  row.reachability = productionReachable.has(row.path) ? "production" : "unresolved";
  if (row.reachability !== "production" && /\.test\.[jt]s$/.test(row.path)) {
    row.reachability = "test_only";
  } else if (row.reachability !== "production" && labReachable.has(row.path)) {
    row.reachability = "lab_only";
  }
}
moduleRows.sort((a, b) => a.path.localeCompare(b.path));
const externalImports = moduleRows.flatMap((row) => row.imports
  .filter((item) => item.target === null && !item.specifier.startsWith("."))
  .map((item) => ({ from: row.path, ...item })));
const unresolvedStaticImports = moduleRows.flatMap((row) => row.imports
  .filter((item) => item.target === null && item.specifier.startsWith("."))
  .map((item) => ({ from: row.path, ...item })));

console.log(JSON.stringify({
  schema_version: 2,
  generated_by: "tools/rosetta_source_census.mjs",
  production_entrypoints: htmlEntrypoints.filter((entry) => entry.category === "production"),
  lab_or_test_entrypoints: htmlEntrypoints.filter((entry) => entry.category === "lab_or_test"),
  generated_bridges: [{ from: "web/vendor/engine.js", to: "engine/index.ts", kind: "generated_bundle" }],
  summary: {
    files: moduleRows.length,
    engine: moduleRows.filter((row) => row.kind === "engine").length,
    web: moduleRows.filter((row) => row.kind === "web").length,
    converter: moduleRows.filter((row) => row.kind === "converter").length,
    production_reachable: moduleRows.filter((row) => row.reachability === "production").length,
    lab_only: moduleRows.filter((row) => row.reachability === "lab_only").length,
    test_only: moduleRows.filter((row) => row.reachability === "test_only").length,
    unresolved: moduleRows.filter((row) => row.reachability === "unresolved").length,
    unresolved_static_imports: unresolvedStaticImports.length,
    external_imports: externalImports.length,
    unresolved_dynamic_imports: moduleRows.reduce((sum, row) => sum + row.unresolved_dynamic_imports.length, 0),
  },
  unresolved_static_imports: unresolvedStaticImports,
  external_imports: externalImports,
  files: moduleRows,
}, null, 2));

function inspectNode(node, source, row) {
  if (ts.isImportDeclaration(node)) {
    const names = [];
    if (node.importClause?.name) names.push(node.importClause.name.text);
    const bindings = node.importClause?.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) names.push(`* as ${bindings.name.text}`);
    if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) names.push(element.propertyName?.text ?? element.name.text);
    }
    addImport(row, source, node.moduleSpecifier, "static", names);
  }
  if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
    addImport(row, source, node.moduleSpecifier, "re_export");
    row.reexports.push({
      specifier: node.moduleSpecifier.text,
      names: node.exportClause && ts.isNamedExports(node.exportClause)
        ? node.exportClause.elements.map((element) => element.name.text).sort()
        : ["*"],
    });
  }
  if (ts.isExportAssignment(node)) row.exports.push("default");
  if (ts.isFunctionDeclaration(node) && node.name) {
    row.functions.push(node.name.text);
    if (hasExportModifier(node)) row.exports.push(node.name.text);
  }
  if (ts.isClassDeclaration(node) && node.name && hasExportModifier(node)) row.exports.push(node.name.text);
  if (ts.isInterfaceDeclaration(node) && hasExportModifier(node)) row.exports.push(node.name.text);
  if (ts.isTypeAliasDeclaration(node) && hasExportModifier(node)) row.exports.push(node.name.text);
  if (ts.isEnumDeclaration(node) && hasExportModifier(node)) row.exports.push(node.name.text);
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer &&
      (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) {
    row.functions.push(node.name.text);
    if (node.parent?.parent && hasExportModifier(node.parent.parent)) row.exports.push(node.name.text);
  }
  if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
    const arg = node.arguments[0];
    if (arg && ts.isStringLiteralLike(arg)) addImport(row, source, arg, "dynamic");
    else row.unresolved_dynamic_imports.push(`${line(source, node.getStart(source))}:${node.getText(source)}`);
  }
  if (ts.isCallExpression(node)) {
    const callee = node.expression.getText(source);
    row.calls.push({ callee, line: line(source, node.getStart(source)) });
    const kind = registrationKind(callee);
    if (kind) row.registrations.push({ kind, callee, line: line(source, node.getStart(source)) });
  }
  if (ts.isStringLiteralLike(node) && isDataPath(node.text)) row.data_paths.push(node.text);
}
function hasExportModifier(node) {
  return !!node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
}
function isDataPath(value) {
  // Fragment guard: concatenation pieces such as ".json" (mapId + ".json" in
  // web/editor.js, web/sceneEditor.js, web/game.js) and directory prefixes
  // such as "web/assets/data/" (const D in tools/engine-convert/load-real.ts)
  // are not paths. Require a basename character around the match.
  return /(?:assets\/data\/\S|assets\/.+\.(?:json|png|jpg|jpeg|webp|wav|mp3)|[^\s\/]\.json$|[^\s\/]\.toml$)/i.test(value);
}
function addImport(row, source, specifierNode, kind, names = []) {
  const specifier = String(specifierNode.text);
  row.imports.push({ kind, specifier, names: [...names].sort(), target: resolveSpecifier(specifier, source.fileName) });
}
function resolveSpecifier(specifier, containingFile) {
  const browserRelative = containingFile.endsWith(".html") && !specifier.includes(":") && !specifier.startsWith("/");
  if (!specifier.startsWith(".") && !browserRelative) return null;
  const resolverSpecifier = browserRelative && !specifier.startsWith(".") ? `./${specifier}` : specifier;
  const resolved = ts.resolveModuleName(resolverSpecifier, containingFile, compilerOptions, ts.sys).resolvedModule?.resolvedFileName;
  if (!resolved) return null;
  const target = byAbsolutePath.get(path.resolve(resolved));
  return rel(resolved) === "web/vendor/engine.js" ? "engine/index.ts" : target ?? null;
}
function registrationKind(callee) {
  if (callee.endsWith(".addEventListener") || callee === "addEventListener") return "event_listener";
  if (/^(register|.*\.register)[A-Z_]/.test(callee)) return "registration";
  if (/set(?:Timeout|Interval)$/.test(callee)) return "scheduled_callback";
  if (/(?:handler|callback)/i.test(callee)) return "callback_wiring";
  return null;
}
function closure(roots, edges) {
  const found = new Set(roots);
  const pending = [...roots];
  while (pending.length) {
    for (const target of edges.get(pending.pop()) ?? []) {
      if (!found.has(target)) { found.add(target); pending.push(target); }
    }
  }
  return found;
}
function uniqueRows(rows, key) {
  return [...new Map(rows.map((row) => [key(row), row])).values()]
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}
function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}
function walkNode(node, visit) { visit(node); ts.forEachChild(node, (child) => walkNode(child, visit)); }
function line(source, offset) { return source.getLineAndCharacterOfPosition(offset).line + 1; }
function rel(file) { return path.relative(root, file).split(path.sep).join("/"); }
function argValue(name) { const at = process.argv.indexOf(name); return at < 0 ? null : process.argv[at + 1] ?? null; }
