// Capture the save screen's rotating transition quad (POLY_G4, decoded
// 2026-08-14). Lab-only: the walker has no memory card to check, so the state
// that raises it in the original does not exist here.
//
//   python3 -m http.server 8742 --directory web
//   tools/run-playwright.sh tools/verify_savequad.mjs [out-dir]
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";
const out = process.argv[2] ?? "/tmp/savequad";
mkdirSync(out, { recursive: true });
const b = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const p = await b.newPage({ viewport: { width: 1100, height: 760 } });
p.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
await p.goto(`${baseUrl(8742)}/ui-lab.html`, { waitUntil: "load" });
await p.waitForFunction(() => {
  const f = document.getElementById("game");
  return f?.contentWindow?.__labOpen && f.contentWindow.__state?.started;
}, null, { timeout: 30000 });
await p.click('[data-scr="savequad"]');
const frame = p.frames().find((f) => f.url().includes("index.html"));
const canvas = await frame.$("canvas");
for (const [tag, ms] of [["a", 120], ["b", 300], ["c", 700]]) {
  await p.waitForTimeout(ms);
  await canvas.screenshot({ path: `${out}/quad-${tag}.png` });
  console.log("shot", tag);
}
await b.close();
