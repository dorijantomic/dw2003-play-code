import assert from "node:assert/strict";
import { chromium } from "playwright";
import { baseUrl } from "./verify-base-url.mjs";

const browser = await chromium.launch();
try {
  const model = process.env.MODEL ?? "m005grey";
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("response", response => {
    if (response.status() >= 400 &&
        !(response.status() === 404 && response.url().endsWith("/slot_map.json"))) {
      errors.push(`${response.status()} ${response.url()}`);
    }
  });
  await page.goto(process.env.LAB_URL ?? `${baseUrl(8742)}/battle-lab.html`, { waitUntil: "networkidle" });
  await page.selectOption("#pModel", model);
  await page.waitForTimeout(1800);
  const info = await page.evaluate(() => {
    const gl = document.querySelector("#cv").getContext("2d");
    const pixels = gl.getImageData(0, 0, 960, 672).data;
    let colored = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i] > pixels[i + 1] * 1.2 && pixels[i] > pixels[i + 2] * 1.2 && pixels[i] > 70) colored++;
    }
    const r = window.__r;
    return { colored, status: document.querySelector("#status").textContent,
      contextLost: r?.gl?.isContextLost(), glError: r?.gl?.getError() };
  });
  await page.locator("#cv").screenshot({ path: process.argv[2] });
  console.log(JSON.stringify({ model, ...info, errors }));
  assert.ok(info.colored > 1000, "custom Greymon texture should show visible color");
  assert.deepEqual(errors, [], "battle viewer should have no page errors");
} finally {
  await browser.close();
}
