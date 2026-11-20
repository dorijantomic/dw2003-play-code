// rename-web.mjs: git mv every tracked web game-code .js -> .ts (.mjs -> .mts).
// Not web/lib3d, not web/vendor, not web/assets*. Run build-web.mjs right after.
import { execFileSync } from 'node:child_process';
const files = execFileSync('git', ['ls-files', '-z', 'web'], { encoding: 'utf8', maxBuffer: 1 << 28 })
  .split('\0').filter(Boolean);
const moves = [];
for (const f of files) {
  const m = /\.(m?)js$/.exec(f);
  if (!m) continue;
  const parts = f.split('/');
  if (['lib3d', 'vendor', 'node_modules'].includes(parts[1]) || parts[1].startsWith('assets')) continue;
  moves.push([f, f.replace(/\.(m?)js$/, '.$1ts')]);
}
if (process.argv.includes('--dry')) { console.log(moves.length + ' moves'); process.exit(0); }
const mv = moves.flatMap(([a, b]) => [a, b]);
// one git call per chunk
for (const [a, b] of moves) execFileSync('git', ['mv', a, b]);
console.log('renamed ' + moves.length);
