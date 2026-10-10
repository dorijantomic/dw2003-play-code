// The item shop list draw, translated from pro/stitshop F0x80087920.
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/item-list-draw-oracle.test.js runs the original through
// engine/native's draw-intent recorder and the port through an equivalent
// recorder, comparing the ordered intent list.
//
// DECODED: the accepted item-panel-draw answer (U3/U4) and
// exe-decomp/stitshop_c/F0x80087920.c, which agree line for line. Claim
// shop-fold-duration-all-10-2026-09-10 (partially_verified) covers the fold seed.
//
// Emitted intents, in order:
//   initDrawContext (host, not an intent)
//   setLayer(obj+0x54, obj+0x58); setOrigin(0x280, 0x100)
//   v = obj+0x6E0; if v == 0 return (draw nothing)
//   v != 0x1000 : setScale(0x1000, v, 0x1000); setPos(0xA0, 0x47)
//   v == 0x1000 : for i = 0 .. obj+0x6D4-1, BREAK when idx >= obj+0x6C0 or id==0:
//                   setOrigin(0x140, 0); drawSprite(CMFONTCS, iconClip(id), x, y);
//                   setOrigin(0x280, 0x100); drawSprite(STSHOPCS, 0x31, x, y)
//                 (x = 0x28 + 0x83*(i&1), y = 0x24 + 0x0E*((i % pageSize)>>1))
//                 if obj+0x6C8 >= 2:
//                   if frameTick() - obj+0x6D0 >= 0xB:
//                     obj+0x6D0 = frameTick(); obj+0x6CC = (obj+0x6CC+1 >= 4 ? 0 : +1)
//                   setOrigin(0x280,0x100); paletteShift(obj+0x6CC)
//                   if obj+0x6C4 != 0: drawSprite(STSHOPCS, 0x10, 0x1E, 0x5F+0x2A*mode)
//                   if obj+0x6C4 < obj+0x6C8-1: drawSprite(STSHOPCS, 0x11, 0xFD, 0x5F+0x2A*mode)
//                   paletteShift(0)
//   setOrigin(0x280, 0x100); drawSprite(STSHOPCS, mode+6, 0, 0x1D)
//
// id source: mode 0 -> s16 at [obj+0x6B4] + 2*idx ; mode != 0 -> s16 at obj+0x64 + 2*idx.

export interface ItemListDrawMemory {
    read16(addr: number): number;
    read32(addr: number): number;
    write32(addr: number, value: number): void;
}

/** The draw boundary. Each call is one ctx method invocation. */
export interface ItemListDrawHost {
    initDrawContext(): void;
    setLayer(target: number, bucket: number): void;
    setOrigin(x: number, y: number): void;
    setScale(x: number, y: number, z: number): void;
    setPos(x: number, y: number): void;
    paletteShift(value: number): void;
    drawSprite(packPtr: number, clip: number, x: number, y: number): void;
    /** packGetEntry handle -> directory pointer. */
    packResolve(handle: number): number;
    /** f6(itemId) -> icon clip. */
    iconClip(id: number): number;
    /** getFrameTickCounter(). */
    frameTick(): number;
}

export const PACK_CMFONT = 0x02860000; // idx 646
export const PACK_STSHOP = 0x04020000; // idx 1026
export const LIST_WINDOW_ORIGIN_X = 0x280;
export const LIST_WINDOW_ORIGIN_Y = 0x100;

/** F0x80087920(obj): draw the BUY/SELL item list. */
export function itemListDraw(mem: ItemListDrawMemory, obj: number, host: ItemListDrawHost): void {
    host.initDrawContext();
    host.setLayer(mem.read32(obj + 0x54) | 0, mem.read32(obj + 0x58) | 0);
    host.setOrigin(LIST_WINDOW_ORIGIN_X, LIST_WINDOW_ORIGIN_Y);

    const fold = mem.read32(obj + 0x6e0) | 0;
    if (fold === 0) return;

    const mode = mem.read32(obj + 0x5c) | 0;
    if (fold !== 0x1000) {
        host.setScale(0x1000, fold, 0x1000);
        host.setPos(0xa0, 0x47);
    } else {
        const pageSize = mem.read32(obj + 0x6d4) | 0;
        if (pageSize > 0) {
            for (let i = 0; i < pageSize; i++) {
                const idx = (Math.imul(mem.read32(obj + 0x6c4), pageSize) + i) | 0;
                const id = mode === 0
                    ? mem.read16((mem.read32(obj + 0x6b4) + Math.imul(idx, 2)) >>> 0)
                    : mem.read16(obj + 0x64 + Math.imul(idx, 2));
                if (!(idx < (mem.read32(obj + 0x6c0) | 0) && id !== 0)) break;
                const x = 0x28 + 0x83 * (i & 1);
                const y = 0x24 + 0x0e * ((i % pageSize) >> 1);
                host.setOrigin(0x140, 0);
                host.drawSprite(host.packResolve(PACK_CMFONT), host.iconClip(id), x, y);
                host.setOrigin(LIST_WINDOW_ORIGIN_X, LIST_WINDOW_ORIGIN_Y);
                host.drawSprite(host.packResolve(PACK_STSHOP), 0x31, x, y);
            }
        }
        if ((mem.read32(obj + 0x6c8) | 0) >= 2) {
            const frame = host.frameTick() | 0;
            if (((frame - (mem.read32(obj + 0x6d0) | 0)) | 0) >= 0xb) {
                mem.write32(obj + 0x6d0, frame);
                let k = (mem.read32(obj + 0x6cc) | 0) + 1;
                if (k >= 4) k = 0;
                mem.write32(obj + 0x6cc, k);
            }
            host.setOrigin(LIST_WINDOW_ORIGIN_X, LIST_WINDOW_ORIGIN_Y);
            host.paletteShift(mem.read32(obj + 0x6cc) | 0);
            const page = mem.read32(obj + 0x6c4) | 0;
            const pageCount = mem.read32(obj + 0x6c8) | 0;
            if (page !== 0) host.drawSprite(host.packResolve(PACK_STSHOP), 0x10, 0x1e, 0x5f + 0x2a * mode);
            if (page < pageCount - 1) host.drawSprite(host.packResolve(PACK_STSHOP), 0x11, 0xfd, 0x5f + 0x2a * mode);
            host.paletteShift(0);
        }
    }
    host.setOrigin(LIST_WINDOW_ORIGIN_X, LIST_WINDOW_ORIGIN_Y);
    host.drawSprite(host.packResolve(PACK_STSHOP), mode + 6, 0, 0x1d);
}
