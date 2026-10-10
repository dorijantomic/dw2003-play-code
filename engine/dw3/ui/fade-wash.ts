// The duel's full-screen colour wash, translated from pro/cardgame:
//   F0x800A367C createFadeWash    — allocate the 0x78-byte task object
//   F0x800A35BC fadeWashHandler   — the object's per-frame handler
//   F0x800A3488 fadeWashTick      — ramp the three colour channels
//   F0x800A32D8 fadeWashDraw      — submit the wash quad and its draw-mode word
//   F0x800A3548 fadeWashSetColours— set the current colour directly
//   F0x800A3558 fadeWashStart     — snapshot the colour and start the ramp
//   F0x800A35A4 fadeWashIsIdle    — state == 0
//   F0x800A35B0 fadeWashStop      — state = 2
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/fade-wash-oracle.test.js runs each original through
// engine/native on the shipped pro_cardgame.bin + resident.bin and compares the
// object, the submitted packet, the ordering-table bucket and the recorded
// boundary calls.
//
// Source (assembly, authority 2): exe-decomp/cardgame.norm.s
//   F0x800a32d8 @.L0x00020628, F0x800a3488 @.L0x000207d8, F0x800a3548 @.L0x00020898,
//   F0x800a3558 @.L0x000208a8, F0x800a35a4 @.L0x000208f4, F0x800a35b0 @.L0x00020900,
//   F0x800a35bc @.L0x0002090c, F0x800a367c @.L0x000209cc.
//
// Boundaries the original reaches, all host-injected here:
//   [0x8004DF9C]()  = F0x8001D704  — the frame delta [0x8004DE28]
//   [0x8004DE10+0x17C](key) = F0x8001DA84 findRegisteredHandleByKey (ported, called directly)
//   [view+0x138](view, 0)   = F0x8001DFA8 — the ordering-table bucket head
//   [0x8004DE10+0x158]()    = F0x8001D844 — the prim cursor [0x8004DE30]
//   [0x8004DE10+0x15C](v)   = F0x8001D854 — [0x8004DE30] = v
//   [obj+0x38](obj) / [obj+0x28](obj,n) — the object factory's base state methods

import { findRegisteredHandleByKey } from "../display-service.ts";

export interface FadeWashMemory {
    read8(addr: number): number;
    read16(addr: number): number;
    read32(addr: number): number;
    write8(addr: number, value: number): void;
    write16(addr: number, value: number): void;
    write32(addr: number, value: number): void;
}

/** The factory edge the creator alone needs; duel-queue calls it too. */
export interface FadeWashCreateHost {
    /** F0x80014504(handler, size, extra) -> the new task object. */
    allocate(handler: number, size: number, extra: number): number;
}

export interface FadeWashHost extends FadeWashCreateHost {
    /** [0x8004DF9C]() = F0x8001D704: the frame delta, [0x8004DE28]. */
    frameDelta(): number;
    /** [view+0x138](view, depth) = F0x8001DFA8: the OT bucket head cell. */
    otBucket(view: number, depth: number): number;
    /** [service+0x158]() = F0x8001D844: the prim cursor, [0x8004DE30]. */
    getCursor(): number;
    /** [service+0x15C](v) = F0x8001D854: stores the prim cursor. */
    setCursor(cursor: number): void;
    /** obj+0x28 (F0x80014274): the factory's set-state method. */
    setState(obj: number, state: number): void;
    /** obj+0x38 (F0x800142AC): the factory's advance-state method. */
    advance0(obj: number): void;
}

/** The object's field map; the four +0x68..+0x74 words are method slots. */
export const FADE_WASH = {
    /** The handler's dispatch state (1 = ramping arm). */
    state0: 0x0c,
    setState: 0x28,
    advance0: 0x38,
    /** The wash state: 0 idle, 1 ramping, 2 done. */
    state: 0x50,
    /** Ticks left in the ramp (s32). */
    counter: 0x54,
    /** The ramp's length in ticks (s32). */
    duration: 0x58,
    /** The quad's draw-mode low bits (u8, the creator's argument). */
    modeBits: 0x5c,
    /** Non-zero holds the wash at the end instead of returning to idle. */
    hold: 0x5d,
    target: 0x5e,
    previous: 0x61,
    current: 0x64,
    setColoursSlot: 0x68,
    startSlot: 0x6c,
    isIdleSlot: 0x70,
    stopSlot: 0x74,
} as const;

export const FADE_WASH_HANDLER = 0x800a35bc;
export const FADE_WASH_CREATE = 0x800a367c;
export const FADE_WASH_TICK = 0x800a3488;
export const FADE_WASH_DRAW = 0x800a32d8;
export const FADE_WASH_SET_COLOURS = 0x800a3548;
export const FADE_WASH_START = 0x800a3558;
export const FADE_WASH_IS_IDLE = 0x800a35a4;
export const FADE_WASH_STOP = 0x800a35b0;
/** The allocated object size the creator asks the factory for. */
export const FADE_WASH_SIZE = 0x78;
/** The wash rectangle in the overlay's data tail: four u16 [x, y, w, h]. */
export const FADE_WASH_RECT = 0x800a5d94;
/** The draw-mode word's fixed part (E1, semi-transparency rate 1, page bits). */
export const FADE_WASH_DRAW_MODE = 0xe1000205;
/** The quad's code byte: 0x20 | quad (8) | semi-transparent (2). */
export const FADE_WASH_QUAD_CODE = 0x2a;
/** The quad packet's word count after its tag word (colour + four vertices). */
export const FADE_WASH_QUAD_LEN = 5;
/** The view handle the wash looks up. */
export const FADE_WASH_VIEW_KEY = 0x100;

const s32 = (v: number): number => v | 0;

/**
 * F0x800A367C(modeBits): the factory builds a 0x78-byte task whose handler is
 * F0x800A35BC, then the creator installs the four method slots and the mode
 * byte. Returns the object.
 */
export function createFadeWash(mem: FadeWashMemory, host: FadeWashCreateHost, modeBits: number): number {
    const obj = host.allocate(FADE_WASH_HANDLER, FADE_WASH_SIZE, 4) >>> 0;
    mem.write32(obj + FADE_WASH.setColoursSlot, FADE_WASH_SET_COLOURS);
    mem.write32(obj + FADE_WASH.startSlot, FADE_WASH_START);
    mem.write32(obj + FADE_WASH.isIdleSlot, FADE_WASH_IS_IDLE);
    mem.write8(obj + FADE_WASH.modeBits, modeBits & 0xff);
    mem.write32(obj + FADE_WASH.stopSlot, FADE_WASH_STOP);
    return obj;
}

/** F0x800A3548(obj, r, g, b): set the current colour directly. */
export function fadeWashSetColours(mem: FadeWashMemory, obj: number, r: number, g: number, b: number): void {
    mem.write8(obj + FADE_WASH.current, r & 0xff);
    mem.write8(obj + FADE_WASH.current + 1, g & 0xff);
    mem.write8(obj + FADE_WASH.current + 2, b & 0xff);
}

/**
 * F0x800A3558(obj, r, g, b, duration, hold): snapshot the current colour into
 * the "previous" bytes, set the targets, arm the counter and state, and record
 * the hold flag. The last two arguments arrive on the caller's stack in the
 * original (its frame is 0x18, so they are at sp+0x28/sp+0x2C of its caller).
 */
export function fadeWashStart(
    mem: FadeWashMemory,
    obj: number,
    r: number,
    g: number,
    b: number,
    duration: number,
    hold: number,
): void {
    for (let i = 0; i < 3; i++) {
        mem.write8(obj + FADE_WASH.previous + i, mem.read8(obj + FADE_WASH.current + i));
    }
    mem.write8(obj + FADE_WASH.target, r & 0xff);
    mem.write8(obj + FADE_WASH.target + 1, g & 0xff);
    mem.write8(obj + FADE_WASH.target + 2, b & 0xff);
    mem.write32(obj + FADE_WASH.counter, duration | 0);
    mem.write32(obj + FADE_WASH.duration, duration | 0);
    mem.write32(obj + FADE_WASH.state, 1);
    mem.write8(obj + FADE_WASH.hold, hold & 0xff);
}

/** F0x800A35A4(obj): 1 while the wash sits idle (state 0). */
export function fadeWashIsIdle(mem: FadeWashMemory, obj: number): number {
    return (mem.read32(obj + FADE_WASH.state) | 0) === 0 ? 1 : 0;
}

/** F0x800A35B0(obj): mark the wash finished (state 2). */
export function fadeWashStop(mem: FadeWashMemory, obj: number): void {
    mem.write32(obj + FADE_WASH.state, 2);
}

/**
 * F0x800A3488(obj): subtract the frame delta from the counter and, while it
 * stays positive, step each channel from its previous value toward its target
 * (integer division truncating toward zero). At zero: a held wash stops at
 * state 2, otherwise the state returns to 0 and the current colour snaps to the
 * target. The counter store is the branch's delay slot and always lands.
 */
export function fadeWashTick(mem: FadeWashMemory, obj: number, host: FadeWashHost): number {
    const counter = s32(mem.read32(obj + FADE_WASH.counter) - host.frameDelta());
    mem.write32(obj + FADE_WASH.counter, counter);
    if (counter > 0) {
        const duration = s32(mem.read32(obj + FADE_WASH.duration));
        for (let i = 0; i < 3; i++) {
            const target = mem.read8(obj + FADE_WASH.target + i) & 0xff;
            const previous = mem.read8(obj + FADE_WASH.previous + i) & 0xff;
            const step = Math.trunc(Math.imul(target - previous, counter) / duration);
            mem.write8(obj + FADE_WASH.current + i, (target - step) & 0xff);
        }
        // the loop's own `slti` leaves v0 at 0; no caller reads it, but the
        // oracle pins it because the original's value is observable
        return 0;
    }
    if ((mem.read8(obj + FADE_WASH.hold) & 0xff) !== 0) {
        mem.write32(obj + FADE_WASH.state, 2);
        return 2;
    }
    mem.write32(obj + FADE_WASH.state, 0);
    for (let i = 0; i < 3; i++) {
        mem.write8(obj + FADE_WASH.current + i, mem.read8(obj + FADE_WASH.target + i) & 0xff);
    }
    // the target-red load in the original is what v0 holds on this arm
    return mem.read8(obj + FADE_WASH.target) & 0xff;
}

/**
 * F0x800A32D8(obj, rect, size): look up the view registered under 0x100, take
 * its ordering-table bucket, and write a two-packet chain at the current prim
 * cursor: a flat semi-transparent quad (code 0x2A, length 5) in the object's
 * current colour, then a one-word E1 draw-mode packet whose low bits come from
 * the creator's mode byte. Both are linked into the bucket head; the cursor is
 * published one word past the draw-mode packet.
 *
 * `rect` is (y << 16) | x and `size` is (h << 16) | w — the handler builds them
 * from the four u16s at FADE_WASH_RECT.
 */
export function fadeWashDraw(
    mem: FadeWashMemory,
    obj: number,
    rect: number,
    size: number,
    host: FadeWashHost,
): void {
    const view = findRegisteredHandleByKey(mem, FADE_WASH_VIEW_KEY) >>> 0;
    const bucket = host.otBucket(view, 0) >>> 0;
    const packet = host.getCursor() >>> 0;

    mem.write8(packet + 4, mem.read8(obj + FADE_WASH.current) & 0xff);
    mem.write8(packet + 5, mem.read8(obj + FADE_WASH.current + 1) & 0xff);
    mem.write8(packet + 6, mem.read8(obj + FADE_WASH.current + 2) & 0xff);
    mem.write8(packet + 3, FADE_WASH_QUAD_LEN);
    mem.write8(packet + 7, FADE_WASH_QUAD_CODE);

    const x = rect & 0xffff;
    const y = (rect >>> 16) & 0xffff;
    const w = size & 0xffff;
    const h = (size >>> 16) & 0xffff;
    mem.write16(packet + 0x08, x);
    mem.write16(packet + 0x0a, y);
    mem.write16(packet + 0x0c, (x + w) & 0xffff);
    mem.write16(packet + 0x0e, y);
    mem.write16(packet + 0x10, x);
    mem.write16(packet + 0x12, (y + h) & 0xffff);
    mem.write16(packet + 0x14, (x + w) & 0xffff);
    mem.write16(packet + 0x16, (y + h) & 0xffff);

    // link the quad in front of the bucket's current head, then repoint the head
    mem.write32(packet, ((mem.read32(packet) & 0xff000000) | (mem.read32(bucket) & 0xffffff)) >>> 0);
    mem.write32(bucket, ((mem.read32(bucket) & 0xff000000) | (packet & 0xffffff)) >>> 0);

    const mode = (packet + 0x18) >>> 0;
    mem.write8(mode + 3, 1);
    mem.write32(mode + 4, (FADE_WASH_DRAW_MODE | ((mem.read8(obj + FADE_WASH.modeBits) & 3) << 5)) >>> 0);
    mem.write32(mode, ((mem.read32(mode) & 0xff000000) | (mem.read32(bucket) & 0xffffff)) >>> 0);
    mem.write32(bucket, ((mem.read32(bucket) & 0xff000000) | (mode & 0xffffff)) >>> 0);

    host.setCursor((packet + 0x20) >>> 0);
}

/**
 * F0x800A35BC(obj): the task's handler. State 1 is the wash arm: tick while the
 * wash is ramping (its own state 1), draw the quad from the static rectangle,
 * and when the wash reaches state 2 advance the task to state 3. Any other
 * dispatch state except 2 and 3 falls through to the factory's advance method.
 */
export function fadeWashHandler(mem: FadeWashMemory, obj: number, host: FadeWashHost): void {
    const state0 = s32(mem.read32(obj + FADE_WASH.state0));
    if (state0 !== 1) {
        if (state0 < 2 || state0 >= 4) host.advance0(obj);
        return;
    }
    if (s32(mem.read32(obj + FADE_WASH.state)) === 1) fadeWashTick(mem, obj, host);
    const rect = ((mem.read16(FADE_WASH_RECT + 2) << 16) | mem.read16(FADE_WASH_RECT)) >>> 0;
    const size = ((mem.read16(FADE_WASH_RECT + 6) << 16) | mem.read16(FADE_WASH_RECT + 4)) >>> 0;
    fadeWashDraw(mem, obj, rect, size, host);
    if (s32(mem.read32(obj + FADE_WASH.state)) === 2) host.setState(obj, 3);
}
