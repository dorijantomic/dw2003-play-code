// Which frames of a battle model's timeline keep all its parts together?
// Loads web/model-viewer.html?model=<folder>, then for every N frames computes the spread of the bones'
// world positions (the one with the smallest spread is the most coherent pose).
import { chromium } from "playwright";
import { baseUrl } from "./verify-base-url.mjs";

const folder = process.argv[2] ?? "m140mtrn";
const step = Number(process.argv[3] ?? 5);
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
page.on("pageerror", (e) => console.log("ERR", e.message));
await page.goto(`${baseUrl(8770)}/model-viewer.html?model=${folder}`);
await page.waitForFunction(() => window._model && window._b3d, null, { timeout: 60000 });
await page.waitForTimeout(600);
const rows = await page.evaluate(({ step }) => {
  const m = window._model;
  const out = [];
  for (let f = 0; f <= 380; f += step) {
    const { mats } = window._b3d.buildBoneWorldMatrices(m, f);
    const pts = mats.map((M) => [M[12], M[13], M[14]]);
    let maxd = 0;
    for (let i = 0; i < pts.length; i++)
      for (let j = i + 1; j < pts.length; j++)
        maxd = Math.max(maxd, Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1], pts[i][2] - pts[j][2]));
    // count bones whose own translation is far from the first bone's
    const spread = pts.map((p) => Math.hypot(p[0] - pts[0][0], p[1] - pts[0][1], p[2] - pts[0][2]));
    out.push({ f, maxd: Math.round(maxd), far: spread.map((d) => Math.round(d)) });
  }
  return { out, clips: m.clips?.filter((c) => c.present).map((c) => [c.index, c.start_frame, c.end_frame]), frames: m.total_frames };
}, { step });
console.log("clips", JSON.stringify(rows.clips), "total", rows.frames);
const sorted = [...rows.out].sort((a, b) => a.maxd - b.maxd);
console.log("tightest frames:", sorted.slice(0, 10).map((r) => `${r.f}=${r.maxd}`).join(" "));
console.log("widest frames:", sorted.slice(-5).map((r) => `${r.f}=${r.maxd}`).join(" "));
console.log("by frame:", rows.out.map((r) => `${r.f}:${r.maxd}`).join(" "));
await browser.close();
