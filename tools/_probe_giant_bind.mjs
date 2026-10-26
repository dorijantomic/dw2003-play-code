// Render the model with every bone matrix at identity: if the mesh chunks are stored in model space, this is the
// assembled bind pose.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const folder = process.argv[2] ?? "m140mtrn";
const OUT = process.argv[3] ?? `/home/dorij/scratch-research/giant/bind-${folder}`;
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ["--use-gl=angle", "--use-angle=swiftshader"] });
const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
page.on("pageerror", (e) => console.log("ERR", e.message));
await page.goto(`${baseUrl(8770)}/model-viewer.html?model=${folder}`);
await page.waitForFunction(() => window._model && window._mv && window._b3d, null, { timeout: 60000 });
await page.waitForTimeout(800);
await page.evaluate(() => { window._mv.clear = [0, 1, 0, 1]; document.getElementById("overlay").style.display = "none"; });

const box = await page.evaluate(() => {
  const m = window._model;
  let lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  for (const b of m.bones) for (const v of (b.verts || [])) {
    lo = [Math.min(lo[0], v[0]), Math.min(lo[1], v[1]), Math.min(lo[2], v[2])];
    hi = [Math.max(hi[0], v[0]), Math.max(hi[1], v[1]), Math.max(hi[2], v[2])];
  }
  return { lo, hi, n: m.bones.length };
});
console.log("raw verts box", JSON.stringify(box));
await page.evaluate(() => {
  const m = window._model;
  for (const b of m.bones) {
    b.anim = { ch1: [[0, 0, 0, 0], [0, 0, 0, 30000]], ch2: [[0, 0, 0, 0], [0, 0, 0, 30000]] };
  }
});
const c = [(box.lo[0] + box.hi[0]) / 2, (box.lo[1] + box.hi[1]) / 2, (box.lo[2] + box.hi[2]) / 2];
const r = 0.5 * Math.hypot(box.hi[0] - box.lo[0], box.hi[1] - box.lo[1], box.hi[2] - box.lo[2]);
const dist = r / Math.tan(Math.PI / 8) * 1.15;
console.log("center", c.map(Math.round), "radius", Math.round(r), "dist", Math.round(dist));
const canvas = page.locator("#c");
for (const [name, theta] of [["down", 0], ["down-left", Math.PI / 4], ["left", Math.PI / 2], ["up-left", 3 * Math.PI / 4], ["up", Math.PI]]) {
  await page.evaluate(({ theta, dist, target }) => window._mv.setCamera({ theta, phi: 0.3, dist, target }), {
    theta, dist, target: [c[0] * 0.85, -c[1] * 0.85, c[2] * 0.85],
  });
  await page.evaluate(() => window._mv.setFrame(0));
  await page.waitForTimeout(300);
  writeFileSync(`${OUT}/${name}.png`, await canvas.screenshot());
}
await browser.close();
console.log("done", OUT);
