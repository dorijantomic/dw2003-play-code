// Bounded ordinary-route check for the translated merchant task tree.
// Run with tools/run-playwright.sh tools/verify_translated_shop.mjs [output-dir].
import { chromium } from "playwright";
import { mkdirSync, readFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const output = process.argv[2] ?? "/tmp/translated-shop";
mkdirSync(output, { recursive: true });
const merchants = JSON.parse(readFileSync("web/assets/data/shops.json", "utf8")).shops
  .filter((merchant) => merchant.shop_id < 30);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const failures = [];
const requests = [];
page.on("pageerror", (error) => failures.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error") failures.push(message.text());
});
await page.route("**/assets/native/**", (route) => {
  requests.push(route.request().url());
  return route.abort();
});
const press = async (key) => {
  await page.keyboard.down(key);
  await page.waitForTimeout(70);
  await page.keyboard.up(key);
  await page.waitForTimeout(180);
};
const actorState = () => page.evaluate(() => {
  const session = window.__shop?._session;
  if (!session) return null;
  const context = session.mem.read32(session.root + 0x24);
  const actor = session.mem.read32(context + 0x1c);
  return actor ? session.mem.read32(actor + 0x10) : null;
});
const waitActorState = async (value) => page.waitForFunction((expected) => {
  const session = window.__shop?._session;
  if (!session) return false;
  const context = session.mem.read32(session.root + 0x24);
  const actor = session.mem.read32(context + 0x1c);
  return actor && session.mem.read32(actor + 0x10) === expected;
}, value, { timeout: 10000 });
try {
  await page.goto(`${baseUrl(8742)}/index.html?skipTitle=1&noEncounters=1`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__state?.started && window.__state.shops);
  await page.evaluate(() => {
    window.__state.bits = 10000;
    window.__state.inventory = [{ id: 92, qty: 3 }];
    localStorage.setItem("inventory", JSON.stringify(window.__state.inventory));
  });
  await page.evaluate(() => window.__labOpen("shop", 0));
  await page.waitForFunction(() => window.__shop?._session || window.__shop?._error,
    null, { timeout: 10000 });
  await page.waitForFunction(() => window.__shop?._session?.mem.read32(window.__shop._session.root + 0x10) === 3,
    null, { timeout: 10000 });
  await page.locator("#game").screenshot({ path: `${output}/root.png` });
  await press("c");
  await waitActorState(3);
  await page.locator("#game").screenshot({ path: `${output}/buy-list.png` });
  // The Effects plate is the third face button, word bit 0x1000, which the one pad
  // map reaches with `k` (engine/systems/input-map.ts, commit 173ebcf0; `z` reached
  // that bit before 2026-10-03 and confirms now). Each screen reads the pad once per
  // frame, so wait for the plate to come up and fold again rather than firing the
  // closing press into the opening transition.
  await press("k");
  await waitActorState(4);
  await page.locator("#game").screenshot({ path: `${output}/effects.png` });
  await press("k");
  await waitActorState(3);
  await press("c");
  await waitActorState(8);
  await page.locator("#game").screenshot({ path: `${output}/quantity.png` });
  await press("c");
  await waitActorState(17);
  await page.locator("#game").screenshot({ path: `${output}/confirm.png` });
  await press("c");
  await waitActorState(27);
  await page.locator("#game").screenshot({ path: `${output}/equip-offer.png` });
  await press("c");
  await waitActorState(32);
  await page.locator("#game").screenshot({ path: `${output}/equip-who.png` });
  await press("c");
  const equipped = await page.evaluate(() => window.__shop._session.result());
  if (equipped.equipment[0]?.right !== 92 ||
      equipped.inventory.find((row) => row.id === 92)?.qty !== 3 || equipped.bits !== 9800) {
    failures.push(`Bought weapon was not equipped: ${JSON.stringify(equipped)}`);
  }
  await waitActorState(39);
  await press("c");
  await waitActorState(32);
  await press("Escape");
  await waitActorState(3);
  await press("Escape");
  await page.waitForFunction(() => window.__shop?._session?.mem.read32(window.__shop._session.root + 0x10) === 3,
    null, { timeout: 10000 });
  await press("ArrowDown");
  await press("c");
  await waitActorState(2);
  await page.locator("#game").screenshot({ path: `${output}/sell-categories.png` });
  await press("ArrowDown");
  await press("c");
  await waitActorState(6);
  await page.waitForTimeout(250);
  const sellRow = await page.evaluate(() => {
    const session = window.__shop._session;
    const context = session.mem.read32(session.root + 0x24);
    const actor = session.mem.read32(context + 0x1c);
    const list = session.mem.read32(session.mem.read32(actor + 0x24));
    const firstWidget = session.mem.read32(session.mem.read32(list + 0x24)) >>> 0;
    const widget = session.widgets.textWidgets().find((entry) => entry.addr === firstWidget);
    return { count: session.mem.read32(list + 0x6c0), id: session.mem.read16(list + 0x64),
      visible: widget?.visible, text: widget?.lines[0]?.bytes };
  });
  if (sellRow.count === 0 || sellRow.id !== 92 || !sellRow.visible || !sellRow.text?.length) {
    failures.push(`SELL row is absent: ${JSON.stringify(sellRow)}`);
  }
  await page.locator("#game").screenshot({ path: `${output}/sell-list.png` });
  await press("c");
  await waitActorState(0x17);
  await press("c");
  await waitActorState(0x20);
  await page.waitForTimeout(250);
  await page.locator("#game").screenshot({ path: `${output}/sell-confirm.png` });
  await press("c");
  await waitActorState(6);
  const sold = await page.evaluate(() => window.__shop._session.result());
  if (sold.bits !== 9900 || sold.inventory.find((row) => row.id === 92)?.qty !== 2) {
    failures.push(`Sale did not update wallet and bag: ${JSON.stringify(sold)}`);
  }
  await press("Escape");
  await waitActorState(2);
  await press("Escape");
  await page.waitForFunction(() => window.__shop?._session?.mem.read32(window.__shop._session.root + 0x10) === 3,
    null, { timeout: 10000 });
  await press("Escape");
  await page.waitForFunction(() => !window.__shop.isOpen(), null, { timeout: 10000 });
  const saved = await page.evaluate(() => ({
    bits: window.__state.bits,
    inventory: window.__state.inventory,
    equipment: window.__state.equipment,
  }));
  if (saved.bits !== 9900 || saved.inventory.find((row) => row.id === 92)?.qty !== 2 ||
      saved.equipment[0]?.right !== 92) failures.push(`Exit did not commit save state: ${JSON.stringify(saved)}`);
  const diagnostic = await page.evaluate(() => window.__shop.diagnostics());
  if (diagnostic.execution !== "translated") failures.push(`Merchant runs ${diagnostic.execution} logic`);
  await page.reload({ waitUntil: "load" });
  await page.waitForFunction(() => window.__state?.started && window.__state.shops);
  const reloaded = await page.evaluate(() => ({
    bits: window.__state.bits,
    inventory: window.__state.inventory,
    equipment: window.__state.equipment,
  }));
  if (reloaded.bits !== 9900 || reloaded.inventory.find((row) => row.id === 92)?.qty !== 2 ||
      reloaded.equipment[0]?.right !== 92) failures.push(`Reload lost merchant state: ${JSON.stringify(reloaded)}`);
  for (const id of [0, 1, 2]) {
    await page.evaluate((merchant) => window.__applyStoryFlag(0x7a00 + merchant, 1), id);
    await page.waitForFunction(() => window.__shop?._session || window.__shop?._error,
      null, { timeout: 10000 });
    const openedId = await page.evaluate(() => window.__shop._session?.mem.read32(0x8004b404));
    if (openedId !== id) failures.push(`Merchant event ${id} opened ${openedId}`);
    await page.evaluate(() => window.__shop.close());
  }
  for (const merchant of merchants) {
    await page.evaluate((id) => window.__labOpen("shop", id), merchant.shop_id);
    await page.waitForFunction(() => window.__shop?._session || window.__shop?._error,
      null, { timeout: 10000 });
    await page.waitForFunction(() => window.__shop?._session?.mem.read32(window.__shop._session.root + 0x10) === 3,
      null, { timeout: 10000 });
    await press("c");
    await waitActorState(3);
    const stock = await page.evaluate(() => {
      const session = window.__shop._session;
      const rootContext = session.mem.read32(session.root + 0x24);
      const actor = session.mem.read32(rootContext + 0x1c);
      const actorContext = session.mem.read32(actor + 0x24);
      const list = session.mem.read32(actorContext);
      return {
        count: session.mem.read32(list + 0x6c0),
        first: session.mem.read16(session.mem.read32(list + 0x6b4)),
      };
    });
    if (stock.count !== merchant.items.length || stock.first !== merchant.items[0]?.id) {
      failures.push(`Merchant ${merchant.shop_id} stock differs: ${JSON.stringify(stock)}`);
    }
    await page.evaluate(() => window.__shop.close());
  }
  await page.evaluate(() => { window.__state.bits = 0; });
  await page.evaluate(() => window.__labOpen("shop", 0));
  await page.waitForFunction(() => window.__shop?._session?.mem.read32(window.__shop._session.root + 0x10) === 3,
    null, { timeout: 10000 });
  await press("c");
  await waitActorState(3);
  await press("c");
  await waitActorState(47);
  const refused = await page.evaluate(() => window.__shop._session.result());
  if (refused.bits !== 0) failures.push(`Empty-wallet refusal changed BIT: ${refused.bits}`);
  await page.locator("#game").screenshot({ path: `${output}/refusal.png` });
  await press("c");
  await waitActorState(3);
  await page.evaluate(() => window.__shop.close());
  await page.evaluate(() => {
    window.__state.bits = 10000;
    window.__state.inventory = [{ id: 92, qty: 99 }];
  });
  await page.evaluate(() => window.__labOpen("shop", 0));
  await page.waitForFunction(() => window.__shop?._session?.mem.read32(window.__shop._session.root + 0x10) === 3,
    null, { timeout: 10000 });
  await press("c"); await waitActorState(3);
  await press("c"); await waitActorState(47);
  const full = await page.evaluate(() => window.__shop._session.result());
  if (full.bits !== 10000 || full.inventory.find((row) => row.id === 92)?.qty !== 99) {
    failures.push(`Full bag refusal changed state: ${JSON.stringify(full)}`);
  }
  await page.locator("#game").screenshot({ path: `${output}/full-bag.png` });
  await page.evaluate(() => window.__shop.close());
  await page.evaluate(() => { window.__state.inventory = []; });
  await page.evaluate(() => window.__labOpen("shop", 0));
  await page.waitForFunction(() => window.__shop?._session?.mem.read32(window.__shop._session.root + 0x10) === 3,
    null, { timeout: 10000 });
  await press("c"); await waitActorState(3);
  await press("c"); await waitActorState(8);
  await press("Escape"); await waitActorState(3);
  await press("c"); await waitActorState(8);
  await press("c"); await waitActorState(17);
  await press("ArrowDown");
  await press("c"); await waitActorState(3);
  const declined = await page.evaluate(() => window.__shop._session.result());
  if (declined.bits !== 10000 || declined.inventory.some((row) => row.id === 92)) {
    failures.push(`Declined purchase changed state: ${JSON.stringify(declined)}`);
  }
  await press("Escape");
  await page.waitForFunction(() => window.__shop?._session?.mem.read32(window.__shop._session.root + 0x10) === 3,
    null, { timeout: 10000 });
  await press("ArrowDown"); await press("c"); await waitActorState(2);
  await press("c"); await waitActorState(0xca);
  await page.locator("#game").screenshot({ path: `${output}/empty-sell-category.png` });
  await press("c"); await waitActorState(2);
  await page.evaluate(() => window.__shop.close());
  if (diagnostic.renderer.clips === 0) failures.push("Merchant pictures did not paint");
  if (requests.length) failures.push(`Executable asset requests: ${requests.length}`);
  if (failures.length) throw new Error(failures.join("\n"));
  console.log(JSON.stringify({ result: "pass", output, merchants: merchants.length,
    clips: diagnostic.renderer.clips }));
} finally {
  await browser.close();
}
