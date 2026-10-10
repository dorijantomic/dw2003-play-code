// The disc LBA tables, translated from the resident EXE.
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/resident-accessors-oracle.test.js calls the original F0x80014200
// through engine/native and compares.
//
// DECODED: docs/research/infra/rig-reference.md table row
// `0x800474a4 | LBA_LEN_SECTORS u16[2382]` and the ledger claim whose exact is
// `return *((arg0 * 2) + &LBA_LEN_SECTORS);`. The runtime/probe already reads the
// same table (tools/native_screen_probe.ts `lenOff = 0x800474a4 + index*2`).

/** u16[2382] sector count per archive file, indexed by disc table index. */
export const LBA_LEN_SECTORS = 0x800474a4;

export interface HalfwordTableMemory {
    read16(addr: number): number;
}

/** F0x80014200(index): the u16 sector length at LBA_LEN_SECTORS[index]. */
export function getLbaSectorLength(mem: HalfwordTableMemory, index: number): number {
    const off = Math.imul(index | 0, 2);
    return mem.read16((LBA_LEN_SECTORS + off) >>> 0) & 0xffff;
}
