import { chromium } from "playwright";
import { baseUrl } from "./verify-base-url.mjs";
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`${baseUrl(8741)}/`);
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForFunction(() => window.__state?.manifest, null, { timeout: 20000 });
await page.waitForTimeout(4000);
await page.evaluate(() => {
  window.__blips = [];
  const sfx = window.__sfx;
  const orig = sfx.play.bind(sfx);
  sfx.play = (id, ...rest) => { window.__blips.push(id); return orig(id, ...rest); };
});
for (const key of ["Enter", "Enter", "ArrowDown", "Enter"]) {
  await page.keyboard.press(key);
  await page.waitForTimeout(1200);
  const info = await page.evaluate(() => ({
    blips: window.__blips,
    started: window.__state?.started,
  }));
  console.log(`after ${key}:`, JSON.stringify(info));
}
await browser.close();
