import { readFile } from "node:fs/promises";
import { chromium } from "playwright";

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.route("**/assets/battle/models/m005grey/anim.json", async route =>
    route.fulfill({ body: await readFile("/tmp/m005bones.json"), contentType: "application/json" }));
  await page.route("**/assets/battle/textures/m005grey.png", async route =>
    route.fulfill({ body: await readFile("/tmp/m005bones.png"), contentType: "image/png" }));
  await page.goto("http://127.0.0.1:8742/battle-lab.html", { waitUntil: "networkidle" });
  await page.selectOption("#pModel", "m005grey");
  await page.waitForTimeout(1200);
  await page.locator("#cv").screenshot({ path: process.argv[2] });
} finally {
  await browser.close();
}
