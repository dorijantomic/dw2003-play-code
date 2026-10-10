// The card shop screen's object: its constructor, its lifecycle dispatch and
// its chrome draw, translated bit-exactly from the original pro/stcrdshp
// overlay bodies.
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/lane-b/card-shop-screen.test.js runs the original through
// engine/native and compares the constructed object, the field writes, the
// ordered boundary calls and the chrome draw intents.
//
//   F0x80088CA0  build the card shop screen (factory F0x80014504 with handler
//                0x80088B50, size 0x3CC and a 0x2C extra block): +0x3C8 =
//                0x80088AFC, +0x50 = 0x1000, +0x54 = 7, +0x60 = the shop-id
//                service, +0x64 = the current stage's shop id from the
//                stage→shop table at 0x8008CB28 (default 0x1F), +0x6C = 2 when
//                the stage's mode is 0x400, then seven bank requests.
//   F0x80088B50  the screen lifecycle:
//                 state 1  root tick (F0x8008838C) then the chrome draw.
//                 state 2  nothing.
//                 state 3  the resource service pair.
//                 else     start the text banks through [0x8008CB80]; once
//                          +0x10 is 1 and [0x8008CB84] reports ready, build the
//                          labels (F0x80087D00), seed +0x398/+0x3A8/+0x3B8 with
//                          0xA and call +0x38.
//   F0x800880C4  draw the screen's chrome: the animated band (8), the shop
//                frames at +0x3A0/+0x3B0/+0x3C0, through the standard draw
//                context and the 0x063E0000 shop pack.
//
// The draw context is the engine/native stub boundary; the factory allocation,
// the stage global, the shop-id / mode / bank-request services, the root tick,
// the label builder and the bank service cells are host boundaries; the port
// preserves the exact call order and arguments. This is lane B
// (engine/dw3/ui/native/**); lane A owns the shared engine/dw3/ui/index.ts
// barrel and data/translated_functions.json.

import { BASE_TABLE } from "../create-text-element.ts";

/** The card shop screen's class handler installed at +0x48. */
export const SHOP_SCREEN_HANDLER = 0x80088b50;
export const SHOP_SCREEN_SIZE = 0x3cc;
export const SHOP_SCREEN_EXTRA = 0x2c;
/** The label object method installed at +0x3C8. */
export const SHOP_SCREEN_LABEL_METHOD = 0x80088afc;
/** The statically initialised stage id → shop id table (pairs, zero-terminated). */
export const SHOP_STAGE_TABLE = 0x8008cb28;
/** The current stage id global ([0x80048D34]+0x34). */
export const SHOP_STAGE_GLOBAL = 0x80048d34 + 0x34;
/** The language/save block pointer cell (reads +0x16 / +0x1D bank ids). */
export const SHOP_SAVE_PTR_CELL = 0x8005cca8;
/** The shop chrome sprite pack. */
export const PACK_SHOP = 0x063e0000;
/** Shop id used when the stage is not in the table. */
export const SHOP_DEFAULT_ID = 0x1f;
/** Stage mode that switches the screen to its second layout. */
export const SHOP_MODE_TWO = 0x400;

export interface ShopScreenMemory {
    read16(addr: number): number;
    read32(addr: number): number;
    write32(addr: number, value: number): void;
}

export interface ShopScreenCreateHost {
    /** Allocate `size` zero-filled bytes, as the factory does. */
    alloc(size: number): number;
    /** [0x80048D34]+0x2708(): the shop-id service. */
    shopId(): number;
    /** [0x8004B448](stageId): the stage mode. */
    shopMode(stageId: number): number;
    /** [0x80044B38]+0x40C(id): request a text bank. */
    bankRequest(id: number): void;
}

/** F0x80088CA0(): build the card shop screen and return it. */
export function shopScreenCreate(
    mem: ShopScreenMemory,
    host: ShopScreenCreateHost,
): number {
    const obj = host.alloc(SHOP_SCREEN_SIZE) >>> 0;
    const extra = host.alloc(SHOP_SCREEN_EXTRA) >>> 0;
    mem.write32(obj + 0x24, extra);
    mem.write32(obj + 0x20, SHOP_SCREEN_EXTRA >> 2);
    for (const entry of BASE_TABLE) {
        const off = entry[0];
        mem.write32(obj + off, (off === 0x48 ? SHOP_SCREEN_HANDLER : entry[1]) >>> 0);
    }
    mem.write32(obj + 0x3c8, SHOP_SCREEN_LABEL_METHOD);
    mem.write32(obj + 0x50, 0x1000);
    mem.write32(obj + 0x54, 7);
    mem.write32(obj + 0x60, host.shopId() | 0);

    const stage = mem.read32(SHOP_STAGE_GLOBAL) | 0;
    let entry = SHOP_STAGE_TABLE;
    if ((mem.read32(entry) | 0) !== 0) {
        do {
            if ((mem.read32(entry) | 0) === stage) mem.write32(obj + 0x64, mem.read32(entry + 4) | 0);
            entry += 8;
        } while ((mem.read32(entry) | 0) !== 0);
    }
    if ((mem.read32(obj + 0x64) | 0) === 0) mem.write32(obj + 0x64, SHOP_DEFAULT_ID);

    if ((host.shopMode(stage) | 0) === SHOP_MODE_TWO) mem.write32(obj + 0x6c, 2);

    host.bankRequest(0x7f6);
    host.bankRequest(0x7f7);
    host.bankRequest(0x7f8);
    host.bankRequest(0x7f9);
    host.bankRequest(0x7fa);
    host.bankRequest((mem.read32(SHOP_SAVE_PTR_CELL) | 0) + 0x16);
    host.bankRequest((mem.read32(SHOP_SAVE_PTR_CELL) | 0) + 0x1d);
    return obj;
}

export interface ShopChromeHost {
    initDrawContext(): void;
    setLayer(layer: number, bucket: number): void;
    setOrigin(x: number, y: number): void;
    setScale(x: number, y: number, z: number): void;
    setPos(x: number, y: number): void;
    drawSprite(packPtr: number, clip: number, x: number, y: number): void;
    packResolve(handle: number): number;
}

/** F0x800880C4(obj): draw the card shop screen's chrome. */
export function shopDrawChrome(
    mem: ShopScreenMemory,
    obj: number,
    host: ShopChromeHost,
): void {
    host.initDrawContext();
    host.setLayer(mem.read32(obj + 0x50) | 0, 7);
    host.setOrigin(0x280, 0);

    // Band ping-pong counter: +0x5C toggles; +0x58 advances 0..0x5F.
    let spin = 0;
    if ((mem.read32(obj + 0x5c) | 0) !== 0) {
        const next = (mem.read32(obj + 0x58) | 0) + 1;
        mem.write32(obj + 0x58, next);
        if (next < 0x60) spin = next;
        mem.write32(obj + 0x58, spin);
        mem.write32(obj + 0x5c, 0);
    } else {
        mem.write32(obj + 0x5c, 1);
    }
    const spinValue = mem.read32(obj + 0x58) | 0;
    host.drawSprite(host.packResolve(PACK_SHOP), 8, spinValue, spinValue);

    host.setLayer(mem.read32(obj + 0x50) | 0, (mem.read32(obj + 0x54) | 0) - 1);

    const a = mem.read32(obj + 0x3a0) | 0;
    if (a !== 0) {
        if (a !== 0x1000) {
            host.setScale(a, 0x1000, 0x1000);
            host.setPos(0x57, 0x1b);
        }
        host.drawSprite(host.packResolve(PACK_SHOP), 0x28, 0x16, 0x14);
        if ((mem.read32(obj + 0x3a0) | 0) !== 0x1000) host.setPos(0x140, 0x1d);
        host.drawSprite(host.packResolve(PACK_SHOP), 0x29, 0xd6, 0x15);
    }

    const b = mem.read32(obj + 0x3b0) | 0;
    if (b !== 0) {
        if (b !== 0x1000) {
            host.setScale(b, 0x1000, 0x1000);
            host.setPos(0x140, 0x49);
        }
        host.drawSprite(host.packResolve(PACK_SHOP), 0x2f, 0x92, 0x2e);
        if ((mem.read32(obj + 0x3b0) | 0) !== 0x1000) host.setPos(0x140, 0xd2);
        host.drawSprite(host.packResolve(PACK_SHOP), 0xf, 0xc6, 0xc4);
    }

    const c = mem.read32(obj + 0x3c0) | 0;
    if (c !== 0) {
        if (c !== 0x1000) {
            host.setScale(c, 0x1000, 0x1000);
            host.setPos(0x140, 0x77);
        }
        host.drawSprite(host.packResolve(PACK_SHOP), 0x2c, 0x7b, 0x6b);
    }
}

export interface ShopScreenLifecycleHost extends ShopChromeHost {
    /** F0x8008838C(obj, ctx): the shop root tick. */
    call8838c(obj: number, ctx: number): void;
    /** F0x80087D00(obj, ctx): build the shop labels. */
    call87d00(obj: number, ctx: number): void;
    /** [0x8008CB80](value): start the text-bank request. */
    startBanks(value: number): void;
    /** [0x8008CB84](value): nonzero while the banks are still pending. */
    banksPending(value: number): number;
    /** obj->+0x38(obj). */
    baseMethod38(obj: number): void;
    /** [0x80048D34]+0x270C(a, b). */
    resourceCall(a: number, b: number): void;
    /** [0x80048D34]+0x2708(flag). */
    shopIdFor(flag: number): number;
}

/** F0x80088B50(obj, ctx): the card shop screen's lifecycle tick. */
export function shopScreenLifecycle(
    mem: ShopScreenMemory,
    obj: number,
    ctx: number,
    host: ShopScreenLifecycleHost,
): void {
    const state = mem.read32(obj + 0x0c) | 0;

    if (state === 1) {
        host.call8838c(obj, ctx);
        shopDrawChrome(mem, obj, host);
        return;
    }
    if (state === 2) return;

    if (state === 3) {
        if ((mem.read32(obj + 0x68) | 0) !== 0) {
            host.resourceCall(0x400, host.shopIdFor(1));
            return;
        }
        host.resourceCall(mem.read32(SHOP_STAGE_GLOBAL) | 0, 0);
        return;
    }

    const sub = mem.read32(obj + 0x10) | 0;
    if (sub === 1) {
        if ((host.banksPending(1) | 0) !== 0) return;
        host.call87d00(obj, ctx);
        mem.write32(obj + 0x398, 0xa);
        mem.write32(obj + 0x3a8, 0xa);
        mem.write32(obj + 0x3b8, 0xa);
        host.baseMethod38(obj);
        return;
    }
    host.startBanks(1);
    mem.write32(obj + 0x10, sub + 1);
}
