// Capture the Asuka-plaza tree at the positions the occlusion report names,
// through the REAL web/game.js renderer.
//
//   python3 -m http.server 8742 --directory web
//   tools/run-playwright.sh tools/capture_s202_occlusion.mjs <outDir> <tag>
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const OUT = process.argv[2] ?? "/tmp/s202";
const TAG = process.argv[3] ?? "shot";
const MAP = process.argv[4] ?? "s202";
const PORT = 8742;
// "x,y;x,y" on argv[5], else the four positions from the s202 occlusion report.
const SPOTS = process.argv[5]
    ? process.argv[5].split(";").map((p) => p.split(",").map(Number))
    : [[460, 220], [560, 250], [540, 280], [600, 230]];

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1024, height: 900 } });
page.on("pageerror", (e) => console.log("pageerror:", e.message));

await page.addInitScript(() => {
    localStorage.setItem("assetMode", "authentic");
    localStorage.setItem("seenAssetChooser", "1");
});
await page.goto(`http://127.0.0.1:${PORT}/index.html?skipTitle=1&map=${MAP}`, {
    waitUntil: "load",
});
await page.waitForFunction(() => typeof window.__teleport === "function", { timeout: 20000 });
// Let the map-name intro finish. Comparing two runs caught mid-animation makes
// the banner text differ and pollutes a before/after pixel diff.
await page.waitForTimeout(6000);

for (const [x, y] of SPOTS) {
    await page.evaluate(([px, py]) => window.__teleport(px, py), [x, y]);
    await page.waitForTimeout(1200);
    const canvas = page.locator("canvas").first();
    await canvas.screenshot({ path: `${OUT}/${TAG}-${x}-${y}.png` });
    console.log(`captured ${TAG} at (${x},${y})`);
}
await browser.close();
