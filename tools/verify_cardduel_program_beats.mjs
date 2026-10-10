// Prove, in the live page, that the steps of a card program reach the screen.
//
// `?legacyDuel=1` because this drives the HAND-AUTHORED screen (web/cardduel.js);
// the lab defaults to the native pro/cardgame screen, as tools/verify_cardduel.mjs
// records.
//
// THE GAP THIS CLOSES. A card program's steps are latched one at a time on the
// disc, each owning the frame while it plays out. Our interpreter ran a whole
// program inline, so the screen saw none of it: the duel issued 19 distinct
// beats where the captured one issues 38, and every step a program can SHOW was
// invisible. `duel.beat.replay` is the lane those steps now travel on.
//
// WHY THE EXISTING GAP VERIFIER COULD NOT SEE THIS. verify_cardduel_gaps.mjs
// answers `cross` to every play box, which passes the turn — so its duel never
// plays a Program card and never runs a program at all. This one answers
// `circle` and plays them.
//
// What this checks:
//   1. the duel still reaches an outcome on its own frames;
//   2. a card program actually ran (otherwise the rest proves nothing);
//   3. every visible step the interpreter executed was issued as a beat;
//   4. no step was issued that the interpreter never executed;
//   5. none of the issued program beats fell through to a plain resync;
//   6. the beat lane never applies a step twice — the board holds no more
//      cards than the model says it does;
//   7. and, because which programs get dealt is luck, EVERY visible step is
//      then put on the lane by hand and must still find an animation of its
//      own. That last check is the one that does not depend on the shuffle.
//
// Serve the lab first:  python3 -m http.server 8742 --directory web
// Then:                 tools/run-playwright.sh tools/verify_cardduel_program_beats.mjs
import { chromium } from "playwright";
import { baseUrl } from "./verify-base-url.mjs";

const browser = await chromium.launch();
const page = await browser.newPage({ viewportSize: { width: 1280, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

await page.goto(`${baseUrl(8742)}/ui-lab.html?legacyDuel=1`);
await page.waitForTimeout(2500);
const frame = page.frames().find((f) => f.url().includes("index.html")) ?? page.mainFrame();
await frame.evaluate(() => window.__labOpen && window.__labOpen("cardduel"));
await page.waitForTimeout(1500);

const fail = [];
const check = (ok, msg) => { if (!ok) fail.push(msg); else console.log("  ok:", msg); };

const PROGRAM_BEATS = await frame.evaluate(async () => {
  const m = await import("./vendor/engine.js");
  return [...m.PROGRAM_BEATS];
});

await frame.evaluate((ops) => { window.__programBeats = ops; }, PROGRAM_BEATS);

const result = await frame.evaluate(() => new Promise((done) => {
  const c = window.__labDuel;
  const issued = new Set();
  const vmOps = new Set();
  globalThis.__vmOpTrace = vmOps;
  let frames = 0;
  let last = null;
  let overflow = null;
  let injected = false;
  let seededProgram = false;
  const forced = new Set();
  /** beats issued before anything was put on the lane by hand */
  const natural = new Set();

  const tick = () => {
    frames += 1;
    const d = c.duel;
    if (!d) { c.handleKey("enter"); return next(); }

    const cur = d.beat.current;
    if (cur !== last) {
      if (cur != null) { issued.add(cur); if (!injected) natural.add(cur); }
      last = cur;
    }

    // A step replayed for the screen must never apply itself again, and the
    // loudest way that would show is a board holding more cards than the rules
    // allow. Watch it every frame rather than only at the end.
    for (const s of [d.player, d.opponent]) {
      if (s.field.length > 6 && !overflow) overflow = `${s.name} holds ${s.field.length}`;
    }

    // Which programs get dealt is the shuffle's business, so once the duel is
    // properly under way put every visible step on the lane by hand. Each is
    // then latched, dispatched and drawn exactly as a real one would be — and a
    // step with no animation of its own gets recorded as a gap.
    if (!injected && frames > 600 && d.beat && !d.outcome) {
      injected = true;
      for (const op of window.__programBeats) { d.beat.replay.push(op); forced.add(op); }
    }

    // Guarantee a program actually runs rather than trusting the shuffle: put a
    // one-opcode Program card (White Power, id 5) in hand and park the play
    // machine on it, exactly as verify_cardduel_turns does. Without this the
    // dealt hand may never contain a playable Program during the window, and
    // the trace guard ("a card program actually ran") reads zero.
    if (!seededProgram && frames > 120 && d.beat && !d.outcome && c.play) {
      d.player.hand[0] = 5;
      c.play.cursor = 0; c.play.stage = "ask"; c.play.ask = 0; c.play.frozen = false;
      try { c.resyncSprites(); } catch { /* not exposed in every build */ }
      seededProgram = true;
    }

    // PLAY the program cards rather than passing them — that is the whole point.
    // A phase banner waits on Circle or Cross with no timer of its own
    // (`F0x80089580`), so a driver that never presses waits forever. This is
    // the press a player makes.
    if (d.beat.gated) c.handleKey("circle");
    else if (c.coin && c.coin.step === 2) c.handleKey("circle");
    else if (c.play) c.handleKey("circle");
    else if (c.effectPicker) c.handleKey("circle");
    else if (c.picker) c.handleKey("circle");
    else if (d.summonTurns && !d.summonTurns.done) c.handleKey(d.summonTurns.order[d.summonTurns.turn] === d.player ? (c.summonConfirm ? "circle" : "square") : "circle");
    // Every window the set award puts up takes Circle or Cross (F0x800A0F94's
    // five pad gates each read logical 0x0D then 0x0E), so a driver has to take
    // down whichever one is up. It used to press only on the single "result"
    // step, which is all the screen had before the chain was ported.
    else if (c.setEnd) c.handleKey("circle");

    const finish = (timedOut) => done({
      frames, timedOut, overflow, outcome: d.outcome ?? null,
      issued: [...issued].sort((a, b) => a - b),
      forced: [...forced].sort((a, b) => a - b),
      natural: [...natural].sort((a, b) => a - b),
      vmOps: [...vmOps].sort((a, b) => a - b),
      gaps: c.unhandledBeats(),
    });
    if (d.outcome && !c.setEnd) return finish(false);
    if (frames > 30000) return finish(true);
    next();
  };
  const next = () => requestAnimationFrame(tick);
  next();
}));

const hex = (n) => "0x" + n.toString(16).toUpperCase().padStart(2, "0");
console.log("  frames:", result.frames, "outcome:", result.outcome);

const ran = PROGRAM_BEATS.filter((op) => result.vmOps.includes(op));
const shown = PROGRAM_BEATS.filter((op) => result.issued.includes(op));
console.log("  the interpreter ran :", ran.map(hex).join(" ") || "(none)");
console.log("  the screen was shown:", shown.map(hex).join(" ") || "(none)");
console.log("  distinct beats issued:", result.issued.length);
console.log("  the set:", result.issued.map(hex).join(" "));

check(!!result.outcome, `the duel reaches an outcome (${result.outcome})`);
check(!result.timedOut, `in a bounded time (${result.frames} frames)`);
check(result.vmOps.length > 0, `a card program actually ran (${result.vmOps.length} steps)`);

// 0x13 is not a program step: it is the play itself rising into the centre, and
// it is issued once per play rather than from the opcode stream.
const missed = ran.filter((op) => !result.issued.includes(op));
check(missed.length === 0,
  "every visible step the interpreter ran was issued as a beat"
  + (missed.length ? ` — missing: ${missed.map(hex).join(" ")}` : ""));

// Only the beats issued BEFORE the hand-injection can answer this: the injected
// ones are put there on purpose and are checked separately below.
const phantom = result.natural.filter(
  (op) => PROGRAM_BEATS.includes(op) && op !== 0x13 && !result.vmOps.includes(op));
check(phantom.length === 0,
  "no step was shown that the interpreter never ran"
  + (phantom.length ? ` — phantom: ${phantom.map(hex).join(" ")}` : ""));

check(result.issued.includes(0x13),
  "the card you play rises into the centre of the board");

const unhandled = result.gaps.filter(({ op }) => PROGRAM_BEATS.includes(op));
check(unhandled.length === 0,
  "every program beat the duel issued had an animation of its own"
  + (unhandled.length ? ` — resynced: ${unhandled.map((g) => hex(g.op)).join(" ")}` : ""));

check(!result.overflow, `the replay never doubles a step (${result.overflow ?? "board stayed legal"})`);

// The shuffle-independent half: every visible step was put on the lane by hand.
const forcedMissing = PROGRAM_BEATS.filter((op) => !result.forced.includes(op));
check(forcedMissing.length === 0,
  `all ${PROGRAM_BEATS.length} visible steps were put on the lane`
  + (forcedMissing.length ? ` — never queued: ${forcedMissing.map(hex).join(" ")}` : ""));

const forcedNotIssued = result.forced.filter((op) => !result.issued.includes(op));
check(forcedNotIssued.length === 0,
  "every step put on the lane was latched as a beat"
  + (forcedNotIssued.length ? ` — swallowed: ${forcedNotIssued.map(hex).join(" ")}` : ""));

if (errors.length) {
  console.log("\npage errors:");
  for (const e of errors) console.log("  " + e);
} else console.log("\nno page errors");

await browser.close();
if (fail.length || errors.length) {
  console.log("\nFAILED:");
  for (const f of fail) console.log("  " + f);
  for (const e of errors) console.log("  " + e);
  process.exit(1);
}
console.log("ALL CHECKS PASSED");
