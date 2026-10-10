import { chromium } from "playwright";
import { baseUrl } from "./verify-base-url.mjs";
// DIAGNOSTIC: NPCs near (663,382) on s210 + single-tap creep test westward.
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`${baseUrl(8741)}/?skipTitle=1&map=s210`);
await page.waitForFunction(() => window.__state?.started, null, { timeout: 20000 });
await page.waitForTimeout(1500);
const near = await page.evaluate(() => {
  const st = window.__state;
  st.x = 668; st.y = 382; st.dir = "left";
  const npcs = (st.scenes?.["s210"]?.npcs || [])
    .map((n) => ({ id: n.npc_id, x: Math.round(n.x), y: Math.round(n.y) }))
    .filter((n) => Math.abs(n.x - 663) < 120 && Math.abs(n.y - 382) < 80);
  return npcs.slice(0, 12);
});
console.log("npcs near stuck point:", JSON.stringify(near));
// Creep: single quick taps west, 40x.
await page.evaluate(() => { window.__state.x = 668; window.__state.y = 382; });
for (let i = 0; i < 40; i++) {
  await page.keyboard.down("ArrowLeft");
  await page.waitForTimeout(30);
  await page.keyboard.up("ArrowLeft");
  await page.waitForTimeout(30);
}
console.log("after 40 taps:", JSON.stringify(await page.evaluate(() => ({ x: window.__state.x, y: window.__state.y }))));
await browser.close();
