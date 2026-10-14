// The in-battle DNA pane, translated from the original bodies in pro/fightstg.
//
// Lane B. Every routine below is one original address; the list model it builds
// with (F0x8009B0C8 / F0x8009AF4C / F0x8009ADD4) is the already translated port
// in ./fight-command-menu.ts, because the pane calls the same factory as the
// command menu, the TAG list and the TECH list. The partner list that precedes
// this screen is the port in ./battle-tag-menu.ts and is not duplicated here.
//
//   F0x80098884 dnaPaneActorConstruct  build the 0x84 screen object (tick
//                                      0x800980E4), wire the caller's word block
//                                      and the partner's combatant index.
//   F0x800988FC dnaPaneActorConstruct2 the same plus the species out word.
//   F0x800980E4 dnaPaneTick            state 0 seeds the species strip and falls
//                                      into state 1; state 1 runs the two
//                                      sub-states (0 the species names, 1 the
//                                      Switch / DNA DV rows).
//   F0x80097AB0 dnaPaneCreateWidgets   the fourteen text widgets of the pane.
//   F0x80097BD8 dnaPaneNames           fill or hide the four species names.
//   F0x80097CFC dnaPaneLabels          fill or hide the nine option and MP-plate
//                                      widgets, including the grey palette.
//   F0x800979E4 dnaPaneArt             the PGFGTC00 frame, the DNA row's backing
//                                      and the MP plate.
//
// Geometry, read from fightstg.s. The species strip's config block at 0x800A3594
// is {4, 168, 147, 19, 36, 167, 146, 19} (fightstg.s:33969-33976), so its cursor
// quad sits at (168, 147 + 19*row) and the marker is cel 0x24 at
// (167, 146 + 19*row). The option block at 0x800A35B4 is
// {2, 168, 166, 19, 34, 167, 165, 19} (fightstg.s:33977-33984). The four name
// widgets are (187, 146 + 19*i) (fightstg.s:21585-21599), the header (171, 146),
// "Switch" (187, 165), "DNA DV" (187, 184), "MP" (270, 186), the price
// (307, 186), and the four MP-plate widgets at y 57 with x from the halfword
// table at 0x800A35D4 = {172, 216, 217, 251} (fightstg.s:33985-33988).

import { PROFILE_TABLE_BASE } from "./pause-status.ts";
/** The screen object handler and geometry (the factory's F0x80014504 arguments). */
export const DNA_PANE_HANDLER = 0x800980e4;
export const DNA_PANE_SIZE = 0x84;
export const DNA_PANE_EXTRA = 0x44;
/** The two config blocks, 0x20 bytes apart. */
export const DNA_PANE_CONFIG_STRIP = 0x800a3594;
export const DNA_PANE_CONFIG_OPTIONS = 0x800a35b4;
/** The eight words at 0x800A3594 (fightstg.s:33969-33976). */
export const DNA_STRIP_CONFIG_WORDS: readonly number[] = [4, 0xa8, 0x93, 0x13, 0x24, 0xa7, 0x92, 0x13];
/** The eight words at 0x800A35B4 (fightstg.s:33977-33984). */
export const DNA_OPTIONS_CONFIG_WORDS: readonly number[] = [2, 0xa8, 0xa6, 0x13, 0x22, 0xa7, 0xa5, 0x13];
/** The four MP-plate x anchors at 0x800A35D4 (fightstg.s:33985-33988). */
export const DNA_MP_XS = 0x800a35d4;
export const DNA_MP_X_WORDS: readonly number[] = [172, 216, 217, 251];
/** The Jogress MP price table: 0x80042BDC + 18*(dnaId - 1). */
export const DNA_PRICES = 0x80042bdc;
export const DNA_PRICE_STRIDE = 0x12;
/** The species the seed starts from: the 0x58-stride profile table, row `self+0x60`.
 *  fightstg.s:21999-22019: `lui $v1, 0x8004` + `addiu $v1, -0x10a4` is 0x8003EF5C,
 *  and the index runs 2i -> 3i -> 12i -> 11i -> 88i, so the stride is 0x58. The
 *  same pair with the same arithmetic appears in wfightmn.s:810-816, where the
 *  halfword it loads is compared against a form id. */
export const DNA_SPECIES_TABLE = PROFILE_TABLE_BASE;
export const DNA_COMBATANT_STRIDE = 0x58;
/**
 * The table's whole length: 0x8003EF5C + 55*0x58 = 0x80040244, where the shop
 * descriptor table starts. This is the table's size, not the species getter's
 * scan: F0x800134E8 ([0x8005CCA0]) asks f1, which stops after 52 rows
 * (exe/f1.s:26), so the last three forms have no record on the original's
 * screens. native/pause-status.ts PROFILE_SCAN_ROWS carries that bound.
 */
export const DNA_PROFILE_ROWS = 0x37;
/** The screen object fields (F0x800980E4's `a0`). */
export const DNA_STATE = 0x0c;
export const DNA_SUB_STATE = 0x10;
export const DNA_BUILD = 0x14;
export const DNA_WORDS = 0x50;
/**
 * +0x54 is L1/R1's own three-position selection (0, 1, 2, wrapping). It is NOT
 * the Switch / DNA DV row: the commit reads the option list model's own cursor
 * at +0x50 (fightstg.s:22264 `lw $v0, 0x4($s3)` then `lw $v0, 0x50($v0)`,
 * words 0x8e620004 / 0x8c420050), which the shared list widget moves with Up
 * and Down. +0x54 is what the pane hands F0x800953E4 as its second argument, so
 * it chooses which stat set the carry-over preview shows.
 */
export const DNA_PREVIEW_OPTION = 0x54;
export const DNA_SELECTED = 0x58;
export const DNA_PARTNER_SLOT = 0x5c;
export const DNA_COMBATANT = 0x60;
export const DNA_STRIP_CURSOR = 0x64;
/** The species strip: `self[2*i + 0x68]`, `self+0x70` of them. */
export const DNA_SPECIES = 0x68;
export const DNA_ROW_COUNT = 0x70;
export const DNA_CANDIDATES = 0x74;
/** The DNA result id, non-zero when the partner carries a pairing. */
export const DNA_DNA_ID = 0x7c;
export const DNA_SPECIES_OUT = 0x80;
/** The three halfwords the candidate service writes at self+0x74. */
export const DNA_CANDIDATE_COUNT = 3;
/** The widget block the pane builds into (`a1` of its tick). */
export const DNA_SLOT_MODEL = 0x00;
export const DNA_SLOT_OPTIONS = 0x04;
export const DNA_SLOT_PREVIEW_A = 0x08;
export const DNA_SLOT_PREVIEW_B = 0x0c;
export const DNA_SLOT_NAMES = 0x10;
export const DNA_SLOT_SWITCH = 0x20;
export const DNA_SLOT_DNA = 0x24;
export const DNA_SLOT_MP_LABEL = 0x28;
export const DNA_SLOT_PRICE = 0x2c;
export const DNA_SLOT_HEADER = 0x30;
export const DNA_SLOT_MP = 0x34;
/** The shared list model's cursor and marker. */
export const DNA_MODEL_CURSOR = 0x50;
export const DNA_MODEL_MARKER = 0x54;
/** The battle workspace: the acting slot at +0x08, the party records at +0x10, 0x20 each. */
export const DNA_PARTY_BASE = 0x800a4470;
export const DNA_PARTY_INDEX = 0x800a4468;
export const DNA_PARTY_STRIDE = 0x20;
export const DNA_PARTY_SPECIES = 0x00;
export const DNA_PARTY_MAX_HP = 0x06;
export const DNA_PARTY_HP = 0x08;
export const DNA_PARTY_MAX_MP = 0x0a;
export const DNA_PARTY_MP = 0x0c;
export const DNA_PARTY_BLAST = 0x1a;
export const DNA_PARTY_AILMENTS = 0x1c;
/**
 * Three profile bytes this screen reads. +0x3D is the record's DNA partner as a
 * 1-based profile index, +0x55 is its own 1-based profile index — which is also
 * the word its name is filed under in bank 0x4E — and the halfword at +0x2A is
 * the DNA result id.
 */
export const DNA_PROFILE_PAIR = 0x3d;
export const DNA_PROFILE_INDEX = 0x55;
export const DNA_PROFILE_RESULT = 0x2a;
/** The language byte and the two banks the pane asks for. */
export const DNA_STRING_BASE = 0x8005cca8;
export const DNA_BANK_UI = 0x7f;
export const DNA_BANK_NAME = 0x4e;
/** The bank words: "MP" 0x0D, "/" 0x10, "Switch" 0x1B, "DNA DV" 0x1C. */
export const DNA_WORD_MP = 0x0d;
export const DNA_WORD_SLASH = 0x10;
export const DNA_WORD_SWITCH = 0x1b;
export const DNA_WORD_DNA = 0x1c;
/** The dead palette. */
export const DNA_PALETTE_GREY = 7;
/** The draw context calls, in the original's order. */
export const DNA_LAYER = 0x1005;
export const DNA_LAYER_BUCKET = 1;
export const DNA_ORIGIN = 0x200;
export const DNA_PACK_CHROME = 0x04550000;
export const DNA_CEL_FRAME = 0x2b;
export const DNA_CEL_DNA_ROW = 0x02;
export const DNA_CEL_MP_PLATE = 0x29;
export const DNA_FRAME_X = 0xa7;
export const DNA_FRAME_Y = 0x8f;
export const DNA_DNA_ROW_X = 0xa7;
export const DNA_DNA_ROW_Y = 0xb8;
export const DNA_PLATE_X = 0xa3;
export const DNA_PLATE_Y = 0x21;
/** The pane's own widget anchors (F0x80097AB0). */
export const DNA_NAME_X = 0xbb;
export const DNA_NAME_Y0 = 0x92;
export const DNA_NAME_PITCH = 0x13;
export const DNA_HEADER_X = 0xab;
export const DNA_SWITCH_Y = 0xa5;
export const DNA_DNA_Y = 0xb8;
export const DNA_MP_LABEL_X = 0x10e;
export const DNA_PRICE_X = 0x133;
export const DNA_MP_LABEL_Y = 0xba;
export const DNA_PLATE_WORD_Y = 0x39;
/** The pad bits. Circle 0x2000, Cross 0x4000, L1 0x400, R1 0x800. */
export const DNA_PAD_CONFIRM = 0x2000;
export const DNA_PAD_CANCEL = 0x4000;
export const DNA_PAD_L1 = 0x0400;
export const DNA_PAD_R1 = 0x0800;
/** The three packed sounds. The move and confirm blips carry the 0x4 high half
 *  (lui $a0, 0x4 at :21979 / :22009 plus the delay-slot ori); the cancel blip is
 *  lui 0x8004 plus ori 0x50BD (:22004 / :22012). */
export const DNA_MOVE_SOUND = 0x4001b;
export const DNA_CONFIRM_SOUND = 0x4001c;
export const DNA_CANCEL_SOUND = 0x800450bd;
/** The result word's running answer, and the cancel answer. */
export const DNA_RESULT_RUNNING = -1;
export const DNA_RESULT_CANCEL = -2;
/** The generic close arguments the pane passes to +0x28. */
export const DNA_CLOSE_SCREEN = 3;
export const DNA_CLOSE_LIST = 3;
export const DNA_CLOSE_PREVIEW = 2;

export interface DnaPaneMemory {
    read8(addr: number): number;
    read16(addr: number): number;
    read16s(addr: number): number;
    read32(addr: number): number;
    write8?(addr: number, value: number): void;
    write16(addr: number, value: number): void;
    write32(addr: number, value: number): void;
}

export interface DnaPaneHost {
    /** F0x80014504(0x800980E4, 0x84, 0x44): allocate the screen object. */
    allocateActor(): number;
    /** F0x8009B0C8(config): build the shared list model. */
    createModel(config: number): number;
    /** F0x8001AE38(target, kind, x, y): build a text widget. */
    createTextElement(target: number, kind: number, x: number, y: number): number;
    /** [0x80044F4C](bank): the resource base of an indexed text bank. */
    resourceBase(bank: number): number;
    /** [0x80044F5C](handle): resolve a pack handle to its pointer. */
    packResolve(handle: number): number;
    /** [0x8005CCA0](species): the Digimon profile record for a form id. */
    preselectRecord(species: number): number;
    /** *[0x8004B44C](partySlot): the partner's battle combatant index. */
    combatantOf(slot: number): number;
    /** *[0x8005B46C](combatant, dest): the three candidate species. */
    dnaCandidates(combatant: number, dest: number): void;
    /** [0x8004BBC4](0): the pad word the pane reads. */
    padRead(port: number): number;
    /** [0x8004B7D0+0x3F4](port): the pressed word the shared list model reads. */
    padReadA(port: number): number;
    /** [0x8004B7D0+0x3FC](port): the repeated word the shared list model reads. */
    padReadB(port: number): number;
    /** [0x80055C48](id): play a packed sound. */
    playSound(id: number): void;
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
    /** target+slot(a1, a2): an object method. */
    callMethod(target: number, slot: number, args: number[]): number;
    /** F0x800953E4(combatant, row, species): the hand-off screen the confirm shows. */
    spawnHandoff(combatant: number, row: number, species: number): number;
}

/**
 * F0x80098884(words) (fightstg.s:22476-22504): allocate the 0x84 screen object,
 * keep the caller's word block at +0x50, take the partner's party slot out of
 * `*words` into +0x5C, ask the resident service for that partner's battle
 * combatant index into +0x60, and answer "still running" in `*words`.
 */
export function dnaPaneActorConstruct(
    mem: DnaPaneMemory,
    words: number,
    host: DnaPaneHost,
): number {
    const self = host.allocateActor();
    const partner = mem.read32(words);
    mem.write32(self + DNA_WORDS, words);
    mem.write32(self + DNA_PARTNER_SLOT, partner);
    mem.write32(self + DNA_COMBATANT, host.combatantOf(partner));
    mem.write32(words, DNA_RESULT_RUNNING);
    return self;
}

/** F0x800988FC (fightstg.s:22509-22512): the same, plus the species out word. */
export function dnaPaneActorConstruct2(
    mem: DnaPaneMemory,
    words: number,
    speciesOut: number,
    host: DnaPaneHost,
): number {
    const self = dnaPaneActorConstruct(mem, words, host);
    mem.write32(self + DNA_SPECIES_OUT, speciesOut);
    return self;
}

/**
 * F0x800980E4(self, slot): the screen's own tick. State 0 seeds the species
 * strip and falls straight into state 1, so one call does both; state 1 splits
 * on the sub-state (0 the species names, 1 the Switch / DNA DV rows); every
 * state from 2 on is the finished screen.
 */
export function dnaPaneTick(mem: DnaPaneMemory, self: number, slot: number, host: DnaPaneHost): void {
    const state = mem.read32(self + DNA_STATE) | 0;
    if (state >= 2) return;
    if (state === 0) dnaPaneSeed(mem, self, slot, host);
    if ((mem.read32(self + DNA_SUB_STATE) | 0) === 1) {
        dnaPaneOptionsTick(mem, self, slot, host);
        return;
    }
    dnaPaneStripTick(mem, self, slot, host);
}

/**
 * F0x800980E4 state 0 (fightstg.s:22001-22036): the candidate service fills
 * three halfwords at self+0x74, the pane keeps every one of them that is at
 * least 3, the count goes into self+0x70 and into the strip config from the
 * widget call's delay slot, and the widgets are built. Then +0x38(self) opens
 * the screen and the result word becomes -1.
 */
function dnaPaneSeed(mem: DnaPaneMemory, self: number, slot: number, host: DnaPaneHost): void {
    const combatant = mem.read32(self + DNA_COMBATANT) | 0;
    host.dnaCandidates(combatant, self + DNA_CANDIDATES);
    mem.write16(self + DNA_SPECIES, mem.read16(DNA_SPECIES_TABLE + DNA_COMBATANT_STRIDE * combatant));
    // The loop's counter starts at 1, because self+0x68 already holds the
    // combatant's own species: the strip is that species followed by every
    // candidate the service kept (fightstg.s:22020-22021).
    let count = 1;
    for (let i = 0; i < DNA_CANDIDATE_COUNT; i++) {
        const species = mem.read16s(self + DNA_CANDIDATES + i * 2) | 0;
        if (species < 3) continue;
        mem.write16(self + DNA_SPECIES + count * 2, species);
        count += 1;
    }
    mem.write32(self + DNA_ROW_COUNT, count);
    mem.write32(DNA_PANE_CONFIG_STRIP, count);
    dnaPaneCreateWidgets(mem, self, slot, host);
    mem.write32(self + DNA_SELECTED, -1);
    host.callMethod(self, 0x38, []);
}

/**
 * F0x80097AB0(self, slot) (fightstg.s:21579-21604): fourteen text widgets. The
 * four species names go to slot+0x10..0x1C. Five of the remaining handles are
 * stored from the delay slot of the call that FOLLOWS them, so each lands one
 * widget earlier than its own call: slot+0x20 is the "Switch" label (187, 165),
 * slot+0x24 the "DNA DV" label (187, 184), slot+0x28 the "MP" label (270, 186)
 * and slot+0x30 the header (171, 146). The price widget's handle is dropped.
 */
export function dnaPaneCreateWidgets(
    mem: DnaPaneMemory,
    self: number,
    slot: number,
    host: DnaPaneHost,
): void {
    void self;
    for (let i = 0; i < 4; i++) {
        const widget = host.createTextElement(DNA_LAYER, 1, DNA_NAME_X, DNA_NAME_Y0 + DNA_NAME_PITCH * i);
        mem.write32(slot + DNA_SLOT_NAMES + i * 4, widget);
    }
    // The header is made first and lands at slot+0x30 out of the call that
    // makes the "DNA DV" label, one call after its own.
    const header = host.createTextElement(DNA_LAYER, 1, DNA_HEADER_X, DNA_NAME_Y0);
    mem.write32(slot + DNA_SLOT_SWITCH,
        host.createTextElement(DNA_LAYER, 1, DNA_NAME_X, DNA_SWITCH_Y));
    mem.write32(slot + DNA_SLOT_DNA,
        host.createTextElement(DNA_LAYER, 1, DNA_NAME_X, DNA_DNA_Y));
    mem.write32(slot + DNA_SLOT_MP_LABEL,
        host.createTextElement(DNA_LAYER, 3, DNA_MP_LABEL_X, DNA_MP_LABEL_Y));
    mem.write32(slot + DNA_SLOT_PRICE,
        host.createTextElement(DNA_LAYER, 3, DNA_PRICE_X, DNA_MP_LABEL_Y));
    mem.write32(slot + DNA_SLOT_HEADER, header);
    for (let i = 0; i < 4; i++) {
        const x = mem.read16s(DNA_MP_XS + i * 4) | 0;
        mem.write32(slot + DNA_SLOT_MP + i * 4,
            host.createTextElement(DNA_LAYER, 3, x, DNA_PLATE_WORD_Y));
    }
}

/**
 * F0x80097BD8(self, slot, show) (fightstg.s:21656-21700): with a non-zero third
 * argument each of the self+0x70 species names goes into its own widget as the
 * name-bank word for that record's +0x55 byte; with zero all four name widgets
 * are hidden.
 */
export function dnaPaneNames(
    mem: DnaPaneMemory,
    self: number,
    slot: number,
    show: number,
    host: DnaPaneHost,
): void {
    if (show === 0) {
        for (let i = 0; i < 4; i++) {
            const widget = mem.read32(slot + DNA_SLOT_NAMES + i * 4) >>> 0;
            if (widget === 0) continue;
            host.callMethod(widget, 0x144, [0]);
        }
        return;
    }
    const count = mem.read32(self + DNA_ROW_COUNT) | 0;
    for (let i = 0; i < count; i++) {
        const species = mem.read16s(self + DNA_SPECIES + i * 2) | 0;
        const record = host.preselectRecord(species) >>> 0;
        if (record === 0) continue;
        // [0x8004_4F4C](language + 0x4E) is asked inside the loop, once per
        // row, and after the profile service (fightstg.s:21644-21656).
        const names = host.resourceBase((mem.read32(DNA_STRING_BASE) | 0) + DNA_BANK_NAME);
        host.callMethod(mem.read32(slot + DNA_SLOT_NAMES + i * 4) >>> 0, 0x114,
            [names, mem.read8(record + DNA_PROFILE_INDEX) & 0xff]);
    }
}

/**
 * F0x80097CFC(self, slot, show) (fightstg.s:21732-21983): the resource call
 * happens either way. With a non-zero third argument the header takes the
 * species under the strip cursor, "Switch" and "DNA DV" and the "MP" label take
 * their bank words, the price and the four MP-plate numbers take their values,
 * and the two row labels take the grey palette on the failures the original
 * tests. With zero all nine of those widgets are hidden.
 */
export function dnaPaneLabels(
    mem: DnaPaneMemory,
    self: number,
    slot: number,
    show: number,
    host: DnaPaneHost,
): void {
    const language = mem.read32(DNA_STRING_BASE) | 0;
    const res = host.resourceBase(language + DNA_BANK_UI);
    if (show === 0) {
        for (let i = 0; i < 5; i++) {
            const widget = mem.read32(slot + DNA_SLOT_SWITCH + i * 4) >>> 0;
            if (widget === 0) continue;
            host.callMethod(widget, 0x144, [0]);
        }
        for (let i = 0; i < 4; i++) {
            const widget = mem.read32(slot + DNA_SLOT_MP + i * 4) >>> 0;
            if (widget === 0) continue;
            host.callMethod(widget, 0x144, [0]);
        }
        return;
    }
    const active = mem.read32(DNA_PARTY_INDEX) | 0;
    const partner = mem.read32(self + DNA_PARTNER_SLOT) | 0;
    const activeRecord = (DNA_PARTY_BASE + DNA_PARTY_STRIDE * active) >>> 0;
    const partnerRecord = (DNA_PARTY_BASE + DNA_PARTY_STRIDE * partner) >>> 0;
    const cursor = mem.read32(self + DNA_STRIP_CURSOR) | 0;
    const species = mem.read16s(self + DNA_SPECIES + cursor * 2) | 0;
    const theirs = host.preselectRecord(species) >>> 0;
    const names = host.resourceBase(language + DNA_BANK_NAME);
    host.callMethod(mem.read32(slot + DNA_SLOT_HEADER) >>> 0, 0x114,
        [names, mem.read8(theirs + DNA_PROFILE_INDEX) & 0xff]);
    const switchRow = mem.read32(slot + DNA_SLOT_SWITCH) >>> 0;
    host.callMethod(switchRow, 0x114, [res, DNA_WORD_SWITCH]);
    // `li $a1, 0x7` is the delay slot of the jump both bit tests take, so the
    // acting record's 0x10 and the partner's both reach the grey value and only
    // the clear case keeps the 0 its own branch stored
    // (fightstg.s:21724-21738).
    const greySwitch = ((mem.read8(activeRecord + DNA_PARTY_AILMENTS) | 0) & 0x10) !== 0 ||
        ((mem.read8(partnerRecord + DNA_PARTY_AILMENTS) | 0) & 0x10) !== 0;
    host.callMethod(switchRow, 0x138, [greySwitch ? DNA_PALETTE_GREY : 0]);
    const dnaId = mem.read32(self + DNA_DNA_ID) | 0;
    if (dnaId === 0) return;
    const dnaRow = mem.read32(slot + DNA_SLOT_DNA) >>> 0;
    host.callMethod(dnaRow, 0x114, [res, DNA_WORD_DNA]);
    host.callMethod(mem.read32(slot + DNA_SLOT_MP_LABEL) >>> 0, 0x114, [res, DNA_WORD_MP]);
    const price = dnaPrice(mem, dnaId);
    setNumber(mem, host, mem.read32(slot + DNA_SLOT_PRICE) >>> 0, price);
    // The grey test runs in the original's order: the acting member's MP, the
    // partner's, 0x20 on either record, 0x08 on the acting record, then HP on
    // either record. It is the same seven-test chain the walker's
    // battle-party.ts dnaRejection states, so the pane reuses that rule.
    const grey =
        (mem.read16s(activeRecord + DNA_PARTY_MP) | 0) < price ||
        (mem.read16s(partnerRecord + DNA_PARTY_MP) | 0) < price ||
        ((mem.read8(activeRecord + DNA_PARTY_AILMENTS) | 0) & 0x20) !== 0 ||
        ((mem.read8(partnerRecord + DNA_PARTY_AILMENTS) | 0) & 0x20) !== 0 ||
        ((mem.read8(activeRecord + DNA_PARTY_AILMENTS) | 0) & 0x08) !== 0 ||
        (mem.read16s(activeRecord + DNA_PARTY_HP) | 0) <= 0 ||
        (mem.read16s(partnerRecord + DNA_PARTY_HP) | 0) <= 0;
    host.callMethod(dnaRow, 0x138, [grey ? DNA_PALETTE_GREY : 0]);
    // The MP plate: "MP", the acting member's current MP, the separator and
    // that member's maximum MP.
    host.callMethod(mem.read32(slot + DNA_SLOT_MP) >>> 0, 0x114, [res, DNA_WORD_MP]);
    setNumber(mem, host, mem.read32(slot + DNA_SLOT_MP + 4) >>> 0,
        mem.read16s(activeRecord + DNA_PARTY_MP) | 0);
    host.callMethod(mem.read32(slot + DNA_SLOT_MP + 8) >>> 0, 0x114, [res, DNA_WORD_SLASH]);
    setNumber(mem, host, mem.read32(slot + DNA_SLOT_MP + 12) >>> 0,
        mem.read16s(activeRecord + DNA_PARTY_MAX_MP) | 0);
}

/** fightstg.s:21848-21856, :21868-21876 and :21932-21940: +0x118(0, v) then +0x148(1). */
function setNumber(mem: DnaPaneMemory, host: DnaPaneHost, widget: number, value: number): void {
    host.callMethod(widget, 0x118, [0, value]);
    host.callMethod(widget, 0x148, [1]);
}

/** The Jogress MP price a DNA result id costs: 0x80042BDC + 18*(id - 1), unsigned. */
function dnaPrice(mem: DnaPaneMemory, dnaId: number): number {
    return mem.read16(DNA_PRICES + DNA_PRICE_STRIDE * ((dnaId - 1) | 0)) & 0xffff;
}

/**
 * F0x800979E4(self) (fightstg.s:21525-21572): the pane's frame always, and the
 * DNA row's backing and the MP plate when the partner carries a pairing.
 */
export function dnaPaneArt(mem: DnaPaneMemory, self: number, host: DnaPaneHost): void {
    // [0x80044F5C](0x455) is resolved before the draw context is built
    // (fightstg.s:21532-21540).
    const pack = host.packResolve(DNA_PACK_CHROME);
    host.initDrawContext();
    host.setLayer(DNA_LAYER, DNA_LAYER_BUCKET);
    host.setOrigin(DNA_ORIGIN, 0);
    host.drawSprite(pack, DNA_CEL_FRAME, DNA_FRAME_X, DNA_FRAME_Y);
    if ((mem.read32(self + DNA_DNA_ID) | 0) === 0) return;
    host.drawSprite(pack, DNA_CEL_DNA_ROW, DNA_DNA_ROW_X, DNA_DNA_ROW_Y);
    host.drawSprite(pack, DNA_CEL_MP_PLATE, DNA_PLATE_X, DNA_PLATE_Y);
}

/**
 * F0x800980E4 sub-state 0 (fightstg.s:22017-22020, :22046-22069, :22070-22189):
 * the build branch makes the species list from the strip config and closes the
 * option model left behind; the live branch reads the pad. Cross closes the
 * whole screen with -2, Circle opens the option sub-state and marks the row,
 * L1/R1 move the selected row (wrapping 2 to 0 and 0 to 2) and play the move
 * blip, and an idle frame refills the names and hides the options. Every branch
 * here goes straight to the shared tail without repainting.
 */
function dnaPaneStripTick(mem: DnaPaneMemory, self: number, slot: number, host: DnaPaneHost): void {
    if ((mem.read32(self + DNA_BUILD) | 0) === 0) {
        const model = host.createModel(DNA_PANE_CONFIG_STRIP);
        mem.write32(slot + DNA_SLOT_MODEL, model);
        mem.write32(model + DNA_MODEL_CURSOR, mem.read32(self + DNA_STRIP_CURSOR));
        const stale = mem.read32(slot + DNA_SLOT_OPTIONS) >>> 0;
        if (stale !== 0) host.callMethod(stale, 0x28, [DNA_CLOSE_LIST]);
        host.callMethod(self, 0x40, []);
        dnaPaneTail(mem, self, slot, host);
        return;
    }
    const pad = host.padRead(0) | 0;
    if ((pad & DNA_PAD_CANCEL) !== 0) {
        host.playSound(DNA_CANCEL_SOUND);
        mem.write32(mem.read32(self + DNA_WORDS) >>> 0, DNA_RESULT_CANCEL);
        host.callMethod(self, 0x28, [DNA_CLOSE_SCREEN]);
    } else if ((pad & DNA_PAD_CONFIRM) !== 0) {
        host.playSound(DNA_CONFIRM_SOUND);
        host.callMethod(self, 0x3c, []);
        dnaPaneNames(mem, self, slot, 0, host);
        markSpecies(mem, self, slot);
    } else if ((pad & (DNA_PAD_R1 | DNA_PAD_L1)) !== 0) {
        moveRow(mem, self, pad, host);
    } else {
        dnaPaneNames(mem, self, slot, 1, host);
        dnaPaneLabels(mem, self, slot, 0, host);
    }
    dnaPaneTail(mem, self, slot, host);
}

/**
 * F0x800980E4 sub-state 1 (fightstg.s:22034-22067, :22225-22344): the build
 * branch asks the acting member's profile for its DNA result id, which decides
 * whether the option list has one row or two and which of the two 0x20-byte
 * config blocks it is built from; the live branch reads the pad and every branch
 * repaints the pane first.
 */
function dnaPaneOptionsTick(mem: DnaPaneMemory, self: number, slot: number, host: DnaPaneHost): void {
    if ((mem.read32(self + DNA_BUILD) | 0) === 0) {
        dnaPaneFindPairing(mem, self, host);
        const paired = (mem.read32(self + DNA_DNA_ID) | 0) !== 0;
        // `addiu $v0, 0x3594` is the branch's delay slot, so $v0 is 0x800A3594
        // on both sides of it and the option list always comes from the block
        // 0x20 bytes along (fightstg.s:22364-22368). Only the row count differs.
        const config = DNA_PANE_CONFIG_OPTIONS;
        // `sw $a1, 0x20($v0)` is the factory call's delay slot, so the row count
        // lands in that block's word [0] before the factory reads it.
        mem.write32(config, paired ? 2 : 1);
        const model = host.createModel(config);
        mem.write32(slot + DNA_SLOT_OPTIONS, model);
        const stale = mem.read32(slot + DNA_SLOT_MODEL) >>> 0;
        if (stale !== 0) host.callMethod(stale, 0x28, [DNA_CLOSE_LIST]);
        host.callMethod(self, 0x40, []);
        dnaPaneArt(mem, self, host);
        dnaPaneTail(mem, self, slot, host);
        return;
    }
    const pad = host.padRead(0) | 0;
    // This sub-state tests CIRCLE first and sends a non-Circle frame on to the
    // Cross test (`andi $v0, $v1, 0x2000` / `beqz $v0, .L0x800986f8`,
    // fightstg.s:22246-22247, then `andi $v0, $v1, 0x4000` at :22375). It is the
    // other way round from the name strip above, which tests Cross first
    // (:22085). A frame carrying both therefore commits the confirm here.
    if ((pad & DNA_PAD_CONFIRM) !== 0) {
        host.playSound(DNA_CONFIRM_SOUND);
        dnaPaneCommit(mem, self, slot, host);
        dnaPaneTail(mem, self, slot, host);
        return;
    }
    if ((pad & DNA_PAD_CANCEL) !== 0) {
        host.playSound(DNA_CANCEL_SOUND);
        host.callMethod(self, 0x2c, [0]);
        dnaPaneLabels(mem, self, slot, 0, host);
        dnaPaneArt(mem, self, host);
    } else if ((pad & (DNA_PAD_R1 | DNA_PAD_L1)) !== 0) {
        moveRow(mem, self, pad, host);
        dnaPaneArt(mem, self, host);
    } else {
        dnaPaneNames(mem, self, slot, 0, host);
        dnaPaneLabels(mem, self, slot, 1, host);
        dnaPaneArt(mem, self, host);
    }
    dnaPaneTail(mem, self, slot, host);
}

/**
 * The L1/R1 pair both sub-states carry (fightstg.s:22086-22104, :22320-22338):
 * R1 raises the selected row and wraps 2 to 0, L1 lowers it and wraps 0 to 2,
 * and either plays the move blip. Both compare the moved value, so the stores
 * in the branch delay slots are what move the row.
 */
function moveRow(mem: DnaPaneMemory, self: number, pad: number, host: DnaPaneHost): void {
    const row = mem.read32(self + DNA_PREVIEW_OPTION) | 0;
    if ((pad & DNA_PAD_R1) !== 0) mem.write32(self + DNA_PREVIEW_OPTION, row + 1 === 3 ? 0 : row + 1);
    else if (row - 1 < 0) mem.write32(self + DNA_PREVIEW_OPTION, 2);
    else mem.write32(self + DNA_PREVIEW_OPTION, row - 1);
    host.playSound(DNA_MOVE_SOUND);
}

/**
 * The tick's shared tail (fightstg.s:22398-22452): the pane re-shows the
 * carry-over preview whenever the selected page differs from the confirmed one
 * (self+0x54 against self+0x58), or the species list's own cursor differs from
 * the strip cursor — in which case the list cursor is copied into self+0x64 and
 * the preview follows. Otherwise the panel already on screen stays.
 *
 * The one branch that decides "nothing changed" is the species list itself. When
 * the Switch / DNA DV rows have replaced it, `lw $v1, ($s3)` reads zero, and the
 * `move_ $v0, $zr` at fightstg.s:22344 is the DELAY SLOT of that `beqz`, so it
 * runs on both paths: the flag is cleared and the tail returns without asking for
 * a preview. Reading it as a separate statement is what made an earlier port
 * re-ask every frame (the raw word is 0x00001021 at 0x800987b8, `or $v0,$zero,
 * $zero`, inside the branch's delay slot).
 */
function dnaPaneTail(mem: DnaPaneMemory, self: number, slot: number, host: DnaPaneHost): void {
    const row = mem.read32(self + DNA_PREVIEW_OPTION) | 0;
    let proceed: number;
    // `li $v0, 0x1` is the delay slot of the compare, so a differing selection
    // always confirms, whatever the row is (fightstg.s:22408-22410).
    if ((mem.read32(self + DNA_SELECTED) | 0) !== row) {
        proceed = 1;
    } else {
        proceed = 0;
        const model = mem.read32(slot + DNA_SLOT_MODEL) >>> 0;
        if (model !== 0) {
            const cursor = mem.read32(model + DNA_MODEL_CURSOR) | 0;
            if (cursor !== (mem.read32(self + DNA_STRIP_CURSOR) | 0)) {
                // The copy is the `j`'s delay slot, so it happens on this path only.
                mem.write32(self + DNA_STRIP_CURSOR, cursor);
                proceed = 1;
            }
        }
    }
    if (proceed === 0) return;
    mem.write32(self + DNA_SELECTED, row);
    const combatant = mem.read32(self + DNA_COMBATANT);
    const species = mem.read32(self + DNA_STRIP_CURSOR);
    const open = mem.read32(slot + DNA_SLOT_PREVIEW_A) >>> 0;
    if (open !== 0) {
        host.callMethod(open, 0x28, [DNA_CLOSE_PREVIEW]);
        mem.write32(slot + DNA_SLOT_PREVIEW_B, host.spawnHandoff(combatant, row, species));
        return;
    }
    const other = mem.read32(slot + DNA_SLOT_PREVIEW_B) >>> 0;
    if (other !== 0) host.callMethod(other, 0x28, [DNA_CLOSE_PREVIEW]);
    mem.write32(slot + DNA_SLOT_PREVIEW_A, host.spawnHandoff(combatant, row, species));
}

/** The three reads a DNA pairing is made of, plus the price they cost. */
export interface DnaPairingAnswer {
    /** The acting record's halfword at +0x2A: the DNA action's own id. */
    resultId: number;
    /** u16 at 0x80042BDC + 0x12*(resultId - 1): what each member pays. */
    price: number;
}

/** The four fields of the 18-byte record the DNA action runs as a technique. */
export interface DnaActionRecord {
    /** +0x00: the MP cost, the same number the pane's commit reads. */
    mp: number;
    /** +0x02. */
    power: number;
    /** +0x04: the category the technique path rolls against. 2 and 3 are the
     *  physical and magical rows, and F0x8008f714 uses exactly that test to
     *  choose the live actor's own record as the attack's source. */
    category: number;
    /** +0x07. */
    element: number;
    /** +0x10: the action clip. Every DNA action's own record carries 12. */
    clip: number;
}

/** The reads the shared rule makes: bytes and halfwords at absolute addresses. */
export interface DnaPairingMemory {
    read8(addr: number): number;
    read16(addr: number): number;
}

/**
 * The DNA command's own answer, and the ONE place it is written down. Both the
 * pane and the battle command path call this, over the same extracted bytes.
 *
 * FIGHTSTG_F0x800980e4 :22132-22163 (fightstg.s, 0x8009832c-0x800983b8), the
 * build branch of the option sub-state:
 *
 *   lbu $v1, 0x3d($s0)   0x9203003d   the acting record's DNA partner, a 1-based
 *                                      profile index
 *   bnez $v1, …          0x14200000   zero means this form cannot DNA at all
 *   lbu $v0, 0x55($v0)   0x90420055   the cursor species' OWN 1-based index
 *   bne $v1, $v0, …      0x14200000   and they must be equal
 *   lhu $v0, 0x2a($s0)   0x9602002a   the acting record's DNA result/action id
 *   sw  $v0, 0x7c($s1)                 → the pane's DNA id
 *
 * The registers, from the raw words: `move $s0, $v0` (0x00a09021) is the DELAY
 * SLOT of the second species getter's `jalr $v1` (0x80098384), so it runs BEFORE
 * that call and $s0 is the FIRST fetch — the acting member's record. $v0 at the
 * +0x55 read is therefore the cursor species' record, not $s0: the .s listing
 * prints $v0 and the opcode word agrees. The same block also gates on the acting
 * combatant record's +0x1A (the blast byte), which the caller checks.
 *
 * The price is the same number the confirm charges: F0x800980e4 :22296-22301
 * (0x800985b4-0x800985d8) builds `0x80042bdc + 0x12*(self+0x7C - 1) + row` and
 * `lhu`s it, so the row's +1 lands on an odd address and the PlayStation's
 * unaligned halfword load rounds down to the even one. Both rows read the same
 * halfword, and 0x8009864c/0x80098680 debit it from BOTH records.
 *
 * A record address of 0 is the species getter's "no such form" answer; the
 * original would read through address 0, so this refuses the pairing instead.
 */
export function dnaPairing(
    mem: DnaPairingMemory,
    actorRecord: number,
    partnerRecord: number,
): DnaPairingAnswer | null {
    if (actorRecord === 0 || partnerRecord === 0) return null;
    const partner = mem.read8(actorRecord + DNA_PROFILE_PAIR) & 0xff;
    const theirsIndex = mem.read8(partnerRecord + DNA_PROFILE_INDEX) & 0xff;
    if (partner === 0 || partner !== theirsIndex) return null;
    const resultId = mem.read16(actorRecord + DNA_PROFILE_RESULT) & 0xffff;
    return { resultId, price: dnaActionPrice(mem, resultId) };
}

/**
 * The MP price of one DNA action: the first halfword of its own 18-byte record
 * at 0x80042BDC + 0x12*(resultId - 1). Id 0 has no record (the table starts at
 * id 1), so it answers 0 rather than reading the row below the base.
 */
export function dnaActionPrice(mem: DnaPairingMemory, resultId: number): number {
    if (resultId < 1) return 0;
    return mem.read16(DNA_PRICES + DNA_PRICE_STRIDE * (resultId - 1)) & 0xffff;
}

/**
 * The 18-byte record a DNA action runs as. F0x8008f714 (fightstg.s:12957-12992,
 * 0x8008f760-0x8008f7d4) builds `0x80042bca + 9*id` — one row BELOW the
 * extracted table, the code's own 1-based convention — and reads the element
 * byte at +0x04 to pick the actor source and the clip byte at +0x10 to decide
 * the presentation: 12 is the Jogress director (presentation command 0x3A),
 * anything else is the ordinary action. So the DNA action's own damage numbers
 * are this record's, not a profile field's.
 */
export function dnaActionRecord(mem: DnaPairingMemory, resultId: number): DnaActionRecord | null {
    if (resultId < 1) return null;
    const at = DNA_PRICES + DNA_PRICE_STRIDE * (resultId - 1);
    return {
        mp: mem.read16(at) & 0xffff,
        power: mem.read16(at + 2) & 0xffff,
        category: mem.read8(at + 4) & 0xff,
        element: mem.read8(at + 7) & 0xff,
        clip: mem.read8(at + 0x10) & 0xff,
    };
}

/**
 * F0x800980E4 :22138-22182: the pane writes the shared answer into its own
 * +0x7C. A blast-flagged actor and a form the profile table does not hold both
 * leave the field as the build branch found it, which is 0.
 */
function dnaPaneFindPairing(mem: DnaPaneMemory, self: number, host: DnaPaneHost): void {
    const active = mem.read32(DNA_PARTY_INDEX) | 0;
    const activeRecord = (DNA_PARTY_BASE + DNA_PARTY_STRIDE * active) >>> 0;
    if ((mem.read8(activeRecord + DNA_PARTY_BLAST) | 0) !== 0) return;
    const mine = host.preselectRecord(mem.read16s(activeRecord + DNA_PARTY_SPECIES) | 0) >>> 0;
    const cursor = mem.read32(self + DNA_STRIP_CURSOR) | 0;
    const species = mem.read16s(self + DNA_SPECIES + cursor * 2) | 0;
    const theirs = host.preselectRecord(species) >>> 0;
    const answer = dnaPairing(mem, mine, theirs);
    mem.write32(self + DNA_DNA_ID, answer === null ? 0 : answer.resultId);
}

/**
 * F0x800980E4 :22248-22393: the confirm on the option sub-state. The sound plays
 * first, then row 0 ("Switch") refuses on 0x10 of either record and otherwise
 * answers with the species under the cursor, and row 1 ("DNA DV") runs the
 * seven tests in the original's order before taking the price off both
 * members' MP and answering with the row, the species and the DNA result id.
 * Every failing test falls through to the repaint: no message, no second sound,
 * the cursor where it was.
 */
function dnaPaneCommit(mem: DnaPaneMemory, self: number, slot: number, host: DnaPaneHost): void {
    const model = mem.read32(slot + DNA_SLOT_OPTIONS) >>> 0;
    if (model === 0) return;
    const row = mem.read32(model + DNA_MODEL_CURSOR) | 0;
    const active = mem.read32(DNA_PARTY_INDEX) | 0;
    const partner = mem.read32(self + DNA_PARTNER_SLOT) | 0;
    const activeRecord = (DNA_PARTY_BASE + DNA_PARTY_STRIDE * active) >>> 0;
    const partnerRecord = (DNA_PARTY_BASE + DNA_PARTY_STRIDE * partner) >>> 0;
    const activeAilments = mem.read8(activeRecord + DNA_PARTY_AILMENTS) | 0;
    const partnerAilments = mem.read8(partnerRecord + DNA_PARTY_AILMENTS) | 0;
    const words = mem.read32(self + DNA_WORDS) >>> 0;
    if (row === 0) {
        if (((activeAilments | partnerAilments) & 0x10) !== 0) {
            dnaPaneArt(mem, self, host);
            return;
        }
        const species = mem.read16s(self + DNA_SPECIES + (mem.read32(self + DNA_STRIP_CURSOR) | 0) * 2) | 0;
        mem.write32(words, species << 4);
        host.callMethod(self, 0x2c, [0]);
        dnaPaneLabels(mem, self, slot, 0, host);
        markOption(mem, self, model);
        dnaPaneArt(mem, self, host);
        return;
    }
    // The price table address is built from the result id alone: `addiu $a2,
    // $v0, 0x2bdc` at fightstg.s:22294 has the `lui $v0, 0x8004` at :22292 in its
    // DELAY SLOT, so the selected row never reaches the address — both rows read
    // the same even halfword at 0x80042BDC + 0x12*(id - 1).
    const dnaId = mem.read32(self + DNA_DNA_ID) | 0;
    const price = mem.read16(DNA_PRICES + DNA_PRICE_STRIDE * ((dnaId - 1) | 0)) & 0xffff;
    // Both MP compares are SIGNED halfwords (`lh $v1, 0xc($s0)` at :22302 and
    // `lh $v0, 0xc($s2)` at :22308), as in the grey test above.
    const reject =
        (mem.read16s(activeRecord + DNA_PARTY_MP) | 0) < price ||
        (mem.read16s(partnerRecord + DNA_PARTY_MP) | 0) < price ||
        (activeAilments & 0x20) !== 0 ||
        (partnerAilments & 0x20) !== 0 ||
        (activeAilments & 0x08) !== 0 ||
        (mem.read16s(activeRecord + DNA_PARTY_HP) | 0) <= 0 ||
        (mem.read16s(partnerRecord + DNA_PARTY_HP) | 0) <= 0;
    if (reject) {
        dnaPaneArt(mem, self, host);
        return;
    }
    mem.write16(activeRecord + DNA_PARTY_MP,
        ((mem.read16(activeRecord + DNA_PARTY_MP) - price) & 0xffff));
    mem.write16(partnerRecord + DNA_PARTY_MP,
        ((mem.read16(partnerRecord + DNA_PARTY_MP) - price) & 0xffff));
    const species = mem.read16s(self + DNA_SPECIES + (mem.read32(self + DNA_STRIP_CURSOR) | 0) * 2) | 0;
    mem.write32(words, (row | (species << 4)) >>> 0);
    mem.write32(mem.read32(self + DNA_SPECIES_OUT) >>> 0, dnaId);
    host.callMethod(self, 0x2c, [0]);
    dnaPaneLabels(mem, self, slot, 0, host);
    markOption(mem, self, model);
    dnaPaneArt(mem, self, host);
}

/**
 * fightstg.s:22250 / :22296 / :22416: the option confirm freezes its list model by
 * writing the pane's own +0x14 — the build counter, held at 1 — into the model's
 * +0x54. The shared list widget skips its whole input block when that word is
 * non-zero (`F0x8009AF4C`, fightstg.s:22448-22450), so this is the "you have
 * chosen, stop moving" flag.
 */
function markOption(mem: DnaPaneMemory, self: number, model: number): void {
    if (model !== 0) mem.write32(model + DNA_MODEL_MARKER, mem.read32(self + DNA_BUILD));
}

/**
 * fightstg.s:22224: Circle in the name strip freezes the species list by writing
 * the pane's own +0x14 into the list model's +0x54 (`sw $s0, 0x54($v0)` at
 * 0x8009849c). On this path the value is the BUILD flag, not the combatant: the
 * sub-state-0 dispatch loaded it into $s0 at fightstg.s:22053 (`lw $s0,
 * 0x14($s1)`) and the live branch below is only entered when it is 1, so the
 * store always writes 1. Writing the partner's combatant index (self+0x60) here
 * instead is what used to leave the list unfrozen for a partner in roster slot 0
 * — the shared list widget skips its whole input block only when +0x54 is
 * non-zero (`lw $v0, 0x54($s1)` / `bnez` at fightstg.s:25089-25091).
 */
function markSpecies(mem: DnaPaneMemory, self: number, slot: number): void {
    const model = mem.read32(slot + DNA_SLOT_MODEL) >>> 0;
    if (model !== 0) mem.write32(model + DNA_MODEL_MARKER, mem.read32(self + DNA_BUILD));
}