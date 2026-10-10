import { chromium } from "playwright";
import { baseUrl } from "./verify-base-url.mjs";
// DIAGNOSTIC (not part of journey proof): sample westward walkability across
// s210 at several y bands by placing the player and holding Left.
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`${baseUrl(8741)}/?skipTitle=1&map=s210`);
await page.waitForFunction(() => window.__state?.started, null, { timeout: 20000 });
await page.waitForTimeout(1500);
const probe = async (x, y) => {
  await page.evaluate(([px, py]) => {
    const st = window.__state;
    st.x = px; st.y = py; st.dir = "left";
  }, [x, y]);
  await page.waitForTimeout(300);
  const x0 = await page.evaluate(() => window.__state.x);
  await page.keyboard.down("ArrowLeft");
  await page.waitForTimeout(500);
  await page.keyboard.up("ArrowLeft");
  const x1 = await page.evaluate(() => window.__state.x);
  return x1 - x0;
};
for (const y of [360, 382, 400, 420, 440, 460]) {
  const row = [];
  for (const x of [700, 600, 500, 400, 300, 200, 120]) row.push(`${x}:${probe ? "" : ""}`);
  const vals = [];
  for (const x of [700, 600, 500, 400, 300, 200, 120]) vals.push(await probe(x, y));
  console.log(`y=${y} ` + vals.map((v, i) => `x=${[700, 600, 500, 400, 300, 200, 120][i]}:${v.toFixed(0)}`).join(" "));
}
await browser.close();
