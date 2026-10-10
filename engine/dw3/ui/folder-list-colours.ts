// The card-folder colour census, translated from pro/stcrddek F0x8008924C.
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/folder-list-colours-oracle.test.js runs the original overlay
// address through engine/native and compares all 18 counter words.
//
// DECODED: the accepted list-builder-family researcher answer (U4), authority 2
// `~/ddw3/asm/dw2003/pro/stcrddek.s` L6510-6575 (file 0x659c..0x66a0) and
// authority 3 exe-decomp/stcrddek_c/F0x8008924C.c. Existing ledger claim
// UI-CARDDECK-FOLDER-LIST-COLOUR-SPREAD-2026-08-14 (candidate) describes the
// same routine: six colour counters per folder, 40 card slots per folder.
//
// Contract, in the assembly's order:
//
//   F0x8001EBF8(&stack) builds a stack card-accessor struct (NOT an allocator);
//   the loop then, for f = 0..2:
//     1. zero the six counter words at   self + f*0x18 + 0x74 + 4k  (k = 0..5)
//     2. for i = 0..39:
//          id = (signed halfword) [0x80049372 + f*0x66 + 2i]
//          colour = byte 0 of the record the accessor resolves for `id`
//          count at self + f*0x18 + 0x74 + (colour-1)*4
//   The (colour-1)*4 arithmetic is UNGUARDED in the original: colour 0 writes
//   four bytes below the block start. The port reproduces that, it does not
//   clamp.
//
// The card-record resolution (F0x8001E7EC: D0x80044F4C(D0x8004DFB8[(id-1)>>6])
// + ((id-1)&0x3F)*0x62C, no offset for id <= 0) is a resident BOUNDARY, so the
// port takes it as `cardRecordOf` — the same host contract the interpreter
// resolves through the resource service. Only the census itself is ported.

/** Folder id table: 3 folders x 40 signed halfwords, stride 0x66. */
export const FOLDER_IDS = 0x80049372;
export const FOLDER_IDS_STRIDE = 0x66;
export const FOLDER_COUNT = 3;
export const FOLDER_IDS_PER_FOLDER = 40;

/** Per-folder counter block: six words at self + f*0x18 + 0x74. */
export const FOLDER_COUNTER_BASE = 0x74;
export const FOLDER_COUNTER_STRIDE = 0x18;
export const FOLDER_COUNTERS = 6;

export interface ColourCountMemory {
    read8(addr: number): number;
    read16(addr: number): number;
    read32(addr: number): number;
    write32(addr: number, value: number): void;
}

/**
 * F0x8008924C(self): recount the six colour buckets of each of the three
 * folders from the 40 card slots. `cardRecordOf(id)` is the card-accessor
 * boundary returning the record address for a signed id.
 */
export function folderListCountColours(
    mem: ColourCountMemory,
    self: number,
    cardRecordOf: (id: number) => number,
): void {
    for (let f = 0; f < FOLDER_COUNT; f++) {
        const block = self + f * FOLDER_COUNTER_STRIDE;
        for (let k = 0; k < FOLDER_COUNTERS; k++) {
            mem.write32(block + FOLDER_COUNTER_BASE + k * 4, 0);
        }
        for (let i = 0; i < FOLDER_IDS_PER_FOLDER; i++) {
            const id = (mem.read16(FOLDER_IDS + f * FOLDER_IDS_STRIDE + i * 2) << 16) >> 16;
            const colour = mem.read8(cardRecordOf(id) >>> 0) & 0xff;
            const target = block + FOLDER_COUNTER_BASE + (colour - 1) * 4;
            mem.write32(target, (mem.read32(target) + 1) | 0);
        }
    }
}
