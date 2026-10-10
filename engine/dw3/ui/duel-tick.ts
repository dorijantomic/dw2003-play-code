// The duel's per-frame tick, translated from pro/cardgame:
//   F0x800A2DF8 cardDuelTick — three queue services, then the +0x2F4 arm switch
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/duel-tick-oracle.test.js runs the original through engine/native
// on the shipped pro_cardgame.bin + resident.bin with the six far calls stubbed;
// the default arm runs the shipped mode machine, so the tick is checked against
// the real dispatch chain.
//
// Source (assembly, authority 2): exe-decomp/cardgame.norm.s @.L0x00020148.
// The arm switch reads `duel+0x2F4`:
//   1 -> F0x80084320(duel, view)            [the effect VM's opcode runner]
//   2 -> F0x800A2180(duel, scene) & 0xFF -> clear +0x2F4 when non-zero
//   3 -> F0x800A2608(duel, scene): 1 re-arms +0x2F4, 2 reports finished
//   anything else -> F0x800A1B48(duel, scene) (the mode machine), 1 iff non-zero
// The first call, F0x8009E62C, is entered with the caller's own a0/a1 still in
// place (the m2c listing shows no argument setup): it receives (duel, scene).
//
// The view the arm-1 call receives is [scene+0x18] — the scene handler stores
// the created view there (see cardDuelSceneHandler 0x800A2F00).
//
// Existing contracts reused: `cardgame-effect-interpreter-and-round-driver-never-
// share-a-frame-2026-08-24` (partially_verified) for the tick's frame shape, and
// the mode machine already ported in engine/dw3/ui/duel-mode-machine.ts, which
// this tick calls directly rather than through a host stub.

import { DUEL_SCENE_VIEW, runModeMachine, type DuelModeHost, type DuelModeMemory } from "./duel-mode-machine.ts";

export type DuelTickMemory = DuelModeMemory;

export interface DuelTickHost extends DuelModeHost {
    /** F0x8009E62C(duel, scene): apply the queued grey flags. */
    applyQueuedGreyFlags(duel: number, scene: number): void;
    /** F0x8009E668(duel, scene): dispatch the duel view's queue. */
    dispatchDuelViewQueue(duel: number, scene: number): void;
    /** F0x8009E560(duel, scene): run the queued announcement. */
    runQueuedAnnounce(duel: number, scene: number): void;
    /** F0x80084320(duel, view): run the queued effect opcode. */
    runEffectOpcode(duel: number, view: number): void;
    /** F0x800A2180(duel, scene): fetch the next effect opcode. */
    fetchNextEffectOpcode(duel: number, scene: number): number;
    /** F0x800A2608(duel, scene): the nested effect step block. */
    saveRestoreEffectStepBlock(duel: number, scene: number): number;
}

/** The arm byte the tick dispatches on (u8). */
export const DUEL_TICK_ARM = 0x2f4;
/** The tick's own address, and the six boundaries it reaches. */
export const DUEL_TICK = 0x800a2df8;
export const DUEL_APPLY_GREY_FLAGS = 0x8009e62c;
export const DUEL_DISPATCH_VIEW_QUEUE = 0x8009e668;
export const DUEL_RUN_QUEUED_ANNOUNCE = 0x8009e560;
export const DUEL_RUN_EFFECT_OPCODE = 0x80084320;
export const DUEL_FETCH_NEXT_EFFECT_OPCODE = 0x800a2180;
export const DUEL_SAVE_RESTORE_EFFECT_STEP = 0x800a2608;
/** The arm the mode machine's machine is re-armed with when arm 3 reports 1. */
export const DUEL_TICK_ARM_MODE_MACHINE = 1;
export const DUEL_TICK_ARM_EFFECT_VM = 1;

/**
 * F0x800A2DF8(duel, scene): run the three queue services in order, then the arm
 * switch. Returns 1 only when the arm-3 step block reports 2, or when the mode
 * machine reports non-zero (itself only a mode-4 finished report).
 */
export function cardDuelTick(
    mem: DuelTickMemory,
    host: DuelTickHost,
    duel: number,
    scene: number,
): number {
    host.applyQueuedGreyFlags(duel, scene);
    host.dispatchDuelViewQueue(duel, scene);
    host.runQueuedAnnounce(duel, scene);

    const arm = mem.read8(duel + DUEL_TICK_ARM) & 0xff;
    if (arm === DUEL_TICK_ARM_EFFECT_VM) {
        host.runEffectOpcode(duel, mem.read32(scene + DUEL_SCENE_VIEW) | 0);
        return 0;
    }
    if (arm === 2) {
        if ((host.fetchNextEffectOpcode(duel, scene) & 0xff) !== 0) {
            mem.write8(duel + DUEL_TICK_ARM, 0);
        }
        return 0;
    }
    if (arm === 3) {
        // the original compares the callee's full register against 1 and 2 (no `andi`)
        const code = host.saveRestoreEffectStepBlock(duel, scene);
        if (code === DUEL_TICK_ARM_MODE_MACHINE) {
            mem.write8(duel + DUEL_TICK_ARM, DUEL_TICK_ARM_MODE_MACHINE);
            return 0;
        }
        if (code === 2) return 1;
        return 0;
    }
    // arm 0, 4 and anything else fall through to the mode machine
    return runModeMachine(mem, host, duel, scene) !== 0 ? 1 : 0;
}
