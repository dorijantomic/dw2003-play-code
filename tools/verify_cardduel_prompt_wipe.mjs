// tools/verify_cardduel_prompt_wipe.mjs — the play-negotiation box WIPES open.
//
// web/cardduel.js used to pop this box up instantly: drawPlayBox drew a static
// band the moment the negotiation opened. The original opens it over 12 frames
// and closes it over 6 (F0x8009C054 / F0x8009C0DC, driven by F0x80097ACC), with
// the progress running 0 -> 0x1000. engine/systems/card-view.ts owns that state
// machine; this proves the walker now runs it and the renderer follows.
//
// Serve the lab first:  python3 -m http.server 8742 --directory web
import { chromium } from "playwright";
import { baseUrl } from "./verify-base-url.mjs";

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

const r = await frame.evaluate(() => new Promise((done) => {
  const c = window.__labDuel;
  const out = { reached: false, progress: [], states: [] };
  let n = 0, sampling = 0;
  const tick = () => {
    if (++n > 40000) return done(out);
    if (!c.duel) { c.handleKey("enter"); return requestAnimationFrame(tick); }
    // Once the negotiation is up, sample the decoded window instead of pressing.
    // Sample the NEGOTIATION's window, not merely any window standing while a
    // question is pending. `layoutIndex` says who owns the single prompt
    // record: the negotiation opens layout 0, the phase prompt and 0xA8's
    // window use layout 1. A question asked DURING an announcement is real --
    // the announcement legitimately keeps the box until it ends -- so keying on
    // `c.play` alone caught the announcement's own window at whatever width it
    // had reached and reported it as the negotiation jumping backwards. That
    // failed about one run in six and read as flakiness.
    if (c.play && c.view && c.view.prompt.layoutIndex === 0) {
      out.reached = true;
      out.progress.push(c.view.prompt.progress);
      out.states.push(c.view.prompt.state);
      out.layouts = out.layouts ?? []; out.layouts.push(c.view.prompt.layoutIndex);
      out.asks = out.asks ?? []; out.asks.push(c.play.stage);
      if (++sampling >= 20) return done(out);
      return requestAnimationFrame(tick);
    }
    // Drive everything else exactly as the pace verifier does.
    const d = c.duel;
    // A phase banner waits on Circle or Cross with no timer of its own
    // (`F0x80089580`), so a driver that never presses waits forever. This is
    // the press a player makes.
    if (d.beat.gated) c.handleKey("circle");
    else if (c.coin && c.coin.step === 2) c.handleKey("circle");
    else if (c.effectPicker) c.handleKey("circle");
    else if (c.picker) c.handleKey("cross");
    else if (d.summonTurns && !d.summonTurns.done) c.handleKey(d.summonTurns.order[d.summonTurns.turn] === d.player ? (c.summonConfirm ? "circle" : "square") : "circle");
    else if (c.setEnd) c.handleKey("circle");  // every window of the set-award chain, not only its first (CARD-DUEL-VERIFIED.md 31)
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}));

if (errors.length) console.log("PAGEERRORS:", errors.slice(0, 3));
const fail = [];
const check = (ok, m) => { if (ok) console.log("  ok:", m); else fail.push(m); };

check(r.reached, "the duel reaches the play negotiation");
const p = r.progress;
check(p.length > 0 && p[0] < 0x1000, `the box starts part-open, not full (${p[0]})`);
check(p.some((v) => v > 0 && v < 0x1000), "it passes through intermediate widths");
check(p.includes(0x1000) || p[p.length - 1] === 0x1000,
      `it reaches full width 0x1000 (last ${p[p.length - 1]})`);
const rising = p.every((v, i) => i === 0 || v >= p[i - 1] || v === 0x1000);
check(rising, "and it only ever opens wider, never jumps back");
const toFull = p.findIndex((v) => v === 0x1000);
check(toFull >= 0 && toFull <= 13, `full width inside the decoded 12 frames (${toFull})`);

console.log(fail.length ? "\nFAILED:\n  " + fail.join("\n  ") : "\nALL CHECKS PASSED");
await browser.close();
process.exit(fail.length ? 1 : 0);
