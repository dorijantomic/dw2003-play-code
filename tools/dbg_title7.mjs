import { chromium } from "playwright";
import { baseUrl } from "./verify-base-url.mjs";
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`${baseUrl(8741)}/`);
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForFunction(() => window.__state?.manifest, null, { timeout: 20000 });
await page.waitForTimeout(4000);
const r = await page.evaluate(() => {
  let prevented = null;
  window.addEventListener("keydown", (e) => { prevented = e.defaultPrevented; });
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  return { preventedByEarlierListener: prevented };
});
console.log(JSON.stringify(r));
await page.waitForTimeout(1500);
console.log(JSON.stringify(await page.evaluate(() => ({ started: window.__state?.started }))));
await browser.close();
