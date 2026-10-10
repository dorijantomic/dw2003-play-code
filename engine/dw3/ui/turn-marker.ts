// The card duel's turn marker, translated from pro/cardgame:
//   F0x80099BE4 turnMarkerFadeTick — ramp the marker's scale, then draw
//   F0x800999A0 drawTurnMarker     — place, scale and draw the marker
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/turn-marker-oracle.test.js runs both originals through
// engine/native on the shipped pro_cardgame.bin + resident.bin with the draw
// context, the object method slots and the resident lookup recorded.
//
// DECODED: authority-2 closures `_asm/F0x80099be4.s` and `_asm/F0x800999a0.s`.
// The fade struct (the tick's a3) is {level +0x00 s16, counter +0x04 s16,
// duration +0x06 s16, state +0x08 u8}. The tick forwards (a0, a1, a2, a3) to
// drawTurnMarker. drawTurnMarker picks a placement pair from the 16-byte table
// entries at 0x800A5AA8 indexed by mem32(0x8005CCB0): marker 0 uses +0x00/+0x02
// and +0x08/+0x0A, every other marker uses +0x04/+0x06 and +0x0C/+0x0E.

export interface TurnMarkerMemory {
    read8(addr: number): number;
    read16s(addr: number): number;
    read32(addr: number): number;
    write16(addr: number, value: number): void;
}

export interface TurnMarkerHost {
    /** `[0x8004DF9C]` = resident F0x8001D704: the frame delta. */
    frameDelta(): number;
    /** ctx+0x7C (F0x8001ED34): set the draw layer target and bucket. */
    setLayer(target: number, bucket: number): void;
    /** ctx+0x74 (F0x8001ECBC): set the draw origin. */
    setOrigin(x: number, y: number): void;
    /** ctx+0x94 (F0x8001F608): set the sprite position. */
    setPos(x: number, y: number): void;
    /** ctx+0x8C (F0x8001F5D0): set the sprite scale. */
    setScale(sx: number, sy: number, sz: number): void;
    /** ctx+0x84 (F0x8001ED6C): draw a sprite from the resolved pack. */
    drawSprite(handle: number, clip: number, x: number, y: number): void;
    /** `[0x80044F5C]`: resolve a pack handle to its image. */
    packResolve(handle: number): number;
    /** An indirect call through the object's method table at `slot`. */
    callSlot(obj: number, slot: number, a1: number, a2: number): number;
    /** `[0x80044F4C](arg)`: the resident language lookup. */
    callService44F4C(arg: number): number;
}

export const TURN_MARKER = { level: 0x00, counter: 0x04, duration: 0x06, state: 0x08 } as const;
/** The marker placement table and its selector. */
export const TURN_MARKER_TABLE = 0x800a5aa8;
export const TURN_MARKER_SELECTOR = 0x8005ccb0;
export const TURN_MARKER_LANGUAGE = 0x8005cca8;
export const TURN_MARKER_SHEET = 0x025d0002;
export const TURN_MARKER_LAYER = 0x100;
export const TURN_MARKER_ORIGIN = { x: 0x280, y: 0 } as const;
export const TURN_MARKER_FULL_SCALE = 0x1000;
/** The two clip ids: index 0 and every other marker. */
export const TURN_MARKER_CLIP_INDEX0 = 0x44;
export const TURN_MARKER_CLIP_OTHER = 0x43;
/** The object method slots drawTurnMarker calls. */
export const TURN_MARKER_SLOT_POS = 0x134;
export const TURN_MARKER_SLOT_TEXT = 0x114;
export const TURN_MARKER_SLOT_CLEAR = 0x144;

const s16 = (v: number): number => (v << 16) >> 16;

/**
 * F0x80099BE4(view, a1, index, marker): step the marker's scale, then draw it.
 * State 1 ramps 0x1000 - (counter<<12)/duration down and latches to state 2;
 * state 3 ramps (counter<<12)/duration up and clears to state 0; every other
 * state just draws.
 */
export function turnMarkerFadeTick(
    mem: TurnMarkerMemory, view: number, a1: number, index: number, marker: number, host: TurnMarkerHost,
): void {
    const state = mem.read8(marker + TURN_MARKER.state);
    if (state === 1) {
        const counter = s16(mem.read16s(marker + TURN_MARKER.counter));
        const duration = s16(mem.read16s(marker + TURN_MARKER.duration));
        const level = Math.trunc((counter << 12) / duration);
        mem.write16(marker + TURN_MARKER.level, (TURN_MARKER_FULL_SCALE - level) & 0xffff);
        const next = (mem.read16s(marker + TURN_MARKER.counter) - (host.frameDelta() | 0)) & 0xffff;
        mem.write16(marker + TURN_MARKER.counter, next);
        if (s16(next) <= 0) mem.write16(marker + TURN_MARKER.state, 2);
        drawTurnMarker(mem, view, a1, index, marker, host);
        return;
    }
    if (state === 3) {
        const counter = s16(mem.read16s(marker + TURN_MARKER.counter));
        const duration = s16(mem.read16s(marker + TURN_MARKER.duration));
        const level = Math.trunc((counter << 12) / duration);
        mem.write16(marker + TURN_MARKER.level, level & 0xffff);
        const next = (mem.read16s(marker + TURN_MARKER.counter) - (host.frameDelta() | 0)) & 0xffff;
        mem.write16(marker + TURN_MARKER.counter, next);
        if (s16(next) <= 0) mem.write16(marker + TURN_MARKER.state, 0);
        drawTurnMarker(mem, view, a1, index, marker, host);
        return;
    }
    // 0, 2 and every value above 3 only draw.
    drawTurnMarker(mem, view, a1, index, marker, host);
}

/** F0x800999A0(view, a1, index, marker): place, scale and draw the marker. */
export function drawTurnMarker(
    mem: TurnMarkerMemory, view: number, a1: number, index: number, marker: number, host: TurnMarkerHost,
): void {
    const table = (TURN_MARKER_TABLE + (mem.read32(TURN_MARKER_SELECTOR) << 4)) >>> 0;
    let sx: number;
    let sy: number;
    let tx: number;
    let ty: number;
    if (index === 0) {
        sx = s16(mem.read16s(table + 0x00));
        sy = s16(mem.read16s(table + 0x02));
        tx = s16(mem.read16s(table + 0x08));
        ty = s16(mem.read16s(table + 0x0a));
    } else {
        sx = s16(mem.read16s(table + 0x04));
        sy = s16(mem.read16s(table + 0x06));
        tx = s16(mem.read16s(table + 0x0c));
        ty = s16(mem.read16s(table + 0x0e));
    }
    const state = mem.read8(marker + TURN_MARKER.state);
    // The clear-slot call reads a2 as a register leftover: the marker index
    // when nothing was drawn this tick, otherwise the drawn x.
    let leftoverA2 = index;
    if (state !== 0) {
        host.setLayer(TURN_MARKER_LAYER, 1);
        host.setOrigin(TURN_MARKER_ORIGIN.x, TURN_MARKER_ORIGIN.y);
        const p = (view + index * 0x54) >>> 0;
        const px = s16(mem.read16s(p + 0x6c)) + sx;
        const py = s16(mem.read16s(p + 0x6e)) + sy;
        leftoverA2 = px;
        host.setPos(px, py);
        host.setScale(s16(mem.read16s(marker + TURN_MARKER.level)), TURN_MARKER_FULL_SCALE, TURN_MARKER_FULL_SCALE);
        const handle = host.packResolve(TURN_MARKER_SHEET) >>> 0;
        host.drawSprite(handle, index === 0 ? TURN_MARKER_CLIP_INDEX0 : TURN_MARKER_CLIP_OTHER, px, py);
    }
    const obj = mem.read32(a1 + index * 4 + 0x10) >>> 0;
    if (state === 2) {
        const q = (view + index * 0x54) >>> 0;
        const px = s16((mem.read16s(q + 0x6c) + tx) & 0xffff);
        const py = s16((mem.read16s(q + 0x6e) + ty) & 0xffff);
        host.callSlot(obj, TURN_MARKER_SLOT_POS, px, py);
        const language = mem.read32(TURN_MARKER_LANGUAGE) | 0;
        const text = host.callService44F4C(language + 0x0f) | 0;
        host.callSlot(obj, TURN_MARKER_SLOT_TEXT, text, 0x3f);
        return;
    }
    host.callSlot(obj, TURN_MARKER_SLOT_CLEAR, 0, leftoverA2 | 0);
}
