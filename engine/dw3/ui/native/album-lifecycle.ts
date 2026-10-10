// The card album screen's object: its constructor, its lifecycle dispatch and
// its in-screen chrome/paint state, translated bit-exactly from the original
// pro/stcrdabm overlay bodies.
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/lane-b/album-lifecycle.test.js runs the original through
// engine/native and compares the constructed object, the ordered boundary calls
// and the field writes.
//
//   F0x8008566C  build the album screen (factory F0x80014504 with handler
//                0x80085540, size 0xD8 and a 0x4C extra block), +0x50 = 0x1000,
//                +0x54 = 7.
//   F0x80085540  the screen lifecycle: state 1 runs the album tick then the
//                chrome; state 2 idles; state 3 does the resource service pair;
//                otherwise it starts the text banks through [0x80085A64], and
//                once +0x10 is 1 and [0x80085A68] reports ready, builds the
//                panel labels (F0x80083BFC), seeds +0xB8/+0xC8 with 8, sets
//                +0x64 = 0x1B, +0x78 = the flags, and calls +0x38.
//   F0x80084C38  the album tick state machine (the cursor, paging and window
//                open/close), drawing the panel.
//
// The chrome draw (F0x80084500) and the album draw state (F0x80084C38) are
// translated here where they share the object; the resident text-render context
// F0x8001EBF8 that the chrome draw uses at +0xB0 is a host boundary (it is not
// in engine/native's stub set), as are the widget constructors/methods, the
// [0x80044B38]/[0x80044F4C] resource services, the panel and grid helpers, the
// popup builder, the base methods and the frame cell [0x8004DE20]. The port
// preserves the exact call order and arguments. This is lane B
// (engine/dw3/ui/native/**); lane A owns the shared engine/dw3/ui/index.ts
// barrel and data/translated_functions.json.

import { BASE_TABLE } from "../create-text-element.ts";

/** The album screen's class handler installed at +0x48. */
export const ALBUM_SCREEN_HANDLER = 0x80085540;
export const ALBUM_SCREEN_SIZE = 0xd8;
export const ALBUM_SCREEN_EXTRA = 0x4c;
/** The album chrome sprite pack. */
export const PACK_ALBUM_CHROME = 0x06050000;
/** The animated cursor frame table, six frames. */
export const ALBUM_CURSOR_TABLE = 0x80085a4c;
export const ALBUM_CURSOR_FRAMES = 6;
/** The frame cell [0x8004DE20] the cursor/arrow animations compare against. */
export const ALBUM_FRAME_CELL = 0x8004de20;
/** The language/save block pointer cell whose +0x24 the labels read. */
export const ALBUM_SAVE_PTR_CELL = 0x8005cca8;

export interface AlbumMemory {
    read16(addr: number): number;
    read32(addr: number): number;
    write16(addr: number, value: number): void;
    write32(addr: number, value: number): void;
}

export interface AlbumCreateHost {
    /** Allocate `size` zero-filled bytes, as the factory does. */
    alloc(size: number): number;
}

/** F0x8008566C(): build the album screen object and return it. */
export function albumScreenCreate(mem: AlbumMemory, host: AlbumCreateHost): number {
    const obj = host.alloc(ALBUM_SCREEN_SIZE) >>> 0;
    const extra = host.alloc(ALBUM_SCREEN_EXTRA) >>> 0;
    mem.write32(obj + 0x24, extra);
    mem.write32(obj + 0x20, ALBUM_SCREEN_EXTRA >> 2);
    for (const entry of BASE_TABLE) {
        const off = entry[0];
        mem.write32(obj + off, (off === 0x48 ? ALBUM_SCREEN_HANDLER : entry[1]) >>> 0);
    }
    mem.write32(obj + 0x50, 0x1000);
    mem.write32(obj + 0x54, 7);
    return obj;
}

function s16(v: number): number {
    return (v << 16) >> 16;
}

export interface AlbumChromeHost {
    /** F0x8001F648(&ctx): the shared stack draw context. */
    initDrawContext(): void;
    setLayer(layer: number, bucket: number): void;
    setOrigin(x: number, y: number): void;
    setScale(x: number, y: number, z: number): void;
    setPos(x: number, y: number): void;
    m_0x88(a: number): void;
    drawSprite(packPtr: number, clip: number, x: number, y: number): void;
    packResolve(handle: number): number;
    /** F0x8001EBF8(&ctx): the resident text-render context. */
    initTextContext(): void;
    /** ctx+0x2C: set the text origin to a screen coordinate. */
    textSetPos(x: number): void;
    /** ctx+0x50(): the text context's status (1/2/else). */
    textStatus(): number;
    /** ctx+0x00: the text context's current page byte. */
    textPage(): number;
    /** [0x8004DE10]+0x188(): the display frame stamp. */
    frame(): number;
}

/** F0x80084500(obj): draw the album screen's chrome. */
export function albumDrawChrome(
    mem: AlbumMemory,
    obj: number,
    host: AlbumChromeHost,
): void {
    host.initDrawContext();
    host.setOrigin(0x280, 0);
    host.setLayer(mem.read32(obj + 0x50) | 0, mem.read32(obj + 0x54) | 0);

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
    host.drawSprite(host.packResolve(PACK_ALBUM_CHROME), 8, spinValue, spinValue);

    host.setLayer(mem.read32(obj + 0x50) | 0, (mem.read32(obj + 0x54) | 0) - 2);

    const c0 = mem.read32(obj + 0xc0) | 0;
    if (c0 !== 0) {
        if (c0 !== 0x1000) {
            host.setScale(c0, 0x1000, 0x1000);
            host.setPos(0, 0x20);
        }
        host.drawSprite(host.packResolve(PACK_ALBUM_CHROME), 9, 0, 0x15);
        if ((mem.read32(obj + 0xc0) | 0) !== 0x1000) host.setPos(0x140, 0x20);
        host.drawSprite(host.packResolve(PACK_ALBUM_CHROME), 0xf, 0xc8, 0x15);
        const c0b = mem.read32(obj + 0xc0) | 0;
        if (c0b !== 0x1000) {
            host.setScale(c0b, c0b, 0x1000);
            host.setPos(0x3a, 0xa5);
        }
        host.drawSprite(host.packResolve(PACK_ALBUM_CHROME), 0xe, 0x22, 0x9a);
    }

    if ((mem.read32(obj + 0x68) | 0) !== 0) {
        if ((mem.read32(obj + 0x64) | 0) >= 2) {
            if (((host.frame() | 0) - (mem.read32(obj + 0x70) | 0)) >= 0x11) {
                mem.write32(obj + 0x70, host.frame() | 0);
                mem.write32(obj + 0x6c, (1 - (mem.read32(obj + 0x6c) | 0)) | 0);
            }
            if ((mem.read32(obj + 0x6c) | 0) !== 0) {
                if ((mem.read32(obj + 0x60) | 0) > 0) {
                    host.drawSprite(host.packResolve(PACK_ALBUM_CHROME), 0x1a, 0xe, 0x5a);
                }
                if ((mem.read32(obj + 0x60) | 0) < ((mem.read32(obj + 0x64) | 0) - 1)) {
                    host.drawSprite(host.packResolve(PACK_ALBUM_CHROME), 0x1b, 0x121, 0x5a);
                }
            }
        }
        if ((mem.read32(obj + 0x7c) | 0) !== 0) {
            if (((host.frame() | 0) - (mem.read32(obj + 0xb4) | 0)) >= 0x11) {
                mem.write32(obj + 0xb4, host.frame() | 0);
                let frame = (mem.read32(obj + 0xb0) | 0) + 1;
                if (frame >= ALBUM_CURSOR_FRAMES) frame = 0;
                mem.write32(obj + 0xb0, frame);
            }
            host.m_0x88(mem.read32(ALBUM_CURSOR_TABLE + Math.imul(mem.read32(obj + 0xb0) | 0, 4)) >>> 0);
            host.drawSprite(
                host.packResolve(PACK_ALBUM_CHROME),
                7,
                Math.imul((mem.read32(obj + 0x74) | 0) % 6, 0x2a) + 0x24,
                Math.imul(((mem.read32(obj + 0x74) | 0) / 6) | 0, 0x36) + 0x32,
            );
            host.m_0x88(0);
        }
    }

    if ((mem.read32(obj + 0xd0) | 0) !== 0) {
        host.initTextContext();
        host.textSetPos(mem.read32(obj + 0x78) | 0);
        const d0 = mem.read32(obj + 0xd0) | 0;
        if (d0 !== 0x1000) {
            host.setScale(d0, 0x1000, 0x1000);
            host.setPos(0x140, 0xa8);
        }
        const status = host.textStatus() | 0;
        let var_s0 = 0;
        if (status === 1) var_s0 = 0x12;
        else if (status === 2) var_s0 = 0x13;
        else var_s0 = (host.textPage() | 0) + 0x13;
        host.drawSprite(host.packResolve(PACK_ALBUM_CHROME), var_s0, 0x103, 0x9f);
        host.drawSprite(host.packResolve(PACK_ALBUM_CHROME), 0xd, 0xfc, 0x9d);
        if ((mem.read32(obj + 0xd0) | 0) !== 0x1000) host.setPos(0x140, 0xa8);
        host.drawSprite(host.packResolve(PACK_ALBUM_CHROME), 0xa, 0x82, 0x9d);
        if ((mem.read32(obj + 0xd0) | 0) !== 0x1000) host.setPos(0x140, 0xd0);
        host.drawSprite(host.packResolve(PACK_ALBUM_CHROME), 0x10, 0x103, 0xc5);
        host.drawSprite(host.packResolve(PACK_ALBUM_CHROME), 0xd, 0xfc, 0xc3);
        if ((mem.read32(obj + 0xd0) | 0) !== 0x1000) host.setPos(0x140, 0xc6);
        const card = mem.read32(obj + 0x78) | 0;
        if (status !== 0) {
            host.drawSprite(host.packResolve(PACK_ALBUM_CHROME), 0xb, 0x4a, 0xb3);
        } else if (
            card === 0x45 || card === 0x70 || card === 0x9b || card === 0xc6 || card === 0xf1
        ) {
            host.drawSprite(host.packResolve(PACK_ALBUM_CHROME), 0xb, 0x4a, 0xb3);
        } else {
            host.drawSprite(host.packResolve(PACK_ALBUM_CHROME), 0xc, 0xc7, 0xb3);
        }
    }
}

export interface AlbumLifecycleHost extends AlbumChromeHost {
    /** F0x80084C38(obj, ctx): the album tick state machine. */
    call84c38(obj: number, ctx: number): void;
    /** F0x80083BFC(obj, ctx): build the album panel labels. */
    call83bfc(obj: number, ctx: number): void;
    /** [0x80085A64](value): start the text-bank request. */
    startBanks(value: number): void;
    /** [0x80085A68](value): nonzero while the banks are still pending. */
    banksPending(value: number): number;
    /** obj->+0x38(obj). */
    baseMethod38(obj: number): void;
    /** [0x80048D34]+0x270C(a, b). */
    resourceCall(a: number, b: number): void;
    /** [0x80048D34]+0x2714(flag). */
    resource2714(flag: number): number;
}

/** F0x80085540(obj, ctx): the album screen's lifecycle tick. */
export function albumScreenLifecycle(
    mem: AlbumMemory,
    obj: number,
    ctx: number,
    host: AlbumLifecycleHost,
): void {
    const state = mem.read32(obj + 0x0c) | 0;

    if (state === 1) {
        host.call84c38(obj, ctx);
        albumDrawChrome(mem, obj, host);
        return;
    }
    if (state === 2) return;

    if (state === 3) {
        host.resourceCall(host.resource2714(1), 0);
        return;
    }

    const sub = mem.read32(obj + 0x10) | 0;
    if (sub === 1) {
        if ((host.banksPending(1) | 0) !== 0) return;
        host.call83bfc(obj, ctx);
        mem.write32(obj + 0xb8, 8);
        mem.write32(obj + 0xc8, 8);
        mem.write32(obj + 0x64, 0x1b);
        mem.write32(obj + 0x78, sub);
        host.baseMethod38(obj);
        return;
    }
    host.startBanks(1);
    mem.write32(obj + 0x10, sub + 1);
}
