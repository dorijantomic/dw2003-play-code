// Sequences an attacker action against a defender reaction. A thin top-level slice of the
// fightstg state machine: the attacker's authored opcode 1 records replace the opposing
// subordinate action actor. Mode 5 selects clip 1 for intermediate combo contacts; mode 0
// selects clip 2/3/4 for survive/death/miss. It also owns per-tick stepping of both actors
// so battle3d delegates here (no double-stepping).
//
// The reaction CHOICE is the shared op1 dispatch FIGHTSTG_F0x8008b69c, ported once in
// engine/dw3/battle-reaction-dispatch.ts: the coordinator supplies only its own data — the
// op1 mode word and the attack's outcome code (1 survive / 2 lethal / 3 miss, the value the
// standard attack setup writes to the attacker's +0x64) — and the port does the child
// replacement, the side inversion and the index arithmetic (+0x64+1 / the +0x90 counter).
// See docs/research/fight-3d/action-vm-dispatch.md §"op1 subordinate action actor".
import {
  REACTION_MULTI_HIT_CLIP, REACTION_HIT_CLIP, REACTION_DEATH_CLIP, REACTION_EVADE_CLIP,
} from "./fight-tables.js";
import {
  dispatchSubordinateActor, SUBORDINATE_MODE_SINGLE, SUBORDINATE_MODE_MULTI_HIT,
} from "../vendor/engine.js";

// The actor/context fields FIGHTSTG_F0x8008b69c reads and writes (offsets off the attacker
// action actor and its owner context). Kept as named constants so the port's inputs are the
// original's own fields, not a paraphrase.
const ACTOR_IP = 0x8c;        // the script instruction pointer (points at the mode word)
const ACTOR_SIDE = 0x50;      // the side flag the child inverts
const ACTOR_OUTCOME = 0x64;   // 1 survive / 2 lethal / 3 miss
const ACTOR_CONTACT = 0x90;   // mode-5 contact counter
const CONTEXT_CHILD = 0x3c;   // the owner's live subordinate child

// Distinct scratch words for the parent actor, its context, the mode word and the child; the
// port needs only addresses it can read and write. The child never runs here — the browser
// applies the selected index to its own ActorAnimator — so its allocator returns one fixed
// pointer and its destructor is a no-op.
const PARENT = 0x100, CTX = 0x200, MODE_CELL = 0x300, CHILD = 0x400;

/** A word memory backed by a Map, seeded with the parent actor's fields. */
function dispatchMemory(w) {
  return {
    read32: (a) => w.get(a) | 0,
    read16s: (a) => { const v = w.get(a) | 0; return (v << 16) >> 16; },
    write32: (a, v) => { w.set(a, v | 0); },
  };
}

export class FightCoordinator {
  constructor(player, enemy) {
    this.player = player;        // ActorAnimator (our fighter)
    this.enemy = enemy;          // ActorAnimator (opponent)
    this._defender = null;       // the actor that should react to the current attack
    this._reacted = false;       // one-shot: defender reaction started for this attack
    // EXPERIMENT (multiplayer many-vs-many): a function returning the extra ActorAnimators standing in the arena beside the
    // two main ones. Null in a normal fight, where this class behaves exactly as before.
    this.extraActors = null;
  }

  // Start an attack. attacker/defender are the two ActorAnimators (subset of player/enemy).
  // The original setup writes the attack outcome into the attacker's +0x64 (1 survive /
  // 2 lethal / 3 miss) and leaves the fresh +0x58/+0x5c/+0x60 slots zero; the op1 handler
  // adds one. Therefore authored op1 timing—not inferred op10 timing—starts defender clips
  // 1 (intermediate), 2 (survive), 3 (death), or 4 (evade).
  // hooks = optional extra hooks merged onto the attacker (e.g. FX/sound onHit from battle.js).
  // `defenderHooks`: hooks threaded into the defender's REACTION script (reaction clips carry
  // their own op10[99] received-impact effect + op5 impact-camera presets — decode 2026-07-05).
  attack(attacker, defender, techId, hooks = {}, { lethal = false, miss = false, defenderHooks = {} } = {}) {
    this._defender = defender;
    this._reacted = false;

    // The op1 handler's parent-actor block, seeded exactly as the standard attack setup leaves
    // it: side, the outcome code, a zero contact counter and three zero index bases.
    const words = new Map([
      [PARENT + ACTOR_IP, MODE_CELL],
      [PARENT + ACTOR_SIDE, attacker.homeSlot?.side === "enemy" ? 1 : 0],
      [PARENT + ACTOR_OUTCOME, miss ? 3 : lethal ? 2 : 1],
      [PARENT + ACTOR_CONTACT, 0],
      [PARENT + 0x58, 0], [PARENT + 0x5c, 0], [PARENT + 0x60, 0],
      [CTX + CONTEXT_CHILD, 0],
    ]);
    const mem = dispatchMemory(words);
    const host = { allocateActionActor: () => CHILD, destroyActionActor: () => {} };

    // Run one op1 mode word through the ported handler and return the child action index it
    // selected (0 when the mode is a no-op).
    const dispatch = (mode) => {
      // The op1 handler reads the mode word at the parent's IP; the caller (here the
      // coordinator, standing in for the dispatcher) points the IP at the mode word for
      // this call, exactly as the dispatcher's own IP would point at the live opcode.
      mem.write32(PARENT + ACTOR_IP, MODE_CELL);
      mem.write32(MODE_CELL, mode | 0);
      const r = dispatchSubordinateActor(PARENT, CTX, host, mem);
      return r.fired ? r.actionIndex : 0;
    };

    return attacker.setAnimByTech(techId, {
      ...hooks,
      onHit: (rec) => {
        hooks.onHit?.(rec);
      },
      onAuxAction: (rec) => {
        hooks.onAuxAction?.(rec);
        const mode = rec.mode | 0;
        if (mode === SUBORDINATE_MODE_MULTI_HIT) {
          const clip = dispatch(mode);
          if (clip) defender.setAction(clip, defenderHooks);
        } else if (mode === SUBORDINATE_MODE_SINGLE && !this._reacted) {
          this._reacted = true;
          const clip = dispatch(mode);
          if (clip) defender.setAction(clip, defenderHooks, { holdFinalPose: clip === REACTION_DEATH_CLIP });
        }
      },
    });
  }

  // One fixed PS1 logic tick for both actors.
  tick(speed = 1) {
    if (this.player && this.player.isActive) this.player.tick(speed);
    if (this.enemy && this.enemy.isActive) this.enemy.tick(speed);
    if (this.extraActors) for (const a of this.extraActors()) if (a.isActive) a.tick(speed);
  }

  // A sequence is in progress while either participant's action VM is still running.
  get active() {
    const a = this.player && this.player.vm && !this.player.vm.ended;
    const d = this._defender && this._defender.vm && !this._defender.vm.ended;
    const e = this.enemy && this.enemy.vm && !this.enemy.vm.ended;
    const x = !!this.extraActors && this.extraActors().some((t) => t.vm && !t.vm.ended);
    return !!(a || d || e || x);
  }

  // Whether an action SCRIPT owns the frame — one half of the original's camera arbitration. The
  // battle's camera director FIGHTSTG_F0x8008718c re-publishes its own record through the cut
  // [0xf8] on EVERY tick it runs (pro/fightstg.s:5096-5105), so while a script is driving an
  // actor its op5 record must not be cut over. The other half is the director's EXISTENCE: on the
  // confirm edge the command screen writes state 3 and the exe frees the object
  // (exe/fns.s:8883), so nothing re-publishes for the rest of the attack regardless of the VM —
  // the renderer's `directorRetired` (web/battle3d.js) carries that.
  //
  // This is the SAME question `get active` answers (any of the three actors' VMs running), and
  // it is the question the battle Lab already asks of this object. The field/game battle flow
  // asks it directly (web/battle.js update -> setCameraMode scriptOwnsCamera); the walker's old
  // SCRIPT_OWNED_CAMERA_STATES state list was removed 2026-10-08 (worker-bc) in favour of the
  // director's own resume/retire edges.
  cameraScriptOwned() {
    const running = (a) => !!(a && a.vm && !a.vm.ended);
    return running(this.player) || running(this.enemy) || running(this._defender)
      || (!!this.extraActors && this.extraActors().some(running));
  }
}
