// The in-battle TECH list (pro/fightstg): the screen object, its widget table,
// its row updater and its draw, translated from the original bodies.
//
// Lane B. Every routine below is one original address; the resident services it
// calls (the picture context, the text-element constructor, the resource bank,
// the pad, the sound, the frame counter, the object methods and the three
// technique-list helpers at 0x8005B44C/0x8005B46C/0x8005B47C) are host
// boundaries. The list model object (F0x8009B0C8) and its state machine
// (F0x8009AF4C) plus the vsync marker blit (F0x8009ABD8) are the already
// translated ports in ./fight-command-menu.ts: the TECH list is built from the
// same factory with a different config block.
//
//   F0x80096E88 techListActorConstruct  build the 0xD8 screen object.
//   F0x800967A0 techListTick            state 0 builds the list, state 1 draws
//                                        it and reads the pad.
//   F0x80096048 techListCreateWidgets   the fourteen text widgets.
//   F0x80096314 techListUpdateRows      the six row names, palettes and the
//                                        description block.
//   F0x80095E40 techListDraw            the six icon cels and the five
//                                        PGFGTC00 cels.
//
// Geometry, all read from fightstg.s: rows at x = 42, y = 69 + 14*i; the icon at
// (29, 69 + 14*i) is a CMFONT cel read from the exe's technique table; the "L1"/"R1" hints at (26,159)/(128,159);
// the MP plate's widgets at (172,58) "MP", (216,58) the value, (217,58) the
// slash, (251,58) the maximum; the page arrows PGFGTC00 0x1F at (16,159) and
// 0x20 at (144,159); the list window 0x2A at (8,62); the MP plate 0x29 at
// (163,33); the description pane 0x31 at (11,188); the description title at
// (256,208), "MP" and the cost both on the widget at (299,208).

/** The screen object handler and the factory arguments of F0x80096E88. */
export const TECH_LIST_ACTOR_HANDLER = 0x800967a0;
export const TECH_LIST_ACTOR_SIZE = 0xd8;
export const TECH_LIST_ACTOR_EXTRA = 0x40;
/** The config block the screen overwrites and F0x8009B0C8 reads. */
export const TECH_LIST_CONFIG = 0x800a3554;
/** The page table: the halfword at +0x58 + 2*page, the ids at +0x68 + 0x14*page. */
export const TECH_LIST_PAGE_HEADER = 0x58;
export const TECH_LIST_PAGE_FILL = 0x60;
export const TECH_LIST_PAGE_IDS = 0x68;
export const TECH_LIST_PAGE_STRIDE = 0x14;
export const TECH_LIST_PAGES_MAX = 16;
/** The built list: sixteen 16-bit entries at four bytes each, then count/page/pages. */
export const TECH_LIST_ENTRIES = 0x9c;
export const TECH_LIST_ENTRY_STRIDE = 4;
export const TECH_LIST_COUNT = 0xcc;
export const TECH_LIST_PAGE = 0xd0;
export const TECH_LIST_PAGES = 0xd4;
export const TECH_LIST_LAST_CURSOR = 0x54;
export const TECH_LIST_OUT = 0x50;
export const TECH_LIST_WIDGET_SLOT = 0x1c;
export const TECH_LIST_ROWS = 6;
/**
 * The entry word: 13 bits of technique id, bit 14 the LOAN flag (0x4000 — set
 * on a technique borrowed from another equipped form; the row palette and the
 * MP price rule both read it), bit 15 "pre-selected" (0x8000 — the signature,
 * and the Blast signature while active).
 */
export const TECH_ID_MASK = 0x1fff;
export const TECH_FLAG_LOADED = 0x4000;
export const TECH_FLAG_PRESELECTED = 0x8000;
/** The alias the palette/draw code was written with; same bit as TECH_FLAG_LOADED. */
export const TECH_FLAG_BACK = TECH_FLAG_LOADED;
/** The battle workspace: the acting slot at +0x08, the party records at +0x10, 0x20 bytes each. */
export const TECH_PARTY_BASE = 0x800a4470;
export const TECH_PARTY_INDEX = 0x800a4468;
export const TECH_PARTY_STRIDE = 0x20;
export const TECH_PARTY_TECH_COUNT = 0x00;
export const TECH_PARTY_MAX_MP = 0x0a;
export const TECH_PARTY_MP = 0x0c;
export const TECH_PARTY_NO_CHARGE = 0x1a;
/** The per-member technique word block the screen reads (0x8003EF5C + 0x58*member). */
export const TECH_MEMBER_BLOCK = 0x8003ef5c;
export const TECH_MEMBER_STRIDE = 0x58;
/** The MP price table [0x800A466C]. */
export const TECH_COST_TABLE = 0x800a466c;
/** The language byte the resident resource-base helper is composed with elsewhere. */
export const TECH_STRING_BASE = 0x8005cca8;
/** The two draw packs: 0x02860000 (CMFONT, the row icon) and 0x04550000 (PGFGTC00). */
export const TECH_ICON_PACK = 0x02860000;
export const TECH_CHROME_PACK = 0x04550000;
/**
 * F0x80095E40's row icon: the exe's technique table at 0x80042BDC holds 18 bytes
 * per technique and the cel is `byte[18*(id-1) + 4] + 0x37` (the lbu feeds the
 * addiu in the draw call's delay slot, so the table byte is live; the lane-b
 * oracle settles both the stride and the +0x37).
 */
export const TECH_ICON_TABLE = 0x80042bdc;
export const TECH_ICON_TABLE_STRIDE = 0x12;
/**
 * How long that table is. It is 443 entries, not the 512 the extracted window
 * carries: the technique-name bank 0xA2 has 444 rows with row 0 empty, every
 * consumer indexes `18*(id-1)` with the id masked to 0x1FFF
 * (fightstg.s:18564 `sll 3 / addu / sll 1`, :13144, :19753, :21829, :22294,
 * :32398), and the very next resident word after 443*18 = 0x1F26 bytes is
 * D0x80044B02 (~/ddw3/rust/dw2003_exe_data/src/data.rs:1504 and the symbol
 * after it). What follows in the extracted file is the exe's own word table,
 * including the two pack-service pointers [0x80044F4C] = F0x80013E5C and
 * [0x80044F5C] = F0x800140D8, so a screen that copies the whole window writes a
 * false pointer over both of them. Every loader must cut at TECH_ICON_TABLE_SIZE.
 */
export const TECH_ICON_TABLE_ENTRIES = 443;
export const TECH_ICON_TABLE_SIZE = TECH_ICON_TABLE_ENTRIES * TECH_ICON_TABLE_STRIDE;
/** The first resident word after the table: 0x80044B02. */
export const TECH_ICON_TABLE_END = TECH_ICON_TABLE + TECH_ICON_TABLE_SIZE;
export const TECH_ICON_TABLE_FIELD = 4;
export const TECH_ICON_CEL_BASE = 0x37;
export const TECH_ICON_X = 0x1d;
/** The frame counter [0x8004DF98] -> D0x8004de20; bit 4 gates the page arrows. */
export const TECH_FRAME_COUNTER = 0x8004df98;
export const TECH_ARROW_GATE = 0x10;
/** The packs' draws. */
export const TECH_LAYER = 0x1005;
export const TECH_LAYER_BUCKET = 1;
export const TECH_ICON_ORIGIN = 0x140;
export const TECH_CHROME_ORIGIN = 0x200;
/** The chrome cels and their anchors. */
export const TECH_CEL_ARROW_LEFT = 0x1f;
export const TECH_CEL_ARROW_RIGHT = 0x20;
export const TECH_CEL_LIST_WINDOW = 0x2a;
export const TECH_CEL_MP_PLATE = 0x29;
export const TECH_CEL_DESCRIPTION = 0x31;
/** Text banks (the call sites pass the offsets literally). */
export const TECH_BANK_UI = 0x7f;
export const TECH_BANK_DESCRIPTION = 0x9b;
export const TECH_BANK_NAME = 0xa2;
export const TECH_WORD_MP_SHORT_TITLE = 0x54;
export const TECH_WORD_EMPTY = 0x13;
export const TECH_WORD_MP = 0x0d;
export const TECH_WORD_HINT_LEFT = 0x11;
export const TECH_WORD_HINT_RIGHT = 0x12;
export const TECH_WORD_SLASH = 0x10;
/** The row palettes: short of MP, pre-selected, moved-to-the-back, normal. */
export const TECH_PALETTE_SHORT = 7;
export const TECH_PALETTE_PRESELECTED = 3;
export const TECH_PALETTE_BACK = 4;
export const TECH_PALETTE_NORMAL = 0;
/** The pad bits: L1, R1, up, down, Circle, Cross. */
export const TECH_PAD_LEFT = 0x400;
export const TECH_PAD_RIGHT = 0x800;
export const TECH_PAD_UP = 0x10;
export const TECH_PAD_DOWN = 0x40;
export const TECH_PAD_CONFIRM = 0x2000;
export const TECH_PAD_CANCEL = 0x4000;
/** The three packed sounds. The move and page blips carry the 0x4 high half. */
export const TECH_MOVE_SOUND = 0x4001b;
export const TECH_CONFIRM_SOUND = 0x4001c;
/** The cancel blip: the call site passes 0x50BD and the packed-sound entry
 *  F0x8002006C widens it to the id the sound service consumes. */
export const TECH_CANCEL_SOUND = 0x800450bd;
/** Cancel writes -2 into the caller's word (the caller tests -1 for "still open"). */
export const TECH_RESULT_CANCEL = -2;

export interface TechListMemory {
    read8(addr: number): number;
    read16(addr: number): number;
    read16s(addr: number): number;
    read32(addr: number): number;
    write8?(addr: number, value: number): void;
    write16(addr: number, value: number): void;
    write32(addr: number, value: number): void;
}

export interface TechListHost {
    /** F0x80014504(0x800967A0, 0xD8, 0x40): allocate the screen object. */
    allocateActor(): number;
    /**
     * F0x8009B0C8(config): build the list model from the config block. The TECH
     * list uses the shared factory, so the port is commandMenuCreate.
     */
    createModel(config: number): number;
    /** [0x8005B44C](index): the member whose technique block the screen reads. */
    activeMember(): number;
    /**
     * [0x8005B46C](member, self + 0x58): write one halfword per page of technique
     * words at the page table and return the page count.
     */
    techListBegin(member: number, headerBase: number): number;
    /**
     * [0x8005B47C](member, header, self + 0x60 + 0x14*page): write the page's
     * status halfword at `dest` and its six technique words at `dest + 8`.
     */
    techListPage(member: number, header: number, dest: number): void;
    /** [0x8005CCA0](partyWord, 9): the pre-selected record; +0x28 is the id compared. */
    preselectRecord(partyWord: number): number | null;
    /** [0x800A466C](0, entry): the MP price of a list entry. */
    techCost(entry: number): number;
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

function s16(value: number): number {
    return (value << 16) >> 16;
}

/** F0x80096E88(out): build the screen object and mark the answer "not yet". */
export function techListActorConstruct(mem: TechListMemory, out: number, host: TechListHost): number {
    const obj = host.allocateActor();
    mem.write32(obj + TECH_LIST_OUT, out);
    mem.write32(out, 0xffffffff);
    return obj;
}

/**
 * F0x800967A0(self, slot): the screen's own tick. State 0 builds the list and
 * hands the model to F0x80096048/F0x80096314; state 1 draws the list and reads
 * the pad; every other state returns.
 */
export function techListTick(
    mem: TechListMemory,
    self: number,
    slot: number,
    host: TechListHost,
): void {
    const state = mem.read32(self + 0x0c) | 0;
    if (state === 1) {
        techListInput(mem, self, slot, host);
        return;
    }
    if (state < 2) {
        techListBuild(mem, self, slot, host);
        return;
    }
}

/**
 * F0x800967A0 state 0 (fightstg.s:20345-20620): read the acting member's
 * technique words a page at a time, append every non-zero one to the list at
 * +0x9C with its flags intact, mark or append the current form's signature
 * with bit 15 while the party carries the +0x1A flag, compute the page count,
 * write the row count into the config block, build the model, build and fill
 * the widgets and call the screen's per-frame method.
 */
export function techListBuild(
    mem: TechListMemory,
    self: number,
    slot: number,
    host: TechListHost,
): void {
    const index = mem.read32(TECH_PARTY_INDEX) | 0;
    const member = host.activeMember() | 0;
    const party = (TECH_PARTY_BASE + Math.imul(index, TECH_PARTY_STRIDE)) >>> 0;
    const techCount = mem.read16s(party + TECH_PARTY_TECH_COUNT) | 0;
    const block = (TECH_MEMBER_BLOCK + Math.imul(member, TECH_MEMBER_STRIDE)) >>> 0;

    // The single-technique case: when the member's technique count is the first
    // word of its block, the list is one pre-selected entry read from +0x28.
    if (techCount === (mem.read16(block) | 0)) {
        mem.write32(self + TECH_LIST_COUNT, 1);
        mem.write32(self + TECH_LIST_ENTRIES, (mem.read16(block + 0x28) | 0) | TECH_FLAG_PRESELECTED);
        techListFinishBuild(mem, self, slot, host);
        return;
    }

    const pages = host.techListBegin(member, (self + TECH_LIST_PAGE_HEADER) >>> 0) | 0;
    mem.write32(self + TECH_LIST_COUNT, 0);
    if (pages > 0) {
        for (let page = 0; page < pages; page++) {
            const header = mem.read16s(self + TECH_LIST_PAGE_HEADER + page * 2) | 0;
            const dest = (self + TECH_LIST_PAGE_FILL + page * TECH_LIST_PAGE_STRIDE) >>> 0;
            host.techListPage(member, header, dest);
            // A page whose status halfword disagrees with the member's technique
            // count is skipped whole.
            if ((mem.read16s(dest) | 0) !== techCount) continue;
            for (let i = 0; i < TECH_LIST_ROWS; i++) {
                const word = mem.read16(dest + TECH_LIST_PAGE_IDS - TECH_LIST_PAGE_FILL + i * 2) | 0;
                if ((s16(word) | 0) === 0) continue;
                // The words keep their flags: the caller's list already cleared
                // bit 14 on the current form's own slots and kept it on the
                // sibling loans (F0x800967A0 :20368-:20466), and the row palette
                // and the price rule both read it back.
                let count = mem.read32(self + TECH_LIST_COUNT) | 0;
                mem.write32(self + TECH_LIST_ENTRIES + count * TECH_LIST_ENTRY_STRIDE, s16(word) | 0);
                mem.write32(self + TECH_LIST_COUNT, count + 1);
            }
        }
    }

    // The current form's signature is marked or appended with bit 15 while the
    // party carries the +0x1A flag (Blast active): an entry whose 13-bit id
    // matches is REWRITTEN as id | 0x8000, else the signature is appended with
    // the flag (F0x800967A0 :20381-:20400, `.L0x80096878`).
    if ((mem.read8(party + TECH_PARTY_NO_CHARGE) | 0) !== 0) {
        const record = host.preselectRecord(mem.read16s(party) | 0);
        if (record !== null) {
            const signature = mem.read16(record + 0x28) | 0;
            let found = false;
            const count = mem.read32(self + TECH_LIST_COUNT) | 0;
            for (let i = 0; i < count; i++) {
                const at = (self + TECH_LIST_ENTRIES + i * TECH_LIST_ENTRY_STRIDE) >>> 0;
                const entry = mem.read32(at) | 0;
                if ((entry & TECH_ID_MASK) === signature) {
                    mem.write32(at, ((entry & TECH_ID_MASK) | TECH_FLAG_PRESELECTED) | 0);
                    found = true;
                    break;
                }
            }
            if (!found) appendEntry(mem, self, (signature & TECH_ID_MASK) | TECH_FLAG_PRESELECTED);
        }
    }

    techListFinishBuild(mem, self, slot, host);
}

/**
 * fightstg.s:20496-20499 and 20526-20532: append one entry and count it.
 * (The sibling merge that used to live here as `moveFlaggedToBack` — collect
 * bit-14 page words, append the missing ones — is the SAME list step the caller's
 * seed already performs: the original's merge appends the sibling loans once,
 * inside the build, and the port was re-appending a list that already contained
 * them, so the pass was always a no-op. The words now arrive flagged.)
 */
function appendEntry(mem: TechListMemory, self: number, entry: number): void {
    const count = mem.read32(self + TECH_LIST_COUNT) | 0;
    mem.write32(self + TECH_LIST_ENTRIES + count * TECH_LIST_ENTRY_STRIDE, entry | 0);
    mem.write32(self + TECH_LIST_COUNT, count + 1);
}

/**
 * fightstg.s:20563-20620: pages = ceil(count / 6); the config block's row count
 * is max(1, min(count, 6)); the model is built, its widgets are created and
 * filled, and the screen's per-frame method (+0x38) is called.
 */
function techListFinishBuild(
    mem: TechListMemory,
    self: number,
    slot: number,
    host: TechListHost,
): void {
    const count = mem.read32(self + TECH_LIST_COUNT) | 0;
    if (count !== 0) {
        const quotient = Math.floor(count / 6);
        mem.write32(self + TECH_LIST_PAGES, count === quotient * 6 ? quotient : quotient + 1);
        mem.write32(TECH_LIST_CONFIG, count < 7 ? count : 6);
    } else {
        mem.write32(TECH_LIST_CONFIG, 1);
    }
    // `sw $v0, ($s7)` in the delay slot of the F0x80096048 call: the argument is
    // the child-slot cell itself, and it receives the model.
    const model = host.createModel(TECH_LIST_CONFIG);
    mem.write32(slot, model);
    techListCreateWidgets(mem, self, slot, host);
    techListUpdateRows(mem, self, slot, host);
    host.callMethod(self, 0x38, []);
}

/**
 * F0x80096048(self, slot) (fightstg.s:19855-20158): the fourteen text widgets.
 * The order of the calls and every anchor is the original's; the widget handle
 * written for the (20,194) description bar is discarded by the original and is
 * discarded here.
 */
export function techListCreateWidgets(
    mem: TechListMemory,
    self: number,
    slot: number,
    host: TechListHost,
): void {
    void self;
    const index = mem.read32(TECH_PARTY_INDEX) | 0;
    const party = (TECH_PARTY_BASE + Math.imul(index, TECH_PARTY_STRIDE)) >>> 0;
    const res = host.resourceBase((mem.read32(TECH_STRING_BASE) | 0) + TECH_BANK_UI);

    let widget = host.createTextElement(0x1005, 3, 26, 159);
    mem.write32(slot + 0x04, widget);
    host.callMethod(widget, 0x114, [res, TECH_WORD_HINT_LEFT]);
    host.callMethod(widget, 0x138, [2]);

    widget = host.createTextElement(0x1005, 3, 128, 159);
    mem.write32(slot + 0x08, widget);
    host.callMethod(widget, 0x114, [res, TECH_WORD_HINT_RIGHT]);
    host.callMethod(widget, 0x138, [2]);

    widget = host.createTextElement(0x1005, 3, 172, 58);
    mem.write32(slot + 0x0c, widget);
    host.callMethod(widget, 0x114, [res, TECH_WORD_MP]);

    widget = host.createTextElement(0x1005, 3, 216, 58);
    mem.write32(slot + 0x18, widget);
    if ((mem.read8(party + TECH_PARTY_NO_CHARGE) | 0) !== 0) {
        const mp = mem.read16s(party + TECH_PARTY_MP) | 0;
        const word = mp < 0x64 ? 0x1a : (mp < 0x3e8 ? 0x0f : 0x24);
        host.callMethod(widget, 0x114, [res, word]);
    } else {
        host.callMethod(widget, 0x118, [0, mem.read16s(party + TECH_PARTY_MP) | 0]);
    }
    host.callMethod(widget, 0x148, [1]);

    widget = host.createTextElement(0x1005, 3, 217, 58);
    mem.write32(slot + 0x14, widget);
    host.callMethod(widget, 0x114, [res, TECH_WORD_SLASH]);

    widget = host.createTextElement(0x1005, 3, 251, 58);
    mem.write32(slot + 0x10, widget);
    host.callMethod(widget, 0x118, [0, mem.read16s(party + TECH_PARTY_MAX_MP) | 0]);
    host.callMethod(widget, 0x148, [1]);

    for (let i = 0; i < TECH_LIST_ROWS; i++) {
        const row = host.createTextElement(0x1005, 1, 42, 69 + 14 * i);
        mem.write32(slot + 0x1c + i * 4, row);
    }

    // Each store is the delay slot of the *next* create, so the three handles
    // land one slot earlier than their own call: (20,194) is the description
    // title, (256,208) carries the "MP" label and (299,208) the cost number.
    widget = host.createTextElement(0x1005, 1, 20, 194);
    mem.write32(slot + 0x34, widget);
    widget = host.createTextElement(0x1005, 1, 256, 208);
    mem.write32(slot + 0x38, widget);
    widget = host.createTextElement(0x1005, 1, 299, 208);
    mem.write32(slot + 0x3c, widget);
}

/**
 * F0x80096314(self, slot) (fightstg.s:20037-20330): the six row names (bank
 * 0xA2, the entry's 13-bit id), the row palette, and the description block.
 * A row past the entry count is hidden with widget +0x144(0).
 */
export function techListUpdateRows(
    mem: TechListMemory,
    self: number,
    slot: number,
    host: TechListHost,
): void {
    const index = mem.read32(TECH_PARTY_INDEX) | 0;
    const party = (TECH_PARTY_BASE + Math.imul(index, TECH_PARTY_STRIDE)) >>> 0;
    const count = mem.read32(self + TECH_LIST_COUNT) | 0;
    const page = mem.read32(self + TECH_LIST_PAGE) | 0;
    if (count === 0) {
        const res = host.resourceBase((mem.read32(TECH_STRING_BASE) | 0) + TECH_BANK_UI);
        host.callMethod(mem.read32(slot + 0x34) >>> 0, 0x114, [res, TECH_WORD_EMPTY]);
        return;
    }
    for (let row = 0; row < TECH_LIST_ROWS; row++) {
        const widget = mem.read32(slot + 0x1c + row * 4) >>> 0;
        const at = page * TECH_LIST_ROWS + row;
        if (at > count - 1) {
            host.callMethod(widget, 0x144, [0]);
            continue;
        }
        const entry = mem.read32(self + TECH_LIST_ENTRIES + at * TECH_LIST_ENTRY_STRIDE) | 0;
        const res = host.resourceBase((mem.read32(TECH_STRING_BASE) | 0) + TECH_BANK_NAME);
        host.callMethod(widget, 0x114, [res, entry & TECH_ID_MASK]);
        const cost = host.techCost(entry) | 0;
        host.callMethod(widget, 0x138, [techRowPalette(mem, party, entry, cost)]);
    }

    // The description block reads the entry under the cursor, not the whole row.
    const menu = mem.read32(slot) >>> 0;
    const cursor = mem.read32(menu + 0x50) | 0;
    const at = page * TECH_LIST_ROWS + cursor;
    const entry = mem.read32(self + TECH_LIST_ENTRIES + at * TECH_LIST_ENTRY_STRIDE) | 0;
    const cost = host.techCost(entry) | 0;
    const shortOfMp = (mem.read8(party + TECH_PARTY_NO_CHARGE) | 0) === 0 &&
        ((mem.read16s(party + TECH_PARTY_MP) | 0) < cost);
    const title = mem.read32(slot + 0x34) >>> 0;
    const costText = mem.read32(slot + 0x38) >>> 0;
    const costNumber = mem.read32(slot + 0x3c) >>> 0;
    if (shortOfMp) {
        // Two separate lookups in the original: one for the title word, one for
        // the "MP" label.
        host.callMethod(title, 0x114,
            [host.resourceBase((mem.read32(TECH_STRING_BASE) | 0) + TECH_BANK_UI), TECH_WORD_MP_SHORT_TITLE]);
        host.callMethod(costText, 0x114,
            [host.resourceBase((mem.read32(TECH_STRING_BASE) | 0) + TECH_BANK_UI), TECH_WORD_MP]);
        host.callMethod(costText, 0x138, [TECH_PALETTE_SHORT]);
    } else {
        host.callMethod(title, 0x114, [host.resourceBase((mem.read32(TECH_STRING_BASE) | 0) + TECH_BANK_DESCRIPTION), entry & TECH_ID_MASK]);
        host.callMethod(costText, 0x114, [host.resourceBase((mem.read32(TECH_STRING_BASE) | 0) + TECH_BANK_UI), TECH_WORD_MP]);
    }
    host.callMethod(costNumber, 0x118, [0, cost]);
    host.callMethod(costNumber, 0x148, [1]);
    if (shortOfMp) {
        host.callMethod(costNumber, 0x138, [TECH_PALETTE_SHORT]);
    } else if ((entry & TECH_FLAG_BACK) !== 0) {
        host.callMethod(costText, 0x138, [TECH_PALETTE_BACK]);
        host.callMethod(costNumber, 0x138, [TECH_PALETTE_BACK]);
    } else {
        host.callMethod(costText, 0x138, [TECH_PALETTE_NORMAL]);
        host.callMethod(costNumber, 0x138, [TECH_PALETTE_NORMAL]);
    }
}

/** fightstg.s:20103-20150: short of MP, then pre-selected, then moved-to-the-back. */
function techRowPalette(mem: TechListMemory, party: number, entry: number, cost: number): number {
    if ((mem.read8(party + TECH_PARTY_NO_CHARGE) | 0) === 0 &&
        ((mem.read16s(party + TECH_PARTY_MP) | 0) < cost)) {
        return TECH_PALETTE_SHORT;
    }
    if ((entry & TECH_FLAG_PRESELECTED) !== 0) return TECH_PALETTE_PRESELECTED;
    if ((entry & TECH_FLAG_BACK) !== 0) return TECH_PALETTE_BACK;
    return TECH_PALETTE_NORMAL;
}

/**
 * F0x80095E40(self) (fightstg.s:19722-19852): six CMFONT cel 0x37 icons at
 * x = 29, y = 69 + 14*row for every row on the page whose entry exists and is
 * not id 0; then PGFGTC00 0x2A at (8,62), 0x29 at (163,33), 0x31 at (11,188),
 * and the page arrows 0x1F at (16,159) / 0x20 at (144,159) while the display
 * counter's bit 4 is set and the page is not the first/last one.
 */
export function techListDraw(mem: TechListMemory, self: number, host: TechListHost): void {
    host.initDrawContext();
    host.setLayer(TECH_LAYER, TECH_LAYER_BUCKET);
    host.setOrigin(TECH_ICON_ORIGIN, 0);
    const icons = host.packResolve(TECH_ICON_PACK);
    const page = mem.read32(self + TECH_LIST_PAGE) | 0;
    const count = mem.read32(self + TECH_LIST_COUNT) | 0;
    let y = 0x45;
    for (let row = 0; row < TECH_LIST_ROWS; row++) {
        const at = page * TECH_LIST_ROWS + row;
        if (at < count) {
            const id = mem.read32(self + TECH_LIST_ENTRIES + at * TECH_LIST_ENTRY_STRIDE) & TECH_ID_MASK;
            if (id !== 0) {
                const cel = mem.read8(TECH_ICON_TABLE + (id - 1) * TECH_ICON_TABLE_STRIDE + TECH_ICON_TABLE_FIELD);
                host.drawSprite(icons, cel + TECH_ICON_CEL_BASE, TECH_ICON_X, y);
            }
        }
        y += 0x0e;
    }
    host.setOrigin(TECH_CHROME_ORIGIN, 0);
    const chrome = host.packResolve(TECH_CHROME_PACK);
    if (((host.frameCounter() | 0) & TECH_ARROW_GATE) !== 0) {
        if (page > 0) host.drawSprite(chrome, TECH_CEL_ARROW_LEFT, 16, 159);
        if (page < (mem.read32(self + TECH_LIST_PAGES) | 0) - 1) {
            host.drawSprite(chrome, TECH_CEL_ARROW_RIGHT, 144, 159);
        }
    }
    host.drawSprite(chrome, TECH_CEL_LIST_WINDOW, 8, 62);
    host.drawSprite(chrome, TECH_CEL_MP_PLATE, 163, 33);
    host.drawSprite(chrome, TECH_CEL_DESCRIPTION, 11, 188);
}

/**
 * F0x800967A0 state 1 (fightstg.s:20622-20758): draw, then the page keys, then
 * the cursor-change refill, then Circle (which charges MP and answers with the
 * 13-bit id) and Cross (which answers -2). L1 is not clamped in the original:
 * it stores page - 1 unconditionally, so it walks to page -1 off the first page.
 */
export function techListInput(
    mem: TechListMemory,
    self: number,
    slot: number,
    host: TechListHost,
): void {
    techListDraw(mem, self, host);
    const pad = host.padRead(0) | 0;
    const pages = mem.read32(self + TECH_LIST_PAGES) | 0;
    const page = mem.read32(self + TECH_LIST_PAGE) | 0;
    if (pages !== 0) {
        if ((pad & TECH_PAD_LEFT) !== 0) {
            // fightstg.s:20658-20668: page - 1 is stored, then the branch's
            // delay slot stores 0 when it went negative, so L1 clamps at the
            // front page.
            const previous = page - 1;
            mem.write32(self + TECH_LIST_PAGE, previous);
            if (previous < 0) mem.write32(self + TECH_LIST_PAGE, 0);
        } else if ((pad & TECH_PAD_RIGHT) !== 0) {
            const next = page + 1;
            mem.write32(self + TECH_LIST_PAGE, next);
            if (pages - 1 < next) mem.write32(self + TECH_LIST_PAGE, pages - 1);
        }
    }
    if (mem.read32(self + TECH_LIST_PAGE) !== page) {
        const menu = mem.read32(slot) >>> 0;
        mem.write32(menu + 0x50, 0);
        const shown = mem.read32(self + TECH_LIST_COUNT) - 6 * mem.read32(self + TECH_LIST_PAGE);
        mem.write32(menu + 0x58, shown < 7 ? shown : 6);
        techListUpdateRows(mem, self, slot, host);
        host.playSound(TECH_MOVE_SOUND);
        techListStoreCursor(mem, self, slot);
        return;
    }
    const menu = mem.read32(slot) >>> 0;
    if (mem.read32(self + TECH_LIST_LAST_CURSOR) !== (mem.read32(menu + 0x50) | 0)) {
        techListUpdateRows(mem, self, slot, host);
        techListStoreCursor(mem, self, slot);
        return;
    }
    if ((pad & TECH_PAD_CONFIRM) !== 0) {
        host.playSound(TECH_CONFIRM_SOUND);
        if (mem.read32(self + TECH_LIST_COUNT) !== 0) {
            const index = mem.read32(TECH_PARTY_INDEX) | 0;
            const party = (TECH_PARTY_BASE + Math.imul(index, TECH_PARTY_STRIDE)) >>> 0;
            if ((mem.read8(party + TECH_PARTY_NO_CHARGE) | 0) === 0) {
                const at = mem.read32(self + TECH_LIST_PAGE) * TECH_LIST_ROWS + (mem.read32(menu + 0x50) | 0);
                const entry = mem.read32(self + TECH_LIST_ENTRIES + at * TECH_LIST_ENTRY_STRIDE) | 0;
                const cost = host.techCost(entry) | 0;
                const mp = mem.read16s(party + TECH_PARTY_MP) | 0;
                if (mp < cost) {
                    techListStoreCursor(mem, self, slot);
                    return;
                }
                mem.write16(party + TECH_PARTY_MP, (mem.read16(party + TECH_PARTY_MP) - cost) & 0xffff);
            }
            const at = mem.read32(self + TECH_LIST_PAGE) * TECH_LIST_ROWS + (mem.read32(menu + 0x50) | 0);
            const entry = mem.read32(self + TECH_LIST_ENTRIES + at * TECH_LIST_ENTRY_STRIDE) | 0;
            mem.write32(mem.read32(self + TECH_LIST_OUT) >>> 0, entry & TECH_ID_MASK);
            host.callMethod(self, 0x28, [3]);
            mem.write32(menu + 0x54, 1);
            return;
        }
        techListStoreCursor(mem, self, slot);
        return;
    }
    if ((pad & TECH_PAD_CANCEL) !== 0) {
        host.playSound(TECH_CANCEL_SOUND);
        mem.write32(mem.read32(self + TECH_LIST_OUT) >>> 0, TECH_RESULT_CANCEL);
        host.callMethod(self, 0x28, [3]);
        return;
    }
    techListStoreCursor(mem, self, slot);
}

/** fightstg.s:20644-20654 and 20739-20753: the screen remembers the cursor. */
function techListStoreCursor(mem: TechListMemory, self: number, slot: number): void {
    const menu = mem.read32(slot) >>> 0;
    mem.write32(self + TECH_LIST_LAST_CURSOR, mem.read32(menu + 0x50) | 0);
}
