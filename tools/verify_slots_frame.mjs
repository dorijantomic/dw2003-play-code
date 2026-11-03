// Shared by tools/verify_slots.mjs: open the Arena Viewer (look=built) with time frozen, draw N frames, return the pixels.
// performance.now and requestAnimationFrame are frozen BEFORE the page runs, so two runs of the same code give the same bytes.
import { launch } from "./verify-launch.mjs";
import { baseUrl } from "./verify-base-url.mjs";

export async function openViewer(browser, arena, { ls = null, w = 1300, h = 760 } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  await ctx.addInitScript((lsInit) => {
    window.__realNow = performance.now.bind(performance); let t = 5000; performance.now = () => t; window.requestAnimationFrame = () => 0;
    if (lsInit) for (const [k, v] of Object.entries(lsInit)) if (!localStorage.getItem(k)) localStorage.setItem(k, v);
  }, ls);
  const page = await ctx.newPage();
  const errors = []; page.on("pageerror", (e) => errors.push(String(e).slice(0, 300)));
  await page.goto(`${baseUrl(8090)}/arena-viewer.html?arena=${arena}&look=built&p=m373rena&e=m051kuwa`);
  await page.waitForFunction(() => window.__renderFrame && window.__built && !window.__built.missing && window.__tools?.tuner && window.__slotsUI, null, { timeout: 120000, polling: 250 });
  return { page, ctx, errors };
}
/** n frames at the frozen clock; returns the visible canvas pixels as a Buffer (RGBA) */
export async function grab(page, n = 3) {
  await page.evaluate(() => { window.__renderFrame(5000); return window.__built.slots?.idle?.(); });   // the first frame makes the slots; chosen assets come up
  const b64 = await page.evaluate((n) => {
    for (let i = 0; i < n; i++) window.__renderFrame(5000);
    const cv = document.getElementById("cv"), d = cv.getContext("2d").getImageData(0, 0, cv.width, cv.height).data;
    let s = ""; const CH = 0x8000; for (let i = 0; i < d.length; i += CH) s += String.fromCharCode.apply(null, d.subarray(i, i + CH));
    return btoa(s);
  }, n);
  return Buffer.from(b64, "base64");
}
export function diff(a, b) { let m = 0, c = 0; if (a.length !== b.length) return { max: 255, count: -1 }; for (let i = 0; i < a.length; i++) { const d = Math.abs(a[i] - b[i]); if (d) { c++; if (d > m) m = d; } } return { max: m, count: c }; }
