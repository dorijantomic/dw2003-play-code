// The field conversation balloon's FRAME: outline sprite pieces plus the
// semi-transparent body fill, translated from the resident EXE F0x8001C050.
//
// Oracle: tests/lane-b/dialogue-frame.test.js runs the original through
// engine/native on resident.bin and compares the ordered calls, the primitive
// bytes written and the ordering-table link words.
// Worklist: .dw3-research/screen-worklists-2026-10-01/dialogue.md.
//
// Balloon (obj+0x50) fields read: +0x54 draw layer, +0x58 mode (0..3),
// +0x60 / +0x62 position (s16), +0x64 width / tail x, +0x66 height.
// Outline table D0x8004DCF8: 0x20 bytes per mode, four (x, y) s16 pairs.
// Piece 0 clip is the s32 at D0x8004DCF8 - 4 + mode * 0x20 (the last word of
// the previous entry; the original never advances that pointer). Piece 1 uses
// clip 0 and x - tail (+0x64 when mode < 2, else 0). Piece 2 is never drawn.
// Piece 3 uses clip 2, and for modes 2 and 3 x = +0x64 - 0xE (table x ignored).
// Fill table D0x8004DD00: 0x20 bytes per mode, s16 (x, y) offsets at +0 / +2.
//
// The fill is a GPU POLY_FT4 (textured quad) packet of 0x28 bytes + tag:
// tag byte 3 = 9 words, rgb 80,80,80, code 0x2E (0x2C | semi-transparent),
// clut 0x2C57, tpage 0x45 (page x 320, y 0, 4-bit, abr 2 = B-F), uv rect
// (0xBC,0)-(0xC7,0x3E). Corners: x0 = pos.x + tbl.x - tail, x1 = x0 + width,
// y0 = pos.y + tbl.y, y1 = y0 + height (all wrap to 16 bits).
//
// The draw context (F0x8001F648 + slots), the pack getter, the ordering-table
// service ([0x8004DE10+0x17C / +0x158 / +0x15C]) are host boundaries.

export const FRAME_ADDR = 0x8001c050;
export const FRAME_OUTLINE_TABLE = 0x8004dcf8;
export const FRAME_FILL_TABLE = 0x8004dd00;
export const FRAME_PACK = 0x02860000;
export const FRAME_PRIM_SIZE = 0x28;

export interface FrameMemory {
    read8(addr: number): number;
    read16(addr: number): number;
    read16s(addr: number): number;
    read32(addr: number): number;
    write8(addr: number, value: number): void;
    write16(addr: number, value: number): void;
    write32(addr: number, value: number): void;
}

/** What the browser needs to paint the fill (the packet bytes stay authoritative). */
export interface FrameFillIntent {
    primitive: "POLY_FT4";
    code: number;
    color: [number, number, number];
    semiTransparent: boolean;
    abr: number;
    tpage: number;
    clut: number;
    uv: [number, number, number, number, number, number, number, number];
    /** Corners x0,y0 x1,y1 x2,y2 x3,y3 in packet order (TL, TR, BL, BR). */
    corners: [number, number, number, number, number, number, number, number];
}

export interface FrameHost {
    /** F0x8001F648(&ctx): the shared stack draw context. */
    initDrawContext(): void;
    setLayer(layer: number, bucket: number): void;
    setOrigin(x: number, y: number): void;
    drawSprite(packPtr: number, clip: number, x: number, y: number): void;
    /** [0x80044F5C](handle): the pack getter. */
    packResolve(handle: number): number;
    /** [0x8004DE10+0x17C](layer): the layer's draw object. */
    layerObject(layer: number): number;
    /** obj.method[0x138](obj, 0): address of the ordering-table head word. */
    orderingHead(obj: number): number;
    /** [0x8004DE10+0x158](height, mode << 5): allocate a 0x28+ byte primitive. */
    allocPrim(a0: number, a1: number): number;
    /** [0x8004DE10+0x15C](prim + 0x28, link, 0xFF000000): advance the packet pointer. */
    commitPrim(next: number, link: number, mask: number, intent: FrameFillIntent): void;
}

const u32 = (v: number): number => v >>> 0;
const s32 = (v: number): number => v | 0;
const s16 = (v: number): number => (v << 16) >> 16;
const u16 = (v: number): number => v & 0xffff;

/** F0x8001C050(task): draw the balloon outline pieces, then queue the fill. */
export function dialogueFrameDraw(mem: FrameMemory, host: FrameHost, task: number): void {
    const balloon = u32(mem.read32(task + 0x50));
    const mode = u32(mem.read32(balloon + 0x58));
    const sub = mode < 2 ? mem.read16s(balloon + 0x64) : 0;
    const entry = u32(FRAME_OUTLINE_TABLE + (mode << 5));
    host.initDrawContext();
    host.setLayer(s32(mem.read32(u32(mem.read32(task + 0x50)) + 0x54)), 0);
    host.setOrigin(0x140, 0);
    for (let i = 0; i < 4; i++) {
        if (i === 2) continue;
        const px = mem.read16s(entry + 4 * i);
        const py = mem.read16s(entry + 4 * i + 2);
        let clip: number;
        let x: number;
        let b: number;
        if (i === 0) {
            const pack = host.packResolve(FRAME_PACK);
            clip = s32(mem.read32(entry - 4));
            b = u32(mem.read32(task + 0x50));
            x = mem.read16s(b + 0x60) + px;
            host.drawSprite(pack, clip, s32(x), s32(mem.read16s(b + 0x62) + py));
        } else if (i === 1) {
            const pack = host.packResolve(FRAME_PACK);
            b = u32(mem.read32(task + 0x50));
            x = px + mem.read16s(b + 0x60) - sub;
            host.drawSprite(pack, 0, s32(x), s32(mem.read16s(b + 0x62) + py));
        } else {
            let xo = px;
            if (mode >= 2) {
                xo = mem.read16s(u32(mem.read32(task + 0x50)) + 0x64) - 0xe;
            }
            const pack = host.packResolve(FRAME_PACK);
            b = u32(mem.read32(task + 0x50));
            host.drawSprite(pack, 2, s32(mem.read16s(b + 0x60) + xo), s32(mem.read16s(b + 0x62) + py));
        }
    }

    const layerObj = host.layerObject(s32(mem.read32(u32(mem.read32(task + 0x50)) + 0x54)));
    const ot = u32(host.orderingHead(layerObj));
    const fill = u32(FRAME_FILL_TABLE + (mode << 5));
    const b1 = u32(mem.read32(task + 0x50));
    const x0 = u16(u16(mem.read16(b1 + 0x60) + mem.read16(fill)) - u16(sub));
    const x1 = u16(x0 + mem.read16(u32(mem.read32(task + 0x50)) + 0x64));
    const y0 = u16(mem.read16(u32(mem.read32(task + 0x50)) + 0x62) + mem.read16(fill + 2));
    const h = mem.read16(u32(mem.read32(task + 0x50)) + 0x66);
    const y1 = u16(y0 + h);

    const prim = u32(host.allocPrim(h, mode << 5));
    mem.write8(prim + 3, 9);
    mem.write8(prim + 7, 0x2c);
    mem.write8(prim + 4, 0x80);
    mem.write8(prim + 5, 0x80);
    mem.write8(prim + 6, 0x80);
    mem.write16(prim + 0x16, 0x45);
    mem.write16(prim + 0xe, 0x2c57);
    mem.write8(prim + 7, mem.read8(prim + 7) | 2);
    mem.write16(prim + 0x8, x0);
    mem.write16(prim + 0xa, y0);
    mem.write16(prim + 0x10, x1);
    mem.write16(prim + 0x12, y0);
    mem.write16(prim + 0x18, x0);
    mem.write16(prim + 0x1a, y1);
    mem.write16(prim + 0x20, x1);
    mem.write8(prim + 0x14, 0xc7);
    mem.write8(prim + 0x24, 0xc7);
    mem.write8(prim + 0xc, 0xbc);
    mem.write8(prim + 0x1c, 0xbc);
    mem.write8(prim + 0xd, 0);
    mem.write8(prim + 0x15, 0);
    mem.write8(prim + 0x1d, 0x3e);
    mem.write8(prim + 0x25, 0x3e);
    mem.write16(prim + 0x22, y1);
    mem.write32(prim, ((mem.read32(prim) & 0xff000000) | (mem.read32(ot) & 0xffffff)) >>> 0);
    const link = (prim & 0xffffff) >>> 0;
    mem.write32(ot, (((mem.read32(ot) & 0xff000000) | link) >>> 0));
    host.commitPrim(u32(prim + FRAME_PRIM_SIZE), link, 0xff000000, {
        primitive: "POLY_FT4", code: 0x2e, color: [0x80, 0x80, 0x80], semiTransparent: true, abr: 2,
        tpage: 0x45, clut: 0x2c57,
        uv: [0xbc, 0, 0xc7, 0, 0xbc, 0x3e, 0xc7, 0x3e],
        corners: [s16(x0), s16(y0), s16(x1), s16(y0), s16(x0), s16(y1), s16(x1), s16(y1)],
    });
}
