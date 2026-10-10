// The battle actor's ANIMATION-SLOT system — the port of the fightstg routines that own the
// animation object's four slots: which timeline table a slot plays, and where the slot sits on
// the arena floor. THE shared system behind the browser's web/fight/actor-animator.js.
//
// Read from ~/ddw3/asm/dw2003/pro/fightstg.s (authority 2):
//
//   FIGHTSTG_F0x80087bf8  :5184-5202  find the slot whose key matches          → findAnimSlotIndex
//   FIGHTSTG_F0x80087e28  :5339-5361  resolve that slot to its base           → resolveAnimSlot
//   FIGHTSTG_F0x80088024  :5478-5491  bind a table index into the slot (+0x18) → setAnimSlotTable
//   FIGHTSTG_F0x80087f38  :5416-5476  place the slot on its arena home         → placeAnimSlot
//   FIGHTSTG_F0x8008b7f4  :8857-9149  the op2 handler's movement arms (3/7/8)  → op2SlotTarget
//
// ── The animation object ─────────────────────────────────────────────────────
//
// FIGHTSTG_F0x80088054 (:5493-5533) builds it: 0x19c bytes with four slots at +0x50 on a 0x4c
// stride (the ctor zeroes each slot's occupancy word at +0x00), and installs the method table
//
//   +0x180 F0x80087c70   +0x184 F0x80087d00   +0x188 F0x80087e28 (the SLOT RESOLVER)
//   +0x18c F0x80087e7c   +0x190 F0x80087ee4   +0x194 F0x80087f38 (the HOME PLACEMENT)
//
// A slot (base = animObject + 0x50 + i*0x4c) is: +0x00 occupancy, +0x04 key, +0x08 bind state,
// +0x0c state, +0x10 done flag, +0x14 the model record, +0x18 the bound table index,
// +0x1c/+0x1e/+0x20 live x/y/z, +0x22/+0x24/+0x26 live rotX/rotY/rotZ, +0x28.. the HOME triple
// copied from live at the end of a placement, +0x34 the visibility/side flag.
//
// ── The slot resolver (FIGHTSTG_F0x80087e28, +0x188) ─────────────────────────
//
// FIGHTSTG_F0x80087bf8 scans the four slots, comparing each occupied slot's key (+0x04) to the
// argument and returning the first match's index, or -1. F0x80087e28 turns that index into the
// slot's base (`animObject + idx*0x4c + 0x50`) or returns 0. It is the method the op2 handler
// calls on every mode except 6 and 9, and the method the idle cut director (F0x8008718c) calls
// with key 0 (near side) and 0x10 (far side) to flag which fighter a shot frames.
//
// ── The home placement (FIGHTSTG_F0x80087f38, +0x194) ───────────────────────
//
// It resolves the slot for the slot id, reads the model record's hover (+0x18) and stand-off
// (+0x10), and writes, in the NEAR case (slotId < 0x10):
//
//   x = 0   y = -hover   z = -(0x1400 + stand-off)   rot = (0, 0x800, 0)
//
// and the far case is symmetric with z = +(0x1400 + stand-off) and rot.y = 0. It then copies the
// live triple to the HOME triple (+0x28..+0x32). **That arithmetic is ALREADY ported**:
// engine/dw3/battle-presentation.ts `arenaPlacement(hover, standoff, slotId)` (F0x80087F38's own
// oracle lives in tests/lane-b/battle-presentation.test.js and tests/fight-arena-placement.test.js),
// so this module REUSES it rather than writing a second copy — see the duplication the lead
// flagged. `placeAnimSlot` here is only the slot-shaped write on top of it.
//
// ── The op2 movement arms (FIGHTSTG_F0x8008b7f4) ─────────────────────────────
//
// F0x8008b7f4 is the op2 handler: it reads the mode word, resolves the slot through +0x188, then
// jumps through the ten-entry table at 0x80082e58. Three arms MOVE a slot, and they are what the
// browser's actor-animator `_onMove` implements:
//
//   mode 3 [x, y, z, flag]  ARENA-ABSOLUTE: live = (x, -y, -z) — no side test at all
//   mode 7 [flag]           HOME: home → live, instant at flag 0 or tweened through F0x8009b650
//   mode 8 [flag]           CONTACT: live = home with z ± 0x2800 (+ near, - far), the basic-attack
//                           dash; the sign is the slot side flag's high nibble (`andi $s4,0xf0`)
//
// The browser keeps each actor's slot as a DELTA from its home (`_move.cur`), so the movement
// arm ports as a target the caller subtracts home from; `op2SlotTarget` is the port and
// `animSlotMoveDelta` is that delta form. The absolute targets are authored per side in the
// data, exactly as the op3 effect and op6 projectile coordinates are — nothing mirrors them here.

import { arenaPlacement, type ArenaPlacement } from "./battle-presentation.ts";
// F0x80087bf8 is the SHARED four-slot scan; its single port lives in battle-actor-pool.ts
// (findFighterSlot, oracled directly against the original words). This module reuses it rather
// than carrying a second copy — see the reconciliation note on findAnimSlotIndex below.
import { findFighterSlot, type FighterSlotPool } from "./battle-actor-pool.ts";
// The transformation driver FIGHTSTG_F0x80089cd8 drives the anim object whose slots this
// module owns: its step bodies call the object's +0x184 bind, +0x188 resolve and +0x194
// home placement, exactly the calls encoded here. The ported driver's spawn schedule is
// surfaced through this module so the actor-animation system is the route's window onto
// the ordinary transformation path.
import { createTransformationSchedule, type TransformationSpawn } from "./battle-effect-driver-host.ts";

/** Four slots per animation object (F0x80088054 zeroes occupancy at +0x50 + i*0x4c, i = 0..3). */
export const ANIM_SLOT_COUNT = 4;
/** Slot stride: the ctor walks +0x4c per slot. */
export const ANIM_SLOT_STRIDE = 0x4c;
/** First slot's offset inside the animation object. */
export const ANIM_SLOT_BASE = 0x50;
/** The contact dash covers 0x2800 PS1 units of z toward the opponent (mode 8). */
export const CONTACT_HALF = 0x2800;
/** The side flag lives at slot+0x34 (modes 1 show / 2 hide write it; the director also writes it). */
export const ANIM_SLOT_VISIBLE = 0x34;

export type Triple = readonly [number, number, number];

/** One animation slot's identity: occupancy, key and the bound table index. */
export interface AnimSlotEntry {
  occupied: boolean;
  key: number;
  /** slot+0x18 — the table index F0x80088024 binds. */
  table: number;
}

const s16 = (v: number): number => ((v | 0) << 16) >> 16;

/**
 * FIGHTSTG_F0x80087bf8: the first slot whose key equals `key` among the occupied slots, else -1.
 *
 * This is the SAME routine ported in engine/dw3/battle-actor-pool.ts as `findFighterSlot` (the
 * record shape there is the raw +0x50 occupancy / +0x54 key pair; here it is slot+0x00 / slot+0x04
 * on the same 0x4C stride — identical memory). The reconciliation keeps ONE port, `findFighterSlot`,
 * whose oracle (tests/engine/unit/battle-actor-pool-oracle.test.ts) executes F0x80087bf8's original
 * words out of the committed overlay directly; this wrapper adapts the parsed slot array to that
 * accessor view so both callers share the single implementation.
 */
export function findAnimSlotIndex(slots: readonly AnimSlotEntry[], key: number): number {
  const pool: FighterSlotPool = {
    active: (i) => (slots[i]?.occupied ? 1 : 0),
    key: (i) => slots[i]?.key ?? 0,
  };
  return findFighterSlot(pool, key);
}

/**
 * FIGHTSTG_F0x80087e28 (the +0x188 method): resolve a key to its slot, or null when no slot
 * carries it (the routine returns 0 for index -1).
 */
export function resolveAnimSlot(
  slots: readonly AnimSlotEntry[], key: number,
): AnimSlotEntry | null {
  const i = findAnimSlotIndex(slots, key);
  return i < 0 ? null : slots[i]!;
}

/**
 * FIGHTSTG_F0x80088024: bind a table index into the slot for `key` (the routine writes the
 * argument to slot+0x18 and does nothing when no slot resolves). Returns the slot it bound, or
 * null when the key matched no slot.
 */
export function setAnimSlotTable(
  slots: readonly AnimSlotEntry[], key: number, table: number,
): AnimSlotEntry | null {
  const s = resolveAnimSlot(slots, key);
  if (s) s.table = table | 0;
  return s;
}

/** The placement of one slot: the live triple and the home triple a placement copies it into. */
export interface AnimSlotPlacement {
  live: ArenaPlacement;
  home: ArenaPlacement;
}

/**
 * FIGHTSTG_F0x80087f38's arithmetic, free of the slot: the SAME `arenaPlacement` port, surfaced
 * under the animation system's name so a caller reading the actor code finds the link. Near side
 * (slotId < 0x10) faces +z-negated with rot.y = 0x800; far side is symmetric with zero rotation.
 */
export function animSlotHome(hover: number, standoff: number, slotId: number): ArenaPlacement {
  return arenaPlacement(hover, standoff, slotId);
}

/**
 * FIGHTSTG_F0x80087f38: place the slot for `slotId` on its arena home and copy the live triple
 * into the home triple (+0x28..+0x32). The caller supplies the model record's hover and
 * stand-off; the numbers come from arenaPlacement, not a second hand-written copy.
 */
export function placeAnimSlot(
  slot: AnimSlotPlacement, hover: number, standoff: number, slotId: number,
): AnimSlotPlacement {
  const p = arenaPlacement(hover, standoff, slotId);
  slot.live = { ...p };
  slot.home = { ...p };
  return slot;
}

/**
 * FIGHTSTG_F0x8008b7f4 mode 7, flag 0: copy the HOME triple into the LIVE triple. This is the
 * original's own way back for a fighter the game does not send home itself; the browser's op2
 * mode-7 handler and `resetSlotPlacement` both mean this write.
 */
export function resetAnimSlotLiveToHome(slot: AnimSlotPlacement): void {
  slot.live = { ...slot.home };
}

/** A decoded op2 movement record (what the browser's action VM hands the animator hook). */
export interface Op2MoveRecord {
  kind: "to" | "home" | "contact" | string;
  x?: number;
  y?: number;
  z?: number;
  tween?: number;
}

/**
 * FIGHTSTG_F0x8008b7f4's three movement arms as the ARENA-ABSOLUTE target each writes, plus the
 * tween the caller passes to F0x8009b650 (0 = instant). `words` are the operands after
 * `(mode, slot)`: mode 3 → [x, y, z, flag], mode 7/8 → [flag].
 *
 * mode 3 negates y and z (the routine's `negu` twice) and applies NO side test; mode 7 targets
 * the home triple; mode 8 targets home with z ± 0x2800, the sign from the slot side flag's high
 * nibble. `sideFlag` is slot+0x04/0x34 — 0x10 selects the far side.
 */
export function op2SlotTarget(
  mode: number, words: readonly number[], home: Triple, sideFlag: number,
): { target: [number, number, number]; tween: number } {
  const m = mode | 0;
  if (m === 3) {
    const target: [number, number, number] = [
      (words[0]! | 0) << 16 >> 16,
      -s16(words[1]! | 0),
      -s16(words[2]! | 0),
    ];
    return { target, tween: words[3]! | 0 };
  }
  if (m === 7) {
    const flag = words[0]! | 0;
    return { target: [home[0], home[1], home[2]], tween: flag };
  }
  if (m === 8) {
    const flag = words[0]! | 0;
    const dz = ((sideFlag | 0) & 0xf0) !== 0 ? -CONTACT_HALF : CONTACT_HALF;
    return { target: [home[0], home[1], (home[2] + dz) & 0xffff], tween: flag };
  }
  return { target: [home[0], home[1], home[2]], tween: 0 };
}

/**
 * The browser ActorAnimator's form of the same three arms: the target MINUS the slot's home, in
 * PS1 units, y down. The actor keeps its slot as this delta (`_move.cur`), so a move is
 * `home + delta`. `side` is the fighter's side ("enemy" = the far side, the slot side flag 0x10).
 */
export function animSlotMoveDelta(
  rec: Op2MoveRecord, home: Triple, side: string,
): [number, number, number] {
  if (rec.kind === "home") return [0, 0, 0];
  if (rec.kind === "contact") {
    return [0, 0, side === "enemy" ? -CONTACT_HALF : CONTACT_HALF];
  }
  // mode 3: rec.x/y/z are already the negated arena-absolute target the action VM hands over.
  return [(rec.x! | 0) - home[0], (rec.y! | 0) - home[1], (rec.z! | 0) - home[2]];
}

/**
 * The ported transformation driver's spawn schedule (FIGHTSTG_F0x80089cd8 over its
 * program), surfaced on the actor-animation system because the driver's step bodies
 * drive this very anim object's slots. `flag` is obj+0x8: 0 = manual DV, nonzero =
 * Blast. The ordinary transformation path reads this through
 * engine/systems/blast-presentation.ts#driverEvolSchedule.
 */
export function transformationAnimSchedule(flag: number): TransformationSpawn[] {
  return createTransformationSchedule({ flag: flag | 0 });
}
