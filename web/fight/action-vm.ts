// Per-actor action-script interpreter — a 1:1 port of the fightstg dispatch loop
// FIGHTSTG_F0x8008c590 (@.L0x8008c714) + the spine opcode handlers, per
// docs/research/action-vm-dispatch.md. Drives the render-only battle3d.js:
// it owns WHICH motion plays and WHEN events fire; the TimelinePlayer samples the frame.
//
// FAITHFUL OP2 SLOT MODEL (dispatch doc §g, RE 2026-06-21): op2 is the per-tick motion program.
// It binds ONE timeline table at a time into the slot (op2 [mode0, slot, table>0]) and the records
// our old decoder dropped are BLOCKING WAITS that gate when one table yields to the next:
//   - op2 [mode0, slot, 0]   → block until the bound table finishes (the slot done-flag; asm .L8bb04)
//   - op2 [5, slot, sub!=0]  → arm a sync ramp object (F0x8009b460): a 0→0x1000 fixed-point ramp
//   - op2 [5, slot, 0]       → block until that ramp reaches 0x1000 (its state +0xc hits >= 2)
// The sampler (TimelinePlayer = F0x80083c30) loops a 0x8000 table IN PLACE during a block — there is
// NO PlaylistPlayer / auto-advance in the engine (that was our bug: it snapped the looping move-back).
// A blocking op yields by REWINDING IP (re-runs next tick) until its condition clears; the motion
// keeps sampling each tick meanwhile, so a looping table (e.g. Renamon move-back table 17) loops.
//
// ⚠️ CORRECTED 2026-08-16 — op2 mode 5 is the SLOT MOTION object, not an opaque wait.
// The old reading paired the object built by FIGHTSTG_F0x8009b460 with the updater
// FIGHTSTG_F0x8009b4ec; that updater belongs to a DIFFERENT class. The factory hard-codes the
// class at 0x8009b13c (`lui $a0,0x800a; addiu $a0,-0x4ec4`), so the real per-tick updater is
// FIGHTSTG_F0x8009b13c (fightstg.s L25168-25370), and it DRIVES THE SLOT'S OWN POSITION:
//   +0x50 kind   +0x54 param   +0x58 distance   +0x5c slot   +0x60 arc amplitude
//   +0x68 rate   +0x6c accumulator t (0 → 0x1000)
// state 0 (init, L25185): distance = 0; kind 4 → `param + 0x2800`; kind 5 → |z − homeZ|;
//   then NEGATED when `slot+0x4 == 0x10` (the far side of the arena, L25207-25216).
// state 1 (per tick, L25227): the slot's own y/z are rewritten every tick —
//   kinds 1-3 → y = f(1,t,startY) − f(2,t,amp)            (an in-place hop, no travel)
//   kinds 4-6 → y = homeY − f(2,t,amp)                    (the leap's height arc)
//   kind 4    → z = homeZ + f(0,t,dist)                   (travel toward the target)
//   kind 5    → z = homeZ + dist − f(0,t,dist)            (travel back home)
//   then t += delta × rate; at t ≥ 0x1000 state 2 snaps the end pose and releases the wait.
// f = FIGHTSTG_F0x800a1f74(sel,t,mag) = (rsin(angle) · mag) >> 12, a full turn = 0x1000:
//   sel 0 → angle t/4      (0..90°)   ramp IN   0 → mag
//   sel 1 → angle t/4+0x400 (90..180°) ramp OUT mag → 0
//   sel 2 → angle t/2      (0..180°)  ARC       0 → mag → 0
// rsin is F0x8002abcc (odd, period 0x1000, 4096 = 1.0).
//
// THIS IS THE ENEMY APPROACH. 112 of the 241 models with a basic attack author their step-in as
// `op2 [5, slot, 4, param]`; only 8 use the mode-3 absolute move we already honoured (Kuwagamon is
// one of those 8 — which is why he was the one Digimon that closed the distance).
// The step `delta` IS D0x800a4464 (a per-tick VSYNC delta — RAM dumps read 3/4, not a constant; §g.3).

import {
  rampCurve, RAMP_TARGET, slotMotionKind,
  armSlotMotion, stepSlotMotion, handlerForOpcode,
  op1Handler, op2Handler, op3Handler, op4Handler, op5Handler, op6Handler, op7Handler, op10Handler,
  op11Wait,
} from "../vendor/engine.js";
// The motion curve, ramp target, per-kind table and the per-tick slot writer come
// from the ported system engine/dw3/battle-slot-motion.ts (FIGHTSTG_F0x800a1f74 /
// F0x8009b460 / F0x8009b13c / 0x800a365c), oracled against the original words by
// tests/engine/unit/battle-slot-motion-oracle.test.ts. The opcode table and yield
// set come from engine/dw3/battle-action-dispatcher.ts (FIGHTSTG_F0x8008c590),
// oracled by tests/engine/unit/battle-action-dispatcher-oracle.test.ts.
// op11's WAIT (FIGHTSTG_F0x8008c220) and op2's record-BLOCK (FIGHTSTG_F0x8008b7f4,
// the mode-5 sub-0 slot-motion wait) are the ported bodies too: the browser drives
// them (below) instead of hand-counting its own wait and ramp state.
export { rampCurve, RAMP_TARGET };

const TERM = (op) => op === 0 || op === 255;          // shared terminator path (finding f)
const STRIKE_TYPE = 99;                               // op10 type 0x63 = the damage strike (finding e)
const EFFECT_CURRENT = 9999;                          // op3 type 0x270f = actor's current-effect (+0x6c)
const OP_BUDGET = 256;                                // defensive cap on ops/tick (no terminator/wait)
const HOLD_CAP = 600;                                 // max ticks to hold on the terminator (~10s @ 60/s)
// LEGACY: the lab's speed slider only. The port reads the per-kind rate from the
// disc table 0x800a365c; MOVE_SPEED no longer drives the ramp. Kept so
// battle3d's debugSetMoveSpeed / the action lab keep working.
export let MOVE_SPEED = 64;
export function setMoveSpeed(n) { MOVE_SPEED = Math.max(1, n | 0); return MOVE_SPEED; }

// Slot stand-in for a VM with no actor attached (tests, the action lab). The live game passes the
// ActorAnimator's adapter so the motion object writes the fighter's real arena offset.
function detachedSlot() {
  const st = { y: 0, z: 0 };
  return {
    sideSign: 1,
    getY: () => st.y, getZ: () => st.z,
    setY: (v) => { st.y = v; }, setZ: (v) => { st.z = v; },
  };
}

export class ActionVM {
  constructor(script, { timelineForTable = null, baseTable = null, moveSpeed = MOVE_SPEED, hooks = {}, currentEffect = null, currentMotion = null, slot = null } = {}) {
    this.ops = Array.isArray(script?.ops) ? script.ops : [];
    this.timelineForTable = timelineForTable;   // (tableIndex) -> TimelinePlayer | null  (op2 bind)
    // () -> the actor's BASE idle table (the anim object's +0x18): 0 = normal idle, 1 = the low-HP
    // stance.  op2 mode 0 word 1 plays THIS, not table 1 (see _dispatchOp2).
    this.baseTable = baseTable;
    this.moveSpeed = moveSpeed;                 // legacy tuning knob (kept for the lab's speed slider)
    this.slot = slot || detachedSlot();         // the motion object's write target (F0x8009b13c +0x5c)
    this.hooks = hooks;
    this.currentEffect = currentEffect;         // actor +0x6c: the tech's effect type (op3 9999)
    // actor +0x68: the motion the machine wrote before the clip started (the item machine's typed
    // arms write it; techs leave it unset). Read by op4's 0x38 sentinel — a clip that plays "the
    // current motion" resolves it from here. null = no machine-supplied motion.
    this.currentMotion = currentMotion;
    this.ip = 0;
    this.player = null;          // active TimelinePlayer (the single slot's motion sampler)
    this.lastMotion = null;      // motionId of the last op4 envelope (0 = return-to-base)
    this.justHit = false;        // one-shot: true the tick the type-99 strike fires
    this._waitFlag = 0;          // actor +0x98: op11's wait state machine (ported)
    this._waitCount = 0;         // actor +0x9c: remaining wait ticks (ported)
    this._ramp = null;           // live slot motion object (F0x8009b460 result), or null
    this._frame = 0;             // fallback frame when no player is bound
    this._terminating = false;   // hit op255/op0 (or ran off end): holding until the motion finishes
    this._holdTicks = 0;         // ticks spent holding on the terminator (capped by HOLD_CAP)
    this._pActor = new Int32Array(0x40);   // scratch actor words for the ported handler bodies
    this._pCtx = new Int32Array(0x40);     // scratch context words for the ported handler bodies
    this.ended = this.ops.length === 0;
  }

  // One fixed PS1 logic tick. `delta` = D0x800a4464 (table-entries advanced this tick; the per-tick
  // VSYNC step). The motion sampler and the sync ramp both advance by it.
  step(delta = 1) {
    this.justHit = false;                 // reset the one-shot at the top of every tick
    this._portDelta = delta | 0;          // the per-tick step the ported handlers read (frameDelta)
    if (this.ended) return;

    // (1) the motion sampler advances every tick, independent of opcode execution — the bound table
    //     loops IN PLACE on a 0x8000 marker (TimelinePlayer) until a blocking op rebinds/releases.
    if (this.player) this.player.step(delta);
    // (1a) the slot motion object updates while armed — it drives the fighter's position every tick,
    //      including while a blocking op2 holds the script (F0x8009b13c state 1).
    this._stepRamp(delta);

    // (1b) HOLD on the terminator: the PS1 terminator (op0/op255) idles in place while the motion is
    //      still playing, then transitions out (dispatch finding f) — NOT an immediate end. The slot
    //      motion object outlives the script, so its landing pose must be written before the VM ends.
    if (this._terminating) {
      this._holdTicks += delta;
      if (this._motionSettled() || this._holdTicks > HOLD_CAP) {
        this.ended = true;
      }
      return;
    }

    // (2) The op11 wait is no longer counted here: the ported op11 (FIGHTSTG_F0x8008c220,
    //     op11Wait) owns the flag/countdown and yields by rewinding the record cursor, so the
    //     dispatch loop below re-runs the op11 record each tick until it releases.

    // (3) dispatch opcodes until a yield (wait / blocking op2 / terminator) or out of ops.
    let budget = OP_BUDGET;
    while (this.ip < this.ops.length && budget-- > 0) {
      const rec = this.ops[this.ip++];
      const op = rec.op;

      if (rec.unknown) continue;          // deferred inline-blob ops → no-op (Phase C decodes these)
      if (TERM(op)) {                     // op0/255 → hold while a motion is still playing, else end now
        this._terminating = true;
        // op4 motion 0 explicitly returned the actor to its base/idle envelope.  That table loops,
        // so waiting for player.ended would incorrectly pin the preceding tech/low-HP stance until
        // HOLD_CAP.  The script's authored waits already completed before this terminator.
        if (this._motionSettled()) this.ended = true;
        return;
      }

      switch (handlerForOpcode(op)) {
        case "op1": this._drivePort("op1", rec); break;      // subordinate action actor (ported)
        case "op2": {                                        // op2 slot motion controller (§g)
          if (!this._dispatchOp2(rec)) { this.ip--; return; } // blocked → rewind IP, yield
          break;
        }
        case "op3": this._drivePort("op3", rec); break;      // spawn/preload visual effect (ported)
        case "op4": this._drivePort("op4", rec); break;      // play-motion envelope (ported)
        case "op6": this._drivePort("op6", rec); break;      // projectile (ported; reuses the flight constructor)
        case "op7": this._drivePort("op7", rec); break;      // slot overlay spawn/free (ported)
        case "op10": this._drivePort("op10", rec); break;    // effect / strike (ported)
        case "op5": this._drivePort("op5", rec); break;      // camera (ported; reuses the look-at)
        case "op11": {                                       // wait N → the ported op11 yield
          if (Number.isInteger(rec.untilEntry)) {           // DW2 motion only (clip-fallback withDw2Body): hold until the body's strike pose
            if (this.player && !this.player.ended && (this.player.playhead | 0) < rec.untilEntry) { this.ip--; return; }
            break;
          }
          if (!this._driveWait(rec, delta)) { this.ip--; return; }
          break;
        }
        // "terminate" is handled above; null (ops 8/9 and 12..254) has no handler.
        default: break;
      }
    }
    if (this.ip >= this.ops.length) {                         // ran off the end → hold until motion ends
      this._terminating = true;
      if (this._motionSettled()) this.ended = true;
    }
  }

  // The terminator hold waits for the motion the script itself started. The settled cases:
  //   lastMotion === 0    op4 returned the actor to its base envelope (that table loops, so
  //                       waiting for player.ended would pin the pose until HOLD_CAP);
  //   lastMotion === null no table envelope was ever played by the script — a seeded idle
  //                       envelope must NOT pin the pose to HOLD_CAP (the op4-less typed item
  //                       clips 14/17), but a slot RAMP (op2 mode 5) still has to land;
  //   otherwise           the bound table has ended and no slot motion is still running.
  _motionSettled() {
    if (this.lastMotion === 0) return true;
    if (this.lastMotion === null) return !this._rampBusy();
    return (!this.player || this.player.ended) && !this._rampBusy();
  }

  // op2 [mode, slot, table?] — returns false if this op BLOCKS (caller rewinds IP and yields this tick),
  // true if it executed and the dispatch should continue. mode/slot/table = words[0]/[1]/[2].
  _dispatchOp2(rec) {
    const words = rec.words;
    const mode = words[0] | 0;
    const table = words[2] | 0;          // only meaningful for the modes that carry a 3rd word
    if (mode === 0) {
      // Word 1 is NOT table 1. The original's mode-0 arm special-cases it (.L0x8008b8e4 ->
      // .L0x8008b90c): it reads the actor's latched BASE table from the anim object's +0x18 and
      // requests animId base+1 — "go back to your resting pose". The base is 0 (normal idle) and
      // becomes 1 (the low-HP stance) only when the engine plays animId 2 for a badly hurt
      // fighter (.L0x80084098-.L0x800840b8). Nearly every action script ends with this record, so
      // binding table 1 literally left every Digimon standing in the near-death stance after a
      // technique. Word >= 2 requests animId word+1, i.e. timeline table `word`, unchanged.
      if (table === 1) {
        const p = this.timelineForTable?.((this.baseTable?.() | 0) || 0);
        if (p) this.player = p;
        return true;
      }
      if (table > 1) {                   // bind/select this table into the slot (method_0x188 analog)
        const p = this.timelineForTable?.(table);
        if (p) this.player = p;
        return true;
      }
      // [mode0, slot, 0] → BLOCK until the bound table's done-flag (slot +0x10) is set. The
      // ported op2 mode-0 arm (op2Handler) owns that read, the continue flag and the cursor
      // rewind; the browser supplies the flag's value (its motion sampler's `ended`).
      return this._portOp2BoundWait(rec);
    }
    if (mode === 5) {
      const sub = table;                 // mode-5's 3rd word selects the motion kind / wait
      // [5, slot, kind] → build the slot motion object (F0x8009b460). Kind 4 alone carries a 4th
      // word (.L0x8008b9b4 reads one extra operand and passes it as a2 = the distance trim).
      if (sub !== 0) { this._armRamp(sub, words[3] | 0); return true; }
      // [5, slot, 0]: the original reads the motion object pointer at context+0x4 (asm .L0x8008b958)
      // and PASSES if it is null, otherwise blocks until its state +0xc reaches 2. The ported op2
      // owns that decision and the rewind; the browser supplies the object's state and its cursor.
      // The object PERSISTS in the context after it lands (state 3), so a later [5,0,0] still
      // releases — this is why the ramp is kept rather than cleared.
      if (this._ramp != null) return this._portOp2Wait(rec);
      // [5, slot, 0] with NO ramp armed → fall back to the slot done-flag and BLOCK until the bound
      // table ends (same as the mode-0 done-wait). USER GROUND TRUTH 2026-06-21: the in-game attack
      // plays the full swing arc (Renamon table 15) which this gates; treating it as pass-through
      // (the bare asm reading: null context+0x4 → return 1) let the next bind overwrite the swing
      // table unplayed. See action-vm-swing-arc.test.js and original-fight-engine.md §7.
      return !this.player || this.player.ended;
    }
    // ACTOR MOVEMENT modes (decoded 2026-07-05, jump table @0x80082e58 in F0x8008b7f4):
    //   mode 3 [x,y,z,flag] → move the slot to an ARENA-ABSOLUTE target (y,z negated in the
    //           handler); flag=0 instant, else tweened (F0x8009b650) — the signature leap.
    //   mode 7 [flag]       → return to the HOME position (slot+0x28) — instant or tweened.
    //   mode 8 [flag]       → move to the CONTACT position: home.z ± 0x2800 toward the
    //           opponent (sign = slot side flag) — the basic-attack dash. Instant when 0.
    //   modes 1/2 = slot visibility flag (+0x34); 4 = set +0x22 vector; 9 = slot release.
    if (mode === 3) {
      const w = words;
      this.hooks.onMove?.({ kind: "to", x: w[2] | 0, y: -(w[3] | 0), z: -(w[4] | 0), tween: w[5] | 0 });
      return true;
    }
    if (mode === 4) {
      // Slot secondary transform vector (+0x22/+0x24/+0x26). The handler
      // copies X and negates Y/Z; these are PS1 rotation angles (4096=360°).
      const neg = (v) => v ? -v : 0;
      this.hooks.onRotate?.({ x: words[2] | 0, y: neg(words[3] | 0), z: neg(words[4] | 0) });
      return true;
    }
    if (mode === 7) { this.hooks.onMove?.({ kind: "home", tween: words[2] | 0 }); return true; }
    if (mode === 8) { this.hooks.onMove?.({ kind: "contact", tween: words[2] | 0 }); return true; }
    // modes 1/2 = slot visibility (+0x34): 1 shows, 2 hides. The DNA clip-12 presentation
    // stages its parent/result actors entirely through these, so surface them with the slot id
    // and let the owner decide which slot the on-screen actor currently embodies.
    if (mode === 1 || mode === 2) {
      this.hooks.onVisibility?.({ slot: words[1] | 0, visible: mode === 1 });
      return true;
    }
    // Mode 6 assigns a model/resource id to a presentation slot; mode 9 releases
    // that slot. The browser's single-actor renderer cannot own the native slot
    // table itself, so surface the exact lifecycle records to its presentation
    // owner (DNA clip 12 is the first consumer) while preserving VM timing.
    if (mode === 6) {
      this.hooks.onModelAssign?.({ slot: words[1] | 0, model: words[2] | 0 });
      return true;
    }
    if (mode === 9) {
      this.hooks.onSlotRelease?.({ slot: words[1] | 0 });
      return true;
    }
    return true;
  }

  // The write target the ported slot-motion object (engine/dw3/battle-slot-motion.ts,
  // FIGHTSTG_F0x8009b13c) drives. The original tests the slot's side nibble +0x4 == 0x10
  // (the far side) and reads the slot's home y/z at +0x2a/+0x2c; the browser's arena offset
  // is a delta from the home placement, so home is 0.
  _motionSlot() {
    const s = this.slot;
    return {
      sideFlag: s.sideSign === -1 ? 0x10 : 0,
      getY: () => s.getY(), setY: (v) => s.setY(v),
      getZ: () => s.getZ(), setZ: (v) => s.setZ(v),
      homeY: () => 0, homeZ: () => 0,
    };
  }

  // FIGHTSTG_F0x8009b460 + the init state of its updater F0x8009b13c: build the slot motion object.
  // The factory, the distance arithmetic and the amp/rate table are the port's; `param` is
  // meaningful for kind 4 only. The object starts in state 0 and its first tick runs the
  // state-0 fall-through.
  _armRamp(kind, param) {
    const k = slotMotionKind(kind);
    if (!k) { this._ramp = null; return; }
    this._ramp = armSlotMotion(kind, param, this._motionSlot());
    this.hooks.onRamp?.({ kind, param, dist: this._ramp.dist });
  }

  // FIGHTSTG_F0x8009b13c: one call of the port's updater. State 0 seeds t = delta*rate and
  // falls through into state 1 (pose + advance + arm state 2); state 2 writes the landing
  // pose and finishes (state 3). This is the FIX for the documented one-tick release
  // divergence — the browser used to advance its timer first and release one call late.
  // The object is KEPT after it finishes (state 3), like the original's context+0x4 slot.
  _stepRamp(delta) {
    const r = this._ramp;
    if (!r || (r.state | 0) >= 3) return;
    stepSlotMotion(r, this._motionSlot(), delta);
  }

  // True while the slot motion object still owes a pose (states 0..2). The terminator
  // hold waits on it so the landing pose is written before the VM ends.
  _rampBusy() { return this._ramp != null && (this._ramp.state | 0) < 3; }

  // ── the ported opcode bodies ──────────────────────────────────────────────────
  // The opcodes this VM used to hand-write are now the ported handler bodies
  // (engine/dw3/battle-action-opcodes.ts). `_drivePort` gives the port the decoded
  // record words through a scratch memory and a host whose calls render through this
  // VM's hooks — the browser supplies data, the port owns the control flow. The VM's
  // own record cursor already encodes each handler's operand count (the decoder), so
  // the port's returned IP is not used here.
  _portMem(rec) {
    const OP = 0x30000000, ACT = 0x30010000, CTX = 0x30020000;
    const ops = rec.words, actor = this._pActor, ctx = this._pCtx;
    const arr = (a) => (a >= ACT && a < CTX ? actor : ctx);
    const idx = (a) => ((a >= ACT ? a - ACT : a - CTX) >>> 2) & 0x3f;
    const half = (a) => {
      const arr2 = arr(a), w = arr2[idx(a)] | 0;
      return ((w >>> ((a & 2) ? 16 : 0)) & 0xffff) << 16 >> 16;
    };
    return {
      read16s: (a) => {
        if (a >= OP && a < OP + 0x40) { const w = (a - OP) >>> 1; return (((ops[w] ?? 0) & 0xffff) << 16) >> 16; }
        return half(a);
      },
      read32: (a) => (a >= OP && a < OP + 0x40) ? 0 : (arr(a)[idx(a)] | 0),
      write32: (a, v) => { if (a < OP || a >= OP + 0x40) arr(a)[idx(a)] = v | 0; },
    };
  }

  _portHost(rec, slotBase = 0) {
    const self = this;
    const fx = () => { self._effect(rec.words); };
    const playMotion = () => { self.lastMotion = rec.words[1]; self.hooks.onMotion?.(rec.words[1]); };
    const host = {
      managerFetch: () => 0,
      slotKeyResolve: () => 0, animSlotResolve: () => slotBase, animSlotPlace: () => {},
      slotMotionState: () => (self._ramp ? (self._ramp.state | 0) : 0),
      frameDelta: () => self._portDelta | 0,
      effectPreload: () => { fx(); return 1; },
      effectSpawn: () => { fx(); return 0; },
      effectStrike: () => {
        self.hooks.onHit?.({ type: rec.words[0], words: rec.words });
        if (rec.words[0] === STRIKE_TYPE) self.justHit = true;
        return 0;
      },
      projectileFile: () => { self.hooks.setLunge?.({ sub: rec.words[0] | 0, words: rec.words }); return 0; },
      projectileReady: () => 1,
      projectileBuild: (_e, id, vecA, vecB) => {
        self.hooks.setLunge?.({ sub: 0, id, from: [...vecA], to: [...vecB] });
        return 0;
      },
      cameraView: () => { self.hooks.onCamera?.({ words: rec.words }); },
      cameraArm: () => {},
      motionSelect: playMotion, motionProbe: playMotion, motionReady: () => 0,
      overlaySpawn: (arg) => { self.hooks.onOverlay?.({ type: rec.words[0] | 0, duration: rec.words[1] | 0 }); return 0; },
      overlayFree: () => { self.hooks.onOverlay?.({ type: rec.words[0] | 0, duration: rec.words[1] | 0 }); },
      allocateActionActor: () => { host.fired = true; return 0; },
      destroyActionActor: () => {},
      fired: false,
    };
    return host;
  }

  _drivePort(name, rec) {
    const OP = 0x30000000, ACT = 0x30010000, CTX = 0x30020000;
    this._pActor.fill(0); this._pCtx.fill(0);
    const mem = this._portMem(rec);
    mem.write32(ACT + 0x8c, OP);                       // the handler's IP = the operand scratch
    mem.write32(ACT + 0x50, this.slot?.sideSign === -1 ? 1 : 0);   // side
    mem.write32(ACT + 0x68, this.currentMotion ?? this.lastMotion ?? 0);   // the actor's current motion
    // actor+0x6c is the CURRENT EFFECT (op3's 9999 sentinel reads it: fightstg.s .L0x8008bcc0).
    // actor+0x70 is a DIFFERENT field — the CONTACT SOUND op10's 0x62/0x63 strike reads
    // (F0x8008c454). The browser resolves that sound itself in battle3d (contactSoundTypeFor)
    // and the ported op10 does not consume the value, so the effect stands in for it here.
    mem.write32(ACT + 0x6c, this.currentEffect || 0);
    mem.write32(ACT + 0x70, this.currentEffect || 0);
    const host = this._portHost(rec);
    const fn = { op1: op1Handler, op3: op3Handler, op4: op4Handler, op5: op5Handler, op6: op6Handler, op7: op7Handler, op10: op10Handler }[name];
    if (fn) fn(ACT, CTX, host, mem, { projectiles: [] });
    if (host.fired) this.hooks.onAuxAction?.({ mode: rec.words[0] | 0 });
  }

  // op11 F0x8008c220 — the WAIT YIELD, driven by the port. The port's op11Wait owns the
  // +0x98/+0x9c wait state machine; it returns false while the wait is armed (the caller
  // rewinds the record cursor) and true in the tick it releases (continue). The browser's
  // `delta` is the per-tick frame step the original reads at D0x8004df9c.
  _driveWait(rec, delta) {
    const a = { ip: 0, waitFlag: this._waitFlag | 0, waitCount: this._waitCount | 0 };
    const released = op11Wait(a, rec.words[0] | 0, delta | 0, 1);
    this._waitFlag = a.waitFlag | 0;
    this._waitCount = a.waitCount | 0;
    return released;
  }

  // op2 mode 5 sub 0 F0x8008b7f4 — the record BLOCK, driven by the port. With a slot-motion
  // object armed (ctx+0x4), the port's op2Handler returns cont 0 (yield + rewind to the opcode
  // word) while the object's state +0xc < 2 and cont 1 when it releases. Returns true to continue.
  _portOp2Wait(rec) {
    const OP = 0x30000000, ACT = 0x30010000, CTX = 0x30020000;
    this._pActor.fill(0); this._pCtx.fill(0);
    const mem = this._portMem(rec);
    mem.write32(ACT + 0x8c, OP);        // the handler's IP = the operand scratch
    mem.write32(CTX + 0x4, 1);          // the armed slot-motion object's presence (ctx+0x4 != 0)
    const res = op2Handler(ACT, CTX, this._portHost(rec), mem);
    return res.cont === 1;
  }

  // op2 mode 0 sub 0 F0x8008b7f4 — the BOUND-TABLE WAIT, driven by the port. The ported op2
  // mode-0 arm (op2Handler) reads the anim slot's own done-flag at +0x10; while it is zero it
  // returns cont 0 and rewinds to the record's opcode word. The browser supplies the flag's
  // value: its motion sampler sets it when the bound timeline table finishes (`player.ended`).
  _portOp2BoundWait(rec) {
    const OP = 0x30000000, ACT = 0x30010000, CTX = 0x30020000;
    this._pActor.fill(0); this._pCtx.fill(0);
    const mem = this._portMem(rec);
    mem.write32(ACT + 0x8c, OP);           // the handler's IP = the operand scratch
    const slotBase = ACT + 0x80;           // the scratch anim slot the port's +0x10 read addresses
    mem.write32(slotBase + 0x10, (!this.player || this.player.ended) ? 1 : 0);
    const res = op2Handler(ACT, CTX, this._portHost(rec, slotBase), mem);
    return res.cont === 1;
  }

  // op1 FIGHTSTG_F0x8008b69c consumes one mode word. Only modes 0 and 5
  // have behavior: both replace owner+0x3c with a subordinate action actor;
  // mode 0 selects actor+0x64 + 1, while mode 5 cycles
  // actor+0x58/+0x5c/+0x60 and adds 1. Those source fields are populated by
  // the owning battle state, so expose the replacement request to that owner.
  // All other modes are native no-ops.
  _auxAction(words) {
    const mode = words[0] | 0;
    if (mode === 0 || mode === 5) this.hooks.onAuxAction?.({ mode });
  }

  currentFrame() { return this.player ? this.player.currentFrame() : this._frame; }

  // The active motion sampler's pose blend ({from,t}) this tick, or null. Lets the renderer
  // interpolate transitions (timeline blend segments) instead of snapping between phases.
  currentBlend() { return this.player ? (this.player.blend ?? null) : null; }

  // op4: the motion ENVELOPE (sentinel 56 = current motion, 0 = return-to-base/idle, else a direct id).
  // The per-frame table SEQUENCE is the op2 stream (§g), so op4 does NOT bind a table here — it only
  // records the envelope (motion 0 lets the ActorAnimator return to idle once the script terminates).
  _playMotion(words) {
    this.lastMotion = words[1];
    this.hooks.onMotion?.(words[1]);
  }

  // op3 — the VISUAL EFFECT opcode (decode 2026-07-05, tech-effects-decode.md; the old "no-op"
  // reading is falsified). sub=1 [sub,type] = async preload (a browser no-op — assets are local —
  // but surfaced for the lab); sub=0 [sub,type,x,y,z] = spawn at an actor-relative position.
  // type 9999 = the actor's current-effect field +0x6c (the tech record's effect type).
  // z = 32767 / -1 → screen-space draw (F0x8008921c), else world-space via the battle camera.
  _effect(words) {
    const sub = words[0] | 0;
    let type = words[1] | 0;
    if (type === -1) return;
    if (type === EFFECT_CURRENT) {
      if (this.currentEffect == null) return;   // no current effect set → faithful skip
      type = this.currentEffect | 0;
    }
    if (sub === 1) { this.hooks.onEffectPreload?.(type); return; }
    this.hooks.onEffect?.({ type, x: words[2] | 0, y: words[3] | 0, z: words[4] | 0 });
  }

  // op6 sub=0: [sub,id, x,y,z, x2,y2,z2]; the handler negates Y,Z of each vector
  // (PS1 Y-down/Z convention). sub=1 is the auto-target path (no explicit vectors).
  _lunge(words) {
    const neg = (v) => (v === 0 ? 0 : -v);   // avoid -0 leaking into offsets
    if (words[0] === 0 && words.length >= 8) {
      return {
        sub: 0,
        id: words[1] | 0,      // projectile registry id (@0x800a2550 -> MEFT00xx pack)
        from: [words[2], neg(words[3]), neg(words[4])],
        to:   [words[5], neg(words[6]), neg(words[7])],
      };
    }
    return { sub: words[0], words };
  }
}
