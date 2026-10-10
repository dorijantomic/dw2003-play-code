// Does every Digimon's tech effect land on a Digimon? — the whole roster, offline.
//
// A screen-space op3 effect (z = 32767 / -1) is pasted at a fixed point on the PS1's 320x240
// frame, so only the CAMERA can put it on a body. That camera is one shared mechanism — the op5
// record read by web/fight/battle-camera.js applyOp5 — and the fighter slots are one shared
// table (web/assets/battle/model_placement.json). Nothing about either is per-Digimon, so
// checking one Digimon at a time in a browser proves nothing about the other 244.
//
// This walks EVERY action of EVERY extracted model pack statically, keeps the camera and the
// actor's arena slot up to date the way the action VM does, and reports two things. It imports the
// shipped applyOp5, so it tests the real code path rather than a copy of the maths.
//
//   A. SHOT AIM — for every explicit op5 shot, how far its aim point is from the nearest fighter's
//      body, in PS1 arena units. This needs no projection and does not care how big the Digimon
//      is, so it is the sharp test of whether the camera mechanism is being read correctly. It is
//      what settles the +0x18 anchor without looking at a single screenshot: read without the
//      anchor, 80 of the 80 anchored shots aim clear of every fighter; read with it, 80 of 80
//      land on one.
//   B. EFFECT LANDING — for every screen-space op3 spawn, the px distance from its point on the
//      320x240 frame to the nearest fighter's body axis. This is what a player sees, but it is
//      coarser: it measures to an AXIS, so a wide Digimon whose effect sits on its own outstretched
//      claw still scores as a miss.
//
// Limits, stated up front:
//   * STATIC walk. op11 waits and op5 tween durations are not simulated, so a move is scored at
//     the pose its ops END on. A shot that tweens INTO frame is therefore scored at its
//     destination — which is the framing that holds while the effect is on screen. op2 slot moves
//     ARE tracked, including the mode-5 leap (kinds 4/5 travel `param + 0x2800` toward the
//     opponent and back). While a leap is IN FLIGHT the fighter is somewhere between its two
//     ends and a static walk cannot say where, so spawns issued in that window are counted apart
//     rather than scored. A shot may also ANTICIPATE: m386dino sets a shot anchored on the spot
//     it is about to leap to, four ops before it leaps. So a shot's aim is scored against every
//     slot position its action visits, not only the one current when it is set.
//   * A fighter is its BODY AXIS: the vertical line at its slot, running the pack's own rest-pose
//     height (bone hierarchy from anim.json - each bone's world position is the running sum of its
//     ch1 frame-0 translation up the parent_slot chain, which reproduces the one shipped
//     bind_pose.json exactly - plus that bone's vertices). The miss is the px distance from the
//     effect's point to that axis, so it does not depend on how wide the Digimon is or on how the
//     limbs happen to be posed. A Digimon is roughly 700-1000 PS1 units across, which at ordinary
//     battle framing is 40-70 px, so the 60 px default reads as "on the body".
//   * The three op5 angles at +0x24 ARE applied, here and in the renderer (they are the
//     anchor frame's orientation - see web/fight/battle-camera.js). Applying them removed
//     one of the residual effect misses (m386dino action 11) and left the anchored-shot
//     aim result unchanged, which is expected: an anchored shot states a zero target, so
//     rotating the shot about its anchor moves the eye and not the aim point.
//   * The +0x2c roll (degrees) is applied too. It cannot move a shot's AIM - it is a rotation of
//     the finished frame - but it does move where a screen-space effect falls relative to a body,
//     so it belongs in metric B. 7 packs author one.
//
// Run:  node tools/audit_camera_effect_alignment.mjs [--tol 60] [--verbose]
import fs from "node:fs";
import path from "node:path";
import { applyOp5, applyScreenRoll, PS1_UP } from "../web/fight/battle-camera.js";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const MODELS = path.join(ROOT, "web/assets/battle/models");
const args = process.argv.slice(2);
const TOL = Number(args[args.indexOf("--tol") + 1]) || 60;    // PSX px off the body axis
const VERBOSE = args.includes("--verbose");

const placement = JSON.parse(fs.readFileSync(path.join(ROOT, "web/assets/battle/model_placement.json"), "utf8"));
const BASE_Z = placement.base_z | 0;
const SCREEN_Z = new Set([32767, -1]);
const CONTACT_Z = 0x2800;                            // action-vm.js CONTACT_Z
const AIM_TOL = 2000;                                // PS1 units: a body is ~1000 across

const modelKey = (folder) => { const m = /^m(\d{3})/.exec(folder); return m ? String(Number(m[1])) : null; };

/** One fighter's home slot in PS1 arena units, Y down (battle3d.arenaSlot). */
function slotFor(key, far) {
  const rec = placement.models[key];
  const z = BASE_Z + (rec?.standoff | 0);
  return { x: 0, y: 0 - (rec?.hover | 0), z: far ? z : -z };
}

/**
 * A pack's rest-pose height in PS1 units. Bone world position = the running sum of its frame-0
 * ch1 translation up the `parent_slot - 1` chain (the root bone's own translation is not applied);
 * that reproduces m373rena/bind_pose.json bone for bone. Height spans every bone's vertices.
 */
const heightCache = new Map();
function bodyHeight(folder) {
  if (heightCache.has(folder)) return heightCache.get(folder);
  let h = null;
  try {
    const bones = JSON.parse(fs.readFileSync(path.join(MODELS, folder, "anim.json"), "utf8")).bones || [];
    const wp = [];
    for (let i = 0; i < bones.length; i++) {
      const t = bones[i]?.anim?.ch1?.[0];
      if (i === 0 || !t) { wp.push([0, 0, 0]); continue; }
      const p = wp[(bones[i].parent_slot | 0) - 1] || [0, 0, 0];
      wp.push([p[0] + t[0], p[1] + t[1], p[2] + t[2]]);
    }
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < bones.length; i++)
      for (const v of (bones[i].verts || [])) {
        const y = wp[i][1] + v[1];
        if (y < lo) lo = y; if (y > hi) hi = y;
      }
    if (Number.isFinite(lo)) h = hi - lo;
  } catch { /* an unreadable pack falls back to nominal */ }
  heightCache.set(folder, h);
  return h;
}
const NOMINAL_H = 1800;

// ── Projection: PS1 world (Y down) -> the 320x240 frame, the same look-at + H the renderer uses.
const sub = (a, b) => [a[0]-b[0], a[1]-b[1], a[2]-b[2]];
const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const dot = (a, b) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
const norm = (a) => { const l = Math.hypot(...a) || 1; return [a[0]/l, a[1]/l, a[2]/l]; };
const toRender = (p) => [p[0], -p[1], p[2]];      // battle3d's PS1 -> render mapping (scale cancels)

function projector(cam) {
  if (!cam?.eye || !cam?.target || !cam.H) return null;
  const eye = toRender(cam.eye), tgt = toRender(cam.target);
  const z = norm(sub(eye, tgt));                   // view backward
  // The shot's own up vector, not world up: the +0x24 angles can turn it (m031pata, m059houo)
  // and the +0x2c roll turns it again. Both go through the shipped helpers, exactly as battle3d
  // does, so this stays a test of the real code path rather than a copy of it.
  const up = applyScreenRoll(toRender(cam.up || PS1_UP), eye, tgt, cam.roll || 0);
  const x = norm(cross(up, z));
  const y = cross(z, x);
  if (!Number.isFinite(x[0])) return null;         // degenerate (looking straight down)
  return (p) => {
    const v = sub(toRender(p), eye);
    const d = -dot(v, z);                          // depth in front of the camera
    if (d <= 1) return null;
    return { x: 160 + cam.H * dot(v, x) / d, y: 120 - cam.H * dot(v, y) / d };
  };
}

/** PSX px from the point `pt` on the 320x240 frame to this fighter's body axis. */
function missTo(proj, slot, h, pt) {
  let best = Infinity;
  for (let i = 0; i <= 16; i++) {
    const q = proj([slot.x, slot.y - h * (i / 16), slot.z]);
    if (q) best = Math.min(best, Math.hypot(q.x - pt.x, q.y - pt.y));
  }
  return best;
}

// ── The static walk ───────────────────────────────────────────────────────────
// op5 sub=0 preset -> which fighter's canned-shot array and which shot (battle3d.op5ShotSlot).
function shotSlot(preset) {
  const p = preset | 0;
  if (p >= 1 && p <= 4) return { far: false, index: p + 7 };
  if (p >= 5 && p <= 7) return { far: true,  index: p - 5 };
  return null;                                     // preset 0 = back to the default camera
}
const DEFAULT_CAM = { eye: [-3840, -2432, -4608], target: [0, -2048, 768], H: 280 };

function cannedShot(key, sel) {
  const cam = placement.models[key]?.camera;
  const eye = cam?.eye?.[sel.index], look = cam?.look?.[sel.index];
  if (!eye || !look) return null;
  if (!eye.some(Boolean) && !look.some(Boolean)) return null;   // an unused shot slot
  return { eye, target: look, H: cam.view?.[sel.index] || 280 };
}

/**
 * Which side of the arena a pack's action data is written for. The absolute points in a script -
 * op5 anchors and op2 mode-3 targets - are authored per side rather than mirrored at runtime
 * (claim fight-world-effect-coordinates-are-not-mirrored-per-side-2026-08-18), so a pack whose
 * anchors sit at z > 0 is written to be fought from the far slot. Reading it on the near slot
 * scores its own shots against the wrong fighter. Decided by majority over the script's own
 * absolute z values, so it is data-derived rather than a per-Digimon list.
 */
const sideCache = new Map();
function authoredFar(folder, anim) {
  if (sideCache.has(folder)) return sideCache.get(folder);
  const tally = (pick) => {
    let near = 0, far = 0;
    for (const a of (anim.actions || [])) for (const op of (a?.ops || [])) {
      const z = pick(op, op.words || []);
      if (z === null || z === 0) continue;
      if (z < 0) near++; else far++;
    }
    return { near, far };
  };
  let t = tally((op, w) => (op.op === 5 && w[1] === 1 && (w[8] || w[9] || w[10]) ? -(w[10] | 0) : null));
  if (!t.near && !t.far) t = tally((op, w) => (op.op === 2 && (w[0] | 0) === 3 ? -(w[4] | 0) : null));
  const isFar = t.far > t.near;
  sideCache.set(folder, isFar);
  return isFar;
}

// Every slot position an action puts its fighter through, so an anticipating shot is scored
// against the place it is waiting for rather than the place the fighter has not left yet.
function visitedSlots(ops, home) {
  const seen = [{ ...home }];
  let cur = { ...home };
  const push = (p) => { cur = p; if (!seen.some((q) => q.x === p.x && q.y === p.y && q.z === p.z)) seen.push({ ...p }); };
  for (const op of ops) {
    if (op.op !== 2) continue;
    const w = op.words || [], mode = w[0] | 0, sign = home.z < 0 ? 1 : -1;
    if (mode === 3) push({ x: w[2] | 0, y: -(w[3] | 0), z: -(w[4] | 0) });
    else if (mode === 7) push({ ...home });
    else if (mode === 8) push({ ...home, z: home.z + CONTACT_Z * sign });
    else if (mode === 5 && (w[2] | 0) === 4) push({ ...home, z: home.z + ((w[3] | 0) + CONTACT_Z) * sign });
    else if (mode === 5 && (w[2] | 0) === 5) push({ ...home });
  }
  return seen;
}

function walk(folder, ops, selfKey, foeKey, far) {
  const selfSlot = slotFor(selfKey, far), foeSlot = slotFor(foeKey, !far);
  const selfH = bodyHeight(folder) || NOMINAL_H, foeH = bodyHeight(FOE_FOLDER) || NOMINAL_H;
  const home = { ...selfSlot };
  const visited = visitedSlots(ops, home);
  let cur = { ...selfSlot };
  let cam = DEFAULT_CAM;
  // Whether the camera in force was set by THIS action. An action that spawns a screen-space
  // effect without ever setting a camera inherits whatever the idle director or the previous
  // action left, so its framing is not determined by the data and cannot be scored here.
  let owned = false;
  let leaping = false;               // a mode-5 travel is armed and has not been waited out
  const hits = [], shots = [];
  for (const op of ops) {
    const w = op.words || [];
    if (op.op === 5) {
      const cs = applyOp5({}, op).op5;
      if (!cs) continue;
      if (cs.eye) {
        cam = { eye: cs.eye, target: cs.target, H: cs.H }; owned = true;
        shots.push({ anchored: cs.anchor.some(Boolean), leaping,
          aim: Math.min(aimDist(cs.target, foeSlot, foeH),
                        ...visited.map((p) => aimDist(cs.target, p, selfH))),
          target: cs.target });
      }
      else if (cs.preset != null) {
        const sel = shotSlot(cs.preset);
        if (!sel) { cam = DEFAULT_CAM; owned = false; }     // preset 0 = hand the camera back
        else { const c = cannedShot(sel.far ? foeKey : selfKey, sel); if (c) { cam = c; owned = true; } }
      }
      continue;
    }
    if (op.op === 2) {                              // actor slot movement (action-vm _dispatchOp2)
      const mode = w[0] | 0;
      if (mode === 3) cur = { x: w[2] | 0, y: -(w[3] | 0), z: -(w[4] | 0) };
      else if (mode === 7) cur = { ...home };
      else if (mode === 8) cur = { ...home, z: home.z + CONTACT_Z * (home.z < 0 ? 1 : -1) };
      else if (mode === 5 && (w[2] | 0) === 0) { leaping = false; }   // the blocking wait: it has landed
      else if (mode === 5) {
        // The slot motion object (F0x8009b13c): kind 4 travels `param + 0x2800` toward the
        // opponent, kind 5 travels the same distance back. Its height arc returns to the floor,
        // so only z ends up moved. Scored at the end of the travel, like every other move here.
        const kind = w[2] | 0;
        leaping = true;
        if (kind === 4) cur = { ...home, z: home.z + ((w[3] | 0) + CONTACT_Z) * (home.z < 0 ? 1 : -1) };
        else if (kind === 5) cur = { ...home };
      }
      continue;
    }
    if (op.op !== 3) continue;
    if ((w[0] | 0) !== 0) continue;                 // sub != 0 is a preload, not a spawn
    const z = w[4] | 0;
    if (!SCREEN_Z.has(z)) continue;                 // world-space spawns project on their own
    const sx = w[2] | 0, sy = w[3] | 0;
    // Full-frame clips are pinned to the frame's top-left corner, not placed on anything. Of the
    // 1,450 screen-space spawns in the shipped packs, 1,388 are (0,0) and 21 sit in a corner
    // cluster - (-160,-120) eighteen times, plus (-160,-128), (-154,-114) and (-140,-120), which
    // are the same clip nudged a few px. Anything within 32 px of the corner is one of those.
    if (Math.hypot(sx + 160, sy + 120) < 32) continue;
    const proj = projector(cam);
    if (!proj) continue;
    const pt = { x: 160 + sx, y: 120 + sy };
    const miss = Math.min(missTo(proj, cur, selfH, pt), missTo(proj, foeSlot, foeH, pt));
    hits.push({ type: w[1] | 0, pt, miss, owned, leaping, cam, self: { ...cur }, selfH, foeSlot, foeH });
  }
  return { hits, shots };
}

/** PS1 units from a point to a fighter's body: the vertical segment at its slot. */
function aimDist(t, slot, h) {
  const yTop = slot.y - h, lo = Math.min(slot.y, yTop), hi = Math.max(slot.y, yTop);
  const dy = t[1] < lo ? lo - t[1] : (t[1] > hi ? t[1] - hi : 0);
  return Math.hypot(t[0] - slot.x, dy, t[2] - slot.z);
}

// ── Sweep ─────────────────────────────────────────────────────────────────────
const FOE_FOLDER = "m003agum";                      // the stand-in opponent, as in the Battle Lab
const ONLY = args.includes("--model") ? args[args.indexOf("--model") + 1] : null;
const FOE_KEY = modelKey(FOE_FOLDER);
const folders = fs.readdirSync(MODELS).filter((f) => fs.existsSync(path.join(MODELS, f, "anim.json")));

let spawns = 0, off = 0, worst = 0, worstAt = null, inherited = 0;
let aimTotal = 0, aimOff = 0, aimAnchored = 0, aimAnchoredOff = 0, farPacks = 0;
let aimMidLeap = 0, midLeap = 0;
const aimBad = [];
const perModel = [];
for (const folder of folders) {
  const key = modelKey(folder);
  if (!key) continue;
  if (ONLY && folder !== ONLY) continue;
  const anim = JSON.parse(fs.readFileSync(path.join(MODELS, folder, "anim.json"), "utf8"));
  const far = authoredFar(folder, anim);
  if (far) farPacks++;
  let mOff = 0, mWorst = 0, mSpawns = 0, mAction = null;
  (anim.actions || []).forEach((a, ai) => {
    if (!a) return;
    const res = walk(folder, a.ops || [], key, FOE_KEY, far);
    for (const sh of res.shots) {
      if (sh.leaping) { aimMidLeap++; continue; }
      aimTotal++;
      if (sh.anchored) aimAnchored++;
      if (sh.aim > AIM_TOL) { aimOff++; if (sh.anchored) aimAnchoredOff++;
        aimBad.push(`${folder} action ${ai}  aim ${sh.aim.toFixed(0)} units from any fighter  target ${JSON.stringify(sh.target)}${sh.anchored ? "  (anchored)" : ""}`); }
    }
    for (const h of res.hits) {
      if (!h.owned) { inherited++; continue; }
      if (h.leaping) { midLeap++; continue; }
      spawns++; mSpawns++;
      if (h.miss > TOL) {
        off++; mOff++;
        if (ONLY) console.log(`  action ${ai} effect ${h.type} at (${h.pt.x},${h.pt.y}) miss ${h.miss.toFixed(0)} px` +
          `\n    cam eye ${JSON.stringify(h.cam.eye)} target ${JSON.stringify(h.cam.target)} H ${h.cam.H}` +
          `\n    self slot ${JSON.stringify(h.self)} h ${h.selfH}   foe slot ${JSON.stringify(h.foeSlot)} h ${h.foeH}`);
      }
      if (h.miss > mWorst) { mWorst = h.miss; mAction = ai; }
      if (h.miss > worst) { worst = h.miss; worstAt = `${folder} action ${ai} effect ${h.type}`; }
    }
  });
  if (mSpawns) perModel.push({ folder, spawns: mSpawns, off: mOff, worst: mWorst, action: mAction });
}

const bad = perModel.filter((m) => m.off > 0).sort((a, b) => b.worst - a.worst);
console.log(`packs walked            ${folders.length}  (${farPacks} written to be fought from the far slot)`);
console.log(`\nA. shot aim - where the camera the action sets is pointed`);
console.log(`  explicit op5 shots    ${aimTotal}  (${aimAnchored} of them anchored on a +0x18 point)`);
console.log(`  aimed >${AIM_TOL} units from every fighter   ${aimOff}, of which anchored ${aimAnchoredOff}`);
console.log(`  not scored, issued mid-leap                ${aimMidLeap}`);
console.log(`\nB. effect landing - where each screen-space effect is drawn`);
console.log(`screen-space spawns     ${spawns} scored, ${inherited} skipped (camera inherited), ${midLeap} skipped (mid-leap)`);
console.log(`spawns off every body   ${off}  (tolerance ${TOL} px off the axis)`);
console.log(`worst miss              ${worst.toFixed(0)} px   ${worstAt || ""}`);
console.log(`packs with any miss     ${bad.length} of ${perModel.length}`);
if (VERBOSE && aimBad.length) { console.log("\nshots aimed clear of both fighters:"); for (const l of aimBad) console.log("  " + l); }
if (bad.length) {
  console.log("\nworst offenders:");
  for (const m of bad.slice(0, VERBOSE ? bad.length : 15)) {
    console.log(`  ${m.folder}  action ${String(m.action).padStart(2)}  ${String(m.off).padStart(4)}/${String(m.spawns).padEnd(4)} spawns off  worst ${m.worst.toFixed(0)} px`);
  }
}
// The gate is part A on the ANCHORED shots: those are the ones the +0x18 reading decides, and
// each one names a fighter's slot outright, so "does it aim at a fighter" has a right answer that
// does not depend on any Digimon's size. Part B is reported for eyes, not gated: its axis metric
// is too coarse to call a miss on a Digimon as broad as m230gkwa.
console.log(aimAnchoredOff === 0
  ? `\nPASS - all ${aimAnchored} anchored shots aim at a fighter.`
  : `\nFAIL - ${aimAnchoredOff} anchored shots aim at no fighter; the op5 anchor is being misread.`);
process.exit(aimAnchoredOff === 0 ? 0 : 1);
