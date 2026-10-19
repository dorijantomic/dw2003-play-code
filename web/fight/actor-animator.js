// Per-actor playback state machine that battle3d.js uses to drive one fighter's frame.
// It switches between IDLE (a TimelinePlayer over the model's idle position table) and an
// ACTION (an ActionVM interpreting model.actions[clip]). The renderer calls tick(speed)
// once per fixed PS1 logic tick and reads currentFrame() for buildBoneWorldMatrices.
//
// Motion -> table resolution is DATA-derived from the DISC, RESOLVED 2026-06-21
// (docs/.../renamon-motion-table-map.md §4c; dispatch doc §g). The timeline tables a clip plays are
// named DIRECTLY, one at a time, by the model's OWN action script via opcode 2 (op2[mode=0, slot,
// table]; handler FIGHTSTG_F0x8008b7f4 -> anim object method 0x188). The ActionVM executes that op2
// stream IN ORDER (binding ONE table per op2 mode-0), with the script's blocking waits (op2 [*,0,0]
// done-waits and mode-5 sync waits) gating when one table yields to the next — NOT a flattened
// PlaylistPlayer (that snapped the looping move-back; see action-vm.js header). We just hand the VM a
// `timelineForTable(i)` resolver; it owns the sequencing. Reference clips (N=2 Renamon + Agumon):
//   clip 5 basic   = [14,15,16,17,18]      clip 6/7/8 combo = [20-24]/[26-30]/[32-36]
//   clip 11 signature = per-model (Rena [12,50,51,52,53,1], Agu [50,51])
//   clip 10 reaction  = [44,45]
// op4 play-motion sets only the motion ENVELOPE (sentinel 56 -> current motion, 0 -> return-to-base /
// idle); the per-frame table SEQUENCE is the op2 stream. The clip's FIRST op2 table seeds the slot so
// currentFrame() is sane before tick 1 (and clips with neither op2 nor op4 fall back to idle).
import { TimelinePlayer, PlaylistPlayer } from "./timeline-player.js";
import { ActionVM } from "./action-vm.js";
import { techToClip, techRecord, techEffectType, ITEM_USE_CLIP, itemUseEffect, throwItemEffect } from "./fight-tables.js";
import { resolveClipScript, scriptTableSeq } from "./clip-fallback.js";
import { authoredSide, mirrorHooks } from "./side-mirror.js";
// The animation-slot system the original runs is ported in
// engine/dw3/battle-actor-animation.ts: the op2 movement arms of FIGHTSTG_F0x8008b7f4
// (`animSlotMoveDelta`) and the live=home write of mode 7 / the placement FIGHTSTG_F0x80087f38
// (`resetAnimSlotLiveToHome`). This file consumes those instead of hand-writing them.
import { animSlotMoveDelta, resetAnimSlotLiveToHome } from "../vendor/engine.js";

// Max forward per-tick frame delta still treated as "continuous" (interpolatable) by renderSample.
// Real motion advances ~1–4 frames/tick (the vsync delta); phase cuts jump by hundreds. 16 cleanly
// separates the two so a phase boundary or loop-back snaps instead of sweeping through dead frames.
const SNAP_THRESH = 16;
// Ticks over which the action->idle pose ease plays (~0.17s @60Hz). Long enough to read as fluid,
// short enough not to feel laggy returning to idle after an attack.
const HANDOFF_TICKS = 10;

// The ordered list of timeline tables a clip plays, read straight from its action script's op2
// play-table records (op2[mode=0, slot, table]) in script order; table 0 (idle/rest) is excluded
// by the `> 0` test. Exported as the SINGLE source of truth so the renderer (_clipTableSeq) and the
// Fight Action Lab cross-check both derive the script's sequence the exact same way.
export function clipTableSeq(model, clip) {
  const ops = model?.actions?.[clip]?.ops;
  if (!Array.isArray(ops)) return [];
  const seq = [];
  for (const o of ops) {
    // > 1: word 0 is the done-wait and word 1 is "return to the actor's base idle" (see
    // action-vm.js _dispatchOp2) — neither names a table.
    if (o.op === 2 && o.words?.[0] === 0 && (o.words[2] | 0) > 1) seq.push(o.words[2] | 0);
  }
  return seq;
}

export class ActorAnimator {
  constructor(model) {
    this.model = model;
    this.vm = null;                          // active ActionVM, or null while idle
    this._clip = 0;                          // clip index of the active action (drives its motion table)
    this.frame = model?.clips?.[0]?.start_frame ?? 0;
    this.blend = null;                       // active pose blend ({from,t}) this tick, or null
    this._dbgLoop = null;                    // fight-action-lab: table list to re-loop, or null
    // Render-interpolation state: the (frame, blend) BEFORE the most recent tick, plus a flag set
    // when that tick was a discontinuity (phase cut / loop-back). renderSample() lerps between the
    // previous and current tick by the render accumulator's fraction, suppressed when _snap is set.
    this._prevFrame = this.frame;
    this._prevBlend = null;
    this._snap = true;                       // first frame shows the current state, no interpolation
    // Action->idle handoff ease: when a VM ends, the idle table leads with plain frames (no ease-in),
    // so resuming idle would snap the pose. We synthesize a blend from the action's last frame into
    // idle over HANDOFF_TICKS. _handoffFrom = that frame (null = inactive); _handoffT ramps 0->1.
    this._handoffFrom = null;
    this._handoffT = 0;
    // Lethal reaction clips end on an authored dead pose.  Unlike ordinary actions, that
    // terminal pose must remain on screen until the battle presentation tears the actor down.
    this._heldPose = false;
    this._holdFinalPose = false;
    this._timelineCycleComplete = false;
    // The timeline table currently bound (the model actor's +0x78 minus one).
    this._timelineTable = 0;
    // The actor's BASE idle table (the anim object's +0x18): 0 = the normal idle, 1 = the low-HP
    // stance. The engine latches it when it plays animId 1 or 2 (.L0x80084098-.L0x800840b8); every
    // action's trailing op2 [0, slot, 1] and every action->idle return plays THIS table
    // (.L0x8008b90c / .L0x80083dc4). battle3d sets it from the fighter's live HP.
    this.baseTable = 0;
    // Slot movement (op2 modes 3/7/8): PS1 arena-absolute position as a DELTA from the
    // actor's home slot. battle3d adds worldDelta() (render-mapped) to the slot position.
    // {cur:[x,y,z], from:[..], target:[..], t, ticks} — deltas in PS1 units, y down.
    //
    // The delta is the SLOT's live triple (slot+0x1c/+0x1e/+0x20), so it PERSISTS until another
    // movement record rewrites it. Nothing in the original restores it on its own: the only two
    // writers that put a slot back on its arena home are the placement routine
    // FIGHTSTG_F0x80087f38 (x=0, y=-hover, z=-(0x1400+standoff), which also seeds the home
    // triple at slot+0x28/+0x2a/+0x2c — fightstg.s:5436-5459 and :5478-5497) and an explicit
    // `op2 [7, slot, flag]` (fightstg.s:9074-9090 copies home -> live, instant at flag 0 or
    // through the same F0x8009b650 tween at flag != 0). This file used to invent a third,
    // a 30-tick ease home on every script end, which is what slid the DNA result model off its
    // staging point 30 ticks into segment 3; it is gone, and resetSlotPlacement() is the
    // placement re-arm the original does instead.
    this._move = { cur: [0, 0, 0], from: null, target: null, t: 0, ticks: 0 };
    this._rotation = [0, 0, 0];
    // The renderer already folds the PS1 D=Ry(2048) root basis into every
    // extracted model. Presentation actors can declare that authored basis so
    // their slot rotation is not applied a second time.
    this.rotationBase = 0;
    this.homeSlot = null;        // set by battle3d: {x,y,z, side} PS1 arena home
    this.idle = this._idlePlayer();
  }

  // op2 movement hook target. kinds: "to" (arena-absolute, already y/z-negated by the VM —
  // convert to a delta vs home), "contact" (±0x2800 z toward the opponent), "home" (delta 0).
  // tween = ticks (0 = instant; authored values ~25).
  //
  // "contact" IS side-aware and "to" is NOT, which is the original's own split: the mode-8
  // handler negates its 0x2800 offset on the slot's side nibble, while the mode-3 handler
  // stores (x, -y, -z) with no side test at all. The absolute targets are authored per side
  // in the data, exactly as the op3 effect and op6 projectile coordinates are — claim
  // fight-world-effect-coordinates-are-not-mirrored-per-side-2026-08-18.
  _onMove(rec) {
    const h = this.homeSlot;
    if (!h) return;
    // FIGHTSTG_F0x8008b7f4's movement arms, ported: mode 3 (arena-absolute, "to"), mode 7
    // ("home") and mode 8 ("contact"). The delta is target - home; "contact" alone is
    // side-aware (mode 8's `andi $s4,0xf0`), the absolute "to" target is not.
    const d = animSlotMoveDelta(rec, [h.x, h.y, h.z], h.side);
    const m = this._move;
    if (!rec.tween) { m.cur = d; m.target = null; return; }
    m.from = m.cur.slice(); m.target = d; m.t = 0; m.ticks = Math.max(1, rec.tween | 0);
  }

  // The write target the op2 mode-5 motion object (F0x8009b13c) drives every tick: the original
  // rewrites `slot+0x1e`/`slot+0x20` directly, so the leap must land on the SAME arena offset the
  // mode-3/7/8 moves use, not a parallel one. `sideSign` is the slot+0x4 == 0x10 direction flip.
  _slotAdapter() {
    const m = this._move;
    return {
      get sideSign() { return this.owner.homeSlot?.side === "enemy" ? -1 : 1; },
      owner: this,
      getY: () => m.cur[1], getZ: () => m.cur[2],
    // A motion object owns the slot outright — cancel any mode-3 tween still running into it.
      setY: (v) => { m.cur[1] = v; m.target = null; },
      setZ: (v) => { m.cur[2] = v; m.target = null; },
    };
  }

  _stepMove(speed) {
    const m = this._move;
    if (!m.target) return;
    m.t += speed;
    const a = Math.min(1, m.t / m.ticks);
    m.cur = m.from.map((v, i) => v + (m.target[i] - v) * a);
    if (a >= 1) { m.cur = m.target; m.target = null; }
  }

  /** Current movement delta in PS1 units [x, y(down), z], for battle3d to render-map. */
  moveDelta() { return this._move.cur; }
  rotation() { return this._rotation; }

  // FIGHTSTG_F0x80087f38: put the slot back on the arena home its own placement record names,
  // and drop any tween still travelling into it. This is the ONLY way back for a fighter the
  // original does not send home itself — the walker runs it when the actor is (re)built from a
  // model pack, which is exactly where the original builds a slot and seeds it.
  resetSlotPlacement(home = this.homeSlot) {
    if (home) this.homeSlot = home;
    // The original's only way back onto the arena home is FIGHTSTG_F0x8008b7f4 mode 7 (flag 0)
    // and the placement FIGHTSTG_F0x80087f38 — both "live = home". This actor stores its slot
    // as a DELTA from home, so that write is a zero delta; route it through the ported rule so
    // there is one copy of it.
    const slot = {
      live: { x: this._move.cur[0], y: this._move.cur[1], z: this._move.cur[2], rotX: 0, rotY: 0, rotZ: 0 },
      home: { x: 0, y: 0, z: 0, rotX: 0, rotY: 0, rotZ: 0 },
    };
    resetAnimSlotLiveToHome(slot);
    const m = this._move;
    m.cur = [slot.live.x, slot.live.y, slot.live.z];
    m.from = null; m.target = null; m.t = 0; m.ticks = 0;
  }

  _idlePlayer() {
    const base = (this.baseTable | 0) === 1 ? 1 : 0;
    this._timelineTable = base;
    const t = this.model?.timeline?.[base]?.table ?? this.model?.timeline?.[0]?.table;
    return t && t.length ? new TimelinePlayer(t) : null;
  }

  // Which timeline table is playing. FIGHTSTG_F0x80083a54 keeps this on the model
  // actor at +0x78 as `table + 1` — it is handed `animId` and plays directory member
  // `animId - 1`, and F0x80083f90 writes 1 there at creation, which is table 0, the
  // idle. Other code reads it back: the eye override in FIGHTSTG_F0x8008b118 holds
  // the eyes for particular values (claim
  // fightstg-model-actor-0x78-is-the-timeline-table-index-2026-08-18).
  get timelineTable() { return this._timelineTable | 0; }
  get animationId() { return (this._timelineTable | 0) + 1; }

  // op2 bind resolver handed to the ActionVM: timeline table `i` -> a fresh single-table sampler.
  // Falls back to the idle/rest table 0 when `i` is empty, so a clip never freezes on a missing table.
  // Carries the OUTGOING table's current frame into the new player so a leading aux=0xffff ease-in
  // blends from the previous pose instead of snapping at the boundary (see TimelinePlayer ctor). On
  // the first bind there's no outgoing player (vm.player null) -> no carry, which is correct.
  _playerForTable(i) {
    this._timelineTable = i | 0;
    const tl = this.model?.timeline;
    // Carry the outgoing pose: an op2 rebind eases from the previous table's frame; the FIRST table of
    // an action (no vm.player yet) eases from the current idle frame, so the windup blends in from idle
    // instead of snapping. (Action tables like Renamon 14 lead with an aux=0xffff ease-in.)
    const prev = this.vm?.player ? this.vm.player.currentFrame() : this.frame;
    const t = tl?.[i]?.table;
    if (t && t.length) return new TimelinePlayer(t, prev);
    const t0 = tl?.[0]?.table;
    return (i !== 0 && t0 && t0.length) ? new TimelinePlayer(t0, prev) : null;
  }

  // The ordered list of timeline tables a clip plays, read straight from its action script's op2
  // play-table records (op2[mode=0, slot, table>0]) in script order. DISC-faithful, per-model.
  // Used to SEED the slot with the clip's first table; the VM rebinds the rest as it executes.
  _clipTableSeq(clip) {
    return clipTableSeq(this.model, clip);
  }

  // Debug: play an arbitrary timeline table on loop (motion browser, to identify which table
  // is which motion). Not used by the game; drives the same `idle` slot tick() reads.
  debugPlayTable(table) {
    this.playTimelineTable(table);
  }

  // Play one raw authored timeline table.  Its own sentinel controls whether it loops or freezes.
  // Production battle presentation uses this for the verified victory table; the motion browser
  // uses the same path.
  playTimelineTable(table) {
    this.vm = null;
    this._dbgLoop = null;
    this._heldPose = false;
    this._holdFinalPose = false;
    this._handoffFrom = null;
    this._timelineCycleComplete = false;
    this.idle = (table && table.length) ? new TimelinePlayer(table) : this._idlePlayer();
  }

  // Debug (fight-action-lab): play an ORDERED SEQUENCE of timeline tables back-to-back via
  // PlaylistPlayer — the assembled action the user composes from the palette. loop=true rebuilds it
  // when the playlist ends so the action repeats for study. Not used by the live game.
  debugPlayPlaylist(tables, { loop = true } = {}) {
    this.vm = null;
    const list = (tables || []).filter((t) => t && t.length);
    this._dbgLoop = loop ? list : null;
    this.idle = list.length ? new PlaylistPlayer(list) : this._idlePlayer();
  }

  setIdle() {
    this.vm = null;
    this._dbgLoop = null;
    this._heldPose = false;
    this._holdFinalPose = false;
    this._timelineCycleComplete = false;
    this.idle = this._idlePlayer();
  }

  // An enemy model the player owns stands on the near side (or the reverse): its scripts aim the wrong way down the
  // arena unless turned around (side-mirror.js).
  _standsOnOtherSide() {
    const authored = authoredSide(this.model);
    return !!authored && !!this.homeSlot?.side && authored !== this.homeSlot.side;
  }

  // Start an action script for a clip index. Returns true if a VM was created, false if it
  // fell back to idle (no script / empty script). hooks = { onHit, onCamera, setLunge }.
  setAction(clip, hooks = {}, { currentEffect = null, currentMotion = null, holdFinalPose = false, element = 1 } = {}) {
    // a model with no such clip (an enemy-only species using a spell) gets one built from a donor's (clip-fallback.js)
    const script = (clip != null) ? resolveClipScript(this.model, clip, { element }) : null;
    // a donor-built script keeps its camera operands as the donor authored them (see clip-fallback.js)
    this._camFromDonor = script?.camAuthored === "donor";
    if (script && Array.isArray(script.ops) && script.ops.length) {
      this._clip = clip;
      this._heldPose = false;
      this._holdFinalPose = !!holdFinalPose;
      const h2 = {
        ...hooks,
        onMove: (rec) => { this._onMove(rec); hooks.onMove?.(rec); },
        onRotate: (rec) => {
          this._rotation = [rec.x, rec.y, rec.z];
          hooks.onRotate?.(rec);
        },
        onMotion: (motion) => {
        // op4 motion 0 is the authored return-to-base command at the end of attacks/techs.
        // Bind the BASE table immediately instead of leaving the prior table visible — base, not
        // table 0, so a badly hurt fighter returns to its low-HP stance (see baseTable).
          if (motion === 0 && this.vm) this.vm.player = this._playerForTable((this.baseTable | 0) === 1 ? 1 : 0);
          hooks.onMotion?.(motion);
        },
      };
      this.vm = new ActionVM(script, {
        timelineForTable: (i) => this._playerForTable(i), hooks: this._standsOnOtherSide() ? mirrorHooks(h2) : h2, currentEffect, currentMotion,
        baseTable: () => this.baseTable | 0,
        slot: this._slotAdapter(),
      });
    // Seed the slot with the clip's FIRST op2 table so currentFrame() is sane before tick 1. The VM
    // then binds each op2 table in order as it runs (reaction clips 10/17 bind via op2; clip 14 has
    // neither op2 nor op4 -> _playerForTable falls back to idle so it never freezes at frame 0).
      const seq = scriptTableSeq(script);
      this.vm.player = this._playerForTable(seq.length ? seq[0] : 0);
      return true;
    }
    this.setIdle();
    return false;
  }

  /** Run a verified external action stream against this model.  DNA/Jogress
   *  result clip 12 is supplied by the battle presentation actor rather than
   *  the result model's own action directory; op4 motion 30 selects table 30. */
  setScript(script, hooks = {}, { currentEffect = null, initialTable = null, motionTables = {} } = {}) {
    if (!script || !Array.isArray(script.ops) || !script.ops.length) return false;
    this._clip = -1;
    const h2 = {
      ...hooks,
      onMove: (rec) => { this._onMove(rec); hooks.onMove?.(rec); },
      onRotate: (rec) => {
        this._rotation = [rec.x, rec.y, rec.z];
        hooks.onRotate?.(rec);
      },
      onMotion: (motion) => {
      // Some presentation actors receive their action stream externally, so
      // there is no model-local op2 table bind.  Preserve the verified op4
      // timing by binding its extracted motion table only when op4 executes.
        const table = motionTables[motion];
        if (table != null && this.vm) this.vm.player = this._playerForTable(table);
        hooks.onMotion?.(motion);
      },
    };
    this.vm = new ActionVM(script, {
      timelineForTable: (i) => this._playerForTable(i), hooks: h2, currentEffect,
      baseTable: () => this.baseTable | 0,
      slot: this._slotAdapter(),
    });
    if (initialTable != null) this.vm.player = this._playerForTable(initialTable);
    return true;
  }

  // The THROW band's typed arm (the item machine FIGHTSTG_F0x8008d3b4's state-0 jump table at
  // 0x80082ee4, items 77-90): each arm names the clip AND the fresh actor's motion (+0x68),
  // effect (+0x6c) and sound (+0x70) — tools/extract_throw_item_effects.py. The clip runs with
  // the record's effect as its current effect (op3's 9999 sentinel) and its motion as the
  // actor's current motion (op4's 0x38 sentinel). `branch` picks item 88's STR/DEF effect pair;
  // `motion` overrides the record's motion (item 84's rand_u16()%7 roll is resolved by the
  // caller, which owns the RNG and the element draw it shares). No record -> false, so the
  // caller keeps the default-arm clip-10 entry.
  setAnimByThrowItem(itemId, hooks = {}, { branch = null, motion = undefined } = {}) {
    const rec = throwItemEffect(itemId);
    if (!rec) return false;
    const effect = (branch != null && rec.effect_branch && rec.effect_branch[branch] != null)
      ? rec.effect_branch[branch]
      : rec.effect;
    return this.setAction(rec.clip, hooks,
      { currentEffect: effect, currentMotion: motion !== undefined ? motion : rec.motion });
  }

  // The tech's clip AND its effect type (tech record +0x0e → the actor's +0x6c "current
  // effect", resolved by op3's 9999 sentinel). Both come from the extracted tech table;
  // techEffectType applies the F0x8008ee84 fallback (a zero +0x0e on a clip-5 basic plays
  // the fixed 0x2e effect).
  setAnimByTech(techId, hooks = {}) {
    const rec = techRecord(techId);
    return this.setAction(techToClip(techId), hooks, { currentEffect: techEffectType(rec), element: rec?.elem1 ?? 1 });
  }

  // The item's use clip AND its effect type: the item machine's default arm plays clip 10 and
  // writes the used item's record effect (0x800a336c record+2) into the actor's +0x6c, which
  // clip 10's op3 9999 spawn resolves (pro/fightstg.s .L0x8008d8c0). Both come from the
  // extracted item-use table; an item with no record leaves the effect unset (no write), as
  // the original leaves the fresh actor's field alone.
  setAnimByItem(itemId, hooks = {}) {
    const rec = itemUseEffect(itemId);
    return this.setAction(ITEM_USE_CLIP, hooks, { currentEffect: rec?.effect ?? null });
  }

  // "Active" = something authored is driving the frame (a running VM, or the idle table while
  // no VM runs). False only when the model lacks a timeline AND no VM — then battle3d falls
  // back to its legacy advanceFrame path.
  get isActive() {
    if (this.vm) return !this.vm.ended;
    return this._heldPose || !!this.idle;
  }

  get timelineCycleComplete() { return this._timelineCycleComplete; }

  tick(speed = 1) {
    const pf = this.frame, pb = this.blend;   // state BEFORE this tick (the render-interp "previous")
    if (this.vm) {
      if (!this.vm.ended) this.vm.step(speed);
      this.frame = this.vm.currentFrame();
      this.blend = this.vm.currentBlend ? this.vm.currentBlend() : null;
      this._stepMove(speed);
      if (this.vm.ended) {
        if (this._holdFinalPose) {
        // Death is a terminal presentation state: retain the action's final sampled frame and
        // stop ticking it.  coordinator.active still becomes false because the VM is cleared.
          this.vm = null;
          this.idle = null;
          this._heldPose = true;
          this.blend = null;
        } else {                              // ordinary action -> ease final pose into idle
          this._handoffFrom = this.frame; this._handoffT = 0;
        // The slot stays where the script left it: the original has no "return home when the
        // script ends" rule (see _move). Only op2 mode 7 or the placement re-arm moves it.
          this.setIdle();
        }
      }
    } else if (this.idle) {
      this._stepMove(speed);                  // finish any return-home tween while idling
      this.idle.step(speed);
      if (this.idle.looped || this.idle.ended) this._timelineCycleComplete = true;
    // fight-action-lab: re-loop a composed playlist so the assembled action repeats for study.
      if (this.idle.ended && this._dbgLoop) this.idle = new PlaylistPlayer(this._dbgLoop);
      this.frame = this.idle.currentFrame();
      this.blend = this.idle.blend ?? null;
    // Synthesize the action->idle ease: while the handoff is active, override the (blend-less) idle
    // pose with an ease FROM the action's last frame. t ramps 0->1; the displayed frame is the live
    // idle frame, so the pose morphs from the attack's end pose into the walking idle.
      if (this._handoffFrom != null) {
        this._handoffT += speed / HANDOFF_TICKS;
        if (this._handoffT >= 1) { this._handoffFrom = null; }
        else this.blend = { from: this._handoffFrom, t: this._handoffT };
      }
    }
    // Discontinuity = the frame jumped (a phase cut / blend boundary) or went backward (a loop-back).
    // Only a forward step within SNAP_THRESH is "continuous" and safe to interpolate the scalar over;
    // anything else snaps (the blend object, not the scalar, carries eased phase transitions).
    this._prevFrame = pf;
    this._prevBlend = pb;
    const d = this.frame - pf;
    this._snap = !(d >= 0 && d <= SNAP_THRESH);
    return this.frame;
  }

  currentFrame() { return this.frame; }

  // The pose blend ({from,t}) for this tick, or null — consumed by buildBoneWorldMatrices so
  // timeline blend segments morph the pose smoothly instead of snapping. See timeline-player.js.
  currentBlend() { return this.blend ?? null; }

  // The display (frame, blend) for THIS render, interpolated between the previous and current logic
  // tick by alpha = render-accumulator/stepDur ∈ [0,1] (classic fixed-timestep interpolation — the
  // 60Hz logic tick stays faithful; this only smooths the draw so a render rate that isn't phase-
  // locked to 60Hz doesn't beat-judder). Interpolation is suppressed across discontinuities (_snap);
  // during a blend phase the frame is held and blend.t is eased instead. buildBoneWorldMatrices
  // accepts a fractional frame (interpChannel), so the returned frame can be non-integer.
  renderSample(alpha = 0) {
    const a = alpha <= 0 ? 0 : alpha >= 1 ? 1 : alpha;
    const cf = this.frame, cb = this.blend;
    if (this._snap) return { frame: cf, blend: cb };
    if (cb) {                                 // blend in progress: frame is constant, ease blend.t
      const pb = this._prevBlend;
      const t = (pb && pb.from === cb.from) ? pb.t + (cb.t - pb.t) * a : cb.t;
      return { frame: cf, blend: { from: cb.from, t } };
    }
    return { frame: this._prevFrame + (cf - this._prevFrame) * a, blend: null };
  }
}
