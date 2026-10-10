// The battle's slow-motion clock — the stepper FIGHTSTG_F0x8009e428 and its setter
// FIGHTSTG_F0x8009e510, ported from pro/fightstg.s:28617-28689.
//
// This is the routine the browser renderer re-implements as `slowMoStep` in
// web/battle3d.js:910 (and `setSlowMotion` at :1888): one per-frame step that reads
// the raw frame delta through the pointer at 0x8004df9c and writes the word the
// battle's animation and motion timers read from 0x800a4464. It is NOT the camera's
// clock: the defeat orbit reads 0x8004df9c directly, which is why every camera glide
// stays at full speed while this word slows the fighters.
//
// The original's own words (fightstg.s):
//
//   F0x8009e428:
//     .L0x8009e428  s0 = 0x800a453c (the level word);  v1 = lw 0x453c
//     .L0x8009e440  level == 1 -> .L0x8009e480
//     .L0x8009e448  slti v0, v1, 2 ; bnez -> .L0x8009e468          (level 0)
//     .L0x8009e458  level == 2 -> .L0x8009e488 ; level == 3 -> .L0x8009e4e8
//     .L0x8009e468  (level 0) v0 = [0x8004df9c]() ; publish 0x800a4464 = v0
//     .L0x8009e480  (level 1) publish = 0
//     .L0x8009e488  (level 2) v0 = [0x8004df9c]() ; v1 = accum 0x800a4540
//                   a0 = 0x800a4460 ; publish(0x800a4464) = 0
//                   v1 = accum + v0 ; accum = v1
//                   slti v1, 5 ; bnez -> exit            (publish stays 0)
//     .L0x8009e4bc  loop: publish 0x800a4464 += 1 ; accum 0x800a4540 -= 4
//                   slti v1, 5 ; beqz -> loop
//     .L0x8009e4e8  (level 3) v0 = [0x8004df9c]() ; publish = v0 << 1
//
//   F0x8009e510:  stores a0 at 0x800a453c, zeroes 0x800a4540, then calls the stepper.
//
// `0x800a453c - 0xd8 == 0x800a4464` and `0x800a4460 + 0x4 == 0x800a4464`, so the level,
// the accumulator and the published word are all one 0x800-a-4460-based block.
//
// The stepper is the ONLY writer of 0x800a4464. The battle's model actor adds that
// word to its frame counter at F0x80083d30 (`self+0x80 += 0x800a4464`), the second
// actor clock at .L0x80089614, and every op2 slot-motion blend reads it
// (F0x8009b1fc / .L0x8009b380 / .L0x8009b520 / .L0x8009b5d4 / .L0x8009b720).
//
// Port: `slowMotionStep(level, delta, acc)` returns the published word and the
// carried accumulator; `setSlowMotion(level, delta)` is the setter (acc reset to 0).

/** The level word (`0x800a453c`): 0 passes the raw delta, 1 freezes, 2 quarters, 3 doubles. */
export const SLOW_MO_LEVEL = 0x800a453c;
/** The carried accumulator (`0x800a4540`), the 1..4 remainder the level-2 loop keeps. */
export const SLOW_MO_ACCUM = 0x800a4540;
/** The word the stepper publishes (`0x800a4464`), read by every battle animation timer. */
export const SLOW_MO_PUBLISH = 0x800a4464;
/** The raw per-frame delta accessor, `[0x8004df9c]()`; it returns 1 a frame in the shipped game. */
export const FRAME_DELTA_CELL = 0x8004df9c;
/** Level 2 emits one unit once the accumulator reaches 5 (`.L0x8009e4b0 slti v1, 0x5`). */
export const SLOW_MO_PUBLISH_AT = 5;
/** ...and each emitted unit costs 4 of the accumulator (`.L0x8009e4c8 addiu v1, -0x4`). */
export const SLOW_MO_ACCUM_COST = 4;

export interface SlowMoStep {
  /** The value written to 0x800a4464 this frame. */
  delta: number;
  /** The accumulator left at 0x800a4540 (unchanged for every level except 2). */
  acc: number;
}

/**
 * One frame of F0x8009e428. Level 0 passes the frame's delta through, 1 freezes (0),
 * 3 doubles it, and 2 emits one unit per four accumulated, keeping the 1..4 remainder
 * so the average stays exact. At the shipped delta of 1 that is one unit every fourth
 * frame. Levels other than 2 leave the accumulator untouched, as the original does.
 */
export function slowMotionStep(level: number, delta: number, acc = 0): SlowMoStep {
  const lv = level | 0;
  if (lv === 1) return { delta: 0, acc: acc | 0 };
  if (lv === 3) return { delta: delta * 2, acc: acc | 0 };
  if (lv !== 2) return { delta, acc: acc | 0 };
  let a = (acc | 0) + delta;
  let out = 0;
  while (a >= SLOW_MO_PUBLISH_AT) { out += 1; a -= SLOW_MO_ACCUM_COST; }
  return { delta: out, acc: a };
}

/**
 * F0x8009e510 — the setter `[0x800a4548](level)` arms: it stores the level at
 * 0x800a453c, zeroes the accumulator 0x800a4540, then runs one step so the published
 * word is set the same tick.
 */
export function setSlowMotion(level: number, delta: number): SlowMoStep & { level: number } {
  const lv = level | 0;
  return { level: lv, ...slowMotionStep(lv, delta, 0) };
}
