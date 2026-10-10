// The duel's mode-3 and mode-4 update bodies, translated from pro/cardgame.
//
// These are the two of the nine mode updates that are SELF-CONTAINED: neither
// dispatches through a jump table and neither calls anything. They read and
// write only duel fields, so they port exactly, with no further layer below
// them. The remaining seven (mode-2 0x8009F110, mode-5/7 0x8009FDD8,
// mode-6 0x800A0B80, mode-8 0x800A0F94, and the three enters 0x800A0548 /
// 0x800A0F4C / 0x800A1A5C) each dispatch through a table into view methods the
// view object installs from its constructor — a layer that is absent from the
// lifted C (see tools/verify_translated_duel.mjs and tools/lift_installed_routines.py).
//
// Authority 2 (original assembly): exe-decomp/cardgame.norm.s
//   F0x8009f8c0 @ line 31134 (mode-3, Load Phase update)
//   F0x8009f910 @ line 31156 (mode-4, Compile/Battle Phase update)
// Oracle: tests/duel-mode-updates-oracle.test.js runs both originals through
// engine/native on the shipped pro_cardgame.bin + resident.bin over every
// sub-step and selection value, with a discriminating mutation.

export interface DuelUpdateMemory {
    read8(addr: number): number;
    read32(addr: number): number;
    write8(addr: number, value: number): void;
}

/** The duel fields these two bodies touch. */
export const DUEL_UPDATE_FIELDS = {
    /** The current mode's sub-step (u8). */
    subStep: 0x2f9,
    /** The effect-VM's pending-opcode latch (u8). */
    pendingOpcode: 0x421,
    /** The tick's own arm byte (u8). */
    tickArm: 0x2f4,
    /** The mode-3 walk's carried byte (u8). */
    sub3Carry: 0x2f5,
    /** The selection cursor the two updates read (s32). */
    selected: 0x440,
} as const;

export const UPDATE_MODE_THREE = 0x8009f8c0;
export const UPDATE_MODE_FOUR = 0x8009f910;
/** The coin-toss opcode mode 3 arms, and the deal opcode mode 4 arms. */
export const MODE_THREE_ARM_OPCODE = 0xa7;
export const MODE_FOUR_ARM_OPCODE = 0x14;

/**
 * F0x8009F8C0(duel): the mode-3 (Load Phase) update.
 *
 * Sub-step 0 arms the effect VM with the coin-toss opcode 0xA7, sets the tick
 * arm to 1 and moves to sub-step 1, reporting 0. Any other sub-step sets
 * duel+0x2F5 from whether a selection is present (the cursor at duel+0x440 is
 * non-zero) and reports 1, which the mode machine turns into its advance.
 */
export function updateDuelModeThree(mem: DuelUpdateMemory, duel: number): number {
    const sub = mem.read8(duel + DUEL_UPDATE_FIELDS.subStep) & 0xff;
    if (sub === 0) {
        mem.write8(duel + DUEL_UPDATE_FIELDS.pendingOpcode, MODE_THREE_ARM_OPCODE);
        mem.write8(duel + DUEL_UPDATE_FIELDS.tickArm, 1);
        mem.write8(duel + DUEL_UPDATE_FIELDS.subStep, 1);
        return 0;
    }
    mem.write8(duel + DUEL_UPDATE_FIELDS.sub3Carry, (mem.read32(duel + DUEL_UPDATE_FIELDS.selected) | 0) !== 0 ? 1 : 0);
    return 1;
}

/**
 * F0x8009F910(duel): the mode-4 (Compile/Battle Phase) update.
 *
 * Sub-step 0 arms the effect VM with the deal opcode 0x14, sets the tick arm to
 * 1 and moves to sub-step 1, reporting 0. Any other sub-step maps the selection
 * cursor to the phase outcome: 0 -> 1, 1 -> 2, 2 -> 3, anything else -> 0. It
 * writes no field on that path.
 *
 * The outcome is read by the mode machine's mode-4 arm (duel-mode-machine.ts
 * updateModeFour): 2 sets the outcome byte and reports finished, 3 clears it
 * and reports finished, 1 queues mode 10.
 */
export function updateDuelModeFour(mem: DuelUpdateMemory, duel: number): number {
    const sub = mem.read8(duel + DUEL_UPDATE_FIELDS.subStep) & 0xff;
    if (sub === 0) {
        mem.write8(duel + DUEL_UPDATE_FIELDS.pendingOpcode, MODE_FOUR_ARM_OPCODE);
        mem.write8(duel + DUEL_UPDATE_FIELDS.tickArm, 1);
        mem.write8(duel + DUEL_UPDATE_FIELDS.subStep, 1);
        return 0;
    }
    const selected = mem.read32(duel + DUEL_UPDATE_FIELDS.selected) | 0;
    if (selected === 0) return 1;
    if (selected === 1) return 2;
    if (selected === 2) return 3;
    return 0;
}
