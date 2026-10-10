// The Card Folder screen's per-row fill, translated from the original
// pro/stcrddek body.
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/folder-list-row-oracle.test.js runs the original address
// F0x80088D24 through engine/native with the widget methods stubbed and
// compares the ordered call sequence (arguments included) for both paths.
//
// The body performs NO memory store: every write is a widget method call.
//   show (a3 != 0): label->0x114(label, 0x8004935C + row*0x66, -1), then for
//                   i = 0..5: w = widgets[row].cell[i];
//                   w->0x118(w, 0, screen[row].value[i]); w->0x148(w, 1).
//   hide (a3 == 0): label->0x144(label, 0); for i = 0..5: w->0x144(w, 0).
// The whole sequence is chosen by a3; inside a path the order is fixed.

export interface FolderListRowMemory {
    read32(addr: number): number;
}

export interface FolderListRowHost {
    /** label->0x114(label, resourceBase, line): set the folder-name text. */
    widgetSetResourceLine(widget: number, base: number, line: number): void;
    /** w->0x118(w, flag, value): set the counted value. */
    widgetSetNumber(widget: number, flag: number, value: number): void;
    /** w->0x148(w, on): show the widget. */
    widgetSetVisible(widget: number, on: number): void;
    /** w->0x144(w, flag): hide/reveal-flag the widget. */
    widgetHide(widget: number, flag: number): void;
}

/** Folder-name records: three 0x66-byte entries at 0x8004935C. */
export const FOLDER_RECORDS = 0x8004935c;
/** Distance between folder records. */
export const FOLDER_RECORD_STRIDE = 0x66;
/** Widget-array entry: label slot +0x08, six value widgets from +0x0C. */
export const FOLDER_ROW_STRIDE = 0x1c;
export const FOLDER_ROW_LABEL = 0x08;
export const FOLDER_ROW_VALUES = 0x0c;
/** Screen object: six values per row at +0x74, stride 0x18. */
export const FOLDER_SCREEN_ROW_STRIDE = 0x18;
export const FOLDER_SCREEN_VALUES = 0x74;
export const FOLDER_VALUE_COUNT = 6;

/** F0x80088D24(screen, widgets, row, show): fill or blank one folder row. */
export function folderListFillRow(
    mem: FolderListRowMemory,
    screen: number,
    widgets: number,
    row: number,
    show: number,
    host: FolderListRowHost,
): void {
    const label = mem.read32((widgets + row * FOLDER_ROW_STRIDE + FOLDER_ROW_LABEL) >>> 0) >>> 0;

    if (show !== 0) {
        host.widgetSetResourceLine(
            label,
            (FOLDER_RECORDS + row * FOLDER_RECORD_STRIDE) >>> 0,
            -1,
        );
        for (let i = 0; i < FOLDER_VALUE_COUNT; i++) {
            const widget = mem.read32((widgets + row * FOLDER_ROW_STRIDE + FOLDER_ROW_VALUES + i * 4) >>> 0) >>> 0;
            const value = mem.read32((screen + row * FOLDER_SCREEN_ROW_STRIDE + FOLDER_SCREEN_VALUES + i * 4) >>> 0) | 0;
            host.widgetSetNumber(widget, 0, value);
            host.widgetSetVisible(widget, 1);
        }
        return;
    }

    host.widgetHide(label, 0);
    for (let i = 0; i < FOLDER_VALUE_COUNT; i++) {
        const widget = mem.read32((widgets + row * FOLDER_ROW_STRIDE + FOLDER_ROW_VALUES + i * 4) >>> 0) >>> 0;
        host.widgetHide(widget, 0);
    }
}
