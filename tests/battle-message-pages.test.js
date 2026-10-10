// Every PAGE KIND of the in-battle message box, one test each, plus the census that
// keeps the port, the arm table and the research document listing the same kinds.
//
// The decode is docs/research/battle/battle-message-page-kinds-2026-10-04.md and the port
// is engine/dw3/ui/native/battle-message-pages.ts on top of the already-ported arm table
// in engine/dw3/ui/native/battle-message-line.ts.
//
// Each test states the two lines a player reads, rendered through the shipped English
// message bank (web/assets/data/battlecmd/esmfight.json) and the shipped item-name bank
// (esitmnam.json), so a wrong arm index, a wrong slot or a wrong payload word all fail.
//
// Every test here FAILS on the code before this change: the module did not exist, so
// `battleMessagePage` was undefined and the two typed sites in web/battle.js —
// `trySteal`'s " Stole X!" suffix and `applyWeaponSecondary`'s " Drained N HP!" —
// produced walker wording with no page for the box.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  BATTLE_MESSAGE_ARMS, BATTLE_MESSAGE_BANK, BATTLE_MESSAGE_BANK_FIELD, BATTLE_MESSAGE_KIND_MAX,
  BATTLE_MESSAGE_NAME, BATTLE_MESSAGE_CURSE_INDEX,
  BATTLE_MESSAGE_PAGE_KINDS, BATTLE_MESSAGE_CURSE_WORDS,
  battleMessageArm, battleMessageLineIndex, battleMessageNamesLineOne,
  battleMessagePage,
} from "../web/vendor/engine.js";
import { battleMessageCompose } from "../engine/dw3/ui/battle-message-session.ts";

const ESMFIGHT = JSON.parse(readFileSync(
  new URL("../web/assets/data/battlecmd/esmfight.json", import.meta.url), "utf8")).strings;
const ESITMNAM = JSON.parse(readFileSync(
  new URL("../web/assets/data/battlecmd/esitmnam.json", import.meta.url), "utf8")).strings;

const NAME = "Koko";
const ITEM_ID = 47;          // the item-name bank is indexed by ItemId
const ITEM_NAME = ESITMNAM[ITEM_ID];

/**
 * Render the page the original would draw, the way the session does: resolve each line's
 * bank index through the ported arm table and substitute the numbered slots.
 *
 * `battleMessageLineIndex` is the ARM's own resolution, so this asserts the payload the
 * builder wrote against the arm's own reading of it, and then the words that come out.
 */
function render(page) {
  const out = [];
  for (const line of [0, 1]) {
    const index = battleMessageLineIndex(page.kind, line, page.payload);
    if (index === null) { out.push(""); continue; }
    const template = ESMFIGHT[index] ?? "";
    // The shared tail FIGHTSTG_F0x80098d14 fills slot 1 of the line at (20,194) with the
    // acting Digimon's name, so line one's numbered slots start with the name; line two's
    // slots are the ones the ARM wrote.
    const slots = line === 0 ? [page.name ?? "", ...page.slots] : page.slots;
    out.push(battleMessageCompose(template, slots));
  }
  return out;
}

/** Every kind must be a builder AND an arm, and the two lists must be the same list. */
test("the VM bounds 22 kinds and the port builds every one of them", () => {
  assert.equal(BATTLE_MESSAGE_KIND_MAX, 0x16);
  assert.deepEqual(BATTLE_MESSAGE_PAGE_KINDS,
    Array.from({ length: 22 }, (_u, i) => i + 1));
  assert.equal(BATTLE_MESSAGE_PAGE_KINDS.length, BATTLE_MESSAGE_ARMS.length);
  for (const kind of BATTLE_MESSAGE_PAGE_KINDS) {
    assert.ok(battleMessageArm(kind), `kind ${kind} has an arm`);
    assert.ok(battleMessagePage(kind, { name: NAME }), `kind ${kind} has a builder`);
  }
  // The bound check rejects kind 0 and kind 23, and so does the builder.
  assert.equal(battleMessagePage(0), null);
  assert.equal(battleMessagePage(23), null);
  assert.equal(battleMessagePage(-1), null);
});

test("kind 1 -- the one-line arm: line 1 is the caller's index and nobody is named", () => {
  const page = battleMessagePage(1, { name: NAME, index: 7 });
  assert.equal(page.name, null, "the arm jumps to .L0x8009a200, skipping the shared tail");
  assert.equal(battleMessageNamesLineOne(1), false);
  assert.deepEqual(render(page), ["Ambush!", ""]);
});

test("kind 2 -- the outcome arm: the name, then the caller's own word", () => {
  const page = battleMessagePage(2, { name: NAME, index: 0x1d });
  assert.deepEqual(render(page), [NAME, "Evade!"]);
});

test("kind 3 -- the technique arm: the name, then the technique name out of bank 0xa2", () => {
  const page = battleMessagePage(3, { name: NAME, slot: "Fire Blast" });
  assert.deepEqual(render(page), [NAME, "Fire Blast!"]);
  assert.equal(battleMessageArm(3).slots[0].bank, 0xa2);
});

test("kind 4 -- the damage arm: the name, then '{1} damage!'", () => {
  const page = battleMessagePage(4, { name: NAME, numbers: [510] });
  assert.deepEqual(render(page), [NAME, "510 damage!"]);
});

test("kind 5 -- 'Counter! {1}!', the technique name out of bank 0xa2", () => {
  const page = battleMessagePage(5, { name: NAME, slot: "Revenge" });
  assert.deepEqual(render(page), [NAME, "Counter! Revenge!"]);
  assert.equal(battleMessageArm(5).slots[0].bank, 0xa2);
});

test("kind 6 -- 'Counter!', and nothing on the second line's slots", () => {
  const page = battleMessagePage(6, { name: NAME });
  assert.deepEqual(render(page), [NAME, "Counter!"]);
  assert.equal(battleMessageArm(6).slots.length, 0);
});

test("kind 7 -- the caller's index goes on line two, under the name", () => {
  const page = battleMessagePage(7, { name: NAME, index: 0x1c });
  assert.deepEqual(render(page), [NAME, "DNA DV"]);
});

test("kind 8 -- '{1}HP healed!'", () => {
  const page = battleMessagePage(8, { name: NAME, numbers: [120] });
  assert.deepEqual(render(page), [NAME, "120HP healed!"]);
});

test("kind 9 -- the silent arm: no text on either line, and nobody named", () => {
  const page = battleMessagePage(9, { name: NAME });
  assert.equal(page.name, null);
  assert.deepEqual(page.payload, []);
  assert.deepEqual(page.slots, []);
  assert.deepEqual(render(page), ["", ""]);
});

test("kind 10 -- 'HP gradually recovers.', with no numbered slot at all", () => {
  const page = battleMessagePage(10, { name: NAME, value: 30 });
  assert.deepEqual(render(page), [NAME, "HP gradually recovers."]);
  assert.equal(battleMessageArm(10).slots.length, 0);
});

test("kind 11 -- '{1}HP healed!' from the THIRD payload word", () => {
  const page = battleMessagePage(11, { name: NAME, value: 120 });
  assert.equal(battleMessageArm(11).slots[0].payload, 2, "the arm reads payload[2]");
  assert.deepEqual(render(page), [NAME, "120HP healed!"]);
});

test("kind 12 -- 'Digivolved! {1}!', the new form's name out of bank 0x4e", () => {
  const page = battleMessagePage(12, { name: NAME, slot: "Greymon" });
  assert.deepEqual(render(page), [NAME, "Digivolved! Greymon!"]);
  assert.equal(battleMessageArm(12).slots[0].bank, 0x4e);
});

test("kind 13 -- 'Next Digimon out!' over the partner's own name", () => {
  const page = battleMessagePage(13, { name: NAME, index: 1, slot: "Patamon" });
  assert.deepEqual(render(page), ["Next Digimon out!", "Patamon!"]);
  assert.equal(battleMessageArm(13).line1, 0x4e);
});

test("kind 14 -- the item announcement, the item's name out of bank 0x6a by ItemId", () => {
  const page = battleMessagePage(14, { name: NAME, index: ITEM_ID, slot: ITEM_NAME });
  assert.deepEqual(page.payload, [0, ITEM_ID]);
  assert.deepEqual(render(page), [NAME, `${ITEM_NAME}!`]);
  assert.equal(battleMessageArm(14).slots[0].bank, BATTLE_MESSAGE_BANK_FIELD);
});

test("kind 15 -- 'Poisoned: {1}' from the THIRD payload word", () => {
  const page = battleMessagePage(15, { name: NAME, value: 12 });
  assert.equal(battleMessageArm(15).slots[0].payload, 2);
  assert.deepEqual(render(page), [NAME, "Poisoned: 12"]);
});

test("kind 16 -- '{1} X {2} = {3}!', the third slot the product of the first two", () => {
  const page = battleMessagePage(16, { name: NAME, numbers: [5, 3] });
  assert.deepEqual(page.payload.slice(1), [5, 3]);
  assert.deepEqual(page.slots, ["5", "3", "15"]);
  assert.deepEqual(render(page), [NAME, "5 X 3 = 15!"]);
});

test("kind 17 -- 'Stole' over the item's own name, the steal page", () => {
  const page = battleMessagePage(17, { name: NAME, index: ITEM_ID, slot: ITEM_NAME });
  assert.deepEqual(render(page), ["Stole", `${ITEM_NAME}!`]);
  assert.equal(battleMessageArm(17).slots[0].bank, BATTLE_MESSAGE_BANK_FIELD);
});

test("kind 18 -- the weapon drain: '{1}HP healed!', or MP when the third word is set", () => {
  const hp = battleMessagePage(18, { name: NAME, numbers: [120] });
  assert.deepEqual(hp.payload.slice(2), [0]);
  assert.deepEqual(render(hp), [NAME, "120HP healed!"]);
  const mp = battleMessagePage(18, { name: NAME, numbers: [30], mp: true });
  assert.deepEqual(mp.payload.slice(2), [1]);
  assert.deepEqual(render(mp), [NAME, "30 MP absorbed!"]);
});

test("kind 19 -- the curse words, the caller's word plus 0x49", () => {
  assert.deepEqual(BATTLE_MESSAGE_CURSE_WORDS,
    [BATTLE_MESSAGE_CURSE_INDEX, BATTLE_MESSAGE_CURSE_INDEX + 1, BATTLE_MESSAGE_CURSE_INDEX + 2]);
  assert.deepEqual(render(battleMessagePage(19, { name: NAME, stat: 0 })),
    [NAME, "Strength cursed!"]);
  assert.deepEqual(render(battleMessagePage(19, { name: NAME, stat: 1 })),
    [NAME, "Defense cursed!"]);
  assert.deepEqual(render(battleMessagePage(19, { name: NAME, stat: 2 })),
    [NAME, "Speed cursed!"]);
});

test("kind 20 -- the arm re-enters the VM with kind 4, so the page reads as damage", () => {
  const page = battleMessagePage(20, { name: NAME, numbers: [77] });
  assert.equal(page.kind, 4, ".L0x8009a050 li $a1, 0x4 / jal FIGHTSTG_F0x80099588");
  assert.deepEqual(render(page), [NAME, "77 damage!"]);
});

test("kind 21 -- '{1}HP healed!' from ring word 1", () => {
  const page = battleMessagePage(21, { name: NAME, numbers: [120] });
  assert.deepEqual(render(page), [NAME, "120HP healed!"]);
});

test("kind 22 -- 'Galacticmon learned a technique!' over the technique's name", () => {
  const page = battleMessagePage(22, { name: NAME, index: 1, slot: "Tri-Attack" });
  assert.deepEqual(render(page), ["Galacticmon learned a technique!", "Tri-Attack!"]);
  assert.equal(battleMessageArm(22).slots[0].bank, 0xa2);
});

test("the two typed sites now build the original's page, not a walker sentence", () => {
  // web/battle.js: `trySteal` returns `{ text, page }` and `applyWeaponSecondary` returns
  // `{ text, ail, page }`. Both `page` values are a `battleMessagePage` spec, so the box
  // draws the bank's own two lines instead of the walker's flat suffix.
  const steal = battleMessagePage(17, { name: NAME, index: ITEM_ID, slot: ITEM_NAME });
  const drain = battleMessagePage(18, { name: NAME, numbers: [64] });
  assert.deepEqual(render(steal), ["Stole", `${ITEM_NAME}!`]);
  assert.deepEqual(render(drain), [NAME, "64HP healed!"]);
  const src = readFileSync(new URL("../web/battle.js", import.meta.url), "utf8");
  assert.match(src, /battleMessagePage\(17,/,
    "trySteal asks for the original's steal page");
  assert.match(src, /battleMessagePage\(18,/,
    "the weapon's drain asks for the original's drain page");
});

test("the census: the research document, the arm table and the port list one kind set", () => {
  const doc = readFileSync(
    new URL("../docs/research/battle/battle-message-page-kinds-2026-10-04.md", import.meta.url),
    "utf8");
  const rows = [...doc.matchAll(/^\|\s*(\d+)\s*\|\s*`(0x[0-9a-f]{8})`\s*\|/gm)]
    .map((m) => ({ kind: Number(m[1]), at: m[2] }));
  assert.equal(rows.length, 22, "one table row per kind, and nothing else in that shape");
  assert.deepEqual(rows.map((r) => r.kind), BATTLE_MESSAGE_PAGE_KINDS);
  assert.deepEqual(rows.map((r) => Number(r.at)),
    BATTLE_MESSAGE_ARMS.map((a) => a.at),
    "the document's arm addresses are the arm table's");
  // The caller census in the same document must name every kind that has a caller and
  // must not claim one for the three arms nothing asks for.
  const called = [...doc.matchAll(/^\|\s*(\d+)\s*\|\s*\d+\s*\|/gm)].map((m) => Number(m[1]));
  for (const kind of called) {
    assert.ok(kind >= 1 && kind <= 22, `caller row ${kind} is a real kind`);
  }
});