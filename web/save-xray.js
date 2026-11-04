// web/save-xray.js — the resident memory-card image (0x26C4 bytes) read the way
// the disc keeps it: every named interval, every population, and every byte the
// layout does not name kept and labelled "retained".
//
// Layout authority: ddw3-walker docs/research/systems/save-block-layout.md
// ("Complete interval partition"). Populations are the engine's own constants
// (web/vendor/engine.js is the built form of engine/dw3/save-block.ts), so this
// file never keeps a second copy of a length it can import.
//
// Pure: no page, no DOM, no storage, no fetch, and it writes nothing — it reads
// a copy of the image the card driver already saved. The page
// (web/save-xray-page.js) owns the browser store and the slot keys.
import {
  RESIDENT_SAVE_SIZE,
  SAVE_BLOCK_SIZE,
  RESIDENT_ROSTER_COUNT,
  RESIDENT_FORM_COUNT,
  RESIDENT_FORM_SIZE,
  ROSTER_STRIDE,
  SAVE_CARD_MAX,
  SAVE_FOLDER_COUNT,
  SAVE_FOLDER_SIZE,
  SAVE_FOLDER_CARDS,
  SAVE_STORED_BANKS,
  heldArrayAddress,
  wornArrayAddress,
} from "./vendor/engine.js";

// The resident block is exactly the engine's card size. The model re-exports the
// engine's own name so a test can never disagree with the card driver.
export { RESIDENT_SAVE_SIZE };
if (SAVE_BLOCK_SIZE !== RESIDENT_SAVE_SIZE) throw new Error("save X-ray: the engine disagrees about the card size");

// Offsets inside the image. Where the engine exports an accessor, the offset is
// that accessor; the rest are the walker's partition (relative to 0x80048D34).
const OFF_CHECKSUM = 0x0000;
const OFF_FORMAT = 0x0002;
const OFF_CLOCK = 0x004c;      // u16 hours, u16 minutes, u16 seconds (memcard-state.ts)
const OFF_NAME = 0x0054;       // 24 player-name bytes
const OFF_BITS = 0x006c;       // u32 (memcard-state.ts)
const OFF_PARTY = 0x0070;      // three u32 party-to-roster indices, -1 empty
const OFF_HELD = heldArrayAddress(0, 0);   // 0x7c, 403 bytes
const OFF_WORN = wornArrayAddress(0, 0);   // 0x20f, 403 bytes
const OFF_CARD_COUNTS = 0x03a2; // id zero + 315 counts
const OFF_ALBUM = 0x04df;      // id zero + 315 album bytes
const OFF_FOLDERS = 0x0628;    // three 0x66 records
const OFF_ROSTER = 0x0760;     // eight 0x3dc records
const OFF_PACK = 0x2640;       // u32 starter pack id
const OFF_FLAGS = SAVE_STORED_BANKS[0][1]; // 0x2644, the first stored-bank base

const HELD_BYTES = wornArrayAddress(0, 0) - heldArrayAddress(0, 0); // 403: id zero through id 402
const WORN_BYTES = OFF_CARD_COUNTS - OFF_WORN;                      // 403, the same span
const CARD_BYTES = SAVE_CARD_MAX + 1;
const ROSTER_BYTES = RESIDENT_ROSTER_COUNT * ROSTER_STRIDE;
const FOLDER_BYTES = SAVE_FOLDER_COUNT * SAVE_FOLDER_SIZE;
const FOLDER_NAME_BYTES = SAVE_FOLDER_SIZE - SAVE_FOLDER_CARDS * 2; // 22 name bytes before the forty cards
const FLAG_BYTES = RESIDENT_SAVE_SIZE - OFF_FLAGS;

// Record-relative field offsets (ddw3-walker save-block-layout.md, "Roster record
// partition"; the engine's RECORD_FIELDS / ROSTER_EQUIP_OFFSETS agree).
const R = {
  owned: 0x00,
  currentForm: 0x04,
  name: 0x08,
  xp: 0x20,
  level: 0x24,
  tp: 0x26,
  hp: 0x28,
  maxHp: 0x2a,
  mp: 0x2c,
  maxMp: 0x2e,
  core: 0x30,
  elements: 0x3c,
  equippedForms: 0x50,
  forms: 0x58,
  equipment: 0x3c8,
  lastUltraDrill: 0x3d4,
  storyOrdinal: 0x3d8,
};
const EQUIP_SLOTS = ["head", "body", "right", "left", "acc0", "acc1"];
const CORE_SLOTS = ["str", "def", "spt", "wis", "spd", "chr"];

/**
 * The named intervals and the retained gaps between them, in order, covering the
 * whole image exactly once. "Retained" means lossless byte storage, not a claim
 * of unused storage (the walker's own wording). The roster is one named row; its
 * own retained gaps are listed in RETAINED_SPANS and on each decoded record
 * (`record.retained`), so no byte of that row is silently dropped.
 */
export const SECTION_TABLE = [
  { name: "header checksum", offset: OFF_CHECKSUM, length: 1, note: "+0x00 checksum byte the card driver writes over this image" },
  { name: "retained", offset: 0x0001, length: 1, note: "retained: +0x01 sits between the checksum and the format byte, no semantic assignment made" },
  { name: "header format", offset: OFF_FORMAT, length: 1, note: "+0x02 format byte; the original stores one byte here, never a halfword" },
  { name: "retained", offset: 0x0003, length: 1, note: "retained: +0x03 is the byte after the format byte" },
  { name: "retained", offset: 0x0004, length: 0x2c, note: "retained: resident control and travel fields (+0x04 and +0x0C are stored by a new game)" },
  { name: "retained", offset: 0x0030, length: 4, note: "retained: the encounter countdown" },
  { name: "retained", offset: 0x0034, length: 0x10, note: "retained: travel context — source screen, actor position and facing direction" },
  { name: "retained", offset: 0x0044, length: 4, note: "retained: the two route cursors" },
  { name: "retained", offset: 0x0048, length: 4, note: "retained: the play clock's fractional counter" },
  { name: "clock", offset: OFF_CLOCK, length: 6, note: "play clock: u16 hours, u16 minutes, u16 seconds" },
  { name: "retained", offset: 0x0052, length: 2, note: "retained: the clock saturation flag lives here; its width is not decoded" },
  { name: "name", offset: OFF_NAME, length: 0x18, note: "player name, 24 bytes" },
  { name: "bits", offset: OFF_BITS, length: 4, note: "BIT (money), u32" },
  { name: "party", offset: OFF_PARTY, length: 12, note: "three u32 party-to-roster indices; -1 means an empty party slot" },
  { name: "held", offset: OFF_HELD, length: HELD_BYTES, note: "402 carried-item counts plus id zero (403 bytes)" },
  { name: "worn", offset: OFF_WORN, length: WORN_BYTES, note: "402 worn-item counts plus id zero (403 bytes)" },
  { name: "card counts", offset: OFF_CARD_COUNTS, length: CARD_BYTES, note: "315 card counts plus id zero" },
  { name: "retained", offset: 0x04de, length: 1, note: "retained byte between the two card arrays" },
  { name: "album", offset: OFF_ALBUM, length: CARD_BYTES, note: "album history: 315 seen flags plus id zero" },
  { name: "retained", offset: 0x061b, length: 0x0d, note: "retained bytes after the album; no semantic assignment made" },
  { name: "folders", offset: OFF_FOLDERS, length: FOLDER_BYTES, note: "three 0x66-byte folders: 22 name bytes then forty u16 cards" },
  { name: "retained", offset: 0x075a, length: 6, note: "retained bytes between the folders and the roster" },
  { name: "roster", offset: OFF_ROSTER, length: ROSTER_BYTES, note: "eight 0x3DC-byte roster records, 44 form cells each" },
  { name: "pack", offset: OFF_PACK, length: 4, note: "starter pack id, u32" },
  { name: "flags", offset: OFF_FLAGS, length: FLAG_BYTES, note: "13 stored flag banks; a bank's slice ends at the next bank's base" },
];

// The complement: every byte outside a named field, one span each so the page
// can name a gap and the diff can report a changed retained byte exactly. This
// includes the retained bytes inside each roster record (the walker's own
// record partition: +4A..50, +56..58, +3D5..3D8, and in the first seven records
// +3D8..3DC — only the last record's final word is the story ordinal).
const RECORD_RETAINED = [
  { offset: 0x4a, length: 6, note: "retained: roster record +0x4A..0x50 — no semantic assignment made" },
  { offset: 0x56, length: 2, note: "retained: roster record +0x56..0x58 — between the equipped forms and the ledger" },
  { offset: 0x3d5, length: 3, note: "retained: roster record +0x3D5..0x3D8 — after the remembered drill" },
];
export const RETAINED_SPANS = [
  ...SECTION_TABLE.filter((s) => s.name === "retained")
    .map((s) => ({ name: "retained", offset: s.offset, length: s.length, note: s.note })),
  ...Array.from({ length: RESIDENT_ROSTER_COUNT }, (_, slot) => {
    const base = OFF_ROSTER + slot * ROSTER_STRIDE;
    const spans = RECORD_RETAINED.map((gap) => ({
      name: "retained",
      offset: base + gap.offset,
      length: gap.length,
      note: gap.note,
    }));
    if (slot !== RESIDENT_ROSTER_COUNT - 1) {
      spans.push({
        name: "retained",
        offset: base + 0x3d8,
        length: 4,
        note: "retained: this record's final word; only the last record's final word is the story ordinal",
      });
    }
    return spans;
  }).flat(),
];

const SPAN_TOTALS = SECTION_TABLE.reduce((n, s) => n + s.length, 0);
if (SPAN_TOTALS !== RESIDENT_SAVE_SIZE) throw new Error("save X-ray: the section table does not cover the image");

const asBytes = (image) => {
  if (image instanceof Uint8Array) return image;
  if (ArrayBuffer.isView(image)) return new Uint8Array(image.buffer, image.byteOffset, image.byteLength);
  if (Array.isArray(image)) return Uint8Array.from(image);
  throw new Error("save X-ray: an image must be bytes (the card driver's 0x26C4 block)");
};

const viewOf = (bytes) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

/** Printable text for a name field; a non-printable byte shows as a middle dot. */
function textOf(bytes, at, length) {
  let out = "";
  for (let i = 0; i < length; i++) {
    const b = bytes[at + i];
    if (b === 0) break;
    out += b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : "\u00b7";
  }
  return out;
}

function hexOf(bytes, at, length) {
  return Array.from(bytes.subarray(at, at + length), (b) => b.toString(16).padStart(2, "0")).join(" ");
}

function readRosterRecord(bytes, view, slot) {
  const base = OFF_ROSTER + slot * ROSTER_STRIDE;
  const u8 = (off) => view.getUint8(base + off);
  const u16 = (off) => view.getUint16(base + off, true);
  const u32 = (off) => view.getUint32(base + off, true);
  const forms = Array.from({ length: RESIDENT_FORM_COUNT }, (_, index) => {
    const at = base + R.forms + index * RESIDENT_FORM_SIZE;
    return {
      index,
      offset: at,
      id: view.getUint16(at, true),
      level: view.getUint8(at + 2),
      preserved: view.getUint8(at + 3),
      dvexp: view.getUint32(at + 4, true),
      tech: Array.from({ length: 6 }, (_, j) => view.getUint16(at + 8 + j * 2, true)),
    };
  });
  // The record's own retained gaps, reported so no byte of a named record is
  // silently dropped by the diff. The last record's final word is the story
  // ordinal; in the other seven records those four bytes are retained.
  const retained = [
    { offset: base + 0x4a, length: 6, bytes: Array.from(bytes.subarray(base + 0x4a, base + 0x50)) },
    { offset: base + 0x56, length: 2, bytes: Array.from(bytes.subarray(base + 0x56, base + 0x58)) },
    { offset: base + 0x3d5, length: 3, bytes: Array.from(bytes.subarray(base + 0x3d5, base + 0x3d8)) },
  ];
  if (slot !== RESIDENT_ROSTER_COUNT - 1) {
    retained.push({ offset: base + 0x3d8, length: 4, bytes: Array.from(bytes.subarray(base + 0x3d8, base + 0x3dc)) });
  }
  return {
    slot,
    offset: base,
    owned: u32(R.owned),
    currentForm: u32(R.currentForm),
    nameBytes: Array.from(bytes.subarray(base + R.name, base + R.name + 24)),
    name: textOf(bytes, base + R.name, 24),
    xp: u32(R.xp),
    level: u16(R.level),
    tp: u16(R.tp),
    hp: u16(R.hp),
    maxHp: u16(R.maxHp),
    mp: u16(R.mp),
    maxMp: u16(R.maxMp),
    core: Array.from({ length: 6 }, (_, i) => view.getUint16(base + R.core + i * 2, true)),
    elements: Array.from({ length: 7 }, (_, i) => view.getUint16(base + R.elements + i * 2, true)),
    equippedForms: Array.from({ length: 3 }, (_, i) => view.getUint16(base + R.equippedForms + i * 2, true)),
    forms,
    equipment: Object.fromEntries(EQUIP_SLOTS.map((key, i) => [key, view.getUint16(base + R.equipment + i * 2, true)])),
    lastUltraDrill: u8(R.lastUltraDrill),
    storyOrdinal: slot === RESIDENT_ROSTER_COUNT - 1 ? u32(R.storyOrdinal) : null,
    retained,
  };
}

/**
 * One image -> the disc's own view of it.
 *   header   checksum + format bytes
 *   clock    hours / minutes / seconds and the total seconds
 *   name     the player name bytes and their printable text
 *   bits     money
 *   party    three roster indices
 *   items    held[403] and worn[403], index = item id (id zero is the byte the
 *            original never uses)
 *   roster   eight records, 44 form cells each, with the record's own retained gaps
 *   cards    counts[316], album[316], the owned [id,count] rows and the seen ids
 *   folders  three folders of forty cards
 *   flags    the 13 stored banks, keyed by bank number, each with its exact slice
 *   pack     the starter pack id
 *   retained namedBytes + unexplainedBytes + the retained spans
 */
export function xray(image) {
  const bytes = asBytes(image);
  if (bytes.length !== RESIDENT_SAVE_SIZE) {
    throw new Error(`save X-ray: expected ${RESIDENT_SAVE_SIZE} bytes, got ${bytes.length}`);
  }
  const view = viewOf(bytes);
  const u8 = (off) => view.getUint8(off);
  const u16 = (off) => view.getUint16(off, true);
  const u32 = (off) => view.getUint32(off, true);

  const held = Array.from({ length: HELD_BYTES }, (_, id) => u8(OFF_HELD + id));
  const worn = Array.from({ length: WORN_BYTES }, (_, id) => u8(OFF_WORN + id));
  const counts = Array.from({ length: CARD_BYTES }, (_, id) => u8(OFF_CARD_COUNTS + id));
  const album = Array.from({ length: CARD_BYTES }, (_, id) => u8(OFF_ALBUM + id));

  const folders = Array.from({ length: SAVE_FOLDER_COUNT }, (_, f) => {
    const at = OFF_FOLDERS + f * SAVE_FOLDER_SIZE;
    return {
      index: f,
      offset: at,
      nameBytes: Array.from(bytes.subarray(at, at + FOLDER_NAME_BYTES)),
      name: textOf(bytes, at, FOLDER_NAME_BYTES),
      cards: Array.from({ length: SAVE_FOLDER_CARDS }, (_, i) => view.getUint16(at + FOLDER_NAME_BYTES + i * 2, true)),
    };
  });

  const flags = {};
  SAVE_STORED_BANKS.forEach(([bank, start], row) => {
    const end = SAVE_STORED_BANKS[row + 1]?.[1] ?? RESIDENT_SAVE_SIZE;
    flags[bank] = {
      bank,
      offset: start,
      length: end - start,
      bytes: Array.from(bytes.subarray(start, end)),
    };
  });

  const hours = u16(OFF_CLOCK);
  const minutes = u16(OFF_CLOCK + 2);
  const seconds = u16(OFF_CLOCK + 4);

  const unexplainedBytes = RETAINED_SPANS.reduce((n, s) => n + s.length, 0);

  return {
    size: bytes.length,
    header: { checksum: u8(OFF_CHECKSUM), format: u8(OFF_FORMAT) },
    clock: { hours, minutes, seconds, totalSeconds: hours * 3600 + minutes * 60 + seconds },
    name: { bytes: Array.from(bytes.subarray(OFF_NAME, OFF_NAME + 0x18)), text: textOf(bytes, OFF_NAME, 0x18) },
    bits: u32(OFF_BITS),
    party: [0, 1, 2].map((i) => view.getInt32(OFF_PARTY + i * 4, true)),
    items: { held, worn },
    roster: Array.from({ length: RESIDENT_ROSTER_COUNT }, (_, slot) => readRosterRecord(bytes, view, slot)),
    cards: {
      counts,
      album,
      owned: counts.map((n, id) => [id, n]).filter(([id, n]) => id >= 1 && n > 0),
      seen: album.map((n, id) => [id, n]).filter(([id, n]) => id >= 1 && n > 0).map(([id]) => id),
    },
    folders,
    flags,
    packId: u32(OFF_PACK),
    retained: {
      namedBytes: RESIDENT_SAVE_SIZE - unexplainedBytes,
      unexplainedBytes,
      spans: RETAINED_SPANS.map((s) => ({ offset: s.offset, length: s.length, note: s.note })),
    },
  };
}

/** Name a named field's bytes as a display value: number, text or hex. */
function fieldValue(bytes, name, at, length) {
  if (name.endsWith(".name") || name === "name") return textOf(bytes, at, length);
  if (length === 1) return bytes[at];
  if (length === 2) return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(at, true);
  if (length === 4) {
    // party indices are signed in the engine's party map; everything else here is
    // a count, an offset-free id or BIT.
    if (name.startsWith("party[")) return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getInt32(at, true);
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(at, true);
  }
  return hexOf(bytes, at, length);
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function pushRow(rows, field, a, b) {
  if (!same(a, b)) rows.push({ field, a, b });
}

/**
 * Two images -> only the fields that differ, as `{field, a, b}` rows in image
 * order. Every named field is compared element by element (held[43], not the
 * whole bag), and every differing byte inside a retained gap gets its own
 * `retained +0x<offset>` row. Identical images -> an empty list.
 */
export function diffSlots(a, b) {
  const A = asBytes(a);
  const B = asBytes(b);
  if (A.length !== RESIDENT_SAVE_SIZE || B.length !== RESIDENT_SAVE_SIZE) {
    throw new Error(`save X-ray: both images must be ${RESIDENT_SAVE_SIZE} bytes`);
  }
  const rows = [];
  const at = (atA, name, length) => {
    const va = fieldValue(A, name, atA, length);
    const vb = fieldValue(B, name, atA, length);
    pushRow(rows, name, va, vb);
  };

  at(OFF_CHECKSUM, "checksum", 1);
  at(OFF_FORMAT, "format", 1);
  at(OFF_CLOCK, "clock.hours", 2);
  at(OFF_CLOCK + 2, "clock.minutes", 2);
  at(OFF_CLOCK + 4, "clock.seconds", 2);
  at(OFF_NAME, "name", 0x18);
  at(OFF_BITS, "bits", 4);
  for (let i = 0; i < 3; i++) at(OFF_PARTY + i * 4, `party[${i}]`, 4);
  for (let id = 0; id < HELD_BYTES; id++) at(OFF_HELD + id, `held[${id}]`, 1);
  for (let id = 0; id < WORN_BYTES; id++) at(OFF_WORN + id, `worn[${id}]`, 1);
  for (let id = 0; id < CARD_BYTES; id++) at(OFF_CARD_COUNTS + id, `cards[${id}]`, 1);
  for (let id = 0; id < CARD_BYTES; id++) at(OFF_ALBUM + id, `album[${id}]`, 1);
  for (let f = 0; f < SAVE_FOLDER_COUNT; f++) {
    const base = OFF_FOLDERS + f * SAVE_FOLDER_SIZE;
    at(base, `folders[${f}].name`, FOLDER_NAME_BYTES);
    for (let i = 0; i < SAVE_FOLDER_CARDS; i++) at(base + FOLDER_NAME_BYTES + i * 2, `folders[${f}].card[${i}]`, 2);
  }
  for (let slot = 0; slot < RESIDENT_ROSTER_COUNT; slot++) {
    const base = OFF_ROSTER + slot * ROSTER_STRIDE;
    const p = `roster[${slot}]`;
    at(base + R.owned, `${p}.owned`, 4);
    at(base + R.currentForm, `${p}.currentForm`, 4);
    at(base + R.name, `${p}.name`, 24);
    at(base + R.xp, `${p}.xp`, 4);
    for (const [key, off] of [["level", R.level], ["tp", R.tp], ["hp", R.hp], ["maxHp", R.maxHp], ["mp", R.mp], ["maxMp", R.maxMp]]) {
      at(base + off, `${p}.${key}`, 2);
    }
    for (let i = 0; i < 6; i++) at(base + R.core + i * 2, `${p}.core[${CORE_SLOTS[i]}]`, 2);
    for (let i = 0; i < 7; i++) at(base + R.elements + i * 2, `${p}.element[${i}]`, 2);
    for (let i = 0; i < 3; i++) at(base + R.equippedForms + i * 2, `${p}.equipped[${i}]`, 2);
    for (let index = 0; index < RESIDENT_FORM_COUNT; index++) {
      const cell = base + R.forms + index * RESIDENT_FORM_SIZE;
      const c = `${p}.forms[${index}]`;
      at(cell, `${c}.id`, 2);
      at(cell + 2, `${c}.level`, 1);
      at(cell + 3, `${c}.preserved`, 1);
      at(cell + 4, `${c}.dvexp`, 4);
      for (let j = 0; j < 6; j++) at(cell + 8 + j * 2, `${c}.tech[${j}]`, 2);
    }
    for (let i = 0; i < 6; i++) at(base + R.equipment + i * 2, `${p}.equipment.${EQUIP_SLOTS[i]}`, 2);
    at(base + R.lastUltraDrill, `${p}.lastUltraDrill`, 1);
    if (slot === RESIDENT_ROSTER_COUNT - 1) at(base + R.storyOrdinal, `${p}.storyOrdinal`, 4);
  }
  at(OFF_PACK, "pack", 4);
  SAVE_STORED_BANKS.forEach(([bank, start], row) => {
    const end = SAVE_STORED_BANKS[row + 1]?.[1] ?? RESIDENT_SAVE_SIZE;
    for (let off = start; off < end; off++) at(off, `flags[${bank}].byte[${off - start}]`, 1);
  });

  // Retained gaps: one row per changed byte, never a collapsed block, so the
  // page can say exactly where a save differs outside anything named.
  for (const span of RETAINED_SPANS) {
    for (let i = 0; i < span.length; i++) {
      const off = span.offset + i;
      if (A[off] !== B[off]) rows.push({ field: `retained +0x${off.toString(16)}`, a: A[off], b: B[off] });
    }
  }
  return rows;
}

// ------------------------------------------------------------------ the page's data

/** The three card slots the driver writes (web/save.js SLOT_KEY / SLOT_COUNT). */
export const SLOT_COUNT = 3;
export const slotKey = (i) => `mcardSlot${i}`;

/**
 * Raw slot entries -> page rows. `raw` is what the browser store held: three
 * strings, nulls, or already-parsed entries. A slot is only decoded when it
 * carries an `image` of the right length; an empty slot or one written before the
 * card driver existed has `xray: null` and is never read as a block.
 */
export function decodeSlots(raw) {
  const list = Array.isArray(raw) ? raw : [];
  return Array.from({ length: SLOT_COUNT }, (_, slot) => {
    const entry = parseEntry(list[slot]);
    const image = entry?.image;
    const hasImage = Array.isArray(image) && image.length === RESIDENT_SAVE_SIZE;
    return {
      slot,
      key: slotKey(slot),
      empty: !entry,
      hasImage,
      record: entry?.record ?? null,
      playSeconds: Number.isFinite(Number(entry?.playSeconds)) ? Number(entry.playSeconds) : null,
      savedAt: Number.isFinite(Number(entry?.savedAt)) ? Number(entry.savedAt) : null,
      image: hasImage ? Uint8Array.from(image) : null,
      xray: hasImage ? xray(Uint8Array.from(image)) : null,
    };
  });
}

function parseEntry(raw) {
  if (!raw) return null;
  if (typeof raw === "string") {
    try { return JSON.parse(raw); } catch { return null; }
  }
  return typeof raw === "object" ? raw : null;
}
