// Native screen text layer, measurement step: dump the live class-A text
// widgets the item shop's own code filled, so the renderer can be wired to real
// strings/pens instead of guessed ones.
//
// This is a structure/dump check: it asserts the widgets exist with non-empty
// string records and prints their bytes for the codec work. The render
// assertion comes once the widget->uifont bridge is wired.
//
// Server: python3 -m http.server 8742 --directory web
// Run:    .opencode/autonomy/check-browser tools/verify_native_screen_text.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";
import { baseUrl } from "./verify-base-url.mjs";
import { bootShopLab, openBuyList } from "./native-screen-shop-lab.mjs";

const ROOT = process.env.NATIVE_SCREEN_ROOT || `${baseUrl(8742)}/`;
const OUT = process.env.NATIVE_SCREEN_SHOT || "/tmp/native-screen-text";
mkdirSync(OUT, { recursive: true });

const latin1 = (bytes) => (bytes ? Buffer.from(bytes).toString("latin1") : "");

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
            return s && s.screensLoaded === 20 && s.booted && s.frames >= 45;
        },
        null,
        { timeout: 10000 },
    );
    // The digit readouts this check reads are the item list's, not the
    // BUY/SELL menu's: the merchant opens on its two-row menu (its own root
    // state table, `pro/stitshop.s` file `0x4E8`, entry 3) and only the confirm
    // press in state 3 (`stitshop.s:9205` -> `+0x10 = 0x14` at `:9220`) opens
    // the list. Press it the way a player does, through the lab's pad-input
    // service, before reading the widgets.
    await openBuyList(page);
    const widgets = await page.evaluate(() => window.__nativeTextWidgets());
    // Let the bridge draw (it also drives the capture).
    await page.waitForFunction(
        () => window.__nativeScreenRender?.()?.text && window.__nativeScreenRender()?.ready,
        null,
        { timeout: 10000 },
    );
    const text = await page.evaluate(() => window.__nativeScreenRender().text);
    await page.screenshot({ path: `${OUT}/native-screen-text.png` });
    writeFileSync(`${OUT}/widgets.json`, JSON.stringify(widgets, null, 1) + "\n");

    const problems = [];
    if (widgets.length < 4) problems.push(`only ${widgets.length} text widgets (want >=4)`);
    const withText = widgets.filter((w) => w.lines.some((l) => l.len > 0 && l.bytes));
    if (withText.length < 1) problems.push("no widget carries a non-empty line record");
    for (const w of widgets) {
        const parts = w.lines
            .filter((l) => l.len > 0)
            .map((l) => `ptr=0x${l.ptr.toString(16)} len=${l.len} "${latin1(l.bytes).replace(/[^\x20-\x7e]/g, ".")}"`);
        console.log(
            `widget 0x${w.addr.toString(16)} font=0x${w.font.toString(16)} pen=(${w.penX},${w.penY}) ` +
                `total=${w.total} reveal=${w.revealFirst}..${w.revealEnd} colour=${w.colour} vis=${w.visible} ` +
                `lines=[${parts.join(" | ")}]`,
        );
    }
    // The decoded native widget texts must include the digit readouts measured
    // live (item shop: font codes 0x04+d). This is the codec/draw assertion.
    if (text.drawn < 1) problems.push(`text bridge drew ${text.drawn} lines (want >=1)`);
    if (!text.texts || !text.texts.some((t) => t === "1" || t === "2" || t === "200")) {
        problems.push(`decoded texts ${JSON.stringify(text.texts)} lack the measured digit readouts`);
    }
    if (errors.length) problems.push(`page errors: ${errors.join(" | ")}`);
    if (problems.length) {
        console.error(`FAIL native screen text dump:\n- ${problems.join("\n- ")}`);
        process.exitCode = 1;
    } else {
        console.log(
            `PASS native screen text: ${widgets.length} widgets, ${withText.length} with text, ` +
                `ifont ${text.ready} drew ${text.drawn}/${text.lines} lines texts=${JSON.stringify(text.texts.slice(0, 6))}; ` +
                `dump ${OUT}/widgets.json`,
        );
    }
} finally {
    await browser.close();
}
