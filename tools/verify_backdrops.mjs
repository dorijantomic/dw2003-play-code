// Headless verify: per-element special-attack backdrops render in battle-lab.
// For each (label, techId) it forces the backdrop on via window.__r.setDataField(true, techId),
// waits for dataFieldActive, and screenshots. Run: ~/.local/share/playwright-shot/run.sh tools/verify_backdrops.mjs
import { baseUrl } from "./verify-base-url.mjs";

const pkg = await import(`${process.env.HOME}/.local/share/playwright-shot/node_modules/playwright-core/index.js`);
const { chromium } = pkg.default ?? pkg;
const URL = process.env.LAB_URL || `${baseUrl(8743)}/battle-lab.html`;
const OUTDIR = process.env.OUTDIR || "/tmp/claude-1000/-home-dorij-ddw3-walker/41a7780a-0cdc-4dcb-9ece-48846dff6010/scratchpad";
const chromePath = `${process.env.HOME}/.cache/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-linux64/chrome-headless-shell`;

// tech id → label. 144=Inferno(fire), 156=Thunder Bolt(thunder), 149=Ice Blow(ice), 59=Diamond Storm(sig0 data-field)
const CASES = [[144, "fire-inferno"], [156, "thunder-bolt"], [149, "ice-blow"], [59, "dstorm-datafield"], [1, "basic-nobackdrop"]];

const browser = await chromium.launch({
  executablePath: chromePath,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
});
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1140, height: 720 } });
  page.on("pageerror", e => errors.push("JS: " + e.message));
  // slot_map.json is an OPTIONAL per-model override the loader probes for and
  // copes without: no shipped model carries one (`ls web/assets/battle/models/*/slot_map.json` = 0).
  // Its 404 is the absence of an optional file, not a page fault, and the sibling
  // checks already say so (tools/verify_custom_greymon_texture.mjs:13,
  // tools/verify_generated_model.mjs:44, tools/verify_proj_layers.mjs:118).
  page.on("response", res => {
    if (res.status() >= 400 && !/favicon/i.test(res.url()) && !res.url().endsWith("/slot_map.json")) {
      errors.push(`HTTP ${res.status()} ${res.url()}`);
    }
  });
  await page.goto(URL, { waitUntil: "load" });
  await page.waitForFunction(() => window.__r && typeof window.__r.setDataField === "function", { timeout: 20000 });

  for (const [techId, label] of CASES) {
    await page.evaluate((t) => { window.__r.setDataField(false); window.__r.setDataField(true, t); }, techId);
    // let the pack's atlas + geometry load (async fetch), poll dataFieldActive up to 8s
    let active = false;
    for (let i = 0; i < 40; i++) {
      active = await page.evaluate(() => window.__r.dataFieldActive === true);
      if (active) break;
      await new Promise(r => setTimeout(r, 200));
    }
    await new Promise(r => setTimeout(r, 900));  // render a few frames
    await page.screenshot({ path: `${OUTDIR}/bd_${label}.png` });
    console.log(`${label} (tech ${techId}): dataFieldActive=${active}`);
  }
} finally {
  await browser.close();
}
if (errors.length) { console.log("PAGE ERRORS:\n" + errors.join("\n")); process.exit(1); }
console.log("done");
