// Ordinary title route with executable assets forbidden: prompt, Start, and
// Continue-without-a-save return. Serve web/ on port 8742 (VERIFY_PORT wins).
// The return leg is the memory card: Continue launches the card in LOAD mode,
// and leaving it with nothing loaded answers with the card's own exit selector
// 0xE00 — the TITLE SCREEN (pro/stgmcard.s 0x4dc4-0x4e2c -> engine/dw3/ui/
// memcard-root.ts state 3). It does not start a game, so the title comes back.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import { baseUrl } from "./verify-base-url.mjs";
import { leaveCard } from "./memcard-continue.mjs";

const out = process.argv[2] ?? ".dw3-research/part-d-2026-09-28/translated-title";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [], executableRequests = [];
page.on("pageerror", (error) => errors.push(error.message));
await page.route("**/assets/native/**", (route) => {
    executableRequests.push(route.request().url());
    return route.abort();
});
await page.addInitScript(() => {
    localStorage.setItem("assetMode", "authentic");
    localStorage.removeItem("saveSlots");
});
const press = async (key) => {
    await page.keyboard.press(key, { delay: 80 });
    await page.waitForTimeout(100);
};
const phase = () => page.evaluate(() => window.__titleState?.().phase?.());
const waitPhase = (name) => page.waitForFunction((want) => window.__titleState?.().phase?.() === want,
    name, { timeout: 10000 });
try {
    await page.goto(`${baseUrl(8742)}/index.html?skipLanguage=1&noEncounters=1`);
    await waitPhase("prompt");
    await page.waitForFunction(() => (window.__titleState?.().twinkles?.().length ?? 0) > 0,
        null, { timeout: 8000 });
    const twinkleSample = await page.evaluate(() => window.__titleState().twinkles());
    assert.ok(twinkleSample.every((sprite) => [0x08870003, 0x08870008].includes(sprite.pack)));
    await page.screenshot({ path: `${out}/01-press-start.png` });
    assert.equal(executableRequests.length, 0, "title requested an executable asset");
    await press("Enter");
    assert.equal(await phase(), "prompt", "Circle must wait at the Start prompt");
    await press("i");
    await waitPhase("menu");
    assert.equal(await page.evaluate(() => window.__titleState().highlight()), 1);
    await page.screenshot({ path: `${out}/02-start-continue.png` });
    await press("ArrowUp");
    assert.equal(await page.evaluate(() => window.__titleState().highlight()), 0);
    await press("Enter");
    await page.waitForFunction(() => window.__state?.started === true, null, { timeout: 30000 });
    const started = await page.evaluate(() => ({
        started: window.__state.started, titleHidden: document.getElementById("title-screen")?.hidden,
        map: window.__state.manifest?.maps?.[window.__state.mapIdx]?.id ?? null,
    }));
    assert.equal(started.titleHidden, true);
    assert.equal(executableRequests.length, 0, "Start route requested an executable asset");
    await page.screenshot({ path: `${out}/03-field.png` });

    // A fresh unsaved browser choice must return to a usable title prompt.
    await page.goto(`${baseUrl(8742)}/index.html?skipLanguage=1&noEncounters=1`);
    await waitPhase("prompt");
    await press("i");
    await waitPhase("menu");
    await press("Enter");
    // The title fades out before the card opens (web/game.js closeTitle).
    await page.waitForFunction(() => window.__saveNative?.isOpen?.(), null, { timeout: 20000 });
    assert.equal(await page.evaluate(() => window.__saveNative.diagnostics().mode), "load",
        "Continue did not open the memory card in LOAD mode");
    // The empty card answers "No data here."; the player backs out of it, and the
    // title the card names (0xE00) is what comes back.
    await leaveCard(page);
    await page.waitForFunction(() => window.__titleState?.().phase?.() === "prompt", null,
        { timeout: 15000 });
    assert.equal(await page.evaluate(() => window.__state?.started ?? false), false,
        "backing out of the card started a game");
    assert.equal(await page.evaluate(() => window.__memcardExitScreen), 0xe00,
        "the card's exit selector was not 0xE00, the title screen");
    assert.equal(executableRequests.length, 0, "Continue return requested an executable asset");
    assert.deepEqual(errors, []);
    const proof = { execution: "translated", started, twinkleSample, executableRequests, errors,
        continueWithoutSave: "returned to prompt" };
    writeFileSync(`${out}/proof.json`, JSON.stringify(proof, null, 2) + "\n");
    console.log(`PASS translated title: Start reaches field, Continue without a save returns; ${out}/proof.json`);
} finally {
    await browser.close();
}
