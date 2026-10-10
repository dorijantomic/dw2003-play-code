// Headless screenshot verifier for the rig-authentic shop/DRI UI (scratch).
// Run through tools/run-playwright.sh with web/ served on VERIFY_PORT (default 8741):
//   VERIFY_PORT=8837 tools/run-playwright.sh tools/verify_shop_ui.mjs .bunny-scratch/shop-ui
//
// The merchant is the translated port (engine/dw3/ui ShopRootSession) and the
// Digimon Lab is the translated lab screen, so both are opened through the lab
// hook `__labOpen(name, arg)` and stepped with real pad keys. The walker's own
// title buttons and `shop.handleKey(key, state)` are gone from the shipped route:
// the title draws its own menu on the canvas and the merchant reads the pad.
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const out = process.argv[2] ?? ".bunny-scratch/shop-ui";
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  channel: "chromium-headless-shell",
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 960, height: 720 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
await page.goto(`${baseUrl(8741)}/?skipTitle=1&noEncounters=1`, { waitUntil: "load" });
await page.waitForFunction(() => window.__state?.started, null, { timeout: 30000 });
await page.waitForTimeout(2500); // fonts/packs

// Seed a rig-like save: Renamon/Veemon/Kotemon party, Boost Gem on Renamon.
// The party, partnerStats and partyStats are left to __labOpen's own fallback:
// the merchant builds its save block from all three together (shop-translated.js
// `saveSeed`), and a hand-written stats array with no roster slots stops it
// opening at all.
await page.evaluate(() => {
  const s = window.__state;
  s.bits = 130821;
  s.digimonNames = {};
  s.equipment = [{ acc0: 300 }, {}, {}];
  s.inventory = [{ id: 43, qty: 56 }, { id: 292, qty: 4 }];
});

const key = async (k, ms = 800) => {
  await page.keyboard.press(k);
  await page.waitForTimeout(ms);
};
const shot = async (name) => {
  await page.waitForTimeout(400);
  await page.locator("canvas#game").screenshot({ path: `${out}/${name}.png` });
  console.log("shot", name);
};
const rootChoices = () => page.waitForFunction(() =>
  window.__shop?._session?.mem.read32(window.__shop._session.root + 0x10) === 3, null, { timeout: 20000 });
const actorNow = () => page.evaluate(() => {
  const session = window.__shop?._session;
  if (!session) return null;
  const context = session.mem.read32(session.root + 0x24);
  const actor = session.mem.read32(context + 0x1c);
  return actor ? session.mem.read32(actor + 0x10) : null;
});
/** Press confirm and wait for the buy actor to reach its next screen. */
const step = async (name, keyName = "c") => {
  const before = await actorNow();
  await page.keyboard.press(keyName);
  await page.waitForTimeout(300);
  for (let i = 0; i < 60; i++) {
    const now = await actorNow();
    if (now !== null && now !== before) break;
    await page.waitForTimeout(150);
  }
  await shot(name);
  return actorNow();
};

// 1. Suzaku Item Shop (shop 9) — root, then buy list, qty, confirm.
await page.evaluate(() => window.__labOpen("shop", 9));
await rootChoices();
await shot("w1_root");
await step("w2_list");   // BUY -> the item list
await step("w3_qty");    // -> quantity
await step("w4_confirm"); // -> confirm
// Leave the list and the merchant. The walker's two Escape presses were walking
// its own screen stack; the port folds the windows shut and the lab closes it.
await key("Escape", 700);
await page.evaluate(() => window.__shop.close());
await page.waitForTimeout(400);

// 2. Suzaku Pawn Shop (shop 8) — list, desc view, effects cards.
await page.evaluate(() => window.__labOpen("shop", 8));
await rootChoices();
await step("p1_list_desc");   // BUY -> list (Power Gem selected)
await key("z");               // circle: effects cards
await shot("p2_effects");
await page.evaluate(() => window.__shop.close());

// 3. Digimon Lab Select Action screen.
await page.evaluate(() => window.__labOpen("dri"));
await shot("d1_select_action");

const shopState = await page.evaluate(() => window.__shop.diagnostics?.() ?? null);
console.log("shop diagnostics", JSON.stringify({ error: shopState?.error, renderer: shopState?.renderer?.frames }));
if (shopState?.error) console.log("PAGEERROR: merchant failed to open:", shopState.error);

await browser.close();
console.log("done ->", out);