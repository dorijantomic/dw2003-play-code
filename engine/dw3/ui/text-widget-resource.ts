// The text widget's resource/string line setters, translated from the resident
// EXE F0x800194e8 (slot +0x114) and F0x800196e4 (slot +0x120).
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/text-widget-resource-oracle.test.js runs the original through
// engine/native (with the shared text-service block F0x8001fcc0 stubbed to
// install a deterministic lookup) and the port through an equivalent callback.
//
// DECODED: ledger UI-WIDGETCLASS-AE38-SETLINE-001 (partially_verified, read at
// authority 2 and corrected by UI-WIDGETCLASS-AE38-TEXTLAYOUT-CORRECTION-001)
// and exe-decomp/c/F0x800196e4.c / _asm/F0x800196e4.s.
//
//   F0x800196e4(self, source, index, line)
//     index >= 0 : fetch the shared text-service block (F0x8001fcc0) into a
//                  stack slot, call its slot +0 (F0x8001f744, a self-relative
//                  string/by-id lookup) with (source, index). If it returns 0
//                  the call is a no-op. Otherwise install the returned char
//                  pointer on `line`.
//     index <  0 : install `source` directly as a literal char pointer.
//     install    : widgetSetLineString(self, self + line*0xC + 0x5C, ptr),
//                  then clear the per-line halfword at self + line*0xC + 0x66.
//
//   F0x800194e8(self, source, index) is F0x800196e4 with line forced to 0.
//
// The shared text-service block (F0x8001fcc0 and slot +0) is the host boundary:
// the port delegates the string lookup to `host.stringById`, exactly the
// interface slot the original calls. widgetSetLineString is the already
// translated F0x80019370.

import {
    LINE_RECORD_BASE,
    LINE_RECORD_STRIDE,
    widgetSetLineString,
    type WidgetLineHost,
    type WidgetLineMemory,
} from "./text-widget-line.ts";

export interface TextWidgetResourceMemory extends WidgetLineMemory {}

export interface TextWidgetResourceHost extends WidgetLineHost {
    /**
     * The shared text-service block's slot +0 (F0x8001f744): look `index` up in
     * `source`'s self-relative directory and return a char pointer, or 0.
     */
    stringById(source: number, index: number): number;
}

/** The per-line flag word cleared after a successful install: +0x66 + 0xC*line. */
export const LINE_FLAG_WORD = 0x66;

function installLine(
    mem: TextWidgetResourceMemory,
    host: TextWidgetResourceHost,
    self: number,
    line: number,
    strPtr: number,
): void {
    widgetSetLineString(
        mem,
        host,
        self,
        self + line * LINE_RECORD_STRIDE + LINE_RECORD_BASE,
        strPtr,
    );
    mem.write16(self + line * LINE_RECORD_STRIDE + LINE_FLAG_WORD, 0);
}

/** F0x800196e4(self, source, index, line): slot +0x120. */
export function widgetSetLineFromSource(
    mem: TextWidgetResourceMemory,
    host: TextWidgetResourceHost,
    self: number,
    source: number,
    index: number,
    line: number,
): void {
    const lineIdx = line | 0;
    if ((index | 0) >= 0) {
        const strPtr = host.stringById(source >>> 0, index | 0) >>> 0;
        if (strPtr === 0) return;
        installLine(mem, host, self, lineIdx, strPtr);
        return;
    }
    installLine(mem, host, self, lineIdx, source >>> 0);
}

/** F0x800194e8(self, source, index): slot +0x114, line 0. */
export function widgetSetLine0FromSource(
    mem: TextWidgetResourceMemory,
    host: TextWidgetResourceHost,
    self: number,
    source: number,
    index: number,
): void {
    widgetSetLineFromSource(mem, host, self, source, index, 0);
}
