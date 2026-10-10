// The real browser boot/lab language screen with executable resources denied,
// including the opening-movie handoff the language pick performs before the
// title appears. Serve web/ on 8742 (or set VERIFY_PORT); run via tools/run-playwright.sh.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import { baseUrl } from "./verify-base-url.mjs";

const out = process.argv[2] ?? ".dw3-research/translation-audit-2026-09-28/language-no-executables";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [], blocked = [], requests = [];
page.on("pageerror", error => errors.push(error.message));
page.on("request", request => requests.push(request.url()));
await page.addInitScript(() => localStorage.setItem("assetMode", "authentic"));
const denyExecutableResources = route => {
    blocked.push(route.request().url());
    return route.abort();
};
await page.route("**/assets/native/**", denyExecutableResources);
try {
    await page.goto(`${baseUrl(8742)}/index.html?noEncounters=1`);
    await page.waitForFunction(() => window.__cntyselNative?.active?.() &&
        window.__cntyselNative.diagnostics().host.state.state1 === 7, null, { timeout: 30000 });
    const read = () => page.evaluate(() => window.__cntyselNative.diagnostics());
    const entry = await read();
    assert.equal(entry.host.execution, "translated");
    assert.equal(await page.evaluate(() => window.__bgm.current), "bgm031");
    assert.equal(blocked.length, 0, "language and title need no executable preload");
    assert.ok(requests.some(url => url.endsWith("/assets/data/country_screen.json")));
    await page.screenshot({ path: `${out}/01-language.png` });
    // A held key exercises the shared repeat provider through actual game input.
    await page.keyboard.down("ArrowDown");
    await page.waitForFunction(() => window.__cntyselNative.diagnostics().row === 4);
    await page.keyboard.up("ArrowDown");
    await page.waitForTimeout(100);
    await page.keyboard.press("ArrowUp", { delay: 80 });
    await page.waitForFunction(() => window.__cntyselNative.diagnostics().row === 3);
    await page.screenshot({ path: `${out}/02-italian.png` });
    await page.keyboard.press("i", { delay: 80 });
    await page.waitForFunction(() => window.__cntyselNative.diagnostics().fade >= 100);
    await page.screenshot({ path: `${out}/03-fade.png` });
    await page.waitForFunction(() => !window.__cntyselNative.isOpen());
    const result = await page.evaluate(() => window.__bootLanguage);
    assert.deepEqual(result, { row: 3, language: 4 });
    assert.equal((await read()).host.objects, 0, "completed screen releases its task tree");
    assert.equal(errors.length, 0, errors.join("\n"));
    // The pick hands the launcher 0xE01/0xE02 — the opening movie — and the
    // movie returns to the title screen (docs/research/ui/cnty_sel-full-decode-
    // 2026-08-05.md "Confirm"; docs/research/ui/stdwtitl-title-menu-2026-08-14.md
    // "launch code"). The title session is only ticked while no movie is open,
    // so the prompt cannot arrive until the ~119 s stream is over; Start is the
    // player's own skip (web/game.js:2133), the same press the title movies
    // verifier uses.
    await page.waitForFunction(() => window.__titleMovie?.().open, null, { timeout: 30000 });
    const movie = await page.evaluate(() => window.__titleMovie());
    assert.equal(movie.code, 0xe02, "language byte 4 is not Japanese, so the second opening movie");
    assert.equal(movie.blocked, false, "the opening movie autoplayed");
    await page.waitForFunction(() => window.__titleMovie?.().currentTime > 0.5, null,
        { timeout: 15000 });
    await page.screenshot({ path: `${out}/04-opening-movie.png` });
    await page.keyboard.press("i", { delay: 80 });
    await page.waitForFunction(() => !window.__titleMovie?.().open, null, { timeout: 15000 });
    await page.waitForFunction(() => window.__titleState?.().phase?.() === "prompt",
        null, { timeout: 30000 });
    assert.equal(await page.evaluate(() => window.__titleState().result()), 0);
    assert.deepEqual(await page.evaluate(() => window.__titleState().clips()), [11, 12, 13]);
    assert.equal(await page.evaluate(() => window.__bgm.current), "ttlbgm");
    await page.screenshot({ path: `${out}/05-title.png` });
    // Reuse the real lab entry: opening and cancelling must not deliver a pick.
    await page.evaluate(() => { window.__labLanguageByte = -1; window.__labOpen("cntysel"); });
    await page.waitForFunction(() => window.__labCntyselNative?.active?.());
    await page.evaluate(() => window.__labClose());
    assert.equal(await page.evaluate(() => window.__labLanguageByte), -1);
    assert.equal(errors.length, 0, errors.join("\n"));
    const proof = { entry, result, movie, blocked, requests, errors, cancellation: "no callback", execution: "translated" };
    writeFileSync(`${out}/proof.json`, JSON.stringify(proof, null, 2) + "\n");
    console.log("PASS language opening, held input, selection, fade, opening-movie handoff and translated title handoff with executable resources denied; lab cancellation");
    console.log(`Proof: ${out}/proof.json`);
} finally {
    await browser.close();
}
