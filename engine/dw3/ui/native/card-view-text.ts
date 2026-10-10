// The shared card-view text context: the resident card class
// (F0x8001EBF8, its record selector F0x8001E7EC, the kind predicate F0x8001EBCC
// and the draw slots) with the real CARDPAK record store and the card-art
// primitive F0x8001E9E0.
//
// Both card front-ends that show a card's values read this ONE context: the
// Card Album (engine/dw3/ui/album-session.ts, pro/stcrdabm) and the Card Folder
// editor's grid (engine/dw3/ui/folder-session.ts over
// engine/dw3/ui/native/folder-card-grid.ts, pro/stcrddek). Before this module
// each session carried its own copy of the boundary -- a hand-built
// eight-byte-per-card colour table plus stubs for the selector, the kind word
// and the primitive. That duplication is what this module removes: the class is
// ported once in engine/dw3/ui/card-view.ts, the records are materialised once
// here, and the primitive is ported here.
//
// WHAT A CARDPAK RECORD HOLDS (docs/research/card/CARD-DUEL-VERIFIED.md S8.1,
// section 23 of the same file; docs/research/ui/card-album-screen-2026-08-14.md
// S2): five disc files CARDPAK0..4.BIN, 64 records of 0x62C bytes each. The
// leading bytes are the ones every screen reads:
//
//   +0x00 u8  colour 1..6 = white, blue, green, red, black, brown
//   +0x01 u8  AP
//   +0x02 u8  HP
//   +0x03 u8  kind: 0x10 = Digimon, 1..8 = Program category
//   +0x04 u8  Program cost
//   +0x05 u8  summon cost (S-Energy of the card's colour)
//   +0x06 u8  level 1..5
//   +0x07 u8  zero on every record (no meaning established)
//   +0x08 u16 strength rank, ascending FROM the strongest
//   +0x0A u16 combo target card id
//   +0x0C..  the record's own 8bpp TIM, then 1548 bytes of artwork
//
// Every one of these leading fields that has an established meaning is carried
// end to end: tools/extract_card_catalog.py reads it off the disc into
// card_catalog.json, the two screens' adapters (web/cardalbum-translated.js and
// web/carddeck-translated.js) map it into this `CardRecord`, and
// installCardRecords below writes it at the real 0x62C stride so the selector
// resolves it. A field is carried for BOTH card kinds, not only the half that
// happens to hold it non-zero: a Program's summon cost and level, and a
// Digimon's program cost, are zero on this disc, and carrying them (rather than
// defaulting them) is what lets a screen read the disc's real byte.
//
// HOW THE SELECTOR CHOOSES IT (F0x8001E7EC, fns.s L15967-L15995 -- ported in
// engine/dw3/ui/card-view.ts resolveCardRecord): `id > 0` takes file
// `(id-1)>>6` from the five-word table D0x8004DFB8 and the record at
// `((id-1)&0x3F)*0x62C` inside it; `id <= 0` resolves to file 0 with no offset.
// The chosen record pointer lands in the class context's +0x00.
//
// THE KIND TABLE: D0x8004DFCC is static executable data (the seventeen words
// `dw2003_exe_data/src/data.rs` L4237-L4253; docs/research/ui/
// card-album-screen-2026-08-14.md S2). The album's page mask reads the record's
// +0x03 kind and indexes it; a Digimon (kind 0x10) reads 0 and shows AP/HP, and
// a Program (kinds 1..14) reads non-zero and shows its class plate. The sessions
// do not load the executable image, so this module installs the table.
//
// THE CARD-ART PRIMITIVE F0x8001E9E0 `queueCurrentViewPrimitive(x, y)`: builds
// one 0x1C-byte textured GPU sprite from the current record's cell and links it
// into the ordering table at class+0x28, then a DR_TPAGE packet at prim+0x14.
// Decoded from exe-decomp/c/_asm/F0x8001e9e0.s (authority 2) and
// exe-decomp/c/F0x8001e9e0.c. The two device calls -- the picture service's
// new-primitive slot [D0x8004DE10+0x158] and its emit slot [D0x8004DE10+0x15C]
// -- are host boundaries, exactly as the class's LoadImage is.
//
// Authority: the record layout, selector and kind table are established in
// docs/research/card/CARD-DUEL-VERIFIED.md (canonical) and
// docs/research/ui/card-album-screen-2026-08-14.md; the primitive is read from
// the original assembly. Nothing here executes a PlayStation instruction.

import {
    CARD_FILE_TABLE,
    CARD_KIND_TABLE,
    CARD_RECORD_STRIDE,
    CARD_RECORDS_PER_FILE,
    CARD_HELPER_SIZE,
    CARD_VIEW_SIZE,
    commitCardView,
    constructCardView,
    currentViewTableWord,
    dispatchCurrentDisplayView,
    resolveCardRecord,
    setCurrentObject4_8,
    setCurrentObjectC_10,
    setCurrentViewSize_14_18,
    type CardViewHost,
    type CardViewMemory,
} from "../card-view.ts";
import { CURRENT_VIEW_CELL } from "../../globals.ts";

/** The five CARDPAK file disc ids, the static table at D0x8004DFB8. */
export const CARD_FILE_IDS: readonly number[] = [0x7f6, 0x7f7, 0x7f8, 0x7f9, 0x7fa];
/** The first file id, so `discId - CARD_FILE_ID0` indexes the file. */
export const CARD_FILE_ID0 = 0x7f6;
/** The record-kind words at D0x8004DFCC (seventeen words; docs verify S2). */
export const CARD_KIND_TABLE_WORDS: readonly number[] = [
    0, 1, 1, 1, 2, 1, 1, 2, 2, 1, 1, 2, 1, 1, 2, 0, 0,
];
/**
 * The RAM base of CARDPAK file 0. RAM is 2MB (engine/native/memory.ts); the
 * five files at 0x62C stride need 5*64*0x62C = 0x7B700 bytes, and this region
 * sits between the widget arena (ends at 0x80100000) and the text banks
 * (0x801E0000), so it fits without wrapping.
 */
export const CARD_PAK_FILES_BASE = 0x80100000;
/** The leading record bytes materialised: through combo target (+0x0A). */
export const CARD_RECORD_LEAD = 0x0c;

/** One CARDPAK record's leading fields, as the disc holds them. */
export interface CardRecord {
    colour: number;
    ap: number;
    hp: number;
    kind: number;
    programCost: number;
    summonCost: number;
    level: number;
    strengthRank?: number;
    comboInto?: number;
}

/** The record address for a 1-based card id, or file 0's base for id <= 0. */
export function cardRecordAddress(id: number): number {
    const card = id | 0;
    if (card > 0) return (CARD_PAK_FILES_BASE + Math.imul(card - 1, CARD_RECORD_STRIDE)) >>> 0;
    return CARD_PAK_FILES_BASE >>> 0;
}

/** The file base for a CARDPAK disc id (+0x7F6..+0x7FA). */
export function cardPakFileBase(discId: number): number {
    return (CARD_PAK_FILES_BASE +
        Math.imul((discId | 0) - CARD_FILE_ID0, CARD_RECORDS_PER_FILE * CARD_RECORD_STRIDE)) >>> 0;
}

/** Install the five file ids and the seventeen-word kind table (static exe data). */
export function installCardViewTables(mem: CardViewMemory): void {
    for (let i = 0; i < CARD_FILE_IDS.length; i++) {
        mem.write32(CARD_FILE_TABLE + i * 4, CARD_FILE_IDS[i] as number);
    }
    for (let i = 0; i < CARD_KIND_TABLE_WORDS.length; i++) {
        mem.write32(CARD_KIND_TABLE + i * 4, CARD_KIND_TABLE_WORDS[i] as number);
    }
}

/**
 * Materialise the leading bytes of every record at the real 0x62C stride, so the
 * selector resolves them exactly as the disc does. `records[i]` is card id i+1.
 * The artwork at +0x0C is not written: the browser paints the extracted atlas,
 * and every screen reads only the leading values.
 */
export function installCardRecords(mem: CardViewMemory, records: readonly CardRecord[]): void {
    for (let i = 0; i < records.length; i++) {
        const card = records[i] as CardRecord;
        const base = (CARD_PAK_FILES_BASE + Math.imul(i, CARD_RECORD_STRIDE)) >>> 0;
        mem.write8(base + 0x00, card.colour & 0xff);
        mem.write8(base + 0x01, card.ap & 0xff);
        mem.write8(base + 0x02, card.hp & 0xff);
        mem.write8(base + 0x03, card.kind & 0xff);
        mem.write8(base + 0x04, card.programCost & 0xff);
        mem.write8(base + 0x05, card.summonCost & 0xff);
        mem.write8(base + 0x06, card.level & 0xff);
        if (card.strengthRank !== undefined) mem.write16(base + 0x08, card.strengthRank & 0xffff);
        if (card.comboInto !== undefined) mem.write16(base + 0x0a, card.comboInto & 0xffff);
    }
}

/**
 * Everything the card-view text context reaches outside itself. The class-owned
 * pieces (the context bytes, the record table, the kind table) are the module's;
 * the four device services are the host's.
 */
export interface CardViewTextHost {
    /** Allocate the 0x54-byte context (and the 0x34-byte upload helper). */
    allocate(size: number): number;
    /** F0x80025B14 LoadImage: the VRAM transfer (the browser paints the atlas). */
    loadImage(x: number, y: number, w: number, h: number, data: number): void;
    /** F0x8001DA84(key): the registered view for a handle, or 0. */
    findRegisteredHandleByKey(key: number): number;
    /** [view+0x138](arg): the view's dispatch method. */
    callViewMethod(view: number, arg: number): number;
    /** [D0x8004DE10+0x158](): a fresh GPU primitive to fill. */
    newPrimitive(): number;
    /** [D0x8004DE10+0x15C](prim): emit a filled primitive. */
    emitPrimitive(prim: number): void;
}

/** The assembled context: card-view class + primitive, one per screen. */
export class CardViewTextContext {
    private readonly mem: CardViewMemory;
    private readonly host: CardViewTextHost;
    private readonly ctx: number;
    private helper = 0;

    constructor(mem: CardViewMemory, host: CardViewTextHost) {
        this.mem = mem;
        this.host = host;
        this.ctx = host.allocate(CARD_VIEW_SIZE) >>> 0;
    }

    /** F0x8001EBF8(ctx): build the class context and publish it to [gp+0x1B8]. */
    init(): void {
        constructCardView(this.mem, this.ctx);
    }

    /** F0x8001E7EC(id): select the record for a 1-based card id. */
    select(id: number): void {
        resolveCardRecord(this.mem, this.viewHost(), id | 0);
    }

    /** F0x8001EBCC(): the current record's kind-table word (nonzero = plate). */
    kind(): number {
        return currentViewTableWord(this.mem) | 0;
    }

    /** A byte of the current record, at the selected pointer (ctx+0x00). */
    byte(offset: number): number {
        const ctx = this.mem.read32(CURRENT_VIEW_CELL) | 0;
        const record = this.mem.read32(ctx) | 0;
        if (record === 0) return 0;
        return this.mem.read8(record + (offset | 0)) & 0xff;
    }

    /** F0x8001E98C(x, y): the first destination pair (ctx+0x04/+0x08). */
    setPairA(x: number, y: number): void {
        setCurrentObject4_8(this.mem, x | 0, y | 0);
    }

    /** F0x8001E9A0(x, y): the second destination pair (ctx+0x0C/+0x10). */
    setPairB(x: number, y: number): void {
        setCurrentObjectC_10(this.mem, x | 0, y | 0);
    }

    /** F0x8001E9B4(col, row): the cell column/row (ctx+0x14/+0x18). */
    setSize(col: number, row: number): void {
        setCurrentViewSize_14_18(this.mem, col | 0, row | 0);
    }

    /** F0x8001E890(): upload the current record's artwork (LoadImage boundary). */
    commit(): void {
        if (this.helper === 0) this.helper = this.host.allocate(CARD_HELPER_SIZE) >>> 0;
        commitCardView(this.mem, this.viewHost(), this.helper);
    }

    /** F0x8001E938(key, arg): dispatch one pass through the registered view. */
    dispatch(key: number, arg: number): number {
        return dispatchCurrentDisplayView(this.mem, this.viewHost(), key | 0, arg | 0) | 0;
    }

    /** F0x8001E9E0(x, y): emit the current record's one cell primitive. */
    drawCell(x: number, y: number): void {
        queueCurrentViewPrimitive(this.mem, this.host, x | 0, y | 0);
    }

    /** The class context address (the allocation the registry publishes). */
    address(): number {
        return this.ctx >>> 0;
    }

    private viewHost(): CardViewHost {
        return {
            resourceGetBase: (discId: number) => cardPakFileBase(discId) | 0,
            loadImage: (x, y, w, h, data) => this.host.loadImage(x, y, w, h, data),
            findRegisteredHandleByKey: (key) => this.host.findRegisteredHandleByKey(key) | 0,
            callViewMethod: (view, arg) => this.host.callViewMethod(view, arg) | 0,
        };
    }
}

// ── F0x8002915c: the DR_TPAGE packet builder ────────────────────────────────
//
// exe-decomp/c/F0x8002915c.c. arg0+0x3 = 1; arg0+0x4 = (arg2 ? 0xE1000200 :
// 0xE1000000) | (arg3 & 0x9FF) | (arg1 ? 0x400 : 0).
export function buildTpagePacket(
    mem: CardViewMemory,
    prim: number,
    arg1: number,
    arg2: number,
    tpage: number,
): void {
    mem.write8(prim + 0x3, 1);
    const word = (((arg2 | 0) !== 0 ? 0xe1000200 : 0xe1000000) |
        ((tpage | 0) & 0x9ff) |
        ((arg1 | 0) !== 0 ? 0x400 : 0)) >>> 0;
    mem.write32(prim + 0x4, word);
}

/**
 * F0x8001E9E0(x, y): build one 0x1C-byte textured sprite for the current record
 * and a DR_TPAGE packet, link both into the ordering table at class+0x28, and
 * hand the sprite to the picture service's emit slot. Read from
 * exe-decomp/c/_asm/F0x8001e9e0.s. The two service calls are the host's.
 */
export function queueCurrentViewPrimitive(
    mem: CardViewMemory,
    host: Pick<CardViewTextHost, "newPrimitive" | "emitPrimitive">,
    x: number,
    y: number,
): void {
    const ctx = mem.read32(CURRENT_VIEW_CELL) | 0;
    const prim = host.newPrimitive() | 0;
    const col = mem.read32(ctx + 0x14) | 0;
    const pitch = mem.read32(ctx + 0x1c) | 0;
    const row = mem.read32(ctx + 0x18) | 0;
    const pairBase = mem.read32(ctx + 0x10) | 0;
    const clutX = (mem.read32(ctx + 0x0c) | 0) >> 4;
    const tpageBits = mem.read32(ctx + 0x08) | 0;
    const pageBase = mem.read32(ctx + 0x04) | 0;

    mem.write8(prim + 0x3, 4);
    mem.write8(prim + 0x7, (mem.read32(ctx + 0x20) | 0) !== 0 ? 0x66 : 0x64);
    mem.write16(prim + 0x8, x & 0xffff);
    mem.write8(prim + 0x4, 0x80);
    mem.write8(prim + 0x5, 0x80);
    mem.write8(prim + 0x6, 0x80);
    mem.write16(prim + 0xa, y & 0xffff);
    mem.write8(prim + 0xc, ((col & 0x3) << 5) & 0xff);
    mem.write8(prim + 0xd, (row << 5) & 0xff);
    mem.write16(prim + 0x10, 0x20);
    mem.write16(prim + 0x12, 0x20);

    // The CLUT word: ((row + base + col*pitch) << 6) | ((ctx+0xC >> 4) & 0x3F).
    const clut = (((row + pairBase + Math.imul(col, pitch)) << 6) | (clutX & 0x3f)) & 0xffff;
    mem.write16(prim + 0xe, clut);

    // Link the sprite into the ordering table. ctx+0x28 holds a POINTER to the
    // table's tag word; each link keeps that word's high byte and takes the
    // low 24 bits as the next pointer (exe-decomp/c/_asm/F0x8001e9e0.s:
    // `lw $v0, 0x28($a0)` then `lw $v0, ($v0)`).
    const tag = mem.read32(ctx + 0x28) | 0;
    mem.write32(prim, ((mem.read32(prim) & 0xff000000) | (mem.read32(tag) & 0x00ffffff)) >>> 0);
    mem.write32(tag, ((mem.read32(tag) & 0xff000000) | (prim & 0x00ffffff)) >>> 0);

    // The texpage: ((ctx+0x8 & 0x100) >> 4) | (((ctx+0x4 + col*0x10) & 0x3C0) >> 6)
    //   | 0xA0 | ((ctx+0x8 & 0x200) << 2).
    const tpage = (((tpageBits & 0x100) >> 4) |
        ((((pageBase + Math.imul(col, 0x10)) & 0x3c0) >> 6)) |
        0xa0 |
        ((tpageBits & 0x200) << 2)) >>> 0;
    buildTpagePacket(mem, prim + 0x14, 0, 1, tpage);

    // Link the DR_TPAGE packet in after the sprite.
    mem.write32(prim + 0x14, ((mem.read32(prim + 0x14) & 0xff000000) |
        (mem.read32(tag) & 0x00ffffff)) >>> 0);
    mem.write32(tag, ((mem.read32(tag) & 0xff000000) |
        ((prim + 0x14) & 0x00ffffff)) >>> 0);

    host.emitPrimitive((prim + 0x1c) >>> 0);
}
