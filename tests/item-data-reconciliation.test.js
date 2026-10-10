// One owner per number, for item data and for the card count.
//
// `web/assets/data/items.json` used to hold its own hand-authored copies of the
// consumable numbers (PowerCharge 200 HP, chips +5, prices off a rarity guess
// table) while `web/assets/data/item_effects.json` — the extract of the disc's
// master item table D0x80041844 and consumable-effect table D0x8005cb54 — held
// the disc's real ones (PowerCharge 500 HP, chips +10, real shop prices). Two
// shipped files, two answers. This test pins items.json to item_effects.json and
// pins both to the disc bytes, so neither side can drift again.
//
// Disc citation: master item table base 0x80041838, record = 12 bytes; item `id`'s
// effect-record pointer is the u32 at 0x80041838 + 12*id and that record's value
// halfword is u16 LE at pointer+2 (the extractor writes the same table as
// `D0x80041844` with row i = item i+1). Bytes: web/assets/native/screens/resident.bin.
//
// Card count: the raw CARDPAK0..4 catalog holds 316 records, but the album screen
// loops `id < 0x13B` (stcrdabm.s:259,277,381,634,689,2008), so it addresses ids
// 1..314 — 314 cards. Ids 315 (Calumon) and 316 (Impmon) are named out-of-collection
// specials. Ledger claim card-ids-315-316-are-out-of-collection-specials.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = new URL("..", import.meta.url);
const readJson = (p) => JSON.parse(readFileSync(new URL(p, root), "utf8"));

const A = readJson("web/assets/data/items.json");
const B = readJson("web/assets/data/item_effects.json");
const A_BY = new Map(A.items.map((r) => [r.id, r]));
const B_BY = new Map(B.items.map((r) => [r.id, r]));

const RESIDENT_BASE = 0x80010000;
const ITEM_RECORD_TABLE = 0x80041838;
const resident = new Uint8Array(readFileSync(new URL("web/assets/native/screens/resident.bin", root)));
const view = new DataView(resident.buffer, resident.byteOffset);
const u32 = (a) => view.getUint32(a - RESIDENT_BASE, true);
const u16 = (a) => view.getUint16(a - RESIDENT_BASE, true);
/** The disc's own effect record for item `id`: pointer target, value halfword, code byte. */
function discRecord(id) {
  const ptr = u32(ITEM_RECORD_TABLE + 12 * id);
  if (!ptr) return null;
  return { record: ptr, value: u16(ptr + 2), code: resident[ptr - RESIDENT_BASE + 1] };
}

test("items.json repeats item_effects.json's numbers instead of holding its own", () => {
  let checked = 0;
  for (const [id, a] of A_BY) {
    const b = B_BY.get(id);
    assert.ok(b, `items.json row ${id} ${a.name} has no item_effects.json record`);
    if ("effect" in b) assert.equal(a.effect, b.effect, `item ${id} ${b.name}: effect`);
    if ("value" in b) assert.equal(a.value, b.value, `item ${id} ${b.name}: value`);
    assert.equal(a.price, b.buy, `item ${id} ${b.name}: items.json price vs item_effects buy`);
    checked++;
  }
  assert.equal(checked, 83, "items.json projects the 83 consumable/booster records");
});

test("every consumable value on the two shipped files is the disc's own halfword", () => {
  let pinned = 0;
  for (const [id, b] of B_BY) {
    if (b.category !== "consumable" || !("value" in b)) continue;
    const d = discRecord(id);
    if (!d) continue;
    assert.equal(b.value, d.value,
      `item_effects.json item ${id} ${b.name} is not the disc value at 0x${d.record.toString(16)}`);
    if (A_BY.has(id)) {
      assert.equal(A_BY.get(id).value, d.value, `items.json item ${id} ${b.name} is not the disc value`);
    }
    pinned++;
  }
  assert.equal(pinned, 48, "the 48 consumable effect records all resolve");
});

test("the disc's settled headline values, pinned on all three sides", () => {
  // id -> the disc value halfword. A change to either shipped file, or to the disc
  // record the extractor reads, fails one of these.
  const settled = {
    43: 500, 44: 2000, 45: 5000, 46: 9999,          // Power/Super/Ultra/Max Charge
    47: 30, 48: 30,                                  // HP / MP Chip
    49: 10, 50: 10, 51: 10, 52: 10, 53: 10, 54: 10,  // Power/Armor/Mind/Wisdom/Boost/Charisma
    55: 10, 56: 10, 57: 10, 58: 10, 59: 10, 60: 10, 61: 10, // elemental chips
    62: 1, 63: 2, 64: 3, 65: 5,                      // TrainChips (TP)
    70: 0, 72: 32, 73: 64, 74: 64, 76: 200, 86: 96, 89: 32, // disks / plugs
  };
  for (const [id, v] of Object.entries(settled)) {
    const n = Number(id);
    assert.equal(discRecord(n)?.value, v, `disc record for item ${n}`);
    assert.equal(B_BY.get(n)?.value, v, `item_effects.json item ${n}`);
    assert.equal(A_BY.get(n)?.value, v, `items.json item ${n}`);
  }
});

test("the Card Album addresses 314 cards even though the raw catalog holds 316", () => {
  const catalog = readJson("web/assets/data/card_catalog.json");
  assert.equal(catalog.cards.length, 316, "the raw CARDPAK0..4 catalog holds 316 records");

  const album = readFileSync(new URL("web/cardalbum.js", root), "utf8");
  const m = album.match(/const CARD_COUNT_ABS = (0x[0-9a-fA-F]+|\d+)/);
  assert.ok(m, "cardalbum.js still declares CARD_COUNT_ABS");
  const bound = Number(m[1]);
  assert.equal(bound, 0x13b, "the album's own slti bound is 0x13B (id < 315)");
  assert.equal(bound - 1, 314, "so the album addresses ids 1..314 = 314 cards");

  assert.deepEqual(
    catalog.cards.filter((c) => c.id > 314).map((c) => c.id), [315, 316],
    "ids 315/316 are the two records past the bound");
});

test("no shipped file or doc labels the collection 315 any more", () => {
  for (const f of [
    "web/cardalbum.js", "web/cardalbum-native.js", "docs/research/systems-plain/cards.md",
  ]) {
    const text = readFileSync(new URL(f, root), "utf8");
    assert.equal(/315-card|315 cards|full 315/.test(text), false,
      `${f} still labels the collection 315 (the album addresses 314)`);
  }
  assert.match(readFileSync(new URL("docs/research/systems-plain/cards.md", root), "utf8"),
    /314 cards/, "cards.md states the settled 314");
});
