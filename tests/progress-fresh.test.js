// PROGRESS.md and the README's progress block must match web/system-status.json.
// When this fails, run: node tools/build_progress.mjs .
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

test("the progress page and the README summary match the system status data", () => {
  const r = spawnSync(process.execPath, ["tools/build_progress.mjs", ".", "--check"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr || r.stdout);
});
