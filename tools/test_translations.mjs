#!/usr/bin/env node
// Run the tests actually named by the translation registry, including nested
// suites that the old npm test glob omitted.
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const root = new URL('../', import.meta.url);
const rows = JSON.parse(readFileSync(new URL('data/translated_functions.json', root)));
const files = [...new Set(rows.map(r => r.oracle))].sort();
for (const file of files) {
    if (typeof file !== 'string' || !file.startsWith('tests/') || !existsSync(new URL(file, root))) {
        throw new Error(`Missing or invalid translation test: ${file}`);
    }
}
const result = spawnSync(process.execPath, ['--test', '--test-concurrency=2', ...files], {
    cwd: root, stdio: 'inherit',
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
