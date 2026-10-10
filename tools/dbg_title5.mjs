import { chromium } from "playwright";
import { baseUrl } from "./verify-base-url.mjs";
const browser = await chromium.launch();
const page = await browser.newPage();
page.on("pageerror", (e) => console.log("PAGEERROR:", String(e && e.message || e).slice(0, 200)));
await page.goto(`${baseUrl(8741)}/`);
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForFunction(() => window.__state?.manifest, null, { timeout: 20000 });
await page.waitForTimeout(4000);
const st = () => page.evaluate(() => ({ started: window.__state?.started, cls: document.getElementById("title-screen")?.className, hidden: document.getElementById("title-screen")?.hidden }));
console.log("t0:", JSON.stringify(await st()));
// Full native rhythm: confirm, let blink+split finish, confirm again, let fade finish.
await page.keyboard.press("Enter");
for (let i = 0; i < 6; i++) {
  await page.waitForTimeout(1000);
  const s = await st();
  console.log(`after Enter+${i + 1}s:`, JSON.stringify(s));
  if (s.started) break;
}
if (!(await st()).started) {
  console.log("second confirm");
  await page.keyboard.press("Enter");
  for (let i = 0; i < 4; i++) {
    await page.waitForTimeout(1000);
    console.log(`after 2nd+${i + 1}s:`, JSON.stringify(await st()));
  }
}
await page.screenshot({ path: "/tmp/dbg_title5.png" });
await browser.close();
