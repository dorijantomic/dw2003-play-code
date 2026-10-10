// The naming screen's closing fade object and the root method that starts it,
// translated from the original pro/stdgname bodies.
//
// Part D of docs/plans/2026-09-28-translated-game-completion-plan.md. Oracle:
// tests/lane-b/name-fade.test.js runs the originals through engine/native and
// compares the ordered calls and fields.
//
//   F0x80083330 nameFadeCreate   build the 0x68-byte fade object: start method
//                                +0x64, colour scale +0x50 = 0x1000, +0x54 = 6.
//   F0x800830B0 nameFadeStart    (dir, frames): set state 1, remember the
//                                direction and start the 0..0xFF00 ramp; a
//                                fade-out (dir 0) rises, a fade-in falls.
//   F0x8008327C nameFadeTick     state 0 advances; state 1 steps the ramp and
//                                lands in state 2 at either end, then paints
//                                the dim rectangle; state 2 only paints; 3 idle.
//   F0x8008656C nameScreenOpenFade  root method +0x68: build the fade in the
//                                root's third child slot and start a 30-frame
//                                fade-out. The chooser's cancel calls it.
//
// The allocator, the object methods and the dim-rectangle painter
// (F0x80083138, a GPU primitive) are host boundaries.

export const NAME_FADE_HANDLER = 0x8008327c;
export const NAME_FADE_SIZE = 0x68;
export const NAME_FADE_START_ENTRY = 0x800830b0;
export const NAME_FADE_START_SLOT = 0x64;
export const NAME_FADE_FRAMES = 0x1e;
const FADE_FULL = 0xff00;

export interface NameFadeMemory {
    read32(addr: number): number;
    write32(addr: number, value: number): void;
}

export interface NameFadeHost {
    /** F0x80014504(handler, size, extra): allocate a screen object. */
    alloc(handler: number, size: number, extra: number): number;
    /** target+slot(args...): an object method. */
    callMethod(target: number, slot: number, args: number[]): void;
    /** F0x80083138(fade): paint the dim rectangle. */
    dimQuad(fade: number): void;
}

/** F0x80083330(): build the fade object. */
export function nameFadeCreate(mem: NameFadeMemory, host: NameFadeHost): number {
    const obj = host.alloc(NAME_FADE_HANDLER, NAME_FADE_SIZE, 0);
    mem.write32(obj + NAME_FADE_START_SLOT, NAME_FADE_START_ENTRY | 0);
    mem.write32(obj + 0x50, 0x1000);
    mem.write32(obj + 0x54, 6);
    return obj;
}

/** F0x800830B0(obj, direction, frames): start the ramp. */
export function nameFadeStart(
    mem: NameFadeMemory,
    obj: number,
    direction: number,
    frames: number,
    host: NameFadeHost,
): void {
    host.callMethod(obj, 0x28, [1]);
    mem.write32(obj + 0x10, 1);
    mem.write32(obj + 0x58, direction | 0);
    const step = frames === 0 ? -1 : Math.trunc(FADE_FULL / (frames | 0));
    if ((direction | 0) === 0) {
        mem.write32(obj + 0x5c, 0);
        mem.write32(obj + 0x60, step | 0);
        return;
    }
    mem.write32(obj + 0x5c, FADE_FULL);
    mem.write32(obj + 0x60, -step | 0);
}

/** F0x8008327C(obj): one frame of the fade. */
export function nameFadeTick(mem: NameFadeMemory, obj: number, host: NameFadeHost): void {
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

/** F0x8008656C(root): build the fade in the third child slot and start it. */
export function nameScreenOpenFade(mem: NameFadeMemory, root: number, host: NameFadeHost): void {
    const children = mem.read32(root + 0x24) | 0;
    const fade = nameFadeCreate(mem, host);
    mem.write32(children + 8, fade);
    host.callMethod(fade, NAME_FADE_START_SLOT, [0, NAME_FADE_FRAMES]);
}
