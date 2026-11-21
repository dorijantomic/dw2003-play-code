import { smoothAnimEnabled } from "../fight/smooth-anim.js";
import { mat4Identity } from "../fight/proj-layers.js";
import { ps1AnglesToMat3 } from "./math.js";
import { S } from "./state.js";

const PS1_UNIT_RAD = (Math.PI * 2) / 4096;   // 4096 units = one turn

/** A ch2 triple (raw units c0,c1,c2) as the quaternion of Rz(c2)*Ry(c1)*Rx(c0), [x,y,z,w]. */
export function ch2ToQuat(c0, c1, c2) {
  const ax = c0 * PS1_UNIT_RAD * 0.5, ay = c1 * PS1_UNIT_RAD * 0.5, az = c2 * PS1_UNIT_RAD * 0.5;
  const sx = Math.sin(ax), cx = Math.cos(ax);
  const sy = Math.sin(ay), cy = Math.cos(ay);
  const sz = Math.sin(az), cz = Math.cos(az);
  // qz * qy * qx  (the same order as the matrix: Rz * Ry * Rx)
  return [
    cz * cy * sx - sz * sy * cx,
    cz * sy * cx + sz * cy * sx,
    sz * cy * cx - cz * sy * sx,
    cz * cy * cx + sz * sy * sx,
  ];
}

function quatNormalize(q) {
  const l = Math.sqrt(q[0]*q[0] + q[1]*q[1] + q[2]*q[2] + q[3]*q[3]) || 1;
  return [q[0]/l, q[1]/l, q[2]/l, q[3]/l];
}

/** Shortest-path slerp. dot < 0 negates one side (the two quaternions are the same rotation);
 *  nearly parallel pairs (dot > 0.9995) use nlerp, where slerp is ill-conditioned. */
export function quatSlerp(a, b, t) {
  let d = a[0]*b[0] + a[1]*b[1] + a[2]*b[2] + a[3]*b[3];
  let bx = b[0], by = b[1], bz = b[2], bw = b[3];
  if (d < 0) { d = -d; bx = -bx; by = -by; bz = -bz; bw = -bw; }
  if (d > 0.9995) {
    return quatNormalize([
      a[0] + (bx - a[0]) * t, a[1] + (by - a[1]) * t,
      a[2] + (bz - a[2]) * t, a[3] + (bw - a[3]) * t,
    ]);
  }
  const th0 = Math.acos(d > 1 ? 1 : d < -1 ? -1 : d);
  const th = th0 * t;
  const s0 = Math.sin(th0 - th) / Math.sin(th0);
  const s1 = Math.sin(th) / Math.sin(th0);
  return [a[0]*s0 + bx*s1, a[1]*s0 + by*s1, a[2]*s0 + bz*s1, a[3]*s0 + bw*s1];
}

/** Quaternion -> column-major mat3, the same storage convention as ps1AnglesToMat3. */
export function quatToMat3(q: number[]) {
  const [x, y, z, w] = quatNormalize(q);
  const xx = x*x, yy = y*y, zz = z*z;
  const xy = x*y, xz = x*z, yz = y*z;
  const wx = w*x, wy = w*y, wz = w*z;
  return new Float32Array([
    1 - 2*(yy + zz), 2*(xy + wz), 2*(xz - wy),
    2*(xy - wz), 1 - 2*(xx + zz), 2*(yz + wx),
    2*(xz + wy), 2*(yz - wx), 1 - 2*(xx + yy),
  ]);
}

// ─── Smooth mode (?smooth=1; F2 → Battle → "Smooth battle animation") ─────────────────────────
// WHAT THE PS1 ACTUALLY DRAWS (measured in the walker decomp, not guessed):
//  * The sampler's clock `ctx->unk84` is compared as a WHOLE integer against the key frames
//    (`lw $v1, 0x84($s3)` / `slt` in fightstg_c/_asm/F0x800832d0.s, C at F0x800832d0.c:29-34), so the
//    game never asks for a pose at a fractional FRAME.
//  * It does draw fractional POSES between keys: F0x80083a54 expands a span of N frames into N play
//    entries, each carrying frame = the span's target key and frac = i*4096/(N+1) (fightstg.norm.s
//    .L0x00000ec4-.L0x00000ef4), and F0x800832d0 adds (key - live)*frac to the live pose — the
//    component-by-component 16-bit lerp. The authored tables already carry those entries (e.g.
//    m008tyra table 16 opens with 10 blend entries frac 372..3723 toward frame 700).
//  So the authored path between two keys is the per-component ramp of the 16-bit angle triple, and a
//  component jump (-3979 -> +117 = exactly +4096 = one full turn) IS a full turn on screen.
//
// THIS MODE keeps that path and changes only these three things, all behind the switch:
//  1. the pose between keys is built with quaternions, not by turning a blended euler triple into a
//     matrix: the authored ramp is cut into <=45 deg substeps, each substep's triple becomes a
//     quaternion and consecutive substeps are slerped. For a one-component span that is exactly the
//     authored rotation (a single-axis quaternion slerp is the angle ramp), so the total turn per
//     span equals the PS1 path's, full spins included (Tyrannomon bone 12, frames 735->765).
//  2. the SPEED along that path is made continuous at the keys: the span is re-timed by a monotone
//     cubic whose end slopes are the neighbouring spans' speeds (deg/frame). The pose therefore never
//     leaves the authored path — overshoot is 0 by construction, not merely bounded — while the
//     angular speed no longer jumps when a fast span meets a slow one.
//  3. hard cuts are eased downstream (ActorAnimator: 4-tick crossfade where the disc has no blend
//     entry) and held playlist frames are spread (TimelinePlayer lookahead + ActorAnimator de-step).
// Flag OFF: nothing below runs; buildBoneWorldMatrices is the byte-identical old arithmetic.
const SMOOTH_SUBSTEP_UNITS = 512;    // 45 deg: the longest authored step the quaternion path cuts across

const SMOOTH_SLOPE_MIN = 0.25;       // clamp on a span's end slope (neighbour speed / this speed)

const SMOOTH_SLOPE_MAX = 1.5;        // <= 1.5 keeps the cubic monotone (Fritsch-Carlson: a^2+b^2 <= 9)

const SMOOTH_MAX_SHIFT_DEG = 20;     // how far the re-timed pose may run ahead/behind at the SAME frame

/** Angle in degrees between two unit quaternions, [0,180]; uses |dot| (q and -q are one rotation). */
function quatAngleDeg(a, b) {
  let d = Math.abs(a[0]*b[0] + a[1]*b[1] + a[2]*b[2] + a[3]*b[3]);
  if (d > 1) d = 1;
  return 2 * Math.acos(d) * 180 / Math.PI;
}

/** The authored sweep of one key pair: sum of the quaternion steps along the per-component ramp.
 *  Substeps stay <=90 deg so a full turn is measured as a turn (a quaternion ends a turn back at
 *  itself, so the endpoints alone cannot see it). */
export function ch2AuthoredTurnDeg(a, b) {
  const d0 = b[0] - a[0], d1 = b[1] - a[1], d2 = b[2] - a[2];
  const m = Math.max(Math.abs(d0), Math.abs(d1), Math.abs(d2));
  const K = Math.max(1, Math.min(64, Math.ceil(m / 1024)));
  let total = 0;
  let prev = ch2ToQuat(a[0], a[1], a[2]);
  for (let j = 1; j <= K; j++) {
    const t = j / K;
    const q = ch2ToQuat(a[0] + d0*t, a[1] + d1*t, a[2] + d2*t);
    total += quatAngleDeg(prev, q);
    prev = q;
  }
  return total;
}

/** The authored rotation at t in [0,1] along the lo->hi span, as a quaternion: the per-component
 *  ramp cut into substeps, slerped inside a substep. Endpoints are the keys themselves. */
export function ch2QuatAlongSpan(lo, hi, t: number) {
  if (t <= 0) return ch2ToQuat(lo[0], lo[1], lo[2]);
  if (t >= 1) return ch2ToQuat(hi[0], hi[1], hi[2]);
  const d0 = hi[0] - lo[0], d1 = hi[1] - lo[1], d2 = hi[2] - lo[2];
  const m = Math.max(Math.abs(d0), Math.abs(d1), Math.abs(d2));
  const K = Math.max(1, Math.min(64, Math.ceil(m / SMOOTH_SUBSTEP_UNITS)));
  const u = t * K;
  const j = Math.min(K - 1, Math.floor(u));
  const f = u - j;
  const qa = ch2ToQuat(lo[0] + d0*(j/K), lo[1] + d1*(j/K), lo[2] + d2*(j/K));
  const qb = ch2ToQuat(lo[0] + d0*((j+1)/K), lo[1] + d1*((j+1)/K), lo[2] + d2*((j+1)/K));
  return quatSlerp(qa, qb, f);
}

// The key span a frame sits in, with the index of the LOWER key (the smooth re-timing needs the
// neighbouring spans, which channelSpan() alone does not expose). Same walk, same sentinel.
function spanIndexAt(channel, frame) {
  if (!channel || channel.length === 0) return null;
  let i = 0, lo = channel[0], hi = channel[0];
  for (let k = 0; k < channel.length; k++) {
    if (channel[k][3] === 30000) break;
    if (channel[k][3] <= frame) { lo = channel[k]; i = k; }
    else { hi = channel[k]; break; }
  }
  if (lo === hi || hi[3] === 30000 || hi[3] <= lo[3]) return { i, lo, hi: null, t: 0 };
  return { i, lo, hi, t: (frame - lo[3]) / (hi[3] - lo[3]) };
}

// Per-channel span speeds in "authored units per frame" (degrees for a ch2 channel), cached: the
// channels are static arrays read every drawn frame.
const _spanSpeedCache = new WeakMap();

function channelSpanSpeeds(channel, angle: boolean) {
  const key = angle ? "a" : "v";
  const hit = _spanSpeedCache.get(channel);
  if (hit && hit[key]) return hit[key];
  const n = channel.length;
  const speeds = new Float64Array(n);
  for (let i = 0; i + 1 < n; i++) {
    const a = channel[i], b = channel[i + 1];
    if (a[3] === 30000 || b[3] === 30000) break;
    const df = b[3] - a[3];
    if (!(df > 0)) { speeds[i] = 0; continue; }
    if (angle) speeds[i] = ch2AuthoredTurnDeg(a, b) / df;
    else speeds[i] = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / df;
  }
  const box = hit || {};
  box[key] = speeds;
  _spanSpeedCache.set(channel, box);
  return speeds;
}

/** Monotone cubic re-timing of t in [0,1] inside span `i`: u(0)=0, u(1)=1, u'(0)=prev/this speed,
 *  u'(1)=next/this speed (clamped to keep the cubic monotone). Keys stay exact, the path is untouched
 *  (u never leaves [0,1]), only the speed along it changes. */
export function smoothTimeWarp(channel, i: number, t: number, angle = false) {
  if (!(t > 0) || !(t < 1)) return t;
  const sp = channelSpanSpeeds(channel, angle);
  const cur = sp[i];
  if (!(cur > 1e-9)) return t;
  const clampS = (v: number) => (v < SMOOTH_SLOPE_MIN ? SMOOTH_SLOPE_MIN : v > SMOOTH_SLOPE_MAX ? SMOOTH_SLOPE_MAX : v);
  const m0 = i > 0 && sp[i - 1] > 0 ? clampS(sp[i - 1] / cur) : 1;
  const m1 = i + 1 < sp.length && sp[i + 1] > 0 ? clampS(sp[i + 1] / cur) : 1;
  if (m0 === 1 && m1 === 1) return t;
  const t2 = t * t, t3 = t2 * t;
  let u = (-2*t3 + 3*t2) + m0 * (t3 - 2*t2 + t) + m1 * (t3 - t2);
  if (u < 0) u = 0; else if (u > 1) u = 1;
  // A re-timed pose is a pose at a slightly different point of the SAME path. Bound how far that can
  // run: at most SMOOTH_MAX_SHIFT_DEG of the span's own sweep (so a four-turn span is barely
  // re-timed at all, an ordinary 10-20 deg span a lot). Clamping a monotone u against t+-c keeps it
  // monotone, so the pose still never turns back and never leaves the authored path.
  const spanFrames = (channel[i + 1]?.[3] ?? channel[i][3] + 1) - channel[i][3];
  const extent = cur * (spanFrames > 0 ? spanFrames : 1);
  const cap = angle ? Math.min(0.25, SMOOTH_MAX_SHIFT_DEG / Math.max(extent, 1e-6)) : 0.15;
  if (u < t - cap) u = t - cap; else if (u > t + cap) u = t + cap;
  return u;
}

/** Smooth-mode ch2 rotation at `frame` as {q, m}: authored path (quaternion substeps), re-timed. */
function ch2SmoothRotationAt(channel, frame) {
  const s = spanIndexAt(channel, frame);
  if (!s) return { q: [0, 0, 0, 1], m: ps1AnglesToMat3(0, 0, 0) };
  if (!s.hi || s.t <= 0) return { q: ch2ToQuat(s.lo[0], s.lo[1], s.lo[2]), m: ps1AnglesToMat3(s.lo[2], s.lo[1], s.lo[0]) };
  if (s.t >= 1) return { q: ch2ToQuat(s.hi[0], s.hi[1], s.hi[2]), m: ps1AnglesToMat3(s.hi[2], s.hi[1], s.hi[0]) };
  const u = smoothTimeWarp(channel, s.i, s.t, true);
  const q = ch2QuatAlongSpan(s.lo, s.hi, u);
  return { q, m: quatToMat3(q) };
}

/** Smooth-mode linear channel (ch1 translation / ch3 scale): the same authored segment, re-timed by
 *  the same monotone warp so translation and rotation arrive together. */
function interpChannelSmooth(channel, frame) {
  const s = spanIndexAt(channel, frame);
  if (!s) return [0, 0, 0];
  if (!s.hi) return [s.lo[0], s.lo[1], s.lo[2]];
  const u = smoothTimeWarp(channel, s.i, s.t, false);
  return [
    s.lo[0] + u * (s.hi[0] - s.lo[0]),
    s.lo[1] + u * (s.hi[1] - s.lo[1]),
    s.lo[2] + u * (s.hi[2] - s.lo[2]),
  ];
}

// ─── Skeletal animation helpers ───────────────────────────────────────────────

/** The LOCAL ch2 rotation matrix the renderer puts on this bone at `frame`, flag-aware and without
 *  the FK chain. Same three samplers buildBoneWorldMatrices uses; exported for the animation tests
 *  and the smoothness measurement, which must not confuse a parent's pose with a bone's own. */
export function localRotationAt(bone, frame) {
  const ch = bone?.anim?.ch2;
  if (smoothAnimEnabled()) return ch2SmoothRotationAt(ch, frame).m;
  if (S._slerpRot) return ch2RotationAt(ch, frame).m;
  const c = interpChannel(ch, frame);
  return ps1AnglesToMat3(c[2], c[1], c[0]);
}

// The key span a channel is sampled in at `frame`: {lo, hi, t} with t∈[0,1], or {lo, hi:null}
// when the frame is at/after the last key (or the channel holds a single key). Shared by the
// linear sampler and the quaternion rotation sampler so both read the SAME two keys.
function channelSpan(channel, frame) {
  if (!channel || channel.length === 0) return null;
  let lo = channel[0], hi = channel[0];
  for (let i = 0; i < channel.length; i++) {
    if (channel[i][3] === 30000) break;
    if (channel[i][3] <= frame) lo = channel[i];
    else { hi = channel[i]; break; }
  }
  if (lo === hi || hi[3] === 30000 || hi[3] <= lo[3]) return { lo, hi: null, t: 0 };
  return { lo, hi, t: (frame - lo[3]) / (hi[3] - lo[3]) };
}

// Interpolate a keyframe channel at the given frame number.
// channel: array of [x,y,z,frame] records. Sentinel frame=30000.
// Returns [x,y,z] linearly interpolated.
export function interpChannel(channel, frame) {
  const s = channelSpan(channel, frame);
  if (!s) return [0, 0, 0];
  const lo = s.lo, hi = s.hi;
  if (!hi) return [lo[0], lo[1], lo[2]];
  const t = s.t;
  return [
    lo[0] + t * (hi[0] - lo[0]),
    lo[1] + t * (hi[1] - lo[1]),
    lo[2] + t * (hi[2] - lo[2]),
  ];
}

// A ch2 rotation at `frame` as {q, m}: the quaternion of the SAME rotation the matrix carries.
// At a key both come straight from the key (m is ps1AnglesToMat3, bit-identical to the linear
// path); between keys the quaternion is the shortest-path slerp and m its matrix.
function ch2RotationAt(channel, frame) {
  const s = channelSpan(channel, frame);
  if (!s) return { q: [0, 0, 0, 1], m: ps1AnglesToMat3(0, 0, 0) };
  const keyAt = (k) => ({ q: ch2ToQuat(k[0], k[1], k[2]), m: ps1AnglesToMat3(k[2], k[1], k[0]) });
  if (!s.hi || s.t <= 0) return keyAt(s.lo);
  if (s.t >= 1) return keyAt(s.hi);
  const q = quatSlerp(ch2ToQuat(s.lo[0], s.lo[1], s.lo[2]), ch2ToQuat(s.hi[0], s.hi[1], s.hi[2]), s.t);
  return { q, m: quatToMat3(q) };
}

// Build per-bone world mat4 arrays for a skeletal model at a given frame.
// Verified formula: Rz(c2[2])×Ry(c2[1])×Rx(c2[0]), sign-corrected ch1 translation.
// All 21 Renamon bones match sstate1 dump within 5 units (RMS 1.99).
// `blend` (optional) = { from, t }: a timeline blend segment eases the pose FROM the `from`
// frame TO `frame` by t∈[0,1] (the game's per-bone interpolation, FIGHTSTG_F0x80083c30: a
// value&0x8000 entry sets +0x94=1, frac=value&0x7fff /4096, from=aux). Without it, motions
// SNAP between disjoint phases (e.g. attack frame 765→1325). Channels are lerped at the sample
// level (a close approximation of the GTE matrix blend).
// `hide` (optional, A15) = bone indices whose mesh the caller draws FORCED OFF (scale 0) even if the
// pack's own ch3 would show it. The disc hides prop meshes exactly this way (ch3 = 0), so a built action
// that reuses a body authored for another clip can keep a part the model's idle never shows (the thrown
// axe carried beside the held one) hidden without changing the pose. Set or array of indices.
export function buildBoneWorldMatrices(model, frame, blend = null, hide = null) {
    const hidden = hide == null ? null : (typeof hide.has === "function" ? hide : new Set(hide));
    const smooth = smoothAnimEnabled();          // F2 → Battle → Smooth battle animation (default OFF)
    const n = model.num_bones;
    const worldRot = new Array(n);
    const worldTrans = new Array(n);
    const worlds = new Array(n);

    function applyRot3x3(rot, v) {
        return [
            rot[0] * v[0] + rot[3] * v[1] + rot[6] * v[2],
            rot[1] * v[0] + rot[4] * v[1] + rot[7] * v[2],
            rot[2] * v[0] + rot[5] * v[1] + rot[8] * v[2],
        ];
    }

    function composeRot3x3(a, b: Float32Array<ArrayBuffer>) {
        const out = new Float32Array(9);
        for (let i = 0; i < 3; i++)
            for (let j = 0; j < 3; j++)
                for (let k = 0; k < 3; k++)
                    out[i * 3 + j] += a[k * 3 + j] * b[i * 3 + k];
        return out;
    }

    function toMat4(rot, trans) {
        const m = mat4Identity();
        m[0] = rot[0]; m[4] = rot[3]; m[8]  = rot[6]; m[12] = trans[0];
        m[1] = rot[1]; m[5] = rot[4]; m[9]  = rot[7]; m[13] = trans[1];
        m[2] = rot[2]; m[6] = rot[5]; m[10] = rot[8]; m[14] = trans[2];
        return m;
    }

    // Sample a keyframe channel at `frame`, or (during a blend segment) lerp the sample from
    // the `blend.from` frame toward `frame` by `blend.t`. This is what makes transitions fluid
    // instead of snapping between disjoint motion phases. See the header note.
    const sampleCh = (ch) => {
        const a = smooth ? interpChannelSmooth(ch, frame) : interpChannel(ch, frame);
        if (!blend || blend.from == null) return a;
        const b = smooth ? interpChannelSmooth(ch, blend.from) : interpChannel(ch, blend.from);
        const t = blend.t;
        return [b[0] + (a[0] - b[0]) * t, b[1] + (a[1] - b[1]) * t, b[2] + (a[2] - b[2]) * t];
    };

    // ch2 rotation for one bone. Flag off: today's path exactly — lerp the triple, then turn it
    // into a matrix. Flag on: slerp the two surrounding keys (and the two poses of a blend
    // segment) as whole rotations, shortest path. Endpoints are the key matrices themselves, so a
    // key frame is bit-identical either way.
    const sampleRot = (ch) => {
        if (!S._slerpRot && !smooth) {
            const c = sampleCh(ch);
            return ps1AnglesToMat3(c[2], c[1], c[0]);
        }
        const rotAt = smooth ? ch2SmoothRotationAt : ch2RotationAt;
        const a = rotAt(ch, frame);
        if (!blend || blend.from == null) return a.m;
        const b = rotAt(ch, blend.from);
        const t = blend.t;
        if (t <= 0) return b.m;
        if (t >= 1) return a.m;
        return quatToMat3(quatSlerp(b.q, a.q, t));
    };

    function processBone(i: number) {
        const bone = model.bones[i];
        if (!bone || !bone.anim) {
            worldRot[i] = ps1AnglesToMat3(0, 0, 0);
            worldTrans[i] = [0, 0, 0];
            worlds[i] = mat4Identity();
            return;
        }
        const parentIdx = bone.parent_slot > 0 ? bone.parent_slot - 1 : -1;
        if (parentIdx >= 0 && !worlds[parentIdx]) processBone(parentIdx);

        const localRot = sampleRot(bone.anim.ch2);
        const c1 = sampleCh(bone.anim.ch1);

        if (parentIdx < 0) {
            worldRot[i] = localRot;
            worldTrans[i] = [-c1[0], c1[1], -c1[2]];
        } else {
            worldRot[i] = composeRot3x3(worldRot[parentIdx], localRot);
            const rotatedT = applyRot3x3(worldRot[parentIdx], c1);
            worldTrans[i] = [
                worldTrans[parentIdx][0] - rotatedT[0],
                worldTrans[parentIdx][1] + rotatedT[1],
                worldTrans[parentIdx][2] - rotatedT[2],
            ];
        }
        worlds[i] = toMat4(worldRot[i], worldTrans[i]);
        // Apply ch3 scale if present (4096=1.0; defaults to identity when absent).
        // Applied to final matrix columns only — does not propagate to worldRot.
        if (bone.anim.ch3) {
            const c3 = hidden && hidden.has(i) ? [0, 0, 0] : sampleCh(bone.anim.ch3);
            const sx = c3[0] / 4096, sy = c3[1] / 4096, sz = c3[2] / 4096;
            worlds[i][0] *= sx; worlds[i][1] *= sx; worlds[i][2] *= sx;
            worlds[i][4] *= sy; worlds[i][5] *= sy; worlds[i][6] *= sy;
            worlds[i][8] *= sz; worlds[i][9] *= sz; worlds[i][10] *= sz;
        } else if (hidden && hidden.has(i)) {
            worlds[i][0] = 0; worlds[i][1] = 0; worlds[i][2] = 0;
            worlds[i][4] = 0; worlds[i][5] = 0; worlds[i][6] = 0;
            worlds[i][8] = 0; worlds[i][9] = 0; worlds[i][10] = 0;
        }
    }

    for (let i = 0; i < n; i++) {
        if (!worlds[i]) processBone(i);
        if (!worlds[i]) worlds[i] = mat4Identity();
    }
    return { mats: worlds, worldTrans };
}
