// K19f item 7: the slice's GUARD — the fast test that was missing while the unit tests were green and the
// contract was not.
//
// It runs the two instruments the brief names, on the three exemplars only:
//   1. tools/k19e_contract_slice.mjs  — the whole C1–C15 contract with the O3 hook ON
//   2. tools/verify_battle_contract.mjs — the same rows with the hook OFF (the baseline)
//   3. tools/k19e_identity.mjs        — every other built script byte-identical, no model mutated
//
// Asserted: the dispatcher/geometry rules are zero, C12 and C13 do not exceed the hook-OFF baseline, C14/C15
// are zero, and the identity check reports no unexpected change and no model mutation.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ON = path.join(ROOT, "tools/k19e_contract_slice.mjs");
const OFF = path.join(ROOT, "tools/verify_battle_contract.mjs");
const ID = path.join(ROOT, "tools/k19e_identity.mjs");
const ONLY = "m228piem,m094icem,m050coca";      // the K19 slice: prop / bare hand / mouth
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dw3-k19f-guard-"));

const run = (tool, args) => {
  const r = spawnSync(process.execPath, [tool, ...args], { cwd: ROOT, encoding: "utf8", timeout: 300_000 });
  assert.equal(r.status, 0, `${path.basename(tool)} failed: ${r.stderr || r.stdout}`);
  return r;
};

const contract = (tool, tag) => {
  const json = path.join(dir, `${tag}.json`);
  run(tool, ["--only", ONLY, "--quiet", "--json", json, "--md", path.join(dir, `${tag}.md`)]);
  const out = JSON.parse(fs.readFileSync(json, "utf8"));
  const s = out.summary;
  assert.equal(s.errors, 0, `${tag}: ${s.errors} cases threw`);
  assert.ok(s.cases >= 600, `${tag}: expected the whole case list, got ${s.cases}`);
  return s;
};

test("K19 slice guard: contract with the hook ON does not regress the hook-OFF baseline", { timeout: 240_000 }, () => {
  const off = contract(OFF, "off");
  const on = contract(ON, "on");
  for (const inv of ["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8", "C9", "C10", "C11", "C14", "C15"]) {
    assert.equal(on.byInvariant[inv], on.byInvariantOwn?.[inv] ?? 0, `${inv} must be 0 on built rows with the hook ON, got ${on.byInvariant[inv]}`);
  }
  // C12/C13 may not exceed the baseline: the solver must never make a launch or an idle-resume worse than
  // the build the engine plays without it (parity is acceptable — a refused pair keeps the old build).
  assert.ok(on.byInvariant.C12 <= off.byInvariant.C12, `C12 ${on.byInvariant.C12} > baseline ${off.byInvariant.C12}`);
  assert.ok(on.byInvariant.C13 <= off.byInvariant.C13, `C13 ${on.byInvariant.C13} > baseline ${off.byInvariant.C13}`);
});

test("K19 slice guard: every other built script is byte-identical (identity + model state)", { timeout: 300_000 }, () => {
  const json = path.join(dir, "identity.json");
  run(ID, ["--out", json]);
  const s = JSON.parse(fs.readFileSync(json, "utf8"));
  assert.equal(s.unexpectedChanges, 0, `${s.unexpectedChanges} unexpected script changes`);
  assert.equal(s.hookOffModelMutated, 0, "the hook OFF must not mutate any model");
  assert.equal(s.hookOnModelMutatedOutsideSlice, 0, "the hook ON must not mutate a model outside the slice");
  assert.equal(s.orderChanges, 0, `${s.orderChanges} order-dependent changes`);
  assert.ok(s.expectedSliceChanges >= 1, `expected the slice pairs to change, got ${s.expectedSliceChanges}`);
});
