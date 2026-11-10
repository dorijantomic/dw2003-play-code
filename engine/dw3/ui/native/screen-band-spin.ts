// The animated background band's ping-pong counter, written out inline by three
// chrome draws that are otherwise unrelated:
//   folderDrawChrome     F0x80088E74  (folder-screen.ts)
//   shopDrawChrome       F0x800880C4  (card-shop-screen.ts)
//   albumDrawChrome      F0x80084500  (album-lifecycle.ts)
// Each draws pack clip 8 at (spin, spin) after stepping the counter, so the
// step and the draw live here once. Object fields: +0x58 the counter (0..0x5F),
// +0x5C the toggle that paces it (one step every other call).

export interface BandSpinMemory {
    read32(addr: number): number;
    write32(addr: number, value: number): void;
}

export interface BandSpinHost {
    drawSprite(packPtr: number, clip: number, x: number, y: number): void;
    packResolve(handle: number): number;
}

/** The counter's top value: past it the step stops and the band holds. */
export const BAND_SPIN_LIMIT = 0x60;
/** The clip every chrome draw puts the band on. */
export const BAND_SPIN_CLIP = 8;

/** Step the band's ping-pong counter and draw it. */
export function screenBandSpin(
    mem: BandSpinMemory,
    obj: number,
    packHandle: number,
    host: BandSpinHost,
): void {
    let spin = 0;
    if ((mem.read32(obj + 0x5c) | 0) !== 0) {
        const next = (mem.read32(obj + 0x58) | 0) + 1;
        mem.write32(obj + 0x58, next);
        if (next < BAND_SPIN_LIMIT) spin = next;
        mem.write32(obj + 0x58, spin);
        mem.write32(obj + 0x5c, 0);
    } else {
        mem.write32(obj + 0x5c, 1);
    }
    const spinValue = mem.read32(obj + 0x58) | 0;
    host.drawSprite(host.packResolve(packHandle), BAND_SPIN_CLIP, spinValue, spinValue);
}
