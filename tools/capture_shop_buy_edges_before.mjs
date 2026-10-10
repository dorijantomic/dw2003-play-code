// Capture the three pre-repair BUY behaviors without changing the working tree.
// The browser receives a copy of the current shop module with just these
// bounded fixes reversed. All other modules and assets are served from web/.
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const out = process.argv[2] ?? "/tmp/shop-buy-edges-before";
mkdirSync(out, { recursive: true });
let source = readFileSync("web/shop.js", "utf8");
const revert = (now, before) => {
  if (!source.includes(now)) throw new Error(`changed shop source: ${now}`);
  source = source.replace(now, before);
};
revert('["list", "qty", "confirm"].includes(sh.screen)', 'sh.screen === "list"');
revert('sh.screen = "equipwho"; sh.equipWhoIdx = first;', 'sh.screen = "equipwho"; sh.equipWhoIdx = 0;');
revert('    if (sh.fadeLeaving) {\n      const t = sh.time',
  '    if (sh.feedbackMsg) {\n      sh.feedbackTimer = (sh.feedbackTimer ?? 1.8) - dt;\n      if (sh.feedbackTimer <= 0) sh.feedbackMsg = null;\n    }\n    if (sh.fadeLeaving) {\n      const t = sh.time');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.route("**/shop.js", route => route.fulfill({
  status: 200, contentType: "text/javascript", body: source,
}));
const press = async (key, ms = 180) => {
  await page.keyboard.down(key); await page.waitForTimeout(80);
  await page.keyboard.up(key); await page.waitForTimeout(ms);
};
const shot = async (name) => {
  await page.waitForTimeout(250);
  await page.locator("#game").screenshot({ path: `${out}/${name}.png` });
};
const requireState = async (name, predicate) => {
  if (!(await page.evaluate(predicate))) {
    const state = await page.evaluate(() => ({ screen: window.__shop?.screen, view: window.__shop?.infoView, feedback: window.__shop?.feedbackMsg, idx: window.__shop?.equipWhoIdx }));
    throw new Error(`pre-repair checkpoint failed: ${name} ${JSON.stringify(state)}`);
  }
};
const enterBuy = async () => {
  await page.waitForTimeout(800);
  for (let i = 0; i < 4 && await page.evaluate(() => window.__shop.screen === "root"); i++) await press("c", 450);
  await requireState("BUY list opened", () => window.__shop.screen === "list");
  await page.waitForTimeout(500);
};
try {
  await page.goto(`${baseUrl(8742)}/index.html?skipTitle=1&noEncounters=1`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__state?.started && window.__state.shops);
  await page.evaluate(() => {
    window.__state.bits = 10000;
    window.__state.inventory = [{ id: 92, qty: 3 }];
    window.__labOpen("shop", 0);
  });
  await enterBuy(); await press("c", 350);
  await requireState("quantity", () => window.__shop.screen === "qty");
  await press("z");
  await requireState("quantity keeps description", () => window.__shop.infoView === "desc");
  await shot("before-effects-during-quantity");
  await press("c"); await press("z");
  await requireState("Buy/No keeps description", () => window.__shop.screen === "confirm" && window.__shop.infoView === "desc");
  await shot("before-effects-during-confirm");
  await page.evaluate(() => { window.__shop.close(); window.__state.bits = 50; window.__labOpen("shop", 0); });
  await enterBuy(); await press("c", 350);
  await requireState("refusal appears", () => window.__shop.feedbackMsg === "Not enough BIT.");
  await page.waitForTimeout(2100);
  await requireState("refusal expires", () => window.__shop.feedbackMsg === null);
  await shot("before-refusal-expired");
  await page.evaluate(() => {
    window.__shop.close();
    window.__state.bits = 10000;
    window.__state.inventory = [];
    window.__state.equipment = [{}, {}, {}];
    window.__labOpen("shop", 0);
  });
  await enterBuy(); await press("ArrowDown"); await press("ArrowRight");
  for (let i = 0; i < 4; i++) await press("c");
  await requireState("ineligible first partner", () => window.__shop.screen === "equipwho" && window.__shop.equipWhoIdx === 0);
  await shot("before-first-wearable-partner");
  await press("c");
  await requireState("initial Cross cannot equip", () => window.__shop.screen === "equipwho" && !window.__shop.feedbackMsg);
  await shot("before-ineligible-cross");
  console.log("capture_shop_buy_edges_before: OK");
} finally { await browser.close(); }
