// The card album's cell painter, translated bit-exactly from the original
// pro/stcrdabm F0x80083174 body.
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/lane-b/album-cells-draw.test.js runs the original through
// engine/native and compares the ordered draw intents.
//
// F0x80083174(obj, page) draws the visible cells of the current page: for each
// of obj+0x64 cells it starts the standard draw context, sets up the resident
// text context (F0x8001EBF8) with its origin (0x140,0x100) and clip (0x300,
// 0x100) and the cell scale, and for a card in range:
//   collected: show the card's art (sprite 0x1D) or, when the text context
//     reports a badge, the card's level digits from spB0->unk1/unk2 split into
//     tens and units (digit sprites at 0x27 and 0x3A with 7px steps), then the
//     card-id sprite (spB0->unk0 - 1);
//   empty: the plain cell sprite 6.
//
// The cell grid is six columns (0x2A each, x at +0x23) by rows of 0x36 (y at
// +0x32); the card index is the page's base (obj+0x5C, or obj+0x60 when
// `page` != 0) plus the running cell. The draw context, the text context and
// its methods are host boundaries; the port preserves the exact call order and
// arguments. This is lane B (engine/dw3/ui/native/**); lane A owns the shared
// engine/dw3/ui/index.ts barrel and data/translated_functions.json.

import { ALBUM_COLLECTION_TABLE, ALBUM_COLLECTION_BYTE, ALBUM_CARD_MAX } from "./album-grid.ts";

/** The album cell sprite pack. */
export const PACK_ALBUM_CELLS = 0x06050000;
/** Digit sprite base: the tens tile; 0x1E..0x27 are the digit range. */
export const ALBUM_DIGIT_BASE = 0x1e;
/** The empty-cell sprite. */
export const ALBUM_EMPTY_SPRITE = 6;
/** The card-art sprite (2-frame alternating). */
export const ALBUM_CARD_SPRITE = 0x1d;

export interface AlbumCellsMemory {
    read8(addr: number): number;
    read32(addr: number): number;
}

export interface AlbumCellsHost {
    /** F0x8001F648(&ctx): the shared stack draw context. */
    initDrawContext(): void;
    setLayer(layer: number, bucket: number): void;
    setOrigin(x: number, y: number): void;
    drawSprite(packPtr: number, clip: number, x: number, y: number): void;
    packResolve(handle: number): number;
    /** F0x8001EBF8(&ctx): the resident text context. */
    initTextContext(): void;
    /** textctx+0x2C: set the card byte. */
    textSetCard(card: number): void;
    /** textctx+0x34: place the next glyph at (x, y). */
    textSetPos(x: number, y: number): void;
    /** textctx+0x38: set the text scale to (scaleX, scaleY). */
    textSetScale(scaleX: number, scaleY: number): void;
    /** textctx+0x3C: set the text origin to (x, y). */
    textSetOrigin(x: number, y: number): void;
    /** textctx+0x40: set the text clip to (x, y). */
    textSetClip(x: number, y: number): void;
    /** textctx+0x44: select glyph cell (col, row). */
    textCell(col: number, row: number): void;
    /** textctx+0x50: nonzero when the card has a badge. */
    textBadge(): number;
    /** textctx+0x00: the card's name byte. */
    textNameByte(): number;
    /** textctx+0x01: the card's first level number. */
    textLevel1(): number;
    /** textctx+0x02: the card's second level number. */
    textLevel2(): number;
}

/** F0x80083174(obj, page): draw the album page's cells. */
export function albumGridDrawCells(
    mem: AlbumCellsMemory,
    obj: number,
    page: number,
    host: AlbumCellsHost,
): void {
    host.initDrawContext();
    host.setLayer(mem.read32(obj + 0x54) | 0, mem.read32(obj + 0x58) | 0);
    host.setOrigin(0x280, 0);
    host.initTextContext();
    host.textSetOrigin(0x140, 0x100);
    host.textSetClip(0x300, 0x100);
    host.textSetScale(mem.read32(obj + 0x54) | 0, mem.read32(obj + 0x58) | 0);

    const count = mem.read32(obj + 0x64) | 0;
    if (count <= 0) return;
    const base = (mem.read32(page !== 0 ? obj + 0x60 : obj + 0x5c) | 0);

    for (let cell = 0; cell < count; cell++) {
        const card = base + cell;
        if (card >= ALBUM_CARD_MAX) break;
        const row = (cell / 6) | 0;
        const col = cell % 6;
        const x = Math.imul(col, 0x2a);
        const y = Math.imul(row, 0x36);

        if (mem.read8(ALBUM_COLLECTION_TABLE + card + ALBUM_COLLECTION_BYTE) !== 0) {
            host.textSetCard(card);
            host.textCell(col, row);
            const artX = x + 0x27;
            host.textSetPos(artX, y + 0x34);
            if ((host.textBadge() | 0) !== 0) {
                host.drawSprite(host.packResolve(PACK_ALBUM_CELLS), ALBUM_CARD_SPRITE, artX, y + 0x53);
            } else {
                drawDigits(host, host.textLevel1() | 0, x, y, 0x27, [1, 2, 0]);
                drawDigits(host, host.textLevel2() | 0, x, y, 0x3a, [1, 2]);
            }
            host.drawSprite(
                host.packResolve(PACK_ALBUM_CELLS),
                ((host.textNameByte() | 0) - 1) | 0,
                x + 0x23,
                y + 0x32,
            );
        } else {
            host.drawSprite(host.packResolve(PACK_ALBUM_CELLS), ALBUM_EMPTY_SPRITE, x + 0x23, y + 0x32);
        }
    }
}

function drawDigits(
    host: AlbumCellsHost,
    value: number,
    x: number,
    y: number,
    startX: number,
    kinds: ReadonlyArray<number>,
): void {
    // kinds: 1 = tens tile, 2 = units tile, 0 = a fixed separator tile.
    const tiles = [0, 0, 0];
    for (let i = 0; i < kinds.length; i++) {
        if (kinds[i] === 1) {
            const tens = (value / 10) | 0;
            tiles[i] = tens !== 0 ? tens + ALBUM_DIGIT_BASE : 0;
        } else if (kinds[i] === 2) {
            tiles[i] = (value % 10) + ALBUM_DIGIT_BASE;
        } else {
            tiles[i] = 0x1c;
        }
    }
    let dx = startX;
    for (let i = 0; i < kinds.length; i++) {
        const tile = tiles[i] ?? 0;
        if (tile !== 0) {
            host.drawSprite(host.packResolve(PACK_ALBUM_CELLS), tile, x + dx, y + 0x53);
        }
        dx += 7;
    }
}
