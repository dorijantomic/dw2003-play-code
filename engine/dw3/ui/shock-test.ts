// The shock-test developer screen's tick, translated from pro/shocktst
// F0x80084714 (`_asm/F0x80084714.s`, authority 2; C `F0x80084714.c`).
//
// State at +0x0C: 0 (and the >= 4 fall-through) builds; 1 gates on pad logical
// bit 3; 2 does nothing; 3 frees the two 0x4000 buffers and requests the 0x1500
// transition back to stage select. The build advances the task, creates the
// title (20,30) and two caption widgets (220,180)/(220,200), allocates the two
// text buffers at +0x54/+0x50, opens C:\DEVELOP\DLSKDATA.TXT (the filename
// pointer at 0x80084AF0), reads 0x4000 bytes into +0x54, compiles the text
// (F0x800843F0), resolves the first word of +0x50 through F0x8008436C and binds
// it (F0x800842E0) into arg1+0xC, or resolves the literal 0xA when +0x50 is
// null. Any allocation or open failure calls obj+0x28(obj, 3).
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/shock-test-oracle.test.js runs the original through
// engine/native with the allocator, file services, text compiler and pad
// service stubbed.

export interface ShockTestMemory {
    read32(addr: number): number;
    write32(addr: number, value: number): void;
}

export interface ShockTestHost {
    /** obj+0x38 (F0x800142AC): advance state. */
    advance(obj: number): void;
    /** F0x8001AE38(kind, arg1, x, y) -> child widget object. */
    createWidget(kind: number, a1: number, x: number, y: number): number;
    /** widget+0x110(resource id). */
    widgetSetString(widget: number, id: number): void;
    /** [0x8004B5DC+0x20](size, tag) -> buffer. */
    malloc(size: number, tag: number): number;
    /** fopen(name, mode) (0x800250AC) -> handle or -1. */
    fileOpen(namePtr: number, mode: number): number;
    /** fread(handle, dest, size) (0x800250BC). */
    fileRead(handle: number, dest: number, size: number): void;
    /** fclose(handle) (0x800250DC). */
    fileClose(handle: number): void;
    /** F0x800843F0(obj): compile the text buffer to the binary form. */
    compileText(obj: number): void;
    /** F0x8008436C(value) -> resource id. */
    textToBin(value: number): number;
    /** F0x800842E0(id, ptr): bind the compiled resource. */
    bindBin(id: number, ptr: number): void;
    /** [0x8004B7D0+0x3F4](port): pressed-edge word. */
    padPressed(port: number): number;
    /** [0x8004B7D0+0x408](port, logical): shift position of a logical button. */
    padShift(port: number, logical: number): number;
    /** obj+0x28(obj, 3): move the task to state 3. */
    setState3(obj: number): void;
    /** [0x8004B5EC](ptr): free a buffer. */
    free(ptr: number): void;
    /** [0x8004B440](selector, arg): request a screen transition. */
    requestTransition(selector: number, arg: number): void;
}

export const SHOCK_TEST = {
    state: 0x0c,
    method28: 0x28,
    advance: 0x38,
    bufferA: 0x50,
    bufferB: 0x54,
    textId: 0x0c,
} as const;

export const SHOCK_TEST_FILENAME_PTR = 0x80084af0;
export const SHOCK_TEST_BUFFER_SIZE = 0x4000;
export const SHOCK_TEST_WIDGETS = [
    { slot: 0x00, kind: 0x1000, arg1: 0, x: 0x14, y: 0x1e, str: 0x80082d68 },
    { slot: 0x04, kind: 0x1000, arg1: 1, x: 0xdc, y: 0xb4, str: 0x80082d78 },
    { slot: 0x08, kind: 0x1000, arg1: 1, x: 0xdc, y: 0xc8, str: 0x80082d8c },
] as const;
export const SHOCK_TEST_PAD_LOGICAL = 3;
export const SHOCK_TEST_TRANSITION = 0x1500;
export const SHOCK_TEST_DEFAULT_TEXT = 0x0a;

const s32 = (v: number): number => v | 0;

/** F0x80084714(obj, arg1): one shock-test frame. */
export function shockTestTick(
    mem: ShockTestMemory,
    obj: number,
    arg1: number,
    host: ShockTestHost,
): void {
    const state = s32(mem.read32(obj + SHOCK_TEST.state));

    if (state === 1) {
        const pressed = host.padPressed(0);
        const shift = host.padShift(0, SHOCK_TEST_PAD_LOGICAL) & 31;
        if (((pressed >> shift) & 1) !== 0) host.setState3(obj);
        return;
    }
    if (state === 2) return;
    if (state === 3) {
        const a = mem.read32(obj + SHOCK_TEST.bufferA);
        if (a !== 0) host.free(a >>> 0);
        const b = mem.read32(obj + SHOCK_TEST.bufferB);
        if (b !== 0) host.free(b >>> 0);
        host.requestTransition(SHOCK_TEST_TRANSITION, 0);
        return;
    }

    host.advance(obj);
    for (const w of SHOCK_TEST_WIDGETS) {
        const widget = host.createWidget(w.kind, w.arg1, w.x, w.y) >>> 0;
        mem.write32(arg1 + w.slot, widget);
        host.widgetSetString(widget, w.str);
    }

    const bufferB = host.malloc(SHOCK_TEST_BUFFER_SIZE, 2) >>> 0;
    mem.write32(obj + SHOCK_TEST.bufferB, bufferB);
    const bufferA = host.malloc(SHOCK_TEST_BUFFER_SIZE, 2) >>> 0;
    mem.write32(obj + SHOCK_TEST.bufferA, bufferA);
    if (bufferB === 0 || bufferA === 0) {
        host.setState3(obj);
        return;
    }

    const handle = host.fileOpen(mem.read32(SHOCK_TEST_FILENAME_PTR) >>> 0, 1) | 0;
    if (handle === -1) {
        host.setState3(obj);
        return;
    }
    host.fileRead(handle, bufferB, SHOCK_TEST_BUFFER_SIZE);
    host.fileClose(handle);
    host.compileText(obj);

    const ptr = mem.read32(obj + SHOCK_TEST.bufferA);
    if (ptr !== 0) {
        const id = host.textToBin(mem.read32(ptr) >>> 0) >>> 0;
        mem.write32(arg1 + SHOCK_TEST.textId, id);
        host.bindBin(id, ptr >>> 0);
    } else {
        mem.write32(arg1 + SHOCK_TEST.textId, host.textToBin(SHOCK_TEST_DEFAULT_TEXT) >>> 0);
    }
}
