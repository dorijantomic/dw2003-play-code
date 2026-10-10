// The resident byte-copy and string-length helpers, translated bit-exactly.
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/byte-ops-oracle.test.js runs the original addresses through
// engine/native and compares.
//
// DECODED: ledger claims core-q002 / the widget-line path and exe-decomp/c/
// F0x8002514C.c, F0x8002525C.c, confirmed instruction by instruction in
// exe-decomp/fns.norm.s:
//
//   F0x8002514C(dest, src, n): if dest == 0 return 0. Otherwise copy n bytes
//   FORWARD one at a time (so an overlapping dest > src propagates, it is not
//   memmove) and return dest. n <= 0 copies nothing and still returns dest.
//
//   F0x8002525C(s): if s == 0 return 0, else count bytes until the NUL and
//   return the count (the NUL is excluded).
//
// These are the copy/length pair F0x80019370 widgetSetLineString calls, so they
// are the first dependency of the text producer path.

export interface ByteMemory {
    read8(addr: number): number;
    write8(addr: number, value: number): void;
}

/** F0x8002514C(dest, src, n): forward byte copy; returns dest (0 if dest is 0). */
export function memcpyBytes(mem: ByteMemory, dest: number, src: number, n: number): number {
    if (dest === 0) return 0;
    const count = n | 0;
    for (let i = 0; i < count; i++) {
        mem.write8(dest + i, mem.read8(src + i) & 0xff);
    }
    return dest >>> 0;
}

/** F0x8002525C(s): byte length up to the NUL; returns 0 for a null pointer. */
export function strlenBytes(mem: ByteMemory, ptr: number): number {
    if (ptr === 0) return 0;
    let n = 0;
    while ((mem.read8(ptr + n) & 0xff) !== 0) n += 1;
    return n;
}

/**
 * F0x8002518C(dest, src): copy src to dest INCLUDING the terminating NUL and
 * return dest; either pointer null returns 0. Forward byte loop, like the
 * original. Read from the m2c body and fns.norm.s.
 */
export function strcpyBytes(mem: ByteMemory, dest: number, src: number): number {
    if (dest === 0 || src === 0) return 0;
    let i = 0;
    for (;;) {
        const b = mem.read8(src + i) & 0xff;
        mem.write8(dest + i, b);
        i += 1;
        if (b === 0) break;
    }
    return dest >>> 0;
}

/**
 * F0x800283C4(dest, value, n): Psy-Q memsetBytes. The original stores `value`
 * through a signed-byte pointer, so only the low 8 bits land; the count is a
 * signed word and a non-positive n (including 0) writes nothing. No return
 * value. Read from fns.s:26511-26520.
 */
export function memsetBytes(mem: ByteMemory, dest: number, value: number, n: number): void {
    const count = n | 0;
    for (let i = 0; i < count; i++) {
        mem.write8(dest + i, value & 0xff);
    }
}
