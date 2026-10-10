// Regression pin: the full-model animation census (tools/fight_anim_census.mjs) must not
// grow NEW failing clips vs its committed baseline. Runs the census as a subprocess in
// --baseline compare mode (exit 1 = new failures). ~30s over 245 models × 2135 clips.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));

test("fight animation census holds its baseline (no new failing clips)", { timeout: 300000 }, () => {
  const out = execFileSync("node", [path.join(HERE, "../tools/fight_anim_census.mjs"), "--baseline"],
    { encoding: "utf8" });
  assert.match(out, /census OK/);
});
