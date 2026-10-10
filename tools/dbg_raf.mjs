import { chromium } from "playwright";
import { baseUrl } from "./verify-base-url.mjs";
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`${baseUrl(8741)}/`);
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForFunction(() => window.__state?.manifest, null, { timeout: 20000 });
const n = await page.evaluate(() => new Promise((res) => {
  let c = 0; const t1 = performance.now();
  const loop = () => { c++; if (performance.now() - t1 < 2000) requestAnimationFrame(loop); else res(c); };
  requestAnimationFrame(loop);
}));
console.log("rAF in 2s:", n);
// Is the title's own frame loop running? instrument by watching canvas pixels change
const px = await page.evaluate(() => new Promise((res) => {
  const c = document.getElementById("title-canvas");
  const g = c.getContext("2d");
  const d1 = Array.from(g.getImageData(0, 0, 8, 8).data.slice(0, 8));
  setTimeout(() => {
    const d2 = Array.from(g.getImageData(0, 0, 8, 8).data.slice(0, 8));
    res({ d1, d2, same: JSON.stringify(d1) === JSON.stringify(d2) });
  }, 1500);
}));
console.log("canvas pixels:", JSON.stringify(px));
await browser.close();
