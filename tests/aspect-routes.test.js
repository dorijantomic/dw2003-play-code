// The aspect routes (docs/aspect-system-plan.md): with ASPECT_ROUTES=1 every extra form that has a parent gets a second unlock record
// on an element bonus. Builds the data twice into scratch folders (the shared data is not touched) and checks the invariants.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const have = fs.existsSync("web/assets/data/enemies.json") && fs.existsSync("web/assets/data/digimon_profiles.bin");
const x = { skip: have ? false : "needs the disc-derived data (web/assets/data)" };

function build(aspect) {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), aspect ? "aspect-on-" : "aspect-off-"));
  const r = spawnSync("python3", ["tools/build_extra_species.py"], {
    env: { ...process.env, ASPECT_ROUTES: aspect ? "1" : "0", EXTRA_SPECIES_OUT: out }, encoding: "utf8",
  });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  return JSON.parse(fs.readFileSync(path.join(out, "extra_species.json"), "utf8"));
}

let off, on;
const built = () => { off ??= build(false); on ??= build(true); return { off, on }; };
const D = (n) => JSON.parse(fs.readFileSync(`web/assets/data/${n}`, "utf8"));

test("the element routes are the stat routes plus one record per form that has a parent", x, () => {
  const { off, on } = built();
  for (let line = 0; line < 8; line++) {
    const a = off.tree[String(line)], b = on.tree[String(line)];
    const element = b.filter((r) => r.kind >= 8);
    const rest = b.filter((r) => r.kind < 8);
    const key = (r) => JSON.stringify(r);
    assert.deepEqual([...rest.map(key)].sort(), [...a.map(key)].sort(), `line ${line}: the old records are all still there, unchanged`);
    const withParent = a.filter((r) => r.req0);
    assert.equal(element.length, withParent.length, `line ${line}: one element record per form with a parent`);
  }
});

test("an element record keeps its stat record's prerequisites and gates on the form's own element", x, () => {
  const { on } = built();
  const meta = Object.fromEntries(Object.values(on.meta).map((m) => [m.id, m]));
  const ELEMS = ["fire", "water", "ice", "wind", "thunder", "machine", "dark"];
  for (let line = 0; line < 8; line++) {
    const recs = on.tree[String(line)];
    for (const r of recs.filter((q) => q.kind >= 8)) {
      const twin = recs.find((q) => q.to === r.to && q.kind < 8);
      assert.ok(twin, `${r.to} has a stat record too`);
      assert.deepEqual([r.req0, r.req0Level, r.req1, r.req1Level], [twin.req0, twin.req0Level, twin.req1, twin.req1Level]);
      assert.equal(ELEMS[r.kind - 8], meta[r.to].element, "the gate is the form's own element");
      assert.ok(r.threshold > 0 && r.threshold <= 999, `gate ${r.threshold} fits the stat cap`);
    }
  }
});

test("every form has an element tag from the seven, and the gate rises with the tier", x, () => {
  const { on } = built();
  const ELEMS = new Set(["fire", "water", "ice", "wind", "thunder", "machine", "dark"]);
  for (const m of Object.values(on.meta)) assert.ok(ELEMS.has(m.element), `${m.id} has an element`);
  const meta = Object.fromEntries(Object.values(on.meta).map((m) => [m.id, m]));
  for (let line = 0; line < 8; line++) {
    const el = (r) => r.threshold;                         // the live game counts the trained points only (verify_aspect_route.mjs)
    const byTier = {};
    for (const r of on.tree[String(line)].filter((q) => q.kind >= 8)) (byTier[meta[r.to].tier] ??= new Set()).add(el(r));
    const lows = Object.entries(byTier).map(([t, s]) => [+t, Math.min(...s)]).sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < lows.length; i++) assert.ok(lows[i][1] >= lows[i - 1][1], `line ${line}: tier ${lows[i][0]} gate is not below tier ${lows[i - 1][0]}`);
  }
});

test("the table is weakest tier first, so the first passing record is always the weakest form available", x, () => {
  const { on } = built();
  const tier = Object.fromEntries(Object.values(on.meta).map((m) => [m.id, m.tier]));
  for (let line = 0; line < 8; line++) {
    const t = on.tree[String(line)].map((r) => tier[r.to]);
    for (let i = 1; i < t.length; i++) assert.ok(t[i] >= t[i - 1], `line ${line}: record ${i} (tier ${t[i]}) comes after tier ${t[i - 1]}`);
  }
});

test("the default build is unchanged: no element records, the same table as before", x, () => {
  const { off } = built();
  for (let line = 0; line < 8; line++) assert.equal(off.tree[String(line)].filter((r) => r.kind >= 8).length, 0);
  assert.equal(off.tree["0"].length, 135);
});
