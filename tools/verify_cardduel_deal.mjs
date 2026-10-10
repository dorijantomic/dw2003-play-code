// Verify the card duel's deal choreography in the real game module, against the
// runtime capture it was built from (docs/research/card/
// cardduel-choreography-2026-08-06.md).
//
// Both hands must be dealt from x=352 with a scale ramp from zero, staggered,
// landing on x = 24, 65, 106, 147, 188, 229 at y=156 (player) and y=38
// (opponent); the player's cards then flip face up while the opponent's collapse
// edge-on to sx=0 without leaving their slots.
//
// Serve the lab first:  python3 -m http.server 8742 --directory web
// Then:                 tools/run-playwright.sh tools/verify_cardduel_deal.mjs [outdir]
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const OUT = process.argv[2] ?? "/tmp/duelshots";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewportSize: { width: 1280, height: 900 } });
page.on("pageerror", (e) => console.log("PAGE ERROR:", e.message));
page.on("console", (m) => { if (m.type() === "error") console.log("CONSOLE:", m.text()); });

// The legacy duel: this check reads the old shell's own surface (labDuel.handleKey, labDuel.ticks, labDuel?.isOpen, labDuel?.phaseKey, labDuel?.sprites, labDuel?.ticks), which the native duel (the default since web/game.js:545) does not expose. Census: CARD-DUEL-VERIFIED.md 34.
await page.goto(`${baseUrl(8742)}/ui-lab.html?legacyDuel=1`);
await page.waitForTimeout(2500);

const frame = page.frames().find((f) => f.url().includes("index.html")) ?? page.mainFrame();
await frame.evaluate(() => window.__labOpen && window.__labOpen("cardduel"));
await page.waitForTimeout(1200);

const state = await frame.evaluate(() => ({
  open: !!window.__labDuel?.isOpen(),
  phase: window.__labDuel?.phaseKey?.() ?? null,
  ticks: window.__labDuel?.ticks ?? null,
}));
console.log("duel state:", JSON.stringify(state));

// Advance out of the Start phase so the hands are dealt.
// The duel runs its own frames now (it drives the ceremony-opcode stream one
// beat per frame), so this only has to answer the two opening screens and the
// Calumon draw's pick — and the draw's intro tween has to finish before its
// step will take a press at all, which is why this presses until a hand
// appears rather than a fixed four times.
for (let i = 0; i < 60; i++) {
  await frame.evaluate(() => window.__labDuel.handleKey("enter"));
  await page.waitForTimeout(150);
  const n = await frame.evaluate(() => window.__labDuel?.sprites?.size ?? 0);
  console.log("after step", i, "phase",
    await frame.evaluate(() => window.__labDuel?.phaseKey?.()), "sprites", n);
  if (n > 0) break;
}
await frame.evaluate(() => new Promise((done, fail) => {
  let n = 0;
  const tick = () => {
    if ((window.__labDuel?.sprites?.size ?? 0) > 0) return done();
    if (++n > 600) return fail(new Error("no sprites after 600 frames; phase="
      + window.__labDuel?.phaseKey?.()));
    requestAnimationFrame(tick);
  };
  tick();
}));
let first = null, last = null;
let oppWentEdgeOn = false;
const t0 = await frame.evaluate(() => window.__labDuel.ticks);
console.log("deal starts at tick", t0);

// The deal wave is 50 frames from the first launch to the last landing, plus
// the flip wave; sample across it.
for (const t of [0, 8, 16, 24, 34, 50, 62, 76, 92, 120]) {
  await frame.evaluate((target) => new Promise((done) => {
    const tick = () => {
      const d = window.__labDuel;
      if (!d || d.ticks >= target) return done();
      requestAnimationFrame(tick);
    };
    tick();
  }), t0 + t);
  const canvas = await page.locator("iframe").first().contentFrame().locator("canvas").first();
  await canvas.screenshot({ path: `${OUT}/deal-t${String(t).padStart(3, "0")}.png` });
  const snap = await frame.evaluate(() => {
    const d = window.__labDuel;
    if (!d) return null;
    const out = [];
    for (const [k, r] of d.sprites) {
      out.push({ k, x: r.sprite.x >> 8, sx: r.sprite.scaleX,
                 st: r.sprite.state, rk: r.sprite.renderKind });
    }
    return { ticks: d.ticks, n: out.length, sprites: out.slice(0, 14) };
  });
  console.log(`t=${t}`, JSON.stringify(snap));
  if (t === 0) first = snap;
  // The opponent's row squeezes edge-on after it lands and then comes back.
  // The squeeze is the traced half, so watch for it while sampling rather than
  // looking for it in the last frame, where it is over.
  if (snap && snap.sprites.some((x) => x.k.startsWith("opp:hand:") && x.sx === 0
                                       && x.x !== 352))
    oppWentEdgeOn = true;
  last = snap;
}

// ---- assertions against the capture ---------------------------------------
const fail = [];
const check = (ok, what) => { if (!ok) fail.push(what); };

check(first.n === 12, `both hands are dealt (got ${first.n} sprites, want 12)`);
check(first.sprites.some((s) => s.x === 352),
      "the deal starts off the right edge at x=352");
check(first.sprites.some((s) => s.sx === 0),
      "a card that has not launched yet has zero scale");
// Staggered means that at one instant some cards are already crossing while
// others have not left the edge yet.
check(first.sprites.some((s) => s.x < 352) && first.sprites.some((s) => s.x === 352),
      "the wave is staggered — some cards are in flight while others wait");

const you = last.sprites.filter((s) => s.k.startsWith("you:hand:"));
const opp = last.sprites.filter((s) => s.k.startsWith("opp:hand:"));
const SLOTS = [24, 65, 106, 147, 188, 229];
check(JSON.stringify(you.map((s) => s.x)) === JSON.stringify(SLOTS),
      `the player's hand lands on ${SLOTS} (got ${you.map((s) => s.x)})`);
check(JSON.stringify(opp.map((s) => s.x)) === JSON.stringify(SLOTS),
      `the opponent's hand lands on ${SLOTS} (got ${opp.map((s) => s.x)})`);
check(you.every((s) => s.sx === 4096 && s.rk === 1),
      "every player card ends face up at full width");
// CORRECTED 2026-09-14 against the raw run-2 dump. The squeeze (frames 328-331)
// is followed by the slot going to state 0 at frame 611 and STAYING edge-on;
// the opponent's hand is not re-shown until frame 2055, the Summon Phase, by
// the in-place reveal. An earlier version demanded full width in the last
// frame, which was the walker's guessed immediate reopen. The reveal at the
// summon phase is checked by tools/verify_cardduel_opp_hand_reveal.mjs.
check(oppWentEdgeOn,
      "the opponent's hand squeezes edge-on once it has landed");
check(opp.every((s) => s.sx === 0 && s.rk === 2),
      "and stays edge-on, face down, on its slot until the opponent acts");

await browser.close();
if (fail.length) {
  console.error("\nFAILED:");
  for (const f of fail) console.error("  -", f);
  process.exit(1);
}
console.log("\nOK — the deal matches the capture. Shots in", OUT);

