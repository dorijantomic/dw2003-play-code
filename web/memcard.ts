// web/memcard.js — the browser's virtual PlayStation memory card (Phase 6.3 of
// docs/plans/2026-09-21-native-screen-production-integration-plan.md).
//
// The save screen (pro/stgmcard) drives the PS1 card BIOS through the translated
// card manager (engine/dw3/ui/memcard-machine.ts, F0x80084dcc). The browser has
// no card, so this module stands in for the device: it builds the 0xD4-byte
// directory block the manager reads from a save file and keeps the walker's own
// save image behind it.
//
// Block layout — decoded from the writer (F0x80084dcc state 0x33) and the
// screen's own binder (F0x8008316c), and measured against the running screen on
// 2026-09-22 (see progress.md 2026-09-22o):
//
//   +0x00  u8   XOR-8 checksum over +4..+0xD4
//   +0x01  u8   file slot (0..2); the binder indexes the record array by it
//   +0x02  u16  format id (4)
//   +0x04  u32  tag 0x33574D44
//   +0x08  + slot*0x44: the 0x44-byte summary record
//
// Summary record (record = block + 8 + slot*0x44):
//
//   +0x00  name string, in the game's screen text codec (web/native-screen.js
//          encodeNativeScreenText); the binder draws it with the class-A text
//          widget's own decoder. Byte 0 also means "empty slot": the binder's
//          `lbu (record)` branch then shows the descriptor placeholders.
//   +0x18  u32 area string index (esstarea bank)
//   +0x1C  u32 place string index (esshpnam bank)
//   +0x20  u32 BIT
//   +0x28  u16 play hours
//   +0x2A  u16 play minutes
//   +0x2C  u16 play seconds
//   +0x30 + 4i  u32 starter type (3..10; the icon/nameplate tables index
//               `type - 3`)
//   +0x3C + 2i  u16 level
//
// The manager's read/write services address a card FILE, and the screen's own
// driver asks for file `selectedSlot + 2` (F0x80084dcc: `unk4 + 2`), so the
// file-to-slot mapping is `file - 2`. The block carries all three slots'
// summaries, exactly as the original writer fills them.

import { encodeNativeScreenText } from "./native-screen.js";

export const DIR_BLOCK_SIZE = 0xd4;
export const SAVE_IMAGE_SIZE = 0x26c4;
export const MCARD_TAG = 0x33574d44;
export const MCARD_FORMAT = 4;
export const MCARD_STRIDE = 0x44;
export const MCARD_RECORDS_AT = 8;
/** The card's file number for a slot: the driver reads/writes `slot + 2`. */
export const MCARD_FILE_BASE = 2;

/** The walker slot behind a card file number. Files 2..4 are slots 0..2. */
export function slotForFile(file) {
    const f = Number(file) | 0;
    return f >= MCARD_FILE_BASE && f < MCARD_FILE_BASE + 3 ? f - MCARD_FILE_BASE : f & 3;
}

/** XOR-8 over `bytes[from..to)`; the manager's checksum service (+0x358). */
export function xor8(bytes, from = 4, to = DIR_BLOCK_SIZE) {
    let sum = 0;
    for (let i = from; i < to; i++) sum ^= bytes[i] & 0xff;
    return sum & 0xff;
}

/**
 * One 0x44-byte summary record from a `web/save.js buildRecord` result.
 * A null/absent record (an empty walker slot) stays all zeroes, which is the
 * screen's own "no data here" state.
 */
export function buildSummaryRecord(rec, encodeName = encodeNativeScreenText) {
    const out = new Uint8Array(MCARD_STRIDE);
    if (!rec) return out;
    const dv = new DataView(out.buffer);
    const name = encodeName(rec.name ?? "", 0x18);
    for (let i = 0; i < name.length && i < 0x18; i++) out[i] = name[i] & 0xff;
    dv.setUint32(0x18, (rec.areaIndex ?? 0) >>> 0, true);
    dv.setUint32(0x1c, (rec.placeIndex ?? 0) >>> 0, true);
    dv.setUint32(0x20, (rec.bits ?? 0) >>> 0, true);
    dv.setUint16(0x28, (rec.hours ?? 0) & 0xffff, true);
    dv.setUint16(0x2a, (rec.minutes ?? 0) & 0xffff, true);
    dv.setUint16(0x2c, (rec.seconds ?? 0) & 0xffff, true);
    for (let i = 0; i < 3; i++) {
        const type = Number(rec.partyTypes?.[i] ?? -1);
        dv.setUint32(0x30 + i * 4, type > 0 ? type >>> 0 : 0, true);
        dv.setUint16(0x3c + i * 2, Number(rec.partyLevels?.[i] ?? 0) & 0xffff, true);
    }
    return out;
}

/**
 * The 0xD4 directory block for card file `file`, from up to three slot records.
 * `slot` is the file's own index and lands in the block's +0x01 byte, which the
 * screen's binder uses to pick the record it displays.
 */
export function buildDirectoryBlock(records, slot = 0, encodeName = encodeNativeScreenText) {
    const block = new Uint8Array(DIR_BLOCK_SIZE);
    const dv = new DataView(block.buffer);
    dv.setUint16(2, MCARD_FORMAT, true);
    dv.setUint32(4, MCARD_TAG, true);
    block[1] = slot & 0xff;
    for (let s = 0; s < 3; s++) {
        block.set(buildSummaryRecord(records?.[s] ?? null, encodeName),
            MCARD_RECORDS_AT + s * MCARD_STRIDE);
    }
    block[0] = xor8(block);
    return block;
}

/**
 * A virtual card over the walker's three save slots.
 *
 *   slots()   -> [{ record, image }|null]  the walker's own slot contents
 *   onStore(slot, bytes, kind)             the screen wrote a block
 *
 * `kind` is "header" for the 0xD4 directory and "image" for the 0x26C4 save
 * image. The adapter owns what a write means; this module only supplies the
 * device contract engine/native/stubs.ts declares.
 */
export function createWalkerMemcard({ slots, onStore = null } = {}) {
    const read = () => (typeof slots === "function" ? slots() : slots) ?? [];
    const images = new Map(); // slot -> 0x26C4 image handed back by `block`
    return {
        fileCount: () => 3,
        record(file) {
            const list = read();
            const slot = slotForFile(file);
            const records = [0, 1, 2].map((i) => list[i]?.record ?? null);
            return buildDirectoryBlock(records, slot);
        },
        block(file) {
            const slot = slotForFile(file);
            const stored = images.get(slot);
            if (stored) return Uint8Array.from(stored);
            const img = read()[slot]?.image;
            return img ? Uint8Array.from(img) : null;
        },
        store(file, bytes) {
            const buf = Uint8Array.from(bytes);
            // A directory header names its own slot in +0x01 (the writer stamps
            // the selected slot there); the image write carries no slot, so it
            // falls back to the file number the manager passed.
            const slot = buf.length === DIR_BLOCK_SIZE ? buf[1] & 3 : slotForFile(file);
            if (buf.length === SAVE_IMAGE_SIZE) images.set(slot, buf);
            onStore?.(slot, buf, buf.length === DIR_BLOCK_SIZE ? "header" : "image");
        },
        /** Test seam: the image a previous `store` handed back. */
        storedImage: (slot) => images.get(slot) ?? null,
    };
}
