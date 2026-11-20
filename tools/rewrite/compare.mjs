// compare.mjs a.jsonl b.jsonl -> "same", or the first difference (frame field, error kind) + both
// values, exit 1. Every line is a frame except the last one, which is metadata written by
// record.mjs: {"errors":[{"kind":"pageerror|console-error|console-warning","text":"...","n":1}]}.
// Two recordings count as DIFFERENT when the error lists differ, even if every frame matches.
import { readFileSync } from "node:fs";

const [a, b] = process.argv.slice(2);
if (!a || !b) { console.error("usage: compare.mjs a.jsonl b.jsonl"); process.exit(2); }

function parse(p) {
  const frames = [], errors = [];
  for (const line of readFileSync(p, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const o = JSON.parse(line);
    if (o && typeof o === "object" && Array.isArray(o.errors)) {
      for (const e of o.errors) errors.push(typeof e === "string" ? { kind: "pageerror", text: e, n: 1 } : e);
    } else frames.push(o);
  }
  return { frames, errors };
}
const A = parse(a), B = parse(b);

function diff(x, y, path) {
  if (x === y) return null;
  if (x && y && typeof x === "object" && typeof y === "object") {
    const keys = [...new Set([...Object.keys(x), ...Object.keys(y)])].sort();
    for (const k of keys) { const d = diff(x[k], y[k], path ? `${path}.${k}` : k); if (d) return d; }
    return null;
  }
  return { field: path, a: x, b: y };
}
const differ = (msg) => { console.log(`different: ${msg}`); process.exit(1); };

const n = Math.min(A.frames.length, B.frames.length);
for (let i = 0; i < n; i++) {
  const d = diff(A.frames[i], B.frames[i], "");
  if (d) differ(`frame ${i}, field ${d.field}, a=${JSON.stringify(d.a)} b=${JSON.stringify(d.b)}`);
}
if (A.frames.length !== B.frames.length) differ(`length ${A.frames.length} vs ${B.frames.length} frames`);

// errors: same kinds, same order, same repeat counts
const key = (e) => `${e.kind}|${e.n ?? 1}|${e.text}`;
const ea = A.errors.map(key), eb = B.errors.map(key);
for (let i = 0; i < Math.min(ea.length, eb.length); i++) {
  if (ea[i] !== eb[i]) differ(`errors[${i}]: a=${JSON.stringify(A.errors[i])} b=${JSON.stringify(B.errors[i])}`);
}
if (ea.length !== eb.length) differ(`error kind count ${ea.length} vs ${eb.length}: a=${JSON.stringify(A.errors)} b=${JSON.stringify(B.errors)}`);
console.log(`same (${n} frames, ${ea.length} error kind(s))`);
