// The resident resource/cache service accessors, translated from the EXE.
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/cache-service-oracle.test.js runs the original addresses through
// engine/native and compares.
//
// DECODED: exe-decomp/c/F0x800138A8.c and F0x80013A34.c plus fns.norm.s.

/** The resource service's active/idle word (F0x800138A8 reads it). */
export const RESOURCE_SERVICE_ACTIVE = 0x80044b04;
/** The 64-slot cache table; each slot is 0x10 bytes (F0x800139FC/F0x80013A34). */
export const CACHE_SLOTS = 0x80044b3c;
export const CACHE_SLOT_COUNT = 0x40;
export const CACHE_SLOT_STRIDE = 0x10;

export interface WordReader {
    read32(addr: number): number;
}

/**
 * F0x800138A8(): 1 while the resource service is busy. The original is
 * `lw v0,[0x80044b04]; sltu v0,zero,v0`, so any nonzero word yields 1.
 */
export function isResourceServiceReady(mem: WordReader): number {
    return (mem.read32(RESOURCE_SERVICE_ACTIVE) >>> 0) !== 0 ? 1 : 0;
}

/**
 * F0x80013A34(): the first of the 64 cache slots whose +4 word is 0, else 0.
 * The original returns the slot's address (base + index*0x10).
 */
export function findFreeCacheSlot(mem: WordReader): number {
    for (let i = 0; i < CACHE_SLOT_COUNT; i++) {
        const slot = (CACHE_SLOTS + i * CACHE_SLOT_STRIDE) >>> 0;
        if ((mem.read32(slot + 4) | 0) === 0) return slot;
    }
    return 0;
}

/**
 * F0x800139FC(id): the first of the 64 cache slots whose +4 word equals `id`,
 * else 0. The original walks the table with a 64-iteration counter, compares
 * the full 32-bit word, and returns the slot pointer on a match.
 */
export function findCacheSlotById(mem: WordReader, id: number): number {
    const want = id | 0;
    for (let i = 0; i < CACHE_SLOT_COUNT; i++) {
        const slot = (CACHE_SLOTS + i * CACHE_SLOT_STRIDE) >>> 0;
        if ((mem.read32(slot + 4) | 0) === want) return slot;
    }
    return 0;
}

export interface CacheSlotMemory extends WordReader {
    read16(addr: number): number;
    write16(addr: number, value: number): void;
    write32(addr: number, value: number): void;
}

export interface CacheFreeHost {
    /** [0x8004B5EC](buffer): the evictor's free routine. */
    freeBlock(buffer: number): void;
}

/**
 * F0x80013EFC(id): free the slot holding `id` when it is resident (state 3) and
 * blank its five fields. Assembly order:
 *   s = F0x800139FC(id); if (s == 0) return
 *   if (lh(s) != 3) return
 *   [0x8004B5EC](lw(s+0xC))          -> host.freeBlock
 *   sw 0, s+0x4; sw 0, s+0xC; sw 0, s+0x8; sh 0, s+0x2; sh 0, s+0x0
 * The state and +0x2 fields are halfwords (`lh`/`sh`), the others words.
 */
export function freeCacheSlotBlock(
    mem: CacheSlotMemory,
    id: number,
    host: CacheFreeHost,
): void {
    const slot = findCacheSlotById(mem, id);
    if (slot === 0) return;
    if ((mem.read32(slot) & 0xffff) !== 3) return;
    host.freeBlock(mem.read32(slot + 0xc) >>> 0);
    mem.write32(slot + 0x4, 0);
    mem.write32(slot + 0xc, 0);
    mem.write32(slot + 0x8, 0);
    mem.write16(slot + 0x2, 0);
    mem.write16(slot + 0x0, 0);
}

// ── the cache service's four bodies ─────────────────────────────────────────
//
// F0x80013A6C poll, F0x80013C30 acquire, F0x80013CDC service-pending and
// F0x80013E20 load-blocking, from the accepted `cache-service-contract` answer
// and `fns.s` L4149-L4423. The states are 0 free, 1 requested, 2 dispatched and
// 3 resident; a poll answers 0 only at 3. The transfer start is the device
// boundary (cell D0x80044B34, the browser's readBank); the frame clock is the
// word at D0x8004DE20 the clock getter F0x8001D6F4 returns.

/** `[0x8004DE20]`: the frame clock the LRU ticks store. */
export const FRAME_CLOCK_CELL = 0x8004de20;
/** `D0x80044B38`: 1 while any slot is in flight. */
export const CACHE_ACTIVE = 0x80044b38;
/** `D0x80044B30`: the busy gate (F0x800138A8). */
export const CACHE_BUSY_CELL = 0x80044b30;
/** `LBA_LEN_SECTORS`: the per-id sector count F0x80014200 returns. */
export const LBA_LEN_SECTORS = 0x800474a4;
/** The allocation tag the cache asks the heap for. */
export const CACHE_ALLOC_TAG = 3;

export interface CacheServiceHost {
    /** `[0x8004B5F4](size, tag)`: the blocking heap allocator. */
    alloc(size: number, tag: number): number;
    /** `[0x80044B34](id, buffer)`: start the disc transfer (device). */
    startTransfer(id: number, buffer: number): void;
}

/**
 * F0x80013A6C(id): 0 when the slot is resident (state 3), 1 otherwise. A
 * missing slot is requested first (the original calls F0x80013C30) and the
 * answer is still 1. Any present slot has its tick refreshed.
 */
export function cachePoll(mem: CacheSlotMemory, id: number, host: CacheServiceHost): number {
    const slot = findCacheSlotById(mem, id);
    if (slot === 0) {
        cacheAcquire(mem, id, host);
        return 1;
    }
    mem.write32(slot + 0x8, mem.read32(FRAME_CLOCK_CELL) | 0);
    return (mem.read32(slot) & 0xffff) === 3 ? 0 : 1;
}

/**
 * F0x80013C30(id): touch a known slot, or take the first free one, record the
 * id, allocate `sectors << 11` bytes from the heap and put the slot in state 1.
 * The original trusts `F0x80013A34` to find a free slot; with none free it
 * writes through address 0 exactly as the shipped code does.
 */
export function cacheAcquire(mem: CacheSlotMemory, id: number, host: CacheServiceHost): void {
    const known = findCacheSlotById(mem, id);
    if (known !== 0) {
        mem.write32(known + 0x8, mem.read32(FRAME_CLOCK_CELL) | 0);
        return;
    }
    const slot = findFreeCacheSlot(mem);
    mem.write32(slot + 0x4, id | 0);
    const sectors = mem.read16(LBA_LEN_SECTORS + (id & 0xffff) * 2);
    mem.write32(slot + 0xc, host.alloc((sectors << 11) >>> 0, CACHE_ALLOC_TAG) | 0);
    mem.write16(slot + 0x0, 1);
    mem.write32(slot + 0x8, 0);
    mem.write16(slot + 0x2, 0);
    mem.write32(CACHE_ACTIVE, 1);
}

/**
 * F0x80013CDC(): one pass of the loader. It runs nothing while the busy gate
 * answers 1; otherwise the first state-1 slot starts its transfer and becomes 2,
 * every state-2 slot becomes 3, both refresh their tick, and at most one
 * transfer starts per pass. When no slot moved the active word is cleared.
 */
export function cacheServicePending(mem: CacheSlotMemory, host: CacheServiceHost): void {
    if ((mem.read32(CACHE_ACTIVE) | 0) === 0) return;
    if (isResourceServiceReady(mem) === 1) return;
    let updated = false;
    let started = false;
    for (let i = 0; i < CACHE_SLOT_COUNT; i++) {
        const slot = (CACHE_SLOTS + i * CACHE_SLOT_STRIDE) >>> 0;
        const id = mem.read32(slot + 0x4) | 0;
        if (id === 0) continue;
        const state = mem.read32(slot) & 0xffff;
        if (state === 1) {
            if (started) continue;
            updated = true;
            host.startTransfer(id, mem.read32(slot + 0xc) >>> 0);
            mem.write16(slot + 0x0, 2);
            mem.write32(slot + 0x8, mem.read32(FRAME_CLOCK_CELL) | 0);
            started = true;
        } else if (state === 2) {
            mem.write16(slot + 0x0, 3);
            mem.write32(slot + 0x8, mem.read32(FRAME_CLOCK_CELL) | 0);
            updated = true;
        }
    }
    if (!updated) mem.write32(CACHE_ACTIVE, 0);
}

/**
 * F0x80013E20(id): request the slot, then service the loader until the poll
 * says the slot is resident. A caller that only needs to wait for its own file
 * gets here; `F0x80013E5C` is the same loop wrapped around a buffer return.
 */
export function cacheLoadBlocking(mem: CacheSlotMemory, id: number, host: CacheServiceHost): void {
    cacheAcquire(mem, id, host);
    do {
        cacheServicePending(mem, host);
    } while (cachePoll(mem, id, host) !== 0);
}

/** `0x8004DE10 + 0x188`: the clock-getter pointer cell resourceGetBase reads. */
export const RESOURCE_GET_CLOCK_CELL = 0x8004df98;
/** `D0x80044B04 + 0x2C` = 0x80044B30: the readiness gate the blocking path spins on. */
export const RESOURCE_BUSY_GATE = 0x80044b30;

/**
 * F0x80013E5C(id) - resourceGetBase: the RAM base of a requested bank's file.
 *
 * Resident path (fns.s L4432-4448): find the slot for `id`; when its state
 * halfword is 3, stamp the slot's +8 LRU tick from the clock getter at cell
 * `[0x8004DE10+0x188]` (0x8004DF98 -> F0x8001D6F4 -> `[0x8004DE20]`) and return
 * the slot's +0xC buffer word.
 *
 * Non-resident path (fns.s L4450-4462): the decompiled C omits it, but the
 * assembly first busy-waits - it calls `[0x80044B04+0x2C]` (the readiness cell
 * 0x80044B30) in a loop until it answers 0 - then loads the slot blocking
 * (F0x80013E20) and returns the found slot's +0xC buffer. A missing slot after
 * the blocking load reads the table base (its +4 id is 0), so the buffer word
 * comes back 0 - the shipped behavior, preserved.
 */
export function resourceGetBase(
    mem: CacheSlotMemory,
    id: number,
    host: CacheServiceHost & { clock(): number; busyGate(): number },
): number {
    const slot = findCacheSlotById(mem, id);
    if (slot !== 0 && (mem.read32(slot) & 0xffff) === 3) {
        mem.write32(slot + 0x8, host.clock() | 0);
        return mem.read32(slot + 0xc) >>> 0;
    }
    while ((host.busyGate() | 0) !== 0) {
        // spin: the original's bnez $v0, .L0x80013ebc
    }
    cacheLoadBlocking(mem, id, host);
    const found = findCacheSlotById(mem, id);
    return found === 0 ? 0 : mem.read32(found + 0xc) >>> 0;
}

/**
 * F0x800140D8(handle) - the pack-entry resolver `[0x80044B38 + 0x424]`: the
 * handle's high half names a resource and its low half an entry. It returns
 * `resourceGetBase(handle >> 16) + word[base + (handle & 0xFFFF) * 4]`, so an
 * entry's offset table is relative to the file (fns.s L4602-L4618).
 */
export function packResolveHandle(
    mem: CacheSlotMemory,
    handle: number,
    host: CacheServiceHost & { clock(): number; busyGate(): number },
): number {
    const base = resourceGetBase(mem, (handle >>> 16) & 0xffff, host);
    const offset = mem.read32((base + ((handle & 0xffff) << 2)) >>> 0) | 0;
    return (offset + base) >>> 0;
}
