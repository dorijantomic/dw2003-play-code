// The naming screen's object constructor, its text-bank load pair and its idle
// shimmer draw, translated bit-exactly from the original pro/stdgname bodies.
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/lane-b/name-screen.test.js runs the original through
// engine/native and compares the constructed object, the ordered bank calls,
// the ready result and the shimmer draw intents.
//
//   F0x800865B0  build the naming screen (factory F0x80014504 with handler
//                0x8008645C, size 0x6C and a 0x10 extra block): base table
//                +0x28..+0x4C, +0x68 = 0x8008656C, +0x50 = 0x1000.
//   F0x800865F0  register the 0x80087F3C resource descriptor (4), then build
//                the F0x8001FFA8 request context, origin (0x280,0), resolve pack
//                0x02890000 and request save+0x40, 0x771, save+0x86.
//   F0x800866AC  poll save+0x40, 0x771, save+0x86, returning 1 on the first
//                that is still loading, else the last id's own boolean.
//   F0x80086368  the idle shimmer: layer +0x50 at 7, the pack-0x31 base sprite,
//                then the +0x5C/+0x58 ping-pong counter wrapping at 0x5F and the
//                pack-0x24 sprite at that offset. Pack 0x02880000.
//
// "save" is *(s32*)0x8005CCA8. This is lane B (engine/dw3/ui/native/**);
// lane A owns the shared engine/dw3/ui/index.ts barrel and the registry.

import { BASE_TABLE } from "../create-text-element.ts";
import type { AlbumBanksHost } from "./album-banks.ts";

/** The naming screen's class handler installed at +0x48. */
export const NAME_SCREEN_HANDLER = 0x8008645c;
export const NAME_SCREEN_SIZE = 0x6c;
export const NAME_SCREEN_EXTRA = 0x10;
/** The resource descriptor registered before the bank request. */
export const NAME_RESOURCE_DESC = 0x80087f3c;
/** The naming text pack. */
export const PACK_NAME_TEXT = 0x02890000;
/** The idle shimmer sprite pack. */
export const PACK_NAME = 0x02880000;
/** The save-global block. */
export const NAME_SAVE_PTR = 0x8005cca8;

export interface NameScreenMemory {
    read32(addr: number): number;
    write32(addr: number, value: number): void;
}

export interface NameScreenCreateHost {
    /** Allocate `size` zero-filled bytes, as the factory does. */
    alloc(size: number): number;
}

/** F0x800865B0: build the naming screen object and return it. */
export function nameScreenCreate(mem: NameScreenMemory, host: NameScreenCreateHost): number {
    const obj = host.alloc(NAME_SCREEN_SIZE) >>> 0;
    const extra = host.alloc(NAME_SCREEN_EXTRA) >>> 0;
    mem.write32(obj + 0x24, extra);
    mem.write32(obj + 0x20, NAME_SCREEN_EXTRA >> 2);
    for (const entry of BASE_TABLE) {
        const off = entry[0];
        mem.write32(obj + off, (off === 0x48 ? NAME_SCREEN_HANDLER : entry[1]) >>> 0);
    }
    mem.write32(obj + 0x68, 0x8008656c);
    mem.write32(obj + 0x50, 0x1000);
    return obj;
}

export interface NameBanksHost extends AlbumBanksHost {
    /** [0x8004B600](descriptor, count): register a text resource descriptor. */
    registerResource(descriptor: number, count: number): void;
}

/** F0x800865F0: register the descriptor and request the naming text banks. */
export function nameScreenRequestBanks(mem: NameScreenMemory, host: NameBanksHost): void {
    host.registerResource(NAME_RESOURCE_DESC, 4);
    host.beginRequestContext();
    host.requestContextOrigin(0x280, 0);
    host.requestContextPack(host.packResolve(PACK_NAME_TEXT));
    const save = mem.read32(NAME_SAVE_PTR) | 0;
    host.requestBank(save + 0x40);
    host.requestBank(0x771);
    host.requestBank(save + 0x86);
}

/** F0x800866AC: 1 while any naming text bank is still loading, else 0. */
export function nameScreenBanksReady(mem: NameScreenMemory, host: AlbumBanksHost): number {
    const save = mem.read32(NAME_SAVE_PTR) | 0;
    if ((host.pollBank(0x771) | 0) !== 0) return 1;
    if ((host.pollBank(save + 0x40) | 0) !== 0) return 1;
    return (host.pollBank(save + 0x86) | 0) !== 0 ? 1 : 0;
}

export interface NameShimmerHost {
    initDrawContext(): void;
    setLayer(layer: number, bucket: number): void;
    setOrigin(x: number, y: number): void;
    drawSprite(packPtr: number, clip: number, x: number, y: number): void;
    packResolve(handle: number): number;
}

/** F0x80086368: draw the naming screen's idle shimmer band. */
export function nameScreenIdleShimmer(mem: NameScreenMemory, obj: number, host: NameShimmerHost): void {
    host.initDrawContext();
    host.setLayer(mem.read32(obj + 0x50) | 0, 7);
    host.setOrigin(0x280, 0);
    host.drawSprite(host.packResolve(PACK_NAME), 0x31, 0, 0);

    if ((mem.read32(obj + 0x5c) | 0) !== 0) {
        const old = mem.read32(obj + 0x58) | 0;
        const next = old + 1;
        mem.write32(obj + 0x58, next);
        mem.write32(obj + 0x58, old < 0x5f ? next : 0);
        mem.write32(obj + 0x5c, 0);
    } else {
        mem.write32(obj + 0x5c, 1);
    }
    const value = mem.read32(obj + 0x58) | 0;
    host.drawSprite(host.packResolve(PACK_NAME), 0x24, value, value);
}
