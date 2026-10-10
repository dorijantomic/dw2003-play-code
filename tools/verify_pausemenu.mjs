import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";
const out = process.argv[2] ?? "/tmp/bagshot";
mkdirSync(out, { recursive: true });
const b = await chromium.launch({ channel: "chromium-headless-shell", args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const p = await b.newPage({ viewport: { width: 1100, height: 760 } });
p.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
await p.goto(`${baseUrl(8742)}/ui-lab.html`, { waitUntil: "load" });
await p.waitForFunction(() => {
  const f = document.getElementById("game");
  return f?.contentWindow?.__labOpen && f.contentWindow.__state?.started;
}, null, { timeout: 30000 });

// give the bag more than one page so the counter and the hints have something
// to say (24 slots = two pages of 16)
await p.evaluate(() => {
  const w = document.getElementById("game").contentWindow;
  w.__labOpen("menu");
  // after the boot, or it is wiped: 24 slots = two pages of sixteen
  w.__state.inventory = Array.from({ length: 24 }, (_, i) => ({ id: 43 + (i % 26), qty: 1 + i }));
});
const frame = p.frames().find((f) => f.url().includes("index.html")) ?? p.mainFrame();
// The game listens on the iframe's own window, so send the event there rather
// than typing into the host page.
const key = async (k, ms = 260) => {
  await p.evaluate((kk) => {
    const w = document.getElementById("game").contentWindow;
    w.dispatchEvent(new w.KeyboardEvent("keydown", { key: kk, bubbles: true }));
    w.dispatchEvent(new w.KeyboardEvent("keyup", { key: kk, bubbles: true }));
  }, k);
  await p.waitForTimeout(ms);
};
await p.waitForTimeout(900);
await p.screenshot({ path: `${out}/1-home.png` });
await key("Enter");            // circle: home -> ITEMS categories
await p.waitForTimeout(600);
await p.screenshot({ path: `${out}/2-cats.png` });
await key("Enter");            // circle: enter the bag
await p.waitForTimeout(900);
await p.screenshot({ path: `${out}/3-bag.png` });
const canvas = await frame.$("canvas");
if (canvas) await canvas.screenshot({ path: `${out}/3-bag-canvas.png` });
// status sheet: back out, move to STATUS, open, pick a partner
await key("Escape");
await key("Escape");
for (let i = 0; i < 4; i++) await key("ArrowDown", 180);
await key("Enter");
await key("Enter");
await p.waitForTimeout(900);
if (canvas) await canvas.screenshot({ path: `${out}/4-status-canvas.png` });
await b.close();
console.log("done", out);
