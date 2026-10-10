// The card folder screen's picker tick, translated bit-exactly from the
// original pro/stcrddek F0x80089354 body.
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/lane-b/folder-picker-tick.test.js runs the original through
// engine/native and compares the ordered boundary calls, the field writes and
// the fold sub-object calls.
//
// The picker is the folder screen's list state machine (state = obj+0x10):
//   default     reset the rows (F0x8008924C) and start the +0xBC/+0xEC folds.
//   1..3        step the folds a row at a time (F0x80088D24 fills a row) until
//               the rows are in, then the +0x10C/+0xDC folds finish.
//   4           left/right (key 4/6, with auto-repeat) move obj+0x60 in 0..2 and
//               play 0x4001B; confirm 0x4001C -> 0xA; cancel 0x800450BD and
//               +0x2C(obj,0x64).
//   0xA..0x11   close the list window, show the level widgets, then reopen.
//   0x32..0x35  the closing folds and row clear.
//   0x36        hand the selection to +0x0 (F0x8008660C or F0x800887D4) and call
//               +0x28(obj,2), or set the screen mode to 3.
//   0x64/0x65   build the popup (F0x80083594) and, when its +0x0C is 2, go to 0x36.
//
// The fold pair (0x8008B838/0x8008B83C = F0x8008A2D8/F0x8008A36C, the folder's
// window-fold homologues) is a host boundary here, as are the row reset/fill
// (F0x8008924C / F0x80088D24), the selection builders, the [0x80044F4C]
// resource getter, the pad service and the widget methods. The port preserves
// the exact call sequence, including the short-circuit pad reads. This is lane B
// (engine/dw3/ui/native/**); lane A owns the shared engine/dw3/ui/index.ts
// barrel and data/translated_functions.json.

/** Screen fields the picker reads/writes. */
export const FOLDER_PICKER_FIELDS = {
    mode: 0x0c,
    state: 0x10,
    flag14: 0x14,
    method28: 0x28,
    method2C: 0x2c,
    cursor: 0x60,
    flag64: 0x64,
    flag70: 0x70,
    foldA: 0xbc,
    foldB: 0xcc,
    foldC: 0xdc,
    foldD: 0xec,
    foldE: 0xfc,
    foldF: 0x10c,
} as const;

/** The row base of the folder-list record table the selection hands over. */
export const FOLDER_RECORD_TABLE = 0x8004935c;
export const FOLDER_RECORD_STRIDE = 0x66;
/** The language/save block pointer cell the row bank id derives from. */
export const FOLDER_SAVE_PTR_CELL = 0x8005cca8;

export interface FolderPickerMemory {
    read16(addr: number): number;
    read32(addr: number): number;
    write16(addr: number, value: number): void;
    write32(addr: number, value: number): void;
}

export interface FolderPickerHost {
    /** F0x8008924C(obj): reset the folder rows. */
    resetRows(obj: number): void;
    /** F0x80088D24(obj, ctx, row, flag): fill or clear one row. */
    fillRow(obj: number, ctx: number, row: number, flag: number): void;
    /** F0x8008660C(obj, index): the odd selection builder, returns a pointer. */
    selectOdd(obj: number, index: number): number;
    /** F0x800887D4(record): the even selection builder, returns a pointer. */
    selectEven(record: number): number;
    /** F0x80083594(): build the closing popup, returns it. */
    makePopup(): number;
    /** [0x80044F4C](id): the resident resource handle getter. */
    resourceGet(id: number): number;
    /** obj+0x28(obj, value). */
    baseMethod28(obj: number, value: number): void;
    /** obj+0x2C(obj, value). */
    baseMethod2C(obj: number, value: number): void;
    /** [0x8004B7D0]+0x3F4(port): the pad word pressed this frame. */
    padPressed(port: number): number;
    /** [0x8004B7D0]+0x3FC(port): the pad word auto-repeat pulses. */
    padRepeat(port: number): number;
    /** [0x8004B7D0]+0x408(port, code): the keymap bit for a button. */
    padKey(port: number, code: number): number;
    /** [0x80055C48](id): play a packed sound. */
    playSound(id: number): void;
    /** [0x8008B838](sub, direction): start the folder fold. */
    foldStart(sub: number, direction: number): void;
    /** [0x8008B83C](sub): advance the fold, nonzero while still running. */
    foldTick(sub: number): number;
    /** list-header widget +0x114(w, source, index). */
    widget114(widget: number, source: number, index: number): void;
    /** widget +0x144(widget, value). */
    widget144(widget: number, value: number): void;
    /** cursor widget +0x84(widget, x, y). */
    widget84(widget: number, x: number, y: number): void;
    /** cursor widget +0x80(widget, value). */
    widget80(widget: number, value: number): void;
    /** cursor widget +0x94(widget, value). */
    widget94(widget: number, value: number): void;
    /** cursor widget +0x88(widget, value). */
    widget88(widget: number, value: number): void;
    /** popup widget +0x64(widget, a, b). */
    widget64(widget: number, a: number, b: number): void;
}

function advance(mem: FolderPickerMemory, obj: number): void {
    mem.write32(obj + FOLDER_PICKER_FIELDS.state, ((mem.read32(obj + FOLDER_PICKER_FIELDS.state) | 0) + 1) | 0);
}

/** (pressed >> key(code)) & 1 with the original's short-circuit call order. */
function padBitRepeat(host: FolderPickerHost, code: number): boolean {
    const pressed = host.padPressed(0) | 0;
    if (((pressed >> host.padKey(0, code)) & 1) !== 0) return true;
    const repeat = host.padRepeat(0) | 0;
    return ((repeat >> host.padKey(0, code)) & 1) !== 0;
}

/** (pressed >> key(code)) & 1 for the confirm/cancel/direction reads. */
function padBit(host: FolderPickerHost, code: number): boolean {
    const pressed = host.padPressed(0) | 0;
    return ((pressed >> host.padKey(0, code)) & 1) !== 0;
}

/** F0x80089354(obj, ctx): the card folder screen's picker tick. */
export function folderPickerTick(
    mem: FolderPickerMemory,
    obj: number,
    ctx: number,
    host: FolderPickerHost,
): void {
    const state = mem.read32(obj + FOLDER_PICKER_FIELDS.state) | 0;

    switch (state) {
        case 0x1:
            host.foldTick(obj + FOLDER_PICKER_FIELDS.foldA);
            if ((host.foldTick(obj + FOLDER_PICKER_FIELDS.foldD) | 0) !== 0) {
                host.widget114(mem.read32(ctx + 0x4) >>> 0, host.resourceGet((mem.read32(FOLDER_SAVE_PTR_CELL) | 0) + 0x32), 0x19);
                host.fillRow(obj, ctx, 0, 1);
                host.foldStart(obj + FOLDER_PICKER_FIELDS.foldE, 1);
                advance(mem, obj);
            }
            return;

        case 0x2:
            if ((host.foldTick(obj + FOLDER_PICKER_FIELDS.foldE) | 0) !== 0) {
                host.fillRow(obj, ctx, 1, 1);
                host.foldStart(obj + FOLDER_PICKER_FIELDS.foldF, 1);
                host.foldStart(obj + FOLDER_PICKER_FIELDS.foldC, 1);
                advance(mem, obj);
            }
            return;

        case 0x3:
            host.foldTick(obj + FOLDER_PICKER_FIELDS.foldC);
            if ((host.foldTick(obj + FOLDER_PICKER_FIELDS.foldF) | 0) !== 0) {
                host.fillRow(obj, ctx, 2, 1);
                advance(mem, obj);
            }
            return;

        case 0x4: {
            const before = mem.read32(obj + FOLDER_PICKER_FIELDS.cursor) | 0;
            if (padBitRepeat(host, 4)) {
                const next = before - 1;
                mem.write32(obj + FOLDER_PICKER_FIELDS.cursor, next < 0 ? 0 : next);
            } else if (padBitRepeat(host, 6)) {
                const next = before + 1;
                mem.write32(obj + FOLDER_PICKER_FIELDS.cursor, next >= 3 ? 2 : next);
            }
            if (before !== (mem.read32(obj + FOLDER_PICKER_FIELDS.cursor) | 0)) {
                host.playSound(0x4001b);
                return;
            }
            if (padBit(host, 0xd)) {
                host.playSound(0x4001c);
                mem.write32(obj + FOLDER_PICKER_FIELDS.state, 0xa);
                return;
            }
            if (padBit(host, 0xe)) {
                host.playSound(0x800450bd);
                host.baseMethod2C(obj, 0x64);
                return;
            }
            return;
        }

        case 0xa:
            mem.write32(obj + FOLDER_PICKER_FIELDS.flag64, 1);
            host.widget144(mem.read32(ctx + 0x4) >>> 0, 0);
            host.foldStart(obj + FOLDER_PICKER_FIELDS.foldA, 0);
            advance(mem, obj);
            return;

        case 0xb:
            if ((host.foldTick(obj + FOLDER_PICKER_FIELDS.foldA) | 0) !== 0) {
                host.widget144(mem.read32(ctx + 0x4) >>> 0, 0);
                host.foldStart(obj + FOLDER_PICKER_FIELDS.foldB, 1);
                advance(mem, obj);
            }
            return;

        case 0xc:
            if ((host.foldTick(obj + FOLDER_PICKER_FIELDS.foldB) | 0) !== 0) {
                mem.write32(obj + FOLDER_PICKER_FIELDS.flag70, 0);
                const cursorWidget = mem.read32(ctx + 0x64) >>> 0;
                host.widget84(cursorWidget, 0x9a, 0x23);
                host.widget80(cursorWidget, 1);
                const id = (mem.read32(FOLDER_SAVE_PTR_CELL) | 0) + 0x32;
                host.widget114(mem.read32(ctx + 0x5c) >>> 0, host.resourceGet(id), 0x1a);
                host.widget114(mem.read32(ctx + 0x60) >>> 0, host.resourceGet(id), 0x1b);
                advance(mem, obj);
            }
            return;

        case 0xd: {
            const before = mem.read32(obj + FOLDER_PICKER_FIELDS.flag70) | 0;
            if (padBit(host, 4)) {
                mem.write32(obj + FOLDER_PICKER_FIELDS.flag70, 0);
            } else if (padBit(host, 6)) {
                mem.write32(obj + FOLDER_PICKER_FIELDS.flag70, 1);
            }
            if (before !== (mem.read32(obj + FOLDER_PICKER_FIELDS.flag70) | 0)) {
                host.playSound(0x8004513e);
                host.widget84(
                    mem.read32(ctx + 0x64) >>> 0,
                    0x9a,
                    Math.imul(mem.read32(obj + FOLDER_PICKER_FIELDS.flag70) | 0, 0xe) + 0x23,
                );
                return;
            }
            if (padBit(host, 0xd)) {
                host.playSound(0x8004503c);
                host.baseMethod2C(obj, 0x32);
                mem.write32(obj + FOLDER_PICKER_FIELDS.flag14, 1);
                return;
            }
            if (padBit(host, 0xe)) {
                host.playSound(0x800450bd);
                mem.write32(obj + FOLDER_PICKER_FIELDS.state, 0xf);
                return;
            }
            return;
        }

        case 0xf:
            host.widget80(mem.read32(ctx + 0x64) >>> 0, 0);
            host.widget144(mem.read32(ctx + 0x5c) >>> 0, 0);
            host.widget144(mem.read32(ctx + 0x60) >>> 0, 0);
            host.foldStart(obj + FOLDER_PICKER_FIELDS.foldB, 0);
            advance(mem, obj);
            return;

        case 0x10:
            if ((host.foldTick(obj + FOLDER_PICKER_FIELDS.foldB) | 0) !== 0) {
                host.foldStart(obj + FOLDER_PICKER_FIELDS.foldA, 1);
                advance(mem, obj);
            }
            return;

        case 0x11:
            if ((host.foldTick(obj + FOLDER_PICKER_FIELDS.foldA) | 0) !== 0) {
                host.widget114(mem.read32(ctx + 0x4) >>> 0, host.resourceGet((mem.read32(FOLDER_SAVE_PTR_CELL) | 0) + 0x32), 0x19);
                mem.write32(obj + FOLDER_PICKER_FIELDS.flag64, 0);
                host.baseMethod2C(obj, 4);
                return;
            }
            return;

        case 0x32: {
            if ((mem.read32(obj + FOLDER_PICKER_FIELDS.flag14) | 0) !== 0) {
                host.widget94(mem.read32(ctx + 0x64) >>> 0, 1);
                host.widget88(mem.read32(ctx + 0x64) >>> 0, 7);
            }
            host.foldStart(obj + FOLDER_PICKER_FIELDS.foldC, 0);
            host.foldStart(obj + FOLDER_PICKER_FIELDS.foldF, 0);
            host.fillRow(obj, ctx, 2, 0);
            advance(mem, obj);
            return;
        }

        case 0x33:
            host.foldTick(obj + FOLDER_PICKER_FIELDS.foldC);
            if ((host.foldTick(obj + FOLDER_PICKER_FIELDS.foldF) | 0) !== 0) {
                host.foldStart(obj + FOLDER_PICKER_FIELDS.foldE, 0);
                host.fillRow(obj, ctx, 1, 0);
                advance(mem, obj);
            }
            return;

        case 0x34:
            if ((host.foldTick(obj + FOLDER_PICKER_FIELDS.foldE) | 0) !== 0) {
                if ((mem.read32(obj + FOLDER_PICKER_FIELDS.flag14) | 0) !== 0) {
                    const cursorWidget = mem.read32(ctx + 0x64) >>> 0;
                    host.widget94(cursorWidget, 0);
                    host.widget88(cursorWidget, 0);
                    host.widget80(cursorWidget, 0);
                    host.widget144(mem.read32(ctx + 0x5c) >>> 0, 0);
                    host.widget144(mem.read32(ctx + 0x60) >>> 0, 0);
                    host.foldStart(obj + FOLDER_PICKER_FIELDS.foldB, 0);
                } else {
                    host.widget144(mem.read32(ctx + 0x4) >>> 0, 0);
                    host.foldStart(obj + FOLDER_PICKER_FIELDS.foldA, 0);
                }
                host.foldStart(obj + FOLDER_PICKER_FIELDS.foldD, 0);
                host.fillRow(obj, ctx, 0, 0);
                advance(mem, obj);
            }
            return;

        case 0x35: {
            const sub = (mem.read32(obj + FOLDER_PICKER_FIELDS.flag14) | 0) !== 0
                ? obj + FOLDER_PICKER_FIELDS.foldB
                : obj + FOLDER_PICKER_FIELDS.foldA;
            host.foldTick(sub);
            if ((host.foldTick(obj + FOLDER_PICKER_FIELDS.foldD) | 0) !== 0) advance(mem, obj);
            return;
        }

        case 0x36:
            if ((mem.read32(obj + FOLDER_PICKER_FIELDS.flag14) | 0) !== 0) {
                if ((mem.read32(obj + FOLDER_PICKER_FIELDS.flag70) | 0) === 0) {
                    mem.write32(ctx + 0x0, host.selectOdd(obj, mem.read32(obj + FOLDER_PICKER_FIELDS.cursor) | 0));
                } else {
                    const record = Math.imul(mem.read32(obj + FOLDER_PICKER_FIELDS.cursor) | 0, FOLDER_RECORD_STRIDE) + FOLDER_RECORD_TABLE;
                    mem.write32(ctx + 0x0, host.selectEven(record));
                }
                host.baseMethod28(obj, 2);
                return;
            }
            mem.write32(obj + FOLDER_PICKER_FIELDS.mode, 3);
            return;

        case 0x64: {
            const popup = host.makePopup() >>> 0;
            mem.write32(ctx + 0x68, popup);
            host.widget64(popup, 0, 0xa);
            advance(mem, obj);
            return;
        }

        case 0x65: {
            const popup = mem.read32(ctx + 0x68) >>> 0;
            if ((mem.read32(popup + 0x0c) | 0) === 2) {
                mem.write32(obj + FOLDER_PICKER_FIELDS.state, 0x36);
            }
            return;
        }

        default:
            host.resetRows(obj);
            host.foldStart(obj + FOLDER_PICKER_FIELDS.foldA, 1);
            host.foldStart(obj + FOLDER_PICKER_FIELDS.foldD, 1);
            mem.write32(obj + FOLDER_PICKER_FIELDS.flag64, 0);
            advance(mem, obj);
            return;
    }
}
