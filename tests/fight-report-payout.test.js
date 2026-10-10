// The wallet after a won battle, through the translated results screen
// (web/fightreport-translated.js behind engine/dw3/ui/fight-report-session.ts).
//
// What the disc does, and what this pins: stfgtrep F0x80084EC4 case 0x14
// (stfgtrep.s file 0x2664-0x2798) adds word 2 of the 12-byte reward record at
// 0x80086A88 into the wallet D0x80048DA0 (`D0x80048D34 + 0x6C`, clamped at
// 9,999,999) inside the same block that draws the "BIT gained" page, and case
// 0x15 (file 0x279C-0x28E8) increments the bag count `D0x80048D34 + 0x7C + id`
// (capped at 99) in the "Item gained" block. So the money moves while the page is
// up. The adapter used to read those totals back only when the screen closed,
// which both paid later than the disc and lost the payment outright whenever the
// screen was left before it finished.
//
// web/fightreport-translated.js fetches its data files, so this file serves them
// from disk and imports the module dynamically, exactly as tests/inn-session.test.js
// and tests/menu-map-refusal.test.js do.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const DATA = resolve("web/assets/data");
globalThis.fetch = async (url) => {
  const file = resolve("web", String(url));
  if (!existsSync(file)) return { ok: false, status: 404, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) };
  const raw = readFileSync(file);
  return {
    ok: true, status: 200,
    json: async () => JSON.parse(raw.toString("utf8")),
    arrayBuffer: async () => raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength),
  };
};
const store = Object.create(null);
globalThis.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
};
if (typeof globalThis.window === "undefined") globalThis.window = globalThis;

const { createFightReportTranslated } = await import("../web/fightreport-translated.js");
await new Promise((r) => setTimeout(r, 50));   // let the glyph/font tables land

/** Battle 5 = 2xNumemon lv27 -> reward record [dvexp 27, exp 268, bits 645]. */
const BATTLE = 5;
const BIT_REWARD = 645;
const START_BITS = 4321;

const partner = (pos, extra = {}) => ({
  pos, rosterSlot: pos, preExp: 8188, level: 20, name: `Digi${pos}`,
  participated: true, ...extra,
});

/** Open the screen on a wallet of START_BITS and hold Confirm, one frame at a time. */
async function play({ dropItemId = 0, inventory = [] } = {}) {
  const state = { bits: START_BITS, inventory: inventory.map((x) => ({ ...x })), keys: [] };
  const closed = { count: 0 };
  const r = createFightReportTranslated(null, { getState: () => state });
  r.open({
    gameState: state,
    battleId: BATTLE,
    dropItemId,
    activePos: 0,
    partySlots: [0],
    participants: [partner(0)],
    onClose: () => { closed.count++; },
  });
  const marks = [];
  for (let frame = 0; frame < 4000 && r.isOpen(); frame++) {
    const before = state.bits;
    // A player taps Confirm rather than holding it: the pad service needs the
    // release edge, so a permanently held Confirm never closes a page.
    state.keys = frame % 4 < 2 ? ["circle"] : [];
    r.update(1 / 60);
    // The adapter loads its data files through fetch, so let the promise chain run.
    await new Promise((done) => setImmediate(done));
    if (state.bits !== before) marks.push({ frame, bits: state.bits, open: r.isOpen() });
  }
  assert.equal(r.isOpen(), false, "the screen must retire within 4000 frames");
  return { state, closed, marks, screen: r };
}

test("a won battle pays its reward-table BIT into the wallet exactly once", async () => {
  const { state, closed, marks } = await play();
  assert.equal(closed.count, 1, "one close");
  assert.equal(state.bits, START_BITS + BIT_REWARD,
    `wallet ${START_BITS} -> ${state.bits}, the disc's record for battle ${BATTLE} pays ${BIT_REWARD}`);
  assert.equal(localStorage.getItem("bits"), String(START_BITS + BIT_REWARD));
});

test("the wallet rises while the 'BIT gained' page is still up, not on close", async () => {
  const { marks } = await play();
  assert.equal(marks.length, 1, `the payout must land once, saw ${JSON.stringify(marks)}`);
  assert.equal(marks[0].bits, START_BITS + BIT_REWARD);
  assert.equal(marks[0].open, true,
    "the money must be in the wallet while the results screen is still showing");
});

test("closing the screen afterwards does not pay a second time", async () => {
  const { state, screen } = await play();
  assert.equal(state.bits, START_BITS + BIT_REWARD);
  screen.close();     // the adapter's own close path, after the screen already retired
  screen.close();
  assert.equal(state.bits, START_BITS + BIT_REWARD, "still exactly one reward");
});

test("leaving the screen after the BIT page keeps the reward", async () => {
  // The reported bug: the screen showed "BIT gained: N BIT", the wallet stayed
  // where it was, and nothing ever paid it. The disc has already moved the money
  // by the time its page is up, so tearing the screen down right there must not
  // lose it.
  const state = { bits: START_BITS, inventory: [], keys: [] };
  const r = createFightReportTranslated(null, { getState: () => state });
  r.open({
    gameState: state, battleId: BATTLE, dropItemId: 0, activePos: 0, partySlots: [0],
    participants: [partner(0)], onClose: () => {},
  });
  for (let frame = 0; frame < 4000 && r.isOpen(); frame++) {
    state.keys = frame % 4 < 2 ? ["circle"] : [];
    r.update(1 / 60);
    await new Promise((done) => setImmediate(done));
    // The disc has moved the money (its own save context at D0x80048DA0) and the
    // "BIT gained" page is up. Walk away right here.
    if (r._session && r._session.bits() > START_BITS) break;
  }
  assert.ok(r.isOpen(), "the screen must still be up when it has paid");
  assert.equal(r._session.bits(), START_BITS + BIT_REWARD, "the disc's own wallet moved");
  assert.equal(state.bits, START_BITS + BIT_REWARD, "the wallet must have moved with it");
  r.close();                       // the player walks away mid-screen
  assert.equal(r.isOpen(), false);
  assert.equal(state.bits, START_BITS + BIT_REWARD, "the reward survives an early exit");
});

test("the dropped item's held count lands with its page too", async () => {
  // Item 42 is the walker's stand-in for the disc's drop slot; the screen
  // increments that one bag byte in its case 0x15 block, capped at 99.
  const { state, marks } = await play({ dropItemId: 42, inventory: [{ id: 42, qty: 3 }] });
  assert.equal(state.bits, START_BITS + BIT_REWARD, "the BIT still pays with a drop");
  assert.deepEqual(state.inventory, [{ id: 42, qty: 4 }]);
  assert.ok(marks.length >= 1 && marks[0].open, "paid while the screen was up");
});