// Sweep camera distance with the viewer's own fitted target and dump shots, to find the framing that holds the whole model.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const folder = process.argv[2] ?? "m140mtrn";
const OUT = process.argv[3] ?? `/home/dorij/scratch-research/giant/framing-${folder}`;
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ["--use-gl=angle", "--use-angle=swiftshader"] });
const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
page.on("pageerror", (e) => console.log("ERR", e.message));
await page.goto(`${baseUrl(8770)}/model-viewer.html?model=${folder}`);
await page.waitForFunction(() => window._model && window._mv && window._b3d, null, { timeout: 60000 });
await page.waitForTimeout(800);
await page.evaluate(() => { window._mv.clear = [0, 1, 0, 1]; document.getElementById("overlay").style.display = "none"; });
const fitted = await page.evaluate(() => window._mv.getCamera());
console.log("fitted", JSON.stringify(fitted));
const canvas = page.locator("#c");
for (const theta of [0, Math.PI / 2]) {
  for (const k of [1.0, 1.3, 1.6, 2.0]) {
    await page.evaluate(({ theta, dist, target }) => window._mv.setCamera({ theta, phi: 0.25, dist, target }), {
      theta, dist: fitted.dist * k, target: fitted.target,
    });
    await page.evaluate(() => window._mv.setFrame(0));
    await page.waitForTimeout(250);
    writeFileSync(`${OUT}/t${Math.round(theta * 100)}_x${k}.png`, await canvas.screenshot());
  }
}
await browser.close();
console.log("done", OUT);
