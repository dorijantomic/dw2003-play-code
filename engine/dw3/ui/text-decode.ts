// The resident text-token decoder, translated bit-exactly from F0x8001D264.
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/text-decode-oracle.test.js runs the original through
// engine/native on the resident image and compares every byte pair under both
// convert flags, plus the shipped label strings from pro/stagslct,
// pro/soundtst and pro/shocktst.
//
// DECODED: authority-2 `~/ddw3/asm/dw2003/exe/fns.s` L14434-L14531, read with
// the accepted `text-decoder-pair-path` contract. One call decodes ONE token
// and returns one u16 `type << 8 | code`; it writes no output buffer and has no
// loop.
//
//   a0 = pointer to the current token byte
//   a1 & 0xFF = the line's convert flag (line record +0xA; 1 for a literal
//               caller string installed through widget method +0x110)
//   a2 = the font bank record (widget +0x50): +0x0C table A (Shift-JIS in
//        range, entries start at pointer+0x10), +0x10 table B, +0x14 s16 basic
//        code limit, +0x16 u16 extended glyph count (the same halfword read
//        signed for the limit and unsigned for the count).
//
// Convert flag 1: byte 0 ends the line (0x0400); 0x0A is a one-byte newline
// (0x0201); 0x01..0x03 return the raw halfword; every other byte is the lead of
// a two-byte Shift-JIS pair. 0x824F..0x8394 look up table A and return a basic
// glyph code (type 0); anything else looks up table B and returns an extended
// glyph code or-ed with 0x100 (type 1). A table miss, or a table whose first
// key is 0xFFFF, returns 0x0300 (the caller draws basic glyph 0). The terminator
// check looks one entry ahead, exactly as the assembly does.
//
// Convert flag 0 (native codec): 0x01,N is extended glyph N-1 clamped to
// (count+1); 0x02/0x03 are control/blank pairs returning the raw halfword;
// 0x04..0xFF is a basic glyph code when it is below the signed +0x14 limit.
//
// The caller (the drawer F0x800197A4 and the stepper F0x8001A48C) advances the
// cursor 2 bytes for a pair in convert mode and 1 byte otherwise.

export interface TextDecodeMemory {
    read8(addr: number): number;
    read32(addr: number): number;
    read16(addr: number): number;
    read16s(addr: number): number;
}

/** The font bank record's fields. */
export const TEXT_FONT = {
    tableA: 0x0c,
    tableB: 0x10,
    basicLimit: 0x14,
    extCount: 0x16,
} as const;
/** The resident kind-1 font record the browser bridge draws with. */
export const TEXT_FONT_KIND1 = 0x8004dd8c;
/** Decoder return values. */
export const TEXT_TOKEN_END = 0x0400;
export const TEXT_TOKEN_INVALID = 0x0300;
export const TEXT_TOKEN_NEWLINE = 0x0201;
/** The Shift-JIS range table A serves. */
export const TEXT_SJIS_FIRST = 0x824f;
export const TEXT_SJIS_LAST = 0x8394;
/** Entry layout: {u16 key, u8 value, u8 pad}, 4 bytes. */
export const TEXT_TABLE_ENTRY = 4;
export const TEXT_TABLE_TERMINATOR = 0xffff;

const s16 = (v: number): number => (v << 16) >> 16;

function tableLookup(
    mem: TextDecodeMemory,
    table: number,
    key: number,
    firstOffset: number,
    tag: number,
): number {
    let entry = (table + firstOffset) >>> 0;
    if (mem.read16(entry) === TEXT_TABLE_TERMINATOR) return TEXT_TOKEN_INVALID;
    for (;;) {
        if ((key & 0xffff) === mem.read16(entry)) {
            return ((mem.read8(entry + 2) & 0xff) | tag) >>> 0;
        }
        const next = (entry + TEXT_TABLE_ENTRY) >>> 0;
        // The lookahead terminator check: if the NEXT entry is the sentinel the
        // key is absent.
        if (mem.read16(next) === TEXT_TABLE_TERMINATOR) return TEXT_TOKEN_INVALID;
        entry = next;
    }
}

/**
 * F0x8001D264(ptr, convert, font): decode one text token.
 */
export function decodeTextToken(
    mem: TextDecodeMemory,
    ptr: number,
    convert: number,
    font: number,
): number {
    const b0 = mem.read8(ptr) & 0xff;
    if (b0 === 0) return TEXT_TOKEN_END;
    if ((convert & 0xff) !== 0) {
        if (b0 < 4) {
            return s16((((b0 << 8) | (mem.read8(ptr + 1) & 0xff)) & 0xffff));
        }
        if (b0 === 0x0a) return TEXT_TOKEN_NEWLINE;
        const key = ((b0 << 8) | (mem.read8(ptr + 1) & 0xff)) & 0xffff;
        if (((key + 0x7db1) & 0xffff) < 0x146) {
            return tableLookup(mem, mem.read32(font + TEXT_FONT.tableA) >>> 0, key, 0x10, 0);
        }
        return tableLookup(mem, mem.read32(font + TEXT_FONT.tableB) >>> 0, key, 0, 0x100);
    }
    if (b0 === 1) {
        const b1 = mem.read8(ptr + 1) & 0xff;
        const limit = mem.read16s(font + TEXT_FONT.extCount);
        if (limit < b1) {
            return (((mem.read16(font + TEXT_FONT.extCount) + 1) & 0xff) | 0x100) >>> 0;
        }
        return s16((((1 << 8) | b1) & 0xffff));
    }
    if (b0 >= 4) {
        return b0 < mem.read16s(font + TEXT_FONT.basicLimit) ? b0 : TEXT_TOKEN_INVALID;
    }
    return s16((((b0 << 8) | (mem.read8(ptr + 1) & 0xff)) & 0xffff));
}
