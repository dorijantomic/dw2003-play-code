// The text layer's index -> string resolver, ported from the original EXE.
//
// Phase 4 translation. Oracle: tests/text-resolver-oracle.test.js runs the
// original address F0x8001F744 against this port.
//
// DECODED: F0x8001F744 (resident), contract in the accepted shop-name-resource
// answer and docs/research/ui/menu-assets-decoded-2026-07-03.md: the bank image
// is `u32 count`, then `count` u32 relative offsets, then NUL-terminated strings.
// The widget method +0x120 resolves index -> bytes through this.

import type { MemoryReader } from "../party-context.js";

/** F0x8001F744(base, index): bytes at base + offsets[index], or 0. */
export function fetchTableEntry(mem: MemoryReader, base: number, index: number): number {
    const count = mem.read32(base) | 0;
    if (index < 0) return 0;
    if (count < index) return 0; // signed compare, exactly as the original slt
    const offset = mem.read32(base + 4 + index * 4) >>> 0;
    return (base + offset) >>> 0;
}

// ── the fetcher service block and its converter ─────────────────────────────
//
// F0x8001FCC0 builds the three-word service the text layer calls through:
//   +0 F0x8001F744 fetchTableEntry, +4 F0x8001F770 measureLine,
//   +8 F0x8001FA20 convertTextEncoding,
// and registers the block in [gp+0x1C8] (F0x8001F738). F0x8001FA20 converts a
// NUL-terminated source between the game's internal codes and little-endian
// SJIS through the two 4-byte-entry tables at 0x8004E010 and 0x8004E3BC.
//
// Phase 4 translation. Oracle: tests/fetch-family-oracle.test.js runs both
// original addresses against this port over the resident tables.

import { zeroFill } from "../zero-fill.ts";
import { strlenBytes } from "../byte-ops.ts";
import { setCurrentFetcherTable } from "./text-element-setters.ts";

export interface FetcherMemory {
    read8(addr: number): number;
    read16(addr: number): number;
    read32(addr: number): number;
    write8(addr: number, value: number): void;
    write16(addr: number, value: number): void;
    write32(addr: number, value: number): void;
}

/** The two conversion tables (data.rs D0x8004E010 / D0x8004E3BC). */
export const FONT_TABLE_A = 0x8004e010;
export const FONT_TABLE_B = 0x8004e3bc;
/** The three service pointers F0x8001FCC0 stores. */
export const FETCHER_TABLE_ENTRY = 0x8001f744;
export const FETCHER_MEASURE_ENTRY = 0x8001f770;
export const FETCHER_CONVERT_ENTRY = 0x8001fa20;

const bswap16 = (v: number): number => ((v >>> 8) | ((v & 0xff) << 8)) & 0xffff;

/**
 * F0x8001FCC0(block): zero-fill the caller's 0xC-byte block, store the three
 * service pointers and register the block in the gp word. v0 is not set by the
 * original (the callers overwrite it in a delay slot).
 */
export function initFetcherTable(mem: FetcherMemory, block: number): void {
    zeroFill(mem, block, 0xc);
    mem.write32(block + 0, FETCHER_TABLE_ENTRY);
    mem.write32(block + 4, FETCHER_MEASURE_ENTRY);
    mem.write32(block + 8, FETCHER_CONVERT_ENTRY);
    setCurrentFetcherTable(mem, block);
}

/**
 * F0x8001FA20(dst, src, mode): mode 0 walks the source's bytes; a byte >= 4 is
 * looked up in table A and a byte < 4 pairs with the next byte in table B; on a
 * match the byte-swapped 16-bit entry is written to dst (dst += 2). Mode 1 walks
 * the source's halfwords (length >> 1), byte-swaps each and looks it up in table
 * A (write the entry's byte, dst += 1); a miss falls back to table B, whose
 * matching entry writes a 1 and the paired table-A entry's byte (dst += 2).
 * Any other mode is a no-op. Returns 0 on completion (the length when the source
 * is empty, and 1 for an unknown mode, exactly as the original's v0).
 */
export function convertTextEncoding(
    mem: FetcherMemory,
    dst: number,
    src: number,
    mode: number,
): number {
    const len = strlenBytes(mem, src);
    if (mode !== 0) {
        if (mode !== 1) return 1;
        const count = len >> 1;
        if (count <= 0) return 1;
        let idx = 0;
        let ai = src;
        let ao = dst;
        let matches = 0;
        for (;;) {
            let matched = 0;
            if (mem.read16(FONT_TABLE_A + 0x10) !== 0xffff) {
                const swapped = bswap16(mem.read16(ai));
                let entry = FONT_TABLE_A + 0x10;
                for (;;) {
                    if (mem.read16(entry) === swapped) {
                        matches += 1;
                        const byte = mem.read8(entry + 2) & 0xff;
                        matched = 1;
                        mem.write8(ao, byte);
                        ao += 1;
                        break;
                    }
                    entry += 4;
                    if (mem.read16(entry) === 0xffff) break;
                }
            }
            if (matched === 0 && mem.read16(FONT_TABLE_B + 4) !== 0xffff) {
                const swapped = bswap16(mem.read16(ai));
                let entryB = FONT_TABLE_B + 4;
                let entryA = FONT_TABLE_A + 4;
                for (;;) {
                    if (mem.read16(entryB) === swapped) {
                        ao += 2;
                        mem.write8(ao - 2, 1);
                        const byte = mem.read8(entryA + 2) & 0xff;
                        matches += 2;
                        mem.write8(ao - 1, byte);
                        break;
                    }
                    entryB += 4;
                    entryA += 4;
                    if (mem.read16(entryB) === 0xffff) break;
                }
            }
            idx += 1;
            if (!(idx < count)) return 0;
            ai += 2;
        }
    }
    if (len <= 0) return len;
    let idx = 0;
    let ai = src;
    let ao = dst;
    for (;;) {
        const b = mem.read8(ai) & 0xff;
        if (b >= 4) {
            if (mem.read16(FONT_TABLE_A + 0x10) !== 0xffff) {
                let entry = FONT_TABLE_A + 0x10;
                for (;;) {
                    if ((mem.read8(entry + 2) & 0xff) === b) {
                        mem.write16(ao, bswap16(mem.read16(entry)));
                        ao += 2;
                        break;
                    }
                    if (mem.read16(entry + 4) === 0xffff) break;
                    entry += 4;
                }
            }
        } else {
            if (mem.read16(FONT_TABLE_B + 4) !== 0xffff) {
                const second = mem.read8(ai + 1) & 0xff;
                let entry = FONT_TABLE_B + 4;
                for (;;) {
                    if ((mem.read8(entry + 2) & 0xff) === second) {
                        mem.write16(ao, bswap16(mem.read16(entry)));
                        ao += 2;
                        break;
                    }
                    entry += 4;
                    if (mem.read16(entry) === 0xffff) break;
                }
            }
            // The pair path's `a1 += 1 / t3 += 1` falls through into the
            // shared `a1 += 1 / t3 += 1`: a pair advances TWO source bytes
            // and two indices, not one.
            ai += 2;
            idx += 2;
            if (!(idx < len)) return 0;
            continue;
        }
        ai += 1;
        idx += 1;
        if (!(idx < len)) return 0;
    }
}
