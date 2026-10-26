// dw2delta.mjs — turn a DW2 clip into a motion scene for our body by transferring EVERY paired bone's full 3-axis rotation change.
// In the repo since 2026-10-26 (from the private research prototype): paths come from ./paths.mjs, the logic is unchanged.
//   node dw2delta.mjs <map.json> <dw2 clip index> <out.motion> [--tail <file>] [--ticks 2] [--flip auto|yes|no]
// For every DW2 pose and every paired bone: the world rotation CHANGE from DW2's own standing pose (clip A frame 0), mirrored for the facing,
// is applied to OUR matching bone on top of OUR standing pose. Turn, tilt AND roll all carry over (a head that tilts sideways, a trunk that rolls).
// Positions are not copied: the feet stay planted and the hips settle through the leg rotations, exactly as the body is built.
// Output = `joint <bone> p y r` clauses, one phase per DW2 pose with `ease linear`, smoothed by the map's spring lines.
// The mirror (DW2 faces -Z, ours +Z) is CALIBRATED, not assumed: both options are tried and the one whose result follows DW2's part angles better is used.
import fs from "node:fs"; import os from "node:os";
import * as D from "./dwr.mjs";
import { RIGS, PAIRS, dw2Path, fightModule } from "./paths.mjs";
const fa = await import(fightModule("firing-axis.js"));
const [mapPath, clipS, outPath, ...rest] = process.argv.slice(2);
const opt = (k, d) => { const i = rest.indexOf(k); return i >= 0 ? rest[i + 1] : d; };
// --slow "39-45:5,10-14:4" = ticks per pose for those pose ranges (the rest use --ticks)
const SLOW = (opt("--slow", "") || "").split(",").filter(Boolean).map((x) => { const [r, t] = x.split(":"); const [a, b] = r.split("-").map(Number); return { a, b: b ?? a, t: +t }; });
const SWING = +opt("--swing", 15);   // dir mode: a bone is AIMED only if, in DW2, its direction relative to its parent turns by more than this many degrees during the clip (a limb); a rigid prop keeps the world-change method
const DIRGAP = +opt("--dirgap", 30);   // dir mode: a bone is AIMED only where its idle direction differs from DW2's by more than this many degrees; elsewhere it keeps the world-change method (props, cannons)
const MODE = opt("--mode", "dir"), GAP = +opt("--gap", 30);   // world | local | auto (local = copy the JOINT bend relative to the parent where the idle poses differ by more than --gap degrees)
const TPP = +opt("--ticks", 2), tailFile = opt("--tail", null), flipOpt = opt("--flip", "auto");
// opt-in, OFF by default (2026-10-23, one species at a time): --hiptravel on = move our body sideways/forward with DW2's planted feet so a stance foot stays where DW2's stays; --leafroll on = also match the ROLL (palm direction) of hands/claws; --flip rule = mirror is the opposite of the pairing's flipDw2 (150 of 154 clips picked the lower error)
const HIPTRAVEL = opt("--hiptravel", "off") === "on", LEAFROLL = opt("--leafroll", "off") === "on";
const M = JSON.parse(fs.readFileSync(mapPath, "utf8"));
const src = JSON.parse(fs.readFileSync(dw2Path(M.dw2.id), "utf8"));
const DEG = Math.PI / 180, F = D.FLIP;
const toRows = (r) => [[r[0], r[3], r[6]], [r[1], r[4], r[7]], [r[2], r[5], r[8]]];   // firing-axis poseFromChannels().rot is COLUMN-major: read it as columns (was read as rows: the inverse rotation in the wrong frame)
const mul = D.mul, tr = D.tr;
// ── DW2: world rotation of every bone per pose, and the rest ─────────────────────────────────
const tableOf = (c) => src.actions[c].ops.find((o) => o.op === 2 && o.words?.[0] === 0 && (o.words[2] | 0) > 1)?.words[2] ?? src.clips[c].table;
const framesOf = (c) => src.timeline[tableOf(c)].table.map((e) => e.value).filter((v) => v >= 0 && v < 0x8000);
const restF = Math.min(...src.timeline[0].table.map((e) => e.value).filter((v) => v >= 0 && v < 0x8000));
const clipFr = framesOf(+clipS), lo = Math.min(...clipFr), hi = Math.max(...clipFr);
const rotsAt = (f) => { const P = fa.poseFromChannels(src, f); return { rot: P.rot.map(toRows), pos: P.pos }; };
const dwRest = rotsAt(restF);
const dwPoses = []; for (let f = lo; f <= hi; f++) dwPoses.push(rotsAt(f));
// ── DW2 data de-glitch: a bone that jumps > 100 deg for ONE pose and comes straight back is a flip in the converted data (Triceramon's head and jaw), not a motion.
// Such a pose is replaced by the neighbours' average (every bone: rotation by quaternion mid-point, position by mean). Counted and printed.
const angM = (A, B) => { let tr = 0; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) tr += A[i][j] * B[i][j]; return Math.acos(Math.max(-1, Math.min(1, (tr - 1) / 2))) * 180 / Math.PI; };
let fixedPoses = 0;
for (let k = 1; k + 1 < dwPoses.length; k++) {
  let glitch = false;
  for (let b = 0; b < src.bones.length && !glitch; b++) glitch = angM(dwPoses[k - 1].rot[b], dwPoses[k].rot[b]) > 100 && angM(dwPoses[k].rot[b], dwPoses[k + 1].rot[b]) > 100 && angM(dwPoses[k - 1].rot[b], dwPoses[k + 1].rot[b]) < 40;
  if (!glitch) continue;
  const a = dwPoses[k - 1], c = dwPoses[k + 1];
  dwPoses[k] = { rot: a.rot.map((R, b) => D.quatToMat(D.slerpQ(D.matToQuat(R), D.matToQuat(c.rot[b]), 0.5))), pos: a.pos.map((P, b) => [0, 1, 2].map((i) => (P[i] + c.pos[b][i]) / 2)) };
  fixedPoses++;
}
globalThis.__deglitched = fixedPoses;
// ── ours ────────────────────────────────────────────────────────────────────────────────────
const body = D.loadBody(M.ours.folder, { facing: String(M.ours.facing ?? 0) });
if (M.ours.contact) body.contact = M.ours.contact;
const pairs = M.pairs;                                              // [[ours bone, dw2 bone], ...]
const order = body.order ?? pairs.map((p) => p[0]);
const ordered = [...pairs].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]));
const mk = (joints) => { const p = D.blankPose(body); p.plant = 0; p.joint = joints; return p; };
// euler(p, y, r) = Ry(y) Rz(r) Rx(-p) (dwr.mjs) -> invert
const toEuler = (R) => {
  const y = Math.atan2(-R[2][0], R[0][0]);
  const c = Math.cos(y), s = Math.sin(y);
  const Mx = [[c * R[0][0] - s * R[2][0], c * R[0][1] - s * R[2][1], c * R[0][2] - s * R[2][2]],
    [R[1][0], R[1][1], R[1][2]],
    [s * R[0][0] + c * R[2][0], s * R[0][1] + c * R[2][1], s * R[0][2] + c * R[2][2]]];   // Ry(-y) R
  const r = Math.atan2(Mx[1][0], Mx[0][0]);
  const a = Math.atan2(Mx[2][1], Mx[2][2]);
  return { p: -a / DEG, y: y / DEG, r: r / DEG };
};
const angDiff = (a, b) => { let d = a - b; while (d > 180) d -= 360; while (d < -180) d += 360; return d; };
const near = (v, ref) => ref == null ? v : ref + angDiff(v, ref);
// check the decomposition against the solver's own euler
{ const t = { p: 20, y: -35, r: 50 }; const R = D.euler(t.p, t.y, t.r); const e = toEuler(R); const R2 = D.euler(e.p, e.y, e.r);
  let m = 0; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) m = Math.max(m, Math.abs(R[i][j] - R2[i][j]));
  if (m > 1e-6) throw new Error("euler round trip failed " + m); }
// ── one pose -> joint requests ──────────────────────────────────────────────────────────────
const mapDelta = (Dd, flip) => (flip ? mul(F, mul(Dd, F)) : Dd);
const partnerOf = new Map(pairs.map(([o, d]) => [o, d]));
const ATLAS = JSON.parse(fs.readFileSync(RIGS, "utf8")).models[M.ours.folder];
const roleOfBone = new Map((ATLAS?.boneList || []).map((b) => [b.i, b.r]));
const LIMB = new Set(["shoulder", "upper-arm", "forearm", "hand", "thigh", "shin", "foot", "wing-root", "wing-seg", "wing-tip", "tail-base", "tail-seg", "tail-tip", "tentacle"]);
const pairedChild = new Map();                 // our bone -> our first paired child
for (const [o] of pairs) { const q = body.par[o]; if (q >= 0 && partnerOf.has(q) && !pairedChild.has(q)) pairedChild.set(q, o); }
const facingFlip = !!M.flipDw2;
const mapPos = (v) => (facingFlip ? [-v[0], v[1], -v[2]] : v);
const unit3 = (a) => { const l = Math.hypot(...a) || 1; return a.map((x) => x / l); };
const dwParent = (d) => (src.bones[d].parent_slot | 0) - 1;
const angOf = (R) => Math.acos(Math.max(-1, Math.min(1, (R[0][0] + R[1][1] + R[2][2] - 1) / 2))) / DEG;
const idleGap = (ob, db, flip) => angOf(mul(body.rest.W[ob], tr(flip ? mul(F, mul(dwRest.rot[db], F)) : dwRest.rot[db])));
const localOk = (ob, db) => { const po = body.par[ob]; return po >= 0 && dwParent(db) >= 0 && partnerOf.get(po) === dwParent(db); };
// the spine = the roots and the chain from the root down to the head: these keep the world-change method; everything else (limbs, wings, tail, props) is aimed
// the body core keeps the world-change method: the roots, the chain down to the atlas head, AND every bone near the body's centre line (the real head, neck, tail and spine are
// central, limbs are not). The atlas head can be wrong (a cannon, a horn), so position decides, not the atlas.
const CENTRE = +opt("--centre", 0.03);
// pairs that sit on OPPOSITE sides of the body (the hammer arm is on the left in DW2 and on the right in ours): the meaning of the pairing is right, so the DW2 motion is
// MIRRORED left-to-right for that bone instead of being copied across the body
const SXM = [[-1, 0, 0], [0, 1, 0], [0, 0, 1]];
const xTol = 0.02 * Math.max(...body.rest.P.map((p) => Math.abs(p[0])));
const sideMismatch = new Map(pairs.map(([o, d]) => { const xo = body.rest.P[o][0], xd = mapPos(dwRest.pos[d])[0]; return [o, Math.abs(xo) > xTol && Math.abs(xd) > xTol && Math.sign(xo) !== Math.sign(xd)]; }));
globalThis.__mirrored = [...sideMismatch.values()].filter(Boolean).length;
const spine = new Set(); { let b = M.ours.head; while (b != null && b >= 0) { spine.add(b); b = body.par[b]; } for (let i = 0; i < body.n; i++) if (body.par[i] < 0 || Math.abs(body.rest.P[i][0]) < CENTRE * body.H) spine.add(i); }
// how much does this segment turn RELATIVE TO ITS PARENT in DW2 over the whole clip? (a limb swings, a cannon bolted to the torso does not)
// a mirror twin of a spine bone (same parent, same mesh, mirrored x) is treated the same way: both cannons on a head, both horns, both ears get ONE method
for (const b of [...spine]) {
  const p = body.par[b]; if (p < 0) continue;
  for (let t = 0; t < body.n; t++) {
    if (t === b || spine.has(t) || body.par[t] !== p) continue;
    const vb = body.model.bones[b].verts?.length || 0, vt = body.model.bones[t].verts?.length || 0, xb = body.rest.P[b][0], xt = body.rest.P[t][0];
    if (vb && vb === vt && Math.abs(xb + xt) <= 0.25 * Math.max(Math.abs(xb), Math.abs(xt)) + 1e-6 && Math.abs(xb) > 1e-6) spine.add(t);
  }
}
const swingOf = (ob) => {
  const oc = pairedChild.get(ob), db = partnerOf.get(ob), dc = partnerOf.get(oc), pd = dwParent(db);
  const loc = (pos, rot) => { const v = [0, 1, 2].map((i) => pos[dc][i] - pos[db][i]); if (pd < 0) return unit3(v); const R = rot[pd]; return unit3([0, 1, 2].map((r) => R[0][r] * v[0] + R[1][r] * v[1] + R[2][r] * v[2])); };   // R^T v
  const r0 = loc(dwRest.pos, dwRest.rot); let worst = 0;
  for (const P of dwPoses) { const r = loc(P.pos, P.rot); worst = Math.max(worst, Math.acos(Math.max(-1, Math.min(1, r0[0] * r[0] + r0[1] * r[1] + r0[2] * r[2]))) * 180 / Math.PI); }
  return worst;
};
// leaf parts (hands, claws, tail tips): no paired child, so no segment direction. Their POINTING direction = from the bone origin to the centre of its mesh (the way the claws point). Aim it where DW2's points,
// by the shortest arc from our idle orientation (same method as the limb segments), but only where the two meshes point alike at rest (<= LEAFGAP deg): different mesh conventions would turn the part the wrong way.
const LEAFDIR = opt("--leafdir", "on") !== "off" && !process.env.LEAFDIR_OFF, LEAFGAP = +opt("--leafgap", 45);
const meanV = (vs) => { const m = [0, 0, 0]; for (const v of vs) for (let a = 0; a < 3; a++) m[a] += v[a]; return m.map((x) => x / Math.max(1, vs.length)); };
const rowsMul = (R, v) => [0, 1, 2].map((i) => R[i][0] * v[0] + R[i][1] * v[1] + R[i][2] * v[2]);
const vis = (v) => [-v[0], v[1], -v[2]];   // matrix frame (W * v, poseFromChannels) -> the VISUAL frame the aiming works in (verified: hand_dir.mjs measures the matrix frame)
const leafVec = new Map();
for (const [ob, db] of pairs) {
  if (pairedChild.has(ob) || (spine.has(ob) && !process.env.LEAFSPINE) || (M.ours.contact || []).includes(ob)) continue;
  const vo = body.model.bones[ob].verts, vd = src.bones[db].verts; if (!vo?.length || !vd?.length) continue;
  const mO = meanV(vo), mD = meanV(vd), cur0 = unit3(vis(rowsMul(body.rest.W[ob], mO))), raw = unit3(vis(rowsMul(dwRest.rot[db], mD)));
  // which way is DW2's rotation frame turned for THIS part? (it differs between species and even between left/right bones): try raw, x+z negated, x negated, z negated; the one that agrees with our idle pose wins (raw unless another is better by > 10 deg)
  const SG = [[1, 1], [-1, -1], [-1, 1], [1, -1]], gp = SG.map(([sx, sz]) => Math.acos(Math.max(-1, Math.min(1, cur0[0] * sx * raw[0] + cur0[1] * raw[1] + cur0[2] * sz * raw[2]))) / DEG);
  let bi = 0; for (let c = 1; c < 4; c++) if (gp[c] < gp[bi] - 10) bi = c;
  if (gp[bi] <= LEAFGAP) leafVec.set(ob, { mD, cur0, sx: SG[bi][0], sz: SG[bi][1] });
}
globalThis.__leafDir = leafVec.size;
if (process.env.DBGL) console.error("leafdir bones:", [...leafVec.keys()].join(","));
const modeCache = new Map();
const modeOf = (ob, db, flip) => {
  if (MODE !== "dir") return MODE === "world" ? "world" : (localOk(ob, db) && (MODE === "local" || idleGap(ob, db, flip) > GAP) ? "local" : "world");
  if (modeCache.has(ob)) return modeCache.get(ob);
  let m;
  if (process.env.LEAFSPINE && leafVec.has(ob)) m = "leafdir"; else if (spine.has(ob)) m = "world";
  else if (!process.env.NOFOOTW && (M.ours.contact || []).includes(ob) && !pairedChild.has(ob)) m = "world";   // a foot that stands on the floor takes DW2's foot orientation in the WORLD (not its bend on our differently aimed shin)
  else if (pairedChild.has(ob)) m = swingOf(ob) > SWING ? "dir" : "world";
  else if (LEAFDIR && leafVec.has(ob)) m = "leafdir";
  else { const po = body.par[ob]; m = localOk(ob, db) && po >= 0 && modeOf(po, partnerOf.get(po), flip) === "dir" ? "local" : "world"; }   // a leaf follows its parent's way
  modeCache.set(ob, m); return m;
};
// bones of ours with no partner that stand on the floor (an unpaired foot) stay flat in the world
const floorFeet = (M.ours.contact || []).filter((b) => !partnerOf.has(b));
function solveJoints(k, flip, prevJ) {
  const joints = {}, targets = {};
  for (const [ob, db] of [...ordered, ...floorFeet.map((b) => [b, null])].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))) {
    let Wt;
    const mo = db == null ? "flat" : modeOf(ob, db, flip);
    if (mo === "flat") {
      Wt = body.rest.W[ob];                                              // an unpaired foot keeps its idle orientation in the world: it stays flat
    } else if (mo === "dir") {
      // aim this segment where DW2's segment points (in the body's own frame, turned for facing); twist stays as in our idle
      const oc = pairedChild.get(ob), dc = partnerOf.get(oc);
      let tgt = unit3(mapPos([0, 1, 2].map((a) => dwPoses[k].pos[dc][a] - dwPoses[k].pos[db][a]))); if (sideMismatch.get(ob)) tgt = [-tgt[0], tgt[1], tgt[2]];
      const cur0 = unit3([0, 1, 2].map((a) => body.rest.P[oc][a] - body.rest.P[ob][a]));
      const S = D.fromTo(cur0, tgt);
      Wt = mul(mul(F, mul(S, F)), body.rest.W[ob]);
    } else if (mo === "leafdir") {
      const lv = leafVec.get(ob); let tgt = unit3(vis(rowsMul(dwPoses[k].rot[db], lv.mD))); tgt = [lv.sx * tgt[0], tgt[1], lv.sz * tgt[2]];
      Wt = mul(mul(F, mul(D.fromTo(lv.cur0, tgt), F)), body.rest.W[ob]);
      if (LEAFROLL) {
        // the pointing is set; now the ROLL about it. Full DW2 orientation change (same frame choice as the pointing), expressed on our idle; E = what is still missing; keep only its twist about the pointing axis
        const Sm = [[lv.sx, 0, 0], [0, 1, 0], [0, 0, lv.sz]], Dd = mul(dwPoses[k].rot[db], tr(dwRest.rot[db])), Wfull = mul(mul(Sm, mul(Dd, Sm)), body.rest.W[ob]);
        const q = D.matToQuat(mul(Wfull, tr(Wt))), ax = [-tgt[0], tgt[1], -tgt[2]];   // pointing axis in the matrix frame (F * visual)
        let th = 2 * Math.atan2(q[1] * ax[0] + q[2] * ax[1] + q[3] * ax[2], q[0]); if (th > Math.PI) th -= 2 * Math.PI; if (th < -Math.PI) th += 2 * Math.PI;
        Wt = mul(mul(F, mul(D.rot(tgt, th), F)), Wt);
      }
    } else if (mo === "local") {
      // the JOINT bend: how this bone turns relative to its parent in DW2 (in the bone's own frame), applied on top of OUR parent's current pose and OUR rest joint
      const pd = dwParent(db), po = body.par[ob];
      const Ldr = mul(tr(dwRest.rot[pd]), dwRest.rot[db]), Ldt = mul(tr(dwPoses[k].rot[pd]), dwPoses[k].rot[db]);
      let C = mul(tr(Ldr), Ldt); if (flip) C = mul(F, mul(C, F)); if (sideMismatch.get(ob)) C = mul(SXM, mul(C, SXM));
      const Wp = D.solvePose(body, mk(joints)).W[po];
      const Lo = mul(tr(body.rest.W[po]), body.rest.W[ob]);
      Wt = mul(Wp, mul(Lo, C));
    } else {
      const Dd = mul(dwPoses[k].rot[db], tr(dwRest.rot[db]));          // DW2 world change from its own rest (channel frame)
      let Dt = mapDelta(Dd, process.env.WORLDFLIP === "facing" ? facingFlip : flip); if (sideMismatch.get(ob)) Dt = mul(SXM, mul(Dt, SXM));
      Wt = mul(Dt, body.rest.W[ob]);                                      // where our bone should end up
    }
    targets[ob] = Wt;
    const W0 = D.solvePose(body, mk(joints)).W[ob];                   // our bone with everything above it already posed, and no turn of its own
    const Rv = mul(F, mul(mul(Wt, tr(W0)), F));                       // the extra visual turn that brings it to Wt
    const e = toEuler(Rv);
    joints[ob] = { p: near(e.p, prevJ?.[ob]?.p), y: near(e.y, prevJ?.[ob]?.y), r: near(e.r, prevJ?.[ob]?.r) };
  }
  return { joints, targets };
}
// ── calibration of the mirror: which option follows DW2's part heights/angles better at the most extreme poses ──
const dwHead = M.dw2.head, ourHead = M.ours.head;
const upOf = (P, i) => P[i][1];
const calib = (flip) => {
  let err = 0;
  for (const k of [Math.round(dwPoses.length * 0.25), Math.round(dwPoses.length * 0.66)]) {
    const { joints } = solveJoints(k, flip, null);
    const out = D.solvePose(body, mk(joints)), W = out.W;
    for (const [ob] of ordered) { const Dd = mul(dwPoses[k].rot[pairs.find((p) => p[0] === ob)[1]], tr(dwRest.rot[pairs.find((p) => p[0] === ob)[1]])); const Wt = mul(mapDelta(Dd, flip), body.rest.W[ob]);
      const R = mul(W[ob], tr(Wt)); const ang = Math.acos(Math.max(-1, Math.min(1, (R[0][0] + R[1][1] + R[2][2] - 1) / 2))) / DEG; err += ang; }
  }
  return err;
};
let flip = flipOpt === "yes" ? true : flipOpt === "no" ? false : flipOpt === "rule" ? !M.flipDw2 : null;
if (flipOpt === "rule") console.log(`mirror by rule (not flipDw2 = ${!M.flipDw2}) -> flip=${flip}`);
if (flip === null) {
  // Try both mirrors; keep the one under which OUR bones move the way DW2's do. For a set of extreme poses, compare for every paired bone the displacement of its
  // origin from the idle (in body heights) with DW2's displacement, turned into our frame when DW2 faces the other way (the pairing found that).
  const facingFlip = !!M.flipDw2;
  const extent = (P) => { let lo = 1e9, hi = -1e9; for (const p of P) { lo = Math.min(lo, p[1]); hi = Math.max(hi, p[1]); } return Math.max(1, hi - lo); };
  const Hd = extent(dwRest.pos), Ho = extent(body.rest.P);
  const err = (fl) => { let e = 0, n = 0;
    for (const k of [0.25, 0.45, 0.6, 0.8].map((f) => Math.round((dwPoses.length - 1) * f))) {
      const P = D.solvePose(body, mk(solveJoints(k, fl, null).joints)).P;
      for (const [ob, db] of pairs) {
        const d = [0, 1, 2].map((a) => (dwPoses[k].pos[db][a] - dwRest.pos[db][a]) / Hd);
        const want = facingFlip ? [-d[0], d[1], -d[2]] : d, got = [0, 1, 2].map((a) => (P[ob][a] - body.rest.P[ob][a]) / Ho);
        e += Math.hypot(want[0] - got[0], want[1] - got[1], want[2] - got[2]); n++; } }
    return e / n; };
  const eT = err(true), eF = err(false); flip = eT < eF; globalThis.__dispErr = Math.min(eT, eF);
  console.log(`mirror calibration (bone displacement vs DW2, mean over poses): mirror ${eT.toFixed(3)}, no mirror ${eF.toFixed(3)} -> flip=${flip}`);
}
// ── all poses ───────────────────────────────────────────────────────────────────────────────
// hips: DW2 does not plant its feet, its root bones travel (down on a hit, up on a hop). Follow that travel (in body heights) and only LIFT our body if a foot would sink;
// pulling the body down onto the floor (old behaviour, --hips ground) sank it 0.3-1.7 body heights below the floor on 168 clips.
const HdBody = (() => { let lo = 1e9, hi = -1e9; src.bones.forEach((b, i) => { for (const v of b.verts || []) { const y = dwRest.rot[i][1][0] * v[0] + dwRest.rot[i][1][1] * v[1] + dwRest.rot[i][1][2] * v[2] + dwRest.pos[i][1]; lo = Math.min(lo, y); hi = Math.max(hi, y); } }); return Math.max(1, hi - lo); })();
const HIPS = opt("--hips", "follow"), FLOOR = opt("--floor", "clamp") !== "off", LIFTCAP = +opt("--liftcap", 0.3), CLAMPMAX = +opt("--clampmax", 40), TOL = 0.01 * body.H;
const hipDy = (() => {
  const ext = (P) => { let lo = 1e9, hi = -1e9; src.bones.forEach((b, i) => { for (const v of b.verts || []) { const y = P.rot[i][1][0] * v[0] + P.rot[i][1][1] * v[1] + P.rot[i][1][2] * v[2] + P.pos[i][1]; lo = Math.min(lo, y); hi = Math.max(hi, y); } }); return Math.max(1, hi - lo); };
  const Hd = ext(dwRest), roots = pairs.filter(([ob]) => body.model.bones[ob].parent_slot === 0).map((p) => p[1]);
  const use = roots.length ? roots : [pairs[0][1]];
  return dwPoses.map((P) => use.reduce((s, db) => s + (P.pos[db][1] - dwRest.pos[db][1]) / Hd, 0) / use.length);
})();
// the pose as the game will show it: joints + hip travel + lift-only grounding (used by the floor clamp below)
// feet DW2 has ON ITS FLOOR at each pose (the foot's lowest vertex within 0.03 body heights of its idle floor): our paired foot stands on its floor too (DW2 hips drop by a fraction of ITS leg, our legs are longer)
const PLANT = opt("--plant", "on") !== "off";
const anchors = (() => {
  const feet = (M.ours.contact || []).filter((b) => partnerOf.has(b)), low = (P, db) => { let hi = -1e9; for (const v of src.bones[db].verts || []) hi = Math.max(hi, P.rot[db][1][0] * v[0] + P.rot[db][1][1] * v[1] + P.rot[db][1][2] * v[2] + P.pos[db][1]); return hi; };
  let lo = 1e9, hi = -1e9; src.bones.forEach((b, i) => { for (const v of b.verts || []) { const y = dwRest.rot[i][1][0] * v[0] + dwRest.rot[i][1][1] * v[1] + dwRest.rot[i][1][2] * v[2] + dwRest.pos[i][1]; lo = Math.min(lo, y); hi = Math.max(hi, y); } });
  const Hd = Math.max(1, hi - lo);
  return dwPoses.map((P) => (PLANT ? feet.filter((b) => (low(dwRest, partnerOf.get(b)) - low(P, partnerOf.get(b))) / Hd < 0.03) : []));
})();
// --hiptravel only (2026-10-25, Woodmon: 4 legs + 2 arms were 10 "stance feet"): a stance foot is a contact bone with no contact bone below it (the shin of a leg whose foot is listed is not a second foot),
// whose DW2 partner's lowest point is ON DW2's idle floor at that pose (within 3% of DW2's height), not merely "no higher than its own idle" (a hanging hand never rises either)
const stance = (() => {
  if (!HIPTRAVEL) return null;
  const C = M.ours.contact || [], below = (b) => C.some((c) => c !== b && (() => { for (let p = body.par[c]; p >= 0; p = body.par[p]) if (p === b) return true; return false; })());
  const lowD = (P, db) => { let hi = -1e9; for (const v of src.bones[db].verts || []) hi = Math.max(hi, P.rot[db][1][0] * v[0] + P.rot[db][1][1] * v[1] + P.rot[db][1][2] * v[2] + P.pos[db][1]); return hi; };
  let lo = 1e9, fl = -1e9; src.bones.forEach((b, i) => { for (const v of b.verts || []) { const y = dwRest.rot[i][1][0] * v[0] + dwRest.rot[i][1][1] * v[1] + dwRest.rot[i][1][2] * v[2] + dwRest.pos[i][1]; lo = Math.min(lo, y); fl = Math.max(fl, y); } });
  const Hd = Math.max(1, fl - lo), leaves = new Set(C.filter((b) => !below(b)));
  // the floor as the feet see it: the lowest paired contact at DW2's idle (DW2 Andromon's feet sit 0.04 H above its lowest vertex, so the whole-body lowest point is not their floor)
  { let f2 = -1e9; for (const b of C) if (partnerOf.has(b)) f2 = Math.max(f2, lowD(dwRest, partnerOf.get(b))); if (f2 > -1e9) fl = f2; }
  return anchors.map((a, k) => a.filter((b) => leaves.has(b) && Math.abs(fl - lowD(dwPoses[k], partnerOf.get(b))) / Hd < 0.03));   // abs: a part driven under the floor (Woodmon's slam, hands -0.14 H) is a hit, not a stance
})();
// how deep DW2's OWN lowest vertex sits under its idle floor at each pose (its height units): a fall or a tumble sinks in DW2 as well, so our body may sink that much (and no more) before it is lifted
const sinkOK = (() => {
  const low = (P) => { let hi = -1e9; src.bones.forEach((b, i) => { for (const v of b.verts || []) hi = Math.max(hi, P.rot[i][1][0] * v[0] + P.rot[i][1][1] * v[1] + P.rot[i][1][2] * v[2] + P.pos[i][1]); }); return hi; };
  let lo = 1e9, hi = -1e9; src.bones.forEach((b, i) => { for (const v of b.verts || []) { const y = dwRest.rot[i][1][0] * v[0] + dwRest.rot[i][1][1] * v[1] + dwRest.rot[i][1][2] * v[2] + dwRest.pos[i][1]; lo = Math.min(lo, y); hi = Math.max(hi, y); } });
  const Hd = Math.max(1, hi - lo), r0 = low(dwRest);
  return dwPoses.map((P) => (PLANT ? Math.max(0, (low(P) - r0) / Hd) : 0));
})();
const hipXZ = [];   // --hiptravel: per pose [x, z] body shift in body heights (visual frame), set after the pose is solved
const mkF = (joints, k) => { const p = mk(joints); if (HIPS === "follow") { p.shift = [hipXZ[k]?.[0] ?? 0, hipDy[k] ?? 0, hipXZ[k]?.[1] ?? 0]; p.lift = 1; p.anchor = anchors[k] || []; p.anchorW = p.anchor.length ? 1 : 0; p.sink = sinkOK[k] || 0; } return p; };
globalThis.__floorBones = 0;
// -- hands: DW2's two hands keep their distance; our shoulders are narrower, so aiming the arms along DW2's directions brings our hands closer (fused hands, an X).
// Where our hand gap (body heights, + = right hand on the right) is smaller than DW2's, swing both arms outward about the vertical through the shoulder until it matches. DW2's own crossings are kept (its gap is the target).
const HANDS = opt("--hands", "spread") !== "off", HAND_TRIG = +opt("--handtrig", 0.06), HAND_MIN = +opt("--handmin", 0.15), HAND_NEAR = +opt("--handnear", 0.25);   // act only when our hands are closer than HAND_TRIG (about to fuse) and DW2 holds them apart; widen to min(DW2 gap, HAND_MIN)
globalThis.__handsSpread = 0;
const handInfo = (() => {
  try {
    const at = JSON.parse(fs.readFileSync(RIGS, "utf8")).models[M.ours.folder], hl = at.sites?.hands?.left?.bone, hr = at.sites?.hands?.right?.bone;
    const dl = partnerOf.get(hl), dr = partnerOf.get(hr);
    if (hl == null || hr == null || hl === hr || dl == null || dr == null) return null;
    const shOf = (h) => { const c = Object.values(body.chains || {}).find((ch) => ch.length >= 2 && ch[ch.length - 1] === h) || Object.values(body.chains || {}).find((ch) => ch.length >= 2 && ch.includes(h)); return c || null; };
    const chL = shOf(hl), chR = shOf(hr); if (!chL || !chR || chL[0] === chR[0]) return null;
    const shL = chL[0], shR = chR[0];
    let lo = 1e9, hi = -1e9; src.bones.forEach((b, i) => { for (const v of b.verts || []) { const y = dwRest.rot[i][1][0] * v[0] + dwRest.rot[i][1][1] * v[1] + dwRest.rot[i][1][2] * v[2] + dwRest.pos[i][1]; lo = Math.min(lo, y); hi = Math.max(hi, y); } });
    // the gap is measured between the centres of the two HAND MESHES (what is on screen), not the bone origins
    const mean = (vs) => { const m = [0, 0, 0]; for (const v of vs) for (let a = 0; a < 3; a++) m[a] += v[a]; return m.map((x) => x / Math.max(1, vs.length)); };
    const mO = { [hl]: mean(body.model.bones[hl].verts || []), [hr]: mean(body.model.bones[hr].verts || []) }, mD = { [dl]: mean(src.bones[dl].verts || []), [dr]: mean(src.bones[dr].verts || []) };
    const dx = (P, b) => -(P.rot[b][0][0] * mD[b][0] + P.rot[b][0][1] * mD[b][1] + P.rot[b][0][2] * mD[b][2]) + P.pos[b][0];   // visual frame: vertex = F*(R*v) + pos
    const ox = (W, Pp, b) => -(W[b][0][0] * mO[b][0] + W[b][0][1] * mO[b][1] + W[b][0][2] * mO[b][2]) + Pp[b][0];
    const Hd = Math.max(1, hi - lo), sd = Math.sign(dx(dwRest, dr) - dx(dwRest, dl)) || 1, s = Math.sign(ox(body.rest.W, body.rest.P, hr) - ox(body.rest.W, body.rest.P, hl)) || 1;
    const c3 = (W, Pp, b) => [0, 1, 2].map((a) => (a === 1 ? 1 : -1) * (W[b][a][0] * mO[b][0] + W[b][a][1] * mO[b][1] + W[b][a][2] * mO[b][2]) + Pp[b][a]);
    return { hl, hr, shL, shR, chL, chR, s, ox, c3, gapDw: dwPoses.map((P) => (sd * (dx(P, dr) - dx(P, dl))) / Hd) };
  } catch (e) { return null; }
})();
function spreadHands(joints, k) {
  const hi = handInfo; if (!HANDS || !hi || !joints[hi.shL] || !joints[hi.shR]) return;
  const target = Math.min(hi.gapDw[k], HAND_MIN);
  const gapOf = (J) => { const o = D.solvePose(body, mkF(J, k)); return (hi.s * (hi.ox(o.W, o.P, hi.hr) - hi.ox(o.W, o.P, hi.hl))) / body.H; };
  const g00 = gapOf(joints); if (g00 >= HAND_TRIG || g00 >= target - 0.03) return;
  { const o0 = D.solvePose(body, mkF(joints, k)), a = hi.c3(o0.W, o0.P, hi.hl), b = hi.c3(o0.W, o0.P, hi.hr); if (Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) / body.H >= HAND_NEAR) return; }   // far apart in depth or height: not fused
  // swing ONE bone of the arm (the upper arm, then the forearm) about its own joint along the shortest arc that carries the next joint OUTWARD (axis = bone->next x outward); every bone below keeps the WORLD
  // orientation DW2 gave it, so the hand keeps pointing where DW2's points and only moves sideways. First the upper arm (up to 30 deg), then the forearm (up to 60 deg).
  const turn = (J, ch, idx, side, deg) => {
    if (!deg || idx + 1 >= ch.length || !J[ch[idx]]) return J;
    const sh = ch[idx], o = D.solvePose(body, mkF(J, k)), Wnow = o.W[sh], W0 = D.solvePose(body, mk({ ...J, [sh]: { p: 0, y: 0, r: 0 } })).W[sh];
    const p = [0, 1, 2].map((a) => o.P[ch[idx + 1]][a] - o.P[sh][a]), e = [side * hi.s, 0, 0];
    let n = [p[1] * e[2] - p[2] * e[1], p[2] * e[0] - p[0] * e[2], p[0] * e[1] - p[1] * e[0]]; n = Math.hypot(...n) < 1e-6 ? [0, 0, 1] : unit3(n);
    const Wt = mul(mul(F, mul(D.rot(n, deg * DEG), F)), Wnow), ee = toEuler(mul(F, mul(mul(Wt, tr(W0)), F)));
    const J2 = { ...J, [sh]: { p: near(ee.p, J[sh].p), y: near(ee.y, J[sh].y), r: near(ee.r, J[sh].r) } };
    for (const b of ch.slice(idx + 1)) {
      if (!J2[b]) continue;
      const Wb = o.W[b], W0b = D.solvePose(body, mk({ ...J2, [b]: { p: 0, y: 0, r: 0 } })).W[b], eb = toEuler(mul(F, mul(mul(Wb, tr(W0b)), F)));
      J2[b] = { p: near(eb.p, J[b].p), y: near(eb.y, J[b].y), r: near(eb.r, J[b].r) };
    }
    return J2;
  };
  const apply = (up, fore) => turn(turn(turn(turn(joints, hi.chR, 0, 1, up), hi.chL, 0, -1, up), hi.chR, 1, 1, fore), hi.chL, 1, -1, fore);
  let best = null;
  for (let th = 2; th <= 90; th += 2) {
    const up = Math.min(th, 30), fore = Math.max(0, th - 30), J2 = apply(up, fore);
    if (process.env.DBGH) console.error(`k=${k} up=${up} fore=${fore} target=${target.toFixed(2)} gap=${gapOf(J2).toFixed(2)}`);
    best = J2;
    if (gapOf(J2) >= target - 0.01) break;
  }
  for (const b of [...hi.chR, ...hi.chL]) if (best[b]) joints[b] = best[b];
  globalThis.__handsSpread++;
}
// -- hand height relative to the head (opt-in, OFF by default, 2026-10-23, one species at a time): our head/horns are a different size and stand at a different height than DW2's, so copying where DW2's arm points
// puts the hands at another place relative to the head (Tuskmon: hands level with the horn tips where DW2's hang below them). Per pose, per arm: DW2's gap hand-centre -> head top (in DW2 body heights) is scaled by the head
// size ratio (ours/DW2, from pairing/proportions.json, or --hh-scale) and laid below OUR head top (which moves with the body bending); the upper arm is turned about the horizontal axis across it (up to --hh-max deg) to hit that height.
//   --handhead on --hh-arms "8,9,10;2,3,4" (our arm chains, shoulder first, hand last) --hh-head "1" (our bones that carry head/horns) --hh-dw2head "0" (DW2 bones that carry head/horns) [--hh-scale 1.1] [--hh-max 35]
const HH = opt("--handhead", "off") === "on", HH_MAX = +opt("--hh-max", 35), HH_NEAR = +opt("--hh-near", 0.25), HH_FAR = +opt("--hh-far", 0.45), HH_EXTRA = +opt("--hh-extra", 0), HH_MIN = +opt("--hh-min", -99);   // --hh-min G: the hand centre never rises closer than G body heights to the head top   // --hh-extra H: hang the hands this many body heights lower still (user: arms in the air in front of him must come DOWN)   // gap limits in DW2 body heights
const csv = (s) => String(s || "").split(",").filter((x) => x !== "").map(Number);
const HH_ARMS = String(opt("--hh-arms", "")).split(";").filter(Boolean).map(csv), HH_ALL = opt("--hh-head", "") === "all", HH_HEAD = csv(HH_ALL ? "" : opt("--hh-head", "")), HH_DWHEAD = csv(opt("--hh-dw2head", ""));   // --hh-head all = the highest point of everything that is not an arm (ours and DW2)
globalThis.__hhTurned = 0;
const hhInfo = (() => {
  if (!HH || !HH_ARMS.length || (!HH_ALL && (!HH_HEAD.length || !HH_DWHEAD.length))) return null;
  let sc = opt("--hh-scale", null);
  if (sc == null) { try { sc = JSON.parse(fs.readFileSync(PAIRS, "utf8")).species.find((r) => r.folder === M.ours.folder).headH; } catch (e) { sc = 1; } }
  const meanOf = (vs) => { const m = [0, 0, 0]; for (const v of vs) for (let a = 0; a < 3; a++) m[a] += v[a]; return m.map((x) => x / Math.max(1, vs.length)); };
  const dwY = (P, b, v) => P.rot[b][1][0] * v[0] + P.rot[b][1][1] * v[1] + P.rot[b][1][2] * v[2] + P.pos[b][1];
  const inSub = (b, root) => { for (let q = b; q >= 0; q = dwParent(q)) if (q === root) return true; return false; };
  const arms = HH_ARMS.map((ch) => {
    const hand = ch[ch.length - 1], dh = partnerOf.get(hand); if (dh == null) return null;
    const dRoot = dwParent(dh) >= 0 ? dwParent(dh) : dh, dSet = src.bones.map((_, i) => i).filter((i) => inSub(i, dRoot));   // DW2 hand = the palm bone and everything under it
    const dMean = dSet.map((i) => [i, meanOf(src.bones[i].verts || [])]);
    return { ch, hand, mO: meanOf(body.model.bones[hand].verts || []), dSet, dMean };
  });
  if (arms.some((a) => !a)) return null;
  const armShoulderD = HH_ARMS.map((ch) => partnerOf.get(ch[0])).filter((x) => x != null), armSetO = new Set(HH_ARMS.flat());
  const headO = HH_ALL ? Array.from({ length: body.n }, (_, i) => i).filter((i) => !armSetO.has(i)) : HH_HEAD;
  const headD = HH_ALL ? src.bones.map((_, i) => i).filter((i) => !armShoulderD.some((r) => inSub(i, r))) : HH_DWHEAD;
  const topD = (P) => { let lo = 1e9; for (const b of headD) for (const v of src.bones[b].verts || []) lo = Math.min(lo, dwY(P, b, v)); return lo; };
  const handD = (P, a) => { let s = 0, n = 0; for (const b of a.dSet) for (const v of src.bones[b].verts || []) { s += dwY(P, b, v); n++; } return s / Math.max(1, n); };
  // gap hand centre -> head top in DW2 body heights, per pose per arm (+ = hand below the head top)
  const gapDw = dwPoses.map((P) => arms.map((a) => (handD(P, a) - topD(P)) / HdBody));
  return { sc: +sc, arms, gapDw, headO };
})();
function handHeadHeight(joints, k) {
  const hi = hhInfo; if (!hi) return;
  const oy = (o, b, v) => o.W[b][1][0] * v[0] + o.W[b][1][1] * v[1] + o.W[b][1][2] * v[2] + o.P[b][1];
  const headTop = (o) => { let lo = 1e9; for (const b of hi.headO) for (const v of body.model.bones[b].verts || []) lo = Math.min(lo, oy(o, b, v)); return lo; };
  const handY = (o, a) => { let s = 0, n = 0; for (const v of body.model.bones[a.hand].verts || []) { s += oy(o, a.hand, v); n++; } return s / Math.max(1, n); };
  hi.arms.forEach((a, ai) => {
    const ch = a.ch; if (!joints[ch[0]]) return;
    const o0 = D.solvePose(body, mkF(joints, k)), tgt = headTop(o0) + Math.max(hi.gapDw[k][ai] * hi.sc + HH_EXTRA, HH_MIN) * body.H, cur = handY(o0, a);   // y grows down: the hand should hang gap below the head top
    if (Math.abs(tgt - cur) / body.H < 0.01) return;
    const wgt = Math.max(0, Math.min(1, (HH_FAR - hi.gapDw[k][ai]) / (HH_FAR - HH_NEAR)));   // the head only matters while DW2's hand is near it: full below HH_NEAR, fading to nothing at HH_FAR (hands hanging far below the head are left as DW2 has them)
    if (wgt <= 0) return;
    const goal = cur + wgt * (tgt - cur);
    if (Math.abs(goal - cur) / body.H < 0.01) return;
    const sh = ch[0], p = [0, 1, 2].map((q) => o0.P[ch[1]][q] - o0.P[sh][q]);
    let n = [-p[2], 0, p[0]]; n = Math.hypot(...n) < 1e-6 ? [0, 0, 1] : unit3(n);   // horizontal axis across the upper arm (p x up)
    const turnArm = (J, deg) => {
      const o = D.solvePose(body, mkF(J, k)), Wnow = o.W[sh], W0 = D.solvePose(body, mk({ ...J, [sh]: { p: 0, y: 0, r: 0 } })).W[sh];
      const Wt = mul(mul(F, mul(D.rot(n, deg * DEG), F)), Wnow), ee = toEuler(mul(F, mul(mul(Wt, tr(W0)), F)));
      const J2 = { ...J, [sh]: { p: near(ee.p, J[sh].p), y: near(ee.y, J[sh].y), r: near(ee.r, J[sh].r) } };
      for (const b of ch.slice(1)) {
        if (!J2[b]) continue;
        const Wb = o.W[b], W0b = D.solvePose(body, mk({ ...J2, [b]: { p: 0, y: 0, r: 0 } })).W[b], eb = toEuler(mul(F, mul(mul(Wb, tr(W0b)), F)));
        J2[b] = { p: near(eb.p, J[b].p), y: near(eb.y, J[b].y), r: near(eb.r, J[b].r) };   // the forearm and hand keep the WORLD orientation DW2 gave them
      }
      return J2;
    };
    let best = joints, bestErr = Math.abs(goal - cur);
    for (let d = 1; d <= HH_MAX; d++) for (const sg of [1, -1]) {
      const J2 = turnArm(joints, sg * d), e = Math.abs(goal - handY(D.solvePose(body, mkF(J2, k)), a));
      if (e < bestErr - 1e-6) { best = J2; bestErr = e; }
    }
    if (best !== joints) { for (const b of ch) if (best[b]) joints[b] = best[b]; globalThis.__hhTurned++; }
    if (process.env.DBGHH) console.error(`k${k} arm${ai} cur ${(cur / body.H).toFixed(3)} target ${(goal / body.H).toFixed(3)} w ${wgt.toFixed(2)} -> err ${(bestErr / body.H).toFixed(3)}`);
  });
}
const steps = []; let prevJ = null;
for (let k = 0; k < dwPoses.length; k++) {
  const { joints } = solveJoints(k, flip, prevJ);
  spreadHands(joints, k);
  handHeadHeight(joints, k);
  if (FLOOR) {
    // no free part may sink below the floor (DW2's own parts rarely do): walk the bones root-first; a part whose lowest vertex is under the floor is turned UP (about the horizontal
    // axis across its own direction) just far enough to clear it. The body core and the feet are not turned; a body that still sinks is lifted (capped).
    const skip = new Set([...(M.ours.contact || []), ...Array.from({ length: body.n }, (_, i) => i).filter((i) => body.par[i] < 0)]);
    for (const [ob] of ordered) {
      if (skip.has(ob)) continue;
      const lowOf = (J) => { const o = D.solvePose(body, mkF(J, k)); return { low: D.lowestY(body, o.W, o.P, { only: [ob] }), o }; };
      const FLK = body.floorY + (sinkOK[k] || 0) * body.H;   // the floor for this pose: DW2's own body sinks this far, so ours may
      let { low, o } = lowOf(joints); if (low - FLK <= TOL) continue;
      const oc = pairedChild.get(ob), Pt = o.P, dir = oc != null ? unit3([0, 1, 2].map((a) => Pt[oc][a] - Pt[ob][a])) : unit3([0, 1, 2].map((a) => (body.rest.P[ob][a] - body.rest.P[body.par[ob] >= 0 ? body.par[ob] : ob][a]) || (a === 1 ? 1 : 0)));
      let n = [dir[2], 0, -dir[0]]; n = Math.hypot(...n) < 1e-6 ? [1, 0, 0] : unit3(n);   // dir x up, up = (0,-1,0) (y grows down)
      const Wnow = o.W[ob], W0 = D.solvePose(body, mk({ ...joints, [ob]: { p: 0, y: 0, r: 0 } })).W[ob];
      let done = false;
      for (let th = 3; th <= CLAMPMAX && !done; th += 3) {
        const S = D.rot(n, th * DEG);
        const Wt = mul(mul(F, mul(S, F)), Wnow), Rv = mul(F, mul(mul(Wt, tr(W0)), F)), e = toEuler(Rv);
        const J2 = { ...joints, [ob]: { p: near(e.p, joints[ob].p), y: near(e.y, joints[ob].y), r: near(e.r, joints[ob].r) } };
        if (lowOf(J2).low - FLK <= TOL || th >= CLAMPMAX) { joints[ob] = J2[ob]; globalThis.__floorBones++; done = true; }
      }
    }
  }
  if (HIPTRAVEL && HIPS === "follow") {
    // keep each stance foot (DW2 foot on its floor) where DW2's stays: target = our idle foot + DW2's foot displacement (scaled by body height); move the WHOLE body by the mean miss
    const feet = stance[k] || [], o = D.solvePose(body, mkF(joints, k)); let sx = 0, sz = 0, n = 0;
    for (const f of feet) { const db = partnerOf.get(f), d = mapPos([dwPoses[k].pos[db][0] - dwRest.pos[db][0], 0, dwPoses[k].pos[db][2] - dwRest.pos[db][2]]).map((x) => x * body.H / HdBody);
      sx += body.rest.P[f][0] + d[0] - o.P[f][0]; sz += body.rest.P[f][2] + d[2] - o.P[f][2]; n++; }
    if (n) hipXZ[k] = [sx / n / body.H, sz / n / body.H];
    if (process.env.DBGHIP && n) console.error(`k${k} feet ${feet.join(',')} miss ${(sx/n).toFixed(0)},${(sz/n).toFixed(0)} units; unshifted foot ${feet.map((f) => o.P[f][0].toFixed(0) + ',' + o.P[f][2].toFixed(0)).join(' | ')}; rest ${feet.map((f) => body.rest.P[f][0].toFixed(0) + ',' + body.rest.P[f][2].toFixed(0)).join(' | ')}; H ${body.H}`);
    if (n) {   // the feet may stand wider/narrower than the body shift can satisfy for both: turn each stance thigh a few degrees (shin and foot keep DW2's world direction) until its foot sits on its planted spot
      const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
      const turnBone = (J, ch, idx, axis, deg) => {
        const sh = ch[idx], oo = D.solvePose(body, mkF(J, k)), W0 = D.solvePose(body, mk({ ...J, [sh]: { p: 0, y: 0, r: 0 } })).W[sh];
        const Wt = mul(mul(F, mul(D.rot(axis, deg * DEG), F)), oo.W[sh]), ee = toEuler(mul(F, mul(mul(Wt, tr(W0)), F))), J2 = { ...J, [sh]: { p: near(ee.p, J[sh].p), y: near(ee.y, J[sh].y), r: near(ee.r, J[sh].r) } };
        for (const b of ch.slice(idx + 1)) { if (!J2[b]) continue; const W0b = D.solvePose(body, mk({ ...J2, [b]: { p: 0, y: 0, r: 0 } })).W[b], eb = toEuler(mul(F, mul(mul(oo.W[b], tr(W0b)), F))); J2[b] = { p: near(eb.p, J[b].p), y: near(eb.y, J[b].y), r: near(eb.r, J[b].r) }; }
        return J2; };
      for (const f of feet) {
        const ch = Object.values(body.chains || {}).find((c) => c.length >= 2 && c.includes(f)); if (!ch || !joints[ch[0]]) continue;
        const db = partnerOf.get(f), d = mapPos([dwPoses[k].pos[db][0] - dwRest.pos[db][0], 0, dwPoses[k].pos[db][2] - dwRest.pos[db][2]]).map((x) => x * body.H / HdBody), tx = body.rest.P[f][0] + d[0], tz = body.rest.P[f][2] + d[2];
        const y0 = D.solvePose(body, mkF(joints, k)).P[f][1];   // the foot keeps its height: only its place on the floor is corrected
        const missOf = (J) => { const oo = D.solvePose(body, mkF(J, k)); return Math.hypot(oo.P[f][0] - tx, oo.P[f][2] - tz, oo.P[f][1] - y0); };
        let J = joints, m0 = null, bestM = null;
        for (let it = 0; it < 8; it++) {   // alternate: turn the thigh about the hip, then the shin about the knee (bones below keep their world direction); a few passes reach the spot
          const idx = ch.length >= 3 && ch[1] !== f && J[ch[1]] ? it % 2 : 0;
          const o1 = D.solvePose(body, mkF(J, k)), cur = o1.P[f], piv = o1.P[ch[idx]], here = Math.hypot(cur[0] - tx, cur[2] - tz, cur[1] - y0); if (m0 == null) m0 = here; bestM = here; if (here < 0.003 * body.H) break;
          const vc = unit3([cur[0] - piv[0], cur[1] - piv[1], cur[2] - piv[2]]), vt = unit3([tx - piv[0], y0 - piv[1], tz - piv[2]]); let ax = cross3(vc, vt); if (Math.hypot(...ax) < 1e-6) continue; ax = unit3(ax);
          let bestJ = null, bm = here;
          // coarse to fine (2026-10-25): every 4 deg over +-20, then every 0.5 deg within +-3.5 of the best (25 body solves instead of 80; same 0.5 deg grid)
          const tryTh = (th) => { if (Math.abs(th) < 0.25 || Math.abs(th) > 20) return; const J2 = turnBone(J, ch, idx, ax, th), m = missOf(J2); if (m < bm) { bm = m; bestJ = J2; bt = th; } };
          let bt = 0; for (let th = -20; th <= 20; th += 4) tryTh(th); const c0 = bt; for (let th = c0 - 3.5; th <= c0 + 3.5; th += 0.5) if (th !== c0) tryTh(th);
          if (bestJ) { J = bestJ; bestM = bm; }
        }
        if (J !== joints) { for (const b of ch) if (J[b]) joints[b] = J[b]; globalThis.__legTurn = (globalThis.__legTurn || 0) + 1; }
        if (process.env.DBGHIP) console.error(`  k${k} foot ${f}: miss ${m0.toFixed(0)} -> ${bestM.toFixed(0)} units`);
      }
    }
    else { const rt = pairs.find(([ob]) => body.par[ob] < 0)?.[1], prev = hipXZ[k - 1] ?? [0, 0]; let dd = [0, 0];   // airborne: keep the last shift and follow DW2's root travel
      if (rt != null && k > 0) { const a = mapPos([dwPoses[k].pos[rt][0] - dwPoses[k - 1].pos[rt][0], 0, dwPoses[k].pos[rt][2] - dwPoses[k - 1].pos[rt][2]]); dd = [a[0] / HdBody, a[2] / HdBody]; }
      hipXZ[k] = [prev[0] + dd[0], prev[1] + dd[1]]; }
  }
  if (process.env.DBGFIN && (anchors[k]||[]).length) { const o = D.solvePose(body, mkF(joints, k)); console.error(`FIN k${k} ` + (anchors[k]||[]).map((f) => `foot${f} planned ${o.P[f][0].toFixed(0)},${o.P[f][1].toFixed(0)},${o.P[f][2].toFixed(0)}`).join(' | ') + ` shift ${(hipXZ[k]||[0,0]).map((x) => (x * body.H).toFixed(0)).join(',')}`); }
  steps.push(joints); prevJ = joints;
  if (FLOOR && HIPS === "follow") { const o = D.solvePose(body, mkF(joints, k)), ex = (D.lowestY(body, o.W, o.P) - body.floorY) / body.H; if (ex > 0.01) hipDy[k] -= Math.min(LIFTCAP, ex); }
}
// ── write ───────────────────────────────────────────────────────────────────────────────────
const f1 = (v) => (Math.round(v * 10) / 10).toString();
let out = `# GENERATED by prototype/dw2delta.mjs from DW2 model ${M.dw2.id} clip ${clipS} (${dwPoses.length} poses, ${TPP} ticks each), for ${M.ours.folder}. Every paired bone's full 3-axis rotation change, mirrored=${flip}.\n`;
out += `body ${M.ours.folder}\nslot ${M.slot ?? 9}\nfacing ${M.ours.facing ?? 0}\n`;
if (M.ours.contact) out += `contact-bones ${M.ours.contact.join(" ")}\n`;
for (const s of M.springs || []) out += `spring ${s}\n`;
out += "\n";
const clauseText = (J) => Object.entries(J).filter(([, e]) => Math.abs(e.p) + Math.abs(e.y) + Math.abs(e.r) > 0.05).map(([b, e]) => `  joint ${b} ${f1(e.p)} ${f1(e.y)} ${f1(e.r)}`).join("\n");
const tppOf = (k) => SLOW.find((r) => k >= r.a && k <= r.b)?.t ?? TPP;
const shiftText = (k) => { const h = hipXZ[k]; return HIPTRAVEL && h && Math.hypot(h[0], h[1]) > 1e-4 ? `\n  shift vec:${h[0].toFixed(5)},0,${h[1].toFixed(5)} ${Math.hypot(h[0], h[1]).toFixed(5)}` : ""; };
const hipText = (k) => (HIPS === "follow" ? `${shiftText(k)}\n  crouch ${(hipDy[k] ?? 0).toFixed(3)}\n  ground lift${(anchors[k] || []).length ? " anchor " + anchors[k].join(" ") : ""}${sinkOK[k] > 0.005 ? " sink " + sinkOK[k].toFixed(3) : ""}` : "");
globalThis.__hipMax = Math.max(...hipDy);
steps.forEach((J, k) => { out += `phase p${k} ${tppOf(k)}t ease linear\n${clauseText(J)}${hipText(k)}\n\n`; });
if (tailFile) out += fs.readFileSync(tailFile, "utf8").replace(/@LAST@/g, clauseText(steps[steps.length - 1]) + hipText(steps.length - 1));
fs.writeFileSync(outPath, out);
{ let acc = 0; const ends = steps.map((_, k) => (acc += tppOf(k)) - 1); fs.writeFileSync(outPath + ".targets.json", JSON.stringify({ pairs, flip, poses: dwPoses.length, tpp: TPP, ends })); }
console.log(`poses ${steps.length}; mirrored-side bones ${globalThis.__mirrored ?? 0}; deglitched ${globalThis.__deglitched ?? 0}; mirror ${flip}; dispErr ${(globalThis.__dispErr ?? -1).toFixed(3)}; mode ${MODE}${MODE === "world" ? "" : `: local bend on ${ordered.filter(([o, d]) => modeOf(o, d, flip) === "local").map(([o]) => o).join(",") || "no bone"}`}; wrote ${outPath}`);
