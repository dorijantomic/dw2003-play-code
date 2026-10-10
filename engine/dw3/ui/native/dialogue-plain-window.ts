// The field conversation box's plain bottom window, translated bit-exactly from
// the resident EXE F0x8001BE00 (build) and F0x8001BBE8 (tick).
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/lane-b/dialogue-plain-window.test.js runs the originals through
// engine/native on resident.bin and compares memory writes and ordered calls.
// Worklist: .dw3-research/screen-worklists-2026-10-01/dialogue.md.
//
// Build F0x8001BE00(h, textPack, line) -> task:
//   task = F0x80014504(tick 0x8001BBE8, 0x50, 8); state = [task+0x24];
//   w = F0x8001AE38(s16(h), 1, 0x12, 0xB0); [state+0] = w;
//   w.0x160(w, 3); w.0x114(w, textPack, line); w.0x144(w, 0); w.0x130(w, 6);
//   [state+4] = F0x8001BB88(h); return task.
//
// Tick F0x8001BBE8(obj, state): obj+0xC is the task state, obj+0x10 the step,
// [state+0] the text widget and [state+4] the band companion object.
//   task state 1 only; otherwise state < 2 or >= 4 parks via obj.0x38(obj).
//   step 1 (typewriter): 0x168 nonzero -> band.+0x10 = 2, 0x144(0), step++, SFX
//     0x4001A, return. Else pad bit 0xD set -> 0x128; then 0x170 nonzero ->
//     band.+0x5C = step (1), else band.+0x5C = 0.
//   step 2: if [state+4] == 0 -> obj.0x28(obj, 3).
//   other steps (0, <0, >=3): 0x16C == 0 and band.+0x10 == 1 -> 0x144(1), step++.
//
// F0x80014504, F0x8001AE38, F0x8001BB88, the widget methods, the pad service
// and the SFX entry are host boundaries.

import { PAD_BLOCK } from "../../../systems/pad-block.ts";

export const PLAIN_WINDOW_BUILD = 0x8001be00;
export const PLAIN_WINDOW_TICK = 0x8001bbe8;
export const PLAIN_WINDOW_TASK_SIZE = 0x50;
export { PAD_BLOCK as PLAIN_WINDOW_PAD_BASE };
export const PLAIN_WINDOW_SOUND_CELL = 0x80055c48;
export const PLAIN_WINDOW_SFX = 0x4001a;
export const PLAIN_WINDOW_BUTTON = 0xd;

export interface PlainWindowMemory {
    read32(addr: number): number;
    write32(addr: number, value: number): void;
}

export interface PlainWindowHost {
    /** F0x80014504(tick, size, align): create the task, return its object. */
    createTask(tick: number, size: number, align: number): number;
    /** F0x8001AE38(target, fontKind, x, y): create the text widget. */
    createText(target: number, kind: number, x: number, y: number): number;
    /** F0x8001BB88(h): spawn the band companion, return its object. */
    createBand(h: number): number;
    /** target.method[slot](target, ...args): return the result. */
    callMethod(target: number, slot: number, args: number[]): number;
    /** PAD_CELL_PRESSED: the pad word. */
    padRead(port: number): number;
    /** PAD_CELL_BUTTON_MAP: the bit index of a logical button. */
    padShift(port: number, button: number): number;
    /** [0x80055C48](id): play a packed sound. */
    playSound(id: number): void;
}

const u32 = (v: number): number => v >>> 0;
const s32 = (v: number): number => v | 0;
const s16 = (v: number): number => (v << 16) >> 16;

/** F0x8001BE00(h, textPack, line): build the window, return the task. */
export function dialoguePlainWindowBuild(
    mem: PlainWindowMemory,
    host: PlainWindowHost,
    h: number,
    textPack: number,
    line: number,
): number {
    const task = u32(host.createTask(PLAIN_WINDOW_TICK, PLAIN_WINDOW_TASK_SIZE, 8));
    const state = u32(mem.read32(task + 0x24));
    const w = u32(host.createText(s16(h), 1, 0x12, 0xb0));
    mem.write32(state, w);
    host.callMethod(w, 0x160, [3]);
    host.callMethod(u32(mem.read32(state)), 0x114, [textPack, line]);
    host.callMethod(u32(mem.read32(state)), 0x144, [0]);
    host.callMethod(u32(mem.read32(state)), 0x130, [6]);
    mem.write32(state + 4, host.createBand(h));
    return task;
}

/** F0x8001BBE8(obj, state): the plain window's per-frame tick. */
export function dialoguePlainWindowTick(
    mem: PlainWindowMemory,
    obj: number,
    state: number,
    host: PlainWindowHost,
): void {
    const taskState = s32(mem.read32(obj + 0x0c));
    if (taskState !== 1) {
        if (taskState < 2 || taskState >= 4) host.callMethod(obj, 0x38, []);
        return;
    }
    const step = s32(mem.read32(obj + 0x10));
    const widget = (): number => u32(mem.read32(state));
    const band = (): number => u32(mem.read32(state + 4));
    const advance = (): void => mem.write32(obj + 0x10, u32(s32(mem.read32(obj + 0x10)) + 1));

    if (step === 1) {
        if (s32(host.callMethod(widget(), 0x168, [])) !== 0) {
            mem.write32(band() + 0x10, 2);
            host.callMethod(widget(), 0x144, [0]);
            advance();
            host.playSound(PLAIN_WINDOW_SFX);
            return;
        }
        const pad = s32(host.padRead(0));
        const shift = s32(host.padShift(0, PLAIN_WINDOW_BUTTON));
        if (((pad >> shift) & 1) !== 0) host.callMethod(widget(), 0x128, []);
        if (s32(host.callMethod(widget(), 0x170, [])) !== 0) {
            mem.write32(band() + 0x5c, step);
        } else {
            mem.write32(band() + 0x5c, 0);
        }
        return;
    }
    if (step === 2) {
        if (u32(mem.read32(state + 4)) === 0) host.callMethod(obj, 0x28, [3]);
        return;
    }
    if (s32(host.callMethod(widget(), 0x16c, [])) === 0 && s32(mem.read32(band() + 0x10)) === 1) {
        host.callMethod(widget(), 0x144, [1]);
        advance();
    }
}
