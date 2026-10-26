// Try phase-locking every bone's animation channel to one common loop, then look at the model.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const folder = process.argv[2] ?? "m140mtrn";
const OUT = process.argv[3] ?? `/home/dorij/scratch-research/giant/phase-${folder}`;
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ["--use-gl=angle", "--use-angle=swiftshader"] });
const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
page.on("pageerror", (e) => console.log("ERR", e.message));
await page.goto(`${baseUrl(8770)}/model-viewer.html?model=${folder}`);
await page.waitForFunction(() => window._model && window._mv && window._b3d, null, { timeout: 60000 });
await page.waitForTimeout(800);
await page.evaluate(() => { window._mv.clear = [0, 1, 0, 1]; document.getElementById("overlay").style.display = "none"; });

const info = await page.evaluate(() => {
  const m = window._model;
  const ranges = m.bones.map((b) => {
    const r = [];
    for (const ch of [b.anim?.ch1, b.anim?.ch2]) {
      if (!ch) { r.push(null); continue; }
      const ts = ch.filter((k) => k[3] !== 30000).map((k) => k[3]);
      r.push(ts.length ? [Math.min(...ts), Math.max(...ts), ts.length] : null);
    }
    return r;
  });
  return { ranges, total: m.total_frames, clips: m.clips?.filter((c) => c.present) };
});
console.log("ranges", JSON.stringify(info.ranges));
console.log("clips", JSON.stringify(info.clips));

// Phase-lock: every channel's keys are remapped so its own [t0,t1] becomes [0, LEN].
const LEN = 240;
await page.evaluate((LEN) => {
  const m = window._model;
  for (const b of m.bones) {
    for (const name of ["ch1", "ch2"]) {
      const ch = b.anim?.[name];
      if (!ch || ch.length < 2) continue;
      const ts = ch.filter((k) => k[3] !== 30000).map((k) => k[3]);
      const t0 = Math.min(...ts), t1 = Math.max(...ts);
      if (!(t1 > t0)) continue;
      b.anim[name] = ch.map((k) => (k[3] === 30000 ? k : [k[0], k[1], k[2], Math.round(((k[3] - t0) / (t1 - t0)) * LEN)]));
    }
  }
}, LEN);

const canvas = page.locator("#c");
const snap = async (file) => writeFileSync(file, await canvas.screenshot());
const fitted = await page.evaluate(() => window._mv.getCamera());
console.log("fitted", JSON.stringify(fitted));
const view = (cam) => page.evaluate((t) => window._mv.setCamera(t), cam);
for (const [name, theta] of [["left", Math.PI / 2], ["front", 0], ["down-left", Math.PI / 4]]) {
  await view({ theta, phi: 0.3, dist: fitted.dist * 1.6 });
  for (let k = 0; k < 6; k++) {
    const f = Math.round((k / 6) * LEN);
    await page.evaluate((x) => window._mv.setFrame(x), f);
    await page.waitForTimeout(120);
    await snap(`${OUT}/${name}_${k}.png`);
  }
}
await browser.close();
console.log("done", OUT);
