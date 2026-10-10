// Dump the live native text widgets with their decoded string and the font codes
// the decoder could not map, so text-fidelity gaps are measured rather than
// guessed. Env: MOD (module id, default pro/stfgtrep).
// Run: MOD=pro/stfgtrep .opencode/autonomy/check-browser tools/dump_native_screen_text.mjs
import { chromium } from "playwright";
import { baseUrl } from "./verify-base-url.mjs";
const ROOT = process.env.NATIVE_SCREEN_ROOT || `${baseUrl(8742)}/`;
const MOD = process.env.MOD || "pro/stfgtrep";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 960, height: 720 } });
await page.goto(`${ROOT}ui-lab.html`, { waitUntil: "domcontentloaded" });
await page.click('button[data-scr="nativescreen"]');
await page.waitForURL(/native-screen-lab\.html/);
await page.waitForFunction(() => window.__nativeScreen?.()?.screensLoaded === 20, null, { timeout: 10000 });
await page.evaluate((m) => window.__nativeScreenBoot(m), MOD);
if (process.env.SEED) {
  const seed = JSON.parse(process.env.SEED);
  await page.evaluate((sd) => window.__nativeScreenSeedParty(sd), seed);
}
await page.waitForFunction((m) => { const s = window.__nativeScreen(); return s.booted && s.frames >= 45; }, MOD, { timeout: 10000 });
const dump = await page.evaluate(() => window.__nativeScreenTextDump());
const rows = [];
for (const w of dump) for (let i = 0; i < w.decoded.length; i++) {
  const d = w.decoded[i];
  if (d && (d.text || (d.unknown && d.unknown.length))) {
    const bytes = (w.lines[i]?.bytes ?? []).map((b) => b.toString(16).padStart(2, "0")).join(" ");
    rows.push({ pos: `${w.penX},${w.penY}`, text: d.text, unknown: d.unknown, bytes });
  }
}
console.log(`${MOD}: ${rows.length} non-empty decoded lines`);
for (const r of rows) console.log(`  (${r.pos}) "${r.text}"${r.unknown?.length ? ` unknown=${JSON.stringify(r.unknown)}` : ""}\n      bytes: ${r.bytes}`);
await browser.close();
