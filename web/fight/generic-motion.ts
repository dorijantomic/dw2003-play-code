// Ten GENERIC, body-aware procedural motions. Nothing here knows a species: every recipe reads the rig's ROLES
// (torso, head, arms, legs, wings, tail, spine) and scales by the body's own height and limb lengths.
//
// Method (same arithmetic as the K23 world retarget): the idle pose is the rest; each tick a recipe asks for
//   - rotations of role bones in TRUE WORLD axes (+x character right, y DOWN, +z facing), about the bone origin
//     or a pivot (the hips), clamped to a joint budget taken from how far the model's own clips move that bone;
//   - a body shift (all root-carried bones);
//   - IK for planted feet (FABRIK on the rest bone lengths, bone-aimed by minimal arc) and for reaching hands.
// Every bone is keyed on every tick, so no authored channel leaks, and a smoothstep edge guard returns every
// amplitude to zero at the first and last tick (idle -> motion -> idle).
import { MOTION_KIT, rigOf } from "./anim-retarget.js";
import { bodyPlan } from "./digimon-anatomy.js";

const { sample, k16Pose, k16ToCh2, k16FromCh2, k16mul: mul, k16tr: tr, k16mv: mv, k16fromTo: fromTo,
  k16axisAngle: axAng, k16axisOf: axOf, k23Cloud, k23NeutralFrame, shiftPlaylistEntry } = MOTION_KIT;

const TAU = (Math.PI * 2) / 4096;
const F = [[-1, 0, 0], [0, 1, 0], [0, 0, -1]];
const I3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
const FDF = (D) => mul(F, mul(D, F));
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scl = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const nrm = (a) => { const l = len(a); return l > 1e-9 ? scl(a, 1 / l) : [0, 0, 0]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const cl = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const ss = (x) => { x = cl(x); return x * x * (3 - 2 * x); };
const rx = (a) => axAng([1, 0, 0], a);
const ry = (a) => axAng([0, 1, 0], a);
const rz = (a) => axAng([0, 0, 1], a);
/** eased piecewise curve through [u, value] keys */
function kf(u, pts) {
  if (u <= pts[0][0]) return pts[0][1];
  for (let i = 0; i < pts.length - 1; i++) {
    const [a, va] = pts[i], [b, vb] = pts[i + 1];
    if (u <= b) return va + (vb - va) * ss((u - a) / (b - a));
  }
  return pts[pts.length - 1][1];
}
const win = (u, a, b, c, d) => ss((u - a) / (b - a)) * (1 - ss((u - c) / (d - c)));
function scaleRot(R, t) {
  const { axis, ang } = axOf(R);
  return ang < 1e-9 ? I3 : axAng(axis, ang * t);
}
function clampRot(R, cap) {
  const { axis, ang } = axOf(R);
  return ang > cap ? axAng(axis, cap) : R;
}

// ───────────────────────────── context ─────────────────────────────
const ctxCache = new WeakMap();
function hierPrefix(par, chain) {
  const out = [];
  for (const b of chain || []) {
    if (!Number.isInteger(b)) break;
    if (out.length && par[b] !== out[out.length - 1]) break;
    if (out.includes(b)) break;
    out.push(b);
  }
  return out;
}

function buildCtx(model) {
  const bones = model.bones, n = bones.length;
  const par = bones.map((b) => { const p = (b.parent_slot ?? 0) - 1; return p >= 0 && p < n ? p : -1; });
  const kids = Array.from({ length: n }, () => []);
  par.forEach((p, i) => { if (p >= 0) kids[p].push(i); });
  const fN = k23NeutralFrame(model);
  const rest = k16Pose(model, fN);
  const Wr = rest.W, Pr = rest.P;
  const cloud = k23Cloud(model, rest);
  const H = cloud.H;
  let zmin = Infinity, zmax = -Infinity, xmin = Infinity, xmax = -Infinity;
  for (const p of cloud.parts) if (p) {
    zmin = Math.min(zmin, p.c[2] - p.sz[2] / 2); zmax = Math.max(zmax, p.c[2] + p.sz[2] / 2);
    xmin = Math.min(xmin, p.c[0] - p.sz[0] / 2); xmax = Math.max(xmax, p.c[0] + p.sz[0] / 2);
  }
  let rig = null;
  try { rig = rigOf(model); } catch { rig = null; }
  const notes = [];
  const roots = []; for (let i = 0; i < n; i++) if (par[i] < 0) roots.push(i);
  let mainRoot = rig && Number.isInteger(rig.root) && rig.root >= 0 && rig.root < n ? rig.root : roots[0] ?? 0;
  while (par[mainRoot] >= 0) mainRoot = par[mainRoot];
  const torso = rig && Number.isInteger(rig.torso) && rig.torso >= 0 && rig.torso < n ? rig.torso : mainRoot;
  const head = rig && Number.isInteger(rig.head) && rig.head >= 0 && rig.head < n ? rig.head : null;
  const mkLimb = (chain0, label, extra = {}) => {
    const chain = hierPrefix(par, chain0);
    if (!chain.length) return null;
    const root = chain[0], tip = chain[chain.length - 1];
    const dx = (Pr[tip][0] - cloud.mx) / H;
    let s = Math.abs(dx) < 0.04 ? 0 : Math.sign(dx);
    if (!s && extra.side) s = extra.side === "right" ? 1 : extra.side === "left" ? -1 : 0;
    let L = 0; for (let j = 1; j < chain.length; j++) L += len(sub(Pr[chain[j]], Pr[chain[j - 1]]));
    let dir = nrm(sub(Pr[tip], Pr[root]));
    if (!len(dir)) dir = [0, 1, 0];
    return { chain, root, tip, s, len: L, dir, ordinal: extra.ordinal ?? 0, frontness: (Pr[tip][2] - cloud.mz) / H, label,
      broken: chain.length < (chain0 || []).length };
  };
  const arms = [], legs = [], wings = [];
  if (rig) {
    for (const a of rig.arms) { const l = mkLimb(a.chain, "arm", a); if (l && l.len > 0.03 * H) arms.push(l); }
    for (const a of rig.legs) { const l = mkLimb(a.chain, "leg", a); if (l && l.len > 0.05 * H) legs.push(l); }
    for (const a of rig.wings) { const l = mkLimb(a.chain, "wing", a); if (l && l.len > 0.03 * H) wings.push(l); }
  }
  for (const w of wings) if (!w.s) w.s = wings.indexOf(w) % 2 ? 1 : -1;
  const tailChain = hierPrefix(par, rig?.tail || []);
  const tail = tailChain.length ? tailChain : [];
  // subtree membership
  const sub_ = (r) => { const out = new Set(); const st = [r]; while (st.length) { const b = st.pop(); out.add(b); st.push(...kids[b]); } return out; };
  const legRoots = new Set(legs.map((l) => l.root));
  const ep = par.slice();
  for (const r of roots) {
    if (r === mainRoot) continue;
    const s = sub_(r);
    ep[r] = s.has(torso) || legRoots.has(r) || torso === r ? mainRoot : torso;
    if (ep[r] === r) ep[r] = mainRoot;
  }
  // effective children + DFS order
  const ekids = Array.from({ length: n }, () => []);
  ep.forEach((p, i) => { if (p >= 0) ekids[p].push(i); });
  const order = [], seen = new Set();
  const visit = (i) => { if (seen.has(i)) return; seen.add(i); order.push(i); for (const k of ekids[i]) visit(k); };
  visit(mainRoot);
  for (let i = 0; i < n; i++) visit(i);
  // pivot for body rotations: the hips
  let hips = Pr[torso];
  if (legs.length) { hips = [0, 0, 0]; for (const l of legs) hips = add(hips, Pr[l.root]); hips = scl(hips, 1 / legs.length); }
  // spine: tail, else the longest descending chain (greedy by subtree depth)
  const depth = new Array(n).fill(1);
  for (let k = order.length - 1; k >= 0; k--) { const i = order[k]; for (const c of kids[i]) depth[i] = Math.max(depth[i], 1 + depth[c]); }
  let spine = [];
  for (const r of roots) {
    const ch = [r]; let c = r;
    while (kids[c].length) { c = kids[c].reduce((a, b) => (depth[b] > depth[a] ? b : a)); ch.push(c); }
    if (ch.length > spine.length) spine = ch;
  }
  const limbBones = new Set([...arms, ...legs, ...wings].flatMap((l) => l.chain));
  const spineFree = spine.filter((b) => !limbBones.has(b));
  // the bones the whole upper body hangs from: the torso, plus the top of the head chain when the rig hangs
  // the head from somewhere the torso does not reach (Agumon: torso is the arm root, the head is under the pelvis)
  const upper = [torso];
  if (head != null) {
    const path = []; for (let b = head; b >= 0; b = par[b]) path.push(b);
    if (!path.includes(torso) && !(sub_(torso).has(head))) { const top = path.filter((b) => par[b] === mainRoot)[0]; if (top != null && top !== torso) upper.push(top); }
  }
  const plan = bodyPlan(model.folder) || (legs.length >= 4 ? "quadruped" : wings.length && legs.length ? "winged-biped" : legs.length >= 2 ? "biped-upright" : "other");
  const ctx = {
    model, n, par, kids, ep, order, Wr, Pr, fN, H, cloud, W: xmax - xmin, D: zmax - zmin, rig, notes,
    mainRoot, torso, head, arms, legs, wings, tail, spine: tail.length >= 3 ? tail : (spineFree.length >= 3 ? spineFree : []),
    hips, upper, plan, own: new Map(),
    quad: legs.length >= 4 || /quadruped/.test(plan) || (zmax - zmin) > 1.0 * H,
  };
  ctx.cap = (b, floor, ceil) => {
    let o = ctx.own.get(b);
    if (o === undefined) {
      o = 0;
      const ch2 = bones[b]?.anim?.ch2 || [];
      const Lr = k16FromCh2(sample(ch2, fN));
      for (const k of ch2) {
        if (k[3] >= 3000) continue;
        const { ang } = axOf(mul(tr(Lr), k16FromCh2(k)));
        if (ang > o) o = ang;
      }
      ctx.own.set(b, o);
    }
    return Math.min(ceil, Math.max(floor, 1.3 * o));
  };
  return ctx;
}
function getCtx(model) {
  let c = ctxCache.get(model);
  if (!c) { c = buildCtx(model); ctxCache.set(model, c); }
  return c;
}

// ───────────────────────────── pose spec + solver ─────────────────────────────
class Spec {
  constructor(ctx, g) {
    this.ctx = ctx; this.g = g; this.sh = [0, 0, 0];
    this.rot = new Map(); this.legs = new Map(); this.reaches = new Map();
  }
  shift(v) { this.sh = add(this.sh, scl(v, this.g)); }
  rotate(b, R, { pivot = null, floor = 0.5, ceil = 1.9 } = {}) {
    if (b == null || b < 0) return;
    const cur = this.rot.get(b);
    let M = scaleRot(R, this.g);
    if (cur) M = mul(M, cur.R);
    M = clampRot(M, this.ctx.cap(b, floor, ceil));
    this.rot.set(b, { R: M, pivot: pivot || cur?.pivot || null });
  }
  /** rotate a whole limb rigidly so its rest direction turns toward `dir` by `amt` of the way */
  aim(limb, dir, amt, opts = {}) {
    if (!limb || amt <= 1e-4) return;
    const d = nrm(dir); if (!len(d)) return;
    this.rotate(limb.root, scaleRot(fromTo(limb.dir, d), cl(amt)), { floor: 1.6, ceil: 2.6, ...opts });
  }
  /** several weighted pulls toward different directions, composed (continuous in the weights, no swing between opposites) */
  aimMix(limb, items) {
    let R = I3, any = false;
    for (const [dir, wt] of items) {
      if (wt <= 1e-4) continue;
      const d = nrm(dir); if (!len(d)) continue;
      R = mul(scaleRot(fromTo(limb.dir, d), cl(wt)), R); any = true;
    }
    if (any) this.rotate(limb.root, R, { floor: 1.6, ceil: 2.6 });
  }
  leg(l, { off = [0, 0, 0], air = 0, tuck = [0, 0, 0] } = {}) {
    this.legs.set(l, { off: scl(off, this.g), air: air * this.g, tuck: scl(tuck, this.g) });
  }
  reach(arm, target, w) { this.reaches.set(arm, { target, w: cl(w) * this.g }); }
}

function fabrik(J, l, T, H) {
  const k = J.length - 1, J0 = J[0].slice();
  for (let it = 0; it < 24; it++) {
    J[k] = T.slice();
    for (let j = k - 1; j >= 0; j--) J[j] = add(J[j + 1], scl(nrm(sub(J[j], J[j + 1])), l[j]));
    J[0] = J0.slice();
    for (let j = 1; j <= k; j++) J[j] = add(J[j - 1], scl(nrm(sub(J[j], J[j - 1])), l[j - 1]));
    if (len(sub(J[k], T)) < 1e-3 * H) break;
  }
  return J;
}

function solve(ctx, spec, stats) {
  const { n, ep, order, Wr, Pr, H } = ctx;
  const Wn = new Array(n), Pn = new Array(n), Dn = new Array(n), done = new Array(n).fill(false);
  const ik = new Map();
  for (const l of ctx.legs) if (l.chain.length >= 2) ik.set(l.root, { kind: "leg", limb: l, e: spec.legs.get(l) || { off: [0, 0, 0], air: 0, tuck: [0, 0, 0] } });
  for (const a of ctx.arms) { const r = spec.reaches.get(a); if (r && a.chain.length >= 2 && !ik.has(a.root)) ik.set(a.root, { kind: "arm", limb: a, e: r }); }
  for (const i of order) {
    if (done[i]) continue;
    const p = ep[i];
    let Wd, Pd, q0 = null;
    const R = spec.rot.get(i);
    if (p < 0) { Wd = Wr[i]; Pd = add(Pr[i], spec.sh); if (R?.pivot) q0 = add(R.pivot, spec.sh); }
    else {
      const D = Dn[p];
      Wd = mul(FDF(D), Wr[i]);
      Pd = add(Pn[p], mv(D, sub(Pr[i], Pr[p])));
      if (R?.pivot) q0 = add(Pn[p], mv(D, sub(R.pivot, Pr[p])));
    }
    if (R) {
      Wn[i] = mul(FDF(R.R), Wd);
      Pn[i] = q0 ? add(q0, mv(R.R, sub(Pd, q0))) : Pd;
    } else { Wn[i] = Wd; Pn[i] = Pd; }
    Dn[i] = FDF(mul(Wn[i], tr(Wr[i])));
    const c = ik.get(i);
    if (c) {
      const ch = c.limb.chain, k = ch.length - 1, c0 = ch[0];
      const J = ch.map((b) => add(Pn[c0], mv(Dn[c0], sub(Pr[b], Pr[c0]))));
      const Jc = J.map((x) => x.slice());
      const l = []; for (let j = 0; j < k; j++) l.push(len(sub(Pr[ch[j + 1]], Pr[ch[j]])));
      let T;
      if (c.kind === "leg") {
        const Tabs = add(Pr[ch[k]], c.e.off);
        const Tfk = add(Jc[k], c.e.tuck);
        T = lerp3(Tabs, Tfk, cl(c.e.air));
      } else T = lerp3(Jc[k], c.e.target, c.e.w);
      fabrik(J, l, T, H);
      stats.ikErr = Math.max(stats.ikErr, c.kind === "leg" && c.e.air < 0.01 && len(c.e.off) < 1e-6 ? len(sub(J[k], T)) / H : 0);
      let last = I3;
      for (let j = 0; j < k; j++) {
        const dR = sub(Pr[ch[j + 1]], Pr[ch[j]]), dN = sub(J[j + 1], J[j]);
        const A = len(dR) > 1e-6 && len(dN) > 1e-6 ? fromTo(dR, dN) : I3;
        Wn[ch[j]] = mul(F, mul(A, mul(F, Wr[ch[j]])));
        Pn[ch[j]] = J[j];
        last = A;
      }
      const Rk = spec.rot.get(ch[k])?.R || I3;
      const base = c.kind === "leg" ? I3 : last;
      Wn[ch[k]] = mul(FDF(mul(Rk, base)), Wr[ch[k]]);
      Pn[ch[k]] = J[k];
      for (let j = 0; j <= k; j++) { Dn[ch[j]] = FDF(mul(Wn[ch[j]], tr(Wr[ch[j]]))); done[ch[j]] = true; }
    }
    done[i] = true;
  }
  return { Wn, Pn };
}

// ───────────────────────────── the ten recipes ─────────────────────────────
function lean(S, c, { pitch = 0, yaw = 0, roll = 0, floor = 0.6 } = {}) {
  const R = mul(ry(yaw), mul(rz(roll), rx(-pitch)));
  for (const b of c.upper) S.rotate(b, R, { pivot: c.hips, floor });
}
function headRot(S, c, { pitch = 0, yaw = 0, roll = 0, floor = 0.6 } = {}) {
  if (c.head == null || c.head === c.torso) return;
  S.rotate(c.head, mul(ry(yaw), mul(rz(roll), rx(-pitch))), { floor });
}
const prim = (c) => c.arms.filter((a) => a.ordinal === 0);
const armS = (a, i) => a.s || (i % 2 ? 1 : -1);
/** a bend of every bone of a chain toward lateral (+x) and/or up, per-bone angles */
function bendChain(S, c, chain, fn, floor = 0.5) {
  for (let j = 0; j < chain.length; j++) {
    const b = chain[j];
    let d = j < chain.length - 1 ? nrm(sub(c.Pr[chain[j + 1]], c.Pr[b])) : (j > 0 ? nrm(sub(c.Pr[b], c.Pr[chain[j - 1]])) : [0, 0, -1]);
    if (!len(d)) continue;
    let la = cross(d, [1, 0, 0]); la = len(la) > 0.3 ? nrm(la) : [0, 1, 0];
    let va = Math.abs(d[1]) < 0.8 ? cross(d, [0, -1, 0]) : cross(d, [0, 0, 1]);
    va = nrm(va);
    const [a, v] = fn(j, chain.length);
    S.rotate(b, mul(axAng(la, a), axAng(va, v)), { floor, ceil: 1.4 });
  }
}
const frontLegs = (c) => c.legs.filter((l) => l.frontness > 0.08);
const rearLegs = (c) => c.legs.filter((l) => l.frontness <= 0.08);

function runRear(c, S, u) {
  const H = c.H, hunched = /hunched/.test(c.plan);
  const pmax = c.quad ? 0.7 : hunched ? 0.5 : 0.4;
  const dip = kf(u, [[0, 0], [0.14, 1], [0.27, 0], [1, 0]]);
  const rise = kf(u, [[0, 0], [0.22, 0], [0.4, 1], [0.78, 1], [0.94, 0], [1, 0]]);
  const sh = Math.sin(2 * Math.PI * 4 * (u - 0.4)) * win(u, 0.4, 0.46, 0.74, 0.8);
  S.shift([0, H * (0.03 * dip - 0.02 * rise), H * (-0.05 * rise)]);
  lean(S, c, { pitch: -0.12 * dip - pmax * rise, floor: 0.8 });
  headRot(S, c, { pitch: -0.3 * rise - 0.12 * sh, yaw: 0.1 * sh, floor: 0.8 });
  const fl = c.quad ? frontLegs(c) : [];
  for (const l of fl) S.leg(l, { off: [l.s * -0.03 * H * rise, -0.28 * H * rise, 0.1 * H * rise] });
  prim(c).forEach((a, i) => {
    if (fl.some((l) => l.root === a.root)) return;
    const s = armS(a, i);
    S.aimMix(a, [[[s * 0.8, -0.5, 0.3], 0.85 * rise], [[s * 0.3, 0.2, 0.5], 0.5 * dip]]);
  });
  if (c.tail.length) bendChain(S, c, c.tail, (j, k) => [0.35 * Math.sin(2 * Math.PI * 2 * u - j * 0.5) * rise / k * 2, -0.25 * rise / k]);
  for (const w of c.wings) S.aim(w, [w.s * 0.8, -0.6, -0.2], 0.6 * rise);
}

function runLunge(c, S, u) {
  const H = c.H;
  const wind = kf(u, [[0, 0], [0.2, 1], [0.32, 0], [1, 0]]);
  const lunge = kf(u, [[0, 0], [0.22, 0], [0.36, 1], [0.7, 1], [0.92, 0], [1, 0]]);
  const hitA = kf(u, [[0, 0], [0.12, 0], [0.4, 1], [0.52, 0.6], [0.62, 0], [1, 0]]);
  const hitB = kf(u, [[0, 0], [0.4, 0], [0.66, 1], [0.76, 0.5], [0.88, 0], [1, 0]]);
  S.shift([0, 0, H * (0.17 * lunge - 0.04 * wind)]);
  lean(S, c, { pitch: 0.28 * lunge - 0.12 * wind, floor: 0.7 });
  const arms = prim(c).sort((a, b) => b.len - a.len);
  headRot(S, c, { pitch: 0.15 * lunge + (arms.length ? 0 : 0.35 * hitA), floor: 0.7 });
  if (!arms.length) S.shift([0, 0, H * 0.06 * hitA]);
  arms.slice(0, 2).forEach((a, i) => {
    const s = armS(a, i), hit = i === 0 ? hitA : hitB, wd = wind * (i === 0 ? 1 : 0.6);
    const dir = nrm(lerp3([s * 0.25, 0.4, -0.7], [-s * 0.08, -0.02, 1], 0.5 + 0.5 * (hit - wd)));
    let T = add(c.Pr[a.root], scl(dir, a.len * 0.92));
    const dv = sub(T, c.Pr[a.tip]);                       // a hand never travels more than this far from its rest spot
    if (len(dv) > 0.5 * H) T = add(c.Pr[a.tip], scl(dv, 0.5 * H / len(dv)));
    S.reach(a, T, Math.max(hit, wd));
    // reach target must follow the torso (carried below)
  });
  carryReaches(c, S, 0);
}
/** reach targets are given in rest coordinates; make them ride the body shift (cheap carry) */
function carryReaches(c, S, extraZ) {
  for (const r of S.reaches.values()) r.target = add(r.target, add(S.sh, [0, 0, extraZ]));
}

function runTail(c, S, u) {
  const H = c.H;
  const wind = kf(u, [[0, 0], [0.25, 1], [0.35, 1], [0.55, 0], [1, 0]]);
  const sweep = kf(u, [[0, 0], [0.25, -1], [0.38, -1], [0.58, 1], [0.7, 1], [0.92, 0], [1, 0]]);
  const k = c.tail.length;
  bendChain(S, c, c.tail, (j) => {
    const lag = kf(u - j * 0.025, [[0, 0], [0.25, -1], [0.38, -1], [0.58, 1], [0.7, 1], [0.92, 0], [1, 0]]);
    return [1.5 / k * lag, -0.15 * wind / k];
  }, 0.7);
  lean(S, c, { yaw: -0.3 * sweep, roll: 0.05 * sweep, floor: 0.5 });
  headRot(S, c, { yaw: 0.2 * sweep, floor: 0.5 });
  prim(c).forEach((a, i) => S.aim(a, [armS(a, i) * 0.7, -0.1 + 0.2 * sweep, 0.2 - 0.2 * sweep], 0.35 * Math.abs(sweep)));
  for (const w of c.wings) S.aim(w, [w.s * 0.8, -0.3, -0.3], 0.3 * Math.abs(sweep));
  S.shift([H * 0.015 * sweep, 0, 0]);
}

function runStomp(c, S, u) {
  const H = c.H;
  const raise = kf(u, [[0, 0], [0.28, 1], [0.34, 1], [0.42, 0], [1, 0]]);
  const armsUp = kf(u, [[0, 0], [0.26, 1], [0.34, 1], [0.44, 0], [1, 0]]);
  const slamA = kf(u, [[0, 0], [0.4, 0], [0.46, 1], [0.62, 0.6], [0.82, 0], [1, 0]]);
  const t = Math.max(0, u - 0.42);
  const ring = ss(t / 0.03) * Math.exp(-t * 7) * Math.cos(2 * Math.PI * 3 * t);
  const lead = [...c.legs].sort((a, b) => b.frontness - a.frontness || b.s - a.s)[0];
  for (const l of c.legs) {
    if (l === lead) S.leg(l, { off: [0, -0.22 * H * raise, 0.07 * H * raise] });
  }
  S.shift([lead ? -lead.s * 0.05 * H * raise : 0, H * 0.05 * ring, 0]);
  lean(S, c, { pitch: -0.12 * raise + 0.18 * slamA + 0.03 * ring, floor: 0.6 });
  headRot(S, c, { pitch: 0.05 * ring + 0.1 * slamA, floor: 0.5 });
  prim(c).forEach((a, i) => {
    const s = armS(a, i);
    S.aimMix(a, [[[s * 0.3, -1, 0.4], 0.9 * armsUp], [[s * 0.2, 0.7, 0.9], 0.85 * slamA]]);
  });
  bendChain(S, c, c.tail, (j, k) => [0.2 * ring / k * 3, 0.15 * slamA / k]);
}

function runLeap(c, S, u) {
  const H = c.H;
  const crouch = kf(u, [[0, 0], [0.2, 1], [0.3, 1], [0.42, 0], [1, 0]]);
  const hop = Math.sin(Math.PI * cl((u - 0.3) / 0.42)) * (u > 0.3 && u < 0.72 ? 1 : 0);
  const lift = 0.34 * hop;
  const land = kf(u, [[0, 0], [0.7, 0], [0.76, 1], [0.88, 0], [1, 0]]);
  const air = ss((lift - 0.02) / 0.12), tuckAmt = ss(hop * 2);
  S.shift([0, H * (0.09 * crouch + 0.07 * land - lift), H * 0.12 * hop]);
  lean(S, c, { pitch: 0.18 * crouch + 0.22 * hop * hop + 0.12 * land, floor: 0.7 });
  headRot(S, c, { pitch: -0.15 * hop, floor: 0.5 });
  for (const l of c.legs) S.leg(l, { air, tuck: scl([0, -0.2 * H, (l.frontness > 0.08 ? 0.12 : -0.12) * H], tuckAmt) });
  prim(c).forEach((a, i) => {
    const s = armS(a, i);
    S.aimMix(a, [[[s * 0.3, 0.5, -0.8], 0.8 * crouch], [[s * 0.2, -0.3, 1], 0.9 * hop], [[s * 0.4, 0.3, 0.6], 0.5 * land]]);
  });
  for (const w of c.wings) S.aim(w, [w.s * 0.9, -0.6 * hop, -0.1], 0.7 * hop);
  bendChain(S, c, c.tail, (j, k) => [0, (0.3 * hop - 0.2 * crouch) / k * 2]);
}

function runCharge(c, S, u) {
  const H = c.H;
  const crouch = kf(u, [[0, 0], [0.18, 1], [0.46, 1], [0.58, 0], [1, 0]]);
  const coil = kf(u, [[0, 0], [0.4, 0], [0.5, 1], [0.55, 0], [1, 0]]);
  const charge = kf(u, [[0, 0], [0.5, 0], [0.62, 1], [0.8, 1], [0.95, 0], [1, 0]]);
  const shake = Math.sin(2 * Math.PI * 4 * (u - 0.7)) * win(u, 0.7, 0.74, 0.84, 0.9);
  S.shift([0, H * 0.07 * crouch, H * (0.15 * charge - 0.05 * coil)]);
  lean(S, c, { pitch: 0.22 * crouch + 0.2 * charge - 0.1 * coil, floor: 0.7 });
  headRot(S, c, { pitch: 0.3 * crouch + 0.2 * charge, yaw: 0.3 * shake, floor: 0.8 });
  const pawers = c.legs.length >= 3 ? frontLegs(c) : [];
  const paw = [...(pawers.length ? pawers : c.legs)].sort((a, b) => b.frontness - a.frontness).slice(0, 1);
  const sc = win(u, 0.1, 0.16, 0.38, 0.44);
  const ph = Math.sin(2 * Math.PI * 2.5 * (u - 0.1) / 0.3);
  for (const l of paw) S.leg(l, { off: [0, -0.07 * H * Math.max(0, ph) * sc, (0.03 - 0.07 * ph) * H * sc] });
  prim(c).forEach((a, i) => S.aim(a, [armS(a, i) * 0.4, 0.3, 0.8], 0.4 * charge + 0.3 * crouch));
  bendChain(S, c, c.tail, (j, k) => [0.3 * shake / k * 2, -0.35 * charge / k]);
}

function runWings(c, S, u) {
  const H = c.H;
  const open = kf(u, [[0, 0], [0.14, 1], [0.84, 1], [0.97, 0], [1, 0]]);
  const x = Math.max(0, (u - 0.14) / 0.7);
  const ph = 2 * Math.PI * 3 * x;
  const a = 0.35 + 0.65 * Math.sin(ph);               // wing elevation, rad-ish (up positive)
  const act = ss(x * 8) * (1 - ss((x - 0.88) * 8));
  for (const w of c.wings) {
    const el = a * act + 0.3 * (1 - act);
    S.aim(w, [w.s * Math.cos(el), -Math.sin(el), -0.15], open);
  }
  const bob = -Math.cos(ph) * act;
  S.shift([0, H * (-0.04 * open + 0.035 * bob), 0]);
  lean(S, c, { pitch: -0.12 * open - 0.04 * bob, floor: 0.5 });
  headRot(S, c, { pitch: -0.15 * open, floor: 0.5 });
  const air = ss((0.04 * open - 0.035 * bob - 0.015) / 0.04);
  for (const l of c.legs) S.leg(l, { air: cl(air) * 0.8, tuck: [0, -0.06 * H, -0.04 * H] });
  prim(c).forEach((ar, i) => S.aim(ar, [armS(ar, i) * 0.5, 0.3, 0.7], 0.3 * open));
  bendChain(S, c, c.tail, (j, k) => [0.2 * Math.sin(ph - j * 0.5) * act / k * 2, 0.2 * bob / k]);
}

function runCoil(c, S, u) {
  const H = c.H, sp = c.spine, k = sp.length;
  const coil = kf(u, [[0, 0], [0.3, 1], [0.44, 1], [0.54, 0], [1, 0]]);
  const rear = kf(u, [[0, 0], [0.28, 0], [0.42, 1], [0.5, 1], [0.58, 0], [1, 0]]);
  const strike = kf(u, [[0, 0], [0.46, 0], [0.56, 1], [0.7, 1], [0.9, 0], [1, 0]]);
  bendChain(S, c, sp, (j) => [
    (1.1 * Math.sin(2 * Math.PI * (1.4 * j / k) - 4 * u) * coil + 0.15 * Math.sin(2 * Math.PI * 3 * (u - 0.58)) * win(u, 0.58, 0.62, 0.8, 0.92)) * 1.0,
    (0.4 * rear - 0.45 * strike) * (j < k * 0.6 ? 1 : 0.4),
  ].map((v) => v * Math.min(0.9, 4 / k)), 0.8);
  S.shift([0, -H * 0.03 * rear, H * 0.1 * strike]);
  if (c.torso !== sp[0]) lean(S, c, { pitch: -0.2 * rear + 0.25 * strike, floor: 0.6 });
  headRot(S, c, { pitch: -0.2 * rear + 0.3 * strike, floor: 0.7 });
  for (const w of c.wings) S.aim(w, [w.s * 0.9, -0.4 * rear, -0.1], 0.6 * (rear + 0.5 * strike));
  prim(c).forEach((a, i) => S.aim(a, [armS(a, i) * 0.6, 0.1, 0.5], 0.4 * strike));
}

function runSkitter(c, S, u) {
  const H = c.H;
  const legs = [...c.legs].sort((a, b) => b.frontness - a.frontness);
  const gate = win(u, 0.08, 0.16, 0.84, 0.92);
  const cyc = 3 * (u - 0.1) / 0.8;
  const f = cyc - Math.floor(cyc);
  const sway = Math.sin(2 * Math.PI * cyc);
  legs.forEach((l, i) => {
    const grp = (i + (l.s > 0 ? 1 : 0)) % 2;
    const phase = grp ? f : (f + 0.5) % 1;
    const lifting = phase < 0.5 ? Math.sin(Math.PI * phase * 2) : 0;
    S.leg(l, { off: [0, -0.12 * H * lifting * gate, 0.07 * H * Math.sin(Math.PI * phase * 2 - 0.0) * gate * (phase < 0.5 ? 1 : 0)] });
  });
  S.shift([H * 0.05 * sway * gate, -H * 0.02 * Math.abs(Math.sin(2 * Math.PI * cyc)) * gate, 0]);
  lean(S, c, { yaw: 0.2 * sway * gate, roll: -0.1 * sway * gate, pitch: 0.06 * gate, floor: 0.5 });
  headRot(S, c, { pitch: 0.12 * Math.sin(2 * Math.PI * cyc * 2) * gate, yaw: -0.15 * sway * gate, floor: 0.5 });
  prim(c).forEach((a, i) => S.aim(a, [armS(a, i) * (0.35 + 0.35 * Math.sin(2 * Math.PI * cyc * 2 + i)), 0.1, 0.9], 0.55 * gate));
  for (const w of c.wings) S.aim(w, [w.s * 0.9, -0.5 + 0.3 * Math.sin(2 * Math.PI * cyc * 4), -0.1], 0.45 * gate);
  bendChain(S, c, c.tail, (j, k) => [0.3 * Math.sin(2 * Math.PI * cyc - j * 0.6) * gate / k * 2, 0]);
}

function runTaunt(c, S, u) {
  const H = c.H;
  const gate = win(u, 0.08, 0.2, 0.82, 0.94);
  const x = (u - 0.12) / 0.76;
  const hs = Math.sin(2 * Math.PI * 3 * x) * gate;
  const sw = Math.sin(2 * Math.PI * 1.5 * x) * gate;
  const bounce = Math.abs(Math.sin(2 * Math.PI * 3 * x)) * gate;
  S.shift([H * 0.03 * sw, -H * 0.02 * bounce, 0]);
  lean(S, c, { pitch: -0.14 * gate, roll: 0.14 * sw, yaw: 0.1 * hs, floor: 0.5 });
  headRot(S, c, { yaw: 0.5 * hs, pitch: -0.1 * gate, roll: 0.1 * hs, floor: 0.9 });
  prim(c).forEach((a, i) => {
    const s = armS(a, i), ph = Math.sin(2 * Math.PI * 3 * x + (i ? Math.PI : 0)) * gate;
    S.aim(a, [s * 0.9, -0.2 - 0.6 * ph, 0.5], 0.75 * gate);
  });
  for (const w of c.wings) S.aim(w, [w.s * 0.9, -0.4 - 0.3 * bounce, -0.1], 0.6 * gate);
  bendChain(S, c, c.tail, (j, k) => [0.5 * Math.sin(2 * Math.PI * 3 * x - j * 0.6) * gate / k * 2, 0.15 * gate / k]);
}

// ───────────────────────────── catalogue ─────────────────────────────
const legsN = (c, n) => c.legs.filter((l) => l.chain.length >= 2).length >= n;
const M = [
  { id: "rear-roar", name: "Rear Up and Roar", ticks: 64, run: runRear,
    description: "Dips, rears the chest back about the hips, head thrown up and shaking, arms flung out; a four-legged body lifts its forelegs off the ground.",
    needs: ["torso", "head", "legs>=2"], bodyPlans: ["biped-upright", "biped-hunched", "quadruped", "winged-biped", "winged-quadruped", "multi-armed", "other"],
    can: (c) => (c.head == null ? "no head bone" : !legsN(c, 2) ? "needs two legs to rear on" : null) },
  { id: "lunge-strike", name: "Lunge and Double Strike", ticks: 64, run: runLunge,
    description: "Winds back, then lunges forward with the feet planted and strikes with each arm in turn (an armless body headbutts).",
    needs: ["torso"], bodyPlans: "any", can: (c) => (c.torso == null ? "no torso" : null) },
  { id: "tail-sweep", name: "Tail Sweep", ticks: 56, run: runTail,
    description: "Torso winds against the tail, the tail whips across in a travelling wave, the body counter-turns.",
    needs: ["tail"], bodyPlans: "any", can: (c) => (c.tail.length < 1 ? "no tail chain in the bone map" : null) },
  { id: "stomp-slam", name: "Stomp and Slam", ticks: 60, run: runStomp,
    description: "Lifts one foot and both arms, shifts weight, then slams foot and arms down with a damped body quake.",
    needs: ["legs>=2"], bodyPlans: ["biped-upright", "biped-hunched", "winged-biped", "multi-armed", "quadruped", "insectoid", "other"],
    can: (c) => (!legsN(c, 2) ? "needs two legs" : null) },
  { id: "leap-pounce", name: "Leap and Pounce", ticks: 60, run: runLeap,
    description: "Crouches, springs up with the legs tucked and arms reaching forward, lands in a crouch. The only motion where the feet leave the ground.",
    needs: ["legs>=2"], bodyPlans: ["biped-upright", "biped-hunched", "quadruped", "winged-biped", "winged-quadruped", "insectoid", "multi-armed", "other"],
    can: (c) => (!legsN(c, 2) ? "needs two legs to jump on" : null) },
  { id: "crouch-charge", name: "Crouch and Charge", ticks: 72, run: runCharge,
    description: "Drops head-low and paws the ground with a forefoot, coils back, then drives forward head-first and shakes off.",
    needs: ["head", "legs>=2"], bodyPlans: ["quadruped", "winged-quadruped", "biped-hunched", "insectoid", "other"],
    can: (c) => (c.head == null ? "no head bone" : !legsN(c, 2) ? "needs two legs" : null) },
  { id: "wing-flap", name: "Wing Spread and Flap", ticks: 64, run: runWings,
    description: "Spreads the wings, beats them three times while the body rises and sinks and the feet lift.",
    needs: ["wings"], bodyPlans: ["winged-biped", "winged-quadruped", "insectoid", "floating", "multi-armed", "biped-upright"],
    can: (c) => (!c.wings.length ? "no wing chains in the bone map" : null) },
  { id: "coil-strike", name: "Coil and Strike", ticks: 72, run: runCoil,
    description: "Throws an S-wave down a long body or tail, rears the head up, then straightens and strikes forward.",
    needs: ["spine>=3 bones"], bodyPlans: ["serpentine", "aquatic-swimmer", "floating", "other"],
    can: (c) => (c.spine.length < 3 ? "no chain of 3+ free bones to wave" : (c.legs.length >= 2 && c.tail.length < 5 ? "legged body: use Tail Sweep" : null)) },
  { id: "skitter-step", name: "Skitter Step", ticks: 60, run: runSkitter,
    description: "Alternate groups of legs step in place while the body sways, the head and feelers twitch.",
    needs: ["legs>=3"], bodyPlans: ["insectoid", "quadruped", "winged-quadruped", "multi-armed", "blob"],
    can: (c) => (!legsN(c, 3) ? "needs three or more legs" : null) },
  { id: "taunt-shake", name: "Taunt Shake", ticks: 64, run: runTaunt,
    description: "Leans back and swaggers: head shakes, shoulders roll, arms and wings beckon, tail wags. Feet stay planted.",
    needs: ["torso"], bodyPlans: "any", can: (c) => (c.torso == null ? "no torso" : null) },
];

export const GENERIC_MOTIONS = M.map(({ id, name, description, needs, bodyPlans }) => ({ id, name, description, needs, bodyPlans }));

export function listGenericMotions(model) {
  let c = null, err = null;
  try { c = model?.bones?.length ? getCtx(model) : null; } catch (e) { err = e; }
  return M.map((m) => {
    if (!c) return { id: m.id, name: m.name, applicable: false, reason: err ? `rig analysis failed: ${err.message}` : "no model" };
    let r = null;
    try { r = m.can(c); } catch { r = "check failed"; }
    return r ? { id: m.id, name: m.name, applicable: false, reason: r } : { id: m.id, name: m.name, applicable: true };
  });
}

export function bakeGenericMotion(model, id, { offset = 8000 } = {}) {
  try {
    const m = M.find((x) => x.id === id);
    if (!m) return { ok: false, reason: `unknown motion ${id}` };
    if (!model?.bones?.length) return { ok: false, reason: "no model" };
    const c = getCtx(model);
    const why = m.can(c);
    if (why) return { ok: false, reason: why };
    const n = c.n, T = m.ticks;
    const keys2 = Array.from({ length: n }, () => []), keys1 = Array.from({ length: n }, () => []);
    const prev = c.model.bones.map((b) => sample(b?.anim?.ch2, c.fN));
    const stats = { ikErr: 0, maxStep: 0 };
    for (let t = 0; t < T; t++) {
      const u = t / (T - 1);
      const g = ss(u / 0.06) * ss((1 - u) / 0.06);
      const S = new Spec(c, g);
      m.run(c, S, u);
      const { Wn, Pn } = solve(c, S, stats);
      for (let i = 0; i < n; i++) {
        const p = c.par[i];
        const L = p >= 0 ? mul(tr(Wn[p]), Wn[i]) : Wn[i];
        const o2 = k16ToCh2(L, prev[i]); prev[i] = o2;
        let c1;
        if (p < 0) c1 = [-Pn[i][0], Pn[i][1], -Pn[i][2]];
        else c1 = mv(tr(Wn[p]), [Pn[p][0] - Pn[i][0], Pn[i][1] - Pn[p][1], Pn[p][2] - Pn[i][2]]);
        const f = offset + t;
        keys2[i].push([o2[0], o2[1], o2[2], f]);
        keys1[i].push([Math.round(c1[0]), Math.round(c1[1]), Math.round(c1[2]), f]);
      }
    }
    const out = {
      ...model,
      bones: model.bones.map((b, i) => {
        const own2 = (b.anim?.ch2 ?? []).filter((r) => r[3] !== 30000 && r[3] < offset).map((r) => r.slice());
        const own1 = (b.anim?.ch1 ?? []).filter((r) => r[3] !== 30000 && r[3] < offset).map((r) => r.slice());
        const l2 = keys2[i][T - 1], l1 = keys1[i][T - 1];
        return { ...b, anim: { ...(b.anim || {}), ch2: [...own2, ...keys2[i], [l2[0], l2[1], l2[2], 30000]], ch1: [...own1, ...keys1[i], [l1[0], l1[1], l1[2], 30000]] } };
      }),
    };
    const tl = model.timeline ? model.timeline.slice() : [];
    let table = 62;
    while (tl[table] && (tl[table].table?.length ?? 0)) table++;
    const play = [];
    for (let t = 0; t < T; t++) play.push(shiftPlaylistEntry({ value: t, loop_target: 0, aux: null }, offset));
    play.push({ value: 0xffff, loop_target: 0, aux: null });
    tl[table] = { table: play };
    out.timeline = tl;
    return {
      ok: true, model: out, table, ticks: T,
      report: {
        id, plan: c.plan, height: Math.round(c.H), neutralFrame: c.fN,
        roles: { torso: c.torso, head: c.head, arms: c.arms.length, legs: c.legs.length, wings: c.wings.length, tail: c.tail.length, spine: c.spine.length },
        brokenChains: [...c.arms, ...c.legs, ...c.wings].filter((l) => l.broken).length,
        maxPlantedFootError: +stats.ikErr.toFixed(4),
      },
    };
  } catch (e) {
    return { ok: false, reason: `bake failed: ${e?.message || e}` };
  }
}
