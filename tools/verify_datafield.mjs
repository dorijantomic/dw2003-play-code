// Headless verify: the special-attack digital data-field backdrop (MEFT1055) renders in battle-lab.
// Loads the lab, waits for the renderer handle, forces the field on, screenshots.
// Run:  ~/.local/share/playwright-shot/run.sh tools/verify_datafield.mjs
import { baseUrl } from "./verify-base-url.mjs";

const pkg = await import(`${process.env.HOME}/.local/share/playwright-shot/node_modules/playwright-core/index.js`);
const { chromium } = pkg.default ?? pkg;
const URL = process.env.LAB_URL || `${baseUrl(8743)}/battle-lab.html`;
const OUT = process.env.OUT || "/tmp/datafield.png";
const OUT_OFF = process.env.OUT_OFF || "/tmp/datafield-off.png";
const chromePath = `${process.env.HOME}/.cache/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-linux64/chrome-headless-shell`;

const browser = await chromium.launch({
  executablePath: chromePath,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
});
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1140, height: 720 } });
  page.on("pageerror", e => errors.push("JS: " + e.message));
  page.on("response", res => { if (res.status() >= 400 && !/favicon/i.test(res.url())) errors.push(`HTTP ${res.status()} ${res.url()}`); });
  await page.goto(URL, { waitUntil: "load" });

  // Renderer handle + the datafield geometry must be loaded before we can show it.
  await page.waitForFunction(() => window.__r && typeof window.__r.setDataField === "function", { timeout: 20000 });
  // geometry.json loads async; poll until pieces exist by toggling on and reading dataFieldActive.
  await page.waitForFunction(() => {
    window.__r.setDataField(true);
    return window.__r.dataFieldActive === true;
  }, { timeout: 20000 });

  await new Promise(r => setTimeout(r, 1200));  // let a few frames render + blit
  const camInfo = await page.evaluate(() => window.__r.getCameraInfo && window.__r.getCameraInfo());
  await page.screenshot({ path: OUT });

  // Off state for comparison.
  await page.evaluate(() => window.__r.setDataField(false));
  await new Promise(r => setTimeout(r, 800));
  await page.screenshot({ path: OUT_OFF });

  console.log("dataFieldActive was:", true);
  console.log("cameraInfo:", JSON.stringify(camInfo));
  console.log("page errors:", errors.length ? errors.join(" ;; ") : "none");
  console.log("WROTE", OUT, "and", OUT_OFF);
} finally {
  await browser.close();
}
