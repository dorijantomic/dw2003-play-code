// Save X-ray: your own memory-card slot read as the disc's 0x26C4-byte resident
// block — every offset named, every byte outside a named interval kept and
// labelled "retained" — and two slots diffed field by field.
//
// F2 -> Extras -> "Save X-ray (new)" (off by default). With the switch off there
// is no row to click, no page and no localStorage read.
//
// The layout authority is ddw3-walker docs/research/systems/save-block-layout.md;
// the populations below are pinned to the engine's own constants, never to a
// second copy of the numbers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  RESIDENT_SAVE_SIZE,
  SECTION_TABLE,
  RETAINED_SPANS,
  xray,
  diffSlots,
  decodeSlots,
  SLOT_COUNT,
} from "../web/save-xray.js";
import {
  RESIDENT_SAVE_SIZE as ENGINE_SAVE_SIZE,
  SAVE_CARD_MAX,
  SAVE_FOLDER_COUNT,
  SAVE_FOLDER_SIZE,
  SAVE_FOLDER_CARDS,
  RESIDENT_ROSTER_COUNT,
  RESIDENT_FORM_COUNT,
  RESIDENT_FORM_SIZE,
  ROSTER_STRIDE,
  SAVE_STORED_BANKS,
  heldArrayAddress,
  wornArrayAddress,
  readItemArrays,
} from "../web/vendor/engine.js";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const src = () => read("../web/save-xray.js");

const table = (name) => SECTION_TABLE.find((s) => s.name === name);

test("the block is the engine's own 9924 bytes and every byte is named or retained", () => {
  assert.equal(RESIDENT_SAVE_SIZE, 9924);
  assert.equal(RESIDENT_SAVE_SIZE, ENGINE_SAVE_SIZE);

  // The table is the whole image, in order, with no gap and no overlap.
  let at = 0;
  for (const row of SECTION_TABLE) {
    assert.equal(row.offset, at, `${row.name} starts where the previous row ends`);
    assert.ok(Number.isInteger(row.length) && row.length > 0, `${row.name} has a length`);
    assert.equal(typeof row.note, "string");
    assert.ok(row.note.length > 0, `${row.name} explains itself`);
    at += row.length;
  }
  assert.equal(at, RESIDENT_SAVE_SIZE, "the table covers the last byte");

  // The named intervals come from the engine's own offsets and populations.
  assert.equal(table("held").offset, heldArrayAddress(0, 0));
  assert.equal(table("held").length, heldArrayAddress(402, 0) - heldArrayAddress(0, 0) + 1);
  assert.equal(table("held").length, 403);
  assert.equal(table("worn").offset, wornArrayAddress(0, 0));
  assert.equal(table("worn").length, wornArrayAddress(402, 0) - wornArrayAddress(0, 0) + 1);
  assert.equal(table("worn").length, 403);
  assert.equal(table("card counts").length, SAVE_CARD_MAX + 1, "315 ids plus id zero");
  assert.equal(table("album").length, SAVE_CARD_MAX + 1);
  assert.equal(table("folders").length, SAVE_FOLDER_COUNT * SAVE_FOLDER_SIZE);
  assert.equal(table("roster").length, RESIDENT_ROSTER_COUNT * ROSTER_STRIDE);
  assert.equal(table("roster").length, 8 * 988);
  assert.equal(table("flags").offset, SAVE_STORED_BANKS[0][1]);
  assert.equal(table("flags").length, RESIDENT_SAVE_SIZE - SAVE_STORED_BANKS[0][1]);
  assert.equal(table("pack").offset, RESIDENT_SAVE_SIZE - 0x80 - 4);

  // The retained spans are the complement the table's own retained rows promise.
  let unexplained = 0;
  for (const span of RETAINED_SPANS) {
    assert.equal(span.name, "retained");
    assert.ok(span.note.length > 0);
    unexplained += span.length;
  }
  assert.equal(unexplained, RETAINED_SPANS.reduce((n, s) => n + s.length, 0));

  // An empty image decodes without a throw and fills every section.
  const empty = new Uint8Array(RESIDENT_SAVE_SIZE);
  const x = xray(empty);
  assert.equal(x.bits, 0);
  assert.equal(x.items.held.length, 403);
  assert.equal(x.items.worn.length, 403);
  assert.equal(x.roster.length, RESIDENT_ROSTER_COUNT);
  for (const rec of x.roster) {
    assert.equal(rec.forms.length, RESIDENT_FORM_COUNT, "44 form cells per record");
    for (const cell of rec.forms) {
      assert.equal(typeof cell.id, "number");
      assert.equal(typeof cell.level, "number");
      assert.equal(cell.tech.length, 6);
    }
  }
  assert.equal(x.cards.counts.length, SAVE_CARD_MAX + 1);
  assert.equal(x.cards.album.length, SAVE_CARD_MAX + 1);
  assert.equal(x.folders.length, SAVE_FOLDER_COUNT);
  for (const f of x.folders) assert.equal(f.cards.length, SAVE_FOLDER_CARDS);
  assert.equal(Object.keys(x.flags).length, SAVE_STORED_BANKS.length);
  for (const [bank, start] of SAVE_STORED_BANKS) {
    const row = x.flags[bank];
    assert.equal(row.offset, start);
    assert.ok(Array.isArray(row.bytes) && row.bytes.length > 0);
  }
  assert.deepEqual(x.clock, { hours: 0, minutes: 0, seconds: 0, totalSeconds: 0 });
  assert.equal(x.retained.namedBytes + x.retained.unexplainedBytes, RESIDENT_SAVE_SIZE);
  assert.equal(x.retained.unexplainedBytes, unexplained);
  assert.equal(x.retained.namedBytes, RESIDENT_SAVE_SIZE - unexplained);
  assert.equal(x.retained.spans.length, RETAINED_SPANS.length);
});

const put16 = (img, at, value) => {
  img[at] = value & 0xff;
  img[at + 1] = (value >>> 8) & 0xff;
};
const put32 = (img, at, value) => {
  img[at] = value & 0xff;
  img[at + 1] = (value >>> 8) & 0xff;
  img[at + 2] = (value >>> 16) & 0xff;
  img[at + 3] = (value >>> 24) & 0xff;
};

test("a fixture image reports exactly the fields it holds and nothing else", () => {
  const img = new Uint8Array(RESIDENT_SAVE_SIZE);
  put32(img, 0x6c, 1234);                 // BIT
  img[0x7c + 43] = 5;                     // held count of item 43
  img[0x20f + 46] = 1;                    // worn count of item 46
  img[0x3a2 + 1] = 7;                     // card 1 count 7
  put16(img, 0x628 + 0x16 + 1 * 2, 12);   // folder 0, card 1 = card id 12
  img[SAVE_STORED_BANKS[0][1]] = 0x80;    // flag bank 2, first byte

  const x = xray(img);
  assert.equal(x.bits, 1234);
  assert.equal(x.items.held[43], 5);
  assert.equal(x.items.worn[46], 1);
  assert.deepEqual(x.items.held.filter((n) => n !== 0), [5], "no other carried count");
  assert.deepEqual(x.items.worn.filter((n) => n !== 0), [1], "no other worn count");
  assert.deepEqual(x.cards.owned, [[1, 7]]);
  assert.deepEqual(x.cards.counts.map((n, id) => [id, n]).filter(([, n]) => n !== 0), [[1, 7]]);
  assert.deepEqual(x.cards.seen, []);
  assert.deepEqual(x.folders[0].cards.slice(0, 3), [0, 12, 0]);
  assert.equal(x.folders[0].cards.filter((n) => n !== 0).length, 1);
  assert.equal(x.folders[1].cards.filter((n) => n !== 0).length, 0);
  assert.equal(x.folders[2].cards.filter((n) => n !== 0).length, 0);
  assert.equal(x.flags[2].bytes[0], 0x80);
  for (const [bank, row] of Object.entries(x.flags)) {
    if (Number(bank) === 2) assert.deepEqual(row.bytes.slice(1), row.bytes.slice(1).map(() => 0), "only the first flag byte is set");
    else assert.ok(row.bytes.every((b) => b === 0), `bank ${bank} is untouched`);
  }
  // The roster, clock, name and party are untouched by the fixture.
  for (const rec of x.roster) {
    assert.equal(rec.owned, 0);
    assert.equal(rec.level, 0);
    assert.equal(rec.xp, 0);
    assert.equal(rec.maxMp, 0);
    assert.equal(rec.lastUltraDrill, 0);
    assert.ok(rec.forms.every((cell) => cell.id === 0 && cell.level === 0 && cell.dvexp === 0 && cell.tech.every((t) => t === 0)));
  }
  assert.deepEqual(x.clock, { hours: 0, minutes: 0, seconds: 0, totalSeconds: 0 });
  assert.equal(x.packId, 0);
  assert.deepEqual(x.party, [0, 0, 0]);

  // And the diff against an empty card names exactly those six fields, in image order.
  assert.deepEqual(diffSlots(new Uint8Array(RESIDENT_SAVE_SIZE), img).map((r) => r.field), [
    "bits", "held[43]", "worn[46]", "cards[1]", "folders[0].card[1]", "flags[2].byte[0]",
  ]);
});

test("both item arrays are 403 bytes and every id 1..402 agrees with the engine's reader", () => {
  const img = new Uint8Array(RESIDENT_SAVE_SIZE);
  for (let id = 1; id <= 402; id++) {
    img[heldArrayAddress(id, 0)] = (id % 7) + 1;
    img[wornArrayAddress(id, 0)] = (id % 5) + 1;
  }
  const x = xray(img);
  const engineRows = readItemArrays({ read8: (at) => img[at] }, 0);

  assert.equal(wornArrayAddress(0, 0) - heldArrayAddress(0, 0), 403, "the held array is the three bytes before the worn one");
  assert.equal(x.items.held.length, 403);
  assert.equal(x.items.worn.length, 403);
  assert.equal(engineRows.length, 402, "ids 1..402, never id zero");
  assert.deepEqual(engineRows.map((r) => r.id), Array.from({ length: 402 }, (_, i) => i + 1));
  for (const row of engineRows) {
    assert.equal(x.items.held[row.id], row.held, `held ${row.id}`);
    assert.equal(x.items.worn[row.id], row.worn, `worn ${row.id}`);
  }
});

test("two saves that differ only in BIT diff to one row", () => {
  const a = new Uint8Array(RESIDENT_SAVE_SIZE);
  const b = new Uint8Array(RESIDENT_SAVE_SIZE);
  put32(b, 0x6c, 1234);
  assert.deepEqual(diffSlots(a, b), [{ field: "bits", a: 0, b: 1234 }]);
});

test("a changed byte inside a retained gap is one retained +0x row", () => {
  const a = new Uint8Array(RESIDENT_SAVE_SIZE);
  const b = new Uint8Array(RESIDENT_SAVE_SIZE);
  b[0x061b] = 9; // the first byte of the retained gap after the album
  assert.deepEqual(diffSlots(a, b), [{ field: "retained +0x61b", a: 0, b: 9 }]);
  // and the same for the retained bytes around the folders and the records
  const c = new Uint8Array(RESIDENT_SAVE_SIZE);
  c[0x075a] = 3;
  assert.deepEqual(diffSlots(a, c), [{ field: "retained +0x75a", a: 0, b: 3 }]);
  // A record's own retained bytes (+0x4A..0x50 of slot 0's record) are retained too.
  const d = new Uint8Array(RESIDENT_SAVE_SIZE);
  d[0x760 + 0x4a] = 4;
  assert.deepEqual(diffSlots(a, d), [{ field: "retained +0x7aa", a: 0, b: 4 }]);
});

test("identical images diff to nothing", () => {
  const a = new Uint8Array(RESIDENT_SAVE_SIZE);
  for (let i = 0; i < a.length; i++) a[i] = (i * 13 + 17) & 0xff;
  assert.deepEqual(diffSlots(a, Uint8Array.from(a)), []);
});

test("decodeSlots decodes only the slots that carry an image", () => {
  const img = new Uint8Array(RESIDENT_SAVE_SIZE);
  put32(img, 0x6c, 55);
  const raw = [
    JSON.stringify({ record: { name: "Tamer" }, image: Array.from(img), playSeconds: 3725 }),
    JSON.stringify({ record: { name: "No image here" } }),
    null,
  ];
  const slots = decodeSlots(raw);
  assert.equal(slots.length, SLOT_COUNT);
  assert.equal(slots[0].slot, 0);
  assert.equal(slots[0].key, "mcardSlot0");
  assert.equal(slots[0].hasImage, true);
  assert.equal(slots[0].xray.bits, 55);
  assert.equal(slots[0].image.length, RESIDENT_SAVE_SIZE);
  assert.equal(slots[0].record.name, "Tamer");
  assert.equal(slots[0].playSeconds, 3725);
  assert.equal(slots[1].hasImage, false, "a slot without an image is never decoded");
  assert.equal(slots[1].xray, null);
  assert.equal(slots[1].record.name, "No image here");
  assert.equal(slots[2].empty, true);
  assert.equal(slots[2].xray, null);

  // Malformed JSON and a short image never throw and never count as a block.
  const junk = decodeSlots(["not json", JSON.stringify({ image: [1, 2, 3] }), undefined]);
  assert.deepEqual(junk.map((s) => s.xray), [null, null, null]);
  assert.deepEqual(junk.map((s) => s.hasImage), [false, false, false]);
});

test("the model is pure: no DOM, no storage, no fetch, and it writes nothing", () => {
  const source = src();
  assert.doesNotMatch(source, /\bdocument\b/);
  assert.doesNotMatch(source, /\bwindow\b/);
  assert.doesNotMatch(source, /\blocalStorage\b/);
  assert.doesNotMatch(source, /\bsessionStorage\b/);
  assert.doesNotMatch(source, /\bfetch\s*\(/);
  assert.doesNotMatch(source, /\.setItem\s*\(/);
  assert.doesNotMatch(source, /\bwrite8\s*\(/);
  assert.doesNotMatch(source, /\bwriteSaveBlock\b/);
});

test("the section lengths are imported from the engine, never re-typed", () => {
  const source = src();
  assert.match(source, /from "\.\/vendor\/engine\.js"/);
  for (const name of [
    "RESIDENT_SAVE_SIZE", "SAVE_CARD_MAX", "SAVE_FOLDER_COUNT", "SAVE_FOLDER_SIZE",
    "SAVE_FOLDER_CARDS", "RESIDENT_ROSTER_COUNT", "RESIDENT_FORM_COUNT",
    "RESIDENT_FORM_SIZE", "ROSTER_STRIDE", "SAVE_STORED_BANKS",
    "heldArrayAddress", "wornArrayAddress",
  ]) {
    assert.match(source, new RegExp(`\\b${name}\\b`), `${name} comes from the engine`);
  }
});

test("the page is three slot buttons, a field list and a diff picker over one store read", () => {
  const page = read("../web/save-xray.html");
  const script = read("../web/save-xray-page.js");

  assert.match(page, /<script type="module" src="\.\/save-xray-page\.js"><\/script>/, "the page's own script");
  for (const id of ["slots", "view", "diffSlot", "diffRows"]) {
    assert.match(page, new RegExp(`id="${id}"`), `the page has #${id}`);
  }
  assert.match(script, /from "\.\/save-xray\.js"/, "the page renders through the pure module");
  assert.match(script, /\bdecodeSlots\(/, "slot entries come from decodeSlots");
  assert.match(script, /\bdiffSlots\(/, "the diff comes from diffSlots");
  assert.match(script, /\bSECTION_TABLE\b/, "the field list is the section table");
  assert.match(script, /localStorage\.getItem\(slotKey\(i\)\)/, "the page owns the one slot read");
  assert.match(script, /\.hasImage/, "a slot without an image is never offered");
  assert.match(script, /\.filter\(\(slot\) => slot\.hasImage\)/, "only decodable slots are listed");
  assert.doesNotMatch(script, /fetch\s*\(/, "no network");
  assert.doesNotMatch(script, /\.setItem\s*\(/, "the page writes nothing back to the save");
});

test("the F2 switch is off by default and gates the row, the page and every slot read", () => {
  const ambience = read("../web/ambience.js");
  assert.match(ambience, /\["savexray", "Save X-ray \(new\)"\]/, "the F2 Extras row");
  const experimental = ambience.match(/const EXPERIMENTAL = \[([^\]]*)\];/);
  assert.ok(experimental, "EXPERIMENTAL is still one array literal");
  assert.match(experimental[1], /"savexray"/, "off until the player switches it on");
  assert.match(ambience, /id="fx-savexray" hidden/, "the button row ships hidden");
  assert.match(ambience, /const savexray = panel\.querySelector\("#fx-savexray"\); if \(savexray\) savexray\.hidden = !fx\.savexray;/,
    "refreshPanel follows the switch");
  assert.match(ambience, /if \(fx\.savexray\)[^;{}]*window\.open\("save-xray\.html", "_blank", "noopener"\)/,
    "opened only behind the toggle's guard");
  assert.equal(ambience.split("save-xray.html").length - 1, 1, "one reference to the page, no other link into it");
  assert.doesNotMatch(ambience, /(get|has)\("savexray"\)/, "never a URL flag");
  assert.doesNotMatch(ambience, /mcardSlot\d/, "the off state reads no slot");
  assert.match(ambience, /#fx-panel \.row\[hidden\] \{ display:none; \}/, "the panel's own rule that makes a hidden row vanish");
});
