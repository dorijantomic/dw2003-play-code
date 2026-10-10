// The partner-select screen's cursor and confirm handler, translated from
// pro/stdgname F0x80085B70 (partner_select_move).
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/partner-select-move-oracle.test.js runs the original through
// engine/native on the shipped pro_stdgname.bin + resident.bin with the pad
// service cells and the sound cell stubbed, and compares the ordered calls.
//
// DECODED: authority-2 `exe-decomp/stdgname_c/_asm/F0x80085b70.s`. The function
// reads the pad through the service cells at +0x3F4 (the pressed word),
// +0x3FC (its auto-repeat word) and +0x408 (the button-bit shift), named in
// engine/systems/pad-block.ts, and plays sounds through the cell at
// 0x80055C48:
//   up (code 4):    A or B -> the shared index cell 0x80087F3C -= 1; if it went
//                   below zero it becomes obj+0x78 - 1; blip 0x4001B.
//   down (code 6):  A or B -> the cell += 1; when the cell passes obj+0x78 - 1
//                   it wraps to 0; blip 0x4001B.
//   confirm (code 0xD, pad A only): play 0x4001C, store the cell into
//                   obj->+0x50->+0x60 and return 1.
//   cancel (code 0xE, pad A only): play 0x800450BD (the value is passed whole),
//                   store -1 into obj->+0x50->+0x60, call obj->+0x50's +0x68 and
//                   return 1.
//   no input: return 0.
//
// The index cell 0x80087F3C is the partner-select screen's own selection cell
// (0x80087F38 + 4), the same one the already-translated row builder reads.

import {
    PAD_BLOCK,
    PAD_CELL_BUTTON_MAP,
    PAD_CELL_PRESSED,
    PAD_CELL_REPEAT,
} from "../../systems/pad-block.ts";

export interface PartnerMoveMemory {
    read32(addr: number): number;
    write32(addr: number, value: number): void;
}

export interface PartnerMoveHost {
    /** PAD_CELL_PRESSED(0): pad A's pressed bits. */
    padA(): number;
    /** PAD_CELL_REPEAT(0): pad B's auto-repeat bits. */
    padB(): number;
    /** PAD_CELL_BUTTON_MAP(0, code): the shift for a button code. */
    padBit(code: number): number;
    /** [0x80055C48](id): play a packed sound id. */
    playSound(id: number): void;
    /** obj->+0x50->+0x68(obj->+0x50): the cancel callback. */
    parentCancel(parent: number): void;
}

/** The pad service cell and its three cells. */
export { PAD_BLOCK as PARTNER_MOVE_PAD_CELL };
export {
    PAD_CELL_PRESSED as PARTNER_MOVE_PAD_A_SLOT,
    PAD_CELL_REPEAT as PARTNER_MOVE_PAD_B_SLOT,
    PAD_CELL_BUTTON_MAP as PARTNER_MOVE_PAD_BIT_SLOT,
};
/** The sound service cell. */
export const PARTNER_MOVE_SOUND_CELL = 0x80055c48;
/** The screen's shared selection cell (0x80087F38 + 4). */
export const PARTNER_MOVE_INDEX_CELL = 0x80087f3c;
/** Object fields: the parent pointer and the selectable count. */
export const PARTNER_MOVE_OBJ_PARENT = 0x50;
export const PARTNER_MOVE_OBJ_COUNT = 0x78;
/** The parent fields written by confirm / cancel. */
export const PARTNER_MOVE_PARENT_RESULT = 0x60;
export const PARTNER_MOVE_PARENT_CANCEL = 0x68;
/** The sound ids the two moves and the two decisions play. */
export const PARTNER_MOVE_BLIP = 0x4001b;
export const PARTNER_MOVE_CONFIRM = 0x4001c;
export const PARTNER_MOVE_CANCEL_VALUE = 0x800450bd;
/** The button codes the handler tests. */
export const PARTNER_MOVE_BUTTON_UP = 4;
export const PARTNER_MOVE_BUTTON_DOWN = 6;
export const PARTNER_MOVE_BUTTON_CONFIRM = 0xd;
export const PARTNER_MOVE_BUTTON_CANCEL = 0xe;

/** F0x80085B70(obj): handle one frame of the partner list's cursor input. */
export function partnerSelectMove(
    mem: PartnerMoveMemory,
    obj: number,
    host: PartnerMoveHost,
): number {
    const padA = (code: number): number => (host.padA() >> host.padBit(code)) & 1;
    const padB = (code: number): number => (host.padB() >> host.padBit(code)) & 1;

    if (padA(PARTNER_MOVE_BUTTON_UP) !== 0 || padB(PARTNER_MOVE_BUTTON_UP) !== 0) {
        let index = (mem.read32(PARTNER_MOVE_INDEX_CELL) | 0) - 1;
        mem.write32(PARTNER_MOVE_INDEX_CELL, index | 0);
        if (index < 0) {
            index = (mem.read32(obj + PARTNER_MOVE_OBJ_COUNT) | 0) - 1;
            mem.write32(PARTNER_MOVE_INDEX_CELL, index | 0);
        }
        host.playSound(PARTNER_MOVE_BLIP);
    } else if (padA(PARTNER_MOVE_BUTTON_DOWN) !== 0 || padB(PARTNER_MOVE_BUTTON_DOWN) !== 0) {
        const index = ((mem.read32(PARTNER_MOVE_INDEX_CELL) | 0) + 1) | 0;
        mem.write32(PARTNER_MOVE_INDEX_CELL, index);
        if (((mem.read32(obj + PARTNER_MOVE_OBJ_COUNT) | 0) - 1) < index) {
            mem.write32(PARTNER_MOVE_INDEX_CELL, 0);
        }
        host.playSound(PARTNER_MOVE_BLIP);
    }

    if (padA(PARTNER_MOVE_BUTTON_CONFIRM) !== 0) {
        host.playSound(PARTNER_MOVE_CONFIRM);
        const parent = mem.read32(obj + PARTNER_MOVE_OBJ_PARENT) >>> 0;
        mem.write32(parent + PARTNER_MOVE_PARENT_RESULT, mem.read32(PARTNER_MOVE_INDEX_CELL) | 0);
        return 1;
    }
    if (padA(PARTNER_MOVE_BUTTON_CANCEL) !== 0) {
        host.playSound(PARTNER_MOVE_CANCEL_VALUE);
        const parent = mem.read32(obj + PARTNER_MOVE_OBJ_PARENT) >>> 0;
        mem.write32(parent + PARTNER_MOVE_PARENT_RESULT, -1);
        host.parentCancel(mem.read32(obj + PARTNER_MOVE_OBJ_PARENT) >>> 0);
        return 1;
    }
    return 0;
}
