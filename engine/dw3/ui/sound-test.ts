// The developer sound-test screen's menu task, translated from pro/soundtst
// F0x80084B2C (`_asm/F0x80084b2c.s`, authority 2; C `F0x80084b2c.c`).
//
// State at +0x0C: 0 (and >= 4) builds the screen; 1 dispatches on the substate
// at +0x10 (1 -> loader F0x80084808, 2 -> sound list F0x800844A8, everything
// else -> category list F0x800848BC); 2 does nothing; 3 requests the 0x1500
// transition. The build resets the display, creates the view, then the title
// (16,30), heading (32,50), eight rows (48, 70+16i) at +0xC..+0x28 and the
// cursor (32,70) at +8, and finally advances the task.
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/sound-test-oracle.test.js runs the original through
// engine/native with the display/view/widget subfunctions stubbed.

export interface SoundTestMemory {
    read32(addr: number): number;
    write32(addr: number, value: number): void;
}

export interface SoundTestMenuHost {
    /** [0x8004DE10+0x150](arg). */
    displaySetA(arg: number): void;
    /** [0x8004DE10+0x154](0x5000). */
    displaySetB(arg: number): void;
    /** [0x8004DE10+0x174](x, y, w, h). */
    displaySetRect(x: number, y: number, w: number, h: number): void;
    /** [0x8004DE10+0x16C](descriptor, arg1, arg2) -> view object. */
    displayViewCreate(descriptor: number, a1: number, a2: number): number;
    /** view+0x12C(r, g, b). */
    viewSetColour(view: number, r: number, g: number, b: number): void;
    /** F0x8001AE38(kind, arg1, x, y) -> child widget object. */
    createWidget(kind: number, a1: number, x: number, y: number): number;
    /** widget+0x110(resource id). */
    widgetSetString(widget: number, id: number): void;
    /** obj+0x38 (F0x800142AC). */
    advance(obj: number): void;
    /** F0x800848BC: the category list sub-state. */
    categoryList(obj: number, arg1: number): void;
    /** F0x80084808: the archive loader sub-state. */
    loader(obj: number, arg1: number): void;
    /** F0x800844A8: the sound-list sub-state. */
    soundList(obj: number, arg1: number): void;
    /** [0x8004B440]: request a screen transition. */
    requestTransition(selector: number, arg: number): void;
}

export const SOUND_TEST_MENU = {
    state: 0x0c,
    substate: 0x10,
    advance: 0x38,
} as const;

export const SOUND_TEST_MENU_VIEW_DESCRIPTOR = 0x80085a40;
export const SOUND_TEST_MENU_BUILD_SELECTOR = 0x1500;
export const SOUND_TEST_MENU_TITLE = { x: 0x10, y: 0x1e, str: 0x8008435c } as const;
export const SOUND_TEST_MENU_HEADING = { x: 0x20, y: 0x32 } as const;
export const SOUND_TEST_MENU_CURSOR = { x: 0x20, y: 0x46, str: 0x8008436c } as const;
export const SOUND_TEST_MENU_ROW = { x: 0x30, y0: 0x46, dy: 0x10, count: 8, first: 0x0c } as const;

const s32 = (v: number): number => v | 0;

/** F0x80084B2C(obj, arg1): one sound-test menu frame. */
export function soundTestMenuTick(
    mem: SoundTestMemory,
    obj: number,
    arg1: number,
    host: SoundTestMenuHost,
): void {
    const state = s32(mem.read32(obj + SOUND_TEST_MENU.state));

    if (state === 1) {
        const sub = s32(mem.read32(obj + SOUND_TEST_MENU.substate));
        if (sub === 1) {
            host.loader(obj, arg1);
            return;
        }
        if (sub === 2) {
            host.soundList(obj, arg1);
            return;
        }
        host.categoryList(obj, arg1);
        return;
    }
    if (state === 2) return;
    if (state === 3) {
        host.requestTransition(SOUND_TEST_MENU_BUILD_SELECTOR, 0);
        return;
    }

    // state 0 builds with selector 0; any other fall-through state (>= 4)
    // builds with the 0x1500 selector the original left in a0.
    host.displaySetA(state === 0 ? 0 : SOUND_TEST_MENU_BUILD_SELECTOR);
    host.displaySetB(0x5000);
    host.displaySetRect(0x140, 0xf0, 0, 0);
    const view = host.displayViewCreate(SOUND_TEST_MENU_VIEW_DESCRIPTOR, 1, 0x1000) >>> 0;
    host.viewSetColour(view, 0x1f, 0x1f, 0x1f);

    let widget = host.createWidget(0x1000, 1, SOUND_TEST_MENU_TITLE.x, SOUND_TEST_MENU_TITLE.y) >>> 0;
    mem.write32(arg1 + 0x00, widget);
    host.widgetSetString(widget, SOUND_TEST_MENU_TITLE.str);

    mem.write32(arg1 + 0x04, host.createWidget(0x1000, 1, SOUND_TEST_MENU_HEADING.x, SOUND_TEST_MENU_HEADING.y) >>> 0);

    let rowSlot = arg1;
    let y = SOUND_TEST_MENU_ROW.y0;
    for (let i = 0; i < SOUND_TEST_MENU_ROW.count; i++) {
        widget = host.createWidget(0x1000, 1, SOUND_TEST_MENU_ROW.x, y) >>> 0;
        mem.write32(rowSlot + SOUND_TEST_MENU_ROW.first, widget);
        rowSlot += 4;
        y += SOUND_TEST_MENU_ROW.dy;
    }

    widget = host.createWidget(0x1000, 1, SOUND_TEST_MENU_CURSOR.x, SOUND_TEST_MENU_CURSOR.y) >>> 0;
    mem.write32(arg1 + 0x08, widget);
    host.widgetSetString(widget, SOUND_TEST_MENU_CURSOR.str);

    host.advance(obj);
}

// ---------------------------------------------------------------------------
// The category list sub-state, translated from pro/soundtst F0x800848BC
// (`_asm/F0x800848bc.s`, authority 2; C `F0x800848bc.c`).
//
// Runs while the menu's substate is anything but 1, and builds when the object's
// +0x14 is not 1: it counts the 8-byte entries of table 0x80085800 into +0x58,
// sets the heading (arg1+4) from 0x8008432C and calls obj+0x40. Then it reads
// the pad service 0x8004B7D0: pressed|repeat 0x40 moves the cursor down one,
// pressed|repeat 0x10 moves it up one (both via F0x8008443C with the count), and
// a pressed-edge 0x2000 (Circle) stores the selected entry's +4 into +0x5C and
// calls obj+0x3C. Finally it fills up to eight row widgets from the scroll
// offset (entry+0 == name resource, entry+4 == 0 terminates), hides the unused
// rows and moves the cursor widget to 0x20, 0x46+16*(cursor-scroll).

export interface SoundTestCategoryHost {
    /** [0x8004B7D0+0x3F4](port): pressed-edge word. */
    padPressed(port: number): number;
    /** [0x8004B7D0+0x3FC](port): auto-repeat word. */
    padRepeat(port: number): number;
    /** obj+0x40 / obj+0x3C task method slots. */
    taskCall(slot: number, obj: number): void;
    /** widget+0x110(resource id). */
    widgetSetString(widget: number, id: number): void;
    /** widget+0x144(visible). */
    widgetSetVisible(widget: number, visible: number): void;
    /** widget+0x134(x, y). */
    widgetSetPos(widget: number, x: number, y: number): void;
}

export const SOUND_TEST_CATEGORY = {
    substate: 0x14,
    method40: 0x40,
    method3c: 0x3c,
    cursor: 0x50,
    scroll: 0x54,
    count: 0x58,
    selected: 0x5c,
    heading: 0x04,
    cursorWidget: 0x08,
    firstRow: 0x0c,
} as const;

export const SOUND_TEST_CATEGORY_TABLE = 0x80085800;
export const SOUND_TEST_CATEGORY_HEADING_STR = 0x8008432c;
export const SOUND_TEST_CATEGORY_ROWS = 8;
export const SOUND_TEST_CATEGORY_ROW_X = 0x20;
export const SOUND_TEST_CATEGORY_ROW_Y0 = 0x46;
export const SOUND_TEST_CATEGORY_ROW_DY = 0x10;
export const SOUND_TEST_CATEGORY_PAD_DOWN = 0x40;
export const SOUND_TEST_CATEGORY_PAD_UP = 0x10;
export const SOUND_TEST_CATEGORY_PAD_CONFIRM = 0x2000;

/** F0x800848BC(obj, arg1): one category-list frame. */
export function soundTestCategoryList(
    mem: SoundTestMemory,
    obj: number,
    arg1: number,
    host: SoundTestCategoryHost,
): void {
    if (s32(mem.read32(obj + SOUND_TEST_CATEGORY.substate)) !== 1) {
        let count = 0;
        mem.write32(obj + SOUND_TEST_CATEGORY.count, 0);
        if (s32(mem.read32(SOUND_TEST_CATEGORY_TABLE + 4)) !== 0) {
            do {
                count += 1;
                mem.write32(obj + SOUND_TEST_CATEGORY.count, count);
            } while (s32(mem.read32(SOUND_TEST_CATEGORY_TABLE + count * 8 + 4)) !== 0);
        }
        host.widgetSetString(mem.read32(arg1 + SOUND_TEST_CATEGORY.heading), SOUND_TEST_CATEGORY_HEADING_STR);
        host.taskCall(SOUND_TEST_CATEGORY.method40, obj);
    }

    // Pad: the original reads the pressed word and the auto-repeat word twice
    // (0x40 then 0x10) and the pressed word once more (0x2000 edge).
    const pressed1 = host.padPressed(0) | host.padRepeat(0);
    if ((pressed1 & SOUND_TEST_CATEGORY_PAD_DOWN) !== 0) {
        soundTestScrollList(mem, 1, obj + SOUND_TEST_CATEGORY.cursor, obj + SOUND_TEST_CATEGORY.scroll,
            s32(mem.read32(obj + SOUND_TEST_CATEGORY.count)));
    } else {
        const pressed2 = host.padPressed(0) | host.padRepeat(0);
        if ((pressed2 & SOUND_TEST_CATEGORY_PAD_UP) !== 0) {
            soundTestScrollList(mem, -1, obj + SOUND_TEST_CATEGORY.cursor, obj + SOUND_TEST_CATEGORY.scroll,
                s32(mem.read32(obj + SOUND_TEST_CATEGORY.count)));
        } else if ((host.padPressed(0) & SOUND_TEST_CATEGORY_PAD_CONFIRM) !== 0) {
            const cursor = s32(mem.read32(obj + SOUND_TEST_CATEGORY.cursor));
            mem.write32(obj + SOUND_TEST_CATEGORY.selected,
                mem.read32(SOUND_TEST_CATEGORY_TABLE + cursor * 8 + 4) >>> 0);
            host.taskCall(SOUND_TEST_CATEGORY.method3c, obj);
        }
    }

    const scroll = s32(mem.read32(obj + SOUND_TEST_CATEGORY.scroll));
    let entry = SOUND_TEST_CATEGORY_TABLE + scroll * 8;
    let rowAddr = arg1;
    let shown = 0;
    let terminated = false;
    while (true) {
        if (s32(mem.read32(entry + 4)) === 0) {
            terminated = true;
            break;
        }
        const widget = mem.read32(rowAddr + SOUND_TEST_CATEGORY.firstRow);
        host.widgetSetString(widget, mem.read32(entry) >>> 0);
        host.widgetSetVisible(widget, 1);
        shown += 1;
        entry += 8;
        rowAddr += 4;
        if (!(shown < SOUND_TEST_CATEGORY_ROWS)) break;
    }
    if (terminated && shown < SOUND_TEST_CATEGORY_ROWS) {
        let addr = arg1 + shown * 4;
        for (let i = shown; i < SOUND_TEST_CATEGORY_ROWS; i++) {
            host.widgetSetVisible(mem.read32(addr + SOUND_TEST_CATEGORY.firstRow), 0);
            addr += 4;
        }
    }

    const cursor = s32(mem.read32(obj + SOUND_TEST_CATEGORY.cursor));
    const y = (((cursor - scroll) * SOUND_TEST_CATEGORY_ROW_DY + SOUND_TEST_CATEGORY_ROW_Y0) << 16) >> 16;
    host.widgetSetPos(mem.read32(arg1 + SOUND_TEST_CATEGORY.cursorWidget), SOUND_TEST_CATEGORY_ROW_X, y);
}

// ---------------------------------------------------------------------------
// The shared list mover, translated from pro/soundtst F0x8008443C
// (`_asm/F0x8008443c.s`, authority 2). Both list screens call it with their own
// cursor/scroll fields: a0 is unused, a1 is the step, a2/a3 are the cursor and
// scroll addresses, and the row count rides on the stack.
//
// Moves the absolute cursor by `delta` and refuses to leave 0..count-1; the
// eight-row window follows only when the cursor would leave it (scroll =
// cursor - 7 past the bottom, scroll = cursor past the top). Canonical decode:
// docs/research/audio/soundtst-full-decode-2026-08-05.md "Selection state".
export function soundTestScrollList(
    mem: SoundTestMemory,
    delta: number,
    cursorPtr: number,
    scrollPtr: number,
    count: number,
): void {
    const candidate = s32(mem.read32(cursorPtr)) + delta;
    if (candidate < 0) return;
    if (!(candidate < count)) return;
    mem.write32(cursorPtr, candidate >>> 0);
    if (!(candidate < s32(mem.read32(scrollPtr)) + 8)) {
        mem.write32(scrollPtr, (candidate - 7) >>> 0);
    }
    if (s32(mem.read32(cursorPtr)) < s32(mem.read32(scrollPtr))) {
        mem.write32(scrollPtr, mem.read32(cursorPtr));
    }
}

// ---------------------------------------------------------------------------
// The archive loader sub-state, translated from pro/soundtst F0x80084808
// (`_asm/F0x80084808.s`, authority 2; C `F0x80084808.c`).
//
// Stage +0x14: anything but 1 starts the load of the archive the category list
// stored at +0x5C - archive 1 (the COMMON bank) through D0x80055C58(0, 1), any
// other archive through D0x80055C54(id) - and advances the stage. Then it polls
// D0x80055C60() and calls task slot +0x3C once the load reports done.
export interface SoundTestLoaderHost {
    /** D0x80055C54(archiveId): load a VAB archive. */
    loadArchive(archiveId: number): void;
    /** D0x80055C58(a0, a1): the archive-1 (COMMON bank) special case. */
    loadCommon(a0: number, a1: number): void;
    /** D0x80055C60(): nonzero while the archive load is still running. */
    loadBusy(): number;
    /** obj+0x3C task method slot. */
    taskCall(slot: number, obj: number): void;
}

export const SOUND_TEST_LOADER = {
    stage: 0x14,
    archive: 0x5c,
    method3c: 0x3c,
} as const;

/** F0x80084808(obj): one archive-loader frame. */
export function soundTestLoader(mem: SoundTestMemory, obj: number, host: SoundTestLoaderHost): void {
    const stage = s32(mem.read32(obj + SOUND_TEST_LOADER.stage));
    if (stage !== 1) {
        const archive = s32(mem.read32(obj + SOUND_TEST_LOADER.archive));
        if (archive === 1) host.loadCommon(0, 1);
        else host.loadArchive(archive);
        mem.write32(obj + SOUND_TEST_LOADER.stage, (stage + 1) >>> 0);
    }
    if (host.loadBusy() === 0) host.taskCall(SOUND_TEST_LOADER.method3c, obj);
}

// ---------------------------------------------------------------------------
// The sound-list sub-state, translated from pro/soundtst F0x800844A8
// (`_asm/F0x800844a8.s`, authority 2; C `F0x800844a8.c`).
//
// Entered with the archive the category list picked; `0x800856E4` maps the
// category index (+0x50) to that archive's own table of 8-byte entries
// (name id, packed sound id; a zero sound id terminates). The build counts the
// entries into +0x68, sets the heading widget (arg1+4) from the category's own
// record name at 0x80085800[cursor].name and calls task slot +0x40. The pad:
// Down/Up move (repeat included), Square stops everything, Cross goes back
// (task slot +0x2C), Circle plays the highlighted entry and releasing Circle
// stops it through D0x80055C50. The render fills the eight row widgets from the
// scroll window and hides the unused rows, exactly like the category list.
export interface SoundTestSoundListHost {
    /** [0x8004B7D0+0x3F4](port): pressed-edge word. */
    padPressed(port: number): number;
    /** [0x8004B7D0+0x3F8](port): held word. */
    padHeld(port: number): number;
    /** [0x8004B7D0+0x3FC](port): auto-repeat word. */
    padRepeat(port: number): number;
    /** D0x80055C64(): stop every playing sound. */
    stopAll(): void;
    /** D0x80055C48(packedId) -> s16 handle: start the preview. */
    previewStart(packedId: number): number;
    /** D0x80055C50(packedId, handle): stop that preview. */
    previewStop(packedId: number, handle: number): void;
    /** obj+0x2C / obj+0x40 task method slots. */
    taskCall(slot: number, obj: number): void;
    /** widget+0x110(resource id). */
    widgetSetString(widget: number, id: number): void;
    /** widget+0x144(visible). */
    widgetSetVisible(widget: number, visible: number): void;
    /** widget+0x134(x, y). */
    widgetSetPos(widget: number, x: number, y: number): void;
}

export const SOUND_TEST_SOUND_LIST = {
    stage: 0x14,
    method2c: 0x2c,
    method40: 0x40,
    category: 0x50,
    cursor: 0x60,
    scroll: 0x64,
    count: 0x68,
    previewing: 0x6c,
    previewHandle: 0x70,
    heading: 0x04,
    cursorWidget: 0x08,
    firstRow: 0x0c,
} as const;

/** u32 pointer per category index -> that archive's 8-byte entry table. */
export const SOUND_TEST_SOUND_LIST_TABLES = 0x800856e4;
export const SOUND_TEST_SOUND_LIST_PAD_STOP = 0x8000;
export const SOUND_TEST_SOUND_LIST_PAD_BACK = 0x4000;
export const SOUND_TEST_SOUND_LIST_PAD_PLAY = 0x2000;

/** F0x800844A8(obj, arg1): one sound-list frame. */
export function soundTestSoundList(
    mem: SoundTestMemory,
    obj: number,
    arg1: number,
    host: SoundTestSoundListHost,
): void {
    const category = s32(mem.read32(obj + SOUND_TEST_SOUND_LIST.category));
    const table = mem.read32(SOUND_TEST_SOUND_LIST_TABLES + category * 4) >>> 0;

    if (s32(mem.read32(obj + SOUND_TEST_SOUND_LIST.stage)) !== 1) {
        mem.write32(obj + SOUND_TEST_SOUND_LIST.cursor, 0);
        mem.write32(obj + SOUND_TEST_SOUND_LIST.scroll, 0);
        mem.write32(obj + SOUND_TEST_SOUND_LIST.count, 0);
        if (s32(mem.read32(table + 4)) !== 0) {
            let count = 0;
            do {
                count += 1;
                mem.write32(obj + SOUND_TEST_SOUND_LIST.count, count);
            } while (s32(mem.read32(table + count * 8 + 4)) !== 0);
        }
        host.widgetSetString(
            mem.read32(arg1 + SOUND_TEST_SOUND_LIST.heading),
            mem.read32(SOUND_TEST_CATEGORY_TABLE + category * 8) >>> 0,
        );
        mem.write32(obj + SOUND_TEST_SOUND_LIST.previewing, 0);
        host.taskCall(SOUND_TEST_SOUND_LIST.method40, obj);
    }

    // Pad: Down/Up combine the pressed and repeat words (a held direction
    // repeats every frame here); Square/Cross/Circle read the pressed edge, and
    // the Circle-release test reads the held word.
    const direction = host.padPressed(0) | host.padRepeat(0);
    if ((direction & SOUND_TEST_CATEGORY_PAD_DOWN) !== 0) {
        soundTestScrollList(mem, 1, obj + SOUND_TEST_SOUND_LIST.cursor, obj + SOUND_TEST_SOUND_LIST.scroll,
            s32(mem.read32(obj + SOUND_TEST_SOUND_LIST.count)));
    } else if ((direction & SOUND_TEST_CATEGORY_PAD_UP) !== 0) {
        soundTestScrollList(mem, -1, obj + SOUND_TEST_SOUND_LIST.cursor, obj + SOUND_TEST_SOUND_LIST.scroll,
            s32(mem.read32(obj + SOUND_TEST_SOUND_LIST.count)));
    } else if ((host.padPressed(0) & SOUND_TEST_SOUND_LIST_PAD_STOP) !== 0) {
        host.stopAll();
    } else if ((host.padPressed(0) & SOUND_TEST_SOUND_LIST_PAD_BACK) !== 0) {
        host.taskCall(SOUND_TEST_SOUND_LIST.method2c, obj);
    } else if ((host.padPressed(0) & SOUND_TEST_SOUND_LIST_PAD_PLAY) !== 0) {
        const soundId = mem.read32(table + s32(mem.read32(obj + SOUND_TEST_SOUND_LIST.cursor)) * 8 + 4) >>> 0;
        mem.write32(obj + SOUND_TEST_SOUND_LIST.previewHandle, (host.previewStart(soundId) << 16) >> 16);
        mem.write32(obj + SOUND_TEST_SOUND_LIST.previewing, 1);
    } else if (s32(mem.read32(obj + SOUND_TEST_SOUND_LIST.previewing)) !== 0) {
        if ((host.padHeld(0) & SOUND_TEST_SOUND_LIST_PAD_PLAY) === 0) {
            const handle = (s32(mem.read32(obj + SOUND_TEST_SOUND_LIST.previewHandle)) << 16) >> 16;
            mem.write32(obj + SOUND_TEST_SOUND_LIST.previewing, 0);
            const soundId = mem.read32(table + s32(mem.read32(obj + SOUND_TEST_SOUND_LIST.cursor)) * 8 + 4) >>> 0;
            host.previewStop(soundId, handle);
        }
    }

    const scroll = s32(mem.read32(obj + SOUND_TEST_SOUND_LIST.scroll));
    let entry = table + scroll * 8;
    let rowAddr = arg1;
    let shown = 0;
    let terminated = false;
    while (true) {
        if (s32(mem.read32(entry + 4)) === 0) {
            terminated = true;
            break;
        }
        const widget = mem.read32(rowAddr + SOUND_TEST_SOUND_LIST.firstRow);
        host.widgetSetString(widget, mem.read32(entry) >>> 0);
        host.widgetSetVisible(widget, 1);
        shown += 1;
        entry += 8;
        rowAddr += 4;
        if (!(shown < SOUND_TEST_CATEGORY_ROWS)) break;
    }
    if (terminated && shown < SOUND_TEST_CATEGORY_ROWS) {
        let addr = arg1 + shown * 4;
        for (let i = shown; i < SOUND_TEST_CATEGORY_ROWS; i++) {
            host.widgetSetVisible(mem.read32(addr + SOUND_TEST_SOUND_LIST.firstRow), 0);
            addr += 4;
        }
    }

    const cursor = s32(mem.read32(obj + SOUND_TEST_SOUND_LIST.cursor));
    const y = (((cursor - scroll) * SOUND_TEST_CATEGORY_ROW_DY + SOUND_TEST_CATEGORY_ROW_Y0) << 16) >> 16;
    host.widgetSetPos(mem.read32(arg1 + SOUND_TEST_SOUND_LIST.cursorWidget), SOUND_TEST_CATEGORY_ROW_X, y);
}
