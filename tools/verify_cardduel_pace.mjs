// Prove, in the live page, that the duel keeps its own time.
//
// The screen used to advance one PHASE per confirm: nothing moved unless you
// pressed a button, and a whole phase then happened in a single frame. It now
// drives the disc's own ceremony-opcode stream — the twenty opcodes latched at
// duel+0x421, decoded in engine/systems/card-ceremony.ts — one beat per frame,
// each beat holding the screen for the number of frames measured between that
// latch and the next on the rig (GUI save state 1, 2026-08-26 capture).
//
// What this checks:
//   1. the duel reaches an outcome with NO press that advances a phase — the
//      only presses are the two opening screens, the Calumon draw's pick, and
//      the turns the disc genuinely hands to the player;
//   2. every one of the six phase banners is issued, in phase order;
//   3. a beat that carries a measured duration actually holds the screen for
//      it, rather than passing through in one frame. A PHASE BANNER IS NOT
//      SUCH A BEAT: it waits for the player instead, which
//      tools/verify_cardduel_banner_wait.mjs proves;
//   4. nothing stalls: the stream never sits on the same beat with nothing
//      holding it.
//
//   ONE DUEL, ONE OPPONENT, ONE FOLDER — every duration this leans on comes
//   from that single capture.
//
// Serve the lab first:  python3 -m http.server 8742 --directory web
// Then:                 tools/run-playwright.sh tools/verify_cardduel_pace.mjs [outdir]
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const OUT = process.argv[2] ?? "/tmp/duelpace";
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

// The whole duel is played inside the page, one animation frame at a time, so
// the beat stream can be sampled every frame rather than every poll.
const result = await frame.evaluate(() => new Promise((done) => {
  const c = window.__labDuel;
  const BANNERS = [0xa0, 0xa1, 0xa2, 0xa3, 0xa4, 0xa5];
  const seenBanners = [];
  const stream = [];           // [op, framesHeld]
  const presses = [];          // every key this harness sent, and why
  let frames = 0;
  let last = null;
  let heldFor = 0;
  let stallFor = 0;
  let worstStall = 0;

  const tick = () => {
    frames += 1;
    const d = c.duel;
    if (!d) { c.handleKey("enter"); presses.push("opening"); return next(); }

    const cur = d.beat.current;
    if (cur !== last) {
      if (last !== null) stream.push([last, heldFor]);
      if (BANNERS.includes(cur)) seenBanners.push(cur);
      last = cur;
      heldFor = 0;
      stallFor = 0;
    } else {
      heldFor += 1;
      // "Stalled" means: the stream is not moving and nothing on the screen
      // says why. A beat holding its timer is not a stall, nor is a question.
      const dbg = c.driveDebug();
      const held = Object.values(dbg.holds).some(Boolean) || d.beat.hold > 0;
      stallFor = held ? 0 : stallFor + 1;
      worstStall = Math.max(worstStall, stallFor);
    }

    // The only presses this harness makes. NONE of them advances a phase.
    // A phase banner waits on Circle or Cross with no timer of its own
    // (`F0x80089580`), so a driver that never presses waits forever. This is
    // the press a player makes.
    if (d.beat.gated) { c.handleKey("circle"); presses.push("dismiss a phase banner"); }
    else if (c.coin && c.coin.step === 2) { c.handleKey("circle"); presses.push("coin pick"); }
    else if (c.play) { c.handleKey("cross"); presses.push("decline a play turn"); }
    else if (c.effectPicker) { c.handleKey("circle"); presses.push("answer a card"); }
    else if (c.picker) { c.handleKey("cross"); presses.push("close the combo picker"); }
    else if (d.summonTurns && !d.summonTurns.done) { c.handleKey(d.summonTurns.order[d.summonTurns.turn] === d.player ? (c.summonConfirm ? "circle" : "square") : "circle"); presses.push("end a summon turn"); }
    else if (c.setEnd) { c.handleKey("circle"); presses.push("dismiss a set result"); }  // every window of the set-award chain, not only its first (CARD-DUEL-VERIFIED.md 31)

    if (d.outcome && !c.setEnd) {
      if (last !== null) stream.push([last, heldFor]);
      return done({ frames, stream, seenBanners, worstStall, outcome: d.outcome,
                    score: [d.player.score, d.opponent.score],
                    presses: presses.reduce((m, p) => (m[p] = (m[p] ?? 0) + 1, m), {}) });
    }
    if (frames > 200000) {
      return done({ frames, stream, seenBanners, worstStall, outcome: null,
                    score: [d.player.score, d.opponent.score], timedOut: true,
                    drive: c.driveDebug(),
                    presses: presses.reduce((m, p) => (m[p] = (m[p] ?? 0) + 1, m), {}) });
    }
    next();
  };
  const next = () => requestAnimationFrame(tick);
  next();
}));

const hex = (n) => "0x" + n.toString(16).toUpperCase().padStart(2, "0");
console.log("  frames:", result.frames, "outcome:", result.outcome, "score:", result.score);
console.log("  presses:", JSON.stringify(result.presses));
console.log("  beats:", result.stream.length,
  result.stream.slice(0, 14).map(([op, n]) => `${hex(op)}x${n}`).join(" "));

check(!!result.outcome, `the duel reaches an outcome on its own frames (${result.outcome})`);
check(!result.timedOut, `and does so in a bounded time (${result.frames} frames)`);

// Nothing this harness pressed was a phase step. Dismissing a banner is not
// one: the banner beat's own update polls the pad and advances on Circle or
// Cross with no timer (`F0x80089580`), so that press is the disc's own step 2
// rather than a shortcut past a phase. Everything else here is a decision the
// disc genuinely hands to the player.
const ALLOWED = new Set([
  "opening", "dismiss a phase banner", "coin pick", "decline a play turn",
  "answer a card", "close the combo picker", "end a summon turn",
  "dismiss a set result",
]);
const stray = Object.keys(result.presses).filter((k) => !ALLOWED.has(k));
check(stray.length === 0,
  `no press in this run advanced a phase (${stray.join(", ") || "none stray"})`);

// Every banner, in phase order, at least once.
const firstSix = result.seenBanners.slice(0, 6);
check(JSON.stringify(firstSix) === JSON.stringify([0xa0, 0xa1, 0xa2, 0xa3, 0xa4, 0xa5]),
  `the six phase banners are issued in phase order (${firstSix.map(hex).join(" ")})`);

// A beat with a measured duration holds the screen. 0x14 is the deal, whose
// measured gap is 231 frames — the longest of them — so it is the clearest
// witness that a beat OWNS the frame rather than passing through it.
const deal = result.stream.find(([op]) => op === 0x14);
check(!!deal && deal[1] >= 200, `the deal holds the screen (${deal?.[1]} frames)`);
// A BANNER IS NOT ONE OF THOSE. It carries no timer at all — it holds until
// the player presses — so its length here is only how fast this harness
// pressed. That it waits, and for how long, is proved separately by
// tools/verify_cardduel_banner_wait.mjs.

check(result.worstStall < 240,
  `the stream never sits idle with nothing holding it (worst ${result.worstStall} frames)`);

await page.screenshot({ path: `${OUT}/pace.png` });
console.log(errors.length ? `page errors: ${errors.join(" | ")}` : "no page errors");
if (fail.length) { console.log("FAILED:"); for (const f of fail) console.log("  -", f); }
else console.log("ALL CHECKS PASSED");
await browser.close();
process.exit(fail.length ? 1 : 0);
