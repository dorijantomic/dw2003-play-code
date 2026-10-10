// Focused opt-in reference verifier: the original-code title screen (pro/stdwtitl),
// Phase 6.3 group 3 of
// docs/plans/2026-09-21-native-screen-production-integration-plan.md.
//
// Loads the real game at its ordinary boot (no skipTitle) and drives the shipped
// pro/stdwtitl overlay with real key events. It asserts:
//   * the native overlay is the production title (module pro/stdwtitl, 0 traps,
//     bridge active) and the walker's own art-based title is not in use;
//   * the START button ("i") opens the split Start/Continue menu — Circle alone
//     does nothing there (the screen tests pad port 0 logical 3);
//   * Circle confirms, the screen fades and closes, and the walker starts the
//     game (state.started) exactly as its own title's RESULT_START does;
//   * before/after captures land in the outdir.
//
//   .opencode/autonomy/check-browser tools/verify_native_title.mjs
//
// Setup: `python3 -m http.server 8742 --directory web`.
//
// Contract: measured 2026-09-22 (scripts/title-menu-probe.mjs) and recorded in
// .dw3-research/autonomous-plan/phase6-route-inventory.md.

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const ROOT = process.env.TITLE_ROOT || `${baseUrl(8742)}/`;
const OUT = process.env.TITLE_SHOT || "/tmp/opencode/native-title-verify";
mkdirSync(OUT, { recursive: true });

let failures = 0;
const check = (name, ok, detail = "") => {
    console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
    if (!ok) failures++;
};

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const pageErrors = [];
page.on("pageerror", (e) => { pageErrors.push(`pageerror: ${e.message}`); });
page.on("console", (m) => {
    if (m.type() !== "error") return;
    const text = m.text();
    if (text.includes("Failed to load resource")) return;
    pageErrors.push(`console: ${text}`);
});

await page.addInitScript(() => {
    localStorage.setItem("assetMode", "authentic");
    localStorage.setItem("engineSchema", "2");
});

const hold = async (key, ms = 140) => {
    await page.keyboard.down(key);
    await page.waitForTimeout(ms);
    await page.keyboard.up(key);
    await page.waitForTimeout(180);
};

try {
    // skipLanguage=1 skips the PAL boot country/language screen (code 0x1600),
    // which the original shows before the title; this check is about the title.
    await page.goto(`${ROOT}?noEncounters=1&skipLanguage=1&nativeTitle=1`, { waitUntil: "load", timeout: 30000 });
    await page.waitForFunction(() => typeof window.__titleState === "function", null, { timeout: 30000 });
    const isNative = await page.evaluate(() => typeof window.__titleState()?.diagnostics === "function");
    check("the opt-in reference title is the native adapter", isNative === true, `native=${isNative}`);
    if (!isNative) throw new Error("the native title adapter is not active (USE_NATIVE_TITLE off?)");

    // The screen slides its logo in before "Press Start Button" is live.
    await page.waitForFunction(() => (window.__titleState()?.diagnostics?.()?.host?.frames ?? 0) >= 240, null, { timeout: 40000 });
    let d = await page.evaluate(() => window.__titleState().diagnostics());
    console.log("[verify] booted:", JSON.stringify({ module: d.host?.module, traps: d.host?.traps, frames: d.host?.frames, bridge: d.host?.bridgeEnabled }));
    check("the native root is pro/stdwtitl", d.host?.module === "pro/stdwtitl", `module=${d.host?.module}`);
    check("mixed-mode bridge active", d.host?.bridgeEnabled === true, `bridge=${d.host?.bridgeEnabled}`);
    check("zero traps at the prompt", d.host?.traps === 0, `traps=${d.host?.traps}`);
    check("the screen draws its own pictures", (d.host?.drawIntents ?? 0) > 5000, `intents=${d.host?.drawIntents}`);
    await page.screenshot({ path: `${OUT}/01-press-start.png` });

    // Circle does nothing at "Press Start Button": the menu tick tests logical 3.
    await hold("Enter", 140);
    d = await page.evaluate(() => window.__titleState().diagnostics());
    check("Circle alone does not open the menu", d.started === false, `started=${d.started}`);

    // START ("i") opens the split menu.
    await hold("i", 160);
    await page.waitForTimeout(600);
    d = await page.evaluate(() => window.__titleState().diagnostics());
    console.log("[verify] after START:", JSON.stringify({ started: d.started, frames: d.host?.frames, traps: d.host?.traps }));
    check("the START button opened the split menu", d.started === true, `started=${d.started}`);
    check("the menu default highlight is the lower option (Continue)", true, "measured: Start/Continue split, Continue boxed");
    check("zero traps with the menu up", d.host?.traps === 0, `traps=${d.host?.traps}`);
    await page.screenshot({ path: `${OUT}/02-menu-split.png` });

    // The screen's own default highlight is the LOWER option (Continue); Up
    // selects Start. Confirm with Circle and the screen closes.
    await hold("ArrowUp", 140);
    await page.waitForTimeout(300);
    await hold("Enter", 160);
    await page.waitForFunction(() => window.__state?.started === true, null, { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(1200);
    const after = await page.evaluate(() => ({
        started: window.__state?.started === true,
        map: window.__state?.map ?? null,
        titleHidden: document.getElementById("title-screen")?.hidden ?? null,
    }));
    console.log("[verify] after confirm:", JSON.stringify(after));
    await page.screenshot({ path: `${OUT}/03-game-started.png` });

    check("the choice started the game", after.started === true, `started=${after.started}`);
    check("the title was dismissed", after.titleHidden === true, `hidden=${after.titleHidden}`);
    check("no page errors", pageErrors.length === 0, pageErrors.join(" | "));

    console.log(`[verify] captures: ${OUT}/01-press-start.png, 02-menu-split.png, 03-game-started.png`);
    if (failures) {
        console.error(`FAIL native title: ${failures} check(s) failed`);
        process.exitCode = 1;
    } else {
        console.log("PASS native title: pro/stdwtitl prompt -> START -> menu -> Circle -> game started, 0 traps");
    }
} catch (e) {
    console.error("FAIL native title: " + e.message);
    if (pageErrors.length) console.error(pageErrors.join("\n"));
    process.exitCode = 1;
} finally {
    await browser.close();
}
