// The card duel's element-panel family (S12), translated from pro/cardgame.
//
// A 0x74-byte widget the Draw Phase opens three of, one per page of the marker.
// §24.2 named the object; its constructor and two slots were read from the
// overlay assembly at their offsets inside the F0x8009BBA8 blob (no
// disassembler entry-list start, so the m2c C is not the source):
//   F0x80096828 constructor              @ .L0x00013b78 (handler F0x80096418, draw F0x800961f0)
//   F0x800967F8 element_panel_start_oneshot @ .L0x00013b48 (slot +0x6C)
//   F0x80096808 element_panel_scale_out     @ .L0x00013b58 (slot +0x70)
//
// Player-visible result: the panel counts one folder's forty cards into six
// element buckets (panel+0x60..+0x65), then sits at its (x, y). start_oneshot
// plays the moving layer's eight frames and holds; scale_out vanishes the six
// counts and shrinks the panel away over six frames. §24.2 records that the
// panel's own entry state grows +0x5C from 0 over 12 ticks, while scale_out
// requests the 6-tick shrink — two different durations, not one.
//
// The card cursor (F0x8001EBF8 opening it, the resolved record's element byte,
// and the [sp+0x3C] resolver) is a resident service and stays a host edge; the
// six element buckets are the only thing this body computes, and in a session
// with no disc catalog the resolver returns a zero record (kind 0), exactly as
// the other catalog-fed ports already document.

export interface ElementPanelMemory {
    read8(addr: number): number;
    read16s(addr: number): number;
    write8(addr: number, value: number): void;
    write16(addr: number, value: number): void;
    write32(addr: number, value: number): void;
}

export interface ElementPanelHost {
    /** F0x80014504(handler, size, slot): build the widget task object. */
    allocate(handler: number, size: number, slot: number): number;
    /** F0x8001EBF8(buf): open the card cursor the forty reads walk. */
    openElementCursor(): number;
    /** the cursor's own resolve callback: resolve the raw card `id` into it. */
    resolveCardInto(cursor: number, id: number): void;
    /** `lbu (*(cursor+0))`: the resolved record's element byte (1-based). */
    cardKind(cursor: number): number;
}

/** The panel's own fields (stride 0x74). */
export const ELEMENT_PANEL = {
    /** folder index (s32) */
    folder: 0x50,
    /** the panel's own entry state's scale (s16, grows 0 -> full over 12 ticks) */
    entryScale: 0x5c,
    /** x (s16), y (s16) */
    x: 0x58,
    y: 0x5a,
    /** the six element buckets */
    buckets: 0x60,
    /** mode byte (scale_out writes 2) */
    mode: 0x66,
    /** start_oneshot flag */
    oneshot: 0x67,
    /** the two shrink frames scale_out arms (6) */
    shrinkA: 0x68,
    shrinkB: 0x6a,
} as const;

export const ELEMENT_PANEL_HANDLER = 0x80096418;
export const ELEMENT_PANEL_DRAW = 0x800961f0;
export const ELEMENT_PANEL_SIZE = 0x74;
export const ELEMENT_PANEL_EXTRA = 0x1c;
export const ELEMENT_PANEL_SLOT_ONESHOT = 0x6c;
export const ELEMENT_PANEL_SLOT_SCALE_OUT = 0x70;
export const ELEMENT_PANEL_METHOD_ONESHOT = 0x800967f8;
export const ELEMENT_PANEL_METHOD_SCALE_OUT = 0x80096808;
export const ELEMENT_PANEL_BUCKETS = 6;
export const ELEMENT_PANEL_CARDS = 40;
/** The folder's card list: 40 halfwords, stride 0x66 per folder, field +0x63E. */
export const FOLDER_RECORD_BASE = 0x80048d34;
export const FOLDER_RECORD_STRIDE = 0x66;
export const FOLDER_CARD_FIELD = 0x63e;
export const ELEMENT_PANEL_SCALE_OUT_FRAMES = 6;
export const ELEMENT_PANEL_MODE_SCALE_OUT = 2;
export const ELEMENT_PANEL_FULL_SCALE = 0x1000;

/**
 * F0x80096828(folderIdx, x, y): build the panel, count the folder's forty cards
 * into its six element buckets, install the two slots and seed its position.
 */
export function createElementPanel(
    mem: ElementPanelMemory, host: ElementPanelHost, folderIdx: number, x: number, y: number,
): number {
    const cursor = host.openElementCursor() | 0;
    const panel = host.allocate(ELEMENT_PANEL_HANDLER, ELEMENT_PANEL_SIZE, ELEMENT_PANEL_EXTRA) >>> 0;
    for (let k = ELEMENT_PANEL_BUCKETS - 1; k >= 0; k--) mem.write8(panel + ELEMENT_PANEL.buckets + k, 0);
    const base = (FOLDER_RECORD_BASE + (folderIdx | 0) * FOLDER_RECORD_STRIDE + FOLDER_CARD_FIELD) | 0;
    for (let i = 0; i < ELEMENT_PANEL_CARDS; i++) {
        const id = mem.read16s(base + i * 2) | 0;
        host.resolveCardInto(cursor, id);
        const bucket = (host.cardKind(cursor) - 1) | 0;
        const at = (panel + ELEMENT_PANEL.buckets + bucket) | 0;
        mem.write8(at, (mem.read8(at) + 1) & 0xff);
    }
    mem.write32(panel + ELEMENT_PANEL_SLOT_ONESHOT, ELEMENT_PANEL_METHOD_ONESHOT);
    mem.write32(panel + ELEMENT_PANEL.folder, folderIdx | 0);
    mem.write16(panel + ELEMENT_PANEL.x, x & 0xffff);
    mem.write16(panel + ELEMENT_PANEL.y, y & 0xffff);
    mem.write8(panel + ELEMENT_PANEL.oneshot, 0);
    mem.write32(panel + ELEMENT_PANEL_SLOT_SCALE_OUT, ELEMENT_PANEL_METHOD_SCALE_OUT);
    return panel;
}

/** F0x800967F8(panel): the panel's moving layer plays eight frames and holds. */
export function elementPanelStartOneshot(mem: ElementPanelMemory, panel: number): void {
    mem.write8(panel + ELEMENT_PANEL.oneshot, 1);
    mem.write32(panel + 0x54, 0);
}

/** F0x80096808(panel): the six element counts vanish and the panel shrinks away. */
export function elementPanelScaleOut(mem: ElementPanelMemory, panel: number): void {
    mem.write16(panel + ELEMENT_PANEL.shrinkB, ELEMENT_PANEL_SCALE_OUT_FRAMES);
    mem.write16(panel + ELEMENT_PANEL.shrinkA, ELEMENT_PANEL_SCALE_OUT_FRAMES);
    mem.write8(panel + ELEMENT_PANEL.mode, ELEMENT_PANEL_MODE_SCALE_OUT);
    mem.write16(panel + ELEMENT_PANEL.entryScale, ELEMENT_PANEL_FULL_SCALE);
}
