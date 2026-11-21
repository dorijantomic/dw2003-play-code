// web/gym.js — the training gym's scene drawing (TRANIN packs), used by web/gym-lab.html.
//
// The gym screen itself is web/gym-translated.js (engine GymSession). This module
// keeps the TRANIN scene player the gym lab page calibrates the scene anchors with.
//
// Decoded flow + numerics: docs/research/battle/exp-levelup-rewards-decoded-2026-07-10.md §4
// and docs/research/ui/stgtrain-decoded-2026-07-11.md.
import { assignAssetImage } from "./assets.js";

// TRANIN training-scene packs (DAT/TRAINING/TRANIN00-16, extracted by
// tools/extract_tranin.py — see the extractor header for the decoded format
// and docs/research/ui/stgtrain-decoded-2026-07-11.md for how they were
// found). One file per drill family; subdirs 0-7 = per-starter large workout
// animation sets (same order as the sprite-category table), subdir 8 = the
// shared props (punching bag/chain/mount/dust for Punch; per-drill props for
// the others). Clips carry their native scene draw offsets (ox,oy); anim
// script 0 is the looping workout cycle, durations in vsyncs.
const TRANIN_CACHE = {};
export function traninEntry(key: string | number) {
  let e = TRANIN_CACHE[key];
  if (e) return e;
  e = TRANIN_CACHE[key] = { img: new Image(), meta: null };
  assignAssetImage(e.img, `assets/ui/tranin/t${key}.png`);
  fetch(`assets/ui/tranin/t${key}.json`).then((r) => r.json())
    .then((j) => { e.meta = j; }).catch(() => {});
  return e;
}

function traninReady(e) {
  return !!(e?.meta && e.img.complete && e.img.naturalWidth);
}

// Anim-script semantics, decoded 2026-07-12d from the rep widget task F0x800897b8
// + rep dispatcher F0x800871ac (both re-decompiled via m2c): each subdir carries
// EXACTLY 6 scripts and the game plays them by fixed index —
//   0 = intro/ready stance (played once when the round starts),
//   1 = per-rep wind-up (widget case 4, unk5C 0→1: D2EC(cat,1)),
//   2 = HIT — punch connects (success roll: D2EC(cat,2)),
//   3 = MISS — the bag swings back and hits you (fail roll: D2EC(cat,3)),
//   4 = WIN pose / 5 = LOSE pose (widget case 8: unk60 ? 4 : 5).
// The trainee (subdir = sprite category) and the props (subdir 8: bag/chain/mount)
// play the SAME index in lockstep, so the bag reacts on the same beat as the punch.
export const TR_INTRO = 0, TR_WINDUP = 1, TR_HIT = 2, TR_MISS = 3, TR_WIN = 4, TR_LOSE = 5;

// Per-drill-family scene anchor — ONE anchor shared by the trainee (subdir =
// category) and the props (subdir 8); the actors' relative placement is fully
// baked into the clips' native draw offsets. Both calibrated families land on
// the identical point (runtime captures 2026-07-13):
//   "00" Punch (82,31): rig framebuffer template match + user PS1 capture
//        (bag-relative Kotemon bbox agrees within ~2px). The old separate
//        digi anchor (71,46) — "matched within 1-2px" — was WRONG.
//   "03" Study (79,24): user PS1 capture, edge/color-NCC lock 0.73-0.85
//        (an earlier (79,27) digi reading was an NCC argmax clipped at the
//        search-radius edge).
//   "14" Thunder Defense (47,35): user PS1 capture, calibrated visually in
//        gym-lab (auto-registered overlay).
// Native DRAW ORDER is trainee first, props on top (subdir order): the real
// game occludes Kotemon's extended sword behind the punching bag.
// The native anchor source is the resident anim-actor system (0x8008cfcc
// runtime-populated vtable, not stgtrain-local); other families are
// UNCALIBRATED and fall back to the Punch value — calibrate each with one
// real capture in web/gym-lab.html.
export const TRANIN_ANCHORS = { default: [82, 31], "03": [79, 24], "14": [47, 35] };
export function traninAnchors(fam: string | number) {
  return TRANIN_ANCHORS[fam] ?? TRANIN_ANCHORS.default;
}

// Total run length of one anim script, in ms (PAL vsync = 20ms/step). 0 if absent.
export function traninScriptMs(e, idx: string | number) {
  const steps = traninReady(e) && e.meta.anims[idx];
  if (!steps?.length) return 0;
  return steps.reduce((s, x) => s + x.dur, 0) * 20;
}
// Draw one clip: the opaque cell, then the clip's semi-transparent cell
// blended over it (PS1 semi-transparency, c bit15 — the Thunder flash, Yoga
// spotlight cone, Heat explosion glow, the Ice frost encasing; the real game
// shows the trainee THROUGH these). 50/50 (PS1 mode 0) is used for all semi
// layers — matches the thunder capture. The clip record's d&3 is exported as
// semi.abr but its mapping to PS1 ABR modes is UNRESOLVED (the falling-snow
// sheets carry d&3=2, which as ABR would be subtractive black snow — the
// runtime frames show white; do not wire d&3 as ABR without per-mode runtime
// comparison).
function drawClipCell(ctx, e, clip: string | number, ax, ay) {
  const c = e.meta.clips[clip];
  if (!c) return false;
  if (c.w) ctx.drawImage(e.img, c.x, c.y, c.w, c.h, ax + c.ox, ay + c.oy, c.w, c.h);
  if (c.semi) {
    const s = c.semi;
    ctx.save();
    ctx.globalAlpha *= 0.5;
    ctx.drawImage(e.img, s.x, s.y, s.w, s.h, ax + s.ox, ay + s.oy, s.w, s.h);
    ctx.restore();
  }
  return true;
}

// Resolve which step of an anim script is showing at an absolute elapsed time.
// `loop` cycles forever; otherwise the script plays once and holds the final
// frame (so a resolved punch/pose stays put until the state machine advances).
function traninResolve(e, idx: string | number, elapsedMs: number, loop: boolean) {
  if (!traninReady(e)) return null;
  let steps = e.meta.anims[idx];
  if (!steps?.length) steps = e.meta.anims[TR_INTRO];
  if (!steps?.length) return null;
  const total = steps.reduce((s, x) => s + x.dur, 0) || 1;
  let t = Math.floor(Math.max(0, elapsedMs) / 20);
  t = loop ? t % total : Math.min(t, total - 1);
  let curIdx = steps.length - 1, acc = 0;
  for (let i = 0; i < steps.length; i++) { if (t < acc + steps[i].dur) { curIdx = i; break; } acc += steps[i].dur; }
  return steps[curIdx];
}

// Draw the full two-actor training scene: trainee first, props on top
// (native subdir order — the bag occludes the extended sword), both at the
// shared scene anchor + their step's movement offset; semi-transparent
// layers blend inside drawClipCell. No size heuristics — what the scripts
// say is what draws (the wide props panoramas already contain every prop,
// and the Yoga spotlight clip contains the meditating trainee).
// digiOff is the gym-lab exploration offset (0 in the game).
export function drawTraninScene(ctx, digi, props, idx: string | number, elapsedMs: number, ax: number, ay: number, loop = false, digiOff = null) {
  const dF = traninResolve(digi, idx, elapsedMs, loop);
  const pF = traninResolve(props, idx, elapsedMs, loop);
  if (dF) drawClipCell(ctx, digi, dF.clip,
    ax + (digiOff?.[0] ?? 0) + (dF.dx ?? 0), ay + (digiOff?.[1] ?? 0) + (dF.dy ?? 0));
  if (pF) drawClipCell(ctx, props, pF.clip, ax + (pF.dx ?? 0), ay + (pF.dy ?? 0));
  return { drewDigi: !!dF, drewProps: !!pF, digiF: dF ?? null, propsF: pF ?? null };
}
