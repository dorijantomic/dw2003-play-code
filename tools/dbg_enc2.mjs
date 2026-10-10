import { chromium } from "playwright";
import { baseUrl } from "./verify-base-url.mjs";
// DIAGNOSTIC: s200 rates by entryKey + step-counter state after a real opening
// is too slow to replay here; check key sensitivity + ambush tiles instead.
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`${baseUrl(8741)}/?skipTitle=1&map=s200`);
await page.waitForFunction(() => window.__state?.started, null, { timeout: 20000 });
await page.waitForTimeout(1500);
const info = await page.evaluate(async () => {
  await window.__encounter.ready();
  const out = {};
  for (const key of [0, 1, 2, 3, 4, 5, 6, 7]) {
    window.__state.entryKey = key;
    out[key] = [
      window.__encounter.rateLevel("s200", 1000, 236),
      window.__encounter.rateLevel("s200", 564, 558),
      window.__encounter.rateLevel("s200", 288, 544),
    ];
  }
  return out;
});
console.log(JSON.stringify(info));
await browser.close();
