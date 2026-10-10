import { chromium } from "playwright";
import { baseUrl } from "./verify-base-url.mjs";
// DIAGNOSTIC: encounter rate/zone layout on s200 around (1000,236).
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`${baseUrl(8741)}/?skipTitle=1&map=s200`);
await page.waitForFunction(() => window.__state?.started, null, { timeout: 20000 });
await page.waitForTimeout(1500);
const info = await page.evaluate(async () => {
  await window.__encounter.ready();
  const rows = [];
  for (const [x, y] of [[1000, 236], [900, 236], [800, 300], [700, 400], [564, 558], [400, 500], [288, 544]]) {
    rows.push([x, y, window.__encounter.rateLevel("s200", x, y)]);
  }
  return {
    rates: rows,
    entryKey: window.__state.entryKey,
    party: window.__state.party,
  };
});
console.log(JSON.stringify(info, null, 1));
await browser.close();
