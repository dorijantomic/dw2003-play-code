// The battle-report row object's constructor, its widget builders and its five
// installed state methods, translated bit-exactly from the original pro/stfgtrep
// overlay bodies.
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/lane-b/fight-report-row.test.js runs the original through
// engine/native and compares the constructed object, the ordered
// createTextElement / widget-method calls, the row's widget array and the
// computed score.
//
//   F0x80084AEC  build a report row (factory F0x80014504 with handler 0x800848E4,
//                size 0x174 and a 0x30 extra block): the five state-method slots
//                at +0x160..+0x170, +0x54 = 0x1000, +0x58 = 6, +0x50 = parent
//                screen, +0x134 = -1 (halfword), +0x5C = row index, +0x60 =
//                score. Returns the object.
//   F0x80083260  build the row's eleven text widgets into the caller's array
//                (arg1): four header widgets, three rows of a label plus a value
//                widget, and a separator widget whose +0x160 is set to 2.
//   F0x80084B98  build the three level widgets (two labels and a separator).
//   F0x80084A08  state method: +0x10 = 1.
//   F0x80084A14  state method: +0x10 = 0xB.
//   F0x80084A20  state method: +0x10 = 0x14.
//   F0x80084A2C  compute the row's score once: if the row is fresh and the card
//                record's +0x3C8 or +0x3CA is 0x141, add score/5; mark the row
//                and return the score.
//   F0x80084AE0  state method: +0x68 = 1.
//
// The text-widget constructor (F0x8001AE38), the widget +0x160 method, the
// card-index / card-record services (0x80048D34 + 0x2718 / +0x2750) and the
// allocation are host boundaries; the port preserves the exact call order and
// arguments. This is lane B (engine/dw3/ui/native/**); lane A owns the shared
// engine/dw3/ui/index.ts barrel and data/translated_functions.json.

import { BASE_TABLE } from "../create-text-element.ts";

/** The report row's class handler installed at +0x48. */
export const REPORT_ROW_HANDLER = 0x800848e4;
export const REPORT_ROW_SIZE = 0x174;
export const REPORT_ROW_EXTRA = 0x30;

/** The five state-method addresses installed at +0x160..+0x170. */
export const REPORT_ROW_METHOD_08 = 0x80084a08;
export const REPORT_ROW_METHOD_14 = 0x80084a14;
export const REPORT_ROW_METHOD_20 = 0x80084a20;
export const REPORT_ROW_METHOD_2C = 0x80084a2c;
export const REPORT_ROW_METHOD_E0 = 0x80084ae0;

/** The resident card service table base and its index/record slots. */
export const REPORT_CARD_SERVICE = 0x80048d34;
export const REPORT_CARD_INDEX_SLOT = 0x2718;
export const REPORT_CARD_RECORD_SLOT = 0x2750;
/** The card record field that marks a report row for a bonus. */
export const REPORT_CARD_FIELD = 0x3c8;
export const REPORT_CARD_FIELD_ALT = 0x3ca;
export const REPORT_CARD_MATCH = 0x141;

export interface ReportRowMemory {
    read16(addr: number): number;
    read32(addr: number): number;
    write16(addr: number, value: number): void;
    write32(addr: number, value: number): void;
}

export interface ReportRowCreateHost {
    /** Allocate `size` zero-filled bytes, as the factory does. */
    alloc(size: number): number;
}

/** F0x80084AEC(screen, index, score): build a report row and return it. */
export function reportRowCreate(
    mem: ReportRowMemory,
    host: ReportRowCreateHost,
    screen: number,
    index: number,
    score: number,
): number {
    const obj = host.alloc(REPORT_ROW_SIZE) >>> 0;
    const extra = host.alloc(REPORT_ROW_EXTRA) >>> 0;
    mem.write32(obj + 0x24, extra);
    mem.write32(obj + 0x20, REPORT_ROW_EXTRA >> 2);
    for (const entry of BASE_TABLE) {
        const off = entry[0];
        mem.write32(obj + off, (off === 0x48 ? REPORT_ROW_HANDLER : entry[1]) >>> 0);
    }
    mem.write32(obj + 0x160, REPORT_ROW_METHOD_08);
    mem.write32(obj + 0x164, REPORT_ROW_METHOD_14);
    mem.write32(obj + 0x168, REPORT_ROW_METHOD_20);
    mem.write32(obj + 0x16c, REPORT_ROW_METHOD_2C);
    mem.write32(obj + 0x170, REPORT_ROW_METHOD_E0);
    mem.write32(obj + 0x54, 0x1000);
    mem.write32(obj + 0x58, 6);
    mem.write32(obj + 0x50, screen | 0);
    mem.write16(obj + 0x134, 0xffff);
    mem.write32(obj + 0x5c, index | 0);
    mem.write32(obj + 0x60, score | 0);
    return obj;
}

/** Widget-host methods both builders use. */
export interface ReportRowWidgetHost {
    /** F0x8001AE38(target, kind, x, y) -> widget pointer. */
    createTextElement(target: number, kind: number, x: number, y: number): number;
    /** widget+0x160(widget, 2) — set the separator's mode. */
    setWidget160(widget: number, value: number): void;
}

export const REPORT_ROW_FIELDS = {
    state: 0x10,
    target: 0x50,
    scale: 0x54,
    index: 0x5c,
    score: 0x60,
    computed: 0x64,
    flag68: 0x68,
    method160: 0x160,
} as const;

function s16(v: number): number {
    return (v << 16) >> 16;
}

/** F0x80083260(row, widgets): build the eleven report-row widgets. */
export function reportRowWidgetsCreate(
    mem: ReportRowMemory,
    row: number,
    widgets: number,
    host: ReportRowWidgetHost,
): void {
    const target = s16(mem.read16(row + REPORT_ROW_FIELDS.scale));
    const base = Math.imul(mem.read32(row + REPORT_ROW_FIELDS.index) | 0, 0x32);
    const y38 = s16(base + 0x38);
    const y45 = s16(base + 0x45);

    mem.write32(widgets + 0x00, host.createTextElement(target, 1, 0x3d, s16(base + 0x28)));
    mem.write32(widgets + 0x08, host.createTextElement(target, 3, 0x3e, y38));
    mem.write32(widgets + 0x04, host.createTextElement(target, 3, 0x5b, y38));
    mem.write32(widgets + 0x10, host.createTextElement(target, 3, 0x6a, y45));
    mem.write32(widgets + 0x0c, host.createTextElement(target, 3, 0x67, y45));

    for (let i = 0; i < 3; i++) {
        const y = base + Math.imul(i, 0xf);
        const slot = widgets + Math.imul(i, 8);
        mem.write32(slot + 0x14, host.createTextElement(target, 1, 0x8d, s16(y + 0x28)));
        mem.write32(slot + 0x18, host.createTextElement(target, 3, 0x114, s16(y + 0x2c)));
    }

    const separator = host.createTextElement(target, 1, 0x14, 0xc2);
    mem.write32(widgets + 0x2c, separator);
    host.setWidget160(separator, 2);
}

/** F0x80084B98(row, widgets): build the three level widgets. */
export function reportLevelWidgetsCreate(
    mem: ReportRowMemory,
    row: number,
    widgets: number,
    host: ReportRowWidgetHost,
): void {
    const target = s16(mem.read16(row + REPORT_ROW_FIELDS.target));
    mem.write32(widgets + 0x0, host.createTextElement(target, 3, 0x42, 0x17));
    mem.write32(widgets + 0x4, host.createTextElement(target, 3, 0x45, 0x17));
    const separator = host.createTextElement(target, 1, 0x14, 0xc2);
    mem.write32(widgets + 0x8, separator);
    host.setWidget160(separator, 2);
}

/** F0x80084A08(row): state method, +0x10 = 1. */
export function reportRowMethod08(mem: ReportRowMemory, row: number): number {
    mem.write32(row + REPORT_ROW_FIELDS.state, 1);
    return 1;
}

/** F0x80084A14(row): state method, +0x10 = 0xB. */
export function reportRowMethod14(mem: ReportRowMemory, row: number): number {
    mem.write32(row + REPORT_ROW_FIELDS.state, 0xb);
    return 0xb;
}

/** F0x80084A20(row): state method, +0x10 = 0x14. */
export function reportRowMethod20(mem: ReportRowMemory, row: number): number {
    mem.write32(row + REPORT_ROW_FIELDS.state, 0x14);
    return 0x14;
}

/** F0x80084AE0(row): state method, +0x68 = 1. */
export function reportRowMethodE0(mem: ReportRowMemory, row: number): number {
    mem.write32(row + REPORT_ROW_FIELDS.flag68, 1);
    return 1;
}

export interface ReportRowScoreHost {
    /** [0x80048D34]+0x2718(rowIndex) -> card index. */
    cardIndexOf(rowIndex: number): number;
    /** [0x80048D34]+0x2750(cardIndex) -> card record pointer. */
    cardRecord(cardIndex: number): number;
}

/**
 * F0x80084A2C(row): compute the score once. When the row is fresh and the card
 * record's +0x3C8 or +0x3CA equals 0x141, add score/5 (C truncation toward
 * zero), then mark the row computed and return the final score.
 */
export function reportRowComputeScore(
    mem: ReportRowMemory,
    row: number,
    host: ReportRowScoreHost,
): number {
    if ((mem.read32(row + REPORT_ROW_FIELDS.computed) | 0) === 0) {
        const cardIndex = host.cardIndexOf(mem.read32(row + REPORT_ROW_FIELDS.index) | 0);
        const record = host.cardRecord(cardIndex);
        const a = s16(mem.read16(record + REPORT_CARD_FIELD));
        const b = s16(mem.read16(record + REPORT_CARD_FIELD_ALT));
        if (a === REPORT_CARD_MATCH || b === REPORT_CARD_MATCH) {
            const score = mem.read32(row + REPORT_ROW_FIELDS.score) | 0;
            mem.write32(row + REPORT_ROW_FIELDS.score, (score + Math.trunc(score / 5)) | 0);
        }
    }
    mem.write32(row + REPORT_ROW_FIELDS.computed, 1);
    return mem.read32(row + REPORT_ROW_FIELDS.score) | 0;
}
