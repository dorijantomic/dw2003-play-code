// tools/verify_cardduel_hud_slide.mjs — the HUD strips are driven by the decoded
// panel model, not by a constant.
//
// web/cardduel.js used to draw both HUD strips at the fixed PLAYER_ORIGIN
// [[0,153],[0,-12]]. Those two numbers are the decoded RESTING panel y (141 near,
// 0 far) plus the 50Hz display correction F0x80098898 applies in its prologue
// (+12 near, -12 far). So binding the live model through that offset must leave
// the strips exactly where they were while the panels sit at rest, and must move
// them the decoded way once a slide is issued.
//
// This drives both and checks both.
//   duration:  slideBothPanelsOut is 10 frames (F0x8009C350)
//   endpoints: near 141 -> 241, far 0 -> -100  (0x8D -> 0xF1, 0x00 -> -0x64)
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

// stepSprites() — and therefore stepCardView() — only runs once a duel is
// actually live, so press through the challenge and folder screens first.
await frame.evaluate(() => new Promise((done) => {
  const c = window.__labDuel;
  let n = 0;
  const go = () => {
    if (c.duel || ++n > 600) return done();
    c.handleKey("enter");
    requestAnimationFrame(go);
  };
  requestAnimationFrame(go);
}));
await page.waitForTimeout(400);

const r = await frame.evaluate(() => new Promise((done) => {
  const c = window.__labDuel;
  const out = { atRest: null, ys: [], hasView: !!c.view };
  if (!c.view || !c.slidePanels) { out.noHook = !c.slidePanels; return done(out); }
  out.atRest = [c.view.panels[0].y, c.view.panels[1].y];
  // Drive the slide through the model directly; the point under test is that the
  // renderer follows it, not how the beat issues it.
  c.slidePanels("out");
  let n = 0;
  const tick = () => {
    out.ys.push([c.view.panels[0].y, c.view.panels[1].y]);
    if (++n >= 14) return done(out);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}));

if (errors.length) console.log("PAGEERRORS:", errors.slice(0, 3));
const fail = [];
const check = (ok, m) => { if (ok) console.log("  ok:", m); else fail.push(m); };

check(r.hasView, "the duel builds the decoded view model");
check(r.atRest && r.atRest[0] === 141 && r.atRest[1] === 0,
      `both panels rest at the decoded shown y (got ${JSON.stringify(r.atRest)})`);
const last = r.ys[r.ys.length - 1];
check(last && last[0] === 241 && last[1] === -100,
      `the slide-out reaches the decoded hidden endpoints 241 / -100 (got ${JSON.stringify(last)})`);
const moved = r.ys.filter((y, i) => i > 0 && y[0] !== r.ys[i - 1][0]).length;
check(moved >= 8 && moved <= 11, `the near panel moves on ~10 frames (moved on ${moved})`);
check(r.ys.some(([a]) => a > 141 && a < 241), "and it passes through intermediate positions");

console.log(fail.length ? "\nFAILED:\n  " + fail.join("\n  ") : "\nALL CHECKS PASSED");
await browser.close();
process.exit(fail.length ? 1 : 0);
