// Headless smoke test for web/fight-action-lab.html. Confirms the page loads with no JS errors,
// WebGL renders, composing a sequence + the script cross-check work end-to-end. Run via the
// playwright-shot harness:  ~/.local/share/playwright-shot/run.sh tools/verify_action_lab.mjs
import { baseUrl } from "./verify-base-url.mjs";

// Launch goes through `import { chromium } from "playwright"` with no
// executablePath, like tools/verify_blast.mjs: a pinned browser build number
// goes stale the moment `npm install` moves Playwright on, and this one named a
// build (1223) that is no longer installed on any machine here.
import { chromium } from "playwright";
const URL = process.env.LAB_URL || `${baseUrl(8743)}/fight-action-lab.html`;
const OUT = process.env.OUT || "/tmp/action-lab.png";

const browser = await chromium.launch({
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
});
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1140, height: 620 } });
  page.on("pageerror", e => errors.push("JS: " + e.message));
  // Flag any failed resource by URL (ignore the favicon.ico 404 every headless page emits,
  // and slot_map.json, the OPTIONAL per-model override no shipped pack carries).
  page.on("response", res => {
    if (res.status() >= 400 && !/favicon/i.test(res.url()) && !res.url().endsWith("/slot_map.json")) {
      errors.push(`HTTP ${res.status()} ${res.url()}`);
    }
  });
  await page.goto(URL, { waitUntil: "load" });
  // palette is populated only after the model + timeline load
  await page.waitForFunction(() => document.querySelectorAll("#palette button").length > 0, { timeout: 20000 });

  // Compose the basic ATTACK the docs claim: tables 14,15,16,17,18 (clicking palette buttons).
  for (const idx of [14, 15, 16, 17, 18]) {
    await page.evaluate((i) => {
      const b = [...document.querySelectorAll("#palette button")].find(x => x.textContent.trim().startsWith("table " + i + " "));
      if (b) b.click();
    }, idx);
  }
  await page.click("#play");
  await page.selectOption("#labelSel", "ATTACK");
  await page.click("#reveal");
  await new Promise(r => setTimeout(r, 1500));

  const reveal = await page.$eval("#reveal", el => el.textContent);
  const seqChips = await page.$$eval("#seq .chip", els => els.map(e => e.textContent));
  await page.screenshot({ path: OUT });

  const matched = /✓ match/.test(reveal);
  console.log("seq chips:", seqChips.join(","));
  console.log("reveal:", reveal.replace(/\n/g, " | "));
  console.log("ATTACK cross-check matched script clip 5:", matched);
  console.log("page errors:", errors.length ? errors.join(" ;; ") : "none");
  console.log("WROTE", OUT);
  process.exit(errors.length === 0 && matched ? 0 : 1);
} finally {
  await browser.close();
}
