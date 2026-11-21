#!/usr/bin/env node
// callsite-params: machine pass that types untyped function parameters (TS7006 under the strict config)
// from their CALL SITES. infer-types only reads the function body; this reads the callers.
//
// For every function-like node with an untyped identifier parameter it collects each call / new
// expression whose resolved signature declaration is that function, takes the checker's type of the
// argument at the parameter's position, widens literals ("a" -> string, 3 -> number) and unions them.
// The annotation is written only when
//   - the function is never used as a value (every reference is a callee or its declaration/import/export),
//   - there is at least one call, no call uses a spread argument,
//   - no argument type is or contains any / never / unknown / {} / object / Function, or a type
//     parameter, and the printed type is under MAX_LEN characters,
//   - a call that leaves the argument out makes the parameter optional (`p?: T`), only if every later
//     parameter is optional too.
// Named types the caller's file can see but the callee's file cannot are added as `import type`.
// Type syntax only (`: T`, `?: T`, `import type` lines). Files whose non-strict check breaks are put
// back (and retried edit by edit), files whose strict error count rises are put back. Rounds repeat
// while the strict count drops (earlier types feed later ones).
//
//   node tools/rewrite/callsite-params.mjs              # rounds until the count stops dropping
//   node tools/rewrite/callsite-params.mjs --rounds 1   # one round
//   node tools/rewrite/callsite-params.mjs --dry        # report only, write nothing
//
// After it: node tools/rewrite/same-js.mjs (all same) and npx tsc -p tsconfig.web.json (0 errors).
import ts from "typescript";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { runStrict } from "./strict-count.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = process.argv.slice(2);
const dry = args.includes("--dry");
const ri = args.indexOf("--rounds");
const maxRounds = ri >= 0 ? Number(args[ri + 1]) : 8;
const MAX_LEN = 120;
const BAD_TEXT = /(?<![\w$.])(any|never|unknown|object|Function)(?![\w$])|\{\s*\}/;
const FLAGS = ts.NodeBuilderFlags.NoTruncation;

function loadProgram() {
  const cfg = ts.readConfigFile(resolve(ROOT, "tsconfig.web.strict.json"), ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(cfg.config, ts.sys, ROOT);
  return ts.createProgram(parsed.fileNames, parsed.options);
}

const isFn = (n) => ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n) ||
  ts.isMethodDeclaration(n) || ts.isConstructorDeclaration(n);

// bad type anywhere inside (union / intersection / type arguments), or a type parameter
function badType(checker, t, seen = new Set(), depth = 0) {
  if (seen.has(t) || depth > 6) return false;
  seen.add(t);
  const F = ts.TypeFlags;
  if (t.flags & (F.Any | F.Never | F.Unknown | F.TypeParameter | F.Index | F.IndexedAccess | F.Conditional | F.Substitution | F.UniqueESSymbol | F.NonPrimitive | F.Void)) return true;
  if (t.isUnionOrIntersection()) return t.types.some((x) => badType(checker, x, seen, depth + 1));
  if (t.flags & F.Object) {
    const ot = t;
    if (ot.objectFlags & ts.ObjectFlags.Reference) {
      for (const a of checker.getTypeArguments(t)) if (badType(checker, a, seen, depth + 1)) return true;
    }
    // function / object types: signature parameter and return types
    for (const s of t.getCallSignatures()) {
      for (const p of s.getParameters()) if (badType(checker, checker.getTypeOfSymbol(p), seen, depth + 1)) return true;
      if (badType(checker, s.getReturnType(), seen, depth + 1)) return true;
    }
  }
  return false;
}

function collect(prog) {
  const checker = prog.getTypeChecker();
  const sfs = prog.getSourceFiles().filter((f) => !f.isDeclarationFile && f.fileName.startsWith(ROOT) && !/node_modules/.test(f.fileName));

  // 1. untyped parameters (TS7006 positions)
  const bad7006 = new Map(); // file -> Set(pos)
  for (const sf of sfs) {
    for (const d of prog.getSemanticDiagnostics(sf)) {
      if (d.code !== 7006 || d.start === undefined) continue;
      if (!bad7006.has(sf.fileName)) bad7006.set(sf.fileName, new Set());
      bad7006.get(sf.fileName).add(d.start);
    }
  }
  const fnInfo = new Map(); // fn node -> { sf, params: [param nodes to type] }
  for (const sf of sfs) {
    const want = bad7006.get(sf.fileName);
    if (!want) continue;
    const visit = (n) => {
      if (isFn(n)) {
        for (const p of n.parameters) {
          if (!want.has(p.name.getStart(sf)) || !ts.isIdentifier(p.name) || p.type || p.initializer || p.dotDotDotToken) continue;
          if (ts.isArrowFunction(n) && !/\(/.test(sf.text.slice(n.getStart(sf), p.getStart(sf)))) continue; // x => ... (no parens)
          if (!fnInfo.has(n)) fnInfo.set(n, { sf, params: [] });
          fnInfo.get(n).params.push(p);
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }

  // 2. symbols of those functions
  const symOf = (n) => {
    let nameNode;
    if (n.name && (ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n) || ts.isFunctionExpression(n))) nameNode = n.name;
    if (ts.isMethodDeclaration(n) && ts.isClassLike(n.parent)) {
      if (n.parent.heritageClauses?.length) return undefined; // implements / extends: calls may go through the other type
    }
    if (!nameNode && n.parent) {
      if (ts.isVariableDeclaration(n.parent) && n.parent.initializer === n && ts.isIdentifier(n.parent.name)) nameNode = n.parent.name;
      else if (ts.isPropertyAssignment(n.parent) && n.parent.initializer === n && ts.isIdentifier(n.parent.name)) nameNode = n.parent.name;
    }
    if (!nameNode) return undefined;
    return checker.getSymbolAtLocation(nameNode);
  };
  const fnBySym = new Map(); // symbol -> fn node
  const escaped = new Set(); // fn nodes
  for (const n of fnInfo.keys()) {
    const s = symOf(n);
    if (!s) { escaped.add(n); continue; }
    // two declarations merged under one symbol (overloads): skip
    if (fnBySym.has(s) || (s.declarations && s.declarations.length > 1 && !ts.isVariableDeclaration(s.declarations[0]))) { escaped.add(n); escaped.add(fnBySym.get(s)); continue; }
    fnBySym.set(s, n);
  }
  const names = new Set([...fnBySym.keys()].map((s) => s.name));
  const resolveAlias = (s) => (s && (s.flags & ts.SymbolFlags.Alias) ? checker.getAliasedSymbol(s) : s);

  // 3. walk everything once: escapes (non-call references) and call sites
  const calls = new Map(); // fn node -> [{ args, sf }]
  const walk = (sf) => {
    const visit = (n) => {
      if (ts.isIdentifier(n) && names.has(n.text)) {
        let s = checker.getSymbolAtLocation(n);
        if (!s && ts.isShorthandPropertyAssignment(n.parent)) s = checker.getShorthandAssignmentValueSymbol(n.parent);
        s = resolveAlias(s);
        const fn = s && fnBySym.get(s);
        if (fn) {
          const p = n.parent;
          let ok = false;
          if (p === fn || p === fn.parent && (ts.isVariableDeclaration(p) || ts.isPropertyAssignment(p)) && p.name === n) ok = true; // declaration
          else if ((ts.isCallExpression(p) || ts.isNewExpression(p)) && p.expression === n) ok = true;
          else if (ts.isPropertyAccessExpression(p) && p.name === n && (ts.isCallExpression(p.parent) || ts.isNewExpression(p.parent)) && p.parent.expression === p) ok = true;
          else if (ts.isImportSpecifier(p) || ts.isExportSpecifier(p) || ts.isImportClause(p)) ok = true;
          else if (ts.isExportAssignment(p)) ok = false;
          if (!ok) escaped.add(fn);
        }
      }
      if (ts.isCallExpression(n) || ts.isNewExpression(n)) {
        let sig;
        try { sig = checker.getResolvedSignature(n); } catch { sig = undefined; }
        const d = sig?.declaration;
        if (d && fnInfo.has(d)) {
          if (!calls.has(d)) calls.set(d, []);
          calls.get(d).push({ args: n.arguments ?? [], sf });
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  };
  for (const sf of sfs) walk(sf);

  // 4. decide per function
  const edits = new Map(); // file -> [{ pos, text, imports:[{name, spec}] }]
  const stats = { params: 0, typed: 0, noCalls: 0, escaped: 0, badType: 0, long: 0, spread: 0, other: 0 };
  for (const [fn, info] of fnInfo) {
    stats.params += info.params.length;
    if (escaped.has(fn)) { stats.escaped += info.params.length; continue; }
    const cs = calls.get(fn);
    if (!cs || !cs.length) { stats.noCalls += info.params.length; continue; }
    if (cs.some((c) => c.args.some((a) => ts.isSpreadElement(a)))) { stats.spread += info.params.length; continue; }
    const decided = new Map(); // param -> { text, optional, imports } | null
    for (const p of fn.parameters) {
      if (!info.params.includes(p)) continue;
      const i = fn.parameters.indexOf(p);
      const types = [];
      let optional = false, bad = false;
      for (const c of cs) {
        const a = c.args[i];
        if (!a) { optional = true; continue; }
        const t0 = checker.getTypeAtLocation(a);
        const t = checker.getBaseTypeOfLiteralType(checker.getWidenedType ? checker.getWidenedType(t0) : t0);
        if (badType(checker, t)) { bad = true; break; }
        types.push(t);
      }
      if (bad || !types.length) { decided.set(p, null); stats.badType++; continue; }
      // union (dedupe by identity; the union type does the rest)
      const u = types.length === 1 ? types[0] : checker.getUnionType ? checker.getUnionType(types) : types[0];
      if (badType(checker, u)) { decided.set(p, null); stats.badType++; continue; }
      const node = checker.typeToTypeNode(u, p, FLAGS);
      if (!node) { decided.set(p, null); stats.other++; continue; }
      const imports = [];
      let okNode = true;
      const tr = (ctx) => {
        const vis = (x) => {
          if (ts.isImportTypeNode(x)) {
            if (x.isTypeOf || !x.qualifier || !ts.isIdentifier(x.qualifier) || !ts.isLiteralTypeNode(x.argument) || !ts.isStringLiteral(x.argument.literal)) { okNode = false; return x; }
            const name = x.qualifier.text;
            const spec = x.argument.literal.text;
            imports.push({ name, spec });
            const targs = x.typeArguments?.map((a) => ts.visitNode(a, vis));
            return ts.factory.createTypeReferenceNode(name, targs);
          }
          return ts.visitEachChild(x, vis, ctx);
        };
        return (root) => ts.visitNode(root, vis);
      };
      const res = ts.transform(node, [tr]);
      const out = res.transformed[0];
      const text = ts.createPrinter({ removeComments: true }).printNode(ts.EmitHint.Unspecified, out, info.sf);
      res.dispose();
      if (/^(null|undefined|null \| undefined|undefined \| null)$/.test(text)) { decided.set(p, null); stats.badType++; continue; }
      if (!okNode || text.length > MAX_LEN || BAD_TEXT.test(text) || /\n|import\(|typeof /.test(text)) { decided.set(p, null); stats.long++; continue; }
      // import names must not clash with another binding of the same name visible in the file
      const scope = checker.getSymbolsInScope(p, ts.SymbolFlags.Type | ts.SymbolFlags.Value | ts.SymbolFlags.Alias);
      if (imports.some((im) => scope.some((s) => s.name === im.name))) { decided.set(p, null); stats.other++; continue; }
      if (new Set(imports.map((im) => im.name)).size !== new Set(imports.map((im) => im.name + "|" + im.spec)).size) { decided.set(p, null); stats.other++; continue; }
      decided.set(p, { text, optional: optional && !p.questionToken, imports });
    }
    // optional `?` only when every later parameter is optional / defaulted / rest / also `?`
    const ps = fn.parameters;
    for (let i = ps.length - 1; i >= 0; i--) {
      const d = decided.get(ps[i]);
      if (!d || !d.optional) continue;
      for (let j = i + 1; j < ps.length; j++) {
        const q = ps[j];
        const dj = decided.get(q);
        const okLater = q.questionToken || q.initializer || q.dotDotDotToken || (dj && dj.optional);
        if (!okLater) { decided.set(ps[i], null); break; }
      }
    }
    for (const p of info.params) {
      const d = decided.get(p);
      if (!d) continue;
      const list = edits.get(info.sf.fileName) ?? [];
      const pos = p.questionToken ? p.questionToken.end : p.name.end;
      list.push({ pos, text: `${d.optional ? "?" : ""}: ${d.text}`, imports: d.imports, fn: fn.getStart(info.sf), fnEnd: fn.end, touch: new Set([info.sf.fileName, ...cs.map((c) => c.sf.fileName)]) });
      edits.set(info.sf.fileName, list);
      stats.typed++;
    }
  }
  return { edits, stats };
}

function importLines(file, list, text) {
  const need = new Map(); // spec -> Set(names)
  for (const e of list) for (const im of e.imports) {
    if (!need.has(im.spec)) need.set(im.spec, new Set());
    need.get(im.spec).add(im.name);
  }
  const lines = [];
  for (const [spec0, names] of need) {
    let spec = spec0;
    if (/^\.{0,2}\//.test(spec) || spec.startsWith("/")) {
      if (spec.startsWith("/")) spec = relative(dirname(file), spec).split(sep).join("/");
      if (!spec.startsWith(".")) spec = "./" + spec;
      spec = spec.replace(/\.d\.ts$/, "").replace(/\.ts$/, "");
      if (!/\.m?js$/.test(spec)) spec += ".js";
    }
    const fresh = [...names].filter((n) => !new RegExp(`import[^;]*\\b${n}\\b[^;]*;`).test(text));
    if (fresh.length) lines.push(`import type { ${fresh.join(", ")} } from "${spec}";`);
  }
  return lines;
}

const toOrigMaps = new Map(); // file -> (position in the written text) => position in the original text
function apply(file, text, list) {
  let out = text;
  const asc = [...list].sort((a, b) => a.pos - b.pos);
  for (const e of [...asc].reverse()) out = out.slice(0, e.pos) + e.text + out.slice(e.pos);
  let at = -1, addLen = 0;
  const imps = importLines(file, list, text);
  if (imps.length) {
    const m = [...out.matchAll(/^import [^;]*;\s*$/gm)];
    at = m.length ? m[m.length - 1].index + m[m.length - 1][0].length : 0;
    const ins = "\n" + imps.join("\n");
    addLen = ins.length;
    out = out.slice(0, at) + ins + out.slice(at);
  }
  toOrigMaps.set(file, (pos) => {
    const p1 = at >= 0 && pos >= at ? Math.max(at, pos - addLen) : pos;
    let shift = 0, res = p1;
    for (const e of asc) {
      const start = e.pos + shift;
      if (p1 >= start + e.text.length) { shift += e.text.length; res = p1 - shift; }
      else if (p1 >= start) { res = e.pos; break; }
      else break;
    }
    return res;
  });
  return out;
}

function nonStrictErrors() {
  let out = "";
  try { execFileSync("npx", ["tsc", "-p", "tsconfig.web.json", "--noEmit", "--pretty", "false"], { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 30, stdio: ["ignore", "pipe", "pipe"] }); }
  catch (e) { out = `${e.stdout ?? ""}${e.stderr ?? ""}`; }
  const files = new Map(); // file -> [{ line, col }]
  for (const l of out.split("\n")) {
    const m = /^(.+?)\((\d+),(\d+)\): error/.exec(l);
    if (!m) continue;
    const f = resolve(ROOT, m[1]);
    if (!files.has(f)) files.set(f, []);
    files.get(f).push({ line: Number(m[2]), col: Number(m[3]) });
    if (process.env.CP_ERRS) console.log("    " + l.slice(0, 260));
  }
  return files;
}
const nonStrictErrorFiles = () => new Set(nonStrictErrors().keys());

// write `chosen` edits per file; returns the original texts
function writeAll(edits, orig) {
  for (const [f, l] of edits) {
    if (!orig.has(f)) orig.set(f, readFileSync(f, "utf8"));
    writeFileSync(f, l.length ? apply(f, orig.get(f), l) : orig.get(f));
  }
}

function round(n) {
  const prog = loadProgram();
  const { edits, stats } = collect(prog);
  console.log(`round ${n}: ${JSON.stringify(stats)} in ${edits.size} files`);
  if (dry) { const all = [...edits.values()].flat(); const seen = new Map(); for (const e of all) seen.set(e.text, (seen.get(e.text) ?? 0) + 1); console.log([...seen].sort((a,b)=>b[1]-a[1]).slice(0,40).map(([t,c])=>c+" "+t).join("|")); console.log("imports:", [...new Set(all.flatMap(e=>e.imports.map(i=>i.name+" from "+i.spec)))].slice(0,15).join(" ; ")); }
  if (dry || !edits.size) return 0;
  const before = runStrict();
  const orig = new Map();
  const cur = new Map(edits); // file -> edit list currently written
  writeAll(cur, orig);
  // non-strict errors: drop every edit that touches an erroring file (the function lives there or is called from there)
  for (let pass = 0; pass < 12; pass++) {
    const errs = nonStrictErrors();
    if (!errs.size) break;
    const dropFn = new Map(); // file -> Set(function start): the error sits inside that edited function
    const coarse = new Set(); // erroring files not explained by an edited function inside them
    for (const [f, list] of errs) {
      const l = cur.get(f);
      const map = toOrigMaps.get(f);
      if (!l || !l.length || !map) { coarse.add(f); continue; }
      const text = readFileSync(f, "utf8");
      const lineStart = [0];
      for (let k = 0; k < text.length; k++) if (text.charCodeAt(k) === 10) lineStart.push(k + 1);
      for (const er of list) {
        const pos = map((lineStart[er.line - 1] ?? 0) + er.col - 1);
        const inside = l.filter((e) => e.fn <= pos && pos < e.fnEnd);
        if (!inside.length) { coarse.add(f); continue; }
        const inner = inside.reduce((a, b) => (b.fn >= a.fn ? b : a));
        if (!dropFn.has(f)) dropFn.set(f, new Set());
        dropFn.get(f).add(inner.fn);
      }
    }
    const changed = new Map();
    for (const [f, l] of cur) {
      const nl = l.filter((e) => !dropFn.get(f)?.has(e.fn) && ![...coarse].some((x) => e.touch.has(x)));
      if (nl.length !== l.length) { cur.set(f, nl); changed.set(f, nl); }
    }
    if (!changed.size) { console.log("  errors not explained by an edit:", [...errs.keys()].map((f) => relative(ROOT, f)).join(" ")); break; }
    writeAll(changed, orig);
    console.log(`  pass ${pass + 1}: ${errs.size} erroring files (${coarse.size} coarse), rewrote ${changed.size}`);
  }
  // errors elsewhere (callers broken by an edit in a file we cannot locate): put everything back
  if (nonStrictErrorFiles().size) {
    for (const [f, t] of orig) writeFileSync(f, t);
    console.log("  non-strict errors remain: round undone");
    return 0;
  }
  const after = runStrict();
  // files whose own strict count rose: put back, then win back function groups by halving
  const relOf = (f) => relative(ROOT, f).split(sep).join("/");
  const accepted = new Map(), unresolved = new Map();
  for (const [f, l] of cur) {
    const rel = relOf(f);
    if (!l.length || (after.files.get(rel) ?? 0) <= (before.files.get(rel) ?? 0)) continue;
    const byFn = new Map();
    for (const e of l) { if (!byFn.has(e.fn)) byFn.set(e.fn, []); byFn.get(e.fn).push(e); }
    accepted.set(f, []);
    unresolved.set(f, [[...byFn.values()]]);
    writeFileSync(f, orig.get(f)); cur.set(f, []);
  }
  console.log(`  ${accepted.size} files rose; refining by function groups`);
  for (let level = 0; level < 7 && [...unresolved.values()].some((g) => g.length); level++) {
    const next = new Map([...accepted.keys()].map((f) => [f, []]));
    for (const side of [0, 1]) {
      const trial = new Map();
      for (const [f, groups] of unresolved) {
        const part = [];
        for (const g of groups) {
          const h = Math.ceil(g.length / 2);
          const half = side === 0 ? g.slice(0, h) : g.slice(h);
          if (half.length) part.push(half);
        }
        trial.set(f, part);
        if (part.length) writeFileSync(f, apply(f, orig.get(f), [...accepted.get(f), ...part.flat(2)]));
      }
      const r = runStrict();
      for (const [f, part] of trial) {
        if (!part.length) continue;
        const ok = (r.files.get(relOf(f)) ?? 0) <= (before.files.get(relOf(f)) ?? 0);
        if (ok) accepted.get(f).push(...part.flat(2));
        else for (const g of part) if (g.length > 1) next.get(f).push(g);
        writeFileSync(f, accepted.get(f).length ? apply(f, orig.get(f), accepted.get(f)) : orig.get(f));
        cur.set(f, accepted.get(f));
      }
    }
    unresolved.clear();
    for (const [f, g] of next) unresolved.set(f, g);
    console.log(`  refine level ${level + 1}: ${[...unresolved.values()].reduce((a, g) => a + g.length, 0)} groups left`);
  }
  if (nonStrictErrorFiles().size) {
    for (const [f, t] of orig) writeFileSync(f, t);
    console.log("  non-strict errors after refine: round undone");
    return 0;
  }
  const end = runStrict();
  if (end.total >= before.total) {
    for (const [f, t] of orig) writeFileSync(f, t);
    console.log(`  strict ${before.total} -> ${end.total}: round undone`);
    return 0;
  }
  console.log(`  strict ${before.total} -> ${end.total}, TS7006 ${before.codes.get("TS7006") ?? 0} -> ${end.codes.get("TS7006") ?? 0}`);
  return before.total - end.total;
}

for (let r = 1; r <= maxRounds; r++) {
  const gained = round(r);
  if (dry || gained <= 0) break;
}
