import {
  K16_ID,
  k16Pose,
  k16Subtrees,
  k16ToCh2,
  k16axisAngle,
  k16axisOf,
  k16fromTo,
  k16mul,
  k16mv,
  k16norm,
  k16tr,
} from "./k16-rig.js";
import { sample, shiftPlaylistEntry } from "./rig-basics.js";
import type { RetargetWorldModel } from "./types.js";

/**
 * K23 — the WORLD-SPACE bake: every part's motion is transferred as a rotation in WORLD space, and the parts are
 * paired by WHERE THEY SIT ON THE BODY (geometry), not by a role name or by a bone index.
 *
 * Why not the K16 bake for a pair of rigs built differently (a DW2 donor on a DW3 body):
 *   * K16 copies each bone's LOCAL rotation (L_target = L_rest * (L_rest_donor^-1 * L_donor)). That is only
 *     right when the two bones have the same parent and the same local axes. A donor whose limbs are separate
 *     ROOTS (their "local" rotation is the world one) and a body that hangs the same limbs under a hub (their
 *     local is relative to the hub) are not that case; a body that FACES the other way is not that case either.
 *   * the role map names a part by what the anatomy table says it is, and that table is wrong for some rigs
 *     (a wing chain called a tail). A position on the body is measured, not named.
 *   * rest = the neutral IDLE frame of the target (K19f: its frame 0 can sit a tenth of a body height off the
 *     idle) and every bone is keyed, so no bone replays its last authored value.
 *
 *   W_target(t) = Q * (W_donor(t) * W_donor_rest^T) * Q^T * W_target_rest      (all in the true world frame)
 *
 * Q is the donor's facing relative to the target's (a yaw of 0 or 180), picked by the lower total distance of the
 * matched parts. Parts the donor has no partner for follow their parent rigidly at the target's own rest
 * offset. The body's travel is the donor's torso displacement, scaled by the height ratio, on the target's roots.
 * Same return shape as the other bakes. Pure; no names; no per-species constants.
 */
const K23 = {
  /** the largest distance (in body heights) between two parts that may still be paired */
  matchMax: 0.8,
  /** how much one level of hierarchy depth between two parts weighs against their position (body heights) */
  depthWeight: 0.12,
  /** how much a part's size mismatch weighs against its position mismatch (both in body heights) */
  sizeWeight: 1.5,
  /** the share of the clip over which the donor's pose is blended in from (and back out to) the target's own rest */
  rampShare: 0.18,
  /** a part's centre must sit at least this share of the body height from its origin to give it a direction */
  dirMin: 0.03,
  /** the body's vertical travel is capped to this share of its height (a rear-up may lift it a little) */
  liftShare: 0.08,
};

const K23_F = [[-1, 0, 0], [0, 1, 0], [0, 0, -1]];

export function k23NeutralFrame(model) {
  let lo = Infinity;
  for (const e of model?.timeline?.[1]?.table ?? []) { const v = e?.value | 0; if (v >= 0 && v < 0x8000 && v < lo) lo = v; }
  return Number.isFinite(lo) ? lo : 0;
}

/** per-bone world centroid + vertex count + the body's normalising frame, from a pose (the renderer's flip). */
export function k23Cloud(model, pose) {
  const n = model.bones.length;
  const parts = new Array(n).fill(null);
  let sx = 0, sz = 0, cnt = 0, top = Infinity, floor = -Infinity;
  for (let i = 0; i < n; i++) {
    const vs = model.bones[i].verts || [];
    const W = pose.W[i], P = pose.P[i];
    if (!vs.length || !W || !P) continue;
    let cx = 0, cy = 0, cz = 0;
    const mn = [Infinity, Infinity, Infinity], mxv = [-Infinity, -Infinity, -Infinity];
    for (const v of vs) {
      const o = k16mv(W, v);
      const x = -o[0] + P[0], y = o[1] + P[1], z = -o[2] + P[2];
      cx += x; cy += y; cz += z; sx += x; sz += z; cnt++;
      if (y < top) top = y; if (y > floor) floor = y;
      if (x < mn[0]) mn[0] = x; if (x > mxv[0]) mxv[0] = x;
      if (y < mn[1]) mn[1] = y; if (y > mxv[1]) mxv[1] = y;
      if (z < mn[2]) mn[2] = z; if (z > mxv[2]) mxv[2] = z;
    }
    parts[i] = { c: [cx / vs.length, cy / vs.length, cz / vs.length], v: vs.length, sz: [mxv[0] - mn[0], mxv[1] - mn[1], mxv[2] - mn[2]] };
  }
  return { parts, mx: cnt ? sx / cnt : 0, mz: cnt ? sz / cnt : 0, H: Math.max(1, floor - top), floor };
}

export function bakeRetargetWorld(target, source, clip, { offset = 6000, yaw = "auto" as number | "auto", restS = 0, restT = null, matchMax = K23.matchMax, transport = false, delta = false } = {}) {
  const src = source?.actions?.[clip];
  if (!src || !src.ops?.length) return null;
  const table = src.ops.find((o) => o.op === 2 && o.words?.[0] === 0 && (o.words[2] | 0) > 1)?.words[2] | 0;
  const srcTable = source.timeline?.[table]?.table;
  if (!table || !Array.isArray(srcTable) || !srcTable.length) return null;
  let lo = Infinity, hi = -1;
  for (const e of srcTable) { const v = e?.value | 0; if (v >= 0 && v < 0x8000) { if (v < lo) lo = v; if (v > hi) hi = v; } }
  if (!(hi > lo)) return null;
  const n = target.bones.length, ns = source.bones.length;
  const neutralT = restT ?? k23NeutralFrame(target);
  const tr = k16Pose(target, neutralT), sr = k16Pose(source, restS);
  const ct = k23Cloud(target, tr), cs = k23Cloud(source, sr);
  const ratio = ct.H / cs.H;
  const norm = (c, p) => [(p.c[0] - c.mx) / c.H, (c.floor - p.c[1]) / c.H, (p.c[2] - c.mz) / c.H];
  const pt = ct.parts.map((p) => (p ? norm(ct, p) : null));
  const ps = cs.parts.map((p) => (p ? norm(cs, p) : null));
  const Qs = { 0: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], 180: [[-1, 0, 0], [0, 1, 0], [0, 0, -1]] };
  const yawOf = (deg: number, p) => (deg === 180 ? [-p[0], p[1], -p[2]] : p);
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  // the SIZE of a part (its three bounding extents, sorted, in body heights): a part is not a point, and two
  // parts at nearly the same place (a tail fan and a torso) are told apart by how big they are
  const sizeOf = (c, p) => p.sz.map((v) => v / c.H).sort((a, b) => b - a);
  const zt = ct.parts.map((p) => (p ? sizeOf(ct, p) : null)), zs = cs.parts.map((p) => (p ? sizeOf(cs, p) : null));
  const depthIn = (model) => {
    const m = model.bones.length, d = new Array(m).fill(0);
    for (let i = 0; i < m; i++) { let k = i, g = 0; for (;;) { const q = (model.bones[k]?.parent_slot ?? 0) - 1; if (q < 0 || q >= m || g++ > m) break; k = q; d[i]++; } }
    return d;
  };
  const dT = depthIn(target), dS = depthIn(source);
  const sizeCost = (i, j) => (Math.abs(zt[i][0] - zs[j][0]) + Math.abs(zt[i][1] - zs[j][1]) + Math.abs(zt[i][2] - zs[j][2])) / 3;
  // CHAINS: a limb is not a point either. Cut each rig into maximal chains (a root, or the child of a branch
  // point, followed down while every bone has exactly one child), describe each chain by where it sits on the
  // body, how far it reaches and how many bones it has, pair CHAINS, then pair the bones along each chain from
  // the root end. That keeps a leg's hip with a leg's hip and a head chain in order.
  const chainsOf = (model) => {
    const m = model.bones.length;
    const par = (i: number) => { const q = (model.bones[i]?.parent_slot ?? 0) - 1; return q >= 0 && q < m ? q : -1; };
    const kids = Array.from({ length: m }, () => []);
    for (let i = 0; i < m; i++) { const q = par(i); if (q >= 0) kids[q].push(i); }
    const out = [];
    const walk = (start) => {
      const ch = [start];
      let cur = start;
      while (kids[cur].length === 1) { cur = kids[cur][0]; ch.push(cur); }
      out.push(ch);
      for (const k of kids[cur]) walk(k);
    };
    for (let i = 0; i < m; i++) if (par(i) < 0) walk(i);
    return out;
  };
  const chT = chainsOf(target), chS = chainsOf(source);
  const featOf = (chain, c, P: (number[] | null)[], Z, D, deg?: number) => {
    const pts = chain.filter((i) => P[i]);
    if (!pts.length) return null;
    const cen = [0, 0, 0], lo3 = [Infinity, Infinity, Infinity], hi3 = [-Infinity, -Infinity, -Infinity];
    for (const i of pts) {
      const q = deg === undefined ? P[i] : yawOf(deg, P[i]);
      const half = c.parts[i].sz.map((v) => v / c.H / 2);
      for (let k = 0; k < 3; k++) { cen[k] += q[k]; lo3[k] = Math.min(lo3[k], q[k] - half[k]); hi3[k] = Math.max(hi3[k], q[k] + half[k]); }
    }
    for (let k = 0; k < 3; k++) cen[k] /= pts.length;
    return { cen, ext: [hi3[0] - lo3[0], hi3[1] - lo3[1], hi3[2] - lo3[2]], len: pts.length, depth: D[chain[0]], tip: P[pts[pts.length - 1]] };
  };
  const pair = (deg: number) => {
    const fT = chT.map((ch) => featOf(ch, ct, pt, zt, dT)), fS = chS.map((ch) => featOf(ch, cs, ps, zs, dS, deg));
    const cand = [];
    for (let a = 0; a < chT.length; a++) if (fT[a]) for (let b = 0; b < chS.length; b++) if (fS[b]) {
      const x = fT[a], y = fS[b];
      const tipT = x.tip, tipS = deg === 180 ? [-y.tip[0], y.tip[1], -y.tip[2]] : y.tip;
      const cost = dist(x.cen, y.cen) + 0.5 * dist(x.tip, y.tip) + K23.sizeWeight * (Math.abs(x.ext[0] - y.ext[0]) + Math.abs(x.ext[1] - y.ext[1]) + Math.abs(x.ext[2] - y.ext[2])) / 3
        + 0.06 * Math.abs(x.len - y.len) + K23.depthWeight * Math.abs(x.depth - y.depth);
      cand.push([cost, a, b]);
    }
    cand.sort((p, q) => p[0] - q[0]);
    const usedA = new Set(), usedB = new Set(), map = new Array(n).fill(-1), nxt = new Array(n).fill(-1), starts = new Set();
    let cost = 0, matched = 0;
    for (const [c, a, b] of cand) {
      if (c > matchMax) break;
      if (usedA.has(a) || usedB.has(b)) continue;
      usedA.add(a); usedB.add(b);
      const ca = chT[a].filter((i) => pt[i]), cb = chS[b].filter((i) => ps[i]);
      const m = Math.min(ca.length, cb.length);
      for (let k = 0; k < m; k++) { map[ca[k]] = cb[k]; matched++; if (k + 1 < m) nxt[ca[k]] = ca[k + 1]; }
      if (m) starts.add(ca[0]);
      cost += c * Math.sqrt(ca.reduce((t, i) => t + ct.parts[i].v, 0));
    }
    for (let a = 0; a < chT.length; a++) if (fT[a] && !usedA.has(a)) cost += matchMax * 1.5 * Math.sqrt(chT[a].reduce((t, i) => t + (ct.parts[i]?.v ?? 0), 0));
    return { map, cost, matched, nxt, starts };
  };
  const cand0 = yaw === "auto" || yaw === 0 ? pair(0) : null, cand180 = yaw === "auto" || yaw === 180 ? pair(180) : null;
  const pick = cand0 && cand180 ? (cand180.cost < cand0.cost ? 180 : 0) : (cand0 ? 0 : 180);
  const chosen = pick === 180 ? cand180 : cand0;
  const map = chosen.map, nxt = chosen.nxt, starts = chosen.starts;
  const Q = Qs[pick], Qt = k16tr(Q);
  // the body root: the root bone with the biggest subtree (the one the rest of the body hangs from)
  let tTorso = -1, bestSub = -1;
  {
    const sub = k16Subtrees(target);
    for (let i = 0; i < n; i++) {
      const p = (target.bones[i]?.parent_slot ?? 0) - 1;
      if (p >= 0 && p < n) continue;
      if (map[i] >= 0 && (sub[i]?.length ?? 0) > bestSub) { bestSub = sub[i].length; tTorso = i; }
    }
  }
  const sTorso = tTorso >= 0 ? map[tTorso] : -1;

  const parentOf = (i: number) => { const p = (target.bones[i]?.parent_slot ?? 0) - 1; return p >= 0 && p < n ? p : -1; };
  const order = [];
  {
    const kids = Array.from({ length: n }, () => []);
    const rootsT = [];
    for (let i = 0; i < n; i++) { const p = parentOf(i); if (p >= 0) kids[p].push(i); else rootsT.push(i); }
    const visit = (i) => { order.push(i); for (const k of kids[i]) visit(k); };
    for (const r of rootsT) visit(r);
    for (let i = 0; i < n; i++) if (!order.includes(i)) order.push(i);
  }
  const rootsT = order.filter((i) => parentOf(i) < 0);
  const restC1 = target.bones.map((b) => sample(b?.anim?.ch1, neutralT).map((x) => Math.round(x)));
  const keys2 = new Map(), keys1 = new Map(), prev = new Map();
  let travelMax = 0;
  // the middle of each part's mass in its OWN frame (null when it sits on the origin: then it has no direction)
  const centreOf = (model, H: number) => model.bones.map((b) => {
    const vs = b.verts || [];
    if (!vs.length) return null;
    const c = [0, 0, 0];
    for (const v of vs) { c[0] += v[0]; c[1] += v[1]; c[2] += v[2]; }
    const m = [c[0] / vs.length, c[1] / vs.length, c[2] / vs.length];
    return k16norm(m) > K23.dirMin * H ? m : null;
  });
  const cLocT = centreOf(target, ct.H), cLocS = centreOf(source, cs.H);
  // the clip starts and ends on the target's OWN rest (its idle): the donor's pose is blended in over the first
  // and last `ramp` ticks, so the cast leaves the idle and returns to it with no snap
  const nF = hi - lo + 1;
  const ramp = Math.max(6, Math.round(K23.rampShare * nF));
  const weight = (s: number) => { const x = Math.max(0, Math.min(1, Math.min((s - lo) / ramp, (hi - s) / ramp))); return x * x * (3 - 2 * x); };
  /** the rotation `Wtarget`, reached `w` of the way from the rest rotation `Wrest` (along the shortest turn) */
  const blendRot = (Wrest, Wtarget, w: number) => {
    if (w >= 1) return Wtarget;
    const { axis, ang } = k16axisOf(k16mul(k16tr(Wrest), Wtarget));
    return k16mul(Wrest, k16axisAngle(axis, ang * w));
  };
  // `transport`: turn each aimed bone from where it pointed the PREVIOUS frame (a minimal step) instead of from its rest
  // direction. The shortest turn from rest has an ill-conditioned axis when a limb goes from hanging to raised (it swings
  // sideways and rolls, shoulders merge, arms cross); small steps of a planar path add no roll. Off by default.
  const tstate = new Map();
  const aimR = (key: string, u, dv) => {
    if (!transport) return k16fromTo(u, dv);
    const st = tstate.get(key) || { d: u, R: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] };
    const R = k16mul(k16fromTo(st.d, dv), st.R);
    tstate.set(key, { d: dv, R });
    return R;
  };
  for (let s = lo; s <= hi; s++) {
    const f = s + offset;
    const sp = k16Pose(source, s);
    const w = weight(s);
    const Wt = new Array(n).fill(null);
    for (const i of order) {
      const p = parentOf(i);
      const j = map[i];
      let W;
      if (j >= 0) {
        let Wtarget = null;
        const ci = nxt[i];
        if (ci >= 0 && map[ci] >= 0) {
          // a limb bone is AIMED: it takes the world DIRECTION its partner points in (toward the next bone of its
          // chain), turned by Q. The direction is a property of the shape, not of the bone's local axes, so it
          // survives a different rest pose, a different facing and a different hierarchy.
          const cj = map[ci];
          const dv = k16mv(Q, [sp.P[cj][0] - sp.P[j][0], sp.P[cj][1] - sp.P[j][1], sp.P[cj][2] - sp.P[j][2]]);
          const u = [tr.P[ci][0] - tr.P[i][0], tr.P[ci][1] - tr.P[i][1], tr.P[ci][2] - tr.P[i][2]];
          // the bone matrices live in the renderer's frame (the true world frame is F * W, F = diag(-1,1,-1)), so a
          // turn R in true world is F R F in the matrix
          // `delta`: copy the donor's CHANGE from its own rest direction and apply it to this body's rest orientation, instead
          // of forcing this limb along the donor's ABSOLUTE direction (a hunched donor would crouch a straight-standing body)
          const dr = k16mv(Q, [sr.P[cj][0] - sr.P[j][0], sr.P[cj][1] - sr.P[j][1], sr.P[cj][2] - sr.P[j][2]]);
          if (k16norm(dv) > 1e-6 && k16norm(u) > 1e-6 && (!delta || k16norm(dr) > 1e-6)) Wtarget = k16mul(K23_F, k16mul(aimR(`l${i}`, delta ? dr : u, dv), k16mul(K23_F, tr.W[i])));
        }
        if (!Wtarget && cLocT[i] && cLocS[j]) {
          // an END part (a foot, a wing tip, a fan): it has no next bone to aim along, so it is aimed along the
          // direction from its attachment point to the middle of its own mass (a foot: toward the toes; a fan:
          // toward the feathers), which is again a property of the shape and not of the bone's local axes
          const u = k16mv(K23_F, k16mv(tr.W[i], cLocT[i])), dv = k16mv(Q, k16mv(K23_F, k16mv(sp.W[j], cLocS[j])));
          const dr = k16mv(Q, k16mv(K23_F, k16mv(sr.W[j], cLocS[j])));
          if (k16norm(dv) > 1e-6 && k16norm(u) > 1e-6 && (!delta || k16norm(dr) > 1e-6)) Wtarget = k16mul(K23_F, k16mul(aimR(`e${i}`, delta ? dr : u, dv), k16mul(K23_F, tr.W[i])));
        }
        if (!Wtarget) {
          // a part whose mass is centred on its own origin (a body, a hub): the donor's own turn from its rest
          const A = k16mul(sp.W[j], k16tr(sr.W[j]));
          Wtarget = k16mul(k16mul(Q, k16mul(A, Qt)), tr.W[i]);
        }
        W = blendRot(tr.W[i], Wtarget, w);
      } else if (p >= 0 && (target.bones[i].verts?.length ?? 0) > 0) {
        W = k16mul(Wt[p], k16mul(k16tr(tr.W[p]), tr.W[i]));      // an unpaired MESH part rides its parent
      } else W = tr.W[i];                                         // an unpaired PIVOT (no mesh) holds the world rest orientation
      Wt[i] = W;
      const Wp = p >= 0 ? Wt[p] : K16_ID;
      const out = k16ToCh2(k16mul(k16tr(Wp), W), prev.get(i) ?? null);
      prev.set(i, out);
      if (!keys2.has(i)) keys2.set(i, []);
      keys2.get(i).push([out[0], out[1], out[2], f]);
    }
    // POSITIONS. The START of a chain (a root, a limb's first bone) goes where its partner goes: its origin's
    // displacement from rest in the donor (true world), turned by Q and scaled by the height ratio, times the
    // blend weight, on top of the target's own rest position (the donor does exactly this: every limb is its own
    // root with its own translation, and the target's format allows it: every bone has its own ch1). Every other
    // bone rides its parent at its own rest offset, so a chain stays one connected limb. The local ch1 is then
    // solved back from the world positions, parents first.
    const Pt = new Array(n).fill(null);
    const disp = (j) => {
      const raw = [sp.P[j][0] - sr.P[j][0], sp.P[j][1] - sr.P[j][1], sp.P[j][2] - sr.P[j][2]];
      const q = k16mv(Q, raw);
      return [q[0] * ratio * w, q[1] * ratio * w, q[2] * ratio * w];
    };
    const dBody = sTorso >= 0 ? disp(sTorso) : [0, 0, 0];
    travelMax = Math.max(travelMax, Math.hypot(dBody[0], dBody[2]));
    for (const i of order) {
      const p = parentOf(i), j = map[i];
      let P;
      if (j >= 0 && (starts.has(i) || p < 0)) { const q = disp(j); P = [tr.P[i][0] + q[0], tr.P[i][1] + q[1], tr.P[i][2] + q[2]]; }
      else if (p >= 0) { const o = k16mv(Wt[p], restC1[i]); P = [Pt[p][0] - o[0], Pt[p][1] + o[1], Pt[p][2] - o[2]]; }
      else P = [tr.P[i][0] + dBody[0], tr.P[i][1] + dBody[1], tr.P[i][2] + dBody[2]];
      Pt[i] = P;
      let c1;
      if (p < 0) c1 = [-P[0], P[1], -P[2]];
      else c1 = k16mv(k16tr(Wt[p]), [Pt[p][0] - P[0], P[1] - Pt[p][1], Pt[p][2] - P[2]]);
      if (!keys1.has(i)) keys1.set(i, []);
      keys1.get(i).push([Math.round(c1[0]), Math.round(c1[1]), Math.round(c1[2]), f]);
    }
  }
  const model = {
    ...target,
    bones: target.bones.map((b, i) => {
      const k2 = keys2.get(i), k1 = keys1.get(i);
      const own2 = (b.anim?.ch2 ?? []).filter((r) => r[3] !== 30000).map((r) => r.slice());
      const own1 = (b.anim?.ch1 ?? []).filter((r) => r[3] !== 30000).map((r) => r.slice());
      const l2 = k2[k2.length - 1], l1 = k1[k1.length - 1];
      return { ...b, anim: { ...(b.anim || {}), ch2: [...own2, ...k2, [l2[0], l2[1], l2[2], 30000]], ch1: [...own1, ...k1, [l1[0], l1[1], l1[2], 30000]] } };
    }),
  } as RetargetWorldModel;
  model.timeline = (target.timeline ? target.timeline.slice() : []);
  model.timeline[table] = { table: srcTable.map((e) => shiftPlaylistEntry(e, offset)) };
  const pairs = [];
  for (let i = 0; i < n; i++) if (map[i] >= 0) pairs.push({ target: i, source: map[i], dist: +dist(pt[i], yawOf(pick, ps[map[i]])).toFixed(3), verts: [ct.parts[i].v, cs.parts[map[i]].v] });
  const withVerts = pt.filter(Boolean).length;
  return {
    model, table, map, clip, offset, frames: hi - lo + 1, pairs,
    covered: withVerts ? chosen.matched / withVerts : 0,
    metrics: { yaw: pick, yawCost: { 0: cand0 ? +cand0.cost.toFixed(3) : null, 180: cand180 ? +cand180.cost.toFixed(3) : null }, sizeRatio: +ratio.toFixed(3), neutralFrame: neutralT, torso: [tTorso, sTorso], travelMax: Math.round(travelMax), roots: rootsT },
  };
}
