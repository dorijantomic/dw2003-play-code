// The card duel's marker-sprite family (S11), translated from pro/cardgame.
//
// A 0x74-byte widget the Draw Phase plants and then moves across its three
// element panels. It is one of the five objects §24 named; its constructor and
// its three slots were read from the overlay assembly at their offsets inside
// the F0x8009BBA8 blob (no disassembler entry-list start, so the m2c C is not
// the source):
//   F0x80096180 constructor       @ .L0x000134d0  (handler F0x80095FB4, draw F0x80095E58)
//   F0x80096144 marker_set_position @ .L0x00013494 (slot +0x68)
//   F0x80096160 marker_scale_out    @ .L0x000134b0 (slot +0x6C)
//   F0x80096150 marker_start_oneshot @ .L0x000134a0 (slot +0x70)
//
// Player-visible result: a small marker sits at the (x, y) it was made with;
// set_position moves it to another spot, start_oneshot plays its eight frames
// and freezes on the last, and scale_out plays a five-frame shrink until it is
// gone. The Draw Phase's arm 7 creates it, arm 9 re-places it per page, arm 11
// scales it out.

export interface MarkerMemory {
    read8(addr: number): number;
    write8(addr: number, value: number): void;
    write16(addr: number, value: number): void;
    write32(addr: number, value: number): void;
}

export interface MarkerFamilyHost {
    /** F0x80014504(handler, size, slot): build the widget task object. */
    allocate(handler: number, size: number, slot: number): number;
}

/** The widget's own fields (stride 0x74). */
export const MARKER = {
    /** one-shot elapsed frame (s32; start_oneshot zeroes it) */
    elapsed: 0x50,
    /** x (s16) */
    x: 0x54,
    /** y (s16) */
    y: 0x56,
    /** scale (s16, set to full by scale_out) */
    scale: 0x5a,
    /** the mode byte the draw switches on (2 = scale-out) */
    mode: 0x62,
    /** the one-shot flag (start_oneshot sets it) */
    oneshot: 0x63,
    /** the two shrink frames scale_out arms (5) */
    shrinkA: 0x64,
    shrinkB: 0x66,
} as const;

export const MARKER_HANDLER = 0x80095fb4;
export const MARKER_DRAW = 0x80095e58;
export const MARKER_SIZE = 0x74;
export const MARKER_SLOT_POSITION = 0x68;
export const MARKER_SLOT_SCALE_OUT = 0x6c;
export const MARKER_SLOT_ONESHOT = 0x70;
export const MARKER_METHOD_POSITION = 0x80096144;
export const MARKER_METHOD_SCALE_OUT = 0x80096160;
export const MARKER_METHOD_ONESHOT = 0x80096150;
export const MARKER_SCALE_OUT_FRAMES = 5;
export const MARKER_MODE_SCALE_OUT = 2;
export const MARKER_FULL_SCALE = 0x1000;

/**
 * F0x80096180(x, y): build the marker widget, install its three slots and seed
 * its position and one-shot flag.
 */
export function createMarkerSprite(
    mem: MarkerMemory, host: MarkerFamilyHost, x: number, y: number,
): number {
    const obj = host.allocate(MARKER_HANDLER, MARKER_SIZE, 0) >>> 0;
    mem.write32(obj + MARKER_SLOT_POSITION, MARKER_METHOD_POSITION);
    mem.write32(obj + MARKER_SLOT_SCALE_OUT, MARKER_METHOD_SCALE_OUT);
    mem.write32(obj + MARKER_SLOT_ONESHOT, MARKER_METHOD_ONESHOT);
    mem.write16(obj + MARKER.x, x & 0xffff);
    mem.write16(obj + MARKER.y, y & 0xffff);
    mem.write8(obj + MARKER.oneshot, 0);
    return obj;
}

/** F0x80096144(marker, x, y): the marker sits at that spot on screen. */
export function markerSetPosition(mem: MarkerMemory, marker: number, x: number, y: number): void {
    mem.write16(marker + MARKER.x, x & 0xffff);
    mem.write16(marker + MARKER.y, y & 0xffff);
}

/** F0x80096150(marker): the marker plays eight frames and freezes on the last. */
export function markerStartOneshot(mem: MarkerMemory, marker: number): void {
    mem.write8(marker + MARKER.oneshot, 1);
    mem.write32(marker + MARKER.elapsed, 0);
}

/** F0x80096160(marker): the marker shrinks away over five frames and is gone. */
export function markerScaleOut(mem: MarkerMemory, marker: number): void {
    mem.write16(marker + MARKER.shrinkB, MARKER_SCALE_OUT_FRAMES);
    mem.write16(marker + MARKER.shrinkA, MARKER_SCALE_OUT_FRAMES);
    mem.write8(marker + MARKER.mode, MARKER_MODE_SCALE_OUT);
    mem.write16(marker + MARKER.scale, MARKER_FULL_SCALE);
}
