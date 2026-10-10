import { chromium } from "playwright";
import { baseUrl } from "./verify-base-url.mjs";
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`${baseUrl(8741)}/`);
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForFunction(() => window.__state?.manifest, null, { timeout: 20000 });
await page.waitForTimeout(2000);
const info = () => page.evaluate(() => ({
  cls: document.getElementById("title-screen")?.className,
  hidden: document.getElementById("title-screen")?.hidden,
  started: window.__state?.started,
}));
console.log("before:", JSON.stringify(await info()));
for (const key of ["Enter", "Space", "z"]) {
  await page.keyboard.press(key);
  await page.waitForTimeout(1500);
  console.log(`after ${key}:`, JSON.stringify(await info()));
}
await page.screenshot({ path: "/tmp/dbg_title2.png" });
await browser.close();
