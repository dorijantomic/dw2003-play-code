// The text widget's line-metrics pass (method slot +0x14C), translated from
// the resident EXE.
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/text-line-metrics-oracle.test.js runs F0x8001A2AC through
// engine/native and compares memory.
//
// DECODED: F0x8001A2AC (fns.s L11196-) and its 5-entry jump table D0x80010274.
// It walks line 0's token buffer from byte 0 to the line length (self+0x62)
// and does one thing: it runs every `{8}` (operand 8, player-name) control
// through setWidgetStringIndexed(self, D0x80048D88, n) so line n holds the
// name, clears line n's flag halfword, and steps over the control. Every other
// token only advances the cursor (the same advance rule as the stepper). It
// stores nothing else and returns no value. The neighbour is
// measureTextWidth (0x8001A25C, text-measure.ts).
//
// Jump table, by the decoded token type (halfword >> 8): 0 and 3 and >=5 step
// 1 byte (2 when line 0's flag is set); 1 steps 2; 2 is the control arm above;
// 4 (end) returns. A control whose operand byte is 4 never advances in the
// original (an endless loop); the port stops there instead.

import { decodeTextToken, type TextDecodeMemory } from "./text-decode.ts";
import { ADVANCE_TABLE_CELL } from "./text-measure.ts";
import { TEXT_LITERAL_PLAYER_NAME } from "./text-window.ts";
import {
    LINE_RECORD_BASE,
    LINE_RECORD_STRIDE,
    setWidgetStringIndexed,
    type WidgetLineHost,
    type WidgetLineMemory,
} from "./text-widget-line.ts";

export type TextLineMetricsMemory = TextDecodeMemory & WidgetLineMemory;

const s16 = (v: number): number => (v << 16) >> 16;

/** Widget fields the pass reads: the font pointer; line 0's length is +0x62. */
export const LINE_METRICS_WIDGET = { font: 0x50, line0: LINE_RECORD_BASE, lineLength: 0x62 } as const;
/** The line record fields: buffer +0, flag +0xA. */
const LINE_FLAG = 0xa;
/** Offset of the flag halfword inside the widget for line n (`n*12 + 0x66`). */
const LINE_FLAG_BASE = 0x66;

/**
 * F0x8001A2AC textLineMetrics(self) — slot +0x14C. Host boundaries: none beyond
 * the allocator setWidgetStringIndexed already takes.
 */
export function textLineMetrics(
    mem: TextLineMetricsMemory,
    host: WidgetLineHost,
    self: number,
): void {
    const line = (self + LINE_METRICS_WIDGET.line0) >>> 0;
    if ((mem.read32(line) | 0) === 0) return;
    if (s16(mem.read16(self + LINE_METRICS_WIDGET.lineLength)) <= 0) return;
    let cursor = 0;
    // The buffer, flag and length are re-read every pass: operand 8 reinstalls a
    // line string, which for index 0 (or out of range) replaces line 0 itself.
    do {
        const buf = mem.read32(line) >>> 0;
        const flag = mem.read8(line + LINE_FLAG) & 0xff;
        const token = decodeTextToken(mem, (buf + cursor) >>> 0, flag, mem.read32(self + LINE_METRICS_WIDGET.font) >>> 0);
        const type = (token >>> 8) & 0xff;
        if (type === 4) return;
        if (type === 1) {
            cursor += 2;
        } else if (type === 2) {
            const operand = mem.read8((buf + cursor + 1) >>> 0) & 0xff;
            if (operand === 4) return; // original: no advance, endless loop
            const table = mem.read32(ADVANCE_TABLE_CELL) >>> 0;
            if (operand === 8) {
                const n = mem.read8((buf + cursor + 2) >>> 0) & 0xff;
                setWidgetStringIndexed(mem, host, self, TEXT_LITERAL_PLAYER_NAME, n);
                mem.write16((self + n * LINE_RECORD_STRIDE + LINE_FLAG_BASE) >>> 0, 0);
                cursor += mem.read32((table + 0x20) >>> 0) | 0;
            } else {
                cursor += mem.read32((table + operand * 4) >>> 0) | 0;
            }
        } else {
            cursor += s16(mem.read16(line + LINE_FLAG)) !== 0 ? 2 : 1;
        }
    } while (cursor < s16(mem.read16(self + LINE_METRICS_WIDGET.lineLength)));
}
