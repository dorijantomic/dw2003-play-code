// engine/systems/auction.ts
//
// The s260 Cargo Tower AUCTION — the lot cycle, ported once.
//
// WHAT A PLAYER MEETS.  Walk into the Cargo Tower while the story stands on one
// of the sixteen auction beats and the auctioneer Mr. Smith is already calling
// the lot: the crowd shouts its bids, he asks "Bid at N BIT?", and a Yes/No box
// takes the answer.  Yes pays the bid out of your BIT and hands you the lot's
// item; No passes.  Either answer closes the lot for good — and the scene walks
// you back out to the Water Tunnel.
//
// THE DECODE.  The whole cycle is read off the disc; every claim is `verified`
// in docs/research/evidence/ledger.json and documented in
// docs/research/scripting/field-script-engine-verified.md § "The story's yes/no
// questions — the auction bids (2026-10-09)" and
// docs/research/field/s260-cargo-tower-auction-decoded-2026-07-10.md:
//
//   * THE GATE — FIELDSTG_runStoryEvents (pro/fieldstg.s, RAM 0x80084b40, the
//     map/point-slot setup): on a field load it scans FIELDSTG_progressEvents
//     (0x80096bb8, 16 records {s32 progress, s32 flag, s32 condition, s16
//     script, s16 nextScript}) and starts the first record whose `progress`
//     equals the master story ordinal [0x8004b370], whose flag (0x400+N) reads
//     CLEAR, and whose condition reads SET.  The two tests are get_flag(flag, 0)
//     and get_flag(condition, 1) through the flag API (0x80048abc+0x10); the
//     condition 0x7074+j is the bank-0x70 currency compare "money >=
//     MONEY_REQUIRED[j]" (F0x80015aac arm 0).  The record's two event ids are
//     started in order: `script` (the open), then, when its runner ends,
//     `nextScript` (the question).  Claims: fieldstg-progressevents-table-2026-10-09,
//     fieldstg-events-choice-wiring-2026-10-09.
//   * THE QUESTION — one of the sixteen FIELDSTG_askChoice0-15 tasks
//     (constructors at 0x80084804+): it shows question N's text from
//     FIELDSTG_choices (0x80096b38, {u32 text = 0x1190000|entry, s16 events[2]})
//     and, on a confirmed answer, starts the answer's event id.  Claims:
//     fieldstg-askchoice-constructors-2026-10-09, fieldstg-choices-table-2026-10-09,
//     fieldstg-auction-bid-questions-2026-10-09.
//   * THE ANSWER — when the answer's event ends its FIELDSTG_endChoiceNAnswerM
//     handler runs (0x800915a0..0x80091e34): Answer1 (the pass) sets flag 0x400+N;
//     Answer0 (the bid) first applies 0x707E+j — the bank-0x70 currency subtract
//     "money -= MONEY_LOSSES[j], floored at 0" (F0x80015aac arm 2) — then the
//     lot's item code (bank 0x80-0x8E: one copy joins the bag, cap 0x63 = 99),
//     then flag 0x400+N.  Claims: fieldstg-endchoice-flag-handlers-2026-10-09,
//     fieldstg-endchoice-code-consequences-2026-10-09,
//     fieldstg-auction-lot-items-2026-10-09.
//   * THE EXIT — every accepted and pass script ends `HANDOFF 530 766 165`, the
//     tower's scripted force-exit to the Water Tunnel (s275).  The handoff is
//     the script's own op, so this module only reports it.
//
// WHAT IS NOT DECODED (named gap, not filled): FIELDSTG_runChoice's own window
// state machine — its option windows, cursor and confirm handoff — is listed
// under "Not yet decoded here" in field-script-engine-verified.md.  The flow
// this module ports is everything around it: the gate, the script order, the
// two answers, their end handlers and the exit.  The host renders the question
// through its existing decoded question box and names that gap where it wires
// it (web/game.js runAuctionLot).
//
// The module is pure: flags, scripts and the question box are injected.  The
// lot table itself is data — web/assets/data/auction_lots.json, written by
// tools/extract_s260_auction.py from the disc.

/** One lot, as tools/extract_s260_auction.py reads it off the disc. */
export interface AuctionLot {
  /** Lot number 0..15, the order the ceremony calls them in. */
  n: number;
  /** The master story ordinal this lot sits on (FIELDSTG_progressEvents.progress). */
  progress: number;
  /** The lot's own flag (0x400 + n): set by EITHER answer, so a lot fires once. */
  flag: number;
  /** The affordability condition (0x7074 + money_index): money >= bid. */
  condition: number;
  /** Index into MONEY_REQUIRED / MONEY_LOSSES. */
  money_index: number;
  /** The bid in BIT (MONEY_REQUIRED[money_index] = MONEY_LOSSES[money_index]). */
  bid: number;
  /** The granted item id (item_code & 0x1ff). */
  item: number;
  /** The collection-bank code the Answer0 handler passes (e.g. 0x8b19). */
  item_code: number;
  /** open / question / accepted / pass event ids (ids 1331+5n .. 1334+5n). */
  events: { open: number; question: number; accepted: number; pass: number };
  /** esdmg260 entry numbers: open, accepted, choice, pass. */
  entries: { open: number; accepted: number; choice: number; pass: number };
}

/** The read door the gate uses — FlagManager.get, or any object with the same shape. */
export interface AuctionFlagReader {
  get(id: number, expected?: number): boolean;
}

export type AuctionAnswer = "accept" | "pass";

/** A write a handler makes, in the disc's order: set_flag(id, value). */
export interface AuctionWrite {
  flag: number;
  value: number;
}

/**
 * The gate — the port of FIELDSTG_runStoryEvents' scan (pro/fieldstg.s
 * .L0x00001fa8-:2028), read instruction by instruction:
 *
 *   for each record:  if (record.progress != [0x8004b370])      continue;  // :1fb4
 *                     if (!get_flag(record.flag, 0))            continue;  // :1fc8-:1fd0
 *                     if (!get_flag(record.condition, 1))       continue;  // :1fe4-:1fec
 *                     -> start_event(record.script); record.nextScript = pending
 *
 * The first match wins, so at most one lot is offered per field load, and the
 * record order (lots 0..15) decides which.  `ordinal` is the master story
 * ordinal the caller's own stage entry reads ([0x8004b370], the walker's
 * $story.ordinal); a lot whose `progress` is not the current ordinal is not
 * eligible even when its flag is clear.
 */
export function selectAuctionLot(
  lots: readonly AuctionLot[],
  ordinal: number,
  flags: AuctionFlagReader,
): AuctionLot | null {
  for (const lot of lots) {
    if (lot.progress !== ordinal) continue;
    if (!flags.get(lot.flag, 0)) continue;       // the lot must still be open
    if (!flags.get(lot.condition, 1)) continue;  // and affordable
    return lot;
  }
  return null;
}

/**
 * The end handler's writes, in the order the handler applies them (the `li $a0`
 * constants of FIELDSTG_endChoiceNAnswer0 / Answer1, read by the extractor):
 *
 *   accept: (0x707E+j, 1)  money -= MONEY_LOSSES[j], floor 0   [bank 0x70 op 0x20 arm 2]
 *           (item_code, 1) one copy of the lot's item joins the bag, cap 99
 *           (0x400+N, 1)   the lot's flag
 *   pass:   (0x400+N, 1)   the lot's flag
 *
 * The money and item writes go through the ordinary flag API, exactly as the
 * disc's own handler does — set_flag(0x707E+j) reaches the currency subtract and
 * set_flag(item_code) the collection increment, so this module never touches a
 * wallet or a bag directly.
 */
export function auctionAnswerWrites(lot: AuctionLot, answer: AuctionAnswer): AuctionWrite[] {
  if (answer === "accept") {
    return [
      { flag: 0x707e + lot.money_index, value: 1 },
      { flag: lot.item_code, value: 1 },
      { flag: lot.flag, value: 1 },
    ];
  }
  return [{ flag: lot.flag, value: 1 }];
}

/** The handoff an answer script carries (HANDOFF 530 766 165 on s260). */
export interface AuctionHandoff {
  screenId: number;
  x: number;
  y: number;
  dir: number;
}

/**
 * What the host renders.  All three are browser concerns; the engine owns the
 * order and the writes.
 */
export interface AuctionHost {
  /** Play one of the lot's scripts. `onDone` gets the script's HANDOFF, if any. */
  playScript(eventId: number, onDone: (handoff: AuctionHandoff | null) => void): void;
  /** Show the question and call back with the player's answer. */
  askQuestion(lot: AuctionLot, onAnswer: (answer: AuctionAnswer) => void): void;
  /** set_flag through the engine's own dispatch (money, bag, stored bit). */
  writeFlag(id: number, value: number): void;
}

/**
 * One lot, start to finish — the port of the runStoryEvents driver plus the
 * askChoice task plus the end handlers, in the disc's own order:
 *
 *   1. start_event(record.script)            — the open script plays
 *   2. when its runner ends: start_event(record.nextScript) — the question
 *   3. the question's confirmed answer starts the answer's event
 *   4. when that event ends: its end handler's writes, in order
 *   5. the answer script's HANDOFF is the caller's to route (the tower's exit)
 *
 * `onDone` fires after the writes land, with the handoff the answer script
 * carried (null when it carried none).
 */
export function runAuctionLot(
  lot: AuctionLot,
  host: AuctionHost,
  onDone?: (handoff: AuctionHandoff | null) => void,
): void {
  host.playScript(lot.events.open, () => {
    host.askQuestion(lot, (answer) => {
      const evId = answer === "accept" ? lot.events.accepted : lot.events.pass;
      host.playScript(evId, (handoff) => {
        // The end handler runs when the answer's event ENDS (claim
        // fieldstg-endchoice-flag-handlers-2026-10-09), so the writes land
        // after the script, before the caller routes the handoff.
        for (const w of auctionAnswerWrites(lot, answer)) host.writeFlag(w.flag, w.value);
        onDone?.(handoff);
      });
    });
  });
}
