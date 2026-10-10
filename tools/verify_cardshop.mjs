// Capture the card shop from the real game module.
//
//   python3 -m http.server 8742 --directory web
//   tools/run-playwright.sh tools/verify_cardshop.mjs [out-dir]
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const out = process.argv[2] ?? "/tmp/wave2-cardshop";
mkdirSync(out, { recursive: true });

const b = await chromium.launch({
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const p = await b.newPage({ viewport: { width: 1100, height: 760 } });
p.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
await p.goto(`${baseUrl(8742)}/ui-lab.html?legacyCardShop=1`, { waitUntil: "load" });
await p.waitForFunction(() => {
  const f = document.getElementById("game");
  return f?.contentWindow?.__labOpen && f.contentWindow.__state?.started;
}, null, { timeout: 30000 });

await p.click('[data-scr="cardshop"]');
const frame = p.frames().find((f) => f.url().includes("index.html"));
const canvas = await frame.$("canvas");
await p.waitForTimeout(800);
await canvas.screenshot({ path: `${out}/cardshop-root.png` });
console.log("shot cardshop-root");
await b.close();
