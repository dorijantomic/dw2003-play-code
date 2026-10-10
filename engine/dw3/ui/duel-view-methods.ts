// The card duel's remaining board-view method bodies: the pair of panel slides
// the deal ceremony opens with, the HUD highlight byte-set, and the per-row
// counter step it uses while the fresh hand lands. Each is a constructor-
// installed method of the board view (view+0xEC8 / +0xEC4 / +0xEB8), or a
// directly-called overlay routine (F0x8008D854), so the disassembler's ordinary
// function-start list does not carry them; every body was read from the overlay
// ASSEMBLY (authority 2), never the m2c C.
//
// Source: exe-decomp/cardgame.norm.s
//   F0x8009C2D0 slideBothPanelsIn  @.L0x00019620 (view+0xEC8)
//   F0x8009C350 slideBothPanelsOut @.L0x000196a0 (view+0xEC4)
//   F0x8009CC4C setHudHighlights   @.L0x00019f9c (view+0xEB8)
//   F0x8008D854 settleRowCard      @.L0x0000aba4
//
// WHAT A PLAYER SEES. When an effect wipes both fields and deals a fresh turn,
// the two HUD half-panels slide back into place. `slideBothPanelsIn` drops both
// panels off their near edge and arms them to travel home (mode 1 with a 20-frame
// span); `slideBothPanelsOut` arms the opposite trip (mode 3). The per-frame
// board draw is what actually moves them (player-hud.ts slidePlayerPanel), and it
// is also what flips panel state 1 -> 2, the value the ceremony's wait arm reads.
// `setHudHighlights` lights the little per-side indicator bytes; `settleRowCard`
// bumps one row's counter and pushes the new number onto that side's HUD.

import {
    scaleSlotCore, type DuelBoardMemory,
} from "./duel-board-view.ts";

const s16 = (v: number): number => (v << 16) >> 16;

/** A (offset, value) halfword store list; the stores are to distinct fields, so
 *  the original's instruction order does not change the final memory. */
export type HalfwordStores = readonly (readonly [number, number])[];

/**
 * F0x8009C2D0(view) — view+0xEC8: slide both HUD panels in. Panel 0 (view+0x60)
 * drops to its away edge (y 0xF1), panel 1 (view+0xB4) to y 0xFF9C, both armed at
 * mode 1 with a 20-frame span; the alt/plate fields are seeded to the "in"
 * endpoints. Read from exe-decomp/cardgame.norm.s .L0x00019620.
 */
export const SLIDE_PANELS_IN_STORES: HalfwordStores = [
    [0x60, 0x14], [0x62, 0x14], [0x64, 1], [0x66, 2], [0x6c, 0], [0x6e, 0xf1],
    [0x80, 0x147], [0x82, 0x8f], [0x9c, 0x140], [0x9e, 0xbd],
    [0xb4, 0x14], [0xb6, 0x14], [0xb8, 1], [0xc0, 0], [0xc2, 0xff9c], [0xd4, 0xf9],
    [0xd6, 0x50], [0xf0, 0x140], [0xf2, 0x26],
];

/**
 * F0x8009C350(view) — view+0xEC4: slide both HUD panels out. Both panels are
 * armed at mode 3 with a 10-frame span: panel 0 leaves by y 0x8D, panel 1 by
 * y 0 and x 0, and the alt/plate fields start from their away endpoints. Read
 * from exe-decomp/cardgame.norm.s .L0x000196a0.
 */
export const SLIDE_PANELS_OUT_STORES: HalfwordStores = [
    [0x60, 0xa], [0x62, 0xa], [0x64, 3], [0x6c, 0], [0x6e, 0x8d],
    [0x80, 0x120], [0x82, 0x8f], [0x9c, 0x113], [0x9e, 0xbd],
    [0xb4, 0xa], [0xb6, 0xa], [0xb8, 3], [0xc0, 0], [0xc2, 0], [0xd4, 0x120],
    [0xd6, 0x50], [0xf0, 0x113], [0xf2, 0x26],
];

function applyStores(mem: DuelBoardMemory, view: number, stores: HalfwordStores): void {
    for (const [off, value] of stores) mem.write16(view + off, value & 0xffff);
}

/** F0x8009C2D0(view): slide both HUD panels in (view+0xEC8). */
export function slideBothPanelsIn(mem: DuelBoardMemory, view: number): void {
    applyStores(mem, view, SLIDE_PANELS_IN_STORES);
}

/** F0x8009C350(view): slide both HUD panels out (view+0xEC4). */
export function slideBothPanelsOut(mem: DuelBoardMemory, view: number): void {
    applyStores(mem, view, SLIDE_PANELS_OUT_STORES);
}

/**
 * The HUD highlight bytes F0x8009CC4C sets: each set bit of `mask` lights one
 * byte to 1. Bits the mask does not name are left exactly as they were — the
 * routine only ever sets, never clears. Read from
 * exe-decomp/cardgame.norm.s .L0x00019f9c.
 */
export const HUD_HIGHLIGHT_BYTES: readonly (readonly [number, number])[] = [
    [0x00001, 0x90], [0x00004, 0x91], [0x00010, 0x92], [0x00040, 0x93],
    [0x00100, 0x94], [0x00400, 0x95], [0x01000, 0x96], [0x04000, 0x97],
    [0x10000, 0x98], [0x40000, 0x99],
    [0x00002, 0xe4], [0x00008, 0xe5], [0x00020, 0xe6], [0x00080, 0xe7],
    [0x00200, 0xe8], [0x00800, 0xe9], [0x02000, 0xea], [0x08000, 0xeb],
    [0x20000, 0xec], [0x80000, 0xed],
];

/** F0x8009CC4C(view, mask): light the HUD indicator bytes named by `mask`. */
export function setHudHighlights(mem: DuelBoardMemory, view: number, mask: number): void {
    const m = mask >>> 0;
    for (const [bit, off] of HUD_HIGHLIGHT_BYTES) {
        if ((m & (bit >>> 0)) !== 0) mem.write8(view + off, 1);
    }
}

/** The edges `settleRowCard` drives; the first three are the resident card-record
 *  cursor the original builds on its own stack frame. */
export interface SettleRowHost {
    /** A scratch the card-record cursor is built on (the original's stack frame). */
    cardCursorScratch(): number;
    /** F0x8001EBF8(ctx): build the resident card-record cursor on `scratch`. */
    cardCursorCreate(scratch: number): void;
    /** cursor+0x2C (F0x8001E7EC): select record `id`; its pointer lands at `scratch+0x00`. */
    cardRecordSelect(scratch: number, id: number): void;
    /** view+0xEA0 (F0x8009CAE0): push a HUD readout. */
    setHudCounter(view: number, side: number, index: number, value: number): void;
}

/**
 * F0x8008D854(duel, view, side, value) — the per-row counter step the deal
 * ceremony runs while the fresh hand lands. It builds the resident card-record
 * cursor, selects the record for `duel + value*2 + 0x50` (made 1-based), reads
 * the record's first byte, and — when that index is in range — bumps the row's
 * matching counter byte (up to 0x63) and pushes the new value onto that side's
 * HUD. Returns 1 when it stepped a counter, 0 otherwise. Read from
 * exe-decomp/cardgame.norm.s .L0x0000aba4.
 */
export function settleRowCard(
    mem: DuelBoardMemory, host: SettleRowHost, duel: number, view: number, side: number, value: number,
): number {
    const scratch = host.cardCursorScratch();
    host.cardCursorCreate(scratch);
    // s3 = duel + side*0xC8 + 0x59C; the counter byte is `lbu/sb 0xC($s1)`, so the
    // row cell sits a further 0x0C on: duel + side*0xC8 + 0x5A8 + idx.
    const row = duel + side * 0xc8 + 0x5a8;
    const id = (s16(mem.read16(duel + value * 2 + 0x50)) + 1) | 0;
    host.cardRecordSelect(scratch, id);
    const record = mem.read32(scratch) | 0;
    const idx = (mem.read8(record) & 0xff) - 1;
    if (idx >= 5) return 0; // slti $a2, 0x5 is signed: skip for idx >= 5
    const cell = row + idx;
    const count = mem.read8(cell) & 0xff;
    if (count < 0x63) mem.write8(cell, count + 1);
    host.setHudCounter(view, side, idx, mem.read8(cell) & 0xff);
    return 1;
}

/** Re-exported so the oracle can pin the panel-slide stores against the binary. */
export { scaleSlotCore };

/** The turn-marker record stride on the view (`view + side*0x54`). */
export const TURN_MARKER_STRIDE = 0x54;

/**
 * F0x8009C4A4(view, side) — view+0xED0: grow that side's turn marker in. Writes
 * the marker record at `view + side*0x54 + 0xA8`: state byte 1, counter and
 * duration 12, level 0. The per-frame marker draw (turn-marker.ts) ramps the
 * level up over those twelve frames. Read from exe-decomp/cardgame.norm.s
 * .L0x000197f4.
 */
export function growTurnMarker(mem: DuelBoardMemory, view: number, side: number): void {
    const p = view + side * TURN_MARKER_STRIDE;
    mem.write8(p + 0xb0, 1);
    mem.write16(p + 0xae, 12);
    mem.write16(p + 0xac, 12);
    mem.write16(p + 0xa8, 0);
}

/**
 * F0x8009C4D8(view, side) — view+0xED4: shrink that side's turn marker away.
 * The same record, but state byte 3, counter and duration 6, level 0x1000. Read
 * from exe-decomp/cardgame.norm.s .L0x00019828.
 */
export function shrinkTurnMarker(mem: DuelBoardMemory, view: number, side: number): void {
    const p = view + side * TURN_MARKER_STRIDE;
    mem.write8(p + 0xb0, 3);
    mem.write16(p + 0xae, 6);
    mem.write16(p + 0xac, 6);
    mem.write16(p + 0xa8, 0x1000);
}
