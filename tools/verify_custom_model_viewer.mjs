import assert from "node:assert/strict";
import { chromium } from "playwright";
import { baseUrl } from "./verify-base-url.mjs";

const model = process.argv[2] ?? "m005tri";
const capture = process.argv[3] ?? `/tmp/${model}-model-viewer.png`;
const base = process.env.LAB_URL ?? `${baseUrl(7771)}/web/model-viewer.html`;
const baseline = process.env.BASELINE === "1";
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const url = new URL(base);
  if (!baseline) url.searchParams.set("model", model);
  await page.goto(url.href, { waitUntil: "networkidle" });
  if (process.env.CLIP != null) {
    await page.locator("#clipSel").selectOption(process.env.CLIP);
  }
  if (process.env.FRAME != null) {
    await page.locator("#autoPlay").uncheck();
    await page.locator("#frameScrub").evaluate((slider, frame) => {
      slider.value = String(frame);
      slider.dispatchEvent(new Event("input", { bubbles: true }));
    }, process.env.FRAME);
  }
  if (process.env.ORBIT_PIXELS) {
    const box = await page.locator("#c").boundingBox();
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + Number(process.env.ORBIT_PIXELS),
      y + Number(process.env.ORBIT_VERTICAL_PIXELS ?? 0), { steps: 12 });
    await page.mouse.up();
  }
  await page.waitForTimeout(700);
  const info = await page.evaluate(() => {
    const canvas = document.querySelector("#c");
    const gl = canvas.getContext("webgl");
    return { selected: document.querySelector("#modelSel").value,
      contextLost: gl.isContextLost(), width: canvas.width, height: canvas.height };
  });
  console.log(JSON.stringify({ model, ...info, errors, capture }));
  assert.equal(info.selected, baseline ? "m373rena" : model);
  assert.equal(info.contextLost, false);
  assert.deepEqual(errors, []);
  await page.locator("#c").screenshot({ path: capture });
} finally {
  await browser.close();
}
