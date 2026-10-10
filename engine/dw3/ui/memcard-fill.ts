// The save-file card's text binder, translated from pro/stgmcard F0x8008316C (the
// method at card+0x8C, installed by F0x80083B6C; the save card's per-frame
// routine F0x800836C4 calls it when the card folds shut on a new block).
//
// Oracle: tests/lane-b/memcard-parts.test.js runs the original through
// engine/native on the shipped overlay (widget methods, the bank lookup and the
// shared index stubbed) and compares the ordered calls and the card's fields.
// Source: exe-decomp/stgmcard_c/_asm F0x8008316C (689 lines; the lifted C
// collapses two of its three-iteration loops to one iteration and two delay-slot
// increments, so this port follows the assembly).
//
// The card owns 19 text widgets (card+0x24 array, card+0x20 count):
//   0 name, 1 area, 2 place, 3/4 "BIT" labels, 5 BIT amount, 6..8 "LV" labels,
//   9..11 party levels (or "---"), 12..14 play hours / minutes / seconds, 15/16
//   the two clock separators, 17/18 the zero pads before single-digit minutes and
//   seconds.
// The record read is the summary at window+0x74 + index*0x44 (index = the shared
// block's +4): +0x00 name, +0x18 area index, +0x1C place index, +0x20 BIT,
// +0x28/+0x2A/+0x2C play time, +0x30+4i starter types, +0x3C+2i levels.
// Three cases, chosen by card+0x60 and the record's first byte:
//   card+0x60 == 0      hide every widget (the card is folding shut);
//   name byte == 0      an empty slot: each widget gets the descriptor table's own
//                       placeholder string (0x80088088, 0x14 bytes each: +0 string,
//                       +8 x, +0xC y, +0x10 numeric flag);
//   otherwise           the populated layout above.

import type { CallMethod, PartsMemory } from "./memcard-parts.ts";

export const MEMCARD_FILL_TABLE = 0x80088088;
export const MEMCARD_FILL_STRIDE = 0x14;
export const MEMCARD_FILL_INDEX = 0x8008876c;
const LANGUAGE_CELL = 0x8005cca8;

const s16 = (v: number): number => (v << 16) >> 16;

export interface MemcardFillHost {
    callMethod: CallMethod;
    /** [0x80044B38+0x414](id) (F0x80013E5C): text bank id -> RAM base. */
    resourceGetBase(id: number): number;
}

/** F0x8008316C(card): bind the record under the cursor to the card's widgets. */
export function memcardFillCard(mem: PartsMemory, card: number, host: MemcardFillHost): void {
    const index = mem.read32(MEMCARD_FILL_INDEX) | 0;
    const record = (mem.read32(card + 0x50) + Math.imul(index, 0x44) + 0x74) >>> 0;
    const widgets = mem.read32(card + 0x24);
    const count = mem.read32(card + 0x20) | 0;
    const bank = (offset: number): number => host.resourceGetBase(((mem.read32(LANGUAGE_CELL) | 0) + offset) | 0);
    const widget = (i: number): number => mem.read32(widgets + i * 4);
    const call = (i: number, slot: number, ...args: number[]): void => { host.callMethod(widget(i), slot, args); };

    if (mem.read32(card + 0x60) === 0) {
        for (let i = 0; i < count; i++) call(i, 0x144, 0);
        return;
    }
    if (mem.read8(record) === 0) {
        for (let i = 0; i < count; i++) {
            const descriptor = MEMCARD_FILL_TABLE + i * MEMCARD_FILL_STRIDE;
            host.callMethod(widget(i), 0x114, [bank(0x78), mem.read32(descriptor) | 0]);
            if (mem.read32(descriptor + 0x10) !== 0) {
                call(i, 0x118, 1, 0);
                call(i, 0x148, 1);
                call(i, 0x134, s16(mem.read16(descriptor + 8)), s16(mem.read16(descriptor + 0xc)));
            }
        }
        return;
    }

    call(0, 0x114, record, -1);
    call(1, 0x114, bank(0xa9), mem.read32(record + 0x18) | 0);
    call(2, 0x114, bank(0x94), mem.read32(record + 0x1c) | 0);
    for (let i = 3; i < 5; i++) call(i, 0x114, bank(0x78), 0x15);
    call(5, 0x118, 0, mem.read32(record + 0x20) | 0);
    call(5, 0x148, 1);
    call(12, 0x118, 0, s16(mem.read16(record + 0x28)));
    call(13, 0x118, 0, s16(mem.read16(record + 0x2a)));
    call(14, 0x118, 0, s16(mem.read16(record + 0x2c)));
    for (let i = 12; i < 15; i++) call(i, 0x148, 1);
    if (s16(mem.read16(record + 0x2a)) < 10) {
        call(17, 0x118, 0, 0);
        call(17, 0x148, 1);
        call(17, 0x134, 0x111, 0xb2);
    } else {
        call(17, 0x144, 0);
    }
    if (s16(mem.read16(record + 0x2c)) < 10) {
        call(18, 0x118, 0, 0);
        call(18, 0x148, 1);
        call(18, 0x134, 0x124, 0xb2);
    } else {
        call(18, 0x144, 0);
    }
    for (let i = 15; i < 17; i++) call(i, 0x114, bank(0x78), 0x13);
    const types = (mem.read32(card + 0x50) + Math.imul(index, 0x44) + 0xa4) >>> 0;
    for (let i = 0; i < 3; i++) {
        call(6 + i, 0x114, bank(0x78), 0x14);
        if ((mem.read32(types + i * 4) | 0) - 3 < 0) {
            call(9 + i, 0x114, bank(0x78), 0x23);
        } else {
            call(9 + i, 0x118, 0, s16(mem.read16(record + 0x3c + i * 2)));
        }
        call(9 + i, 0x148, 1);
        mem.write32(card + 0x68 + i * 4, 0);
    }
    mem.write32(card + 0x64, 0);
}
