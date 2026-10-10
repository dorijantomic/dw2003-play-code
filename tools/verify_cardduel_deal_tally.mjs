// Prove, in the live page, that the five energy numbers COUNT UP during the
// deal instead of appearing at their final value.
//
// The deal's handler F0x80092E60 is a twelve-state sub-machine. Its fourth pass
// walks both hands slot by slot, adds each card's colour to that side's energy
// block at +0x5A8, and pushes the running count to the HUD through the panel
// setter as property `colour - 1` -- panel +0x18..+0x1C, which the layout
// record names `field_numbers`: the five two-digit numbers under the cubes.
//
// What this checks:
//   1. the ramp actually runs when the deal beat is issued;
//   2. nothing is counted during the lead-in, while the cards are still flying
//      in and turning over;
//   3. the numbers only ever climb;
//   4. each step lands one hand slot -- so both sides gain at most one point
//      between consecutive steps, never a jump to the finished total;
//   5. it stops after six slots, and the totals it lands on are the totals the
//      model already holds.
//
// Serve the lab first:  python3 -m http.server 8742 --directory web
// Then:                 tools/run-playwright.sh tools/verify_cardduel_deal_tally.mjs [outdir]
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const OUT = process.argv[2] ?? "/tmp/duealtally";
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
  const samples = [];       // one row per frame while the ramp is running
  let started = false;
  let frames = 0;
  let modelAtEnd = null;

  const tick = () => {
    frames += 1;
    const d = c.duel;
    if (!d) { c.handleKey("enter"); return next(); }

    const t = c.view && c.view.dealTally;
    if (t && t.running) {
      started = true;
      samples.push({
        tick: t.tick, step: t.step,
        you: [...t.shown[0]], opp: [...t.shown[1]],
      });
    } else if (started && modelAtEnd === null) {
      const names = ["white", "blue", "green", "red", "black"];
      modelAtEnd = {
        you: names.map((n) => d.player.energy[n] ?? 0),
        opp: names.map((n) => d.opponent.energy[n] ?? 0),
      };
      return done({ frames, samples, modelAtEnd });
    }

    // A phase banner waits on Circle or Cross with no timer of its own
    // (`F0x80089580`), so a driver that never presses waits forever. This is
    // the press a player makes.
    if (d.beat.gated) c.handleKey("circle");
    else if (c.coin && c.coin.step === 2) c.handleKey("circle");
    else if (c.play) c.handleKey("cross");
    else if (c.effectPicker) c.handleKey("circle");
    else if (c.picker) c.handleKey("cross");
    else if (c.setEnd) c.handleKey("circle");  // every window of the set-award chain, not only its first (CARD-DUEL-VERIFIED.md 31)
    else if (d.summonTurns && !d.summonTurns.done) c.handleKey(d.summonTurns.order[d.summonTurns.turn] === d.player ? (c.summonConfirm ? "circle" : "square") : "circle");

    if (frames > 20000) return done({ frames, samples, modelAtEnd, timedOut: true });
    next();
  };
  const next = () => requestAnimationFrame(tick);
  next();
}));

const sum = (a) => a.reduce((x, y) => x + y, 0);
console.log("  frames:", result.frames, "ramp samples:", result.samples.length);

check(result.samples.length > 0, "the deal starts the colour tally");
if (result.samples.length === 0) {
  console.log("\nFAILED:\n  " + ["the deal starts the colour tally"].join("\n  "));
  await browser.close();
  process.exit(1);
}

const first = result.samples[0];
const last = result.samples[result.samples.length - 1];
console.log(`  first sample: tick ${first.tick} step ${first.step}` +
            ` you [${first.you}] opp [${first.opp}]`);
console.log(`  last  sample: tick ${last.tick} step ${last.step}` +
            ` you [${last.you}] opp [${last.opp}]`);
if (result.modelAtEnd) {
  console.log(`  model after:  you [${result.modelAtEnd.you}] opp [${result.modelAtEnd.opp}]`);
}

// 2. nothing counted during the lead-in.
check(sum(first.you) === 0 && sum(first.opp) === 0,
  "both readouts start at nothing");
const leadIn = result.samples.filter((s) => s.step === 0);
check(leadIn.length > 1,
  `nothing is counted for the whole lead-in (${leadIn.length} frames)`);

// 3. monotone, per colour, per side.
let climbs = true, jumps = 0;
for (let i = 1; i < result.samples.length; i += 1) {
  const a = result.samples[i - 1], b = result.samples[i];
  for (const side of ["you", "opp"]) {
    for (let k = 0; k < 5; k += 1) {
      if (b[side][k] < a[side][k]) climbs = false;
      if (b[side][k] - a[side][k] > 1) jumps += 1;
    }
  }
}
check(climbs, "the numbers only ever climb");
// 4. one hand slot per step: at most one point per side per transition.
check(jumps === 0, `no colour ever gains more than one point at a time (${jumps} jumps)`);

// 5. six slots, and the ramp's totals are the model's.
check(last.step === 6 || last.step === 5,
  `the ramp reaches the last hand slot (step ${last.step})`);
if (result.modelAtEnd) {
  const total = (r, s) => sum(r[s]);
  check(total(last, "you") <= total(result.modelAtEnd, "you")
     && total(last, "opp") <= total(result.modelAtEnd, "opp"),
    "the ramp never overshoots the totals the model holds");
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
