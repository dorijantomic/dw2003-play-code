// The action VM's per-tick SLOT MOTION controller — the routine that carries an
// attacker across the arena to strike, and the curve and table it runs on.
//
// This is a port of the original pro/fightstg routines, read from the disc:
//   FIGHTSTG_F0x8009b460   fightstg.s L25375  the factory (builds the object)
//   FIGHTSTG_F0x8009b13c   fightstg.s L25168  the per-tick updater (states 0..3)
//   FIGHTSTG_F0x800a1f74   fightstg.s L32544  the three motion curves f(sel,t,mag)
//   0x800a365c                                the per-kind {amp, rate} table
//   FIGHTSTG_F0x8002abcc                       the console's sine (engine/dw3/rsin.ts)
//
// Why this is a shared system and not one Digimon's data: 112 of the 241 models
// with a basic attack author their step-in as `op2 [5, slot, 4, param]`, and the
// same updater drives the leap back home. The browser renderer used to hand-write
// this whole mechanism inside web/fight/action-vm.js (`_armRamp`/`_stepRamp`/
// `rampCurve`); this module is the port, and the oracle
// tests/engine/unit/battle-slot-motion-oracle.test.ts runs the original words
// through engine/native and compares them to it.
//
// WHAT THE ORIGINAL DOES (offsets off the motion object):
//   +0x50 kind   +0x54 param   +0x58 distance   +0x5c slot   +0x60 arc amplitude
//   +0x64 (kinds 1-3) the slot's own y at creation   +0x68 rate   +0x6c t   +0xc state
//   slot +0x04 side flag (0x10 = far side)   +0x1e live y   +0x20 live z
//        +0x2a home y   +0x2c home z
// state 0 seeds distance and t = delta*rate, then FALLS THROUGH into state 1 in
// the same call; state 1 rewrites the slot's y/z every tick and, once t reaches
// 0x1000, advances to state 2 (which snaps the end pose on the NEXT call); state
// 3 is finished. See docs/research/fight-3d/action-vm-dispatch.md §(g.5).

import { rsin } from "./rsin.ts";

/** The sync ramp completes at t = 0x1000 (4096 = fixed-point 1.0; asm .L0x8009b3a0). */
export const RAMP_TARGET = 0x1000;
/** The leap covers `param + 0x2800` — the contact distance the whole attack shares. */
export const CONTACT_Z = 0x2800;

export interface SlotMotionKind {
  /** word 0 of 0x800a365c[kind-1]: the arc amplitude f(2,t,amp). */
  readonly amp: number;
  /** word 1 of 0x800a365c[kind-1]: the accumulator rate, t += delta*rate. */
  readonly rate: number;
}

/** 0x800a365c, stride 8, indexed kind-1 (asm L25400-25402; RAM dump fight_rena.bin). */
export const SLOT_MOTION_KINDS: readonly SlotMotionKind[] = [
  { amp: 640, rate: 136 },  // 1 — small hop in place
  { amp: 1280, rate: 102 }, // 2
  { amp: 1920, rate: 81 },  // 3 — tallest in-place hop
  { amp: 2560, rate: 64 },  // 4 — the forward LEAP (carries the attacker in)
  { amp: 1280, rate: 64 },  // 5 — the leap back to the home slot
  { amp: 0, rate: 42 },     // 6 — no arc
];

/** The per-kind record, or null for a kind outside the disc table. */
export function slotMotionKind(kind: number): SlotMotionKind | null {
  return SLOT_MOTION_KINDS[(kind | 0) - 1] ?? null;
}

/**
 * FIGHTSTG_F0x800a1f74(sel, t, mag): the three motion curves, in PS1 fixed point.
 *   sel 0 → angle t/4      (0..90 deg)  ramp IN   0 → mag
 *   sel 1 → angle t/4+0x400 (90..180)   ramp OUT  mag → 0
 *   sel 2 → angle t/2      (0..180)     ARC       0 → mag → 0
 * The magnitude is scaled and `sra 12`-rounded, with the negative bias the
 * original applies before the shift (asm .L0x800a1fc8 `addiu $v0,0xfff`).
 */
export function rampCurve(sel: number, t: number, mag: number): number {
  const angle = sel === 1 ? (t >> 2) + 0x400 : sel === 2 ? t >> 1 : t >> 2;
  const v = rsin(angle) * mag;
  return (v < 0 ? v + 0xfff : v) >> 12;
}

/** The write target the motion object drives: the actor's arena slot. */
export interface MotionSlot {
  /** slot+0x04; 0x10 selects the far side and negates the travel distance. */
  sideFlag: number;
  getY(): number;       // slot+0x1e (live y, PS1 Y-down)
  setY(v: number): void;
  getZ(): number;       // slot+0x20 (live z)
  setZ(v: number): void;
  homeY(): number;      // slot+0x2a
  homeZ(): number;      // slot+0x2c
}

/** A live slot-motion object (the 0x70-byte object FIGHTSTG_F0x8009b460 allocates). */
export interface SlotMotion {
  kind: number;  // +0x50
  param: number; // +0x54
  dist: number;  // +0x58
  amp: number;   // +0x60
  rate: number;  // +0x68
  seedY: number; // +0x64 — the slot's own y read at creation (kinds 1-3's f(1) mag)
  t: number;     // +0x6c accumulator
  state: number; // +0x0c
}

/**
 * FIGHTSTG_F0x8009b460: build the motion object. It reads the kind's amp/rate
 * from 0x800a365c and latches the slot's current y as the kinds 1-3 curve
 * magnitude. The object starts in state 0; no tick has run yet.
 */
export function armSlotMotion(kind: number, param: number, slot: MotionSlot): SlotMotion {
  const k = slotMotionKind(kind);
  return {
    kind: kind | 0,
    param: param | 0,
    dist: 0,
    amp: k ? k.amp : 0,
    rate: k ? k.rate : 0,
    seedY: slot.getY() | 0,
    t: 0,
    state: 0,
  };
}

/**
 * State 0 (asm .L0x8009b178): distance = 0; kind 4 → `param + 0x2800`; kind 5 →
 * `|z − homeZ|`; then negated when the slot's side flag is 0x10 (the far-side
 * mirror, so both fighters advance toward each other).
 */
export function slotMotionDistance(kind: number, param: number, slot: MotionSlot): number {
  let dist = 0;
  if (kind === 4) dist = (param | 0) + CONTACT_Z;
  else if (kind === 5) dist = Math.abs((slot.getZ() | 0) - (slot.homeZ() | 0));
  if ((slot.sideFlag | 0) === 0x10) dist = -dist;
  return dist;
}

/**
 * State 1 (asm .L0x8009b220-.L0x8009b3ac): the pose the slot takes at accumulator
 * `t`. Returns z = null where the original leaves the slot's z untouched.
 */
export function slotMotionPose(
  kind: number, t: number, amp: number, seedY: number, dist: number, homeY = 0, homeZ = 0,
): { y: number; z: number | null } {
  let y: number;
  if (kind < 4 || kind >= 7) y = rampCurve(1, t, seedY) - rampCurve(2, t, amp);
  else if (kind < 6) y = homeY - rampCurve(2, t, amp);
  else y = rampCurve(0, t, homeY);
  let z: number | null = null;
  if (kind === 4) z = homeZ + rampCurve(0, t, dist);
  else if (kind === 5) z = homeZ + dist - rampCurve(0, t, dist);
  return { y, z };
}

/**
 * State 2 (asm .L0x8009b3b4-.L0x8009b438): the pose written when the ramp lands.
 * Returns z = null where the original leaves z untouched.
 */
export function slotMotionLanding(
  kind: number, dist: number, homeY = 0, homeZ = 0,
): { y: number; z: number | null } {
  const y = kind >= 4 && kind < 7 ? homeY : 0;
  let z: number | null = null;
  if (kind === 4) z = homeZ + dist;
  else if (kind === 5) z = homeZ;
  return { y, z };
}

/**
 * FIGHTSTG_F0x8009b13c: ONE call of the per-tick updater — the exact state
 * machine, including the state-0 fall-through and the one-call-late end snap.
 * Returns true once the object has passed state 2 (finished). The oracle runs
 * the original words with the same call cadence and compares the slot after
 * every call.
 *
 * The browser's renderer deliberately keeps its own one-test tick loop (see
 * web/fight/action-vm.js `_stepRamp`) and consumes the pure pose/curve functions
 * above, so the visible frame timing is unchanged; this exact driver is what the
 * oracle pins.
 */
export function stepSlotMotion(m: SlotMotion, slot: MotionSlot, delta: number): boolean {
  if (m.state >= 3) return true;

  if (m.state === 0) {
    m.dist = slotMotionDistance(m.kind, m.param, slot);
    m.t = (delta | 0) * m.rate;
    m.state = 1;
    // fall through into state 1 in the SAME call (asm .L0x8009b21c-.L0x8009b220)
  }

  if (m.state === 2) {
    const land = slotMotionLanding(m.kind, m.dist, slot.homeY(), slot.homeZ());
    slot.setY(land.y);
    if (land.z !== null) slot.setZ(land.z);
    m.state = 3;
    return true;
  }

  // state 1
  const pose = slotMotionPose(m.kind, m.t, m.amp, m.seedY, m.dist, slot.homeY(), slot.homeZ());
  slot.setY(pose.y);
  if (pose.z !== null) slot.setZ(pose.z);
  m.t = m.t + (delta | 0) * m.rate;
  if (m.t >= RAMP_TARGET) m.state = 2; // snaps on the next call, exactly as the original
  return false;
}
