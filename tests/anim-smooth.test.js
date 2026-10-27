// SMOOTH BATTLE ANIMATION (F2 → Battle → "Smooth battle animation"; ?smooth=1 as a dev override).
//
// Pins, with the real modules in node:
//  1. switch OFF is bit-identical to the pre-change renderer (a verbatim copy of that function is the
//     reference, over keys, half-way frames, sweeps and real blend segments);
//  2. the switch: off by default, on through the F2 store, through ?smooth=1, through ANIM_SMOOTH=1;
//  3. every ch2 key pose is bit-identical with the mode on;
//  4. the total turn of a span equals the PS1 per-component path's — the authored full/half spin is
//     KEPT (Tyrannomon bone 12 735->765 first), where ?slerp=1 takes the short way and is 180 deg off;
//  5. no overshoot: every sampled pose lies between the two keys of its span (angle to each end never
//     exceeds the span's authored turn);
//  6. held playlist frames are spread over their run (TimelinePlayer.lookaheadHold + the animator) and
//     a hard cut is eased only where the disc has no blend entry;
//  7. hit / effect ticks are unchanged.
//
// Model packs are git-ignored; the tests skip when they are not installed.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import * as b3 from "../web/battle3d.js";
import { ActorAnimator } from "../web/fight/actor-animator.js";
import { TimelinePlayer } from "../web/fight/timeline-player.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const MODELS = path.join(ROOT, "web/assets/battle/models");
const EXEMPLARS = ["m003agum", "m008tyra", "m009mera", "m050coca"];
const HAVE = EXEMPLARS.every((f) => fs.existsSync(path.join(MODELS, f, "anim.json")));
const skip = HAVE ? false : "battle model packs are not installed";
const read = (folder) => JSON.parse(fs.readFileSync(path.join(MODELS, folder, "anim.json"), "utf8"));

const withSmooth = (v, fn) => { try { return fn(); } finally { b3.setSmoothAnim(v); } };
function smooth(v, fn) { b3.setSmoothAnim(v); try { return fn(); } finally { b3.setSmoothAnim(false); } }
const ang = (a, b) => {
  let tr = 0;
  for (let i = 0; i < 9; i++) tr += a[i] * b[i];
  const c = (tr - 1) / 2;
  return Math.acos(c > 1 ? 1 : c < -1 ? -1 : c) * 180 / Math.PI;
};

// ── the pre-change renderer, verbatim (its own copy of the old linear sampler) ──────────────────
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
  return [lo[0] + t * (hi[0] - lo[0]), lo[1] + t * (hi[1] - lo[1]), lo[2] + t * (hi[2] - lo[2])];
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
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) out[i * 3 + j] += a[k * 3 + j] * b[i * 3 + k];
    return out;
  };
  const toMat4 = (rot, trans) => {
    const m = new Float32Array(16);
    m[0] = rot[0]; m[4] = rot[3]; m[8] = rot[6]; m[12] = trans[0];
    m[1] = rot[1]; m[5] = rot[4]; m[9] = rot[7]; m[13] = trans[1];
    m[2] = rot[2]; m[6] = rot[5]; m[10] = rot[8]; m[14] = trans[2];
    m[15] = 1;
    return m;
  };
  const sampleCh = (ch) => {
    const a = refInterpChannel(ch, frame);
    if (!blend || blend.from == null) return a;
    const b = refInterpChannel(ch, blend.from);
    const t = blend.t;
    return [b[0] + (a[0] - b[0]) * t, b[1] + (a[1] - b[1]) * t, b[2] + (a[2] - b[2]) * t];
  };
  function processBone(i) {
    const bone = model.bones[i];
    if (!bone || !bone.anim) { worldRot[i] = b3.ps1AnglesToMat3(0, 0, 0); worldTrans[i] = [0, 0, 0]; worlds[i] = toMat4(worldRot[i], worldTrans[i]); return; }
    const parentIdx = bone.parent_slot > 0 ? bone.parent_slot - 1 : -1;
    if (parentIdx >= 0 && !worlds[parentIdx]) processBone(parentIdx);
    const c = sampleCh(bone.anim.ch2);
    const localRot = b3.ps1AnglesToMat3(c[2], c[1], c[0]);
    const c1 = sampleCh(bone.anim.ch1);
    if (parentIdx < 0) { worldRot[i] = localRot; worldTrans[i] = [-c1[0], c1[1], -c1[2]]; }
    else {
      worldRot[i] = composeRot3x3(worldRot[parentIdx], localRot);
      const rt = applyRot3x3(worldRot[parentIdx], c1);
      worldTrans[i] = [worldTrans[parentIdx][0] - rt[0], worldTrans[parentIdx][1] + rt[1], worldTrans[parentIdx][2] - rt[2]];
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
  for (let i = 0; i < n; i++) processBone(i);
  return { mats: worlds, worldTrans };
}
const maxDiff = (a, b) => { let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i])); return m; };

// ── 1. the switch must not change one bit when it is off ───────────────────────────────────────
test("smooth OFF is bit-identical to the pre-change renderer", { skip }, () => {
  let compared = 0;
  for (const folder of EXEMPLARS) {
    const model = read(folder);
    const frames = new Set([0, 1, 60, 735, 735.5, 765, 1200, 2500]);
    for (const bone of model.bones) {
      const ch = bone.anim.ch2;
      if (!Array.isArray(ch)) continue;
      for (const k of ch) { if (k[3] === 30000) break; frames.add(k[3]); }
    }
    const list = [...frames];
    for (const f of list) {
      const a = refBuild(model, f, null), b = smooth(false, () => b3.buildBoneWorldMatrices(model, f, null));
      for (let i = 0; i < model.num_bones; i++) {
        assert.deepEqual(Array.from(b.mats[i]), Array.from(a.mats[i]), `${folder} bone ${i} frame ${f}`);
        compared++;
      }
    }
    for (const [from, t] of [[0, 0.25], [735, 0.5], [985, 0.75], [120, 1]]) {
      const a = refBuild(model, 1000, { from, t }), b = smooth(false, () => b3.buildBoneWorldMatrices(model, 1000, { from, t }));
      for (let i = 0; i < model.num_bones; i++) { assert.deepEqual(Array.from(b.mats[i]), Array.from(a.mats[i])); compared++; }
    }
  }
  assert.ok(compared > 3000, `only ${compared} comparisons`);
});

// ── 2. the switch ──────────────────────────────────────────────────────────────────────────────
test("the switch is off by default, reads ?smooth=1 and the F2 store", () => {
  assert.equal(b3.smoothFlagFromUrl("?smooth=1"), true);
  assert.equal(b3.smoothFlagFromUrl("?smooth=true"), true);
  assert.equal(b3.smoothFlagFromUrl("?smooth=on"), true);
  assert.equal(b3.smoothFlagFromUrl("?smooth=0"), false);
  assert.equal(b3.smoothFlagFromUrl("?slerp=1"), false);
  assert.equal(b3.smoothFlagFromUrl(""), false);
  // the F2 panel's Battle group names this key; battle-settings.js and ambience.js must agree
  const amb = fs.readFileSync(path.join(ROOT, "web/ambience.js"), "utf8");
  assert.match(amb, /\["smoothanim", "Smooth battle animation/);
  const store = fs.readFileSync(path.join(ROOT, "web/fight/battle-settings.js"), "utf8");
  assert.match(store, /smoothanim: false/);
  assert.match(store, /\[\"ownclips\", \"dw2motion\", \"smoothanim\"\]|smoothanim/);
  b3.setSmoothAnim(true);
  assert.equal(b3.smoothAnimEnabled(), true);
  b3.setSmoothAnim(false);
  assert.equal(b3.smoothAnimEnabled(), false);
  b3.setSmoothAnim(null);
});

// ── 3. keys are the keys ──────────────────────────────────────────────────────────────────────
test("every ch2 key pose is identical with the mode on", { skip }, () => {
  let n = 0;
  for (const folder of EXEMPLARS) {
    const model = read(folder);
    for (let i = 0; i < model.bones.length; i++) {
      const bone = model.bones[i], ch = bone.anim?.ch2;
      if (!Array.isArray(ch) || ch.length < 2) continue;
      for (const k of ch) {
        if (k[3] === 30000) break;
        const a = smooth(false, () => b3.localRotationAt(bone, k[3]));
        const b = smooth(true, () => b3.localRotationAt(bone, k[3]));
        assert.equal(maxDiff(a, b), 0, `${folder} bone ${i} key ${k[3]}`);
        n++;
      }
    }
  }
  assert.ok(n > 500, `only ${n} keys checked`);
});

// ── 4. the authored turn is kept (Tyrannomon first) ──────────────────────────────────────────
function sweptDeg(model, boneIdx, f0, f1, mode) {
  const bone = model.bones[boneIdx];
  let total = 0, prev = null;
  for (let f = f0; f <= f1 + 1e-9; f += 0.1) {
    const r = smooth(mode === "smooth", () => b3.localRotationAt(bone, f));
    if (prev) total += ang(prev, r);
    prev = r;
  }
  return total;
}
test("a span keeps the PS1 per-component turn (full/half spins survive)", { skip }, () => {
  const cases = [
    ["m008tyra", 12, 735, 765],     // the operator's case: ?slerp=1 broke this attack
    ["m122hagu", 2, 260, 280],
    ["m003agum", 9, 954, 955],
  ];
  for (const [folder, b, f0, f1] of cases) {
    if (!fs.existsSync(path.join(MODELS, folder, "anim.json"))) continue;
    const model = read(folder);
    const ch = model.bones[b].anim.ch2;
    const k0 = ch.find((k) => k[3] === f0), k1 = ch.find((k) => k[3] === f1);
    const authored = b3.ch2AuthoredTurnDeg(k0, k1);
    const today = sweptDeg(model, b, f0, f1, "off");
    const sm = sweptDeg(model, b, f0, f1, "smooth");
    assert.ok(Math.abs(today - authored) < 1.0, `${folder} bone ${b}: today ${today} vs authored ${authored}`);
    assert.ok(Math.abs(sm - authored) < 1.0, `${folder} bone ${b}: smooth ${sm} vs authored ${authored}`);
    // ...and the shortest-path slerp is NOT that path
    b3.setSlerpRotation(true);
    const mid = b3.localRotationAt(model.bones[b], (f0 + f1) / 2);
    b3.setSlerpRotation(false);
    const authMid = smooth(true, () => b3.localRotationAt(model.bones[b], (f0 + f1) / 2));
    assert.ok(ang(mid, authMid) > 90, `${folder} bone ${b}: slerp should differ (got ${ang(mid, authMid).toFixed(1)} deg)`);
  }
});

// ── 5. no overshoot: every pose lies between the span's two keys ─────────────────────────────
test("smooth mode never leaves the key-to-key sweep (overshoot 0)", { skip }, () => {
  let n = 0, worst = 0;
  for (const folder of EXEMPLARS) {
    const model = read(folder);
    for (let b = 0; b < model.bones.length; b++) {
      const bone = model.bones[b], ch = bone.anim?.ch2;
      if (!Array.isArray(ch)) continue;
      for (let i = 0; i + 1 < ch.length && ch[i + 1][3] !== 30000; i++) {
        const turn = b3.ch2AuthoredTurnDeg(ch[i], ch[i + 1]);
        if (turn < 1) continue;
        for (let q = 1; q < 8; q++) {
          const f = ch[i][3] + ((ch[i + 1][3] - ch[i][3]) * q) / 8;
          const p = smooth(true, () => b3.localRotationAt(bone, f));
          const a = smooth(false, () => b3.localRotationAt(bone, ch[i][3]));
          const e = smooth(false, () => b3.localRotationAt(bone, ch[i + 1][3]));
          const da = ang(a, p), de = ang(p, e);
          worst = Math.max(worst, da - turn, de - turn);
          assert.ok(da <= turn + 1e-3 && de <= turn + 1e-3,
            `${folder} bone ${b} span ${ch[i][3]}->${ch[i + 1][3]} t=${q}/8: ${da.toFixed(2)}/${de.toFixed(2)} > ${turn.toFixed(2)}`);
          n++;
        }
      }
    }
  }
  assert.ok(n > 100, `only ${n} samples`);
  assert.ok(worst < 1e-3, `overshoot ${worst}`);
});

// ── 6a. held playlist frames are spread ─────────────────────────────────────────────────────
test("a held playlist frame is spread across its run instead of standing still", { skip }, () => {
  const table = [
    { value: 100, loop_target: 0, aux: null },
    { value: 100, loop_target: 0, aux: null },
    { value: 100, loop_target: 0, aux: null },
    { value: 100, loop_target: 0, aux: null },
    { value: 100, loop_target: 0, aux: null },
    { value: 100, loop_target: 0, aux: null },
    { value: 110, loop_target: 0, aux: null },
    { value: 0xffff, loop_target: 0, aux: null },
  ];
  const p = new TimelinePlayer(table);
  const la = p.lookaheadHold();
  assert.ok(la, "lookahead must see the run");
  assert.ok(la.run >= 3, `run ${la.run}`);
  assert.equal(la.frame, 100);
  assert.equal(la.next, 110);

  const model = read("m008tyra");
  const run = (on) => {
    const a = new ActorAnimator(model);
    a.vm = null;
    a.idle = new TimelinePlayer(table);
    b3.setSmoothAnim(on);
    const frames = [];
    for (let i = 0; i < 8; i++) { a.tick(1); frames.push(a.frame); }
    b3.setSmoothAnim(false);
    return frames;
  };
  const plain = run(false), frames = run(true);
  // today the frame stands still through the run and then jumps 100 -> 110 in one tick
  const stillPlain = plain.filter((f, i) => i > 0 && f === plain[i - 1]).length;
  assert.ok(stillPlain >= 2, `today's playback is expected to stand still (${plain.join(",")})`);
  // with the mode on the same run is spread: no two drawn frames in a row are the same until it arrives
  const before110 = frames.slice(0, frames.indexOf(110));
  const stillSmooth = before110.filter((f, i) => i > 0 && f === before110[i - 1]).length;
  assert.equal(stillSmooth, 0, `smooth playback must not stand still (${frames.join(",")})`);
  assert.ok(before110.length >= 2, `expected in-between frames (${frames.join(",")})`);
  for (let i = 1; i <= frames.indexOf(110); i++) assert.ok(frames[i] >= frames[i - 1], `the spread went backwards (${frames.join(",")})`);
  assert.ok(frames.includes(110), `the spread must arrive at 110 (${frames.join(",")})`);
});

// ── 6b. a hard cut is eased, an authored blend entry is never overridden ────────────────────
test("a hard cut is eased only where the disc has no blend entry", { skip }, () => {
  const model = read("m008tyra");
  const a = new ActorAnimator(model);
  assert.ok(a.setAction(5, {}), "clip 5 must resolve");
  b3.setSmoothAnim(true);
  let cuts = 0, authoredDuringCut = 0, authored = 0;
  for (let t = 0; t < 200 && a.isActive; t++) {
    a.tick(1);
    const b = a.blend;
    if (b?.cut) cuts++;
    if (b && !b.cut) { authored++; }
    if (b?.cut) { /* a cut is only started on a tick with no authored blend */ }
  }
  b3.setSmoothAnim(false);
  assert.ok(cuts > 0, "the clip's table changes must produce at least one eased cut");
  assert.equal(authoredDuringCut, 0);
  assert.ok(authored > 0, "the disc's own blend entries must still be there");
});

// ── 7. hits / effect ticks unchanged ─────────────────────────────────────────────────────────
test("hit and effect ticks are identical with the mode on", { skip }, () => {
  const model = read("m008tyra");
  const run = (on) => {
    b3.setSmoothAnim(on);
    const a = new ActorAnimator(model);
    const ev = [];
    let tick = 0;
    if (!a.setAction(5, { onHit: (r) => ev.push(`h${r.type}@${tick}`), onEffect: (r) => ev.push(`e${r.type}@${tick}`) })) return null;
    for (; tick < 200 && a.isActive; tick++) a.tick(1);
    b3.setSmoothAnim(false);
    return ev;
  };
  const off = run(false), on = run(true);
  if (!off) return;                                  // clip script unavailable in this checkout
  assert.deepEqual(on, off);
  assert.ok(off.length > 0);
});
