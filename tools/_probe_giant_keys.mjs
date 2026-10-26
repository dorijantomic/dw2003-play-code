// Render the model at EXACT keyframe times (Euler interpolation between sparse keys spins parts apart).
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const folder = process.argv[2] ?? "m140mtrn";
const OUT = process.argv[3] ?? `/home/dorij/scratch-research/giant/keys-${folder}`;
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ["--use-gl=angle", "--use-angle=swiftshader"] });
const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
page.on("pageerror", (e) => console.log("ERR", e.message));
await page.goto(`${baseUrl(8770)}/model-viewer.html?model=${folder}`);
await page.waitForFunction(() => window._model && window._mv && window._b3d, null, { timeout: 60000 });
await page.waitForTimeout(800);
await page.evaluate(() => { window._mv.clear = [0, 1, 0, 1]; document.getElementById("overlay").style.display = "none"; });

const keys = await page.evaluate(() => {
  const m = window._model;
  const set = new Set();
  for (const b of m.bones) for (const ch of [b.anim?.ch1, b.anim?.ch2]) {
    if (!ch) continue;
    for (const k of ch) if (k[3] !== 30000 && k[3] <= 342) set.add(k[3]);
  }
  return [...set].sort((a, b) => a - b);
});
console.log("key times", keys.length, keys.slice(0, 40).join(","));
const canvas = page.locator("#c");
const fitted = await page.evaluate(() => window._mv.getCamera());
const shots = [];
for (const [name, theta] of [["left", Math.PI / 2], ["front", 0]]) {
  await page.evaluate(({ theta, dist, target }) => window._mv.setCamera({ theta, phi: 0.3, dist, target }), {
    theta, dist: fitted.dist * 0.62, target: [0, 0, 0],
  });
  const picked = keys.filter((t) => t <= 342).slice(0, 10);
  for (let i = 0; i < picked.length; i++) {
    await page.evaluate((f) => window._mv.setFrame(f), picked[i]);
    await page.waitForTimeout(180);
    const file = `${OUT}/${name}_${String(i).padStart(2, "0")}.png`;
    writeFileSync(file, await canvas.screenshot());
    shots.push(file);
  }
  console.log(name, "frames", picked.join(","));
}
await browser.close();
console.log("done", OUT);
