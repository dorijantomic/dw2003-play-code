// The text widget's line-install routine, translated from F0x80019370.
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/text-widget-line-oracle.test.js runs the original through
// engine/native and compares the line-record fields and the copied string.
//
// DECODED: the accepted text-element-create researcher answer (U4) and
// exe-decomp/c/_asm/F0x80019370.s. Claims: UI-WIDGETCLASS-AE38-LINES-001
// (line record layout) and UI-WIDGETCLASS-AE38-SETLINE-001 (partially_verified).
//
// Line record i at self+0x5C+0xC*i:
//   +0x0  word     buffer pointer
//   +0x4  halfword capacity (bytes)
//   +0x6  halfword string length
//   +0xA  halfword flag (set to 1)
//
// Sequence (assembly order):
//   cString == 0 -> recurse with the default literal 0x800101A4, then the +0xAA
//                   gate.
//   L = strlen(cString); [record+0x6] = L.
//   L == 0 -> self+0xC1 = 0; RETURN (skips the +0xAA gate).
//   self+0xC1 = 1; [record+0xA] = 1.
//   if buffer != 0 and NOT (L < capacity): free(buffer), buffer = 0, capacity = 0.
//   if buffer == 0: cap = (L&3) ? (L&0xFFFC)+8 : L+4; capacity = cap;
//                   buffer = alloc(s16(cap), 2).
//   zeroFill(buffer, s16(capacity)); memcpy(buffer, cString, s16(L)).
//   if self+0xAA == 0: setTextScroll(self, 0).
//
// The allocation is the host boundary (D0x8004B5F4 -> blockingRetryAlloc ->
// allocFromFreeList, which engine/native host-serves as an arena). Free is the
// D0x8004B5EC hook, a no-op in the screen runtime.

import { memcpyBytes, strlenBytes } from "../byte-ops.ts";
import { intToDecimalAscii } from "./int-to-decimal.ts";
import { zeroFill } from "../zero-fill.ts";
import { setTextScroll } from "./text-element-setters.ts";

export interface WidgetLineMemory {
    read8(addr: number): number;
    read16(addr: number): number;
    read32(addr: number): number;
    write8(addr: number, value: number): void;
    write16(addr: number, value: number): void;
    write32(addr: number, value: number): void;
}

/** The two resident allocation hooks widgetSetLineString calls through. */
export interface WidgetLineHost {
    /** D0x8004B5F4(size, align): returns a buffer of at least `size` bytes. */
    alloc(size: number, align: number): number;
    /** D0x8004B5EC(ptr): releases a buffer (a no-op in the screen runtime). */
    free(ptr: number): void;
}

export const LINE_RECORD_BASE = 0x5c;
export const LINE_RECORD_STRIDE = 0x0c;
export const LINE_BUFFER = 0x00;
export const LINE_CAPACITY = 0x04;
export const LINE_LENGTH = 0x06;
export const LINE_FLAG = 0x0a;
export const WIDGET_FLAG_C1 = 0xc1;
export const WIDGET_SCROLL = 0xaa;
/** The literal the original substitutes for a NULL cString. */
export const DEFAULT_LINE_STRING = 0x800101a4;

/** F0x80019370(self, lineRecord, cString). */
export function widgetSetLineString(
    mem: WidgetLineMemory,
    host: WidgetLineHost,
    self: number,
    lineRec: number,
    cString: number,
): void {
    if (cString === 0) {
        widgetSetLineString(mem, host, self, lineRec, DEFAULT_LINE_STRING);
    } else {
        const len = strlenBytes(mem, cString);
        mem.write16(lineRec + LINE_LENGTH, len & 0xffff);
        if ((len & 0xffff) === 0) {
            // L low halfword == 0: mark empty and return past the +0xAA gate.
            mem.write8(self + WIDGET_FLAG_C1, 0);
            return;
        }
        mem.write8(self + WIDGET_FLAG_C1, 1);
        let buffer = mem.read32(lineRec + LINE_BUFFER) >>> 0;
        mem.write16(lineRec + LINE_FLAG, 1);
        if (buffer !== 0) {
            const capacity = (mem.read16(lineRec + LINE_CAPACITY) << 16) >> 16;
            const signedLen = (mem.read16(lineRec + LINE_LENGTH) << 16) >> 16;
            if (!(signedLen < capacity)) {
                host.free(buffer);
                mem.write32(lineRec + LINE_BUFFER, 0);
                mem.write16(lineRec + LINE_CAPACITY, 0);
                buffer = 0;
            }
        }
        if (buffer === 0) {
            const raw = mem.read16(lineRec + LINE_LENGTH) & 0xffff;
            const capacity = (raw & 3) !== 0 ? ((raw & 0xfffc) + 8) : raw + 4;
            mem.write16(lineRec + LINE_CAPACITY, capacity & 0xffff);
            buffer = host.alloc((capacity << 16) >> 16, 2) >>> 0;
            mem.write32(lineRec + LINE_BUFFER, buffer);
        }
        zeroFill(mem, buffer, (mem.read16(lineRec + LINE_CAPACITY) << 16) >> 16);
        memcpyBytes(mem, buffer, cString, (mem.read16(lineRec + LINE_LENGTH) << 16) >> 16);
    }
    if (((mem.read16(self + WIDGET_SCROLL) << 16) >> 16) === 0) {
        setTextScroll(mem, self, 0);
    }
}

/** F0x800194C4(self, cString): install cString on line 0. */
export function setWidgetString(
    mem: WidgetLineMemory,
    host: WidgetLineHost,
    self: number,
    cString: number,
): void {
    widgetSetLineString(mem, host, self, self + LINE_RECORD_BASE, cString);
}

/** The literal F0x800196E4/F0x800195B0 install for an out-of-range line. */
export const OUT_OF_RANGE_LINE_STRING = 0x800101c8;
/** ASCII digit 0x30 -> glyph 0x04. */
export const GLYPH_OFFSET = 0x2c;

/**
 * F0x800195B0(self, lineIndex, value): render `value` as decimal, convert the
 * ASCII digits to the game's glyph codes by subtracting 0x2C, install it on
 * `lineIndex`, then clear that line's +0xA flag. lineIndex >= 6 installs the
 * literal 0x800101C8 on line 0 instead. `scratch` is the caller's 16-byte
 * stack buffer (the original's sp+0x10).
 */
export function widgetSetLineNumber(
    mem: WidgetLineMemory,
    host: WidgetLineHost,
    self: number,
    lineIndex: number,
    value: number,
    scratch: number,
): void {
    const idx = lineIndex | 0;
    if ((idx >>> 0) >= 6) {
        setWidgetString(mem, host, self, OUT_OF_RANGE_LINE_STRING);
        return;
    }
    zeroFill(mem, scratch, 16);
    intToDecimalAscii(mem, scratch, value);
    let i = 0;
    while ((mem.read8(scratch + i) & 0xff) !== 0) {
        mem.write8(scratch + i, (mem.read8(scratch + i) - GLYPH_OFFSET) & 0xff);
        i += 1;
    }
    const lineRec = self + idx * LINE_RECORD_STRIDE + LINE_RECORD_BASE;
    widgetSetLineString(mem, host, self, lineRec, scratch);
    mem.write16(lineRec + LINE_FLAG, 0);
}

/** The literal F0x8001968C installs on line 0 for an out-of-range index. */
export const EXT_MESSAGE_LITERAL = 0x800101fc;

/**
 * F0x8001968C(self, cString, index) — slot +0x11C. An index in 1..5 installs
 * the caller's string on that line record through F0x80019370; any other index
 * installs the extension-message literal on line 0 through F0x800194C4.
 * (Callers reach it from the operand-5 handler and from the sequence tick.)
 */
export function setWidgetStringIndexed(
    mem: WidgetLineMemory,
    host: WidgetLineHost,
    self: number,
    cString: number,
    index: number,
): void {
    if (((index - 1) >>> 0) < 5) {
        const lineRec = (self + LINE_RECORD_BASE + index * LINE_RECORD_STRIDE) >>> 0;
        widgetSetLineString(mem, host, self, lineRec, cString);
        return;
    }
    setWidgetString(mem, host, self, EXT_MESSAGE_LITERAL);
}
