// The fight report's closing fade object, translated from the original
// pro/stfgtrep bodies. It is the same family as the naming screen's fade
// (native/name-fade.ts) and the merchant's (shop-fade-task.ts): a 0x68-byte object
// whose 0..0xFF00 accumulator drives a full-screen subtractive dim.
//
// Oracle: tests/lane-b/fight-report-fade.test.js runs the originals through
// engine/native and compares the ordered calls and the fields.
//
//   F0x80083218 reportFadeCreate  build the object: start method +0x64 = F0x80082F98,
//                                 layer +0x50 = 0x1000, bucket +0x54 = 6.
//   F0x80082F98 reportFadeStart   (dir, frames): state 1, armed; a fade-out (dir 0) rises
//                                 from 0, a fade-in falls from 0xFF00, by 0xFF00 / frames.
//   F0x80083164 reportFadeTick    state 1 (armed) steps and lands in state 2 at either end,
//                                 then paints; state 2 paints; state 3 idles; the default
//                                 arm advances the task state.
//   F0x80083020 (dimQuad)         the GPU primitive: a flat quad over (0,0)-(0x140,0x100) in
//                                 layer [+0x50], bucket [+0x54], grey level [+0x5C] >> 8,
//                                 semi-transparency mode 2 (background minus foreground).
//                                 A host boundary; the browser paints the dim over the frame.
export const REPORT_FADE_HANDLER = 0x80083164;
export const REPORT_FADE_SIZE = 0x68;
export const REPORT_FADE_START_ENTRY = 0x80082f98;
export const REPORT_FADE_START_SLOT = 0x64;
export const REPORT_FADE_FRAMES = 0x1e;
const FADE_FULL = 0xff00;

export interface ReportFadeMemory {
    read32(addr: number): number;
    write32(addr: number, value: number): void;
}

export interface ReportFadeHost {
    /** F0x80014504(handler, size, extra): allocate a screen object. */
    alloc(handler: number, size: number, extra: number): number;
    /** target+slot(args...): an object method. */
    callMethod(target: number, slot: number, args: number[]): void;
    /** F0x80083020(fade): paint the dim rectangle. */
    dimQuad(fade: number): void;
}

/** F0x80083218(): build the fade object. */
export function reportFadeCreate(mem: ReportFadeMemory, host: Pick<ReportFadeHost, "alloc">): number {
    const obj = host.alloc(REPORT_FADE_HANDLER, REPORT_FADE_SIZE, 0);
    mem.write32(obj + REPORT_FADE_START_SLOT, REPORT_FADE_START_ENTRY | 0);
    mem.write32(obj + 0x50, 0x1000);
    mem.write32(obj + 0x54, 6);
    return obj;
}

/** F0x80082F98(obj, direction, frames): start the ramp. */
export function reportFadeStart(
    mem: ReportFadeMemory, obj: number, direction: number, frames: number,
    host: Pick<ReportFadeHost, "callMethod">,
): void {
    host.callMethod(obj, 0x28, [1]);
    mem.write32(obj + 0x10, 1);
    mem.write32(obj + 0x58, direction | 0);
    // MIPS signed div: a zero divisor yields -1 for a positive dividend.
    const step = frames === 0 ? -1 : Math.trunc(FADE_FULL / (frames | 0));
    if ((direction | 0) === 0) {
        mem.write32(obj + 0x5c, 0);
        mem.write32(obj + 0x60, step | 0);
        return;
    }
    mem.write32(obj + 0x5c, FADE_FULL);
    mem.write32(obj + 0x60, -step | 0);
}

/** F0x80083164(obj): one frame of the fade. */
export function reportFadeTick(mem: ReportFadeMemory, obj: number, host: ReportFadeHost): void {
    const state = mem.read32(obj + 0x0c) | 0;
    if (state !== 1 && state !== 2 && state !== 3) {
        host.callMethod(obj, 0x38, [obj]);
        return;
    }
    if (state === 3) return;
    if (state === 1) {
        if ((mem.read32(obj + 0x10) | 0) === 0) return;
        const next = ((mem.read32(obj + 0x5c) | 0) + (mem.read32(obj + 0x60) | 0)) | 0;
        mem.write32(obj + 0x5c, next);
        if ((mem.read32(obj + 0x58) | 0) === 0) {
            if (next > FADE_FULL) {
                mem.write32(obj + 0x5c, FADE_FULL);
                mem.write32(obj + 0x0c, 2);
            }
        } else if (next < 0) {
            mem.write32(obj + 0x5c, 0);
            mem.write32(obj + 0x0c, 2);
        }
    }
    host.dimQuad(obj);
}
