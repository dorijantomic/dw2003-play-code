// Capture the party standing under a stage's foreground-overlay art.
//
// The overlay layer draws OVER the player, so it is where a half-transparent
// map texel is actually visible: left at half alpha the player shows through
// art the console draws solid.
//
// Needs the web root served:  python3 -m http.server 8742 --directory web
// Run: tools/run-playwright.sh tools/diag_map_fg_shot.mjs <stage> <x> <y> <out.png>
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const [stage, px, py, out] = [process.argv[2], +process.argv[3], +process.argv[4], process.argv[5]];
const browser = await chromium.launch({
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
await page.goto("http://127.0.0.1:8742/seam-lab.html", { waitUntil: "load" });
await page.waitForFunction(() => window.__seamLab?.ready(), null, { timeout: 30000 });
await page.evaluate((s) => window.__seamLab.setMapById(s), stage);
await page.waitForTimeout(5000);          // entry wipe and location title card

const png = await page.evaluate(async ([x, y]) => {
  const f = document.getElementById("game"), w = f.contentWindow, d = f.contentDocument;
  if (w.__textbox) w.__textbox.dialogue = null;
  w.__hideProps = true;
  w.__state.x = x; w.__state.y = y; w.__state.dir = "down";
  w.__labCam(x, y);
  await new Promise((r) => w.requestAnimationFrame(() => w.requestAnimationFrame(r)));
  return d.getElementById("game").toDataURL("image/png");
}, [px, py]);

writeFileSync(out, Buffer.from(png.split(",")[1], "base64"));
await browser.close();
console.log("wrote", out);
