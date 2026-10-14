// The effect object family driver of the battle overlay (pro/fightstg): the
// per-tick controller FIGHTSTG_F0x80089cd8 that owns a set of spawned effect
// sprites and drives the transformation presentation.
//
//   FIGHTSTG_F0x80089cd8  fightstg.s L7053-L7765   the driver
//   FIGHTSTG_F0x8008a7f4  fightstg.s L7767          its constructor: allocates a
//                                                  0x74-byte object of type 0x80089cd8
//   FIGHTSTG_F0x8008a83c  fightstg.s L7788          the object's start entry
//
// It is the E000EVOL transformation controller (docs/research/battle/3d-battle-complete-model-2026-08-19.md
// L965, L1250): a fifteen-state controller whose state-1 body is a jump table of
// fifteen handlers, each of which spawns child effects through F0x80089be4 and
// drives the three sub-managers the object owns.
//
// The object (0x74 bytes; +0x50/+0x54/+0x58 are the three sub-manager handles the
// driver calls methods on):
//   +0x04        one word handed to the constructor (F0x8008a7f4 stores its a0)
//   +0x08        the other constructor word (a1) — reads as a "has the hit landed" gate
//   +0x0c        STATE: 0 = unparsed/construct, 1 = program (the 15-substate run),
//                2/3 = landed/finished (return at once), >=4 = construct
//   +0x10        SUBSTATE: the program step under state 1, or the construct stage under state 0
//   +0x14        a mode latch (0 or 1) several bodies branch on
//   +0x18        a running frame TIMER, gated at 0xb4 / 0x78 / 0x3c before advancing
//   +0x1c..+0x26 the effect's sprite fields written by the bodies (sh)
//   +0x28        END entry        (called with 3 to abort)
//   +0x38        advance entry
//   +0x3c        step entry
//   +0x40        self-advance entry (the shared tail calls it)
//   +0x50/+0x54/+0x58  the three sub-managers (handles; the constructor fills +0x50/+0x58)
//   +0x5c..+0x6e the four overlay-quad corners (0x60/0x62, 0x64/0x66, 0x68/0x6a, 0x6c/0x6e)
//   +0x70        a table-derived value (F0x8008a83c divides 0xff00 by it)
//
// WHAT IS PORTED HERE.  This module ports the driver's SHARED CONTROL SYSTEM —
// the entry state dispatch, the state-0 construct-stage dispatch and the state-1
// fifteen-entry jump table with its unsigned bounds check — together with the
// FIFTEEN STEP BODIES and the FOUR CONSTRUCT-STAGE BODIES they select, and the
// timer-gate constants. The bodies are the driver's own call choreography: each
// drives the three sub-managers the object owns (the manager getter
// [0x8004b610+0x1ac], the spawn F0x80089be4, and the sub-managers' own
// +0x188/+0x104/+0xf8/... methods) through an `EffectDriverHost`. They are
// transcribed from the raw words of web/assets/native/screens/pro_fightstg.bin
// (base 0x80082cb0), and proven against the original words by
// tests/engine/unit/battle-effect-driver-steps-oracle.test.ts, which runs the
// original overlay, replaces every callee with a recording host stub, and
// compares the full (site, $a0..$a3) call sequence — and the sequence of stores
// to the driver's objects — to the port. The entry dispatch is separately proven
// by tests/engine/unit/battle-effect-driver-oracle.test.ts.
//
// Their observable output — the Evolve transformation screen, which spawns effect
// ids 0x3E8/0x3E9/0x3EA/0x3EB/0x3EF/0x3F0 through F0x80089be4 — is now driven by this
// state machine on the ordinary route: engine/systems/blast-presentation.ts#evolEffectsDue
// runs the ported bodies (through engine/dw3/battle-effect-driver-host.ts
// #createTransformationSchedule) and spawns at the driver's own frames. The frozen
// walker table (EVOL_EFFECT_SCHEDULE) is kept for reference; see
// docs/research/battle/transformation-driver-wired-2026-10-06.md.
//
// This module is DOM-free and has no host dependency.

/** The driver's `+0x0c` state values (fightstg.s L7066 dispatch). */
export const EFFECT_DRIVER_STATE_CONSTRUCT = 0;
export const EFFECT_DRIVER_STATE_PROGRAM = 1;
export const EFFECT_DRIVER_STATE_LANDED = 2;
export const EFFECT_DRIVER_STATE_FINISHED = 3;

/** The entry labels the `+0x0c` dispatch targets. */
export const EFFECT_DRIVER_ENTRY_CONSTRUCT = 0x80089d28; // state 0 and state >= 4 — the eval block
export const EFFECT_DRIVER_ENTRY_PROGRAM = 0x80089f20;   // state 1 — the 15-entry jump table
export const EFFECT_DRIVER_ENTRY_RETURN = 0x8008a7d4;    // state 2/3 — the shared epilogue

/** The four construct-stage targets the `+0x10` dispatch under state 0 reaches. */
export const EFFECT_DRIVER_STAGE_DEFAULT = 0x80089d50;   // substate 0 and >= 4
export const EFFECT_DRIVER_STAGE_SETUP = 0x80089db4;     // substate 1 — builds the sub-managers
export const EFFECT_DRIVER_STAGE_MODE2 = 0x80089e70;     // substate 2
export const EFFECT_DRIVER_STAGE_MODE3 = 0x80089eb8;     // substate 3

/**
 * The state-1 fifteen-entry jump table D0x80082de0 (fightstg.s L66-L80). Entry k is
 * the handler for substate k. Entry 0's address is also the >= 15 default (f50).
 */
export const EFFECT_DRIVER_SUBSTATE_HANDLERS: readonly number[] = [
  0x80089f50, 0x80089f8c, 0x8008a02c, 0x8008a180, 0x8008a2a4,
  0x8008a2e0, 0x8008a32c, 0x8008a43c, 0x8008a490, 0x8008a5cc,
  0x8008a5f8, 0x8008a634, 0x8008a664, 0x8008a6bc, 0x8008a6c8,
];

/** The frame-timer gates the bodies compare `+0x18` against (slti at L7262/L7435/L7751). */
export const EFFECT_DRIVER_TIMER_GATES = [0xb4, 0x78, 0x3c] as const;

/** The driver's `+0x0c` entry target: which block a given state runs. */
export type EffectDriverEntry = "construct" | "program" | "return";

/**
 * FIGHTSTG_F0x80089cd8 entry dispatch (L7068-L7074). Signed comparisons, exactly as
 * the original: state 1 -> program; state < 2 -> construct; state < 4 (2 or 3) ->
 * return; anything else (>= 4) -> construct.
 */
export function effectDriverEntryTarget(state: number): EffectDriverEntry {
  const s = state | 0;
  if (s === EFFECT_DRIVER_STATE_PROGRAM) return "program";
  if (s < 2) return "construct";
  if (s < 4) return "return";
  return "construct";
}

/** Which construct-stage block a `+0x10` value selects under state 0. */
export type EffectDriverStage = "default" | "setup" | "mode2" | "mode3";

/**
 * The state-0 construct-stage dispatch (L7075-L7084). substate 1 -> setup, 2 -> mode2,
 * 3 -> mode3, and 0 or >= 4 -> default (the signed `slti $v0, $v1, 0x2` sends
 * negatives to default too).
 */
export function effectDriverStageTarget(substate: number): EffectDriverStage {
  const s = substate | 0;
  if (s === 1) return "setup";
  if (s === 2) return "mode2";
  if (s === 3) return "mode3";
  return "default";
}

/**
 * The state-1 jump-table dispatch (L7201-L7212): an UNSIGNED `sltiu $v0, $v1, 0xf`.
 * A substate below 15 runs its handler; 15 or above (including any negative reading
 * as a huge unsigned) runs the default, which is handler 0.
 */
export function effectDriverProgramTarget(substate: number): number {
  const s = substate >>> 0;
  return s < EFFECT_DRIVER_SUBSTATE_HANDLERS.length
    ? EFFECT_DRIVER_SUBSTATE_HANDLERS[s]!
    : EFFECT_DRIVER_SUBSTATE_HANDLERS[0]!;
}

// ═══════════════════════════════════════════════════════════════════════════════
// THE FIFTEEN STEP BODIES AND THE FOUR CONSTRUCT-STAGE BODIES
//
// The bodies are the driver's own call choreography: each reads a few object
// fields, then drives the three sub-managers it owns and the effect spawner. The
// original reaches every callee through a register-indirect `lw v0, off(reg);
// jalr v0`, so the port is written against an `EffectDriverHost` whose `call`
// reproduces exactly that (a method load on a handle at an offset). Globals the
// bodies reach — the object-lookup cell, the frame-delta cell, the SFX cell, the
// render-layer registry and the resource service — are called through `callCell`
// and `callDirect`, and the effect spawner F0x80089be4 through `spawn`.
//
// The argument registers are threaded through one invocation exactly as the
// original's `$a0..$a3` are: a body that does not set an argument leaves the
// previous body's value in it, and the oracle compares all four registers at
// every call. `r[0]` starts at 1 because the entry does `li $a0, 0x1` before the
// dispatch (the bodies overwrite it before their visible calls).
//
// The bodies COMPOSE by fallthrough, and the composition is part of the original
// code, not an artefact: handler 0 runs on and into handler 1 (L7213-L7227), 2
// into 3, 6 into 7, 9 into 10, 11 into 12; the construct stages chain setup ->
// mode2 -> mode3 (L7110-L7181). A body reached directly by the jump table runs
// alone; the same body reached by an earlier body's fallthrough runs after it.
//
// Each body is transcribed from the raw words of web/assets/native/screens/
// pro_fightstg.bin (base 0x80082cb0) as printed in ~/ddw3/asm/dw2003/pro/
// fightstg.s L7053-L7765. The disassembler prints a two-operand subtract/`sll`
// shortened (docs/research/infra/disassembler-operand-printing.md): `subu $v1,
// $v0` means `v1 = v1 - v0`, `sll $a0, 0x10` means `a0 = a0 << 16`.
// ═══════════════════════════════════════════════════════════════════════════════

/** A global this driver reaches. */
export const EFFECT_DRIVER_CELL_OBJ_GET = 0x8004b7bc;    // [0x8004b610 + 0x1ac]: object lookup by type
export const EFFECT_DRIVER_CELL_55C54 = 0x80055c54;
export const EFFECT_DRIVER_CELL_55C60 = 0x80055c60;
export const EFFECT_DRIVER_CELL_DF9C = 0x8004df9c;       // frame delta
export const EFFECT_DRIVER_CELL_55C48 = 0x80055c48;      // play SFX
export const EFFECT_DRIVER_CELL_4570 = 0x800a4570;       // resource-record getter
export const EFFECT_DRIVER_CELL_44F44 = 0x80044f44;
export const EFFECT_DRIVER_LAYER_REGISTRY = 0x8004de10;  // render-layer registry object (methods at +0x17c / +0x18c)
export const EFFECT_DRIVER_RESOURCE_SERVICE = 0x80044b38; // resource/cache service object (+0x404/+0x40c/+0x424)
export const EFFECT_DRIVER_SPAWN_POS_ORIGIN = 0x80082dc8;
export const EFFECT_DRIVER_SPAWN_POS_CENTRE = 0x80082dd0;
export const EFFECT_DRIVER_SPAWN_POS_NEG = 0x80082dd8;
export const EFFECT_DRIVER_SFX_SOURCE = 0x80042b28;      // word read as the SFX argument
export const EFFECT_DRIVER_SFX_SOURCE2 = 0x80042b30;     // word read as the SFX argument
export const EFFECT_DRIVER_SFX_OFFSET_TABLE = 0x800a46d8; // {…, +0x8, +0x14} adjusted by the effect's own +0x2c

/** The effect spawner's table the handlers pass (F0x80089be4). */
export const EFFECT_DRIVER_SPAWN_TABLE = {
  ORIGIN: EFFECT_DRIVER_SPAWN_POS_ORIGIN,
  CENTRE: EFFECT_DRIVER_SPAWN_POS_CENTRE,
  NEG: EFFECT_DRIVER_SPAWN_POS_NEG,
} as const;

/**
 * The host the step bodies run against. `call` is the register-indirect method
 * call (`lw v0, off(handle); jalr v0`), `callCell` a call through a global
 * function-pointer cell, `callDirect` a `jal` to a fixed address, `spawn` the
 * effect spawner F0x80089be4, and `contextFill` the F0x8001ffa8 sound/render
 * context the mode-3 stage builds on the stack.
 */
export interface EffectDriverHost {
  read(handle: number, offset: number): number;
  read16u(handle: number, offset: number): number;
  read16s(handle: number, offset: number): number;
  write(handle: number, offset: number, value: number): void;
  write16(handle: number, offset: number, value: number): void;
  call(handle: number, offset: number, args: readonly number[]): number;
  callCell(addr: number, args: readonly number[]): number;
  callDirect(addr: number, args: readonly number[]): number;
  spawn(id: number, table: number): number;
  contextFill(args: readonly number[]): number;
}

export type EffectDriverRegs = [number, number, number, number];

/**
 * Threaded argument registers for one driver invocation. The entry does
 * `li $a0, 0x1` before the dispatch, and `$a1` still holds the caller's second
 * argument — the out-record pointer the driver copies into `$s4` — so bodies that
 * reach a call before setting `$a1` pass that pointer on.
 */
export function effectDriverRegs(out: number): EffectDriverRegs {
  return [1, out | 0, 0, 0];
}

const LAYER_REG = EFFECT_DRIVER_LAYER_REGISTRY;
const RES = EFFECT_DRIVER_RESOURCE_SERVICE;
const SFX_OFF = EFFECT_DRIVER_SFX_OFFSET_TABLE;

// ── the four construct-stage bodies (state 0) ────────────────────────────────

/** Stage default L7085-L7109: substate 0 and >= 4. */
function stageDefault(H: EffectDriverHost, obj: number, out: number, r: EffectDriverRegs): void {
  void out;
  if (H.read(obj, 0x14) !== 1) {
    r[0] = 0x45;
    H.callCell(EFFECT_DRIVER_CELL_55C54, r);
    r[0] = obj;
    H.call(obj, 0x40, r);
  }
  const v = H.callCell(EFFECT_DRIVER_CELL_55C60, r);
  if (v !== 0) return;
  r[0] = obj;
  H.call(obj, 0x3c, r);      // j a784, v0 = obj+0x3c (da8)
}

/** Stage setup L7110-L7156: substate 1. Falls through into mode2, then mode3. */
function stageSetup(H: EffectDriverHost, obj: number, out: number, r: EffectDriverRegs): void {
  void out;
  r[0] = 0x14; r[1] = -1; r[2] = -1;
  const s1 = H.callCell(EFFECT_DRIVER_CELL_OBJ_GET, r);
  H.write(obj, 0x50, s1);
  r[0] = 0x12; r[1] = -1; r[2] = -1;
  const s2 = H.callCell(EFFECT_DRIVER_CELL_OBJ_GET, r);
  H.write(obj, 0x54, s2);
  r[0] = 0x15; r[1] = -1; r[2] = -1;
  const s3 = H.callCell(EFFECT_DRIVER_CELL_OBJ_GET, r);
  H.write(obj, 0x58, s3);
  r[0] = H.read(obj, 0x4);
  const rec = H.callCell(EFFECT_DRIVER_CELL_4570, r);
  r[0] = H.read16s(rec, 0x2);
  H.write(obj, 0x70, r[0]);
  H.callCell(EFFECT_DRIVER_CELL_44F44, r);
  r[0] = s1; r[1] = 0;
  const m = H.call(s1, 0x188, r);
  const v = H.read(m, 0x18);
  r[0] = obj;
  H.write(obj, 0x5c, v);       // executed in the delay slot of the obj+0x3c call
  H.call(obj, 0x3c, r);
}

/** Stage mode2 L7157-L7173: substate 2. Falls through into mode3. */
function stageMode2(H: EffectDriverHost, obj: number, out: number, r: EffectDriverRegs): void {
  void out;
  r[0] = H.read(obj, 0x70);
  if (H.call(RES, 0x404, r) !== 0) return;
  r[0] = 0x8a2;
  H.callCell(EFFECT_DRIVER_CELL_44F44, r);   // RES+0x40c IS the global cell 0x80044f44
  r[0] = obj;
  H.call(obj, 0x3c, r);
}

/** Stage mode3 L7174-L7199: substate 3. */
function stageMode3(H: EffectDriverHost, obj: number, out: number, r: EffectDriverRegs): void {
  void out;
  r[0] = 0x8a2;
  if (H.call(RES, 0x404, r) !== 0) return;
  const ctx = H.contextFill(r);
  r[0] = 0x300; r[1] = 0x100;
  H.call(ctx, 0x24, r);
  r[0] = 0x08a20005;           // set in the delay slot of the +0x424 call
  const w = H.call(RES, 0x424, r);
  r[0] = w;                    // `move a0, v0` in the delay slot of the ctx+0x2c call
  H.call(ctx, 0x2c, r);
  r[0] = obj;
  H.call(obj, 0x38, r);      // j a784, v0 = obj+0x38 (f14) — the advance entry
}

/** Run a construct-stage body, including its fallthrough chain. */
export function effectDriverConstructStageBody(
  stage: EffectDriverStage, H: EffectDriverHost, obj: number, out: number,
  r: EffectDriverRegs = effectDriverRegs(out),
): void {
  if (stage === "default") { stageDefault(H, obj, out, r); return; }
  if (stage === "setup") stageSetup(H, obj, out, r);
  else if (stage === "mode2") stageMode2(H, obj, out, r);
  else { stageMode3(H, obj, out, r); return; }
  if (stage === "setup") { stageMode2(H, obj, out, r); stageMode3(H, obj, out, r); }
  else stageMode3(H, obj, out, r);
}

// ── the fifteen step bodies (state 1) ────────────────────────────────────────

/** Handler 0 L7213-L7227: default for substate >= 15. Falls through into handler 1. */
function step0(H: EffectDriverHost, obj: number, out: number, r: EffectDriverRegs): void {
  void out;
  const m3 = H.read(obj, 0x58);
  r[1] = H.read(obj, 0x8) !== 0 ? 0x1f : 0x1c;
  r[2] = 0x20; r[3] = 0x20; r[0] = m3;
  H.call(m3, 0xe8, r);
  r[0] = obj;
  H.call(obj, 0x3c, r);
}

/** Handler 1 L7228-L7267. */
function step1(H: EffectDriverHost, obj: number, out: number, r: EffectDriverRegs): boolean {
  void out;
  const m1 = H.read(obj, 0x50);
  const m3 = H.read(obj, 0x58);
  if (H.read(obj, 0x14) !== 1) {
    if (H.read(m3, 0xc) === 2) return true;   // tail: plain return
    r[0] = 0x41140000;
    H.callCell(EFFECT_DRIVER_CELL_55C48, r);
    r[0] = m1; r[1] = 1; r[2] = H.read(obj, 0x4); r[3] = 0;
    H.call(m1, 0x184, r);
    r[0] = obj;
    H.call(obj, 0x40, r);
  }
  const d = H.callCell(EFFECT_DRIVER_CELL_DF9C, r);
  H.write(obj, 0x18, (H.read(obj, 0x18) + d) | 0);
  if (H.read(obj, 0x18) < 0xb4) return true;
  r[0] = obj;
  H.call(obj, 0x3c, r);      // `.L0x8008a784` is a nop: it calls the v0 loaded at a020 (0x3c)
  return true;
}

/** Handler 2 L7268-L7352. Falls through into handler 3. */
function step2(H: EffectDriverHost, obj: number, out: number, r: EffectDriverRegs): void {
  const m1 = H.read(obj, 0x50);
  const m2 = H.read(obj, 0x54);
  H.write16(obj, 0x60, 0); H.write16(obj, 0x62, 0);
  H.write16(obj, 0x64, 0x140); H.write16(obj, 0x66, 0xf0);
  H.write16(obj, 0x68, 0); H.write16(obj, 0x6a, 0xf0);
  H.write16(obj, 0x6c, 0x140); H.write16(obj, 0x6e, 0);
  r[0] = m1; r[1] = 0;
  const S0 = H.call(m1, 0x188, r);      // v0 is live in the delay slot of the m2+0x104 call
  r[0] = m2; r[1] = 0; r[2] = 9;
  H.call(m2, 0x104, r);                 // result discarded; s0 above is what the math uses
  const adj = (-H.read16s(S0, 0x2c)) | 0;
  const g8 = H.read(SFX_OFF, 0x8); const g14 = H.read(SFX_OFF, 0x14);
  H.write(SFX_OFF, 0x8, (g8 + adj) | 0);
  H.write(SFX_OFF, 0x14, (g14 + adj) | 0);
  const v1 = H.read16u(S0, 0x2a);
  r[0] = m2; r[1] = SFX_OFF; r[2] = adj;
  H.call(m2, 0xf8, r);
  H.write(S0, 0x40, 1); H.write(S0, 0x48, 1); H.write(S0, 0x44, 0x1003);
  H.write16(S0, 0x1c, 0); H.write16(S0, 0x20, 0); H.write16(S0, 0x22, 0);
  H.write16(S0, 0x24, 0x800); H.write16(S0, 0x26, 0); H.write16(S0, 0x1e, v1);
  H.write(S0, 0x8, H.read(obj, 0x8) !== 0 ? 0xe : 0xd);
  r[0] = m1; r[1] = 0x10;
  const Hh = H.call(m1, 0x188, r);
  H.write(Hh, 0x34, 0);
  if (H.read(obj, 0x8) === 0) {
    r[0] = 0x3e8; r[1] = EFFECT_DRIVER_SPAWN_POS_ORIGIN;
    const e1 = H.spawn(0x3e8, EFFECT_DRIVER_SPAWN_POS_ORIGIN);
    H.write(out, 0x8, e1);
    r[0] = 0x3e9; r[1] = EFFECT_DRIVER_SPAWN_POS_ORIGIN;
    const e2 = H.spawn(0x3e9, EFFECT_DRIVER_SPAWN_POS_ORIGIN);
    H.write(out, 0xc, e2);
  } else {
    r[0] = 0x3ef; r[1] = EFFECT_DRIVER_SPAWN_POS_ORIGIN;
    const e = H.spawn(0x3ef, EFFECT_DRIVER_SPAWN_POS_ORIGIN);
    H.write(out, 0x8, e);
  }
  r[0] = obj;
  H.call(obj, 0x3c, r);
}

/** Handler 3 L7353-L7425. */
function step3(H: EffectDriverHost, obj: number, out: number, r: EffectDriverRegs): void {
  const m1 = H.read(obj, 0x50);
  const d = H.callCell(EFFECT_DRIVER_CELL_DF9C, r);   // the layer registry's +0x18c IS 0x8004df9c
  const dd = (d << 1) | 0;
  H.write16(obj, 0x66, (H.read16u(obj, 0x66) - dd) | 0);
  let a0 = (H.read16u(obj, 0x6a) - dd) | 0;
  H.write16(obj, 0x6a, a0);
  const nn = (H.read16u(obj, 0x6e) + dd) | 0;
  const sgn = (a0 << 16) | 0;
  if (sgn <= 0) {
    H.write16(obj, 0x6e, nn);
    H.write16(obj, 0x66, 0); H.write16(obj, 0x6e, 0xf0); H.write16(obj, 0x6a, 0);
    r[0] = m1; r[1] = 0;
    const Hh = H.call(m1, 0x188, r);
    r[0] = 0x3ea; r[1] = EFFECT_DRIVER_SPAWN_POS_CENTRE;
    const e = H.spawn(0x3ea, EFFECT_DRIVER_SPAWN_POS_CENTRE);
    H.write(Hh, 0x34, 0);
    H.write(out, 0x10, e);
    r[0] = obj;
    H.call(obj, 0x3c, r);
  } else {
    H.write16(obj, 0x6e, nn);
  }
  r[0] = 0x1004;
  const la = H.call(LAYER_REG, 0x17c, r);
  r[0] = la; r[1] = H.read16s(obj, 0x60); r[2] = H.read16s(obj, 0x62);
  H.call(la, 0x110, r);
  r[0] = la; r[1] = H.read16s(obj, 0x64); r[2] = H.read16s(obj, 0x66);
  H.call(la, 0x114, r);
  r[0] = 0x1003;
  const lb = H.call(LAYER_REG, 0x17c, r);
  r[0] = lb; r[1] = H.read16s(obj, 0x68); r[2] = H.read16s(obj, 0x6a);
  H.call(lb, 0x110, r);
  r[0] = lb; r[1] = H.read16s(obj, 0x6c); r[2] = H.read16s(obj, 0x6e);
  H.call(lb, 0x114, r);
  void a0;
}

/** Handler 4 L7426-L7440. */
function step4(H: EffectDriverHost, obj: number, out: number, r: EffectDriverRegs): void {
  void out;
  const d = H.callCell(EFFECT_DRIVER_CELL_DF9C, r);
  H.write(obj, 0x18, (H.read(obj, 0x18) + d) | 0);
  if (H.read(obj, 0x18) < 0x78) return;
  r[0] = obj;
  H.call(obj, 0x3c, r);      // j a784, v0 = obj+0x3c (a2d4)
}

/** Handler 5 L7441-L7459. */
function step5(H: EffectDriverHost, obj: number, out: number, r: EffectDriverRegs): void {
  if (H.read(obj, 0x14) !== 1) {
    r[0] = 0x20;
    const v = H.callDirect(0x800930c0, r);
    H.write(out, 0x0, v);
    r[0] = obj;
    H.call(obj, 0x40, r);    // j a780 → obj+0x40
  } else {
    const p = H.read(out, 0x0);
    if (H.read(p, 0x10) === 0) return;
    r[0] = obj;
    H.call(obj, 0x3c, r);    // j a784, v0 = obj+0x3c (a320)
  }
}

/** Handler 6 L7460-L7527. Falls through into handler 7. */
function step6(H: EffectDriverHost, obj: number, out: number, r: EffectDriverRegs): void {
  void out;
  const m1 = H.read(obj, 0x50);
  const m2 = H.read(obj, 0x54);
  r[0] = m1; r[1] = 1; r[2] = 0;
  H.call(m1, 0x18c, r);
  r[0] = m1; r[1] = 0;
  const Hh = H.call(m1, 0x188, r);
  H.write(Hh, 0x38, 0x1004); H.write(Hh, 0x34, 1); H.write(Hh, 0x3c, 0);
  H.write(Hh, 0x40, 1); H.write(Hh, 0x48, 1); H.write(Hh, 0x44, 0x1003);
  r[0] = m1; r[1] = 0;
  H.call(m1, 0x194, r);
  r[0] = m2; r[1] = 0; r[2] = 9;
  H.call(m2, 0x104, r);
  const adj = (-H.read16s(Hh, 0x2c)) | 0;
  const g8 = H.read(SFX_OFF, 0x8); const g14 = H.read(SFX_OFF, 0x14);
  H.write(SFX_OFF, 0x8, (g8 + adj) | 0);
  H.write(SFX_OFF, 0x14, (g14 + adj) | 0);
  r[0] = m2; r[1] = SFX_OFF; r[2] = adj;
  H.call(m2, 0xf8, r);
  const v1 = H.read16u(Hh, 0x2a);
  H.write16(Hh, 0x1c, 0); H.write16(Hh, 0x20, 0); H.write16(Hh, 0x22, 0);
  H.write16(Hh, 0x24, 0x800); H.write16(Hh, 0x26, 0); H.write16(Hh, 0x1e, v1);
  H.write16(obj, 0x64, 0x140); H.write16(obj, 0x6c, 0x140);
  H.write16(obj, 0x60, 0); H.write16(obj, 0x62, 0); H.write16(obj, 0x66, 0);
  H.write16(obj, 0x68, 0); H.write16(obj, 0x6a, 0);
  H.write16(obj, 0x6e, 0xf0);                  // delay slot of the obj+0x3c call
  r[0] = obj;
  H.call(obj, 0x3c, r);
}

/** Handler 7 L7528-L7548. */
function step7(H: EffectDriverHost, obj: number, out: number, r: EffectDriverRegs): void {
  if (H.read(obj, 0x14) !== 1) {
    const a0 = H.read(out, 0x0);
    r[0] = a0; r[1] = 2;
    H.call(a0, 0x28, r);
    r[0] = obj;
    H.call(obj, 0x40, r);
  } else {
    if (H.read(out, 0x0) !== 0) return;
    r[0] = obj;
    H.call(obj, 0x3c, r);    // j a784, v0 = obj+0x3c (a484)
  }
}

/** Handler 8 L7549-L7627. */
function step8(H: EffectDriverHost, obj: number, out: number, r: EffectDriverRegs): void {
  const m1 = H.read(obj, 0x50);
  const d = H.callCell(EFFECT_DRIVER_CELL_DF9C, r);
  const dd = (d << 1) | 0;
  H.write16(obj, 0x66, (H.read16u(obj, 0x66) + dd) | 0);
  H.write16(obj, 0x6a, (H.read16u(obj, 0x6a) + dd) | 0);
  const nn = (H.read16u(obj, 0x6e) - dd) | 0;
  if (H.read16s(obj, 0x66) >= 0xf0) {
    H.write16(obj, 0x6e, nn);
    H.write16(obj, 0x66, 0xf0); H.write16(obj, 0x6a, 0xf0); H.write16(obj, 0x6e, 0);
    r[0] = m1; r[1] = 0;
    const Hh = H.call(m1, 0x188, r);
    H.write(Hh, 0x40, 0);
    const id = H.read(obj, 0x8) === 0 ? 0x3eb : 0x3f0;
    r[0] = id; r[1] = EFFECT_DRIVER_SPAWN_POS_NEG;
    const e = H.spawn(id, EFFECT_DRIVER_SPAWN_POS_NEG);
    H.write(out, 0x14, e);
    r[0] = obj;
    H.call(obj, 0x3c, r);
  } else {
    H.write16(obj, 0x6e, nn);
  }
  r[0] = 0x1004;
  const la = H.call(LAYER_REG, 0x17c, r);
  r[0] = la; r[1] = H.read16s(obj, 0x60); r[2] = H.read16s(obj, 0x62);
  H.call(la, 0x110, r);
  r[0] = la; r[1] = H.read16s(obj, 0x64); r[2] = H.read16s(obj, 0x66);
  H.call(la, 0x114, r);
  r[0] = 0x1003;
  const lb = H.call(LAYER_REG, 0x17c, r);
  r[0] = lb; r[1] = H.read16s(obj, 0x68); r[2] = H.read16s(obj, 0x6a);
  H.call(lb, 0x110, r);
  r[0] = lb; r[1] = H.read16s(obj, 0x6c); r[2] = H.read16s(obj, 0x6e);
  H.call(lb, 0x114, r);
}

/** Handler 9 L7628-L7638. Falls through into handler 10. */
function step9(H: EffectDriverHost, obj: number, out: number, r: EffectDriverRegs): void {
  void out;
  const m1 = H.read(obj, 0x50);
  r[0] = m1; r[1] = 0;
  const Hh = H.call(m1, 0x188, r);
  H.write(Hh, 0x8, 0xd);
  r[0] = obj;
  H.call(obj, 0x3c, r);
}

/** Handler 10 L7639-L7653. */
function step10(H: EffectDriverHost, obj: number, out: number, r: EffectDriverRegs): void {
  void out;
  const d = H.callCell(EFFECT_DRIVER_CELL_DF9C, r);
  H.write(obj, 0x18, (H.read(obj, 0x18) + d) | 0);
  if (H.read(obj, 0x18) < 0xb4) return;
  r[0] = obj;
  H.call(obj, 0x3c, r);      // j a784, v0 = obj+0x3c (a628)
}

/** Handler 11 L7654-L7665. Falls through into handler 12. */
function step11(H: EffectDriverHost, obj: number, out: number, r: EffectDriverRegs): void {
  void out;
  const m3 = H.read(obj, 0x58);
  r[0] = m3; r[2] = 0x20;
  r[1] = H.read(EFFECT_DRIVER_SFX_SOURCE, 0);
  r[3] = r[2];
  H.call(m3, 0xe8, r);
  r[0] = obj;
  H.call(obj, 0x3c, r);
}

/** Handler 12 L7666-L7687. */
function step12(H: EffectDriverHost, obj: number, out: number, r: EffectDriverRegs): void {
  void out;
  const m1 = H.read(obj, 0x50);
  const m2 = H.read(obj, 0x54);
  const m3 = H.read(obj, 0x58);
  if (H.read(m3, 0xc) === 2) return;
  r[0] = m1; r[1] = 0;
  H.call(m1, 0x194, r);
  r[0] = m2; r[1] = 0; r[2] = 9;
  const R = H.call(m2, 0x104, r);
  r[0] = m2; r[1] = R;
  H.call(m2, 0xf8, r);
  r[0] = obj;
  H.call(obj, 0x3c, r);      // j a784, v0 = obj+0x3c (a6b0)
}

/** Handler 13 L7688-L7690. */
function step13(H: EffectDriverHost, obj: number, out: number, r: EffectDriverRegs): void {
  void out;
  r[0] = obj;
  H.call(obj, 0x3c, r);      // j a784, v0 = obj+0x3c (a6bc)
}

/** Handler 14 L7691-L7757. */
function step14(H: EffectDriverHost, obj: number, out: number, r: EffectDriverRegs): void {
  void out;
  const m1 = H.read(obj, 0x50);
  const m2 = H.read(obj, 0x54);
  if (H.read(obj, 0x14) !== 1) {
    r[0] = m1; r[1] = 0x10;
    const h1 = H.call(m1, 0x188, r);
    H.write(h1, 0x34, 1);
    r[0] = m1; r[1] = 0;
    const h2 = H.call(m1, 0x188, r);
    if (H.read(obj, 0x8) === 0) {
      r[0] = h2;
      H.write(r[0], 0x8, H.read(obj, 0x5c) !== 0 ? 2 : 1);
    } else {
      H.write(r[0], 0x8, 1);       // a0 is still m1 on this branch
    }
    r[0] = m2;
    const q = H.call(m2, 0x100, r);
    r[0] = m2; r[1] = 0; r[2] = q; r[3] = 0x3c;
    H.call(m2, 0xfc, r);
    r[0] = H.read(EFFECT_DRIVER_SFX_SOURCE2, 0);
    H.callCell(EFFECT_DRIVER_CELL_55C48, r);
    r[0] = obj;
    H.call(obj, 0x40, r);
  } else {
    const d = H.callCell(EFFECT_DRIVER_CELL_DF9C, r);
    H.write(obj, 0x18, (H.read(obj, 0x18) + d) | 0);
    if (H.read(obj, 0x18) < 0x3c) return;
    r[0] = obj; r[1] = 3;
    H.call(obj, 0x28, r);
  }
}

const STEP_BODIES: ReadonlyArray<(H: EffectDriverHost, obj: number, out: number, r: EffectDriverRegs) => void> = [
  step0, step1, step2, step3, step4, step5, step6, step7,
  step8, step9, step10, step11, step12, step13, step14,
];

/** The bodies a handler runs on into, keyed by handler index. */
export const EFFECT_DRIVER_STEP_FALLTHROUGH: Readonly<Record<number, number>> = Object.freeze({
  0: 1, 2: 3, 6: 7, 9: 10, 11: 12,
});

/** Run the step body for `substate`, following the original fallthrough chain. */
export function effectDriverProgramBody(
  substate: number, H: EffectDriverHost, obj: number, out: number,
  r: EffectDriverRegs = effectDriverRegs(out),
): void {
  const target = effectDriverProgramTarget(substate);
  let i = EFFECT_DRIVER_SUBSTATE_HANDLERS.indexOf(target);
  if (i < 0) i = 0;
  for (;;) {
    STEP_BODIES[i]!(H, obj, out, r);
    const next = EFFECT_DRIVER_STEP_FALLTHROUGH[i];
    if (next === undefined) return;
    i = next;
  }
}
