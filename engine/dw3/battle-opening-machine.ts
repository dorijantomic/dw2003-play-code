// engine/dw3/battle-opening-machine.ts
//
// THE BATTLE'S OPENING PHASE MACHINE — the port of the #2 jump-table arm of
// `pro/wfightmn`'s controller `F0x800a6c44` (file `0xe64`).
//
// The controller runs one phase handler per frame while the battle's own
// three-level state word selects the #2 arm: top state `ctx+0x0c == 0` and
// sub-state `ctx+0x10 == 2`. The phase word is `ctx+0x14`; the 7-entry jump
// table is file `0x01c` (RAM `0x800a5dfc`, `wfightmn.s:13-19`) and the inline
// dispatcher sits at file `0xf60` (`wfightmn.s:991-1002`) — `lw $v1,0x14($s2)`;
// `sltiu $v0,$v1,7`; `addiu $v0,$0x5dfc`; `jr $v0` — so a phase >= 7 (and any
// negative) falls to phase 0's own handler at file `0xf90`.
//
// The seven phases (lifted bodies `.hermes/cache/scratch/wlift_y/F0x800a*.c`;
// named in `.dw3-research/turn-loop-phases-2026-10-07/worker-aa.md`):
//
//   0 assembleBattleObjects     0x800a6d70  file 0xf90
//   1 loadEncounterAndFighters  0x800a6dbc  file 0xfdc
//   2 queueBattleOverlay        0x800a7030  file 0x1250
//   3 awaitOverlay              0x800a7048  file 0x1268
//   4 sweepActionQueue          0x800a7060  file 0x1280
//   5 frameCameraOrOpenLine     0x800a707c  file 0x129c
//   6 awaitLineThenHandOff      0x800a7220  file 0x1440
//
// TRANSITIONS, all from the lifted bodies (not from the walker):
//   * phase 0 ends by calling `ctx->+0x40` = `F0x800142e0` = `+0x14++, clear +0x18`.
//   * phases 1, 2, 4 end with the shared tail `+0x14++` (file `0x1288`).
//   * phase 3 returns while `block+0 != 0`, else advances.
//   * phase 5 reads `ctx+0x18`: nonzero -> opens the message window at
//     `block+0x1C`, writes `ctx+0x50 = 7`, advances; zero -> the camera beat and
//     `ctx->+0x38` = `F0x800142ac` = `+0x0c++, clear +0x10/+0x14/+0x18` — it EXITS
//     the whole machine.
//   * phase 6 reads `block+0x1C`: zero -> `ctx->+0x38` (EXIT).
//
// The EXIT advances the TOP state `ctx+0x0c` to 1, and `ctx+0x0c == 1` is the
// branch that drives the already-ported secondary action sequencer
// `F0x800a9cb4` (`engine/dw3/battle-action-sequencer.ts`); so the machine hands
// the fight to that port rather than to a timer.
//
// This module is the machine only: the real work of each phase (the five fight
// sub-objects, the encounter/fighter load, the overlay queue, the queue sweep,
// the opening line) is supplied by an `OpeningPorts` object, exactly as the
// browser's fight flow supplies the already-ported systems. The module carries
// the transitions and gating; the ports carry the work.

/** The overlay's RAM load base (`pro/wfightmn`), file offset 0 == this. */
export const OPENING_MACHINE_BASE = 0x800a5de0;
/** The #2 phase table file offset (RAM `0x800a5dfc`; `wfightmn.s:13-19`). */
export const OPENING_PHASE_TABLE_FILE = 0x1c;
/** The #2 controller entry (`F0x800a6c44`, file `0xe64`). */
export const OPENING_CONTROLLER_ADDRESS = 0x800a6c44;
/** The dispatcher guard target, phase 0's handler (`file 0xf90`). */
export const OPENING_DEFAULT_PHASE = 0;
/** How many phases the table holds; `sltiu $v0,$v1,7`. */
export const OPENING_PHASE_COUNT = 7;
/** `ctx->+0x40` = `F0x800142e0`: phase+1, clear `+0x18` (the phase-0 advance). */
export const OPENING_ADVANCE_PHASE_METHOD = 0x800142e0;
/** `ctx->+0x3c` = `F0x800142c8`: sub-state+1, clear `+0x14/+0x18`. */
export const OPENING_ADVANCE_SUBSTATE_METHOD = 0x800142c8;
/** `ctx->+0x38` = `F0x800142ac`: top-state+1, clear `+0x10/+0x14/+0x18` (the exit). */
export const OPENING_EXIT_METHOD = 0x800142ac;

/** One phase of the #2 table. */
export interface OpeningPhase {
    phase: number;
    address: number;
    /** File offset in `pro/wfightmn` (RAM = base + this). */
    file: number;
    name: string;
}

/** The 7 phases in table order, from the lifted bodies and the disc's table. */
export const OPENING_PHASES: readonly OpeningPhase[] = [
    { phase: 0, address: 0x800a6d70, file: 0xf90, name: "assembleBattleObjects" },
    { phase: 1, address: 0x800a6dbc, file: 0xfdc, name: "loadEncounterAndFighters" },
    { phase: 2, address: 0x800a7030, file: 0x1250, name: "queueBattleOverlay" },
    { phase: 3, address: 0x800a7048, file: 0x1268, name: "awaitOverlay" },
    { phase: 4, address: 0x800a7060, file: 0x1280, name: "sweepActionQueue" },
    { phase: 5, address: 0x800a707c, file: 0x129c, name: "frameCameraOrOpenLine" },
    { phase: 6, address: 0x800a7220, file: 0x1440, name: "awaitLineThenHandOff" },
];

/** The dispatcher's `sltiu $v0,$v1,7` guard: >= 7 (or negative) selects phase 0. */
export function openingPhaseIndex(phase: number): number {
    const p = phase | 0;
    return p >= 0 && p < OPENING_PHASE_COUNT ? p : OPENING_DEFAULT_PHASE;
}

/** The phase entry the table word at `phase` names (or phase 0 out of range). */
export function openingPhaseFor(phase: number): OpeningPhase {
    return OPENING_PHASES[openingPhaseIndex(phase)] ?? OPENING_PHASES[0]!;
}

// ── The encounter's intro-variant rule (phase 1) ────────────────────────────
//
// Phase 1's first act reads the battle id `[0x8004B448]()` and the map id
// `[0x80042B2C]` and picks the opening variant word `[0x800A4536]`:
//
//   (id 0x22D && map 0x143) -> 1
//   (id 0x23A && map 0x0B)  -> 2
//   (id 0x272 && map 0x1E)  -> 3
//   (map 0x144)             -> the special-mode-4 arm: `[0x800A4460]+0xD6 = 4`
//                              and the four counters +0xDB/+0xDA/+0xD8 zeroed,
//                              the variant word left untouched (0 by default)
//   else                    -> 0
//
// (lifted `F0x800a6dbc.c`; `wfightmn.s:1022-1178`). The four pairs are the
// scripted intro battles; everything else is the ordinary 0.

export type OpeningIntroVariant = 0 | 1 | 2 | 3;

export interface OpeningIntroAnswer {
    /** `[0x800A4536]` after phase 1. */
    variant: OpeningIntroVariant;
    /** True when the `mapId == 0x144` arm ran (special battle mode 4, the finale). */
    specialMode4: boolean;
}

export const OPENING_INTRO_VARIANT_PAIRS: readonly OpeningIntroVariant[] = [1, 2, 3];

/** The encounter map that takes the special-mode-4 arm instead of a variant. */
export const OPENING_SPECIAL_MODE4_MAP = 0x144;

/** Phase 1's intro-variant selection, exactly as the lifted body branches. */
export function introVariantFor(battleId: number, mapId: number): OpeningIntroAnswer {
    const id = battleId | 0;
    const map = mapId | 0;
    if (id === 0x22d && map === 0x143) return { variant: 1, specialMode4: false };
    if (id === 0x23a && map === 0x0b) return { variant: 2, specialMode4: false };
    if (id === 0x272 && map === 0x1e) return { variant: 3, specialMode4: false };
    if (map === OPENING_SPECIAL_MODE4_MAP) return { variant: 0, specialMode4: true };
    return { variant: 0, specialMode4: false };
}

// ── The opening-line roll (phase 1's line gate) ─────────────────────────────
//
// Phase 1 arms the opening line (`ctx+0x18 = 1`) only when `F0x800a684c()`
// returns nonzero; that routine is the encounter's own line gate:
//
//   if ([0x80042B1C]+0x3C == 0) return 0;                 // no line for this battle
//   a0 = [0x80042B1C]+0x3C * (0x20 - [party]+0x784 - [0x80042B1C]+0x1C);
//   if (a0 < 0) a0 += 0x1F;
//   r  = [0x8004DC0C](a0);                                // the disc's random table
//   q  = r >> 7 (signed);  frac = r - (q << 7);
//   return frac == 0 ? 1 : (frac < (a0 >> 5));
//
// (lifted `F0x800a684c.c`; `wfightmn.s` around the phase-1 body). The three
// inputs are the encounter record's line weight `+0x3C`, its bias `+0x1C`, and
// the acting Digimon's field at the party record's `+0x784`; the random value
// comes from the shared stream. Ported as a pure function so the browser can
// feed the same three numbers and the same stream value.

export interface OpeningLineRollInput {
    /** `[0x80042B1C]+0x3C` — nonzero only for battles with an opening line. */
    lineWeight: number;
    /** `[0x80042B1C]+0x1C` — the encounter's bias. */
    bias: number;
    /** The acting party record's `+0x784` field. */
    enemyField: number;
    /** The raw value the shared random stream returned for the scaled bound. */
    roll: number;
}

/** Phase 1's opening-line gate `F0x800a684c` as a pure function. */
export function openingLineRoll(input: OpeningLineRollInput): boolean {
    const weight = input.lineWeight | 0;
    if (weight === 0) return false;
    let bound = Math.imul(weight, (0x20 - (input.enemyField | 0) - (input.bias | 0)) | 0) | 0;
    if (bound < 0) bound = (bound + 0x1f) | 0;
    const roll = input.roll | 0;
    let q = roll >> 7;
    if (roll < 0) q = (roll + 0x7f) >> 7;
    const frac = (roll - (q << 7)) | 0;
    if (frac === 0) return true;
    return frac < (bound >> 5);
}

// ── The machine's own state (the controller's three-level word + its block) ──

/**
 * The battle controller's opening state, mirroring the fields the #2 handlers
 * read and write:
 *   top   ctx+0x0c  — 0 while the opening machine runs, 1 at the hand-off.
 *   sub   ctx+0x10  — 2 selects the #2 arm.
 *   phase ctx+0x14  — the phase word the dispatcher reads.
 *   linePending  ctx+0x18  — the opening line is armed.
 *   overlayHandle block+0x00 — the queued-overlay word (phase 2 writes, 3 clears).
 *   windowHandle  block+0x1C — the message window (phase 5 writes, 6 clears).
 *   kindWord      ctx+0x50   — 7 while the opening line is up.
 */
export interface OpeningState {
    top: number;
    sub: number;
    phase: number;
    linePending: number;
    overlayHandle: number;
    windowHandle: number;
    kindWord: number;
    introVariant: OpeningIntroVariant;
    specialMode4: boolean;
    /**
     * Set true the frame phase 1 creates the battle-open camera-sequence actor — the disc's
     * controller child slot 6 (`wfightmn.s:1175-1178`) — ONCE per battle.
     */
    openCameraArmed: boolean;
    /** Set the frame the machine exits into the top state 1 (the turn machinery). */
    exited: boolean;
}

export function newOpeningState(init: Partial<OpeningState> = {}): OpeningState {
    return {
        top: 0, sub: 2, phase: 0, linePending: 0, overlayHandle: 0, windowHandle: 0,
        kindWord: 0, introVariant: 0, specialMode4: false, openCameraArmed: false, exited: false,
        ...init,
    };
}

/** The phase-0 advance: `ctx->+0x40` (`+0x14++, clear +0x18`). */
export function openingAdvancePhase(state: OpeningState, clearLine = false): void {
    state.phase = (state.phase | 0) + 1;
    if (clearLine) state.linePending = 0;
}

/** The exit: `ctx->+0x38` (`+0x0c++, clear +0x10/+0x14/+0x18`). */
export function openingExit(state: OpeningState): void {
    state.top = (state.top | 0) + 1;
    state.sub = 0;
    state.phase = 0;
    state.linePending = 0;
    state.exited = true;
}

// ── The ports: the already-ported work each phase calls ─────────────────────

/**
 * The real work of the seven phases, supplied by the caller. Every method is a
 * call into an already-ported system (or the browser's own build of it) — the
 * machine never re-implements a phase's work.
 */
export interface OpeningPorts {
    /** Phase 0: build the five fight sub-objects (`+4/+8/+0x10/+0x14/+0xC`). */
    assembleBattleObjects(): void;
    /** Phase 1: read the encounter, pick the variant, load the combatant table, fill the HUD. */
    loadEncounterAndFighters(state: OpeningState): void;
    /** Phase 1: the opening-line gate `F0x800a684c`; returns true to arm the line. */
    introLinePending(state: OpeningState): boolean;
    /**
     * Phase 1: create the battle-open camera-sequence actor — the disc's controller CHILD SLOT 6
     * (`wfightmn.s:1175-1178`, `F0x800a246c`), created ONCE per battle, right after the encounter
     * and fighters are loaded. The work (allocating the actor and handing it to the camera owner)
     * is the caller's; the machine owns WHEN.
     */
    createOpenCamera?(state: OpeningState): void;
    /** Phase 2: queue the battle overlay (`F0x800a6414`); returns the pending handle (0 = none). */
    queueBattleOverlay(): number;
    /** Phase 3: is the queued overlay still pending? (stays in phase 3 while true). */
    overlayPending(handle: number): boolean;
    /** Phase 4: the queue sweep `F0x800a69f0`. */
    sweepActionQueue(): void;
    /** Phase 5 (no line): the HP-proportion camera beat before the exit. */
    frameCamera(): void;
    /** Phase 5 (line): the camera beat, then open the message window; returns the window handle. */
    frameCameraAndOpenLine(): number;
    /** Phase 5/6: is the window still up? (phase 6 waits while true). */
    lineUp(handle: number): boolean;
}

/** One pass of the machine: the phase word it left behind and whether it exited. */
export interface OpeningStep {
    phase: number;
    top: number;
    sub: number;
    exited: boolean;
    /** The phase handler that ran this pass (0..6). */
    ranPhase: number;
}

/**
 * Run one phase of the machine — the port of the controller's #2 arm. One call
 * is one frame, exactly as the controller runs one handler per call.
 */
export function stepOpeningPhase(state: OpeningState, ports: OpeningPorts): OpeningStep {
    const ranPhase = openingPhaseIndex(state.phase);
    switch (ranPhase) {
        case 0:
            ports.assembleBattleObjects();
            openingAdvancePhase(state, true);
            break;
        case 1: {
            ports.loadEncounterAndFighters(state);
            // The slot-6 create sits at the END of the disc's phase-1 body (`wfightmn.s:1175-1178`,
            // `.L0x00001240`), after the fighters are placed and their anim slots are armed. It
            // runs once per battle; guard on the flag so a re-run cannot double-create.
            if (!state.openCameraArmed) {
                ports.createOpenCamera?.(state);
                state.openCameraArmed = true;
            }
            state.linePending = ports.introLinePending(state) ? 1 : 0;
            openingAdvancePhase(state);
            break;
        }
        case 2:
            state.overlayHandle = ports.queueBattleOverlay() | 0;
            openingAdvancePhase(state);
            break;
        case 3:
            // The original returns while `block+0 != 0`, and advances once it clears.
            if (state.overlayHandle !== 0 && ports.overlayPending(state.overlayHandle)) break;
            openingAdvancePhase(state);
            break;
        case 4:
            ports.sweepActionQueue();
            openingAdvancePhase(state);
            break;
        case 5:
            if (state.linePending !== 0) {
                state.windowHandle = ports.frameCameraAndOpenLine() | 0;
                state.kindWord = 7;
                openingAdvancePhase(state);
            } else {
                ports.frameCamera();
                openingExit(state);
            }
            break;
        case 6:
            // The original exits once `block+0x1C` clears; the message object clears
            // it when the line is read.
            if (state.windowHandle === 0 || !ports.lineUp(state.windowHandle)) openingExit(state);
            break;
    }
    return { phase: state.phase, top: state.top, sub: state.sub, exited: state.exited, ranPhase };
}
