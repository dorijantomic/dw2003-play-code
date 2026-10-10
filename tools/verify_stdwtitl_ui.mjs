// Headless screenshot verifier for the STDWTITL title-screen background.
// Usage: ~/.local/share/playwright-shot/run.sh tools/verify_stdwtitl_ui.mjs [outdir]
// Requires: cd web && python3 -m http.server 8741
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const out = process.argv[2] ?? "/tmp/titleui";
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  channel: "chromium-headless-shell",
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 960, height: 720 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
await page.goto(`${baseUrl(8741)}/`, { waitUntil: "load" });
await page.waitForSelector("#title-screen:not([hidden])", { timeout: 30000 });
await page.waitForTimeout(500); // image load
await page.locator("#title-screen").screenshot({ path: `${out}/title.png` });
console.log("shot title ->", out);

await browser.close();
