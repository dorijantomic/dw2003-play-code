import {
  K16,
  K16_ID,
  K16_SX,
  k16ChainLen,
  k16FromCh2,
  k16IdleSpan,
  k16Pose,
  k16Rest,
  k16Subtrees,
  k16ToCh2,
  k16WorstStep,
  k16axisAngle,
  k16clampRot,
  k16dot,
  k16mul,
  k16mv,
  k16norm,
  k16perp,
  k16scale,
  k16sub,
  k16tr,
  rigOf,
  roleBoneMap,
  shouldMirror,
} from "./k16-rig.js";
import { sample, shiftPlaylistEntry } from "./rig-basics.js";
import type { RetargetChannels, RetargetModel } from "./types.js";

/**
 * The K16 bake: per-frame conjugation in the target's rest frame, root translation scaled, arm/leg
 * end effectors solved by a bounded two-bone IK, joint limits applied. Same return shape as
 * bakeRetargetGeometry(). null when this pair has no bone map or no playable table.
 */
export function bakeRetargetByRole(target, source, clip, { offset = 6000, mirror = null, ik = true, trace = null,
  reach = "point", idleRoles = false, idleRange = null, rootNormalise = "auto" } = {}) {
  const src = source?.actions?.[clip];
  if (!src || !src.ops?.length) return null;
  const T0 = rigOf(target), S0 = rigOf(source);
  if (T0.source !== "bonemap" || S0.source !== "bonemap") return null;
  // K22b rule 1: WHICH root is the root, normalised on both sides. A rig can carry two roots (upper body
  // + legs) and which one a game calls bone 0 is arbitrary, so the two sides can DISAGREE about what their
  // stored root means - the case K21d measured (a donor torso twist rotating the target's whole body).
  //   "auto" (default) — normalise only when the two sides disagree, so a pair whose maps already agree is
  //                      bit-identical to the K16 bake;
  //   true             — always;   false — never (the pre-K22b pairing, kept for the A/B measurement).
  const Traw = T0.rootFix?.rawCarriesLegs, Sraw = S0.rootFix?.rawCarriesLegs;
  const disagree = !!(Traw !== Sraw && T0.rootFix?.legRoot != null && S0.rootFix?.legRoot != null);
  const normalise = rootNormalise === "auto" ? disagree : !!rootNormalise;
  const T = normalise ? T0 : { ...T0, root: T0.rootRaw, torso: T0.torsoRaw };
  const S = normalise ? S0 : { ...S0, root: S0.rootRaw, torso: S0.torsoRaw };
  const table = src.ops.find((o: { op: number; words: number[]; }) => o.op === 2 && o.words?.[0] === 0 && (o.words[2]! | 0) > 1)?.words[2] | 0;
  const srcTable = source.timeline?.[table]?.table;
  if (!table || !Array.isArray(srcTable) || !srcTable.length) return null;
  let lo = Infinity, hi = -1;
  for (const e of srcTable) { const v = e?.value | 0; if (v >= 0 && v < 0x8000) { if (v < lo) lo = v; if (v > hi) hi = v; } }
  if (!(hi > lo)) return null;

  const mirrorOn = mirror == null ? shouldMirror(T, S, source, clip, lo, hi) : !!mirror;
  const plan = roleBoneMap(T, S, { mirror: mirrorOn });
  const tRest = k16Rest(target), sRest = k16Rest(source);
  const subs = k16Subtrees(target);
  const H = T.box.h || 1, HD = S.box.h || 1;
  const sizeRatio = HD > 1e-6 ? H / HD : 1;
  const pairs = plan.pairs.map((p) => {
    const tLen = k16ChainLen(tRest.P, p.tc), sLen = k16ChainLen(sRest.P, p.sc);
    let split = 1;
    if (p.tc.length > 2) {
      const half = tLen / 2;
      let best = Infinity;
      for (let i = 1; i < p.tc.length - 1; i++) {
        const c = k16ChainLen(tRest.P, p.tc.slice(0, i + 1));
        if (Math.abs(c - half) < best) { best = Math.abs(c - half); split = i; }
      }
    }
    return { ...p, tLen, sLen, ratio: sLen > 1e-6 ? tLen / sLen : 1, split, tip: p.tc[p.tc.length - 1] };
  });
  const armPairs = ik ? pairs.filter((p) => p.kind === "arm" && p.tc.length >= 3) : [];
  const legPairs = ik ? pairs.filter((p) => p.kind === "leg" && p.tc.length >= 2) : [];
  const mirrorBones = new Set();
  if (mirrorOn) for (const p of pairs.filter((q) => q.kind === "arm")) for (const b of p.tc) mirrorBones.add(b);

  const rootBone = T.root;
  const rootRestC1 = sample(target.bones[rootBone]?.anim?.ch1, 0);
  const sRootRestC1 = sample(source.bones[S.root]?.anim?.ch1, 0);
  // each model's REST-FRAME local rotation per bone (the "rest-pose orientation offset" of every joint)
  const localOf = (model: RetargetModel, pose: { W: (typeof K16_ID)[] }): (typeof K16_ID)[] => model.bones.map((b, i: string | number) => {
    const p = (b.parent_slot ?? 0) - 1;
    return k16mul(k16tr(p >= 0 && p < pose.W.length ? pose.W[p] : K16_ID), pose.W[i]);
  });
  const LrestT = localOf(target, tRest), LrestD = localOf(source, sRest);
  // parents before children: a bone's world matrix is only built from its parent's
  const order: number[] = [];
  {
    const kids = Array.from({ length: T.n }, () => []);
    for (let i = 0; i < T.n; i++) {
      const p = (target.bones[i]?.parent_slot ?? 0) - 1;
      if (p >= 0 && p < T.n) kids[p]!.push(i);
    }
    const rootsT = [];
    for (let i = 0; i < T.n; i++) { const p = (target.bones[i]?.parent_slot ?? 0) - 1; if (p < 0 || p >= T.n) rootsT.push(i); }
    const visit = (i: number) => { order.push(i); for (const k of kids[i]!) visit(k); };
    for (const r of rootsT) visit(r);
    for (let i = 0; i < T.n; i++) if (!order.includes(i)) order.push(i);
  }
  // One full pass over the clip. `reachMode` decides how an arm is driven (K22b rule 2):
  //   "point" — the two-bone IK solves the elbow so the hand lands on the donor's hand POINT (K16);
  //   "path"  — the elbow keeps the bend the conjugation gave it (the donor's own joint) and only the
  //             shoulder aims the chain along the donor's hand DIRECTION, so the hand travels the donor's
  //             PATH instead of chasing a point this chain cannot reach. No interior-angle solve means no
  //             reach clamp and no bend-plane flip — which is what snapped Meramon's forearm 2.08 rad.
  const pass = (reachMode: string) => {
  const rootKeys = [];
  const keys = new Map();
  const prevKeys = new Map();
  const ikPlane = new Map();
  const rootLift = K16.rootLiftShare * H;
  let ikClamped = 0, ikSolved = 0, jointsClamped = 0, pathFrames = 0;

  for (let s = lo; s <= hi; s++) {
    const sp = k16Pose(source, s);
    const f = s + offset;
    const Wt = new Array(T.n).fill(null);
    // 1. the delta conjugation, per bone, in the TARGET's rest frame, parents before children:
    //        L_target = L_rest_target * (L_rest_donor^-1 * L_donor(frame))
    //    The angle of the transferred joint delta is the donor's own joint departure, measured against
    //    the target's own rest orientation, so a joint moves exactly as far as the donor's did.
    for (const i of order) {
      const m = plan.map[i];
      const p = (target.bones[i]?.parent_slot ?? 0) - 1;
      const Wp = p >= 0 && p < T.n ? (Wt[p] ?? K16_ID) : K16_ID;
      if (m < 0) { Wt[i] = k16mul(Wp, LrestT[i]); continue; }
      let D = k16mul(k16tr(LrestD[m]), k16FromCh2(sample(source.bones[m]?.anim?.ch2, s)));
      if (mirrorBones.has(i)) D = k16mul(k16mul(K16_SX, D), K16_SX);
      const lim = k16clampRot(D, K16.maxJoint);
      if (lim !== D) jointsClamped++;
      Wt[i] = k16mul(Wp, k16mul(LrestT[i], lim));
    }
    // 2. positions from the TARGET's own bone offsets (its ch1 at rest - nothing can stretch)
    let Pt = null;
    const posOf = (i: number) => {
      if (Pt[i]) return Pt[i];
      const p = (target.bones[i]?.parent_slot ?? 0) - 1;
      const c1 = sample(target.bones[i]?.anim?.ch1, 0);
      if (p < 0 || p >= T.n) { Pt[i] = [-c1[0], c1[1], -c1[2]]; return Pt[i]; }
      posOf(p);
      const o = k16mv(Wt[p], c1);
      Pt[i] = [Pt[p][0] - o[0], Pt[p][1] + o[1], Pt[p][2] - o[2]];
      return Pt[i];
    };
    const rebuild = () => { Pt = new Array(T.n).fill(null); for (let i = 0; i < T.n; i++) posOf(i); };
    rebuild();
    const setSubtree = (bone: string | number, R: number[][]) => { for (const j of subs[bone]) Wt[j] = k16mul(R, Wt[j]); };
    // 3a. LEGS: the gate (and a planted cast) cares that a foot does not leave the ground, so the
    //     whole leg is turned about the hip until the ankle is back at the model's own rest height.
    //     A knee solve there would be hypersensitive (a nearly straight leg needs a huge knee angle for
    //     a small vertical move and the bend plane is undefined), a hip turn is one smooth angle.
    for (const p of legPairs) {
      const tipBone = p.tc[p.tc.length - 1];
      const hip = Pt![p.tc[0]], ankle = Pt![tipBone];
      const restY = tRest.P[tipBone][1];
      const lim = K16.ankleShare * H;
      const dy = ankle[1] - restY;
      if (Math.abs(dy) < lim) continue;
      const v1 = k16sub(ankle, hip);
      const v2 = [v1[0], restY + Math.sign(dy) * lim * 0.5 - hip[1], v1[2]];
      const ax = [v1[1]! * v2[2]! - v1[2]! * v2[1]!, v1[2]! * v2[0]! - v1[0]! * v2[2]!, v1[0]! * v2[1]! - v1[1]! * v2[0]!];
      const an = k16norm(ax);
      if (an < 1e-6) continue;
      const ang = Math.atan2(an, k16dot(v1, v2));
      setSubtree(p.tc[0], k16axisAngle(k16scale(ax, 1 / an), Math.min(K16.maxIk, ang)));
      rebuild();
      ikSolved++;
    }
    // 3b. ARMS: the bounded analytic two-bone IK. The hand is driven to the point the donor's hand
    //     occupies in the donor's own frame, scaled by this chain's length ratio and carried on the
    //     target's shoulder; the elbow turns by the difference between the angle the law of cosines
    //     asks for and the angle the limb already has, then the shoulder turns the chain onto the
    //     wanted direction. Both are joint angles about a measured axis, so the correction is
    //     continuous from frame to frame, and both are bounded (K16.maxIk, reachSlack).
    for (const p of armPairs) {
      const tipBone = p.tc[p.tc.length - 1];
      const scTip = p.sc[p.sc.length - 1];
      const S0 = Pt![p.tc[0]];
      const cur = Pt![tipBone];
      const hand = k16scale(k16sub(sp.P[scTip], sp.P[p.sc[0]]), p.ratio);
      const want = [S0[0] + hand[0], S0[1] + hand[1], S0[2] + hand[2]];
      if (k16norm(k16sub(want, cur)) < K16.ikDeadband * H) continue;
      const E0 = Pt![p.tc[p.split]];
      const u1 = k16sub(E0, S0), u2 = k16sub(cur, E0);
      const l1 = k16norm(u1), l2 = k16norm(u2);
      if (l1 < 1e-6 || l2 < 1e-6) continue;
      const dWant = k16norm(k16sub(want, S0));
      const dClamp = Math.min((l1 + l2) * K16.reachSlack, Math.max(Math.abs(l1 - l2) * 1.02 + 1e-6, dWant));
      const outOfReach = dClamp !== dWant;
      if (outOfReach) { ikClamped++; if (reachMode === "path") pathFrames++; }
      if (reachMode === "point") {
        const key = `arm:${p.side}`;
        const wantInterior = Math.acos(Math.max(-1, Math.min(1, (l1 * l1 + l2 * l2 - dClamp * dClamp) / (2 * l1 * l2))));
        const curInterior = Math.acos(Math.max(-1, Math.min(1, k16dot(u1, u2) / (l1 * l2))));
        let hinge = [u1[1]! * u2[2]! - u1[2]! * u2[1]!, u1[2]! * u2[0]! - u1[0]! * u2[2]!, u1[0]! * u2[1]! - u1[1]! * u2[0]!];
        const hn = k16norm(hinge);
        if (hn < 1e-6 * l1 * l2) hinge = ikPlane.get(key) ?? k16perp(u1);
        else hinge = k16scale(hinge, 1 / hn);
        ikPlane.set(key, hinge);
        const dElbow = Math.max(-K16.maxIk, Math.min(K16.maxIk, curInterior - wantInterior));
        if (Math.abs(dElbow) > 1e-6) {
          setSubtree(p.tc[p.split], k16axisAngle(hinge, dElbow));
          rebuild();
        }
      }
      const E1 = Pt![p.tc[p.split]];
      const v1 = k16sub(E1, S0), v2 = k16sub(want, S0);
      const ax = [v1[1]! * v2[2]! - v1[2]! * v2[1]!, v1[2]! * v2[0]! - v1[0]! * v2[2]!, v1[0]! * v2[1]! - v1[1]! * v2[0]!];
      const an = k16norm(ax), vn = k16norm(v1) * k16norm(v2);
      if (an > 1e-6 && vn > 1e-9) {
        const ang = Math.min(K16.maxIk, Math.atan2(an, k16dot(v1, v2)));
        setSubtree(p.tc[0], k16axisAngle(k16scale(ax, 1 / an), ang));
        rebuild();
      }
      ikSolved++;
    }
    // 4. locals, joint limits against the target's own rest joints, and the keys
    for (let i = 0; i < T.n; i++) {
      if (plan.map[i] < 0) continue;
      const p = (target.bones[i]?.parent_slot ?? 0) - 1;
      const Wp = p >= 0 && p < T.n ? Wt[p] : K16_ID;
      const L = k16mul(k16tr(Wp), Wt[i]);
      const Lr = k16mul(k16tr(p >= 0 && p < T.n ? tRest.W[p] : K16_ID), tRest.W[i]);
      const d = k16clampRot(k16mul(k16tr(Lr), L), K16.maxJoint);
      const out = k16ToCh2(k16mul(Lr, d), prevKeys.get(i) ?? null);
      prevKeys.set(i, out);
      if (!keys.has(i)) keys.set(i, []);
      keys.get(i).push([out[0], out[1], out[2], f]);
    }
    // 5. the root translation channel, scaled by the size ratio; its vertical part is damped so a
    //    borrowed cast cannot lift the whole body (the ankle gate and a planted cast depend on it)
    const c1s = sample(source.bones[S.root]?.anim?.ch1, s);
    const dy = Math.max(-rootLift, Math.min(rootLift, (c1s[1] - sRootRestC1[1]) * sizeRatio));
    rootKeys.push([
      Math.round(rootRestC1[0] + (c1s[0] - sRootRestC1[0]) * sizeRatio),
      Math.round(rootRestC1[1] + dy),
      Math.round(rootRestC1[2] + (c1s[2] - sRootRestC1[2]) * sizeRatio), f,
    ]);
  }
  return { rootKeys, keys, ikClamped, ikSolved, jointsClamped, pathFrames };
  };

  // K22b rule 2, the measured rule: solve the clip with the point IK first; when that IK clamps on
  // `reachSwitchShare` of its arm solves, the donor's hand is out of this chain's reach — re-solve the
  // whole clip in path mode and keep whichever bake has the smaller worst frame-to-frame step (a tie goes
  // to path, which cannot clamp by construction). `reach: "point"` (default) pins the K16 behaviour.
  const frames = hi - lo + 1;
  const solveBudget = Math.max(1, frames * Math.max(1, armPairs.length));
  let reachMode = reach === "path" ? "path" : "point";
  let out = pass(reachMode);
  const clampShare = out.ikClamped / solveBudget;
  if (reach === "auto" && armPairs.length && clampShare >= K16.reachSwitchShare) {
    const alt = pass("path");
    // keep the path bake only when it is MATERIALLY smoother (>= 20 %): a switch for noise would trade
    // the tuned point IK for nothing, and the point IK is what the K16 casts were measured with.
    if (k16WorstStep(alt.keys) <= k16WorstStep(out.keys) * 0.80) { out = alt; reachMode = "path"; }
  }
  const { rootKeys, keys, ikSolved, ikClamped, jointsClamped, pathFrames } = out;

  // K22b rule 4: a ROLE the donor has no chain for (wings, tail, a second pair of arms) moves on the
  // TARGET's OWN idle instead of freezing at its rest rotation: its own keys are replayed over the baked
  // span from the model's own longest looping clip. `idleRoles` is OFF by default.
  const idleBones = [];
  const idle = idleRoles ? (idleRange ?? k16IdleSpan(target)) : null;
  if (idle) {
    for (const b of T.roleBones ?? []) {
      if (plan.map[b] >= 0) continue;
      const ch = target.bones[b]?.anim?.ch2;
      if (!ch?.length) continue;
      const arr = [];
      for (let s = lo; s <= hi; s++) {
        const v = sample(ch, idle.lo + ((s - lo) % idle.len));
        arr.push([v[0], v[1], v[2], s + offset]);
      }
      keys.set(b, arr);
      idleBones.push(b);
    }
  }

  const model = {
    ...target,
    bones: target.bones.map((b, i) => {
      const moved = keys.get(i);
      const wantRoot = i === rootBone && rootKeys.length;
      if (!moved && !wantRoot) return b;
      const own2 = (b.anim?.ch2 ?? []).filter((r: number[]) => r[3] !== 30000).map((r) => r.slice());
      const ch2 = moved ? [...own2, ...moved, [moved[moved.length - 1][0], moved[moved.length - 1][1], moved[moved.length - 1][2], 30000]] : (b.anim?.ch2 ?? []);
      const anim = { ...(b.anim || {}), ch2 } as RetargetChannels;
      if (wantRoot) {
        const own1 = (b.anim?.ch1 ?? []).filter((r: number[]) => r[3] !== 30000).map((r) => r.slice());
        const l1 = rootKeys[rootKeys.length - 1];
        anim.ch1 = [...own1, ...rootKeys, [l1![0], l1![1], l1![2], 30000]];
      }
      return { ...b, anim };
    }),
  } as RetargetModel;
  // the shifted playlist, exactly as the geometry bake does it (one shared shiftPlaylistEntry)
  model.timeline = (target.timeline ? target.timeline.slice() : []);
  model.timeline[table] = { table: srcTable.map((e) => shiftPlaylistEntry(e, offset)) };
  const roleBones = T.roleBones ?? [];
  const covered = roleBones.length
    ? roleBones.filter((b: string | number) => plan.map[b] >= 0).length / roleBones.length
    : plan.map.filter((m, i) => m >= 0 && i !== rootBone).length / Math.max(1, T.n - 1);
  return {
    model, table, map: plan.map, covered, roles: { target: T, source: S }, clip, offset,
    mirror: mirrorOn, frames: hi - lo + 1, pairs,
    metrics: {
      ikSolved, ikClamped, jointsClamped, sizeRatio: +sizeRatio.toFixed(3), mirrored: mirrorOn,
      reachMode, reachClampShare: +clampShare.toFixed(3), reachPathFrames: pathFrames,
      idleBones: idleBones.length, idleSpan: idle ? [idle.lo, idle.hi] : null,
      rootNormalised: normalise, rootDisagree: disagree,
      rootFix: { target: T.rootFix, source: S.rootFix },
    },
  };
}
