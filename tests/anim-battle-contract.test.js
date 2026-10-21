// The A11 battle-animation contract as a fast regression gate (BRIEF4 "ORCHESTRATOR DIRECTIVE").
//
// tools/verify_battle_contract.mjs plays the REAL ActionVM + ActorAnimator + FightCoordinator headless over
// every (species form x technique it can use / item record x side near/far x outcome hit/lethal/miss).
// The full cross product (192 forms, 39 822 cases, 2 732 live runs) takes ~10 s; this test runs the same
// code path on a bounded subset (`--fast`: the first 8 forms, every technique and item they can use, both
// sides, all three outcomes) so the suite still exercises every rule in under a minute.
//
// The gate is the CALIBRATED contract (see anim-contract.md's calibration log): the disc's own authored
// scripts are ground truth, so an authored row must not be rejected by any rule except C7's op4-envelope
// gap (clips 14/15/17 play near-idle in ActorAnimator because the envelope table is bound outside the clip),
// which is bounded instead of asserted at zero. Built rows must be zero on the dispatcher/geometry rules
// (C2 pairing, C3 target class, C5 locomotion, C6 projectile origin, C8 camera, C9 symmetry, C10 items) and
// are bounded on the three rules with known A9/A10 work left (C1 contacts, C4 lanes, C7 body motion).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TOOL = path.join(ROOT, "tools/verify_battle_contract.mjs");
const INV = ["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8", "C9", "C10"];

test("battle animation contract (C1-C10) — fast subset", { timeout: 120_000 }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dw3-contract-"));
  const json = path.join(dir, "contract.json");
  const md = path.join(dir, "contract.md");
  const r = spawnSync(process.execPath, [TOOL, "--fast", "--quiet", "--json", json, "--md", md], {
    cwd: ROOT, encoding: "utf8", timeout: 110_000,
  });
  assert.equal(r.status, 0, `verifier failed: ${r.stderr || r.stdout}`);
  const out = JSON.parse(fs.readFileSync(json, "utf8"));
  const s = out.summary;

  // the case list is the full cross product of the subset, not a sample of one side or one outcome
  assert.ok(s.cases > 300, `expected a full cross product, got ${s.cases} cases`);
  assert.equal(s.errors, 0, `${s.errors} cases threw`);
  for (const side of ["near", "far"]) {
    for (const outcome of ["hit", "lethal", "miss"]) {
      assert.ok(out.rows.some((x) => x.side === side && x.outcome === outcome),
        `no ${side}/${outcome} row — the cross product lost an axis`);
    }
  }
  // every row carries one boolean per invariant, and the report groups violations by builder path
  for (const r2 of out.rows) for (const k of INV) {
    assert.ok(r2[k] === true || r2[k] === false || r2[k] === null, `${r2.model} ${r2.case} lacks ${k}`);
  }
  assert.ok(typeof s.byInvariantBuilt.C2 === "number", "summary lacks per-path >= 0 counters");

  // AUTHORED scripts are ground truth: no rule may reject them (C7's op4-envelope gap is the documented
  // exception, bounded at 1% so a real "nothing animates" regression still fails).
  for (const k of ["C1", "C2", "C3", "C4", "C5", "C6", "C8", "C9", "C10"]) {
    assert.equal(s.byInvariantOwn[k], 0, `${k} rejects ${s.byInvariantOwn[k]} authored-script rows`);
  }
  assert.ok(s.byInvariantOwn.C7 <= Math.ceil(s.ownRows * 0.01),
    `C7 rejects ${s.byInvariantOwn.C7}/${s.ownRows} authored rows — the op4-envelope gap has grown`);

  // BUILT scripts: the rules the builder must satisfy by construction are zero.
  for (const k of ["C2", "C3", "C5", "C6", "C8", "C9", "C10"]) {
    assert.equal(s.byInvariantBuilt[k], 0, `${k}: ${s.byInvariantBuilt[k]} built rows violate the rule`);
  }
  // ... and the three with known A9/A10 work left are bounded, so a regression still trips.
  assert.ok(s.byInvariantBuilt.C1 <= Math.ceil(s.builtRows * 0.02),
    `C1: ${s.byInvariantBuilt.C1}/${s.builtRows} built rows have the wrong contact count`);
  assert.ok(s.byInvariantBuilt.C4 <= Math.ceil(s.builtRows * 0.05),
    `C4: ${s.byInvariantBuilt.C4}/${s.builtRows} built rows anchor an effect on the wrong fighter`);
  assert.ok(s.byInvariantBuilt.C7 <= Math.ceil(s.builtRows * 0.05),
    `C7: ${s.byInvariantBuilt.C7}/${s.builtRows} built rows do not move the body`);
  assert.ok(Array.isArray(out.rows) && out.rows.length === s.cases);
  fs.rmSync(dir, { recursive: true, force: true });
});
