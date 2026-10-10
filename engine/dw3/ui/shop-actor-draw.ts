// The BUY actor's per-frame draw, translated from pro/stitshop F0x80083970.
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/shop-actor-draw-oracle.test.js runs the original through
// engine/native's draw-intent recorder and the port through an equivalent
// recorder, comparing the ordered intent list and the counters it updates.
//
// DECODED: exe-decomp/stitshop_c/F0x80083970.c and the raw body at
// exe-decomp/stitshop_c/_asm/F0x80083970.s (authority 2), cross-checked against
// the accepted draw-context answer U5. The ctx slots are the item-list-draw
// names: +0x74 setOrigin, +0x7c setLayer, +0x84 drawSprite, +0x88 paletteShift,
// +0x8c setScale, +0x94 setPos.
//
// Ordered intents:
//   initDrawContext
//   setLayer(obj+0x58, obj+0x5C); setOrigin(0x280, 0x100)
//   if obj+0x90 != 0:
//     setScale(obj+0x90, 0x1000, 0x1000)                 (unconditional)
//     if obj+0x90 != 0x1000: setPos(0x140, 0x42)
//     drawSprite(STSHOP, 0x0A, 0x9A, 0x34)
//     if obj+0x90 != 0x1000: setPos(0x140, 0x59)
//     else: frame-tick blink (obj+0x70/obj+0x6C), then the two X/selected marks
//     drawSprite(STSHOP, 0x0B, 0xF6, 0x4F)
//   if obj+0xA0 != 0: fold shape, drawSprite(STSHOP, 0x15, 0x7B, 0x26), then
//     drawSprite(STSHOP, 0x0C, 0xAF, 0x43)
//   if obj+0xB0 != 0 / if obj+0xC0 != 0: setLayer(obj+0x58, obj+0x5C-2), fold
//     shape, drawSprite(STSHOP, 0x15, 0x7B, 0x26)
//   if obj+0x7C != 0: palette blink (obj+0x84/obj+0x80), setLayer(obj+0x58,
//     obj+0x5C-2), setScale(1,1,1), paletteShift(obj+0x80),
//     drawSprite(STSHOP, 0x0F, 0x63*obj+0x78 + 0x10, 0x9C)
//
// The pack resolver cell [0x80044F5C] and the frame tick are host boundaries,
// exactly as in item-list-draw.

export interface ShopActorDrawMemory {
    read32(addr: number): number;
    write32(addr: number, value: number): void;
}

export interface ShopActorDrawHost {
    initDrawContext(): void;
    setLayer(target: number, bucket: number): void;
    setOrigin(x: number, y: number): void;
    setScale(x: number, y: number, z: number): void;
    setPos(x: number, y: number): void;
    /** ctx+0x88, F0x8001ECEC. */
    paletteShift(value: number): void;
    drawSprite(packPtr: number, clip: number, x: number, y: number): void;
    /** packGetEntry handle -> directory pointer. */
    packResolve(handle: number): number;
    /** getFrameTickCounter(). */
    frameTick(): number;
}

const PACK_STSHOP = 0x04020000;

/** Actor draw fields touched by this function. */
export const SHOP_ACTOR_DRAW = {
    layer: 0x58,
    bucket: 0x5c,
    blinkOn: 0x6c,
    selected: 0x64,
    max: 0x68,
    lastBlinkTick: 0x70,
    cardIndex: 0x78,
    cardsVisible: 0x7c,
    paletteK: 0x80,
    lastPaletteTick: 0x84,
    foldMain: 0x90,
    foldA: 0xa0,
    foldB: 0xb0,
    foldC: 0xc0,
} as const;

/** F0x80083970(obj): draw the BUY actor's window and cards frame. */
export function shopActorBuyDraw(
    mem: ShopActorDrawMemory,
    obj: number,
    host: ShopActorDrawHost,
): void {
    host.initDrawContext();
    host.setLayer(mem.read32(obj + SHOP_ACTOR_DRAW.layer) | 0, mem.read32(obj + SHOP_ACTOR_DRAW.bucket) | 0);
    host.setOrigin(0x280, 0x100);

    const foldMain = mem.read32(obj + SHOP_ACTOR_DRAW.foldMain) | 0;
    if (foldMain !== 0) {
        host.setScale(foldMain, 0x1000, 0x1000);
        if (foldMain !== 0x1000) host.setPos(0x140, 0x42);
        host.drawSprite(host.packResolve(PACK_STSHOP), 0x0a, 0x9a, 0x34);
        if (foldMain !== 0x1000) {
            host.setPos(0x140, 0x59);
        } else {
            const tick = host.frameTick() | 0;
            if (((tick - (mem.read32(obj + SHOP_ACTOR_DRAW.lastBlinkTick) | 0)) | 0) >= 9) {
                mem.write32(obj + SHOP_ACTOR_DRAW.lastBlinkTick, tick >>> 0);
                mem.write32(obj + SHOP_ACTOR_DRAW.blinkOn, 1 - (mem.read32(obj + SHOP_ACTOR_DRAW.blinkOn) | 0));
            }
            if ((mem.read32(obj + SHOP_ACTOR_DRAW.blinkOn) | 0) !== 0) {
                if ((mem.read32(obj + SHOP_ACTOR_DRAW.selected) | 0) < (mem.read32(obj + SHOP_ACTOR_DRAW.max) | 0)) {
                    host.drawSprite(host.packResolve(PACK_STSHOP), 0x12, 0x122, 0x51);
                }
                if ((mem.read32(obj + SHOP_ACTOR_DRAW.selected) | 0) >= 2) {
                    host.drawSprite(host.packResolve(PACK_STSHOP), 0x13, 0x122, 0x5b);
                }
            }
        }
        host.drawSprite(host.packResolve(PACK_STSHOP), 0x0b, 0xf6, 0x4f);
    }

    const foldA = mem.read32(obj + SHOP_ACTOR_DRAW.foldA) | 0;
    if (foldA !== 0) {
        if (foldA !== 0x1000) {
            host.setScale(foldA, 0x1000, 0x1000);
            host.setPos(0x140, 0x32);
        } else {
            host.setScale(0x1000, 0x1000, 0x1000);
        }
        host.drawSprite(host.packResolve(PACK_STSHOP), 0x15, 0x7b, 0x26);
        if (foldA !== 0x1000) host.setPos(0x140, 0x57);
        host.drawSprite(host.packResolve(PACK_STSHOP), 0x0c, 0xaf, 0x43);
    }

    for (const field of [SHOP_ACTOR_DRAW.foldB, SHOP_ACTOR_DRAW.foldC]) {
        const fold = mem.read32(obj + field) | 0;
        if (fold === 0) continue;
        host.setLayer(mem.read32(obj + SHOP_ACTOR_DRAW.layer) | 0, (mem.read32(obj + SHOP_ACTOR_DRAW.bucket) | 0) - 2);
        if (fold !== 0x1000) {
            host.setScale(fold, 0x1000, 0x1000);
            host.setPos(0x140, 0x32);
        } else {
            host.setScale(0x1000, 0x1000, 0x1000);
        }
        host.drawSprite(host.packResolve(PACK_STSHOP), 0x15, 0x7b, 0x26);
    }

    if ((mem.read32(obj + SHOP_ACTOR_DRAW.cardsVisible) | 0) !== 0) {
        const tick = host.frameTick() | 0;
        if (((tick - (mem.read32(obj + SHOP_ACTOR_DRAW.lastPaletteTick) | 0)) | 0) >= 9) {
            mem.write32(obj + SHOP_ACTOR_DRAW.lastPaletteTick, tick >>> 0);
            let k = ((mem.read32(obj + SHOP_ACTOR_DRAW.paletteK) | 0) + 1) | 0;
            if (k >= 8) k = 0;
            mem.write32(obj + SHOP_ACTOR_DRAW.paletteK, k >>> 0);
        }
        host.setLayer(mem.read32(obj + SHOP_ACTOR_DRAW.layer) | 0, (mem.read32(obj + SHOP_ACTOR_DRAW.bucket) | 0) - 2);
        host.setScale(0x1000, 0x1000, 0x1000);
        host.paletteShift(mem.read32(obj + SHOP_ACTOR_DRAW.paletteK) | 0);
        host.drawSprite(
            host.packResolve(PACK_STSHOP),
            0x0f,
            Math.imul(mem.read32(obj + SHOP_ACTOR_DRAW.cardIndex) | 0, 0x63) + 0x10,
            0x9c,
        );
    }
}

/** F0x80085B18: draw the SELL category, list, quantity and confirm windows. */
export function shopActorSellDraw(
    mem: ShopActorDrawMemory,
    obj: number,
    host: ShopActorDrawHost,
): void {
    const read = (off: number): number => mem.read32(obj + off) | 0;
    const draw = (clip: number, x: number, y: number): void =>
        host.drawSprite(host.packResolve(PACK_STSHOP), clip, x, y);
    host.initDrawContext();
    host.setOrigin(0x280, 0x100);
    const fold5 = read(0xb4);
    if (fold5 !== 0) {
        host.setLayer(read(0x58), 1);
        if (fold5 !== 0x1000) {
            host.setScale(fold5, 0x1000, 0x1000);
            host.setPos(0x140, 0x41);
        }
        draw(0x0d, 0xa0, 0x24);
    }
    host.setLayer(read(0x58), read(0x5c));
    const category = read(0x84);
    if (category !== 0) {
        if (category !== 0x1000) {
            host.setScale(category, 0x1000, 0x1000);
            host.setPos(0x140, 0x4f);
        }
        draw(4, 0xa9, 0x26);
    }
    const list = read(0x94);
    if (list !== 0) {
        if (list !== 0x1000) {
            host.setScale(list, 0x1000, 0x1000);
            host.setPos(0x140, 0x42);
        }
        draw(0x0a, 0x9a, 0x34);
        if (list !== 0x1000) {
            host.setPos(0x140, 0x59);
        } else {
            const tick = host.frameTick() | 0;
            if (((tick - read(0x74)) | 0) >= 9) {
                mem.write32(obj + 0x74, host.frameTick() >>> 0);
                mem.write32(obj + 0x70, (1 - read(0x70)) >>> 0);
            }
            if (read(0x70) !== 0) {
                if (read(0x68) < read(0x6c)) draw(0x12, 0x122, 0x51);
                if (read(0x68) >= 2) draw(0x13, 0x122, 0x5b);
            }
        }
        draw(0x0b, 0xf6, 0x4f);
    }
    const confirm = read(0xa4);
    if (confirm !== 0) {
        if (confirm !== 0x1000) {
            host.setScale(confirm, 0x1000, 0x1000);
            host.setPos(0x140, 0x32);
        }
        draw(0x15, 0x7b, 0x26);
        if (confirm !== 0x1000) host.setPos(0x140, 0x57);
        draw(0x0c, 0xaf, 0x43);
    }
    const message = read(0xc4);
    if (message !== 0) {
        if (message !== 0x1000) {
            host.setScale(message, 0x1000, 0x1000);
            host.setPos(0x140, 0x8f);
        }
        draw(0x15, 0x7b, 0x84);
    }
}
