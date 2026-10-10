// The field conversation box's band companion (the dark band that wipes in behind
// the plain bottom window), translated bit-exactly from the resident EXE
// F0x8001BB88 (create), F0x8001BA2C (tick), F0x8001B814 (band draw) and
// F0x8001B930 (advance-blink marker draw).
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/lane-b/dialogue-band.test.js runs the originals through
// engine/native on resident.bin and compares memory writes and the ordered
// calls, including every draw-context call with its arguments.
// Worklist: .dw3-research/screen-worklists-2026-10-01/dialogue.md.
//
// Object fields: +0xC task state, +0x10 step (0 wipe-in, 1 idle, 2 wipe-out,
// the window writes 2 to close), +0x28 / +0x38 / +0x3C base methods,
// +0x50 draw layer (the window handle), +0x54 last wipe-out frame, +0x58
// wipe-out step (0..4), +0x5C marker-visible flag (the window writes it),
// +0x60 last blink frame, +0x64 blink frame (0..4), +0x68 wipe width (s16),
// +0x6A wipe speed (0x199 once parked).
//
// F0x80014504, F0x8001F648 (the stack draw context), the context's function
// slots, the pack getter [0x80044F5C], the frame counter [0x8004DE10+0x188],
// the SFX entry and the base methods are host boundaries. The context slots
// use the names of cnty-draw.ts (offsets relative to the context base):
//   setLayer 0x7C, setOrigin 0x74, setScale 0x8C, setPos 0x94, drawSprite 0x84,
//   and setFrame 0x88 (new here, one argument).

export const BAND_CREATE = 0x8001bb88;
export const BAND_TICK = 0x8001ba2c;
export const BAND_DRAW = 0x8001b814;
export const BAND_MARKER = 0x8001b930;
export const BAND_TASK_SIZE = 0x6c;
export const BAND_SFX = 0x40019;
export const BAND_SOUND_CELL = 0x80055c48;
/** The pack handle passed to the getter at [0x80044F5C]. */
export const BAND_PACK = 0x02860000;

export interface BandMemory {
    read16s(addr: number): number;
    read32(addr: number): number;
    write16(addr: number, value: number): void;
    write32(addr: number, value: number): void;
}

export interface BandHost {
    /** F0x80014504(tick, size, align): create the task, return its object. */
    createTask(tick: number, size: number, align: number): number;
    /** [0x80055C48](id): play a packed sound. */
    playSound(id: number): void;
    /** obj.method[slot](obj, ...args). */
    callMethod(obj: number, slot: number, args: number[]): void;
    /** [0x8004DE10+0x188](): the frame counter. */
    frameCounter(): number;
    /** F0x8001F648(&ctx): the shared stack draw context. */
    initDrawContext(): void;
    /** ctx+0x7C(layer, bucket). */
    setLayer(layer: number, bucket: number): void;
    /** ctx+0x74(x, y). */
    setOrigin(x: number, y: number): void;
    /** ctx+0x8C(x, y, z). */
    setScale(x: number, y: number, z: number): void;
    /** ctx+0x94(x, y). */
    setPos(x: number, y: number): void;
    /** ctx+0x88(frame). */
    setFrame(frame: number): void;
    /** ctx+0x84(packPtr, clip, x, y). */
    drawSprite(packPtr: number, clip: number, x: number, y: number): void;
    /** [0x80044F5C](handle): the pack getter. */
    packResolve(handle: number): number;
}

const u32 = (v: number): number => v >>> 0;
const s32 = (v: number): number => v | 0;
const s16 = (v: number): number => (v << 16) >> 16;

/** F0x8001BB88(h): create the band task, return it. */
export function dialogueBandCreate(mem: BandMemory, host: BandHost, h: number): number {
    const task = u32(host.createTask(BAND_TICK, BAND_TASK_SIZE, 0));
    mem.write32(task + 0x50, h);
    host.playSound(BAND_SFX);
    return task;
}

/**
 * F0x8001B814(obj): two X-scaled strips, CMFONTCS clips 8 and 9 at y 0xA6.
 * Per strip: initDrawContext, setLayer(+0x50, 0), setOrigin(0x140, 0), then
 * step 0: setScale(s16 +0x68, 0x1000, 0x1000), setPos(0x140 - 0x140*i, 0xC4);
 * step 2: setFrame(+0x58); then drawSprite(pack, 8 + i, 0, 0xA6).
 */
export function dialogueBandDraw(mem: BandMemory, obj: number, host: BandHost): void {
    for (let i = 0; i < 2; i++) {
        host.initDrawContext();
        host.setLayer(s32(mem.read32(obj + 0x50)), 0);
        host.setOrigin(0x140, 0);
        const step = s32(mem.read32(obj + 0x10));
        if (step === 0) {
            host.setScale(mem.read16s(obj + 0x68), 0x1000, 0x1000);
            host.setPos(0x140 - 0x140 * i, 0xc4);
        } else if (step === 2) {
            host.setFrame(s32(mem.read32(obj + 0x58)));
        }
        const pack = host.packResolve(BAND_PACK);
        host.drawSprite(pack, 8 + i, 0, 0xa6);
    }
}

/** F0x8001B930(obj): the 5-frame advance-blink marker, step 4 frames, at (0x124, 0xCD). */
export function dialogueBandMarker(mem: BandMemory, obj: number, host: BandHost): void {
    host.initDrawContext();
    host.setLayer(s32(mem.read32(obj + 0x50)), 0);
    host.setOrigin(0x140, 0);
    if (s32(host.frameCounter() - s32(mem.read32(obj + 0x60))) >= 4) {
        mem.write32(obj + 0x60, s32(host.frameCounter()));
        const f = s32(mem.read32(obj + 0x64) + 1);
        mem.write32(obj + 0x64, f);
        if (f >= 5) mem.write32(obj + 0x64, 0);
    }
    host.setFrame(s32(mem.read32(obj + 0x64)));
    const pack = host.packResolve(BAND_PACK);
    host.drawSprite(pack, 0xa, 0x124, 0xcd);
}

/** F0x8001BA2C(obj): the band's per-frame tick. */
export function dialogueBandTick(mem: BandMemory, obj: number, host: BandHost): void {
    const taskState = s32(mem.read32(obj + 0x0c));
    if (taskState !== 1) {
        if (taskState < 2 || taskState >= 4) {
            host.callMethod(obj, 0x38, []);
            mem.write16(obj + 0x6a, 0x199);
        }
        return;
    }
    const step = s32(mem.read32(obj + 0x10));
    if (step === 1) {
        if (s32(mem.read32(obj + 0x5c)) !== 0) dialogueBandMarker(mem, obj, host);
    } else if (step === 2) {
        if (s32(host.frameCounter() - s32(mem.read32(obj + 0x54))) >= 3) {
            mem.write32(obj + 0x54, s32(host.frameCounter()));
            const n = s32(mem.read32(obj + 0x58) + 1);
            mem.write32(obj + 0x58, n);
            if (n >= 5) {
                host.callMethod(obj, 0x28, [3]);
                return;
            }
        }
    } else {
        const w = (mem.read16s(obj + 0x68) + mem.read16s(obj + 0x6a)) & 0xffff;
        mem.write16(obj + 0x68, w);
        if (s16(w) >= 0x1001) {
            mem.write16(obj + 0x68, 0x1000);
            host.callMethod(obj, 0x3c, []);
        }
    }
    dialogueBandDraw(mem, obj, host);
}
