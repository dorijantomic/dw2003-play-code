// The duel's mode machine, translated from pro/cardgame:
//   F0x800A1B2C initDuelModeState — the five byte stores that arm a duel
//   F0x800A1B48 runModeMachine     — the pending/enter rotate and the mode update
// and the jump-table arms its two tables reach:
//   enter table 0x80083A00 (indexed by pending-1, pending 1..9)
//     0x800A1BA0 pending 1,2 · 0x800A1BAC pending 3,4,6 · 0x800A1BB4 pending 5,7
//     0x800A1BC8 pending 8   · 0x800A1BDC pending 9
//   update table 0x80083A28 (indexed by mode-1, modes 1..10)
//     0x800A1C30 mode 1 · 0x800A1C7C mode 2 · 0x800A1C98 mode 3 ·
//     0x800A1CB4 mode 4 · 0x800A1D14 mode 5,7 · 0x800A1D30 mode 6 ·
//     0x800A1D4C mode 8 · 0x800A1D84 mode 9 · 0x800A1D90 mode 10
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/duel-mode-machine-oracle.test.js runs the originals through
// engine/native on the shipped pro_cardgame.bin + resident.bin.
//
// Source (assembly, authority 2): exe-decomp/cardgame.norm.s
//   F0x800a1b2c @.L0x0001ee7c, F0x800a1b48 @.L0x0001ee98, arms at
//   .L0x0001eef0/.L0x0001eefc/.L0x0001ef04/.L0x0001ef18/.L0x0001ef2c and
//   .L0x0001ef80/.L0x0001efcc/.L0x0001efe8/.L0x0001f004/.L0x0001f064/
//   .L0x0001f080/.L0x0001f09c/.L0x0001f0d4/.L0x0001f0e0.
// The tables are in the overlay image and are read through them, so the port
// keeps the same dispatch shape.
//
// The nine arms' own calls into the rest of the duel are host boundaries; the
// view the arm bodies read is [scene+0x18] (the scene handler stores the view
// there), and mode 10 calls the already-ported queueInterPhaseBanner.

import { queueInterPhaseBanner } from "./phase-banner.ts";

export interface DuelModeMemory {
    read8(addr: number): number;
    read32(addr: number): number;
    write8(addr: number, value: number): void;
    write32(addr: number, value: number): void;
}

/** The nine still-native duel routines the mode machine calls. */
export interface DuelModeHost {
    /** F0x800A0548(duel, scene) — the pending-5/7 enter. */
    enterFive(duel: number, scene: number): void;
    /** F0x800A0F4C(duel, scene) — the pending-8 enter. */
    enterEight(duel: number, scene: number): void;
    /** F0x800A1A5C(duel, scene) — the pending-9 enter. */
    enterNine(duel: number, scene: number): void;
    /** F0x8009F110(duel, scene) — the mode-2 update; non-zero advances to mode 10. */
    updateTwo(duel: number, scene: number): number;
    /** F0x8009F8C0(duel, scene) — the mode-3 update. */
    updateThree(duel: number, scene: number): number;
    /** F0x8009F910(duel, scene) — the mode-4 update: 2 or 3 report finished. */
    updateFour(duel: number, scene: number): number;
    /** F0x8009FDD8(duel, scene) — the mode-5/7 update. */
    updateFive(duel: number, scene: number): number;
    /** F0x800A0B80(duel, scene) — the mode-6 update. */
    updateSix(duel: number, scene: number): number;
    /** F0x800A0F94(duel, scene) — the mode-8 update: 1 -> mode 9, 2 -> finished. */
    updateEight(duel: number, scene: number): number;
}

export const DUEL_MODE = {
    /** The mode before the current one (u8). */
    previous: 0x2f6,
    /** The pending mode the next call enters (u8). */
    pending: 0x2f7,
    /** The current mode (u8). */
    current: 0x2f8,
    /** The current mode's sub-step (u8). */
    subStep: 0x2f9,
    /** The mode-1/2 enter's word store (s32). */
    enterWord: 0x2fc,
    /** The mode-4 outcome byte (u8). */
    outcome302: 0x302,
    /** initDuelModeState's bytes (u8 each). */
    init5ad: 0x5ad,
    init675: 0x675,
    init303: 0x303,
} as const;

/** The scene's view pointer the mode-1 update reads. */
export const DUEL_SCENE_VIEW = 0x18;
/** The view's widget state byte the mode-1 update waits on. */
export const DUEL_VIEW_WIDGET = 0xe9e;
/** The mode the three "advanced" updates queue, and the mode-8 step. */
export const DUEL_MODE_TEN = 0xa;
export const DUEL_MODE_NINE = 9;
/** Enter table 0x80083A00 (pending-1) and update table 0x80083A28 (mode-1). */
export const DUEL_ENTER_TABLE = 0x80083a00;
export const DUEL_UPDATE_TABLE = 0x80083a28;
export const DUEL_ENTER_ARM_1_2 = 0x800a1ba0;
export const DUEL_ENTER_ARM_3_4_6 = 0x800a1bac;
export const DUEL_ENTER_ARM_5_7 = 0x800a1bb4;
export const DUEL_ENTER_ARM_8 = 0x800a1bc8;
export const DUEL_ENTER_ARM_9 = 0x800a1bdc;
export const DUEL_UPDATE_ARM_1 = 0x800a1c30;
export const DUEL_UPDATE_ARM_2 = 0x800a1c7c;
export const DUEL_UPDATE_ARM_3 = 0x800a1c98;
export const DUEL_UPDATE_ARM_4 = 0x800a1cb4;
export const DUEL_UPDATE_ARM_5_7 = 0x800a1d14;
export const DUEL_UPDATE_ARM_6 = 0x800a1d30;
export const DUEL_UPDATE_ARM_8 = 0x800a1d4c;
export const DUEL_UPDATE_ARM_9 = 0x800a1d84;
export const DUEL_UPDATE_ARM_10 = 0x800a1d90;
export const DUEL_RUN_MODE_MACHINE = 0x800a1b48;
export const DUEL_INIT_MODE_STATE = 0x800a1b2c;

/** F0x800A1B2C(duel): the five byte stores, in listing order. */
export function initDuelModeState(mem: DuelModeMemory, duel: number): void {
    mem.write8(duel + DUEL_MODE.init5ad, 0);
    mem.write8(duel + DUEL_MODE.init675, 1);
    mem.write8(duel + DUEL_MODE.init303, 0);
    mem.write8(duel + DUEL_MODE.outcome302, 1);
    mem.write8(duel + DUEL_MODE.current, 1);
}

/** Pending 1,2 (0x800A1BA0): clear the sub-step and the enter word. */
export function enterModeClearBoth(mem: DuelModeMemory, duel: number): void {
    mem.write8(duel + DUEL_MODE.subStep, 0);
    mem.write32(duel + DUEL_MODE.enterWord, 0);
}

/** Pending 3,4,6 (0x800A1BAC): clear the sub-step. */
export function enterModeClearSub(mem: DuelModeMemory, duel: number): void {
    mem.write8(duel + DUEL_MODE.subStep, 0);
}

/** Pending 5,7 (0x800A1BB4) and pending 8 (0x800A1BC8). */
export function enterModeFive(mem: DuelModeMemory, host: DuelModeHost, duel: number, scene: number): void {
    void mem;
    host.enterFive(duel, scene);
}

export function enterModeEight(mem: DuelModeMemory, host: DuelModeHost, duel: number, scene: number): void {
    void mem;
    host.enterEight(duel, scene);
}

/** Pending 9 (0x800A1BDC). */
export function enterModeNine(mem: DuelModeMemory, host: DuelModeHost, duel: number, scene: number): void {
    void mem;
    host.enterNine(duel, scene);
}

/**
 * Mode 1 (0x800A1C30): sub-step 1 sets the view's widget byte and moves to
 * sub-step 1; any other sub-step value does the same, and sub-step 1 waits for
 * the widget to read 2 and then queues mode 10.
 */
export function updateModeOne(mem: DuelModeMemory, duel: number, scene: number): number {
    const sub = mem.read8(duel + DUEL_MODE.subStep) & 0xff;
    const view = mem.read32(scene + DUEL_SCENE_VIEW) | 0;
    if (sub === 1) {
        if ((mem.read8(view + DUEL_VIEW_WIDGET) & 0xff) === 2) {
            mem.write8(duel + DUEL_MODE.pending, DUEL_MODE_TEN);
        }
        return 0;
    }
    mem.write8(view + DUEL_VIEW_WIDGET, 1);
    mem.write8(duel + DUEL_MODE.subStep, 1);
    return 0;
}

/** Modes 2 (0x800A1C7C), 3 (0x800A1C98), 5/7 (0x800A1D14), 6 (0x800A1D30). */
function updateAdvanceOnNonZero(mem: DuelModeMemory, value: number, duel: number): number {
    if (value !== 0) mem.write8(duel + DUEL_MODE.pending, DUEL_MODE_TEN);
    return 0;
}

export function updateModeTwo(mem: DuelModeMemory, host: DuelModeHost, duel: number, scene: number): number {
    return updateAdvanceOnNonZero(mem, host.updateTwo(duel, scene) | 0, duel);
}

export function updateModeThree(mem: DuelModeMemory, host: DuelModeHost, duel: number, scene: number): number {
    return updateAdvanceOnNonZero(mem, host.updateThree(duel, scene) | 0, duel);
}

export function updateModeFiveSeven(mem: DuelModeMemory, host: DuelModeHost, duel: number, scene: number): number {
    return updateAdvanceOnNonZero(mem, host.updateFive(duel, scene) | 0, duel);
}

export function updateModeSix(mem: DuelModeMemory, host: DuelModeHost, duel: number, scene: number): number {
    return updateAdvanceOnNonZero(mem, host.updateSix(duel, scene) | 0, duel);
}

/**
 * Mode 4 (0x800A1CB4): the update's own result decides. 1 queues mode 10 and
 * reports 0; 2 sets the outcome byte and reports finished (1); 3 clears the
 * outcome byte and reports finished; anything else reports 0.
 */
export function updateModeFour(mem: DuelModeMemory, host: DuelModeHost, duel: number, scene: number): number {
    const v = host.updateFour(duel, scene) | 0;
    if (v === 2) {
        mem.write8(duel + DUEL_MODE.outcome302, 1);
        return 1;
    }
    if (v === 1) {
        mem.write8(duel + DUEL_MODE.pending, DUEL_MODE_TEN);
        return 0;
    }
    if (v === 3) {
        mem.write8(duel + DUEL_MODE.outcome302, 0);
        return 1;
    }
    return 0;
}

/** Mode 8 (0x800A1D4C): 1 queues mode 9; 2 reports finished. */
export function updateModeEight(mem: DuelModeMemory, host: DuelModeHost, duel: number, scene: number): number {
    const v = host.updateEight(duel, scene) | 0;
    if (v === 1) {
        mem.write8(duel + DUEL_MODE.pending, DUEL_MODE_NINE);
        return 0;
    }
    if (v === 2) return 1;
    return 0;
}

/** Mode 9 (0x800A1D84): queue mode 10. */
export function updateModeNine(mem: DuelModeMemory, duel: number): number {
    mem.write8(duel + DUEL_MODE.pending, DUEL_MODE_TEN);
    return 0;
}

/** Mode 10 (0x800A1D90): arm the inter-phase banner. */
export function updateModeTen(mem: DuelModeMemory, duel: number): number {
    queueInterPhaseBanner(mem, duel);
    return 0;
}

/**
 * F0x800A1B48(duel, scene): if a pending mode is set (and inside 1..9) run its
 * enter arm, then rotate pending -> current and current -> previous; then run
 * the current mode's update arm. Returns 1 only when a mode-4 update reports
 * finished.
 */
export function runModeMachine(mem: DuelModeMemory, host: DuelModeHost, duel: number, scene: number): number {
    let result = 0;
    const pending = mem.read8(duel + DUEL_MODE.pending) & 0xff;
    if (pending !== 0) {
        const slot = (pending - 1) >>> 0;
        if (slot < 9) {
            if (pending === 1 || pending === 2) enterModeClearBoth(mem, duel);
            else if (pending === 3 || pending === 4 || pending === 6) enterModeClearSub(mem, duel);
            else if (pending === 5 || pending === 7) enterModeFive(mem, host, duel, scene);
            else if (pending === 8) enterModeEight(mem, host, duel, scene);
            else enterModeNine(mem, host, duel, scene);
        }
        // the rotate (0x800A1EF38): previous = the OLD current, then
        // pending = 0 and current = the rotated-in mode
        const current = mem.read8(duel + DUEL_MODE.current) & 0xff;
        mem.write8(duel + DUEL_MODE.pending, 0);
        mem.write8(duel + DUEL_MODE.previous, current);
        mem.write8(duel + DUEL_MODE.current, pending);
    }
    const mode = mem.read8(duel + DUEL_MODE.current) & 0xff;
    if (((mode - 1) >>> 0) >= 10) return result;
    switch (mode) {
        case 1: result = updateModeOne(mem, duel, scene); break;
        case 2: result = updateModeTwo(mem, host, duel, scene); break;
        case 3: result = updateModeThree(mem, host, duel, scene); break;
        case 4: result = updateModeFour(mem, host, duel, scene); break;
        case 5: case 7: result = updateModeFiveSeven(mem, host, duel, scene); break;
        case 6: result = updateModeSix(mem, host, duel, scene); break;
        case 8: result = updateModeEight(mem, host, duel, scene); break;
        case 9: result = updateModeNine(mem, duel); break;
        case 10: result = updateModeTen(mem, duel); break;
        default: break;
    }
    return result;
}
