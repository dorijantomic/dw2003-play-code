import type { K16Rig, RigBasicsModel, RigSampleOut } from "./types.js";
export const TAU = (Math.PI * 2) / 4096;

export function sample(ch, frame: number) {
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

function mat3Mul(a: number[], b) {
  const o = new Array(9).fill(0);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
    let s = 0; for (let k = 0; k < 3; k++) s += a[k * 3 + r]! * b[c * 3 + k];
    o[c * 3 + r] = s;
  }
  return o;
}

function ps1Mat3(ax: number, ay: number, az: number) {
  const cx = Math.cos(ax * TAU), sx = Math.sin(ax * TAU);
  const cy = Math.cos(ay * TAU), sy = Math.sin(ay * TAU);
  const cz = Math.cos(az * TAU), sz = Math.sin(az * TAU);
  const Rz = [cx, sx, 0, -sx, cx, 0, 0, 0, 1];
  const Ry = [cy, 0, -sy, 0, 1, 0, sy, 0, cy];
  const Rx = [1, 0, 0, 0, cz, sz, 0, -sz, cz];
  return mat3Mul(Rz, mat3Mul(Ry, Rx));
}

function compose(a: number[], b) {
  const o = new Array(9).fill(0);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    let s = 0; for (let k = 0; k < 3; k++) s += a[k * 3 + j]! * b[i * 3 + k];
    o[i * 3 + j] = s;
  }
  return o;
}

function applyRot(R: number[], v) {
  return [R[0]! * v[0] + R[3]! * v[1] + R[6]! * v[2],
          R[1]! * v[0] + R[4]! * v[1] + R[7]! * v[2],
          R[2]! * v[0] + R[5]! * v[1] + R[8]! * v[2]];
}

/** Rest-pose world position/rotation per bone (the renderer's own formula, battle3d.js buildBoneWorldMatrices). */
export function restPose(model, frame = 0) {
  const n = model.num_bones ?? model.bones.length;
  const rot = new Array(n).fill(null), pos = new Array(n).fill(null);
  const proc = (i: number) => {
    const b = model.bones[i], anim = b.anim || {};
    const c2 = sample(anim.ch2, frame), c1 = sample(anim.ch1, frame);
    const R = ps1Mat3(c2[2], c2[1], c2[0]);
    const p = (b.parent_slot ?? 0) - 1;
    if (p < 0) { rot[i] = R; pos[i] = [-c1[0], c1[1], -c1[2]]; return; }
    if (!rot[p]) proc(p);
    rot[i] = compose(rot[p], R);
    const rt = applyRot(rot[p], c1);
    pos[i] = [pos[p][0] - rt[0]!, pos[p][1] + rt[1], pos[p][2] - rt[2]!];
  };
  for (let i = 0; i < n; i++) if (!rot[i]) proc(i);
  return { rot, pos };
}

function meshBox(model, i: number, pose) {
  const b = model.bones[i], vs = b.verts || [];
  if (!vs.length) return null;
  const R = pose.rot[i], t = pose.pos[i];
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (const v of vs) {
    const x = -(R[0] * v[0] + R[3] * v[1] + R[6] * v[2]) + t[0];
    const y =  (R[1] * v[0] + R[4] * v[1] + R[7] * v[2]) + t[1];
    const z = -(R[2] * v[0] + R[5] * v[1] + R[8] * v[2]) + t[2];
    if (x < mn[0]!) mn[0] = x; if (x > mx[0]!) mx[0] = x;
    if (y < mn[1]!) mn[1] = y; if (y > mx[1]!) mx[1] = y;
    if (z < mn[2]!) mn[2] = z; if (z > mx[2]!) mx[2] = z;
  }
  return { mn, mx, d: [mx[0]! - mn[0]!, mx[1]! - mn[1]!, mx[2]! - mn[2]!] };
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
      for (let k = 0; k < 3; k++) { if (bb.mn[k]! < mn[k]!) mn[k] = bb.mn[k]; if (bb.mx[k]! > mx[k]!) mx[k] = bb.mx[k]; }
    }
    return { mn, mx, h: mx[1]! - mn[1]!, w: mx[0]! - mn[0]!, d: mx[2]! - mn[2]! };
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
    if (bb.d[0]! > 0.30 * W || bb.d[1]! > 0.35 * H) continue;
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
    if (s[0]! >= 0.45 * H && s[0]! >= 2.2 * Math.max(s[1]!, 1)) {
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
export function normaliseRoots(rig: K16Rig, model) {
  const n = rig.n ?? model.num_bones ?? model.bones.length;
  const parentOf = (i: number) => { const p = (model.bones[i]?.parent_slot ?? 0) - 1; return p >= 0 && p < n ? p : -1; };
  let roots = (rig.roots ?? []).filter((i) => i >= 0 && i < n).slice();
  if (!roots.length) { for (let i = 0; i < n; i++) if (parentOf(i) < 0) roots.push(i); }
  if (!roots.length) roots = [0];
  const under = (bone: number | undefined, root: number) => {
    let i = bone;
    for (let step = 0; step <= n && i! >= 0; step++) { if (i === root) return true; i = parentOf(i!); }
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
  else if (legsUnder.length > 1 && legsUnder.includes(storedRoot!)) root = storedRoot;
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
export function shiftPlaylistEntry(e, offset: number) {
  const v = e.value | 0;
  const out = { ...e } as RigSampleOut;
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
  const table = src.ops.find((o: { op: number; words: number[]; }) => o.op === 2 && o.words?.[0] === 0 && (o.words[2]! | 0) > 1)?.words[2] | 0;
  if (!table) return null;
  const srcTable = source.timeline?.[table]?.table;
  if (!Array.isArray(srcTable) || !srcTable.length) return null;
  const model = {
    ...target,
    bones: target.bones.map((b, i: string | number) => {
      const m = map[i];
      const srcBone = m >= 0 ? source.bones[m] : null;
      const ch2 = srcBone?.anim?.ch2;
      if (!ch2 || !ch2.length) return { ...b, anim: { ...(b.anim || {}) } };
      // keep the target's own keys (its other clips use them), then append the donor keys past `offset`
      const own = (b.anim?.ch2 ?? []).filter((r: number[]) => r[3] !== 30000).map((r) => r.slice());
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
  } as RigBasicsModel;
  // the shifted playlist: the source's frames re-based into the target's appended key range.
  model.timeline = (target.timeline ? target.timeline.slice() : []);
  model.timeline[table] = { table: srcTable.map((e) => shiftPlaylistEntry(e, offset)) };
  return { model, table, map, covered, roles: { target: T, source: S }, clip, offset };
}
