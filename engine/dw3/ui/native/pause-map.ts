// The MAP pause page (the world map with a scrolling view and a blinking marker),
// translated from the original pro/ststatus bodies.
//
// Part D of docs/plans/2026-09-28-translated-game-completion-plan.md. Oracle:
// tests/lane-b/pause-map.test.js runs each original through engine/native.
//
//   F0x80099324 mapFactory  build the page object (0x1A0 bytes, 4 extra).
//   F0x8009913C mapRoot     load, build the cursor and scroll to the start, then tick.
//   F0x80098450 mapScroll   move the view one step: the view pans across three bands.
//   F0x800986C0 mapTick     read the pad: scroll speed, scroll, close.
//   F0x80098294 mapZone     which of the 47 zones the cursor is over, and its label.
//   F0x80098B84 mapDraw     the map, the cursor, the zone markers and the tier layer.
//
// Object fields: +0x78 map variant; +0x80/+0x84/+0x88 the three pack ids; +0x8C the
// text bank; +0x90/+0x94 the map's pan; +0x98/+0x9C the start position; +0xA0 the marker
// blink frame; +0xA8.. one word per zone (nonzero = revealed); +0x164/+0x168 the cursor;
// +0x16C the cursor is showing; +0x170 the cursor frame; +0x174 the last frame it moved;
// +0x178/+0x17C the horizontal and vertical scroll speed; +0x180 the cursor is over a
// zone; +0x184 that zone; +0x188/+0x18C the cursor where it landed on the zone.
import { PAUSE_LANGUAGE_CELL, type PauseMemory, type PauseServices } from "./pause-services.ts";

export const MAP_HANDLER = 0x8009913c;
export const MAP_SIZE = 0x1a0;
export const MAP_EXTRA = 4;
const FRAMES = 0x8009af68;
const ZONES = 0x8009af70;
const CURSOR_FRAMES = 0x8009a978;
/** [0x8004B370]: the story progress count that picks the revealed tier. */
export const MAP_PROGRESS_CELL = 0x8004b370;

const HIT_X = 6;
const HIT_Y = 0x12;
const ZONE_COUNT = 0x2f;

export interface MapHost extends PauseServices {
    alloc(handler: number, size: number, extra: number): number;
    /** [0x8009B6EC+0](): which map (0 or 1). */
    menuVariant(): number;
    /** [0x8009B6EC+4](): the map level. */
    mapLevel(): number;
    /** [0x8009B6EC+8](dest): fill one revealed word per zone. */
    mapFillZones(dest: number): void;
    /** [0x80044F44](id): request the text bank. */
    requestBank(id: number): void;
    /** [0x80044F3C](id, arg): nonzero until the bank has loaded. */
    bankPending(id: number, arg: number): number;
    /** [0x8009B5E8](variant, tier): the marker list for the tier. */
    markerList(variant: number, tier: number): number;
}

/** F0x80099324(parent): build the page object. */
export function mapFactory(mem: PauseMemory, parent: number, host: MapHost): number {
    const obj = host.alloc(MAP_HANDLER, MAP_SIZE, MAP_EXTRA);
    mem.write32(obj + 0x54, 0x1000);
    mem.write32(obj + 0x58, 5);
    mem.write32(obj + 0x50, parent);
    const variant = host.menuVariant() | 0;
    mem.write32(obj + 0x78, variant);
    const lang = mem.read32(PAUSE_LANGUAGE_CELL) | 0;
    const pack = variant === 0 ? 0x0799 : 0x079b;
    mem.write32(obj + 0x80, pack << 16);
    mem.write32(obj + 0x88, (pack << 16) | 2);
    mem.write32(obj + 0x84, (pack << 16) | 1);
    mem.write32(obj + 0x68, pack);
    mem.write32(obj + 0x8c, variant === 0 ? lang + 8 : lang + 1);
    host.requestBank(mem.read32(obj + 0x8c) | 0);
    mem.write32(obj + 0x5c, 0xf0);
    mem.write32(obj + 0x60, 0x10);
    return obj;
}

/** F0x80098450(obj, dx, dy): pan the view one step; +/-1 picks the direction. */
export function mapScroll(mem: PauseMemory, obj: number, dx: number, dy: number): void {
    const r = (off: number) => mem.read32(obj + off) | 0;
    const w = (off: number, v: number) => mem.write32(obj + off, v | 0);
    if (dx < 0) {
        const c = r(0x164);
        if (c >= 0xa1) {
            w(0x164, c - r(0x178));
            if (r(0x164) < 0xa0) w(0x164, 0xa0);
        } else if (c < 0xa0) {
            w(0x164, c - r(0x178));
            if (r(0x164) < 0x16) w(0x164, 0x16);
        } else {
            w(0x90, r(0x90) + r(0x178));
            if (r(0x90) > 0) {
                w(0x90, 0);
                w(0x164, 0x9f);
            }
        }
    } else if (dx > 0) {
        const c = r(0x164);
        if (c < 0xa0) {
            w(0x164, c + r(0x178));
            if (r(0x164) >= 0xa1) w(0x164, 0xa0);
        } else if (c >= 0xa1) {
            w(0x164, c + r(0x178));
            if (r(0x164) >= 0x12b) w(0x164, 0x12a);
        } else {
            w(0x90, r(0x90) - r(0x178));
            if (r(0x90) < -0x48) {
                w(0x90, -0x48);
                w(0x164, 0xa1);
            }
        }
    }
    const size = r(0x5c);
    const half = (size + (size >>> 31)) >> 1;
    if (dy < 0) {
        const c = r(0x168);
        if (half < c) {
            w(0x168, c - r(0x17c));
            if (r(0x168) < half) w(0x168, half);
        } else if (c < half) {
            w(0x168, c - r(0x17c));
            if (r(0x168) < 0xf) w(0x168, 0xf);
        } else {
            w(0x94, r(0x94) + r(0x17c));
            if (r(0x94) > 0) {
                w(0x94, 0);
                w(0x168, half - 1);
            }
        }
    } else if (dy > 0) {
        const c = r(0x168);
        if (c < half) {
            w(0x168, c + r(0x17c));
            if (half < r(0x168)) w(0x168, half);
        } else if (half < c) {
            w(0x168, c + r(0x17c));
            const limit = size - r(0x60) - 0x1e;
            if (limit < r(0x168)) w(0x168, limit);
        } else {
            w(0x94, r(0x94) - r(0x17c));
            if (r(0x94) < -0x60) {
                w(0x94, -0x60);
                w(0x168, half + 1);
            }
        }
    }
}

/** F0x800986C0(obj): read the pad; hold builds the scroll speed, circle closes. */
export function mapTick(mem: PauseMemory, obj: number, host: MapHost): void {
    const w = (off: number, v: number) => mem.write32(obj + off, v | 0);
    const r = (off: number) => mem.read32(obj + off) | 0;
    const bit = (bits: number, code: number) => (bits >> host.padBit(0, code)) & 1;
    // A direction is down when either of its two button codes is set in the word.
    const held = (a: number, b: number) => {
        if (bit(host.padHeld(0), a)) return true;
        return bit(host.padHeld(0), b) !== 0;
    };
    const pressed = (a: number, b: number) => {
        if (bit(host.padPressed(0), a)) return true;
        return bit(host.padPressed(0), b) !== 0;
    };
    const repeat = (a: number, b: number) => {
        if (bit(host.padRepeat(0), a)) return true;
        return bit(host.padRepeat(0), b) !== 0;
    };
    const speed = (off: number, a: number, b: number) => {
        if (held(a, b)) {
            if (pressed(a, b)) {
                w(off, 2);
            } else if (repeat(a, b)) {
                w(off, r(off) + 1);
                if (r(off) >= 5) w(off, 4);
            }
        } else {
            w(off, 0);
        }
    };
    speed(0x178, 7, 5);
    speed(0x17c, 4, 6);
    let dx = 0;
    if (bit(host.padHeld(0), 7)) dx = -1;
    else if (bit(host.padHeld(0), 5)) dx = 1;
    if (dx !== 0) mapScroll(mem, obj, dx, 0);
    let dy = 0;
    if (bit(host.padHeld(0), 4)) dy = -1;
    else if (bit(host.padHeld(0), 6)) dy = 1;
    if (dy !== 0) mapScroll(mem, obj, 0, dy);
    if (bit(host.padPressed(0), 0xe)) {
        host.playSound(0x800450bd);
        w(0xc, 3);
    }
}

/** F0x80098294(obj, ui): find the zone under the cursor and label it. */
export function mapZone(mem: PauseMemory, obj: number, ui: number, host: MapHost): void {
    const r = (off: number) => mem.read32(obj + off) | 0;
    const w = (off: number, v: number) => mem.write32(obj + off, v | 0);
    const before = r(0x180);
    w(0x180, 0);
    const cx = r(0x164) - r(0x90);
    const cy = r(0x168) - r(0x94);
    const table = (mem.read32(ZONES) | 0) + 0xc;
    for (let z = 1; z < ZONE_COUNT; z++) {
        if ((mem.read32(obj + 0xa8 + (z - 1) * 4) | 0) === 0) continue;
        const e = table + (z - 1) * 0xc;
        const x = mem.read32(e + 4) | 0;
        const y = mem.read32(e + 8) | 0;
        if (x + HIT_X < cx && !(x + HIT_Y < cx) && y + HIT_X < cy && !(y + HIT_Y < cy)) {
            w(0x180, 1);
            w(0x184, z);
            break;
        }
    }
    const now = r(0x180);
    if (before !== now) {
        if (now !== 0) {
            host.playSound(0x4001c);
            w(0x188, r(0x164));
            w(0x18c, r(0x168));
        } else {
            host.callMethod(mem.read32(ui) | 0, 0x144, [0]);
        }
    }
    if (r(0x180) !== 0) {
        const size = r(0x5c);
        const half = (size + (size >>> 31)) >> 1;
        const y = r(0x18c) < half ? 0xb9 : 0x19;
        host.callMethod(mem.read32(ui) | 0, 0x134, [0x10, y]);
        const bank = host.languageBank(r(0x8c));
        host.callMethod(mem.read32(ui) | 0, 0x114, [bank, r(0x184)]);
    }
}

/** F0x80098B84(obj): the map, the cursor, the zone markers and the tier layer. */
export function mapDraw(mem: PauseMemory, obj: number, host: MapHost): void {
    const r = (off: number) => mem.read32(obj + off) | 0;
    const w = (off: number, v: number) => mem.write32(obj + off, v | 0);
    const size = r(0x5c);
    const half = (size + (size >>> 31)) >> 1;
    if (r(0x180) !== 0) {
        host.drawInit();
        host.draw7C(r(0x54), r(0x58) - 2);
        host.draw74(0x280, 0x100);
        const handle = host.packHandle(0x04040000);
        host.drawSprite(handle, 0x3b, 0, r(0x18c) < half ? 0xb4 : 0x14);
    }
    host.drawInit();
    if (r(0x16c) !== 0) {
        if (host.frameCount() - r(0x174) >= 4) {
            w(0x174, host.frameCount());
            w(0x170, r(0x170) + 1);
            if (r(0x170) >= 4) w(0x170, 0);
            w(0xa0, r(0xa0) + 1);
            if (r(0xa0) >= 3) w(0xa0, 0);
        }
        host.draw74(0x300, 0x100);
        const cursorFrame = () => mem.read32(CURSOR_FRAMES + r(0x170) * 4) | 0;
        if (r(0x180) !== 0) {
            host.draw7C(r(0x54), r(0x58));
            const zone = (mem.read32(ZONES) | 0) + r(0x184) * 0xc;
            host.drawSprite(host.packHandle(r(0x88)), cursorFrame() + 0x38,
                (mem.read32(zone + 4) | 0) + r(0x90) + 0xc, (mem.read32(zone + 8) | 0) + r(0x94) + 0xc + r(0x60));
        } else {
            host.draw7C(r(0x54), r(0x58) - 1);
            host.drawSprite(host.packHandle(r(0x88)), cursorFrame() + 0x32, r(0x164), r(0x168) + r(0x60));
        }
        host.draw7C(r(0x54), r(0x58) - 2);
        const at = r(0x180) !== 0 ? r(0x188) : r(0x164);
        const base = r(0x98) + r(0x90);
        host.drawSprite(host.packHandle(r(0x88)), (at < base ? 0x35 : 0x3b) + r(0xa0), base,
            r(0x9c) + r(0x94) + r(0x60));
    }
    host.draw7C(r(0x54), r(0x58) - 1);
    if (r(0x16c) !== 0) {
        host.draw74(0x300, 0x100);
        const marks = mem.read32(FRAMES + 8) | 0;
        for (let z = 1; z < ZONE_COUNT; z++) {
            if ((mem.read32(obj + 0xa8 + (z - 1) * 4) | 0) === 0) continue;
            const e = marks + z * 0xc;
            host.drawSprite(host.packHandle(r(0x88)), mem.read32(e) | 0, (mem.read32(e + 4) | 0) + r(0x90),
                (mem.read32(e + 8) | 0) + r(0x94) + r(0x60));
        }
    }
    host.draw7C(r(0x54), r(0x58) + 1);
    const progress = mem.read32(MAP_PROGRESS_CELL) | 0;
    let list = host.markerList(r(0x78), r(0x7c)) | 0;
    let tier = 0;
    if (progress >= 7) {
        tier = 1;
        if (progress >= 0xf) {
            tier = 2;
            if (progress >= 0x1b) {
                tier = 3;
                if (progress >= 0x1e) tier = 4;
            }
        }
    }
    w(0x7c, tier);
    host.draw74(0x380, 0x100);
    const tierBase = mem.read32(FRAMES + 0xc) | 0;
    for (let id = mem.read32(list) | 0; id !== 0; id = mem.read32(list) | 0) {
        list += 4;
        const e = tierBase + id * 8;
        host.drawSprite(host.packHandle(r(0x84)), id - 1, (mem.read32(e) | 0) + r(0x90),
            (mem.read32(e + 4) | 0) + r(0x94) + r(0x60));
    }
    host.draw74(0x280, 0);
    host.draw78(0x140, 0x100);
    host.drawSprite(host.packHandle(r(0x80)), 0, r(0x90), r(0x94) + r(0x60));
}

/** F0x8009913C(obj, ui): load the banks, build the cursor and scroll to the start, then run. */
export function mapRoot(mem: PauseMemory, obj: number, ui: number, host: MapHost): void {
    const r = (off: number) => mem.read32(obj + off) | 0;
    const w = (off: number, v: number) => mem.write32(obj + off, v | 0);
    const state = r(0xc);
    if (state === 1) {
        mapTick(mem, obj, host);
        mapZone(mem, obj, ui, host);
        mapDraw(mem, obj, host);
        return;
    }
    if (state >= 2 && state < 4) return;
    const sub = r(0x10);
    if (sub !== 1) {
        if (host.bankPending(r(0x8c), sub === 0 ? ui : 1) === 0) w(0x10, r(0x10) + 1);
        return;
    }
    const cursor = host.createText(mem.read16s(obj + 0x54), 1, 0x14, 0x16);
    mem.write32(ui, cursor);
    host.callMethod(cursor, 0x160, [2]);
    w(0x190, 0xa);
    host.mapFillZones(obj + 0xa8);
    const level = host.mapLevel() + 1;
    const frames = mem.read32(FRAMES + 8) | 0;
    w(0x98, (mem.read32(frames + level * 0xc + 4) | 0) + 0xc);
    w(0x9c, (mem.read32(frames + level * 0xc + 8) | 0) + 0xc);
    w(0x178, sub);
    w(0x17c, sub);
    while (r(0x98) + r(0x90) !== r(0x164)) mapScroll(mem, obj, 1, 0);
    while (r(0x9c) + r(0x94) !== r(0x168)) mapScroll(mem, obj, 0, 1);
    w(0x178, 0);
    w(0x17c, 0);
    w(0x16c, 1);
    host.callMethod(obj, 0x38, []);
}
