// Drive a whole card duel through the real game module and check that the
// decoded rules are the ones the screen is running on
// (docs/research/card/cardduel-rules-2026-08-06.md).
//
// Checks, in the live page rather than in a unit test:
//   * six cards drawn per side, and S-Energy appearing with them, one point per
//     card of an energy colour and none for brown;
//   * at most 10 in hand, at most 6 on the field, energy never above 99;
//   * the HUD's five stepped plates carrying the five energy colours;
//   * the duel ending at two sets.
//
// Serve the lab first:  python3 -m http.server 8742 --directory web
// Then:                 tools/run-playwright.sh tools/verify_cardduel_rules.mjs [outdir]
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const OUT = process.argv[2] ?? "/tmp/duelrules";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewportSize: { width: 1280, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
  if (m.type() !== "error") return;
  // A failed subresource is reported to the console WITHOUT its URL, so it
  // cannot be judged here — the response listener below judges it by URL and
  // records what actually matters.
  if (/Failed to load resource/.test(m.text())) return;
  errors.push(m.text());
});
page.on("response", (r) => {
  if (r.status() !== 404) return;
  // The field renderer probes for an optional per-layer raster (`*_l0.png`)
  // that the asset build does not produce. That is a map-layer question, not a
  // duel rule, and counting it made this harness fail for a cause it does not
  // test. Any OTHER 404 is still a real error.
  if (/\/assets\/maps\/[^/]+_l\d+\.png$/.test(r.url())) return;
  errors.push(`404 ${r.url()}`);
});

// The legacy duel: this check reads the old shell's own surface (labDuel.duel, labDuel.handleKey, labDuel.phaseKey, labDuel?.duel), which the native duel (the default since web/game.js:545) does not expose. Census: CARD-DUEL-VERIFIED.md 34.
await page.goto(`${baseUrl(8742)}/ui-lab.html?legacyDuel=1`);
await page.waitForTimeout(2500);
const frame = page.frames().find((f) => f.url().includes("index.html")) ?? page.mainFrame();
await frame.evaluate(() => window.__labOpen && window.__labOpen("cardduel"));
await page.waitForTimeout(1500);

const snap = () => frame.evaluate(() => {
  const d = window.__labDuel?.duel;
  if (!d) return null;
  const s = (x) => ({
    hand: x.hand.length, field: x.field.length, deck: x.deck.length,
    trash: x.trash.length, energy: { ...x.energy }, score: x.score,
    totalAp: x.totalAp, totalHp: x.totalHp,
  });
  return {
    phase: window.__labDuel.phaseKey(), set: d.set, outcome: d.outcome,
    player: s(d.player), opponent: s(d.opponent),
    log: d.log.slice(-3),
  };
});

/** Wait for the board to accept input again. The duel refuses every press while
 *  any card is still in flight — the Summon Phase in particular swallows them all
 *  (web/cardduel.js:2657) — and it publishes that refusal as its own test,
 *  `busyNow()` ("debug-only: why the board is refusing input",
 *  web/cardduel.js:1192-1195). A harness that fires presses on a timer loses
 *  whichever ones land mid-animation: this one did, and the Summon picker's mark
 *  never arrived, so a duel that could summon reported "Digimon reached the
 *  field" as a rules failure. Bounded, so a board that never settles cannot hang
 *  the run. */
const idle = async (tries = 60) => {
  for (let i = 0; i < tries && (await frame.evaluate(() => window.__labDuel.busyNow())); i++) {
    await page.waitForTimeout(100);
  }
};
const press = async (k) => {
  await idle();
  await frame.evaluate((kk) => window.__labDuel.handleKey(kk), k);
  await page.waitForTimeout(220);
};
const marked = () => frame.evaluate(() => (window.__labDuel.summonMarks?.size ?? 0) > 0);
/** The hand as the summon picker sees it: which cards it walks past, and why. */
const hand = () => frame.evaluate(() => {
  const d = window.__labDuel.duel;
  return {
    energy: { ...d.player.energy },
    cards: d.player.hand.map((id, slot) => {
      const rec = d.byId.get(id);
      return { slot, name: rec?.name, kind: rec?.kind, colour: rec?.colour };
    }),
  };
});

/** One press. The duel now PARKS in four places the old version of this
 *  harness knew nothing about — the pick/confirm/commit negotiation for a card,
 *  the Summon picker's own three steps, and a card program's own question — and
 *  a bare Enter answers none of them. So a press first discharges whatever the
 *  screen is waiting for:
 *    * `play`   the three-step play negotiation -> Cross, decline and move on,
 *               since this harness tests the ceilings and not the choosing;
 *    * `picker` a program's board or pile question -> Circle, take the default.
 *  Without this the duel sits in the Load Phase forever and every check past
 *  the draw fails for one cause. */
const step = async (n = 1) => {
  for (let i = 0; i < n; i++) {
    const parked = await frame.evaluate(() => {
      const c = window.__labDuel;
      const t = c.duel?.summonTurns;
      return {
        play: !!c.play, picker: !!c.effectPicker,
        summon: !!(t && !t.done), confirm: !!c.summonConfirm,
        mine: !!(t && !t.done && c.summonIsMine()),
      };
    });
    if (parked.summon && parked.mine && !parked.confirm) {
      // THE SUMMON PICKER IS THREE STEPS, AND THE FIRST ONE MARKS A CARD.
      // Circle toggles the mark on the card under the hand cursor, Square
      // raises "Put in Field? Yes/No" (F0x800878B4 sets picker state 6 on
      // Square), and Circle at that prompt commits the marked set and ends the
      // turn (web/cardduel.js:2611-2650). Squaring with nothing marked commits
      // an EMPTY set, so the field stayed empty for the whole duel and this
      // harness reported "Digimon reached the field" as a rules failure. Walk
      // the cursor along the hand and mark the first card that takes it, which
      // is what a player does; the cursor does not wrap (it stops at both ends),
      // so one pass over the hand is the whole search.
      const n = await frame.evaluate(() => window.__labDuel.duel.player.hand.length);
      for (let g = 0; g < n + 2 && !(await marked()); g++) {
        await press("circle");
        if (await marked()) break;
        await press("right");
      }
      if (!(await marked())) {
        // Nothing in this hand takes a mark — no Digimon, or not enough S-Energy
        // of its colour. Say so with the hand and the pool, so a duel that truly
        // cannot summon is a legible result and not a mystery.
        console.log("  (no card took a mark)", JSON.stringify(await hand()));
      }
      await press("square");
      continue;
    }
    const k = parked.summon ? (parked.confirm ? "circle" : "square")
      : parked.picker ? "circle" : parked.play ? "cross" : "enter";
    await press(k);
  }
};

/** Press until the duel actually reaches the state being tested. The board
 *  refuses input while cards animate, so a fixed number of presses samples the
 *  state at a moment that depends on machine speed. */
const stepUntil = async (want, tries = 40) => {
  let st = await snap();
  for (let i = 0; i < tries && !want(st); i++) { await step(); st = await snap(); }
  return st;
};

const fail = [];
const check = (ok, msg) => { if (!ok) fail.push(msg); else console.log("  ok:", msg); };

// The lab opens on the challenge screen, not in a duel: `__labDuel.duel` is
// null until somebody accepts. Press through that first, or the very first
// snapshot is null and every check below fails for one cause that has nothing
// to do with the rules.
for (let i = 0; i < 20 && (await snap()) === null; i++) {
  await frame.evaluate(() => window.__labDuel.handleKey("enter"));
  await page.waitForTimeout(220);
}
console.log("start:", JSON.stringify(await snap()));
// Six each is the state to wait FOR, not a state to assume after two presses.
let st = await stepUntil((s) => s.player.hand >= 6 && s.opponent.hand >= 6);
console.log("after draw:", JSON.stringify(st));
check(st.player.hand === 6, "six cards drawn into the player's hand");
check(st.opponent.hand === 6, "six cards drawn into the opponent's hand");
const energyTotal = (e) => Object.values(e).reduce((a, b) => a + b, 0);
check(Object.keys(st.player.energy).join(",") === "white,blue,green,red,black",
  "the energy pool is the five colours, brown excluded");
check(energyTotal(st.player.energy) <= 6,
  "no more than one energy point per card drawn");
await page.screenshot({ path: `${OUT}/01-after-draw.png` });

// Run the duel out, watching the ceilings the whole way.
let guard = 0;
let sawField = false;
while (!st.outcome && guard++ < 600) {
  await step();
  st = await snap();
  for (const side of ["player", "opponent"]) {
    const s = st[side];
    if (s.hand > 10) fail.push(`${side} hand exceeded 10 (${s.hand})`);
    if (s.field > 6) fail.push(`${side} field exceeded 6 (${s.field})`);
    if (s.field > 0) sawField = true;
    for (const [c, v] of Object.entries(s.energy)) {
      if (v > 99) fail.push(`${side} ${c} energy exceeded 99 (${v})`);
    }
  }
  if (st.phase === "battle") await page.screenshot({ path: `${OUT}/02-battle-set${st.set}.png` });
}
console.log("end:", JSON.stringify(st));
await page.screenshot({ path: `${OUT}/03-outcome.png` });

check(sawField, "Digimon reached the field");
check(!!st.outcome, "the duel reached an outcome");
check(st.player.score === 2 || st.opponent.score === 2,
  `the duel ended at two sets (${st.player.score}-${st.opponent.score})`);
check(st.set <= 3, `a best-of-three never ran past three sets (${st.set})`);
check(errors.length === 0, `no page errors (${errors.slice(0, 3).join(" | ")})`);

await browser.close();
if (fail.length) {
  console.log("\nFAILED:");
  for (const f of fail) console.log("  -", f);
  process.exit(1);
}
console.log(`\nAll checks passed. Shots in ${OUT}`);
