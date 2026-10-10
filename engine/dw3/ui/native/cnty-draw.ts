// The language-select screen's strip/row draws, translated bit-exactly from the
// original pro/cnty_sel overlay bodies.
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/lane-b/cnty-draw.test.js runs the original overlay addresses
// through engine/native's draw-intent recorder and the port through an
// equivalent recorder, comparing the ordered intents.
//
// Each routine builds the shared 0xa0-byte stack draw context with F0x8001F648
// and then emits the same fixed sequence. The piece id is always the cnty_sel
// pack 0x08A30000, resolved through the [0x80044F5C] pack-getter:
//
//   F0x80083630  left strip   setLayer(0x100,1) setOrigin(0x280,0) setPos(0x94,0)
//                             setScale(+0x54,+0x56,0x1000) drawSprite(pack,2,0x94,0)
//   F0x80083894  right strip  setLayer(0x100,1) setOrigin(0x280,0) setPos(0x140,0x14)
//                             setScale(+0x54,+0x56,0x1000) drawSprite(pack,1,0x140,0x14)
//   F0x80083B00  bottom strip setLayer(0x100,1) setOrigin(0x280,0) setDepth(0,0x1F0)
//                             setPos(0,0x9E) setScale(+0x54,+0x56,0x1000)
//                             drawSprite(pack,3,0,0x9E)
//   F0x80082EF0  row panel    setLayer(0x100,1) setOrigin(0x280,0)
//                             drawSprite(pack,0,t,t)   t = ((s16)+0x50 / 2) % 96
//
// The +0x54 / +0x56 sizes are the same fields the breathe ticks animate (see
// cnty-decor.ts). This module is lane B (engine/dw3/ui/native/**); lane A owns
// the shared engine/dw3/ui/index.ts barrel and data/translated_functions.json.

/** The cnty_sel sprite pack, resolved through [0x80044F5C]. */
export const PACK_CNT = 0x08a30000;

export interface CntDrawMemory {
    read16(addr: number): number;
    read32(addr: number): number;
}

export interface CntDrawHost {
    /** F0x8001F648(&ctx): the shared stack draw context. */
    initDrawContext(): void;
    /** ctx+0x7C. */
    setLayer(layer: number, bucket: number): void;
    /** ctx+0x74. */
    setOrigin(x: number, y: number): void;
    /** ctx+0x78. */
    setDepth(a: number, b: number): void;
    /** ctx+0x94. */
    setPos(x: number, y: number): void;
    /** ctx+0x8C. */
    setScale(x: number, y: number, z: number): void;
    /** ctx+0x84 (packPtr, clip, x, y). */
    drawSprite(packPtr: number, clip: number, x: number, y: number): void;
    /** The [0x80044F5C] pack getter. */
    packResolve(handle: number): number;
}

/** Object size fields the strips read (signed 16-bit). */
export const CNT_STRIP_FIELD_54 = 0x54;
export const CNT_STRIP_FIELD_56 = 0x56;
/** The row panel's phase counter (signed 16-bit). */
export const CNT_ROW_PHASE = 0x50;

function s16(v: number): number {
    return (v << 16) >> 16;
}

/** F0x80083630(left): draw the left decorative strip. */
export function countrySelectDrawLeft(mem: CntDrawMemory, obj: number, host: CntDrawHost): void {
    host.initDrawContext();
    host.setLayer(0x100, 1);
    host.setOrigin(0x280, 0);
    host.setPos(0x94, 0);
    host.setScale(
        s16(mem.read16(obj + CNT_STRIP_FIELD_54)),
        s16(mem.read16(obj + CNT_STRIP_FIELD_56)),
        0x1000,
    );
    host.drawSprite(host.packResolve(PACK_CNT), 2, 0x94, 0);
}

/** F0x80083894(right): draw the right decorative strip. */
export function countrySelectDrawRight(mem: CntDrawMemory, obj: number, host: CntDrawHost): void {
    host.initDrawContext();
    host.setLayer(0x100, 1);
    host.setOrigin(0x280, 0);
    host.setPos(0x140, 0x14);
    host.setScale(
        s16(mem.read16(obj + CNT_STRIP_FIELD_54)),
        s16(mem.read16(obj + CNT_STRIP_FIELD_56)),
        0x1000,
    );
    host.drawSprite(host.packResolve(PACK_CNT), 1, 0x140, 0x14);
}

/** F0x80083B00(bottom): draw the bottom decorative strip. */
export function countrySelectDrawBottom(mem: CntDrawMemory, obj: number, host: CntDrawHost): void {
    host.initDrawContext();
    host.setLayer(0x100, 1);
    host.setOrigin(0x280, 0);
    host.setDepth(0, 0x1f0);
    host.setPos(0, 0x9e);
    host.setScale(
        s16(mem.read16(obj + CNT_STRIP_FIELD_54)),
        s16(mem.read16(obj + CNT_STRIP_FIELD_56)),
        0x1000,
    );
    host.drawSprite(host.packResolve(PACK_CNT), 3, 0, 0x9e);
}

/** F0x80082EF0(row): draw the sliding row panel. */
export function countrySelectDrawRow(mem: CntDrawMemory, obj: number, host: CntDrawHost): void {
    host.initDrawContext();
    host.setLayer(0x100, 1);
    host.setOrigin(0x280, 0);
    // t = ((s16)phase / 2) % 96, with MIPS signed division and remainder.
    const phase = s16(mem.read16(obj + CNT_ROW_PHASE));
    const t = (((phase / 2) | 0) % 96) | 0;
    host.drawSprite(host.packResolve(PACK_CNT), 0, t, t);
}
