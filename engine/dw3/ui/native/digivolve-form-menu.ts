// The in-battle Digivolve form list (pro/fightstg): the name list a player picks
// a form from, and its paged stat panel, translated from the original bodies.
//
// Lane B. Every routine below is one original address; the resident services the
// bodies call (the object factory, the picture context, the text-element
// constructor, the resource bank, the pad, the sound, the frame counter, the
// object methods, the three resident profile/technique helpers and the species
// record lookup) are host boundaries. The list model object (F0x8009B0C8) and
// its state machine (F0x8009AF4C) plus the vsync marker blit (F0x8009ABD8) are
// the already translated ports in ./fight-command-menu.ts: this list is built from
// the same factory with a different config block.
//
//   F0x8009482c formListActorConstruct  build the 0x74 screen object.
//   F0x80094478 formListTick            state 0 builds the rows, state 1 reads
//                                        the pad (paging, confirm, cancel).
//   F0x80094298 formListUpdateRows      the four row names and their palettes.
//   F0x800953E4 formPanelConstruct      build the 0xEC panel for one row/page.
//   F0x80094F08 formPanelTick           the panel's own state machine.
//   F0x8009492C formPanelCaptions       page zero's two column captions.
//   F0x80094AD0 formPanelPageZero       page zero's thirteen numbers.
//   F0x80094878 formPanelDrawArrows     the panel's page-arrow cels.
//   F0x80094A00 formPanelDrawPageZero   page zero's two chrome cels.
//
// Geometry, all read from fightstg.s: the row name widgets sit at x = 0xBB = 187,
// y = 0x92 + 0x13*i = 146 + 19*i (kind 1), the config block 0x800A34EC puts the
// per-row highlight cel 0x24 at (167, 146) with pitch 19 and the selection bar at
// (168, 147) with pitch 19, page zero's captions are bank 0x7F words 0x11 and 0x12
// at (34,171) and (56,171) in palette 2, and its thirteen numbers are the thirteen
// (x, y, slot) triples of the table at 0x800A350C.

import { PROFILE_TABLE_BASE, rosterSlotProfileAddress } from "./pause-status.ts";
/** The screen object handler and the factory arguments of F0x8009482C. */
export const FORM_LIST_HANDLER = 0x80094478;
export const FORM_LIST_SIZE = 0x74;
export const FORM_LIST_EXTRA = 0x1c;
/** The config block the screen overwrites and F0x8009B0C8 reads. */
export const FORM_LIST_CONFIG = 0x800a34ec;
/** The panel: F0x800953E4(tick = 0x80094F08, 0xEC, 0x60). */
export const FORM_PANEL_HANDLER = 0x80094f08;
export const FORM_PANEL_SIZE = 0xec;
export const FORM_PANEL_EXTRA = 0x60;
/** self+0x50 out word, +0x54 the acting profile, +0x58 the page, +0x5C last cursor. */
export const FORM_LIST_OUT = 0x50;
export const FORM_LIST_PROFILE = 0x54;
export const FORM_LIST_PAGE = 0x58;
export const FORM_LIST_LAST_CURSOR = 0x5c;
/** +0x60 the current form, +0x62..0x68 up to three acquired forms, +0x68 the count. */
export const FORM_LIST_CURRENT = 0x60;
export const FORM_LIST_ROWS = 0x62;
export const FORM_LIST_ROW_STRIDE = 2;
export const FORM_LIST_COUNT = 0x68;
export const FORM_LIST_ROWS_MAX = 4;
/** The panel's own three words: the owner slot, the page and the cursor row. */
export const FORM_PANEL_SLOT = 0x54;
export const FORM_PANEL_PAGE = 0x58;
export const FORM_PANEL_CURSOR = 0x5c;
/** Panel page zero: the six sums at +0x70, the seven at +0x7C, the flags at +0x8A. */
export const FORM_PANEL_SUM_LEFT = 0x70;
export const FORM_PANEL_SUM_RIGHT = 0x7c;
export const FORM_PANEL_SUM_COUNT = 6;
export const FORM_PANEL_SUM_COUNT_RIGHT = 7;
export const FORM_PANEL_FLAG_LEFT = 0x8a;
/** Each page-zero flag halfword and the number widget slot it greys. */
export const FORM_PANEL_FLAGS: readonly (readonly [number, number])[] =
    [[0x8a, 0x14], [0x8c, 0x18], [0x8e, 0x24]];
/** Panel page zero's number table: thirteen (x, y, slot) triples, and its clamp. */
export const FORM_PANEL_PAGE0_TABLE = 0x800a350c;
export const FORM_PANEL_PAGE0_ROWS = 13;
export const FORM_PANEL_NUMBER_MAX = 0x3e7;
/**
 * Pages one and two: the equipped triple at +0x90, one 0x14-byte technique
 * block per equipped member from +0x98, the six row words at +0xD4 and the
 * headline number at +0x60.
 */
export const FORM_PANEL_EQUIPPED = 0x90;
export const FORM_PANEL_TECH_BLOCK = 0x98;
export const FORM_PANEL_TECH_STRIDE = 0x14;
export const FORM_PANEL_HEADLINE = 0x60;
export const FORM_PANEL_ROW_WORDS = 0xd4;
/** F0x80094D50 builds six name widgets and F0x80094C18 six icon cels. */
export const FORM_TECH_ROWS = 6;
/** The page-two scratch table holds ten candidates (.L0x80095294 compares sp+0x38). */
export const FORM_PANEL_SCRATCH = 10;
/** The entry word's two flag bits and its id field. */
export const FORM_TECH_LOADABLE = 0x4000;
export const FORM_TECH_SIGNATURE = 0x8000;
export const FORM_TECH_ID_MASK = 0x1fff;
/** The per-profile block the screen reads (0x8003EF5C + 0x58*profile). */
export const FORM_PROFILE_BLOCK = PROFILE_TABLE_BASE;
export const FORM_PROFILE_STRIDE = 0x58;
export const FORM_PROFILE_SPECIES = 0x00;
/** The live combatant records: the acting slot at +0x08, three 0x20-byte records. */
export const FORM_PARTY_BASE = 0x800a4470;
export const FORM_PARTY_INDEX = 0x800a4468;
export const FORM_PARTY_STRIDE = 0x20;
export const FORM_PARTY_SPECIES = 0x00;
export const FORM_PARTY_SPECIES_RESERVED = 0x02;
export const FORM_PARTY_HAS_RESERVED = 0x1a;
/** The resident species-record lookup's table base and the name byte it carries. */
export const FORM_STRING_BASE = 0x8005cca8;
export const FORM_BANK_NAME = 0x4e;
export const FORM_BANK_UI = 0x7f;
export const FORM_SPECIES_NAME_BYTE = 0x55;
/** The row name widgets. */
export const FORM_ROW_X = 0xbb;
export const FORM_ROW_Y = 0x92;
export const FORM_ROW_PITCH = 0x13;
export const FORM_ROW_KIND = 1;
/** Panel page zero's captions. */
export const FORM_CAPTION_LEFT = 0x22;
export const FORM_CAPTION_RIGHT = 0x38;
export const FORM_CAPTION_Y = 0xab;
export const FORM_WORD_LEFT = 0x11;
export const FORM_WORD_RIGHT = 0x12;
export const FORM_PALETTE_CAPTION = 2;
export const FORM_PALETTE_NUMBER = 6;
/** The row palettes: grey for the form the Digimon is already in. */
export const FORM_PALETTE_CURRENT = 7;
export const FORM_PALETTE_NORMAL = 0;
/** The pad bits: L1, R1, Circle, Cross. */
export const FORM_PAD_PAGE_NEXT = 0x800;
export const FORM_PAD_PAGE_PREV = 0x400;
export const FORM_PAD_CONFIRM = 0x2000;
export const FORM_PAD_CANCEL = 0x4000;
/** The three packed sounds. The move and page blips carry the 0x4 high half. */
export const FORM_PAGE_SOUND = 0x4001b;
export const FORM_CONFIRM_SOUND = 0x4001c;
/** The cancel blip: the call site builds lui 0x8004 / ori 0x50BD, so the packed
 *  entry F0x8002006C widens it to the id the sound service consumes. */
export const FORM_CANCEL_SOUND = 0x800450bd;
/** Cancel writes -2 into the caller's word (the caller tests -1 for "still open"). */
export const FORM_RESULT_CANCEL = -2;
/** The three pages L1 and R1 wrap over. */
export const FORM_PAGES = 3;
/** The page-zero draw: the two PGFGTC00 / CMFONT cels. */
export const FORM_CEL_PANEL_ZERO = 0x23;
export const FORM_CEL_PANEL_CORNER = 0x25;
export const FORM_CEL_ARROW_LEFT = 0x1f;
export const FORM_CEL_ARROW_RIGHT = 0x20;
export const FORM_CHROME_PACK = 0x04550000;
export const FORM_CMFONT_PACK = 0x02860000;
export const FORM_LAYER = 0x1005;
export const FORM_LAYER_BUCKET = 1;
export const FORM_CHROME_ORIGIN = 0x200;
export const FORM_ICON_ORIGIN = 0x140;
export const FORM_FRAME_GATE = 0x10;
/** The exe's technique icon table the pages 1-2 draw reads: 18 bytes per entry,
 *  the cel selector at +4, drawn as that byte + 0x37 (F0x80094CC8). */
export const FORM_ICON_TABLE = 0x80042bdc;
/** The child slots: the list model, the row widgets (1..4), the panel. */
export const FORM_SLOT_MODEL = 0x00;
export const FORM_SLOT_ROW = 0x04;
export const FORM_SLOT_PANEL = 0x18;

export interface FormListMemory {
    read8(addr: number): number;
    read8s(addr: number): number;
    read16(addr: number): number;
    read16s(addr: number): number;
    read32(addr: number): number;
    write16(addr: number, value: number): void;
    write32(addr: number, value: number): void;
}

export interface FormListHost {
    /** F0x80014504(0x80094478, 0x74, 0x1C): allocate the name list object. */
    allocateActor(): number;
    /** F0x8009B0C8(config): build the list model from the config block. */
    createModel(config: number): number;
    /** F0x80014504(0x80094F08, 0xEC, 0x60): allocate the panel object. */
    allocatePanel(): number;
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
    /** [0x8004DE10+0x18C](): the frame delta the shared list model's highlight uses. */
    frameDelta(): number;
    /** ctx+0x8C(x, y): set the CLUT row offset. */
    setPaletteRow(n: number): void;
    /** F0x8001F648(): build the stack draw context. */
    initDrawContext(): void;
    /** ctx+0x8C(x, y): set the draw layer. */
    setLayer(x: number, y: number): void;
    /** ctx+0x84(x, y): set the draw origin. */
    setOrigin(x: number, y: number): void;
    /** ctx+0x94(pack, id, x, y): draw a sprite. */
    drawSprite(pack: number, id: number, x: number, y: number): void;
    /**
     * [0x8004B46C] = F0x800176AC (slot, dest): the three species ids the slot's
     * equipped forms resolve to, -1 (0xFFFF) in a tail slot. Answers the kept
     * count, which page two's gather loops over.
     */
    profileForms(profile: number, dest: number): number;
    /** [0x8004B44C](slot): the profile the party slot holds. */
    memberProfile(slot: number): number;
    /** [0x8005CCA0](species): the species record, or 0 when the id is unknown. */
    speciesRecord(species: number): number;
    /** [0x8004B468](profile, dest): the profile's page-zero stat block. */
    panelBlock(profile: number, dest: number): void;
    /**
     * [0x8004B47C] = F0x80017A1C (slot, species, dest): copy that species'
     * 0x14-byte technique block into `dest` and answer its block index, or -1
     * with `dest` untouched. `dest` is panel+0x98 + 0x14*member, so the block's
     * halfword at +0x02 is the headline number at panel+0x60 and its six
     * technique words at +0x08.. are what the panel's rows read.
     */
    profileTechs(profile: number, species: number, dest: number): number;
    /** target+slot(a1, a2): an object method. */
    callMethod(target: number, slot: number, args: number[]): void;
}

/** F0x8009482C(out): build the screen object and mark the answer "not yet". */
export function formListActorConstruct(mem: FormListMemory, out: number, host: FormListHost): number {
    const obj = host.allocateActor();
    mem.write32(obj + FORM_LIST_OUT, out);
    mem.write32(obj + FORM_LIST_PROFILE, mem.read32(out));
    mem.write32(out, 0xffffffff);
    return obj;
}

/**
 * F0x80094478(self, slot): the screen's own tick. State 0 builds the rows and
 * hands the model to F0x8009B0C8 and F0x80094298; state 1 reads the pad; every
 * other state returns.
 */
export function formListTick(
    mem: FormListMemory,
    self: number,
    slot: number,
    host: FormListHost,
): void {
    const state = mem.read32(self + 0x0c) | 0;
    if (state === 1) {
        formListInput(mem, self, slot, host);
        return;
    }
    if (state < 2) formListBuild(mem, self, slot, host);
}

/**
 * F0x80094478 state 0 (fightstg.s:18046-18110): read the acting profile's current
 * species into +0x60, copy up to three choices from the profile block at +0x6C,
 * counting only the slots whose value is 3 or more, write the row count into the
 * config block, build the model, spawn the panel, fill the row widgets and advance
 * the screen to state 1.
 */
export function formListBuild(
    mem: FormListMemory,
    self: number,
    slot: number,
    host: FormListHost,
): void {
    const profile = mem.read32(self + FORM_LIST_PROFILE) | 0;
    host.profileForms(profile, self + 0x6c);
    // .L0x80094504: lhu at the profile block's first halfword, stride 0x58.
    const block = rosterSlotProfileAddress(mem, profile);
    mem.write16(self + FORM_LIST_CURRENT, mem.read16(block + FORM_PROFILE_SPECIES));
    // .L0x80094510-0x8009453c: three slots, a value below 3 ends that slot's offer
    // and the count only advances for a kept one.
    let count = 1;
    for (let i = 0; i < 3; i++) {
        const half = mem.read16s(self + 0x6c + i * 2) | 0;
        if (half >= 3) {
            mem.write16(self + FORM_LIST_ROWS + (count - 1) * FORM_LIST_ROW_STRIDE,
                mem.read16(self + 0x6c + i * 2));
            count += 1;
        }
    }
    mem.write32(self + FORM_LIST_COUNT, count);
    mem.write32(FORM_LIST_CONFIG, count);
    const model = host.createModel(FORM_LIST_CONFIG);
    mem.write32(slot + FORM_SLOT_MODEL, model);
    const panel = host.allocatePanel();
    mem.write32(panel + FORM_PANEL_SLOT, profile);
    mem.write32(panel + FORM_PANEL_PAGE, mem.read32(self + FORM_LIST_PAGE));
    mem.write32(panel + FORM_PANEL_CURSOR, mem.read32(model + 0x50));
    mem.write32(slot + FORM_SLOT_PANEL, panel);
    // .L0x80094570: the row updater's return value lands in child slot 5.
    mem.write32(slot + 0x14, formListUpdateRows(mem, self, host));
    // .L0x80094588: the delay slot stores the register it names, which the call's
    // own `li $v0, -1` set, so +0x5C is -1 and the call only advances the state.
    mem.write32(self + FORM_LIST_LAST_CURSOR, -1);
    host.callMethod(self, 0x38, []);
}

/**
 * F0x80094298(self) (fightstg.s:17905-18025): find the party slot whose profile is
 * the acting one, then for each row create its name widget at (187, 146 + 19*i) if
 * it does not exist yet, set the name from bank 0x4E (the byte at species record
 * +0x55) and paint the row grey when it is the Digimon's current form. Returns
 * 0 once every row has been filled, which is what the caller stores in slot 5.
 */
export function formListUpdateRows(mem: FormListMemory, self: number, host: FormListHost): number {
    const profile = mem.read32(self + FORM_LIST_PROFILE) | 0;
    let found = -1;
    for (let slot = 0; slot < 3; slot++) {
        if (host.memberProfile(slot) === profile) { found = slot; break; }
    }
    if (found < 0) return -1;
    // .L0x80094318-0x8009434c: the live record's own species, or its reserved
    // second form when the record carries the 0x1A flag.
    const record = (FORM_PARTY_BASE + found * FORM_PARTY_STRIDE) >>> 0;
    const live = (mem.read8(record + FORM_PARTY_HAS_RESERVED) | 0) !== 0
        ? (mem.read16s(record + FORM_PARTY_SPECIES_RESERVED) | 0)
        : (mem.read16s(record + FORM_PARTY_SPECIES) | 0);
    const count = mem.read32(self + FORM_LIST_COUNT) | 0;
    if (count <= 0) return count;
    // .L0x800942d8: the row widgets live in the child array at self+0x24, slots
    // 1..4, four bytes apart.
    const children = mem.read32(self + 0x24) >>> 0;
    for (let row = 0; row < count; row++) {
        const cell = children + FORM_SLOT_ROW + row * 4;
        const held = mem.read32(cell) >>> 0;
        const widget = held !== 0 ? held : host.createTextElement(FORM_LAYER, FORM_ROW_KIND,
            FORM_ROW_X, FORM_ROW_Y + FORM_ROW_PITCH * row);
        if (held === 0) mem.write32(cell, widget);
        const species = mem.read16s(self + FORM_LIST_CURRENT + row * 2) | 0;
        const record = host.speciesRecord(species);
        if (record === 0) continue;
        const res = host.resourceBase((mem.read32(FORM_STRING_BASE) | 0) + FORM_BANK_NAME);
        host.callMethod(widget, 0x114, [res, mem.read8(record + FORM_SPECIES_NAME_BYTE) | 0]);
        // .L0x800943f4: the row the Digimon already is, and only that one, is grey.
        host.callMethod(widget, 0x138, [live === species ? FORM_PALETTE_CURRENT : FORM_PALETTE_NORMAL]);
    }
    // .L0x8009443c: the loop's last compare is `s1 < count`, which is false.
    return 0;
}

/**
 * F0x80094478 state 1 (fightstg.s:18111-18257): L1 and R1 page the panel (both
 * wrap over 0..2), Circle accepts the row under the cursor unless it is the form
 * the Digimon is already in, Cross answers -2. A page or cursor change rebuilds
 * the panel; anything else returns.
 */
export function formListInput(
    mem: FormListMemory,
    self: number,
    slot: number,
    host: FormListHost,
): void {
    const pad = host.padRead(0) | 0;
    let changed = 0;
    if ((pad & FORM_PAD_PAGE_NEXT) !== 0) {
        // .L0x800945f4-0x80094600: the store is the branch's delay slot, so the page
        // is written twice and 3 wraps back to 0.
        const page = mem.read32(self + FORM_LIST_PAGE) + 1;
        mem.write32(self + FORM_LIST_PAGE, page);
        if (page === 3) mem.write32(self + FORM_LIST_PAGE, 0);
        changed = 1;
        host.playSound(FORM_PAGE_SOUND);
    } else if ((pad & FORM_PAD_PAGE_PREV) !== 0) {
        const page = mem.read32(self + FORM_LIST_PAGE) - 1;
        mem.write32(self + FORM_LIST_PAGE, page);
        if (page < 0) mem.write32(self + FORM_LIST_PAGE, 2);
        changed = 1;
        host.playSound(FORM_PAGE_SOUND);
    } else if ((pad & FORM_PAD_CONFIRM) !== 0) {
        host.playSound(FORM_CONFIRM_SOUND);
        // .L0x80094678-0x800946d4: the acting Digimon's live species against the
        // row under the cursor. Equal means the grey row: nothing happens at all.
        const live = formLiveSpecies(mem);
        const model = mem.read32(slot + FORM_SLOT_MODEL) >>> 0;
        const row = mem.read16s(self + FORM_LIST_CURRENT + (mem.read32(model + 0x50) | 0) * 2) | 0;
        if (live !== row) {
            mem.write32(mem.read32(self + FORM_LIST_OUT) >>> 0, row);
            host.callMethod(self, 0x28, [3]);
            mem.write32(model + 0x54, 1);
            return;
        }
    } else if ((pad & FORM_PAD_CANCEL) !== 0) {
        mem.write32(mem.read32(self + FORM_LIST_OUT) >>> 0, FORM_RESULT_CANCEL);
        host.callMethod(self, 0x28, [3]);
        host.playSound(FORM_CANCEL_SOUND);
        return;
    }
    // .L0x80094718-0x80094738: only the cursor is compared; a page change arrives
    // here with the flag already set and stores the same cursor again.
    const model = mem.read32(slot + FORM_SLOT_MODEL) >>> 0;
    if (mem.read32(self + FORM_LIST_LAST_CURSOR) !== (mem.read32(model + 0x50) | 0)) {
        mem.write32(self + FORM_LIST_LAST_CURSOR, mem.read32(model + 0x50) | 0);
        changed = 1;
    }
    if (changed === 0) return;
    // .L0x8009474c-0x80094788: child slot 5 holds the row updater's return value,
    // which the original treats as an object pointer and closes. That value is 0
    // whenever the rows were filled, the member count when there are none and -1
    // when no party slot holds the profile: never a task, so the port does not
    // close anything there. The panel is closed and respawned either way.
    const old = mem.read32(slot + FORM_SLOT_PANEL) >>> 0;
    if (old !== 0) host.callMethod(old, 0x28, [2]);
    const panel = host.allocatePanel();
    mem.write32(panel + FORM_PANEL_SLOT, mem.read32(self + FORM_LIST_PROFILE));
    mem.write32(panel + FORM_PANEL_PAGE, mem.read32(self + FORM_LIST_PAGE));
    mem.write32(panel + FORM_PANEL_CURSOR, mem.read32(model + 0x50));
    mem.write32(slot + FORM_SLOT_PANEL, panel);
}

/** .L0x80094678-0x800946ac: the acting Digimon's live species id. */
function formLiveSpecies(mem: FormListMemory): number {
    const index = mem.read32(FORM_PARTY_INDEX) | 0;
    const record = (FORM_PARTY_BASE + Math.imul(index, FORM_PARTY_STRIDE)) >>> 0;
    return (mem.read8(record + FORM_PARTY_HAS_RESERVED) | 0) !== 0
        ? (mem.read16s(record + FORM_PARTY_SPECIES_RESERVED) | 0)
        : (mem.read16s(record + FORM_PARTY_SPECIES) | 0);
}

/** F0x800953E4(slot, page, cursor): build the panel for one row and one page. */
export function formPanelConstruct(
    mem: FormListMemory,
    slot: number,
    page: number,
    cursor: number,
    host: FormListHost,
): number {
    const panel = host.allocatePanel();
    mem.write32(panel + FORM_PANEL_SLOT, slot);
    mem.write32(panel + FORM_PANEL_PAGE, page);
    mem.write32(panel + FORM_PANEL_CURSOR, cursor);
    return panel;
}

/**
 * F0x80094F08(self, slot): the panel's own state machine. State 0 gathers the
 * page's numbers, builds the captions and the page's rows, then advances; states
 * 1 and 2 draw the page and advance; state 3 returns.
 */
export function formPanelTick(
    mem: FormListMemory,
    self: number,
    slot: number,
    host: FormListHost,
): void {
    const state = mem.read32(self + 0x0c) | 0;
    if (state === 1) {
        formPanelDraw(mem, self, host);
        return;
    }
    if (state === 2) {
        formPanelDraw(mem, self, host);
        host.callMethod(self, 0x38, []);
        return;
    }
    if (state !== 0) return;
    formPanelBuild(mem, self, slot, host);
    host.callMethod(self, 0x38, []);
}

/** F0x80094F08 state 0 (fightstg.s:18752-18988): the page's own numbers. */
function formPanelBuild(mem: FormListMemory, self: number, slot: number, host: FormListHost): void {
    const profile = mem.read32(self + FORM_PANEL_SLOT) | 0;
    const page = mem.read32(self + FORM_PANEL_PAGE) | 0;
    const cursor = mem.read32(self + FORM_PANEL_CURSOR) | 0;
    if (page === 0) formPanelPageZeroData(mem, self, host, profile, cursor);
    else if (page === 1) formPanelPageOneData(mem, self, host, profile, cursor);
    else if (page === 2) formPanelPageTwoData(mem, self, host, profile, cursor);
    formPanelCaptions(mem, self, slot, host);
    if (page === 0) formPanelPageZero(mem, self, slot, host);
    else if (page >= 1 && page < FORM_PAGES) formPanelTechRows(mem, self, slot, host);
}

/**
 * .L0x80094F9C-0x80095068: the profile's page-zero block, then — for any cursor
 * but the first — the cursor's own species and six halfwords of its record at
 * +0x02 summed into +0x70 and seven at +0x0E summed into +0x7C.
 */
function formPanelPageZeroData(
    mem: FormListMemory,
    self: number,
    host: FormListHost,
    profile: number,
    cursor: number,
): void {
    host.panelBlock(profile, self + 0x64);
    if (cursor === 0) return;
    host.profileForms(profile, self + 0x90);
    const record = host.speciesRecord(mem.read16s(self + 0x90 + (cursor - 1) * 2) | 0);
    if (record === 0) return;
    for (let i = 0; i < FORM_PANEL_SUM_COUNT; i++) {
        const at = self + FORM_PANEL_SUM_LEFT + i * 2;
        mem.write16(at, (mem.read16(record + 0x02 + i * 2) + (mem.read16(at) | 0)) & 0xffff);
    }
    for (let i = 0; i < FORM_PANEL_SUM_COUNT_RIGHT; i++) {
        const at = self + FORM_PANEL_SUM_RIGHT + i * 2;
        mem.write16(at, (mem.read16(record + 0x0e + i * 2) + (mem.read16(at) | 0)) & 0xffff);
    }
}

/**
 * .L0x8009506C-0x80095134: page one takes the cursor row's own six technique
 * words from the 0x14-byte block the gather copied to +0x98, keeps the non-zero
 * ones at +0xD4 + 4*i, and stores the block's level byte at +0x60. The first row
 * (no cursor) has no block of its own: it shows the profile's own pre-selected
 * word at +0xD4 with +0x60 set to -1, which the draw turns into the dash.
 *
 * The six reads are `lh` at +0xA0 with the base advancing by TWO (the delay slot
 * `addiu $a1, 0x2`), while the stores are words four apart (`addiu $v1, 0x4`).
 */
function formPanelPageOneData(
    mem: FormListMemory,
    self: number,
    host: FormListHost,
    profile: number,
    cursor: number,
): void {
    if (cursor === 0) {
        const block = rosterSlotProfileAddress(mem, profile);
        mem.write32(self + 0x60, -1);
        mem.write32(self + 0xd4, (mem.read16(block + 0x28) | 0) | 0x8000);
        return;
    }
    host.profileForms(profile, self + 0x90);
    host.profileTechs(profile, mem.read16s(self + 0x90 + (cursor - 1) * 2) | 0, self + 0x98);
    formPanelHeadline(mem, self, 0x98);
    for (let i = 0; i < 6; i++) {
        const word = mem.read16s(self + 0xa0 + i * 2) | 0;
        if (word !== 0) mem.write32(self + 0xd4 + i * 4, word);
    }
}

/**
 * .L0x80095138-0x800952C4: the second technique page. Every equipped member's
 * own block is copied to +0x98 + 0x14*member; the members OTHER than the cursor
 * contribute the loadable words (bit 0x4000) masked to their 13-bit id, appended
 * to a ten-entry scratch table in order. That table is then compacted into
 * +0xD4, skipping any id the panel already lists, so a technique two members
 * share is shown once. The headline is the cursor's own block level again.
 *
 * Two bounds are the original's own: the scratch table holds ten candidates and
 * the row array six, and the loop that fills it writes one word past the sixth
 * (at +0xE4) before it stops. Both are reproduced rather than tidied.
 */
function formPanelPageTwoData(
    mem: FormListMemory,
    self: number,
    host: FormListHost,
    profile: number,
    cursor: number,
): void {
    if (cursor === 0) {
        mem.write32(self + 0x60, -1);
        mem.write32(self + 0xd4, 0);
        return;
    }
    const members = host.profileForms(profile, self + 0x90);
    const candidates: number[] = [];
    let next = 0;
    for (let member = 0; member < members; member++) {
        const at = self + 0x98 + 0x14 * member;
        if (host.profileTechs(profile, mem.read16s(self + 0x90 + member * 2) | 0, at) < 0) continue;
        if (member === cursor - 1) continue;
        for (let i = 0; i < 6 && candidates.length < FORM_PANEL_SCRATCH; i++) {
            const word = mem.read16s(at + 0x08 + i * 2) | 0;
            if ((word & FORM_TECH_LOADABLE) !== 0) candidates.push(word & FORM_TECH_ID_MASK);
        }
    }
    for (const id of candidates) {
        if (id === 0) continue;
        let found = -1;
        for (let k = 0; k < FORM_TECH_ROWS; k++) {
            if ((mem.read16s(self + 0xd4 + k * 4) | 0) === id) { found = k; break; }
        }
        if (found >= 0) continue;
        // .L0x80095270: the six-entry scan leaves its cursor one past the end, so
        // the seventh candidate still lands — at +0xE4 — before the loop stops.
        mem.write32(self + 0xd4 + next * 4, id);
        next += 1;
    }
    formPanelHeadline(mem, self, 0x98 + 0x14 * (cursor - 1));
}

/**
 * The headline number at panel+0x60: the level byte at +0x02 of the technique
 * block the row was gathered from. Page one always copies the cursor's block to
 * +0x98 (`lb 0x9a($s2)`), so it reads +0x9A; page two copies every member's to
 * +0x98 + 0x14*member and reads the cursor's own (`lb 0x9a($panel + 20*(cursor-1))`).
 */
function formPanelHeadline(mem: FormListMemory, self: number, blockBase: number): void {
    mem.write32(self + 0x60, mem.read8s(self + blockBase + 0x02) | 0);
}


export function formPanelCaptions(
    mem: FormListMemory,
    self: number,
    slot: number,
    host: FormListHost,
): void {
    const res = host.resourceBase((mem.read32(FORM_STRING_BASE) | 0) + FORM_BANK_UI);
    const left = host.createTextElement(FORM_LAYER, 3, FORM_CAPTION_LEFT, FORM_CAPTION_Y);
    mem.write32(slot + 0x04, left);
    host.callMethod(left, 0x114, [res, FORM_WORD_LEFT]);
    host.callMethod(left, 0x138, [FORM_PALETTE_CAPTION]);
    const right = host.createTextElement(FORM_LAYER, 3, FORM_CAPTION_RIGHT, FORM_CAPTION_Y);
    mem.write32(slot + 0x08, right);
    host.callMethod(right, 0x114, [res, FORM_WORD_RIGHT]);
    host.callMethod(right, 0x138, [FORM_PALETTE_CAPTION]);
}

/**
 * F0x80094AD0(self, slot) (fightstg.s:18449-18531): thirteen numbers, each placed
 * at the (x, y) its table row carries and clamped to 999, then the first three are
 * greyed while their flag halfwords are set.
 */
export function formPanelPageZero(
    mem: FormListMemory,
    self: number,
    slot: number,
    host: FormListHost,
): void {
    let table = FORM_PANEL_PAGE0_TABLE;
    for (let i = 0; i < FORM_PANEL_PAGE0_ROWS; i++) {
        const x = mem.read8(table) | 0;
        const y = mem.read8(table + 1) | 0;
        const which = mem.read8(table + 2) | 0;
        const widget = host.createTextElement(FORM_LAYER, 1, x, y);
        mem.write32(slot + 0x14 + i * 4, widget);
        let value = mem.read16s(self + 0x64 + which * 2) | 0;
        if (value >= 0x3e8) value = FORM_PANEL_NUMBER_MAX;
        host.callMethod(widget, 0x118, [0, value]);
        host.callMethod(widget, 0x148, [1]);
        table += 3;
    }
    // .L0x80094b80-0x80094bf4: the three flag halfwords at +0x8A, +0x8C and +0x8E
    // grey child slots 5, 6 and 9 — the first, second and fifth numbers.
    for (const [flag, widget] of FORM_PANEL_FLAGS) {
        if ((mem.read16s(self + flag) | 0) === 0) continue;
        host.callMethod(mem.read32(slot + widget) >>> 0, 0x138, [FORM_PALETTE_NUMBER]);
    }
}

/**
 * F0x80094D50(self, slot) (fightstg.s:18615-18728): pages one and two build a
 * caption (bank 0x7F word 0x19 at (90,169)), its number at (147,169) — the dash
 * word 0x1A when the panel's +0x60 is negative, otherwise that word as a
 * numeral — and six technique-name widgets at (38, 81 + 14*i) in child slots
 * 18..23, the name taken from bank 0xA2 at `word & 0x1FFF`, palette 3 when the
 * word carries bit 15 and palette 4 when it carries bit 14.
 */
export function formPanelTechRows(
    mem: FormListMemory,
    self: number,
    slot: number,
    host: FormListHost,
): void {
    const res = host.resourceBase((mem.read32(FORM_STRING_BASE) | 0) + FORM_BANK_UI);
    const head = host.createTextElement(FORM_LAYER, 1, 0x5a, 0xa9);
    mem.write32(slot + 0x0c, head);
    host.callMethod(head, 0x114, [res, 0x19]);
    const total = host.createTextElement(FORM_LAYER, 1, 0x93, 0xa9);
    mem.write32(slot + 0x10, total);
    const headline = mem.read32(self + FORM_PANEL_HEADLINE) | 0;
    if (headline < 0) host.callMethod(total, 0x114, [res, 0x1a]);
    else host.callMethod(total, 0x118, [0, headline]);
    host.callMethod(total, 0x148, [1]);
    for (let i = 0; i < FORM_TECH_ROWS; i++) {
        const word = mem.read16s(self + FORM_PANEL_ROW_WORDS + i * 4) | 0;
        const name = host.createTextElement(FORM_LAYER, 1, 0x26, 0x51 + 0x0e * i);
        mem.write32(slot + 0x48 + i * 4, name);
        if (word === 0) continue;
        // .L0x80094e54: the name bank is resolved inside the loop, so an empty
        // table never looks bank 0xA2 up.
        const names = host.resourceBase((mem.read32(FORM_STRING_BASE) | 0) + 0xa2);
        host.callMethod(name, 0x114, [names, word & FORM_TECH_ID_MASK]);
        if ((word & FORM_TECH_SIGNATURE) !== 0) host.callMethod(name, 0x138, [3]);
        else if ((word & FORM_TECH_LOADABLE) !== 0) host.callMethod(name, 0x138, [4]);
    }
}

/** F0x80094878(self) (fightstg.s:18290-18335): the two page-arrow cels. */
export function formPanelDrawArrows(mem: FormListMemory, host: FormListHost): void {
    void mem;
    // The pack is resolved before the draw context and kept across it.
    const chrome = host.packResolve(FORM_CHROME_PACK);
    host.initDrawContext();
    host.setLayer(FORM_LAYER, FORM_LAYER_BUCKET);
    host.setOrigin(FORM_CHROME_ORIGIN, 0);
    if (((host.frameCounter() | 0) & FORM_FRAME_GATE) === 0) return;
    host.drawSprite(chrome, FORM_CEL_ARROW_LEFT, 24, 171);
    host.drawSprite(chrome, FORM_CEL_ARROW_RIGHT, 72, 171);
}

/** F0x80094A00(self) (fightstg.s:18394-18446): page zero's two chrome cels. */
export function formPanelDrawPageZero(host: FormListHost): void {
    host.initDrawContext();
    host.setLayer(FORM_LAYER, FORM_LAYER_BUCKET);
    const icons = host.packResolve(FORM_CMFONT_PACK);
    host.setOrigin(FORM_ICON_ORIGIN, 0);
    host.drawSprite(icons, FORM_CEL_PANEL_ZERO, 24, 81);
    const chrome = host.packResolve(FORM_CHROME_PACK);
    host.setOrigin(FORM_CHROME_ORIGIN, 0);
    host.drawSprite(chrome, FORM_CEL_PANEL_CORNER, 16, 74);
}

/**
 * F0x80094C18(self) (fightstg.s:18534-18614): for each of the six technique words
 * that is not empty a CMFONT icon at (24, 81 + 14*i) (the cel itself is the exe's
 * technique-table byte at +4 plus 0x37), then PGFGTC00 0x26 at (16,74).
 */
export function formPanelDrawTechPage(mem: FormListMemory, self: number, host: FormListHost): void {
    host.initDrawContext();
    host.setLayer(FORM_LAYER, FORM_LAYER_BUCKET);
    const icons = host.packResolve(FORM_CMFONT_PACK);
    host.setOrigin(FORM_ICON_ORIGIN, 0);
    for (let i = 0; i < FORM_TECH_ROWS; i++) {
        const word = mem.read16s(self + FORM_PANEL_ROW_WORDS + i * 4) | 0;
        if (word === 0) continue;
        const cel = mem.read8(FORM_ICON_TABLE + ((word & FORM_TECH_ID_MASK) - 1) * 0x12 + 4) | 0;
        host.drawSprite(icons, cel + 0x37, 24, 0x51 + 0x0e * i);
    }
    const chrome = host.packResolve(FORM_CHROME_PACK);
    host.setOrigin(FORM_CHROME_ORIGIN, 0);
    host.drawSprite(chrome, 0x26, 16, 0x4a);
}

/** F0x80094F08 states 1 and 2: the arrows, then the page's own picture. */
function formPanelDraw(mem: FormListMemory, self: number, host: FormListHost): void {
    formPanelDrawArrows(mem, host);
    const page = mem.read32(self + FORM_PANEL_PAGE) | 0;
    if (page === 0) formPanelDrawPageZero(host);
    else if (page >= 1 && page < FORM_PAGES) formPanelDrawTechPage(mem, self, host);
}
