// The battle renderer's opt-in quaternion rotation sampler (?slerp=1).
//
// Pins three things:
//  1. With the flag OFF the renderer is BIT-IDENTICAL to the pre-change function (a verbatim copy
//     of that function lives in this file as `refBuild`, its own copy of the old linear sampler).
//  2. The quaternion reading of a ch2 triple is the same rotation as ps1AnglesToMat3 (the matrix
//     convention trap, skill 4c): float32 storage agreement 1e-6, double-precision 1e-12.
//  3. With the flag ON: a key frame equals today's matrix exactly; mid-span the key-to-key angle is
//     split evenly (shortest path); a full-turn wrap no longer spins the long way; the blend segment
//     slerps between the two sampled poses with exact endpoints.
//
// Data comes from the local model packs (git-ignored); the tests skip when they are not installed.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import * as b3 from "../web/battle3d.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const MODELS = path.join(ROOT, "web/assets/battle/models");
const EXEMPLARS = ["m003agum", "m008tyra", "m009mera", "m050coca"];
const HAVE = EXEMPLARS.every((f) => fs.existsSync(path.join(MODELS, f, "anim.json")));
const skip = HAVE ? false : "battle model packs are not installed";
const read = (folder) => JSON.parse(fs.readFileSync(path.join(MODELS, folder, "anim.json"), "utf8"));

// ── the pre-change renderer, copied verbatim (the reference the flag-off path must equal) ───────
function refInterpChannel(channel, frame) {
  if (!channel || channel.length === 0) return [0, 0, 0];
  let lo = channel[0], hi = channel[0];
  for (let i = 0; i < channel.length; i++) {
    if (channel[i][3] === 30000) break;
    if (channel[i][3] <= frame) lo = channel[i];
    else { hi = channel[i]; break; }
  }
  if (lo === hi || hi[3] === 30000 || hi[3] <= lo[3]) return [lo[0], lo[1], lo[2]];
  const t = (frame - lo[3]) / (hi[3] - lo[3]);
  return [
    lo[0] + t * (hi[0] - lo[0]),
    lo[1] + t * (hi[1] - lo[1]),
    lo[2] + t * (hi[2] - lo[2]),
  ];
}

function refBuild(model, frame, blend = null) {
  const n = model.num_bones;
  const worldRot = new Array(n), worldTrans = new Array(n), worlds = new Array(n);
  const applyRot3x3 = (rot, v) => [
    rot[0] * v[0] + rot[3] * v[1] + rot[6] * v[2],
    rot[1] * v[0] + rot[4] * v[1] + rot[7] * v[2],
    rot[2] * v[0] + rot[5] * v[1] + rot[8] * v[2],
  ];
  const composeRot3x3 = (a, b) => {
    const out = new Float32Array(9);
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++)
        for (let k = 0; k < 3; k++)
          out[i * 3 + j] += a[k * 3 + j] * b[i * 3 + k];
    return out;
  };
  const toMat4 = (rot, trans) => {
    const m = b3.mat4Identity();
    m[0] = rot[0]; m[4] = rot[3]; m[8] = rot[6]; m[12] = trans[0];
    m[1] = rot[1]; m[5] = rot[4]; m[9] = rot[7]; m[13] = trans[1];
    m[2] = rot[2]; m[6] = rot[5]; m[10] = rot[8]; m[14] = trans[2];
    return m;
  };
  const sampleCh = (ch) => {
    const a = refInterpChannel(ch, frame);
    if (!blend || blend.from == null) return a;
    const bb = refInterpChannel(ch, blend.from);
    const t = blend.t;
    return [bb[0] + (a[0] - bb[0]) * t, bb[1] + (a[1] - bb[1]) * t, bb[2] + (a[2] - bb[2]) * t];
  };
  function processBone(i) {
    const bone = model.bones[i];
    if (!bone || !bone.anim) {
      worldRot[i] = b3.ps1AnglesToMat3(0, 0, 0);
      worldTrans[i] = [0, 0, 0];
      worlds[i] = b3.mat4Identity();
      return;
    }
    const parentIdx = bone.parent_slot > 0 ? bone.parent_slot - 1 : -1;
    if (parentIdx >= 0 && !worlds[parentIdx]) processBone(parentIdx);
    const c2 = sampleCh(bone.anim.ch2);
    const localRot = b3.ps1AnglesToMat3(c2[2], c2[1], c2[0]);
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
    if (bone.anim.ch3) {
      const c3 = sampleCh(bone.anim.ch3);
      const sx = c3[0] / 4096, sy = c3[1] / 4096, sz = c3[2] / 4096;
      worlds[i][0] *= sx; worlds[i][1] *= sx; worlds[i][2] *= sx;
      worlds[i][4] *= sy; worlds[i][5] *= sy; worlds[i][6] *= sy;
      worlds[i][8] *= sz; worlds[i][9] *= sz; worlds[i][10] *= sz;
    }
  }
  for (let i = 0; i < n; i++) {
    if (!worlds[i]) processBone(i);
    if (!worlds[i]) worlds[i] = b3.mat4Identity();
  }
  return { mats: worlds, worldTrans };
}

// ── small numeric helpers ───────────────────────────────────────────────────────────────────────
const U = (Math.PI * 2) / 4096;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const frob = (a, b) => { let s = 0; for (let i = 0; i < 9; i++) s += a[i] * b[i]; return s; };
/** Rotation angle of a^T b in degrees (column-major 3x3, both orthonormal). */
const matAngleDeg = (a, b) => Math.acos(clamp((frob(a, b) - 1) / 2, -1, 1)) * 180 / Math.PI;
/** Double-precision euler matrix of the same Rz(c2)*Ry(c1)*Rx(c0) ps1AnglesToMat3 builds. */
function eulerMatD(c0, c1, c2) {
  const cx = Math.cos(c2 * U), sx = Math.sin(c2 * U);
  const cy = Math.cos(c1 * U), sy = Math.sin(c1 * U);
  const cz = Math.cos(c0 * U), sz = Math.sin(c0 * U);
  const Rz = [[cx, -sx, 0], [sx, cx, 0], [0, 0, 1]];
  const Ry = [[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]];
  const Rx = [[1, 0, 0], [0, cz, -sz], [0, sz, cz]];
  const mul = (a, b) => a.map((row, i) => [0, 1, 2].map((j) => row[0] * b[0][j] + row[1] * b[1][j] + row[2] * b[2][j]));
  const R = mul(Rz, mul(Ry, Rx));
  return [R[0][0], R[1][0], R[2][0], R[0][1], R[1][1], R[2][1], R[0][2], R[1][2], R[2][2]];
}
const quatAngleDeg = (a, b) => {
  let d = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]);
  return 2 * Math.acos(clamp(d, -1, 1)) * 180 / Math.PI;
};
const maxDiff = (a, b) => { let m = 0; for (let i = 0; i < 9; i++) m = Math.max(m, Math.abs(a[i] - b[i])); return m; };
/** The upper-left 3x3 of a column-major mat4. */
const rot3 = (m4) => [m4[0], m4[1], m4[2], m4[4], m4[5], m4[6], m4[8], m4[9], m4[10]];
/** Run `fn` with the slerp flag at `on`, always restoring the default afterwards. */
function withSlerp(on, fn) {
  b3.setSlerpRotation(on);
  try { return fn(); } finally { b3.setSlerpRotation(false); }
}

// ── 1. flag off: bit-identical to the pre-change renderer ──────────────────────────────────────
test("slerp OFF is bit-identical to the pre-change renderer (models, frames, blends)", { skip }, () => {
  b3.setSlerpRotation(false);
  let cases = 0;
  for (const folder of EXEMPLARS) {
    const model = read(folder);
    const frames = new Set();
    // every key frame of every bone (capped) + half-way frames between them + a coarse sweep
    for (const bone of model.bones) {
      const ch = bone?.anim?.ch2;
      if (!Array.isArray(ch)) continue;
      for (let i = 0; i + 1 < ch.length && frames.size < 4000; i++) {
        const lo = ch[i][3] | 0, hi = ch[i + 1][3] | 0;
        if (lo === 30000 || hi === 30000) break;
        frames.add(lo);
        frames.add((lo + hi) / 2);
        frames.add(lo + 0.25);
      }
    }
    for (let f = 0; f < (model.total_frames | 0); f += 37) frames.add(f);
    for (const f of frames) {
      const a = refBuild(model, f, null);
      const b = b3.buildBoneWorldMatrices(model, f, null);
      for (let i = 0; i < model.num_bones; i++) {
        assert.deepEqual(b.mats[i], a.mats[i], `${folder} frame ${f} bone ${i} rotation`);
        assert.deepEqual(b.worldTrans[i], a.worldTrans[i], `${folder} frame ${f} bone ${i} translation`);
        cases++;
      }
    }
    // blend segments straight out of the model's own tables (static aux only) + a handoff-style one
    const blends = [];
    for (const tab of model.timeline || []) {
      for (const e of tab?.table || []) {
        const v = e.value | 0;
        if (!(v & 0x8000) || v === 0x8000 || v === 0xffff) continue;
        if (e.aux == null || (e.aux | 0) === 0xffff) continue;
        blends.push({ from: e.aux | 0, t: (v & 0x7fff) / 4096, frame: e.loop_target | 0 });
      }
    }
    blends.push({ from: 300, t: 0.37, frame: 10 });
    for (const bl of blends.slice(0, 200)) {
      const a = refBuild(model, bl.frame, { from: bl.from, t: bl.t });
      const b = b3.buildBoneWorldMatrices(model, bl.frame, { from: bl.from, t: bl.t });
      for (let i = 0; i < model.num_bones; i++) {
        assert.deepEqual(b.mats[i], a.mats[i], `${folder} blend ${bl.from}->${bl.frame}@${bl.t} bone ${i}`);
        cases++;
      }
    }
  }
  assert.ok(cases > 10000, `only ${cases} comparisons ran`);
});

// ── 2. the quaternion reading is the SAME rotation as ps1AnglesToMat3 (skill 4c) ────────────────
test("ch2 -> quaternion matches the euler matrix at keys", { skip }, () => {
  let worstF32 = 0, worstD = 0, n = 0;
  for (const folder of EXEMPLARS) {
    const model = read(folder);
    for (const bone of model.bones) {
      const ch = bone?.anim?.ch2;
      if (!Array.isArray(ch)) continue;
      for (const k of ch) {
        if (k[3] === 30000) continue;
        const qm = b3.quatToMat3(b3.ch2ToQuat(k[0], k[1], k[2]));
        worstF32 = Math.max(worstF32, maxDiff(qm, b3.ps1AnglesToMat3(k[2], k[1], k[0])));
        worstD = Math.max(worstD, maxDiff(qm, eulerMatD(k[0], k[1], k[2])));
        n++;
      }
    }
  }
  assert.ok(n > 1000, `only ${n} keys`);
  assert.ok(worstF32 <= 1e-6, `float32 agreement ${worstF32}`);
  assert.ok(worstD <= 1e-6, `double agreement ${worstD}`);
});

// ── 3. flag on: a key frame is today's matrix, exactly ─────────────────────────────────────────
test("slerp ON keeps every key frame bit-identical", { skip }, () => {
  let n = 0, worst = 0;
  const ancestorsOf = (model) => model.bones.map((b) => {
    const out = [];
    let p = b.parent_slot > 0 ? b.parent_slot - 1 : -1;
    for (let guard = 0; p >= 0 && guard < 64; guard++) {
      out.push(p);
      p = model.bones[p].parent_slot > 0 ? model.bones[p].parent_slot - 1 : -1;
    }
    return out;
  });
  // True when the channel samples as a key at `f`: an exact key, or clamped past either end.
  const atKey = (ch, f) => {
    if (!Array.isArray(ch) || !ch.length) return true;
    const keys = ch.filter((k) => k[3] !== 30000);
    if (!keys.length) return true;
    if (f <= (keys[0][3] | 0) || f >= (keys[keys.length - 1][3] | 0)) return true;
    return keys.some((k) => (k[3] | 0) === f);
  };
  for (const folder of EXEMPLARS) {
    const model = read(folder);
    const anc = ancestorsOf(model);
    const keyFrames = new Set();
    for (const bone of model.bones) for (const k of bone?.anim?.ch2 || []) if (k[3] !== 30000) keyFrames.add(k[3] | 0);
    for (const f of keyFrames) {
      const off = withSlerp(false, () => b3.buildBoneWorldMatrices(model, f, null).mats);
      const on = withSlerp(true, () => b3.buildBoneWorldMatrices(model, f, null).mats);
      for (let i = 0; i < model.num_bones; i++) {
        // only when this bone AND its whole parent chain are at keys: then nothing about the
        // world matrix depends on interpolation at all, so both paths must agree exactly
        if (![i, ...anc[i]].every((b) => atKey(model.bones[b]?.anim?.ch2, f))) continue;
        for (let j = 0; j < 16; j++) worst = Math.max(worst, Math.abs(on[i][j] - off[i][j]));
        n++;
      }
    }
  }
  assert.ok(n > 1000, `only ${n} bone-frames`);
  assert.ok(worst <= 1e-9, `key frame moved by ${worst}`);
});

// ── 4. mid-span: the key-to-key angle is split evenly (shortest path) ──────────────────────────
test("slerp splits the key-to-key angle evenly", { skip }, () => {
  const cases = [
    // [model, bone, frameLo, frameHi] — a ROOT bone's world matrix IS its local rotation
    ["m003agum", 9, 954, 955],     // full-turn wrap: -3979 -> +117 (same orientation)
    ["m008tyra", 12, 735, 765],    // wrap: -2101 units on c1
    ["m122hagu", 2, 260, 280],     // near-180 without any component over 2048
    ["m009mera", 0, 131, 140],     // ordinary span
  ];
  for (const [folder, bone, flo, fhi] of cases) {
    const model = read(folder);
    const ch = model.bones[bone].anim.ch2;
    const lo = ch.find((k) => (k[3] | 0) === flo), hi = ch.find((k) => (k[3] | 0) === fhi);
    assert.ok(lo && hi, `${folder} bone ${bone}: keys ${flo}/${fhi} not found`);
    const qa = b3.ch2ToQuat(lo[0], lo[1], lo[2]);
    const qb = b3.ch2ToQuat(hi[0], hi[1], hi[2]);
    const total = quatAngleDeg(qa, qb);
    const qm = b3.quatSlerp(qa, qb, 0.5);
    assert.ok(Math.abs(quatAngleDeg(qa, qm) - total / 2) < 1e-6, `${folder} ${bone}: lo->mid != half (${total})`);
    assert.ok(Math.abs(quatAngleDeg(qm, qb) - total / 2) < 1e-6, `${folder} ${bone}: mid->hi != half (${total})`);

    // and the renderer's own matrices for a root bone: equal steps from key to key
    if (model.bones[bone].parent_slot === 0) {
      const span = fhi - flo;
      const steps = withSlerp(true, () => {
        const at = (f) => rot3(b3.buildBoneWorldMatrices(model, f, null).mats[bone]);
        const w0 = at(flo), w1 = at(fhi);
        const step = matAngleDeg(w0, w1) / 4;
        const out = [];
        let prev = w0;
        for (const k of [1, 2, 3, 4]) {
          const f = flo + span * k / 4;
          const w = at(f);
          out.push({ f, got: matAngleDeg(prev, w), want: step });
          prev = w;
        }
        return out;
      });
      for (const s of steps) {
        assert.ok(Math.abs(s.got - s.want) < 1e-3, `${folder} bone ${bone} frame ${s.f}: step ${s.got} vs ${s.want}`);
      }
    }
  }
});

// ── 5. a full-turn wrap no longer spins the long way ───────────────────────────────────────────
test("a wrap case takes the short way with slerp on", { skip }, () => {
  const model = read("m003agum");
  const bone = 9;                                  // root: its world matrix IS its local rotation
  assert.equal(model.bones[bone].parent_slot, 0);
  const mid = 954.5;
  const offMid = withSlerp(false, () => rot3(b3.buildBoneWorldMatrices(model, mid, null).mats[bone]));
  const offLo = withSlerp(false, () => rot3(b3.buildBoneWorldMatrices(model, 954, null).mats[bone]));
  const onMid = withSlerp(true, () => rot3(b3.buildBoneWorldMatrices(model, mid, null).mats[bone]));
  const onLo = withSlerp(true, () => rot3(b3.buildBoneWorldMatrices(model, 954, null).mats[bone]));
  const spin = matAngleDeg(offLo, offMid);
  const spinOn = matAngleDeg(onLo, onMid);
  assert.ok(spin > 170, `euler path should spin half a turn here, got ${spin}`);
  assert.ok(spinOn < 1e-3, `slerp path should hold the pose (same orientation), got ${spinOn}`);
  // the two paths are half a turn apart at the midpoint — this is the look change
  assert.ok(matAngleDeg(offMid, onMid) > 170, "flag off vs on should differ by ~180 deg on this span");
});

// ── 6. blend segment: exact endpoints, shortest path in between ────────────────────────────────
test("blend segments slerp between the two sampled poses", { skip }, () => {
  const folder = "m023yuki";
  if (!fs.existsSync(path.join(MODELS, folder, "anim.json"))) return;   // exemplar only
  const model = read(folder);
  const from = 985, frame = 1000, bone = 9;
  const at = (f, bl) => rot3(b3.buildBoneWorldMatrices(model, f, bl).mats[bone]);
  const t0 = withSlerp(true, () => at(frame, { from, t: 0 }));
  const t1 = withSlerp(true, () => at(frame, { from, t: 1 }));
  const half = withSlerp(true, () => at(frame, { from, t: 0.5 }));
  const offHalf = withSlerp(false, () => at(frame, { from, t: 0.5 }));
  const plainFrom = withSlerp(false, () => at(from, null));
  const plainFrame = withSlerp(false, () => at(frame, null));

  assert.ok(maxDiff(t0, plainFrom) <= 1e-9, "blend t=0 must be the `from` pose");
  assert.ok(maxDiff(t1, plainFrame) <= 1e-9, "blend t=1 must be the target pose");
  const gap = matAngleDeg(offHalf, half);
  assert.ok(gap > 150, `expected a large look change on this measured blend, got ${gap}`);

  // the slerp midpoint splits the from->target angle evenly (same maths the renderer runs)
  const ch = model.bones[bone].anim.ch2;
  const A = b3.interpChannel(ch, frame), B = b3.interpChannel(ch, from);
  const qa = b3.ch2ToQuat(A[0], A[1], A[2]), qb = b3.ch2ToQuat(B[0], B[1], B[2]);
  const total = quatAngleDeg(qb, qa);
  const qm = b3.quatSlerp(qb, qa, 0.5);
  assert.ok(Math.abs(quatAngleDeg(qb, qm) - total / 2) < 1e-6, `blend split ${quatAngleDeg(qb, qm)} vs ${total / 2}`);
});

// ── 7. the switch itself ───────────────────────────────────────────────────────────────────────
test("the switch is off by default and reads ?slerp=1", () => {
  assert.equal(b3.slerpRotationEnabled(), false, "default must be OFF");
  assert.equal(b3.slerpFlagFromUrl("?slerp=1"), true);
  assert.equal(b3.slerpFlagFromUrl("?slerp=true"), true);
  assert.equal(b3.slerpFlagFromUrl("?slerp=on"), true);
  assert.equal(b3.slerpFlagFromUrl("?slerp=0"), false);
  assert.equal(b3.slerpFlagFromUrl("?dw2motion=1"), false);
  assert.equal(b3.slerpFlagFromUrl(""), false);
  b3.setSlerpRotation(true);
  assert.equal(b3.slerpRotationEnabled(), true);
  b3.setSlerpRotation(false);
  assert.equal(b3.slerpRotationEnabled(), false);
});
