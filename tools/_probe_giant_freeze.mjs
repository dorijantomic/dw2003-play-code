// Freeze every bone's translation at its first key, keep the rotations: parts should stay attached to the body.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const folder = process.argv[2] ?? "m140mtrn";
const OUT = process.argv[3] ?? `/home/dorij/scratch-research/giant/freeze-${folder}`;
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ["--use-gl=angle", "--use-angle=swiftshader"] });
const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
page.on("pageerror", (e) => console.log("ERR", e.message));
await page.goto(`${baseUrl(8770)}/model-viewer.html?model=${folder}`);
await page.waitForFunction(() => window._model && window._mv && window._b3d, null, { timeout: 60000 });
await page.waitForTimeout(800);
await page.evaluate(() => { window._mv.clear = [0, 1, 0, 1]; document.getElementById("overlay").style.display = "none"; });

const spread = await page.evaluate(() => {
  const m = window._model;
  // freeze translations at the first key
  for (const b of m.bones) {
    const ch = b.anim?.ch1;
    if (!ch || !ch.length) continue;
    const k = ch[0];
    b.anim.ch1 = [[k[0], k[1], k[2], 0], [k[0], k[1], k[2], 30000]];
  }
  const out = [];
  for (const f of [0, 80, 160, 240, 320]) {
    const { mats } = window._b3d.buildBoneWorldMatrices(m, f);
    const pts = mats.map((M) => [M[12], M[13], M[14]]);
    let maxd = 0;
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++)
      maxd = Math.max(maxd, Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1], pts[i][2] - pts[j][2]));
    out.push([f, Math.round(maxd)]);
  }
  return out;
});
console.log("bone spread after freezing translations:", JSON.stringify(spread));

const canvas = page.locator("#c");
const fitted = await page.evaluate(() => window._mv.getCamera());
console.log("fitted", JSON.stringify(fitted));
for (const [name, theta] of [["left", Math.PI / 2], ["front", 0]]) {
  await page.evaluate(({ theta, dist, target }) => window._mv.setCamera({ theta, phi: 0.3, dist, target }), {
    theta, dist: fitted.dist * 0.7, target: fitted.target,
  });
  for (const f of [0, 80, 160, 240, 320]) {
    await page.evaluate((x) => window._mv.setFrame(x), f);
    await page.waitForTimeout(180);
    writeFileSync(`${OUT}/${name}_${f}.png`, await canvas.screenshot());
  }
}
await browser.close();
console.log("done", OUT);
