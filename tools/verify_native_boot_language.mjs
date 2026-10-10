// Focused proof that the country/language select screen is the game's BOOT
// screen, entered from ordinary play (no lab hook, no query switch).
//
// The original's boot main `f12` (called from `start.s`) calls `F0x80016a94`
// through `D0x8004b430`; that sets the current screen code to 0x1600, and `f15`
// resolves library 0x16 through the LBA table at `D0x80055ccc` — entry 0x16 is
// 0x165 (357) = `CNTY_SEL.PRO`. The developer stage-select table's row for the
// same code is くにせんたく (country selection). So `web/game.js` opens the
// shipped pro/cnty_sel overlay before the title; its confirm writes the language
// byte 0x8005CCA8 and hands 0xE01/0xE02 (the opening movies) to the launcher,
// which the walker continues into the title.
//
//   tools/run-playwright.sh tools/verify_native_boot_language.mjs [outdir]
//
// Setup: `python3 -m http.server 8742 --directory web`.

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const ROOT = `${baseUrl(8742)}`;
const OUT = process.argv[2] ?? "/tmp/opencode/native-boot-language";
mkdirSync(OUT, { recursive: true });

let failures = 0;
const check = (name, ok, detail = "") => {
    console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
    if (!ok) failures++;
};

const browser = await chromium.launch();

async function press(page, key, ms = 220) {
    await page.keyboard.down(key);
    await page.waitForTimeout(ms);
    await page.keyboard.up(key);
    await page.waitForTimeout(260);
}

// ── ordinary boot: the language screen is the first screen ──────────────────
{
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.addInitScript(() => localStorage.setItem("assetMode", "authentic"));
    const errors = [];
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => {
        if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`);
    });
    await page.goto(`${ROOT}/index.html?noEncounters=1`, { waitUntil: "load", timeout: 60000 });

    const opened = await page.waitForFunction(
        () => window.__cntyselNative?.active?.() === true,
        null, { timeout: 30000 },
    ).then(() => true).catch(() => false);
    check("ordinary play boots into the translated language screen", opened);

    let s = await page.evaluate(() => {
        const d = window.__cntyselNative?.diagnostics?.() ?? null;
        return {
            open: window.__cntyselNative?.isOpen?.() ?? false,
            started: window.__state?.started ?? null,
            module: d?.host?.module ?? null,
            execution: d?.host?.execution ?? null,
            traps: d?.traps ?? -1,
            titleHidden: document.getElementById("title-screen")?.hidden ?? null,
        };
    });
    check("the language screen uses translated code", s.module === "pro/cnty_sel" && s.execution === "translated",
        `module=${s.module} execution=${s.execution}`);
    check("the game has not started yet", s.started === false, `started=${s.started}`);
    check("no traps on the boot screen", s.traps === 0, `traps=${s.traps}`);
    await page.screenshot({ path: `${OUT}/01-boot-language.png` });

    // Let the overlay build its list and start sampling the pad before pressing.
    await page.waitForTimeout(1800);
    // Down Down -> row 2; confirm is the overlay's pad bit 3 = the walker's START.
    await press(page, "ArrowDown");
    await press(page, "ArrowDown");
    const row = await page.evaluate(() => window.__cntyselNative?.diagnostics?.()?.row ?? null);
    check("Down moves the screen's own list", row === 2, `row=${row}`);
    await page.screenshot({ path: `${OUT}/02-row2.png` });

    await press(page, "i", 260);
    const done = await page.waitForFunction(
        () => window.__cntyselNative?.isOpen?.() === false,
        null, { timeout: 15000 },
    ).then(() => true).catch(() => false);
    check("confirm closes the boot screen", done);

    const after = await page.evaluate(() => ({
        boot: window.__bootLanguage ?? null,
        titleHidden: document.getElementById("title-screen")?.hidden ?? null,
        started: window.__state?.started ?? null,
        traps: window.__cntyselNative?.diagnostics?.()?.traps ?? -1,
    }));
    check("the screen's own commit reached game.js",
        after.boot?.row === 2 && after.boot?.language === 5,
        `boot=${JSON.stringify(after.boot)}`);
    check("the title is what comes next", after.titleHidden === false && after.started === false,
        `titleHidden=${after.titleHidden} started=${after.started}`);
    check("no traps through the route", after.traps === 0, `traps=${after.traps}`);
    await page.screenshot({ path: `${OUT}/03-title-after-language.png` });
    check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
    await page.close();
}

// ── skipLanguage=1 goes straight to the title (the prerequisite later checks use)
{
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(`${ROOT}/index.html?noEncounters=1&skipLanguage=1`, { waitUntil: "load", timeout: 60000 });
    await page.waitForFunction(() => window.__state && window.__titleState, null, { timeout: 30000 });
    const st = await page.evaluate(() => ({
        open: window.__cntyselNative?.isOpen?.() ?? null,
        titleHidden: document.getElementById("title-screen")?.hidden ?? null,
    }));
    check("skipLanguage=1 skips the boot screen", st.open === false, `open=${st.open}`);
    check("skipLanguage=1 shows the title", st.titleHidden === false, `titleHidden=${st.titleHidden}`);
    await page.close();
}

// ── the rollback switch keeps the hand-authored screen at boot ─────────────
{
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(`${ROOT}/index.html?noEncounters=1&legacyCntysel=1`, { waitUntil: "load", timeout: 60000 });
    const opened = await page.waitForFunction(
        () => window.__cntyselMenu?.open === true,
        null, { timeout: 30000 },
    ).then(() => true).catch(() => false);
    const st = await page.evaluate(() => ({
        nativeOpen: window.__cntyselNative?.isOpen?.() ?? null,
        legacyOpen: window.__cntyselMenu?.open ?? null,
    }));
    check("legacyCntysel=1 boots the hand-authored screen instead", opened && st.legacyOpen === true,
        `legacyOpen=${st.legacyOpen}`);
    check("legacyCntysel=1 does not boot the native overlay", st.nativeOpen === false,
        `nativeOpen=${st.nativeOpen}`);
    await page.close();
}

console.log(`[verify] ${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`} — captures in ${OUT}`);
await browser.close();
process.exit(failures === 0 ? 0 : 1);
