// EXPERIMENT: screenshot a stage with and without the 3D grass.
// Needs the web root served:  python3 -m http.server 8743 --directory web
// Run: tools/run-playwright.sh tools/shot_grass3d.mjs <stage> <x> <y> <outPrefix> [frames]
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const [stage, px, py, out] = [process.argv[2], +process.argv[3], +process.argv[4], process.argv[5]];
const frames = +(process.argv[6] ?? 1);
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
const logs = [];
page.on("console", (m) => { const t = m.text(); if (/grass3d|error/i.test(t)) logs.push(t); });
page.on("pageerror", (e) => logs.push("PAGEERROR " + e.message));
await page.goto("http://127.0.0.1:8743/seam-lab.html", { waitUntil: "load" });
await page.waitForFunction(() => window.__seamLab?.ready(), null, { timeout: 60000 });
await page.evaluate((s) => window.__seamLab.setMapById(s), stage);
await page.waitForTimeout(5000);

for (const mode of ["on", "off"]) {
  const t0 = Date.now();
  const png = await page.evaluate(async ([x, y, mode, frames]) => {
    const f = document.getElementById("game"), w = f.contentWindow, d = f.contentDocument;
    if (w.__textbox) w.__textbox.dialogue = null;
    w.__noGrass3d = mode === "off";
    w.__state.x = x; w.__state.y = y; w.__state.dir = "down";
    w.__labCam(x, y);
    for (let i = 0; i < frames + 2; i++) await new Promise((r) => w.requestAnimationFrame(r));
    return d.getElementById("game").toDataURL("image/png");
  }, [px, py, mode, frames]);
  writeFileSync(out + "-" + mode + ".png", Buffer.from(png.split(",")[1], "base64"));
  console.log("wrote", out + "-" + mode + ".png", "(" + (Date.now() - t0) + " ms for " + (frames + 2) + " frames)");
}
console.log(logs.join("\n"));
await browser.close();
