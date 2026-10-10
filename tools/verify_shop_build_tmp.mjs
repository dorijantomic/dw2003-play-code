import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";
const out = "/tmp/opencode/shopbuild";
mkdirSync(out, { recursive: true });
const b = await chromium.launch({ channel: "chromium-headless-shell", args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const p = await b.newPage({ viewport: { width: 1100, height: 760 } });
p.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
await p.goto(`${baseUrl(8742)}/ui-lab.html`, { waitUntil: "load" });
await p.waitForFunction(() => {
  const f = document.getElementById("game");
  return f?.contentWindow?.__labOpen && f.contentWindow.__state?.started;
}, null, { timeout: 30000 });
await p.click(`[data-scr="shop"]`);
await p.waitForTimeout(1500);
const shot = async (name) => { await p.screenshot({ path: `${out}/${name}.png` }); console.log("shot", name); };
const key = async (k, ms = 900) => { await p.keyboard.press(k); await p.waitForTimeout(ms); };
// game canvas focus for keys: click it first
await p.click("#game");
await p.waitForTimeout(500);
await shot("b0-root");
await key("ArrowDown");
await key("c"); // SELL -> sellcat
await shot("b1-sellcat");
await key("c"); // Items (empty) -> message
await shot("b2-noitems");
await key("c"); // dismiss
await key("Escape"); // back to root
await key("ArrowUp");
await key("c"); // BUY -> list
await shot("b3-list");
await p.evaluate(() => { const f = document.getElementById("game"); f.contentWindow.__state.bits = 99999; });
await key("c"); // qty (Short Sword)
await shot("b4-qty");
await key("ArrowRight"); // +10
await key("c"); // confirm
await shot("b5-confirm");
await key("c"); // Buy -> Equip?
await shot("b6-equip");
await key("c"); // Yes -> Equip who?
await shot("b7-equipwho");
await b.close();
