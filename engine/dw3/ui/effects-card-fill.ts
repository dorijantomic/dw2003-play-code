// The shop's per-member Effects-card fill, translated from pro/stitshop
// F0x80089274.
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/effects-card-fill-oracle.test.js runs the original through
// engine/native with every service cell and widget method stubbed and compares
// the ordered call stream, the record fields and the restored equip-slot bytes.
//
// DECODED: exe-decomp/stitshop_c/F0x80089274.c and its raw body in _asm/, plus
// the accepted effects-card-fill answer U1/U5/U6 and the verified claims
// EQUIP-C016 (stat contributions) and EQUIP-C017 (slot selector). The routine:
//
//   1. entry = partyPositionToRosterSlot(member); record = band+0x64+0x80*member;
//      handle = persistentRosterSlot(entry).
//   2. Save the 12 equip-slot bytes at handle+0x3C0 (head/body/right/left/acc0/acc1).
//   3. Build the BEFORE block (effectsStatBlock(entry, record)).
//   4. slot = selectSlot(entry, itemId); record+0x58 = slot;
//      previewEquip(entry, slot, itemId, 0).
//   5. Build the AFTER block (effectsStatBlock(entry, record+0x2C)).
//   6. Restore the 12 equip-slot bytes; record+0x5C = 2.
//   7. Layout switch on the slot index:
//      0/2/3/other: rows (0,5) when the item class is 2..14 else (1,5),
//        record+0x60 = 1/2, record+0x64 = 6, skipA = 0/1, skipB = 5.
//      1 (body): rows (1,5), record+0x60 = 2, record+0x64 = 6, skipA = 1.
//      4/5 (accessory): row pair (5,5) on +0x30/+0x38, record+0x60 = 6; then
//        the stat-descriptor code at +0x8 picks row1: 1..5 -> row key code-1,
//        8..14 -> row key code-2, otherwise the status-ring arm hides +0x34/+0x3C
//        and sets the +0x28 label.
//      Every arm ends with effectsTrailingRows(band, block+i*0x2C+0x40) and the
//      two label line calls on +0x28/+0x2C.
//
// The selector, preview-equip, roster accessors, item-record getter and text
// resolver are host boundaries; the stat block, number, arrow and trailing-row
// helpers are the translated functions in effects-card-helpers.ts.

import {
    effectsCardArrow,
    effectsCardNumber,
    effectsStatBlock,
    effectsTrailingRows,
    type EffectsCardHost,
    type EffectsCardMemory,
    type EffectsStatBlockHost,
} from "./effects-card-helpers.ts";

export interface EffectsCardFillHost extends EffectsStatBlockHost, EffectsCardHost {
    /** [0x80048D34+0x2718](position): party position -> roster slot. */
    rosterSlot(position: number): number;
    /** [0x80048D34+0x2750](slot): the member's record base. */
    rosterHandle(slot: number): number;
    /** [0x8008D1AC+0x24](slot, itemId) = F0x8008C510 -> equip slot 0..5 or -1. */
    selectSlot(slot: number, itemId: number): number;
    /** [0x8008D1AC+0x28](slot, slotIndex, itemId, flag) = F0x8008C800. */
    previewEquip(slot: number, slotIndex: number, itemId: number, flag: number): void;
    /** [0x80044B38+0x414] = F0x80013E5C(languageIndex + offset). */
    resolveText(offset: number): number;
    /** Widget +0x114 (F0x800194E8): install line 0 from a source/index. */
    widgetSetLine0(widget: number, source: number, index: number): void;
    /** Widget +0x144 (F0x8001A23C): show/hide flag. */
    widgetSetFlagC1(widget: number, value: number): void;
}

/** Band/per-member record fields this routine writes. */
export const EFFECTS_FILL_FIELDS = {
    slotIndex: 0x58,
    rowCount: 0x5c,
    firstRowCount: 0x60,
    secondRowKey: 0x64,
} as const;
/** The saved equip-slot byte range inside the member handle. */
export const EQUIP_SLOT_SAVE = { offset: 0x3c0, size: 12 } as const;
/** Widget-block offsets used by the fill, relative to block + index*0x2C. */
export const EFFECTS_WIDGETS = {
    labelA: 0x28,
    labelB: 0x2c,
    rowA: 0x30,
    rowB: 0x34,
    rowC: 0x38,
    rowD: 0x3c,
    trailing: 0x40,
} as const;
const LABEL_INDEX = 0x0c;
const LABEL_BANK = 0x71;

/** F0x80089274(band, block, index, scratch): fill one member's Effects card. */
export function effectsCardFill(
    mem: EffectsCardMemory,
    band: number,
    block: number,
    index: number,
    host: EffectsCardFillHost,
    scratch: number,
): void {
    const i = index | 0;
    const entry = host.rosterSlot(i) | 0;
    const record = band + 0x64 + Math.imul(i, 0x80);
    const handle = host.rosterHandle(entry) >>> 0;
    const saved: number[] = [];
    for (let k = 0; k < EQUIP_SLOT_SAVE.size; k++) {
        saved.push(mem.read8(handle + EQUIP_SLOT_SAVE.offset + k));
    }
    effectsStatBlock(mem, entry, record, host);
    const itemId = mem.read32(band + 0x1e4) | 0;
    const slot = host.selectSlot(entry, itemId) | 0;
    mem.write32(record + EFFECTS_FILL_FIELDS.slotIndex, slot >>> 0);
    host.previewEquip(entry, slot, itemId, 0);
    effectsStatBlock(mem, entry, record + 0x2c, host);
    for (let k = 0; k < EQUIP_SLOT_SAVE.size; k++) {
        mem.write8(handle + EQUIP_SLOT_SAVE.offset + k, saved[k] as number);
    }
    mem.write32(record + EFFECTS_FILL_FIELDS.rowCount, 2);

    const w = block + Math.imul(i, 0x2c);
    const widget = (off: number): number => mem.read32(w + off) >>> 0;
    const state = (key: number, after: number, skipA: number, skipB: number): void => {
        mem.write32(scratch + 0x00, i >>> 0);
        mem.write32(scratch + 0x04, key >>> 0);
        mem.write32(scratch + 0x08, after >>> 0);
        mem.write32(scratch + 0x0c, skipA >>> 0);
        mem.write32(scratch + 0x10, skipB >>> 0);
    };
    const number = (widgetOffset: number): void =>
        effectsCardNumber(mem, band, widget(widgetOffset), scratch, host);
    const arrow = (widgetOffset: number): void =>
        effectsCardArrow(mem, band, widget(widgetOffset), scratch, host);
    const labels = (): void => {
        host.widgetSetLine0(widget(EFFECTS_WIDGETS.labelA), host.resolveText(LABEL_BANK), LABEL_INDEX);
        host.widgetSetLine0(widget(EFFECTS_WIDGETS.labelB), host.resolveText(LABEL_BANK), LABEL_INDEX);
    };

    if (slot === 1) {
        mem.write32(record + EFFECTS_FILL_FIELDS.firstRowCount, 2);
        state(1, 0, 0, 0); number(EFFECTS_WIDGETS.rowA); arrow(EFFECTS_WIDGETS.rowA);
        state(1, 1, 0, 0); number(EFFECTS_WIDGETS.rowC); arrow(EFFECTS_WIDGETS.rowC);
        mem.write32(record + EFFECTS_FILL_FIELDS.secondRowKey, 6);
        state(5, 0, 0, 0); number(EFFECTS_WIDGETS.rowB); arrow(EFFECTS_WIDGETS.rowB);
        state(5, 1, 0, 0); number(EFFECTS_WIDGETS.rowD); arrow(EFFECTS_WIDGETS.rowD);
        state(5, 1, 1, 5);
        effectsTrailingRows(mem, band, w + EFFECTS_WIDGETS.trailing, scratch, host);
        labels();
        return;
    }

    if (slot === 4 || slot === 5) {
        mem.write32(record + EFFECTS_FILL_FIELDS.firstRowCount, 6);
        state(5, 0, 0, 0); number(EFFECTS_WIDGETS.rowA); arrow(EFFECTS_WIDGETS.rowA);
        state(5, 1, 0, 0); number(EFFECTS_WIDGETS.rowC); arrow(EFFECTS_WIDGETS.rowC);
        const item = host.itemRecord(itemId) >>> 0;
        const stats = mem.read32(item + 0x0) >>> 0;
        const code = mem.read8(stats + 0x8) & 0xff;
        if (((code - 1) >>> 0) >= 5) {
            if (((code - 8) >>> 0) < 7) {
                mem.write32(record + EFFECTS_FILL_FIELDS.secondRowKey, (code - 1) >>> 0);
                accessoryRow1();
            } else {
                host.widgetSetFlagC1(widget(EFFECTS_WIDGETS.rowB), 0);
                host.widgetSetFlagC1(widget(EFFECTS_WIDGETS.rowD), 0);
                mem.write32(record + EFFECTS_FILL_FIELDS.secondRowKey, 0);
                host.widgetSetLine0(widget(EFFECTS_WIDGETS.labelA), host.resolveText(LABEL_BANK), LABEL_INDEX);
                host.widgetSetFlagC1(widget(EFFECTS_WIDGETS.labelB), 0);
                state(5, 1, 5, -1);
            }
        } else {
            mem.write32(record + EFFECTS_FILL_FIELDS.secondRowKey, code >>> 0);
            accessoryRow1();
        }
        effectsTrailingRows(mem, band, w + EFFECTS_WIDGETS.trailing, scratch, host);
        return;

        function accessoryRow1(): void {
            const key = (mem.read32(record + EFFECTS_FILL_FIELDS.secondRowKey) | 0) - 1;
            state(key, 0, 5, 0); number(EFFECTS_WIDGETS.rowB); arrow(EFFECTS_WIDGETS.rowB);
            state(key, 1, 5, 0); number(EFFECTS_WIDGETS.rowD); arrow(EFFECTS_WIDGETS.rowD);
            labels();
            state(key, 1, 5, key);
        }
    }

    // default: slot 0/2/3 (head, right, left) and every other value, including -1
    const item = host.itemRecord(itemId) >>> 0;
    const klass = mem.read8(item + 0x9) & 0xff;
    const wide = ((klass - 2) >>> 0) < 0xd;
    mem.write32(record + EFFECTS_FILL_FIELDS.firstRowCount, wide ? 1 : 2);
    const firstKey = wide ? 0 : 1;
    state(firstKey, 0, 0, 0); number(EFFECTS_WIDGETS.rowA); arrow(EFFECTS_WIDGETS.rowA);
    state(firstKey, 1, 0, 0); number(EFFECTS_WIDGETS.rowC); arrow(EFFECTS_WIDGETS.rowC);
    mem.write32(record + EFFECTS_FILL_FIELDS.secondRowKey, 6);
    state(5, 0, 0, 0); number(EFFECTS_WIDGETS.rowB); arrow(EFFECTS_WIDGETS.rowB);
    state(5, 1, 0, 0); number(EFFECTS_WIDGETS.rowD); arrow(EFFECTS_WIDGETS.rowD);
    state(5, 1, wide ? 0 : 1, 5);
    effectsTrailingRows(mem, band, w + EFFECTS_WIDGETS.trailing, scratch, host);
    labels();
}
