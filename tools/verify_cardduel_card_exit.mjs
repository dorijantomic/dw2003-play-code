// Prove, in the live page, that a card leaving the board squeezes away IN PLACE
// and that the set award then puts both hands back into both decks.
//
// Both beats that send a field card to the trash -- the transfer (0x17 / 0x18)
// and the set award (0x1C / 0x1D) -- call the view's scale tween, and that tween
// pins the card's destination to the position it already holds. So the card
// stays where it is and squeezes to nothing edge-on; what travels is the COUNT.
// The walker used to slide the card to the trash pile's corner on the deal's
// six-tick stagger, marked at the site as a guess for a gap that "was not read".
//
// What this checks:
//   1. a retiring card's destination is the position it already occupies -- it
//      never acquires a destination away from itself;
//   2. its width falls to zero, and its height does not;
//   3. the squeeze runs for the decoded number of ticks;
//   4. the set award's hand return ramps: the hand count falls and the deck
//      count climbs, one card per side at a time, neither ever going backwards.
//
// Serve the lab first:  python3 -m http.server 8742 --directory web
// Then:                 tools/run-playwright.sh tools/verify_cardduel_card_exit.mjs [outdir]
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const OUT = process.argv[2] ?? "/tmp/duelexit";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewportSize: { width: 1280, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

// The legacy duel: this check reads the old shell's own surface, which the native duel — the default since web/game.js:545 — does not expose. Census: docs/research/card/CARD-DUEL-VERIFIED.md 34.
await page.goto(`${baseUrl(8742)}/ui-lab.html?legacyDuel=1`);
await page.waitForTimeout(2500);
const frame = page.frames().find((f) => f.url().includes("index.html")) ?? page.mainFrame();
await frame.evaluate(() => window.__labOpen && window.__labOpen("cardduel"));
await page.waitForTimeout(1500);

const fail = [];
const check = (ok, msg) => { if (!ok) fail.push(msg); else console.log("  ok:", msg); };

const result = await frame.evaluate(() => new Promise((done) => {
  const c = window.__labDuel;
  const open = new Map();        // sprite key -> the squeeze running right now
  const squeezes = [];           // one row per squeeze, so one card can leave twice
  const returns = [];            // one row per frame while the hands go back
  let frames = 0;
  let summonPress = 0;
  let sawReturn = false;

  const tick = () => {
    frames += 1;
    const d = c.duel;
    if (!d) { c.handleKey("enter"); return next(); }

    // Every sprite whose scale-x target is zero is on its way out.
    let stillLeaving = false;
    for (const [key, rec] of c.sprites) {
      const s = rec.sprite;
      if (s.destScaleX !== 0 || s.state === 0) continue;
      stillLeaving = true;
      let row = open.get(key);
      // A width that climbs means the card was shown again, so this is a NEW
      // squeeze: the same sprite key leaves the board more than once in a duel
      // (the opponent's dealt hand collapses once and the set award sends it
      // back again). One row per squeeze, or the last sample of the merged row
      // belongs to the wrong departure.
      if (!row || s.scaleX > row[row.length - 1].sx) {
        row = [];
        open.set(key, row);
        squeezes.push(row);
      }
      row.push({
        x: s.x, y: s.y, destX: s.destX, destY: s.destY,
        sx: s.scaleX, sy: s.scaleY, duration: s.duration,
      });
    }

    const h = c.view && c.view.handReturn;
    if (h && h.running) {
      sawReturn = true;
      returns.push({ tick: h.tick, hand: [...h.hand], deck: [...h.deck] });
    }

    // A phase banner waits on Circle or Cross with no timer of its own
    // (`F0x80089580`), so a driver that never presses waits forever. This is
    // the press a player makes.
    if (d.beat.gated) c.handleKey("circle");
    else if (c.coin && c.coin.step === 2) c.handleKey("circle");
    else if (c.play) c.handleKey("cross");
    else if (c.effectPicker) c.handleKey("circle");
    else if (c.picker) c.handleKey("cross");
    else if (d.summonTurns && !d.summonTurns.done) {
      // Actually summon, or nothing ever reaches the board to leave it. CIRCLE
      // marks; SQUARE raises the "Put in Field?" prompt and CIRCLE answers Yes
      // at it (F0x80087EDC state 7) -- the only path that puts a Digimon on the
      // board; `right` walks the cursor on when nothing is affordable.
      if (d.summonTurns.order[d.summonTurns.turn] !== d.player) c.handleKey("circle");
      else if (c.summonConfirm) c.handleKey("circle");
      else if (c.summonMarks && c.summonMarks.size) c.handleKey("square");
      else {
        summonPress = (summonPress + 1) % 16;
        if (summonPress === 15) c.handleKey("square");         // nothing affordable: raise the prompt to pass
        else c.handleKey(summonPress % 2 === 0 ? "circle" : "right");
      }
    }
    else if (c.setEnd) c.handleKey("circle");  // every window of the set-award chain, not only its first (CARD-DUEL-VERIFIED.md 31)

    // Wait for the hand return AND for every card that was on its way out to
    // finish leaving, or the last squeezes are still in flight and the run
    // cannot say whether their width ever reached zero.
    if ((sawReturn && !(h && h.running) && returns.length > 4 && !stillLeaving)
        || frames > 25000) {
      return done({ frames, squeezes, returns, outcome: d.outcome ?? null });
    }
    next();
  };
  const next = () => requestAnimationFrame(tick);
  next();
}));

console.log("  frames:", result.frames, "cards squeezed:", result.squeezes.length,
            "hand-return samples:", result.returns.length);

check(result.squeezes.length > 0, "cards leave the board");

// 1 + 2: in place, and only the width goes.
let travelled = 0, keptHeight = true, reachedZero = 0;
const durations = new Set();
const lastWidths = [];
for (const row of result.squeezes) {
  const a = row[0];
  if (a.destX !== a.x || a.destY !== a.y) travelled += 1;
  if (row.some((s) => s.sy === 0)) keptHeight = false;
  if (row[row.length - 1].sx <= 0) reachedZero += 1;
  durations.add(a.duration);
  lastWidths.push(row[row.length - 1].sx);
}
check(travelled === 0,
  `no leaving card is given a destination away from itself (${travelled} travelled)`);
check(keptHeight, "the height is never squeezed, only the width");
check(reachedZero > 0,
  `the width reaches zero (${reachedZero} of ${result.squeezes.length};` +
  ` last widths ${lastWidths.join(" ")})`);
console.log("  squeeze durations seen:", [...durations].sort((a, b) => a - b).join(" "));
check([...durations].every((d) => d === 4 || d === 5),
  "every squeeze runs the decoded 4 ticks (set award) or 5 (transfer)");

// 4: the hand return.
check(result.returns.length > 0, "the set award puts the hands back");
if (result.returns.length) {
  const first = result.returns[0], last = result.returns[result.returns.length - 1];
  console.log(`  hand return: hand ${first.hand} -> ${last.hand},` +
              ` deck ${first.deck} -> ${last.deck}`);
  let ok = true, conserved = true;
  for (let i = 1; i < result.returns.length; i += 1) {
    const a = result.returns[i - 1], b = result.returns[i];
    for (const s of [0, 1]) {
      if (b.hand[s] > a.hand[s] || b.deck[s] < a.deck[s]) ok = false;
      if ((a.hand[s] - b.hand[s]) !== (b.deck[s] - a.deck[s])) conserved = false;
      if (a.hand[s] - b.hand[s] > 1) ok = false;
    }
  }
  check(ok, "the hand only falls and the deck only climbs, one card at a time");
  check(conserved, "every card that leaves a hand arrives in that side's deck");
  check(last.hand[0] === 0 || last.hand[1] === 0,
    "it runs until a hand is empty");
}

console.log("");
if (errors.length) console.log("page errors:\n  " + errors.join("\n  "));
else console.log("no page errors");
await browser.close();
if (fail.length || errors.length) {
  console.log("\nFAILED:\n  " + [...fail, ...errors].join("\n  "));
  process.exit(1);
}
console.log("ALL CHECKS PASSED");
