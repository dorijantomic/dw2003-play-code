// The ratchet is only useful if someone runs it, so `npm test` runs it: the files listed in
// tools/rewrite/ts-clean.json have no type errors, and this fails the moment one of them does.
// It is a spawn rather than an import because the ratchet shells out to tsc and prints a
// report; the exit code is the contract.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const TOOL = join(ROOT, "tools", "rewrite", "ts-ratchet.mjs");
const CLEAN = join(ROOT, "tools", "rewrite", "ts-clean.json");

test("ts-clean.json is a sorted array of web TypeScript paths", () => {
  assert.ok(existsSync(CLEAN), "tools/rewrite/ts-clean.json is missing (run: node tools/rewrite/ts-ratchet.mjs --update)");
  const list = JSON.parse(readFileSync(CLEAN, "utf8"));
  assert.ok(Array.isArray(list), "ts-clean.json must be a JSON array");
  assert.ok(list.length > 0, "ts-clean.json is empty");
  for (const entry of list) {
    assert.equal(typeof entry, "string", `non-string entry: ${JSON.stringify(entry)}`);
    assert.match(entry, /^web\/.*\.m?ts$/, `not a web .ts path: ${entry}`);
  }
  const sorted = [...list].sort();
  assert.deepEqual(list, sorted, "ts-clean.json must be sorted");
  assert.equal(new Set(list).size, list.length, "ts-clean.json must not repeat a file");
});

test("no file that was type-clean has gone dirty", () => {
  const result = spawnSync(process.execPath, [TOOL], { cwd: ROOT, encoding: "utf8", timeout: 900_000 });
  const out = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  assert.equal(result.status, 0, `ts-ratchet failed (status ${result.status}):\n${out}`);
  assert.match(out, /clean files \d+\/\d+/i, `ratchet did not report a clean count:\n${out}`);
});
