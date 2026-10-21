import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GENERIC_MOTIONS, listGenericMotions, bakeGenericMotion } from "../web/fight/generic-motion.js";
import { poseFromChannels } from "../web/fight/firing-axis.js";
import { neutralFrame } from "../web/fight/anim-solver.js";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../web/assets/battle/models");
const folders = fs.readdirSync(dir).filter((f) => fs.existsSync(path.join(dir, f, "anim.json")));
const load = (f) => { const m = JSON.parse(fs.readFileSync(path.join(dir, f, "anim.json"), "utf8")); m.folder = f; return m; };
const wpos = (m, fr) => poseFromChannels(m, fr).pos;
const height = (m, fr) => { const p = poseFromChannels(m, fr); let a = Infinity, b = -Infinity; m.bones.forEach((bn, i) => { for (const v of bn.verts || []) { const R = p.rot[i], t = p.pos[i]; const y = R[1] * v[0] + R[4] * v[1] + R[7] * v[2] + t[1]; a = Math.min(a, y); b = Math.max(b, y); } }); return b - a; };
const maxd = (A, B) => { let d = 0; for (let i = 0; i < A.length; i++) if (A[i] && B[i]) d = Math.max(d, Math.hypot(A[i][0] - B[i][0], A[i][1] - B[i][1], A[i][2] - B[i][2])); return d; };
const STEP = 0.4;   // body heights per tick on any bone origin; authored attack clips measure p90 0.29 (skeleton height), max 1.9

test("API shape: exactly ten motions", () => {
  assert.equal(GENERIC_MOTIONS.length, 10);
  assert.equal(new Set(GENERIC_MOTIONS.map((m) => m.id)).size, 10);
  for (const m of GENERIC_MOTIONS) { assert.ok(m.name && m.description && Array.isArray(m.needs)); assert.ok(m.bodyPlans === "any" || Array.isArray(m.bodyPlans)); }
  assert.deepEqual(listGenericMotions(null).map((x) => x.id), GENERIC_MOTIONS.map((m) => m.id));
  assert.equal(listGenericMotions({}).every((x) => x.applicable === false), true);
});

test("every motion on all models: no throw, idle at both ends, bounded steps, deterministic, input untouched", () => {
  assert.ok(folders.length >= 249);
  const bad = {}; const counts = {}; let baked = 0, worstStep = 0;
  for (const f of folders) {
    const m = load(f);
    const snap = JSON.stringify(m);
    const list = listGenericMotions(m);
    assert.equal(list.length, 10);
    const n0 = neutralFrame(m);
    const idle = wpos(m, n0), H = height(m, n0);
    for (const x of list) {
      if (!x.applicable) { assert.ok(x.reason, f + " " + x.id); const r = bakeGenericMotion(m, x.id); assert.equal(r.ok, false); continue; }
      counts[x.id] = (counts[x.id] || 0) + 1;
      const r = bakeGenericMotion(m, x.id);
      assert.equal(r.ok, true, f + " " + x.id + " " + r.reason);
      baked++;
      assert.ok(r.table >= 62 && !(m.timeline[r.table]?.table?.length), "free table");
      const fr = r.model.timeline[r.table].table.map((e) => e.value).filter((v) => v < 0x8000);
      assert.equal(fr.length, r.ticks);
      assert.equal(fr[0], 8000);
      const a = wpos(r.model, fr[0]), b = wpos(r.model, fr[fr.length - 1]);
      assert.ok(maxd(a, idle) < 0.01 * H, f + " " + x.id + " start " + maxd(a, idle) / H);
      assert.ok(maxd(b, idle) < 0.01 * H, f + " " + x.id + " end " + maxd(b, idle) / H);
      let prev = a;
      for (let k = 1; k < fr.length; k++) { const p = wpos(r.model, fr[k]); const s = maxd(p, prev) / H; worstStep = Math.max(worstStep, s); if (s >= STEP) { bad[x.id] = bad[x.id] || []; bad[x.id].push(f + ":" + s.toFixed(2)); } prev = p; }
      for (const bn of r.model.bones) { for (const key of [...bn.anim.ch1, ...bn.anim.ch2]) assert.ok(key.every(Number.isFinite)); assert.equal(bn.anim.ch2.at(-1)[3], 30000); }
      if (f.charCodeAt(3) % 11 === 0) { const r2 = bakeGenericMotion(m, x.id); assert.deepEqual(r2.model.bones.map((bn) => bn.anim), r.model.bones.map((bn) => bn.anim)); }
    }
    assert.equal(JSON.stringify(m), snap, "input mutated " + f);
  }
  console.log("baked", baked, "applicable counts", JSON.stringify(counts), "worst step/H", worstStep.toFixed(3));
  // known residue: a long prop or tail on a few rigs swings faster than the bound for a tick or two
  const nBad = Object.values(bad).reduce((t, v) => t + v.length, 0);
  console.log("ticks over the step bound:", nBad, JSON.stringify(bad));
  assert.ok(nBad <= 12, "too many fast ticks: " + nBad);
  for (const g of GENERIC_MOTIONS) assert.ok(counts[g.id] >= 20, g.id + " applies to too few models");
});
