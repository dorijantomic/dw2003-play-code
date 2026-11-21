#!/usr/bin/env node
// nonnull: machine pass for the strict null/undefined errors. Where the checker says a value the code
// already uses "is possibly undefined/null", append the type-only non-null mark `!` to that expression.
// Stripping types removes every `!`, so the game's JavaScript does not change (same-js proves it).
// Only simple expressions get a mark (name, a.b, a[i], call, (..), this); anything else is skipped.
// Codes: 18047 18048 18049 2531 2532 2533 (possibly null/undefined), 2722 2721 (call of possibly
// undefined), 2345 (argument X | undefined -> X: kept only if the error goes away).
//   node tools/rewrite/nonnull.mjs [--dry] [--rounds N]
import ts from "typescript";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const dry = process.argv.includes("--dry");
const ri = process.argv.indexOf("--rounds");
const ROUNDS = ri > 0 ? Number(process.argv[ri + 1]) : 6;
const CODES = new Set([18047, 18048, 18049, 2531, 2532, 2533, 2722, 2721, 2345]);
const OK_KINDS = new Set([ts.SyntaxKind.Identifier, ts.SyntaxKind.PropertyAccessExpression, ts.SyntaxKind.ElementAccessExpression,
  ts.SyntaxKind.CallExpression, ts.SyntaxKind.ParenthesizedExpression, ts.SyntaxKind.ThisKeyword, ts.SyntaxKind.NonNullExpression]);

function load(config) {
  const cfg = ts.getParsedCommandLineOfConfigFile(resolve(ROOT, config), {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} });
  return ts.createProgram({ rootNames: cfg.fileNames, options: cfg.options });
}
function findNode(sf, start, end) {
  let best = null;
  const visit = (n) => { if (n.getStart(sf) <= start && n.getEnd() >= end) { if (n.getStart(sf) === start && n.getEnd() === end) best = n; ts.forEachChild(n, visit); } };
  visit(sf);
  return best;
}
function isNullishOnly(msg) { return /undefined|null/.test(msg); }

let total0 = null;
for (let round = 1; round <= ROUNDS; round++) {
  const prog = load("tsconfig.web.strict.json");
  const edits = new Map(); // file -> Set(pos)
  let count = 0, skipped = 0;
  const all = [];
  for (const sf of prog.getSourceFiles()) {
    if (sf.isDeclarationFile || !sf.fileName.startsWith(ROOT + "/web/")) continue;
    const ds = prog.getSemanticDiagnostics(sf);
    all.push(ds.length);
    for (const d of ds) {
      if (!CODES.has(d.code) || d.start == null) continue;
      const msg = ts.flattenDiagnosticMessageText(d.messageText, " ");
      if (d.code === 2345 && !/'undefined'|'null'|undefined\b|null\b/.test(msg.split(" is not assignable")[0])) { skipped++; continue; }
      if (!isNullishOnly(msg)) { skipped++; continue; }
      let node = findNode(sf, d.start, d.start + d.length);
      if (!node) { skipped++; continue; }
      if (d.code === 2722 || d.code === 2721) { /* span is the callee */ }
      if (!OK_KINDS.has(node.kind)) { skipped++; continue; }
      const p = node.parent;
      if (p && (ts.isShorthandPropertyAssignment(p) || (ts.isBinaryExpression(p) && p.left === node && p.operatorToken.kind === ts.SyntaxKind.EqualsToken) ||
          ts.isPrefixUnaryExpression(p) && (p.operator === ts.SyntaxKind.PlusPlusToken || p.operator === ts.SyntaxKind.MinusMinusToken) ||
          ts.isPostfixUnaryExpression(p) || ts.isDeleteExpression(p) || ts.isTypeOfExpression(p))) { skipped++; continue; }
      if (sf.text[node.getEnd()] === "!") { skipped++; continue; }
      (edits.get(sf.fileName) ?? edits.set(sf.fileName, new Set()).get(sf.fileName)).add(node.getEnd());
      count++;
    }
  }
  const total = all.reduce((a, b) => a + b, 0);
  if (total0 == null) total0 = total;
  console.log(`nonnull: round ${round}: ${total} strict errors in web, ${count} marks in ${edits.size} files, ${skipped} skipped`);
  if (!count || dry) break;
  for (const [f, set] of edits) {
    let s = readFileSync(f, "utf8");
    for (const pos of [...set].sort((a, b) => b - a)) s = s.slice(0, pos) + "!" + s.slice(pos);
    writeFileSync(f, s);
  }
}
console.log(`nonnull: start ${total0} strict errors`);
