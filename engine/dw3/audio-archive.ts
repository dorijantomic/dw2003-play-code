// The screen audio-archive request pair, translated from the EXE.
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/audio-archive-oracle.test.js runs both original addresses
// through engine/native over the same seeded channel records and compares the
// request struct, the channel record, the alternation toggle and the ordered
// device calls.
//
// DECODED: the accepted `audio-archive-contract` answer (researcher B) and
// `~/ddw3/asm/dw2003/exe/fns.s` L17935-L18046. F0x8002044C(channel, id) tears
// down the channel's current program (16 voices per entry, then the program, then
// the VAB slot), stores the new archive request and hands the descriptor's file
// id to the cache service. F0x80020574(id) is the gate: it does nothing when one
// of the two channels already holds that archive, otherwise it requests the
// alternated channel and flips the toggle. Neither waits for the load; the cache
// service (engine/dw3/resource-service.ts) is the only edge.
//
// Turn 356+ translated F0x8003913c (compactBlockRelease) and F0x800391bc
// (compactSpuBlocks), the SPU block map maintenance that releaseVabSlot
// delegates to, and the upload latch pair F0x8003a9b4/F0x8003a98c.
// Source: exe-decomp/c/F0x8003913c.c, F0x800391bc.c, F0x8003a9b4.c, F0x8003a98c.c.

export interface AudioArchiveMemory {
    read16(addr: number): number;
    read32(addr: number): number;
    write16(addr: number, value: number): void;
    write32(addr: number, value: number): void;
}

export interface AudioArchiveHost {
    /** F0x800335B4(entry, index): release one of a program's 16 voices (device). */
    releaseVoice(entry: number, index: number): void;
    /** F0x8003058C(entry): close the program slot (device). */
    closeProgram(entry: number): void;
    /** F0x80037DCC(slot): release the VAB slot (device). */
    releaseVabSlot(slot: number): void;
    /** `[0x80044F44](fileId)`: the cache acquire F0x80013C30. */
    acquire(fileId: number): void;
}

/** Boundaries below the slot wrapper; allocator internals are not translated here. */
export interface VabReleaseMemory extends AudioArchiveMemory {
    read8(addr: number): number;
    write8(addr: number, value: number): void;
}

export interface VabReleaseHost {
    /** F0x8003913c(block): release a resident SPU block. */
    compactBlock(block: number): void;
    /** F0x8003a9b4(): read the resident SPU upload latch (device). */
    readUploadLatch(): number;
    /** F0x8003a98c(value): set the resident SPU upload latch (device). */
    setUploadLatch(value: number): void;
}

// SPU block-map globals (exe resident core).
/** D0x8005c2e0 — active entry count in the block map. */
export const SPU_BLOCK_COUNT = 0x8005c2e0;
/** D0x8005c2e4 — total slot capacity (inclusive upper bound for iteration). */
export const SPU_BLOCK_CAPACITY = 0x8005c2e4;
/** D0x8005c2e8 — base address of the 8-byte block entry array. */
export const SPU_BLOCK_BASE = 0x8005c2e8;
/** D0x8005c2b4 — upload latch flag (0 = upload pending, 1 = idle). */
export const SPU_UPLOAD_LATCH = 0x8005c2b4;
/** Block entry stride: {u32 flags, u32 size_or_link}. */
const BLOCK_STRIDE = 8;
/** Flag: entry is locked/reserved — skip during operations. */
const BLOCK_LOCKED = 0x40000000;
/** Flag: entry has been freed, pending compaction. */
const BLOCK_FREED = 0x80000000;
/** Sentinel for an empty/removed slot. */
const BLOCK_EMPTY = 0x2FFFFFFF;
/** Mask for the address/size payload (low 28 bits). */
const BLOCK_PAYLOAD = 0x0FFFFFFF;

/** The channel record array; channel 0 is never touched by these two. */
export const AUDIO_CHANNEL_BASE = 0x80055bec;
export const AUDIO_CHANNEL_STRIDE = 0x18;
export const AUDIO_VOICE_COUNT = 16;
/** The single request struct (`channel+0x50`). */
export const AUDIO_REQUEST_DESCRIPTOR = 0x80055c3c;
export const AUDIO_REQUEST_PENDING = 0x80055c40;
export const AUDIO_REQUEST_CHANNEL = 0x80055c42;
/** `id -> descriptor pointer`. */
export const AUDIO_ARCHIVE_TABLE = 0x800518b4;
/** The single VAB-slot state byte array (`0` free, `1`/`2` registered). */
export const AUDIO_VAB_STATE = 0x80082688;
/** The live VAB-slot count (u16; decremented with halfword wrap). */
export const AUDIO_VAB_COUNT = 0x800826e0;
/** The slot -> block pointer table (u32 words). */
export const AUDIO_VAB_TABLE = 0x800826e8;
/** The channel alternation toggle. */
export const AUDIO_TOGGLE = 0x80055c38;
/** The id word each channel record starts with (the gate's comparison). */
export const AUDIO_CHANNEL_IDS = [0x80055c04, 0x80055c1c] as const;

const s16 = (v: number): number => (v << 16) >> 16;

/**
 * F0x8002044C(channel, id): release whatever the channel currently holds, then
 * request `id`. The archive id is stored even when there is nothing to release.
 */
export function loadAudioArchive(
    mem: AudioArchiveMemory,
    host: AudioArchiveHost,
    channel: number,
    id: number,
): void {
    const rec = (AUDIO_CHANNEL_BASE + (channel | 0) * AUDIO_CHANNEL_STRIDE) >>> 0;
    const slot = s16(mem.read16(rec + 0x4));
    mem.write32(rec + 0x0, id | 0); // the store sits in the branch's delay slot
    if (slot !== -1) {
        const count = s16(mem.read16(rec + 0x6));
        if (count > 0) {
            for (let j = 0; j < count; j++) {
                const entry = s16(mem.read16(rec + 0x8 + j * 2));
                for (let i = 0; i < AUDIO_VOICE_COUNT; i++) host.releaseVoice(entry, i);
                host.closeProgram(entry);
            }
        }
        host.releaseVabSlot(slot);
        mem.write16(rec + 0x4, 0xffff);
    }
    mem.write16(AUDIO_REQUEST_PENDING, 1);
    const descriptor = mem.read32(AUDIO_ARCHIVE_TABLE + (id | 0) * 4) | 0;
    mem.write16(AUDIO_REQUEST_CHANNEL, channel | 0);
    mem.write32(AUDIO_REQUEST_DESCRIPTOR, descriptor);
    host.acquire(mem.read32(descriptor + 0x4) | 0);
}

/**
 * F0x80020574(id): request `id` unless a channel already holds it. The
 * alternation toggle picks channel 2 when it is 1, channel 1 otherwise, and is
 * flipped after the request. A repeat request during a load is a no-op because
 * the comparison reads the id word the loader writes at request time.
 */
export function ensureSoundArchiveLoaded(
    mem: AudioArchiveMemory,
    host: AudioArchiveHost,
    id: number,
): void {
    const want = id | 0;
    if ((mem.read32(AUDIO_CHANNEL_IDS[0]) | 0) === want) return;
    if ((mem.read32(AUDIO_CHANNEL_IDS[1]) | 0) === want) return;
    if ((mem.read32(AUDIO_TOGGLE) | 0) === 1) {
        loadAudioArchive(mem, host, 2, want);
        mem.write32(AUDIO_TOGGLE, 2);
        return;
    }
    loadAudioArchive(mem, host, 1, want);
    mem.write32(AUDIO_TOGGLE, 1);
}

/**
 * Source: ~/ddw3/asm/dw2003/exe/fns.s L43355-L43395; accepted retrieval
 * turn350-next-resident-row. Oracle: tests/audio-archive-oracle.test.js.
 * This translates the wrapper only, not its allocator/latch boundaries.
 * F0x80037DCC(slot): release one VAB slot. Guarded on the slot's low 16 bits
 * (< 16) and the slot's state byte (1 or 2; 0 free, >= 3 never taken). A valid
 * release releases the slot's resident block, clears the state byte,
 * decrements the live count with halfword wrap, and — only when the upload
 * latch reads 1 — clears the latch to 0. Everything else is a silent no-op
 * (the original still saves/restores its frame). The counter's store sits in
 * the original's `jal F0x8003a9b4` delay slot, so it lands BEFORE the latch
 * read, not after.
 */
export function releaseVabSlot(
    mem: VabReleaseMemory,
    host: VabReleaseHost,
    slot: number,
): void {
    const s = slot & 0xffff;
    if (s >= 0x10) return;
    const state = mem.read8(AUDIO_VAB_STATE + s);
    if (state === 0 || state >= 3) return;
    host.compactBlock(mem.read32(AUDIO_VAB_TABLE + s * 4) | 0);
    mem.write8(AUDIO_VAB_STATE + s, 0);
    mem.write16(AUDIO_VAB_COUNT, (mem.read16(AUDIO_VAB_COUNT) - 1) & 0xffff);
    if ((host.readUploadLatch() | 0) === 1) host.setUploadLatch(0);
}

/**
 * F0x8003a9b4: read the SPU upload latch flag.
 * Returns 0 when D0x8005c2b4 == 1 (latch held), 1 otherwise (idle/ready).
 * Source: exe-decomp/c/F0x8003a9b4.c.
 */
export function readUploadLatch(mem: { read32(addr: number): number }): number {
    return (mem.read32(SPU_UPLOAD_LATCH) | 0) !== 1 ? 1 : 0;
}

/**
 * F0x8003a98c: set the SPU upload latch flag.
 * Writing 1 clears the latch (D0x8005c2b4 = 0); anything else sets it (1).
 * Source: exe-decomp/c/F0x8003a98c.c.
 */
export function setUploadLatch(mem: { write32(addr: number, value: number): void }, value: number): void {
    mem.write32(SPU_UPLOAD_LATCH, (value | 0) === 1 ? 0 : 1);
}

/**
 * F0x8003913c: compact block release. Walks the SPU block map
 * (D0x8005c2e8 base, D0x8005c2e0 count) looking for an entry whose payload
 * matches `blockId`. On match (and when the entry is not locked), sets the
 * BLOCK_FREED flag (|= 0x80000000) and calls compactSpuBlocks to merge and
 * sort. Unmatched entries are skipped; a full scan still hands off to the
 * compactor.
 * Source: exe-decomp/c/F0x8003913c.c.
 */
export function compactBlockRelease(
    mem: { read32(addr: number): number; write32(addr: number, value: number): void },
    blockId: number,
): void {
    const count = mem.read32(SPU_BLOCK_COUNT) | 0;
    const base = mem.read32(SPU_BLOCK_BASE) | 0;
    // The MIPS code (F0x8003913c) iterates entries linearly.  On encountering
    // a LOCKED entry it jumps straight to the compactor (bnez → .L0x800391a0)
    // without advancing the pointer — it does NOT continue scanning.  A match
    // stores the freed flag and also jumps to the compactor.  Only a non-locked
    // non-matching entry advances the scan.
    if (count > 0) {
        let ptr = base;
        for (let i = 0; i < count; i++) {
            const flags = mem.read32(ptr) | 0;
            if ((flags & BLOCK_LOCKED) !== 0) break;   // locked → compactor
            if ((flags & BLOCK_PAYLOAD) === (blockId & BLOCK_PAYLOAD)) {
                mem.write32(ptr, flags | BLOCK_FREED);
                break;
            }
            ptr += BLOCK_STRIDE;
        }
    }
    compactSpuBlocks(mem);
}

/**
 * F0x800391bc: five-phase SPU block-map compactor.
 * Phase 1: merge adjacent freed blocks (BLOCK_FREED flag set by
 *   compactBlockRelease) by folding consecutive freed entries whose addresses
 *   are contiguous.
 * Phase 2: remove zero-size entries by replacing them with BLOCK_EMPTY.
 * Phase 3: selection-sort non-locked entries by ascending address payload,
 *   which also coalesces adjacent freed+payload-adjacent pairs.
 * Phase 4: remove BLOCK_EMPTY entries by sliding the tail forward and
 *   updating the count.
 * Phase 5: compact tail freed blocks from the end backward, converting
 *   BLOCK_FREED to BLOCK_LOCKED and reducing the count.
 * Source: exe-decomp/c/F0x800391bc.c.
 */
export function compactSpuBlocks(
    mem: { read32(addr: number): number; write32(addr: number, value: number): void },
): void {
    const capacity = mem.read32(SPU_BLOCK_CAPACITY) | 0;
    const base = mem.read32(SPU_BLOCK_BASE) | 0;

    // Phase 1: merge adjacent freed blocks.
    // C loop (F0x800391bc.c): do { ... } while (D0x8005c2e4 >= var_t1).
    // When a merge succeeds the outer counter is NOT incremented: the same
    // entry is re-examined so that a chain of consecutive merges is captured.
    // The TS inner loop already continues after a merge, achieving the same
    // chain; the outer loop then advances to the next entry.
    if (capacity >= 0) {
        let ptr = base;
        for (let i = 0; i <= capacity; i++) {
            const flags = mem.read32(ptr) | 0;
            if ((flags & BLOCK_FREED) !== 0) {
                let scan = (i + 1) * BLOCK_STRIDE + base;
                for (let j = i + 1; j <= capacity; j++) {
                    // Skip BLOCK_EMPTY entries (the C inner loop_4 does the
                    // same: advance and re-check until non-empty).
                    if ((mem.read32(scan) | 0) === BLOCK_EMPTY) {
                        scan += BLOCK_STRIDE;
                        continue;
                    }
                    const nextFlags = mem.read32(scan) | 0;
                    if ((nextFlags & BLOCK_FREED) !== 0 &&
                        (nextFlags & BLOCK_PAYLOAD) === ((flags & BLOCK_PAYLOAD) + (mem.read32(ptr + 4) | 0))) {
                        mem.write32(scan, BLOCK_EMPTY);
                        mem.write32(ptr + 4, (mem.read32(ptr + 4) | 0) + (mem.read32(scan + 4) | 0));
                    } else {
                        break;
                    }
                }
                ptr += BLOCK_STRIDE;
            } else {
                ptr += BLOCK_STRIDE;
            }
        }
    }

    // Phase 2: remove zero-size entries by marking them BLOCK_EMPTY.
    if (capacity >= 0) {
        let ptr = base;
        for (let i = 0; i <= capacity; i++) {
            if ((mem.read32(ptr + 4) | 0) === 0) {
                mem.write32(ptr, BLOCK_EMPTY);
            }
            ptr += BLOCK_STRIDE;
        }
    }

    // Phase 3: selection-sort non-locked entries by ascending address payload.
    // The C loop (loop_19/loop_22) exits when it hits a locked entry or runs
    // out of entries; the TS for-loop matches this by breaking on locked.
    if (capacity >= 0) {
        let outer = base;
        for (let i = 0; i <= capacity; i++) {
            const outerFlags = mem.read32(outer) | 0;
            if ((outerFlags & BLOCK_LOCKED) !== 0) break;
            let inner = (i + 1) * BLOCK_STRIDE + base;
            for (let j = i + 1; j <= capacity; j++) {
                const innerFlags = mem.read32(inner) | 0;
                if ((innerFlags & BLOCK_LOCKED) === 0) {
                    if ((innerFlags & BLOCK_PAYLOAD) < (outerFlags & BLOCK_PAYLOAD)) {
                        // swap
                        const tmpFlags = mem.read32(outer) | 0;
                        const tmpSize = mem.read32(outer + 4) | 0;
                        mem.write32(outer, mem.read32(inner) | 0);
                        mem.write32(outer + 4, mem.read32(inner + 4) | 0);
                        mem.write32(inner, tmpFlags);
                        mem.write32(inner + 4, tmpSize);
                    }
                }
                inner += BLOCK_STRIDE;
            }
            outer += BLOCK_STRIDE;
        }
    }

    // Phase 4: remove BLOCK_EMPTY entries.
    // C loop (loop_29): on finding a BLOCK_EMPTY entry, copies the LAST
    // entry (at D0x8005c2e4) to the current position, shrinks the capacity,
    // and exits the loop (no goto loop_29). A locked entry also exits.
    if (capacity >= 0) {
        let i = 0;
        let ptr = base;
        while (i <= capacity) {
            const flags = mem.read32(ptr) | 0;
            if ((flags & BLOCK_LOCKED) !== 0) break;
            if (flags === BLOCK_EMPTY) {
                // copy last entry here and shrink capacity
                const lastPtr = capacity * BLOCK_STRIDE + base;
                mem.write32(ptr, mem.read32(lastPtr) | 0);
                mem.write32(ptr + 4, mem.read32(lastPtr + 4) | 0);
                mem.write32(SPU_BLOCK_CAPACITY, i);
                break;
            }
            i++;
            ptr += BLOCK_STRIDE;
        }
    }

    // Phase 5: compact tail freed blocks backward.
    // Reads D0x8005c2e4 (capacity) directly — it may have been reduced by
    // Phase 4. The C loop (loop_35) converts freed→locked and shrinks the
    // count, merging the freed block's size with the now-last entry.
    let tail = (mem.read32(SPU_BLOCK_CAPACITY) | 0) - 1;
    if (tail >= 0) {
        let ptr = tail * BLOCK_STRIDE + base;
        while (tail >= 0) {
            const flags = mem.read32(ptr) | 0;
            if ((flags & BLOCK_FREED) !== 0) {
                const lastCount = mem.read32(SPU_BLOCK_CAPACITY) | 0;
                mem.write32(ptr, (flags & BLOCK_PAYLOAD) | BLOCK_LOCKED);
                mem.write32(SPU_BLOCK_CAPACITY, tail);
                mem.write32(ptr + 4,
                    (mem.read32(ptr + 4) | 0) +
                    (mem.read32(lastCount * BLOCK_STRIDE + base + 4) | 0));
                tail--;
                ptr -= BLOCK_STRIDE;
            } else {
                break;
            }
        }
    }
}
