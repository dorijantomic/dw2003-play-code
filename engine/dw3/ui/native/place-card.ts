// The stage-entry location title card: the area name and place name typed into
// coloured bars when the player walks into a field stage. Translated bit-exactly
// from the fieldstg overlay (asm ~/ddw3/asm/dw2003/pro/fieldstg.s, overlay load
// base 0x80082CB0; file offsets below are relative to it):
//   F0x80087D68  create         (0x50B8-0x50FC)
//   F0x80087974  frame callback (0x4CC4-0x50B4): build, states 1-3, draw tail
//   F0x800875AC  name lookup    (0x48FC-0x4A50): table 0x80097098, two widgets
//   F0x80087704  bar animator   (0x4A54-0x4BA0)
//   F0x80087854  bar draw       (0x4BA4-0x4CC0): one GP0 0x28 flat quad
// Decoded reference: docs/research/ui/field-location-title-card-2026-08-16.md.
//
// Oracle: tests/lane-b/place-card.test.js runs the five originals through
// engine/native on resident.bin + fieldstg.bin and compares every call and
// memory word, with the shared resident services (task factory, text widget,
// typewriter reveal, task-state methods) supplied on BOTH sides by the existing
// translated services (TranslatedTaskTree, ShopWidgetServices, textRevealTick).
//
// Object (0x1C0 bytes, 8 extra): +0x04 "show names" (create argument),
// +0x0C task state, +0x10 sub-state, +0x14 hold accumulator, +0x50 ten bar
// records of 0x24 bytes, +0x1B8/+0x1BA/+0x1BC/+0x1BE the slit rectangle
// (x, y, w, h, s16). extra: +0x00 area-name widget, +0x04 place-name widget.
// Bar record: +0x00 enable, +0x04/+0x06 x/y, +0x08/+0x0A w/h (s16), +0x0C
// colour word, +0x10 axis (1 = x/w, 2 = y/h, 0 = settled), +0x14 near target,
// +0x18 far target, +0x1C step (s32).
//
// Frame callback (task state, signed):
//   1   sub-state (unsigned; >= 5 shares sub-state 0's target), falling through:
//       0 enable bars 0, 5; wait for bar 5 settled, then +0x3C
//       1 enable bars 8, 9, 6, 1, 2, 7, 3; wait for bar 9, then +0x3C
//       2 +0x3C
//       3 enable bar 4; wait for bar 4, then +0x3C and stop (no fall into 4)
//       4 both widgets' +0x168 (end-of-text flag) nonzero -> +0x28(2)
//   2   view = [0x8004DF8C](0x1003) every frame; sub-state (signed):
//       0 (and < 0, and >= 4): nothing — the card parks until the field calls
//         +0x2C(1) on it.
//       1 +0x14 += frame delta [0x8004DF9C](); at >= 0x3C: +0x3C, fall into 2
//       2 slit = (0, 0, 0x140, 0xF0), +0x3C, fall into 3
//       3 slit y += 8, h -= 0x10; view+0x110(x, y), view+0x114(w, h);
//         h == 0 -> +0x28(3)
//   3   [0x80099DD4] = 0 (the busy flag)
//   else (<= 0 or >= 4): +0x04 == 0 -> +0x28(2); otherwise copy the ten
//       templates from 0x80097458 into +0x50, look up the names, +0x38.
//   Draw tail (task state 1 or 2 after the above, and +0x04 != 0):
//       ot = view(0x1003)+0x138(1); for each enabled record in order, animate
//       it, then link its quad at the head of that one OT entry.
//
// Host boundaries: F0x800143DC (task factory), F0x8001AE38 (text widget), the
// scene-id cell [0x8004B438], the text-bank cell [0x80044F4C], the view getter
// [0x8004DF8C], the frame delta [0x8004DF9C], the packet cursor pair
// [0x8004DF68]/[0x8004DF6C], and every object method (task +0x28/+0x2C/+0x38/
// +0x3C, widget +0x114/+0x130/+0x168, view +0x110/+0x114/+0x138).

export const PLACE_CARD_CREATE = 0x80087d68;
export const PLACE_CARD_TICK = 0x80087974;
export const PLACE_CARD_NAMES = 0x800875ac;
export const PLACE_CARD_BAR_STEP = 0x80087704;
export const PLACE_CARD_BAR_DRAW = 0x80087854;
export const PLACE_CARD_SIZE = 0x1c0;
export const PLACE_CARD_EXTRA = 8;
/** The scheduler key F0x80087D68 passes to the task factory. */
export const PLACE_CARD_TASK_KEY = 9;
/** The busy flag the field waits on: raised on create, cleared in state 3. */
export const PLACE_CARD_BUSY = 0x80099dd4;
/** {u8 area, u8 place, s16 scene} records, terminated by a zero scene. */
export const PLACE_CARD_NAME_TABLE = 0x80097098;
/** Ten 0x24-byte bar templates. */
export const PLACE_CARD_BAR_TEMPLATES = 0x80097458;
export const PLACE_CARD_BAR_COUNT = 10;
export const PLACE_CARD_BAR_SIZE = 0x24;
export const PLACE_CARD_BARS = 0x50;
/** The widget/view group every part of the card draws in. */
export const PLACE_CARD_LAYER = 0x1003;
export const PLACE_CARD_TEXT_GLOBAL = 0x8005cca8;
export const PLACE_CARD_AREA_BANK_BASE = 0xa9;
export const PLACE_CARD_PLACE_BANK_BASE = 0xb7;
/** unk130(widget, 5): one more character once the counter exceeds 5. */
export const PLACE_CARD_REVEAL_DELAY = 5;
export const PLACE_CARD_HOLD = 0x3c;
export const PLACE_CARD_SLIT = 0x1b8;

export interface PlaceCardMemory {
    read8(addr: number): number;
    read16(addr: number): number;
    read32(addr: number): number;
    write8(addr: number, value: number): void;
    write16(addr: number, value: number): void;
    write32(addr: number, value: number): void;
}

export interface PlaceCardHost {
    /** target.method[slot](target, ...args); the return value is used for +0x138 and +0x168. */
    callMethod(target: number, slot: number, args: number[]): number;
    /** F0x800143DC(handler, size, extra, key): allocate and schedule a task object. */
    createTask(handler: number, size: number, extra: number, key: number): number;
    /** F0x8001AE38(layer, kind, x, y): create a text widget. */
    createText(layer: number, kind: number, x: number, y: number): number;
    /** [0x8004B438](): the current scene id. */
    sceneId(): number;
    /** [0x80044F4C](bank): resolve a text bank. */
    textBank(bank: number): number;
    /** [0x8004DF8C](key) = F0x8001DA84: the view registered for a layer key. */
    viewForKey(key: number): number;
    /** [0x8004DF9C]() = F0x8001D704: the frame delta. */
    frameDelta(): number;
    /** [0x8004DF68]() = F0x8001D844: the packet write cursor. */
    packetCursor(): number;
    /** [0x8004DF6C](cursor) = F0x8001D854: publish the consumed cursor. */
    flushPacketCursor(cursor: number): void;
}

const u32 = (v: number): number => v >>> 0;
const s32 = (v: number): number => v | 0;
const s16 = (v: number): number => (v << 16) >> 16;

/** F0x80087D68(show): build the card task and raise the busy flag. */
export function placeCardCreate(mem: PlaceCardMemory, host: PlaceCardHost, show: number): number {
    const task = u32(host.createTask(PLACE_CARD_TICK, PLACE_CARD_SIZE, PLACE_CARD_EXTRA, PLACE_CARD_TASK_KEY));
    mem.write32(task + 4, u32(show));
    mem.write32(PLACE_CARD_BUSY, 1);
    return task;
}

/**
 * F0x800875AC(obj, extra): find the current scene in the name table and build
 * the two typewriter widgets. A scene with no record builds nothing.
 */
export function placeCardNames(mem: PlaceCardMemory, host: PlaceCardHost, extra: number): void {
    const scene = s16(host.sceneId());
    let rec = PLACE_CARD_NAME_TABLE;
    if (s16(mem.read16(rec + 2)) === 0) return;
    while (s16(mem.read16(rec + 2)) !== scene) {
        rec = u32(rec + 4);
        if (s16(mem.read16(rec + 2)) === 0) return;
    }
    const label = (slot: number, x: number, y: number, bankBase: number, index: number): void => {
        mem.write32(extra + slot, u32(host.createText(PLACE_CARD_LAYER, 1, x, y)));
        const bank = host.textBank(u32(mem.read32(PLACE_CARD_TEXT_GLOBAL) + bankBase));
        host.callMethod(u32(mem.read32(extra + slot)), 0x114, [bank, mem.read8(rec + index) & 0xff]);
        host.callMethod(u32(mem.read32(extra + slot)), 0x130, [PLACE_CARD_REVEAL_DELAY]);
    };
    label(0, 0x80, 0x1a, PLACE_CARD_AREA_BANK_BASE, 0);
    label(4, 0x28, 0x44, PLACE_CARD_PLACE_BANK_BASE, 1);
}

/**
 * F0x80087704(obj, rec): step one bar. Axis 1 moves x/width, axis 2 y/height;
 * each edge steps toward its target and clamps there. Once both edges have
 * arrived the axis is written 0 (one shared check at 0x4B88).
 */
export function placeCardBarStep(mem: PlaceCardMemory, rec: number): void {
    const axis = s32(mem.read32(rec + 0x10));
    if (axis !== 1 && axis !== 2) return;
    const posOff = axis === 1 ? 4 : 6;
    const sizeOff = axis === 1 ? 8 : 0x0a;
    let pos = s16(mem.read16(rec + posOff));
    let end = s32(pos + s16(mem.read16(rec + sizeOff)));
    const near = s32(mem.read32(rec + 0x14));
    const far = s32(mem.read32(rec + 0x18));
    const step = s32(mem.read32(rec + 0x1c));
    if (pos < near) {
        pos = s32(pos + step);
        if (near < pos) pos = near;
    } else if (near < pos) {
        pos = s32(pos - step);
        if (pos < near) pos = near;
    }
    if (end < far) {
        end = s32(end + step);
        if (far < end) end = far;
    } else if (far < end) {
        end = s32(end - step);
        if (end < far) end = far;
    }
    mem.write16(rec + posOff, pos & 0xffff);
    mem.write16(rec + sizeOff, s32(end - pos) & 0xffff);
    if (pos === near && end === far) mem.write32(rec + 0x10, 0);
}

/**
 * F0x80087854(obj, ot, x | y << 16, w | h << 16, colour): one GP0 0x28 flat
 * quad, linked at the head of `ot`.
 */
export function placeCardBarDraw(
    mem: PlaceCardMemory, host: PlaceCardHost, ot: number, xy: number, wh: number, colour: number,
): void {
    const pkt = u32(host.packetCursor());
    const x = xy & 0xffff, y = (xy >>> 16) & 0xffff;
    const w = wh & 0xffff, h = (wh >>> 16) & 0xffff;
    mem.write8(pkt + 3, 5);
    mem.write32(pkt + 4, u32(colour));
    mem.write8(pkt + 7, 0x28);
    mem.write16(pkt + 0x08, x);
    mem.write16(pkt + 0x0c, (x + w) & 0xffff);
    mem.write16(pkt + 0x10, x);
    mem.write16(pkt + 0x14, (x + w) & 0xffff);
    mem.write16(pkt + 0x0a, y);
    mem.write16(pkt + 0x0e, y);
    mem.write16(pkt + 0x12, (y + h) & 0xffff);
    mem.write16(pkt + 0x16, (y + h) & 0xffff);
    const head = u32(mem.read32(ot));
    mem.write32(pkt, u32((mem.read32(pkt) & 0xff000000) | (head & 0x00ffffff)));
    mem.write32(ot, u32((mem.read32(ot) & 0xff000000) | (pkt & 0x00ffffff)));
    host.flushPacketCursor(u32(pkt + 0x18));
}

/** F0x80087974(obj, extra): one frame of the card. */
export function placeCardTick(mem: PlaceCardMemory, host: PlaceCardHost, obj: number, extra: number): void {
    const call = (target: number, slot: number, args: number[] = []): number => host.callMethod(u32(target), slot, args);
    const word = (off: number): number => s32(mem.read32(obj + off));
    const state = word(0x0c);
    if (state === 1) placeCardBarsIn(mem, host, obj, extra);
    else if (state === 2) placeCardRelease(mem, host, obj);
    else if (state === 3) mem.write32(PLACE_CARD_BUSY, 0);
    else if (word(4) === 0) call(obj, 0x28, [2]);
    else {
        for (let i = 0; i < PLACE_CARD_BAR_COUNT; i++)
            for (let k = 0; k < PLACE_CARD_BAR_SIZE; k += 4)
                mem.write32(obj + PLACE_CARD_BARS + i * PLACE_CARD_BAR_SIZE + k,
                    mem.read32(PLACE_CARD_BAR_TEMPLATES + i * PLACE_CARD_BAR_SIZE + k));
        placeCardNames(mem, host, extra);
        call(obj, 0x38);
    }
    placeCardDrawBars(mem, host, obj);
}

/** Task state 1: the bars slide in by groups, then the names must finish. */
function placeCardBarsIn(mem: PlaceCardMemory, host: PlaceCardHost, obj: number, extra: number): void {
    const call = (target: number, slot: number, args: number[] = []): number => host.callMethod(u32(target), slot, args);
    const on = (rec: number): void => mem.write32(obj + PLACE_CARD_BARS + rec * PLACE_CARD_BAR_SIZE, 1);
    const axis = (rec: number): number => mem.read32(obj + PLACE_CARD_BARS + rec * PLACE_CARD_BAR_SIZE + 0x10);
    const sub = u32(mem.read32(obj + 0x10));
    switch (sub < 5 ? sub : 0) {
        case 0: {
            const wait = axis(5);
            on(0);
            on(5);
            if (wait !== 0) return;
            call(obj, 0x3c);
        }
        // falls through
        case 1: {
            const wait = axis(9);
            for (const rec of [8, 9, 6, 1, 2, 7, 3]) on(rec);
            if (wait !== 0) return;
            call(obj, 0x3c);
        }
        // falls through
        case 2:
            call(obj, 0x3c);
        // falls through
        case 3: {
            const wait = axis(4);
            on(4);
            if (wait !== 0) return;
            call(obj, 0x3c);
            return;
        }
        default: // 4
            if (call(mem.read32(extra), 0x168) === 0) return;
            if (call(mem.read32(extra + 4), 0x168) === 0) return;
            call(obj, 0x28, [2]);
    }
}

/** Task state 2: parked until released, then the hold and the closing slit. */
function placeCardRelease(mem: PlaceCardMemory, host: PlaceCardHost, obj: number): void {
    const call = (target: number, slot: number, args: number[] = []): number => host.callMethod(u32(target), slot, args);
    const half = (off: number): number => s16(mem.read16(obj + PLACE_CARD_SLIT + off));
    const view = u32(host.viewForKey(PLACE_CARD_LAYER));
    const sub = s32(mem.read32(obj + 0x10));
    if (sub < 1 || sub > 3) return;
    if (sub === 1) {
        const hold = s32(mem.read32(obj + 0x14) + host.frameDelta());
        mem.write32(obj + 0x14, u32(hold));
        if (hold < PLACE_CARD_HOLD) return;
        call(obj, 0x3c);
    }
    if (sub <= 2) {
        mem.write16(obj + PLACE_CARD_SLIT + 4, 0x140);
        mem.write16(obj + PLACE_CARD_SLIT + 0, 0);
        mem.write16(obj + PLACE_CARD_SLIT + 2, 0);
        mem.write16(obj + PLACE_CARD_SLIT + 6, 0xf0);
        call(obj, 0x3c);
    }
    mem.write16(obj + PLACE_CARD_SLIT + 2, (mem.read16(obj + PLACE_CARD_SLIT + 2) + 8) & 0xffff);
    mem.write16(obj + PLACE_CARD_SLIT + 6, (mem.read16(obj + PLACE_CARD_SLIT + 6) - 0x10) & 0xffff);
    call(view, 0x110, [half(0), half(2)]);
    call(view, 0x114, [half(4), half(6)]);
    if (half(6) !== 0) return;
    call(obj, 0x28, [3]);
}

/** The draw tail (0x4FDC): animate and draw every enabled bar, in record order. */
function placeCardDrawBars(mem: PlaceCardMemory, host: PlaceCardHost, obj: number): void {
    const state = mem.read32(obj + 0x0c);
    if (u32(state - 1) >= 2 || mem.read32(obj + 4) === 0) return;
    const view = u32(host.viewForKey(PLACE_CARD_LAYER));
    const ot = u32(host.callMethod(view, 0x138, [1]));
    for (let i = 0; i < PLACE_CARD_BAR_COUNT; i++) {
        const rec = obj + PLACE_CARD_BARS + i * PLACE_CARD_BAR_SIZE;
        if (mem.read32(rec) === 0) continue;
        placeCardBarStep(mem, rec);
        const xy = u32(mem.read16(rec + 4) | (mem.read16(rec + 6) << 16));
        const wh = u32(mem.read16(rec + 8) | (mem.read16(rec + 0x0a) << 16));
        placeCardBarDraw(mem, host, ot, xy, wh, mem.read32(rec + 0x0c));
    }
}
