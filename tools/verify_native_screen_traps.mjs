// Phase 3 native screen port: the three roots whose tick self-registers a
// display view (stage select, sound test) or opens a host-device file (shock
// test) must boot in the browser through engine/native with ZERO fail-soft
// traps. Before the host services in engine/native/runtime.ts they trapped in
// the libetc VSync wait (budget exhausted), on the libgs GTE ctc2 setter, and
// on the BIOS fopen/fwrite jumps respectively.
//
// What is asserted: each root boots, ticks, and reports traps===0. The stage
// select screen's visible content is class-A text widgets, so a non-zero drawn
// text count is asserted for it too. Captures land beside the check.
//
// Run: .opencode/autonomy/check-browser tools/verify_native_screen_traps.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";
import { baseUrl } from "./verify-base-url.mjs";

const ROOT = process.env.NATIVE_SCREEN_ROOT || `${baseUrl(8742)}/`;
const OUT = process.env.NATIVE_SCREEN_SHOT || "/tmp/native-screen-traps";
mkdirSync(OUT, { recursive: true });
const MODULES = ["pro/stagslct", "pro/soundtst", "pro/shocktst"];

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
    await page.waitForFunction(() => window.__nativeScreen?.()?.screensLoaded === 20, null, { timeout: 10000 });

    const results = [];
    const problems = [];
    for (const module of MODULES) {
        await page.evaluate((m) => window.__nativeScreenBoot(m), module);
        await page.waitForFunction(
            (m) => {
                const s = window.__nativeScreen?.();
                return s && s.module === m && s.booted && s.frames >= 12;
            },
            module,
            { timeout: 10000 },
        );
        const state = await page.evaluate(() => window.__nativeScreen());
        const text = await page.evaluate(() => window.__nativeScreenRender()?.text ?? null);
        const widgets = await page.evaluate(() => window.__nativeTextWidgets().length);
        await page.screenshot({ path: `${OUT}/${module.replace("/", "_")}.png` });
        results.push({ module, state, text, widgets });
        if (!state.booted) problems.push(`${module}: did not boot`);
        if (state.traps !== 0) problems.push(`${module}: traps=${state.traps} (${JSON.stringify(state.lastTrap)})`);
        if (state.frames < 12) problems.push(`${module}: only ${state.frames} frames`);
        if (module === "pro/stagslct" && !(text && text.drawn > 0)) {
            problems.push(`pro/stagslct: no text drawn (${JSON.stringify(text)})`);
        }
    }
    writeFileSync(`${OUT}/state.json`, JSON.stringify({ results, errors }, null, 1) + "\n");
    if (errors.length) problems.push(`page errors: ${errors.join(" | ")}`);
    if (problems.length) {
        console.error(`FAIL native screen traps:\n- ${problems.join("\n- ")}`);
        process.exitCode = 1;
    } else {
        console.log(
            `PASS native screen traps: ${results
                .map((r) => `${r.module} frames=${r.state.frames} traps=${r.state.traps} widgets=${r.widgets} text=${r.text ? `${r.text.drawn}/${r.text.lines}` : "-"}`)
                .join("; ")}; shots ${OUT}/`,
        );
    }
} finally {
    await browser.close();
}
