// tests/slot-check.test.js — Card Verify: a save slot is checked before it is
// trusted (web/slot-check.js + the read/load path in web/save.js).
//
// F2 -> Extras -> "Card verify (new)" (off by default). With the switch OFF
// `readSlot`/`restoreSlotData` behave exactly as today. With it ON every slot
// entry is checked for shape and honest numbers first: an image of exactly
// 0x26C4 byte values, a record whose clock is 0..99 h / 0..59 m / 0..59 s, a
// BIT count >= 0, three party types inside the disc's own eight starters
// (stored type -1 or 3..10, i.e. the type index -1..7) with levels 0..99, and a
// `data` object of string values. A damaged entry reads as no file and a load
// returns false before `restoreStorage` clears one key.
//
// The refused raw text is kept under `dw.quarantine.v1` (the Save Doctor's own
// quarantine key family) for a later look.
//
// What is NOT checked, and why (ddw3-walker docs/research/systems/save-block-layout.md:43):
// there is no stored 0xD4 directory block — web/memcard.js builds it from the
// records on every card open (web/save-translated.js:84 -> buildDirectoryBlock)
// so the XOR-8 has nothing to compare against — and the image's own +0 checksum
// byte has no decoded algorithm. Length and shape only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  IMAGE_SIZE,
  CODE_OK,
  CODE_FILE_NOT_FOUND,
  CODE_CARD_ERROR,
  checkSlot,
  checkRecord,
  checkImage,
} from "../web/slot-check.js";
import { RESIDENT_SAVE_SIZE } from "../web/vendor/engine.js";
import {
  __setStoreItem,
  __getStoreItem,
  __clearStore,
  readSlot,
  restoreSlotData,
  lastSlotRefusal,
} from "../web/save.js";

const here = dirname(fileURLToPath(import.meta.url));
const source = (p) => readFileSync(join(here, p), "utf8");

/** A record with the shape `web/save.js buildRecord` writes. */
function goodRecord(over = {}) {
  return {
    name: "Junior",
    areaIndex: 1,
    placeIndex: 1,
    areaText: "Asuka City",
    bits: 500,
    hours: 3,
    minutes: 4,
    seconds: 5,
    partyTypes: [3, 4, 5],
    partyLevels: [10, 11, 12],
    ...over,
  };
}

/** A whole 0x26C4-byte image, every value a legal byte. */
const goodImage = () => Array.from({ length: IMAGE_SIZE }, (_, i) => i & 0xff);

/** A good slot entry (the translated screen's writeSlot shape). */
function goodEntry(over = {}) {
  return {
    record: goodRecord(),
    data: { bits: "500", party: "[]" },
    savedAt: 1,
    image: goodImage(),
    residentImageVersion: 1,
    ...over,
  };
}

/** Run `fn` with a stubbed `window.__fx`, then put the global back. */
function withFx(flags, fn) {
  const had = Object.prototype.hasOwnProperty.call(globalThis, "window");
  const prev = globalThis.window;
  globalThis.window = { __fx: flags };
  try { return fn(); } finally {
    if (had) globalThis.window = prev; else delete globalThis.window;
  }
}

// ── the numbers ───────────────────────────────────────────────────────────────

test("the card image is 9924 bytes, the engine's own resident save size", () => {
  assert.equal(IMAGE_SIZE, 9924);
  assert.equal(IMAGE_SIZE, 0x26c4);
  assert.equal(IMAGE_SIZE, RESIDENT_SAVE_SIZE);
});

test("a good entry passes with the disc's success code", () => {
  const r = checkSlot(goodEntry());
  assert.equal(r.ok, true);
  assert.equal(r.empty, false);
  assert.equal(r.code, CODE_OK);
  assert.equal(r.why, "");
});

test("a record without an image is still a good entry (the hand-made screen's save)", () => {
  const entry = goodEntry();
  delete entry.image;
  delete entry.residentImageVersion;
  assert.equal(checkSlot(entry).ok, true);
});

test("an entry that says 'restore me through the card image' but carries none is a card error", () => {
  // restoreSlotData would hand the missing image to writeSaveBlock, which throws
  // inside the restore — this is exactly the failure the check exists to stop.
  const entry = goodEntry();
  delete entry.image;
  entry.residentImageVersion = 1;
  const r = checkSlot(entry);
  assert.equal(r.ok, false);
  assert.equal(r.code, CODE_CARD_ERROR);
  assert.match(r.why, /image/);
});

// ── pictures that lie ─────────────────────────────────────────────────────────

test("an image one byte short is a card error", () => {
  const r = checkSlot(goodEntry({ image: goodImage().slice(0, 9923) }));
  assert.equal(r.ok, false);
  assert.equal(r.code, CODE_CARD_ERROR);
  assert.match(r.why, /9923/);
});

test("an image value above 255 is a card error", () => {
  const image = goodImage();
  image[5] = 300;
  const r = checkSlot(goodEntry({ image }));
  assert.equal(r.ok, false);
  assert.equal(r.code, CODE_CARD_ERROR);
});

test("an image that is not a list of bytes is a card error", () => {
  const r = checkSlot(goodEntry({ image: "x" }));
  assert.equal(r.ok, false);
  assert.equal(r.code, CODE_CARD_ERROR);
  assert.equal(checkImage("x").code, CODE_CARD_ERROR);
});

// ── records that lie ─────────────────────────────────────────────────────────

test("a play clock outside its own ranges is a card error", () => {
  for (const over of [{ hours: 120 }, { minutes: 60 }, { seconds: 60 }, { hours: -1 }]) {
    const r = checkSlot(goodEntry({ record: goodRecord(over) }));
    assert.equal(r.ok, false, JSON.stringify(over));
    assert.equal(r.code, CODE_CARD_ERROR, JSON.stringify(over));
  }
});

test("a negative or non-numeric BIT count is a card error", () => {
  for (const bits of [-1, "500", undefined, NaN]) {
    const r = checkSlot(goodEntry({ record: goodRecord({ bits }) }));
    assert.equal(r.ok, false, String(bits));
    assert.equal(r.code, CODE_CARD_ERROR, String(bits));
  }
});

test("a party slot outside the disc's starter types is a card error", () => {
  // The record stores the disc's type code: -1 (record empty), 0 (the block's
  // empty form) or 3..10, whose index is code - 3 (-1..7 in the card's words).
  assert.equal(checkSlot(goodEntry({ record: goodRecord({ partyTypes: [-1, -1, -1] }) })).ok, true);
  assert.equal(checkSlot(goodEntry({ record: goodRecord({ partyTypes: [10, 3, 4] }) })).ok, true);
  assert.equal(checkSlot(goodEntry({ record: goodRecord({ partyTypes: [0, 7, 3] }) })).ok, true);
  for (const partyTypes of [[11, 3, 4], [120, 3, 4], [3.5, 4, 5], [3, 4], [3, 4, 5, 6], "x", undefined]) {
    const r = checkSlot(goodEntry({ record: goodRecord({ partyTypes }) }));
    assert.equal(r.ok, false, JSON.stringify(partyTypes));
    assert.equal(r.code, CODE_CARD_ERROR, JSON.stringify(partyTypes));
  }
});

test("a party level outside 0..99 is a card error", () => {
  const r = checkSlot(goodEntry({ record: goodRecord({ partyLevels: [120, 11, 12] }) }));
  assert.equal(r.ok, false);
  assert.equal(r.code, CODE_CARD_ERROR);
  assert.match(r.why, /120/);
});

test("a record that is not an object is a card error", () => {
  for (const record of ["x", 5, [], null]) {
    const r = checkSlot(goodEntry({ record }));
    if (record === null) {
      // record null with an image still present carries something: it is not
      // the empty file (an empty file has no image either).
      assert.equal(r.ok, false);
      assert.equal(r.code, CODE_CARD_ERROR);
    } else {
      assert.equal(r.ok, false);
      assert.equal(r.code, CODE_CARD_ERROR);
    }
  }
});

// ── the snapshot that rides with the file ────────────────────────────────────

test("data that is not an object of string values is a card error", () => {
  for (const data of ["x", 5, [], null, { a: 5 }, { a: "1", b: null }]) {
    const r = checkSlot(goodEntry({ data }));
    assert.equal(r.ok, false, JSON.stringify(data));
    assert.equal(r.code, CODE_CARD_ERROR, JSON.stringify(data));
  }
});

// ── empty is not damaged ─────────────────────────────────────────────────────

test("an entry with no record and no image is an empty file, not an error", () => {
  for (const entry of [{ record: null }, { record: null, data: {} }, {}]) {
    const r = checkSlot(entry);
    assert.equal(r.ok, true);
    assert.equal(r.empty, true);
    assert.equal(r.code, CODE_FILE_NOT_FOUND);   // the disc's code 5, "File cannot be found."
  }
});

// ── the read path ────────────────────────────────────────────────────────────

test("switch off: a damaged slot is still read exactly as today", () => {
  __clearStore();
  const entry = goodEntry({ image: goodImage().slice(0, 10) });
  __setStoreItem("mcardSlot0", JSON.stringify(entry));
  withFx({}, () => {
    assert.equal(readSlot(0).record.name, "Junior");
    assert.equal(restoreSlotData(0), true);      // today: the snapshot loads anyway
  });
});

test("switch on: a damaged slot reads as no file and keeps its raw text", () => {
  __clearStore();
  const raw = JSON.stringify(goodEntry({ image: goodImage().slice(0, 9923) }));
  __setStoreItem("mcardSlot0", raw);
  withFx({ saveverify: true }, () => {
    assert.equal(readSlot(0), null);
    const kept = JSON.parse(__getStoreItem("dw.quarantine.v1"));
    assert.equal(kept.mcardSlot0, raw);
  });
});

test("switch on: a refused load returns false and deletes no live key", () => {
  __clearStore();
  __setStoreItem("bits", "1234");
  __setStoreItem("party", '["p003pken"]');
  __setStoreItem("flags", '{"story":3}');
  __setStoreItem("mcardSlot0", JSON.stringify(goodEntry({ image: goodImage().slice(0, 9923) })));
  withFx({ saveverify: true }, () => {
    assert.equal(restoreSlotData(0), false);
    assert.equal(lastSlotRefusal().code, CODE_CARD_ERROR);
    assert.equal(__getStoreItem("bits"), "1234");
    assert.equal(__getStoreItem("party"), '["p003pken"]');
    assert.equal(__getStoreItem("flags"), '{"story":3}');
  });
});

test("switch on: an empty slot reads as no file", () => {
  __clearStore();
  __setStoreItem("mcardSlot0", JSON.stringify({ record: null, data: {} }));
  withFx({ saveverify: true }, () => {
    assert.ok(readSlot(0));                      // not damaged: today's read
    assert.equal(checkSlot(readSlot(0)).empty, true);
  });
});

test("switch on: a good slot still loads and follows today's snapshot rule", () => {
  __clearStore();
  __setStoreItem("bits", "1");
  __setStoreItem("party", '["old"]');
  __setStoreItem("flags", '{"story":1}');
  __setStoreItem("leftOver", "x");              // a key the snapshot does not carry
  __setStoreItem("mcardSlot0", JSON.stringify(goodEntry()));
  withFx({ saveverify: true }, () => {
    assert.equal(restoreSlotData(0), true);
    assert.equal(__getStoreItem("bits"), "500");
    assert.equal(__getStoreItem("party"), "[]");
    assert.equal(__getStoreItem("flags"), null);
    assert.equal(__getStoreItem("leftOver"), null);
  });
});

// ── the source rules ─────────────────────────────────────────────────────────

test("web/slot-check.js is pure: no DOM, no storage, no fetch", () => {
  const src = source("../web/slot-check.js");
  // \b keeps the header's "message_window.result_messages" from matching.
  const banned = [/\bdocument\b/, /\bwindow\b/, /localStorage/, /sessionStorage/, /fetch\(/];
  for (const pattern of banned) assert.ok(!pattern.test(src), `slot-check.js must not match ${pattern}`);
});

test("web/save.js calls checkSlot from both readSlot and restoreSlotData", () => {
  const src = source("../web/save.js");
  const body = (name) => {
    const start = src.indexOf(`export function ${name}`);
    assert.ok(start >= 0, `${name} exists`);
    return src.slice(start, src.indexOf("\n}", start));
  };
  assert.match(body("readSlot"), /checkSlot\(/);
  assert.match(body("restoreSlotData"), /checkSlot\(/);
});

test("web/ambience.js carries the F2 pair, off by default", () => {
  const src = source("../web/ambience.js");
  assert.match(src, /\["saveverify", "Card verify \(new\)"\]/);
  const experimental = src.slice(src.indexOf("const EXPERIMENTAL = "), src.indexOf("// off until you switch them on"));
  assert.match(experimental, /"saveverify"/);
});
