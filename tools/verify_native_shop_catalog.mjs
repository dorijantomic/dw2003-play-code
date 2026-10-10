// Check the ordinary native merchant route for every catalogued shop.
// Run: tools/run-playwright.sh tools/verify_native_shop_catalog.mjs
// Requires: python3 -m http.server 8742 --directory web
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const shops = JSON.parse(readFileSync("web/assets/data/shops.json", "utf8"))
    .shops.filter((shop) => shop.shop_id < 30);
const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
let failures = 0;
try {
    await page.goto(`${baseUrl(8742)}/index.html?skipTitle=1&noEncounters=1&nativeShop=1`);
    await page.waitForFunction(() => window.__state?.started);
    for (const shop of shops) {
        await page.evaluate((id) => window.__labOpen("shop", id), shop.shop_id);
        await page.waitForFunction((id) => {
            const d = window.__shop.diagnostics();
            return d.shopId === id && d.host?.frames >= 35;
        }, shop.shop_id, { timeout: 15000 });
        const root = await page.evaluate(() => window.__nativeScreenTextDump()
            .flatMap((w) => w.decoded?.map((line) => line.text) ?? []).join(" "));
        await page.keyboard.down("c");
        await page.waitForTimeout(80);
        await page.keyboard.up("c");
        await page.waitForTimeout(650);
        const list = await page.evaluate(() => ({
            text: window.__nativeScreenTextDump()
                .flatMap((w) => w.decoded?.map((line) => line.text) ?? []).join(" "),
            traps: window.__shop.diagnostics().host?.traps,
        }));
        const first = shop.items[0]?.name.replaceAll(" ", "").toLowerCase() ?? "";
        const ok = root.includes(shop.name)
            && list.text.replaceAll(" ", "").toLowerCase().includes(first)
            && list.traps === 0;
        console.log(`${ok ? "PASS" : "FAIL"} ${shop.shop_id} ${shop.name}`);
        if (!ok) {
            failures++;
            console.log(JSON.stringify({ root, list, first }));
        }
        await page.evaluate(() => window.__shop.close());
    }
} finally {
    await browser.close();
}
console.log(JSON.stringify({ shops: shops.length, failures, errors }));
if (failures || errors.length) process.exitCode = 1;
