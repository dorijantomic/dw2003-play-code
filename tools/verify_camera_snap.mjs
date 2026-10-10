// The map must never be resampled: every camera position has to draw the same
// picture, moved by a whole number of device pixels.
//
// The player walks in fractions of a pixel, so before web/game.js snapped the
// camera to the device grid the canvas sampled the map unevenly — at a
// half-pixel offset some map columns were drawn one device pixel wide and
// others two, so the artwork's own one-pixel dark lines changed thickness as
// you walked. This asserts the property that fix establishes.
//
// Needs the web root served:  python3 -m http.server 8742 --directory web
// (or VERIFY_PORT=<port> with a server on that port)
// Run:  tools/run-playwright.sh tools/verify_camera_snap.mjs [stage…]
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { baseUrl } from "./verify-base-url.mjs";

const STAGES = process.argv.slice(2).length ? process.argv.slice(2) : ["s205", "s206"];

const browser = await chromium.launch({
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
await page.goto(`${baseUrl(8742)}/seam-lab.html`, { waitUntil: "load" });
await page.waitForFunction(() => window.__seamLab?.ready(), null, { timeout: 30000 });

for (const stage of STAGES) {
  await page.evaluate((s) => window.__seamLab.setMapById(s), stage);
  await page.waitForTimeout(5000);          // entry wipe and title card

  // Grab the raw pixels at a whole pixel and at seven fractions of one.
  const frames = await page.evaluate(async () => {
    const f = document.getElementById("game"), w = f.contentWindow, d = f.contentDocument;
    if (w.__textbox) w.__textbox.dialogue = null;
    w.__hideProps = true;
    w.__state.x = -4000; w.__state.y = -4000;   // park the party off the picture
    const cv = d.getElementById("game"), g = cv.getContext("2d");
    const out = [];
    for (let i = 0; i < 8; i++) {
      w.__labCam(300 + i / 8, 420);
      await new Promise((r) => w.requestAnimationFrame(() => w.requestAnimationFrame(r)));
      const px = g.getImageData(0, 0, cv.width, cv.height).data;
      out.push({ cam: w.__cam.x, px: Array.from(px), w: cv.width, h: cv.height });
    }
    w.__hideProps = false;
    return out;
  });

  const base = frames[0];
  for (const fr of frames.slice(1)) {
    // The camera may only have moved by whole device pixels.
    const shift = Math.round((fr.cam - base.cam) * 2);
    assert.equal((fr.cam - base.cam) * 2, shift,
      `${stage}: camera landed between device pixels at ${fr.cam}`);
    let bad = 0;
    // The camera moved right, so the picture moved LEFT: fr[x] == base[x + shift].
    for (let y = 0; y < fr.h; y++) {
      for (let x = 0; x + shift < fr.w; x++) {
        const a = (y * fr.w + x) * 4, b = (y * base.w + x + shift) * 4;
        if (fr.px[a] !== base.px[b] || fr.px[a + 1] !== base.px[b + 1] || fr.px[a + 2] !== base.px[b + 2]) bad++;
      }
    }
    assert.equal(bad, 0,
      `${stage}: camera ${fr.cam} is not the base frame moved by ${shift} device px (${bad} pixels differ)`);
  }
  console.log(`${stage}: 8 camera positions, every one a whole-pixel translation of the first`);
}
assert.deepEqual(errs, []);
await browser.close();
