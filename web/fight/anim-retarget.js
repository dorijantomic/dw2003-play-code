// Retarget a donor's per-bone ROTATION motion onto a target skeleton whose hierarchy differs.
//
// Why: a timeline table is only a frame playlist (timeline-player.js:10-15) - the renderer always samples the
// PLAYING model's own channels (battle3d.js:225-311). Borrowing a donor's table therefore only reproduces the
// donor's motion for a pose-identical twin. A model of the same kind but a different skeleton (Knightmon 26
// bones vs Gallantmon 27) can still inherit the MOTION if the bones are matched by role and their rotation
// channels are copied onto the target's own bones: the bone lengths and the rest pitch stay the target's, so
// no limb can stretch - only the joint angles move.
//
// This module is pure maths over the model JSON (no DOM, no fetch), so a node test can check a mapping and the
// battle lab can bake the same thing in memory. Nothing here writes disc data: a bake exists only for the
// lifetime of the model object it is attached to.
//
// Roles are read from the geometry: legs are the chains that end nearest the floor, arms the long chains that
// start high and to one side, a weapon is a terminal bone with an elongated mesh, the head the top-most
// near-centre bone. The arena's PS1 world has +Y DOWN and +Z toward the opponent, so the character's RIGHT is
// +X (this is the same convention that puts Gallantmon's lance on +x and Knightmon's sword on +x).

import { boneMap as k16BoneMap } from "./digimon-bonemap.js";

const TAU = (Math.PI * 2) / 4096;

function sample(ch, frame) {
  if (!ch || !ch.length) return [0, 0, 0];
  let lo = ch[0], hi = ch[0];
  for (const rec of ch) {
    if (rec[3] === 30000) break;
    if (rec[3] <= frame) lo = rec; else { hi = rec; break; }
  }
  if (lo === hi || hi[3] === 30000 || hi[3] <= lo[3]) return [lo[0], lo[1], lo[2]];
  const t = (frame - lo[3]) / (hi[3] - lo[3]);
  return [lo[0] + t * (hi[0] - lo[0]), lo[1] + t * (hi[1] - lo[1]), lo[2] + t * (hi[2] - lo[2])];
}

function mat3Mul(a, b) {
  const o = new Array(9).fill(0);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
    let s = 0; for (let k = 0; k < 3; k++) s += a[k * 3 + r] * b[c * 3 + k];
    o[c * 3 + r] = s;
  }
  return o;
}
function ps1Mat3(ax, ay, az) {
  const cx = Math.cos(ax * TAU), sx = Math.sin(ax * TAU);
  const cy = Math.cos(ay * TAU), sy = Math.sin(ay * TAU);
  const cz = Math.cos(az * TAU), sz = Math.sin(az * TAU);
  const Rz = [cx, sx, 0, -sx, cx, 0, 0, 0, 1];
  const Ry = [cy, 0, -sy, 0, 1, 0, sy, 0, cy];
  const Rx = [1, 0, 0, 0, cz, sz, 0, -sz, cz];
  return mat3Mul(Rz, mat3Mul(Ry, Rx));
}
function compose(a, b) {
  const o = new Array(9).fill(0);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    let s = 0; for (let k = 0; k < 3; k++) s += a[k * 3 + j] * b[i * 3 + k];
    o[i * 3 + j] = s;
  }
  return o;
}
function applyRot(R, v) {
  return [R[0] * v[0] + R[3] * v[1] + R[6] * v[2],
          R[1] * v[0] + R[4] * v[1] + R[7] * v[2],
          R[2] * v[0] + R[5] * v[1] + R[8] * v[2]];
}

/** Rest-pose world position/rotation per bone (the renderer's own formula, battle3d.js buildBoneWorldMatrices). */
export function restPose(model, frame = 0) {
  const n = model.num_bones ?? model.bones.length;
  const rot = new Array(n).fill(null), pos = new Array(n).fill(null);
  const proc = (i) => {
    const b = model.bones[i], anim = b.anim || {};
    const c2 = sample(anim.ch2, frame), c1 = sample(anim.ch1, frame);
    const R = ps1Mat3(c2[2], c2[1], c2[0]);
    const p = (b.parent_slot ?? 0) - 1;
    if (p < 0) { rot[i] = R; pos[i] = [-c1[0], c1[1], -c1[2]]; return; }
    if (!rot[p]) proc(p);
    rot[i] = compose(rot[p], R);
    const rt = applyRot(rot[p], c1);
    pos[i] = [pos[p][0] - rt[0], pos[p][1] + rt[1], pos[p][2] - rt[2]];
  };
  for (let i = 0; i < n; i++) if (!rot[i]) proc(i);
  return { rot, pos };
}

function meshBox(model, i, pose) {
  const b = model.bones[i], vs = b.verts || [];
  if (!vs.length) return null;
  const R = pose.rot[i], t = pose.pos[i];
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (const v of vs) {
    const x = -(R[0] * v[0] + R[3] * v[1] + R[6] * v[2]) + t[0];
    const y =  (R[1] * v[0] + R[4] * v[1] + R[7] * v[2]) + t[1];
    const z = -(R[2] * v[0] + R[5] * v[1] + R[8] * v[2]) + t[2];
    if (x < mn[0]) mn[0] = x; if (x > mx[0]) mx[0] = x;
    if (y < mn[1]) mn[1] = y; if (y > mx[1]) mx[1] = y;
    if (z < mn[2]) mn[2] = z; if (z > mx[2]) mx[2] = z;
  }
  return { mn, mx, d: [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]] };
}

/**
 * The skeleton's usable anatomy: legs/arms by side, a head, terminal props (weapons/shields) and the
 * model's overall box. Every chain is a list of bone indices from the shoulder/hip to the tip.
 *
 * `limbRoots` (K22b, OFF by default): a rig can hang a whole limb off ITS OWN root — one root per arm /
 * leg / wing, so the rig has 5..10 roots and no branch points at all (K21d measured 27 of 108 DW2 rigs of
 * that class, and Kokatorimon's legs were unclaimable without this). When on, a root with exactly one child
 * that begins a chain of two or more bones is read as a LIMB root: its chain's side and reach come from the
 * chain's TIP instead of its start (the start is the body's centre line by construction).
 */
export function rolesOf(model, { limbRoots = false } = {}) {
  const n = model.num_bones ?? model.bones.length;
  const pose = restPose(model);
  const kids = new Map();
  for (let i = 0; i < n; i++) {
    const p = (model.bones[i].parent_slot ?? 0) - 1;
    if (!kids.has(p)) kids.set(p, []);
    kids.get(p).push(i);
  }
  const roots = kids.get(-1) ?? [0];
  const box = (() => {
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < n; i++) {
      const bb = meshBox(model, i, pose);
      if (!bb) continue;
      for (let k = 0; k < 3; k++) { if (bb.mn[k] < mn[k]) mn[k] = bb.mn[k]; if (bb.mx[k] > mx[k]) mx[k] = bb.mx[k]; }
    }
    return { mn, mx, h: mx[1] - mn[1], w: mx[0] - mn[0], d: mx[2] - mn[2] };
  })();
  // every root-child chain, walked to its tip (a bone with != 1 child ends the chain); a branch continues
  // down the child that carries the longest subtree, so an arm's shoulder->hand path is one chain
  const depthOf = (i, seen = 0) => {
    const ks = kids.get(i) ?? [];
    if (!ks.length || seen > 12) return 1;
    return 1 + Math.max(...ks.map((k) => depthOf(k, seen + 1)));
  };
  const chains = [];
  for (const r of roots) {
    for (const c of kids.get(r) ?? []) {
      const seq = []; let cur = c;
      for (;;) {
        seq.push(cur);
        const ks = kids.get(cur) ?? [];
        if (ks.length !== 1) {
          if (ks.length > 1) {
            const next = ks.slice().sort((a, b) => depthOf(b) - depthOf(a))[0];
            if (depthOf(next) > 1) { cur = next; if (seq.length < 14) continue; }
          }
          break;
        }
        cur = ks[0];
        if (seq.length > 14) break;
      }
      chains.push({ root: r, from: c, seq, tip: seq[seq.length - 1],
                    limbRoot: limbRoots && (kids.get(r) ?? []).length === 1 && seq.length >= 2 });
    }
  }
  const H = box.h || 1, W = box.w || 1;
  const tipY = (ch) => pose.pos[ch.tip][1];
  const maxY = Math.max(...chains.map(tipY));
  const topY = Math.min(...pose.pos.map((p) => p[1]));
  // a limb-rooted chain starts on the body's centre line, so its side/reach are the TIP's
  const sideX = (ch) => (ch.limbRoot ? pose.pos[ch.tip][0] : pose.pos[ch.from][0]);
  const reachX = (ch) => Math.abs(sideX(ch));
  const feet = chains.filter((ch) => tipY(ch) > maxY - 0.12 * H
    && (ch.limbRoot ? reachX(ch) > 0.03 * W : Math.abs(pose.pos[ch.from][0]) > 0.03 * W));
  const legs = feet.map((ch) => ({ side: sideX(ch) < 0 ? "left" : "right", chain: ch.seq }));
  // arms: chains that start in the upper half and reach out to one side, longest first
  const armsAll = chains
    .filter((ch) => !feet.includes(ch) && reachX(ch) > 0.10 * W
                    && pose.pos[ch.from][1] < topY + 0.55 * H && ch.seq.length >= 2)
    .sort((a, b) => b.seq.length - a.seq.length);
  const arms = [];
  for (const ch of armsAll) {
    const side = sideX(ch) < 0 ? "left" : "right";
    if (!arms.some((a) => a.side === side)) arms.push({ side, chain: ch.seq });
  }
  // head: the top-most bone near the centre line with a small mesh, not a segment of the trailing cape chain
  const capeSeq = (() => {
    const cand = chains
      .filter((ch) => Math.abs(pose.pos[ch.from][0]) <= 0.10 * W && ch.seq.length >= 3
                      && pose.pos[ch.tip][2] < -0.15 * (box.d || 1))
      .sort((a, b) => b.seq.length - a.seq.length)[0];
    return cand ? cand.seq : null;
  })();
  const inCape = new Set(capeSeq ?? []);
  const limbBones = new Set([...legs.flatMap((l) => l.chain), ...arms.flatMap((a) => a.chain)]);
  let head = -1, bestY = Infinity;
  for (let i = 0; i < n; i++) {
    if (inCape.has(i) || limbBones.has(i) || roots.includes(i)) continue;
    const bb = meshBox(model, i, pose);
    if (!bb) continue;
    // a head is compact, near the centre line, and much smaller than the torso box
    if (Math.abs(pose.pos[i][0]) > 0.15 * W) continue;
    if (bb.d[0] > 0.30 * W || bb.d[1] > 0.35 * H) continue;
    if (pose.pos[i][1] < bestY) { bestY = pose.pos[i][1]; head = i; }
  }
  // props: a terminal bone whose mesh is much longer than it is wide (a blade/lance) on either side
  const props = [];
  for (let i = 0; i < n; i++) {
    const ks = kids.get(i) ?? [];
    if (ks.length) continue;
    const bb = meshBox(model, i, pose);
    if (!bb) continue;
    const s = [...bb.d].sort((a, b) => b - a);
    if (s[0] >= 0.45 * H && s[0] >= 2.2 * Math.max(s[1], 1)) {
      props.push({ bone: i, side: pose.pos[i][0] < 0 ? "left" : (pose.pos[i][0] > 0 ? "right" : "center"),
                   len: s[0], x: pose.pos[i][0] });
    }
  }
  const cape = capeSeq;
  return { n, pose, box, roots, chains, legs, arms, head, props, cape: cape ? cape.slice() : null };
}

/**
 * K22b rule 1 — WHICH root is the root, derived from the rig's own shape (never from a stored index).
 *
 * A rig can carry two roots in the same place: one for the upper body and one for the legs (68 of the 244
 * DW3 bone maps have that shape). Which one a game calls bone 0 is arbitrary, and the retarget maps TARGET
 * ROOT <- DONOR ROOT, so if the two games disagree, a donor TORSO twist rotates the target's whole body
 * (K21d measured it on Meramon: ankle drift 0.419 H, worst step 16.7 vs the normalised 0.185 H / 9.33).
 *
 * `r` is the root that CARRIES THE LEGS (the locomotion root: the bone whose translation moves the body);
 * a second root that carries the arms/head is the TORSO. A rig where every limb hangs off its own root
 * (5..10 roots) has no single leg root and keeps whatever root it names. Nothing here is species-specific:
 * the inputs are the rig's own chains.
 */
export function normaliseRoots(rig, model) {
  const n = rig.n ?? model.num_bones ?? model.bones.length;
  const parentOf = (i) => { const p = (model.bones[i]?.parent_slot ?? 0) - 1; return p >= 0 && p < n ? p : -1; };
  let roots = (rig.roots ?? []).filter((i) => i >= 0 && i < n).slice();
  if (!roots.length) { for (let i = 0; i < n; i++) if (parentOf(i) < 0) roots.push(i); }
  if (!roots.length) roots = [0];
  const under = (bone, root) => {
    let i = bone;
    for (let step = 0; step <= n && i >= 0; step++) { if (i === root) return true; i = parentOf(i); }
    return false;
  };
  const legStarts = rig.legs.filter((l) => l.ordinal === 0 && l.chain.length).map((l) => l.chain[0]);
  const upper = [
    ...rig.arms.filter((a) => a.ordinal === 0 && a.chain.length).map((a) => a.chain[0]),
    ...(rig.head != null && rig.head >= 0 ? [rig.head] : []),
  ];
  const legsUnder = roots.filter((r) => legStarts.length > 0 && legStarts.every((b) => under(b, r)));
  const upperUnder = roots.filter((r) => upper.length > 0 && upper.some((b) => under(b, r)));
  const storedRoot = rig.root != null && rig.root >= 0 ? rig.root : roots[0];
  let root = storedRoot;
  if (legsUnder.length === 1) root = legsUnder[0];
  else if (legsUnder.length > 1 && legsUnder.includes(storedRoot)) root = storedRoot;
  // the second root: when another root carries the upper body, that root IS the torso (a stored torso may
  // be a chest bone inside the same tree; the upper ROOT is what has to take the donor's torso motion).
  const otherUpper = upperUnder.filter((r) => r !== root);
  const storedTorso = rig.torso != null && rig.torso >= 0 ? rig.torso : null;
  let torso = storedTorso === root ? null : storedTorso;
  if (otherUpper.length) torso = otherUpper[0];
  return { roots, root, torso, rootRaw: storedRoot, torsoRaw: storedTorso, legRoots: legsUnder, upperRoot: otherUpper[0] ?? null };
}

/** target bone index -> source bone index (-1 = keep the target's own rest rotation). */
export function buildBoneMap(target, source) {
  const T = rolesOf(target), S = rolesOf(source);
  const map = new Array(T.n).fill(-1);
  map[0] = 0;                                   // root: body lean / turn comes straight across
  // A target chain LONGER than the donor's would otherwise map two of its joints onto one donor joint and
  // apply that joint's rotation twice (the wrist then swings twice as far as the donor's - measured: the
  // target hand travelled 4.5x the donor's). Only the first target joint of a duplicated pair takes the
  // donor's rotation; the extra joint keeps its own rest rotation, so the chain still reaches where the
  // donor's does with one bend instead of two.
  const chainMap = (tc, sc) => {
    const m = tc.length, n = sc.length;
    const taken = new Set();
    for (let i = 0; i < m; i++) {
      const j = m === 1 ? n - 1 : Math.round((i * (n - 1)) / (m - 1));
      if (taken.has(j)) continue;
      taken.add(j);
      map[tc[i]] = sc[j];
    }
  };
  for (const side of ["left", "right"]) {
    const tl = T.legs.find((l) => l.side === side), sl = S.legs.find((l) => l.side === side);
    if (tl && sl) chainMap(tl.chain, sl.chain);
    const ta = T.arms.find((a) => a.side === side), sa = S.arms.find((a) => a.side === side);
    if (ta && sa) chainMap(ta.chain, sa.chain);
  }
  if (T.head >= 0 && S.head >= 0) map[T.head] = S.head;
  // weapons ride the arm that holds them: map each prop onto the source prop on the same side - unless the arm
  // chain already put a joint of this target on that donor joint (then the prop keeps its rest rotation, or the
  // donor's swing would be applied twice down one arm)
  for (const p of T.props) {
    const sp = S.props.find((q) => q.side === p.side) || S.props[0];
    if (!sp) continue;
    if (map.some((v, i) => v === sp.bone && i !== p.bone)) continue;
    map[p.bone] = sp.bone;
  }
  if (T.cape && S.cape) chainMap(T.cape, S.cape);
  return { map, T, S };
}

/**
 * One playlist entry re-based by `offset` frames — the ONE copy both bakes use.
 *
 * `value & 0x8000` is a blend/loop marker, not a frame, so the value keeps its low 15 bits. The
 * `loop_target` field carries two DIFFERENT meanings and the sampler distinguishes them by the value
 * (vendor/engine.js readPhase / advancePlayhead):
 *   * a BLEND segment (value & 0x8000, but not 0x8000 exactly) eases the pose FROM `loop_target`
 *     (and `aux`), which are FRAMES — they move with the playlist;
 *   * the PURE LOOP marker (value === 0x8000) JUMPS THE PLAYHEAD to `loop_target` as a TABLE INDEX —
 *     it must NOT move.
 * A15: the old copy shifted the pure marker's index too (50 -> 6050 in an 82-entry table), so the
 * playhead left the table and every read came back frame 0: the actor was drawn in its bind pose for
 * the rest of the cast, and a mesh the idle keeps scaled to 0 (Boltmon's thrown second axe) popped
 * back at full size. That is the operator's "reset to a flat pose" + "a second axe" report.
 */
function shiftPlaylistEntry(e, offset) {
  const v = e.value | 0;
  const out = { ...e };
  const loopIndex = v === 0x8000;                 // a playhead index, not a frame
  if (v === 0xffff) out.value = v;                // end marker
  else if (v & 0x8000) out.value = 0x8000 | (v & 0x7fff);
  else out.value = v + offset;
  out.loop_target = (loopIndex || e.loop_target == null || e.loop_target === 0xffff)
    ? e.loop_target : (e.loop_target | 0) + offset;
  out.aux = (loopIndex || e.aux == null || e.aux === 0xffff) ? e.aux : (e.aux | 0) + offset;
  return out;
}

/**
 * Bake `clip` from `source` onto a CLONE of `target`: the clone's bones keep their own translations (so no
 * stretching) and gain the source's rotation keys shifted by `offset` frames; the source's bound table is
 * shifted the same way, so playing `table` on the clone reproduces the donor's timing on the target's body.
 * Returns null when the bone map covers too little of the target to be a real pose.
 */
export function bakeRetargetGeometry(target, source, clip, { offset = 6000 } = {}) {
  const src = source.actions?.[clip];
  if (!src || !src.ops?.length) return null;
  const { map, T, S } = buildBoneMap(target, source);
  const covered = map.filter((m, i) => m >= 0 && i > 0).length / Math.max(1, T.n - 1);
  if (covered < 0.45) return null;
  const tableIdx = [];
  for (const o of src.ops) {
    if (o.op === 2 && o.words?.[0] === 0 && (o.words[2] | 0) > 1) tableIdx.push(o.words[2] | 0);
  }
  const table = src.ops.find((o) => o.op === 2 && o.words?.[0] === 0 && (o.words[2] | 0) > 1)?.words[2] | 0;
  if (!table) return null;
  const srcTable = source.timeline?.[table]?.table;
  if (!Array.isArray(srcTable) || !srcTable.length) return null;
  const model = {
    ...target,
    bones: target.bones.map((b, i) => {
      const m = map[i];
      const srcBone = m >= 0 ? source.bones[m] : null;
      const ch2 = srcBone?.anim?.ch2;
      if (!ch2 || !ch2.length) return { ...b, anim: { ...(b.anim || {}) } };
      // keep the target's own keys (its other clips use them), then append the donor keys past `offset`
      const own = (b.anim?.ch2 ?? []).filter((r) => r[3] !== 30000).map((r) => r.slice());
      const moved = [];
      for (const r of ch2) {
        if (r[3] === 30000) continue;
        moved.push([r[0], r[1], r[2], r[3] + offset]);
      }
      moved.sort((a, b) => a[3] - b[3]);
      const last = moved[moved.length - 1];
      const merged = [...own, ...moved, [last ? last[0] : 0, last ? last[1] : 0, last ? last[2] : 0, 30000]];
      return { ...b, anim: { ...(b.anim || {}), ch2: merged } };
    }),
  };
  // the shifted playlist: the source's frames re-based into the target's appended key range.
  model.timeline = (target.timeline ? target.timeline.slice() : []);
  model.timeline[table] = { table: srcTable.map((e) => shiftPlaylistEntry(e, offset)) };
  return { model, table, map, covered, roles: { target: T, source: S }, clip, offset };
}

// ── K16: the math retarget — role based, scale aware, rest-frame conjugation, IK reach ───────────
//
// bakeRetargetGeometry() above copies the donor's ch2 KEYS onto the target's bones. That is only right
// for a pose-identical twin: it assumes the donor's rest orientation, its limb lengths and its firing
// side are the target's, and it derives the roles from mesh geometry (which fails on the 23 rigs with
// no arm chain and on every body whose limbs are drawn on the torso mesh). K16 replaces the copy with a
// retarget computed per frame in the target's own rest frame, from the K12 bone maps
// (digimon-bonemap.js: authored bone indices, no geometry guessed at runtime):
//
//   roles    target bone -> donor bone by ANATOMY: root, torso, head, mouth, the left/right arm chain,
//            the left/right leg chain, wings, tail. A role the target HAS and the donor LACKS is left at
//            the target's own rest rotation; a target with MORE arms keeps its extra arms on their own
//            idle (they are never mapped), and a donor's extra roles are ignored. Chain joints are
//            matched proportionally, and one donor joint never drives two target joints.
//   lengths  per role chain, the ratio of the target's chain length to the donor's (sum of its own bone
//            lengths, so it is the model's real proportion, not its height).
//   frame    per mapped bone the donor's pose is divided by its OWN rest orientation and the quotient is
//            applied to the TARGET's rest orientation:
//                delta = W_donor_rest^-1 * W_donor(frame)
//                W_t   = W_target_rest * delta             (W = world rotation, real matrices)
//            The donor's joint motion therefore arrives in the target's frame, and at the clip's first
//            frame every bone is exactly at the target's own rest pose (no snap, no inherited lean).
//   scale    the ONLY translation that carries body motion is the root's ch1; it is scaled by the height
//            ratio (target height / donor height). Every other ch1 stays the target's own, so no bone
//            length changes: nothing can stretch.
//   reach    the end effector of each arm (hand/weapon tip) and each leg (ankle) is solved with a bounded
//            analytic TWO-BONE IK after the conjugation: the hand is driven to the point the donor's hand
//            would occupy, scaled by the chain's length ratio; the elbow angle comes from the law of
//            cosines, the reach is clamped inside the chain's own length (|a-b| .. a+b), and the bend
//            plane is the one the conjugated pose already had. The ankle's vertical travel is clamped to
//            K16.ankleShare of body height, so a borrowed cast cannot lift a foot.
//   limits   every joint's departure from its rest orientation is clamped to K16.maxJoint, so a donor
//            joint that sits past the target's plausible range cannot invert the target's limb.
//   mirror   when the donor's FIRING arm is the other side (measured over the clip: which arm's tip
//            travels, with the design's dominant side as the tie-break) and both models' sides are
//            confident (bone map sc != "low"), the arm delta is mirrored across the model's own sagittal
//            plane (S*delta*S, S = diag(-1,1,1)) and the donor's opposite arm chain is the source. A
//            model whose side confidence is LOW never mirrors: it takes the same-side chain, which is
//            mirror-safe by construction (no side assumption is made at all).
//
// The result is the same shape bakeRetargetGeometry() returns, so castGate() and applyCastBake() are
// unchanged and the A10 automatic gate keeps deciding whether a pair is used or the planted cast is kept.
export const K16 = {
  maxJoint: 2.62,        // rad (150 deg): a joint never departs its rest orientation by more than this
  reachSlack: 0.985,     // the IK never asks for more than this share of the chain's own length
  ankleShare: 0.055,     // an ankle may rise/fall by this share of the body height (the gate allows 0.10)
  rootLiftShare: 0.03,   // the borrowed root translation may lift the body by this share of its height
  mirrorMinTravel: 0.10, // an arm must out-travel the other by this share to name the firing side
  ikDeadband: 0.02,      // a limb already within this share of body height of its target is not corrected
  maxIk: 1.40,           // rad: the largest correction a single IK pass may apply to one link
  // K22b reach rule: a pair whose IK clamps on this share of its arm solves is not reaching the donor's
  // points at all, so the bake follows the donor's hand PATH instead (see bakeRetargetByRole's `reach`).
  reachSwitchShare: 0.10,
};

// real row-major 3x3 helpers. A ch2 triple (c0,c1,c2) is the rotation RZ(c2)*RY(c1)*RX(c0) in the
// renderer's own arithmetic (verified against restPose(): identical to 0.0e+0 on every bone).
const k16mul = (A, B) => A.map((row) => B[0].map((_, j) => row.reduce((s, v, k) => s + v * B[k][j], 0)));
const k16tr = (A) => A[0].map((_, j) => A.map((r) => r[j]));
const k16mv = (A, v) => A.map((row) => row[0] * v[0] + row[1] * v[1] + row[2] * v[2]);
const k16dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const k16sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const k16scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const k16norm = (a) => Math.hypot(a[0], a[1], a[2]);
const K16_ID = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
const K16_SX = [[-1, 0, 0], [0, 1, 0], [0, 0, 1]];
const k16rz = (t) => [[Math.cos(t), -Math.sin(t), 0], [Math.sin(t), Math.cos(t), 0], [0, 0, 1]];
const k16ry = (t) => [[Math.cos(t), 0, Math.sin(t)], [0, 1, 0], [-Math.sin(t), 0, Math.cos(t)]];
const k16rx = (t) => [[1, 0, 0], [0, Math.cos(t), -Math.sin(t)], [0, Math.sin(t), Math.cos(t)]];
const k16local = (c0, c1, c2) => k16mul(k16rz(c2), k16mul(k16ry(c1), k16rx(c0)));
const k16perp = (a) => {
  const t = Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const p = [a[1] * t[2] - a[2] * t[1], a[2] * t[0] - a[0] * t[2], a[0] * t[1] - a[1] * t[0]];
  const n = k16norm(p);
  return n > 1e-9 ? k16scale(p, 1 / n) : [0, 0, 1];
};
function k16axisAngle(axis, ang) {
  const [x, y, z] = axis, c = Math.cos(ang), s = Math.sin(ang), t = 1 - c;
  return [[t * x * x + c, t * x * y - s * z, t * x * z + s * y],
          [t * x * y + s * z, t * y * y + c, t * y * z - s * x],
          [t * x * z - s * y, t * y * z + s * x, t * z * z + c]];
}
/** The rotation's axis and angle (identity for a zero rotation). */
function k16axisOf(M) {
  const c = Math.max(-1, Math.min(1, (M[0][0] + M[1][1] + M[2][2] - 1) / 2));
  const ang = Math.acos(c);
  if (ang < 1e-9) return { axis: [0, 0, 1], ang: 0 };
  if (Math.PI - ang < 1e-6) {
    // 180 deg: the axis is the dominant diagonal
    const d = [M[0][0], M[1][1], M[2][2]];
    const i = d[0] >= d[1] && d[0] >= d[2] ? 0 : (d[1] >= d[2] ? 1 : 2);
    const v = [Math.sqrt(Math.max(0, (M[i][0] + 1) / 2)), Math.sqrt(Math.max(0, (M[i][1] + (i === 1 ? 1 : 0)) / 2)),
               Math.sqrt(Math.max(0, (M[i][2] + (i === 2 ? 1 : 0)) / 2))];
    return { axis: k16perp(v), ang };
  }
  const ax = [M[2][1] - M[1][2], M[0][2] - M[2][0], M[1][0] - M[0][1]];
  const n = k16norm(ax);
  return { axis: n > 1e-9 ? k16scale(ax, 1 / n) : [0, 0, 1], ang };
}
/** Clamp a rotation's angle to `max` (a joint limit applied in the joint's own frame). */
function k16clampRot(M, max) {
  const { axis, ang } = k16axisOf(M);
  if (ang <= max) return M;
  return k16axisAngle(axis, max);
}
/** Minimal-arc rotation taking direction u onto direction v. */
function k16fromTo(u, v) {
  const nu = k16norm(u), nv = k16norm(v);
  if (nu < 1e-9 || nv < 1e-9) return K16_ID;
  const a = k16scale(u, 1 / nu), b = k16scale(v, 1 / nv);
  const c = k16dot(a, b);
  if (c > 1 - 1e-9) return K16_ID;
  if (c < -1 + 1e-9) return k16axisAngle(k16perp(a), Math.PI);
  const ax = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const s = k16norm(ax);
  return k16axisAngle(k16scale(ax, 1 / s), Math.atan2(s, c));
}
/** A ch2 triple (in RAW units) -> the real local rotation matrix. */
const k16FromCh2 = (t) => k16local(t[0] * TAU, t[1] * TAU, t[2] * TAU);
/**
 * Real local rotation -> a ch2 triple in raw units, RZ(c2)*RY(c1)*RX(c0), picked to be the branch
 * nearest `prev`: a ZYX decomposition has a second, equivalent solution (c0+180, 180-c1, c2+180), and
 * flipping between the two between two frames would be read as a 180-deg jump by the gate (speed) and
 * by the renderer (a visible twitch), so the branch closest to the previous key is always taken.
 */
function k16ToCh2(M, prev = null) {
  const cb = Math.hypot(M[0][0], M[1][0]);
  let c0, c1, c2;
  if (cb > 1e-7) {
    c1 = Math.atan2(-M[2][0], cb);
    c2 = Math.atan2(M[1][0], M[0][0]);
    c0 = Math.atan2(M[2][1], M[2][2]);
  } else {
    c1 = Math.atan2(-M[2][0], cb);
    c2 = Math.atan2(-M[0][1], M[1][1]);
    c0 = 0;
  }
  let t = [c0 / TAU, c1 / TAU, c2 / TAU];
  if (prev) {
    const wrapNear = (x, p) => {
      let d = x - p;
      d = ((d % 4096) + 4096) % 4096;
      if (d > 2048) d -= 4096;
      return p + d;
    };
    const alt = [t[0] + 2048, 2048 - t[1], t[2] + 2048];
    const cost = (v) => Math.abs(v[0] - prev[0]) + Math.abs(v[1] - prev[1]) + Math.abs(v[2] - prev[2]);
    const a = t.map((x, i) => wrapNear(x, prev[i]));
    const b = alt.map((x, i) => wrapNear(x, prev[i]));
    t = cost(a) <= cost(b) ? a : b;
  }
  const norm = (x) => {
    let r = Math.round(x) % 4096;
    if (r < 0) r += 4096;
    return r >= 2048 ? r - 4096 : r;
  };
  return [norm(t[0]), norm(t[1]), norm(t[2])];
}

/** Every bone's world rotation and world position at `frame` (the renderer's own arithmetic). */
function k16Pose(model, frame) {
  const n = model.num_bones ?? model.bones.length;
  const W = new Array(n).fill(null), P = new Array(n).fill(null);
  const go = (i) => {
    const c2 = sample(model.bones[i]?.anim?.ch2, frame);
    const L = k16FromCh2(c2);
    const p = (model.bones[i]?.parent_slot ?? 0) - 1;
    const c1 = sample(model.bones[i]?.anim?.ch1, frame);
    if (p < 0 || p >= n) { W[i] = L; P[i] = [-c1[0], c1[1], -c1[2]]; return; }
    if (!W[p]) go(p);
    W[i] = k16mul(W[p], L);
    const o = k16mv(W[p], c1);
    P[i] = [P[p][0] - o[0], P[p][1] + o[1], P[p][2] - o[2]];
  };
  for (let i = 0; i < n; i++) if (!W[i]) go(i);
  return { W, P };
}

const k16RigCache = new Map();
const k16RestCache = new Map();
function k16Subtrees(model) {
  const n = model.num_bones ?? model.bones.length;
  const kids = Array.from({ length: n }, () => []);
  for (let i = 0; i < n; i++) {
    const p = (model.bones[i]?.parent_slot ?? 0) - 1;
    if (p >= 0 && p < n) kids[p].push(i);
  }
  const out = Array.from({ length: n }, () => []);
  const walk = (i, acc) => { acc.push(i); for (const k of kids[i]) walk(k, acc); return acc; };
  for (let i = 0; i < n; i++) out[i] = walk(i, []);
  return out;
}

/**
 * The anatomical rig of a model: role chains from the K12 bone map when the model has one, else from the
 * geometry heuristics (rolesOf). Shaped for castGate() (arms/legs/props/box/pose) plus the fields the
 * retarget needs (root/torso/head/mouth/wings/tail/dom/side confidence).
 */
export function rigOf(model) {
  const n = model.num_bones ?? model.bones.length;
  const folder = model?.folder ?? null;
  const cacheKey = folder ?? `__${n}`;
  if (folder && k16RigCache.has(cacheKey)) return k16RigCache.get(cacheKey);
  const geo = rolesOf(model);                 // mesh box, weapon props, geometry pose
  const bm = folder ? k16BoneMap(folder) : null;
  const rig = {
    folder, n, box: geo.box, pose: geo.pose, props: geo.props, roots: geo.roots, cape: geo.cape,
    source: bm ? "bonemap" : "geometry",
    root: bm ? (bm.r ?? 0) : (geo.roots[0] ?? 0),
    torso: bm ? (bm.t ?? null) : null,
    head: bm ? (bm.h ?? geo.head) : geo.head,
    mouth: bm ? (bm.m ?? null) : null,
    arms: [], legs: [], wings: [], tail: [],
    dom: bm ? (bm.dom ?? null) : null,
    sc: bm ? (bm.sc ?? null) : null,
  };
  if (bm) {
    for (const [k, side] of [["aL", "left"], ["aR", "right"]]) if (bm[k]?.length) rig.arms.push({ side, ordinal: 0, chain: bm[k].slice() });
    for (const [k, side] of [["aLe", "left"], ["aRe", "right"]]) (bm[k] ?? []).forEach((c, i) => { if (c?.length) rig.arms.push({ side, ordinal: i + 1, chain: c.slice() }); });
    for (const [k, side] of [["lL", "left"], ["lR", "right"]]) if (bm[k]?.length) rig.legs.push({ side, ordinal: 0, chain: bm[k].slice() });
    for (const [k, side] of [["lL2", "left"], ["lR2", "right"]]) (bm[k] ?? []).forEach((c, i) => { if (c?.length) rig.legs.push({ side, ordinal: i + 1, chain: c.slice() }); });
    for (const [k, side] of [["wL", "left"], ["wR", "right"]]) if (bm[k]?.length) rig.wings.push({ side, ordinal: 0, chain: bm[k].slice() });
    if (bm.tl?.length) rig.tail = bm.tl.slice();
  } else {
    for (const a of geo.arms) rig.arms.push({ side: a.side, ordinal: 0, chain: a.chain.slice() });
    for (const l of geo.legs) rig.legs.push({ side: l.side, ordinal: 0, chain: l.chain.slice() });
  }
  // K22b rule 1: normalise which root is the root ON THIS SIDE, from the rig's own shape. A no-op for a
  // rig whose stored root already carries the legs and which has no second upper-body root.
  const nr = normaliseRoots(rig, model);
  rig.rootRaw = nr.rootRaw;
  rig.torsoRaw = nr.torsoRaw;
  rig.root = nr.root;
  rig.torso = nr.torso;
  rig.roots = nr.roots;
  rig.rootFix = {
    legRoot: nr.legRoots[0] ?? null, upperRoot: nr.upperRoot,
    rawCarriesLegs: nr.legRoots.includes(nr.rootRaw),
    moved: nr.root !== nr.rootRaw || nr.torso !== nr.torsoRaw,
  };
  if (folder) k16RigCache.set(cacheKey, rig);
  // the bones this rig claims as ROLES (the coverage the retarget can be judged on: a viz bone or an
  // extra arm the design doesn't animate is not a role, and leaving it at rest is correct)
  const roles = new Set([rig.root, rig.torso, rig.head, rig.mouth].filter((v) => v != null && v >= 0));
  for (const a of [...rig.arms, ...rig.legs, ...rig.wings]) for (const b of a.chain) roles.add(b);
  for (const b of rig.tail) roles.add(b);
  rig.roleBones = [...roles];
  return rig;
}

function k16Rest(model) {
  const key = model?.folder ?? null;
  if (key && k16RestCache.has(key)) return k16RestCache.get(key);
  const p = k16Pose(model, 0);
  if (key) k16RestCache.set(key, p);
  return p;
}

/** Chain length = the sum of the bone-to-bone distances along the chain, in the pose given. */
function k16ChainLen(P, chain) {
  let L = 0;
  for (let i = 1; i < chain.length; i++) {
    const a = P[chain[i - 1]], b = P[chain[i]];
    if (!a || !b) continue;
    L += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  }
  return L;
}

/** Worst per-frame rotation step in a key map (rad): the snap a played clip shows. K22b's tie-break. */
function k16WorstStep(keys) {
  let worst = 0;
  for (const arr of keys.values()) {
    for (let i = 1; i < arr.length; i++) {
      const d = Math.hypot(arr[i][0] - arr[i - 1][0], arr[i][1] - arr[i - 1][1], arr[i][2] - arr[i - 1][2]);
      if (d > worst) worst = d;
    }
  }
  return worst * TAU;
}

/**
 * The model's own longest LOOPING clip, as a frame span — the motion an unmapped role keeps alive during
 * a bake (K22b rule 4). Read from the model's own timeline, so no clip index is assumed.
 */
function k16IdleSpan(model) {
  let best = null;
  for (const [idx, t] of (model.timeline ?? []).entries()) {
    const tab = t?.table;
    if (!Array.isArray(tab)) continue;
    let lo = Infinity, hi = -1, loops = false;
    for (const e of tab) {
      const v = e?.value | 0;
      if (v === 0x8000) loops = true;              // the pure loop marker: a playhead index
      if (v >= 0 && v < 0x8000) { if (v < lo) lo = v; if (v > hi) hi = v; }
    }
    if (!loops || !(hi > lo)) continue;
    if (!best || hi - lo > best.hi - best.lo) best = { lo, hi, len: hi - lo + 1, table: idx };
  }
  return best;
}

/**
 * target bone -> donor bone by ROLE. `mirror` swaps the arm sides (the donor's right arm drives the
 * target's left arm). Extra arms of a multi-armed target are deliberately left unmapped.
 */
export function roleBoneMap(T, S, { mirror = false } = {}) {
  const map = new Array(T.n).fill(-1);
  const pairs = [];
  if (S.root >= 0 && T.root >= 0) map[T.root] = S.root;
  for (const [t, s] of [[T.torso, S.torso], [T.head, S.head], [T.mouth, S.mouth]]) {
    // a torso that IS the root is already mapped as the root: mapping it again would overwrite the root
    // rotation with the donor's torso (the K22b bug, one step removed)
    if (t != null && s != null && t >= 0 && s >= 0 && t !== T.root) map[t] = s;
  }
  const chainMap = (tc, sc) => {
    const m = tc.length, n = sc.length;
    const taken = new Set();
    for (let i = 0; i < m; i++) {
      const j = m === 1 ? n - 1 : Math.round((i * (n - 1)) / (m - 1));
      if (taken.has(j)) continue;
      taken.add(j);
      map[tc[i]] = sc[j];
    }
  };
  for (const side of ["left", "right"]) {
    const ss = mirror ? (side === "left" ? "right" : "left") : side;
    const ta = T.arms.find((a) => a.side === side && a.ordinal === 0);
    const sa = S.arms.find((a) => a.side === ss && a.ordinal === 0);
    if (ta && sa) { chainMap(ta.chain, sa.chain); pairs.push({ kind: "arm", side, tc: ta.chain, sc: sa.chain }); }
    const tl = T.legs.find((a) => a.side === side && a.ordinal === 0);
    const sl = S.legs.find((a) => a.side === side && a.ordinal === 0);
    if (tl && sl) { chainMap(tl.chain, sl.chain); pairs.push({ kind: "leg", side, tc: tl.chain, sc: sl.chain }); }
    const tw = T.wings.find((a) => a.side === side && a.ordinal === 0);
    const sw = S.wings.find((a) => a.side === side && a.ordinal === 0);
    if (tw && sw) chainMap(tw.chain, sw.chain);
  }
  if (T.tail?.length && S.tail?.length) chainMap(T.tail, S.tail);
  if (T.cape && S.cape) chainMap(T.cape, S.cape);
  return { map, pairs };
}

/** Which arm the donor's clip actually fires with: the arm whose tip travels most over the clip. */
function k16FiringSide(S, source, lo, hi) {
  const a = k16Pose(source, lo), b = k16Pose(source, hi);
  const travel = {};
  for (const arm of S.arms.filter((x) => x.ordinal === 0)) {
    const tip = arm.chain[arm.chain.length - 1];
    travel[arm.side] = Math.hypot(...k16sub(b.P[tip], a.P[tip]));
  }
  const l = travel.left ?? 0, r = travel.right ?? 0;
  if (l + r > 1e-6) {
    const big = Math.max(l, r), small = Math.min(l, r);
    if (small <= 1e-6 || (big - small) / big >= K16.mirrorMinTravel) return l > r ? "left" : "right";
  }
  return (S.dom === "left" || S.dom === "right") ? S.dom : null;
}

/**
 * Mirror the arm motion? Only when both models are side-CONFIDENT and the donor's firing arm is the
 * other side from the target's own weapon side. A LOW-confidence target never mirrors (mirror-safe).
 */
export function shouldMirror(T, S, source, clip, lo, hi) {
  if (T.sc === "low" || S.sc === "low") return false;
  const td = T.dom;
  if (td !== "left" && td !== "right") return false;
  const sd = k16FiringSide(S, source, lo, hi);
  return !!sd && sd !== td;
}

/** Bounded analytic two-bone IK: shoulder S0, wanted tip H, link lengths a (S0..elbow) and b.
 *  `hint` is the current elbow direction and `plane` the previous frame's bend direction: near a
 *  straight limb the bend plane is undefined, and without continuity the knee/elbow pops sideways. */
function k16TwoBone(S0, H, a, b, hint, plane = null) {
  const d0 = k16sub(H, S0);
  const d = k16norm(d0);
  const maxR = (a + b) * K16.reachSlack;
  const minR = Math.abs(a - b) * 1.02 + 1e-6;
  const dist = Math.min(maxR, Math.max(minR, d));
  const u = d > 1e-9 ? k16scale(d0, 1 / d) : [0, 1, 0];
  const angle = (a * a + dist * dist - b * b) / (2 * a * dist);
  // a limb that reaches its target nearly straight has NO defined bend plane: solving it with the
  // cosine law there picks an arbitrary plane and the elbow pops sideways between frames, so it is
  // solved as a straight chain instead (one rotation, no knee/elbow).
  if (angle >= 0.995 || dist >= (a + b) * 0.995) {
    return {
      elbow: [S0[0] + a * u[0], S0[1] + a * u[1], S0[2] + a * u[2]],
      tip: [S0[0] + dist * u[0], S0[1] + dist * u[1], S0[2] + dist * u[2]],
      reach: d / Math.max(1e-6, a + b), clamped: Math.abs(dist - d) > 1e-6, straight: true, bendDir: null,
    };
  }
  const cosA = Math.max(-1, Math.min(1, angle));
  const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  const perpOf = (src) => (src ? k16sub(src, k16scale(u, k16dot(src, u))) : [0, 0, 0]);
  let v = perpOf(hint);
  if (k16norm(v) < 0.25 * Math.max(1e-6, k16norm(hint || [0, 0, 0]))) v = perpOf(plane);
  if (k16norm(v) < 1e-6) v = k16perp(u);
  v = k16scale(v, 1 / k16norm(v));
  return {
    elbow: [S0[0] + a * (cosA * u[0] + sinA * v[0]), S0[1] + a * (cosA * u[1] + sinA * v[1]), S0[2] + a * (cosA * u[2] + sinA * v[2])],
    tip: [S0[0] + dist * u[0], S0[1] + dist * u[1], S0[2] + dist * u[2]],
    reach: d / Math.max(1e-6, a + b),
    clamped: Math.abs(dist - d) > 1e-6,
    bendDir: v,
  };
}

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
  const table = src.ops.find((o) => o.op === 2 && o.words?.[0] === 0 && (o.words[2] | 0) > 1)?.words[2] | 0;
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
  const localOf = (model, pose) => model.bones.map((b, i) => {
    const p = (b.parent_slot ?? 0) - 1;
    return k16mul(k16tr(p >= 0 && p < pose.W.length ? pose.W[p] : K16_ID), pose.W[i]);
  });
  const LrestT = localOf(target, tRest), LrestD = localOf(source, sRest);
  // parents before children: a bone's world matrix is only built from its parent's
  const order = [];
  {
    const kids = Array.from({ length: T.n }, () => []);
    for (let i = 0; i < T.n; i++) {
      const p = (target.bones[i]?.parent_slot ?? 0) - 1;
      if (p >= 0 && p < T.n) kids[p].push(i);
    }
    const rootsT = [];
    for (let i = 0; i < T.n; i++) { const p = (target.bones[i]?.parent_slot ?? 0) - 1; if (p < 0 || p >= T.n) rootsT.push(i); }
    const visit = (i) => { order.push(i); for (const k of kids[i]) visit(k); };
    for (const r of rootsT) visit(r);
    for (let i = 0; i < T.n; i++) if (!order.includes(i)) order.push(i);
  }
  // One full pass over the clip. `reachMode` decides how an arm is driven (K22b rule 2):
  //   "point" — the two-bone IK solves the elbow so the hand lands on the donor's hand POINT (K16);
  //   "path"  — the elbow keeps the bend the conjugation gave it (the donor's own joint) and only the
  //             shoulder aims the chain along the donor's hand DIRECTION, so the hand travels the donor's
  //             PATH instead of chasing a point this chain cannot reach. No interior-angle solve means no
  //             reach clamp and no bend-plane flip — which is what snapped Meramon's forearm 2.08 rad.
  const pass = (reachMode) => {
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
    const posOf = (i) => {
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
    const setSubtree = (bone, R) => { for (const j of subs[bone]) Wt[j] = k16mul(R, Wt[j]); };
    // 3a. LEGS: the gate (and a planted cast) cares that a foot does not leave the ground, so the
    //     whole leg is turned about the hip until the ankle is back at the model's own rest height.
    //     A knee solve there would be hypersensitive (a nearly straight leg needs a huge knee angle for
    //     a small vertical move and the bend plane is undefined), a hip turn is one smooth angle.
    for (const p of legPairs) {
      const tipBone = p.tc[p.tc.length - 1];
      const hip = Pt[p.tc[0]], ankle = Pt[tipBone];
      const restY = tRest.P[tipBone][1];
      const lim = K16.ankleShare * H;
      const dy = ankle[1] - restY;
      if (Math.abs(dy) < lim) continue;
      const v1 = k16sub(ankle, hip);
      const v2 = [v1[0], restY + Math.sign(dy) * lim * 0.5 - hip[1], v1[2]];
      const ax = [v1[1] * v2[2] - v1[2] * v2[1], v1[2] * v2[0] - v1[0] * v2[2], v1[0] * v2[1] - v1[1] * v2[0]];
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
      const S0 = Pt[p.tc[0]];
      const cur = Pt[tipBone];
      const hand = k16scale(k16sub(sp.P[scTip], sp.P[p.sc[0]]), p.ratio);
      const want = [S0[0] + hand[0], S0[1] + hand[1], S0[2] + hand[2]];
      if (k16norm(k16sub(want, cur)) < K16.ikDeadband * H) continue;
      const E0 = Pt[p.tc[p.split]];
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
        let hinge = [u1[1] * u2[2] - u1[2] * u2[1], u1[2] * u2[0] - u1[0] * u2[2], u1[0] * u2[1] - u1[1] * u2[0]];
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
      const E1 = Pt[p.tc[p.split]];
      const v1 = k16sub(E1, S0), v2 = k16sub(want, S0);
      const ax = [v1[1] * v2[2] - v1[2] * v2[1], v1[2] * v2[0] - v1[0] * v2[2], v1[0] * v2[1] - v1[1] * v2[0]];
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
      const own2 = (b.anim?.ch2 ?? []).filter((r) => r[3] !== 30000).map((r) => r.slice());
      const ch2 = moved ? [...own2, ...moved, [moved[moved.length - 1][0], moved[moved.length - 1][1], moved[moved.length - 1][2], 30000]] : (b.anim?.ch2 ?? []);
      const anim = { ...(b.anim || {}), ch2 };
      if (wantRoot) {
        const own1 = (b.anim?.ch1 ?? []).filter((r) => r[3] !== 30000).map((r) => r.slice());
        const l1 = rootKeys[rootKeys.length - 1];
        anim.ch1 = [...own1, ...rootKeys, [l1[0], l1[1], l1[2], 30000]];
      }
      return { ...b, anim };
    }),
  };
  // the shifted playlist, exactly as the geometry bake does it (one shared shiftPlaylistEntry)
  model.timeline = (target.timeline ? target.timeline.slice() : []);
  model.timeline[table] = { table: srcTable.map((e) => shiftPlaylistEntry(e, offset)) };
  const roleBones = T.roleBones ?? [];
  const covered = roleBones.length
    ? roleBones.filter((b) => plan.map[b] >= 0).length / roleBones.length
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
function k23NeutralFrame(model) {
  let lo = Infinity;
  for (const e of model?.timeline?.[1]?.table ?? []) { const v = e?.value | 0; if (v >= 0 && v < 0x8000 && v < lo) lo = v; }
  return Number.isFinite(lo) ? lo : 0;
}
/** per-bone world centroid + vertex count + the body's normalising frame, from a pose (the renderer's flip). */
function k23Cloud(model, pose) {
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
export function bakeRetargetWorld(target, source, clip, { offset = 6000, yaw = "auto", restS = 0, restT = null, matchMax = K23.matchMax, transport = false, delta = false } = {}) {
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
  const yawOf = (deg, p) => (deg === 180 ? [-p[0], p[1], -p[2]] : p);
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
    const par = (i) => { const q = (model.bones[i]?.parent_slot ?? 0) - 1; return q >= 0 && q < m ? q : -1; };
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
  const featOf = (chain, c, P, Z, D, deg) => {
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
  const pair = (deg) => {
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

  const parentOf = (i) => { const p = (target.bones[i]?.parent_slot ?? 0) - 1; return p >= 0 && p < n ? p : -1; };
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
  const centreOf = (model, H) => model.bones.map((b) => {
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
  const weight = (s) => { const x = Math.max(0, Math.min(1, Math.min((s - lo) / ramp, (hi - s) / ramp))); return x * x * (3 - 2 * x); };
  /** the rotation `Wtarget`, reached `w` of the way from the rest rotation `Wrest` (along the shortest turn) */
  const blendRot = (Wrest, Wtarget, w) => {
    if (w >= 1) return Wtarget;
    const { axis, ang } = k16axisOf(k16mul(k16tr(Wrest), Wtarget));
    return k16mul(Wrest, k16axisAngle(axis, ang * w));
  };
  // `transport`: turn each aimed bone from where it pointed the PREVIOUS frame (a minimal step) instead of from its rest
  // direction. The shortest turn from rest has an ill-conditioned axis when a limb goes from hanging to raised (it swings
  // sideways and rolls, shoulders merge, arms cross); small steps of a planar path add no roll. Off by default.
  const tstate = new Map();
  const aimR = (key, u, dv) => {
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
  };
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

/**
 * The retarget entry point. Candidates, best first:
 *   1. the K16 role bake WITH the bounded IK reach correction,
 *   2. the same role bake WITHOUT it (a donor whose own arc needs no correction is closer to its own
 *      motion that way - and a limb the IK cannot reach without a visible pop is better left alone),
 *   3. the A6 geometry bake (rigs with no K12 bone map).
 * The A10 automatic gate is the arbiter: the first candidate it accepts is returned, so a pair is only
 * ever used when its own numbers pass. When none passes, the first candidate is returned and the caller
 * keeps the planted cast, exactly as before.
 */
export function bakeRetarget(target, source, clip, { offset = 6000, mirror = null, ...opts } = {}) {
  // A/B switch used by the K16 measurements (tools/check_cast_contract.mjs --geometry) and nothing else:
  // it reproduces the pre-K16 bake without touching any other module.
  if (typeof process !== "undefined" && process.env?.K16_MODE === "geometry") {
    const g = bakeRetargetGeometry(target, source, clip, { offset });
    if (g) { g.source = source; g.method = "geometry"; }
    return g;
  }
  const tries = [];
  const withIk = bakeRetargetByRole(target, source, clip, { offset, mirror, ik: true, ...opts });
  if (withIk) tries.push(withIk);
  const noIk = bakeRetargetByRole(target, source, clip, { offset, mirror, ik: false, ...opts });
  if (noIk) tries.push(noIk);
  const geo = bakeRetargetGeometry(target, source, clip, { offset });
  if (geo) tries.push(geo);
  if (!tries.length) return null;
  for (const t of tries) {
    t.source = source;
    const verdict = castGate(t);
    t.gate = verdict;
    t.method = t === geo ? "geometry" : (t === withIk ? "role+ik" : "role");
    if (verdict.used) return t;
  }
  return tries[0];
}

// ── A10: the CAST body, and the automatic quality gate that decides whether a pair is used ─────────────
//
// A spell on the disc is a CAST: a planted pose with the weapon raised, a projectile leaving the weapon, a
// strike. The build above already carries a model's own motion for the clips it has, but a model missing
// clip 9 has no cast of its own - its own basic attack (a lunge, a jump, a swing) is the wrong motion.
// The donor the ranker picked for that clip HAS an authored cast (its clip 9), and bakeRetarget() above can
// put the donor's ROTATION keys on this model's bones. What was missing is a way to decide, without a human
// looking at a picture, whether a given (target, donor) pair's retarget is a usable cast.
//
// castGate() is that decision, and it is arithmetic over the two skeletons and their poses:
//   coverage    the share of the target's bones the role map covers, and every limb the cast needs
//               (both arms, both legs, the weapon arm when the target carries a prop) must be mapped
//   reach       per limb, the tip-to-root distance over the clip against the donor's, scaled by height: a
//               retarget that swings a limb far outside the donor's own envelope is not the same motion
//   crossing    an arm/leg tip never crosses the body's centre line (a joint that folds through the torso)
//   speed       per mapped bone, the per-frame rotation step stays within the donor's own (× a bound)
//   planted     the ankle drift stays inside the donor's drift, scaled
//   return      the last pose is close to the model's own rest pose, so the clip ends without a snap
//   motion      the pose leaves the rest pose by a share of the donor's own motion energy (a cast that
//               froze is not a cast)
// A pair that fails ANY metric is not used: the caller keeps the planted own-body cast (clip-fallback.js).
// The thresholds are constants here, not per-pair data; the printout (tools/check_cast_contract.mjs) names
// each metric so a failing row says WHY, and tuning them tunes the gate for every pair at once.
export const CAST_GATE = {
  minCovered: 0.55,      // share of the target's bones with a mapped donor bone
  handLo: 0.20,          // the casting hand/prop travel vs the donor's own, scaled by height
  handHi: 8.00,
  energyLo: 0.25,        // whole-body travel (sum over mapped bones) vs the donor's, scaled
  energyHi: 3.50,
  speedRatio: 2.50,      // per-frame rotation step vs the donor's, same bone, same tick
  speedFloor: 0.25,      // rad: a small absolute step is allowed even when the donor's own joint is still
                         // (a rest-frame retarget legitimately moves a joint the donor holds; the ratio
                         // alone would reject every pair for a correction a player cannot see)
  foldCos: -0.90,        // a joint never folds back onto its own parent segment
  ankleShare: 0.10,      // share of the body height the ankles may travel
  returnGap: 2.60,       // radians between the clip's last pose and the model's rest pose
  motionShare: 0.35,     // share of the donor's motion energy the retarget must keep
  samples: 12,
};

const TAU_R = (Math.PI * 2) / 4096;
const angOf = (ch2, frame) => sample(ch2, frame).map((v) => v * TAU_R);
const angBetween = (a, b) => {
  let d = 0;
  for (let i = 0; i < 3; i++) {
    let x = a[i] - b[i];
    while (x > Math.PI) x -= 2 * Math.PI;
    while (x < -Math.PI) x += 2 * Math.PI;
    d += x * x;
  }
  return Math.sqrt(d);
};

/**
 * The point a projectile should leave from: the terminal prop (a weapon's blade/lance/hammer head) when the
 * model carries one, else the tip of the arm on `side`. Taken at the frame where that bone is HIGHEST over
 * the clip's own frame range - a cast raises the weapon, and the highest point of the cast is where the
 * disc's own packs launch (Gallantmon's raw op6 x is his lance bone's x, y is 7424 = above the head).
 * `table` is the baked cast table on the model; without one the rest pose is used.
 */
export function handPoint(model, { table = null, side = null } = {}) {
  if (!model) return null;
  const roles = rolesOf(model);
  const own = roles.props.length
    ? (side ? (roles.props.find((p) => p.side === side) ?? roles.props[0]) : roles.props[0])
    : null;
  let bone = own ? own.bone : null;
  if (bone == null && roles.arms.length) {
    const arm = side ? (roles.arms.find((a) => a.side === side) ?? roles.arms[0]) : roles.arms[0];
    bone = arm.chain[arm.chain.length - 1];
  }
  if (bone == null) return null;
  let lo = Infinity, hi = -1;
  const tab = table != null ? model.timeline?.[table]?.table : null;
  if (Array.isArray(tab)) {
    for (const e of tab) {
      const v = e?.value | 0;
      if (v >= 0 && v < 0x8000) { if (v < lo) lo = v; if (v > hi) hi = v; }
    }
  }
  const frames = [];
  if (hi > lo) {
    for (let k = 0; k < 16; k++) frames.push(Math.round(lo + ((hi - lo) * k) / 15));
  } else frames.push(0);
  let best = null;
  for (const f of frames) {
    const p = restPose(model, f).pos[bone];
    if (!best || p[1] < best.y) best = { x: p[0], y: p[1], z: p[2], frame: f };
  }
  return best ? { ...best, bone, weapon: !!own } : null;
}

/**
 * The quality gate for one (target, donor, clip) retarget. `bake` is bakeRetarget()'s result on the target.
 * Returns every metric plus `used`: the pair's cast body is played only when `used` is true.
 */
export function castGate(bake, { samples = CAST_GATE.samples } = {}) {
  const { model: baked, roles } = bake;
  const T = roles.target, S = roles.source;
  const off = bake.offset;
  const tab = baked.timeline?.[bake.table]?.table ?? [];
  let lo = Infinity, hi = -1;
  for (const e of tab) {
    const v = e?.value | 0;
    if (v >= 0 && v < 0x8000) { if (v < lo) lo = v; if (v > hi) hi = v; }
  }
  if (!(hi > lo)) return { used: false, reason: "empty-table", covered: bake.covered };
  const frames = [];
  for (let k = 0; k < samples; k++) frames.push(Math.round(lo + ((hi - lo) * k) / (samples - 1)));

  const source = bake.source;
  if (!source) return { used: false, reason: "no-source", covered: bake.covered };
  const H = T.box.h || 1, HD = S.box.h || 1;
  const Trest = restPose(baked, 0);

  // coverage: the bones every cast needs, plus the share the map covers
  const need = [];
  for (const side of ["left", "right"]) {
    const ta = T.arms.find((a) => a.side === side), sa = S.arms.find((a) => a.side === side);
    const tl = T.legs.find((l) => l.side === side), sl = S.legs.find((l) => l.side === side);
    if (ta) need.push({ kind: "arm", side, mapped: !!sa });
    if (tl) need.push({ kind: "leg", side, mapped: !!sl });
  }
  for (const p of T.props) {
    const parent = (T.pose ? 0 : 0) + ((baked.bones[p.bone]?.parent_slot ?? 0) - 1);
    need.push({ kind: "prop", side: p.side, mapped: bake.map[p.bone] >= 0 || (parent >= 0 && bake.map[parent] >= 0) });
  }
  const missing = need.filter((r) => !r.mapped).map((r) => `${r.kind}:${r.side}`);
  const covered = bake.covered;

  // per-frame poses
  const chainOf = (roles2, kind, side) =>
    (kind === "arm" ? roles2.arms : roles2.legs).find((c) => c.side === side)?.chain ?? null;
  let speedWorst = 0, ankleDrift = 0, motionT = 0, motionS = 0, returnGap = 0;
  let folds = 0, movedBones = 0, energyT = 0, energyS = 0;
  const baseT = new Map(), baseS = new Map(), rotPrev = new Map(), rotPrevS = new Map();
  const handBone = T.props.length ? (T.props.find((p) => p.side === "right") ?? T.props[0]).bone
    : (T.arms.find((a) => a.side === "right") ?? T.arms[0])?.chain.slice(-1)[0];
  // the donor's own casting hand: its prop on the same side, else its arm tip - whichever bone the map used
  const donorHand = (S.props.find((p) => p.side === "right") ?? S.props[0])?.bone
    ?? (S.arms.find((a) => a.side === "right") ?? S.arms[0])?.chain.slice(-1)[0];
  let handT = 0, handS = 0;
  const handBaseT = [], handBaseS = [];
  for (let k = 0; k < frames.length; k++) {
    const f = frames[k], sf = f - off;
    const Tp = restPose(baked, f), Sp = restPose(source, sf);
    if (handBone != null && Tp.pos[handBone]) {
      if (!handBaseT.length) { handBaseT.push(...Tp.pos[handBone]); }
      handT = Math.max(handT, Math.hypot(Tp.pos[handBone][0] - handBaseT[0], Tp.pos[handBone][1] - handBaseT[1], Tp.pos[handBone][2] - handBaseT[2]));
      const mh = bake.map[handBone];
      if (donorHand != null && Sp.pos[donorHand]) {
        if (!handBaseS.length) handBaseS.push(...Sp.pos[donorHand]);
        handS = Math.max(handS, Math.hypot(Sp.pos[donorHand][0] - handBaseS[0], Sp.pos[donorHand][1] - handBaseS[1], Sp.pos[donorHand][2] - handBaseS[2]));
      } else if (mh >= 0 && Sp.pos[mh]) {
        if (!handBaseS.length) handBaseS.push(...Sp.pos[mh]);
        handS = Math.max(handS, Math.hypot(Sp.pos[mh][0] - handBaseS[0], Sp.pos[mh][1] - handBaseS[1], Sp.pos[mh][2] - handBaseS[2]));
      }
    }
    for (let i = 1; i < baked.bones.length; i++) {
      const m = bake.map[i];
      if (m < 0) continue;
      if (!baseT.has(i)) { baseT.set(i, Tp.pos[i]); baseS.set(i, Sp.pos[m]); }
      const b0 = baseT.get(i), s0 = baseS.get(i);
      const dt = Math.hypot(Tp.pos[i][0] - b0[0], Tp.pos[i][1] - b0[1], Tp.pos[i][2] - b0[2]);
      const ds = Math.hypot(Sp.pos[m][0] - s0[0], Sp.pos[m][1] - s0[1], Sp.pos[m][2] - s0[2]);
      if (ds > 0.01 * H) movedBones++;
      if (k === frames.length - 1) { energyT += dt; energyS += ds; }
      // a joint never folds back onto its own parent segment
      const par = (baked.bones[i].parent_slot ?? 0) - 1;
      const kids = baked.bones.map((b, j) => ((b.parent_slot ?? 0) - 1 === i ? j : -1)).filter((j) => j >= 0);
      if (par >= 0 && kids.length === 1) {
        const u = [Tp.pos[i][0] - Tp.pos[par][0], Tp.pos[i][1] - Tp.pos[par][1], Tp.pos[i][2] - Tp.pos[par][2]];
        const v = [Tp.pos[kids[0]][0] - Tp.pos[i][0], Tp.pos[kids[0]][1] - Tp.pos[i][1], Tp.pos[kids[0]][2] - Tp.pos[i][2]];
        const lu = Math.hypot(...u), lv = Math.hypot(...v);
        if (lu > 1 && lv > 1) {
          const c = (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / (lu * lv);
          if (c < CAST_GATE.foldCos) folds++;
        }
      }
      // rotation speed, same bone, same tick, against the donor
      const a = angOf(baked.bones[i].anim?.ch2, f);
      const b = angOf(source.bones[m].anim?.ch2, sf);
      const prev = rotPrev.get(i), prevS = rotPrevS.get(i);
      if (prev && prevS) speedWorst = Math.max(speedWorst, angBetween(a, prev) / Math.max(CAST_GATE.speedFloor, angBetween(b, prevS)));
      rotPrev.set(i, a);
      rotPrevS.set(i, b);
      if (k > 0) {
        motionT = Math.max(motionT, angBetween(a, angOf(baked.bones[i].anim?.ch2, lo)));
        motionS = Math.max(motionS, angBetween(b, angOf(source.bones[m].anim?.ch2, lo - off)));
      }
    }
    // feet: the ankle's travel against its own rest height
    for (const side of ["left", "right"]) {
      const tc = chainOf(T, "leg", side);
      if (!tc) continue;
      ankleDrift = Math.max(ankleDrift, Math.abs(Tp.pos[tc[tc.length - 1]][1] - Trest.pos[tc[tc.length - 1]][1]));
    }
    // return gap: last pose against the model's own rest pose
    if (k === frames.length - 1) {
      for (let i = 1; i < baked.bones.length; i++) {
        if (bake.map[i] < 0) continue;
        returnGap = Math.max(returnGap, angBetween(angOf(baked.bones[i].anim?.ch2, f), angOf(baked.bones[i].anim?.ch2, 0)));
      }
    }
  }
  const ankleShare = ankleDrift / H;
  const scale = H / HD;
  const handRatio = handS > 1 ? handT / (handS * scale) : 1;
  const energyRatio = energyS > 1 ? energyT / (energyS * scale) : 1;
  const metrics = {
    covered: +covered.toFixed(3),
    missing,
    hand: +handRatio.toFixed(2),
    energy: +energyRatio.toFixed(2),
    moved: movedBones,
    folds,
    speed: +speedWorst.toFixed(2),
    ankle: +ankleShare.toFixed(3),
    returnGap: +returnGap.toFixed(2),
    motion: +(motionT / Math.max(0.02, motionS)).toFixed(2),
  };
  const reasons = [];
  if (missing.length) reasons.push(`unmapped(${missing.join(",")})`);
  if (covered < CAST_GATE.minCovered) reasons.push("coverage");
  if (handRatio > CAST_GATE.handHi || handRatio < CAST_GATE.handLo) reasons.push("hand");
  if (energyRatio > CAST_GATE.energyHi || energyRatio < CAST_GATE.energyLo) reasons.push("energy");
  if (folds > 0) reasons.push("fold");
  if (speedWorst > CAST_GATE.speedRatio) reasons.push("speed");
  if (ankleShare > CAST_GATE.ankleShare) reasons.push("ankle");
  if (returnGap > CAST_GATE.returnGap) reasons.push("return");
  if (metrics.motion < CAST_GATE.motionShare) reasons.push("motion");
  return { used: reasons.length === 0, reasons, ...metrics };
}

/**
 * Retarget `clip`'s body table from `source` onto `target` IN PLACE (the live model object the renderer
 * draws) when the gate passes. Adds the baked table at a free index and returns { table, offset, gate };
 * null when the pair's retarget is not used (the caller keeps the planted own-body cast).
 * The bake is memory only: the model object is a per-load copy, never written to disk.
 */
export function applyCastBake(target, source, clip, { offset = null } = {}) {
  const from = Math.max(0, (target.timeline?.length ?? 0));
  let table = Math.max(62, from);
  while (target.timeline?.[table]?.table) table++;
  const off = offset ?? 6000 + 4000 * (target.__castBakes ?? 0);
  const bake = bakeRetarget(target, source, clip, { offset: off });
  if (!bake) return null;
  bake.source = source;
  const bakedTable = bake.table;
  bake.model.timeline[table] = bake.model.timeline[bakedTable];
  bake.table = table;
  const gate = castGate(bake);
  if (!gate.used) return { table: null, offset: off, gate };
  // write the bake onto the live model: appended ch2 keys + the re-based playlist at `table`
  for (let i = 0; i < target.bones.length; i++) {
    const b = bake.model.bones[i];
    if (b !== target.bones[i]) target.bones[i] = b;
  }
  if (!target.timeline) target.timeline = [];
  target.timeline[table] = bake.model.timeline[bakedTable];
  target.__castBakes = (target.__castBakes ?? 0) + 1;
  return { table, offset: off, gate, map: bake.map, covered: bake.covered };
}


/**
 * The pose/rotation primitives the generic-motion generator (generic-motion.js) shares with the retarget.
 * Exported only so a second baker can use the SAME renderer-faithful arithmetic; nothing here changes behaviour.
 */
export const MOTION_KIT = {
  sample, k16Pose, k16FromCh2, k16ToCh2, k16mul, k16tr, k16mv, k16fromTo, k16axisAngle, k16axisOf,
  k23Cloud, k23NeutralFrame, shiftPlaylistEntry,
};
