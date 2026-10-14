// tests/engine/systems/auction.test.ts
// The s260 Cargo Tower auction — engine/systems/auction.ts against the disc.
//
// The decode is `verified` in docs/research/evidence/ledger.json; the module
// header carries the full citation set.  This test does two things:
//
//   1. re-checks the SHIPPED LOT TABLE (web/assets/data/auction_lots.json) against
//      the decoded claims — the progress ladder, the affordability conditions, the
//      bids, the items, the event ids and the two force-exit scripts;
//   2. drives the port itself: the runStoryEvents gate over a real engine flag
//      bank (including the bank-0x70 currency compare and subtract the auction
//      introduced), the two answer write lists, and the open → question → answer →
//      writes sequence.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  GameEngine,
  selectAuctionLot, auctionAnswerWrites, runAuctionLot,
  type AuctionLot, type AuctionHandoff,
} from "../../../engine/index.ts";
import { loadRealContent } from "../../../tools/engine-convert/load-real.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const AUCTION = JSON.parse(readFileSync(join(ROOT, "web/assets/data/auction_lots.json"), "utf8"));
const ESDMG = JSON.parse(readFileSync(join(ROOT, "web/assets/events/esdmg260.json"), "utf8"));

// The decoded ladders (claims fieldstg-progressevents-table-2026-10-09,
// fieldstg-auction-bid-questions-2026-10-09, fieldstg-auction-lot-items-2026-10-09).
const PROGRESS = [5, 8, 12, 14, 16, 22, 24, 26, 28, 30, 31, 34, 36, 37, 38, 39];
const BIDS = [800, 800, 1600, 1600, 2700, 2700, 4000, 4000,
              6000, 6000, 8700, 8700, 11500, 17500, 24000, 32000];
const ITEMS = [281, 287, 282, 288, 137, 149, 124, 98,
               222, 232, 244, 243, 257, 269, 258, 271];

const real = loadRealContent();
const lots = AUCTION.lots as AuctionLot[];

/** An engine over the REAL converted content — the same tables the browser ships. */
function engineAt(ordinal: number, bits: number): GameEngine {
  const eng = new GameEngine({ stages: real.stages, ordinal: real.ordinal, roster: real.roster });
  eng.state.vars.set("$story.ordinal", ordinal);
  eng.state.vars.set("$party.bit", bits);
  return eng;
}

test("the shipped lot table is the decoded auction", () => {
  assert.equal(lots.length, 16, "sixteen lots");
  assert.deepEqual(lots.map((l) => l.progress), PROGRESS, "the progress ladder");
  assert.deepEqual(lots.map((l) => l.bid), BIDS, "the bid ladder");
  assert.deepEqual(lots.map((l) => l.item), ITEMS, "the granted items");
  for (const lot of lots) {
    const n = lot.n;
    assert.equal(lot.flag, 0x400 + n, `lot ${n}: the lot's own flag`);
    assert.equal(lot.condition, 0x7074 + lot.money_index, `lot ${n}: the affordability condition`);
    assert.equal(lot.events.open, 1331 + 5 * n, `lot ${n}: open id`);
    assert.equal(lot.events.question, 1332 + 5 * n, `lot ${n}: question id`);
    assert.equal(lot.events.accepted, 1333 + 5 * n, `lot ${n}: accepted id`);
    assert.equal(lot.events.pass, 1334 + 5 * n, `lot ${n}: pass id`);
    // The item code is the Answer0 handler's collection-bank constant: bank
    // 0x80-0x8E (the bag), low nine bits the item id.
    assert.equal(lot.item_code & 0x1ff, lot.item, `lot ${n}: item code low bits`);
    const bank = (lot.item_code >> 8) & 0xfe;
    assert.ok(bank >= 0x80 && bank <= 0x8e, `lot ${n}: item code bank 0x${bank.toString(16)}`);
    // The question text asks for exactly this lot's bid.
    const strings = ESDMG[String(lot.entries.choice)].strings;
    assert.equal(strings.length, 3, `lot ${n}: question + two answers`);
    assert.match(strings[0], new RegExp(`Bid at ${lot.bid} BIT\\?`), `lot ${n}: question text`);
    // Every accepted and pass script ends at the tower's force-exit.
    for (const kind of ["accepted", "pass"] as const) {
      const disasm = AUCTION.events[String(lot.events[kind])].disasm as string[];
      assert.equal(disasm[disasm.length - 1], "END", `lot ${n}: ${kind} ends`);
      assert.equal(disasm[disasm.length - 2], "HANDOFF 530 766 165 1", `lot ${n}: ${kind} force-exit`);
    }
  }
  // The two opener records (the lift rides) are not lots.
  assert.deepEqual(AUCTION.openers.map((o: any) => o.event), [1320, 1325]);
  assert.equal(Object.keys(AUCTION.events).length, 50, "16 lots x 3 scripts + 2 openers");
  assert.deepEqual(AUCTION.force_exit, { screen: 530, x: 766, y: 165, stage: 275 });
});

test("the affordability gate is the bank-0x70 currency compare over $party.bit", () => {
  const eng = engineAt(5, 800);
  assert.equal(eng.state.flags.get(0x7074, 1), true, "800 BIT affords the 800 lot");
  assert.equal(eng.state.flags.get(0x7074, 0), false);
  assert.equal(eng.state.flags.get(0x7075, 1), false, "800 BIT does not afford 1600");
  eng.state.vars.set("$party.bit", 799);
  assert.equal(eng.state.flags.get(0x7074, 1), false, "799 BIT does not afford 800");
  eng.state.vars.set("$party.bit", 32000);
  assert.equal(eng.state.flags.get(0x707d, 1), true, "32000 BIT affords the last lot");
});

test("selectAuctionLot: first record whose ordinal matches, flag is clear and the bid is affordable", () => {
  const eng = engineAt(5, 800);
  assert.equal(selectAuctionLot(lots, 5, eng.state.flags)?.n, 0, "lot 0 on its beat");
  // A different beat offers that beat's lot, not lot 0.
  assert.equal(selectAuctionLot(lots, 8, eng.state.flags)?.n, 1);
  // Off every beat: nothing.
  assert.equal(selectAuctionLot(lots, 6, eng.state.flags), null);
  // Unaffordable: nothing.
  assert.equal(selectAuctionLot(lots, 5, engineAt(5, 799).state.flags), null);
  // The lot's own flag (set by EITHER answer) closes it for good.
  const closed = engineAt(5, 800);
  closed.writeStoryFlag(0x400, 1);
  assert.equal(selectAuctionLot(lots, 5, closed.state.flags), null);
  // First match wins, not the dearest: at a beat with money for everything, the
  // record order (lots 0..15) decides — lot 0 sits on ordinal 5.
  assert.equal(selectAuctionLot(lots, 5, engineAt(5, 99999).state.flags)?.n, 0);
});

test("the bid write subtracts the bid from the BIT total, floored at 0", () => {
  const eng = engineAt(5, 800);
  eng.writeStoryFlag(0x707e, 1);              // lot 0's money code
  assert.equal(Number(eng.state.vars.get("$party.bit")), 0);
  eng.state.vars.set("$party.bit", 500);
  eng.writeStoryFlag(0x707e, 1);
  assert.equal(Number(eng.state.vars.get("$party.bit")), 0, "floored at 0");
  eng.state.vars.set("$party.bit", 10000);
  eng.writeStoryFlag(0x7087, 1);              // lot 15's money code: 32000
  assert.equal(Number(eng.state.vars.get("$party.bit")), 0, "10000 - 32000 floors at 0");
  eng.state.vars.set("$party.bit", 50000);
  eng.writeStoryFlag(0x7087, 1);
  assert.equal(Number(eng.state.vars.get("$party.bit")), 18000);
});

test("the answer writes: bid = money + item + flag in that order; pass = flag only", () => {
  const lot = lots[0]!;
  assert.deepEqual(auctionAnswerWrites(lot, "accept"), [
    { flag: 0x707e + lot.money_index, value: 1 },
    { flag: lot.item_code, value: 1 },
    { flag: lot.flag, value: 1 },
  ]);
  assert.deepEqual(auctionAnswerWrites(lot, "pass"), [{ flag: lot.flag, value: 1 }]);

  // Through the engine's own set_flag door: the grant joins the bag and the
  // count is capped at 99 (F0x800161d8, claim items-stack-quantity-cap-99-...).
  const eng = engineAt(5, 800);
  for (const w of auctionAnswerWrites(lot, "accept")) eng.writeStoryFlag(w.flag, w.value);
  assert.equal(Number(eng.state.vars.get("$party.bit")), 0, "the bid was paid");
  assert.equal(eng.state.inventory.has(lot.item), true, "the item joined the bag");
  assert.equal(eng.state.flags.get(lot.flag, 1), true, "the lot closed");
  eng.state.inventory.add(lot.item, 99);
  eng.writeStoryFlag(lot.item_code, 1);
  assert.equal(eng.state.inventory.has(lot.item, 99), true, "capped at 99");
  assert.equal(eng.state.inventory.has(lot.item, 100), false);

  const pass = engineAt(5, 800);
  for (const w of auctionAnswerWrites(lot, "pass")) pass.writeStoryFlag(w.flag, w.value);
  assert.equal(Number(pass.state.vars.get("$party.bit")), 800, "a pass costs nothing");
  assert.equal(pass.state.inventory.has(lot.item), false, "and grants nothing");
  assert.equal(pass.state.flags.get(lot.flag, 1), true, "but still closes the lot");
});

test("runAuctionLot sequences open → question → answer script → writes → handoff", () => {
  const handoff: AuctionHandoff = { screenId: 530, x: 766, y: 165, dir: 1 };
  for (const answer of ["accept", "pass"] as const) {
    const lot = lots[2]!;
    const calls: string[] = [];
    const writes: { flag: number; value: number }[] = [];
    let done: AuctionHandoff | null | undefined;
    runAuctionLot(lot, {
      playScript: (eventId, onDone) => {
        calls.push("script " + eventId);
        // The accepted / pass scripts carry the force-exit; the open does not.
        const carries = eventId === lot.events.accepted || eventId === lot.events.pass;
        onDone(carries ? handoff : null);
      },
      askQuestion: (asked, onAnswer) => {
        assert.equal(asked.n, lot.n);
        calls.push("question");
        onAnswer(answer);
      },
      writeFlag: (id, value) => { calls.push("write " + id); writes.push({ flag: id, value }); },
    }, (h) => { done = h; });
    assert.deepEqual(calls, [
      "script " + lot.events.open,
      "question",
      "script " + (answer === "accept" ? lot.events.accepted : lot.events.pass),
      ...auctionAnswerWrites(lot, answer).map((w) => "write " + w.flag),
    ], answer + ": the disc's own order");
    assert.deepEqual(writes, auctionAnswerWrites(lot, answer));
    assert.deepEqual(done, handoff, answer + ": the script's handoff reaches the caller");
  }
});
