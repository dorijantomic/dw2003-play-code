// Phase 1 native screen port: one screen's ORIGINAL overlay must boot in the
// browser through engine/native from the shipped assets and publish draw
// intents, reached from the UI lab's real entry point.
//
// This is not a visual claim: it asserts the runtime booted, ticked, produced
// draw intents, and trapped nothing. Phase 2 replaces the debug readout with
// the replay-path renderer and adds the capture-vs-original.
//
// Server: python3 -m http.server 8742 --directory web
// Run:    .opencode/autonomy/check-browser tools/verify_native_screen_boot.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";
import { baseUrl } from "./verify-base-url.mjs";

const ROOT = process.env.NATIVE_SCREEN_ROOT || `${baseUrl(8742)}/`;
const OUT = process.env.NATIVE_SCREEN_SHOT || "/tmp/native-screen-boot";
const TARGET = process.env.NATIVE_SCREEN_MODULE || "pro/stitshop";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 960, height: 720 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text()}`);
});

try {
    await page.goto(`${ROOT}ui-lab.html`, { waitUntil: "domcontentloaded", timeout: 10000 });
    await page.waitForSelector('button[data-scr="nativescreen"]', { timeout: 10000 });
    await page.click('button[data-scr="nativescreen"]');
    await page.waitForURL(/native-screen-lab\.html/, { timeout: 10000 });
    await page.waitForFunction(
        () => {
            const s = window.__nativeScreen?.();
            return s && s.screensLoaded === 20;
        },
        null,
        { timeout: 10000 },
    );
    const listed = await page.evaluate(() => window.__nativeScreenList());
    if (listed.length !== 20) throw new Error(`expected 20 shipped screen roots, got ${listed.length}`);
    // Let the RAF loop reach 20 ticks; fail fast rather than hang.
    await page.waitForFunction(
        () => {
            const s = window.__nativeScreen();
            return s && s.module === "pro/stitshop" && s.booted && s.frames >= 20;
        },
        null,
        { timeout: 10000 },
    );
    const state = await page.evaluate(() => window.__nativeScreen());
    await page.screenshot({ path: `${OUT}/native-screen-boot.png` });
    writeFileSync(`${OUT}/state.json`, JSON.stringify({ target: TARGET, listed, state }, null, 1) + "\n");

    const problems = [];
    if (state.module !== TARGET) problems.push(`booted ${state.module}, expected ${TARGET}`);
    if (!state.booted) problems.push("runtime did not boot");
    // pro/stitshop's root scene (F0x8008c118, the scene the player meets: greeting
    // fade, shop-name/BIT header, BUY/SELL menu) allocates 9 objects. The old
    // `< 30` threshold was measured against the manifest's census ctor
    // 0x8008596c, which is only the BUY tab sub-object; the lab now boots the
    // root override (web/native-screen-roots.js), so the count dropped and this
    // Phase-1 smoke check kept failing unnoticed. The production proof for the
    // shop is tools/verify_native_shop.mjs (26/26), which asserts the rendered
    // scene, the money round trip and the close path.
    if (state.objects < 5) problems.push(`objects=${state.objects} (<5)`);
    if (state.drawIntents <= 0) problems.push("no draw intents recorded");
    if (state.traps !== 0) problems.push(`traps=${state.traps} (${JSON.stringify(state.lastTrap)})`);
    if (errors.length) problems.push(`page errors: ${errors.join(" | ")}`);
    if (problems.length) {
        console.error(`FAIL native screen boot:\n- ${problems.join("\n- ")}`);
        process.exitCode = 1;
    } else {
        console.log(
            `PASS native screen boot: ${state.module} objects=${state.objects} frames=${state.frames} ` +
                `intents=${state.drawIntents} last=${state.lastDraw?.method} traps=${state.traps}; ` +
                `${listed.length} roots shipped; shot ${OUT}/native-screen-boot.png`,
        );
    }
} finally {
    await browser.close();
}
