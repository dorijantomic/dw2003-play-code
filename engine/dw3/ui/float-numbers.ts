// The card duel's floating damage/heal numbers, translated from pro/cardgame:
//   F0x80099ED4 floatNumbersTickAll  — the per-frame pump
//   F0x80099D18 floatNumberMove      — the timer/tween step
//   F0x80099DE8 floatNumberDraw      — the sprite draw cycle
//   F0x8009BFCC place_float_number   — park a number at (x,y)
//   F0x8009C010 start_float_number_move — start a slide to (destX,destY)
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/float-numbers-oracle.test.js runs each original through
// engine/native on the shipped pro_cardgame.bin + resident.bin and compares the
// pool fields and the ordered draw intents.
//
// DECODED: authority-2 closures `_asm/F0x80099ed4.s`, `F0x80099d18.s`,
// `F0x80099de8.s` and the original `cardgame.s` L25806-L25839. The pool is 12
// entries of stride 0x12 at view+0xCE8; state 0 is idle, 1 is parked (drawn
// every frame), 2 is tweening (moved then drawn).
//
// REACHABILITY (researcher A's cardgame-float-number-family contract, candidate
// claim cardduel-view-slots-edc-ee0-f04): the two starters are install-only in
// the shipped overlay — no body loads view+0xEDC/+0xEE0, and a full recorded
// duel never entered the move or draw routine. The feature is therefore dead in
// the original game; a browser duel that wants to show a number must synthesise
// the placement event. That choice is the caller's, not part of this port.

export interface FloatNumberMemory {
    read8(addr: number): number;
    write8(addr: number, value: number): void;
    /** Unsigned halfword. */
    read16(addr: number): number;
    /** Signed halfword. */
    read16s(addr: number): number;
    write16(addr: number, value: number): void;
}

export interface FloatNumberHost {
    /** `[0x8004DF9C]` = resident F0x8001D704: the frame delta. */
    frameDelta(): number;
    /** ctx+0x74 (F0x8001ECBC): set the draw origin. */
    setOrigin(x: number, y: number): void;
    /** ctx+0x7C (F0x8001ED34): set the draw layer target. */
    setLayer(target: number, bucket: number): void;
    /** ctx+0x88 (F0x8001ECEC): set the sprite frame index. */
    setFrame(n: number): void;
    /** ctx+0x84 (F0x8001ED6C): draw a sprite from the resolved pack. */
    drawSprite(packPtr: number, clip: number, x: number, y: number): void;
    /** `[0x80044F5C]` = F0x800140D8: resolve a pack handle to its image. */
    packResolve(handle: number): number;
}

export const FLOAT_POOL_BASE = 0xce8;
export const FLOAT_POOL_STRIDE = 0x12;
export const FLOAT_POOL_COUNT = 12;
export const FLOAT_STATE = 0x10;
/** The number sprite's resident sheet id. */
export const FLOAT_SHEET = 0x025d0003;
/** The sub-frame index the draw emits. */
export const FLOAT_CLIP = 8;
export const FLOAT_LAYER = 0x100;
export const FLOAT_LAYER_BUCKET = 1;
export const FLOAT_ORIGIN = { x: 0x340, y: 0 } as const;
/** The pool entry's field offsets. */
export const FLOAT_ENTRY = {
    x: 0x00,
    y: 0x02,
    startX: 0x04,
    startY: 0x06,
    destX: 0x08,
    destY: 0x0a,
    phase: 0x0c,
    timer: 0x0e,
    duration: 0x0f,
    state: 0x10,
} as const;

const s32 = (v: number): number => v | 0;
const s16 = (v: number): number => (v << 16) >> 16;

/** The pool entry address for slot `index`. */
export function floatEntry(view: number, index: number): number {
    return (view + FLOAT_POOL_BASE + index * FLOAT_POOL_STRIDE) >>> 0;
}

/** F0x80099ED4(view): the per-frame pump over the 12-entry pool. */
export function floatNumbersTickAll(mem: FloatNumberMemory, view: number, host: FloatNumberHost): void {
    for (let i = 0; i < FLOAT_POOL_COUNT; i++) {
        const entry = floatEntry(view, i);
        const state = mem.read8(entry + FLOAT_ENTRY.state);
        if (state === 0) continue;
        if (state === 2) floatNumberMove(mem, entry, host);
        floatNumberDraw(mem, entry, host);
    }
}

/** F0x80099D18(entry): step the tween; park the number when the timer empties. */
export function floatNumberMove(mem: FloatNumberMemory, entry: number, host: FloatNumberHost): void {
    const duration = mem.read8(entry + FLOAT_ENTRY.duration);
    const t = (mem.read8(entry + FLOAT_ENTRY.timer) - s32(host.frameDelta())) & 0xff;
    mem.write8(entry + FLOAT_ENTRY.timer, t);
    if (t === 0) {
        mem.write8(entry + FLOAT_ENTRY.state, 1);
        mem.write8(entry + FLOAT_ENTRY.duration, 0);
        mem.write8(entry + FLOAT_ENTRY.timer, 0);
        mem.write16(entry + FLOAT_ENTRY.x, mem.read16(entry + FLOAT_ENTRY.destX));
        mem.write16(entry + FLOAT_ENTRY.y, mem.read16(entry + FLOAT_ENTRY.destY));
        return;
    }
    const dx = s16(mem.read16s(entry + FLOAT_ENTRY.destX)) - s16(mem.read16s(entry + FLOAT_ENTRY.startX));
    const dy = s16(mem.read16s(entry + FLOAT_ENTRY.destY)) - s16(mem.read16s(entry + FLOAT_ENTRY.startY));
    const ix = Math.trunc((dx * t) / duration);
    const iy = Math.trunc((dy * t) / duration);
    mem.write16(entry + FLOAT_ENTRY.x, (mem.read16(entry + FLOAT_ENTRY.destX) - ix) & 0xffff);
    mem.write16(entry + FLOAT_ENTRY.y, (mem.read16(entry + FLOAT_ENTRY.destY) - iy) & 0xffff);
}

/** F0x80099DE8(entry): advance the frame cycle and emit one sprite. */
export function floatNumberDraw(mem: FloatNumberMemory, entry: number, host: FloatNumberHost): void {
    const phase = (mem.read16(entry + FLOAT_ENTRY.phase) + 1) & 0xffff;
    mem.write16(entry + FLOAT_ENTRY.phase, phase);
    const f = (phase << 16) >> 18;
    let frame: number;
    if (f === 1) frame = 3;
    else if (f === 0) frame = 0;
    else if (f === 2) frame = 1;
    else {
        // f >= 3 and f < 0 both reset the cycle.
        mem.write16(entry + FLOAT_ENTRY.phase, 0);
        frame = 0;
    }
    host.setLayer(FLOAT_LAYER, FLOAT_LAYER_BUCKET);
    host.setOrigin(FLOAT_ORIGIN.x, FLOAT_ORIGIN.y);
    host.setFrame(frame);
    const handle = host.packResolve(FLOAT_SHEET) >>> 0;
    host.drawSprite(handle, FLOAT_CLIP, s16(mem.read16s(entry + FLOAT_ENTRY.x)), s16(mem.read16s(entry + FLOAT_ENTRY.y)));
}

/**
 * F0x8009BFCC(view, index, x, y): park a number at (x, y), clearing the tween
 * fields. No range check on the index in the original; the caller must bound it.
 */
export function placeFloatNumber(
    mem: FloatNumberMemory, view: number, index: number, x: number, y: number,
): number {
    const entry = floatEntry(view, index);
    mem.write8(entry + FLOAT_ENTRY.state, 1);
    mem.write16(entry + FLOAT_ENTRY.x, x & 0xffff);
    mem.write16(entry + FLOAT_ENTRY.y, y & 0xffff);
    mem.write16(entry + FLOAT_ENTRY.destY, 0);
    mem.write16(entry + FLOAT_ENTRY.destX, 0);
    mem.write16(entry + FLOAT_ENTRY.startY, 0);
    mem.write16(entry + FLOAT_ENTRY.startX, 0);
    mem.write8(entry + FLOAT_ENTRY.duration, 0);
    mem.write8(entry + FLOAT_ENTRY.timer, 0);
    mem.write16(entry + FLOAT_ENTRY.phase, 0);
    return 0;
}

/**
 * F0x8009C010(view, index, duration, destX, destY): slide the number from its
 * current spot to (destX, destY) over `duration` frames. The draw cycle's phase
 * is left alone.
 */
export function startFloatNumberMove(
    mem: FloatNumberMemory, view: number, index: number, duration: number, destX: number, destY: number,
): number {
    const entry = floatEntry(view, index);
    const startX = mem.read16(entry + FLOAT_ENTRY.x);
    const startY = mem.read16(entry + FLOAT_ENTRY.y);
    mem.write8(entry + FLOAT_ENTRY.state, 2);
    mem.write16(entry + FLOAT_ENTRY.destX, destX & 0xffff);
    mem.write8(entry + FLOAT_ENTRY.duration, duration & 0xff);
    mem.write8(entry + FLOAT_ENTRY.timer, duration & 0xff);
    mem.write16(entry + FLOAT_ENTRY.destY, destY & 0xffff);
    mem.write16(entry + FLOAT_ENTRY.startX, startX);
    mem.write16(entry + FLOAT_ENTRY.startY, startY);
    return 0;
}
