// Japanese title lab entry through the real game renderer, with executable
// resources denied. Serve web/ on port 8742; run through run-playwright.sh.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import { baseUrl } from "./verify-base-url.mjs";

const out = process.argv[2] ?? "captures/step-h-title-menu-2026-10-01/japanese";
const oldArt = process.argv.includes("--old-art");
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [], blocked = [], requests = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("request", (request) => requests.push(request.url()));
await page.route("**/assets/native/**", (route) => {
    blocked.push(route.request().url());
    return route.abort();
});
if (oldArt) {
    await page.route("**/assets/ui/tlogojpn_sheet.png", (route) =>
        route.fulfill({ path: "web/assets/ui/tlogopal_sheet.png" }));
    await page.route("**/assets/ui/tlogojpn_sheet.json", (route) =>
        route.fulfill({ path: "web/assets/ui/tlogopal_sheet.json" }));
}
await page.addInitScript(() => localStorage.setItem("assetMode", "authentic"));
try {
    await page.goto(`${baseUrl(8742)}/index.html?skipLanguage=1&noEncounters=1`);
    await page.waitForFunction(() => window.__titleState?.().phase?.() === "prompt",
        null, { timeout: 30000 });
    await page.keyboard.press("i", { delay: 80 });
    await page.waitForFunction(() => window.__titleState?.().phase?.() === "menu",
        null, { timeout: 10000 });
    await page.keyboard.press("ArrowUp", { delay: 80 });
    await page.keyboard.press("Enter", { delay: 80 });
    await page.waitForFunction(() => window.__state?.started === true,
        null, { timeout: 30000 });
    await page.evaluate(() => {
        window.__state.languageByte = 0;
        window.__labOpen("titlescreen");
    });
    await page.waitForFunction(() => window.__labTitle?.phase?.() === "prompt",
        null, { timeout: 30000 });
    const state = await page.evaluate(() => ({
        language: window.__state.languageByte,
        japanese: window.__labTitle.isJapanese(),
        logo: window.__labTitle.logoAt(),
        wordmark: window.__labTitle.wordmarkAt(),
        numeral: window.__labTitle.numeralAt(),
        glow: window.__labTitle.glowLevel(),
        numeralVisible: window.__labTitle.showNumeral(),
    }));
    assert.deepEqual(state, {
        language: 0, japanese: true, logo: [17, 61], wordmark: [207, 34],
        numeral: [49, 121], glow: 11, numeralVisible: true,
    });
    await page.screenshot({ path: `${out}/01-title-prompt.png` });
    await page.evaluate(() => window.__labTitle.start());
    await page.waitForFunction(() => window.__labTitle?.phase?.() === "menu",
        null, { timeout: 10000 });
    assert.equal(await page.evaluate(() => window.__labTitle.highlight()), 1);
    await page.screenshot({ path: `${out}/02-start-continue.png` });
    assert.ok(requests.some((url) => url.endsWith("/assets/ui/tlogojpn_sheet.png")));
    assert.ok(requests.some((url) => url.endsWith("/assets/ui/tlogojpn_sheet.json")));
    assert.deepEqual(blocked, []);
    assert.deepEqual(errors, []);
    const proof = { state, art: oldArt ? "PAL sheet substituted for before capture" : "extracted Japanese sheet",
        japaneseArtRequests: requests.filter((url) => url.includes("tlogojpn_sheet")),
        blocked, errors, menu: "Continue selected" };
    writeFileSync(`${out}/proof.json`, JSON.stringify(proof, null, 2) + "\n");
    console.log(`PASS Japanese title lab layout and menu with executable assets denied; ${out}/proof.json`);
} finally {
    await browser.close();
}
