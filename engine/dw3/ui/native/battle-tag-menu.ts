// The in-battle TAG (partner switch) list, translated from the original bodies
// in pro/fightstg.
//
// Lane B. Every routine below is one original address. The list model
// (F0x8009B0C8), its state machine (F0x8009AF4C), the row draw (F0x8009ADD4)
// and the vsync marker blit (F0x8009ABD8) are the already translated ports in
// ./fight-command-menu.ts: the TAG list is built from the same factory with the
// config block at 0x800A3574, so all of them are reused unchanged.
//
//   F0x80097984 tagMenuActorConstruct  build the 0x88 screen object.
//   F0x80097498 tagMenuTick             state 0 scans the party and builds the
//                                       list; state 1 draws it and reads the pad;
//                                       state 2 is the "no partner" message;
//                                       state 3 is finished.
//   F0x80096EC8 tagCompatible          the per-row compatibility test that gates
//                                       the HP/MP panel.
//   F0x80096FE4 tagMenuPanels          the PGFGTC00 0x30 panel of each row.
//   F0x800970C0 tagMenuCreateWidgets   the nine text widgets of each row.
//   F0x800972C8 tagMenuFillRows        the four HP/MP numbers, the partner name
//                                       and the grey plate of a dead partner.
//
// Geometry, read from fightstg.s: the config block at 0x800A3574 is
// {2, 17, 78, 32, 47, 16, 77, 32} (fightstg.s:33960-33967), so the cursor quad
// sits at (17, 78 + 32*row) and the selector sprite is cel 0x2F at
// (16, 77 + 32*row). Each row's plate is a kind-1 widget at (36, 76 + 32*row),
// "HP" (bank 0x7F word 0x0E) at (108, 78 + 32*row), "/" (word 0x10) at
// (153, 78 + 32*row), "MP" (word 0x0D) at (108, 92 + 32*row) and "/" at
// (153, 92 + 32*row); the HP/MP panel is PGFGTC00 cel 0x30 at (90, 69 + 31*row),
// one pixel tighter per row than the widgets' 32.

import { PROFILE_TABLE_BASE } from "./pause-status.ts";
/** The screen object handler (the factory's F0x80014504 arguments). */
export const TAG_LIST_ACTOR_HANDLER = 0x80097498;
export const TAG_LIST_FACTORY = 0x80097984;
export const TAG_LIST_ACTOR_SIZE = 0x88;
export const TAG_LIST_ACTOR_EXTRA = 0x50;
/** The config block the screen overwrites and F0x8009B0C8 reads. */
export const TAG_LIST_CONFIG = 0x800a3574;
/** The eight words at 0x800A3574 (fightstg.s:33960-33967). */
export const TAG_CONFIG_WORDS: readonly number[] = [2, 0x11, 0x4e, 0x20, 0x2f, 0x10, 0x4d, 0x20];
/** The screen object fields (F0x80097498's `a0`). */
export const TAG_STATE = 0x0c;
export const TAG_OUT_SLOT = 0x50;
export const TAG_OUT_ROW = 0x54;
export const TAG_INTERACTIVE = 0x58;
export const TAG_CANDIDATE = 0x5c;
export const TAG_COUNT = 0x64;
export const TAG_FIRST_FRAME = 0x68;
export const TAG_BLINK_ACC = 0x6c;
export const TAG_BLINK_PHASE = 0x70;
export const TAG_PANEL_OK = 0x74;
export const TAG_COMPAT_LIST = 0x7c;
/** The child-slot word the "no partner" message widget handle lands in. */
export const TAG_MESSAGE_SLOT = 0x4c;
/** The result the caller reads while the screen is still open. */
export const TAG_RESULT_RUNNING = -1;
/** Cancel answers -2 into the chosen-slot word. */
export const TAG_RESULT_CANCEL = -2;
/** The battle workspace: the acting slot at +0x08, the party records at +0x10, 0x20 each. */
export const TAG_PARTY_BASE = 0x800a4470;
export const TAG_PARTY_INDEX = 0x800a4468;
export const TAG_PARTY_STRIDE = 0x20;
export const TAG_PARTY_SPECIES = 0x00;
export const TAG_PARTY_MAX_HP = 0x06;
export const TAG_PARTY_HP = 0x08;
export const TAG_PARTY_MAX_MP = 0x0a;
export const TAG_PARTY_MP = 0x0c;
/** party record +0x1A: the acting member's Blast flag, which suppresses the panel test. */
export const TAG_PARTY_BLAST = 0x1a;
/** The Digimon profile table the compatibility test walks (0x8003EF5C + 0x58*i). */
export const TAG_PROFILES = PROFILE_TABLE_BASE;
export const TAG_PROFILE_STRIDE = 0x58;
/** The resident service table the screen reads (0x80048D34). */
export const TAG_SERVICE_BASE = 0x80048d34;
export const TAG_SERVICE_SLOT = 0x2718;
export const TAG_SERVICE_LIST = 0x2738;
export const TAG_SERVICE_NAME = 0x2750;
/** The profile record byte the compatibility test walks the table with. */
export const TAG_PROFILE_MATCH_BYTE = 0x3d;
/** The draw packs: 0x02860000 (CMFONT, the blinking hand) and 0x04550000 (PGFGTC00). */
export const TAG_PACK_FONT = 0x02860000;
export const TAG_PACK_CHROME = 0x04550000;
export const TAG_CEL_PANEL = 0x30;
export const TAG_CEL_MESSAGE = 0x31;
export const TAG_CEL_HAND = 0x0a;
/** The draw context calls, in the original's order. */
export const TAG_LAYER = 0x1005;
export const TAG_LAYER_BUCKET = 1;
export const TAG_ORIGIN_CHROME = 0x200;
export const TAG_ORIGIN_HAND = 0x140;
/** The panel's own y series: 69 + 31*row, one pixel tighter than the widgets. */
export const TAG_PANEL_Y0 = 0x45;
export const TAG_PANEL_PITCH = 0x1f;
export const TAG_PANEL_X = 0x5a;
/** The name plate's y series: 76 + 32*row; "HP" at 78 and "MP" at 92. */
export const TAG_ROW_PITCH = 0x20;
export const TAG_NAME_Y0 = 0x4c;
export const TAG_HP_Y0 = 0x4e;
export const TAG_MP_Y0 = 0x5c;
/** The row widgets' x anchors. */
export const TAG_LABEL_X = 0x6c;
export const TAG_SLASH_X = 0x99;
export const TAG_NAME_X = 0x24;
/** The hand's own placement, and the 4-tick/5-phase blink behind it. */
export const TAG_HAND_X = 0x123;
export const TAG_HAND_Y = 0xd0;
export const TAG_HAND_PERIOD = 4;
export const TAG_HAND_PHASES = 5;
/** The message pane cel. */
export const TAG_MESSAGE_X = 0xb;
export const TAG_MESSAGE_Y = 0xbc;
/** Text banks and the words the row widgets ask for (0x7F is the battle UI bank). */
export const TAG_BANK_UI = 0x7f;
export const TAG_WORD_MP = 0x0d;
export const TAG_WORD_HP = 0x0e;
export const TAG_WORD_SLASH = 0x10;
export const TAG_WORD_NO_PARTNER = 0x14;
/** The language byte the resource-base call is composed with. */
export const TAG_STRING_BASE = 0x8005cca8;
/** The dead partner's plate palette. */
export const TAG_PALETTE_GREY = 7;
/** The pad bits: Circle and Cross. */
export const TAG_PAD_CONFIRM = 0x2000;
export const TAG_PAD_CANCEL = 0x4000;
/** The three packed sounds. The move and confirm blips carry the 0x4 high half. */
export const TAG_MOVE_SOUND = 0x4001b;
export const TAG_CONFIRM_SOUND = 0x4001c;
/** The cancel blip: the call site passes 0x50BD (lui 0x8004 + ori 0x50BD,
 * fightstg.s:21434/21440) and the packed-sound entry widens it. */
export const TAG_CANCEL_SOUND = 0x800450bd;
/** The list never holds more than the two partners that are not the actor. */
export const TAG_MAX_ROWS = 2;

export interface TagListMemory {
    read8(addr: number): number;
    read16(addr: number): number;
    read16s(addr: number): number;
    read32(addr: number): number;
    write8?(addr: number, value: number): void;
    write16(addr: number, value: number): void;
    write32(addr: number, value: number): void;
}

export interface TagListHost {
    /** F0x80014504(0x80097498, 0x88, 0x50): allocate the screen object. */
    allocateActor(): number;
    /**
     * F0x8009B0C8(config): build the list model from the config block. The TAG
     * list uses the shared factory, so the port is commandMenuCreate.
     */
    createModel(config: number): number;
    /** [0x80048D34+0x2718](partySlot): the member's live form id. */
    speciesOfSlot(slot: number): number;
    /** [0x8005CCA0](species): the Digimon profile record for a form id. */
    preselectRecord(species: number): number;
    /** [0x80048D34+0x2738](species, dest): the ids written at self+0x7C. */
    compatibilityList(species: number, dest: number): number;
    /** [0x80048D34+0x2750](species): the member's name, as a string pointer. */
    nameOfSlot(slot: number): number;
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
    /** [0x8004DF98](): the display counter the message hand blinks on. */
    frameCounter(): number;
    /** [0x8004DE10+0x18C](): the frame delta the shared row draw advances by. */
    frameDelta(): number;
    /** F0x8001F648(): build the stack draw context. */
    initDrawContext(): void;
    /** ctx+0x8C(x, y): set the draw layer. */
    setLayer(x: number, y: number): void;
    /** ctx+0x84(x, y): set the draw origin. */
    setOrigin(x: number, y: number): void;
    /** ctx+0x88(frame): the palette row the shared row draw sets. */
    setPaletteRow(frame: number): void;
    /** ctx+0x98(frame): the sprite palette the shared row draw selects. */
    setSpritePalette(frame: number): void;
    /** ctx+0x94(pack, id, x, y): draw a sprite. */
    drawSprite(pack: number, id: number, x: number, y: number): void;
    /** target+slot(a1, a2): an object method; +0x16C answers a predicate. */
    callMethod(target: number, slot: number, args: number[]): number;
}

/**
 * F0x80097984(outSlot, outRow, interactive): allocate the screen object, wire
 * the two caller words and answer "still open".
 */
export function tagMenuActorConstruct(
    mem: TagListMemory,
    outSlot: number,
    outRow: number,
    interactive: number,
    host: TagListHost,
): number {
    const obj = host.allocateActor();
    mem.write32(obj + TAG_OUT_SLOT, outSlot);
    mem.write32(outSlot, TAG_RESULT_RUNNING);
    mem.write32(obj + TAG_OUT_ROW, outRow);
    mem.write32(obj + TAG_INTERACTIVE, interactive | 0);
    return obj;
}

/**
 * F0x80097498(self, slot): the screen's own tick. The state word at +0x0C is 0
 * while the list is built, 1 while it is live, 2 for the "no partner" message
 * and 3 once the answer is written.
 */
export function tagMenuTick(mem: TagListMemory, self: number, slot: number, host: TagListHost): void {
    const state = mem.read32(self + TAG_STATE) | 0;
    if (state === 1) {
        tagMenuInput(mem, self, slot, host);
        return;
    }
    if (state < 2) {
        tagMenuBuild(mem, self, slot, host);
        return;
    }
    if (state === 2) tagNoPartnerTick(mem, self, slot, host);
}

/**
 * F0x80097498 state 0 (fightstg.s:21206-21283): walk the three party records
 * and keep every one whose live form id is not zero and which is not the acting
 * member. A knocked-out partner is a row: its current HP is not tested here.
 * Each kept row runs the compatibility test, which is skipped when the screen is
 * forced or the acting member is mid-Blast, and the count goes into the config
 * block before the shared factory builds the model.
 */
export function tagMenuBuild(mem: TagListMemory, self: number, slot: number, host: TagListHost): void {
    const active = mem.read32(TAG_PARTY_INDEX) | 0;
    const interactive = mem.read32(self + TAG_INTERACTIVE) | 0;
    // Read once before the walk (fightstg.s:0x80097504-0x8009750c): it is the
    // acting member's Blast byte, and it gates every row's panel test.
    const blast = mem.read8(party(active) + TAG_PARTY_BLAST) | 0;
    for (let i = 0; i < 3; i++) {
        if ((mem.read16s(party(i) + TAG_PARTY_SPECIES) | 0) === 0) continue;
        if (i === active) continue;
        // The count at self+0x64 is read, used and bumped in place, so it starts
        // from whatever the fresh screen object held.
        const count = mem.read32(self + TAG_COUNT) | 0;
        mem.write32(self + TAG_CANDIDATE + count * 4, i);
        if (interactive !== 0 && blast === 0) {
            const ok = tagCompatible(mem, self, active, i, host);
            mem.write32(self + TAG_PANEL_OK + count * 4, ok);
        }
        mem.write32(self + TAG_COUNT, count + 1);
    }
    const count = mem.read32(self + TAG_COUNT) | 0;

    if (count <= 0) {
        // No partner left: one message widget on the pane, hidden until the
        // screen's own first frame has run.
        const widget = host.createTextElement(TAG_LAYER, 1, 0x14, 0xc2);
        mem.write32(slot + TAG_MESSAGE_SLOT, widget);
        host.callMethod(widget, 0x144, [0]);
        host.callMethod(self, 0x28, [2]);
        return;
    }

    // fightstg.s:0x800975b0-0x800975b4: the count lands in the config block from
    // the factory call's delay slot, so the model shows exactly the rows that
    // exist.
    mem.write32(TAG_LIST_CONFIG, count);
    const model = host.createModel(TAG_LIST_CONFIG);
    mem.write32(slot, model);
    tagMenuCreateWidgets(mem, self, slot, host);
    // fightstg.s:0x800975cc-0x800975d0: the cursor takes the row the caller last
    // had, stored in the widget call's delay slot.
    mem.write32(model + 0x50, mem.read32(mem.read32(self + TAG_OUT_ROW) >>> 0) | 0);
    tagMenuFillRows(mem, self, slot, host);
    host.callMethod(self, 0x38, []);
}

function party(slot: number): number {
    return (TAG_PARTY_BASE + Math.imul(slot | 0, TAG_PARTY_STRIDE)) >>> 0;
}

/**
 * F0x80096EC8(self, activeSlot, candidateSlot): the test that decides whether a
 * row's HP/MP panel is drawn at all. It asks the Digimon data service for both
 * live form ids, takes the acting member's profile record, reads that record's
 * byte +0x3D, asks the service for the candidate id list it writes at self+0x7C
 * and returns the byte when the id at 0x8003EF5C + 0x58*(byte-1) is in the
 * list, else 0.
 */
export function tagCompatible(
    mem: TagListMemory,
    self: number,
    activeSlot: number,
    candidateSlot: number,
    host: TagListHost,
): number {
    host.speciesOfSlot(activeSlot);
    // `move_ $s0, $v0` sits in the profile call's delay slot, so it runs BEFORE
    // that call and captures the CANDIDATE's live form id; the `move_ $a0, $s0`
    // after it hands that id to the list service, while the byte walked below
    // comes from the ACTING member's profile record (fightstg.s:0x80096f38).
    const species = host.speciesOfSlot(candidateSlot) | 0;
    const record = host.preselectRecord(mem.read16s(party(activeSlot) + TAG_PARTY_SPECIES) | 0) >>> 0;
    // `move_ $a2, $v0` sits after the list call, so the loop bound below is the
    // list service's own count (fightstg.s:0x80096f50).
    const count = host.compatibilityList(species, (self + TAG_COMPAT_LIST) >>> 0) | 0;
    if (count <= 0) return 0;
    const match = mem.read8(record + TAG_PROFILE_MATCH_BYTE) & 0xff;
    if (match === 0) return 0;
    // The profile id comes straight out of the table the byte indexes:
    // 0x8003EF5C + 0x58 * (byte - 1), read unsigned (fightstg.s:0x80096f84-0x80096fa0).
    const id = mem.read16(TAG_PROFILES + TAG_PROFILE_STRIDE * (match - 1)) & 0xffff;
    for (let i = 0; i < count; i++) {
        if ((mem.read16s(self + TAG_COMPAT_LIST + i * 2) | 0) === id) return match;
    }
    return 0;
}

/**
 * F0x800970C0(self, slot) (fightstg.s:20928-21059): the nine text widgets of a
 * row. The row pointer advances four bytes, so the second row's block overlaps
 * the first. Four stores sit in the
 * delay slot of the constructor call that follows them, so each lands one slot
 * earlier than its own widget: the current HP/MP sit at x = 152 and the maximum
 * at x = 187, which is the order the running game shows.
 */
export function tagMenuCreateWidgets(
    mem: TagListMemory,
    self: number,
    slot: number,
    host: TagListHost,
): void {
    const res = host.resourceBase((mem.read32(TAG_STRING_BASE) | 0) + TAG_BANK_UI);
    const count = mem.read32(self + TAG_COUNT) | 0;
    for (let row = 0; row < count; row++) {
        const base = slot + row * 4;
        const nameY = TAG_NAME_Y0 + TAG_ROW_PITCH * row;
        const hpY = TAG_HP_Y0 + TAG_ROW_PITCH * row;
        const mpY = TAG_MP_Y0 + TAG_ROW_PITCH * row;
        let widget = host.createTextElement(TAG_LAYER, 3, TAG_LABEL_X, hpY);
        mem.write32(base + 0x04, widget);
        host.callMethod(widget, 0x114, [res, TAG_WORD_HP]);
        widget = host.createTextElement(TAG_LAYER, 3, TAG_SLASH_X, hpY);
        mem.write32(base + 0x14, widget);
        host.callMethod(widget, 0x114, [res, TAG_WORD_SLASH]);
        widget = host.createTextElement(TAG_LAYER, 3, TAG_LABEL_X, mpY);
        mem.write32(base + 0x24, widget);
        host.callMethod(widget, 0x114, [res, TAG_WORD_MP]);
        widget = host.createTextElement(TAG_LAYER, 3, TAG_SLASH_X, mpY);
        mem.write32(base + 0x34, widget);
        host.callMethod(widget, 0x114, [res, TAG_WORD_SLASH]);
        // Each of the next four handles is stored by the store that follows the
        // NEXT constructor call, so the row shows its current value at 152 and
        // its maximum at 187 (fightstg.s:21001-21057, the stores in the delay
        // slots run before their own call).
        widget = host.createTextElement(TAG_LAYER, 3, 0x98, hpY);
        mem.write32(base + 0x0c, widget);
        widget = host.createTextElement(TAG_LAYER, 3, 0xbb, hpY);
        mem.write32(base + 0x1c, widget);
        widget = host.createTextElement(TAG_LAYER, 3, 0x98, mpY);
        mem.write32(base + 0x2c, widget);
        widget = host.createTextElement(TAG_LAYER, 3, 0xbb, mpY);
        mem.write32(base + 0x3c, widget);
        widget = host.createTextElement(TAG_LAYER, 1, TAG_NAME_X, nameY);
        mem.write32(base + 0x44, widget);
    }
}

/**
 * F0x800972C8(self, slot) (fightstg.s:21062-21155): each row's four numbers
 * from its party record, then the partner's name on the plate, and the plate
 * turned grey when the partner is knocked out.
 */
export function tagMenuFillRows(mem: TagListMemory, self: number, slot: number, host: TagListHost): void {
    const count = mem.read32(self + TAG_COUNT) | 0;
    for (let row = 0; row < count; row++) {
        const base = slot + row * 4;
        const record = party(mem.read32(self + TAG_CANDIDATE + row * 4) | 0);
        setNumber(mem, host, mem.read32(base + 0x0c) >>> 0, mem.read16s(record + TAG_PARTY_HP) | 0);
        setNumber(mem, host, mem.read32(base + 0x1c) >>> 0, mem.read16s(record + TAG_PARTY_MAX_HP) | 0);
        setNumber(mem, host, mem.read32(base + 0x2c) >>> 0, mem.read16s(record + TAG_PARTY_MP) | 0);
        setNumber(mem, host, mem.read32(base + 0x3c) >>> 0, mem.read16s(record + TAG_PARTY_MAX_MP) | 0);
        const candidate = mem.read32(self + TAG_CANDIDATE + row * 4) | 0;
        // `move_ $a0, $v0` sits in the name service's delay slot, so it runs
        // before that call: the name service is handed the LIVE FORM ID the
        // species service just answered with, not the party slot.
        const name = host.nameOfSlot(host.speciesOfSlot(candidate) | 0) >>> 0;
        host.callMethod(mem.read32(base + 0x44) >>> 0, 0x114, [name, -1]);
        // Only the plate is recoloured; the four numbers keep palette 0.
        const grey = (mem.read16s(record + TAG_PARTY_HP) | 0) === 0 ? TAG_PALETTE_GREY : 0;
        host.callMethod(mem.read32(base + 0x44) >>> 0, 0x138, [grey]);
    }
}

/** fightstg.s:21073-21110: widget+0x118(0, value) then widget+0x148(1). */
function setNumber(mem: TagListMemory, host: TagListHost, widget: number, value: number): void {
    host.callMethod(widget, 0x118, [0, value]);
    host.callMethod(widget, 0x148, [1]);
}

/**
 * F0x80096FE4(self) (fightstg.s:20870-20996): PGFGTC00 cel 0x30 at
 * (90, 69 + 31*row) for every row whose compatibility test passed, and nothing
 * at all when the list is empty.
 */
export function tagMenuPanels(mem: TagListMemory, self: number, host: TagListHost): void {
    host.initDrawContext();
    host.setLayer(TAG_LAYER, TAG_LAYER_BUCKET);
    const pack = host.packResolve(TAG_PACK_CHROME);
    host.setOrigin(TAG_ORIGIN_CHROME, 0);
    const count = mem.read32(self + TAG_COUNT) | 0;
    for (let row = 0; row < count; row++) {
        if ((mem.read32(self + TAG_PANEL_OK + row * 4) | 0) === 0) continue;
        host.drawSprite(pack, TAG_CEL_PANEL, TAG_PANEL_X, TAG_PANEL_Y0 + TAG_PANEL_PITCH * row);
    }
}

/**
 * F0x80097498 state 1 (fightstg.s:21290-21344, 21434-21446): draw the panels,
 * then the pad. Cross (0x4000) cancels, but only when the screen is interactive.
 * Circle (0x2000) answers with the chosen party slot and the cursor row, and
 * does nothing at all when the partner under the cursor is knocked out.
 */
export function tagMenuInput(mem: TagListMemory, self: number, slot: number, host: TagListHost): void {
    tagMenuPanels(mem, self, host);
    const pad = host.padRead(0) | 0;
    const model = mem.read32(slot) >>> 0;
    if ((mem.read32(self + TAG_INTERACTIVE) | 0) !== 0 && (pad & TAG_PAD_CANCEL) !== 0) {
        host.playSound(TAG_CANCEL_SOUND);
        mem.write32(mem.read32(self + TAG_OUT_SLOT) >>> 0, TAG_RESULT_CANCEL);
        host.callMethod(self, 0x28, [3]);
        return;
    }
    if ((pad & TAG_PAD_CONFIRM) === 0) return;
    host.playSound(TAG_CONFIRM_SOUND);
    const cursor = mem.read32(model + 0x50) | 0;
    const candidate = mem.read32(self + TAG_CANDIDATE + cursor * 4) | 0;
    if ((mem.read16s(party(candidate) + TAG_PARTY_HP) | 0) === 0) return;
    mem.write32(mem.read32(self + TAG_OUT_ROW) >>> 0, cursor);
    mem.write32(mem.read32(self + TAG_OUT_SLOT) >>> 0, candidate);
    host.callMethod(self, 0x28, [3]);
    mem.write32(model + 0x54, 1);
}

/**
 * F0x80097498 state 2 (fightstg.s:21290 no; :21320-21485): the "no partner"
 * screen. Only Circle is read: it answers -2, moves to state 3 and hides the
 * message widget. Every frame draws the message pane and, once the first frame
 * has passed, the blinking hand.
 */
export function tagNoPartnerTick(mem: TagListMemory, self: number, slot: number, host: TagListHost): void {
    const pad = host.padRead(0) | 0;
    if ((pad & TAG_PAD_CONFIRM) !== 0) {
        host.playSound(TAG_CONFIRM_SOUND);
        mem.write32(mem.read32(self + TAG_OUT_SLOT) >>> 0, TAG_RESULT_CANCEL);
        host.callMethod(self, 0x28, [3]);
        host.callMethod(mem.read32(slot + TAG_MESSAGE_SLOT) >>> 0, 0x144, [0]);
        return;
    }
    tagNoPartnerDraw(mem, self, slot, host);
}

/** fightstg.s:21394-21485: the pane, the blinking hand and the text once idle. */
function tagNoPartnerDraw(mem: TagListMemory, self: number, slot: number, host: TagListHost): void {
    host.initDrawContext();
    host.setLayer(TAG_LAYER, TAG_LAYER_BUCKET);
    if ((mem.read32(self + TAG_FIRST_FRAME) | 0) === 0) {
        mem.write32(self + TAG_FIRST_FRAME, 1);
        host.setOrigin(TAG_ORIGIN_CHROME, 0);
    } else {
        // The original reads the display counter once into a register it then
        // subtracts the accumulator from, so a frame the hand does not step
        // still reads it, and four display ticks must pass between steps.
        const counter = host.frameCounter() | 0;
        if ((counter - (mem.read32(self + TAG_BLINK_ACC) | 0)) >= TAG_HAND_PERIOD) {
            mem.write32(self + TAG_BLINK_ACC, host.frameCounter() | 0);
            const phase = (mem.read32(self + TAG_BLINK_PHASE) | 0) + 1;
            mem.write32(self + TAG_BLINK_PHASE, phase < TAG_HAND_PHASES ? phase : 0);
        }
        host.setOrigin(TAG_ORIGIN_HAND, 0);
        host.setSpritePalette(mem.read32(self + TAG_BLINK_PHASE) | 0);
        const font = host.packResolve(TAG_PACK_FONT);
        host.drawSprite(font, TAG_CEL_HAND, TAG_HAND_X, TAG_HAND_Y);
        host.setSpritePalette(0);
        host.setOrigin(TAG_ORIGIN_CHROME, 0);
    }
    const chrome = host.packResolve(TAG_PACK_CHROME);
    host.drawSprite(chrome, TAG_CEL_MESSAGE, TAG_MESSAGE_X, TAG_MESSAGE_Y);
    const widget = mem.read32(slot + TAG_MESSAGE_SLOT) >>> 0;
    // widget+0x16C is the "still typing" predicate: the word is only set once it
    // reports idle.
    if (host.callMethod(widget, 0x16c, []) !== 0) return;
    host.callMethod(widget, 0x114,
        [host.resourceBase((mem.read32(TAG_STRING_BASE) | 0) + TAG_BANK_UI), TAG_WORD_NO_PARTNER]);
}