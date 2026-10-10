// The Card Folder editor's "Change name" keyboard (pro/stcrddek F0x800884E8),
// translated by REUSING the shared NAMEDT name-entry keyboard port rather than
// writing a second one.
//
// The folder keyboard is the THIRD copy of the same object the naming screen
// (pro/stdgname) and the registration wizard (pro/stplnmet) carry. Its bodies
// are byte-for-byte the shared keyboard with a different layout and different
// data tables:
//
//   F0x800884E8  the first-frame setup + type + draw dispatcher, exactly
//                nameEntryTick (name-keyboard.ts).
//   F0x80086AD8  the chrome widget fill/hide, exactly nameEntryWidgetsBind.
//   F0x80086E04  the keyboard/cursor/hint draw, exactly nameKeyboardDraw.
//   F0x80087788  the typing state machine, exactly nameKeyboardTick.
//   F0x800868E8  the chrome widget builder, exactly nameEntryWidgetsBuild.
//   F0x800886C8  the reseed (name export), exactly nameEntryReseed.
//   F0x800887C8  the commit (accepted state), exactly nameEntryCommit.
//
// The layout differs from the naming screen exactly as the wizard's copy does:
// every object field from the cursor column on sits four bytes lower
// (foldInit 0xBC / foldMsg 0xDC / foldOpen 0xCC), and the tables are the
// overlay's own. The bodies were read from exe-decomp/stcrddek_c/*.c and the
// disassembly exe-decomp/stcrddek.fns.s (F0x80087788, F0x80086E04,
// F0x800868E8, F0x80086AD8), and each compared with the stdgname body it
// mirrors. The unk94 name capacity differs too: the naming screen pads to 5/8,
// the folder to 0xA (folderSelectEvenCreate writes +0x94 = 0xA).
//
// The rename keyboard's OWN methods are the pair folderSelectEvenCreate
// installs at +0xEC / +0xF0 (F0x800886C8 / F0x800887C8), four bytes lower than
// the naming screen's +0xF0 / +0xF4 pair.
//
// This is lane B (engine/dw3/ui/native/**); lane A owns the shared barrel.

import {
    nameEntryCommit,
    nameEntryReseed,
    nameEntryWidgetsBind,
    nameEntryWidgetsBuild,
    nameEntryTick,
    nameKeyboardDraw,
    nameKeyboardTick,
    type NameKeyboardHost,
    type NameKeyboardLayout,
    type NameKeyboardMemory,
} from "./name-keyboard.ts";

/** The NAMEDT character-page struct the keyboard writes before it is built. */
export const FOLDER_KEYBOARD_PAGE_STRUCT = 0x8008b848;
/** The keyboard's glyph-table object. */
export const FOLDER_KEYBOARD_GLYPH = 0x8008b6e4;
/** The hint-icon table (`F0x80086E04` hint row). */
export const FOLDER_KEYBOARD_HINT = 0x8008b6fc;
/** The wide-key clip table (DEL/SPC/OK), `+0x18/+0x24/+0x30`. */
export const FOLDER_KEYBOARD_WIDE_KEYS = 0x8008b7dc;
/** The six CLUT-cycle frame words behind the one-page arrows. */
export const FOLDER_KEYBOARD_ARROW_FRAMES = 0x8008b818;
/** Japanese (language 0): three pages, labels and grid. */
export const FOLDER_KEYBOARD_LANG0_LABELS = 0x8008b368;
export const FOLDER_KEYBOARD_LANG0_GRID = 0x8008b38c;
/** Every other language: one page, labels and grid. */
export const FOLDER_KEYBOARD_OTHER_LABELS = 0x8008b604;
export const FOLDER_KEYBOARD_OTHER_GRID = 0x8008b610;

/**
 * The folder keyboard's layout. Field offsets are the wizard's (four lower than
 * the naming screen from the cursor column on); the tables are the overlay's.
 */
export const FOLDER_KEYBOARD_LAYOUT: NameKeyboardLayout = {
    f: {
        col: 0x98, row: 0x9c, blinkFrame: 0xa0, blinkTime: 0xa4, cursorOn: 0xa8, page: 0xac,
        arrowFrame: 0xb0, arrowTime: 0xb4, scale: 0xd4, overlay: 0xe4,
        foldOpen: 0xcc, foldMsg: 0xdc, foldInit: 0xbc,
    },
    t: {
        pageStruct: FOLDER_KEYBOARD_PAGE_STRUCT,
        glyph: FOLDER_KEYBOARD_GLYPH,
        hint: FOLDER_KEYBOARD_HINT,
        wideKeys: FOLDER_KEYBOARD_WIDE_KEYS,
        arrowFrames: FOLDER_KEYBOARD_ARROW_FRAMES,
        lang0: { labels: FOLDER_KEYBOARD_LANG0_LABELS, grid: FOLDER_KEYBOARD_LANG0_GRID },
        other: { labels: FOLDER_KEYBOARD_OTHER_LABELS, grid: FOLDER_KEYBOARD_OTHER_GRID },
    },
};

/** F0x800884E8(obj, ui): first-frame setup, then type and draw. */
export function folderNameEntryTick(
    mem: NameKeyboardMemory,
    obj: number,
    ui: number,
    host: NameKeyboardHost,
): void {
    nameEntryTick(mem, obj, ui, host, FOLDER_KEYBOARD_LAYOUT);
}

/** F0x80087788(obj, ui): the typing state machine. */
export function folderNameKeyboardTick(
    mem: NameKeyboardMemory,
    obj: number,
    ui: number,
    host: NameKeyboardHost,
): void {
    nameKeyboardTick(mem, obj, ui, host, FOLDER_KEYBOARD_LAYOUT);
}

/** F0x80086E04(obj): draw the keyboard, cursor and hint sprites. */
export function folderNameKeyboardDraw(mem: NameKeyboardMemory, obj: number, host: NameKeyboardHost): void {
    nameKeyboardDraw(mem, obj, host, FOLDER_KEYBOARD_LAYOUT);
}

/** F0x800868E8(obj, ui): build the chrome widgets. */
export function folderNameEntryWidgetsBuild(
    mem: NameKeyboardMemory,
    obj: number,
    ui: number,
    host: NameKeyboardHost,
): void {
    nameEntryWidgetsBuild(mem, obj, ui, host, FOLDER_KEYBOARD_LAYOUT);
}

/** F0x80086AD8(obj, ui, show): fill the chrome text, or hide it. */
export function folderNameEntryWidgetsBind(
    mem: NameKeyboardMemory,
    obj: number,
    ui: number,
    show: number,
    host: NameKeyboardHost,
): void {
    nameEntryWidgetsBind(mem, obj, ui, show, host, FOLDER_KEYBOARD_LAYOUT);
}

/** F0x800886C8(obj, dst): export the typed name (installed at +0xEC). */
export const folderNameEntryReseed = nameEntryReseed;
/** F0x800887C8(obj): request the accepted state (installed at +0xF0). */
export const folderNameEntryCommit = nameEntryCommit;
