// Capture the ordinary battle arena (no special backdrop) and a special backdrop, headless.
// Run: VERIFY_PORT=8741 tools/run-playwright.sh tools/verify_arena_backdrop_probe.mjs
import { baseUrl } from "./verify-base-url.mjs";
const pkg = await import(`${process.env.HOME}/.local/share/playwright-shot/node_modules/playwright-core/index.js`);
const { chromium } = pkg.default ?? pkg;
const URL = process.env.LAB_URL || `${baseUrl(8741)}/battle-lab.html`;
const OUTDIR = process.env.OUTDIR || "/tmp";
const chromePath = `${process.env.HOME}/.cache/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-linux64/chrome-headless-shell`;
const browser = await chromium.launch({ executablePath: chromePath, args: ['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--enable-webgl'] });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1140, height: 720 } });
  page.on("pageerror", e => errors.push("JS: " + e.message));
  await page.goto(URL, { waitUntil: "load" });
  await page.waitForFunction(() => window.__r && typeof window.__r.setDataField === "function", { timeout: 20000 });
  await page.evaluate(() => window.__r.setDataField(false));
  await new Promise(r => setTimeout(r, 1500));
  await page.screenshot({ path: `${OUTDIR}/arena_ordinary.png` });
  console.log("ordinary arena: dataFieldActive=", await page.evaluate(() => window.__r.dataFieldActive));
} finally { await browser.close(); }
if (errors.length) { console.log("PAGE ERRORS:\n" + errors.join("\n")); process.exit(1); }
console.log("done");
