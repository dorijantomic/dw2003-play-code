// Prove, in the live page, that the in-duel inspect menu is there and behaves.
//
// While the duel has a card picker up, Triangle opens a five-row menu over it:
// Hand, Field, Trash, Cancel, Surrender. Three rows are read-only
// look-throughs, one puts the duel back where it was, one gives up. The model
// is engine/systems/card-inspect.ts; the decode is in
// docs/research/card/cardduel-animation-atlas-2026-08-26.md under "How it is
// opened, and how surrender ends the duel".
//
//   ledger cardduel-inspect-menu-hand-field-trash-arms-2026-08-27
//          cardduel-inspect-menu-opens-on-triangle-from-a-picker-2026-08-27
//          cardduel-surrender-ends-the-duel-without-the-set-winner-byte-2026-08-27
//
// What this checks:
//   1. Triangle over a picker opens the menu (Triangle with nothing open still
//      leaves the card game, which is checked in tests/cardduel-ui.test.js
//      rather than here — pressing it would close the screen this run needs);
//   2. the row cursor WRAPS both ways, over exactly five rows;
//   3. Hand opens a look-through, its cursor CLAMPS at both ends, and there is
//      no confirm in it — only Cross, back to the menu;
//   4. Field walks the sections, and answers "No Cards in the Field." when the
//      board is bare;
//   5. Cancel puts the duel back exactly where it was;
//   6. Surrender asks first, No goes back, and Yes ends the duel with the set
//      scores untouched.
//
// Serve the lab first:  python3 -m http.server 8742 --directory web
// Then:                 tools/run-playwright.sh tools/verify_cardduel_inspect.mjs [outdir]
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const OUT = process.argv[2] ?? "/tmp/duelinspect";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewportSize: { width: 1280, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

// The legacy duel: this check reads the old shell's own surface (labDuel.duel, labDuel.handleKey), which the native duel (the default since web/game.js:545) does not expose. Census: CARD-DUEL-VERIFIED.md 34.
await page.goto(`${baseUrl(8742)}/ui-lab.html?legacyDuel=1`);
await page.waitForTimeout(2500);
const frame = page.frames().find((f) => f.url().includes("index.html")) ?? page.mainFrame();
await frame.evaluate(() => window.__labOpen && window.__labOpen("cardduel"));
await page.waitForTimeout(1500);

const fail = [];
const check = (ok, msg) => { if (!ok) fail.push(msg); else console.log("  ok:", msg); };
const key = async (k, wait = 120) => {
  await frame.evaluate((kk) => window.__labDuel.handleKey(kk), k);
  await page.waitForTimeout(wait);
};
const shot = (name) => page.screenshot({ path: `${OUT}/${name}.png` });
const snap = () => frame.evaluate(() => {
  const c = window.__labDuel, d = c.duel;
  return {
    open: c.isOpen(), hasDuel: !!d,
    play: c.play ? { stage: c.play.stage, cursor: c.play.cursor } : null,
    inspect: c.inspect ? { ...c.inspect } : null,
    outcome: d?.outcome ?? null,
    score: d ? [d.player.score, d.opponent.score] : null,
    hand: d?.player.hand.length ?? 0,
    field: d?.player.field.length ?? 0,
    oppField: d?.opponent.field.length ?? 0,
    log: d?.log.slice(-1) ?? [],
  };
});

// Walk to a picker, pressing only where the duel genuinely waits on the pad.
const toPicker = async (tries = 400) => {
  for (let i = 0; i < tries; i++) {
    const s = await snap();
    if (s.play) return s;
    await frame.evaluate(() => {
      const c = window.__labDuel, d = c.duel;
      if (!d) { c.handleKey("enter"); return; }
      if (d.beat.gated) c.handleKey("circle");
      else if (c.coin && c.coin.step === 2) c.handleKey("circle");
      else if (c.setEnd) c.handleKey("circle");  // every window of the set-award chain, not only its first (CARD-DUEL-VERIFIED.md 31)
    });
    await page.waitForTimeout(50);
  }
  return snap();
};

let st = await toPicker();
check(!!st.play, `the duel reaches a card picker (${JSON.stringify(st.play)})`);
await shot("01-picker");

// ---- 1. Triangle opens it -------------------------------------------------
await key("triangle");
st = await snap();
check(!!st.inspect && st.inspect.stage === "menu",
  `Triangle over the picker opens the five-row menu (${JSON.stringify(st.inspect)})`);
await shot("02-menu-open");

// ---- 2. the row cursor wraps ---------------------------------------------
await key("up");
st = await snap();
check(st.inspect?.row === 4, `up from the first row reaches the last (row ${st.inspect?.row})`);
await key("down");
st = await snap();
check(st.inspect?.row === 0, "and down from the last comes back to the first");

// ---- 3. Hand is a read-only look-through ---------------------------------
await key("circle");                                  // row 0 = Hand
st = await snap();
check(st.inspect?.stage === "browse" && st.inspect.arm === 0x9b,
  `Hand opens a look-through (${JSON.stringify(st.inspect)})`);
await shot("03-hand-lookthrough");
await key("left");
st = await snap();
check(st.inspect?.cursor === 0, "the browse cursor clamps at the near end rather than wrapping");
const handSize = st.hand;
for (let i = 0; i < handSize + 3; i++) await key("right", 40);
st = await snap();
check(st.inspect?.cursor === Math.max(0, handSize - 1),
  `and clamps at the far end (${st.inspect?.cursor} of ${handSize})`);
await key("circle");
st = await snap();
check(st.inspect?.stage === "browse", "a confirm does nothing in a look-through — it is read-only");
await key("cross");
st = await snap();
check(st.inspect?.stage === "menu", "Cross closes it, back to the five rows");

// ---- 4. Field, and its empty guard ---------------------------------------
await key("down");
await key("circle");                                  // row 1 = Field
st = await snap();
const bare = st.field === 0 && st.oppField === 0;
if (bare) {
  check(st.inspect?.stage === "empty",
    "a bare board answers with the field message rather than an empty list");
  await shot("04-field-empty");
  await key("circle");
} else {
  check(st.inspect?.stage === "field",
    `the field look-through opens on a section with cards (${st.inspect?.section})`);
  await shot("04-field-lookthrough");
  await key("cross");
}
st = await snap();
check(st.inspect?.stage === "menu", "and it comes back to the five rows");

// ...and with cards on the board it walks the sections. A duel this early has
// a bare field, so the boards are seeded directly to reach the state — the
// section walk is what is under test, not how the cards got there.
if (bare) {
  await frame.evaluate(() => {
    const d = window.__labDuel.duel;
    const take = (side) => ({ id: side.deck[0] ?? 1, ap: 20, hp: 20, ready: true });
    d.player.field.push(take(d.player));
    d.opponent.field.push(take(d.opponent));
  });
  await key("circle");                                // Field again
  st = await snap();
  check(st.inspect?.stage === "field" && st.inspect.section === "you",
    `with cards on the board it opens on your own field (${st.inspect?.section})`);
  await shot("04b-field-lookthrough");
  // Your row is the BOTTOM of the board, so Down is refused there and Up walks
  // upward past the empty played stack to the opponent's row.
  await key("down");
  st = await snap();
  check(st.inspect?.section === "you",
    `Down on the bottom row stays put (${st.inspect?.section})`);
  await key("up");
  st = await snap();
  check(st.inspect?.section === "opp",
    `Up jumps to the next section with cards in it (${st.inspect?.section})`);
  await key("up");
  st = await snap();
  check(st.inspect?.section === "opp",
    "and Up on the top row stays put rather than wrapping");
  await key("down");
  st = await snap();
  check(st.inspect?.section === "you",
    "and it skips the empty played stack rather than landing on it");
  await key("cross");
  st = await snap();
  check(st.inspect?.stage === "menu", "Cross leaves the field look-through too");
  await frame.evaluate(() => {
    const d = window.__labDuel.duel;
    d.player.field.length = 0;
    d.opponent.field.length = 0;
  });
}

// ---- 5. Cancel puts the duel back ----------------------------------------
const beforeCancel = await snap();
await key("down"); await key("down");                 // row 2 -> 3 = Cancel
st = await snap();
check(st.inspect?.row === 3, `the cursor reaches Cancel (row ${st.inspect?.row})`);
await key("circle");
st = await snap();
check(!st.inspect, "Cancel closes the menu");
check(!!st.play && st.play.stage === beforeCancel.play?.stage,
  `and the picker underneath is exactly where it was (${st.play?.stage})`);
await shot("05-back-to-the-picker");

// ---- 6. Surrender --------------------------------------------------------
await key("triangle");
for (let i = 0; i < 4; i++) await key("down");        // row 0 -> 4 = Surrender
st = await snap();
check(st.inspect?.row === 4, `the cursor reaches Surrender (row ${st.inspect?.row})`);
await key("circle");
st = await snap();
check(st.inspect?.stage === "surrender", "Surrender asks before it does anything");
await shot("06-are-you-sure");
await key("down");                                    // No
await key("circle");
st = await snap();
check(st.inspect?.stage === "menu", "answering No goes back to the five rows, duel intact");
check(!st.outcome, "and the duel is still running");

// Answering No leaves the cursor on Surrender, so it takes only the confirm.
const scoreBefore = st.score;
while ((await snap()).inspect?.row !== 4) await key("down");
await key("circle");                                  // Surrender again
st = await snap();
check(st.inspect?.stage === "surrender", "and it can be asked again");
await key("circle");                                  // Yes is the resting answer
st = await snap();
check(st.outcome === "loss", `answering Yes ends the duel (${st.outcome})`);
check(JSON.stringify(st.score) === JSON.stringify(scoreBefore),
  `and the set scores are untouched (${JSON.stringify(st.score)})`);
check(/gave up/.test(st.log[0] ?? ""), `the duel says what happened (${st.log[0]})`);
await shot("07-surrendered");

check(errors.length === 0, `no page errors (${errors.join("; ")})`);
await browser.close();
if (fail.length) { console.log("FAILED:"); for (const f of fail) console.log("  -", f); process.exit(1); }
console.log("\nall checks passed");
console.log("captures in", OUT);
