// tools/verify_title_attract_loop.mjs - the title's attract movie ends by itself.
//
// Decoded from pro/stdwtitl (docs/research/ui/stdwtitl-title-menu-2026-08-14.md,
// docs/research/overlays/stdwtitl.md, ledger UI-TITLE-ATTRACT-LOOP-2026-08-14):
//   * 600 idle fields at the "Press Start Button" line put +0x54 over the
//     threshold (stdwtitl.s:2717-2727) and the menu's choice dispatcher launches
//     MOVIEOPN, code 0xE02, on every build and MOVIEOP2, 0xE01, on the Japanese
//     one (stdwtitl.s F0x80086834 case 3).
//   * The movie object ends on the stream's last picture (stdwtitl.s:610-618
//     raising the end flag, tested at :933-949) or on START (:938-942).
//   * The movie screen then launches the movie row's destination word with
//     argument 0 (stdwtitl.s:1172-1190). Both opening rows carry 0x0E00, the
//     title screen, so the loop returns to the title.
//
// Before 2026-10-04 the movie's end was whatever the browser's `ended` event
// said, and the original-code title route never asked for a movie at all: the
// native adapter dropped the transition the screen had written, so the shell
// requested movie 0 and the player logged "Unknown title movie launch code 0".
//
// This walks the player's route with no key press at all: prompt -> 600 idle
// fields -> the movie -> its last picture -> the title's prompt again -> the
// next idle opens the next movie. The movie ends at picture 1776 (118.4 s), so this takes
// about three minutes of wall clock; that is the point of the check.
//
// Server: python3 -m http.server 8921 --directory web
// Run:    VERIFY_PORT=8921 tools/run-playwright.sh tools/verify_title_attract_loop.mjs
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const OUT = process.env.ATTRACT_SHOT || ".bunny-scratch/attract-loop";
mkdirSync(OUT, { recursive: true });
const MOVIE_TIMEOUT = Number(process.env.ATTRACT_TIMEOUT ?? 200000);

const failures = [];
const check = (ok, m) => { if (!ok) failures.push(m); else console.log("  ok:", m); };
const evidence = [];

const browser = await chromium.launch();

/** The player waits for the prompt, lets the title time out, then watches the
 *  movie run to its last picture without touching a key. */
async function attractLoop(label, query, expectCode) {
  const page = await browser.newPage({ viewport: { width: 960, height: 720 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(`${label}: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error") errors.push(`${label}: ${m.text()}`); });
  await page.addInitScript(() => localStorage.setItem("assetMode", "authentic"));
  try {
    await page.goto(`${baseUrl(8921)}/index.html?${query}`, { waitUntil: "load" });
    await page.waitForFunction(() => window.__titleMovie !== undefined, null, { timeout: 30000 });
    // The idle timeout can only fire from the prompt, so the movie opening is
    // itself the proof that the title got there. Remember the screen: the shell
    // must install a FRESH one after the movie, as the disc launches a new
    // title screen rather than resuming the old one.
    await page.evaluate(() => { window.__titleProbe = window.__titleState(); });

    const opened = await page.waitForFunction(
      () => (window.__titleMovie?.().open === true ? window.__titleMovie() : false),
      null, { timeout: 45000 }).then((h) => h.jsonValue()).catch(() => null);
    check(opened?.code === expectCode,
      `${label}: 600 idle fields launched movie 0x${expectCode.toString(16)} ` +
      `(got ${JSON.stringify(opened && { code: opened.code, file: opened.file })})`);

    // No key press from here to the end of the movie.
    const started = Date.now();
    await page.waitForFunction(() => window.__titleMovie().pictures > 5, null, { timeout: 45000 });
    await page.screenshot({ path: `${OUT}/${label}-1-movie.png` });
    const playing = await page.evaluate(() => window.__titleMovie());
    check(playing.blocked === false && playing.pictures > 5,
      `${label}: the movie is running on its own (${playing.pictures} pictures, ${playing.currentTime.toFixed(1)}s)`);
    const launch = await page.evaluate(() => window.__titleState?.().launchCode?.() ?? null);
    check(launch === expectCode,
      `${label}: the screen reports the launch code the disc wrote ` +
      `(${launch === null ? "n/a" : "0x" + launch.toString(16)})`);

    const closed = await page.waitForFunction(
      () => (window.__titleMovie().open === false ? window.__titleMovie() : false),
      null, { timeout: MOVIE_TIMEOUT }).then((h) => h.jsonValue()).catch(() => null);
    const seconds = (Date.now() - started) / 1000;
    check(closed !== null, `${label}: the movie ended by itself after ${seconds.toFixed(1)}s of wall clock`);
    if (closed) {
      check(closed.endedBy === "last-picture" || closed.endedBy === "ended",
        `${label}: it ended on the stream's last picture (endedBy ${closed.endedBy}, ` +
        `${closed.pictures}/${closed.frames} pictures)`);
      check(closed.destination === "0xe00",
        `${label}: the disc's movie row sends the player to 0x0E00, the title (${closed.destination})`);
      check(Math.abs(closed.pictures - closed.frames) <= 1,
        `${label}: it stopped on the last picture, not early (${closed.pictures} of ${closed.frames})`);
      evidence.push({ label, seconds, ...closed });
    }

    // The disc launches a new title screen, so the shell installs a fresh one and
    // then drives it: the fresh title slides in and reaches its prompt on its
    // own, with no key pressed.
    const fresh = await page.waitForFunction(
      () => window.__titleState?.() !== window.__titleProbe,
      null, { timeout: 15000 }).then(() => true).catch(() => false);
    check(fresh, `${label}: the shell installed a fresh title screen after the movie`);
    if (label === "native") {
      // The original-code screen has no phase(); it is checked open and waiting
      // right away, because its own 600-field timeout would start the next
      // movie while this check was still looking at it.
      const diag = await page.evaluate(() => window.__titleState?.().diagnostics?.() ?? null);
      check(diag?.open === true && diag?.done === false,
        `${label}: the fresh original-code screen is open and waiting (${JSON.stringify(diag?.open)})`);
    } else {
      const prompted = await page.waitForFunction(
        () => window.__titleState?.().phase?.() === "prompt",
        null, { timeout: 20000 }).then(() => true).catch(() => false);
      const back = await page.evaluate(() => window.__titleState?.().phase?.() ?? null);
      check(prompted,
        `${label}: the title's prompt is back with no key pressed (phase ${back})`);
    }
    await page.screenshot({ path: `${OUT}/${label}-2-title-back.png` });

    // And the loop loops: the next 600 idle fields open the next movie.
    const again = await page.waitForFunction(
      () => (window.__titleMovie?.().open === true ? window.__titleMovie() : false),
      null, { timeout: 45000 }).then((h) => h.jsonValue()).catch(() => null);
    check(again !== null, `${label}: the idle timeout opens the attract movie again`);
    check(errors.length === 0, `${label}: no page error (${errors.slice(0, 2).join(" | ")})`);
  } finally {
    await page.close();
  }
}

try {
  // The player's own route: the translated title.
  await attractLoop("translated", "skipLanguage=1&noEncounters=1", 0xe02);
  // The original-code title route (?nativeTitle=1). Its attract arm used to ask
  // for movie 0, which is not a movie at all.
  await attractLoop("native", "skipLanguage=1&noEncounters=1&nativeTitle=1", 0xe02);
  writeFileSync(`${OUT}/proof.json`, JSON.stringify({ evidence, failures }, null, 2) + "\n");
} catch (e) {
  failures.push(`check threw: ${e.message}`);
} finally {
  await browser.close();
}

if (failures.length) {
  console.error("\nFAILED:");
  for (const m of failures) console.error(" -", m);
  process.exit(1);
}
console.log("\nOK: the attract movie plays out by itself and the title comes back");