// The card album's grid object, translated bit-exactly from the original
// pro/stcrdabm overlay bodies.
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/lane-b/album-grid.test.js runs the original through
// engine/native and compares fields, memory writes, the page-turn callback and
// the ordered draw intents.
//
// The album shows a page of collected cards as a six-column grid. The grid
// object (F0x80083A78) holds:
//   +0x54 scale x (0x1000)   +0x58 layer (6)
//   +0x5C current page       +0x60 previous page
//   +0x64 cell count         +0x68 visible cells
//   +0x6C pulse              +0x70 silhouette depth
//   +0x74.. per-slot state   +0x7C any-collected flag   +0x80..12 slot flags
//
// Translated here:
//   F0x80083114  begin a page: swap the new page into +0x5C, remember the old
//                in +0x60, clear +0x68/+0x70, then call the +0x28 method with 2.
//   F0x80084BC8  for the twelve slots starting at +0x60*12+1, set +0x80+i to 1
//                when the resident collection table byte at
//                0x80048D34 + 0x4DF + card is nonzero and the card is < 0x13B,
//                else 0; set +0x7C when any slot is collected.
//   F0x800835BC  draw each visible cell's silhouette: setLayer(+0x54,+0x58-1),
//                setOrigin(0x280,0), then per cell m_0x88(depth) and
//                drawSprite(pack 0x06050000, 6, (i%6)*0x2A+0x23,
//                           (i/6)*0x36+0x32), where depth is +0x70 for a
//                collected/out-of-range card and 0 otherwise.
//
// F0x8008304C / F0x80083780 / F0x80083174 (cells) and the display-time service
// are boundaries; this module covers the object's page, mask and silhouette
// behaviour. This is lane B (engine/dw3/ui/native/**); lane A owns the shared
// engine/dw3/ui/index.ts barrel and data/translated_functions.json.

/** The resident collection bitmap base; a card's byte is at +0x4DF + card. */
export const ALBUM_COLLECTION_TABLE = 0x80048d34;
export const ALBUM_COLLECTION_BYTE = 0x4df;
/** Cards numbered below this are in range for the collection table. */
export const ALBUM_CARD_MAX = 0x13b;
/** The album cell sprite pack. */
export const PACK_ALBUM = 0x06050000;

export interface AlbumGridMemory {
    read8(addr: number): number;
    read32(addr: number): number;
    write32(addr: number, value: number): void;
}

export interface AlbumGridHost {
    /** F0x8001F648(&ctx): the shared stack draw context. */
    initDrawContext(): void;
    /** ctx+0x7C. */
    setLayer(layer: number, bucket: number): void;
    /** ctx+0x74. */
    setOrigin(x: number, y: number): void;
    /** ctx+0x88. */
    m_0x88(a: number): void;
    /** ctx+0x84 (packPtr, clip, x, y). */
    drawSprite(packPtr: number, clip: number, x: number, y: number): void;
    /** [0x80044F5C] pack getter. */
    packResolve(handle: number): number;
    /** obj->+0x28(obj, 2) on a page turn. */
    pageMethod28(obj: number, value: number): void;
}

export const ALBUM_GRID_FIELDS = {
    scaleX: 0x54,
    layer: 0x58,
    page: 0x5c,
    prevPage: 0x60,
    word64: 0x64,
    visible: 0x68,
    pulse: 0x6c,
    depth: 0x70,
    anyFlag: 0x7c,
    slotFlags: 0x80,
    slotStride: 4,
    slotCount: 12,
} as const;

/** F0x80083114: begin a new album page. */
export function albumGridBeginPage(
    mem: AlbumGridMemory,
    obj: number,
    page: number,
    host: AlbumGridHost,
): void {
    const previous = mem.read32(obj + ALBUM_GRID_FIELDS.page) | 0;
    mem.write32(obj + ALBUM_GRID_FIELDS.page, page | 0);
    mem.write32(obj + ALBUM_GRID_FIELDS.prevPage, previous);
    mem.write32(obj + ALBUM_GRID_FIELDS.visible, 0);
    mem.write32(obj + ALBUM_GRID_FIELDS.depth, 0);
    host.pageMethod28(obj, 2);
}

/** F0x80084BC8: fill the twelve per-slot collection flags for the current page. */
export function albumPageCollectedMask(mem: AlbumGridMemory, obj: number): void {
    mem.write32(obj + ALBUM_GRID_FIELDS.anyFlag, 0);
    let card = Math.imul(mem.read32(obj + ALBUM_GRID_FIELDS.prevPage) | 0, 12) + 1;
    for (let i = 0; i < ALBUM_GRID_FIELDS.slotCount; i++) {
        let collected = 0;
        if (
            card < ALBUM_CARD_MAX &&
            mem.read8(ALBUM_COLLECTION_TABLE + card + ALBUM_COLLECTION_BYTE) !== 0
        ) {
            collected = 1;
        }
        mem.write32(obj + ALBUM_GRID_FIELDS.slotFlags + Math.imul(i, ALBUM_GRID_FIELDS.slotStride), collected);
        if (collected !== 0) mem.write32(obj + ALBUM_GRID_FIELDS.anyFlag, 1);
        card += 1;
    }
}

/** F0x800835BC: draw the silhouettes of the visible album cells. */
export function albumGridDrawSilhouettes(
    mem: AlbumGridMemory,
    obj: number,
    host: AlbumGridHost,
): void {
    host.initDrawContext();
    host.setLayer(
        mem.read32(obj + ALBUM_GRID_FIELDS.scaleX) | 0,
        ((mem.read32(obj + ALBUM_GRID_FIELDS.layer) | 0) - 1) | 0,
    );
    host.setOrigin(0x280, 0);

    const count = mem.read32(obj + ALBUM_GRID_FIELDS.visible) | 0;
    if (count <= 0) return;
    const base = mem.read32(obj + ALBUM_GRID_FIELDS.page) | 0;
    const pack = host.packResolve(PACK_ALBUM);
    for (let i = 0; i < count; i++) {
        const index = base + i;
        let depth = 0;
        if (
            index >= ALBUM_CARD_MAX ||
            mem.read8(ALBUM_COLLECTION_TABLE + index + ALBUM_COLLECTION_BYTE) !== 0
        ) {
            depth = mem.read32(obj + ALBUM_GRID_FIELDS.depth) | 0;
        }
        host.m_0x88(depth);
        host.drawSprite(
            pack,
            6,
            Math.imul(i % 6, 0x2a) + 0x23,
            Math.imul((i / 6) | 0, 0x36) + 0x32,
        );
    }
}
