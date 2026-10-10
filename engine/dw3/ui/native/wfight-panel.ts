// The battle test harness's smaller number-editor panel, translated
// bit-exactly from the original pro/wfightts bodies.
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/lane-b/wfight-panel.test.js runs the original through
// engine/native and compares the ordered calls and memory.
//
//   F0x800A931C wfightPanelCreate  allocate the 0x100+0x70 panel, store the two
//                                  value pointers at +0xF8 / +0xFC.
//   F0x800A8D34 wfightPanelTick    the panel tick. State 0 / >=4 builds the two
//                                  rows: asks the editor service for each row's
//                                  category, fills the row's card list from the
//                                  shared list service (up to 19 entries, at most
//                                  14 shown) and creates one widget per shown
//                                  entry. State 1 reads the pad: shoulder-lock
//                                  (0x8000) makes a press step ten rows; 0x20
//                                  selects row 0, 0x80 selects row 1, 0x10 / 0x40
//                                  scroll the selected row's column, 0x2000
//                                  confirms the highlighted entry and 0x4000
//                                  cancels, then draws every widget (selected +
//                                  blink hides it, others show and take the
//                                  colour of their entry count). States 2/3 are
//                                  no-ops.
//
// The editor service ([0x8004B7BC]), its +0x190 category method, the category
// setter cell (0x800A4558+0x18), the list service ([0x80044F5C]), the widget
// factory (F0x8001AE38), the three pad reads (0x8004B7D0 + 0x3F4 / 0x3FC / 0x3F8),
// the frame counter (0x8004DE10 + 0x188) and every object method are host
// boundaries; the panel's own cells (0x800A96D0 selection, 0x800A96D8 selected
// row, 0x800A95E8 colour table) are read through memory exactly as the original
// does. This is lane B (engine/dw3/ui/native/**); lane A owns the shared
// engine/dw3/ui/index.ts barrel and data/translated_functions.json.

export const WFIGHT_PANEL_TICK = 0x800a8d34;
export const WFIGHT_PANEL_CREATE = 0x800a931c;
export const WFIGHT_PANEL_ROW_HANDLER = 0x800a8d34;
export const WFIGHT_PANEL_STATE = 0x800a4558;
export const WFIGHT_PANEL_SELECT = 0x800a96d0;
export const WFIGHT_PANEL_SELECTED_ROW = 0x800a96d8;
export const WFIGHT_PANEL_COLOURS = 0x800a95e8;
export const WFIGHT_PANEL_ROWS = 2;
export const WFIGHT_PANEL_ROW_STRIDE = 0x54;
export const WFIGHT_PANEL_LIST_LIMIT = 0x13;
export const WFIGHT_PANEL_SHOWN_LIMIT = 0xe;

export interface WfightMemory {
    read32(addr: number): number;
    write32(addr: number, value: number): void;
}

export interface WfightHost {
    /** F0x800143DC(handler, 0x100, 0x70, 0xFFFF): allocate the panel. */
    createPanel(handler: number, size: number, extra: number, tag: number): number;
    /** [0x8004B7BC](0x14, -1, -1): the shared editor service. */
    openService(a: number, b: number, c: number): number;
    /** service+0x190(service, row*0x10): the row's category. */
    serviceCategory(service: number, arg: number): number;
    /** [0x800A4558+0x18](category, entry): store the category setter call. */
    setEntryCategory(category: number, entry: number): void;
    /** [0x80044F5C](block): the shared list for a category block. */
    resolveList(block: number): number;
    /** F0x8001AE38(0x1005, 1, y, x): build one entry widget. */
    createWidget(kind: number, flag: number, y: number, x: number): number;
    /** [0x8004B7D0+0x3F4](0): pad read A. */
    padButtons3F4(which: number): number;
    /** [0x8004B7D0+0x3FC](0): pad read B. */
    padButtons3FC(which: number): number;
    /** [0x8004B7D0+0x3F8](0): pad read C. */
    padButtons3F8(which: number): number;
    /** [0x8004DE10+0x188](): the frame counter. */
    frameCounter(): number;
    /** target+slot(args): an object method. */
    callMethod(target: number, slot: number, args: number[]): void;
}

function s16(value: number): number {
    return (value << 16) >> 16;
}

/** F0x800A931C(arg0, arg1): allocate the panel and store its value pointers. */
export function wfightPanelCreate(
    mem: WfightMemory,
    arg0: number,
    arg1: number,
    host: WfightHost,
): number {
    const obj = host.createPanel(WFIGHT_PANEL_ROW_HANDLER, 0x100, 0x70, 0xffff);
    mem.write32(obj + 0xf8, arg0);
    mem.write32(obj + 0xfc, arg1);
    return obj;
}

/** F0x800A8D34(obj, arg1): the panel tick. */
export function wfightPanelTick(
    mem: WfightMemory,
    obj: number,
    arg1: number,
    host: WfightHost,
): void {
    const state = mem.read32(obj + 0x0c) | 0;
    if (state === 1) {
        wfightPanelUpdate(mem, obj, state, host);
        wfightPanelDraw(mem, obj, arg1, host);
        return;
    }
    if (state >= 2 && state < 4) return;
    wfightPanelInit(mem, obj, arg1, host);
}

function wfightPanelInit(
    mem: WfightMemory,
    obj: number,
    arg1: number,
    host: WfightHost,
): void {
    const service = host.openService(0x14, -1, -1);
    let y = 0xb4;
    for (let row = 0; row < WFIGHT_PANEL_ROWS; row++) {
        const category = host.serviceCategory(service, row * 0x10) | 0;
        const entry = WFIGHT_PANEL_SELECT + row * 4;
        if ((mem.read32(entry) | 0) !== category) {
            mem.write32(entry, category);
            mem.write32(entry + 0x0c, 0);
            mem.write32(entry + 0x14, 0);
        }
        host.setEntryCategory(category, entry);

        const block = mem.read32((mem.read32(WFIGHT_PANEL_STATE + 0x10) | 0) + 0x8) | 0;
        const rowBase = obj + 0x50 + row * WFIGHT_PANEL_ROW_STRIDE;
        if (block !== 0) {
            const list = host.resolveList(block) | 0;
            if ((mem.read32(list) | 0) === 0) {
                mem.write32(rowBase, 0);
                mem.write32(rowBase + 0x4c, 1);
                mem.write32(rowBase + 0x50, 1);
            } else {
                mem.write32(rowBase + 0x4c, 0);
                for (let i = 0; i < WFIGHT_PANEL_LIST_LIMIT; i++) {
                    if ((mem.read32(list + i * 4) | 0) !== 0) {
                        const count = mem.read32(rowBase + 0x4c) | 0;
                        mem.write32(rowBase + count * 4, (i + 1) | 0);
                        mem.write32(rowBase + 0x4c, (count + 1) | 0);
                    }
                }
                let shown = mem.read32(rowBase + 0x4c) | 0;
                if (shown >= 0xf) shown = WFIGHT_PANEL_SHOWN_LIMIT;
                mem.write32(rowBase + 0x50, shown);
            }
        } else {
            mem.write32(rowBase, 0);
            mem.write32(rowBase + 0x4c, 1);
            mem.write32(rowBase + 0x50, 1);
        }

        const shown = mem.read32(rowBase + 0x50) | 0;
        let x = 0x280000;
        for (let i = 0; i < shown; i++) {
            const widget = host.createWidget(0x1005, 1, s16(y), x >> 16);
            mem.write32(arg1 + row * 0x38 + i * 4, widget);
            x += 0xc0000;
        }
        y -= 0xa0;
    }
    host.callMethod(obj, 0x38, []);
}

function wfightPanelUpdate(
    mem: WfightMemory,
    obj: number,
    state: number,
    host: WfightHost,
): void {
    const buttons = (host.padButtons3F4(0) | 0) | (host.padButtons3FC(0) | 0);
    const step = ((host.padButtons3F8(0) | 0) & 0x8000) !== 0 ? 0xa : 1;
    const selectedCell = WFIGHT_PANEL_SELECTED_ROW;
    if (buttons & 0x20) {
        mem.write32(selectedCell, 0);
    } else if (buttons & 0x80) {
        mem.write32(selectedCell, state | 0);
    } else if (buttons & 0x10) {
        for (let k = 0; k < step; k++) {
            const entry = WFIGHT_PANEL_SELECT + (mem.read32(selectedCell) | 0) * 4;
            const current = mem.read32(entry + 0x0c) | 0;
            if (current !== 0) {
                mem.write32(entry + 0x0c, (current - 1) | 0);
            } else {
                const scroll = mem.read32(entry + 0x14) | 0;
                if (scroll !== 0) mem.write32(entry + 0x14, (scroll - 1) | 0);
            }
        }
    } else if (buttons & 0x40) {
        for (let k = 0; k < step; k++) {
            const row = mem.read32(selectedCell) | 0;
            const entry = WFIGHT_PANEL_SELECT + row * 4;
            const rowBase = obj + row * WFIGHT_PANEL_ROW_STRIDE;
            const count = mem.read32(rowBase + 0xa0) | 0;
            const current = mem.read32(entry + 0x0c) | 0;
            if (current !== count - 1) {
                mem.write32(entry + 0x0c, (current + 1) | 0);
            } else {
                const scroll = mem.read32(entry + 0x14) | 0;
                if (scroll !== ((mem.read32(rowBase + 0x9c) | 0) - count)) {
                    mem.write32(entry + 0x14, (scroll + 1) | 0);
                }
            }
        }
    } else if (buttons & 0x4000) {
        mem.write32(mem.read32(obj + 0xf8) | 0, -1);
        host.callMethod(obj, 0x28, [3]);
    } else if (buttons & 0x2000) {
        const row = mem.read32(selectedCell) | 0;
        const entry = WFIGHT_PANEL_SELECT + row * 4;
        const rowBase = obj + row * WFIGHT_PANEL_ROW_STRIDE;
        const sum = (mem.read32(entry + 0x0c) | 0) + (mem.read32(entry + 0x14) | 0);
        const cell = rowBase + sum * 4 + 0x50;
        if ((mem.read32(cell) | 0) !== 0) {
            mem.write32(mem.read32(obj + 0xf8) | 0, row);
            mem.write32(mem.read32(obj + 0xfc) | 0, (mem.read32(cell) | 0) - 1);
            host.callMethod(obj, 0x28, [3]);
        }
    }
}

function wfightPanelDraw(
    mem: WfightMemory,
    obj: number,
    arg1: number,
    host: WfightHost,
): void {
    for (let row = 0; row < WFIGHT_PANEL_ROWS; row++) {
        const rowBase = obj + row * WFIGHT_PANEL_ROW_STRIDE;
        const entry = WFIGHT_PANEL_SELECT + row * 4;
        const count = mem.read32(rowBase + 0xa0) | 0;
        for (let col = 0; col < count; col++) {
            const widget = mem.read32(arg1 + row * 0x38 + col * 4) | 0;
            const selected = (mem.read32(WFIGHT_PANEL_SELECTED_ROW) | 0) === row
                && (mem.read32(entry + 0x0c) | 0) === col;
            if (selected && ((host.frameCounter() | 0) & 8) !== 0) {
                host.callMethod(widget, 0x144, [0]);
            } else {
                host.callMethod(widget, 0x144, [1]);
                const colour = mem.read32(
                    WFIGHT_PANEL_COLOURS
                    + ((mem.read32(rowBase + (col + (mem.read32(entry + 0x14) | 0)) * 4 + 0x50) | 0) * 4),
                ) | 0;
                host.callMethod(widget, 0x110, [colour]);
            }
        }
    }
}
