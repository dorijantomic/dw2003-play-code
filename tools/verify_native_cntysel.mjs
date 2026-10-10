// Focused production-route verifier for translated country/language select.
// Historical filename retained. The execution provider is asserted below.
// Former native country/language select
// screen (Phase 6.3 group 3 of
// docs/plans/2026-09-21-native-screen-production-integration-plan.md).
//
// Runs the real web/game.js and opens the screen through the lab entry point that
// game.js itself uses (`__labOpen("cntysel")`), which now drives the shipped
// pro/cnty_sel overlay:
//   list up -> Down Down (row 2) -> confirm -> the language byte is committed to
//   0x8005CCA8 and the screen retires.
// The overlay's confirm is pad bit 3 (its own mapping of the identity
// logical-button table), which is the walker's START key (`i`).
//
//   tools/run-playwright.sh tools/verify_native_cntysel.mjs [outdir]
//
// Setup: `python3 -m http.server 8742 --directory web`.

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const ROOT = `${baseUrl(8742)}`;
const OUT = process.argv[2] ?? "/tmp/opencode/native-cntysel-verify";
mkdirSync(OUT, { recursive: true });

let failures = 0;
const check = (name, ok, detail = "") => {
    console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
    if (!ok) failures++;
};

const browser = await chromium.launch();

const read = (page) => page.evaluate(() => {
    const d = window.__labCntyselNative?.diagnostics?.() ?? null;
    return {
        open: window.__labCntyselNative?.isOpen?.() ?? false,
        diag: d,
        row: d?.row ?? null,
        language: d?.language ?? null,
        labLanguage: window.__labLanguage ?? null,
        labByte: window.__labLanguageByte ?? null,
    };
});

async function press(page, key, ms = 220) {
    await page.keyboard.down(key);
    await page.waitForTimeout(ms);
    await page.keyboard.up(key);
    await page.waitForTimeout(260);
}

// ── before: the hand-authored screen under the rollback switch ──────────────
{
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.addInitScript(() => localStorage.setItem("assetMode", "authentic"));
    await page.goto(`${ROOT}/index.html?skipTitle=1&noEncounters=1&legacyCntysel=1`, { waitUntil: "load", timeout: 60000 });
    await page.waitForFunction(() => !!window.__labOpen && window.__state?.started, { timeout: 60000 });
    await page.evaluate(() => window.__labOpen("cntysel"));
    await page.waitForTimeout(1500);
    const native = await page.evaluate(() => !!window.__labCntyselNative);
    check("legacy rollback keeps the walker's screen", native === false);
    await page.screenshot({ path: `${OUT}/before-legacy-language.png` });
    console.log("[verify] legacy language screen captured");
    await page.close();
}

// ── after: the shipped pro/cnty_sel overlay through the real game ───────────
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.addInitScript(() => localStorage.setItem("assetMode", "authentic"));
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => {
    if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`);
});

await page.goto(`${ROOT}/index.html?skipTitle=1&noEncounters=1`, { waitUntil: "load", timeout: 60000 });
await page.waitForFunction(() => !!window.__labOpen && window.__state?.started, { timeout: 60000 });
await page.evaluate(() => window.__labOpen("cntysel"));
await page.waitForTimeout(2500);

let s = await read(page);
check("the lab entry opens the native language screen", s.open === true);
check("the language screen uses translated code", s.diag?.host?.module === "pro/cnty_sel" && s.diag?.host?.execution === "translated",
    `module=${s.diag?.host?.module ?? "none"} execution=${s.diag?.host?.execution}`);
check("no traps on entry", (s.diag?.traps ?? -1) === 0, `traps=${s.diag?.traps}`);
await page.screenshot({ path: `${OUT}/01-language-list.png` });

// Down moves the list (pad bit 0x40); the row is the screen's own obj+0x50.
await press(page, "ArrowDown");
await press(page, "ArrowDown");
s = await read(page);
check("Down moves the screen's own list", s.row === 2, `row=${s.row}`);
await page.screenshot({ path: `${OUT}/02-row2-highlight.png` });

// Confirm (pad bit 3 = START). The screen commits the language byte and retires.
await press(page, "i", 260);
await page.waitForTimeout(1500);
s = await read(page);
check("the screen closes after confirm", s.open === false, `open=${s.open} row=${s.row}`);
check("the committed language byte is the chosen row's", s.language === 5,
    `language=${s.language} (row 2 -> 5 measured)`);
check("the pick is handed to game.js", s.labLanguage === 2 || s.labByte === 5,
    `labLanguage=${s.labLanguage} labByte=${s.labByte}`);
check("no traps through the route", (s.diag?.traps ?? -1) === 0, `traps=${s.diag?.traps}`);
await page.screenshot({ path: `${OUT}/03-after-confirm.png` });

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
console.log(`[verify] ${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`} — captures in ${OUT}`);
await page.close();
await browser.close();
process.exit(failures === 0 ? 0 : 1);
