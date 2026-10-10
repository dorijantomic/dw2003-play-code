// The in-battle ITEM list (pro/fightstg): the screen object, its widget table,
// its row updater and its draw, translated from the original bodies.
//
// Lane B. Every routine below is one original address; the resident services it
// calls (the picture context, the text-element constructor, the resource bank,
// the inventory list, the two record services, the short-array allocator, the
// pad, the sound, the frame counter and the object methods) are host
// boundaries. The list model object (F0x8009B0C8), its state machine
// (F0x8009AF4C) and the vsync marker blit (F0x8009ABD8) are the already
// translated ports in ./fight-command-menu.ts: the ITEM list is built from the
// same factory with its own config block at 0x800A3534.
//
//   F0x800959B0 itemListTick            state 0 builds the list, state 1 draws
//                                        it and reads the pad, state 3 frees.
//   F0x8009543C itemListDraw            the seven icon cels and the five
//                                        PGFGTC00 cels.
//   F0x8009563C itemListCreateWidgets   the eleven text widgets.
//   F0x800957B4 itemListUpdateRows      the seven row names, the description
//                                        and the quantity figure.
//
// Geometry, all read from fightstg.s: rows at x = 42, y = 69 + 14*i (a 16.16
// constant stepped by 0xE0000); the icon at (29, 69 + 14*i); the "L1"/"R1"
// hints at (26,169)/(128,169); the quantity figure at (172,165) and its caption
// at (198,165); the description title at (20,194); the page arrows PGFGTC00
// 0x1F at (16,169) and 0x20 at (144,169); the list window 0x27 at (8,62); the
// quantity pane 0x28 at (166,160); the description pane 0x31 at (11,188).

/** The screen object handler and the factory arguments of F0x80095E00. */
export const ITEM_LIST_ACTOR_HANDLER = 0x800959b0;
export const ITEM_LIST_ACTOR_SIZE = 0x390;
export const ITEM_LIST_ACTOR_EXTRA = 0x34;
/** The config block the screen overwrites and F0x8009B0C8 reads. */
export const ITEM_LIST_CONFIG = 0x800a3534;
/** The screen object's own fields. */
export const ITEM_LIST_STATE = 0x0c;
export const ITEM_LIST_OUT = 0x50;
export const ITEM_LIST_LAST_CURSOR = 0x54;
/** The halfword id page the inventory service fills in, stride 2. */
export const ITEM_LIST_INPUT_IDS = 0x58;
export const ITEM_LIST_IDS = 0x380;
export const ITEM_LIST_COUNT = 0x384;
export const ITEM_LIST_PAGE = 0x388;
export const ITEM_LIST_PAGES = 0x38c;
export const ITEM_LIST_ROWS = 7;
/**
 * The widget table F0x8009563C fills. Each handle is written one slot after the
 * create that made it, because each `sw` is the next call's delay slot.
 */
export const ITEM_LIST_WIDGET_HINT_LEFT = 0x04;
export const ITEM_LIST_WIDGET_HINT_RIGHT = 0x08;
export const ITEM_LIST_WIDGET_FIGURE = 0x0c;
export const ITEM_LIST_WIDGET_CAPTION = 0x10;
export const ITEM_LIST_WIDGET_TITLE = 0x14;
export const ITEM_LIST_WIDGET_ROW = 0x18;
/**
 * The byte-per-item-id held-count table. F0x800135E8 reads it to decide which
 * ids the list offers, and F0x800957B4 reads it again for the quantity figure.
 * It is the same table the merchant tasks seed from the save
 * (engine/dw3/ui/shop-save-state.ts).
 */
export const ITEM_HELD_BASE = 0x80048db0;
export const ITEM_HELD_OFFSET = 0x7c;
export const ITEM_HELD_MAX_ID = 402;
/**
 * The exe's item-icon cel table at 0x80042BA8, indexed by the item record's
 * icon class (byte +9 of the 12-byte record at 0x80041838). Read from the exe
 * image; it is value-for-value the rig-verified FAMILY_TO_CLIP the browser
 * already ships (web/itemicons-data.js), which the lane-b oracle asserts.
 */
export const ITEM_ICON_CEL_TABLE = Object.freeze([
    74, 74, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 73, 72, 85,
    86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 99, 0,
]);
export const ITEM_ICON_CLASS_MAX = ITEM_ICON_CEL_TABLE.length - 1;
/** The two draw packs: 0x02860000 (CMFONT, the row icon) and 0x04550000 (PGFGTC00). */
export const ITEM_ICON_PACK = 0x02860000;
export const ITEM_CHROME_PACK = 0x04550000;
/** The frame counter [0x8004DF98]; bit 4 gates both page arrows. */
export const ITEM_FRAME_COUNTER = 0x8004df98;
export const ITEM_ARROW_GATE = 0x10;
/** The packs' draws. */
export const ITEM_LAYER = 0x1005;
export const ITEM_LAYER_BUCKET = 1;
export const ITEM_ICON_ORIGIN = 0x140;
export const ITEM_CHROME_ORIGIN = 0x200;
/** The chrome cels and their anchors. */
export const ITEM_CEL_ARROW_LEFT = 0x1f;
export const ITEM_CEL_ARROW_RIGHT = 0x20;
export const ITEM_CEL_LIST_WINDOW = 0x27;
export const ITEM_CEL_QUANTITY = 0x28;
export const ITEM_CEL_DESCRIPTION = 0x31;
/** The row icon column and the row-name column. */
export const ITEM_ICON_X = 0x1d;
export const ITEM_ROW_X = 0x2a;
export const ITEM_ROW_Y = 0x45;
export const ITEM_ROW_PITCH = 0x0e;
/** Text banks (the call sites compose them as language + the literal offset). */
export const ITEM_BANK_DESCRIPTION = 0x63;
export const ITEM_BANK_NAME = 0x6a;
export const ITEM_BANK_UI = 0x7f;
/** The language byte the resident resource-base helper is composed with. */
export const ITEM_STRING_BASE = 0x8005cca8;
export const ITEM_WORD_HINT_LEFT = 0x11;
export const ITEM_WORD_HINT_RIGHT = 0x12;
export const ITEM_WORD_FIGURE = 0x0c;
export const ITEM_WORD_EMPTY = 0x15;
export const ITEM_WORD_QUANTITY = 0x1a;
/** The widget kinds F0x8001AE38 renders (arg2 -> +0xB0 x, arg3 -> +0xB2 y). */
export const ITEM_WIDGET_KIND_HINT = 3;
export const ITEM_WIDGET_KIND_ROW = 1;
/** The pad bits: L1, R1, Circle, Cross. Up and down are the shared machine's. */
export const ITEM_PAD_LEFT = 0x400;
export const ITEM_PAD_RIGHT = 0x800;
export const ITEM_PAD_CONFIRM = 0x2000;
export const ITEM_PAD_CANCEL = 0x4000;
/**
 * The three packed sounds. `lui $a0,0x4` before the `ori` in the move and
 * confirm call sites is live: `ori` writes only the low half, so the ids the
 * sound service receives are 0x4001B and 0x4001C. The cancel site has no `lui`,
 * so the id is 0x50BD and F0x8002006C widens it to 0x800450BD.
 */
export const ITEM_MOVE_SOUND = 0x4001b;
export const ITEM_CONFIRM_SOUND = 0x4001c;
export const ITEM_CANCEL_SOUND = 0x800450bd;
/** Cancel writes -2 into the caller's word (the caller tests -1 for "still open"). */
export const ITEM_RESULT_CANCEL = -2;
/** The inventory list selector the screen passes (the battle list). */
export const ITEM_LIST_KIND = 1;
/** The record flag bit the screen tests to decide a listed item is offered. */
export const ITEM_RECORD_FLAG = 0x2;

export interface ItemListMemory {
    read8(addr: number): number;
    read16(addr: number): number;
    read16s(addr: number): number;
    read32(addr: number): number;
    write8?(addr: number, value: number): void;
    write16(addr: number, value: number): void;
    write32(addr: number, value: number): void;
}

export interface ItemListHost {
    /** F0x80014504(0x800959B0, 0x390, 0x34): allocate the screen object. */
    allocateActor(): number;
    /**
     * F0x8009B0C8(config): build the list model from the config block. The ITEM
     * list uses the shared factory, so the port is commandMenuCreate.
     */
    createModel(config: number): number;
    /**
     * F0x800135E8(kind, dest): write one halfword per offered item id at `dest`
     * and return how many. The record service is applied afterwards by the
     * screen itself, so this is the unfiltered id list.
     */
    inventoryList(kind: number, dest: number): number;
    /**
     * The inventory record service F0x8001355C(id) followed by the screen's
     * test: true when bit 1 of byte 0 of the item's effect record is set.
     */
    inventoryRecordFlag(id: number): boolean;
    /** [0x80042B9C](id): the item's icon cel, read from the exe's cel table. */
    itemIconCel(id: number): number;
    /** [0x8004B5F4](2, bytes): allocate the filtered id array. */
    allocShorts(bytes: number): number;
    /** [0x80055BEC](ptr): release the filtered id array (state 3). */
    freeShorts(ptr: number): void;
    /** F0x8001AE38(target, kind, x, y): build a text widget. */
    createTextElement(target: number, kind: number, x: number, y: number): number;
    /** [0x80044F4C](bank): the resource base of an indexed text bank. */
    resourceBase(bank: number): number;
    /** [0x80044F5C](handle): resolve a pack handle to its pointer. */
    packResolve(handle: number): number;
    /** [0x8004BBC4](0): the pad word the screen reads. */
    padRead(port: number): number;
    /** [0x8004B7D0+0x3F4](port): the pressed word the shared list model reads. */
    padReadA(port: number): number;
    /** [0x8004B7D0+0x3FC](port): the repeated word the shared list model reads. */
    padReadB(port: number): number;
    /** [0x80055C48](id): play a packed sound. */
    playSound(id: number): void;
    /** [0x8004DF98](): the display counter whose bit 4 gates the page arrows. */
    frameCounter(): number;
    /** F0x8001F648(): build the stack draw context. */
    initDrawContext(): void;
    /** ctx+0x8C(x, y): set the draw layer. */
    setLayer(x: number, y: number): void;
    /** ctx+0x84(x, y): set the draw origin. */
    setOrigin(x: number, y: number): void;
    /** ctx+0x94(pack, id, x, y): draw a sprite. */
    drawSprite(pack: number, id: number, x: number, y: number): void;
    /** target+slot(a1, a2): an object method. */
    callMethod(target: number, slot: number, args: number[]): void;
}

/** F0x80095E00(out): build the screen object and mark the answer "not yet". */
export function itemListActorConstruct(mem: ItemListMemory, out: number, host: ItemListHost): number {
    const obj = host.allocateActor();
    mem.write32(obj + ITEM_LIST_OUT, out);
    mem.write32(out, -1);
    return obj;
}

/**
 * F0x800959B0(self, slot): the screen's own tick. State 0 builds the list and
 * hands the model to F0x8009563C/F0x800957B4; state 1 draws the list and reads
 * the pad; state 3 releases the id array; every other state returns.
 */
export function itemListTick(
    mem: ItemListMemory,
    self: number,
    slot: number,
    host: ItemListHost,
): void {
    const state = mem.read32(self + ITEM_LIST_STATE) | 0;
    if (state === 1) {
        itemListInput(mem, self, slot, host);
        return;
    }
    if (state < 2) {
        itemListBuild(mem, self, slot, host);
        return;
    }
    if (state === 3) {
        const ids = mem.read32(self + ITEM_LIST_IDS) >>> 0;
        if (ids !== 0) host.freeShorts(ids);
    }
}

/**
 * F0x800959B0 state 0 (fightstg.s:19447-19567): ask the inventory for its
 * battle id list, count and then collect the ids whose record carries the flag
 * bit, compute the page count, write min(count, 7) into the config block, build
 * the model, build and fill the widgets and call the screen's per-frame method.
 *
 * The two passes over the id page are the original's, not a merge: the count
 * pass (:19449-19478) and the collect pass (:19494-19521) each walk the halfword
 * ids the inventory wrote at self+0x58 and stop at the first zero id.
 */
export function itemListBuild(
    mem: ItemListMemory,
    self: number,
    slot: number,
    host: ItemListHost,
): void {
    const listed = host.inventoryList(ITEM_LIST_KIND, (self + ITEM_LIST_INPUT_IDS) >>> 0) | 0;
    let count = 0;
    for (let i = 0; i < listed; i++) {
        const id = mem.read16s(self + ITEM_LIST_INPUT_IDS + i * 2) | 0;
        if (id === 0) break;
        if (host.inventoryRecordFlag(id)) count += 1;
    }
    mem.write32(self + ITEM_LIST_COUNT, count);

    let ids = 0;
    if (count !== 0) {
        // fightstg.s:19469: `beqz count` jumps past the page-count division AND
        // the config write, so an empty list leaves both at whatever they were —
        // which is why both page keys are dead on an empty list.
        const quotient = Math.floor(count / ITEM_LIST_ROWS);
        mem.write32(self + ITEM_LIST_PAGES, count === quotient * ITEM_LIST_ROWS ? quotient : quotient + 1);
        // min(count, 7) into the config block.
        mem.write32(ITEM_LIST_CONFIG, count < ITEM_LIST_ROWS + 1 ? count : ITEM_LIST_ROWS);

        ids = host.allocShorts(count * 2) >>> 0;
        mem.write32(self + ITEM_LIST_IDS, ids);
        let kept = 0;
        for (let i = 0; i < listed; i++) {
            const id = mem.read16s(self + ITEM_LIST_INPUT_IDS + i * 2) | 0;
            if (id === 0) break;
            if (!host.inventoryRecordFlag(id)) continue;
            mem.write16(ids + kept * 2, id & 0xffff);
            kept += 1;
        }
    }

    // `sw $v0, ($s5)` in the delay slot of the F0x8009563C call: the argument is
    // the child-slot cell itself, and it receives the model.
    const model = host.createModel(ITEM_LIST_CONFIG);
    mem.write32(slot, model);
    itemListCreateWidgets(mem, self, slot, host);
    itemListUpdateRows(mem, self, slot, host);
    host.callMethod(self, 0x38, []);
}

/**
 * F0x8009563C(self, slot) (fightstg.s:19199-19294): the eleven text widgets.
 * The order of the calls and every anchor is the original's.
 */
export function itemListCreateWidgets(
    mem: ItemListMemory,
    self: number,
    slot: number,
    host: ItemListHost,
): void {
    void self;
    const bank = (mem.read32(ITEM_STRING_BASE) | 0) + ITEM_BANK_UI;
    const res = host.resourceBase(bank);

    let widget = host.createTextElement(ITEM_LAYER, ITEM_WIDGET_KIND_HINT, 26, 169);
    mem.write32(slot + ITEM_LIST_WIDGET_HINT_LEFT, widget);
    host.callMethod(widget, 0x114, [res, ITEM_WORD_HINT_LEFT]);
    host.callMethod(widget, 0x138, [2]);

    widget = host.createTextElement(ITEM_LAYER, ITEM_WIDGET_KIND_HINT, 128, 169);
    mem.write32(slot + ITEM_LIST_WIDGET_HINT_RIGHT, widget);
    host.callMethod(widget, 0x114, [res, ITEM_WORD_HINT_RIGHT]);
    host.callMethod(widget, 0x138, [2]);

    widget = host.createTextElement(ITEM_LAYER, ITEM_WIDGET_KIND_ROW, 172, 165);
    mem.write32(slot + ITEM_LIST_WIDGET_FIGURE, widget);
    host.callMethod(widget, 0x114, [res, ITEM_WORD_FIGURE]);

    for (let i = 0; i < ITEM_LIST_ROWS; i++) {
        const row = host.createTextElement(ITEM_LAYER, ITEM_WIDGET_KIND_ROW, ITEM_ROW_X,
            ITEM_ROW_Y + ITEM_ROW_PITCH * i);
        mem.write32(slot + ITEM_LIST_WIDGET_ROW + i * 4, row);
    }

    // The two stores are the delay slots of the two calls that follow them, so
    // the (20,194) description bar lands in slot+0x14 and the (198,165) caption
    // in slot+0x10.
    widget = host.createTextElement(ITEM_LAYER, ITEM_WIDGET_KIND_ROW, 20, 194);
    mem.write32(slot + ITEM_LIST_WIDGET_TITLE, widget);
    widget = host.createTextElement(ITEM_LAYER, ITEM_WIDGET_KIND_ROW, 198, 165);
    mem.write32(slot + ITEM_LIST_WIDGET_CAPTION, widget);
}

/**
 * F0x800957B4(self, slot) (fightstg.s:19296-19422): the seven row names (bank
 * 0x6A, the item id), the description of the entry under the cursor (bank 0x63)
 * and the quantity figure (the held-count byte for that id). A row past the
 * count is hidden with the element's +0x144(0). An empty list puts the UI word
 * 0x15 on the description bar and 0x1A on the caption.
 */
export function itemListUpdateRows(
    mem: ItemListMemory,
    self: number,
    slot: number,
    host: ItemListHost,
): void {
    const language = mem.read32(ITEM_STRING_BASE) | 0;
    const count = mem.read32(self + ITEM_LIST_COUNT) | 0;
    const caption = mem.read32(slot + ITEM_LIST_WIDGET_CAPTION) >>> 0;
    if (count === 0) {
        // Two separate bank lookups in the original (fightstg.s:19385-19392
        // and :19396-19401), one per word.
        host.callMethod(mem.read32(slot + ITEM_LIST_WIDGET_TITLE) >>> 0, 0x114,
            [host.resourceBase(language + ITEM_BANK_UI), ITEM_WORD_EMPTY]);
        host.callMethod(caption, 0x114,
            [host.resourceBase(language + ITEM_BANK_UI), ITEM_WORD_QUANTITY]);
    } else {
        const page = mem.read32(self + ITEM_LIST_PAGE) | 0;
        const ids = mem.read32(self + ITEM_LIST_IDS) >>> 0;
        const first = page * ITEM_LIST_ROWS;
        for (let row = 0; row < ITEM_LIST_ROWS; row++) {
            const widget = mem.read32(slot + ITEM_LIST_WIDGET_ROW + row * 4) >>> 0;
            const at = first + row;
            if (at > count - 1) {
                host.callMethod(widget, 0x144, [0]);
                continue;
            }
            const id = mem.read16s(ids + at * 2) | 0;
            if (id === 0) continue;
            host.callMethod(widget, 0x114, [host.resourceBase(language + ITEM_BANK_NAME), id]);
        }
        // The description reads the entry under the cursor, not the whole page.
        const menu = mem.read32(slot) >>> 0;
        const at = first + (mem.read32(menu + 0x50) | 0);
        const id = mem.read16s(ids + at * 2) | 0;
        host.callMethod(mem.read32(slot + ITEM_LIST_WIDGET_TITLE) >>> 0, 0x114,
            [host.resourceBase(language + ITEM_BANK_DESCRIPTION), id]);
        host.callMethod(caption, 0x118, [0, mem.read8(ITEM_HELD_BASE + id)]);
    }
    host.callMethod(caption, 0x148, [1]);
}

/**
 * F0x8009543C(self) (fightstg.s:19068-19195): up to seven item cels at
 * x = 29, y = 69 + 14*row for the rows of the page that exist, then PGFGTC00
 * 0x27 at (8,62), 0x28 at (166,160), 0x31 at (11,188), and the page arrows 0x1F
 * at (16,169) / 0x20 at (144,169) while the display counter's bit 4 is set and
 * the page is not the first/last one.
 */
export function itemListDraw(mem: ItemListMemory, self: number, host: ItemListHost): void {
    host.initDrawContext();
    host.setLayer(ITEM_LAYER, ITEM_LAYER_BUCKET);
    host.setOrigin(ITEM_ICON_ORIGIN, 0);
    const icons = host.packResolve(ITEM_ICON_PACK);
    const ids = mem.read32(self + ITEM_LIST_IDS) >>> 0;
    const count = mem.read32(self + ITEM_LIST_COUNT) | 0;
    const first = (mem.read32(self + ITEM_LIST_PAGE) | 0) * ITEM_LIST_ROWS;
    let y = ITEM_ROW_Y;
    for (let row = 0; row < ITEM_LIST_ROWS; row++) {
        const at = first + row;
        // `bne` leaves the loop on the first row past the end (fightstg.s:19116).
        if (at > count - 1) break;
        const id = mem.read16s(ids + at * 2) | 0;
        host.drawSprite(icons, host.itemIconCel(id), ITEM_ICON_X, y);
        y += ITEM_ROW_PITCH;
    }
    // The chrome pack is resolved before the origin moves, unlike the icon pack
    // above: `lui $a0,0x455` is the delay slot of the resolve call itself
    // (fightstg.s:19130-19135).
    const chrome = host.packResolve(ITEM_CHROME_PACK);
    host.setOrigin(ITEM_CHROME_ORIGIN, 0);
    const page = mem.read32(self + ITEM_LIST_PAGE) | 0;
    if (((host.frameCounter() | 0) & ITEM_ARROW_GATE) !== 0) {
        if (page > 0) host.drawSprite(chrome, ITEM_CEL_ARROW_LEFT, 16, 169);
        if (page < (mem.read32(self + ITEM_LIST_PAGES) | 0) - 1) {
            host.drawSprite(chrome, ITEM_CEL_ARROW_RIGHT, 144, 169);
        }
    }
    host.drawSprite(chrome, ITEM_CEL_LIST_WINDOW, 8, 62);
    host.drawSprite(chrome, ITEM_CEL_QUANTITY, 166, 160);
    host.drawSprite(chrome, ITEM_CEL_DESCRIPTION, 11, 188);
}

/**
 * F0x800959B0 state 1 (fightstg.s:19570-19691): draw, then the page keys, then
 * the cursor-change refill, then Circle (which answers the item id and closes)
 * and Cross (which answers -2). Both page keys clamp; neither acts when the list
 * has no pages.
 */
export function itemListInput(
    mem: ItemListMemory,
    self: number,
    slot: number,
    host: ItemListHost,
): void {
    itemListDraw(mem, self, host);
    const pad = host.padRead(0) | 0;
    const pages = mem.read32(self + ITEM_LIST_PAGES) | 0;
    const page = mem.read32(self + ITEM_LIST_PAGE) | 0;
    if (pages !== 0) {
        if ((pad & ITEM_PAD_LEFT) !== 0) {
            // fightstg.s:19603-19617: `sw page-1` is the delay slot of the
            // `bgez` and `sw 0` the delay slot of the jump, so both run and L1
            // always lands on the first page.
            mem.write32(self + ITEM_LIST_PAGE, page - 1);
            mem.write32(self + ITEM_LIST_PAGE, 0);
        } else if ((pad & ITEM_PAD_RIGHT) !== 0) {
            const next = page + 1;
            mem.write32(self + ITEM_LIST_PAGE, next);
            if (pages - 1 < next) mem.write32(self + ITEM_LIST_PAGE, pages - 1);
        }
    }
    if (mem.read32(self + ITEM_LIST_PAGE) !== page) {
        const menu = mem.read32(slot) >>> 0;
        mem.write32(menu + 0x50, 0);
        const shown = mem.read32(self + ITEM_LIST_COUNT)
            - ITEM_LIST_ROWS * mem.read32(self + ITEM_LIST_PAGE);
        mem.write32(menu + 0x58, shown < ITEM_LIST_ROWS + 1 ? shown : ITEM_LIST_ROWS);
        itemListUpdateRows(mem, self, slot, host);
        host.playSound(ITEM_MOVE_SOUND);
        itemListStoreCursor(mem, self, slot);
        return;
    }
    const menu = mem.read32(slot) >>> 0;
    if (mem.read32(self + ITEM_LIST_LAST_CURSOR) !== (mem.read32(menu + 0x50) | 0)) {
        itemListUpdateRows(mem, self, slot, host);
        itemListStoreCursor(mem, self, slot);
        return;
    }
    if ((pad & ITEM_PAD_CONFIRM) !== 0) {
        host.playSound(ITEM_CONFIRM_SOUND);
        if (mem.read32(self + ITEM_LIST_COUNT) !== 0) {
            const at = (mem.read32(self + ITEM_LIST_PAGE) | 0) * ITEM_LIST_ROWS
                + (mem.read32(menu + 0x50) | 0);
            const id = mem.read16s(mem.read32(self + ITEM_LIST_IDS) + at * 2) | 0;
            mem.write32(mem.read32(self + ITEM_LIST_OUT) >>> 0, id);
            host.callMethod(self, 0x28, [3]);
            // fightstg.s:19644-19650: the chosen path writes the model's
            // answered flag and returns; it does not store the cursor.
            mem.write32(menu + 0x54, 1);
            return;
        }
        // An empty list: the blip plays and nothing else happens.
        itemListStoreCursor(mem, self, slot);
        return;
    }
    if ((pad & ITEM_PAD_CANCEL) !== 0) {
        host.playSound(ITEM_CANCEL_SOUND);
        mem.write32(mem.read32(self + ITEM_LIST_OUT) >>> 0, ITEM_RESULT_CANCEL);
        host.callMethod(self, 0x28, [3]);
        return;
    }
    itemListStoreCursor(mem, self, slot);
}

/** fightstg.s:19568-19569 and 19641-19650: the screen remembers the cursor. */
function itemListStoreCursor(mem: ItemListMemory, self: number, slot: number): void {
    const menu = mem.read32(slot) >>> 0;
    mem.write32(self + ITEM_LIST_LAST_CURSOR, mem.read32(menu + 0x50) | 0);
}