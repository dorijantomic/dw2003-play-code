// Real Summon picker: reserve, refuse, refund, keep marks on No, commit once.
// The hand/phase are fixtures. No opening, walking or earlier duel is replayed.
// Source contracts: CARD-DUEL-VERIFIED.md §25 and F0x800A0754.c:12-24.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import { baseUrl } from "./verify-base-url.mjs";

const out = process.argv[2] ?? ".dw3-research/autonomous-plan/shots/cardduel-summon-selection/after";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage();
page.setDefaultTimeout(10000);
const errors = [], failures = [], observations = [];
page.on("pageerror", e => errors.push(e.message));
const game = (fn, arg) => page.evaluate(({ source, arg }) => {
  const w = document.getElementById("game").contentWindow;
  return new Function("w", "arg", source)(w, arg);
}, { source: fn.toString().replace(/^[^{]*\{/, "").replace(/\}\s*$/, ""), arg });
const snapshot = () => game(() => {
  const c = w.__labDuel, d = c.duel;
  return { marks: [...(c.summonMarks ?? [])], energy: { ...d.player.energy },
    field: d.player.field.map(r => r.id), hand: [...d.player.hand],
    handSlots: [...d.player.handSlots], confirm: c.summonConfirm?.answer ?? null,
    mine: c.summonIsMine(), fixture: w.__summonFixture };
});
const shot = async name => {
  const url = await game(() => { return w.document.querySelector("canvas#game").toDataURL(); });
  writeFileSync(`${out}/${name}.png`, Buffer.from(url.split(",")[1], "base64"));
};
const check = (ok, message) => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${message}`);
  if (!ok) failures.push(message);
};
const press = async key => {
  await game(() => { w.__labDuel.handleKey(arg); }, key);
  await page.waitForTimeout(50);
};
try {
  // The legacy duel: this check reads the old shell's own surface (labDuel.duel, labDuel.handleKey), which the native duel — the default since web/game.js:545 — does not expose. Census: docs/research/card/CARD-DUEL-VERIFIED.md 34.
  await page.goto(`${baseUrl(8742)}/ui-lab.html?legacyDuel=1`);
  await page.waitForFunction(() => document.getElementById("game")?.contentWindow?.__state?.started);
  await game(() => { w.__labOpen("cardduel"); });
  const deadline = Date.now() + 9000;
  while (!await game(() => { return !!w.__labDuel.duel; })) {
    assert.ok(Date.now() < deadline, "duel entry did not finish within 9 seconds");
    await press("circle");
  }
  await game(() => {
    const c = w.__labDuel, d = c.duel;
    const cards = [...d.byId.values()];
    const paid = cards.find(r => r.kind === "digimon" && r.colour !== "brown" && r.summonCost > 0);
    const free = cards.find(r => r.kind === "digimon" && r.summonCost === 0 && r.id !== paid.id);
    d.player.hand = [paid.id, free.id, paid.id]; d.player.handSlots = [8, 19, 27];
    d.player.field = []; d.player.trash = [];
    for (const colour of Object.keys(d.player.energy)) d.player.energy[colour] = 0;
    d.player.energy[paid.colour] = paid.summonCost;
    d.phaseIndex = 3;
    d.summonTurns = { order: [d.player, d.opponent], turn: 0, done: false };
    d.opponent.hand = []; d.opponent.handSlots = [];
    d.beat.current = null; d.beat.gated = false; d.beat.pending.length = 0;
    c.summonMarks = new Set(); c.summonConfirm = null; c.handCursor = 0;
    c.resyncSprites();
    w.__summonFixture = { paid: paid.id, free: free.id, colour: paid.colour, cost: paid.summonCost };
  });
  // Dismiss the phase announcement; stop as soon as the actual first mark lands.
  const ready = Date.now() + 9000;
  while (!(await snapshot()).marks.includes(0)) {
    assert.ok(Date.now() < ready, "Summon picker did not accept input within 9 seconds");
    await press("circle");
  }
  let s = await snapshot(); observations.push({ step: "mark", ...s });
  await shot("marked");
  check(s.energy[s.fixture.colour] === 0, "mark spends the card's energy immediately");
  await press("right"); await press("right"); await press("circle");
  s = await snapshot();
  check(!s.marks.includes(2), "a second card cannot reuse already reserved energy");
  // On the old build the second mark was wrongly accepted; undo it to keep
  // the later before/after checks independent of that measured failure.
  if (s.marks.includes(2)) await press("circle");
  await press("left"); await press("left"); await press("circle");
  s = await snapshot(); observations.push({ step: "refund", ...s });
  check(s.marks.length === 0 && s.energy[s.fixture.colour] === s.fixture.cost,
    "unmark refunds the paid energy even when none remained");
  await press("circle"); await press("right"); await press("circle");
  await press("square"); await press("cross");
  s = await snapshot();
  check(s.confirm === null && s.marks.length === 2 && s.energy[s.fixture.colour] === 0,
    "No returns to the picker with both marks and their reservations intact");
  await press("square"); await press("circle");
  s = await snapshot(); observations.push({ step: "commit", ...s });
  await shot("committed");
  check(JSON.stringify(s.field) === JSON.stringify([s.fixture.paid, s.fixture.free]),
    "confirmed cards retain their order from the hand");
  check(s.energy[s.fixture.colour] === 0, "confirmation does not charge the energy twice");
  check(JSON.stringify(s.hand) === JSON.stringify([s.fixture.paid]) && s.handSlots[0] === 27,
    "hand compaction preserves the remaining card and its deck identity");
  check(!s.mine, "confirmation returns control to the next side");
  check(errors.length === 0, "no browser exceptions");
} catch (e) {
  failures.push(e.stack ?? String(e));
  console.error(e);
  await shot("failure").catch(() => {});
} finally {
  writeFileSync(`${out}/result.json`, JSON.stringify({ failures, errors, observations }, null, 2) + "\n");
  await browser.close();
}
assert.equal(failures.length, 0, failures.join("\n"));
