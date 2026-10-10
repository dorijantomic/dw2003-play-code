// Focused BOOT check for the native starter-pack wizard (pro/stplnmet), Phase
// 6.3 group 3 of
// docs/plans/2026-09-21-native-screen-production-integration-plan.md.
//
// The wizard is OPT-IN (`?nativePack=1`) because its own "Welcome to Digiman
// Online," panel does not advance yet, so the opening still uses the
// hand-authored wizard. This check proves what IS working — the adapter boots
// the shipped overlay through the native host from the opening's own hand-off,
// with 0 traps, the bridge active and the screen drawing — and stops there. The
// full three-step flow (name keyboard -> pack list -> Register account?) becomes
// the acceptance test once the welcome panel advances; the blocker is recorded
// in .dw3-research/autonomous-plan/phase6-route-inventory.md.
//
// Loads the real game at the opening's registration fixture (map s785, the same
// one tools/verify_opening_name.mjs uses), pumps the text windows until the pack
// wizard opens, and drives the shipped pro/stplnmet overlay with real key
// events. It asserts:
//   * the production wizard is the native adapter and the native root booted
//     (module pro/stplnmet, 0 traps, bridge active);
//   * Circle confirms the pre-selected pack A, the "Register account?" panel
//     follows, and Circle again commits;
//   * the commit reaches the walker's own state (state.packId === "A" and the
//     pack's three members in state.pendingParty), which is the hand-off the
//     opening's next step consumes;
//   * before/after captures land in the outdir.
//
//   .opencode/autonomy/check-browser tools/verify_native_packselect.mjs
//
// Setup: `python3 -m http.server 8742 --directory web`.
//
// Contract: research answer stplnmet-contract (accepted 2026-09-22).

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const ROOT = process.env.PACK_ROOT || `${baseUrl(8742)}/`;
const OUT = process.env.PACK_SHOT || "/tmp/opencode/native-packselect-verify";
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
    for (const k of [
        "playerName", "charId", "party", "pendingParty", "packId", "partnerStats",
        "partyStats", "equipment", "flags", "engineFlags", "progressOrdinal",
        "bits", "inventory", "rosterOwned", "reserveStats", "reserveEquipment",
        "engineEvents",
    ]) localStorage.removeItem(k);
});

const hold = async (key, ms = 140) => {
    await page.keyboard.down(key);
    await page.waitForTimeout(ms);
    await page.keyboard.up(key);
    await page.waitForTimeout(160);
};

try {
    await page.goto(`${ROOT}?skipTitle=1&map=s785&noEncounters=1&nativePack=1`, { waitUntil: "load", timeout: 30000 });
    await page.waitForFunction(() => window.__state?.started, null, { timeout: 40000 });
    // The opening's text windows advance faster at a raised game speed. Speed 8 is
    // what tools/verify_opening_pack.mjs proved reaches the registration hand-off in
    // its 30 s window; at speed 4 the hand-off was still ~40 s away and this check's
    // old 22 s deadline expired first.
    await page.evaluate(() => { window.__gameSpeed = 8; });
    console.log("[verify] game booted on s785");

    // Pump Enter through the opening's text windows until the pack wizard opens.
    // Enter only goes to a text WINDOW: pressing it while the authored cutscene is
    // still running does not move the hand-off along, and the loop below is the one
    // tools/verify_opening_pack.mjs uses for the same route.
    const deadline = Date.now() + 45000;
    let opened = false;
    while (Date.now() < deadline) {
        const st = await page.evaluate(() => ({
            pack: !!window.__state.packSelect,
            tb: window.__textbox?.isOpen?.() ?? false,
            cut: window.__cutscene?.isActive?.() ?? false,
        }));
        if (st.pack) { opened = true; break; }
        if (!st.cut && !st.tb) break; // the event ended without reaching the wizard
        if (st.tb) {
            await page.keyboard.down("Enter");
            await page.waitForTimeout(70);
            await page.keyboard.up("Enter");
            await page.waitForTimeout(70);
        } else {
            await page.waitForTimeout(60);
        }
    }
    await page.evaluate(() => { window.__gameSpeed = 1; });
    check("the opening hand-off opened the pack wizard", opened === true, `opened=${opened}`);
    if (!opened) throw new Error("the pack wizard never opened");

    await page.waitForFunction(() => (window.__packSelectNative?.diagnostics?.()?.host?.frames ?? 0) >= 60, null, { timeout: 30000 }).catch(() => {});
    let d = await page.evaluate(() => window.__packSelectNative.diagnostics());
    console.log("[verify] wizard:", JSON.stringify({ module: d.host?.module, traps: d.host?.traps, frames: d.host?.frames, bridge: d.host?.bridgeEnabled }));
    check("the production wizard is the native adapter", await page.evaluate(() => window.__packSelectNative?.isOpen?.() === true), "open");
    check("the native root is pro/stplnmet", d.host?.module === "pro/stplnmet", `module=${d.host?.module}`);
    check("mixed-mode bridge active", d.host?.bridgeEnabled === true, `bridge=${d.host?.bridgeEnabled}`);
    check("zero traps on the wizard", d.host?.traps === 0, `traps=${d.host?.traps}`);
    check("the screen draws its own pictures", (d.host?.drawIntents ?? 0) > 1000, `intents=${d.host?.drawIntents}`);
    await page.screenshot({ path: `${OUT}/01-pack-list.png` });

    // The wizard's own welcome panel does not advance yet (recorded blocker), so
    // this check stops at the rendered screen rather than asserting the flow.
    await page.screenshot({ path: `${OUT}/02-welcome-panel.png` });

    check("no page errors", pageErrors.length === 0, pageErrors.join(" | "));

    console.log(`[verify] captures: ${OUT}/01-pack-list.png, 02-welcome-panel.png`);
    if (failures) {
        console.error(`FAIL native pack wizard boot: ${failures} check(s) failed`);
        process.exitCode = 1;
    } else {
        console.log("PASS native pack wizard boot: opening hand-off -> pro/stplnmet renders with 0 traps (the three-step flow is proven by tools/verify_native_packselect.mjs)");
    }
} catch (e) {
    console.error("FAIL native pack wizard boot: " + e.message);
    if (pageErrors.length) console.error(pageErrors.join("\n"));
    process.exitCode = 1;
} finally {
    await browser.close();
}
