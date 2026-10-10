import { chromium } from "playwright";
import { baseUrl } from "./verify-base-url.mjs";
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`${baseUrl(8741)}/`);
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForFunction(() => window.__state?.manifest, null, { timeout: 20000 });
await page.waitForTimeout(2500);
// Title rhythm that worked.
for (let i = 0; i < 5; i++) {
  await page.keyboard.press("Enter"); await page.waitForTimeout(1500);
  await page.keyboard.press("ArrowUp"); await page.waitForTimeout(400);
  await page.keyboard.press("Enter"); await page.waitForTimeout(1200);
  const st = await page.evaluate(() => window.__state?.started);
  if (st) break;
}
console.log("started:", await page.evaluate(() => window.__state?.started));
// Advance to s785 with Space, then inspect packSelect object.
for (let i = 0; i < 400; i++) {
  const s = await page.evaluate(() => ({
    map: window.__state?.manifest?.maps[window.__state.mapIdx]?.id,
    ps: !!window.__state?.packSelect, ne: !!window.__state?.nameEntry,
    tb: !!window.__textbox?.isOpen?.(), ch: !!window.__choice?.isOpen?.(),
    cut: !!window.__cutscene?.isActive?.(),
  }));
  if (s.map === "s785" && (s.ps || s.ne)) break;
  if (i % 40 === 0) console.log(`advance ${i}:`, JSON.stringify(s));
  if (s.tb || s.ch) { await page.keyboard.press("Space"); await page.waitForTimeout(150); }
  else await page.waitForTimeout(300);
}
const ps = await page.evaluate(() => {
  const p = window.__state?.packSelect;
  if (!p) return { open: false };
  return {
    open: true,
    keys: Object.keys(p),
    proto: Object.getOwnPropertyNames(Object.getPrototypeOf(p)),
    state: JSON.stringify(p, (k, v) => typeof v === "function" ? "[fn]" : v).slice(0, 800),
  };
});
console.log("packSelect:", JSON.stringify(ps, null, 1));
await browser.close();
