// The card-view class (resident F0x8001EBF8 and its ten slots), translated from
// the EXE.
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/card-view-oracle.test.js runs the seven executed rows and the
// helper family through engine/native on the shipped resident image and
// compares the ordered LoadImage calls and every written byte.
//
// DECODED: the accepted `card-view-rows-contract` (researcher B) and
// `card-view-extras-contract` (researcher A) answers, checked against
// `exe-decomp/c/_asm/F0x8001{ebf8,e7ec,e890,e938,e9{8c,a0,b4}}.s` and
// `exe-decomp/c/F0x8001{ffa8,fd1c,fd28,fd3c,fd50}.c`.
//
// The class is ONE 0x54-byte context, published to `[gp+0x1B8]` by its
// constructor; every slot re-reads that singleton instead of taking a receiver.
// +0x00 the current card-record pointer, +0x04/+0x08 and +0x0C/+0x10 the two
// destination pairs, +0x14/+0x18 the column/row, +0x1C the cell pitch (the
// constructor presets 8), +0x20 the primitive flag, +0x24/+0x28 the last
// dispatched view and its method result, +0x2C..+0x50 the slots.
//
// The upload path is the helper context F0x8001FFA8: a second 0x34-byte
// singleton at `[gp+0x1D0]` whose +0x20 slot is F0x8001FD50, the PS1 TIM
// uploader. It calls F0x80025B14 = libgpu LoadImage (the debug name at
// D0x80010404 reads "LoadImage"), so that transfer is the host boundary here.
//
// NOT ported deliberately: the helper's +0x2C F0x8001FE38 and +0x30
// F0x8001FF9C, and the class's +0x34 queueCurrentViewPrimitive, +0x48 setPitch,
// +0x4C setFlag and +0x50 tableWord. None executes on the probe's screen paths;
// the constructor still installs their original addresses as data.

import { zeroFill } from "../zero-fill.ts";
import { CURRENT_VIEW_CELL, setCurrentView } from "../globals.ts";
import { BOOT_GP } from "./text-element-setters.ts";

export interface CardViewMemory {
    read8(addr: number): number;
    read16(addr: number): number;
    read32(addr: number): number;
    write8(addr: number, value: number): void;
    write16(addr: number, value: number): void;
    write32(addr: number, value: number): void;
}

export interface CardViewHost {
    /** F0x80013E5C resourceGetBase(discId): the RAM base of a card file. */
    resourceGetBase(discId: number): number;
    /** F0x80025B14 LoadImage(x, y, w, h, data): the VRAM transfer boundary. */
    loadImage(x: number, y: number, w: number, h: number, data: number): void;
    /** F0x8001DA84(key): the registered view object for a handle, or 0. */
    findRegisteredHandleByKey(key: number): number;
    /** [view+0x138](arg): the view's dispatch method (original code). */
    callViewMethod(view: number, arg: number): number;
}

/** The class context size. */
export const CARD_VIEW_SIZE = 0x54;
/** `[gp+0x1D0]`: the TIM/upload helper context's singleton cell. */
export const CARD_HELPER_CELL = (BOOT_GP + 0x1d0) >>> 0;
/** The helper context size. */
export const CARD_HELPER_SIZE = 0x34;
/** `D0x8004DFB8`: the five card-file disc ids (CARDPAK0..4). */
export const CARD_FILE_TABLE = 0x8004dfb8;
/** `D0x8004DFCC`: the record-kind table the +0x50 slot indexes. */
export const CARD_KIND_TABLE = 0x8004dfcc;
/** One card record: 64 per file, 1580 bytes each. */
export const CARD_RECORD_STRIDE = 0x62c;
export const CARD_RECORDS_PER_FILE = 0x40;
/** The constructor's preset cell pitch. */
export const CARD_VIEW_DEFAULT_PITCH = 8;

/** The class's ten slots, exactly the addresses F0x8001EBF8 stores. */
export const CARD_VIEW_METHODS: readonly (readonly [number, number])[] = [
    [0x2c, 0x8001e7ec], [0x30, 0x8001e890], [0x34, 0x8001e9e0], [0x38, 0x8001e938],
    [0x3c, 0x8001e98c], [0x40, 0x8001e9a0], [0x44, 0x8001e9b4], [0x48, 0x8001e9c8],
    [0x4c, 0x8001e9d4], [0x50, 0x8001ebcc],
];

/** The helper context's six slots. */
export const CARD_HELPER_METHODS: readonly (readonly [number, number])[] = [
    [0x1c, 0x8001fd1c], [0x20, 0x8001fd50], [0x24, 0x8001fd28],
    [0x28, 0x8001fd3c], [0x2c, 0x8001fe38], [0x30, 0x8001ff9c],
];

/** F0x8001EBF8(ctx): zero the 0x54 bytes, install the ten slots, publish, pitch 8. */
export function constructCardView(mem: CardViewMemory, ctx: number): void {
    zeroFill(mem, ctx, CARD_VIEW_SIZE);
    for (const [off, addr] of CARD_VIEW_METHODS) mem.write32(ctx + off, addr);
    setCurrentView(mem, ctx | 0);
    mem.write32(ctx + 0x1c, CARD_VIEW_DEFAULT_PITCH);
}

/**
 * F0x8001E7EC(id): the record selector. `id > 0` picks the file by `(id-1)>>6`
 * and the slot by `(id-1)&0x3F`; anything else uses file 0's base with no
 * offset. The chosen file's base comes from the resource service; the record
 * lands at the singleton's +0x00.
 */
export function resolveCardRecord(mem: CardViewMemory, host: CardViewHost, id: number): void {
    const ctx = mem.read32(CURRENT_VIEW_CELL) | 0;
    const card = id | 0;
    if (card > 0) {
        const n = (card - 1) | 0;
        const discId = mem.read32(CARD_FILE_TABLE + (n >> 6) * 4) | 0;
        const base = host.resourceGetBase(discId) | 0;
        mem.write32(ctx, (base + (n & 0x3f) * CARD_RECORD_STRIDE) >>> 0);
        return;
    }
    const discId = mem.read32(CARD_FILE_TABLE) | 0;
    mem.write32(ctx, host.resourceGetBase(discId) >>> 0);
}

/**
 * F0x8001FFA8(helper): build the upload helper context on caller-owned 0x34
 * bytes. It installs its six slots, publishes itself to `[gp+0x1D0]` through
 * its own +0x1C slot, and presets +0x18. The destination pairs are NOT written
 * here - the driven +0x24/+0x28 slots write them.
 */
export function cardViewHelperInit(mem: CardViewMemory, helper: number): void {
    zeroFill(mem, helper, CARD_HELPER_SIZE);
    for (const [off, addr] of CARD_HELPER_METHODS) mem.write32(helper + off, addr);
    cardViewHelperPublish(mem, helper);
    mem.write32(helper + 0x18, 0xa800);
}

/** F0x8001FD1C(helper): publish the helper context to `[gp+0x1D0]`. */
export function cardViewHelperPublish(mem: CardViewMemory, helper: number): void {
    mem.write32(CARD_HELPER_CELL, helper | 0);
}

/** F0x8001FD28(x, y): store the first destination pair at +0x08/+0x0C. */
export function cardViewHelperSetPairA(mem: CardViewMemory, x: number, y: number): void {
    const helper = mem.read32(CARD_HELPER_CELL) | 0;
    mem.write32(helper + 0x8, x | 0);
    mem.write32(helper + 0xc, y | 0);
}

/** F0x8001FD3C(x, y): store the second destination pair at +0x10/+0x14. */
export function cardViewHelperSetPairB(mem: CardViewMemory, x: number, y: number): void {
    const helper = mem.read32(CARD_HELPER_CELL) | 0;
    mem.write32(helper + 0x10, x | 0);
    mem.write32(helper + 0x14, y | 0);
}

/**
 * F0x8001FD50(tim): the card artwork uploader. It reads the TIM flags at +0x04
 * and the first block header at +0x08; when bit 3 is set and the low three bits
 * are below 2 it transfers one block at the second destination pair, then steps
 * over that block by its own length word and transfers the next block at the
 * first pair. The final block's width/height become the context's +0x00/+0x02.
 */
export function cardViewHelperUpload(mem: CardViewMemory, host: CardViewHost, tim: number): void {
    let block = (tim + 8) >>> 0;
    const flags = mem.read32(tim + 4) >>> 0;
    if ((flags & 8) !== 0) {
        if ((flags & 7) < 2) {
            const helper = mem.read32(CARD_HELPER_CELL) | 0;
            host.loadImage(
                mem.read16(helper + 0x10),
                mem.read16(helper + 0x14),
                mem.read16(block + 0x8),
                mem.read16(block + 0xa),
                (block + 0xc) >>> 0,
            );
        }
        block = (block + (mem.read32(block) >>> 0)) >>> 0;
    }
    const helper = mem.read32(CARD_HELPER_CELL) | 0;
    const w = mem.read16(block + 0x8);
    const h = mem.read16(block + 0xa);
    host.loadImage(
        mem.read16(helper + 0x8),
        mem.read16(helper + 0xc),
        w,
        h,
        (block + 0xc) >>> 0,
    );
    mem.write16(helper + 0x0, w);
    mem.write16(helper + 0x2, h);
}

/** F0x8001FF9C(size): the helper's scratch size at +0x18. */
export function cardViewHelperSetScratchSize(mem: CardViewMemory, size: number): void {
    const helper = mem.read32(CARD_HELPER_CELL) | 0;
    mem.write32(helper + 0x18, size | 0);
}

/** F0x8001E9C8(value): the cell pitch at +0x1C. */
export function setCardViewPitch(mem: CardViewMemory, value: number): void {
    const ctx = mem.read32(CURRENT_VIEW_CELL) | 0;
    mem.write32(ctx + 0x1c, value | 0);
}

/** F0x8001E9D4(value): the primitive flag at +0x20. */
export function setCardViewFlag(mem: CardViewMemory, value: number): void {
    const ctx = mem.read32(CURRENT_VIEW_CELL) | 0;
    mem.write32(ctx + 0x20, value | 0);
}

/**
 * F0x8001E890(helper): the record's artwork commit. It builds the helper
 * context, stages both destination pairs from the class context's fields, then
 * uploads the TIM the current record holds at +0x0C. It writes no class field.
 */
export function commitCardView(mem: CardViewMemory, host: CardViewHost, helper: number): void {
    cardViewHelperInit(mem, helper);
    const ctx = mem.read32(CURRENT_VIEW_CELL) | 0;
    const ax = (mem.read32(ctx + 0x4) + (mem.read32(ctx + 0x14) << 4)) >>> 0;
    const ay = (mem.read32(ctx + 0x8) + (mem.read32(ctx + 0x18) << 5)) >>> 0;
    cardViewHelperSetPairA(mem, ax, ay);

    const ctx2 = mem.read32(CURRENT_VIEW_CELL) | 0;
    const col = mem.read32(ctx2 + 0x14) | 0;
    const pitch = mem.read32(ctx2 + 0x1c) | 0;
    const bx = mem.read32(ctx2 + 0xc) >>> 0;
    const by = (mem.read32(ctx2 + 0x10) + Math.imul(col, pitch) + mem.read32(ctx2 + 0x18)) >>> 0;
    cardViewHelperSetPairB(mem, bx, by);

    const ctx3 = mem.read32(CURRENT_VIEW_CELL) | 0;
    cardViewHelperUpload(mem, host, (mem.read32(ctx3) + 0xc) >>> 0);
}

/**
 * F0x8001E938(key, arg): dispatch one screen pass through the registered view.
 * It caches the resolved view at +0x24 and its method's result at +0x28. The
 * lookup and the view method are original code, so both are host boundaries.
 */
export function dispatchCurrentDisplayView(
    mem: CardViewMemory,
    host: CardViewHost,
    key: number,
    arg: number,
): number {
    const view = host.findRegisteredHandleByKey(key | 0) | 0;
    mem.write32((mem.read32(CURRENT_VIEW_CELL) | 0) + 0x24, view);
    const result = host.callViewMethod(view, arg | 0) | 0;
    mem.write32((mem.read32(CURRENT_VIEW_CELL) | 0) + 0x28, result);
    return result;
}

/** F0x8001E98C(x, y): the first destination pair at +0x04/+0x08. */
export function setCurrentObject4_8(mem: CardViewMemory, x: number, y: number): void {
    const ctx = mem.read32(CURRENT_VIEW_CELL) | 0;
    mem.write32(ctx + 0x4, x | 0);
    mem.write32(ctx + 0x8, y | 0);
}

/** F0x8001E9A0(x, y): the second destination pair at +0x0C/+0x10. */
export function setCurrentObjectC_10(mem: CardViewMemory, x: number, y: number): void {
    const ctx = mem.read32(CURRENT_VIEW_CELL) | 0;
    mem.write32(ctx + 0xc, x | 0);
    mem.write32(ctx + 0x10, y | 0);
}

/** F0x8001E9B4(col, row): the cell column/row at +0x14/+0x18. */
export function setCurrentViewSize_14_18(mem: CardViewMemory, col: number, row: number): void {
    const ctx = mem.read32(CURRENT_VIEW_CELL) | 0;
    mem.write32(ctx + 0x14, col | 0);
    mem.write32(ctx + 0x18, row | 0);
}

/**
 * F0x8001EBCC(): the kind table word for the current record; the kind byte is
 * the record's own +0x03. The table ships zero and is filled at runtime.
 */
export function currentViewTableWord(mem: CardViewMemory): number {
    const ctx = mem.read32(CURRENT_VIEW_CELL) | 0;
    const record = mem.read32(ctx) | 0;
    const kind = mem.read8(record + 0x3) & 0xff;
    return mem.read32(CARD_KIND_TABLE + kind * 4) | 0;
}

// ── the pack uploader (the helper's +0x2C slot) ─────────────────────────────
//
// F0x8001FE38(pack) walks a resolved pack's offset table and uploads every
// record through the TIM uploader, advancing the destination x by 0x40 per
// record. A record whose first word is "RLEN" is a run-length stream: a control
// byte with bit 7 set repeats the next byte (c & 0x7F) times, a control byte
// with bit 7 clear copies the next c bytes literally, and a zero control byte
// ends the stream. The decoded bytes land in a scratch buffer allocated from
// the helper's +0x18 size and freed at the end.

/** "RLEN" little-endian. */
export const RLEN_TAG = 0x4e454c52;
/** The destination-x advance per uploaded record. */
export const PACK_RECORD_ADVANCE = 0x40;

export interface PackUploadHost extends CardViewHost {
    /** The heap's blocking-alloc cell F0x8004B5F4: `alloc(size, tag)`. */
    allocScratch(size: number, tag: number): number;
    /** The heap's free cell F0x8004B5EC. */
    free(ptr: number): void;
    /** F0x80025868 DrawSync(0): the GPU waits for its queue. */
    drawSync(): void;
}

/**
 * F0x80014110(index, pack): the pack's index-th record, or `pack` itself when
 * the table entry is zero (the walk's only stop).
 */
export function resolveRelativeTableEntry(mem: CardViewMemory, index: number, pack: number): number {
    const base = (pack | 0) + ((index & 0xffff) * 4);
    return ((mem.read32(base) | 0) + (pack | 0)) | 0;
}

/**
 * The RLEN decode inline in F0x8001FE38. `src` points at the first control byte
 * (record + 8); the decoded bytes go to `dest`. Returns the number of bytes
 * written.
 */
export function decodeRlenStream(mem: CardViewMemory, src: number, dest: number): number {
    let from = src >>> 0;
    let to = dest >>> 0;
    for (;;) {
        const control = mem.read8(from) & 0xff;
        if (control === 0) return (to - dest) | 0;
        if ((control & 0x80) !== 0) {
            const count = control & 0x7f;
            const byte = mem.read8(from + 1) & 0xff;
            for (let i = 0; i < count; i++) mem.write8(to + i, byte);
            to = (to + count) >>> 0;
            from = (from + 2) >>> 0;
        } else {
            const count = control;
            for (let i = 0; i < count; i++) mem.write8(to + i, mem.read8(from + 1 + i) & 0xff);
            to = (to + count) >>> 0;
            from = (from + count + 1) >>> 0;
        }
    }
}

/**
 * F0x8001FE38(pack): upload every record of a resolved pack. The scratch size
 * is the helper's +0x18 (the constructor presets 0xA800); the destination x at
 * helper +0x08 advances 0x40 per record, and DrawSync(0) follows each transfer.
 */
export function cardViewHelperUploadPack(
    mem: CardViewMemory,
    host: PackUploadHost,
    pack: number,
): void {
    const helper = mem.read32(CARD_HELPER_CELL) | 0;
    const scratch = host.allocScratch(mem.read32(helper + 0x18) | 0, 2) | 0;
    for (let i = 0; ; i++) {
        const record = resolveRelativeTableEntry(mem, i, pack) | 0;
        if (record === (pack | 0)) break;
        let source = record;
        if ((mem.read32(record) >>> 0) === RLEN_TAG) {
            decodeRlenStream(mem, (record + 8) >>> 0, scratch);
            source = scratch;
        }
        cardViewHelperUpload(mem, host, source);
        host.drawSync();
        const h = mem.read32(CARD_HELPER_CELL) | 0;
        mem.write32(h + 0x8, (mem.read32(h + 0x8) + PACK_RECORD_ADVANCE) >>> 0);
    }
    host.free(scratch);
}
