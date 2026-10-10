// The memory-card save header builder, translated from the EXE.
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/save-header-oracle.test.js runs F0x80014930 through engine/native
// and compares the whole block the original writes, including the bytes it
// deliberately leaves alone.
//
// DECODED: the accepted `stats-save-loaders-contract` answer (researcher A,
// checked against `~/ddw3/asm/dw2003/exe/fns.s` L5017-L5104). F0x80014930 builds
// the 0x80-byte "SC" header block at D0x80048750 for a memory-card save: it
// refuses a count outside 1..3 and a name of 0x41 bytes or more, zeroes
// +0x10..+0x8F, writes the "SC" magic, a code byte (count | 0x10) and the version
// 4, copies the name to +0x14, copies two 16-byte halves of the caller's struct
// to +0x70/+0x80, stores the count at +0x314 and the caller's count words at
// +0x318.

import { zeroFill } from "./zero-fill.ts";
import { strcpyBytes, strlenBytes } from "./byte-ops.ts";

export interface SaveHeaderMemory {
    read8(addr: number): number;
    read32(addr: number): number;
    write8(addr: number, value: number): void;
    write32(addr: number, value: number): void;
}

/** The fixed header block the game builds. */
export const SAVE_HEADER_BLOCK = 0x80048750;
/** The name byte limit (a name of this length or more is refused). */
export const SAVE_NAME_LIMIT = 0x41;
/** The count field and the count-word table inside the block. */
export const SAVE_HEADER_COUNT = 0x314;
export const SAVE_HEADER_TABLE = 0x318;
/** The two 16-byte struct halves. */
export const SAVE_HEADER_STRUCT_A = 0x70;
export const SAVE_HEADER_STRUCT_B = 0x80;
/** The version byte the original stores. */
export const SAVE_HEADER_VERSION = 4;

/**
 * F0x80014930(name, struct, count, table): build the save header. `name` is a
 * NUL-terminated string, `struct` a 0x20-byte block, `table` an array of `count`
 * words. A refused call writes nothing at all.
 */
export function saveBuildHeader(
    mem: SaveHeaderMemory,
    name: number,
    struct: number,
    count: number,
    table: number,
): void {
    const c = count | 0;
    if ((((c - 1) >>> 0) >= 3)) return;
    if (strlenBytes(mem, name) >= SAVE_NAME_LIMIT) return;
    const base = SAVE_HEADER_BLOCK;
    // the count store sits in the zero-fill call's delay slot in the original
    mem.write32(base + SAVE_HEADER_COUNT, c);
    zeroFill(mem, base + 0x10, 0x80);
    mem.write8(base + 0x10, 0x53); // 'S'
    mem.write8(base + 0x11, 0x43); // 'C'
    mem.write8(base + 0x13, SAVE_HEADER_VERSION);
    mem.write8(base + 0x12, (mem.read8(base + SAVE_HEADER_COUNT) | 0x10) & 0xff);
    strcpyBytes(mem, base + 0x14, name);
    for (let i = 0; i < 0x10; i++) {
        mem.write8(base + SAVE_HEADER_STRUCT_A + i, mem.read8(struct + i) & 0xff);
        mem.write8(base + SAVE_HEADER_STRUCT_B + i, mem.read8(struct + 0x10 + i) & 0xff);
    }
    for (let i = 0; i < c; i++) {
        mem.write32(base + SAVE_HEADER_TABLE + i * 4, mem.read32(table + i * 4) | 0);
    }
}
