// The card folder screen's object constructor and its chrome draw, translated
// bit-exactly from the original pro/stcrddek overlay bodies.
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/lane-b/folder-screen.test.js runs the original through
// engine/native and compares the constructed object and the draw intents.
//
//   F0x8008A0B8  build the folder screen (factory F0x80014504 with handler
//                0x80089E98, size 0x120 and a 0x6C extra block): base table
//                +0x28..+0x4C, +0x11C = 0x8008924C, +0x50 = 0x1000,
//                +0x54 = 7.
//   F0x80088E74  draw the screen's chrome: the animated background band (8),
//                the puzzle preview (0x30), the three card slots (0x41) and the
//                two extra frames (0x2D/0x42/0x44), through the standard draw
//                context and the 0x063E0000 folder pack. The +0x58/+0x5C
//                pair is the band's ping-pong counter; +0xE4's branch is gated
//                by the shared time cell [0x8004DF98].
//
// This is lane B (engine/dw3/ui/native/**); lane A owns the shared
// engine/dw3/ui/index.ts barrel and the registry.

import { BASE_TABLE } from "../create-text-element.ts";

/** The folder screen's class handler installed at +0x48. */
export const FOLDER_SCREEN_HANDLER = 0x80089e98;
export const FOLDER_SCREEN_SIZE = 0x120;
export const FOLDER_SCREEN_EXTRA = 0x6c;
/** The folder chrome sprite pack. */
export const PACK_FOLDER = 0x063e0000;
/** The shared frame/time cell the band animation reads. */
export const FOLDER_TIME_CELL = 0x8004df98;

export interface FolderScreenMemory {
    read32(addr: number): number;
    write32(addr: number, value: number): void;
}

export interface FolderScreenCreateHost {
    /** Allocate `size` zero-filled bytes, as the factory does. */
    alloc(size: number): number;
}

/** F0x8008A0B8: build the folder screen object and return it. */
export function folderScreenCreate(
    mem: FolderScreenMemory,
    host: FolderScreenCreateHost,
): number {
    const obj = host.alloc(FOLDER_SCREEN_SIZE) >>> 0;
    const extra = host.alloc(FOLDER_SCREEN_EXTRA) >>> 0;
    mem.write32(obj + 0x24, extra);
    mem.write32(obj + 0x20, FOLDER_SCREEN_EXTRA >> 2);
    for (const entry of BASE_TABLE) {
        const off = entry[0];
        mem.write32(obj + off, (off === 0x48 ? FOLDER_SCREEN_HANDLER : entry[1]) >>> 0);
    }
    mem.write32(obj + 0x11c, 0x8008924c);
    mem.write32(obj + 0x50, 0x1000);
    mem.write32(obj + 0x54, 7);
    return obj;
}

export interface FolderChromeHost {
    initDrawContext(): void;
    setLayer(layer: number, bucket: number): void;
    setOrigin(x: number, y: number): void;
    setScale(x: number, y: number, z: number): void;
    setPos(x: number, y: number): void;
    /** ctx+0x88. */
    m_0x88(value: number): void;
    drawSprite(packPtr: number, clip: number, x: number, y: number): void;
    packResolve(handle: number): number;
    /** [0x8004DF98](): the shared frame stamp. */
    now(): number;
}

/** F0x80088E74(obj): draw the folder screen's chrome. */
export function folderDrawChrome(
    mem: FolderScreenMemory,
    obj: number,
    host: FolderChromeHost,
): void {
    host.initDrawContext();
    host.setLayer(mem.read32(obj + 0x50) | 0, mem.read32(obj + 0x54) | 0);
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
    host.drawSprite(host.packResolve(PACK_FOLDER), 8, spinValue, spinValue);

    host.setLayer(mem.read32(obj + 0x50) | 0, (mem.read32(obj + 0x54) | 0) - 1);
    const c4 = mem.read32(obj + 0xc4) | 0;
    if (c4 !== 0) {
        if (c4 !== 0x1000) {
            host.setScale(c4, 0x1000, 0x1000);
            host.setPos(0x140, 0x22);
        }
        host.drawSprite(host.packResolve(PACK_FOLDER), 0x30, 0x7b, 0x1c);
    }

    let slotY = 0x63;
    let cellY = 0x50;
    let slot = obj;
    for (let i = 0; i < 3; i++) {
        const f4 = mem.read32(slot + 0xf4) | 0;
        if (f4 !== 0) {
            host.setScale(f4, 0x1000, 0x1000);
            if ((mem.read32(slot + 0xf4) | 0) !== 0x1000) host.setPos(0x17, slotY);
            host.drawSprite(host.packResolve(PACK_FOLDER), 0x41, 0x17, cellY);
        }
        cellY += 0x2d;
        slotY += 0x2d;
        slot += 0x10;
    }

    const d4 = mem.read32(obj + 0xd4) | 0;
    if (d4 !== 0) {
        host.setScale(d4, 0x1000, 0x1000);
        if ((mem.read32(obj + 0xd4) | 0) !== 0x1000) host.setPos(0x140, 0x37);
        host.drawSprite(host.packResolve(PACK_FOLDER), 0x2d, 0x92, 0x1c);
    }

    if ((mem.read32(obj + 0xe4) | 0) === 0) return;
    host.setLayer(mem.read32(obj + 0x50) | 0, (mem.read32(obj + 0x54) | 0) - 2);
    host.setScale(0x1000, mem.read32(obj + 0xe4) | 0, 0x1000);
    if ((mem.read32(obj + 0xe4) | 0) !== 0x1000) {
        host.setPos(0x17, Math.imul(mem.read32(obj + 0x60) | 0, 0x2d) + 0x63);
    }
    const x = Math.imul(mem.read32(obj + 0x60) | 0, 0x2d) + 0x50;
    if ((mem.read32(obj + 0x64) | 0) === 0) {
        if (((host.now() | 0) - (mem.read32(obj + 0x6c) | 0)) >= 5) {
            mem.write32(obj + 0x6c, host.now() | 0);
            let frame = (mem.read32(obj + 0x68) | 0) + 1;
            if (frame >= 0x10) frame = 0;
            mem.write32(obj + 0x68, frame);
        }
        host.m_0x88(mem.read32(obj + 0x68) | 0);
        host.drawSprite(host.packResolve(PACK_FOLDER), 0x42, 0x17, x);
        return;
    }
    host.drawSprite(host.packResolve(PACK_FOLDER), 0x44, 0x17, x);
}
