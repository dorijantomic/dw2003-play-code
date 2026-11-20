// One-shot codemod: tests that read web/ game-code source text with readFileSync(..., "utf8")
// now call readSource(...) from tests/helpers/source.js (same arguments, same assertions).
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const dry = process.argv.includes('--dry');

function listTests(dir) {
  const out = [];
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    const st = statSync(p);
    if (st.isDirectory()) { if (n !== 'fixtures' && n !== 'helpers' && n !== 'engine') out.push(...listTests(p)); }
    else if (/\.js$/.test(n)) out.push(p);
  }
  return out;
}

function splitTop(s) {
  const parts = []; let depth = 0, q = null, cur = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { cur += c; if (c === '\\') { cur += s[++i]; } else if (c === q) q = null; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; cur += c; continue; }
    if (c === '(' || c === '[' || c === '{') depth++;
    if (c === ')' || c === ']' || c === '}') depth--;
    if (c === ',' && depth === 0) { parts.push(cur); cur = ''; continue; }
    cur += c;
  }
  parts.push(cur);
  return parts;
}

const WEBJS = /web\/(?!assets|lib3d\/|vendor\/)[^"'`)]*\.m?js\b/;
let files = 0, calls = 0;
for (const f of listTests(join(ROOT, 'tests'))) {
  let src = readFileSync(f, 'utf8');
  let out = '', i = 0, n = 0;
  const re = /\b(?:fs\.)?readFileSync\(/g;
  let m;
  while ((m = re.exec(src))) {
    const open = m.index + m[0].length;
    let depth = 1, q = null, j = open;
    for (; j < src.length && depth > 0; j++) {
      const c = src[j];
      if (q) { if (c === '\\') j++; else if (c === q) q = null; continue; }
      if (c === '"' || c === "'" || c === '`') q = c;
      else if (c === '(') depth++;
      else if (c === ')') depth--;
    }
    const inner = src.slice(open, j - 1);
    const args = splitTop(inner);
    if (args.length === 2 && WEBJS.test(args[0]) && /^\s*["']utf-?8["']\s*$/.test(args[1])) {
      out += src.slice(i, m.index) + 'readSource(' + args[0] + ')';
      i = j; n++;
    }
  }
  if (!n) continue;
  out += src.slice(i);
  const rel = f.includes('/tests/lane-b/') ? '../helpers/source.js' : './helpers/source.js';
  const lines = out.split('\n');
  let last = -1;
  for (let k = 0; k < lines.length; k++) {
    if (/^import\b.*;\s*$/.test(lines[k]) || /^\}\s*from\s+["'].*["'];?\s*$/.test(lines[k])) last = k;
    else if (/^(const|let|var|function|test|describe|async|export)\b/.test(lines[k])) break;
  }
  const imp = `import { readSource } from "${rel}";`;
  if (last >= 0) lines.splice(last + 1, 0, imp);
  else lines.splice(lines[0].startsWith('#!') ? 1 : 0, 0, imp);
  if (!dry) writeFileSync(f, lines.join('\n'));
  files++; calls += n;
}
console.log(`${files} files, ${calls} calls`);
