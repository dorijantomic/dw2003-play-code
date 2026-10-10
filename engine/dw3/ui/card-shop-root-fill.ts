// The card shop root menu's two content fills, translated from pro/stcrdshp:
//   F0x80087E8C shop_root_fill_prompt — header, "BIT" label and BIT number
//   F0x80087FAC shop_root_fill_rows   — the three menu rows and the Back label
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/card-shop-root-fill-oracle.test.js runs both originals through
// engine/native on the shipped pro_stcrdshp.bin + resident.bin.
//
// DECODED: authority-2 closures `_asm/F0x80087e8c.s` and `_asm/F0x80087fac.s`
// and researcher B's accepted stcrdshp-remaining-contract. `screen+0x64` is the
// shop-name index; the widget array holds object pointers at fixed slots and the
// fills call the resident text-widget methods +0x114 (set string), +0x118 (set
// number), +0x144 (visibility) and +0x148. Both bank-getter spellings in the
// original read the same resident cell 0x80044F4C.

export interface CardShopFillMemory {
    read32(addr: number): number;
}

export interface CardShopFillHost {
    /** `[0x80044F4C](handle)`: the text-bank getter (both spellings). */
    bankGet(handle: number): number;
    /** An indirect widget method call: `obj+method(obj, a1, a2)`. */
    callWidgetMethod(obj: number, method: number, a1: number, a2: number): number;
}

export const SHOP_FILL = {
    header: 0x00,
    back: 0x04,
    bitLabel: 0x0c,
    bitNumber: 0x10,
    row0: 0x14,
} as const;
export const SHOP_FILL_ROWS = 3;
export const SHOP_PROMPT_BANK = 0x94;
export const SHOP_ROWS_BANK = 0x32;
export const SHOP_LANGUAGE_PTR = 0x8005cca8;
export const SHOP_BIT_PTR = 0x80048da0;
export const SHOP_HEADER_INDEX = 0x64;
/** The resident text-widget method offsets. */
export const WIDGET_SET_STRING = 0x114;
export const WIDGET_SET_NUMBER = 0x118;
export const WIDGET_VISIBILITY = 0x144;
export const WIDGET_MEASURE = 0x148;

/** F0x80087E8C(screen, widgets, show): header + "BIT" label + BIT number. */
export function shopRootFillPrompt(
    mem: CardShopFillMemory, screen: number, widgets: number, show: number, host: CardShopFillHost,
): void {
    if (show !== 0) {
        const header = host.bankGet((mem.read32(SHOP_LANGUAGE_PTR) + SHOP_PROMPT_BANK) | 0) >>> 0;
        host.callWidgetMethod(mem.read32(widgets + SHOP_FILL.header) >>> 0, WIDGET_SET_STRING,
            header, mem.read32(screen + SHOP_HEADER_INDEX) >>> 0);
        const label = host.bankGet((mem.read32(SHOP_LANGUAGE_PTR) + SHOP_ROWS_BANK) | 0) >>> 0;
        host.callWidgetMethod(mem.read32(widgets + SHOP_FILL.bitLabel) >>> 0, WIDGET_SET_STRING, label, 3);
        const bit = mem.read32(SHOP_BIT_PTR) >>> 0;
        const number = mem.read32(widgets + SHOP_FILL.bitNumber) >>> 0;
        host.callWidgetMethod(number, WIDGET_SET_NUMBER, 0, bit);
        // a2 is the leftover bit value from the number call.
        host.callWidgetMethod(number, WIDGET_MEASURE, 1, bit);
        return;
    }
    host.callWidgetMethod(mem.read32(widgets + SHOP_FILL.header) >>> 0, WIDGET_VISIBILITY, 0, 0);
    host.callWidgetMethod(mem.read32(widgets + SHOP_FILL.bitLabel) >>> 0, WIDGET_VISIBILITY, 0, 0);
    host.callWidgetMethod(mem.read32(widgets + SHOP_FILL.bitNumber) >>> 0, WIDGET_VISIBILITY, 0, 0);
}

/** F0x80087FAC(widgets, show): the three menu rows and the Back label. */
export function shopRootFillRows(
    mem: CardShopFillMemory, widgets: number, show: number, host: CardShopFillHost,
): void {
    if (show !== 0) {
        for (let i = 0; i < SHOP_FILL_ROWS; i++) {
            const bank = host.bankGet((mem.read32(SHOP_LANGUAGE_PTR) + SHOP_ROWS_BANK) | 0) >>> 0;
            host.callWidgetMethod(mem.read32(widgets + SHOP_FILL.row0 + i * 4) >>> 0,
                WIDGET_SET_STRING, bank, i + 5);
        }
        const back = host.bankGet((mem.read32(SHOP_LANGUAGE_PTR) + SHOP_ROWS_BANK) | 0) >>> 0;
        host.callWidgetMethod(mem.read32(widgets + SHOP_FILL.back) >>> 0, WIDGET_SET_STRING, back, 4);
        return;
    }
    for (let i = 0; i < SHOP_FILL_ROWS; i++) {
        host.callWidgetMethod(mem.read32(widgets + SHOP_FILL.row0 + i * 4) >>> 0, WIDGET_VISIBILITY, 0, 0);
    }
    host.callWidgetMethod(mem.read32(widgets + SHOP_FILL.back) >>> 0, WIDGET_VISIBILITY, 0, 0);
}
