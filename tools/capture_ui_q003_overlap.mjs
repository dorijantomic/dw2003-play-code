import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const out = process.argv[2] || "/tmp/opencode/uiq003-walker";
mkdirSync(out, { recursive: true });
const b = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const p = await b.newPage({ viewport: { width: 1100, height: 760 } });
p.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
await p.goto(`${baseUrl(8742)}/ui-lab.html`, { waitUntil: "load" });
await p.waitForFunction(
  () => document.getElementById("game")?.contentWindow?.__labOpen
    && document.getElementById("game").contentWindow.__state?.started,
  null,
  { timeout: 30000 },
);
const shot = async (n) => {
  await p.screenshot({ path: `${out}/${n}.png` });
  console.log("shot", n);
};
const key = async (k, label) => {
  await p.keyboard.press(k);
  await p.waitForTimeout(800);
  console.log(`  ${label ?? k}`);
};

// The sidebar button opens the screen AND focuses the iframe (ui-lab.html:148).
await p.click('[data-scr="shop"]');
await p.waitForTimeout(1800);
await shot("walker-01-shop-root");

await key("c", "c (Cross) -> BUY list");
await shot("walker-02-list");
await key("c", "c (Cross) -> item qty");
await shot("walker-03-qty");
await key("c", "c (Cross) -> Buy/No plate");
await shot("walker-04-buyno");

await p.click('[data-scr="menu"]');
await p.waitForTimeout(1500);
await shot("walker-05-menu");
for (let i = 0; i < 4; i++) await key("ArrowDown", `down${i + 1}`);
await key("z", "z -> STATUS");
await shot("walker-06-choose");
await key("z", "z -> member sheet");
await p.waitForTimeout(1400);
await shot("walker-07-sheet");

b.close();
