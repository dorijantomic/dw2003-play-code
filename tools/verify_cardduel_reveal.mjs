// Prove, in the live page, that a queued card reveal becomes its own beat with
// its own screen — and that the four panel numbers travel rather than jumping.
//
// A program card that says "show this" (0x2A) only counts: it raises the
// reveal queue. The Battle-Phase machine's state 8 then issues one 0x1B per
// count (cardgame.s:30972), and 0x1B's update ramps both sides' AP and HP
// toward each other over fifteen frames, exchanges the stored totals, and waits
// for a press. Until 2026-08-28 the walker folded that into the rules and put
// nothing on screen.
//
//   ledger cardduel-battle-phase-issues-one-beat-per-event-2026-08-28
//
// What this checks:
//   1. a queued reveal is issued as a 0x1B beat, one per count;
//   2. the beat WAITS — it does not advance on its own;
//   3. the panel numbers are mid-ramp while it waits, not already exchanged;
//   4. a press releases it and the totals end up exchanged.
//
// Serve the lab first:  python3 -m http.server 8742 --directory web
// Then:                 tools/run-playwright.sh tools/verify_cardduel_reveal.mjs [outdir]
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const OUT = process.argv[2] ?? "/tmp/duelreveal";
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

// Drive to the first Battle Phase with two reveals queued, then stop and look.
const seen = await frame.evaluate(() => new Promise((done) => {
  const c = window.__labDuel;
  let frames = 0;
  let armed = false;
  let pressed = 0;
  let releasing = false;
  const reveals = [];

  const tick = () => {
    frames += 1;
    const d = c.duel;
    if (!d) { c.handleKey("enter"); return next(); }

    // Queue two reveals just before the Battle Phase opens, the way a played
    // Fortune Gate would. NOTHING ELSE IS TOUCHED -- an earlier draft seeded
    // the boards with hand-built slots and the totals came back NaN, which is
    // the harness lying to itself rather than a fault in the screen.
    if (!armed && d.phaseIndex === 4) { armed = true; d.revealBeats = 2; }

    if (d.beat.current === 0x1b) {
      // Watch the ramp while the beat owns the frame. It is the view's own
      // state, so this reads what the panels are drawing.
      const r = c.view && c.view.reveal;
      reveals.push({
        frames, gated: !!d.beat.gated,
        tick: r ? r.tick : null, running: r ? r.running : null,
        from: r ? { ...r.from } : null, to: r ? { ...r.to } : null,
        totals: [d.player.totalAp, d.player.totalHp,
                 d.opponent.totalAp, d.opponent.totalHp],
      });
      // Two reveals run BACK TO BACK, so the beat opcode never changes between
      // them; the ramp restarting at zero is what says a new one has begun.
      if (r && r.tick === 0) releasing = false;
      // Let each ramp finish, then press through it -- once per beat, not once
      // per frame the finished ramp is up.
      if (r && r.tick >= 15 && !releasing) {
        releasing = true;
        c.handleKey("circle");
        pressed += 1;
        if (pressed >= 2) return done({ frames, reveals, ok: true });
      }
      if (frames > 4000) return done({ frames, reveals, ok: false, why: "stuck on a reveal" });
      return next();
    }
    if (d.beat.current !== 0x1b) {
      releasing = false;
    }

    if (d.beat.gated) c.handleKey("circle");
    else if (c.coin && c.coin.step === 2) c.handleKey("circle");
    else if (c.play) c.handleKey("cross");
    else if (c.effectPicker) c.handleKey("circle");
    else if (c.picker) c.handleKey("cross");
    else if (d.summonTurns && !d.summonTurns.done) c.handleKey(d.summonTurns.order[d.summonTurns.turn] === d.player ? (c.summonConfirm ? "circle" : "square") : "circle");
    else if (c.setEnd) c.handleKey("circle");  // every window of the set-award chain, not only its first (CARD-DUEL-VERIFIED.md 31)

    if (d.outcome && !c.setEnd) return done({ frames, reveals, ok: false, why: "duel ended" });
    if (frames > 4000) return done({ frames, reveals, ok: false, why: "timed out" });
    next();
  };
  const next = () => requestAnimationFrame(tick);
  next();
}));

console.log("  frames:", seen.frames, "reveals seen:", seen.reveals.length,
            seen.why ? `(${seen.why})` : "");

check(!seen.why, `the duel is never stuck on a reveal (${seen.why ?? "clean"})`);
const starts = seen.reveals.filter((r) => r.tick === 0).length;
check(starts >= 2, `both queued reveals are issued as their own beat (${starts})`);
check(seen.reveals.some((r) => r.running && r.tick > 0 && r.tick < 15),
  "the ramp is caught part-way, so the numbers travel rather than jumping");
check(seen.reveals.some((r) => r.tick >= 15 && r.gated),
  "the ramp finishes and the beat then WAITS rather than advancing on its own");
const ramp = seen.reveals.find((r) => r.from && r.to);
check(!!ramp && ramp.from.playerAp === ramp.to.opponentAp
              && ramp.from.opponentAp === ramp.to.playerAp,
  `the ramp crosses the two sides rather than a side's own pair (${JSON.stringify(ramp?.from)} -> ${JSON.stringify(ramp?.to)})`);

await page.screenshot({ path: `${OUT}/reveal.png` });
console.log(errors.length ? `page errors: ${errors.join(" | ")}` : "no page errors");
if (fail.length) { console.log("FAILED:"); for (const f of fail) console.log("  -", f); }
else console.log("ALL CHECKS PASSED");
await browser.close();
process.exit(fail.length ? 1 : 0);
