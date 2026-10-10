// Isolate the pause-menu STATUS hand-off + Back (the tail of
// verify_native_status) to see why Escape does not close the page there.
//   tools/run-playwright.sh tools/probe_handoff.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";
import { baseUrl } from "./verify-base-url.mjs";

const BASE = process.env.DDW3_BASE || `${baseUrl(8742)}/index.html?skipTitle=1&noEncounters=1`;
const OUT = "/tmp/opencode/handoff";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });

const diag = (name) => page.evaluate(() => {
    const st = window.__status;
    const d = st?.diagnostics?.() ?? null;
    return { open: st?.isOpen?.() ?? false, menuScreen: window.__menu?.screen ?? null,
        menuOpen: window.__state?.menuOpen, cursor: window.__menu?.mainCursor ?? null,
        frames: d?.renderer?.frames ?? 0, traps: d?.host?.traps ?? null,
        unk10: d?.screen?.childUnk10 ?? null, last: d?.lastDiagnostic ?? null };
}).then((d) => { console.log(name, JSON.stringify(d)); return d; });
const press = async (key, ms = 80) => { await page.keyboard.down(key); await page.waitForTimeout(ms); await page.keyboard.up(key); await page.waitForTimeout(400); };

try {
    await page.goto(BASE, { waitUntil: "load", timeout: 60000 });
    await page.waitForFunction(() => window.__state?.started, null, { timeout: 60000 });
    await page.waitForFunction(() => (window.__cards?.()?.folders?.length ?? 0) > 0, null, { timeout: 30000 }).catch(() => {});
    await page.evaluate(() => { window.__labOpen("menu"); });
    await page.waitForTimeout(400);
    await diag("0-menu");
    for (let i = 0; i < 4; i++) await press("ArrowDown", 70);
    await diag("1-cursor");
    await press("Enter", 80);
    const handed = await page.waitForFunction(() => window.__status?.isOpen?.() === true, null, { timeout: 15000 })
        .then(() => true).catch(() => false);
    console.log("handed:", handed);
    await page.waitForTimeout(400);
    await diag("2-opened");
    await page.waitForFunction(() => (window.__status?.diagnostics?.().renderer?.frames ?? 0) >= 60, null, { timeout: 30000 }).catch(() => {});
    await diag("3-interactive");
    writeFileSync(`${OUT}/3-interactive.png`, await page.locator("#game").screenshot());
    await press("Escape");
    await page.waitForTimeout(1500);
    await diag("4-after-escape");
    console.log("errors:", errors.length ? errors.join(" | ") : "none");
} finally {
    await browser.close();
}
