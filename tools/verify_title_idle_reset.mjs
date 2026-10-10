// tools/verify_title_idle_reset.mjs - the title screen comes back after idle.
//
// Decoded 2026-08-14 (UI-TITLE-ATTRACT-LOOP-2026-08-14): leaving the title alone
// for 600 ticks launches an opening movie, which itself hands back to the title
// screen - an attract loop. The walker ships no FMV, so it closes the loop
// directly, but the shell must keep DRIVING the fresh screen it installs.
//
// Before 2026-09-14 the shell did not: web/game.js `titleFrame` returned at its
// own `ts.isDone()` branch before its `requestAnimationFrame(titleFrame)` line,
// so `commitTitle(RESULT_IDLE)` installed a fresh createTitleScreen() that was
// never ticked. The title froze on the last drawn vignette with no input able to
// advance it. The fix reschedules unless the title is actually closing.
//
// This drives the real page (web/index.html) and reads the live state machine
// through window.__titleState(); it does not wait ~11 seconds of wall clock.
//
// Server: python3 -m http.server 8741 --directory web
// Run:    .opencode/autonomy/check-browser tools/verify_title_idle_reset.mjs
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const ROOT = process.env.TITLE_ROOT || `${baseUrl(8742)}/?skipLanguage=1`;
const OUT = process.env.TITLE_SHOT || ".dw3-research/autonomous-plan/shots/title-idle-reset";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 960, height: 720 } });
const errors = [];
page.on("pageerror", (e) => { errors.push(e.message); console.error("PAGEERROR", e.message); });
const shot = async (name) => { writeFileSync(`${OUT}/${name}.png`, await page.screenshot()); console.log("shot", name); };

const failures = [];
const check = (ok, m) => { if (!ok) failures.push(m); else console.log("  ok:", m); };

try {
  await page.goto(ROOT, { waitUntil: "load" });
  await page.waitForFunction(
    () => window.__titleState?.() && document.getElementById("title-screen"),
    null, { timeout: 20000 });
  // The idle clock only counts from the prompt, after the opening reveal.
  await page.waitForFunction(() => window.__titleState().phase() === "prompt", null, { timeout: 20000 });
  check(true, "the title reached its prompt");
  await shot("before-idle");

  const forced = await page.evaluate(() => {
    const t = window.__titleState();
    window.__titleProbe = t;
    const before = { phase: t.phase() };
    // Accelerated idle: run the state machine past the decoded 600-tick timeout
    // (web/titlescreen.js IDLE_TIMEOUT) and the 30-frame vignette. The title is
    // driven by REAL seconds (TitleSession.tick), so one PAL field is 1/50s.
    for (let i = 0; i < 700; i++) t.tick(1 / 50);
    return { before, after: { phase: t.phase(), done: t.isDone(), result: t.result() } };
  });
  console.log("  forced idle:", JSON.stringify(forced));
  check(forced.after.done === true && forced.after.result === 3,
    `the idle timeout fired and completed its fade (phase ${forced.after.phase}, result ${forced.after.result})`);

  // The shell's next frame runs commitTitle, and RESULT_IDLE now hands the
  // launch code to the opening movie (web/game.js commitTitle -> startMovie),
  // not straight to a fresh screen. So the attract loop is: idle -> movie ->
  // a press skips it -> the shell installs a fresh title screen. This check
  // waited for the fresh screen straight away, which the movie route made
  // impossible: verified 2026-10-03 to fail identically with the title ticked
  // one field per browser frame, i.e. before the real-time fix.
  let opened = true;
  await page.waitForFunction(() => window.__titleMovie?.().open === true, null, { timeout: 5000 })
    .catch(() => { opened = false; });
  const attract = await page.evaluate(() => window.__titleMovie?.() ?? null);
  check(opened && attract?.code === 0xe02,
    `the idle timeout played the international opening movie (${JSON.stringify(attract)})`);
  await page.keyboard.press("i"); // START skips the movie and installs a fresh screen
  await page.waitForFunction(() => window.__titleState() !== window.__titleProbe,
    null, { timeout: 5000 });
  check(true, "the shell installed a fresh title screen after the attract movie");

  // The fresh screen must be DRIVEN back to its prompt. With the old code it
  // stayed frozen in its first "slide" frame and this times out.
  let reached = true;
  await page.waitForFunction(() => window.__titleState().phase() === "prompt", null, { timeout: 8000 })
    .catch(() => { reached = false; });
  const after = await page.evaluate(() => {
    const t = window.__titleState();
    return { phase: t.phase(), highlight: t.highlight(), result: t.result() };
  });
  console.log("  after reset:", JSON.stringify(after));
  check(reached && after.phase === "prompt",
    `the fresh title screen reaches its prompt again (phase ${after.phase})`);
  await shot("after-idle");

  // The restored prompt still takes the real Start button.
  await page.keyboard.press("i");
  let raised = true;
  await page.waitForFunction(() => window.__titleState().phase() === "menu", null, { timeout: 4000 })
    .catch(() => { raised = false; });
  const menu = await page.evaluate(() => {
    const t = window.__titleState();
    return { phase: t.phase(), highlight: t.highlight() };
  });
  check(raised && menu.highlight !== 2,
    `the restored prompt answers input (phase ${menu.phase}, highlight ${menu.highlight})`);

  if (errors.length) check(false, `${errors.length} page error(s)`);
} catch (e) {
  check(false, `check threw: ${e.message}`);
} finally {
  await browser.close();
}

if (failures.length) {
  console.error("\nFAILED:");
  for (const m of failures) console.error(" -", m);
  process.exit(1);
}
console.log("\nOK: the title returns to its prompt after the idle timeout");
