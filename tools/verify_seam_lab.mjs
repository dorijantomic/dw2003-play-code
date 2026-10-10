// Drive web/seam-lab.html headlessly: does the lab find the holes we know about,
// and does it stay quiet on a stage that has none?
//
// The lab measures a hole by painting the frame's clear colour twice in two
// colours and keeping the pixels that changed, so a "hit" means the background
// was visible through the picture — not that something merely looked dark.
//
// Needs the web root served:  python3 -m http.server 8742 --directory web
// (or VERIFY_PORT=<port> with a server on that port)
// Run:  tools/run-playwright.sh tools/verify_seam_lab.mjs [outdir] [stage…]
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const out = process.argv[2] ?? "/tmp/seam-lab";
const stages = process.argv.slice(3);
const STAGES = stages.length ? stages : ["s206", "s285", "s320"];
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1700, height: 1000 } });
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
await page.goto(`${baseUrl(8742)}/seam-lab.html`, { waitUntil: "load" });
await page.waitForFunction(() => window.__seamLab?.ready(), null, { timeout: 30000 });

const report = {};
for (const stage of STAGES) {
  await page.evaluate((s) => window.__seamLab.setMapById(s), stage);
  await page.waitForTimeout(900);
  const hits = await page.evaluate(() => window.__seamLab.scan());
  report[stage] = hits;
  console.log(`${stage}: ${hits.length} thin holes`,
    hits.slice(0, 5).map((h) => `${h.mx},${h.my} ${h.axis} len${h.len}`).join(" | "));
  if (hits.length) {
    await page.evaluate(() => document.querySelector("#hits li").click());
    await page.waitForTimeout(400);
  }
  await page.screenshot({ path: `${out}/${stage}.png` });
}
writeFileSync(`${out}/seam-lab-report.json`, JSON.stringify(report, null, 1));
if (errs.length) console.log("page errors:", errs.slice(0, 5));
await browser.close();
