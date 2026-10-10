// Resident item helpers, exe/f5.s:7-22, f6.s:7-23, f7.s:7-22.
// Existing evidence: FRAG-EXE-F5-E01/F6-E01/F7-E01; oracle below uses
// shipped resident.bin. f7 is byte equality, NOT a bitmask predicate.
export interface ItemRecordMemory { read8(address: number): number; }
export function itemRecord(id: number): number {
    return (id | 0) <= 0 ? 0 : (0x80041838 + Math.imul(id | 0, 12)) >>> 0;
}
export function itemIconClip(mem: ItemRecordMemory, id: number): number {
    return mem.read8((0x80042ba8 + mem.read8((itemRecord(id) + 9) >>> 0)) >>> 0) & 255;
}
export function itemClassEquals(mem: ItemRecordMemory, id: number, value: number): number {
    return (mem.read8((itemRecord(id) + 8) >>> 0) & 255) === (value | 0) ? 1 : 0;
}
