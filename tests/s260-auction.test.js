// tests/s260-auction.test.js
// The s260 Cargo Tower auction, from the browser side: the committed engine bundle
// must carry the ported lot cycle, the shipped lot table must agree with the text
// bank and the tower's own scene record, and the flow must run end to end with the
// browser's wiring shape (a script player, the question box, the engine's flag door).
//
// The engine's own suite (tests/engine/systems/auction.test.ts) checks the port
// against the disc's tables; this file checks what the BROWSER actually loads.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { selectAuctionLot, auctionAnswerWrites, runAuctionLot } from "../web/vendor/engine.js";

const ROOT = new URL("..", import.meta.url);
const json = (p) => JSON.parse(readFileSync(new URL(p, ROOT), "utf8"));

const AUCTION = json("web/assets/data/auction_lots.json");
const ESDMG = json("web/assets/events/esdmg260.json");
const SCENE = json("web/assets/scenes/s260.json");
const SCREEN_TABLE = json("data/screen_table.json");

test("the committed engine bundle carries the auction's lot cycle", () => {
  assert.equal(typeof selectAuctionLot, "function");
  assert.equal(typeof auctionAnswerWrites, "function");
  assert.equal(typeof runAuctionLot, "function");
});

test("the lot table, the text bank and the tower's scene agree", () => {
  assert.equal(AUCTION.lots.length, 16);
  for (const lot of AUCTION.lots) {
    // Every scripted event the lot names is in the shipped script map, and the
    // question event is the one the choices table wires.
    for (const kind of ["open", "accepted", "pass"]) {
      const row = AUCTION.events[String(lot.events[kind])];
      assert.ok(row, `lot ${lot.n}: ${kind} script shipped`);
      assert.equal(row.entry, lot.entries[kind], `lot ${lot.n}: ${kind} text entry`);
      assert.equal(row.disasm[row.disasm.length - 1], "END", `lot ${lot.n}: ${kind} ends`);
    }
    // The question text bank entry is real and asks for the lot's bid.
    const q = ESDMG[String(lot.entries.choice)];
    assert.match(q.strings[0], new RegExp(`Bid at ${lot.bid} BIT\\?`), `lot ${lot.n}: question`);
  }
  // The force-exit the answer scripts carry is the tower's own warp record: screen
  // 530 → stage 275, spawn (766,165) — the same numbers the scene ships.
  const warp = SCENE.warps.find((w) => w.screen === AUCTION.force_exit.screen);
  assert.ok(warp, "s260's warp record names screen 530");
  assert.equal(warp.stage, AUCTION.force_exit.stage, "the exit's destination stage");
  assert.equal(warp.spawnX, AUCTION.force_exit.x);
  assert.equal(warp.spawnY, AUCTION.force_exit.y);
  assert.equal(SCREEN_TABLE[String(AUCTION.force_exit.screen)]?.stage, AUCTION.force_exit.stage);
});

test("the browser's wiring shape drives one lot: open, question, answer, writes", () => {
  const lot = AUCTION.lots[0];
  // A flags reader in the browser's shape: lot 0's beat (5), its flag clear, the
  // 800-BIT condition satisfied, everything else dormant.
  const flags = {
    get(id, expected = 1) {
      const value = id === lot.condition ? 1 : 0;   // affordability holds
      return expected === 0 ? value === 0 : value === 1;
    },
  };
  assert.equal(selectAuctionLot(AUCTION.lots, 5, flags)?.n, 0);
  assert.equal(selectAuctionLot(AUCTION.lots, 6, flags), null, "off the beat: nothing");

  const calls = [];
  runAuctionLot(lot, {
    playScript: (eventId, onDone) => {
      calls.push("script " + eventId);
      onDone(eventId === lot.events.accepted ? { screenId: 530, x: 766, y: 165, dir: 1 } : null);
    },
    askQuestion: (_lot, onAnswer) => { calls.push("question"); onAnswer("accept"); },
    writeFlag: (id) => calls.push("write " + id),
  }, (handoff) => calls.push("handoff " + handoff?.screenId));
  assert.deepEqual(calls, [
    "script " + lot.events.open,
    "question",
    "script " + lot.events.accepted,
    "write " + (0x707e + lot.money_index),
    "write " + lot.item_code,
    "write " + lot.flag,
    "handoff 530",
  ]);
});
