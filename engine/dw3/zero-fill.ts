// The resident bzero, translated from the original F0x80017CB0.
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/zero-fill-oracle.test.js runs the original through engine/native
// and compares every byte of a scratch block.
//
// DECODED: ledger core claim core-registry-* and the allocator chain
// (F0x80017F54 allocZeroed -> F0x80017E84 -> this). The original has two
// branches, read instruction by instruction in exe-decomp/c/_asm/F0x80017CB0.s:
//
//   length & 3 != 0 : byte loop, `sb $zero,($a0)` then `addiu $a0,0x1`,
//                     repeated `length` times.
//   length & 3 == 0 : word loop, `sw $zero,($a0)` then `addiu $a0,0x4`,
//                     repeated `length >> 2` times.
//
// Non-positive lengths write nothing (the original's `blez` guard). The two
// branches are indistinguishable in the final memory - both leave the range
// zero - but the word branch is what the original executes, and it is kept here
// so the port reads like the source.

export interface ZeroMemory {
    write8(addr: number, value: number): void;
    write32(addr: number, value: number): void;
}

/** F0x80017CB0(dest, length): zero `length` bytes at `dest`. */
export function zeroFill(mem: ZeroMemory, dest: number, length: number): void {
    const len = length | 0;
    if ((len & 3) !== 0) {
        if (len <= 0) return;
        for (let i = 0; i < len; i++) mem.write8(dest + i, 0);
        return;
    }
    const words = len >> 2;
    if (words <= 0) return;
    for (let i = 0; i < words; i++) mem.write32(dest + i * 4, 0);
}
