// Focused production-route verifier for the native post-fight results screen
// (pro/stfgtrep, Phase 6.3 of
// docs/plans/2026-09-21-native-screen-production-integration-plan.md).
//
// Runs the real web/game.js, opens the report through the lab entry point, and
// drives the shipped pro/stfgtrep overlay with real key events. It asserts:
//   * the native overlay booted (module pro/stfgtrep), 0 traps;
//   * the reward table record the battle id selects is paid into the walker's
//     money on close (battle 5 = [27,268,645] -> +645 BIT);
//   * the state round-trips to localStorage and a reload sees it.
//
//   tools/run-playwright.sh tools/verify_native_report.mjs [outdir]
//
// Setup: `python3 -m http.server 8742 --directory web`.

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const URL = `${baseUrl(8742)}/index.html?skipTitle=1&noEncounters=1&nativeReport=1`;
const OUT = process.argv[2] ?? "/tmp/opencode/native-report-verify";
mkdirSync(OUT, { recursive: true });

let failures = 0;
const check = (name, ok, detail = "") => {
    console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
    if (!ok) failures++;
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });

async function state() {
    return page.evaluate(() => ({
        bits: window.__state.bits,
        inv: window.__state.inventory,
        open: window.__reportNative?.isOpen() ?? null,
        diag: window.__reportNative?.diagnostics?.() ?? null,
    }));
}

await page.goto(URL, { waitUntil: "load", timeout: 30000 });
await page.waitForFunction(() => window.__state?.started && typeof window.__labOpen === "function",
    { timeout: 30000 });
console.log("[verify] game booted");

const before = await state();
console.log("[verify] bits before:", before.bits);

// Open the report through the lab entry (battle 5 -> +645 BIT).
await page.evaluate(() => window.__labOpen("fightreport", 5));
// Let the overlay preload + boot.
await page.waitForFunction(() => {
    const d = window.__reportNative?.diagnostics?.();
    return d?.host?.module === "pro/stfgtrep" || (d && !d.pending && d.host);
}, { timeout: 20000 }).catch(() => {});
await page.waitForTimeout(1500);

let s = await state();
console.log("[verify] after open:", JSON.stringify(s.diag));
check("report opens through game.js", s.open === true, `open=${s.open}`);
check("native root booted", s.diag?.host?.module === "pro/stfgtrep", `module=${s.diag?.host?.module}`);
check("no traps on entry", (s.diag?.host?.traps ?? 0) === 0, `traps=${s.diag?.host?.traps}`);
check("bridge active on the report", !!s.diag?.host?.bridgeEnabled, `bridge=${s.diag?.host?.bridgeEnabled}`);
const objects0 = s.diag?.host?.objects ?? 0;
check("screen allocated objects", objects0 > 0, `objects=${objects0}`);

await page.screenshot({ path: `${OUT}/01-open.png` });

// Advance through the report with the confirm button. The screen counts the
// experience up, pays BIT and the item, then fades and closes on its own; a
// held Circle (confirm) walks the pages.
const press = async (key, ms = 220) => {
    await page.keyboard.down(key);
    await page.waitForTimeout(ms);
    await page.keyboard.up(key);
    await page.waitForTimeout(180);
};

for (let i = 0; i < 14; i++) {
    s = await state();
    if (!s.open) break;
    await press("Enter");
}
// Give the fade/teardown frames to finish.
await page.waitForFunction(() => window.__reportNative?.isOpen() === false, { timeout: 15000 })
    .catch(() => {});
await page.waitForTimeout(500);

s = await state();
console.log("[verify] after drive:", JSON.stringify(s.diag));
check("report closes after the pages", s.open === false, `open=${s.open}`);

const delta = (s.bits ?? 0) - (before.bits ?? 0);
check("reward table paid +645 BIT", delta === 645, `bits ${before.bits} -> ${s.bits} (delta ${delta})`);
const lsBits = await page.evaluate(() => Number(localStorage.getItem("bits")));
check("localStorage carries the new BIT", lsBits === s.bits, `localStorage=${lsBits}`);
check("no page errors during the route", errors.length === 0, errors.slice(0, 3).join(" | "));

await page.screenshot({ path: `${OUT}/02-after.png` });

// Reload and confirm the persisted BIT.
await page.reload({ waitUntil: "load", timeout: 30000 });
await page.waitForFunction(() => window.__state?.started, { timeout: 30000 });
const afterReload = await state();
check("reload keeps the paid BIT", afterReload.bits === s.bits, `reload bits=${afterReload.bits}`);

await browser.close();
console.log(failures === 0 ? "\nverify_native_report: OK" : `\nverify_native_report: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
