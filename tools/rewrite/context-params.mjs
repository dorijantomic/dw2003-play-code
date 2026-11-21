#!/usr/bin/env node
// context-params: machine pass that copies parameter types from a context interface onto the
// untyped parameters of the functions that implement its members.
//
// web/battle.ts and web/battle3d.ts build one context object (`B: BattleContext`, `B$: Battle3DContext`)
// out of factories (makeX(B) returns { fn, ... } and Object.assign puts them on B). The interface
// (web/types/battle.ts, web/types/battle3d.ts) already says what each member takes, but the
// implementing function declarations are untyped, so strict mode reports TS7006 on every parameter and
// infer-types cannot help (it only looks at the body). This copies the interface's own parameter type
// onto the function of the same name when the type has no `any`.
// Type syntax only: `: T` / `?: T` insertions (and `import type` lines). Files whose non-strict check
// breaks, or whose strict error count rises, are put back.
//
//   node tools/rewrite/context-params.mjs         # apply
//   node tools/rewrite/context-params.mjs --dry   # report only
//
// After it: node tools/rewrite/same-js.mjs (all same) and npx tsc -p tsconfig.web.json (0 errors).
import ts from "typescript";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { runStrict } from "./strict-count.mjs";
import { execFileSync } from "node:child_process";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const dry = process.argv.includes("--dry");
// context interface file, interface name, folder(s) of the factories that fill it
const CONTEXTS = [
  { file: "web/types/battle.ts", name: "BattleContext", dirs: ["web/battle/core/", "web/battle.ts"] },
  { file: "web/types/battle3d.ts", name: "Battle3DContext", dirs: ["web/battle3d/core/", "web/battle3d.ts"] },
];
const BAD = /(?<![\w$.])(any|never)(?![\w$])/;

function load(configName) {
  const cfg = ts.readConfigFile(resolve(ROOT, configName), ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(cfg.config, ts.sys, ROOT);
  return ts.createProgram(parsed.fileNames, parsed.options);
}

function collect() {
  const prog = load("tsconfig.web.strict.json");
  const checker = prog.getTypeChecker();
  const edits = new Map(); // file -> [{pos, text}]
  let params = 0;
  for (const ctx of CONTEXTS) {
    const csf = prog.getSourceFile(resolve(ROOT, ctx.file));
    let iface;
    ts.forEachChild(csf, (n) => { if (ts.isInterfaceDeclaration(n) && n.name.text === ctx.name) iface = n; });
    const members = new Map();
    for (const m of iface.members) {
      if (!ts.isPropertySignature(m) || !m.type || !ts.isFunctionTypeNode(m.type)) continue;
      members.set(m.name.getText(), m.type);
    }
    for (const sf of prog.getSourceFiles()) {
      const rel = relative(ROOT, sf.fileName).split(sep).join("/");
      if (!ctx.dirs.some((d) => rel.startsWith(d))) continue;
      const visit = (n) => {
        if (ts.isFunctionDeclaration(n) && n.name && members.has(n.name.text) && n.body) {
          const decl = members.get(n.name.text);
          n.parameters.forEach((p, i) => {
            if (p.type || !ts.isIdentifier(p.name) || p.dotDotDotToken) return;
            const dp = decl.parameters[i];
            if (!dp || !dp.type || !ts.isIdentifier(dp.name)) return;
            const typeText = dp.type.getText();
            if (BAD.test(typeText)) return;
            // names the type uses must resolve in the target file; collect imports for the ones that do not
            const imports = [];
            let ok = true;
            const vis = (t) => {
              if (ts.isTypeReferenceNode(t) && ts.isIdentifier(t.typeName)) {
                let sym = checker.getSymbolAtLocation(t.typeName);
                if (sym && (sym.flags & ts.SymbolFlags.Alias)) sym = checker.getAliasedSymbol(sym);
                const d = sym?.declarations?.[0];
                const dsf = d?.getSourceFile();
                if (dsf && !dsf.hasNoDefaultLib && !/node_modules[\\/]typescript/.test(dsf.fileName)) {
                  const inScope = checker.getSymbolsInScope(n, ts.SymbolFlags.Type).some((s) => s.name === t.typeName.text && s.declarations?.some((x) => x.getSourceFile() === sf));
                  const local = sf === dsf;
                  if (!inScope && !local) imports.push({ name: t.typeName.text, from: dsf.fileName });
                  if (!d.getSourceFile().fileName.startsWith(ROOT)) ok = false;
                } else if (!dsf && !sym) ok = false;
              }
              ts.forEachChild(t, vis);
            };
            vis(dp.type);
            if (!ok) return;
            const q = dp.questionToken && !p.initializer ? "?" : "";
            const list = edits.get(sf.fileName) ?? [];
            list.push({ pos: p.name.end, text: `${q}: ${typeText}`, imports });
            edits.set(sf.fileName, list);
            params++;
          });
        }
        ts.forEachChild(n, visit);
      };
      visit(sf);
    }
  }
  return { edits, params };
}

function importLines(file, list) {
  const need = new Map(); // from -> Set(names)
  for (const e of list) for (const im of e.imports) {
    if (!need.has(im.from)) need.set(im.from, new Set());
    need.get(im.from).add(im.name);
  }
  const text = readFileSync(file, "utf8");
  const lines = [];
  for (const [from, names] of need) {
    let rel = relative(dirname(file), from).split(sep).join("/").replace(/\.d\.ts$/, "").replace(/\.ts$/, ".js");
    if (!rel.startsWith(".")) rel = "./" + rel;
    const have = new RegExp(`import[^;]*\\b(${[...names].join("|")})\\b[^;]*from`).test(text);
    const fresh = [...names].filter((n) => !new RegExp(`import[^;]*\\b${n}\\b[^;]*;`).test(text));
    if (fresh.length) lines.push(`import type { ${fresh.join(", ")} } from "${rel}";`);
    void have;
  }
  return lines;
}

function apply(file, list) {
  const text = readFileSync(file, "utf8");
  const sorted = [...list].sort((a, b) => b.pos - a.pos);
  let out = text;
  for (const e of sorted) out = out.slice(0, e.pos) + e.text + out.slice(e.pos);
  const imps = importLines(file, list);
  if (imps.length) {
    // after the last top-level import
    const m = [...out.matchAll(/^import [^;]*;\s*$/gm)];
    const at = m.length ? m[m.length - 1].index + m[m.length - 1][0].length : 0;
    out = out.slice(0, at) + "\n" + imps.join("\n") + out.slice(at);
  }
  writeFileSync(file, out);
}

function nonStrictErrorFiles() {
  let out = "";
  try { execFileSync("npx", ["tsc", "-p", "tsconfig.web.json", "--noEmit", "--pretty", "false"], { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 30 }); }
  catch (e) { out = `${e.stdout ?? ""}${e.stderr ?? ""}`; }
  const files = new Set();
  for (const l of out.split("\n")) { const m = /^(.+?)\(\d+,\d+\): error/.exec(l); if (m) { files.add(resolve(ROOT, m[1])); if (process.env.CP_VERBOSE) console.log("    " + l.slice(0, 230)); } }
  return files;
}

const { edits, params } = collect();
console.log(`context-params: ${params} parameters in ${edits.size} files`);
if (dry) { for (const [f, l] of edits) console.log(`  ${relative(ROOT, f)} ${l.length}`); process.exit(0); }
const before = runStrict();
const orig = new Map();
for (const [f, l] of edits) { orig.set(f, readFileSync(f, "utf8")); apply(f, l); }
let active = new Set(edits.keys());
for (let round = 0; round < 6; round++) {
  const bad = nonStrictErrorFiles();
  const putBack = [...active].filter((f) => bad.has(f));
  if (!bad.size) break;
  if (!putBack.length) { console.log("  errors outside edited files:", [...bad].map((f) => relative(ROOT, f)).join(" ")); break; }
  for (const f of putBack) { writeFileSync(f, orig.get(f)); active.delete(f); }
  console.log(`  round ${round + 1}: put back ${putBack.length} files (non-strict errors)`);
}
const after = runStrict();
for (const f of [...active]) {
  const rel = relative(ROOT, f).split(sep).join("/");
  if ((after.files.get(rel) ?? 0) > (before.files.get(rel) ?? 0)) {
    writeFileSync(f, orig.get(f)); active.delete(f);
    console.log(`  put back ${rel}: strict ${before.files.get(rel) ?? 0} -> ${after.files.get(rel) ?? 0}`);
  }
}
const end = runStrict();
console.log(`context-params: strict ${before.total} -> ${end.total}, ${active.size} files kept`);
