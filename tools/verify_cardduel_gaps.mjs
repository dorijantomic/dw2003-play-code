// Measure, in the live page, which duel beats the walker still does not draw.
//
// The point of this verifier is that it turns a silence into a list. Until now
// every beat with no case of its own fell to the same generic sprite resync,
// and there was no way to tell the 57 rules-only beats — for which that resync
// is exactly right — from the ones where the disc plays an animation and the
// walker plays nothing.
//
// `beatNeedsAnimation` (engine/systems/card-ceremony.ts, generated from
// docs/research/card/cardduel-opcode-atlas.md) makes that distinction. The
// walker records only the animating beats it could not draw; this plays a whole
// duel and prints them.
//
// What this checks:
//   1. the duel still reaches an outcome on its own frames (no regression from
//      the reporting arm itself);
//   2. no beat classified rules-only or no-op is ever recorded as a gap — if
//      one is, the classification and the dispatch disagree and one is wrong;
//   3. the measured gap list is printed, with counts, as the Phase 2 worklist.
//
// WHAT THIS VERIFIER CANNOT SEE, stated so its number is not misread. Its
// driver answers `cross` to every play box, which PASSES the turn, so this duel
// never plays a Program card and never runs a card program at all. Every beat a
// program performs is therefore absent from its "handled and animating" list --
// the list is the CEREMONY's beats, not the duel's. Since 2026-08-27 those
// program beats are issued and drawn, and the verifier that exercises them is
// tools/verify_cardduel_program_beats.mjs, which plays its program cards
// instead of passing them and measures 28 distinct beats against this one's 19.
// Do not read the difference as a gap.
//
// This is a REPORT, not a pass/fail on the gap count: the remaining beats are
// known work, not a regression. It fails only if the duel breaks or the
// classification contradicts the dispatch.
//
// Serve the lab first:  python3 -m http.server 8742 --directory web
// Then:                 tools/run-playwright.sh tools/verify_cardduel_gaps.mjs [outdir]
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const OUT = process.argv[2] ?? "/tmp/duelgaps";
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

// Same press set as verify_cardduel_pace: nothing here advances a phase.
const result = await frame.evaluate(() => new Promise((done) => {
  const c = window.__labDuel;
  const issued = new Set();
  let frames = 0;
  let last = null;

  const tick = () => {
    frames += 1;
    const d = c.duel;
    if (!d) { c.handleKey("enter"); return next(); }

    const cur = d.beat.current;
    if (cur !== last) { if (cur != null) issued.add(cur); last = cur; }

    // A phase banner waits on Circle or Cross with no timer of its own
    // (`F0x80089580`), so a driver that never presses waits forever. This is
    // the press a player makes.
    if (d.beat.gated) c.handleKey("circle");
    else if (c.coin && c.coin.step === 2) c.handleKey("circle");
    else if (c.play) c.handleKey("cross");
    else if (c.effectPicker) c.handleKey("circle");
    else if (c.picker) c.handleKey("cross");
    else if (d.summonTurns && !d.summonTurns.done) c.handleKey(d.summonTurns.order[d.summonTurns.turn] === d.player ? (c.summonConfirm ? "circle" : "square") : "circle");
    else if (c.setEnd) c.handleKey("circle");  // every window of the set-award chain, not only its first (CARD-DUEL-VERIFIED.md 31)

    const finish = (timedOut) => done({
      frames, timedOut, outcome: d.outcome ?? null,
      issued: [...issued].sort((a, b) => a - b),
      gaps: c.unhandledBeats(),
    });
    if (d.outcome && !c.setEnd) return finish(false);
    if (frames > 200000) return finish(true);
    next();
  };
  const next = () => requestAnimationFrame(tick);
  next();
}));

// The classification, read back out of the bundle the page is running, so this
// verifier cannot disagree with the table the walker actually used.
const cls = await frame.evaluate(async () => {
  const m = await import("./vendor/engine.js");
  return m.OPCODE_CLASS;
});

const hex = (n) => "0x" + n.toString(16).toUpperCase().padStart(2, "0");
console.log("  frames:", result.frames, "outcome:", result.outcome);
console.log("  distinct beats issued:", result.issued.length);

check(!!result.outcome, `the duel reaches an outcome (${result.outcome})`);
check(!result.timedOut, `in a bounded time (${result.frames} frames)`);

const misfiled = result.gaps.filter(({ op }) => cls[op] !== "animates");
check(misfiled.length === 0,
  "every recorded gap is a beat the disc animates"
  + (misfiled.length ? ` — misfiled: ${misfiled.map((g) => hex(g.op)).join(" ")}` : ""));

const total = result.gaps.reduce((n, g) => n + g.count, 0);
console.log(`\n  GAPS — beats this duel issued that animate on the disc and`);
console.log(`  fell through to a plain resync: ${result.gaps.length} distinct, ${total} beats\n`);
for (const { op, count } of result.gaps) {
  console.log(`    ${hex(op)}  x${String(count).padStart(3)}   ${cls[op]}`);
}

// The beats this duel issued that ARE animated and DID have a case — the other
// side of the same ledger, so the report reads as progress, not just debt.
const gapOps = new Set(result.gaps.map((g) => g.op));
const handled = result.issued.filter((op) => cls[op] === "animates" && !gapOps.has(op));
console.log(`\n  handled and animating: ${handled.length} — ${handled.map(hex).join(" ")}`);

await page.screenshot({ path: `${OUT}/gaps.png` });
console.log(errors.length ? `\npage errors: ${errors.join(" | ")}` : "\nno page errors");
if (fail.length) { console.log("FAILED:"); for (const f of fail) console.log("  -", f); }
else console.log("ALL CHECKS PASSED");
await browser.close();
process.exit(fail.length ? 1 : 0);
