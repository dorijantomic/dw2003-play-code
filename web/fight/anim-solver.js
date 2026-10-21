// K19: ANIMATION FROM THE BODY — the goal-driven cast solver.
//
// The other two ways a cast gets a body both borrow motion: K16 conjugates a DONOR's joints, the A10
// planted build replays the model's OWN authored table. This module makes the motion UP FROM THE GOAL:
// deliver the technique from the part of the body that fires it, to the target, so it reads as an attack.
//
// GOAL + RULES (the only things the solver is told; no named styles anywhere in the code):
//   R1 AIM        at the RELEASE tick the emitter's FIRING AXIS points at the target. The axis is the one
//                 K19b derives from geometry (prop long axis / hand push direction / head facing); the
//                 solver reaches it by rotating the limb, and re-aims the wrist (or the head/torso) until
//                 the measured axis is on the aim line.
//   R2 WIND-UP    before release the emitter moves AWAY from the target (back, mostly up) by an amount
//                 that scales with the body, then drives forward THROUGH the release point. The release
//                 point, the excursion and the phase durations are the disc's own medians (K19a's
//                 motion-constants.js, per emitter class and size class) — where the hands go is measured,
//                 not chosen here.
//   R3 SHARED SHOT when several emitters make ONE combined shot they converge at release to the disc's
//                 measured clasp gap; when each fires its own shot they spread symmetrically about the aim
//                 line (K19c's sharedShotMode/sharedShotTargets, K14's shots rule).
//   R4 FOLLOW-THROUGH + BALANCE
//                 the body follows the shot through and settles; non-emitter limbs counter-move a little;
//                 feet stay planted (no root motion, no leg keys); joint limits are the K16 ones; no part
//                 passes through another (K19c's capsule clearance, judged against the body's own authored
//                 animation); the pose returns to the model's own rest, and the model's own channels are
//                 never damaged (the A15 rule: keys are APPENDED far past every authored frame, the
//                 playlist is a NEW table index).
//
// WHAT THE SOLVER IS NOT: it does not know any technique, species, clip or bone by name. Its inputs are
// the K12 bone map (roles), the K17 arm equipment (what an arm ends in), the K14 shots rule (which sites
// fire, one each or one combined), and K19a's measured constants. The only judgment calls are the
// constants in SOLVER below, each with its justification.
//
// WHERE IT PLUGS IN: clip-fallback.js resolution order O3 (a synthesized style beats a borrowed donor
// retarget, O4, and the planted own-body cast, O5) — but only for a technique whose class is a projectile
// / cast AND whose (model, technique) pair the engine may take over (setSolverScope). Everything else
// keeps its current output byte for byte.
//
// Frame: the model's own battle frame (firing-axis.js): +X the character's RIGHT, +Y DOWN, +Z the way the
// body faces. Lengths are model units.

import { rigOf, K16 } from "./anim-retarget.js";
import { emitterClass, firingAxis, poseFromChannels, aimError, carriedFacing } from "./firing-axis.js";
import { shotsFor, emitters, sizeClass } from "./digimon-anatomy.js";
import { emitterBone, tipOf, chainPrevBone, launchPointsFor } from "./launch-plan.js";
import { motionFor, releasePoint, handPoint, windupFor } from "./motion-constants.js";
import { headCastFor, HEAD_CAST_JUMP, HEAD_CAST_IDLE } from "./head-cast-constants.js";
import { bodyHeight, penetration, clearanceTolerance, rigColliders, poseCollider, pairClearance, allowedPairs } from "./anim-collision.js";
import { sharedShotMode, sharedShotTargets, SHARED_SHOT } from "./anim-collision.js";

const TAU = (Math.PI * 2) / 4096;

/**
 * The solver's judgment calls. Every one is a tolerance, not a style: what "reads as an attack" is
 * measured (K19a/K19b/K19c), what "is acceptable" is decided here.
 */
export const SOLVER = {
  /** R1's acceptance: the firing axis must point this close to the target at release (degrees). K19b's
   *  calibration of the disc's own casts is the reference — the disc is not perfect either. */
  aimToleranceDeg: 22,
  /** R2's drive: after the wind-up the emitter must cover at least this share of the way from the apex to
   *  the release point, or the body never "drives" and the pose is a lean, not a cast. READ by the gate
   *  (K19f): the achieved excursion is compared with the planned one. */
  driveFloor: 0.35,
  /** The largest re-aim of a centre emitter whose bone also carries the FEET (a bird's head bone is the
   *  hub the legs hang from, so turning it to aim drags its feet through the body): a few degrees, and the
   *  22-degree aim tolerance absorbs the rest. Geometry decides — no species names. */
  centreAimMax: 0.03,
  /** R2's motion FLOOR (K19f): a cast whose emitter never leaves its rest point is a still pose however
   *  well it aims. The emitter must travel at least this share of body height during the cast; the
   *  measured classes lift 0.06-0.24 h (K19a), so 0.05 h is the floor beneath every one of them. */
  motionFloor: 0.05,
  /** R2's LATERAL swing (K19f item 4): before the drive an ARM's wind-up draws OUTWARD, away from the
   *  body's midline, so the limb travels AROUND the body to the release point instead of through its
   *  own torso and legs. The disc's prop casts already hold the weapon 0.20-0.65 h lateral (K19a's lH
   *  p10/p90), so an outward excursion of this share of height is inside the measured envelope. The
   *  attempt loop WIDENS it step by step (up to `swingCap`) only when the measured clearance rule fails;
   *  the release point never moves. */
  swingBase: 0.06,
  swingCap: 0.28,
  /** A CENTRE emitter (mouth/head/chest) is BODY TRANSPORT: its point is moved by translating the body's
   *  roots (the disc's own mouth casts translate their root ch1 — Kokatorimon's authored table moves it
   *  368 up and 370 forward), not by turning the bone it sits on, which only spins its mesh. Rotating a
   *  root instead would swing the legs of a two-hierarchy rig through its torso and lift its feet.
   *  The lift is capped by the ground rule: a body may not float. Forward travel is FREE but capped at
   *  the disc's own root travel — K20a measured the root moving 0.13 H at the median mouth/head cast, so
   *  a solver that slides further is inventing a lunge the disc never plays (K20b item 2). */
  centreLift: 0.04,
  centreDrive: 0.13,
  centreBack: 0.05,
  /** R4's ground rule: over the WHOLE cast the played pose may not lift the body's lowest mesh point off
   *  its own floor by more than this share of height (K19f: the gate used to read the root ch1 at the
   *  release tick only). The disc's own mouth casts lift their lowest vertex by 0.036 h (Kokatorimon's
   *  authored table 14, measured), so a bar below that would reject the disc itself. */
  groundShare: 0.05,
  /** R4's clearance: how much DEEPER than the body's own neutral pose two parts may come (share of
   *  height). This replaces the blanket 0.16 h slack on the authored floor (K19f): a pair that stands
   *  0.4 h apart at rest may not travel into the torso, while a pair the rest pose already overlaps
   *  (Piedmon's back sword box through the torso capsule) is only judged against its own noise. */
  clearanceNoise: 0.02,
  /** Where the appended keys start: far past every authored frame (A15), past K16's cast bakes too. */
  offset: 20000,
  offsetStep: 4000,
  /** The last frame a key may name: the channel sentinel is 30000 and a 16-bit consumer wraps at 32767. */
  frameLimit: 29900,
  /** The aim distance, in model units: the fighters' lines are ARENA_HALF apart on each side (10240 between
   *  the two), which is the direction the shot has to leave in. */
  aimDistance: 10240,
  /** Phase minimums (ticks): a drive shorter than this cannot be read, a return shorter than this snaps. */
  minDrive: 5,
  minReturn: 14,
  /** How many times the plan may be adjusted toward a failing gate before the pair is refused. */
  maxAttempts: 8,
  /** The plans tried in order when the gate refuses (K19f item 4). Every rung is the SAME rules, at a
   *  hand point the class's own casts measured: the median first, then with the swing widened (the arm
   *  travels further AROUND the body), then at the class's upper quantiles (a stubby body whose wrist
   *  cannot sit at the median without driving its upper arm through its own pelvis is served by the raised,
   *  wider hand the same class's other casts use, K19a's handHH/handLH p90), and only then a forward push
   *  with a damped lean. A rule that fails at the last rung refuses the pair. */
  attemptLadder: [
    { quantile: 0.5, swing: 1 },
    { quantile: 0.5, swing: 2.5 },
    { quantile: 0.7, swing: 1 },
    { quantile: 0.7, swing: 2.5 },
    { quantile: 0.9, swing: 1 },
    { quantile: 0.9, swing: 2.5 },
    { quantile: 0.9, swing: 2.5, push: 1, lean: 0.5 },
    { quantile: 0.9, swing: 2.5, push: 1, lean: 0 },
  ],
};

// ── SCOPE ────────────────────────────────────────────────────────────────────────────────────────────
// The K19 slice is THREE exemplars, chosen by rule (see the report); the engine is the same for everyone
// once K20 decides it is. Until then the solver only takes over the (model, technique) pairs the caller
// enables, so every other built script is byte-identical. `key` is `${folder}|${techKey}`; a pair with no
// technique (an item / an unnamed clip) is never taken over by the slice.
let SCOPE = null;
const techKey = (name) => String(name ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** Enable the solver: null = off (default), "all" = every pair its gate accepts, or a list of pairs
 *  `[{ folder, tech }]` / `["folder|techkey", ...]`. Returns the scope in force. */
export function setSolverScope(scope) {
  if (scope == null || scope === "all") { SCOPE = scope; return SCOPE; }
  const set = new Set();
  for (const p of scope) {
    if (typeof p === "string") { set.add(p); continue; }
    if (p?.folder) set.add(`${p.folder}|${techKey(p.tech)}`);
  }
  SCOPE = set;
  return SCOPE;
}

/** The scope in force (null when off) — for the viewer/harness panel and the report. */
export function solverScope() { return SCOPE; }

/** May the solver take over this (model, technique)? Generic: scope only, no species logic. */
export function solverEnabledFor(model, { tech = null } = {}) {
  if (SCOPE == null) return false;
  if (!tech) return false;                       // an unnamed clip/item keeps the A9/A10 builds
  if (SCOPE === "all") return true;
  return SCOPE.has(`${model?.folder}|${techKey(tech)}`);
}

// ── the emitter group a technique fires from ───────────────────────────────────────────────────────────

/** Emitter class per site (K19b's geometry classes) folded to the classes K19a measured motion for. */
function motionClassOf(cls, sideCount = 1) {
  if (cls === "hand" || cls === "prop") return cls;
  if (cls === "head") return "mouth";
  if (cls === "eyes") return "eyes";
  if (cls === "chest" || cls === "back" || cls === "body" || cls === "tail" || cls === "wing") return "body";
  return null;
}

/**
 * The sites a technique fires from and the MOTION class of that shot — all from data:
 *   sites  K14's shots rule for the technique (one per emitter, one combined, per-limb contact = none)
 *   class  K19b's geometry class of those sites + K17's arm equipment, folded to K19a's measured classes.
 * Returns { ok, cls, mode, ids, sites, rule, reason }.
 */
export function solverGroup(model, { tech = null } = {}) {
  const folder = model?.folder;
  if (!folder) return { ok: false, reason: "no folder" };
  const rule = shotsFor(folder, tech ?? "");
  const ids = Array.isArray(rule?.emitters) ? rule.emitters.slice() : [];
  if (!ids.length) return { ok: false, reason: `the technique's rule fires nothing (${rule?.mode ?? "?"})`, rule };
  if (rule.mode === "per-limb-contact") return { ok: false, reason: "a contact move, not a cast", rule };
  const sites = [];
  for (const id of ids) {
    const info = emitterClass(folder, id);
    const bone = emitterBone(folder, id);
    if (!info?.cls || bone == null) return { ok: false, reason: `no geometry for emitter ${id}`, rule };
    sites.push({ id, cls: info.cls, bone, chain: info.arm?.chain ?? null, side: info.arm?.side ?? null, equip: info.equip ?? null });
  }
  // the class of the shot: a group of arm sites is one arm class; anything else is the centre class
  const armSites = sites.filter((s) => s.chain && s.chain.length);
  const classes = [...new Set(sites.map((s) => motionClassOf(s.cls)))].filter(Boolean);
  if (!classes.length) return { ok: false, reason: "no motion class for these emitters", rule, sites };
  let cls = classes[0];
  if (armSites.length && classes.includes("prop")) cls = "prop";
  else if (armSites.length && classes.includes("hand")) cls = "hand";
  else if (classes.length > 1 && classes.includes("mouth")) cls = "mouth";
  const mode = sharedShotMode(rule, sites.length) ?? (sites.length > 1 ? "spread" : "single");
  return { ok: true, cls, mode, ids, sites, rule, armSites };
}

// ── the pose plan ────────────────────────────────────────────────────────────────────────────────────

const K19F_DEBUG = typeof process !== "undefined" && !!process.env?.K19F_DEBUG;   // Node diagnostics only: the
// module runs in the BROWSER too, where `process` does not exist and the old unguarded `process.env.K19F_DEBUG`
// threw inside the per-tick bake (K19f item 9: the solver had never run in the real game, only in node tools).
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const smooth = (u) => { const t = clamp(u, 0, 1); return t * t * (3 - 2 * t); };
const lerp3 = (a, b, u) => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];

/** The renderer's ch1/ch2 sampler (anim-retarget sample(), duplicated here: that module keeps it private). */
function chan(ch, frame) {
  if (!Array.isArray(ch) || !ch.length) return [0, 0, 0];
  let lo = ch[0], hi = ch[0];
  for (const rec of ch) {
    if (rec[3] === 30000) break;
    if (rec[3] <= frame) lo = rec; else { hi = rec; break; }
  }
  if (lo === hi || hi[3] === 30000 || hi[3] <= lo[3]) return [lo[0], lo[1], lo[2]];
  const t = (frame - lo[3]) / (hi[3] - lo[3]);
  return [lo[0] + t * (hi[0] - lo[0]), lo[1] + t * (hi[1] - lo[1]), lo[2] + t * (hi[2] - lo[2])];
}

/** The rest pose in the shape firing-axis.js takes ({rot: flat column-major, pos}). */
export function poseOf(model, frame = 0, blend = null) { return poseFromChannels(model, frame, { blend }); }

/** k16's row-major 3x3 -> the flat column-major the renderer/firing-axis use. */
const flatOf = (M) => [M[0][0], M[1][0], M[2][0], M[0][1], M[1][1], M[2][1], M[0][2], M[1][2], M[2][2]];

/**
 * The frame the solver treats as the body's neutral: the first frame of the table the script returns to
 * as its idle (clip-fallback binds table 1), else frame 0. The pose the engine DRAWS when the body
 * stands is this one — a channel's frame 0 can be a modelling default that sits a tenth of a body height
 * below the idle (K19f: Kokatorimon's legs at frame 0 are 0.13 h lower than its own idle).
 */
export function neutralFrame(model) {
  let lo = Infinity;
  for (const e of model?.timeline?.[1]?.table ?? []) {
    const v = e?.value | 0;
    if (v >= 0 && v < 0x8000 && v < lo) lo = v;
  }
  return Number.isFinite(lo) ? lo : 0;
}

/** The lowest mesh point of a posed model (+Y is down, so the largest y) and the bone that carries it. */
export function lowestVertex(model, pose) {
  let best = { y: -Infinity, bone: -1 };
  for (let i = 0; i < model.bones.length; i++) {
    const R = pose.rot[i], t = pose.pos[i], vs = model.bones[i].verts || [];
    if (!R || !t) continue;
    for (const v of vs) {
      const y = (R[1] * v[0] + R[4] * v[1] + R[7] * v[2]) + t[1];
      if (Number.isFinite(y) && y > best.y) best = { y, bone: i };
    }
  }
  return best;
}

/**
 * The shape of a head cast, from the measured cell (K20a): how far the head lifts (degrees, MESH frame),
 * how many ticks it takes to get there, how long it holds, and how long the return takes. Every number is
 * the cell's own median; the rise may not eat more than 60% of the wind-up and the fall may not run past it.
 */
export function headScheduleFrom(cell, { windup = 41 } = {}) {
  // a cell whose median lift is negative (the small bodies, p50 -5.7 deg) is a head the disc does NOT lift
  // at the median: the solver holds it still rather than pitching it down, which the cell's own p10 allows.
  const lift = clamp(cell?.headLift?.p50 ?? 0, 0, 120);
  const rise = clamp(Math.round(cell?.tickToPeak?.p50 ?? 0), 1, Math.max(1, Math.round(windup * 0.6)));
  const hold = clamp(Math.round(cell?.holdTicks?.p50 ?? 0), 0, Math.max(0, windup - rise));
  const fall = clamp(Math.round(cell?.returnTicks?.p50 ?? 0), 1, Math.max(1, windup - rise - hold));
  return {
    lift, rise, hold, fall, cell: cell?.source ?? null, n: cell?.n ?? null,
    p10: cell?.headLift?.p10 ?? null, p50: cell?.headLift?.p50 ?? null, p90: cell?.headLift?.p90 ?? null,
  };
}

/**
 * The head's pitch at tick t of a head cast — degrees in the MESH frame, relative to the model's own
 * neutral. Zero at the first and last frame of the cast (so the table begins and ends on the idle the
 * actor returns to), the cell's measured lift at the peak, level again before the release: that is the
 * disc's own shape (K20a: peak +24 deg median, at 40% of the wind-up, release pitch +1.2 deg median).
 */
export function headCastSchedule(h, t, ticks = Infinity) {
  if (!h || !(h.lift > 0) || t <= 0 || t >= ticks - 1) return 0;
  if (t < h.rise) return h.lift * smooth(t / Math.max(1, h.rise));
  const peakEnd = h.rise + h.hold;
  if (t < peakEnd) return h.lift;
  const end = peakEnd + Math.max(1, h.fall);
  if (t <= end) return h.lift * (1 - smooth((t - peakEnd) / Math.max(1, h.fall)));
  return 0;
}

/**
 * Build the frame-by-frame plan for one cast:
 *   { ticks, release, flight, follow, frames:[{arms:{left,right}, aim:{bone,point}|null, lean, root}],
 *     cls, mode, points:{release, apex, overshoot, rest{left,right}}, report:{...} }
 *
 * The phases come from the technique's own clip's authored distribution where the caller knows it
 * (a spell: windup ≈ 0.18 of the cast, flight ≈ 0.40 — K19a's numbers), and each class's own medians
 * override the excursion and the release point.
 */
export function planCast(model, group, { tick = null, quantile = 0.5 } = {}) {
  const folder = model.folder;
  const rig = rigOf(model);
  if (!rig || rig.source !== "bonemap") return { ok: false, reason: "no bone map for this rig" };
  const H = bodyHeight(model) || rig.box.h;
  if (!(H > 0)) return { ok: false, reason: "no body height" };
  const baseFrame = neutralFrame(model);
  const neutral = poseFromChannels(model, baseFrame);
  const size = sizeClass(folder);
  const cls = group.cls;
  const M = motionFor(cls, size) ? motionFor(cls, size) : motionFor(cls, null);
  if (!M) return { ok: false, reason: `no measured motion for class ${cls}` };
  const rel = releasePoint({ emitterClass: cls, sizeClass: size, bodyHeight: H, quantile }) ?? releasePoint({ emitterClass: cls, bodyHeight: H, quantile });
  const hand = handPoint({ emitterClass: cls, sizeClass: size, bodyHeight: H, quantile }) ?? rel;
  const wu = windupFor({ emitterClass: cls, sizeClass: size, bodyHeight: H, quantile }) ?? windupFor({ emitterClass: cls, bodyHeight: H, quantile });
  if (!rel || !wu) return { ok: false, reason: `no constants for class ${cls}` };
  const low = lowestVertex(model, neutral);
  const floorY = Number.isFinite(low.y) ? low.y : rig.box.mx[1];   // +Y DOWN: the lowest mesh point
  const torsoZ = rig.torso != null ? neutral.pos[rig.torso][2] : 0;
  const torsoX = rig.torso != null ? neutral.pos[rig.torso][0] : 0;

  // the phases (ticks). The wind-up is the class's own median; the drive is a snap; the body follows the
  // shot until it lands (the flight), then returns.
  const windup = clamp(Math.round(wu.windup || 41), 10, 140);
  const drive = clamp(Math.round(windup * 0.22), SOLVER.minDrive, 30);
  const release = windup + drive;
  const flight = clamp(Math.round(wu.flight || 115), 20, 260);
  const follow = clamp(Math.round(wu.follow || Math.max(12, flight * 0.35)), 6, 120);
  const ret = Math.max(SOLVER.minReturn, Math.round(windup * 0.5));
  const ticks = Math.max(release + flight + 6, release + follow + ret);

  // ── K20b: a HEAD/MOUTH emitter is driven by the HEAD ─────────────────────────────────────────────────
  // K20a measured what the disc does with a mouth/head cast: it lifts the head by its own pitch for the
  // size class, holds it, comes back to level by the release (median release pitch +1.2 deg) and lets the
  // body slide at most 0.13 H. A head cast is therefore a HEAD ROTATION over the measured root travel —
  // not a body lunge (the old centre path slid the body 0.18 H and never turned the head at all).
  const headSites = !group.sites.some((s) => s.chain && s.chain.length)
    && group.sites.every((s) => s.cls === "head" || s.cls === "eyes");
  const HC = headSites ? headCastFor(size) : null;
  const headPlan = HC ? headScheduleFrom(HC, { windup }) : null;
  const rootCap = headSites ? Math.min(SOLVER.centreDrive, HC?.rootTravelH?.p50 ?? SOLVER.centreDrive) * H : null;


  // where the emitter has to BE at release: the class's measured point, with the hand as the target for an
  // arm (the sweat spot the ARM can reach; the muzzle rides ahead of it) and the emitter itself otherwise.
  const isArm = group.sites.every((s) => s.chain && s.chain.length);
  const base = isArm ? hand : rel;
  const lateral = rel.lateral || 0;
  // the limb's own rest position at the body's NEUTRAL pose (an arm at rest: the chain tip; a centre
  // emitter: its own firing tip) — and its SIDE from the geometry (which side of the midline the limb
  // actually hangs on), not from the emitter's name: the K19b class's arm.side is the donor's authored
  // side, and a spread built on it put the "left" arm on the right (its muzzle came out at +x and
  // crossed the other arm).
  const restTip = group.sites.map((s) => {
    if (s.chain?.length) { const p = neutral.pos[s.chain[s.chain.length - 1]]; return p ? [p[0], p[1], p[2]] : null; }
    const t = tipOf(neutral.pos, model, s.bone, chainPrevBone(folder, s.id, s.bone));
    return t ? [t[0], t[1], t[2]] : null;
  });
  const sides = group.sites.map((s, i) => {
    const t = restTip[i];
    const dx = t ? t[0] - torsoX : 0;
    if (Math.abs(dx) > 1e-3 * H) return Math.sign(dx);
    return s.side === "left" ? -1 : s.side === "right" ? 1 : 0;
  });
  const releaseFor = (i) => {
    const s = sides[i] || 0;
    const t = restTip[i];
    if (!isArm) {
      // a CENTRE emitter cannot be put at an absolute class median: its height is its own anatomy (a
      // bird's beak, a chest hatch). It is driven from where the body holds it by the measured LIFT and
      // a forward DRIVE (K19a: the disc lifts 3-7x more than it pulls back and arrives before release).
      // For a HEAD cast the whole displacement is capped at the disc's own root travel (K20a): the head
      // rotation is what the player reads, the body only follows it.
      const lift = Math.min(wu.up || 0, SOLVER.centreLift * H);
      const room = rootCap != null ? Math.sqrt(Math.max(0, rootCap * rootCap - lift * lift)) : Infinity;
      const fwd = Math.min(wu.travel || 0, SOLVER.centreDrive * H, room);
      const x = t ? t[0] : torsoX;
      const y = (t ? t[1] : floorY - base.height) - lift;
      const z = (t ? t[2] : torsoZ + base.forward) + fwd;
      return [x, y, z];
    }
    // Where the WRIST goes: the class's wrist record holds its height and its forward offset.
    //   A PROP's lateral comes from the WRIST record too: the weapon rides 0.2-0.65 h further out on its
    //   own, and using the muzzle's lateral for the wrist threw Piedmon's arm straight out sideways past
    //   its reach and swung his upper arm through his pelvis (K19f item 4; K19e's "0.403 h lateral").
    //   A BARE hand IS the emitter, so its lateral is the class's own measured emitter lateral (the
    //   release record): that is the number the class's casts actually hold the hand at.
    const lat = cls === "prop" ? (base.lateral || 0) : (lateral || base.lateral || 0);
    return [torsoX + lat * s, floorY - base.height, torsoZ + base.forward];
  };
  // R3: a combined shot converges the sites to the measured clasp gap; a spread keeps each site's own side.
  let targets = group.sites.map((_, i) => releaseFor(i));
  let origins = targets.slice();
  let shared = null;
  if (group.sites.length > 1) {
    const pts = targets.map((p) => ({ x: p[0], y: p[1], z: p[2] }));
    if (group.mode === "combined") {
      shared = sharedShotTargets({
        points: pts, mode: group.mode, height: H,
        aim: [0, 0, 1], origin: { x: torsoX, y: floorY - base.height, z: torsoZ + base.forward },
      });
      targets = shared.points.map((p) => [p.x, p.y, p.z]);
      origins = shared.origins.map((p) => [p.x, p.y, p.z]);
    } else {
      // SPREAD: each site already sits on its own side of the midline (releaseFor), and each fires its own
      // shot — so nothing is mirrored (K19c's mirroring is for a combined shot's alignment) and the only
      // correction is that two shots may not leave from one point: a pair the body itself places closer than
      // one hand block is pushed apart sideways, heights and forward untouched.
      const minSep = SHARED_SHOT.minSeparation * H;
      if (targets.length === 2 && Math.abs(targets[0][0] - targets[1][0]) < minSep) {
        const mid = (targets[0][0] + targets[1][0]) / 2;
        const d0 = targets[0][0] - mid;
        const s0 = Math.abs(d0) > 1e-6 ? Math.sign(d0) : -1;
        targets[0][0] = mid + s0 * minSep / 2;
        targets[1][0] = mid - s0 * minSep / 2;
      }
      origins = targets.map((p) => p.slice());
      shared = { basis: `emitters spread about the aim line, each on its own side, no pair closer than ${SHARED_SHOT.minSeparation} h` };
    }
  }
  // R2's wind-up: the emitter draws UP (the disc lifts 3–7x more than it pulls back) and BACK, and — for a
  // limb — OUTWARD, away from the body's midline, so the path goes AROUND the body to the release point
  // instead of through it. That outward excursion is `SOLVER.swingBase` (share of height); the attempt loop
  // may WIDEN it step by step when the measured clearance rule fails (K19f item 4), and the release point
  // itself never moves (the drive still ends where the class's own casts fire from).
  // A centre emitter's lift is already capped, so its apex adds only half of it again: the head lifts, then
  // drives through the release (K19a: lift → hold → arrive before the release).
  const apexUp = isArm ? (wu.up || 0) : 0;
  const apexBack = isArm ? (wu.back || 0) : Math.min(wu.back || 0, SOLVER.centreBack * H);
  const sideOf = (i) => sides[i] || (group.sites.length > 1 ? (i === 0 ? -1 : 1) : 0);
  const apexOf = (scale) => targets.map((p, i) => {
    const out = isArm ? SOLVER.swingBase * H * scale : 0;      // outward, on the site's own side
    return [p[0] + sideOf(i) * out, p[1] - apexUp, p[2] - apexBack];
  });
  const overshoot = targets.map((p) => [p[0], p[1], p[2] + (headSites ? 0 : Math.max(0, wu.travel || 0) * 0.12)]);
  // A prop arm fires from the MUZZLE (K19b's geometry: the prop's long axis), not from the wrist: its
  // release point is the class's own muzzle median — height, forward AND lateral from the muzzle record —
  // so the hand that carries it is driven until the part that fires is there.
  const muzzleTargets = group.sites.map((s, i) => (s.cls === "prop"
    ? [torsoX + (rel.lateral || 0) * (sides[i] || 0), floorY - rel.height, torsoZ + rel.forward]
    : targets[i]));

  // The frame path is REBUILT from the plan's points, never aliased into them: a frame that held the apex
  // array itself was shifted once per attempt by the clearance adjustment, so the wind-up ramp grew a
  // little every attempt until the arms were flung five body heights sideways (K19f item 4's real cause).
  const frames = [];
  const buildFrames = () => {
    frames.length = 0;
    for (let t = 0; t < ticks; t++) {
      const f = { arms: { left: null, right: null }, aim: null };
      // the effector path: rest -> apex (ease) -> hold -> drive to the release point -> overshoot -> rest
      const u = t <= windup * 0.6 ? smooth(t / Math.max(1, windup * 0.6))
        : t <= windup ? 1
        : t <= release ? 1 - Math.pow(1 - (t - windup) / Math.max(1, drive), 2)   // the drive: ease-in, fast
        : t <= release + follow ? 0
        : smooth((t - release - follow) / Math.max(1, ticks - release - follow));
      // u: 0 at the apex/hold, 1 at the release point. The rest->apex leg is its own interpolation below.
      for (let i = 0; i < group.sites.length; i++) {
        const s = group.sites[i];
        let p;
        if (t <= windup * 0.6) {
          const a = smooth(t / Math.max(1, windup * 0.6));
          p = restTip[i] ? lerp3(restTip[i], plan.apex[i], a) : plan.apex[i].slice();
        } else if (t <= windup) {
          p = plan.apex[i].slice();
        } else if (t <= release) {
          p = lerp3(plan.apex[i], plan.targets[i], u);
        } else if (t <= release + follow) {
          const k = (t - release) / Math.max(1, follow);
          p = lerp3(plan.targets[i], plan.overshoot[i], smooth(k * 2) * 0.5 + k * 0.5);
        } else {
          // the RETURN retraces the wind-up ARC (through the same outward apex) instead of cutting straight
          // back to the hanging rest pose: a straight line from the release point down to a low wrist runs
          // through the torso of a small body (K19f: Icemon's arm crossed the 0.24 h torso capsule by
          // 0.30 h on the way back), while the arc the limb came out on is known to be clear.
          const k = (t - release - follow) / Math.max(1, ticks - release - follow);
          p = restTip[i]
            ? (k < 0.5 ? lerp3(plan.overshoot[i], plan.apex[i], smooth(k * 2))
                       : lerp3(plan.apex[i], restTip[i], smooth((k - 0.5) * 2)))
            : plan.overshoot[i].slice();
        }
        if (s.side === "left" || s.side === "right") f.arms[s.side] = p;
        else f.aim = { bone: s.bone, point: p };
      }
      // the body: a lean into the shot and a settle back
      //   t=0 neutral -> the wind-up leans AWAY (negative) -> +1 at release -> 0.5 through the follow-through
      //   -> back to 0 as the body returns. A body cast (mouth/chest) leans further: the torso IS the shot.
      let lean01;
      if (t <= windup) lean01 = -0.25 * smooth(t / Math.max(1, windup));
      else if (t <= release) lean01 = -0.25 + 1.25 * (1 - Math.pow(1 - (t - windup) / Math.max(1, drive), 2));
      else if (t <= release + follow) lean01 = 1 - 0.5 * smooth((t - release) / Math.max(1, follow));
      else lean01 = 0.5 * (1 - smooth((t - release - follow) / Math.max(1, ticks - release - follow)));
      f.lean = lean01 * (cls === "mouth" || cls === "body" ? 0.16 : 0.10);   // rad, forward at release
      // K20b: the head's own pitch for this tick (degrees, MESH frame, relative to neutral). It is the
      // cast's motion for a head emitter; for anything else it stays 0 and nothing in the bake reads it.
      f.head = headPlan ? headCastSchedule(headPlan, t, ticks) : 0;
      f.root = [0, 0, 0];                                 // feet planted: the root never moves
      frames.push(f);
    }
    return frames;
  };

  const plan = {
    ok: true, cls, mode: group.mode, size, H, floorY, torso: [torsoX, null, torsoZ], ticks, windup, drive,
    release, flight, follow, return: ret, frames, targets, origins, apex: apexOf(1), overshoot, shared, baseFrame,
    rel, hand, wu, isArm, sites: group.sites, apexUp, apexBack, restTip, muzzleTargets,
    // K20b: the head schedule (null for an arm/body cast), the cap on the body's own travel, and the tick
    // the aim may start at (after the head has come back down, so the aim never eats the lift)
    head: headPlan, headSites, rootCap, aimStart: headPlan ? Math.min(windup, headPlan.rise + headPlan.hold + headPlan.fall) : 0,
    swing: { base: SOLVER.swingBase, cap: SOLVER.swingCap, scale: 1 },
  };
  /** Widen (or reset) the outward swing: the apex moves out on each site's own side, the release stays. */
  plan.setSwing = (scale) => {
    plan.swing.scale = scale;
    plan.apex = apexOf(scale);
    buildFrames();
    return plan;
  };
  buildFrames();
  return plan;
}

// ── the bake: the plan solved onto the model's own skeleton ──────────────────────────────────────────

const mul = (A, B) => [0, 1, 2].map((r) => [0, 1, 2].map((c) => A[r][0] * B[0][c] + A[r][1] * B[1][c] + A[r][2] * B[2][c]));
const tr = (A) => [[A[0][0], A[1][0], A[2][0]], [A[0][1], A[1][1], A[2][1]], [A[0][2], A[1][2], A[2][2]]];
const mv = (A, v) => [A[0][0] * v[0] + A[0][1] * v[1] + A[0][2] * v[2], A[1][0] * v[0] + A[1][1] * v[1] + A[1][2] * v[2], A[2][0] * v[0] + A[2][1] * v[1] + A[2][2] * v[2]];
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len3 = (a) => Math.hypot(a[0], a[1], a[2]);
const unit3 = (a) => { const l = len3(a); return l > 1e-9 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0]; };
const ID3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
const rx = (t) => [[1, 0, 0], [0, Math.cos(t), -Math.sin(t)], [0, Math.sin(t), Math.cos(t)]];
const fromTo = (u, v) => {
  const a = unit3(u), b = unit3(v);
  if (!len3(a) || !len3(b)) return ID3;
  const c = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  if (c > 1 - 1e-9) return ID3;
  if (c < -1 + 1e-9) {
    const t = Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    const p = unit3([a[1] * t[2] - a[2] * t[1], a[2] * t[0] - a[0] * t[2], a[0] * t[1] - a[1] * t[0]]);
    return axisAngle(p, Math.PI);
  }
  const ax = unit3([a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]);
  return axisAngle(ax, Math.atan2(len3([a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]), c));
};
const axisAngle = (axis, ang) => {
  const [x, y, z] = axis, c = Math.cos(ang), s = Math.sin(ang), t = 1 - c;
  return [[t * x * x + c, t * x * y - s * z, t * x * z + s * y],
          [t * x * y + s * z, t * y * y + c, t * y * z - s * x],
          [t * x * z - s * y, t * y * z + s * x, t * z * z + c]];
};
const axisOf = (M) => {
  const c = clamp((M[0][0] + M[1][1] + M[2][2] - 1) / 2, -1, 1);
  const ang = Math.acos(c);
  if (ang < 1e-9) return { axis: [0, 0, 1], ang: 0 };
  const ax = [M[2][1] - M[1][2], M[0][2] - M[2][0], M[1][0] - M[0][1]];
  return { axis: unit3(ax), ang };
};
const clampRot = (M, max) => { const { axis, ang } = axisOf(M); return ang <= max ? M : axisAngle(axis, max); };
/** The same rotation, scaled to `k` of its angle — the aim's fade in/out over the cast. */
const scaleRot = (M, k) => { if (!(k < 1)) return M; const { axis, ang } = axisOf(M); return ang < 1e-9 ? M : axisAngle(axis, ang * k); };
const localOf = (c0, c1, c2) => {
  const Rz = [[Math.cos(c2 * TAU), -Math.sin(c2 * TAU), 0], [Math.sin(c2 * TAU), Math.cos(c2 * TAU), 0], [0, 0, 1]];
  const Ry = [[Math.cos(c1 * TAU), 0, Math.sin(c1 * TAU)], [0, 1, 0], [-Math.sin(c1 * TAU), 0, Math.cos(c1 * TAU)]];
  const Rx = [[1, 0, 0], [0, Math.cos(c0 * TAU), -Math.sin(c0 * TAU)], [0, Math.sin(c0 * TAU), Math.cos(c0 * TAU)]];
  return mul(Rz, mul(Ry, Rx));
};
/** A real local rotation -> a ch2 triple, nearest the previous key (the K16 branch rule). */
function toCh2(M, prev = null) {
  const cb = Math.hypot(M[0][0], M[1][0]);
  let c0, c1, c2;
  if (cb > 1e-7) { c1 = Math.atan2(-M[2][0], cb); c2 = Math.atan2(M[1][0], M[0][0]); c0 = Math.atan2(M[2][1], M[2][2]); }
  else { c1 = Math.atan2(-M[2][0], cb); c2 = Math.atan2(-M[0][1], M[1][1]); c0 = 0; }
  let t = [c0 / TAU, c1 / TAU, c2 / TAU];
  if (prev) {
    const wrap = (x, p) => { let d = x - p; d = ((d % 4096) + 4096) % 4096; if (d > 2048) d -= 4096; return p + d; };
    const alt = [t[0] + 2048, 2048 - t[1], t[2] + 2048];
    const cost = (v) => Math.abs(v[0] - prev[0]) + Math.abs(v[1] - prev[1]) + Math.abs(v[2] - prev[2]);
    const a = t.map((x, i) => wrap(x, prev[i])), b = alt.map((x, i) => wrap(x, prev[i]));
    t = cost(a) <= cost(b) ? a : b;
  }
  const norm = (x) => { let r = Math.round(x) % 4096; if (r < 0) r += 4096; return r >= 2048 ? r - 4096 : r; };
  return [norm(t[0]), norm(t[1]), norm(t[2])];
}

/** Parent-before-child order, the subtree of each bone, and the rest world pose. */
function rigTopology(model) {
  const n = model.num_bones ?? model.bones.length;
  const kids = Array.from({ length: n }, () => []);
  const roots = [];
  const parent = Array.from({ length: n }, (_, i) => (model.bones[i]?.parent_slot ?? 0) - 1);
  for (let i = 0; i < n; i++) {
    const p = parent[i];
    if (p >= 0 && p < n) kids[p].push(i); else roots.push(i);
  }
  const order = [];
  const stack = roots.slice().reverse();
  while (stack.length) {
    const i = stack.pop();
    order.push(i);
    for (const k of kids[i].slice().reverse()) stack.push(k);
  }
  for (let i = 0; i < n; i++) if (!order.includes(i)) order.push(i);
  const subs = Array.from({ length: n }, () => []);
  for (let i = 0; i < n; i++) {
    let p = i, guard = 0;
    while (p >= 0 && p < n && guard++ <= n) { subs[p].push(i); p = parent[p]; }
  }
  return { n, kids, roots, order, subs, parent };
}

/**
 * A baked channel: the authored keys, a HOLD key at `holdAt` carrying the last authored value, the baked
 * keys, then the 30000 sentinel. The hold key is not cosmetic: without it the channel line runs from the
 * last authored frame straight to the first baked one, so every frame in between — another technique's
 * table window, an idle read — is drawn on that line, and a solved bake silently moved a NEIGHBOURING
 * technique's launch bytes (K19e §1: m094icem Ice Blow's op6 573 -> 767). With it, every frame outside the
 * baked window samples exactly what it sampled before the bake.
 */
function withHold(own, added, holdAt) {
  const out = Array.isArray(own) ? own.filter((r) => r[3] !== 30000).map((r) => r.slice()) : [];
  if (out.length && out[out.length - 1][3] < holdAt) {
    const v = out[out.length - 1];
    out.push([v[0], v[1], v[2], holdAt]);
  }
  const last = added[added.length - 1];
  return [...out, ...added, [last[0], last[1], last[2], 30000]];
}

/**
 * The model's OWN idle playlist: the frames of table 1 (the table clip-fallback binds as the idle), in
 * playback order. The engine plays one entry per tick, so walking this list at one entry per tick is the
 * idle's own rate — that is what a cast must keep playing underneath (K20b item 3).
 */
export function idlePlaylist(model, fallback = null) {
  const tab = model?.timeline?.[1]?.table ?? [];
  const out = tab.map((e) => e?.value | 0).filter((v) => v >= 0 && v < 0x8000);
  if (out.length) return out;
  return [fallback ?? neutralFrame(model)];
}

/**
 * Solve `plan` onto `target`'s own skeleton, writing ch2 keys APPENDED past every authored frame and a new
 * playlist table at a free index. Returns { model, table, offset, ticks, trace, metrics }.
 *
 * The solve is the K16 arithmetic (its two-bone IK, its joint clamp, its branch-continuous ch2 writer):
 *   1. every bone starts at the model's OWN IDLE at that tick (its idle playlist, one entry per tick), so
 *      a bone the solver does not drive keeps breathing instead of freezing on one frame (K20b item 3);
 *   2. the body lean, the head's measured pitch (head casts), then the emitter limbs: an arm's chain is
 *      IK'd to the planned point, then the last joint re-aims the FIRING AXIS onto the aim line (R1); a
 *      head/chest/tail emitter is rotated to aim;
 *   3. the locals are written as ch2 keys with the K16 joint limit, the root's ch1 pinned (feet planted).
 */
export function bakeSolverPose(target, plan, { offset = SOLVER.offset, table = null, baseFrame = null } = {}) {
  const rig = rigOf(target);
  const folder = target.folder ?? null;
  const topo = rigTopology(target);
  const { n, subs, parent } = topo;
  const ticks = plan.ticks;
  // the body's NEUTRAL pose is its own idle (K19f): starting from the channel's frame 0 could stand the
  // body a tenth of its height below the pose the engine actually draws when it stands.
  const base = baseFrame ?? plan.baseFrame ?? neutralFrame(target);
  const rest = poseFromChannels(target, base);
  const restW = rest.rot.map((f) => [[f[0], f[3], f[6]], [f[1], f[4], f[7]], [f[2], f[5], f[8]]]);
  // ── the IDLE the cast plays over (K20b item 3) ────────────────────────────────────────────────────────
  // Every bone starts each tick at the pose the model itself is standing in on the idle playlist, and the
  // solver's motion is layered on that. A bone the cast does not drive therefore keeps the idle's own
  // breathing (wings, tail, crest) instead of being frozen on one frame for the whole cast and popping on
  // entry and exit, and the table's first and last frame land on an idle frame.
  const idleList = idlePlaylist(target, base);
  const m3 = (f) => [[f[0], f[3], f[6]], [f[1], f[4], f[7]], [f[2], f[5], f[8]]];
  const idlePoses = idleList.map((f) => poseFromChannels(target, f));
  const idleW = idlePoses.map((p) => p.rot.map(m3));
  const idleL = idlePoses.map((p, k) => p.rot.map((f, i) => {
    const pp = parent[i];
    return mul(tr(pp >= 0 && pp < n ? idleW[k][pp] : ID3), m3(f));
  }));
  const rootBone = rig.root;
  const keys = new Map(), prevKeys = new Map(), key1 = new Map();
  const metrics = { ikClamped: 0, jointsClamped: 0, axisAim: 0, bones: 0, unreachable: 0 };
  const trace = [];

  // world rotations for one tick, from the IDLE frame of that tick
  const W = new Array(n), P = new Array(n);
  let W0 = restW;                    // the idle frame the current tick stands on (set per tick)
  let curFrame = base;
  const rebuild = () => {
    for (const i of topo.order) {
      const c1 = chan(target.bones[i]?.anim?.ch1, curFrame);
      const p = parent[i];
      if (p < 0 || p >= n) { P[i] = [-c1[0], c1[1], -c1[2]]; continue; }
      const o = mv(W[p], c1);
      P[i] = [P[p][0] - o[0], P[p][1] + o[1], P[p][2] - o[2]];
    }
  };
  const rotateSubtree = (bone, R) => { for (const j of subs[bone]) W[j] = mul(R, W[j]); };
  // a bone whose subtree carries mesh that stands on the floor at the neutral pose: turning it drags the
  // feet, so a head cast spreads its pitch over the ancestors ABOVE that line only (K20a's hub section).
  const groundedSet = (() => {
    const low = lowestVertex(target, rest);
    const out = new Set();
    if (!Number.isFinite(low.y)) return out;
    for (let i = 0; i < n; i++) {
      const vs = target.bones[i]?.verts || [];
      if (!vs.length) continue;
      const R = restW[i], p0 = rest.pos[i];
      if (!R || !p0) continue;
      for (const v of vs) {
        const y = (R[1][0] * v[0] + R[1][1] * v[1] + R[1][2] * v[2]) + p0[1];
        if (y >= low.y - 0.12 * plan.H) { out.add(i); break; }
      }
    }
    return out;
  })();
  const carriesGrounded = (bone) => [...subs[bone]].some((b) => groundedSet.has(b));
  const baseLowY = lowestVertex(target, rest).y;
  /** The joints a head cast may pitch: the head's own joint, then its ancestors while they carry no feet. */
  const headJointsOf = (bone) => {
    const out = [bone];
    let p = parent[bone], guard = 0;
    while (p >= 0 && p < n && guard++ < n) {
      if (carriesGrounded(p)) break;
      out.push(p);
      p = parent[p];
    }
    return out;
  };
  // the floor the model itself stands on at each idle frame: the cast may not float above the pose the
  // actor is standing in at that tick (the idle's own bob is the idle's business, not the cast's)
  const idleLowY = idlePoses.map((p) => lowestVertex(target, p).y);

  for (let t = 0; t < ticks; t++) {
    const frame = plan.frames[Math.min(plan.frames.length - 1, t)];
    const idleIdx = idleList.length ? (t % idleList.length) : 0;
    W0 = idleW[idleIdx];
    curFrame = idleList[idleIdx] ?? base;
    const LrTick = idleL[idleIdx] ?? null;
    for (let i = 0; i < n; i++) W[i] = W0[i];
    rebuild();
    // 1. the body: a lean about the torso, the counter-move on the non-firing arm happens below
    if (frame.lean && rig.torso != null) { rotateSubtree(rig.torso, rx(frame.lean * (plan.leanScale ?? 1))); rebuild(); }
    if (K19F_DEBUG && t === 0) {
      const bad = [];
      for (let i = 0; i < n; i++) {
        const d = Math.hypot(P[i][0] - rest.pos[i][0], P[i][1] - rest.pos[i][1], P[i][2] - rest.pos[i][2]);
        if (d > 0.5) bad.push(`${i}:${d.toFixed(0)} P=${P[i].map(Math.round)} rest=${rest.pos[i].map(Math.round)}`);
      }
      console.error("[t0 rebuild] mismatched bones", bad.length, bad.join(" | "));
    }
    // the AIM is faded in over the wind-up and out over the return (K19f item 4): the first and last frame
    // of the table are the body's own idle pose to the letter (R4/C13), the release frame is fully aimed
    // (R1). Without the fade the arm is turned to aim from frame 0, which is not the rest pose at all.
    // K20b: a HEAD cast fades the aim in only AFTER the head has come back down (plan.aimStart), so the aim
    // never eats the lift's own measured pitch.
    const aimTail = Math.max(1, ticks - plan.release - plan.follow);
    const aimStart = Math.min(plan.aimStart ?? 0, Math.max(0, plan.windup - 1));
    // K20b: on a HEAD cast the aim starts only after the fall, which leaves no wind-up to fade it in — with
    // `windup - aimStart` it reached full aim in ONE tick (a 73-244 deg/tick head snap, the jump gate's
    // failure). Its fade is the run from the end of the fall to the RELEASE frame instead, so the aim lands
    // exactly when the shot leaves and the head travels there smoothly.
    const aimIn = Math.max(1, (plan.headSites ? Math.max(plan.release, plan.windup) : plan.windup) - aimStart);
    const aimB = Math.min(smooth((t - aimStart) / aimIn), smooth((ticks - 1 - t) / aimTail));
    // 2. the emitters
    // The renderer's world point is S·(W·v) + t with S = diag(-1, 1, -1) (firing-axis.js vertexWorld
    // negates x and z). So a world-space rotation R applied to a bone's matrix rotates the DRAWN geometry
    // by S·R·S. Both the measured axis and the wanted direction therefore go through S before the
    // rotation is computed — otherwise the limb turns about a mirrored axis and never lands on the aim.
    const num = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const toMat = (v) => [-v[0], v[1], -v[2]];
    /**
     * The rotation to apply to a bone so that the DRAWN geometry turns `u` onto `v`. The drawn geometry is
     * the bone matrix conjugated by S = diag(-1, 1, -1) (see the comment above), so both vectors go through
     * S before the rotation is built — the same convention the aim pass uses below. Building it from the
     * unmirrored vectors (what the position passes used to do) swings the limb through the MIRRORED arc in
     * x/z: it drove Piedmon's wrist 0.18 h the wrong way instead of onto a point well inside its reach.
     */
    const fromToDraw = (u, v) => fromTo(toMat(u), toMat(v));
    const measure = (site, aimPoint) => {
      const poseNow = { rot: W.map(flatOf), pos: P.map((p) => p.slice()) };
      const fa = firingAxis(target, folder, site.id, poseNow, { rest });
      if (!fa || !len3(fa.axis)) return null;
      const wantDir = unit3(sub3(aimPoint, fa.origin));
      const want = len3(wantDir) ? wantDir : fa.axis;
      return { fa, want, axisM: toMat(fa.axis), wantM: toMat(want), err: Math.acos(clamp(num(fa.axis, want), -1, 1)) * 180 / Math.PI };
    };
    /**
     * Turn `bone` until the module's measured FIRING AXIS is on the aim line. The candidate rotations are
     * tried and the best KEPT (a hill climb, not a blind step): the geometry's axis has a sign of its own
     * (which end of a prop is the muzzle) and the rotation that takes it onto the aim line can be
     * degenerate when the two are nearly opposite, so the solver tries the direct answer, the mirrored one
     * and does nothing, and keeps whichever measurably aims best. At most 3 passes; eps is the acceptance.
     *
     * `blend` fades the aim in and out over the cast (K19f item 4): at the FIRST and LAST frame of the
     * table the body must stand exactly as it stands when idle (R4/C13), and an arm turned to aim a blade
     * at the target from frame 0 is not its rest pose — that turn alone buried Piedmon's upper arm 0.036 h
     * inside his own thigh at both ends of the cast.
     */
    const turnTo = (bone, site, aimPoint, eps, maxAng = Infinity, blend = 1) => {
      let best = measure(site, aimPoint);
      if (!best) return false;
      let applied = 0;
      for (let pass = 0; pass < 3 && best.err > eps; pass++) {
        const snapW = W.slice();
        let pick = null;
        for (const cand of [fromTo(best.axisM, best.wantM), fromTo(best.axisM.map((v) => -v), best.wantM), fromTo(best.axisM, best.wantM.map((v) => -v))]) {
          const R = scaleRot(maxAng < Math.PI ? clampRot(cand, maxAng) : cand, blend);
          if (axisOf(R).ang < 1e-4) continue;
          for (let j = 0; j < n; j++) W[j] = snapW[j];
          rotateSubtree(bone, R); rebuild();
          const m = measure(site, aimPoint);
          if (m && m.err < best.err - 0.02) { pick = m; break; }
        }
        if (!pick) { for (let j = 0; j < n; j++) W[j] = snapW[j]; rebuild(); break; }
        best = pick; applied++; metrics.axisAim++;
      }
      return applied > 0;
    };
    // A CENTRE emitter is carried by its ancestors: rotating the emitter bone itself only spins the mesh
    // about its own head, so the firing point never travels (K19f: Kokatorimon's mouth moved 0.000 h in
    // every axis). The chain that moves it is the path from the body's root down to it, and the effector
    // is the firing TIP (launch-plan's own tip arithmetic), not the bone head.
    const tipPrev = new Map(plan.sites.map((s) => [s.bone, chainPrevBone(folder, s.id, s.bone)]));
    const driveChainOf = (bone) => {
      const chain = [];
      let p = parent[bone], guard = 0;
      while (p >= 0 && p < n && guard++ < n) { chain.push(p); p = parent[p]; }
      chain.reverse();
      // the root itself is the last resort (a bird's head is attached straight to the body): it may be
      // turned, because the ground gate then judges the feet the turn lifts.
      return chain;
    };
    /** Rotate the joints that CARRY a centre emitter until its firing tip reaches `point`. */
    const ccdTip = (chain, s, point, passes) => {
      const prev = tipPrev.get(s.bone) ?? null;
      for (let pass = 0; pass < passes; pass++) {
        for (let k = chain.length - 1; k >= 0; k--) {
          const j = chain[k];
          const tip = tipOf(P, target, s.bone, prev);
          if (!tip) continue;
          const u = sub3(tip, P[j]), v = sub3(point, P[j]);
          if (len3(u) < 1e-6 || len3(v) < 1e-6) continue;
          const R = fromToDraw(u, v);
          if (axisOf(R).ang < 1e-6) continue;
          rotateSubtree(j, clampRot(R, K16.maxIk));
          rebuild();
        }
      }
    };
    /**
     * R1, DISTRIBUTED: turn the limb's joints from the most DISTAL inward until the measured axis is on the
     * aim line. The old pass turned the shoulder only, which swings the whole limb about the body: on a
     * three-bone chibi arm it dragged both hands to the midline (K19f: Icemon's arms came to 0.009 h apart
     * in a spread cast), and on a five-bone arm it left the shoulder in a configuration the aim could not
     * recover (Knightmon, 103.5 deg). The distal joints move the hand least, so they are tried first.
     */
    const aimChain = (chain, s, point, eps = 0.004, blend = 1) => {
      // a PROP turns its wrist to aim the blade, and a wrist turn sweeps a metre of steel through whatever
      // stands beside the body (Piedmon's own back box): a prop is aimed from the SHOULDER inward, so the
      // blade travels with the whole arm instead of pivoting into the torso. A bare hand aims from the
      // wrist outward, which keeps the hand where the plan put it.
      const order = s.cls === "prop" ? chain.slice() : chain.slice().reverse();
      for (const j of order) {
        turnTo(j, s, point, eps, K16.maxIk, blend);
        const m = measure(s, point);
        if (m && m.err <= Math.max(eps * 2, 0.02)) break;   // close enough: stop climbing
      }
    };
  let rootDelta = [0, 0, 0];
    for (const s of plan.sites) {
      const chain = s.chain ?? null;
      if (chain && chain.length) {
        const want = frame.arms[s.side];
        if (!want) continue;
        const tipBone = chain[chain.length - 1];
        const aim = plan.aimPoints?.[plan.sites.indexOf(s)] ?? plan.aimPoint ?? [0, P[tipBone]?.[1] ?? 0, 1e5];
        const shoulder = chain[0];
        // the aim is toward the TARGET POINT, the position is the planned release point; and a body whose
        // arm is shorter than the class median cannot put its wrist at the median point. Its release point
        // is the median DIRECTION at its OWN reach (pulled in below, reported as plan.reachPull) — asking the
        // IK for a point the arm cannot touch only bends the body into a lean.
        const chainLenNow = (() => { let L = 0; for (let i = 1; i < chain.length; i++) L += len3(sub3(P[chain[i]], P[chain[i - 1]])); return L; })();
        const maxReach = chainLenNow * K16.reachSlack;
        const wantD = len3(sub3(want, P[shoulder]));
        const wantP = wantD > maxReach && wantD > 1e-6
          ? [P[shoulder][0] + (want[0] - P[shoulder][0]) * maxReach / wantD,
             P[shoulder][1] + (want[1] - P[shoulder][1]) * maxReach / wantD,
             P[shoulder][2] + (want[2] - P[shoulder][2]) * maxReach / wantD]
          : want;
        // POSITION then AIM, repeated: CCD walks the chain's own joints so the wrist lands on the planned
        // point (each joint bounded by K16.maxIk), then the AIM is distributed from the wrist inward (R1).
        // CCD needs no elbow/split guess: it works for a 2-bone chibi arm and a 5-bone knight's arm alike,
        // and it straightens the arm when the target is at the edge of reach instead of folding it.
        const ccd = (target, passes) => {
          for (let pass = 0; pass < passes; pass++) {
            for (let k = chain.length - 2; k >= 0; k--) {
              const j = chain[k];
              const u = sub3(P[tipBone], P[j]), v = sub3(target, P[j]);
              if (len3(u) < 1e-6 || len3(v) < 1e-6) continue;
              const R = fromToDraw(u, v);
              if (axisOf(R).ang < 1e-6) continue;
              rotateSubtree(j, clampRot(R, K16.maxIk));
              rebuild();
            }
          }
        };
        // the part that FIRES: a prop's muzzle (K19b's measured origin), or a bare hand's own tip. Driving
        // the WRIST to the class's release point and then aiming the wrist swings the muzzle (a sword is a
        // metre long) — K19f measured both of Piedmon's muzzles at the midline, 0.03 h apart.
        //
        // The muzzle rides the WRIST PATH: its target is the wrist path point plus the muzzle's offset from
        // the wrist, blended from the offset the arm HAS (no correction at all, so frame 0 stays the body's
        // own idle, R4/C13) to the class's release-time offset at full aim. A fixed release target at every
        // tick used to drag the whole arm off its rest pose on frame 0.
        const idx = plan.sites.indexOf(s);
        const mt = plan.muzzleTargets?.[idx] ?? null;
        const rt = plan.targets[idx] ?? null;
        const effOff = mt && rt ? [mt[0] - rt[0], mt[1] - rt[1], mt[2] - rt[2]] : [0, 0, 0];
        const ccdEff = (aimScale, passes) => {
          for (let pass = 0; pass < passes; pass++) {
            for (let k = chain.length - 2; k >= 0; k--) {
              const j = chain[k];
              const m = measure(s, aim);
              const eff = m?.fa?.origin ?? P[tipBone];
              if (!eff) continue;
              const cur = sub3(eff, P[tipBone]);
              const point = [wantP[0] + cur[0] + (effOff[0] - cur[0]) * aimScale,
                             wantP[1] + cur[1] + (effOff[1] - cur[1]) * aimScale,
                             wantP[2] + cur[2] + (effOff[2] - cur[2]) * aimScale];
              const u = sub3(eff, P[j]), v = sub3(point, P[j]);
              if (len3(u) < 1e-6 || len3(v) < 1e-6) continue;
              const R = fromToDraw(u, v);
              if (axisOf(R).ang < 1e-6) continue;
              rotateSubtree(j, clampRot(R, K16.maxIk));
              rebuild();
            }
          }
        };
        for (let round = 0; round < 3; round++) {
          ccd(wantP, 2);        // the wrist to the planned hand point (the arm's own reach)
          aimChain(chain, s, aim, 0.004, aimB);
          ccdEff(aimB, 1);      // the muzzle to where the class fires from
          aimChain(chain, s, aim, 0.004, aimB);
          if (K19F_DEBUG && t === 0) console.error("[t0 round]", round, s.id, "want", want.map(Math.round), "wantP", wantP.map(Math.round), "tip", P[tipBone].map(Math.round), "aimB", aimB);
        }
        const S0 = P[shoulder];
        if (wantD > maxReach + 1e-6) metrics.unreachable++;      // the plan asked past the arm; pulled in
        const reachD = len3(sub3(wantP, S0));
        const chainLen = (() => { let L = 0; for (let i = 1; i < chain.length; i++) L += len3(sub3(P[chain[i]], P[chain[i - 1]])); return L; })();
        if (reachD > chainLen * K16.reachSlack + 1e-6) metrics.unreachable++;
        if (t === plan.release) (metrics.reachPull ??= []).push({ id: s.id, wantD: +(wantD / plan.H).toFixed(3), max: +(maxReach / plan.H).toFixed(3) });
      } else if (frame.aim && frame.aim.bone === s.bone) {
        // a centre emitter (mouth / head / chest / back / body): its point is moved by BODY TRANSPORT — the
        // whole body's roots slide along the plan (a lunge), so a body with no neck bone still throws its
        // mouth forward without swinging one hierarchy through the other. Its own bone then aims the axis;
        // a rotation about the emitter's own head does not move the tip, so the aim cannot undo the drive.
        const i = plan.sites.indexOf(s);
        const restP = plan.restTip?.[i] ?? null;
        if (restP) {
          const d = sub3(frame.aim.point, restP);
          rootDelta = [rootDelta[0] + d[0], rootDelta[1] + d[1], rootDelta[2] + d[2]];
        }
        // K20b: the head's OWN pitch. K20a measured it in the MESH frame (the geometry the player sees);
        // the module's firing axis reports the exact mirror (geoPitch + axisPitch = 0 on 110 of 115
        // casts), and a world rotation about X of `a` turns the DRAWN geometry by -a. So the pitch is
        // applied as a world rx(+deg) and the measured mesh pitch rises by +deg — the sign is checked by
        // the gate (peak pitch must land inside the disc's p10..p90) and by tests/anim-head-cast.test.js.
        const pitch = frame.head || 0;
        const carriesFeet = carriesGrounded(s.bone);
        // K20b item 2: a head bone that ALSO carries the parts that stand on the floor is the body's hub —
        // pitching it pitches the whole lower body (K20a: the disc does exactly that in 4 casts, and lets
        // the feet drift 0.3-0.6 H). Our ground and clearance gates refuse that body pitch on every hub
        // body measured, and K20a's own hub cell is n=4 ("an existence proof, not a rule"), so the hub case
        // keeps the body-transport motion it had. A FREE head (111 of the 115 measured casts) gets the lift.
        if (pitch) {
          const joints = headJointsOf(s.bone);
          const share = (pitch * Math.PI / 180) / Math.max(1, joints.length);
          for (const j of joints) rotateSubtree(j, rx(share));
          rebuild();
        }
        // an emitter whose bone also CARRIES the parts that stand on the floor (any bone whose mesh reaches
        // the ground at the neutral pose hangs off it) may only be re-aimed by a few degrees: turning it
        // swings the whole lower body through the torso. The aim tolerance absorbs what is left. K20a's hub
        // section says the disc itself turns that bone 25-30 deg and lets the feet drift 0.3-0.6 H, and it
        // re-poses the legs; the ground gate below judges the feet the turn lifts (K20b item 2).
        if (carriesFeet) {
          turnTo(s.bone, s, frame.aim.point, 0.004, SOLVER.centreAimMax, aimB);
        } else {
          // a FREE head is aimed ONCE per tick: the old pass ran the same turn twice, which on a head whose
          // rest axis is far from the aim line walked it past the disc's own band (K20a's p90) and left a
          // 73-195 deg/tick pop between two frames — the jump gate refused it (K20b, m069flar / m005grey).
          turnTo(s.bone, s, frame.aim.point, 0.004, K16.maxJoint, aimB);
        }
      }
    }
    // K20b: THE GROUND, APPLIED NOT REFUSED. A head bone that carries the lower body pitches it too
    // (K20a's hub section: the disc tips the whole body and lets the feet drift 0.3-0.6 H). The solver
    // keeps that body pitch and drops the root by exactly the rise the PLAYED pose takes above the floor
    // the model itself stands on at this tick (its idle floor), so the feet stay planted and no leg pose
    // is invented that the disc never plays.
    if (plan.head && plan.headSites) {
      const lowNow = lowestVertex(target, { rot: W.map(flatOf), pos: P });
      const rise = (idleLowY[idleIdx] ?? baseLowY) - lowNow.y;
      if (Number.isFinite(rise) && rise > 1e-6) {
        rootDelta[1] += rise;
        metrics.footPlant = Math.max(metrics.footPlant ?? 0, +(rise / plan.H).toFixed(3));
      }
    }
    // 3. locals -> ch2 keys (joint limit against the model's own rest joint, branch continuity)
    if (t === plan.release) {
      metrics.aimAfter = [];
      for (const [k, s] of plan.sites.entries()) {
        const m = measure(s, plan.aimPoints?.[k] ?? plan.aimPoint);
        if (m) metrics.aimAfter.push({ id: s.id, err: +m.err.toFixed(2) });
      }
    }
    for (let i = 0; i < n; i++) {
      // the ROOT is keyed too, at its own idle rotation: the table lives at frames far past the authored
      // ones, so a bone with no key of its own would be drawn at its LAST AUTHORED value, not at the pose
      // the solve started from. That leak is a global rotation (every bone off by the same amount: 0.34 rad
      // on one exemplar), and it silently walks the muzzle off the aim line — the read-back in solveCast
      // caught it. A root key at the idle changes nothing the solver does and makes the drawn pose the
      // solved pose.
      const p = parent[i];
      const Wp = p >= 0 && p < n ? W[p] : ID3;
      const L = mul(tr(Wp), W[i]);
      // K20b: the delta is measured against the IDLE local of this tick, so a bone the cast does not drive
      // keeps its idle value exactly (dc = I) and the joint limit is a limit on the cast's own deviation.
      const Lr = LrTick?.[i] ?? mul(tr(p >= 0 && p < n ? restW[p] : ID3), restW[i]);
      const d = mul(tr(Lr), L);
      const dc = clampRot(d, K16.maxJoint);
      const { ang } = axisOf(d);
      if (ang > K16.maxJoint) metrics.jointsClamped++;
      const moved = Math.abs(dc[0][0] - 1) + Math.abs(dc[1][1] - 1) + Math.abs(dc[2][2] - 1)
        + Math.abs(dc[0][1]) + Math.abs(dc[1][0]) + Math.abs(dc[0][2]) + Math.abs(dc[2][0])
        + Math.abs(dc[1][2]) + Math.abs(dc[2][1]);
      // every bone gets a key: a bone the solver did not move is written at its own IDLE rotation for that
      // tick, so the table is a complete pose (no authored channel leaks into it) AND the body keeps
      // breathing through the cast instead of freezing on one frame (K20b item 3)
      const out = toCh2(mul(Lr, dc), prevKeys.get(i) ?? null);
      prevKeys.set(i, out);
      if (!keys.has(i)) keys.set(i, []);
      keys.get(i).push([out[0], out[1], out[2], offset + t]);
      if (moved > 1e-7) metrics.bones++;    // counted per tick; the report divides by the tick count
    }
    // 4. translations: the pose is PLANTED, so every bone's ch1 is held at its IDLE value for the whole
    //    table (a bone whose idle ch1 drifts keeps drifting — that sway is the idle's own). This is also
    //    what makes the solver's own pose and the renderer's sample agree: the renderer samples ch1 at the
    //    table's frame, so a bone whose authored ch1 moves would otherwise be drawn somewhere the solver
    //    never solved.
    const c1s = new Array(n);
    for (let i = 0; i < n; i++) {
      const c1 = chan(target.bones[i]?.anim?.ch1, curFrame);
      // +Y is down and a root's ch1 is written as (x, y, z) with the model's axes (pos = -x, +y, -z):
      // a body-transport delta in MODEL space is (-dx, +dy, -dz) in the channel.
      const isRoot = parent[i] < 0;
      c1s[i] = [
        Math.round(c1[0] - (isRoot ? rootDelta[0] : 0)),
        Math.round(c1[1] + (isRoot ? rootDelta[1] : 0)),
        Math.round(c1[2] - (isRoot ? rootDelta[2] : 0)),
      ];
    }
    for (const i of topo.order) {
      const c1 = c1s[i];
      if (!key1.has(i)) key1.set(i, []);
      key1.get(i).push([c1[0], c1[1], c1[2], offset + t]);
    }
    trace.push({ t, pos: P.map((p) => (p ? p.slice() : null)), rot: W.map((M) => M.map((r2) => r2.slice())) });
  }

  const model = {
    ...target,
    bones: target.bones.map((b, i) => {
      const moved = keys.get(i);
      const trans = key1.get(i);
      if (!moved && !trans) return b;
      const anim = { ...(b.anim || {}) };
      if (moved) anim.ch2 = withHold(b.anim?.ch2, moved, offset);
      if (trans) anim.ch1 = withHold(b.anim?.ch1, trans, offset);
      return { ...b, anim };
    }),
  };
  const idx = table ?? (() => { let k = Math.max(62, model.timeline?.length ?? 0); while (model.timeline?.[k]?.table) k++; return k; })();
  model.timeline = (target.timeline ? target.timeline.slice() : []);
  model.timeline[idx] = { table: [
    ...Array.from({ length: ticks }, (_, i) => ({ value: offset + i, loop_target: 0, aux: null })),
    { value: 0x8000, loop_target: 0, aux: null },
  ] };
  metrics.bones = keys.size;
  // K20b: does the head bone ALSO carry the parts that stand on the floor (K20a's "hub" head)? The gate
  // reports it, because it is the reason this body's lift is a fraction of the disc's own.
  if (plan.head && plan.sites?.[0]) metrics.headHub = carriesGrounded(plan.sites[0].bone);
  return { model, table: idx, offset, ticks, trace, metrics };
}

// ── the entry point: solve, verify, and (on pass) write into the live model ─────────────────────────

/** The point an emitter's axis is aimed at: the opponent's mid-body, on its own line, in model space. */
function targetPoint(model, plan) {
  const H = plan.H;
  return [0, plan.floorY - H * 0.5, plan.torso[2] + SOLVER.aimDistance];
}

/** The firing TIP of one site under a pose — the same point launch-plan writes the launch op from. */
function tipAt(pose, model, folder, s) {
  return tipOf(pose.pos, model, s.bone, chainPrevBone(folder, s.id, s.bone));
}

/**
 * Judge a baked cast against the rules over the WHOLE cast (K19f):
 *   aim        the firing axis at release (R1)
 *   clearance  every pair, every sampled tick, against ITS OWN neutral clearance minus the capsule noise
 *              (a pair that stands 0.4 h apart at rest may not travel into the torso; a pair the rest pose
 *              already overlaps is judged against its own noise, never a blanket 0.16 h)
 *   ground     the lowest mesh point of the PLAYED pose, every sampled tick, against the neutral floor
 *   gap        a spread's two shots stay at least one hand block apart at every sampled tick (R3)
 *   motion     the emitter travels: the plan asks for the measured lift/drive, and the pose achieves at
 *              least SOLVER.driveFloor of it (R2 — no more aiming by standing still)
 *   reachable  the wrist gets to the planned point without stretching past the arm
 */
export function verifyBake(model, plan, bake, group) {
  const folder = model.folder;
  const off = bake.offset;
  const neutral = poseFromChannels(bake.model, plan.baseFrame ?? 0);
  const relPose = poseFromChannels(bake.model, off + plan.release);
  const aim = [];
  for (const [i, s] of plan.sites.entries()) {
    const fa = firingAxis(bake.model, folder, s.id, relPose);
    if (!fa) { aim.push({ id: s.id, error: null }); continue; }
    const e = aimError(fa.axis, fa.origin, plan.aimPoints?.[i] ?? plan.aimPoint);
    aim.push({ id: s.id, cls: fa.cls, origin: fa.origin, axis: fa.axis, error: e.full, yaw: e.yaw, pitch: e.pitch });
  }
  const worstAim = Math.max(...aim.map((a) => (a.error == null ? 999 : a.error)));
  // where the emitter actually IS at release — the muzzle/mouth the geometry reports (a prop arm's wrist is
  // NOT its muzzle), in the same body-relative units as the constants
  const body = (q) => ({ height: (plan.floorY - q[1]) / plan.H, forward: (q[2] - plan.torso[2]) / plan.H, lateral: Math.abs(q[0]) / plan.H });
  const reached = plan.sites.map((s, i) => {
    const o = aim[i]?.origin, p = relPose.pos[s.bone];
    if (!o || !p) return null;
    const wantM = plan.isArm ? plan.hand : plan.rel;      // what the class's own casts say: wrist for an arm
    return {
      id: s.id, ...body(o), bone: body(p),
      want: wantM ? { height: +(wantM.height / plan.H).toFixed(3), forward: +(wantM.forward / plan.H).toFixed(3) } : null,
    };
  });
  // ── clearance: per pair, against the body's own NEUTRAL clearance (not a blanket slack) ────────────
  const rigC = rigColliders(bake.model, folder);
  const posedNeutral = rigC ? rigC.colliders.map((c) => poseCollider(c, neutral)) : [];
  // The baseline is the body's OWN IDLE, not one frozen frame (K20b): the cast now plays over the idle
  // playlist, so a pair's own clearance is the CLOSEST its idle ever stands it. Judging against the neutral
  // frame alone would flag the idle's own breathing.
  const idleSample = (() => {
    const list = idlePlaylist(bake.model, plan.baseFrame ?? 0);
    const step = Math.max(1, Math.floor(list.length / 24));
    const out = [neutral];
    for (let i = 0; i < list.length; i += step) out.push(poseFromChannels(bake.model, list[i]));
    return out;
  })();
  const restClear = new Map();
  const idleColliders = rigC ? idleSample.map((pose) => rigC.colliders.map((c) => poseCollider(c, pose))) : [];
  for (const [i, j] of rigC ? allowedPairs(rigC) : []) {
    let best = null;
    for (const pc of idleColliders) {
      const a = pc[i], b = pc[j];
      if (!a || !b) continue;
      const v = pairClearance(a, b).clearance;
      if (best == null || v < best) best = v;
    }
    const a = posedNeutral[i], b = posedNeutral[j];
    if (best == null && a && b) best = pairClearance(a, b).clearance;
    restClear.set(`${i}:${j}`, best);
  }
  const authorTol = clearanceTolerance(bake.model, folder);
  const noise = SOLVER.clearanceNoise * plan.H;
  const propBone = new Set(rigC ? rigC.colliders.map((c, i) => (c.prop ? i : -1)).filter((i) => i >= 0) : []);
  const roleOf = (i) => (rigC ? rigC.colliders[i]?.role : null);
  const allowed = (i, j) => {
    // An "extra" collider is a part the K12 bone map does not claim as a role — a back box, a cape, a
    // wing, a decoration. Its capsule fits that shape very loosely and the lead/skeptic exchange already
    // showed the torso/extra pair overlapping in the body's own REST pose (Piedmon −0.177 h). Those pairs
    // are measured and reported, never gated; the gate is for a HAND or a HEAD driven through a body.
    if (roleOf(i) === "extra" || roleOf(j) === "extra") return null;
    const rest = restClear.get(`${i}:${j}`);
    const auth = authorTol.pairFloor(i, j);
    // A PROP's capsule is a long thin fit around a blade: turning a wrist sweeps it a body height, and the
    // disc's own animation of the same arm wanders 0.13 h inside the body's capsules (Piedmon's arm/back
    // box: 0.14 h at rest, 0.01 h in its own cast). For a pair with a prop on either side the disc's own
    // depth is therefore the only honest bar; a hand or a head is judged against its own rest pose.
    const prop = propBone.has(i) || propBone.has(j);
    const bar = prop ? (auth ?? rest ?? -Infinity) : Math.max(rest ?? -Infinity, auth ?? -Infinity);
    // how far a pose may go DEEPER than its own neutral: a tenth of a body height for parts that stand far
    // apart (a limb's capsule sweeping past a leg at 0.3 h separation has fitting noise of that order — the
    // measured median for the whole corpus is 0.16 h), and the tight 0.02 h for parts that already stand
    // close (a hand at 0.34 h from the torso travelling 0.42 h INTO it is not fitting noise).
    const far = (rest ?? 0) > 0.25 * plan.H;
    const slack = far ? 0.10 * plan.H : noise;
    return Number.isFinite(bar) ? bar - slack : null;
  };
  // ── the whole cast, sampled ────────────────────────────────────────────────────────────────────────
  const clasp = plan.mode === "combined" && plan.sites.length > 1;
  const step = Math.max(1, Math.floor(plan.ticks / 24));
  const at = [];
  for (let t = 0; t < plan.ticks; t += step) at.push(t);
  if (!at.includes(plan.release)) at.push(plan.release);
  at.sort((a, b) => a - b);
  const baseLow = lowestVertex(bake.model, neutral).y;
  // the floor the model itself stands on at each tick (its own idle's floor): a cast that plays OVER the
  // idle may not be judged against a floor the idle itself has already left (K20b item 3)
  const idleFramesB = idlePlaylist(bake.model, plan.baseFrame ?? 0);
  const idleFloorAt = (t) => lowestVertex(bake.model, poseFromChannels(bake.model, idleFramesB[t % idleFramesB.length])).y;
  const orig = (pose, s) => firingAxis(bake.model, folder, s.id, pose)?.origin ?? null;
  const t0 = plan.sites.map((s) => orig(neutral, s));
  let travel = 0, groundWorst = 0, groundTick = null, penTicks = 0, worstPen = null, gapMin = Infinity;
  for (const t of at) {
    const pose = poseFromChannels(bake.model, off + t);
    const pen = penetration(bake.model, pose, { folder, clasp, tolerance: { pairFloor: allowed } });
    if (!pen.ok) {
      penTicks++;
      if (!worstPen || pen.over > worstPen.over) worstPen = pen;
    }
    const low = lowestVertex(bake.model, pose);
    if (Number.isFinite(low.y)) {
      const rise = (idleFloorAt(t) - low.y) / plan.H;
      if (rise > groundWorst) { groundWorst = rise; groundTick = t; }
    }
    const tips = plan.sites.map((s) => orig(pose, s));
    for (let i = 0; i < tips.length; i++) {
      if (tips[i] && t0[i]) travel = Math.max(travel, len3(sub3(tips[i], t0[i])));
      for (let j = i + 1; j < tips.length; j++) if (tips[i] && tips[j]) gapMin = Math.min(gapMin, len3(sub3(tips[i], tips[j])));
    }
  }
  // ── K20b: the HEAD CAST's own checks, all measured from the same corpus ─────────────────────────────
  //   headPitch  the peak head pitch over the cast, in the MESH frame (the geometry the player sees),
  //              inside the disc's own p10..p90 for this cell (K20a). A head that never moves, lifts the
  //              wrong way (the sign bug this pins) or over-rotates fails here.
  //   jump       the largest frame-to-frame head pitch step: the disc's own p90 step over the same 115
  //              casts is HEAD_CAST_JUMP.p90 (45.76 deg/tick; p50 15.01) — see the constants file.
  //   idle       the pose the table STARTS and ENDS on against the model's own idle: both ends must be
  //              within the model's own idle-to-idle step (HEAD_CAST_IDLE, measured the same way), so the
  //              cast enters and leaves the idle without a pop (K20b item 3, C13).
  //   body       the root's own travel, capped at the disc's measured root travel for a head cast
  //              (K20a rootTravelH p50 = 0.13 H): a head cast may not slide further than the disc does.
  let headGate = null, rootTravel = 0, idlePop = null, releaseTravel = 0;
  {
    const rigB = rigOf(bake.model);
    const rNow = (f) => chan(bake.model.bones[rigB.root]?.anim?.ch1, f);
    for (let t = 0; t < plan.ticks; t++) {
      const c = rNow(off + t);
      // the transport is measured against the IDLE's own ch1 at that tick: the idle's sway is the idle's
      const ic = chan(bake.model.bones[rigB.root]?.anim?.ch1, idleFramesB[t % idleFramesB.length]);
      const d = Math.hypot(c[0] - ic[0], c[1] - ic[1], c[2] - ic[2]) / plan.H;
      rootTravel = Math.max(rootTravel, d);
      if (t === plan.release) releaseTravel = d;
    }
    const vtxDelta = (a, b) => {
      let worst = 0;
      for (let i = 0; i < a.pos.length; i++) {
        const Ra = a.rot[i], Rb = b.rot[i], ta = a.pos[i], tb = b.pos[i];
        if (!Ra || !Rb || !ta || !tb) continue;
        for (const v of bake.model.bones[i]?.verts || []) {
          const pa = [Ra[0] * v[0] + Ra[3] * v[1] + Ra[6] * v[2] + ta[0], Ra[1] * v[0] + Ra[4] * v[1] + Ra[7] * v[2] + ta[1], Ra[2] * v[0] + Ra[5] * v[1] + Ra[8] * v[2] + ta[2]];
          const pb = [Rb[0] * v[0] + Rb[3] * v[1] + Rb[6] * v[2] + tb[0], Rb[1] * v[0] + Rb[4] * v[1] + Rb[7] * v[2] + tb[1], Rb[2] * v[0] + Rb[5] * v[1] + Rb[8] * v[2] + tb[2]];
          worst = Math.max(worst, Math.hypot(pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2]) / plan.H);
        }
      }
      return worst;
    };
    const idleFrames = idlePlaylist(bake.model, plan.baseFrame ?? 0);
    const idlePoses = idleFrames.map((f) => poseFromChannels(bake.model, f));
    let jitter = 0;
    for (let k = 0; k < idlePoses.length; k++) jitter = Math.max(jitter, vtxDelta(idlePoses[k], idlePoses[(k + 1) % idlePoses.length]));
    const startPose = poseFromChannels(bake.model, off);
    const endPose = poseFromChannels(bake.model, off + plan.ticks - 1);
    const nearStart = Math.min(...idlePoses.map((p) => vtxDelta(startPose, p)));
    const nearEnd = Math.min(...idlePoses.map((p) => vtxDelta(endPose, p)));
    idlePop = { start: +nearStart.toFixed(4), end: +nearEnd.toFixed(4), ownJitter: +jitter.toFixed(4) };
    if (plan.head && plan.headSites) {
      const site = plan.sites[0];
      // The head's own RIGID rotation, measured the way K20a measured it: the world matrix of the head
      // bone at a tick against the same matrix at neutral, reduced to its rotation about the model's
      // lateral axis. (+ = the nose goes up on screen, the sign the solver applies.) The firing AXIS is not
      // used here: on some heads it is degenerate (Kokatorimon's reads [0,0,1] at every tick).
      const Wof = (f) => poseFromChannels(bake.model, f).rot[site.bone];
      const toM = (R) => [[R[0], R[3], R[6]], [R[1], R[4], R[7]], [R[2], R[5], R[8]]];
      const W0 = toM(Wof(plan.baseFrame ?? 0));
      const pitchAt = (f) => {
        const R = Wof(f);
        if (!R) return null;
        const W = toM(R);
        // R_delta = W * W0^T
        const D = [0, 1, 2].map((r) => [0, 1, 2].map((c) => W[r][0] * W0[c][0] + W[r][1] * W0[c][1] + W[r][2] * W0[c][2]));
        return Math.atan2(D[2][1] - D[1][2], D[1][1] + D[2][2]) * 180 / Math.PI;
      };
      const series = [];
      for (let t = 0; t < plan.ticks; t++) {
        const p = pitchAt(off + t);
        if (p != null) series.push(p);
      }
      let peak = -Infinity, peakTick = 0, jump = 0;
      for (let i = 0; i < series.length; i++) {
        if (series[i] > peak) { peak = series[i]; peakTick = i; }
        if (i) jump = Math.max(jump, Math.abs(series[i] - series[i - 1]));
      }
      const lo = plan.head.p10, hi = plan.head.p90;
      headGate = {
        peak: +peak.toFixed(2), peakTick, release: +(series[plan.release] ?? NaN).toFixed(2),
        lift: +plan.head.lift.toFixed(2), band: [lo, hi], cell: plan.head.cell, n: plan.head.n,
        hub: !!(bake.metrics?.headHub ?? plan.head.hub), jump: +jump.toFixed(2), jumpBar: HEAD_CAST_JUMP.p90,
        ok: Number.isFinite(peak) && (lo == null || peak >= lo - 1e-6) && (hi == null || peak <= hi + 1e-6),
        jumpOk: jump <= HEAD_CAST_JUMP.p90,
      };
    }
  }
  const bodyCap = plan.rootCap != null ? plan.rootCap / plan.H : null;
  const idleBar = idlePop ? Math.max(idlePop.ownJitter, HEAD_CAST_IDLE.unitsH.p90) * 1.5 + 1e-3 : null;
  const bodyGate = bodyCap == null ? null : { travel: +releaseTravel.toFixed(3), total: +rootTravel.toFixed(3), cap: +bodyCap.toFixed(3), ok: releaseTravel <= bodyCap + 5e-3 };

  const plannedMove = Math.max(...plan.targets.map((p, i) => {
    const s = plan.sites[i];
    const restP = tipAt(neutral, bake.model, folder, s);
    return restP ? len3(sub3(p, restP)) : 0;
  }));
  // R1/R4's reach: at RELEASE the arm must put its wrist where the plan effectively asks (the median point,
  // pulled in to this body's own arm length) without stretching past that length. A centre emitter is
  // rotated, not translated, so it has no reach question.
  const tr = bake.trace[plan.release];
  const reach = plan.sites.map((s, i) => {
    if (!s.chain?.length) return { id: s.id, centre: true, ok: true };
    let L = 0;
    for (let k = 1; k < s.chain.length; k++) L += len3(sub3(tr.pos[s.chain[k]], tr.pos[s.chain[k - 1]]));
    const S0 = tr.pos[s.chain[0]], wrist = tr.pos[s.chain[s.chain.length - 1]];
    const wantD = len3(sub3(plan.targets[i], S0));
    const maxD = L * K16.reachSlack;
    const eff = Math.min(wantD, maxD);
    const d = len3(sub3(wrist, S0));
    const ok = eff < 1e-6 || (d <= L + 1e-6 && Math.abs(d - eff) <= 0.20 * Math.max(eff, 0.05 * plan.H));
    return { id: s.id, ok, d: +(d / plan.H).toFixed(3), arm: +(L / plan.H).toFixed(3), wantD: +(wantD / plan.H).toFixed(3), pulled: wantD > maxD + 1e-6 };
  });
  const minGap = SHARED_SHOT.minSeparation * plan.H;
  const gate = {
    aim: aim.every((a) => a.error != null && a.error <= SOLVER.aimToleranceDeg),
    clearance: penTicks === 0,
    ground: groundWorst <= SOLVER.groundShare,
    gap: !(plan.mode === "spread" && plan.sites.length > 1) || gapMin >= minGap,
    motion: plannedMove >= SOLVER.motionFloor * plan.H && travel >= SOLVER.driveFloor * plannedMove,
    reachable: reach.every((r) => r.ok),
  };
  // K20b's own rules apply to a head cast only; every other cast keeps exactly the gate it had.
  if (headGate) {
    gate.headPitch = headGate.ok;
    gate.jump = headGate.jumpOk;
    gate.idle = idleBar == null || (idlePop.start <= idleBar && idlePop.end <= idleBar);
    gate.body = !bodyGate || bodyGate.ok;
  }
  const report = {
    cls: plan.cls, mode: plan.mode, size: plan.size, ticks: plan.ticks, windup: plan.windup, drive: plan.drive,
    release: plan.release, flight: plan.flight, follow: plan.follow, height: plan.H, offset: bake.offset,
    aim, worstAim, reached, reach, constants: { rel: plan.rel, hand: plan.hand, windup: plan.wu },
    penetration: {
      ok: penTicks === 0, ticks: at.length, badTicks: penTicks,
      over: worstPen?.over ?? 0, worst: worstPen?.worst ?? null, clasp,
      violations: (worstPen?.violations ?? []).slice(0, 4).map((v) => ({ over: +v.over.toFixed(0), clearance: +v.clearance.toFixed(0), floor: +v.floor.toFixed(0), roleA: v.roleA, roleB: v.roleB, prop: v.prop })),
    },
    ground: { rise: +groundWorst.toFixed(3), tick: groundTick, share: SOLVER.groundShare, floor: baseLow },
    gap: { min: Number.isFinite(gapMin) ? +(gapMin / plan.H).toFixed(3) : null, floor: SHARED_SHOT.minSeparation },
    motion: { planned: +(plannedMove / plan.H).toFixed(3), travel: +(travel / plan.H).toFixed(3), floor: SOLVER.motionFloor, driveFloor: SOLVER.driveFloor },
    rootDrift: 0, metrics: bake.metrics, gate,
    head: headGate, body: bodyGate ?? { travel: +rootTravel.toFixed(3), cap: null },
    idlePop: idlePop ? { ...idlePop, bar: idleBar == null ? null : +idleBar.toFixed(4) } : null,
  };
  return { report, gate, pass: Object.values(gate).every((ok) => ok) };
}

/**
 * Solve one cast for `model` and verify it. Returns
 *   { table, ticks, release, flight, follow, windup, at: {frame, tick}, cls, mode, gate:{...}, report:{...} }
 * or null when the technique is not a cast, the body cannot carry the motion, or the pose fails a rule.
 * Nothing is written to `model` unless `apply` is true (the caller does that: clip-fallback O3).
 *
 * A pair is solved ONCE and reused (K19f): the engine calls this from two entry points and every cast used
 * to append a fresh ~142 KB of keys and a new table (five casts left the frame offsets outside 16 bits).
 */
export function solveCast(model, { tech = null, apply = true, offset = null, force = false } = {}) {
  const group = solverGroup(model, { tech });
  if (!group.ok) return null;
  const key = techKey(tech ?? "");
  const cached = model.solverCasts?.[key];
  if (cached?.table != null && model.timeline?.[cached.table]?.table) {
    return { ok: true, reused: true, ...cached };
  }
  const start = offset ?? (SOLVER.offset + SOLVER.offsetStep * (model.__solverBakes ?? 0));
  // The plan is tried at a small ladder of plans, all built from measured data (SOLVER.attemptLadder):
  // the class's median hand point, the swing widened, the class's own upper quantiles, then a forward push
  // with a damped lean. The first rung that passes the gate is kept; the best (fewest failing rules) is
  // the one reported when none does, and the pair is then refused (the caller plays its existing build).
  const makePlan = (quantile) => {
    const p = planCast(model, group, { quantile });
    if (!p.ok) return null;
    p.aimPoint = targetPoint(model, p);
    // R3 SPREAD: each emitter fires its OWN shot, so each aims down its own line (its lateral offset kept)
    // instead of every muzzle converging on the same distant point. Converging aim lines swing both arms to
    // the midline and read as one combined shot — exactly what "spread" is not; it also crossed the forearms
    // (K19c's clearance flagged left-arm x right-arm at -0.08 h). A combined shot is one shot, one aim point.
    p.aimPoints = p.sites.map((s, i) => (p.mode === "spread" && p.sites.length > 1)
      ? [p.targets[i][0], p.aimPoint[1], p.aimPoint[2]]
      : p.aimPoint);
    return p;
  };
  /** Apply a rung to a fresh plan: its swing, its push, its lean. The frames follow the points. */
  const applyRung = (p, rung, gapNeed) => {
    // a HEAD cast's body travel is capped at the disc's own root travel (K20a): the ladder may widen the
    // swing but it may not push the body further forward than the disc ever slides it (K20b item 2)
    if (rung.push && !p.headSites) {
      const push = rung.push * Math.min(0.12 * p.H, Math.max(0.05 * p.H, (p.pushBase ?? 0.06 * p.H)));
      const mid = p.targets.length > 1 ? (p.targets[0][0] + p.targets[1][0]) / 2 : 0;
      for (let i = 0; i < p.targets.length; i++) {
        const sgn = p.targets.length > 1 ? (Math.sign(p.targets[i][0] - mid) || (i === 0 ? -1 : 1)) : 0;
        p.targets[i][2] += push;
        p.targets[i][0] += sgn * push;
        if (p.muzzleTargets[i]) p.muzzleTargets[i] = [p.targets[i][0], p.muzzleTargets[i][1], p.muzzleTargets[i][2] + push];
        if (p.aimPoints[i]) p.aimPoints[i] = [p.targets[i][0], p.aimPoints[i][1], p.aimPoints[i][2]];
      }
    }
    if (gapNeed > 0 && p.targets.length > 1) {
      const mid = (p.targets[0][0] + p.targets[1][0]) / 2;
      for (let i = 0; i < p.targets.length; i++) {
        const sgn = Math.sign(p.targets[i][0] - mid) || (i === 0 ? -1 : 1);
        p.targets[i][0] += sgn * gapNeed / 2;
        if (p.muzzleTargets[i]) p.muzzleTargets[i] = [p.targets[i][0], p.muzzleTargets[i][1], p.muzzleTargets[i][2]];
        if (p.aimPoints[i]) p.aimPoints[i] = [p.targets[i][0], p.aimPoints[i][1], p.aimPoints[i][2]];
      }
    }
    p.setSwing(rung.swing ?? 1);         // recomputes the apex and rebuilds the frames
    if (rung.lean != null) p.leanScale = rung.lean;
    return p;
  };
  const start0 = makePlan(SOLVER.attemptLadder[0].quantile);
  if (!start0) return null;
  if (start + start0.ticks >= SOLVER.frameLimit) return null;   // the channel sentinel/16-bit limit
  let best = null, plan = start0, gapNeed = 0;
  for (const [n, rung] of SOLVER.attemptLadder.entries()) {
    if (n >= SOLVER.maxAttempts) break;
    const p = makePlan(rung.quantile);
    if (!p) continue;
    applyRung(p, rung, gapNeed);
    const bake = bakeSolverPose(model, p, { offset: start });
    if (!bake) return null;
    let v = verifyBake(model, p, bake, group);
    let bk = bake;
    // K20b: a body whose OWN geometry cannot take the disc's head lift keeps the largest SHARE of it that
    // passes the very same gates. A hub head (K20a n=4) swings the parts that stand on the floor with it, so
    // the full measured pitch drives a wing through a leg; a free head whose rest axis is far from the aim
    // line can overshoot the disc's band the other way. The share is found by re-baking at a few fractions
    // and re-running the gate — never by clamping a pose after the fact — and it is reported (headScale).
    if (!v.pass && p.headSites && p.head && Number.isFinite(p.head.lift) && p.head.lift > 0) {
      const base = p.frames.map((f) => f.head ?? 0);
      for (const k of [0.8, 0.6, 0.45, 0.35, 0.25, 0.15]) {
        for (const [i, f] of p.frames.entries()) f.head = base[i] * k;
        const b2 = bakeSolverPose(model, p, { offset: start });
        if (!b2) break;
        const v2 = verifyBake(model, p, b2, group);
        // ONLY a candidate that passes the same gate is kept: a share that merely fails differently (a
        // wilder head for a slightly smaller penetration) is not an improvement, it is another refusal.
        if (v2.pass) {
          // the report carries BOTH numbers: what the disc measured for this size class and the share this
          // body could actually take (verified by re-running the same gate on the re-baked pose)
          v = { ...v2, report: { ...v2.report, head: { ...v2.report.head, liftFull: v2.report.head.lift, lift: +(v2.report.head.lift * k).toFixed(2), scale: k } } };
          bk = b2; p.headScale = k; break;
        }
      }
      if (p.headScale != null) p.head = { ...p.head, lift: p.head.lift * p.headScale, liftFull: p.head.lift, scale: p.headScale };
    }
    const score = (x) => Object.values(x.gate).filter((ok) => !ok).length * 1000 + x.report.penetration.badTicks;
    if (K19F_DEBUG) console.error("[k19f attempt]", n, JSON.stringify(v.gate), "q", rung.quantile, "swing", rung.swing, "bad", v.report.penetration.badTicks, "over", Math.round(v.report.penetration.over), "targets", JSON.stringify(p.targets.map((q2) => q2.map(Math.round))), "why", JSON.stringify(v.report.penetration.violations?.slice(0, 2)));
    if (!best || score(v) < score(best.v)) best = { bake: bk, v, plan: p };
    plan = p;
    if (v.pass) break;
    // only a clearance (or gap) failure can be helped by the next rung: the swing and the quantile move
    // the limb around the body. Anything else is out of this ladder's hands.
    if (!v.gate.clearance && !v.gate.gap) break;
    if (!v.gate.gap && Number.isFinite(v.report.gap.min)) {
      gapNeed = Math.max(gapNeed, (SHARED_SHOT.minSeparation * p.H - v.report.gap.min * p.H) + 0.01 * p.H);
    }
  }
  const { bake, v } = best;
  plan = best.plan;
  const pass = v.pass;
  const forced = !!force && !pass;
  const report = { ...v.report, pass, forced, shared: plan.shared?.basis ?? null };
  if (!pass && !force) return { ok: false, table: null, plan, report, group, bake };
  // the points the script must launch from: the same points launch-plan writes into the op6 records, taken
  // at the RELEASE frame of the solved table (a prop arm's muzzle, a mouth's tip), one per emitter site
  const lplan = launchPointsFor(bake.model, { tech, tables: [bake.table], frame: bake.offset + plan.release });
  const launch = (lplan.points ?? []).map((p) => ({ id: p.id, bone: p.bone, frame: p.frame, x: p.x, y: p.y, z: p.z }));
  const out = {
    ok: true, table: bake.table, ticks: plan.ticks, offset: bake.offset, tick: plan.release,
    windup: plan.windup, release: plan.release, flight: plan.flight, follow: plan.follow,
    cls: plan.cls, mode: plan.mode, report, group, plan, bake, launch,
  };
  if (apply) {
    for (let i = 0; i < model.bones.length; i++) if (bake.model.bones[i] !== model.bones[i]) model.bones[i] = bake.model.bones[i];
    if (!model.timeline) model.timeline = [];
    model.timeline[bake.table] = bake.model.timeline[bake.table];
    if (!model.solverCasts) model.solverCasts = {};
    const { plan: _p, group: _g, bake: _b, ...keep } = out;
    model.solverCasts[key] = keep;
    model.__solverBakes = (model.__solverBakes ?? 0) + 1;
  }
  return out;
}

function hdrRoot(model) {
  return rigOf(model).root ?? 0;
}

/** The report of every cast solved on a model (the viewer panel / the harness read this). */
export function solverReportFor(model) {
  return Object.entries(model?.solverCasts ?? {}).map(([tech, v]) => ({ tech, ...v }));
}
