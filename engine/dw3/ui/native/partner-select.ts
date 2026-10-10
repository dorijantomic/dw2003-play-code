// The partner-select screen's row builder and its state-machine tick,
// translated bit-exactly from the original pro/stdgname bodies.
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/lane-b/partner-select.test.js runs the original through
// engine/native and compares the ordered calls and fields.
//
//   F0x80085420 partnerRowBuild   create / refresh one character row: build the
//                                 row widget on request, attach the card record
//                                 (or the shared record helper) and set its
//                                 selection colour; remove it when create = 0.
//   F0x80085DE4 partnerSelectTick the partner-select object tick: on its own
//                                 state 1 it advances its sub-state machine
//                                 (enable the two banners, build the first rows,
//                                 build the next row as each becomes ready,
//                                 handle input, finish when all six are ready)
//                                 and always draws the grid; in any other state
//                                 it either does nothing (2/3) or initialises
//                                 (call the object's +0x38, blank the six row
//                                 slots and count the party cards).
//
// The jump table at 0x80082F58 (file offset 0x2A8) is on obj+0x10, 1..6:
//   0 -> 0x80085ED8  default (0 and >=7): enable rows 0/1, advance
//   1 -> 0x80085F10  enable rows 0/1 when both banners report ready, then +0x3C
//   2 -> 0x80085F78  build the next row when its slot is ready, advance the index
//   3 -> 0x80086090  advance when the +0xA0 widget reports ready
//   4 -> 0x8008601C  on input, advance and disable/clear all six rows
//   5 -> 0x80086090  same as 3
//   6 -> 0x800860C0  call +0x28(3) when all six rows report ready
// The widget enable / status functions live in the pointer cells at
// 0x80087F48 / 0x80087F4C; the row factory is F0x8001AE38, the card services are
// 0x80048D34 + 0x2718 (index) / +0x2750 (record) / +0x2728 (present), and the
// shared record helper is [0x80044F4C]([0x8005CCA8] + 0x40). All of those, the
// row/grid object methods and F0x8008559C (grid draw) / F0x80085B70 (input) are
// host boundaries; the port preserves the exact order and guards. This is lane B
// (engine/dw3/ui/native/**); lane A owns the shared engine/dw3/ui/index.ts barrel
// and data/translated_functions.json.

export const PARTNER_ROW_BUILD = 0x80085420;
export const PARTNER_GRID_DRAW = 0x8008559c;
export const PARTNER_SELECT_TICK = 0x80085de4;
export const PARTNER_ROW_TABLE = 0x80087d98;
export const PARTNER_SELECTION_CELL = 0x80087f38;
export const PARTNER_WIDGET_ENABLE_CELL = 0x80087f48;
export const PARTNER_WIDGET_STATUS_CELL = 0x80087f4c;
export const PARTNER_CARD_SERVICE = 0x80048d34;
export const PARTNER_CARD_INDEX_SLOT = 0x2718;
export const PARTNER_CARD_RECORD_SLOT = 0x2750;
export const PARTNER_CARD_PRESENT_SLOT = 0x2728;
export const PARTNER_RECORD_BASE = 0x8005cca8;
export const PARTNER_RECORD_HELPER = 0x80044f4c;
/** The six row slot pointers start at arg1+0 and stride 4. */
export const PARTNER_ROW_SLOTS = 6;
/**
 * The one sub-state that reads the pad: table slot 4 -> F0x8008601C, which is
 * the only branch of the tick that calls F0x80085B70 (the input handler).
 * Sub-states 0..3 and 5..6 poll widget-ready flags and advance a step a frame
 * at a time, so a button pressed before this one is never seen. Decoded from
 * `~/ddw3/asm/dw2003/pro/stdgname.s` labels .L0x0000336c (slot 4) and the
 * seven-word jump table at 0x80082F58 (file offset 0x2A8).
 */
export const PARTNER_SELECT_INPUT_SUB = 4;

export interface PartnerMemory {
    read32(addr: number): number;
    write32(addr: number, value: number): void;
}

export interface PartnerHost {
    /** F0x8001AE38(scale, 1, table+4, table+8): build one row widget. */
    createRowObject(scale: number, kind: number, tableLo: number, tableHi: number): number;
    /** [0x80044F4C]([0x8005CCA8] + 0x40): the shared record helper. */
    recordHelper(arg: number): number;
    /** [0x80048D34+0x2718](cardId): the card slot index. */
    cardIndexOf(cardId: number): number;
    /** [0x80048D34+0x2750](index): the card record. */
    cardRecord(index: number): number;
    /** [0x80048D34+0x2728](index): >= 0 when a party card occupies the slot. */
    cardPresent(index: number): number;
    /** [0x80087F48](widget, flag): enable / disable a row widget. */
    setWidgetFlag(widget: number, flag: number): void;
    /** [0x80087F4C](widget): nonzero while the widget is ready. */
    widgetStatus(widget: number): number;
    /** target+slot(args): an object method. */
    callMethod(target: number, slot: number, args: number[]): void;
    /** F0x8008559C(obj, arg1): the grid draw. */
    gridDraw(obj: number, arg1: number): void;
    /** F0x80085B70(obj, arg1): the input handler. */
    inputHandler(obj: number, arg1: number): number;
}

function s16(value: number): number {
    return (value << 16) >> 16;
}

/** F0x80085420(obj, arg1, arg2, arg3): build, fill or remove one character row. */
export function partnerRowBuild(
    mem: PartnerMemory,
    obj: number,
    arg1: number,
    arg2: number,
    arg3: number,
    host: PartnerHost,
): void {
    let scale = 0;
    if ((arg2 | 0) < 5) scale = mem.read32(obj + 0x54) | 0;
    if ((arg3 | 0) !== 0) {
        if ((mem.read32(arg1) | 0) === 0) {
            const entry = PARTNER_ROW_TABLE + (arg2 | 0) * 0xc;
            const row = host.createRowObject(s16(scale), 1, s16(mem.read32(entry + 4)), s16(mem.read32(entry + 8)));
            mem.write32(arg1, row);
            host.callMethod(row, 0x15c, [1]);
        }
        if (((arg2 - 2) >>> 0) < 3) {
            const record = host.cardRecord(host.cardIndexOf(arg2 - 2));
            mem.write32((mem.read32(arg1) | 0) + 0x50, mem.read32(PARTNER_SELECTION_CELL) | 0);
            host.callMethod(mem.read32(arg1) | 0, 0x114, [record, -1]);
        } else {
            const entry = PARTNER_ROW_TABLE + (arg2 | 0) * 0xc;
            const other = host.recordHelper((mem.read32(PARTNER_RECORD_BASE) + 0x40) | 0);
            host.callMethod(mem.read32(arg1) | 0, 0x114, [other, mem.read32(entry) | 0]);
        }
        host.callMethod(mem.read32(arg1) | 0, 0x138, [0]);
        return;
    }
    const row = mem.read32(arg1) | 0;
    if (row !== 0) host.callMethod(row, 0x144, [0]);
}

/** F0x80085DE4(obj, arg1): the partner-select object tick. */
export function partnerSelectTick(
    mem: PartnerMemory,
    obj: number,
    arg1: number,
    host: PartnerHost,
): void {
    const state = mem.read32(obj + 0x0c) | 0;
    if (state === 1) {
        const sub = mem.read32(obj + 0x10) | 0;
        switch (sub) {
            case 1:
                if ((host.widgetStatus(obj + 0x80) | 0) + (host.widgetStatus(obj + 0x90) | 0) === 2) {
                    partnerRowBuild(mem, obj, arg1, 0, 1, host);
                    partnerRowBuild(mem, obj, arg1 + 4, 1, 1, host);
                    host.setWidgetFlag(obj + 0xb0, 1);
                    host.callMethod(obj, 0x3c, []);
                }
                break;
            case 2: {
                const index = mem.read32(obj + 0x14) | 0;
                if ((host.widgetStatus(obj + index * 0x10 + 0xb0) | 0) !== 0) {
                    partnerRowBuild(mem, obj, arg1 + index * 4 + 8, index + 2, 1, host);
                    const current = mem.read32(obj + 0x14) | 0;
                    if (current < ((mem.read32(obj + 0x78) | 0) - 1)) {
                        mem.write32(obj + 0x14, (current + 1) | 0);
                        host.setWidgetFlag(obj + (current + 1) * 0x10 + 0xb0, 1);
                    } else {
                        host.setWidgetFlag(obj + 0xa0, 1);
                        host.callMethod(obj, 0x3c, []);
                    }
                }
                break;
            }
            case 3:
            case 5:
                if ((host.widgetStatus(obj + 0xa0) | 0) !== 0) mem.write32(obj + 0x10, (sub + 1) | 0);
                break;
            case 4:
                if ((host.inputHandler(obj, arg1) | 0) !== 0) {
                    mem.write32(obj + 0x10, (sub + 1) | 0);
                    for (let i = 0; i < PARTNER_ROW_SLOTS; i++) {
                        host.setWidgetFlag(obj + 0x80 + i * 0x10, 0);
                        partnerRowBuild(mem, obj, arg1 + i * 4, i, 0, host);
                    }
                }
                break;
            case 6: {
                let ready = 0;
                for (let i = 0; i < PARTNER_ROW_SLOTS; i++) ready += host.widgetStatus(obj + 0x80 + i * 0x10) | 0;
                if (ready === PARTNER_ROW_SLOTS) host.callMethod(obj, 0x28, [3]);
                break;
            }
            default:
                host.setWidgetFlag(obj + 0x80, 1);
                host.setWidgetFlag(obj + 0x90, 1);
                mem.write32(obj + 0x10, (sub + 1) | 0);
                break;
        }
        host.gridDraw(obj, arg1);
        return;
    }
    if (state >= 2 && state < 4) return;
    host.callMethod(obj, 0x38, []);
    for (let i = 0; i < PARTNER_ROW_SLOTS; i++) mem.write32(obj + 0x80 + i * 0x10, 0xa);
    for (let i = 0; i < 3; i++) {
        if ((host.cardPresent(i) | 0) >= 0) mem.write32(obj + 0x78, (mem.read32(obj + 0x78) + 1) | 0);
    }
}
