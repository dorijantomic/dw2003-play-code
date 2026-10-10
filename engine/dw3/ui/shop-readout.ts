// The item shop's list-label readout, translated from pro/stitshop F0x800875E0.
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/shop-readout-oracle.test.js runs the original through
// engine/native and the port on identical fixtures, comparing the widget
// memory and the recorded boundary calls.
//
// DECODED: exe-decomp/stitshop_c/F0x800875e0.c and _asm/F0x800875e0.s, read
// line for line; the accepted shop-stock-source answer (U5) naming it the label
// page/counter/arrow readout, not a price readout.
//
//   F0x800875E0(obj, widgets, visible)
//
//   visible != 0 ("populate"):
//     for i = 0 .. obj+0x6D4-1 (page rows, in order):
//       idx = page*pageSize + i
//       id  = mode==0 ? s16[(s32)obj+0x6B4 + 2*idx] : s16[obj+0x64 + 2*idx]
//       if idx < obj+0x6C0 and id != 0:
//         widget[i].+0x114(bank(obj,0x6A), id)          -> set line 0 from a
//                                                          resource string
//       else:
//         widget[i].+0x144(0)                            -> hide
//     widgets[+0x38].+0x118(0, page+1)  ; widgets[+0x38].+0x148(1)
//     widgets[+0x3C].+0x114(bank(obj,0x71), 0x18)
//     widgets[+0x40].+0x118(0, pageCount) ; widgets[+0x40].+0x148(1)
//     if pageCount >= 2:
//       if page != 0: widgets[+0x44].+0x114(bank(obj,0x71), 0x19)
//       else:         widgets[+0x44].+0x144(0)
//       if page < pageCount-1: widgets[+0x48].+0x114(bank(obj,0x71), 0x1A); return
//       else:                  widgets[+0x48].+0x144(0)
//     (pageCount < 2 -> no +0x44/+0x48 handling at all)
//   visible == 0 ("hide"):
//     widget[i].+0x144(0) for every page row, then +0x38, +0x3C, +0x40, +0x44,
//     and +0x48.
//
// `bank(obj, k)` is the original's `0x80044F4C([0x8005CCA8] + k)`: slot +0x114
// then looks the id up in the returned resource handle. `bankId` here is the
// already-added `[0x8005CCA8] + k` value.
//
// Reused translations: widgetSetLine0FromSource (F0x800194E8, slot +0x114),
// widgetSetLineNumber (F0x800195B0, slot +0x118) and setTextElementFlagC1
// (F0x8001A23C, slot +0x144). The 0x80044F4C resource service, the +0x148
// justification toggle (F0x8001A25C) and the 16-byte scratch its line-number
// setter needs are host boundaries.

import {
    widgetSetLineNumber,
} from "./text-widget-line.ts";
import {
    setTextElementFlagC1,
    type TextElementMemory,
} from "./text-element-setters.ts";
import {
    widgetSetLine0FromSource,
    type TextWidgetResourceMemory,
    type TextWidgetResourceHost,
} from "./text-widget-resource.ts";

export interface ShopReadoutMemory extends TextWidgetResourceMemory, TextElementMemory {}

export interface ShopReadoutHost extends TextWidgetResourceHost {
    /** The 0x80044F4C service: bankId -> a resource handle (string table). */
    resourceSource(bankId: number): number;
    /** Slot +0x148 (F0x8001A25C): the justification toggle. */
    measureTextWidth(widget: number, enable: number): void;
    /** A 16-byte scratch buffer for the translated line-number setter. */
    scratch(): number;
}

/** The [0x8005CCA8] resource-context cell the bank ids are added to. */
export const RESOURCE_CONTEXT = 0x8005cca8;
/** The item-name resource bank offset used for the list rows. */
export const BANK_ITEM_NAMES = 0x6a;
/** The label resource bank offset used for the page/arrow widgets. */
export const BANK_LABELS = 0x71;

/** List-object fields read by the readout. */
export const READOUT_OBJECT = {
    mode: 0x5c,
    inlineIds: 0x64,
    stockPointer: 0x6b4,
    listLength: 0x6c0,
    page: 0x6c4,
    pageCount: 0x6c8,
    pageSize: 0x6d4,
} as const;

/** Slot-array offsets of the fixed label widgets. */
export const READOUT_WIDGETS = {
    total: 0x38,
    label: 0x3c,
    count: 0x40,
    prev: 0x44,
    next: 0x48,
} as const;

/** Resource indices of the three fixed labels. */
export const LABEL_INDEX = 0x18;
export const PREV_INDEX = 0x19;
export const NEXT_INDEX = 0x1a;

/** F0x800875E0(obj, widgets, visible): fill or hide the list labels. */
export function shopReadout(
    mem: ShopReadoutMemory,
    obj: number,
    widgets: number,
    visible: number,
    host: ShopReadoutHost,
): void {
    const pageSize = mem.read32(obj + READOUT_OBJECT.pageSize) | 0;
    const page = mem.read32(obj + READOUT_OBJECT.page) | 0;
    const pageCount = mem.read32(obj + READOUT_OBJECT.pageCount) | 0;
    const mode = mem.read32(obj + READOUT_OBJECT.mode) | 0;
    const bankBase = mem.read32(RESOURCE_CONTEXT) | 0;

    if ((visible | 0) !== 0) {
        if (pageSize > 0) {
            const listLength = mem.read32(obj + READOUT_OBJECT.listLength) | 0;
            const stock = mem.read32(obj + READOUT_OBJECT.stockPointer) >>> 0;
            for (let i = 0; i < pageSize; i++) {
                const idx = (Math.imul(page, pageSize) + i) | 0;
                const id = mode === 0
                    ? mem.read16((stock + Math.imul(idx, 2)) >>> 0)
                    : mem.read16(obj + READOUT_OBJECT.inlineIds + Math.imul(idx, 2));
                const widget = mem.read32(widgets + Math.imul(i, 4)) >>> 0;
                if (idx < listLength && id !== 0) {
                    widgetSetLine0FromSource(
                        mem,
                        host,
                        widget,
                        host.resourceSource((bankBase + BANK_ITEM_NAMES) | 0),
                        id,
                    );
                } else {
                    setTextElementFlagC1(mem, widget, 0);
                }
            }
        }

        const totalWidget = mem.read32(widgets + READOUT_WIDGETS.total) >>> 0;
        widgetSetLineNumber(mem, host, totalWidget, 0, (page + 1) | 0, host.scratch());
        host.measureTextWidth(totalWidget, 1);

        const labelWidget = mem.read32(widgets + READOUT_WIDGETS.label) >>> 0;
        widgetSetLine0FromSource(
            mem,
            host,
            labelWidget,
            host.resourceSource((bankBase + BANK_LABELS) | 0),
            LABEL_INDEX,
        );

        const countWidget = mem.read32(widgets + READOUT_WIDGETS.count) >>> 0;
        widgetSetLineNumber(mem, host, countWidget, 0, pageCount, host.scratch());
        host.measureTextWidth(countWidget, 1);

        if (pageCount >= 2) {
            const prevWidget = mem.read32(widgets + READOUT_WIDGETS.prev) >>> 0;
            if (page !== 0) {
                widgetSetLine0FromSource(
                    mem,
                    host,
                    prevWidget,
                    host.resourceSource((bankBase + BANK_LABELS) | 0),
                    PREV_INDEX,
                );
            } else {
                setTextElementFlagC1(mem, prevWidget, 0);
            }
            const nextWidget = mem.read32(widgets + READOUT_WIDGETS.next) >>> 0;
            if (page < pageCount - 1) {
                widgetSetLine0FromSource(
                    mem,
                    host,
                    nextWidget,
                    host.resourceSource((bankBase + BANK_LABELS) | 0),
                    NEXT_INDEX,
                );
                return;
            }
            setTextElementFlagC1(mem, nextWidget, 0);
        }
        return;
    }

    if (pageSize > 0) {
        for (let i = 0; i < pageSize; i++) {
            setTextElementFlagC1(mem, mem.read32(widgets + Math.imul(i, 4)) >>> 0, 0);
        }
    }
    setTextElementFlagC1(mem, mem.read32(widgets + READOUT_WIDGETS.total) >>> 0, 0);
    setTextElementFlagC1(mem, mem.read32(widgets + READOUT_WIDGETS.label) >>> 0, 0);
    setTextElementFlagC1(mem, mem.read32(widgets + READOUT_WIDGETS.count) >>> 0, 0);
    setTextElementFlagC1(mem, mem.read32(widgets + READOUT_WIDGETS.prev) >>> 0, 0);
    setTextElementFlagC1(mem, mem.read32(widgets + READOUT_WIDGETS.next) >>> 0, 0);
}
