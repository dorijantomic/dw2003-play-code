// Frame the MAIN cluster of a battle model's bones (outlier part bones inflate the auto-fit), then render a strip.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const folder = process.argv[2] ?? "m140mtrn";
const OUT = process.argv[3] ?? `/home/dorij/scratch-research/giant/cluster-${folder}`;
const FRAMES = Number(process.argv[4] ?? 8);
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ["--use-gl=angle", "--use-angle=swiftshader"] });
const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
page.on("pageerror", (e) => console.log("ERR", e.message));
await page.goto(`${baseUrl(8770)}/model-viewer.html?model=${folder}`);
await page.waitForFunction(() => window._model && window._mv && window._b3d, null, { timeout: 60000 });
await page.waitForTimeout(800);
await page.evaluate(() => { window._mv.clear = [0, 1, 0, 1]; document.getElementById("overlay").style.display = "none"; });

const report = await page.evaluate(() => {
  const m = window._model;
  const boxes = [];
  for (let f of [0, 100, 200, 300]) {
    const { mats } = window._b3d.buildBoneWorldMatrices(m, f);
    const rows = m.bones.map((b, i) => {
      const vs = b.verts || [];
      if (!vs.length) return null;
      const M = mats[i];
      let lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
      for (const v of vs) {
        const x = M[0] * v[0] + M[4] * v[1] + M[8] * v[2] + M[12];
        const y = M[1] * v[0] + M[5] * v[1] + M[9] * v[2] + M[13];
        const z = M[2] * v[0] + M[6] * v[1] + M[10] * v[2] + M[14];
        lo = [Math.min(lo[0], x), Math.min(lo[1], y), Math.min(lo[2], z)];
        hi = [Math.max(hi[0], x), Math.max(hi[1], y), Math.max(hi[2], z)];
      }
      return { i, n: vs.length, c: [Math.round((lo[0] + hi[0]) / 2), Math.round((lo[1] + hi[1]) / 2), Math.round((lo[2] + hi[2]) / 2)], size: Math.round(Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2])) };
    }).filter(Boolean);
    boxes.push({ f, rows });
  }
  return boxes;
});
for (const b of report) {
  console.log(`frame ${b.f}: ` + b.rows.map((r) => `${r.i}:${r.size}@${r.c[0]},${r.c[1]},${r.c[2]}`).join(" "));
}
// The main cluster: bones within 1200 units of the biggest bone box's centre.
const pick = (() => {
  const rows = report[0].rows;
  const big = [...rows].sort((a, b) => b.size - a.size)[0];
  const keep = rows.filter((r) => Math.hypot(r.c[0] - big.c[0], r.c[1] - big.c[1], r.c[2] - big.c[2]) < 1400);
  let lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  for (const r of keep) { /* the centre +- size/2 is enough for a camera box */ }
  for (const r of keep) {
    lo = [Math.min(lo[0], r.c[0] - r.size / 2), Math.min(lo[1], r.c[1] - r.size / 2), Math.min(lo[2], r.c[2] - r.size / 2)];
    hi = [Math.max(hi[0], r.c[0] + r.size / 2), Math.max(hi[1], r.c[1] + r.size / 2), Math.max(hi[2], r.c[2] + r.size / 2)];
  }
  return { bones: keep.map((r) => r.i), lo, hi };
})();
console.log("main cluster", JSON.stringify(pick.bones), "box", pick.lo.map(Math.round), pick.hi.map(Math.round));

const center = [(pick.lo[0] + pick.hi[0]) / 2, (pick.lo[1] + pick.hi[1]) / 2, (pick.lo[2] + pick.hi[2]) / 2];
const radius = 0.5 * Math.hypot(pick.hi[0] - pick.lo[0], pick.hi[1] - pick.lo[1], pick.hi[2] - pick.lo[2]);
const dist = radius / Math.tan(Math.PI / 8) * 1.15;
console.log("camera center", center.map(Math.round), "radius", Math.round(radius), "dist", Math.round(dist));
const modelScale = 0.85;
const view = (theta) => page.evaluate((t) => window._mv.setCamera(t), {
  theta, phi: 0.3, dist: t.dist, target: t.target,
}, ).catch(() => {});
const setView = (theta) => page.evaluate(({ theta, dist, target }) => {
  window._mv.setCamera({ theta, phi: 0.3, dist, target });
}, { theta, dist, target: [center[0] * modelScale, -center[1] * modelScale, center[2] * modelScale] });

const canvas = page.locator("#c");
const snap = async (file) => writeFileSync(file, await canvas.screenshot());
for (const [name, theta] of [["left", Math.PI / 2], ["down-left", Math.PI / 4], ["front", 0], ["right", -Math.PI / 2]]) {
  await setView(theta);
  for (let k = 0; k < FRAMES; k++) {
    const f = Math.round(342 * (k + 0.5) / FRAMES);
    await page.evaluate((x) => window._mv.setFrame(x), f);
    await page.waitForTimeout(140);
    await snap(`${OUT}/${name}_${k}.png`);
  }
}
await browser.close();
console.log("done", OUT);
