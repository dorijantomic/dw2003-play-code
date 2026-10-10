// The field conversation balloon's ADVANCE MARKER (the animated arrow showing
// more text follows), translated bit-exactly from the resident EXE
// F0x8001C4B4 (spawn), F0x8001C448 (task tick) and F0x8001BEEC (marker draw).
//
// Oracle: tests/lane-b/dialogue-marker.test.js runs the originals through
// engine/native on resident.bin and compares memory writes and the ordered
// calls, including every draw-context call with its arguments.
// Worklist: .dw3-research/screen-worklists-2026-10-01/dialogue.md.
//
// Marker task fields: +0xC task state, +0x28 base method, +0x50 balloon
// (window) object, +0x54 frame (0..3), +0x58 last step frame, +0x5C visible
// flag (byte). Balloon fields read: +0x54 draw layer, +0x58 mode (0..3),
// +0x60 / +0x62 position (s16), +0x64 tail x (s16).
// Table D0x8004DD10: 0x20-byte entries per mode, s16 x offset at +0, s16 y
// offset at +2. Modes 2 and 3 ignore the table x and use (+0x64 - 0xE).
//
// F0x80014504, F0x8001F648 (stack draw context), the context slots, the pack
// getter, the frame counter, F0x8001C050 (balloon outline + fill, next step)
// and the base method are host boundaries. Context slot names follow
// dialogue-band.ts.

export const MARKER_SPAWN = 0x8001c4b4;
export const MARKER_TICK = 0x8001c448;
export const MARKER_DRAW = 0x8001beec;
export const MARKER_TASK_SIZE = 0x60;
export const MARKER_TABLE = 0x8004dd10;
export const MARKER_PACK = 0x02860000;
export const MARKER_CLIP = 7;
export const MARKER_FRAMES = 4;
export const MARKER_STEP_VSYNCS = 6;

export interface MarkerMemory {
    read8(addr: number): number;
    read16s(addr: number): number;
    read32(addr: number): number;
    write32(addr: number, value: number): void;
}

export interface MarkerHost {
    /** F0x80014504(tick, size, align): create the task, return its object. */
    createTask(tick: number, size: number, align: number): number;
    /** obj.method[slot](obj, ...args). */
    callMethod(obj: number, slot: number, args: number[]): void;
    /** F0x8001C050(obj): balloon outline + translucent fill (next step). */
    drawBalloon(obj: number): void;
    /** [0x8004DE10+0x188](): the frame counter. */
    frameCounter(): number;
    /** F0x8001F648(&ctx): the shared stack draw context. */
    initDrawContext(): void;
    /** ctx+0x7C(layer, bucket). */
    setLayer(layer: number, bucket: number): void;
    /** ctx+0x74(x, y). */
    setOrigin(x: number, y: number): void;
    /** ctx+0x88(frame). */
    setFrame(frame: number): void;
    /** ctx+0x84(packPtr, clip, x, y). */
    drawSprite(packPtr: number, clip: number, x: number, y: number): void;
    /** [0x80044F5C](handle): the pack getter. */
    packResolve(handle: number): number;
}

const u32 = (v: number): number => v >>> 0;
const s32 = (v: number): number => v | 0;

/** F0x8001C4B4(balloon): spawn the marker task and store the balloon at +0x50. */
export function dialogueMarkerSpawn(mem: MarkerMemory & { write32(a: number, v: number): void }, host: MarkerHost, balloon: number): number {
    const task = u32(host.createTask(MARKER_TICK, MARKER_TASK_SIZE, 0));
    mem.write32(task + 0x50, balloon);
    return task;
}

/**
 * F0x8001BEEC(task): when +0x5C is set, draw clip 7 of the CMFONTCS pack,
 * frame +0x54 (advanced every 6 vsyncs, wraps at 4), at
 * (balloon+0x60 + xOff, balloon+0x62 + table[mode].y).
 */
export function dialogueMarkerDraw(mem: MarkerMemory, host: MarkerHost, task: number): void {
    const balloon = u32(mem.read32(task + 0x50));
    const mode = s32(mem.read32(balloon + 0x58));
    const entry = u32(MARKER_TABLE + (mode << 5));
    const xOff = (mode - 2) >>> 0 < 2 ? mem.read16s(balloon + 0x64) - 0xe : mem.read16s(entry);
    if (mem.read8(task + 0x5c) === 0) return;
    host.initDrawContext();
    host.setLayer(s32(mem.read32(balloon + 0x54)), 0);
    host.setOrigin(0x140, 0);
    if (s32(host.frameCounter() - s32(mem.read32(task + 0x58))) >= MARKER_STEP_VSYNCS) {
        mem.write32(task + 0x58, s32(host.frameCounter()));
        const f = s32(mem.read32(task + 0x54) + 1);
        mem.write32(task + 0x54, f);
        if (f >= MARKER_FRAMES) mem.write32(task + 0x54, 0);
    }
    host.setFrame(s32(mem.read32(task + 0x54)));
    const pack = host.packResolve(MARKER_PACK);
    const b2 = u32(mem.read32(task + 0x50));
    host.drawSprite(pack, MARKER_CLIP, s32(mem.read16s(b2 + 0x60) + xOff), s32(mem.read16s(b2 + 0x62) + mem.read16s(entry + 2)));
}

/** F0x8001C448(task): state 1 draws marker then balloon; states below 2 or from 4 call method 0x28(2). */
export function dialogueMarkerTick(mem: MarkerMemory, host: MarkerHost, task: number): void {
    const state = s32(mem.read32(task + 0x0c));
    if (state === 1) {
        dialogueMarkerDraw(mem, host, task);
        host.drawBalloon(task);
    } else if (state < 2 || state >= 4) {
        host.callMethod(task, 0x28, [2]);
    }
}
