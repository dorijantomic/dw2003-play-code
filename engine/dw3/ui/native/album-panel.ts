// The card album's panel labels, translated bit-exactly from the original
// pro/stcrdabm overlay bodies.
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/lane-b/album-panel.test.js runs the original through
// engine/native and compares the created widget list, the ordered widget-method
// calls and the panel fields.
//
// F0x80083BFC builds the album panel's seventeen label widgets into the
// caller's array `slots` (arg1) through F0x8001AE38(target, 1, x, y), then walks
// the panel's own slot list (arg0+0x24, count arg0+0x20) and calls each
// widget's +0x15C with (arg0+0x54 - 3). The seventeen coordinates are fixed:
//
//   (0x10,0x19) (0xD0,0x19) (0x34,0x9E) (0x35,0x9E) (0x4A,0x9E)
//   (0x12,0x6C) (0x121,0x6C) (0x88,0xA1) (0x115,0xA1) (0x126,0xA1)
//   (0x115,0xC7) (0x12C,0xC7) (0x50,0xB8) (0xCE,0xB8) (0xF0,0xB8)
//   (0xCE,0xC5) (0xF0,0xC5)
//
// F0x80083E14 fills those labels for a shown panel (arg2 != 0) or clears them
// (arg2 == 0). Shown, it sets the page/heading/count text through each widget's
// +0x114 (resource line) and +0x118 (number line) slots and toggles +0x144 /
// +0x148, reading the last two only while arg0+0x68 is set. The text resource
// getter [0x80044F4C] and every widget method are host boundaries; the port
// preserves the exact call order and arguments.
//
// This is lane B (engine/dw3/ui/native/**); lane A owns the shared
// engine/dw3/ui/index.ts barrel and data/translated_functions.json.

export interface AlbumPanelMemory {
    read16(addr: number): number;
    read32(addr: number): number;
    write32(addr: number, value: number): void;
}

export interface AlbumPanelHost {
    /** F0x8001AE38(target, kind, x, y) -> widget pointer. */
    createTextElement(target: number, kind: number, x: number, y: number): number;
    /** widget+0x15C(widget, value). */
    setWidgetUnk15C(widget: number, value: number): void;
    /** widget+0x114(widget, source, index) — the resource line setter. */
    setWidgetLine0(widget: number, source: number, index: number): void;
    /** widget+0x118(widget, 0, value) — the number line setter. */
    setWidgetLineNumber(widget: number, lineIndex: number, value: number): void;
    /** widget+0x144(widget, value). */
    setWidgetFlag144(widget: number, value: number): void;
    /** widget+0x148(widget, value). */
    setWidgetFlag148(widget: number, value: number): void;
    /** [0x80044F4C](id) — the resident text resource getter. */
    resourceGet(id: number): number;
}

/** The save/global block whose +0x24 the headings' resource id comes from. */
export const ALBUM_SAVE_PTR = 0x8005cca8;

export const ALBUM_PANEL_FIELDS = {
    target: 0x50,
    slotCount: 0x20,
    slotList: 0x24,
    scale: 0x54,
    headingIndex: 0x60,
    pageCount: 0x64,
    showExtra: 0x68,
} as const;

/** The seventeen fixed label coordinates, in creation order. */
export const ALBUM_PANEL_LABELS: ReadonlyArray<readonly [number, number]> = [
    [0x10, 0x19], [0xd0, 0x19], [0x34, 0x9e], [0x35, 0x9e], [0x4a, 0x9e],
    [0x12, 0x6c], [0x121, 0x6c], [0x88, 0xa1], [0x115, 0xa1], [0x126, 0xa1],
    [0x115, 0xc7], [0x12c, 0xc7], [0x50, 0xb8], [0xce, 0xb8], [0xf0, 0xb8],
    [0xce, 0xc5], [0xf0, 0xc5],
];

function s16(v: number): number {
    return (v << 16) >> 16;
}

/** F0x80083BFC(panel, slots): create the panel's seventeen labels. */
export function albumPanelCreateLabels(
    mem: AlbumPanelMemory,
    panel: number,
    slots: number,
    host: AlbumPanelHost,
): void {
    const target = s16(mem.read16(panel + ALBUM_PANEL_FIELDS.target));
    for (let i = 0; i < ALBUM_PANEL_LABELS.length; i++) {
        const label = ALBUM_PANEL_LABELS[i] as readonly [number, number];
        mem.write32(slots + i * 4, host.createTextElement(target, 1, label[0], label[1]));
    }

    const bound = (mem.read32(panel + ALBUM_PANEL_FIELDS.slotCount) | 0) - 2;
    if (bound <= 0) return;
    const value = (mem.read32(panel + ALBUM_PANEL_FIELDS.scale) | 0) - 3;
    let slot = mem.read32(panel + ALBUM_PANEL_FIELDS.slotList) >>> 0;
    let n = 0;
    do {
        n += 1;
        host.setWidgetUnk15C(mem.read32(slot) >>> 0, value);
        slot = (slot + 4) >>> 0;
    } while (n < bound);
}

/** F0x80083E14(panel, slots, show): fill or clear the panel's label widgets. */
export function albumPanelFillHeadings(
    mem: AlbumPanelMemory,
    panel: number,
    slots: number,
    show: number,
    host: AlbumPanelHost,
): void {
    const widget = (i: number): number => mem.read32(slots + i * 4) >>> 0;

    if ((show | 0) === 0) {
        for (let i = 0; i < 7; i++) host.setWidgetFlag144(widget(i), 0);
        return;
    }

    const resourceId = (mem.read32(ALBUM_SAVE_PTR) | 0) + 0x24;
    host.setWidgetLine0(widget(0), host.resourceGet(resourceId), 1);
    host.setWidgetLine0(widget(1), host.resourceGet(resourceId), 2);
    host.setWidgetLineNumber(widget(2), 0, (mem.read32(panel + ALBUM_PANEL_FIELDS.headingIndex) | 0) + 1);
    host.setWidgetFlag148(widget(2), 1);
    host.setWidgetLine0(widget(3), host.resourceGet(resourceId), 5);
    host.setWidgetLineNumber(widget(4), 0, mem.read32(panel + ALBUM_PANEL_FIELDS.pageCount) | 0);
    host.setWidgetFlag148(widget(4), 1);

    if ((mem.read32(panel + ALBUM_PANEL_FIELDS.showExtra) | 0) === 0) return;
    if ((mem.read32(panel + ALBUM_PANEL_FIELDS.headingIndex) | 0) > 0) {
        host.setWidgetLine0(widget(5), host.resourceGet(resourceId), 3);
    } else {
        host.setWidgetFlag144(widget(5), 0);
    }
    if (
        (mem.read32(panel + ALBUM_PANEL_FIELDS.headingIndex) | 0) <
        (mem.read32(panel + ALBUM_PANEL_FIELDS.pageCount) | 0) - 1
    ) {
        host.setWidgetLine0(widget(6), host.resourceGet(resourceId), 4);
        return;
    }
    host.setWidgetFlag144(widget(6), 0);
}
