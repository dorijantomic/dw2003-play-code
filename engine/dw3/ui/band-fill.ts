// The item-shop info band's three text fills, translated from pro/stitshop
// F0x80089E2C (name/price row), F0x8008A0D0 (description row) and F0x8008A1FC
// (per-member Effects cards).
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/band-fill-oracle.test.js runs each original through
// engine/native with the widget method slots and every resident boundary stubbed
// and compares the ordered call stream.
//
// DECODED: exe-decomp/stitshop_c/{F0x80089e2c,F0x8008a0d0,F0x8008a1fc}.c and
// the accepted band-fill-family answer U1-U3. None of the three writes the band
// or the block directly; each is a sequence of widget-method calls. The widget
// methods (+0x114 set line 0, +0x118 set line number, +0x138 set_unk_0xc0,
// +0x144 set flag C1, +0x148 measure) are host boundaries here; the setters
// themselves are already ported in text-widget-*.ts.
//
// Slot map (block-relative): +0x00 name, +0x04 "Equip" label, +0x08 Equip
// count, +0x0C "Items" label, +0x10 Items count, +0x14 price label, +0x18
// price total, +0x1C description, +0x20 class string. Per-member Effects
// records start at +0x24 with stride 0x2C (card +0x00, two widgets +0x04/+0x08,
// eight widgets +0x0C..+0x28).

import { PARTY_CONTEXT } from "../party-context.ts";

export interface BandFillMemory {
    read8(addr: number): number;
    read8s(addr: number): number;
    read16(addr: number): number;
    read32(addr: number): number;
}

export interface BandFillHost {
    /** [0x80044B38+0x414] = F0x80013E5C(languageIndex + offset). */
    resolveText(offset: number): number;
    /** [0x80042B98](itemId) -> the item record pointer. */
    itemRecord(itemId: number): number;
    /** [0x80048D34+0x2718](position) = F0x80016D94 -> roster slot. */
    rosterSlot(position: number): number;
    /** [0x80048D34+0x2750](slot) = F0x80017B4C -> the member's record base. */
    rosterHandle(slot: number): number;
    /** [0x8008D1AC+0x20](slot, itemId) = F0x8008C4CC can-equip. */
    canEquip(slot: number, itemId: number): number;
    /** F0x80089274(band, block, memberIndex): fill one member's card. */
    call89274(band: number, block: number, index: number): void;
    /** Widget +0x114 (F0x800194E8): install line 0 from a source/index. */
    widgetSetLine0(widget: number, source: number, index: number): void;
    /** Widget +0x118 (F0x800195B0): render a number on a line. */
    widgetSetLineNumber(widget: number, line: number, value: number): void;
    /** Widget +0x138 (F0x8001A1F4): set_unk_0xc0. */
    widgetSetC0(widget: number, value: number): void;
    /** Widget +0x144 (F0x8001A23C): show/hide flag. */
    widgetSetFlagC1(widget: number, value: number): void;
    /** Widget +0x148 (F0x8001A25C): measure and store the width. */
    widgetMeasure(widget: number, value: number): void;
}

/** Band-object fields the fills read. */
export const BAND_FILL_FIELDS = {
    mode: 0x58,
    memberCount: 0x60,
    itemId: 0x1e4,
    quantity: 0x1e8,
} as const;
/** Item-use byte offsets from PARTY_CONTEXT + itemId (signed). */
export const PARTY_BYTE_EQUIP = 0x20f;
export const PARTY_BYTE_ITEMS = 0x7c;
/** Word table indexed by the item descriptor's byte +2 (word table). */
export const CLASS_STRING_TABLE = 0x8008cb1c;

const w = (mem: BandFillMemory, block: number, slot: number): number => mem.read32(block + slot) >>> 0;

/** F0x80089E2C(band, block, flag): fill/clear the name, counts and price. */
export function bandFillNamePrice(
    mem: BandFillMemory,
    band: number,
    block: number,
    flag: number,
    host: BandFillHost,
): void {
    if (flag !== 0) {
        const itemId = mem.read32(band + BAND_FILL_FIELDS.itemId) | 0;
        const quantity = mem.read32(band + BAND_FILL_FIELDS.quantity) | 0;
        const mode = mem.read32(band + BAND_FILL_FIELDS.mode) | 0;
        host.widgetSetLine0(w(mem, block, 0x00), host.resolveText(0x6a), itemId);
        host.widgetSetLine0(w(mem, block, 0x04), host.resolveText(0x71), 6);
        host.widgetSetLineNumber(w(mem, block, 0x08), 0, mem.read8s(PARTY_CONTEXT + itemId + PARTY_BYTE_EQUIP));
        host.widgetMeasure(w(mem, block, 0x08), 1);
        host.widgetSetLine0(w(mem, block, 0x0c), host.resolveText(0x71), 7);
        host.widgetSetLineNumber(w(mem, block, 0x10), 0, mem.read8s(PARTY_CONTEXT + itemId + PARTY_BYTE_ITEMS));
        host.widgetMeasure(w(mem, block, 0x10), 1);
        host.widgetSetLine0(w(mem, block, 0x14), host.resolveText(0x71), 2);
        const record = host.itemRecord(itemId) >>> 0;
        const price = mode === 0 ? mem.read16(record + 0x4) : mem.read16(record + 0x6);
        host.widgetSetLineNumber(w(mem, block, 0x18), 0, Math.imul(price, quantity));
        host.widgetMeasure(w(mem, block, 0x18), 1);
        return;
    }
    host.widgetSetFlagC1(w(mem, block, 0x00), 0);
    host.widgetSetFlagC1(w(mem, block, 0x04), 0);
    host.widgetSetFlagC1(w(mem, block, 0x08), 0);
    host.widgetSetFlagC1(w(mem, block, 0x0c), 0);
    host.widgetSetFlagC1(w(mem, block, 0x10), 0);
    host.widgetSetFlagC1(w(mem, block, 0x14), 0);
    host.widgetSetFlagC1(w(mem, block, 0x18), 0);
}

/** F0x8008A0D0(band, block, flag): fill/clear the description and class string. */
export function bandFillDescription(
    mem: BandFillMemory,
    band: number,
    block: number,
    flag: number,
    host: BandFillHost,
): void {
    if (flag !== 0) {
        const itemId = mem.read32(band + BAND_FILL_FIELDS.itemId) | 0;
        host.widgetSetLine0(w(mem, block, 0x1c), host.resolveText(0x63), itemId);
        const record = host.itemRecord(itemId) >>> 0;
        const klass = mem.read8(record + 0x9) & 0xff;
        if (((klass - 2) >>> 0) < 0xc) {
            const desc = mem.read32(record + 0x0) >>> 0;
            const index = mem.read8(desc + 0x2) & 0xff;
            const icon = mem.read32(CLASS_STRING_TABLE + Math.imul(index, 4)) | 0;
            host.widgetSetLine0(w(mem, block, 0x20), host.resolveText(0x71), icon);
            return;
        }
        host.widgetSetFlagC1(w(mem, block, 0x20), 0);
        return;
    }
    host.widgetSetFlagC1(w(mem, block, 0x1c), 0);
    host.widgetSetFlagC1(w(mem, block, 0x20), 0);
}

/** F0x8008A1FC(band, block, flag): fill/clear the per-member Effects cards. */
export function bandFillEffectsCards(
    mem: BandFillMemory,
    band: number,
    block: number,
    flag: number,
    host: BandFillHost,
): void {
    const count = mem.read32(band + BAND_FILL_FIELDS.memberCount) | 0;
    if (count <= 0) return;
    let i = 0;
    if (flag !== 0) {
        do {
            const base = block + Math.imul(i, 0x2c) + 0x24;
            const card = mem.read32(base) >>> 0;
            const slot = host.rosterSlot(i) | 0;
            host.widgetSetLine0(card, host.rosterHandle(slot), -1);
            if ((host.canEquip(slot, mem.read32(band + BAND_FILL_FIELDS.itemId) | 0) | 0) !== 0) {
                host.call89274(band, block, i);
                host.widgetSetC0(card, 0);
            } else {
                host.widgetSetC0(card, 7);
                for (let j = 0; j < 2; j++) {
                    host.widgetSetFlagC1(mem.read32(base + 0x04 + Math.imul(4, j)) >>> 0, 0);
                }
                for (let j = 0; j < 8; j++) {
                    host.widgetSetFlagC1(mem.read32(base + 0x0c + Math.imul(4, j)) >>> 0, 0);
                }
            }
            i += 1;
        } while (i < (mem.read32(band + BAND_FILL_FIELDS.memberCount) | 0));
        return;
    }
    do {
        const base = block + Math.imul(i, 0x2c) + 0x24;
        host.widgetSetFlagC1(mem.read32(base) >>> 0, 0);
        for (let j = 0; j < 2; j++) {
            host.widgetSetFlagC1(mem.read32(base + 0x04 + Math.imul(4, j)) >>> 0, 0);
        }
        for (let j = 0; j < 8; j++) {
            host.widgetSetFlagC1(mem.read32(base + 0x0c + Math.imul(4, j)) >>> 0, 0);
        }
        i += 1;
    } while (i < (mem.read32(band + BAND_FILL_FIELDS.memberCount) | 0));
}
