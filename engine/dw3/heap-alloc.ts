// The resident heap allocator family, translated from the EXE.
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/heap-alloc-oracle.test.js runs the four originals (plus the two
// fit bodies they call) through engine/native over the same seeded heap and
// compares the whole block list and the returned pointers.
//
// DECODED: the accepted `allocator-family-contract` answer (researcher B) and
// `~/ddw3/asm/dw2003/exe/fns.s` L8545-L8717. One heap descriptor sits at
// D0x8004B5DC: +0x04 the first block (head), +0x08 the last block + 0xC,
// +0x18/+0x1C/+0x20 the two fit wrappers and the zeroing one, +0x408 of
// D0x80044B38 the eviction pump. Every block carries a three-word header:
// +0x00 previous, +0x04 next, +0x08 flag (0 free, nonzero = allocated tag,
// 1 = the static terminal sentinel), payload at +0x0C.
//
// F0x80017D2C carries the forward first fit (low end, split leaves the leftover
// as a new free block); F0x80017DDC the reverse first fit (high end, exact fit
// reuses the whole free block); F0x80017E84 / F0x80017EEC are the same unbounded
// retry wrapper over each of them - on failure they call the eviction pump and
// try again, forever. F0x80017F54 is the retry wrapper plus a bzero of the
// ORIGINAL (unrounded) size.
//
// The heap is initialised by F0x80017C5C at boot in the original. The browser's
// screen runtime does not run that boot yet and serves a separate arena at
// 0x80017D2C instead (engine/native/screen-heap.ts), so these ports are
// registered as translated but not bridged until the heap init is modelled too.

import { zeroFill } from "./zero-fill.ts";

export interface HeapAllocMemory {
    read32(addr: number): number;
    write8(addr: number, value: number): void;
    write32(addr: number, value: number): void;
}

export interface HeapAllocHost {
    /**
     * The eviction pump the retry wrappers call through `[D0x80044B38+0x408]`
     * (F0x80013BE4: drop the least-recently-used resident file buffer so its
     * space returns to this heap). The original never gives up.
     */
    evictOne(): void;
}

/** The heap descriptor base. */
export const HEAP_DESC = 0x8004b5dc;
/** `[D0x8004B5E0]`: the first block. */
export const HEAP_HEAD = HEAP_DESC + 0x4;
/** `[D0x8004B5E4]`: the last block + 0xC. */
export const HEAP_LAST = HEAP_DESC + 0x8;
/** `[D0x80044B38+0x408]`: the eviction pump pointer. */
export const HEAP_EVICT_CELL = 0x80044b38 + 0x408;

export const BLOCK_PREV = 0x0;
export const BLOCK_NEXT = 0x4;
export const BLOCK_FLAG = 0x8;
export const BLOCK_HEADER = 0xc;
/** The terminal sentinel's flag. */
export const BLOCK_SENTINEL = 1;
/** The split floor: a leftover smaller than this is handed to the caller. */
export const BLOCK_MIN_SPLIT = 0x14;

/**
 * F0x80017D2C(size, tag): forward first fit from the head. Returns the payload
 * pointer or 0 when the sentinel is reached. A free block is used when its
 * usable span (next - node - 0xC) is at least the rounded request; when it is
 * also more than `request + 0x14` the remainder becomes a new free block after
 * the caller's, otherwise the whole remainder is given away.
 */
export function heapAllocForward(mem: HeapAllocMemory, size: number, tag: number): number {
    const req = ((size | 0) + 3) & ~3;
    let node = mem.read32(HEAP_HEAD) >>> 0;
    if ((mem.read32(node + BLOCK_FLAG) | 0) === BLOCK_SENTINEL) return 0;
    const threshold = (req + BLOCK_MIN_SPLIT) >>> 0;
    for (;;) {
        if ((mem.read32(node + BLOCK_FLAG) | 0) === 0) {
            const next = mem.read32(node + BLOCK_NEXT) >>> 0;
            const usable = (next - node - BLOCK_HEADER) >>> 0;
            if (usable >= req) {
                if (threshold < usable) {
                    const nn = (node + req + BLOCK_HEADER) >>> 0;
                    mem.write32(nn + BLOCK_PREV, node);
                    mem.write32(nn + BLOCK_FLAG, 0);
                    mem.write32(nn + BLOCK_NEXT, next);
                    mem.write32(next + BLOCK_PREV, nn);
                    mem.write32(node + BLOCK_NEXT, nn);
                }
                mem.write32(node + BLOCK_FLAG, tag | 0);
                return (node + BLOCK_HEADER) >>> 0;
            }
        }
        node = mem.read32(node + BLOCK_NEXT) >>> 0;
        if ((mem.read32(node + BLOCK_FLAG) | 0) === BLOCK_SENTINEL) return 0;
    }
}

/**
 * F0x80017DDC(size, tag): reverse first fit from the last block, so the
 * allocation lands at a free block's high end. A free block exactly the rounded
 * request plus header is taken whole; a larger one is split with the caller's
 * block at the top and the remainder left free below. Returns 0 when the walk
 * reaches the head.
 */
export function heapAllocReverse(mem: HeapAllocMemory, size: number, tag: number): number {
    const req = ((((size | 0) + 3) & ~3) + BLOCK_HEADER) >>> 0;
    let node = (mem.read32(HEAP_LAST) - BLOCK_HEADER) >>> 0;
    if ((mem.read32(HEAP_HEAD) >>> 0) === node) return 0;
    for (;;) {
        const prev = mem.read32(node + BLOCK_PREV) >>> 0;
        if ((mem.read32(prev + BLOCK_FLAG) | 0) === 0) {
            const span = (node - prev) >>> 0;
            if (span === req) {
                mem.write32(prev + BLOCK_FLAG, tag | 0);
                return (prev + BLOCK_HEADER) >>> 0;
            }
            if (req < span) {
                const nn = (node - req) >>> 0;
                mem.write32(nn + BLOCK_PREV, prev);
                mem.write32(nn + BLOCK_NEXT, node);
                mem.write32(nn + BLOCK_FLAG, tag | 0);
                mem.write32(prev + BLOCK_NEXT, nn);
                mem.write32(node + BLOCK_PREV, nn);
                return (nn + BLOCK_HEADER) >>> 0;
            }
        }
        node = mem.read32(node + BLOCK_PREV) >>> 0;
        if ((mem.read32(HEAP_HEAD) >>> 0) !== node) continue;
        return 0;
    }
}

/**
 * F0x80017E84(size, tag): the forward fit retried forever - each failure calls
 * the eviction pump (which frees the oldest resident file buffer) and tries
 * again. Returns a nonzero payload pointer.
 */
export function heapAllocRetry(
    mem: HeapAllocMemory,
    host: HeapAllocHost,
    size: number,
    tag: number,
): number {
    for (;;) {
        const ptr = heapAllocForward(mem, size, tag);
        if (ptr !== 0) return ptr;
        host.evictOne();
    }
}

/** F0x80017EEC(size, tag): the same unbounded retry wrapper over the reverse fit. */
export function heapAllocRetryHigh(
    mem: HeapAllocMemory,
    host: HeapAllocHost,
    size: number,
    tag: number,
): number {
    for (;;) {
        const ptr = heapAllocReverse(mem, size, tag);
        if (ptr !== 0) return ptr;
        host.evictOne();
    }
}

/**
 * F0x80017F54(size, tag): the forward retry wrapper, then a bzero of the
 * ORIGINAL size (not the rounded one). Returns the payload pointer.
 */
export function heapAllocZeroed(
    mem: HeapAllocMemory,
    host: HeapAllocHost,
    size: number,
    tag: number,
): number {
    const ptr = heapAllocRetry(mem, host, size, tag);
    zeroFill(mem, ptr, size | 0);
    return ptr;
}
