// The battle's idle cut director — now a thin adapter onto the engine port.
//
// FIGHTSTG_F0x8008718c is ported in engine/dw3/battle-idle-director.ts (read that module's
// header for the disassembly anchors: the four shot lists at 0x800a24b8, the three-byte walk at
// 0x800a2518, the raw-delta dwell, the ten sub-state arms and the state-0/state-3 blocks). This
// file no longer holds a second copy of the routine: it creates the engine director and reaches
// it through the built bundle web/vendor/engine.js, so the browser and the oracle run the one
// implementation.
//
// The one thing the adapter does beyond re-exporting is fold the routine's state-0 tick into the
// first update: the original's first call is a pure setup tick that takes the arena shot and
// returns WITHOUT cutting, and the browser's director has always folded that into construction.
// `update` primes once, then delegates, so the visible trajectory is unchanged.

import {
  createIdleDirector as engineDirector,
  createIdleClock,
  idleDirectorTick as engineTick,
  idleSubState, idleNextRow, idleShotEntry, idleRowLength, idleSpinYaw,
  IDLE_TURN_UNITS, IDLE_SPIN_PER_DELTA, IDLE_HALF_TURN_UNITS, IDLE_ROW_END,
  IDLE_SHOT_TABLE, IDLE_ROW_WALK, IDLE_SUB_STATES,
} from "../vendor/engine.js";

export {
  createIdleClock, idleSubState, idleNextRow, idleShotEntry, idleRowLength, idleSpinYaw,
  IDLE_TURN_UNITS, IDLE_SPIN_PER_DELTA, IDLE_HALF_TURN_UNITS, IDLE_ROW_END,
  IDLE_SHOT_TABLE, IDLE_ROW_WALK, IDLE_SUB_STATES,
};

/**
 * The battle's idle cut director, over the engine port.
 *
 * `createIdleClock`'s value handed to `update` is the raw per-frame delta (1 a frame) — the
 * frames SINCE the last tick, never the running total. The engine director's first `update` is
 * the original's state-0 setup tick; this wrapper primes it away so the first cut of the battle
 * is row 3's arena shot, exactly as before.
 */
export function createIdleDirector(opts = {}) {
  const director = engineDirector(opts);
  let primed = false;
  return {
    update(delta) {
      if (!primed) { director.prime(); primed = true; }
      return director.update(delta);
    },
    reset() { return director.reset(); },
    // The terminal state-3 tick the command screen's confirm edge drives (see the engine
    // module): re-cut the plain arena shot, then the object is gone.
    retire() { return director.retire(); },
    state() { return director.state(); },
  };
}

/** The record the director cuts this tick, or null while the director does not exist. */
export function idleDirectorTick(director, clock, dt, exists) {
  if (!exists) return null;
  return director.update(clock.tick(dt)).fields;
}
