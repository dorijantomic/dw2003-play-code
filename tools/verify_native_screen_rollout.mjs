// Phase 3 rollout measurement: boot each listed native screen root in the UI
// lab, tick it, and record what is visible (picture clips, live class-A text
// widgets, traps). PASS means every root booted and none trapped; clip/text
// counts are reported so the next action is chosen from measurement, not a guess.
//
// Env:
//   NATIVE_SCREEN_MODULES  comma list (default: the roots with no picture draw)
//   NATIVE_SCREEN_SHOT     capture directory
// Run: .opencode/autonomy/check-browser tools/verify_native_screen_rollout.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";
import { baseUrl } from "./verify-base-url.mjs";

const ROOT = process.env.NATIVE_SCREEN_ROOT || `${baseUrl(8742)}/`;
const OUT = process.env.NATIVE_SCREEN_SHOT || "/tmp/native-screen-rollout";
const MODULES = (
    process.env.NATIVE_SCREEN_MODULES ||
    "pro/stgtrain,pro/stplnmet,pro/stfgtrep,pro/stgmcard,pro/wfightmn,pro/wfightts"
).split(",");
const FRAMES = Number(process.env.NATIVE_SCREEN_FRAMES || 10);
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 960, height: 720 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const warns = [];
page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text()}`);
    else if (m.type() === "warning") warns.push(m.text());
});

try {
    await page.goto(`${ROOT}ui-lab.html`, { waitUntil: "domcontentloaded", timeout: 10000 });
    await page.waitForSelector('button[data-scr="nativescreen"]', { timeout: 10000 });
    await page.click('button[data-scr="nativescreen"]');
    await page.waitForURL(/native-screen-lab\.html/, { timeout: 10000 });
    await page.waitForFunction(() => window.__nativeScreen?.()?.screensLoaded === 20, null, { timeout: 10000 });

    const results = [];
    const problems = [];
    for (const module of MODULES) {
        await page.evaluate((m) => window.__nativeScreenBoot(m), module);
        let timedOut = false;
        try {
            await page.waitForFunction(
                (args) => {
                    const s = window.__nativeScreen?.();
                    return s && s.module === args.m && s.booted && s.frames >= args.f;
                },
                { m: module, f: FRAMES },
                { timeout: 6000 },
            );
        } catch {
            timedOut = true;
        }
        const state = await page.evaluate(() => window.__nativeScreen());
        const render = await page.evaluate(() => window.__nativeScreenRender());
        const widgets = await page.evaluate(() => window.__nativeTextWidgets());
        const drawn = widgets.filter((w) => w.lines.some((l) => l.len > 0)).length;
        await page.screenshot({ path: `${OUT}/${module.replace("/", "_")}.png` });
        results.push({
            module,
            timedOut,
            booted: state.booted,
            frames: state.frames,
            traps: state.traps,
            drawIntents: state.drawIntents,
            clips: render?.clips ?? null,
            skipped: render?.skipped ?? null,
            widgets: widgets.length,
            widgetsWithText: drawn,
        });
        if (timedOut) problems.push(`${module}: timed out reaching ${FRAMES} frames (errors: ${errors.join(" | ")}; warns: ${warns.join(" | ")})`);
        if (!state.booted) problems.push(`${module}: did not boot`);
        if (state.traps !== 0) problems.push(`${module}: traps=${state.traps} (${JSON.stringify(state.lastTrap)})`);
    }
    writeFileSync(`${OUT}/state.json`, JSON.stringify({ results, errors, warns }, null, 1) + "\n");
    if (errors.length) problems.push(`page errors: ${errors.join(" | ")}`);
    if (problems.length) {
        console.error(`FAIL native screen rollout:\n- ${problems.join("\n- ")}`);
        process.exitCode = 1;
    } else {
        console.log(
            `PASS native screen rollout: ${results
                .map((r) => `${r.module} clips=${r.clips} widgets=${r.widgets}(${r.widgetsWithText} text) traps=${r.traps}`)
                .join("; ")}; shots ${OUT}/`,
        );
    }
} finally {
    await browser.close();
}
