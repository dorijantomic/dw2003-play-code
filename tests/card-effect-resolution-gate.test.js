// tests/card-effect-resolution-gate.test.js — the RESOLUTION half of the
// Program-card legality gate.
//
// F0x800954f8 `checkEffectLegality` is asked at RESOLUTION — F0x800a2180 case 6
// (exe-decomp/cardgame_c/F0x800a2180.c:71-80): a non-zero answer shows the
// record's own +0x02 line and the effect program does NOT run; a zero runs it.
// `canPlayProgram` (F0x800a36e4) is the SELECTION gate, asked earlier, and for
// every shipped card that authors a no-effect line its refusal is a SUBSET of
// this one's — so there are states the browser offers a card in that the disc
// then refuses. This file pins that the walker's resolution path consults the
// gate in exactly those states.
//
// Claim: cardgame-effect-legality-gate-2026-10-10 (verified). Durable record:
// .dw3-research/card-legality-gate-2026-10-07/worker-r.md.
//
// PRE-FIX FAILURE: on a tree whose resolution path does not consult the gate,
// every "nothing moved" assertion below fails. Digimon Charge over a deck of
// only Programs moved the top deck card into the hand (deck 8 -> 7, hand
// 1 -> 2) and Rusty Dust buried an opponent hand card (foe hand 8 -> 7), where
// the disc shows the record's own line ("No Digimon Cards in Deck.", escardgm
// 54; "No Brown Digimon in Hand.", escardgm 56) and runs nothing.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  createDuel, fieldSlot, indexEffects, canPlayProgram, checkEffectLegality,
  applyProgramEffect, beginProgramTurns, playProgramTurn, passProgramTurn,
  pumpProgramTurns, programTurnSide,
} from "../web/vendor/engine.js";

const catalog = JSON.parse(readFileSync(new URL("../web/assets/data/card_catalog.json", import.meta.url), "utf8"));
const effectTable = JSON.parse(readFileSync(new URL("../web/assets/data/card_effects.json", import.meta.url), "utf8"));
const effects = indexEffects(effectTable);
const byId = new Map(catalog.cards.map((c) => [c.id, c]));

const DIGIMON_CHARGE = 43;  // effectVisual 7: allowed iff the actor's deck holds a Digimon
const PROGRAM_CHARGE = 44;  // effectVisual 8: allowed iff the actor's deck holds a non-Digimon
const RUSTY_DUST = 49;      // effectVisual 2: allowed iff the foe's hand holds a brown Digimon

const programs = catalog.cards.filter((c) => c.kind === "program");
const digimons = catalog.cards.filter((c) => c.kind === "digimon");
const brownDigimons = digimons.filter((c) => c.colour === "brown");
const nonBrownDigimons = digimons.filter((c) => c.colour !== "brown");

/** A duel parked with exactly the piles a test names. */
function mk(o = {}) {
  const d = createDuel(catalog, [], []);
  d.player.hand = [...(o.hand ?? [])];
  d.player.handSlots = d.player.hand.map((_, i) => i);
  d.player.deck = [...(o.deck ?? [])];
  d.player.trash = [...(o.trash ?? [])];
  d.player.field = (o.field ?? [50]).map((id) => fieldSlot(id, 10, 10));
  d.opponent.hand = [...(o.foeHand ?? [])];
  d.opponent.handSlots = d.opponent.hand.map((_, i) => 100 + i);
  d.opponent.deck = [...(o.foeDeck ?? [])];
  d.opponent.trash = [...(o.foeTrash ?? [])];
  d.opponent.field = (o.foeField ?? [100]).map((id) => fieldSlot(id, 10, 10));
  return d;
}

const idsOf = (cards, n) => cards.slice(0, n).map((c) => c.id);

// ── the three shipped divergences between the two gates ─────────────────────

test("Digimon Charge over a deck of only Programs: the resolution gate refuses and no card moves", () => {
  const d = mk({ hand: [DIGIMON_CHARGE], deck: idsOf(programs, 8) });
  const eff = effects.get(DIGIMON_CHARGE);
  // The selection gate offers the card — its pile is not empty ...
  assert.equal(canPlayProgram(d, d.player, eff), true, "selection gate (F0x800a36e4) allows");
  // ... the resolution gate refuses: the deck holds no Digimon.
  assert.equal(checkEffectLegality(d, d.player, eff), false, "resolution gate (F0x800954f8) refuses");
  const deck = d.player.deck.length;
  const hand = d.player.hand.length;
  assert.equal(applyProgramEffect(d, d.player, DIGIMON_CHARGE, eff), false,
    "the refused card reports no effect");
  assert.equal(d.player.deck.length, deck, "nothing left the deck");
  assert.equal(d.player.hand.length, hand, "nothing reached the hand");
});

test("Program Charge over a deck of only Digimons: refused, no card moves", () => {
  const d = mk({ hand: [PROGRAM_CHARGE], deck: idsOf(digimons, 8) });
  const eff = effects.get(PROGRAM_CHARGE);
  assert.equal(canPlayProgram(d, d.player, eff), true);
  assert.equal(checkEffectLegality(d, d.player, eff), false);
  const deck = d.player.deck.length;
  const hand = d.player.hand.length;
  assert.equal(applyProgramEffect(d, d.player, PROGRAM_CHARGE, eff), false);
  assert.equal(d.player.deck.length, deck, "nothing left the deck");
  assert.equal(d.player.hand.length, hand, "nothing reached the hand");
});

test("Rusty Dust with no brown Digimon in the opponent's hand: refused, the hand is untouched", () => {
  const d = mk({ hand: [RUSTY_DUST], deck: idsOf(programs, 6), foeHand: idsOf(nonBrownDigimons, 8) });
  const eff = effects.get(RUSTY_DUST);
  assert.equal(canPlayProgram(d, d.player, eff), true);
  assert.equal(checkEffectLegality(d, d.player, eff), false);
  const foeHand = d.opponent.hand.length;
  const foeTrash = d.opponent.trash.length;
  assert.equal(applyProgramEffect(d, d.player, RUSTY_DUST, eff), false);
  assert.equal(d.opponent.hand.length, foeHand, "no opponent card was buried");
  assert.equal(d.opponent.trash.length, foeTrash, "the opponent's trash stayed empty");
});

// ── the same cards run when their condition holds ───────────────────────────

test("the gate allows, and the program runs, once the condition holds", () => {
  // Digimon Charge with a Digimon in the deck: the program takes a deck card.
  const d1 = mk({ hand: [DIGIMON_CHARGE], deck: [...idsOf(programs, 4), digimons[0].id] });
  assert.equal(checkEffectLegality(d1, d1.player, effects.get(DIGIMON_CHARGE)), true);
  const deck1 = d1.player.deck.length;
  assert.equal(applyProgramEffect(d1, d1.player, DIGIMON_CHARGE, effects.get(DIGIMON_CHARGE)), true);
  assert.equal(d1.player.deck.length, deck1 - 1, "the search took a deck card");
  assert.equal(d1.player.hand.length, 2, "it reached the hand");

  // Program Charge with a Program in the deck.
  const d2 = mk({ hand: [PROGRAM_CHARGE], deck: [...idsOf(digimons, 4), programs[0].id] });
  assert.equal(checkEffectLegality(d2, d2.player, effects.get(PROGRAM_CHARGE)), true);
  const deck2 = d2.player.deck.length;
  assert.equal(applyProgramEffect(d2, d2.player, PROGRAM_CHARGE, effects.get(PROGRAM_CHARGE)), true);
  assert.equal(d2.player.deck.length, deck2 - 1, "the search took a deck card");

  // Rusty Dust against a brown Digimon: the hand discard lands.
  const brown = brownDigimons[0].id;
  const d3 = mk({ hand: [RUSTY_DUST], deck: idsOf(programs, 6), foeHand: [brown, ...idsOf(nonBrownDigimons, 2)] });
  assert.equal(checkEffectLegality(d3, d3.player, effects.get(RUSTY_DUST)), true);
  assert.equal(applyProgramEffect(d3, d3.player, RUSTY_DUST, effects.get(RUSTY_DUST)), true);
  assert.equal(d3.opponent.hand.includes(brown), false, "the brown Digimon left the hand");
  assert.equal(d3.opponent.trash.includes(brown), true, "it went to the trash");
});

// ── the turn driver goes through the same gate ──────────────────────────────

test("the turn's resolve consults the gate: a refused play is spent, not run", () => {
  const d = mk({ hand: [DIGIMON_CHARGE], deck: idsOf(programs, 8) });
  beginProgramTurns(d);
  assert.equal(programTurnSide(d), d.player, "the player leads");
  assert.equal(playProgramTurn(d, d.player, 0, effects), true, "the card commits");
  passProgramTurn(d, d.opponent);           // state 1 -> the turn's resolve
  const deck = d.player.deck.length;
  pumpProgramTurns(d, effects, () => 0.5, null);
  assert.equal(d.player.deck.length, deck, "the refused program moved nothing");
  assert.equal(d.player.trash.includes(DIGIMON_CHARGE), true, "the played card still went to its trash");
});

test("the turn's resolve runs an allowed play", () => {
  const d = mk({ hand: [DIGIMON_CHARGE], deck: [...idsOf(programs, 4), digimons[0].id] });
  beginProgramTurns(d);
  assert.equal(playProgramTurn(d, d.player, 0, effects), true);
  passProgramTurn(d, d.opponent);
  const deck = d.player.deck.length;
  pumpProgramTurns(d, effects, () => 0.5, null);
  assert.equal(d.player.deck.length, deck - 1, "the allowed program took a deck card");
});

// ── the gate is the record's +0x01 condition, not the targeting kind ────────

test("a record with no condition (effectVisual 0) is never refused", () => {
  // effectVisual 0 falls outside the disc's 1..0xB switch and always fires;
  // this pins that the new resolution call does not refuse those records.
  let zeroVisual = 0;
  for (const eff of effectTable.effects) {
    if (eff.effectVisual !== 0) continue;
    zeroVisual += 1;
    const d = mk({ hand: [eff.id], deck: idsOf(programs, 6) });
    assert.equal(checkEffectLegality(d, d.player, eff), true, `${eff.name} (#${eff.id})`);
  }
  assert.equal(zeroVisual, 23, "23 of the 60 records author no condition");
});
