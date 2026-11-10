// 2 vs 2: a fighter attacking the enemy DIAGONALLY ACROSS must run the straight line from its own place to the target,
// not slide sideways into the target's lane first (where its own teammate lines up) and then run straight.
//
// The clip is authored as a straight run along z; battle3d adds the sideways (lat) and slant (latz) offset of the target's
// lane. It used to ease them in from tick 0 (0.12 per tick); it now takes them in step with the clip's own forward travel
// (attackLateralFraction of moveDelta z over attackReachZ), so x and z close together. Real ActorAnimator + real clips +
// the real exported helpers; the line-up numbers are _layoutExtras'.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import * as b3 from "../web/battle3d.js";
import { ActorAnimator } from "../web/fight/actor-animator.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const MODELS = path.join(ROOT, "web/assets/battle/models");
const HAVE = fs.existsSync(path.join(MODELS, "m005grey/anim.json")) && fs.existsSync(path.join(MODELS, "m190bolt/anim.json"));
const skip = HAVE ? false : "model packs are not installed";
const load = (folder) => { const p = JSON.parse(fs.readFileSync(path.join(MODELS, folder, "anim.json"), "utf8")); p.folder = folder; return p; };
const B3D = fs.readFileSync(path.join(ROOT, "web/battle3d.js"), "utf8");

// _layoutExtras at the 1900 floor: lanes +-950, echelon dz = away * (i - 0.5) * 0.45 * 1900 (away = the side's z sign)
const LANE = 950, ECH = 0.45 * 1900;
const NEAR = { z0: -5120, dxs: [-LANE, LANE], dzs: [ECH / 2, -ECH / 2] };      // player side (away = -1)
const FAR = { dxs: [-LANE, LANE], dzs: [-ECH / 2, ECH / 2] };                    // enemy side (away = +1)

/** The attacker's (x, z) every tick of the clip, `mode` = "new" (follows the run) or "old" (eases to the lane at 0.12/tick). */
function run(att, def, { clip, mode }) {
  const a = new ActorAnimator(load("m005grey"));
  a.resetSlotPlacement({ x: 0, y: 0, z: NEAR.z0, side: "player" });
  assert.ok(a.setAction(clip, {}));
  const reach = b3.attackReachZ(a.vm.ops, a.homeSlot.z, false);
  const dx = def.dx - att.dx, dz = def.dz - att.dz;
  let lat = 0, latz = 0;
  const pts = [];
  for (let t = 0; t < 600 && a.vm && !a.vm.ended; t++) {
    a.tick(1);
    if (mode === "new") { const k = b3.attackLateralFraction(a.moveDelta()[2], reach); lat = dx * k; latz = dz * k; }
    else { lat += (dx - lat) * 0.12; latz += (dz - latz) * 0.12; }
    const mv = a.moveDelta();
    pts.push({ t, x: att.dx + lat + mv[0], z: NEAR.z0 + mv[2] + att.dz + latz, mvz: mv[2] });
  }
  return { reach, pts, start: { x: att.dx, z: NEAR.z0 + att.dz } };
}
/** furthest a point of the path is from the straight segment start -> hit (the point at the clip's farthest run) */
function offLine(r) {
  const hit = r.pts.reduce((b, p) => (Math.abs(p.mvz) > Math.abs(b.mvz) ? p : b));
  const ux = hit.x - r.start.x, uz = hit.z - r.start.z, len = Math.hypot(ux, uz);
  let worst = 0;
  for (const p of r.pts) worst = Math.max(worst, Math.abs((p.x - r.start.x) * uz - (p.z - r.start.z) * ux) / len);
  return { worst, hit };
}

const A = { dx: NEAR.dxs[0], dz: NEAR.dzs[0] };
const DIAG = { dx: FAR.dxs[1], dz: FAR.dzs[1] };     // the enemy diagonally across
const ACROSS = { dx: FAR.dxs[0], dz: FAR.dzs[0] };   // the enemy straight across

test("diagonal attack: the way in is the straight line from its own place to the target", { skip }, () => {
  const before = run(A, DIAG, { clip: 5, mode: "old" }), after = run(A, DIAG, { clip: 5, mode: "new" });
  const b = offLine(before), n = offLine(after);
  const show = (r) => r.pts.filter((p) => p.t % 20 === 0).map((p) => `t${p.t}(${Math.round(p.x)},${Math.round(p.z)})`).join(" ");
  console.log(`start (${A.dx},${NEAR.z0 + A.dz}) target lane x=${DIAG.dx} reach ${after.reach}`);
  console.log("BEFORE", show(before), "| max off the line", b.worst.toFixed(1));
  console.log("AFTER ", show(after), "| max off the line", n.worst.toFixed(4));
  assert.ok(b.worst > 100, `the old slide left the line by ${b.worst.toFixed(0)}`);
  assert.ok(n.worst < 0.01, `the new path stays on the line (off by ${n.worst})`);
  assert.equal(after.pts[0].x, A.dx, "starts at its own spot");
  assert.ok(Math.abs(n.hit.x - DIAG.dx) < 1e-6, "at the hit point it is in the target's lane");
  assert.ok(Math.abs(n.hit.z - (NEAR.z0 + after.reach + DIAG.dz)) < 1e-6, "and on the target's slanted step");
  assert.ok(Math.abs(after.pts.at(-1).x - A.dx) < 1 && Math.abs(after.pts.at(-1).z - after.start.z) < 1, "and back on its own spot at the end");
});

test("straight-across attack: no sideways move at all (x unchanged), z slant now in step with the run", { skip }, () => {
  const before = run(A, ACROSS, { clip: 5, mode: "old" }), after = run(A, ACROSS, { clip: 5, mode: "new" });
  assert.ok(before.pts.every((p) => p.x === A.dx) && after.pts.every((p) => p.x === A.dx), "x is its own lane every tick, before and after");
  const n = offLine(after);
  console.log("ACROSS x change before/after 0/0 | path off the line after", n.worst.toFixed(4));
  assert.ok(n.worst < 0.01);
});

test("a clip that never leaves its place has no reach (keeps the slide-over behaviour)", { skip }, () => {
  const a = new ActorAnimator(load("m190bolt"));
  a.resetSlotPlacement({ x: 0, y: 0, z: NEAR.z0, side: "player" });
  assert.ok(a.setAction(5, {}));
  assert.equal(b3.attackReachZ(a.vm.ops, a.homeSlot.z, false), 0);
  assert.equal(b3.attackLateralFraction(1234, 0), 0);
});

test("over the whole clip corpus a clip's reach is exactly what it travels", { skip }, () => {
  let n = 0, moving = 0;
  for (const folder of fs.readdirSync(MODELS)) {
    if (!fs.existsSync(path.join(MODELS, folder, "anim.json"))) continue;
    const pack = load(folder);
    for (const clip of Object.keys(pack.actions || {})) for (const side of ["player", "enemy"]) {
      const a = new ActorAnimator(pack);
      a.resetSlotPlacement({ x: 0, y: 0, z: side === "player" ? -5120 : 5120, side });
      if (!a.setAction(+clip, {})) continue;
      const reach = b3.attackReachZ(a.vm.ops, a.homeSlot.z, !!a._standsOnOtherSide?.());
      let peak = 0;
      for (let t = 0; t < 500 && a.vm && !a.vm.ended; t++) { a.tick(1); peak = Math.max(peak, Math.abs(a.moveDelta()[2])); }
      n++; if (reach > 0) moving++;
      assert.ok(peak <= reach + 1, `${folder} clip ${clip} ${side}: travels ${peak} > reach ${reach}`);
      assert.ok(reach === 0 ? peak < 1 : peak > 1, `${folder} clip ${clip} ${side}: reach ${reach} vs travel ${peak}`);
    }
  }
  console.log(`corpus: ${n} clip runs, ${moving} travel, 0 mismatches`);
});

test("fighterAttack wires it: follow set for a travelling clip, effects use the live lane", () => {
  assert.match(B3D, /if \(reach > 0\) \{ A\.follow = \{/);
  assert.match(B3D, /attackLateralFraction\(f\.anim8r\.moveDelta\(\)\[2\], f\.follow\.reach\)/);
  assert.match(B3D, /nearX = \(\) => \(A\.follow \? A\.dx \+ A\.lat : aLane\)/);
});
