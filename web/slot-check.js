// web/slot-check.js — Card Verify: a save slot is checked before it is trusted.
//
// A slot in web/save.js is one JSON entry:
//   { record, data, savedAt, image?, residentImageVersion? }
// `readSlot` used to take it at its word: a truncated image reached
// writeSaveBlock from inside the restore and threw with no message, and by then
// the load had already deleted every live key. This module is the pure check
// the read and the load run first — only when F2 -> Extras -> "Card verify"
// is switched on.
//
// WHAT IS CHECKED — length and shape only:
//   image  exactly IMAGE_SIZE = 0x26C4 values, each a whole number 0..255
//   record hours 0..99, minutes 0..59, seconds 0..59, bits a number >= 0,
//          three party types (-1 empty, else the disc's type code 3..10, i.e.
//          the type index the nameplate table uses, 0..7) and three levels 0..99
//   data   a plain object whose every value is a string (the store snapshot)
// An entry with neither a record nor an image is EMPTY, not damaged
// ({ok:true, empty:true}) — the card already draws its own dashes for that.
//
// WHAT IS NOT CHECKED, and why (ddw3-walker docs/research/systems/save-block-layout.md:43):
//   * the 0xD4 directory block — web/memcard.js builds it from the records on
//     every card open (web/save-translated.js -> buildDirectoryBlock), so no
//     stored copy exists whose XOR-8 could be compared with anything;
//   * the image's own +0 checksum byte — no decoded algorithm exists for it.
//
// Codes are the disc's own result table (web/assets/data/stgmcard_ui.json
// message_window.result_messages.text): 0 = success, 5 = "File cannot be
// found.", 8 = "MEMORY CARD error. Please check MEMORY CARD.".
//
// Pure: no DOM, no storage, no fetch.
import { RESIDENT_SAVE_SIZE } from "./vendor/engine.js";

/** The resident card image's size. The engine's own constant, never a second copy. */
export const IMAGE_SIZE = RESIDENT_SAVE_SIZE;
if (IMAGE_SIZE !== 0x26c4) throw new Error("slot check: the engine disagrees about the card size");

export const CODE_OK = 0;
export const CODE_FILE_NOT_FOUND = 5;
export const CODE_CARD_ERROR = 8;

const plainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const intIn = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
const OK = (empty = false) => ({
  ok: true, code: empty ? CODE_FILE_NOT_FOUND : CODE_OK, empty, why: "",
});
const BAD = (why) => ({ ok: false, code: CODE_CARD_ERROR, empty: false, why });

/**
 * The 0x26C4 image: a list of exactly IMAGE_SIZE byte values. The length is the
 * one thing `writeSaveBlock` (engine/dw3/save-block.ts:16-19) would throw on; a
 * value outside a byte is no image at all.
 */
export function checkImage(image) {
  if (!Array.isArray(image)) return BAD("image is not a list of bytes");
  if (image.length !== IMAGE_SIZE) return BAD(`image length ${image.length} is not ${IMAGE_SIZE}`);
  for (let i = 0; i < image.length; i++) {
    const v = image[i];
    if (!Number.isInteger(v) || v < 0 || v > 255) return BAD(`image value ${v} at ${i} is not a byte`);
  }
  return OK();
}

/**
 * The 0x44 summary record `web/save.js buildRecord` writes. The three party
 * types are the disc's own starter-type codes: -1 for an empty slot, else
 * 3..10 (the nameplate/icon tables index `type - 3`, so the type index is
 * -1..7; 0 is the empty form the 0xD4 block itself stores). Levels are the
 * game's 0..99.
 */
export function checkRecord(record) {
  if (!plainObject(record)) return BAD("record is not an object");
  if (!intIn(record.hours, 0, 99)) return BAD(`hours ${record.hours} is not a whole number 0..99`);
  if (!intIn(record.minutes, 0, 59)) return BAD(`minutes ${record.minutes} is not a whole number 0..59`);
  if (!intIn(record.seconds, 0, 59)) return BAD(`seconds ${record.seconds} is not a whole number 0..59`);
  if (typeof record.bits !== "number" || !Number.isFinite(record.bits) || record.bits < 0) {
    return BAD(`bits ${record.bits} is not a number 0 or more`);
  }
  if (!Array.isArray(record.partyTypes) || record.partyTypes.length !== 3) {
    return BAD("partyTypes is not three entries");
  }
  for (let i = 0; i < 3; i++) {
    const t = record.partyTypes[i];
    // -1 (record empty), 0 (block empty) or the disc's type code 3..10
    // (index 0..7). A type outside the layout's own table (11 and up) can
    // never draw an icon or a nameplate, so it is a damaged record.
    if (!Number.isInteger(t) || !(t === -1 || (t >= 0 && t <= 10))) {
      return BAD(`party type ${t} at ${i} is not -1 or the disc's code 0..10`);
    }
  }
  if (!Array.isArray(record.partyLevels) || record.partyLevels.length !== 3) {
    return BAD("partyLevels is not three entries");
  }
  for (let i = 0; i < 3; i++) {
    if (!intIn(record.partyLevels[i], 0, 99)) {
      return BAD(`party level ${record.partyLevels[i]} at ${i} is not a whole number 0..99`);
    }
  }
  return OK();
}

/** The store snapshot the slot restores: a plain object of raw string values. */
function checkData(data) {
  if (!plainObject(data)) return BAD("data is not an object");
  for (const [key, value] of Object.entries(data)) {
    if (typeof value !== "string") return BAD(`data.${key} is not a string`);
  }
  return OK();
}

/**
 * One slot entry. Returns { ok, code, empty, why }; `code` is the disc's result
 * code (0 success, 5 file not found, 8 card error). Empty is not damaged: an
 * entry that carries neither record nor image is the card's own "no data" row.
 */
export function checkSlot(entry) {
  if (entry === null || entry === undefined) return OK(true);
  if (!plainObject(entry)) return BAD("entry is not an object");
  const hasRecord = entry.record !== null && entry.record !== undefined;
  const hasImage = entry.image !== null && entry.image !== undefined;
  if (!hasRecord && !hasImage) return OK(true);
  // An image without its record is a file the card cannot draw or restore.
  if (!hasRecord) return BAD("record is missing");
  // The translated route's entry says "restore me through the original card's
  // image"; without that image the restore would throw inside writeSaveBlock.
  if (entry.residentImageVersion === 1 && !hasImage) {
    return BAD("resident image version 1 without an image");
  }
  const record = checkRecord(entry.record);
  if (!record.ok) return record;
  if (hasImage) {
    const image = checkImage(entry.image);
    if (!image.ok) return image;
  }
  const data = checkData(entry.data);
  if (!data.ok) return data;
  return OK();
}
