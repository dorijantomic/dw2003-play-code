// The slot-overlay object class FIGHTSTG_F0x80092f7c — the child the
// transformation driver's substates 5 and 7 spawn and then WAIT ON.
//
// ── what this is ────────────────────────────────────────────────────────────
// The driver's third spawn (the E000EVOL effect after the shared one) is not on a
// disc timer: substate 5 spawns a slot-overlay object through FIGHTSTG_F0x800930c0
// (engine/dw3/battle-effect-driver-host.ts#slotOverlaySpawn) and then blocks until
// the object reports progress (driver step 5, fightstg.s L7451: it polls the
// object's +0x10). Substate 7 then drives it to its end (L7534: the overlay's own
// +0x28 set-state with 2) and blocks until the manager clears the handle
// (L7542: `out+0` zero). Until now that gate was MODELLED in
// createTransformationSchedule (and in the timing test) as a hand-written counter;
// this module is the class's own per-frame step, read from the overlay ASSEMBLY.
//
// ── where it was read ───────────────────────────────────────────────────────
// `FIGHTSTG_F0x80092f7c` is a function-start-labelled routine in
// ~/ddw3/asm/dw2003/pro/fightstg.s L16636-L16702, word-matched against the
// committed image web/assets/native/screens/pro_fightstg.bin (base 0x80082cb0,
// file offset 0x02cc). It is the class descriptor the spawn passes to the
// resident object factory F0x80014504 (which stores it at obj+0x48 and installs
// the shared base-object method table at obj+0x28/+0x38/+0x3c/+0x40); the
// engine's object walk calls it once per frame on the object. It is an ordinary
// `.s` routine, so the installed-routine lift tool was NOT needed.
//
// ── the state machine, exactly as the words read ────────────────────────────
// Reading the disassembler's two-operand rule
// (docs/research/infra/disassembler-operand-printing.md), the body is:
//
//   state = w[obj+0x0c]
//   state == 1            -> ACCUMULATE (0x80092fc8)
//   state == 0 (or >= 4)  -> next-state (obj+0x38); w[obj+0x54] = 0; -> ACCUMULATE
//   state == 2            -> DECODE (0x80093028)
//   state == 3            -> TAIL
//
//   ACCUMULATE (0x80092fc8):
//     if w[obj+0x10] != 0 -> TAIL
//     delta = [0x8004df9c]                      (the frame-delta cell)
//     w[obj+0x54] += w[obj+0x50] * delta        (mult/mflo, low 32)
//     if (signed w[obj+0x54]) < 0xff -> TAIL
//     w[obj+0x54] = 0xff; next-substate (obj+0x3c)
//
//   DECODE (0x80093028):
//     delta = [0x8004df9c]
//     w[obj+0x54] -= w[obj+0x50] * delta
//     store w[obj+0x54]  (delay slot: happens before the branch is resolved)
//     if (signed result) >= 0 -> TAIL
//     w[obj+0x54] = 0; set-state (obj+0x28) with 3
//
//   TAIL (0x80093070): F0x80092e18(obj); return
//
// `w[obj+0x50]` is the per-frame rate the spawn stored (0xff / the caller's arg;
// 7 for the driver's 0x20). The three `+0x28/+0x38/+0x3c` entries are the shared
// base-object family (exe/fns.s F0x80014274/ac/c8 → engine/dw3/battle-effect-driver-host.ts
// baseObjectSetState/NextState/NextSubstate). F0x80092e18 is the class's own
// display-list submission (it builds the slot rectangle's prim from +0x54 and
// links it into the OT); it writes nothing the driver's gate reads, so it is a
// named host boundary here, not part of the gate.
//
// ── the gate the driver reads ───────────────────────────────────────────────
//   step 5 waits for w[obj+0x10] != 0  (set by ACCUMULATE's next-substate), and
//   step 7 waits for the MANAGER to clear the returned handle once the object's
//   state reaches 3 (TAIL does not do it; the object-free is the game's, so the
//   handle-clear is modelled at the caller as a named runtime boundary).
//
// ── what the class writes that the gate depends on ─────────────────────────
//   obj+0x0c (state), obj+0x10 (substate), obj+0x54 (the counter). obj+0x50 is
//   read only. Nothing here is invented: every term is a word in the routine.

/** The counter's state word (which arm of the dispatch runs). */
export const SLOT_OVERLAY_STATE = 0x0c;
/** The readiness flag driver step 5 polls (0 -> 1 when the counter reaches the gate). */
export const SLOT_OVERLAY_SUBSTATE = 0x10;
/** The per-frame rate the spawn stored (0xff / the caller's arg). */
export const SLOT_OVERLAY_RATE = 0x50;
/** The accumulator the readiness gate reads. */
export const SLOT_OVERLAY_COUNTER = 0x54;
/** The gate the counter must reach (`slti $v0, 0xff`, L16684). */
export const SLOT_OVERLAY_GATE = 0xff;
/** The state DECODE sets when the counter runs out (`li $a1, 3`). */
export const SLOT_OVERLAY_DONE_STATE = 3;

export interface SlotOverlayStepMemory {
  read32(addr: number): number;
  write32(addr: number, value: number): void;
}

/** The boundaries one step of the class rests on. */
export interface SlotOverlayStepHost {
  /** [0x8004df9c]: the frame delta for this tick. */
  frameDelta(): number;
  /** obj+0x38 (F0x800142ac): +0x0c++, clear +0x10/+0x14/+0x18. */
  nextState(obj: number): void;
  /** obj+0x3c (F0x800142c8): +0x10++, clear +0x14/+0x18. */
  nextSubstate(obj: number): void;
  /** obj+0x28 (F0x80014274): set +0x0c, clear +0x10/+0x14/+0x18. */
  setState(obj: number, state: number): void;
  /** F0x80092e18(obj): the class's own display-list submission (the slot rectangle). */
  present(obj: number): void;
}

/**
 * FIGHTSTG_F0x80092f7c(obj): one frame of the slot-overlay class. Advances the
 * state machine and always ends by submitting the object's display list.
 */
export function slotOverlayStep(
  M: SlotOverlayStepMemory,
  host: SlotOverlayStepHost,
  obj: number,
): void {
  const o = obj | 0;
  const state = M.read32((o + SLOT_OVERLAY_STATE) >>> 0) | 0;

  if (state === 1) {
    accumulate(M, host, o);
  } else if (state === 2) {
    decode(M, host, o);
  } else if (state === 3) {
    // TAIL only.
  } else {
    // state 0 and every state >= 4: advance the state, clear the counter, then
    // fall straight into ACCUMULATE (the words fall through 0x80092fb4 -> 0x80092fc8).
    host.nextState(o);
    M.write32((o + SLOT_OVERLAY_COUNTER) >>> 0, 0);
    accumulate(M, host, o);
  }

  host.present(o);
}

/** 0x80092fc8: accumulate rate*delta into +0x54; at the gate, flip +0x10. */
function accumulate(M: SlotOverlayStepMemory, host: SlotOverlayStepHost, o: number): void {
  if ((M.read32((o + SLOT_OVERLAY_SUBSTATE) >>> 0) | 0) !== 0) return;
  const delta = host.frameDelta() | 0;
  const rate = M.read32((o + SLOT_OVERLAY_RATE) >>> 0) | 0;
  const sum = ((M.read32((o + SLOT_OVERLAY_COUNTER) >>> 0) | 0) + Math.imul(rate, delta)) | 0;
  M.write32((o + SLOT_OVERLAY_COUNTER) >>> 0, sum);
  if (sum < SLOT_OVERLAY_GATE) return; // signed `slti $v0, 0xff`
  M.write32((o + SLOT_OVERLAY_COUNTER) >>> 0, SLOT_OVERLAY_GATE);
  host.nextSubstate(o);
}

/** 0x80093028: run rate*delta off +0x54; at zero, set state 3. */
function decode(M: SlotOverlayStepMemory, host: SlotOverlayStepHost, o: number): void {
  const delta = host.frameDelta() | 0;
  const rate = M.read32((o + SLOT_OVERLAY_RATE) >>> 0) | 0;
  const sum = ((M.read32((o + SLOT_OVERLAY_COUNTER) >>> 0) | 0) - Math.imul(rate, delta)) | 0;
  M.write32((o + SLOT_OVERLAY_COUNTER) >>> 0, sum); // the branch's delay-slot store
  if (sum >= 0) return; // signed `bgez`
  M.write32((o + SLOT_OVERLAY_COUNTER) >>> 0, 0);
  host.setState(o, SLOT_OVERLAY_DONE_STATE);
}
