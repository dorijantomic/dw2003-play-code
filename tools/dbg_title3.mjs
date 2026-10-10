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
  window.__keys = [];
  window.addEventListener("keydown", (e) => window.__keys.push(e.key));
});
await page.keyboard.press("Enter");
await page.waitForTimeout(300);
await page.keyboard.press("Space");
await page.waitForTimeout(300);
const info = await page.evaluate(() => ({
  keys: window.__keys,
  focus: document.hasFocus(),
  active: document.activeElement?.tagName,
  cls: document.getElementById("title-screen")?.className,
  started: window.__state?.started,
}));
console.log(JSON.stringify(info, null, 1));
// Try clicking the canvas (mouse is an ordinary input on this screen).
const box = await page.evaluate(() => {
  const c = document.getElementById("title-canvas");
  const r = c.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height };
});
console.log("canvas box", JSON.stringify(box));
await page.mouse.click(box.x, box.y + box.h * 0.28);
await page.waitForTimeout(1500);
console.log("after canvas click:", JSON.stringify(await page.evaluate(() => ({
  started: window.__state?.started,
  cls: document.getElementById("title-screen")?.className,
}))));
await page.screenshot({ path: "/tmp/dbg_title3.png" });
await browser.close();
