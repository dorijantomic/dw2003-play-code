// Seam probe — do the sprites that fill the stitched base map's cut-outs stay
// joined to it when the camera stands on a fractional pixel?
//
// The frame is cleared to #000 before the map is drawn, so any gap between a
// cut-out and the sprite that fills it shows up as pure-black pixels inside the
// picture. This parks the camera on each point-sprite record of a stage, sweeps
// the player position over one whole pixel in 1/8 steps, and counts pure-black
// pixels in a window around the record.
//
// Needs the web root served:  python3 -m http.server 8742 --directory web
// Run:  tools/run-playwright.sh tools/diag_map_seam.mjs <outdir> <label> [stage]
import { chromium } from "playwright";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";

const out = process.argv[2] ?? "/tmp/seam";
const label = process.argv[3] ?? "run";
const stage = process.argv[4] ?? "s206";
mkdirSync(out, { recursive: true });
const records = JSON.parse(readFileSync("web/assets/data/point_sprites.json", "utf8"))[stage].records;

const browser = await chromium.launch({
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1000, height: 760 } });
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
await page.addInitScript(() => localStorage.setItem("assetMode", "authentic"));
await page.goto(`http://127.0.0.1:8742/index.html?skipTitle=1&noEncounters=1&map=${stage}`,
  { waitUntil: "load" });
await page.waitForFunction(() => window.__state && window.__state.mapImgs &&
  Object.keys(window.__state.mapImgs).length > 0, null, { timeout: 20000 });
await page.waitForTimeout(1500);

const rows = [];
for (const rec of records) {
  const phases = [];
  for (let i = 0; i < 8; i++) {
    const frac = i / 8;
    const r = await page.evaluate(async ([x, y, frac]) => {
      const s = window.__state;
      s.x = x + frac; s.y = y; s.moving = false;
      await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
      const cv = document.querySelector("canvas");
      const g = cv.getContext("2d");
      // the record sits at the view centre; sample a 200x200 device-px window there
      const w = 200, h = 200;
      const ox = Math.floor(cv.width / 2 - w / 2), oy = Math.floor(cv.height / 2 - h / 2);
      const d = g.getImageData(ox, oy, w, h).data;
      let black = 0, worstRun = 0;
      for (let yy = 0; yy < h; yy++) {
        let run = 0;
        for (let xx = 0; xx < w; xx++) {
          const o = (yy * w + xx) * 4;
          if (d[o] === 0 && d[o + 1] === 0 && d[o + 2] === 0 && d[o + 3] === 255) {
            black++; run++; if (run > worstRun) worstRun = run;
          } else run = 0;
        }
      }
      return { black, worstRun };
    }, [rec.x, rec.y, frac]);
    phases.push(r);
  }
  const blacks = phases.map((p) => p.black);
  rows.push({
    x: rec.x, y: rec.y, mode: rec.mode,
    min: Math.min(...blacks), max: Math.max(...blacks),
    spread: Math.max(...blacks) - Math.min(...blacks),
    worstRun: Math.max(...phases.map((p) => p.worstRun)),
  });
}
rows.sort((a, b) => b.spread - a.spread);
console.log(label, "top phase-dependent black:", JSON.stringify(rows.slice(0, 8)));
console.log(label, "records with any phase spread:", rows.filter((r) => r.spread > 0).length, "/", rows.length);
writeFileSync(`${out}/${label}-${stage}.json`, JSON.stringify(rows, null, 1));
if (errs.length) console.log("page errors:", errs.slice(0, 5));
await browser.close();
