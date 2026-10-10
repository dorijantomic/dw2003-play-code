import { chromium } from "playwright";
import { baseUrl } from "./verify-base-url.mjs";
// DIAGNOSTIC: what stops westward motion on s210 at y=382?
const browser = await chromium.launch();
const page = await browser.newPage();
page.on("pageerror", (e) => console.log("PAGEERROR:", String(e?.message || e).slice(0, 200)));
await page.goto(`${baseUrl(8741)}/?skipTitle=1&map=s210`);
await page.waitForFunction(() => window.__state?.started, null, { timeout: 20000 });
await page.waitForTimeout(1500);
const info = await page.evaluate(() => {
  const st = window.__state;
  st.x = 700; st.y = 382; st.dir = "left";
  const g = st.collision?.["s210"];
  const out = { grid: !!g, cell: g?.cell, cols: g?.cols, rows: g?.rows, npcs: (st.scenes?.["s210"]?.npcs || []).length };
  if (g) {
    // cells overlapped by the 12x8 box at a few x positions (y 374..382)
    out.probe = [];
    for (const px of [700, 680, 663, 650, 620]) {
      const cells = [];
      for (let yy = 374; yy <= 382; yy += 4) for (let xx = px - 6; xx <= px + 6; xx += 4) {
        const c = Math.floor(xx / 8), r = Math.floor(yy / 8);
        cells.push(`${c},${r}=${g.cells[r * g.cols + c]}`);
      }
      out.probe.push([px, cells.join(" ")]);
    }
  }
  return out;
});
console.log(JSON.stringify(info, null, 1));
await browser.close();
