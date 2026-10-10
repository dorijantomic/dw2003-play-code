// engine/systems/fire-trap.ts
//
// The Fire Dungeon floor trap (s740 / s741) — a native stage-event controller,
// not bytecode. Step on a marked patch of floor and a switch clicks; a moment
// later each Digimon walking with you is caught in an explosion and left on
// exactly 1 HP. It cannot kill you: the write is a store of the literal 1, not
// damage. Each patch is a ONE-SHOT — the event's on_complete sets that patch's
// own gate flag and its step record only fires while that flag is clear.
//
// DECODE (original assembly wstag740/wstag741, 2026-07-28) + the controlled
// PCSX-Redux replay in
// docs/research/field/captures/fire-dungeon-explosion-state4-2026-07-28.txt.
// Every constant here is EXTRACTED, not written down: tools/extract_fire_traps.py
// reads the party-actor key table, the wait threshold, the two packed sound ids
// and both sprite programs out of the overlay into web/assets/data/fire_traps.json,
// and cross-checks that each region's step gate and on_complete name the same flag
// (32/32 across the two stages). See that tool's header for the object graph.
//
// THE SEQUENCE, as the controller (wstag740 F0x800a5de4) runs it:
//
//   tick 0            leader into mode 1, scene lock up, play the arm sound
//                     (SWITCH02). Field control is gone from here.
//   tick 30           target 0 (party actor key 2 = the leader)
//   tick 60           target 1 (key 4)
//   tick 90           target 2 (key 8)
//   +30               release control; the framework runs on_complete → gate flag.
//
// Each target spawns the explosion at THAT actor's current (x, y), plays the
// blast sound (COMEX113), puts the actor in reaction mode, and stores 1 into its
// stored cur_hp. The actor lookup can fail — a party slot that is not walking
// with you simply has no explosion — and the original just falls through to the
// advance branch, so the wait still runs. Modelled the same way here.
//
// TIMEBASE. The waits are 30 native ticks (`slti 0x1e`). The replay's frame
// counter is not 1:1 with them: its three HP writes are 26 frames apart, the
// same sub-unity frame:tick ratio engine/systems/launch-pad.ts documents for the
// teleport pads. The one number the tables do not explain is the tail — the
// replay restored control 31 frames after the last explosion, longer than a
// 30-tick wait at that ratio. The extra is the controller's destroy/release
// handshake, which is not modelled; the tail below is one ordinary WAIT.
//
// THE EXPLOSION. Two layered sprite components, each driven by the overlay's
// generic {value, holdTicks} animator (the 3-argument one-shot variant — see
// advancePadScript, whose semantics this reuses exactly: value 0xff ends a
// component, 0x12c draws nothing that tick). Component 0 plays sprites 50→55 at
// a y-sort 240 ABOVE the Digimon, so it paints behind everything; component 1
// waits one blank entry then plays 56→67 at y-sort +20, in front. Both sprite
// runs are already in each stage's extracted point-sprite atlas.

import {
  advancePadScript, newPadCursor,
  PAD_CLIP_SCRIPT_BLANK, PAD_CLIP_SCRIPT_END,
  type PadCursor, type PadScriptEntry,
} from "./launch-pad.ts";

export interface FireTrapLayer {
  /** Added to the Digimon's y to get this component's y-sort baseline. */
  ysortDy: number;
  /** `{spriteId, holdTicks}` entries, terminated by spriteId 0xff. */
  program: readonly PadScriptEntry[];
}

export interface FireTrapRegion {
  eventId: number;
  /** Index into the stage's step program — the trigger grid's cell value. */
  stepIndex: number;
  /** Flag the step gates on (must be clear) and the on_complete sets. */
  gateFlag: number;
}

export interface FireTrapConfig {
  waitTicks: number;
  /** Field-party actor keys the controller walks, in order. */
  targetKeys: readonly number[];
  sounds: { arm: string; blast: string };
  layers: readonly FireTrapLayer[];
  traps: readonly FireTrapRegion[];
}

/** One live explosion: fixed at the position its Digimon had when it spawned. */
export interface FireTrapBurst {
  partyIndex: number;
  x: number;
  y: number;
  /** Per-layer current sprite id, or null while blank / after END. */
  sprites: (number | null)[];
  cursors: PadCursor[];
  ended: boolean[];
  get done(): boolean;
}

/** What the host must present this tick. */
export type FireTrapCue =
  | { kind: "sound"; id: string }
  /** This party member is hit right now: reaction pose + cur_hp = 1. */
  | { kind: "hit"; partyIndex: number }
  /** The sequence is over: give control back and set `gateFlag`. */
  | { kind: "end"; gateFlag: number };

export interface FireTrapRun {
  readonly bursts: readonly FireTrapBurst[];
  readonly finished: boolean;
  /**
   * Advance by `delta` ticks. `positionOf(partyIndex)` returns where that
   * Digimon is standing right now, or null if it is not in the field party.
   */
  tick(delta: number, positionOf: (partyIndex: number) => { x: number; y: number } | null): FireTrapCue[];
}

/** Sprite a component shows for `value`: END and BLANK both draw nothing. */
function spriteFor(value: number): number | null {
  return value === PAD_CLIP_SCRIPT_END || value === PAD_CLIP_SCRIPT_BLANK ? null : value;
}

function newBurst(cfg: FireTrapConfig, partyIndex: number, x: number, y: number): FireTrapBurst {
  return {
    partyIndex, x, y,
    cursors: cfg.layers.map(l => newPadCursor(l.program)),
    sprites: cfg.layers.map(l => spriteFor(l.program[0]?.[0] ?? PAD_CLIP_SCRIPT_END)),
    ended: cfg.layers.map(() => false),
    get done(): boolean { return this.ended.every(Boolean); },
  };
}

/**
 * Start a trap. `region` is the patch that was stepped on — its `gateFlag` comes
 * back with the final cue, so the caller sets exactly the flag the original's
 * on_complete would have.
 */
export function startFireTrap(cfg: FireTrapConfig, region: FireTrapRegion): FireTrapRun {
  const bursts: FireTrapBurst[] = [];
  let elapsed = 0;          // ticks since the switch clicked
  let fired = -1;           // index of the last target that went off
  let finished = false;
  let armed = false;

  return {
    bursts,
    get finished() { return finished; },
    tick(delta, positionOf) {
      const cues: FireTrapCue[] = [];
      if (finished) return cues;
      const spawnedThisTick = new Set<FireTrapBurst>();

      if (!armed) {                                  // tick 0: the switch click
        armed = true;
        cues.push({ kind: "sound", id: cfg.sounds.arm });
      } else {
        elapsed += delta;
      }

      // One target per WAIT, in key-table order. `>=` (not `===`) so a delta
      // larger than one tick cannot step over a target.
      while (fired + 1 < cfg.targetKeys.length &&
             elapsed >= (fired + 2) * cfg.waitTicks) {
        fired += 1;
        const at = positionOf(fired);
        if (at) {                                    // absent slot → no explosion
          const burst = newBurst(cfg, fired, at.x, at.y);
          bursts.push(burst);
          spawnedThisTick.add(burst);
          cues.push({ kind: "sound", id: cfg.sounds.blast });
          cues.push({ kind: "hit", partyIndex: fired });
        }
      }

      // A brand-new effect object does NOT animate on the tick it is built: its
      // own update runs the state-0 branch that frame (load cursor + first hold)
      // and only starts advancing on the next one. Without this the opening
      // sprite of each component would be one tick short.
      for (const b of bursts) {
        if (b.done || spawnedThisTick.has(b)) continue;
        cfg.layers.forEach((layer, i) => {
          if (b.ended[i]) return;
          const v = advancePadScript(b.cursors[i]!, layer.program, true, delta);
          if (v === PAD_CLIP_SCRIPT_END) { b.ended[i] = true; b.sprites[i] = null; }
          else b.sprites[i] = spriteFor(v);
        });
      }

      // Tail: one more WAIT after the last target, then control comes back.
      if (fired + 1 >= cfg.targetKeys.length &&
          elapsed >= (cfg.targetKeys.length + 1) * cfg.waitTicks) {
        finished = true;
        cues.push({ kind: "end", gateFlag: region.gateFlag });
      }
      return cues;
    },
  };
}

/** Total ticks from the switch click to control coming back. */
export function fireTrapDurationTicks(cfg: FireTrapConfig): number {
  return (cfg.targetKeys.length + 1) * cfg.waitTicks;
}

/**
 * The region whose step record the player is standing in, or null. `cellValue`
 * is the type-7 trigger grid byte under them, masked to its step index exactly
 * as the OnStep trigger VM masks it (low 5 bits; the top 3 are approach facing).
 */
export function fireTrapRegionAt(cfg: FireTrapConfig | null, cellValue: number | null): FireTrapRegion | null {
  if (!cfg || cellValue == null) return null;
  const idx = cellValue & 0x1f;
  return cfg.traps.find(t => t.stepIndex === idx) ?? null;
}
