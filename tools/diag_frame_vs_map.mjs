// Is a line the player sees painted by the renderer, or is it in the artwork?
//
// Parks the seam lab's camera on a whole pixel, hides the props and the party,
// captures the frame, and writes it next to the same rectangle cut straight out
// of web/assets/maps/<stage>.png. A pixel that differs is the renderer adding
// something; a line present in BOTH is in the picture we ship.
//
// Needs the web root served:  python3 -m http.server 8742 --directory web
// Run:  tools/run-playwright.sh tools/diag_frame_vs_map.mjs <stage> <camX> <camY> [outdir]
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const stage = process.argv[2] ?? "s205";
const cx = Number(process.argv[3] ?? 300);
const cy = Number(process.argv[4] ?? 400);
const out = process.argv[5] ?? "/tmp/frame-vs-map";
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
await page.goto("http://127.0.0.1:8742/seam-lab.html", { waitUntil: "load" });
await page.waitForFunction(() => window.__seamLab?.ready(), null, { timeout: 30000 });
await page.evaluate((s) => window.__seamLab.setMapById(s), stage);
await page.waitForTimeout(5000);  // let the entry wipe and the title card finish

const shot = await page.evaluate(async ([x, y]) => {
  const f = document.getElementById("game");
  const w = f.contentWindow, d = f.contentDocument;
  if (w.__textbox) w.__textbox.dialogue = null;
  w.__hideProps = true;
  w.__state.x = -4000; w.__state.y = -4000;   // park the party off the picture
  w.__labCam(x, y);
  await new Promise((r) => w.requestAnimationFrame(() => w.requestAnimationFrame(r)));
  const cv = d.getElementById("game");
  const info = w.__mapInfo();
  return { png: cv.toDataURL("image/png"), cam: { ...w.__cam }, zoom: info.zoom, w: cv.width, h: cv.height };
}, [cx, cy]);

writeFileSync(`${out}/${stage}-frame.png`, Buffer.from(shot.png.split(",")[1], "base64"));
writeFileSync(`${out}/${stage}-frame.json`, JSON.stringify(shot, null, 1));
console.log(`frame written: cam ${shot.cam.x},${shot.cam.y} zoom ${shot.zoom} canvas ${shot.w}x${shot.h}`);
console.log(`compare with: web/assets/maps/${stage}.png at that offset`);
await browser.close();
