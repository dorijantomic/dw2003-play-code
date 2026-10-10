// Two opening movies on the ordinary translated boot/title route.
// Serve web/ on port 8742; run through tools/run-playwright.sh.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import { baseUrl } from "./verify-base-url.mjs";

const out = process.argv[2] ?? "captures/step-h-title-movies-2026-10-01";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const errors = [], executable = [];
const results = [];

// The PAL language screen cannot select JPN by pad (its side pane is never
// opened), so the Japanese journey skips it with a debug language byte and
// waits for the title's idle timeout instead.
async function journey(language, expectedCode, nextCode, label) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", (error) => errors.push(`${label}: ${error.message}`));
  await page.route("**/assets/native/**", (route) => {
    executable.push(route.request().url());
    return route.abort();
  });
  await page.addInitScript(() => localStorage.setItem("assetMode", "authentic"));
  try {
    if (language === 0) {
      await page.goto(`${baseUrl(8742)}/index.html?skipLanguage=1&language=0&noEncounters=1`);
      await page.waitForFunction(() => window.__titleState?.().phase?.() === "prompt",
        null, { timeout: 30000 });
    } else {
      await page.goto(`${baseUrl(8742)}/index.html?noEncounters=1`);
      await page.waitForFunction(() => window.__cntyselNative?.active?.() &&
        window.__cntyselNative.diagnostics().host.state.state1 === 7,
      null, { timeout: 30000 });
      assert.equal(await page.evaluate(() => window.__cntyselNative.diagnostics().row), 0);
      await page.keyboard.press("i", { delay: 80 });
    }
    await page.waitForFunction(() => window.__titleMovie?.().open, null, { timeout: 30000 });
    await page.waitForFunction(() => window.__titleMovie?.().currentTime > 0.5,
      null, { timeout: 15000 });
    const movie = await page.evaluate(() => window.__titleMovie());
    const boot = await page.evaluate(() => ({ choice: window.__bootLanguage,
      languageByte: window.__state?.languageByte }));
    assert.equal(movie.code, expectedCode, JSON.stringify({ movie, boot }));
    assert.equal(movie.width, 320);
    assert.equal(movie.height, 416);
    assert.equal(movie.blocked, false);
    assert.ok(movie.duration > 119 && movie.duration < 120);
    await page.screenshot({ path: `${out}/${label}-movie.png` });
    await page.keyboard.press("i", { delay: 80 });
    await page.waitForFunction(() => !window.__titleMovie?.().open &&
      window.__titleState?.().phase?.() === "prompt", null, { timeout: 15000 });
    await page.screenshot({ path: `${out}/${label}-returned-title.png` });
    // Let the prompt time out once: Japanese changes movie, international repeats it.
    await page.waitForFunction(() => window.__titleMovie?.().open, null, { timeout: 30000 });
    const loop = await page.evaluate(() => window.__titleMovie());
    assert.equal(loop.code, nextCode);
    await page.keyboard.press("i", { delay: 80 });
    results.push({ label, movie, loopCode: loop.code });
  } finally {
    await page.close();
  }
}

try {
  await journey(0, 0xe01, 0xe02, "japanese");
  await journey(2, 0xe02, 0xe02, "english");
  assert.deepEqual(executable, []);
  assert.deepEqual(errors, []);
  writeFileSync(`${out}/proof.json`, JSON.stringify({ results, executable, errors }, null, 2) + "\n");
  console.log("PASS both opening movies play, Start skips to the title, and idle selects the next movie");
} finally {
  await browser.close();
}
