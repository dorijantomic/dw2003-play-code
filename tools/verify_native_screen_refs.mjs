// Phase 5 acceptance: the UI lab must show the original console capture beside
// the live canvas for every native screen that has one registered under
// web/assets/ref/native/. Boots each listed module and asserts the reference
// image loaded with its real pixel size.
//
// Env: NATIVE_SCREEN_MODULES (comma list), NATIVE_SCREEN_SHOT (capture dir),
//      NATIVE_SCREEN_FRAMES / NATIVE_SCREEN_SETTLE_MS to let an intro animation
//      finish before the shot (defaults 4 / 400 ms; the card duel needs ~260
//      frames for its opening ceremony, the gym/lab lists settle near 90).
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";
import { baseUrl } from "./verify-base-url.mjs";

const ROOT = process.env.NATIVE_SCREEN_ROOT || `${baseUrl(8742)}/`;
const OUT = process.env.NATIVE_SCREEN_SHOT || "/tmp/native-screen-refs";
const SETTLE_FRAMES = Number(process.env.NATIVE_SCREEN_FRAMES || 4);
const SETTLE_MS = Number(process.env.NATIVE_SCREEN_SETTLE_MS || 400);
const MODULES = (process.env.NATIVE_SCREEN_MODULES || "pro/stcrdabm,pro/stcrdshp,pro/stgdglab").split(",");
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 960, height: 720 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });

try {
    await page.goto(`${ROOT}ui-lab.html`, { waitUntil: "domcontentloaded", timeout: 10000 });
    await page.waitForSelector('button[data-scr="nativescreen"]', { timeout: 10000 });
    await page.click('button[data-scr="nativescreen"]');
    await page.waitForURL(/native-screen-lab\.html/, { timeout: 10000 });
    await page.waitForFunction(() => window.__nativeScreen?.()?.screensLoaded === 20, null, { timeout: 20000 });

    const results = [];
    const problems = [];
    for (const module of MODULES) {
        await page.evaluate((m) => window.__nativeScreenBoot(m), module);
        await page.waitForFunction(
            (a) => {
                const [m, frames] = a;
                const s = window.__nativeScreen?.();
                return s && s.module === m && s.booted && s.frames >= frames;
            },
            [module, SETTLE_FRAMES],
            { timeout: 30000 },
        );
        await page.waitForTimeout(SETTLE_MS);
        const ref = await page.evaluate(() => window.__nativeScreenRef());
        // Page shot (canvas + reference side by side) by default; canvas-only
        // with NATIVE_SCREEN_CANVAS_ONLY=1 for a direct visual diff.
        if (process.env.NATIVE_SCREEN_CANVAS_ONLY === "1") {
            await page.locator("#c").screenshot({ path: `${OUT}/${module.replace("/", "_")}.png` });
        } else {
            await page.screenshot({ path: `${OUT}/${module.replace("/", "_")}.png` });
        }
        results.push({ module, ref });
        if (!ref.shown || ref.width === 0) {
            problems.push(`${module}: no reference capture shown (${JSON.stringify(ref)})`);
        }
    }
    writeFileSync(`${OUT}/state.json`, JSON.stringify({ results, errors }, null, 1) + "\n");
    if (errors.length) problems.push(`page errors: ${errors.join(" | ")}`);
    if (problems.length) {
        console.error(`FAIL native screen references:\n- ${problems.join("\n- ")}`);
        process.exitCode = 1;
    } else {
        console.log(`PASS native screen references: ${results
            .map((r) => `${r.module} ${r.ref.width}x${r.ref.height}`)
            .join("; ")}; shots ${OUT}/`);
    }
} catch (e) {
    console.error("FAIL native screen references: " + e.message);
    if (errors.length) console.error(errors.join("\n"));
    process.exitCode = 1;
} finally {
    await browser.close();
}
