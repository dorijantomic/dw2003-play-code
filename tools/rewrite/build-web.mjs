// build-web.mjs: turn every web/**/*.ts (and .mts) into the .js (.mjs) next to it.
// Node's own type stripping (strip mode): types become spaces, so lines, columns
// and comments stay identical. Only erasable TypeScript is allowed.
// Usage: node tools/rewrite/build-web.mjs [--watch] [--quiet]
import { stripTypeScriptTypes } from 'node:module';
import { readdirSync, readFileSync, writeFileSync, statSync, lstatSync, watch } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const WEB = join(ROOT, 'web');
const SKIP_DIRS = new Set(['lib3d', 'vendor', 'node_modules']);
const args = process.argv.slice(2);
const quiet = args.includes('--quiet');

function skipDir(name) {
  return SKIP_DIRS.has(name) || name.startsWith('assets');
}

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (skipDir(name)) continue;
    const p = join(dir, name);
    const st = lstatSync(p);
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) yield* walk(p);
    else if (/\.m?ts$/.test(name) && !/\.d\.m?ts$/.test(name)) yield p;
  }
}

function outPath(ts) {
  return ts.replace(/\.mts$/, '.mjs').replace(/\.ts$/, '.js');
}

// Returns true when written, false when unchanged. Throws a clear error on bad syntax.
function buildOne(ts) {
  const src = readFileSync(ts, 'utf8');
  let out;
  try {
    out = stripTypeScriptTypes(src, { mode: 'strip' });
  } catch (e) {
    throw new Error(`build-web: ${relative(ROOT, ts)}: ${e.message}\n` +
      '  Only erasable TypeScript is allowed (no enum, namespace, constructor parameter properties).');
  }
  const dst = outPath(ts);
  let old = null;
  try { old = readFileSync(dst, 'utf8'); } catch {}
  if (old === out) return false;
  writeFileSync(dst, out);
  return true;
}

function buildAll() {
  let n = 0, w = 0;
  const errors = [];
  for (const ts of walk(WEB)) {
    n++;
    try { if (buildOne(ts)) w++; } catch (e) { errors.push(e.message); }
  }
  if (!quiet) console.log(`build-web: ${n} files, ${w} written, ${errors.length} errors`);
  for (const e of errors) console.error(e);
  return errors.length;
}

const errs = buildAll();
if (!args.includes('--watch')) process.exit(errs ? 1 : 0);

console.log('build-web: watching web/ ...');
const timers = new Map();
watch(WEB, { recursive: true }, (_ev, f) => {
  if (!f || !/\.m?ts$/.test(f) || /\.d\.m?ts$/.test(f)) return;
  if (f.split(sep).some(skipDir)) return;
  const p = join(WEB, f);
  clearTimeout(timers.get(p));
  timers.set(p, setTimeout(() => {
    try { statSync(p); } catch { return; }
    try { if (buildOne(p)) console.log('build-web: ' + f); } catch (e) { console.error(e.message); }
  }, 50));
});
