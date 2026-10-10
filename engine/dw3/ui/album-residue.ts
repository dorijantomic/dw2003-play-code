// The card album's two remaining executed bodies, translated from pro/stcrdabm:
//   F0x80083734 album_page_has_collected — is any card of the visible page held?
//   F0x8008304C album_grid_draw_faces    — stage the page's card faces.
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/album-residue-oracle.test.js runs both originals through
// engine/native on the shipped pro_stcrdabm.bin + resident.bin with the view
// context and the collection table stubbed, and compares the ordered calls.
//
// DECODED: authority-2 `exe-decomp/stcrdabm_c/_asm/{F0x80083734,F0x8008304c}.s`
// and the accepted stcrdabm-remaining-contract answer (UNITs 4-5). Both read the
// page's first card id (+0x5C, 1-based, whole) and gate on the resident bound
// 0x13B (315; the top card id is 0x13A):
//
//   album_page_has_collected(grid): scan up to twelve cards from the page base;
//     return 1 at the first collected flag (0x80048D34 + 0x4DF + card); if the
//     running card reaches 0x13B return 1 as well; after twelve in-range cards
//     return 0. The increment is in the branch delay slot, so the bounds test
//     sees the pre-increment counter.
//
//   album_grid_draw_faces(grid): build the resident view context (F0x8001EBF8),
//     stage its two literal pairs (0x140,0x100) and (0x300,0x100), then walk the
//     page as one twelve-cell sequence in reading order (six across, two down):
//     resolve the card record (ctx+0x2C), stage the cell (ctx+0x44 col,row) and
//     commit the view (ctx+0x30), stopping before the first out-of-range card.
//     The second row continues the card counter rather than restarting it —
//     the row loop re-enters at the bounds test, not at the base read — which
//     is why the twelve cells are one sequence with a single break.
//
// The five resident context methods, the context builder and the collection
// table are host boundaries here. This module is lane A; lane B's
// engine/dw3/ui/native/album-grid.ts owns the grid object's page, mask and
// silhouette behaviour and supplies the bound constants.

import { ALBUM_CARD_MAX, ALBUM_COLLECTION_BYTE, ALBUM_COLLECTION_TABLE } from "./native/album-grid.ts";

export interface AlbumResidueMemory {
    read8(addr: number): number;
    read32(addr: number): number;
}

export interface AlbumResidueHost {
    /** F0x8001EBF8(&ctx): build the resident view context. */
    initTextContext(): void;
    /** ctx+0x3C = F0x8001E98C: stage the first literal pair. */
    setCurrentObject4_8(x: number, y: number): void;
    /** ctx+0x40 = F0x8001E9A0: stage the second literal pair. */
    setCurrentObjectC_10(x: number, y: number): void;
    /** ctx+0x2C = F0x8001E7EC: resolve a card id to its record. */
    resolveCardRecord(card: number): void;
    /** ctx+0x44 = F0x8001E9B4: stage the current view cell (col, row). */
    setCurrentViewSize(col: number, row: number): void;
    /** ctx+0x30 = F0x8001E890: commit the staged view. */
    commitCurrentView(): void;
}

/** The grid object's page field. */
export const ALBUM_PAGE_FIELD = 0x5c;
/** The twelve cells of a page. */
export const ALBUM_PAGE_CELLS = 12;
/** The literal pairs the face pass stages before the cells. */
export const ALBUM_FACE_PAIR_A = 0x140;
export const ALBUM_FACE_PAIR_B = 0x300;
export const ALBUM_FACE_CLIP = 0x100;

/**
 * F0x80083734(grid): nonzero when the visible page has any collected card.
 * The original is a leaf with both returns in the jump-register delay slots.
 */
export function albumPageHasCollected(mem: AlbumResidueMemory, grid: number): number {
    const base = mem.read32(grid + ALBUM_PAGE_FIELD) | 0;
    let i = 0;
    for (;;) {
        const card = (base + i) | 0;
        if (mem.read8(ALBUM_COLLECTION_TABLE + card + ALBUM_COLLECTION_BYTE) !== 0) return 1;
        i += 1;
        if (card < ALBUM_CARD_MAX) {
            if (i < ALBUM_PAGE_CELLS) continue;
            return 0;
        }
        return 1;
    }
}

/** F0x8008304C(grid): stage the current page's twelve card faces. */
export function albumGridDrawFaces(
    mem: AlbumResidueMemory,
    grid: number,
    host: AlbumResidueHost,
): void {
    host.initTextContext();
    host.setCurrentObject4_8(ALBUM_FACE_PAIR_A, ALBUM_FACE_CLIP);
    host.setCurrentObjectC_10(ALBUM_FACE_PAIR_B, ALBUM_FACE_CLIP);
    let card = mem.read32(grid + ALBUM_PAGE_FIELD) | 0;
    for (let i = 0; i < ALBUM_PAGE_CELLS; i++) {
        if (card >= ALBUM_CARD_MAX) break;
        host.resolveCardRecord(card);
        host.setCurrentViewSize(i % 6, (i / 6) | 0);
        host.commitCurrentView();
        card = (card + 1) | 0;
    }
}
