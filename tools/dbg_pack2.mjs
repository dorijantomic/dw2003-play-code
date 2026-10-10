import { chromium } from "playwright";
import { baseUrl } from "./verify-base-url.mjs";
// Reach s785 packSelect via the working rhythms, then step Space and read
// phase()/isDone() after each press.
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`${baseUrl(8741)}/`);
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForFunction(() => window.__state?.manifest, null, { timeout: 20000 });
await page.waitForTimeout(2500);
for (let i = 0; i < 5; i++) {
  await page.keyboard.press("Enter"); await page.waitForTimeout(1500);
  await page.keyboard.press("ArrowUp"); await page.waitForTimeout(400);
  await page.keyboard.press("Enter"); await page.waitForTimeout(1200);
  if (await page.evaluate(() => window.__state?.started)) break;
}
for (let i = 0; i < 600; i++) {
  const s = await page.evaluate(() => ({
    map: window.__state?.manifest?.maps[window.__state.mapIdx]?.id,
    ps: !!window.__state?.packSelect, ne: !!window.__state?.nameEntry,
    tb: !!window.__textbox?.isOpen?.(), ch: !!window.__choice?.isOpen?.(),
  }));
  if (s.ps || s.ne) break;
  if (s.tb || s.ch) { await page.keyboard.press("Space"); await page.waitForTimeout(150); }
  else await page.waitForTimeout(300);
}
console.log("at pack/name:", JSON.stringify(await page.evaluate(() => ({
  map: window.__state?.manifest?.maps[window.__state.mapIdx]?.id,
  ps: !!window.__state?.packSelect, ne: !!window.__state?.nameEntry,
}))));
for (let i = 0; i < 12; i++) {
  const before = await page.evaluate(() => {
    const p = window.__state?.packSelect;
    return p ? { phase: String(p.phase()), done: !!p.isDone() } : null;
  });
  await page.keyboard.press("Space");
  await page.waitForTimeout(700);
  const after = await page.evaluate(() => ({
    ps: !!window.__state?.packSelect, ne: !!window.__state?.nameEntry,
    map: window.__state?.manifest?.maps[window.__state.mapIdx]?.id,
    tb: !!window.__textbox?.isOpen?.(),
  }));
  console.log(`space ${i}: before=${JSON.stringify(before)} after=${JSON.stringify(after)}`);
  if (!after.ps) break;
}
await browser.close();
