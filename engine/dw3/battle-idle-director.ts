// The battle's idle cut director — the port of FIGHTSTG_F0x8008718c
// (fightstg.s:4508-5147) into the engine, so the browser consumes the port instead of a
// second copy of the routine's own logic.
//
// THE module for "which shot the idle battle camera shows, and for how long". Before the
// browser file web/fight/battle-idle-director.js this was a weighted-random pick over five
// hand-typed shots with a dwell drawn from a tuned band — a stand-in for this routine's data
// table, and that table is static data in the disc.
//
// ── The routine, and what its words mean ──────────────────────────────────────
//
// It is a base-class state machine. `F0x800143dc`/`F0x80014504` (exe/fns.s) install the default
// methods at object+0x28..+0x44 and the caller's callback at +0x48, so:
//
//   self+0x0c  state        (0 setup, 1 hold, 2 nothing, 3 re-cut the arena shot)
//   self+0x10  sub-state    (0..10; anything else takes the default arm)
//   self+0x14  sub counter  (each arm's setup runs once, on the tick the sub-state is set)
//   self+0x50  shot provider object (`[0x100]` arena shot, `[0x104](side,index)` canned shot,
//                             `[0xf8]` cut the staged record) — allocated by state 0
//   self+0x54  the staged camera record this tick (the 14 words the arms fill)
//   self+0x58  anim object (`[0x188](key)` resolves a fighter's animation slot by key; key 0 is
//                             the near side, 0x10 the far side) — allocated by state 0
//   self+0x5c  row A        (which list of shots is being walked)
//   self+0x5e  index B      (how far into that list)
//   self+0x60  the shot's carried Y angle
//   self+0x62  the spun angle since the last default-arm setup
//   self+0x64  the dwell counter
//   self+0x68  spin speed (always 1 in the disc's arms)
//
// `[self+0x2c]` is NOT the director's own code: +0x2c is the base class's `SetSub1`
// (`F0x80014288`, exe/fns.s — `sw $a1,0x10($a0)`), and `[self+0x38]` is `AdvState`
// (`F0x800142ac` — clear +0x10/+0x14/+0x18, `+0xc += 1`). That is why the second halfword of
// every table entry is a small integer that lands on the sub-state dispatch, and why state 0
// falls into state 1 by itself.
//
// ── The dwell is a frame count, and the clock is the RAW per-frame delta ──────
//
// `self+0x64` is loaded from the table and decremented once per tick by `*(0x8004df9c)()` — the
// word at 0x8004de28, 1 a frame. Not the walker's seconds, and not the slow-motion-published
// delta. At the real value of 1 the dwell in the table below is 90..1920 FRAMES, i.e. 1.5 s to
// 32 s.
//
// ── The shot list is four lists, and the choice between them is one RAND ──────
//
// The table at 0x800a24b8 is four rows of six halfword PAIRS on a 0x18 stride, each pair
// `(dwell, sub-state)`, terminated by a pair whose low halfword is -1 (fightstg.s:32890-32908):
//
//   row 0 @0x800a24b8  1800→1    480→9  360→3  300→4  480→9   (0x0000ffff ends it)
//   row 1 @0x800a24d0   360→6    900→1  300→5  480→9   (0x0000ffff)
//   row 2 @0x800a24e8  1920→1    360→6  180→7  480→9   (0x0000ffff)
//   row 3 @0x800a2500    90→10     90→5                  (0x0000ffff)
//
// There is no weight, no range and no "not the same shot twice" test: inside a row the order is
// FIXED. The only randomness is which row comes next, and it is a single call to
// `*(0x8004dc0c)()` followed by `rand % 3` (fightstg.s:4612-4628). That remainder indexes three
// BYTES out of the byte table at 0x800a2518, three per row (fightstg.s:32914-32917):
//
//   row 0 → {1,2,1}   row 1 → {0,2,2}   row 2 → {0,1,0}   row 3 → {0,1,2}
//
// so it is a three-way random walk over four lists, and a row CAN repeat itself. The director
// opens on row 3 (`li $v0,0x3` → `sh` to 0x5c, fightstg.s:4529-4531), which is why a battle
// begins with a plain arena shot and not with the long spun one.
//
// ── The random source, and its seed ─────────────────────────────────────────
//
// `[0x8004dc0c]` is `rand_u16` (exe/fns.s:10116-10134):
//   RAND_TABLE_CUR_IDX = (RAND_TABLE_CUR_IDX + 1) & 0xfff ; return RAND_TABLE[idx]
// `RAND_TABLE` is 4096 halfwords at 0x8004bc04, the index a word at 0x8004dc04 that starts at
// 0. The port of that table walk is engine/dw3/random-stream.ts, reached as `RAND_U16`
// (engine/dw3/battle-formulas.ts) — the SAME stream every battle roll draws from, in the order
// the disc draws it. Tests inject their own.
//
// ── What the sub-states are, and the slow turn each hold makes ───────────────
//
// The dispatch is a ten-entry table at 0x80082d08 (fightstg.s:28-37) indexed by `sub-state - 1`;
// sub-state 1 (which rows 0 and 2 lead with), sub-state 0 and anything above 10 all fall into
// the default arm at 0x80087418. Each arm fills the staging block self+0x54 and the routine then
// cuts it through `[0xf8]` on EVERY tick it runs (:5096-5105), so the turn you see while a shot
// is held is the record being re-cut, not a separate pan.
//
// Most arms add `delta * 2` to the record's +0x26 — its Y (yaw) angle, 4096 units to a turn —
// every frame, wrapping at 0x1000 (:5060-5081 up, :4927-4930 down). Because a canned shot's
// anchor is zeroed (F0x800923b4) that yaw turns the whole shot about the arena origin: the
// original's idle camera ORBITS while it holds. Only the default arm seeds the yaw from the
// carried angle, so the orbit phase is continuous across a cut there and starts from zero in the
// arms that take a canned shot.
//
// ── What resets it ───────────────────────────────────────────────────────────
//
// State 3 (:5116-5142) re-flags both fighters (sets their slots' +0x34), re-takes the arena shot
// and cuts it. It does NOT touch +0x64, +0x5c or +0x5e, so a reset returns to the arena shot for
// the rest of the dwell already running and then carries on down the same list. The dwell
// additionally ends EARLY, from inside the default arm, when the battle's own word at 0x80042b28
// has 4 in its low nibble and the arm has turned at least 0x801 units (:4730-4742) — 0x80042b28
// is the encounter record's `param`, documented as the default motion id with 8 as its default,
// so the common battle never takes this path.
//
// ── Who owns it, and the edge that retires it ───────────────────────────────
//
// The director is stored — as child slot 6 of the fightstg command-menu phase `F0x80092684`
// (`F0x800143dc(0x80092684, 0x6c, 0x1c, 0xe)`, fightstg.s:16486-16498). The phase creates it
// lazily into `child[6]` at three "build a row's children" arms (fightstg.s:16154-16160,
// :16371-16377, :16419-16425), and the exe's child ticker `F0x80018230` (exe/fns.s:8914-8941)
// runs it every time the phase is ticked, writing the slot back so a freed child's slot is
// nulled (:8929-8931).
//
// The COMMAND SCREEN retires it: on a confirm it writes state 3 onto the director
// (`fightstg.s:24717-24722`). `F0x80018140` (exe/fns.s:8850-8910) then runs that state-3 tick
// once and, because the state is 3, calls the object's destructor and returns 0 (:8883,
// :8900-8905) — the object is FREED, not paused, and nothing re-publishes the record for the
// rest of the attack. On the next turn the phase rebuilds its children, the slot is null, and a
// FRESH director is created that opens on row 3's plain arena shot and restarts the walk.
// `.dw3-research/attack-camera-retire-2026-10-08/worker-bb.md` carries the full edge table.
//
// What the director does once it is running is complete and is what this port implements; the
// `retire()` below is that terminal state-3 tick.
//
// The oracle tests/engine/unit/battle-idle-director-oracle.test.ts runs the ORIGINAL instruction
// words out of the committed fightstg overlay image (web/assets/native/screens/pro_fightstg.bin,
// base 0x80082cb0) through engine/native, with the routine's vtable methods stubbed to the base
// class's own AdvState/SetSub1 and the shot provider/animation object stubbed, and compares the
// walk, the dwell, the yaw and the state after every tick to this port.

import { RAND_U16 } from "./battle-formulas.ts";

/** 0x1000 angle units to one turn — the +0x24/+0x26/+0x28 triple's scale. */
export const IDLE_TURN_UNITS = 0x1000;

/** `record+0x26 += delta * 2` every frame of a spinning hold (fightstg.s:5060-5072). */
export const IDLE_SPIN_PER_DELTA = 2;

/** The half-turn the early cut waits for, in the same units (fightstg.s:4738). */
export const IDLE_HALF_TURN_UNITS = 0x801;

/** The table terminator: a pair whose low halfword is -1 (fightstg.s:32905). */
export const IDLE_ROW_END = -1;

/** A `[dwell in raw deltas, sub-state]` pair from the shot table. */
export type IdleShotEntry = readonly [number, number];

/**
 * The shot list, verbatim from 0x800a24b8 (fightstg.s:32890-32908): four rows of
 * `[dwell, sub-state]`, the last row being the one the battle opens on.
 */
export const IDLE_SHOT_TABLE: readonly (readonly IdleShotEntry[])[] = [
  [[1800, 1], [480, 9], [360, 3], [300, 4], [480, 9]],
  [[360, 6], [900, 1], [300, 5], [480, 9]],
  [[1920, 1], [360, 6], [180, 7], [480, 9]],
  [[90, 10], [90, 5]],
];

/** The three bytes per row that choose the next row, verbatim from 0x800a2518. */
export const IDLE_ROW_WALK: readonly number[] = [1, 2, 1, 0, 2, 2, 0, 1, 0, 0, 1, 2];

/** A word `w`: the record index a nudge/absolute arm writes. */
export interface IdleNudge {
  readonly [word: number]: number;
}

/**
 * One arm of the sub-state dispatch (table 0x80082d08, fightstg.s:28-37).
 *
 * `spin` is the direction the arm adds `delta * 2 * IDLE_SPIN_PER_DELTA` to the record's Y
 * angle in; `nudge` is added to the record's own words, which is how the arms shift a canned
 * shot's framing without rewriting it; `absolute` replaces eye/target/H outright after the arena
 * shot, leaving the anchor and the other two angles as the arena shot left them. `yawBias` is a
 * MAGNITUDE the arm applies against its own turn direction.
 *
 * The nudge word indices are the RECORD's word offsets / 4: rec+0x20 is the anchor's z
 * (word 8), rec+0x8 is eye.z (word 2) and rec+0x14 is target.z (word 5). The browser's copy
 * nudged word 2 with the wrong sign and word 3 instead of word 8 — it was written against the
 * pre-2026-08-19 record layout, before +0x18 was established as the anchor (fightstg.s
 * :4797-4812, :4840-4855, :4882-4897, :4948-4963; the layout is in web/fight/battle-camera.js
 * composeShot). This port uses the disassembly's words.
 */
export interface IdleArm {
  readonly handler: number;
  readonly arena?: boolean;
  readonly carryYaw?: boolean;
  readonly canned?: { readonly side: "player" | "enemy"; readonly index: number };
  readonly nudge?: IdleNudge;
  readonly absolute?: {
    readonly eye: readonly [number, number, number];
    readonly target: readonly [number, number, number];
    readonly H: number;
  };
  readonly yawBias?: number;
  readonly spin?: number;
  /**
   * The magnitude added to the record's Y angle per delta, times `spin`. The DEFAULT arm
   * hardcodes `2` (fightstg.s:4714-4718, `sll $v0,0x1`); the canned arms 3/4/5/6 and arm 9 run
   * the `delta * spinSpeed` path with spinSpeed = 1 (fightstg.s:4916-4922, :5066-5072), so they
   * turn HALF as fast. Defaults to 1.
   */
  readonly spinPer?: number;
}

/**
 * `default` is the arm at 0x80087418, which sub-states 0 and 1 (and anything above 10) reach.
 */
export const IDLE_SUB_STATES: { readonly [sub: number]: IdleArm; readonly default: IdleArm } = {
  default: { handler: 0x80087418, arena: true, carryYaw: true, spin: 1, spinPer: IDLE_SPIN_PER_DELTA },
  1: { handler: 0x80087418, arena: true, carryYaw: true, spin: 1, spinPer: IDLE_SPIN_PER_DELTA },
  2: {
    handler: 0x80087530,
    arena: true,
    absolute: { eye: [-0x1e80, -0x500, 0], target: [0, 0x500, 0], H: 0x98 },
  },
  3: {
    handler: 0x800875c0,
    canned: { side: "player", index: 8 },
    nudge: { 8: -0x1400, 2: 0x1400, 5: 0x1400 },
    spin: 1, spinPer: 1,
  },
  4: {
    handler: 0x8008766c,
    canned: { side: "enemy", index: 0 },
    nudge: { 8: 0x1400, 2: -0x1400, 5: -0x1400 },
    spin: -1, spinPer: 1,
  },
  5: {
    handler: 0x80087718,
    canned: { side: "player", index: 8 },
    nudge: { 8: -0x1400, 2: 0x1400, 5: 0x1400 },
    yawBias: 0xe3,
    spin: -1, spinPer: 1,
  },
  6: {
    handler: 0x80087820,
    canned: { side: "enemy", index: 0 },
    nudge: { 8: 0x1400, 2: -0x1400, 5: -0x1400 },
    yawBias: 0xe3,
    spin: 1, spinPer: 1,
  },
  7: { handler: 0x800878e0, canned: { side: "player", index: 10 } },
  8: { handler: 0x8008792c, canned: { side: "player", index: 8 } },
  9: {
    handler: 0x80087978,
    arena: true,
    absolute: { eye: [-0x1400, -0x2800, 0], target: [0, 0, 0], H: 0xc8 },
    yawBias: 0x155,
    spin: 1, spinPer: 1,
  },
  10: { handler: 0x80087a7c, arena: true },
};

/** The arm a sub-state number runs — 0, 1 and anything above 10 all take the default arm. */
export function idleSubState(sub: number): IdleArm {
  return IDLE_SUB_STATES[sub | 0] ?? IDLE_SUB_STATES.default;
}

/**
 * The next row, exactly as the routine computes it: one `rand_u16()`, `rand % 3`, and three
 * bytes per row out of the table at 0x800a2518. `rand` is the raw 0..0xffff return.
 */
export function idleNextRow(row: number, rand: number): number {
  return IDLE_ROW_WALK[row * 3 + ((rand | 0) % 3 + 3) % 3]! | 0;
}

/** The `(dwell, sub-state)` pair at `index` of `row`, or null past the -1 terminator. */
export function idleShotEntry(row: number, index: number): IdleShotEntry | null {
  const r = IDLE_SHOT_TABLE[row | 0];
  if (!r) return null;
  return r[index | 0] ?? null;
}

/** The row's length in shots — how many pairs sit before the -1 terminator. */
export function idleRowLength(row: number): number {
  return (IDLE_SHOT_TABLE[row | 0] ?? []).length;
}

const s16 = (v: number): number => ((v | 0) << 16) >> 16;

/**
 * One frame of the turn an arm makes. Up wraps at 0x1000 and down wraps at 0, both through the
 * SIGNED 16-bit test the routine uses (`slti` / `bgez` on `lh`, :5060-5072 and :4927-4930), so
 * a turn that starts from a canned shot's zeroed yaw behaves the same at every scale.
 */
export function idleSpinYaw(yaw: number, step: number): number {
  const y = s16(yaw) + step;
  if (step >= 0 ? s16(y) >= IDLE_TURN_UNITS : s16(y) < 0) {
    return (y - (step >= 0 ? IDLE_TURN_UNITS : -IDLE_TURN_UNITS)) & 0xffff;
  }
  return y & 0xffff;
}

/**
 * The walker's frame seconds turned into the original's per-frame delta.
 *
 * `[0x8004df9c]()` is 1 per 60 Hz frame, and the director is ticked once per RENDERED frame,
 * which is not 60 Hz on a slow display — the battle loop also caps a frame's dt at 0.1 s, so one
 * tick can be worth 6 deltas. What matters is that the value handed to `tick()` is the number of
 * frames SINCE THE LAST TICK and not the running total: a 90-delta hold spent in two frames is
 * the symptom of passing the total, and nothing else catches it because the director still cuts
 * and still turns.
 */
export function createIdleClock(deltaPerFrame = 1, hz = 60): {
  tick(dt: number): number;
  readonly frames: number;
  reset(): void;
} {
  let seconds = 0;
  let frames = 0;
  return {
    /** The delta for this tick, and it advances the clock. */
    tick(dt: number): number {
      seconds += dt;
      const now = Math.floor(seconds * hz);
      const d = (now - frames) * deltaPerFrame;
      frames = now;
      return d;
    },
    /** Whole frames elapsed, which is the clock `tick` subtracts from. */
    get frames(): number { return frames; },
    reset(): void { seconds = 0; frames = 0; },
  };
}

/** The 14-word camera record a shot is staged into (see battle-camera.js fieldsFromShot). */
export type IdleFields = number[];

export interface IdleDirectorState {
  readonly row: number;
  readonly index: number;
  readonly dwell: number;
  readonly sub: number;
  readonly spunSinceSetup: number;
  readonly carryYaw: number;
  /** True once `retire()` has run: the object is gone and no tick will cut again. */
  readonly retired: boolean;
}

export interface IdleDirectorTick {
  readonly fields: IdleFields | null;
  readonly sub: number;
  readonly arm: IdleArm;
  readonly row: number;
  readonly index: number;
  readonly dwell: number;
  readonly spunSinceSetup: number;
  readonly carryYaw: number;
}

export interface IdleDirector {
  update(delta: number): IdleDirectorTick;
  /** The routine's state-0 setup tick, run once before the first hold; idempotent. */
  prime(): void;
  reset(): IdleFields | null;
  /**
   * The terminal state-3 tick the command screen's confirm edge drives: re-cut the plain arena
   * shot through `[0x100]`/`[0xf8]`, then report the object GONE. After it, `update()` no longer
   * cuts — the original frees the object at `exe/fns.s:8883`/`:8900-8905`, and nothing
   * re-publishes the record until a fresh director is created on the next turn.
   */
  retire(): IdleFields | null;
  state(): IdleDirectorState;
}

export interface IdleDirectorOptions {
  /** The game's own random source; `RAND_U16` unless a caller injects one. */
  rand?: () => number;
  /** `[0x100]` — the arena shot's 14 words. */
  arena?: () => IdleFields | null;
  /** `[0x104](side, index)` — a canned shot's 14 words. */
  canned?: (side: "player" | "enemy", index: number) => IdleFields | null;
  /** The word at 0x80042b28 (the encounter record's `param`); 4 in its low nibble is the early cut. */
  battleParam?: number;
}

/**
 * The battle's idle cut director.
 *
 * `update(rawDelta)` is ONE TICK of FIGHTSTG_F0x8008718c's hold state and returns the record the
 * director CUTS that tick, which is what the original does at :5096-5105 — it publishes its
 * record every tick it runs, so the caller installs it through the camera record owner rather
 * than reading a shot to draw.
 */
export function createIdleDirector({
  rand = RAND_U16,
  arena,
  canned,
  battleParam = 8,
}: IdleDirectorOptions = {}): IdleDirector {
  // State 0 (:4515-4531) arms row 3, index 0, and the first pair of that row before anything
  // else. It is a setup tick with NO cut and NO dwell decrement; `prime()` runs it.
  let state = 0;                      // self+0x0c
  let row = 3;
  let index = 0;
  let dwell = IDLE_SHOT_TABLE[row]![index]![0];
  let sub = IDLE_SHOT_TABLE[row]![index]![1];
  let subCounter = 0;                 // self+0x14 — an arm's setup runs once
  let carryYaw = 0;                   // self+0x60
  let spunSinceSetup = 0;             // self+0x62
  let spinSpeed = 1;                  // self+0x68
  let fields: IdleFields | null = null;
  let retired = false;                // the object has been freed (state 3 taken)

  const emptyRecord = (): IdleFields | null => {
    const a = arena ? arena() : null;
    return a ? a.slice() : null;
  };

  /**
   * The state-0 tick: AdvState (clear +0x10/+0x14/+0x18, +0xc += 1), arm row 3 index 0,
   * allocate the shot provider and animation object, take the arena shot and seed the carried
   * yaw from it. It returns at :5143 WITHOUT cutting and WITHOUT decrementing the dwell, so the
   * very first call produces no shot record — the browser folds this tick into construction.
   */
  function prime(): void {
    if (state !== 0) return;
    state = 1;                        // AdvState (exe/fns.s F0x800142ac)
    row = 3;
    index = 0;
    const e = idleShotEntry(row, index);
    dwell = e ? e[0] : 0;
    setSub(e ? e[1] : 0);
    fields = emptyRecord();
    carryYaw = fields ? fields[10]! & 0xffff : 0;
  }

  /** SetSub1 (exe/fns.s): the new sub-state, and the arm's setup runs again. */
  function setSub(n: number): void {
    sub = n | 0;
    subCounter = 0;
  }

  /** The terminator branch: one rand, one walk, and the pair at the new index 0. */
  function pickNextRow(): void {
    row = idleNextRow(row, rand());
    index = 0;
    const e = idleShotEntry(row, index);
    dwell = e ? e[0] : 0;
    setSub(e ? e[1] : 0);
  }

  /** The advance block, run on the tick the counter has reached zero (:4599-4659). */
  function advance(): void {
    index += 1;
    const peek = idleShotEntry(row, index);
    if (!peek) pickNextRow();
    else { dwell = peek[0]; setSub(peek[1]); }
  }

  /**
   * The arm's once-only setup. The original bumps the sub counter at the end of the block
   * whatever the shot loader returned, so a record that has not resolved still counts as set up
   * — and the walker's `canned()`/`arena()` never return a half-filled record.
   */
  function setup(arm: IdleArm): void {
    if (arm.arena) {
      fields = emptyRecord();
      if (fields && arm.carryYaw) {
        // :4744-4753 — the carried angle seeds the shot UNLESS the battle's param has 4 in
        // its low nibble, which is the branch that skips straight to the spin.
        if (((battleParam | 0) & 0xf) !== 4) fields[10] = carryYaw & 0xffff;
        spunSinceSetup = 0;
      }
    } else if (arm.canned) {
      const c = canned ? canned(arm.canned.side, arm.canned.index) : null;
      fields = c ? c.slice() : null;
    }
    if (fields) {
      if (arm.nudge) {
        for (const key of Object.keys(arm.nudge)) {
          const w = Number(key);
          fields[w] = (fields[w]! + arm.nudge[w]!) | 0;
        }
      }
      if (arm.absolute) {
        fields[0] = arm.absolute.eye[0]; fields[1] = arm.absolute.eye[1]; fields[2] = arm.absolute.eye[2];
        fields[3] = arm.absolute.target[0]; fields[4] = arm.absolute.target[1]; fields[5] = arm.absolute.target[2];
        fields[13] = arm.absolute.H;
      }
      // The three arms that nudge the yaw all push it AGAINST the turn they then make:
      // +0xe3 before turning down (:4905-4908), -0xe3 before turning up (:4971-4974) and
      // -0x155 before turning up (:5051-5054). So the bias is a magnitude and the spin
      // direction carries its sign.
      if (arm.yawBias) fields[10] = (fields[10]! - arm.spin! * arm.yawBias) & 0xffff;
    }
    if (arm.spin) spinSpeed = 1;
    subCounter += 1;
  }

  /** One frame of the arm, run every tick once its setup has happened. */
  function spin(arm: IdleArm, delta: number): void {
    if (!arm.spin || !fields) return;
    // The default arm turns `delta * 2`; arms 3/4/5/6/9 turn `delta * spinSpeed` (spinSpeed = 1).
    const step = arm.spin * spinSpeed * (delta | 0) * (arm.spinPer ?? 1);
    fields[10] = idleSpinYaw(fields[10]!, step);
    if (arm.carryYaw) {
      spunSinceSetup = (spunSinceSetup + step) & 0xffff;
      carryYaw = fields[10]!;
      if (((battleParam | 0) & 0xf) === 4 && s16(spunSinceSetup) >= IDLE_HALF_TURN_UNITS) dwell = 0;
    }
  }

  /**
   * ONE TICK. `delta` is `[0x8004df9c]()` — the raw per-frame delta word, 1 a frame — not
   * seconds and not the slow-motion-published delta.
   */
  function update(delta: number): IdleDirectorTick {
    const d = delta | 0;
    // A retired director does not exist: the original frees it, so there is nothing to tick
    // and nothing to cut. The caller stops calling; this is the safety arm.
    if (retired) {
      return { fields: null, sub, arm: idleSubState(sub), row, index, dwell, spunSinceSetup, carryYaw };
    }
    // State 0: the setup tick, which produces no cut and no dwell decrement.
    if (state === 0) {
      prime();
      return { fields, sub, arm: idleSubState(sub), row, index, dwell, spunSinceSetup, carryYaw };
    }
    if (dwell <= 0) advance();

    const arm = idleSubState(sub);
    if (subCounter === 0) setup(arm);
    spin(arm, d);

    // The routine cuts here, before it decrements: a dwell of N therefore shows N+1 ticks of
    // its shot, which is the off-by-one the table's own numbers carry.
    dwell -= d;

    return { fields, sub, arm, row, index, dwell, spunSinceSetup, carryYaw };
  }

  /**
   * State 3 (:5116-5142): re-flag both fighters (their slots' +0x34) and cut the arena shot
   * again through [0xf8]. It deliberately leaves the row, the index and the dwell counter alone,
   * so a reset shows the arena shot for the rest of the hold already running.
   */
  function reset(): IdleFields | null {
    fields = emptyRecord();
    return fields;
  }

  /**
   * The terminal state-3 tick. The command screen's confirm edge writes state 3 onto the
   * director (`fightstg.s:24717-24722`); the exe runs it once and then frees the object
   * (`exe/fns.s:8883`, `:8900-8905`). So this runs the state-3 re-cut — the same arena shot
   * `reset()` returns — and marks the director GONE: `update()` afterwards cuts nothing.
   */
  function retire(): IdleFields | null {
    if (retired) return fields;
    const r = reset();               // the state-3 block: re-take the default arena shot
    state = 3;
    retired = true;
    return r;
  }

  return {
    update, prime, reset, retire,
    /** The debug readout, and what the tests read the walk out of. */
    state: (): IdleDirectorState => ({ row, index, dwell, sub, spunSinceSetup, carryYaw, retired }),
  };
}

/**
 * The record the director cuts this tick — or `null` while the director does not exist.
 *
 * The ORDER is the original's, not a guard the walker invented. The fight's setup phase creates
 * both fighters' model objects and THEN the director in one block, each only if its slot is
 * empty, so the director never runs before the staging records its shots come from exist.
 * `exists` is that question and the caller answers it from the records themselves.
 *
 * While it is false the clock is not read either, which is the part that is easy to get wrong:
 * `createIdleClock` hands over the frames SINCE THE LAST TICK, so ticking it during the wait
 * would hand the first real tick every frame the wait lasted — the 90-frame hold of row 3's
 * opening entry spent before the arena shot could resolve.
 */
export function idleDirectorTick(
  director: IdleDirector, clock: { tick(dt: number): number }, dt: number, exists: boolean,
): IdleFields | null {
  if (!exists) return null;
  return director.update(clock.tick(dt)).fields;
}
