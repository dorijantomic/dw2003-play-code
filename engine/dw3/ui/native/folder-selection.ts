// The card-folder picker's remaining untranslated callees, translated from
// pro/stcrddek (the folder-list screen's hand-off builders and its closing
// popup). The four the picker's own host names:
//
//   F0x8008660C folderSelectOddCreate  — build the "Edit Folder" card-grid
//                object: factory F0x80014504(0x80086574, 0x494, 0xD4) then
//                +0x54 = 0x1000, +0x58 = 6, +0x50 = screen, +0x5C = cursor.
//   F0x800887D4 folderSelectEvenCreate — build the "Change name" keyboard
//                object: factory F0x80014504(0x800884E8, 0xF4, 0x34),
//                +0xEC = 0x800886C8, +0xF0 = 0x800887C8, +0x54 = 0x1000,
//                +0x58 = 3, +0x50 = 2, +0x94 = 0xA, +0x64 = -1, then
//                F0x80088634(obj, record) and F0x80088628(obj, 0x280, 0x100).
//   F0x80088634 folderSelectEvenSetName — copy the folder's stored name into
//                obj+0x78 and pad the ten-character field with the blank glyph
//                0x4081 up to obj+0x94.
//   F0x80088628 folderSelectEvenSetWindow — store the two window words.
//   F0x80083594 folderMakePopup        — build the closing popup: factory
//                F0x80014504(0x800834E0, 0x68, 0) then +0x64 = 0x80083314,
//                +0x50 = 0x1000, +0x54 = 0.  This is the object the picker's
//                states 0x64/0x65 build and poll (picker tick case 0x64/0x65).
//   F0x80083314 folderPopupFadeStart   — popup+0x64(direction, frames): the
//                fade tween the picker starts with (0, 0xA).
//   F0x800834E0 folderPopupTick        — the popup's per-frame fade; state 2
//                is "finished", which is the picker's 0x65 gate.
//
// The row fill F0x80088D24 (folder-list-row.ts), the label builder F0x80088B34
// (folder-list-create.ts) and the colour recount F0x8008924C
// (folder-list-colours.ts) were already translated; the picker host wires those
// three plus these.
//
// DECODED from the overlay: exe-decomp/stcrddek_c/F0x8008660C.c,
// F0x800887D4.c, F0x80088634.c, F0x80088628.c, F0x80083594.c,
// F0x80083314.c, F0x800834E0.c, and the disassembly exe-decomp/stcrddek.fns.s
// F0x800834E0 (:544-:589) and F0x80083594 (:591-:608). The factory F0x80014504
// and the resident string-copy service F0x8001FCC0 / F0x8002525C are host
// boundaries, exactly as the album and shop ports treat them.
//
// This is lane B (engine/dw3/ui/native/**); lane A owns the shared
// engine/dw3/ui/index.ts barrel and data/translated_functions.json.

/** The "Edit Folder" card-grid object. */
export const FOLDER_ODD_HANDLER = 0x80086574;
export const FOLDER_ODD_SIZE = 0x494;
export const FOLDER_ODD_EXTRA = 0xd4;
/** The "Change name" keyboard object. */
export const FOLDER_EVEN_HANDLER = 0x800884e8;
export const FOLDER_EVEN_SIZE = 0xf4;
export const FOLDER_EVEN_EXTRA = 0x34;
/** The keyboard object's two child methods, installed at +0xEC / +0xF0. */
export const FOLDER_EVEN_METHOD_EC = 0x800886c8;
export const FOLDER_EVEN_METHOD_F0 = 0x800887c8;
/** The closing popup object and its fade method. */
export const FOLDER_POPUP_HANDLER = 0x800834e0;
export const FOLDER_POPUP_SIZE = 0x68;
export const FOLDER_POPUP_METHOD_64 = 0x80083314;
/** The keyboard's blank field glyph. */
export const FOLDER_NAME_BLANK = 0x4081;

/** Popup fields the fade start / tick write. */
export const FOLDER_POPUP_FIELDS = {
    state: 0x0c,
    run: 0x10,
    direction: 0x58,
    value: 0x5c,
    delta: 0x60,
    method64: 0x64,
    depth50: 0x50,
    scale54: 0x54,
} as const;

export interface FolderSelectionMemory {
    read32(addr: number): number;
    write16(addr: number, value: number): void;
    write32(addr: number, value: number): void;
}

/** The shared task-object factory F0x80014504(handler, size, extra). */
export interface FolderSelectionHost {
    allocate(handler: number, size: number, extra: number): number;
}

/** F0x8008660C(screen, cursor): build the "Edit Folder" grid object. */
export function folderSelectOddCreate(
    mem: FolderSelectionMemory,
    host: FolderSelectionHost,
    screen: number,
    cursor: number,
): number {
    const obj = host.allocate(FOLDER_ODD_HANDLER, FOLDER_ODD_SIZE, FOLDER_ODD_EXTRA) >>> 0;
    mem.write32(obj + 0x54, 0x1000);
    mem.write32(obj + 0x58, 6);
    mem.write32(obj + 0x50, screen | 0);
    mem.write32(obj + 0x5c, cursor | 0);
    return obj;
}

export interface FolderSelectionNameHost {
    /** The resident text context's string copy (F0x8001FCC0 method +0x18). */
    copyString(dst: number, src: number): void;
    /** F0x8002525C(ptr): the byte length of a copied string. */
    stringLength(ptr: number): number;
}

/** F0x80088634(obj, src): set the keyboard's name field and pad it. */
export function folderSelectEvenSetName(
    mem: FolderSelectionMemory,
    host: FolderSelectionNameHost,
    obj: number,
    src: number,
): void {
    const field = (obj + 0x78) >>> 0;
    host.copyString(field, src);
    const length = host.stringLength(field) >> 1;
    const capacity = mem.read32(obj + 0x94) | 0;
    if (length < capacity) {
        for (let k = length; k < capacity; k++) {
            mem.write16(obj + 0x78 + k * 2, FOLDER_NAME_BLANK);
        }
    }
}

/** F0x80088628(obj, a, b): store the keyboard window's two words. */
export function folderSelectEvenSetWindow(mem: FolderSelectionMemory, obj: number, a: number, b: number): void {
    mem.write32(obj + 0x5c, a | 0);
    mem.write32(obj + 0x60, b | 0);
}

export interface FolderEvenHost extends FolderSelectionHost, FolderSelectionNameHost {}

/** F0x800887D4(record): build the "Change name" keyboard object. */
export function folderSelectEvenCreate(
    mem: FolderSelectionMemory,
    host: FolderEvenHost,
    record: number,
): number {
    const obj = host.allocate(FOLDER_EVEN_HANDLER, FOLDER_EVEN_SIZE, FOLDER_EVEN_EXTRA) >>> 0;
    mem.write32(obj + 0xec, FOLDER_EVEN_METHOD_EC);
    mem.write32(obj + 0xf0, FOLDER_EVEN_METHOD_F0);
    mem.write32(obj + 0x54, 0x1000);
    mem.write32(obj + 0x58, 3);
    mem.write32(obj + 0x50, 2);
    mem.write32(obj + 0x94, 0xa);
    mem.write32(obj + 0x64, -1);
    folderSelectEvenSetName(mem, host, obj, record);
    folderSelectEvenSetWindow(mem, obj, 0x280, 0x100);
    return obj;
}

/** F0x80083594(): build the closing popup object and return it. */
export function folderMakePopup(mem: FolderSelectionMemory, host: FolderSelectionHost): number {
    const obj = host.allocate(FOLDER_POPUP_HANDLER, FOLDER_POPUP_SIZE, 0) >>> 0;
    mem.write32(obj + FOLDER_POPUP_FIELDS.method64, FOLDER_POPUP_METHOD_64);
    mem.write32(obj + FOLDER_POPUP_FIELDS.depth50, 0x1000);
    mem.write32(obj + FOLDER_POPUP_FIELDS.scale54, 0);
    return obj;
}

export interface FolderPopupHost {
    /** popup+0x28(popup, value): the shared task-state setter. */
    baseMethod28(popup: number, value: number): void;
    /** popup+0x38(popup): the shared task-state advance. */
    baseMethod38(popup: number): void;
    /** F0x8008339C(popup, popup): commit the fade to the picture service. */
    commitFade(popup: number): void;
}

/** F0x80083314(popup, direction, frames): start the popup's fade tween. */
export function folderPopupFadeStart(
    mem: FolderSelectionMemory,
    host: FolderPopupHost,
    popup: number,
    direction: number,
    frames: number,
): void {
    host.baseMethod28(popup, 1);
    mem.write32(popup + FOLDER_POPUP_FIELDS.run, 1);
    mem.write32(popup + FOLDER_POPUP_FIELDS.direction, direction | 0);
    const step = (0xff00 / (frames | 0)) | 0;
    if ((direction | 0) === 0) {
        mem.write32(popup + FOLDER_POPUP_FIELDS.value, 0);
        mem.write32(popup + FOLDER_POPUP_FIELDS.delta, step);
        return;
    }
    mem.write32(popup + FOLDER_POPUP_FIELDS.value, 0xff00);
    mem.write32(popup + FOLDER_POPUP_FIELDS.delta, (-step) | 0);
}

/** F0x800834E0(popup): advance the closing fade. State 2 means finished. */
export function folderPopupTick(
    mem: FolderSelectionMemory,
    host: FolderPopupHost,
    popup: number,
): void {
    const state = mem.read32(popup + FOLDER_POPUP_FIELDS.state) | 0;
    if (state === 1) {
        if ((mem.read32(popup + FOLDER_POPUP_FIELDS.run) | 0) === 0) return;
        const value = (mem.read32(popup + FOLDER_POPUP_FIELDS.value) +
            mem.read32(popup + FOLDER_POPUP_FIELDS.delta)) | 0;
        mem.write32(popup + FOLDER_POPUP_FIELDS.value, value);
        if ((mem.read32(popup + FOLDER_POPUP_FIELDS.direction) | 0) === 0) {
            if (value > 0xff00) {
                mem.write32(popup + FOLDER_POPUP_FIELDS.value, 0xff00);
                mem.write32(popup + FOLDER_POPUP_FIELDS.state, 2);
            }
        } else if (value < 0) {
            mem.write32(popup + FOLDER_POPUP_FIELDS.value, 0);
            mem.write32(popup + FOLDER_POPUP_FIELDS.state, 2);
        }
        host.commitFade(popup);
        return;
    }
    if (state === 2) {
        host.commitFade(popup);
        return;
    }
    if (state === 3) return;
    // default (state 0 and anything above 3): run the base advance and return.
    host.baseMethod38(popup);
}
