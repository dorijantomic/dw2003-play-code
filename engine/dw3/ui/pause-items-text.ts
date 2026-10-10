// The pause menu's item-screen text fills, translated from pro/ststatus
// F0x8008EF48 (bit-box fill) and F0x8008F000 (footer labels fill).
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/pause-items-text-oracle.test.js runs each original through
// engine/native with the widget method slots and the resident text resolver
// stubbed and compares the ordered call stream.
//
// DECODED: exe-decomp/ststatus_c/{F0x8008ef48,F0x8008f000}.c and their raw
// bodies in _asm/. Neither writes the block; each calls text widgets (arg1 is
// the widget block downstream of the screen object):
//
//   F0x8008EF48(block, flag): fill -> block+0xA0 set line 0 from
//     resolver(lang+0xB0) index 5; block+0x9C render [0x80048DA0] on line 0 and
//     measure. clear -> block+0xA0 flag 0, then block+0x9C flag 0.
//   F0x8008F000(block, flag): fill -> for i in 0..4, block+0xA4+4i set line 0
//     from resolver(lang+0xB0) index base+i, where
//     base = [ [0x8009AF6C] + 0xB4 ]. clear -> the five flags off.
//
// The widget methods (+0x114, +0x118, +0x144, +0x148) are host boundaries here;
// the setters themselves are already ported in text-widget-*.ts.

export interface PauseItemsTextMemory {
    read32(addr: number): number;
}

export interface PauseItemsTextHost {
    /** [0x80044B38+0x414] = F0x80013E5C(languageIndex + offset). */
    resolveText(offset: number): number;
    /** Widget +0x114 (F0x800194E8): install line 0 from a source/index. */
    widgetSetLine0(widget: number, source: number, index: number): void;
    /** Widget +0x118 (F0x800195B0): render a number on a line. */
    widgetSetLineNumber(widget: number, line: number, value: number): void;
    /** Widget +0x144 (F0x8001A23C): show/hide flag. */
    widgetSetFlagC1(widget: number, value: number): void;
    /** Widget +0x148 (F0x8001A25C): measure and store the width. */
    widgetMeasure(widget: number, value: number): void;
}

/** The shared item-count cell F0x8008EF48 renders. */
export const ITEM_COUNT_CELL = 0x80048da0;
/** The holder whose +0xB4 word is the footer label base index. */
export const FOOTER_LABEL_HOLDER = 0x8009af6c;

const w = (mem: PauseItemsTextMemory, block: number, slot: number): number => mem.read32(block + slot) >>> 0;

/** F0x8008EF48(block, flag): the item screen's bit-box line and count. */
export function pauseItemsBitBoxFill(
    mem: PauseItemsTextMemory,
    block: number,
    flag: number,
    host: PauseItemsTextHost,
): void {
    if (flag !== 0) {
        host.widgetSetLine0(w(mem, block, 0xa0), host.resolveText(0xb0), 5);
        host.widgetSetLineNumber(w(mem, block, 0x9c), 0, mem.read32(ITEM_COUNT_CELL) | 0);
        host.widgetMeasure(w(mem, block, 0x9c), 1);
        return;
    }
    host.widgetSetFlagC1(w(mem, block, 0xa0), 0);
    host.widgetSetFlagC1(w(mem, block, 0x9c), 0);
}

/** F0x8008F000(block, flag): the five footer labels. */
export function pauseItemsFooterLabelsFill(
    mem: PauseItemsTextMemory,
    block: number,
    flag: number,
    host: PauseItemsTextHost,
): void {
    let i = 0;
    if (flag !== 0) {
        const holder = mem.read32(FOOTER_LABEL_HOLDER) >>> 0;
        const base = mem.read32(holder + 0xb4) | 0;
        do {
            // The original re-resolves the bank inside the loop.
            host.widgetSetLine0(w(mem, block, 0xa4 + Math.imul(4, i)), host.resolveText(0xb0), base + i);
            i += 1;
        } while (i < 5);
        return;
    }
    do {
        host.widgetSetFlagC1(w(mem, block, 0xa4 + Math.imul(4, i)), 0);
        i += 1;
    } while (i < 5);
}
