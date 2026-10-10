// The field Yes/No launcher: a two-row "Yes / No" prompt in a folding window
// that starts one of two events. Translated bit-exactly from wstag210
// F0x800A680C (asm ~/ddw3/asm/dw2003/pro/wstag210.s, file offsets 0xA2C-0xFE4,
// overlay load base 0x800A5DE0).
//
// Oracle: tests/lane-b/yesno-launcher.test.js runs the original routine and its
// seven instruction-identical homologues (YESNO_LAUNCHERS) through
// engine/native on each stage image and compares every call and memory word.
// The homologues differ only in the text handle, the two event ids, the
// jump-table base and the stage's window-fold pointer pair (the j-targets are
// relocation only); the oracle diffs the words and runs every one.
//
// Tick F0x800A680C(obj, extra). obj+0xC task state, +0x10 step, +0x14 the
// "confirmed" flag, +0x50 selection (0 = Yes, 1 = No), +0x54 the four-word
// window fold (duration, delta, value at +0x5C, active). extra+0 prompt text,
// +4/+8 the two row texts, +0xC the cursor icon, +0x10 the started event.
//   task state 1: step switch (12-entry jump table, steps 5..9 and >= 12
//     unsigned share step 0), then the draw below.
//   task state 2 or 3: return.  Any other state (< 1 or >= 4): obj.0x38(obj),
//     fold duration 10, rows createText(0x1002,1,0x1C,0xBE+14i) + 0x15C(1),
//     cursor spawnIcon(0x1002,1,0x12,0xBE) + 0x80(0), prompt
//     createText(0x1002,1,0x12,0xB0); return without drawing.
//   step 0: fold open, step++.
//   step 1: fold tick; when done rows 0x114(lookup(h), 2/3), cursor 0x80(1),
//     prompt 0x114(lookup(h), 1), step++. h = ([0x8005CCA8] << 16) + handle.
//   step 2: Up (button 4) on pad word +0x3F4 or +0x3FC -> sel-1 clamped at 0;
//     else Down (button 6) -> sel+1 clamped at 1. Changed -> SFX 0x8004513E,
//     cursor 0x84(0x12, 0xBE + 14*sel). Unchanged -> button 0xD on +0x3F4 ->
//     SFX 0x8004503C, step 10, +0x14 = 1.
//   step 3: extra+0x10 = start_event(sel != 0 ? noId : yesId), step++.
//   step 4: extra+0x10 == 0 -> task state 3.
//   step 10: rows 0x144(0), cursor 0x80(0), prompt 0x144(0), fold close, step++.
//   step 11: fold tick; when done: +0x14 == 1 -> step 3, else task state 3.
//   draw: ctx = F0x8001F648; ctx+0x7C(0x1002,2), +0x74(0x140,0), +0x98(0);
//     fold value v = obj+0x5C; v == 0 -> stop; v != 0x1000 -> +0x8C(v,0x1000,
//     0x1000), +0x94(0,0xC3); +0x84(lookup(0x02860000), 0x45, 0, 0xAC).
//
// F0x8001AE38, F0x8001B364, F0x8001F648, F0x800853F8, the lookup cell
// [0x80044F5C], the pad cells, the SFX cell, the fold pair and every object
// method are host boundaries.

export const YESNO_TICK_S210 = 0x800a680c;
export const YESNO_TEXT_GLOBAL = 0x8005cca8;
export const YESNO_SFX_MOVE = 0x8004513e;
export const YESNO_SFX_CONFIRM = 0x8004503c;
export const YESNO_LAYER = 0x1002;
export const YESNO_WINDOW_PACK = 0x02860000;
export const YESNO_FOLD = 0x54;
export const YESNO_FOLD_VALUE = 0x5c;

export interface YesNoParams {
    /** Full text handle (high half 0x0112, or 0x0120 in s270). */
    textHandle: number;
    /** start_event id for Yes (selection 0). */
    yesId: number;
    /** start_event id for No (selection 1). */
    noId: number;
}

export interface YesNoLauncher extends YesNoParams {
    module: string;
    /** Tick address inside the stage overlay. */
    address: number;
    /** Jump-table base of the step switch (relocation only). */
    jumpTable: number;
    /** Stage cells holding the fold start / fold tick pointers. */
    foldStartCell: number;
    foldTickCell: number;
    /** Launch label supplied with the task brief; not checked by the oracle. */
    label: number;
}

/** The eight instruction-identical homologues; constants read from each image. */
export const YESNO_LAUNCHERS: readonly YesNoLauncher[] = [
    { module: "pro/wstag210", address: 0x800a680c, label: 9, textHandle: 0x01120002, yesId: 13, noId: 14, jumpTable: 0x800a5e10, foldStartCell: 0x800aa090, foldTickCell: 0x800aa094 },
    { module: "pro/wstag210", address: 0x800a6df4, label: 1510, textHandle: 0x01120035, yesId: 58, noId: 1511, jumpTable: 0x800a5e40, foldStartCell: 0x800aa090, foldTickCell: 0x800aa094 },
    { module: "pro/wstag220", address: 0x800a5e74, label: 1512, textHandle: 0x01120036, yesId: 53, noId: 1513, jumpTable: 0x800a5de0, foldStartCell: 0x800a81b8, foldTickCell: 0x800a81bc },
    { module: "pro/wstag220", address: 0x800a645c, label: 1514, textHandle: 0x01120037, yesId: 55, noId: 1515, jumpTable: 0x800a5e10, foldStartCell: 0x800a81b8, foldTickCell: 0x800a81bc },
    { module: "pro/wstag220", address: 0x800a6a44, label: 1516, textHandle: 0x01120038, yesId: 56, noId: 1517, jumpTable: 0x800a5e40, foldStartCell: 0x800a81b8, foldTickCell: 0x800a81bc },
    { module: "pro/wstag270", address: 0x800a5e40, label: 1518, textHandle: 0x01200005, yesId: 59, noId: 1519, jumpTable: 0x800a5de0, foldStartCell: 0x800a87a8, foldTickCell: 0x800a87ac },
    { module: "pro/wstag270", address: 0x800a6428, label: 1520, textHandle: 0x01200006, yesId: 65, noId: 1521, jumpTable: 0x800a5e10, foldStartCell: 0x800a87a8, foldTickCell: 0x800a87ac },
    { module: "pro/wstag280", address: 0x800a5e10, label: 1522, textHandle: 0x01120039, yesId: 57, noId: 1523, jumpTable: 0x800a5de0, foldStartCell: 0x800a7938, foldTickCell: 0x800a793c },
];

export interface YesNoMemory {
    read32(addr: number): number;
    write32(addr: number, value: number): void;
}

export interface YesNoHost {
    /** target.method[slot](target, ...args): the object's inline method. */
    callMethod(target: number, slot: number, args: number[]): number;
    /** F0x8001AE38(layer, kind, x, y): create a text element. */
    createText(layer: number, kind: number, x: number, y: number): number;
    /** F0x8001B364(layer, kind, x, y): spawn the cursor icon. */
    spawnIcon(layer: number, kind: number, x: number, y: number): number;
    /** [0x80044F5C](handle): resolve a text/graphics pack handle. */
    lookup(handle: number): number;
    /** [foldStartCell](fold, direction): begin the window fold (plays its SFX). */
    foldStart(fold: number, direction: number): void;
    /** [foldTickCell](fold): advance the fold, nonzero when done. */
    foldTick(fold: number): number;
    /** [0x8004B7D0+0x3F4](port): the first pad word. */
    padRead(port: number): number;
    /** [0x8004B7D0+0x3FC](port): the second pad word. */
    padAlt(port: number): number;
    /** [0x8004B7D0+0x408](port, button): bit index of a logical button. */
    padShift(port: number, button: number): number;
    /** [0x80055C48](id): play a packed sound. */
    playSound(id: number): void;
    /** F0x800853F8(id): start an event, return its child handle. */
    startEvent(id: number): number;
    /** F0x8001F648(ctx): fill a draw context, return a handle to it. */
    drawInit(): number;
    /** ctx.fn[slot](...args): one draw-context call. */
    drawCall(ctx: number, slot: number, args: number[]): void;
}

const u32 = (v: number): number => v >>> 0;
const s32 = (v: number): number => v | 0;

/** One frame of the Yes/No launcher (F0x800A680C and its homologues). */
export function yesNoLauncherTick(
    mem: YesNoMemory,
    obj: number,
    extra: number,
    host: YesNoHost,
    params: YesNoParams,
): void {
    const taskState = s32(mem.read32(obj + 0x0c));
    if (taskState !== 1) {
        if (taskState >= 2 && taskState < 4) return;
        host.callMethod(obj, 0x38, []);
        mem.write32(obj + YESNO_FOLD, 10);
        for (let i = 0; i < 2; i++) {
            const row = u32(host.createText(YESNO_LAYER, 1, 0x1c, 0xbe + 0xe * i));
            mem.write32(extra + 4 + 4 * i, row);
            host.callMethod(row, 0x15c, [1]);
        }
        const icon = u32(host.spawnIcon(YESNO_LAYER, 1, 0x12, 0xbe));
        mem.write32(extra + 0x0c, icon);
        host.callMethod(icon, 0x80, [0]);
        mem.write32(extra, u32(host.createText(YESNO_LAYER, 1, 0x12, 0xb0)));
        return;
    }

    const advance = (): void => mem.write32(obj + 0x10, u32(mem.read32(obj + 0x10) + 1));
    const handle = (): number => u32((mem.read32(YESNO_TEXT_GLOBAL) << 16) + params.textHandle);
    const bit = (word: number, shift: number): number => (s32(word) >> (shift & 31)) & 1;
    const pressed = (button: number, alt: boolean): number => {
        const word = alt ? host.padAlt(0) : host.padRead(0);
        return bit(word, host.padShift(0, button));
    };

    const step = u32(mem.read32(obj + 0x10));
    switch (step < 12 ? step : 0) {
        case 1: {
            if (s32(host.foldTick(obj + YESNO_FOLD)) === 0) break;
            for (let i = 0; i < 2; i++) {
                const pack = host.lookup(handle());
                const row = u32(mem.read32(extra + 4 + 4 * i));
                host.callMethod(row, 0x114, [pack, i + 2]);
            }
            host.callMethod(u32(mem.read32(extra + 0x0c)), 0x80, [1]);
            const pack = host.lookup(handle());
            host.callMethod(u32(mem.read32(extra)), 0x114, [pack, 1]);
            advance();
            break;
        }
        case 2: {
            const old = s32(mem.read32(obj + 0x50));
            if (pressed(4, false) || pressed(4, true)) {
                const v = s32(mem.read32(obj + 0x50)) - 1;
                mem.write32(obj + 0x50, u32(v));
                if (v < 0) mem.write32(obj + 0x50, 0);
            } else if (pressed(6, false) || pressed(6, true)) {
                const v = s32(s32(mem.read32(obj + 0x50)) + 1);
                mem.write32(obj + 0x50, u32(v));
                if (v >= 2) mem.write32(obj + 0x50, 1);
            }
            if (old !== s32(mem.read32(obj + 0x50))) {
                host.playSound(YESNO_SFX_MOVE);
                const sel = mem.read32(obj + 0x50);
                const icon = u32(mem.read32(extra + 0x0c));
                host.callMethod(icon, 0x84, [0x12, s32(Math.imul(sel, 14) + 0xbe)]);
            } else if (pressed(0xd, false)) {
                host.playSound(YESNO_SFX_CONFIRM);
                mem.write32(obj + 0x10, 10);
                mem.write32(obj + 0x14, 1);
            }
            break;
        }
        case 3: {
            const id = s32(mem.read32(obj + 0x50)) !== 0 ? params.noId : params.yesId;
            mem.write32(extra + 0x10, u32(host.startEvent(id)));
            advance();
            break;
        }
        case 4:
            if (u32(mem.read32(extra + 0x10)) === 0) mem.write32(obj + 0x0c, 3);
            break;
        case 10:
            for (let i = 0; i < 2; i++) host.callMethod(u32(mem.read32(extra + 4 + 4 * i)), 0x144, [0]);
            host.callMethod(u32(mem.read32(extra + 0x0c)), 0x80, [0]);
            host.callMethod(u32(mem.read32(extra)), 0x144, [0]);
            host.foldStart(obj + YESNO_FOLD, 0);
            advance();
            break;
        case 11:
            if (s32(host.foldTick(obj + YESNO_FOLD)) === 0) break;
            if (s32(mem.read32(obj + 0x14)) === 1) mem.write32(obj + 0x10, 3);
            else mem.write32(obj + 0x0c, 3);
            break;
        default: // steps 0, 5..9 and >= 12 (unsigned) share one jump-table target
            host.foldStart(obj + YESNO_FOLD, 1);
            advance();
            break;
    }
    yesNoLauncherDraw(mem, obj, host);
}

/** The draw tail of F0x800A680C (file offset 0xF14), run every task-state-1 frame. */
export function yesNoLauncherDraw(mem: YesNoMemory, obj: number, host: YesNoHost): void {
    const ctx = host.drawInit();
    host.drawCall(ctx, 0x7c, [YESNO_LAYER, 2]);
    host.drawCall(ctx, 0x74, [0x140, 0]);
    host.drawCall(ctx, 0x98, [0]);
    const value = s32(mem.read32(obj + YESNO_FOLD_VALUE));
    if (value === 0) return;
    if (value !== 0x1000) {
        host.drawCall(ctx, 0x8c, [value, 0x1000, 0x1000]);
        host.drawCall(ctx, 0x94, [0, 0xc3]);
    }
    host.drawCall(ctx, 0x84, [host.lookup(YESNO_WINDOW_PACK), 0x45, 0, 0xac]);
}
