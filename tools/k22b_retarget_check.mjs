#!/usr/bin/env node
// k22b_retarget_check.mjs — measure a DW2 clip retargeted onto our DW3 model, through the renderer's own
// pose formula, so the K22b rules (root normalisation, reach/path, idle roles) can be judged numerically.
//
//   node tools/k22b_retarget_check.mjs --root ~/dw2-models/converted2 \
//        --bonemaps ~/dw2-models/dw2-bonemaps.json --species m009mera,m050coca --pairs I:5,K:3 \
//        [--modes point,path,auto] [--idle] [--no-pen] [--out <json>]
//
// Nothing here names a species and nothing writes game data: DW2 paths and the generated bone map come
// from the command line (both are disc-derived and live outside the repo).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BONEMAP } from "../web/fight/digimon-bonemap.js";
import { bakeRetargetByRole, castGate, rigOf, restPose } from "../web/fight/anim-retarget.js";
import { penetration, clearanceTolerance } from "../web/fight/anim-collision.js";
import { poseFromChannels } from "../web/fight/firing-axis.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const A = process.argv.slice(2);
const arg = (k, d = null) => (A.includes(k) ? A[A.indexOf(k) + 1] : d);
const MODELS = arg("--models", path.join(ROOT, "web/assets/battle/models"));
const SRC = arg("--root", path.join(process.env.HOME, "dw2-models/converted2"));
const BM = arg("--bonemaps", path.join(process.env.HOME, "dw2-models/dw2-bonemaps.json"));
const SPECIES = (arg("--species", "") || "").split(",").filter(Boolean);
const PAIRS = (arg("--pairs", "I:5") || "").split(",").filter(Boolean).map((s) => {
  const [letter, clip] = s.split(":");
  return { letter, clip: +clip };
});
const MODES = (arg("--modes", "point") || "").split(",").filter(Boolean);
const IDLE = A.includes("--idle");
const ROOTFIX = A.includes("--no-rootfix") ? false : (arg("--rootfix", "auto") === "always" ? true : "auto");
const PEN = !A.includes("--no-pen");
const OUT = arg("--out", null);

const bm = JSON.parse(fs.readFileSync(BM, "utf8")).models;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const norm = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (a) => { const l = norm(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const angleBetween = (a, b) => Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))) * 180 / Math.PI;
const tableRange = (model, table) => {
  let lo = Infinity, hi = -1;
  for (const e of model.timeline?.[table]?.table ?? []) {
    const v = e?.value | 0;
    if (v >= 0 && v < 0x8000) { if (v < lo) lo = v; if (v > hi) hi = v; }
  }
  return hi > lo ? [lo, hi] : [0, 0];
};
const lowestVertex = (model, frame) => {
  const p = poseFromChannels(model, frame);
  let lo = -Infinity;
  for (let i = 0; i < model.bones.length; i++) {
    const R = p.rot[i], t = p.pos[i];
    for (const v of model.bones[i].verts || []) {
      const y = (R[1] * v[0] + R[4] * v[1] + R[7] * v[2]) + t[1];
      if (y > lo) lo = y;
    }
  }
  return lo;
};
const rotStep = (A2, B2) => {
  let d = 0;
  for (let k = 0; k < 9; k++) d += A2[k] * B2[k];
  return Math.acos(Math.max(-1, Math.min(1, (d - 1) / 2)));
};
const stepOf = (model, a, b) => {
  const pa = poseFromChannels(model, a).rot, pb = poseFromChannels(model, b).rot;
  let worst = 0;
  for (let i = 0; i < model.bones.length; i++) worst = Math.max(worst, rotStep(pa[i], pb[i]));
  return worst;
};

const rows = [];
for (const sp of SPECIES) {
  const tp = path.join(MODELS, sp, "anim.json");
  const dp = path.join(SRC, `dw2_${sp}`, "anim.json");
  if (!fs.existsSync(tp) || !fs.existsSync(dp) || !bm[`dw2_${sp}`]) {
    rows.push({ species: sp, error: `missing ${!fs.existsSync(tp) ? "target" : !fs.existsSync(dp) ? "donor" : "bone map"}` });
    continue;
  }
  const target = JSON.parse(fs.readFileSync(tp, "utf8"));
  target.folder = sp;
  const donor = JSON.parse(fs.readFileSync(dp, "utf8"));
  donor.folder = `dw2_${sp}`;
  BONEMAP[donor.folder] = bm[donor.folder];
  const T = rigOf(target), S = rigOf(donor);
  const H = T.box.h || 1, Hs = S.box.h || 1;
  const tol = clearanceTolerance(target, sp);
  for (const pair of PAIRS) {
    const srcClip = donor.clips?.find((c) => c.letter === pair.letter);
    if (!srcClip) { rows.push({ species: sp, pair: `${pair.letter}:${pair.clip}`, error: "donor has no such clip" }); continue; }
    const hasTargetClip = !!target.timeline?.[pair.clip];
    for (const mode of MODES) {
      const bake = bakeRetargetByRole(target, donor, srcClip.index, { ik: true, reach: mode, idleRoles: IDLE, rootNormalise: ROOTFIX });
      if (!bake) { rows.push({ species: sp, pair: `${pair.letter}:${pair.clip}`, mode, error: "bake null" }); continue; }
      bake.source = donor;
      const gate = castGate(bake);
      const baked = bake.model;
      const [lo, hi] = tableRange(baked, bake.table);
      const frames = hi - lo + 1;
      // ground against the model's own rest pose
      const restLow = lowestVertex(baked, 0);
      let below = 0, above = 0;
      for (let f = lo; f <= hi; f++) {
        const d = lowestVertex(baked, f) - restLow;
        if (d > below) below = d;
        if (-d > above) above = -d;
      }
      // ankles
      const feet = [];
      for (const side of ["left", "right"]) {
        const chain = (T.legs.find((l) => l.side === side) ?? {}).chain;
        if (!chain?.length) continue;
        const ankle = chain[chain.length - 1];
        const rest = restPose(baked, 0).pos[ankle];
        let dy = 0, dxz = 0;
        for (let f = lo; f <= hi; f++) {
          const p = poseFromChannels(baked, f).pos[ankle];
          dy = Math.max(dy, Math.abs(p[1] - rest[1]));
          dxz = Math.max(dxz, Math.hypot(p[0] - rest[0], p[2] - rest[2]));
        }
        feet.push({ side, dy: +(dy / H).toFixed(3), dxz: +(dxz / H).toFixed(3) });
      }
      // penetration vs this body's own authored floor
      let penWorst = Infinity, penOver = 0, penFramesOver = 0, penPair = null;
      if (PEN) {
        for (let f = lo; f <= hi; f++) {
          const pen = penetration(baked, restPose(baked, f), { folder: sp, tolerance: tol });
          if (pen.clearance < penWorst) { penWorst = pen.clearance; penPair = pen.worst ? `${pen.worst.roleA}/${pen.worst.roleB}` : null; }
          const over = Math.max(0, ...pen.violations.map((v) => v.over));
          if (over > 0.01 * H) penFramesOver++;
          penOver = Math.max(penOver, over);
        }
      }
      // worst frame-to-frame step vs the target's own worst step for the clip it keeps
      let jump = 0, jumpBone = -1, jumpAt = -1;
      for (let f = lo + 1; f <= hi; f++) {
        const pa = poseFromChannels(baked, f - 1).rot, pb = poseFromChannels(baked, f).rot;
        for (let i = 0; i < baked.bones.length; i++) {
          const s = rotStep(pa[i], pb[i]);
          if (s > jump) { jump = s; jumpBone = i; jumpAt = f; }
        }
      }
      let ownJump = 0;
      {
        const c = target.clips?.find((x) => x.index === pair.clip);
        if (c) for (let f = c.start_frame + 1; f <= c.end_frame; f++) ownJump = Math.max(ownJump, stepOf(target, f - 1, f));
      }
      // swing: the hand's travel direction against the donor's
      const handBone = (T.props.find((p) => p.side === "right") ?? T.props[0])?.bone
        ?? (T.arms.find((a) => a.side === "right") ?? T.arms[0])?.chain.slice(-1)[0];
      const dHand = (S.props.find((p) => p.side === "right") ?? S.props[0])?.bone
        ?? (S.arms.find((a) => a.side === "right") ?? S.arms[0])?.chain.slice(-1)[0];
      let swing = null;
      if (handBone != null && dHand != null) {
        const p0 = poseFromChannels(baked, lo).pos[handBone];
        let bi = lo, bd = -1;
        for (let f = lo; f <= hi; f++) { const d = norm(sub(poseFromChannels(baked, f).pos[handBone], p0)); if (d > bd) { bd = d; bi = f; } }
        const s0 = poseFromChannels(donor, lo - bake.offset).pos[dHand];
        let sbi = lo, sbd = -1;
        for (let f = lo; f <= hi; f++) { const d = norm(sub(poseFromChannels(donor, f - bake.offset).pos[dHand], s0)); if (d > sbd) { sbd = d; sbi = f; } }
        const dT = unit(sub(poseFromChannels(baked, bi).pos[handBone], p0));
        const dS = unit(sub(poseFromChannels(donor, sbi - bake.offset).pos[dHand], s0));
        swing = { deg: +angleBetween(dT, dS).toFixed(1), travelH: +(bd / H).toFixed(3), donorTravelH: +(sbd / Hs).toFixed(3) };
      }
      // donor's own step, for attribution
      let donorStep = 0;
      for (let f = lo - bake.offset + 1; f <= hi - bake.offset; f++) donorStep = Math.max(donorStep, stepOf(donor, f - 1, f));
      // unmapped ROLE bones: do they move (own idle, K22b rule 4) or sit frozen at rest? Measured on the
      // bone's OWN channel (a child's world rotation inherits its parents, so world would falsely say it moves)
      const chSample = (ch, f) => {
        if (!ch?.length) return [0, 0, 0];
        let lo2 = ch[0], hi2 = ch[0];
        for (const r of ch) { if (r[3] < lo2[3]) lo2 = r; if (r[3] > hi2[3]) hi2 = r; }
        if (f <= lo2[3]) return [lo2[0], lo2[1], lo2[2]];
        if (f >= hi2[3]) return [hi2[0], hi2[1], hi2[2]];
        for (let i = 1; i < ch.length; i++) {
          if (ch[i][3] >= f) {
            const a = ch[i - 1], b = ch[i];
            const t = b[3] === a[3] ? 0 : (f - a[3]) / (b[3] - a[3]);
            return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
          }
        }
        return [hi2[0], hi2[1], hi2[2]];
      };
      let idleMoving = 0, idleStep = 0;
      const roleBones = T.roleBones ?? [];
      for (const b of roleBones) {
        if (bake.map[b] >= 0) continue;
        const ch = baked.bones[b]?.anim?.ch2;
        const c0 = chSample(ch, lo);
        let moved = 0;
        for (let f = lo + 1; f <= hi; f++) {
          const c = chSample(ch, f);
          moved = Math.max(moved, Math.hypot(c[0] - c0[0], c[1] - c0[1], c[2] - c0[2]));
        }
        if (moved > 0.5) idleMoving++;              // > 0.5 raw unit = 0.0008 rad: a real change
        idleStep = Math.max(idleStep, moved);
      }
      const idleRoleCount = roleBones.filter((b) => bake.map[b] < 0).length;
      const m = bake.metrics;
      rows.push({
        species: sp, pair: `${pair.letter}:${pair.clip}`, mode: ROOTFIX === false ? `${mode}-old` : (ROOTFIX === true ? `${mode}-always` : mode), frames,
        targetHasClip: hasTargetClip,
        covered: +bake.covered.toFixed(3),
        roots: { t: `${T.rootRaw}/${T.torsoRaw}->${T.root}/${T.torso}`, s: `${S.rootRaw}/${S.torsoRaw}->${S.root}/${S.torso}` },
        rootMoved: !!(T.rootFix?.moved || S.rootFix?.moved),
        rootNorm: m.rootNormalised,
        ik: { solved: m.ikSolved, clamped: m.ikClamped, share: m.reachClampShare, reachMode: m.reachMode, pathFrames: m.reachPathFrames },
        idleBones: m.idleBones,
        idleRoles: { unmapped: idleRoleCount, moving: idleMoving, step: +idleStep.toFixed(3) },
        jump: { clip: +jump.toFixed(3), bone: jumpBone, atFrame: jumpAt, own: +ownJump.toFixed(3), donor: +donorStep.toFixed(3) },
        feet,
        ground: { below: +(below / H).toFixed(3), above: +(above / H).toFixed(3) },
        pen: PEN ? { worstH: +(penWorst / H).toFixed(3), floorH: +(tol.floor / H).toFixed(3), framesOver: penFramesOver,
                     ofFrames: frames, worstOverH: +(penOver / H).toFixed(3), worstPair: penPair } : null,
        swing,
        gate: { used: gate.used, reasons: gate.reasons ?? [] },
      });
    }
  }
}

if (OUT) fs.writeFileSync(OUT, JSON.stringify(rows, null, 1));
const pad = (v, n) => String(v).padEnd(n);
console.log(pad("species", 9) + pad("pair", 6) + pad("mode", 6) + pad("frames", 7) + pad("cov", 6) + pad("ikClamp", 8) +
  pad("jump/own", 11) + pad("ankleL", 7) + pad("ankleR", 7) + pad("ground-", 8) + pad("pen>own", 9) + pad("swing", 7) + pad("idle", 7) + "roots");
for (const r of rows) {
  if (r.error) { console.log(pad(r.species, 9) + pad(r.pair ?? "-", 6) + pad(r.mode ?? "-", 6) + "ERROR " + r.error); continue; }
  console.log(pad(r.species, 9) + pad(r.pair, 6) + pad(r.mode, 6) + pad(r.frames, 7) + pad(r.covered, 6) +
    pad(`${r.ik.clamped}(${r.ik.share})${r.ik.reachMode === "path" ? "P" : ""}`, 8) +
    pad(`${r.jump.clip}/${r.jump.own}`, 11) +
    pad(r.feet.find((f) => f.side === "left")?.dy ?? "-", 7) + pad(r.feet.find((f) => f.side === "right")?.dy ?? "-", 7) +
    pad(-r.ground.below, 8) + pad(r.pen ? `${r.pen.framesOver}/${r.pen.ofFrames}` : "-", 9) +
    pad(r.swing ? r.swing.deg : "-", 7) + pad(`${r.idleRoles.moving}/${r.idleRoles.unmapped}`, 7) +
    r.roots.t + " | " + r.roots.s);
}
