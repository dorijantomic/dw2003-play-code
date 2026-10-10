// Resident global leaves read on the screen paths.
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/resident-globals-oracle.test.js runs the original addresses
// through engine/native and compares the returned/stored words.
//
// DECODED: F0x80016B58 and F0x80016B68 are one-word pointer getters
// (`lw v0, [D0x8004B400]` / `[D0x8004B3F8]`); F0x8001E7E0 is a one-word store
// (`sw a0, 0x1B8(gp)`), the current-view slot the card screens read.

import { BOOT_GP } from "./ui/text-element-setters.ts";

export interface WordMemory {
    read32(addr: number): number;
    write32(addr: number, value: number): void;
}

/** The cell F0x80016B58 returns. */
export const LOAD_CELL_B400 = 0x8004b400;
/** The cell F0x80016B68 returns. */
export const LOAD_CELL_B3F8 = 0x8004b3f8;
/** `[gp+0x1B8]`: the current-view word F0x8001E7E0 stores. */
export const CURRENT_VIEW_CELL = (BOOT_GP + 0x1b8) >>> 0;

/** F0x80016B58. */
export function loadPtrB400(mem: WordMemory): number {
    return mem.read32(LOAD_CELL_B400) | 0;
}

/** F0x80016B68. */
export function loadPtrB3F8(mem: WordMemory): number {
    return mem.read32(LOAD_CELL_B3F8) | 0;
}

/** F0x8001E7E0(self-ish value): stores into [gp+0x1B8]. */
export function setCurrentView(mem: WordMemory, value: number): void {
    mem.write32(CURRENT_VIEW_CELL, value | 0);
}
