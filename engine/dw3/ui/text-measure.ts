// The text measure service, translated from the resident EXE.
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/text-measure-oracle.test.js runs both original addresses through
// engine/native and compares the return / the stored halfword.
//
// DECODED: F0x8001F770 (fns.s L17041-L17187) and F0x8001A25C (fns.s
// L11174-L11204), plus the accepted text-family-contract answer. The measure is
// what makes a label centred or right-aligned: it walks a line's tokens, sums
// each glyph's advance + ink offset (or the fixed cell when one is set), tracks
// the widest page width across the `{1}`/`{3}` page-break opcodes, and recurses
// into a sibling line record for the `{5}` name-substitution opcode. The result
// is stored s16 at widget+0xBC and negated into +0xB8 by the drawer.
//
// F0x8001A25C builds a three-word fetcher service on its stack
// (F0x8001FCC0: {+0 F0x8001F744, +4 F0x8001F770, +8 F0x8001FA20}) and calls
// the +4 slot. The port calls measureLine directly; the service block itself is
// the fetcher family's port (engine/dw3/ui/fetch-table.ts covers +0).

import { decodeTextToken } from "./text-decode.ts";

export interface TextMeasureMemory {
    read8(addr: number): number;
    read16(addr: number): number;
    read16s(addr: number): number;
    read32(addr: number): number;
    write16(addr: number, value: number): void;
}

/** Pointer cell holding the cursor-advance table (data.rs D0x8004DE04 -> D0x8004DDD4). */
export const ADVANCE_TABLE_CELL = 0x8004de04;
/** The widget's line-0 record, font pointer, fixed cell and result halfword. */
export const MEASURE_WIDGET = { line0: 0x5c, font: 0x50, fixedCell: 0xb4, width: 0xbc } as const;
/** The line record fields the measure reads. */
export const MEASURE_LINE = { buffer: 0x0, length: 0x6, flag: 0xa } as const;

/** The ten operand advance counts (data.rs D0x8004DDD4). */
export const ADVANCE_TABLE = [1, 2, 3, 2, 5, 3, 3, 2, 3, 2] as const;

const s16 = (v: number): number => (v << 16) >> 16;
const s8 = (v: number): number => (v << 24) >> 24;

/**
 * F0x8001A25C measureTextWidth(self, enable): `andi a1,0xff`; enable 0 stores
 * a zero width and returns, otherwise the measure runs and its s16 result lands
 * in self+0xBC.
 */
export function measureTextWidth(mem: TextMeasureMemory, self: number, enable: number): number {
    if ((enable & 0xff) === 0) {
        mem.write16(self + MEASURE_WIDGET.width, 0);
        return 0;
    }
    const width = measureLine(
        mem,
        (self + MEASURE_WIDGET.line0) >>> 0,
        mem.read32(self + MEASURE_WIDGET.font) >>> 0,
        s16(mem.read16(self + MEASURE_WIDGET.fixedCell)),
    );
    mem.write16(self + MEASURE_WIDGET.width, width & 0xffff);
    // The original returns the measure slot's value in v0 (its caller stores
    // the same halfword in the j/jal delay slot).
    return width | 0;
}

/**
 * F0x8001F770 measure(line, font, fixedWidth): the loop. Returns
 * max(running width, widest page width); a null buffer or an s16 length <= 0
 * returns 0. `fixedWidth` is the s16 cell at widget+0xB4 (0 selects the glyph
 * metrics path).
 */
export function measureLine(
    mem: TextMeasureMemory,
    line: number,
    font: number,
    fixedWidth: number,
): number {
    if ((mem.read32(line) | 0) === 0) return 0;
    const fixed = s16(fixedWidth);
    const len = s16(mem.read16(line + MEASURE_LINE.length));
    let cursor = 0;
    let width = 0;
    let maxWidth = 0;
    if (len <= 0) return 0;
    const buf = mem.read32(line) >>> 0;
    const flag = s16(mem.read16(line + MEASURE_LINE.flag));
    // The advance counts live behind the pointer cell the original loads
    // (`lw v0,0x4(s8)` with s8 = D0x8004DE00); the cell holds D0x8004DDD4.
    const advanceBase = mem.read32(ADVANCE_TABLE_CELL) >>> 0;
    const glyphBase = mem.read32(font + 0x4) >>> 0;
    const extBase = mem.read32(font + 0x8) >>> 0;
    const extCount = s16(mem.read16(font + 0x16));
    for (;;) {
        const token = decodeTextToken(mem, (buf + cursor) >>> 0, flag & 0xff, font);
        const type = (token >>> 8) & 0xff;
        if (type === 4) {
            return width > maxWidth ? width : maxWidth; // F0x8001F9DC (exit)
        }
        if (type < 5) {
          if (type === 2) {
            const operand = mem.read8((buf + cursor + 1) >>> 0) & 0xff;
            if (operand === 1 || operand === 3) {
                if (maxWidth < width) maxWidth = width;
                width = 0;
            } else if (operand === 5) {
                const index = mem.read8((buf + cursor + 2) >>> 0) & 0xff;
                width += measureLine(mem, (line + index * 0xc) >>> 0, font, fixed);
            }
            cursor += (mem.read32((advanceBase + operand * 4) >>> 0) | 0);
          } else if (type === 0) {
            if (fixed !== 0) {
                width += fixed;
            } else {
                const glyph = (glyphBase + (((token & 0xffff) << 16 >> 16) * 0xb) - 0x2c) >>> 0;
                width += (mem.read8(glyph + 0x9) & 0xff) + s8(mem.read8(glyph + 0x7));
            }
            cursor += flag !== 0 ? 2 : 1;
          } else if (type === 1) {
            const code = token & 0xff;
            if (!(extCount < code) && !(code <= 0)) {
                if (fixed !== 0) {
                    width += fixed;
                } else {
                    const glyph = (extBase + code * 0xb - 0xb) >>> 0;
                    width += (mem.read8(glyph + 0x9) & 0xff) + s8(mem.read8(glyph + 0x7));
                }
            }
            cursor += 2;
          } else { // type 3: invalid, draws blank glyph 0
            if (fixed !== 0) {
                width += fixed;
            } else {
                width += (mem.read8(glyphBase + 0x9) & 0xff) + s8(mem.read8(glyphBase + 0x7));
            }
            cursor += flag !== 0 ? 2 : 1;
          }
        }
        // The original's shared loop check: a type >= 5 token reaches it with
        // no width and no cursor change (decode never produces one).
        if (!(cursor < len)) return width > maxWidth ? width : maxWidth;
    }
}
