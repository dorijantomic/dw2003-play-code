// SELF-COLLISION AND SHARED-SHOT CONVERGENCE - the K19 brief's rule R3, and the "no part passes
// through another" half of R4.
//
// Two jobs, both arithmetic over the model's OWN data (no species, folder or id in the logic):
//
//  1. COLLIDERS. The PS1 rig is a skeleton plus one vertex set per bone. Each bone's mesh is reduced to
//     a capsule or a sphere in the bone's own frame (oriented by the mesh's principal axis, sized by its
//     own extent), so any pose - the rest pose, an authored animation, the solver's output - can be
//     tested for parts passing through each other. `penetration(model, pose)` answers the deepest pair;
//     `clearanceTolerance(model, folder)` derives how close this body is ALLOWED to come from the
//     disc's own animation of it: a generated pose may not be worse than the animation the disc shipped
//     for the same body (a constant picked by hand would either forbid poses the disc itself uses or
//     forgive limbs through the chest).
//
//  2. SHARED SHOTS (R3). A technique that fires ONE shot from a body with several emitters must bring
//     those emitters TOGETHER at the release (the pair closes to the measured "combined" gap); a
//     technique that fires one shot PER emitter must present those emitters SPREAD about the aim line,
//     symmetrically, and far enough apart that the shots read as separate. Both constants below are
//     measured from the 249 authored packs (see tools/k19c_shot_stats.mjs and the report): the combined
//     gap is the distance the disc's own two-handed casts actually close their hands to, the minimum
//     separation is one hand block wide.
//
// Frame: the model's own (the renderer's). +X is the character's right when it faces +Z, +Y is DOWN
// (PS1 convention, A6), +Z is the aim. All distances in the module are in model units; the two
// published constants are fractions of body height so they scale from a tiny rookie to a giant.
//
// Pure arithmetic: no DOM, no fetch, no model packs read here. A node test and the solver call the
// same functions.

import { roleOfBone, armChains } from "./digimon-bonemap.js";
import { armEquip } from "./digimon-anatomy.js";
import { restPose } from "./anim-retarget.js";

// ---------------------------------------------------------------- the measured rule (R3)
//
// MEASURED (tools/k19c_shot_stats.mjs over every model pack; the full numbers are in anim-k19c.md):
//   combined gap  how close the disc's own animation brings a body's two hands: over the authored
//                 casts of every two-armed model, the casts that converge at all cluster under 0.14 h
//                 (19 casts, 0.022-0.133 h) and their median is 0.074 h. Two hands that far apart are
//                 a clasp - the palms nearly touch without passing through each other. That is the gap
//                 one combined shot closes to.
//   separation    the smallest BARE hand block in the corpus: the p10 of the measured hand collider
//                 diameter is 0.086 h (median 0.182 h - that end carries the forearm as well as the
//                 hand, so the rule takes the conservative end). Two shots closer than one hand block
//                 are drawn on top of each other, so a spread is never tighter than this.
export const SHARED_SHOT = Object.freeze({
  combinedGap: 0.07,
  minSeparation: 0.09,
});

// ---------------------------------------------------------------- geometry helpers

const P90 = 0.9;
const P95 = 0.95;

function percentile(sorted, q) {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * q)));
  return sorted[i];
}

/** The bone-local frame of one mesh: centroid, principal axis, extent along it, radial spread. */
export function meshFrame(verts) {
  const n = verts.length;
  if (!n) return null;
  let cx = 0, cy = 0, cz = 0;
  for (const v of verts) { cx += v[0]; cy += v[1]; cz += v[2]; }
  cx /= n; cy /= n; cz /= n;
  // covariance (symmetric 3x3), then power iteration for the principal axis
  let xx = 0, xy = 0, xz = 0, yy = 0, yz = 0, zz = 0;
  for (const v of verts) {
    const a = v[0] - cx, b = v[1] - cy, c = v[2] - cz;
    xx += a * a; xy += a * b; xz += a * c; yy += b * b; yz += b * c; zz += c * c;
  }
  const C = [xx / n, xy / n, xz / n, xy / n, yy / n, yz / n, xz / n, yz / n, zz / n];
  // start from the column with the largest diagonal
  const diag = [C[0], C[4], C[8]];
  let u = [0, 0, 0];
  u[diag.indexOf(Math.max(...diag))] = 1;
  if (Math.hypot(...u) === 0) u = [0, 1, 0];
  for (let it = 0; it < 32; it++) {
    const w = [
      C[0] * u[0] + C[1] * u[1] + C[2] * u[2],
      C[3] * u[0] + C[4] * u[1] + C[5] * u[2],
      C[6] * u[0] + C[7] * u[1] + C[8] * u[2],
    ];
    const len = Math.hypot(w[0], w[1], w[2]);
    if (len < 1e-12) break;
    u = [w[0] / len, w[1] / len, w[2] / len];
  }
  let lo = Infinity, hi = -Infinity;
  for (const v of verts) {
    const t = (v[0] - cx) * u[0] + (v[1] - cy) * u[1] + (v[2] - cz) * u[2];
    if (t < lo) lo = t;
    if (t > hi) hi = t;
  }
  const half = Math.max(1e-6, (hi - lo) / 2);
  const mid = [cx + u[0] * (lo + hi) / 2, cy + u[1] * (lo + hi) / 2, cz + u[2] * (lo + hi) / 2];
  const rad = [];
  for (const v of verts) {
    const dx = v[0] - cx, dy = v[1] - cy, dz = v[2] - cz;
    const t = dx * u[0] + dy * u[1] + dz * u[2];
    rad.push(Math.hypot(dx - u[0] * t, dy - u[1] * t, dz - u[2] * t));
  }
  rad.sort((a, b) => a - b);
  const radius = Math.max(1e-6, percentile(rad, P90));
  // a blob whose length is comparable to its width is a sphere: a capsule along a short axis would
  // invent two sharp ends the mesh does not have
  const compact = half * 2 <= radius * 2.4;
  return {
    c: [cx, cy, cz], u, half, radius, compact,
    a: [mid[0] - u[0] * half, mid[1] - u[1] * half, mid[2] - u[2] * half],
    b: [mid[0] + u[0] * half, mid[1] + u[1] * half, mid[2] + u[2] * half],
  };
}

/** The model's rest-pose height (world AABB of every vertex), the unit of the published fractions. */
const HEIGHTS = new WeakMap();
export function bodyHeight(model, frame = 0) {
  if (HEIGHTS.has(model)) return HEIGHTS.get(model);
  const rp = restPose(model, frame);
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < model.bones.length; i++) {
    const verts = model.bones[i].verts || [];
    if (!verts.length) continue;
    const R = rp.rot[i], t = rp.pos[i];
    for (const v of verts) {
      const wy = (R[1] * v[0] + R[4] * v[1] + R[7] * v[2]) + t[1];
      if (wy < lo) lo = wy;
      if (wy > hi) hi = wy;
    }
  }
  const h = hi > lo ? hi - lo : 1;
  HEIGHTS.set(model, h);
  return h;
}

// ---------------------------------------------------------------- colliders

const RIGS = new WeakMap();

/**
 * The collider set of one model: a capsule (or sphere) per bone that carries a mesh, in the bone's own
 * frame, plus the role the K12 bone map gives that bone (arm:left, torso, head, leg:right, ...) and a
 * `prop` flag when K17's measured arm equipment says the bone is a held prop.
 *
 * The capsule is the bone's own mesh, not the bone's line: a PS1 bone often carries a whole limb
 * segment, a hand block or a weapon, so the mesh's principal axis and its radial spread are the honest
 * shape. Bones with no vertices (joints) get no collider: they cannot be seen passing through anything.
 */
export function rigColliders(model, folder = model?.folder) {
  if (!model) return null;
  const cached = RIGS.get(model);
  if (cached) return cached;
  const n = model.num_bones ?? model.bones.length;
  const props = new Set();
  for (const side of ["left", "right"]) {
    const e = armEquip(folder, side);
    if (e && e.bone != null && e.class !== "bare" && e.class !== "none") props.add(e.bone);
  }
  // the hand: the LAST bone of an arm chain - the block a shot leaves from and the part that has to
  // meet its opposite number in a combined two-handed shot
  const hands = new Set();
  for (const side of ["left", "right"]) {
    for (const ch of armChains(folder, side)) if (ch && ch.length) hands.add(ch[ch.length - 1]);
  }
  const parent = new Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    const p = (model.bones[i]?.parent_slot ?? 0) - 1;
    parent[i] = p >= 0 && p < n && p !== i ? p : -1;
  }
  const depth = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    // climb to the root, then unwind; the hop cap turns a malformed parent cycle into depth 0
    const chain = [];
    let x = i, guard = 0;
    while (x >= 0 && depth[x] === 0 && parent[x] >= 0 && guard++ < n) { chain.push(x); x = parent[x]; }
    let d = x >= 0 ? depth[x] : 0;
    for (let k = chain.length - 1; k >= 0; k--) { depth[chain[k]] = ++d; }
  }

  const colliders = [];
  for (let i = 0; i < n; i++) {
    const verts = model.bones[i]?.verts || [];
    if (verts.length < 3) continue;
    const f = meshFrame(verts);
    if (!f) continue;
    const role = roleOfBone(folder, i) || "extra";
    colliders.push({
      bone: i, role, prop: props.has(i), hand: hands.has(i),
      compact: f.compact,
      c: f.c, a: f.a, b: f.b, radius: f.radius,
      halfLen: f.half,          // half the mesh's long axis: the bone's own visible length
    });
  }
  const rig = { folder, model, colliders, parent, depth, n };
  RIGS.set(model, rig);
  return rig;
}

/** Tree distance between two bones (infinity when the rig has no path, which cannot happen). */
function boneDistance(rig, a, b) {
  let x = a, y = b, steps = 0;
  while (rig.depth[x] > rig.depth[y]) { x = rig.parent[x]; steps++; if (x < 0) return Infinity; }
  while (rig.depth[y] > rig.depth[x]) { y = rig.parent[y]; steps++; if (y < 0) return Infinity; }
  while (x !== y) {
    x = rig.parent[x]; y = rig.parent[y]; steps += 2;
    if (x < 0 || y < 0) return Infinity;
  }
  return steps;
}

// A limb is tested against everything except itself and its immediate family: parent/child and
// grandparent/grandchild share a joint by construction, so they always "touch". Everything further
// apart is a real question.
export const MIN_BONE_DISTANCE = 3;

/** The world-space capsule (or sphere) of one collider under a pose: {a, b, r} with a === b for a
 *  sphere. A pose is the shape restPose() returns ({rot: [...], pos: [...]}) - or the same thing as
 *  an array of {rot, pos} per bone, which is what a solver building one bone at a time naturally has. */
export function poseCollider(col, pose) {
  let R = null, t = null;
  if (pose && Array.isArray(pose.rot)) { R = pose.rot[col.bone]; t = pose.pos?.[col.bone]; }
  else if (pose && Array.isArray(pose)) { const b = pose[col.bone]; if (b) { R = b.rot ?? b.R; t = b.pos ?? b.t; } }
  else if (pose && pose.rot && pose.pos && !Array.isArray(pose.rot)) { R = pose.rot[col.bone]; t = pose.pos[col.bone]; }
  if (!R || !t) return null;
  const map = (p) => [
    -(R[0] * p[0] + R[3] * p[1] + R[6] * p[2]) + t[0],
    (R[1] * p[0] + R[4] * p[1] + R[7] * p[2]) + t[1],
    -(R[2] * p[0] + R[5] * p[1] + R[8] * p[2]) + t[2],
  ];
  if (col.compact) {
    const c = map(col.c);
    return { a: c, b: c, r: col.radius, bone: col.bone, role: col.role, prop: col.prop };
  }
  return { a: map(col.a), b: map(col.b), r: col.radius, bone: col.bone, role: col.role, prop: col.prop };
}

// ---------------------------------------------------------------- distances

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const len = (a) => Math.hypot(a[0], a[1], a[2]);

/**
 * Closest points between two segments (Ericson, Real-Time Collision Detection 5.1.9) plus the
 * distance. Degenerate segments (a sphere is a zero-length segment) fall out of the same arithmetic.
 */
export function segmentDistance(p1, q1, p2, q2) {
  const d1 = sub(q1, p1), d2 = sub(q2, p2), r = sub(p1, p2);
  const a = dot(d1, d1), e = dot(d2, d2), f = dot(d2, r);
  const EPS = 1e-12;
  let s, t;
  if (a <= EPS && e <= EPS) { s = 0; t = 0; }
  else if (a <= EPS) { s = 0; t = Math.min(1, Math.max(0, f / e)); }
  else {
    const c = dot(d1, r);
    if (e <= EPS) { t = 0; s = Math.min(1, Math.max(0, -c / a)); }
    else {
      const b = dot(d1, d2);
      const denom = a * e - b * b;
      s = denom > EPS ? Math.min(1, Math.max(0, (b * f - c * e) / denom)) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = Math.min(1, Math.max(0, -c / a)); }
      else if (t > 1) { t = 1; s = Math.min(1, Math.max(0, (b - c) / a)); }
    }
  }
  const c1 = add(p1, mul(d1, s)), c2 = add(p2, mul(d2, t));
  return { d: len(sub(c1, c2)), c1, c2, s, t };
}

/** Clearance of a posed pair: positive = a gap, negative = the two capsules overlap by that much. */
export function pairClearance(a, b) {
  const { d, c1, c2 } = segmentDistance(a.a, a.b, b.a, b.b);
  return { clearance: d - a.r - b.r, a: c1, b: c2, distance: d };
}

// ---------------------------------------------------------------- the pose test

/**
 * The deepest penetration of a pose (model units) and the worst pair, over every collider pair whose
 * bones are more than MIN_BONE_DISTANCE apart in the rig.
 *
 * `tolerance` is the model's own authored bar (see clearanceTolerance): a pose is IN VIOLATION when its
 * clearance is below that pair's own floor - i.e. when it brings two parts closer than the disc's own
 * animation of the same body ever does. Pass `tolerance: 0` to ask the stricter geometric question.
 *
 * `clasp: true` declares the one authored reason a body may bring its two hands together: a COMBINED
 * shared shot (R3). The hand-vs-hand pair is then measured and reported (`clasp`), not counted as a
 * violation - a sheet of numbers is more useful to a reviewer than a failure the rule itself asked for.
 */
export function penetration(model, pose, { folder = model?.folder, rig = null, tolerance = null, pairs = null, clasp = false } = {}) {
  const R = rig || rigColliders(model, folder);
  if (!R) return { ok: true, clearance: Infinity, depth: 0, tested: 0, worst: null, tolerance: 0, over: 0, violations: [], clasp: null };
  const tol = tolerance === 0 || typeof tolerance === "number"
    ? { pairFloor: () => tolerance }
    : tolerance || clearanceTolerance(model, folder);
  const posed = R.colliders.map((c) => poseCollider(c, pose));
  const list = pairs || allowedPairs(R);
  let worst = null, tested = 0, clasped = null;
  const violations = [];
  for (const [i, j] of list) {
    const a = posed[i], b = posed[j];
    if (!a || !b) continue;
    tested++;
    const p = pairClearance(a, b);
    const isClasp = clasp && R.colliders[i].hand && R.colliders[j].hand;
    if (isClasp && (!clasped || p.clearance < clasped.clearance)) {
      clasped = { clearance: p.clearance, distance: p.distance, a: p.a, b: p.b, roleA: a.role, roleB: b.role };
    }
    const floor = tol.pairFloor ? tol.pairFloor(i, j) : tol.floor || 0;
    if (floor == null) continue;                 // the pair is fused in this body: not a question
    if (!worst || p.clearance < worst.clearance) {
      worst = { ...p, a, b, i, j, floor };
    }
    if (p.clearance < floor && !isClasp) {
      violations.push({
        clearance: p.clearance, floor, over: floor - p.clearance,
        roleA: a.role, roleB: b.role, boneA: a.bone, boneB: b.bone,
        pointA: p.a, pointB: p.b, prop: a.prop || b.prop,
      });
    }
  }
  violations.sort((x, y) => y.over - x.over);
  const clearance = worst ? worst.clearance : Infinity;
  return {
    ok: violations.length === 0,
    clearance,
    depth: Math.max(0, -clearance),
    tolerance: worst ? worst.floor : 0,
    over: violations.length ? violations[0].over : 0,
    tested,
    violations,
    clasp: clasped,
    worst: worst ? {
      clearance: worst.clearance,
      pointA: worst.a, pointB: worst.b,
      roleA: worst.a.role, roleB: worst.b.role,
      boneA: worst.a.bone, boneB: worst.b.bone,
      prop: worst.a.prop || worst.b.prop,
      floor: worst.floor,
    } : null,
  };
}

/** The collider index pairs the rule tests: same-bone/direct-family pairs are not questions. */
const PAIRS = new WeakMap();
export function allowedPairs(rig) {
  const cached = PAIRS.get(rig);
  if (cached) return cached;
  const out = [];
  const cols = rig.colliders;
  for (let i = 0; i < cols.length; i++) {
    for (let j = i + 1; j < cols.length; j++) {
      if (boneDistance(rig, cols[i].bone, cols[j].bone) < MIN_BONE_DISTANCE) continue;
      out.push([i, j]);
    }
  }
  PAIRS.set(rig, out);
  return out;
}

// ---------------------------------------------------------------- the tolerance, from the disc's own animation

const TOLERANCE = new WeakMap();

/** The frames that define this body's own range of motion: its whole authored keyframe sequence,
 *  sampled evenly (`samples` poses). A cast is part of it; the idle, its attacks and its hurt poses
 *  are the rest, and the minimum over them is "how close this body itself brings these parts". */
function authoredWindows(model, samples) {
  const total = model.total_frames | 0;
  if (total > 0) return [{ source: "own-animation", lo: 0, hi: total - 1 }];
  // a pack without a stated length: the windows its tables name
  let lo = Infinity, hi = -1;
  for (const tbl of model.timeline || []) {
    for (const e of tbl?.table || []) {
      const v = e?.value | 0;
      if (v >= 0 && v < 0x8000) { if (v < lo) lo = v; if (v > hi) hi = v; }
    }
  }
  return hi < 0 ? [] : [{ source: "timeline", lo, hi }];
}

/**
 * How close this body may bring its own parts, per collider pair: the minimum clearance measured over
 * the model's own authored animation, sampled at `samples` poses. The solver's pose is judged against
 * the animation the disc shipped for the same body, so the rule can never be stricter than the disc
 * itself, and a limb through the chest is still caught - the disc never does that to this body.
 *
 * A pair the body keeps overlapping in EVERY sampled pose (a cape through the torso, a fused shell)
 * gets floor `null`: it is fused geometry, not a motion question, and testing it would only produce
 * noise. A pair with room in at least one pose gets that pose's own clearance as its bar.
 */
export function clearanceTolerance(model, folder = model?.folder, { samples = null } = {}) {
  const total = model?.total_frames | 0;
  const want = samples ?? Math.max(1, Math.min(2000, total || 96));
  const cached = TOLERANCE.get(model);
  if (cached && cached.samples >= want) return cached;
  const rig = rigColliders(model, folder);
  const wins = authoredWindows(model, want);
  const out = { samples: want, frames: 0, source: "none", floor: 0, byPair: new Map() };
  if (rig && wins.length) {
    const list = allowedPairs(rig);
    const min = new Array(list.length).fill(Infinity);
    const max = new Array(list.length).fill(-Infinity);
    for (const w of wins) {
      const n = Math.min(want, Math.max(2, Math.floor(w.hi - w.lo) + 1));
      for (let k = 0; k < n; k++) {
        const f = Math.round(w.lo + ((w.hi - w.lo) * k) / Math.max(1, n - 1));
        const pose = restPose(model, f);
        const posed = rig.colliders.map((c) => poseCollider(c, pose));
        for (let q = 0; q < list.length; q++) {
          const [i, j] = list[q];
          const a = posed[i], b = posed[j];
          if (!a || !b) continue;
          const c = pairClearance(a, b).clearance;
          if (c < min[q]) min[q] = c;
          if (c > max[q]) max[q] = c;
        }
        out.frames++;
      }
    }
    let floor = 0;
    for (let n = 0; n < list.length; n++) {
      if (!Number.isFinite(min[n])) continue;
      // fused: no sampled pose ever separated this pair
      const bar = max[n] > 0 ? min[n] : null;
      out.byPair.set(`${list[n][0]}:${list[n][1]}`, bar);
      if (bar != null && bar < floor) floor = bar;
    }
    out.floor = floor;
    out.source = wins[0].source;
  }
  out.pairFloor = (i, j) => {
    const v = out.byPair.get(`${i}:${j}`);
    return v === undefined ? null : v;
  };
  TOLERANCE.set(model, out);
  return out;
}

// ---------------------------------------------------------------- R3: shared shots

/** The longest distance between any two of the points (the group's span). */
export function emitterSpan(points) {
  let span = 0;
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const a = points[i], b = points[j];
      span = Math.max(span, Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z));
    }
  }
  return span;
}

/** The R3 mode a technique's own shots rule implies (K14): one combined shot, or one per emitter. */
export function sharedShotMode(rule, emitterCount = 0) {
  if (!rule) return null;
  const n = Math.max(emitterCount, Array.isArray(rule.emitters) ? rule.emitters.length : 0);
  if (n < 2) return null;
  if (rule.mode === "single") return "combined";
  if (rule.mode === "per-emitter") return "spread";
  return null;
}

const isArmSite = (p) => /arm|hand|claw|fist/.test(String(p?.site ?? p?.role ?? p?.id ?? ""));

/**
 * R3 in one function. `points` are the emitters' positions at the RELEASE pose (model space; the solver
 * takes them from its own pose). The result is the target position for each emitter and the origin(s)
 * the shot(s) leave from:
 *
 *   mode 'combined'  one shot for the whole group. Same-class emitters (two hands, two barrels) close
 *                    the group's span to the measured gap, moving each toward the group's centroid;
 *                    unlike sites (a mouth plus a chest cannon) cannot clasp, so they line up ALONG THE
 *                    AIM instead - the trailing site slides forward until it is within the gap of the
 *                    leading one. The single shot leaves from the group's new centroid.
 *   mode 'spread'    one shot per emitter. Paired emitters are mirrored about the aim line through
 *                    the centroid (the disc's own volleys do this: a two-armed body's shots sit at
 *                    ±half its own arm span), and every shot is at least `minSeparation` from its
 *                    neighbour, so two shots never draw on top of each other.
 */
export function sharedShotTargets({ points, mode, height = null, aim = [0, 0, 1], origin = null, rule = SHARED_SHOT }) {
  const pts = (points || []).filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z));
  const H = height || 1;
  const gap = (rule.combinedGap ?? SHARED_SHOT.combinedGap) * H;
  const sep = (rule.minSeparation ?? SHARED_SHOT.minSeparation) * H;
  const span = emitterSpan(pts);
  const centred = (list) => {
    if (!list.length) return { x: 0, y: 0, z: 0 };
    const s = list.reduce((a, p) => [a[0] + p.x, a[1] + p.y, a[2] + p.z], [0, 0, 0]);
    return { x: s[0] / list.length, y: s[1] / list.length, z: s[2] / list.length };
  };
  if (pts.length < 2 || !mode) {
    return {
      mode: mode || null, span, gap, separation: sep, height: H, rule,
      points: pts.map((p) => ({ ...p })), origins: pts.map((p) => ({ x: p.x, y: p.y, z: p.z })),
      basis: pts.length < 2 ? "one emitter: nothing to converge or spread" : "no shared-shot rule",
    };
  }
  const c = centred(pts);
  const aimLen = Math.hypot(aim[0], aim[1], aim[2]) || 1;
  const ax = [aim[0] / aimLen, aim[1] / aimLen, aim[2] / aimLen];
  // the aim LINE the spread is mirrored about: through the body's own centre line by default
  const o = origin && Number.isFinite(origin.x) ? origin : c;

  if (mode === "combined") {
    const allArms = pts.every(isArmSite);
    let out;
    if (allArms) {
      const s = span > gap ? gap / span : 1;
      out = pts.map((p) => ({ ...p, x: c.x + (p.x - c.x) * s, y: c.y + (p.y - c.y) * s, z: c.z + (p.z - c.z) * s }));
    } else {
      // unlike sites: keep their lateral/vertical places, close the gap ALONG the aim
      const along = pts.map((p) => (p.x - c.x) * ax[0] + (p.y - c.y) * ax[1] + (p.z - c.z) * ax[2]);
      const lead = Math.max(...along);
      out = pts.map((p, i) => {
        const back = lead - along[i];
        const slide = back > gap ? back - gap : 0;
        return { ...p, x: p.x + ax[0] * slide, y: p.y + ax[1] * slide, z: p.z + ax[2] * slide };
      });
    }
    const m = centred(out);
    return {
      mode, span, gap, separation: sep, height: H, rule,
      points: out, origins: [{ x: m.x, y: m.y, z: m.z }],
      basis: allArms
        ? `arms converge to ${(gap / H).toFixed(3)} h (measured disc clasp)`
        : `unlike sites align along the aim to ${(gap / H).toFixed(3)} h`,
    };
  }

  // Spread mirrors the emitters across the aim line SIDEWAYS: the horizontal axis square to the aim
  // (cross(aim, up), up = -Y in this frame). Height and forward position are each emitter's own - a
  // mouth above two hands stays above them - and the pair straddles the line.
  const sideways = lateralAxis(ax);
  const off = pts.map((p) => (p.x - o.x) * sideways[0] + (p.y - o.y) * sideways[1] + (p.z - o.z) * sideways[2]);
  const used = new Array(pts.length).fill(false);
  const target = off.slice();
  // the middle of an odd group stays on the line; the rest pair most-positive with most-negative
  let order = pts.map((_, i) => i).sort((i, j) => off[j] - off[i]);
  if (pts.length % 2 === 1) {
    const mid = order.reduce((best, i) => (Math.abs(off[i]) < Math.abs(off[best]) ? i : best), order[0]);
    used[mid] = true;
    target[mid] = 0;
  }
  for (const i of order) {
    if (used[i]) continue;
    used[i] = true;
    let j = -1, bestScore = Infinity;
    for (const q of order) {
      if (used[q]) continue;
      const score = off[i] + off[q];          // most opposite first
      if (score < bestScore) { bestScore = score; j = q; }
    }
    if (j < 0) { target[i] = 0; continue; }
    used[j] = true;
    let half = Math.abs(off[i] - off[j]) / 2;
    if (half < sep / 2) half = sep / 2;      // two shots closer than a hand block draw as one
    const sign = off[i] >= off[j] ? 1 : -1;
    target[i] = sign * half;
    target[j] = -sign * half;
  }
  const out = pts.map((p, i) => {
    const slide = target[i] - off[i];
    return { ...p, x: p.x + sideways[0] * slide, y: p.y + sideways[1] * slide, z: p.z + sideways[2] * slide };
  });
  return {
    mode, span, gap, separation: sep, height: H, rule,
    points: out, origins: out.map((p) => ({ x: p.x, y: p.y, z: p.z })),
    basis: `emitters spread symmetrically about the aim, no pair closer than ${(sep / H).toFixed(3)} h`,
  };
}

/** The horizontal axis square to the aim: cross(aim, up), with the model frame's up = -Y. */
function lateralAxis(aim) {
  const up = [0, -1, 0];
  let v = [aim[1] * up[2] - aim[2] * up[1], aim[2] * up[0] - aim[0] * up[2], aim[0] * up[1] - aim[1] * up[0]];
  let l = Math.hypot(...v);
  if (l < 1e-6) { v = [1, 0, 0]; l = 1; }
  return [v[0] / l, v[1] / l, v[2] / l];
}

