// Prove, in the live page, that a Load/Compile TURN is an exchange rather than
// a single action, that a pass costs its twenty ticks, and that a card's
// program does not run until the turn is over.
//
//   cardduel-load-compile-turn-rules-2026-08-21          (verified)
//   cardduel-effects-resolve-after-the-turn-2026-08-21   (partially_verified)
//   docs/research/ui/cardgame-divergence-2026-08-21.md items 2 and 3
//
// Serve the lab first:  python3 -m http.server 8742 --directory web
// Then:                 tools/run-playwright.sh tools/verify_cardduel_turns.mjs [outdir]
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const OUT = process.argv[2] ?? "/tmp/duelturns";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewportSize: { width: 1280, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

// The legacy duel: this check reads the old shell's own surface (labDuel.handleKey, labDuel.play), which the native duel (the default since web/game.js:545) does not expose. Census: CARD-DUEL-VERIFIED.md 34.
await page.goto(`${baseUrl(8742)}/ui-lab.html?legacyDuel=1`);
await page.waitForTimeout(2500);
const frame = page.frames().find((f) => f.url().includes("index.html")) ?? page.mainFrame();
await frame.evaluate(() => window.__labOpen && window.__labOpen("cardduel"));
await page.waitForTimeout(1500);

// Injected into the page: true while a beat is waiting on Circle or Cross. The
// seven phase banners poll the pad with no timeout, so the drive loop below
// would otherwise spin forever on a beat that never advances. Same helper as
// tools/verify_cardduel_play.mjs; it must be injected here too, or the loop's
// first tick throws on an undefined function.
await frame.evaluate(`window.duelAwaitsBanner = (d) =>
  !!d && d.beat.gated && d.beat.current !== null;`);

const key = async (k, wait = 220) => {
  await frame.evaluate((kk) => window.__labDuel.handleKey(kk), k);
  await page.waitForTimeout(wait);
};
const shot = (name) => page.screenshot({ path: `${OUT}/${name}.png` });
const snap = () => frame.evaluate(() => {
  const c = window.__labDuel;
  const d = c.duel;
  if (!d) return { phase: null, play: null, turns: null, hand: 0, row: [], trash: 0, energy: null };
  const t = d.programTurns;
  return {
    phase: c.phaseKey(),
    play: c.play ? c.play.stage : null,
    turns: t ? { state: t.state, plays: t.plays, passes: t.passes, turn: t.turn, delay: t.passDelay, done: t.done } : null,
    hand: d.player.hand.length,
    row: d.playedThisPhase.slice(),
    trash: d.player.trash.length,
    energy: { ...d.player.energy },
    log: d.log.slice(-3),
  };
});

const fail = [];
const check = (ok, msg) => { if (!ok) fail.push(msg); else console.log("  ok:", msg); };

// --- to the Load Phase's own question -------------------------------------
let st = await snap();
for (let i = 0; i < 60 && !st.play; i++) { await key("enter"); st = await snap(); }
check(!!st.play, `the Load Phase asks before it acts (${st.play})`);
await shot("01-ask");

// --- a pass costs twenty ticks --------------------------------------------
// Answer "No" and watch the counter run down rather than the turn jumping on.
let turnBefore = st.turns.turn;
// ONLY AN EMPTY TURN IS A PASS, so the delay is only owed when nothing has been
// played this turn: declining after the other side has played goes straight to
// the resolve. Wait for an ask on an empty turn before answering "No".
let mid = null;
for (let i = 0; i < 12; i++) {
  mid = await snap();
  if (mid.play && mid.turns && mid.turns.plays === 0) {
    await frame.evaluate(() => { if (window.__labDuel.play) window.__labDuel.play.ask = 1; });
    await key("enter", 40);
    mid = await snap();
    if (mid.turns && mid.turns.state === "pass") break;
  } else {
    await key(mid.play ? "cross" : "enter", 200);
  }
}
check(!!mid.turns && mid.turns.state === "pass" && mid.turns.delay > 0,
  `a pass holds the screen for its delay (state ${mid.turns?.state}, ${mid.turns?.delay} ticks left)`);
check(!!mid.turns && mid.turns.passDelay !== 0 || mid.turns.state === "pass",
  "and the turn is held rather than moving on");
await shot("02-pass-delay");
// Watch the delay run out rather than sleeping past it. The duel keeps its own
// time now, so a fixed wait can overshoot the whole negotiation — and once the
// negotiation closes, `turns` is null, which is the delay having ended too.
let after = await snap();
for (let i = 0; i < 80 && after.turns && after.turns.state === "pass"; i++) {
  await page.waitForTimeout(40);
  after = await snap();
}
check(!after.turns || after.turns.state !== "pass", "the delay ends on its own");

// --- a card is committed, and its program does NOT run yet -----------------
// Wait for the next question rather than pressing for it: a blind Enter now
// ANSWERS the box instead of moving the duel along. The Summon Phase in
// between IS a decision the disc hands the player, so that one is answered —
// and only that one.
// The pose happens ON the frame the box appears, inside the page: a round trip
// out to the harness and back is several frames, and the duel does not stand
// still for them any more.
const posed = await frame.evaluate(() => new Promise((done) => {
  const c = window.__labDuel;
  let n = 0;
  const tick = () => {
    const d = c.duel;
    if (!d || d.outcome || ++n > 20000) return done(null);
    // A phase banner (the one after the Summon Phase, for instance) waits on
    // Circle with no timer, so a driver that never presses stalls here.
    if (window.duelAwaitsBanner(d)) { c.handleKey("circle"); return requestAnimationFrame(tick); }
    if (!c.play) {
      if (d.summonTurns && !d.summonTurns.done) {
        // Square leaves the browser; only the player's own turn is ours.
        const side = d.summonTurns.order[d.summonTurns.turn];
        c.handleKey(side === d.player ? (c.summonConfirm ? "circle" : "square") : "circle");
      }
      return requestAnimationFrame(tick);
    }
    // White Power is a one-opcode program: one point of white S-Energy. Its
    // arrival is therefore unambiguous evidence that the program has run.
    d.player.hand[0] = 5;
    c.play.cursor = 0; c.play.stage = "ask"; c.play.ask = 0; c.play.frozen = false;
    d.player.energy.white = 0;
    c.resyncSprites();
    done(c.playableSlot(0));
  };
  requestAnimationFrame(tick);
}));
st = await snap();
if (st.play) {
  check(posed, "a one-opcode Program card is in hand and playable");
  const energyBefore = (await snap()).energy.white;
  // ask -> pick -> commit -> played
  for (let i = 0; i < 12; i++) {
    const s = await snap();
    if (s.hand < st.hand) break;
    await key("enter", 260);
  }
  let played = await snap();
  check(played.hand === st.hand - 1, `the card left your hand (${st.hand} -> ${played.hand})`);
  // The turn is an EXCHANGE: after your play the other side may answer and you
  // may answer that, so drive to the end of the turn before checking what the
  // resolve did. Declining here is not a pass — a turn with a play in it goes
  // straight to the resolve.
  for (let i = 0; i < 24; i++) {
    played = await snap();
    if (!played.turns || played.turns.plays === 0 || played.turns.done) break;
    await key(played.play ? "cross" : "enter", 200);
  }
  played = await snap();
  // The play, the other side's answer and the turn's resolve all follow the one
  // press, so what a screen check can show is the END of the pipeline: the card
  // is off the played row, in the trash, and its program has run. That the
  // program does NOT run at the moment of the play is a state a key press
  // cannot catch between frames; it is checked in tests/card-battle.test.js
  // ("a turn's plays resolve together when the turn ends, newest first").
  check(!played.row.includes(5), "the played row is cleared when the turn resolves");
  check(played.energy.white > energyBefore,
    `the program ran at the end of the turn (white ${energyBefore} -> ${played.energy.white})`);
  check(played.turns && played.turns.plays === 0,
    `and the turn moved on (turn ${played.turns?.turn}, plays ${played.turns?.plays})`);
  await shot("03-resolved");
}

console.log(errors.length ? `page errors: ${errors.join(" | ")}` : "no page errors");
if (fail.length) { console.log("FAILED:"); for (const f of fail) console.log("  -", f); }
else console.log("ALL CHECKS PASSED");
await browser.close();
process.exit(fail.length ? 1 : 0);
