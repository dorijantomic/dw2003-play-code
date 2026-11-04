// The five rule cards: the Digimon that PRINT a stat formula, and get it.
//
// The card album's own detail line carries a five-way id check on
// 0x45 / 0x70 / 0x9B / 0xC6 / 0xF1 — card ids 69 RosemonII, 112 MarineAngemon,
// 155 SaberLeomon, 198 Gryphonmon and 241 Creepymon, the last card of each of
// the first five colour blocks. They are the ONLY Digimon cards with text in
// the card-text bank, and two of them print AP 0 / HP 0 because their real
// numbers are computed when they are played
// (docs/research/ui/card-album-screen-2026-08-14.md §3).
//
// The five decoded arms of D0x80083960 (docs/research/card/CARD-DUEL-VERIFIED.md
// §19.3) are one formula per energy colour, in ENERGY_COLOURS order, and they
// match those five printed rules — not the neighbouring ids 68 / 111 / 154 /
// 197 / 240, which carry no rule text and non-zero printed stats.
//
// So engine/systems/card-battle.ts's DYNAMIC_STAT_MEGAS must be the five ids
// that print a formula. The raw halfword table at 0x800A5C20 is recorded, not
// verified (CARD-DUEL-VERIFIED.md §14.5); the catalogue text is the authority.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DYNAMIC_STAT_MEGAS,
  ENERGY_COLOURS,
  applyDynamicStatMegas,
  createDuel,
  fieldSlot,
  recomputeTotals,
} from "../engine/systems/card-battle.ts";

const catalog = JSON.parse(
  readFileSync(new URL("../web/assets/data/card_catalog.json", import.meta.url), "utf8"),
);
const byId = new Map(catalog.cards.map((c) => [c.id, c]));
const RULE_IDS = [69, 112, 155, 198, 241];
const NEIGHBOURS = [68, 111, 154, 197, 240];

const effectOf = (card) => (card.effect ?? "").trim();

/** A duel parked with exactly the field piles and piles a case names. Slots
 *  enter at their printed stats, as putOnField does. */
function mkDuel(o = {}) {
  const d = createDuel(catalog, [], []);
  const place = (ids) => ids.map((id) => {
    const rec = byId.get(id);
    assert.ok(rec, `card ${id} is in the catalogue`);
    return fieldSlot(id, rec.ap, rec.hp);
  });
  d.player.field = place(o.field ?? []);
  d.opponent.field = place(o.foeField ?? []);
  d.player.hand = [...(o.hand ?? [])];
  d.player.trash = [...(o.trash ?? [])];
  d.opponent.trash = [...(o.foeTrash ?? [])];
  recomputeTotals(d.player);
  recomputeTotals(d.opponent);
  return d;
}

function statOf(side, id) {
  const slot = side.field.find((s) => s.id === id);
  assert.ok(slot, `card ${id} is on the field`);
  return { ap: slot.ap, hp: slot.hp };
}

// ── the catalogue: exactly these five cards print a rule ────────────────────

test("the five Digimon with a formula text are exactly 69, 112, 155, 198 and 241", () => {
  const ruleCards = catalog.cards.filter((c) => c.kind === "digimon" && effectOf(c) !== "");
  assert.deepEqual(ruleCards.map((c) => c.id), RULE_IDS);
  // One per energy colour, in the same order the formula arms are indexed.
  assert.deepEqual(ruleCards.map((c) => c.colour), [...ENERGY_COLOURS]);
});

test("the five rule cards' printed stats are the ones the album shows", () => {
  const printed = (id) => ({ ap: byId.get(id).ap, hp: byId.get(id).hp });
  // Two print nothing: their real numbers only exist once they are played.
  assert.deepEqual(printed(69), { ap: 0, hp: 0 });
  assert.deepEqual(printed(198), { ap: 0, hp: 0 });
  // Three print the +10 the decoded arms start from.
  for (const id of [112, 155, 241]) {
    assert.deepEqual(printed(id), { ap: 10, hp: 10 }, `card ${id} prints 10/10`);
  }
});

test("the five neighbouring ids carry no rule text", () => {
  // 68/111/154/197/240 are the values recorded in the raw halfword table; they
  // are not the cards that print a formula.
  for (const id of NEIGHBOURS) {
    const card = byId.get(id);
    assert.ok(card, `card ${id} is in the catalogue`);
    assert.equal(card.kind, "digimon", `card ${id} is a Digimon`);
    assert.equal(effectOf(card), "", `card ${id} has no rule text`);
    assert.ok(card.ap > 0 && card.hp > 0, `card ${id} prints real stats (${card.ap}/${card.hp})`);
  }
});

// ── the decoded arms applied to the cards that print them ───────────────────

test("arm 0: 69 RosemonII with 3 own field Digimon becomes 60/60", () => {
  const d = mkDuel({ field: [69, 70, 71] });
  applyDynamicStatMegas(d);
  assert.deepEqual(statOf(d.player, 69), { ap: 60, hp: 60 }); // 20 x 3
});

test("arm 1: 112 MarineAngemon with 2 cards in hand becomes 40/40", () => {
  const d = mkDuel({ field: [112], hand: [1, 2] });
  applyDynamicStatMegas(d);
  assert.deepEqual(statOf(d.player, 112), { ap: 40, hp: 40 }); // 10 + 10 x 2
});

test("arm 2: 155 SaberLeomon with 1 card in its trash becomes 40/40", () => {
  const d = mkDuel({ field: [155], trash: [1] });
  applyDynamicStatMegas(d);
  assert.deepEqual(statOf(d.player, 155), { ap: 40, hp: 40 }); // 10 + 20 x 1
});

test("arm 3: 198 Gryphonmon with 4 Digimon across both fields becomes 40/40", () => {
  const d = mkDuel({ field: [198, 196], foeField: [100, 101] });
  applyDynamicStatMegas(d);
  assert.deepEqual(statOf(d.player, 198), { ap: 40, hp: 40 }); // 10 x 4
});

test("arm 4: 241 Creepymon with 0 cards across both trashes becomes 20/20", () => {
  const d = mkDuel({ field: [241] });
  applyDynamicStatMegas(d);
  assert.deepEqual(statOf(d.player, 241), { ap: 20, hp: 20 }); // 10 + 10 x 0
});

// ── the constant, and what a duel does with it ──────────────────────────────

test("DYNAMIC_STAT_MEGAS is the five cards that print a formula", () => {
  assert.deepEqual([...DYNAMIC_STAT_MEGAS], RULE_IDS);
});

test("a duel recomputes 69 and leaves 68 at its printed 40/42; nothing else moves", () => {
  const d = mkDuel({ field: [68, 69, 70], foeField: [196], hand: [1, 2] });
  const before = new Map();
  for (const side of [d.player, d.opponent]) {
    for (const slot of side.field) before.set(slot.instance, [slot.id, slot.ap, slot.hp]);
  }

  applyDynamicStatMegas(d);

  assert.deepEqual(statOf(d.player, 69), { ap: 60, hp: 60 }, "69 is recomputed from the board");
  assert.deepEqual(statOf(d.player, 68), { ap: 40, hp: 42 }, "68 keeps its printed stats");
  for (const side of [d.player, d.opponent]) {
    for (const slot of side.field) {
      if (slot.id === 69) continue;
      assert.deepEqual(
        [slot.id, slot.ap, slot.hp],
        before.get(slot.instance),
        `card ${slot.id} is untouched`,
      );
    }
  }
});

// ── the record the code keeps ──────────────────────────────────────────────

const source = readFileSync(
  new URL("../engine/systems/card-battle.ts", import.meta.url),
  "utf8",
);

test("the comment above the list no longer claims the raw table values are the ids", () => {
  const at = source.indexOf("export const DYNAMIC_STAT_MEGAS");
  assert.ok(at > 0, "the constant exists");
  const block = source.slice(source.lastIndexOf("/**", at), at);
  assert.doesNotMatch(block, /READ FROM THE TABLE/, "the old 'read from the table' claim is gone");
  assert.doesNotMatch(block, /68,\s*111,\s*154,\s*197,\s*240/, "the neighbour ids are not the list");
  assert.match(block, /0x800A5C20/, "the raw halfword table is still named, as the recorded one");
  assert.match(block, /69/, "the comment names the rule cards");
  assert.match(block, /112[\s\S]*155[\s\S]*198[\s\S]*241/, "all five rule-card ids are named");
  assert.match(block, /catalo?gue|card text/i, "the catalogue text is the stated authority");
});

test("applyDynamicStatMegas reads DYNAMIC_STAT_MEGAS", () => {
  const at = source.indexOf("export function applyDynamicStatMegas");
  assert.ok(at > 0, "the function exists");
  const body = source.slice(at, source.indexOf("\n}\n", at) + 3);
  assert.match(body, /DYNAMIC_STAT_MEGAS\.indexOf\(slot\.id\)/);
});
