// The action VM's TIMELINE SAMPLER — the playhead that walks one position/frame
// table, loops in place on a 0x8000 marker and freezes on 0xffff.
//
// This is a port of the original pro/fightstg routine read from the disc:
//   FIGHTSTG_F0x80083c30   fightstg.s L1000-1120   the per-tick sampler
// Its three parallel per-entry arrays live on the anim/motion object it is
// handed ($s2):
//   +0x7c  frozen flag (set the tick a 0xffff end marker is reached)
//   +0x80  playhead (advanced by the per-tick delta, clamped to length-1)
//   +0x84  current frame (the value selected this tick)
//   +0x90  last announced loop target
//   +0x94  1 while the selected entry is a loop/blend segment, else 0
//   +0x98  the blend fraction = value & 0x7fff (0..0x1000 fixed point)
//   +0x9c  pending count (frozen-path)
//   +0xa0  table length
//   +0xa4 + 2*playhead   value[]
//   +0xd24 + 2*playhead  loop_target[]
//   +0x19a4 + 2*playhead aux[]
//
// WHY THIS IS A SHARED SYSTEM. Every animated battle actor runs this one routine;
// the browser used to hand-write an approximation inside web/fight/timeline-player.js
// (its own playhead + _setFrom + PlaylistPlayer). This module is the port, and
// tests/engine/unit/battle-timeline-sampler-oracle.test.ts runs the ORIGINAL
// instruction words out of the committed pro_fightstg.bin overlay through
// engine/native and compares every observable field each tick.
//
// TWO OF THE BROWSER'S READINGS WERE WRONG, and this port corrects them (both are
// recorded by the oracle):
//   * `value & 0x8000` means "this entry is a loop/blend segment": the frame is
//     loop_target and the flag goes to 1. The browser treated the two exact
//     sentinels 0x8000 and 0xffff as "ignore the frame"; the original does not
//     skip them at the selected position.
//   * the marker test that loops (0x8000) or freezes (0xffff) runs on the entry
//     the playhead lands on AFTER the advance, not before.
// There is no auto-advancing "playlist" in the engine: a table loops in place
// until a blocking op rebinds the slot (docs/research/fight-3d/action-vm-dispatch.md §g).

/** The bit that marks a loop/blend segment (asm .L0x80083c6c `andi 0x8000`). */
export const SAMPLE_BIT = 0x8000;
/** The pure loop-back marker: jump the playhead to loop_target (asm .L0x80083d68). */
export const LOOP_MARKER = 0x8000;
/** The end marker: freeze the sampler (asm .L0x80083d70). */
export const END_MARKER = 0xffff;
/** Blend fraction scale — 0x1000 fixed-point 1.0, like the motion ramp. */
export const BLEND_TARGET = 0x1000;

/** The three parallel arrays that make one frame table (object +0xa4/+0xd24/+0x19a4). */
export interface TimelineFrameTable {
  /** Entry count (object +0xa0). */
  readonly length: number;
  /** value[] — u16 at object +0xa4 + 2*playhead. */
  readonly values: readonly number[];
  /** loop_target[] — u16 at object +0xd24 + 2*playhead. */
  readonly loopTargets: readonly number[];
  /** aux[] — u16 at object +0x19a4 + 2*playhead. */
  readonly aux: readonly number[];
}

/** One entry as the browser decodes it (`{ value, loop_target, aux }`). */
export interface TimelineEntry {
  value: number;
  loop_target?: number;
  aux?: number;
}

/** Build a TimelineFrameTable from decoded entries (web anim tables). */
export function frameTableFromEntries(entries: readonly TimelineEntry[]): TimelineFrameTable {
  return {
    length: entries.length,
    values: entries.map((e) => e.value & 0xffff),
    loopTargets: entries.map((e) => (e.loop_target ?? 0) & 0xffff),
    aux: entries.map((e) => (e.aux ?? 0) & 0xffff),
  };
}

/** The sampler's mutable state, mirroring the object fields the routine owns. */
export interface SamplerState {
  playhead: number;   // +0x80
  frame: number;      // +0x84
  announced: number;  // +0x90 — last announced loop target
  loopSeg: boolean;   // +0x94 — a loop/blend segment is selected this tick
  frac: number;       // +0x98 — value & 0x7fff
  frozen: boolean;    // +0x7c — a 0xffff end marker has been reached
  /** +0x60 — the frozen-path gate (only the sampler's transition path reads it). */
  gate: number;
  /** +0x9c — the frozen-path pending count. */
  pending: number;
}

/** The object fields a fresh sampler starts from (the browser seeds playhead 1). */
export function newSamplerState(playhead = 1): SamplerState {
  return { playhead, frame: 0, announced: 0, loopSeg: false, frac: 0, frozen: false, gate: 0, pending: 0 };
}

/** The calls FIGHTSTG_F0x80083c30 makes out to the actor's animate/transition graph. */
export interface SamplerHost {
  /**
   * The announce side effects: the sub-slot loop (F0x800835f4 over slots 1..count-1)
   * followed by F0x800839c0. Fired the tick a NEW loop target is announced.
   */
  announce?(loopTarget: number, aux: number): void;
  /**
   * The frozen-path advance (F0x80083a54 and the +0x64 struct's +0x8 increment).
   * Only reached while `gate != 0 && pending != 0`.
   */
  advanceFrozen?(): void;
}

/**
 * The READ half of FIGHTSTG_F0x80083c30: the frozen path, or the frame selection +
 * announce for the entry at the current playhead. It does NOT move the playhead.
 * Returns true on the frozen path (an advance it performed), like the original.
 */
export function readPhase(s: SamplerState, table: TimelineFrameTable, host: SamplerHost = {}): boolean {
  if (s.frozen) {                        // .L0x80083d9c
    s.frame = s.frame;                   // frame untouched in the frozen path
    s.announced = 0;
    s.loopSeg = false;
    if ((s.gate | 0) === 0) return false;
    if ((s.pending | 0) === 0) return false;
    host.advanceFrozen?.();
    return true;
  }

  const v = (table.values[s.playhead] ?? 0) & 0xffff;
  if (v & SAMPLE_BIT) {                  // .L0x80083c6c → loop/blend segment
    const lt = (table.loopTargets[s.playhead] ?? 0) & 0xffff;
    if (s.announced !== lt) {            // .L0x80083c84 — announce only on a change
      s.announced = lt;
      host.announce?.(lt, (table.aux[s.playhead] ?? 0) & 0xffff);
    }
    s.frame = lt;                        // .L0x80083cfc
    s.loopSeg = true;
    s.frac = v & 0x7fff;
  } else {                               // .L0x80083d18 — a plain frame
    s.announced = 0;
    s.frame = v;
    s.loopSeg = false;
  }
  return false;
}

/**
 * The ADVANCE half: playhead += delta, clamp to length-1, then act on the marker
 * the playhead lands on — 0x8000 jumps it to loop_target, 0xffff freezes.
 */
export function advancePlayhead(s: SamplerState, table: TimelineFrameTable, delta: number): void {
  s.playhead = (s.playhead + delta) | 0;          // .L0x80083d38 — advance + clamp
  if (!(s.playhead < table.length)) s.playhead = table.length - 1;

  const nv = (table.values[s.playhead] ?? 0) & 0xffff;   // .L0x80083d60 — land marker
  if (nv === LOOP_MARKER) s.playhead = (table.loopTargets[s.playhead] ?? 0) & 0xffff;
  else if (nv === END_MARKER) s.frozen = true;
}

/**
 * FIGHTSTG_F0x80083c30: ONE call of the sampler for the given table and delta.
 * Returns true if this call performed the frozen-path advance (a host hook).
 *
 * Exact control flow (asm .L0x80083c30-.L0x80083e08):
 *   1. if frozen(+0x7c) → announce cleared, flag cleared; if gate && pending → advance, return.
 *   2. v = value[playhead]; if v & 0x8000 → loop/blend segment:
 *        if loop_target != announced(+0x90): announced = loop_target; announce(...)
 *        frame(+0x84) = loop_target; flag(+0x94) = 1; frac(+0x98) = v & 0x7fff
 *      else: announced = 0; frame = v; flag = 0                       (frame set verbatim)
 *   3. playhead += delta; if playhead >= length → playhead = length - 1
 *   4. nv = value[playhead]; if nv == 0x8000 → playhead = loop_target[playhead]
 *                            if nv == 0xffff → frozen = true
 */
export function sampleTick(
  s: SamplerState,
  table: TimelineFrameTable,
  delta: number,
  host: SamplerHost = {},
): boolean {
  if (readPhase(s, table, host)) return true;
  advancePlayhead(s, table, delta);
  return false;
}
