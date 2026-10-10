// The screen runtime's video-memory upload record.
//
// The console's card artwork path (and any TIM the overlays upload) ends in
// libgpu LoadImage F0x80025B14: a RECT and a pixel pointer. The browser has no
// GPU command queue, so engine/native serves that device boundary here: each
// upload is recorded with its rectangle and the bytes the console would have
// written into VRAM, keyed so a later draw can sample it by (x, y).
//
// Contract: the accepted `loadimage-chain-contract` answer (researcher A,
// 2026-09-15) section 6 - a VRAM map keyed by (x, y) with the upload's pixel
// format, because a CLUT'd TIM arrives as two LoadImage calls (image + palette)
// and the prim's `clut` word names the palette rect.
//
// The pixel copy is raw: the caller states the format width in bits per texel
// so the byte count is exact. Card artwork is 8-bit (one VRAM halfword holds
// two texels); a palette upload is 16-bit.

/**
 * A LoadImage RECT's w/h count **VRAM halfwords**, not texels: the GP0 0xA0
 * builder transfers `(w*h + 1) >> 1` 32-bit words, i.e. `w*h*2` bytes, whatever
 * the pixel format. `bpp` only says how many texels share a halfword.
 */
const TRANSFER_BYTES = (w: number, h: number): number => (w >>> 0) * (h >>> 0) * 2;

export interface VramLoad {
    /** Destination rectangle in VRAM units (texels). */
    x: number;
    y: number;
    w: number;
    h: number;
    /** The source pointer the console would have read. */
    data: number;
    /** Bits per texel: 4, 8 or 16. */
    bpp: number;
    /** True when this upload is the palette (CLUT) half of a TIM. */
    clut: boolean;
    /** The bytes copied at upload time, in source order. */
    pixels: Uint8Array;
}

export class VramMap {
    readonly loads: VramLoad[] = [];

    /**
     * Record one LoadImage. `readByte` (or the bulk `readInto`) copies the
     * source bytes out of the emulated memory at upload time, so a later
     * overwrite of the source block cannot rewrite history.
     */
    upload(
        x: number,
        y: number,
        w: number,
        h: number,
        data: number,
        bpp: number,
        clut: boolean,
        readByte: (addr: number) => number,
        readInto?: (addr: number, dest: Uint8Array) => void,
    ): VramLoad {
        const bytes = TRANSFER_BYTES(w, h);
        const pixels = new Uint8Array(Math.max(0, Math.min(bytes, 0x40000)));
        if (readInto) readInto(data >>> 0, pixels);
        else for (let i = 0; i < pixels.length; i++) pixels[i] = readByte((data + i) >>> 0) & 0xff;
        const load: VramLoad = { x, y, w, h, data, bpp, clut, pixels };
        // A screen that re-uploads the same rectangle every frame (the pause
        // pages do, for their portraits) would otherwise grow this list without
        // bound; the latest upload of a rectangle is the only one find() can
        // return, so replace it in place.
        const prev = this.loads.findIndex((l) => l.x === x && l.y === y && l.w === w && l.h === h);
        if (prev >= 0) this.loads[prev] = load;
        else this.loads.push(load);
        return load;
    }

    /** The most recent upload covering VRAM texel (x, y), or null. */
    find(x: number, y: number): VramLoad | null {
        for (let i = this.loads.length - 1; i >= 0; i--) {
            const l = this.loads[i] as VramLoad;
            if (x >= l.x && x < l.x + l.w && y >= l.y && y < l.y + l.h) return l;
        }
        return null;
    }

    clear(): void {
        this.loads.length = 0;
    }
}
