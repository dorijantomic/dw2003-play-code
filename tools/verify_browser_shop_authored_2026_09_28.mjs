// Historical authored-route verifier from before the task-tree cutover.
// Ordinary translated merchant route: all catalogued merchants, transactions,
// and equipment without executable screen resources.
// Run with: tools/run-playwright.sh tools/verify_browser_shop.mjs [capture-dir]
// The server is python3 -m http.server 8742 --directory web.
import { chromium } from "playwright";
import { mkdirSync, readFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const out = process.argv[2] ?? "/tmp/browser-shop-verify";
mkdirSync(out, { recursive: true });
const shops = JSON.parse(readFileSync("web/assets/data/shops.json", "utf8")).shops
  .filter((shop) => shop.shop_id < 30);
let failed = 0;
const check = (name, condition, detail = "") => {
  console.log(`${condition ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!condition) failed++;
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
const executableRequests = [];
await page.route("**/assets/native/**", route => {
  executableRequests.push(route.request().url());
  return route.abort();
});
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
const state = () => page.evaluate(() => ({
  open: window.__shop.isOpen(),
  nativeHost: !!window.__shop._host,
  screen: window.__shop.screen,
  name: window.__shop.name,
  stock: window.__shop.stock,
  bits: window.__state.bits,
  inventory: window.__state.inventory,
  feedback: window.__shop.feedbackMsg,
}));
const press = async (key, delay = 80) => {
  await page.keyboard.down(key);
  await page.waitForTimeout(70);
  await page.keyboard.up(key);
  await page.waitForTimeout(delay);
};
const open = async (id) => {
  await page.evaluate((shopId) => window.__labOpen("shop", shopId), id);
  await page.waitForFunction((shopId) => window.__shop.isOpen() && window.__shop.name === window.__state.shops[shopId].name, id);
};
const shot = async (name) => {
  await page.waitForTimeout(250); // let the screen's fold and text draw settle
  return page.locator("#game").screenshot({ path: `${out}/${name}.png` });
};

try {
  await page.goto(`${baseUrl(8742)}/index.html?skipTitle=1&noEncounters=1`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__state?.started && window.__state.shops);
  check("ordinary route selects translated shop", await page.evaluate(() => window.__shop === window.__shopTranslated));
  for (const id of [0, 1, 2]) {
    await page.evaluate((shopId) => window.__applyStoryFlag(0x7a00 + shopId, 1), id);
    const s = await state();
    check(`merchant event ${id} opens browser-owned shop`, s.open && !s.nativeHost && s.name === shops[id].name,
      `name=${s.name}`);
    await page.evaluate(() => window.__shop.close());
  }
  for (const shop of shops) {
    await open(shop.shop_id);
    let s = await state();
    check(`shop ${shop.shop_id} opens`, s.open && !s.nativeHost && s.name === shop.name && s.stock.length === shop.items.length,
      `${s.name}, stock=${s.stock.length}`);
    await press("c", 30); // Cross: BUY
    s = await state();
    check(`shop ${shop.shop_id} BUY list`, s.screen === "list" && s.stock[0] === shop.items[0]?.id,
      `screen=${s.screen}`);
    await page.evaluate(() => window.__shop.close());
  }

  await page.evaluate(() => {
    window.__state.bits = 10000;
    window.__state.inventory = [{ id: 92, qty: 3 }];
    localStorage.setItem("bits", "10000");
    localStorage.setItem("inventory", JSON.stringify(window.__state.inventory));
  });
  await open(0); // Asuka Armory
  await shot("01-armory-root");
  await press("c"); await shot("02-armory-buy-list");
  await press("z"); // Circle: show the selected weapon's per-partner effects
  let effect = await page.evaluate(() => ({
    view: window.__shop.infoView,
    cards: window.__shop._equipCards(window.__state),
  }));
  check("Short Sword effects card opens", effect.view === "effects" && effect.cards.length > 0,
    `view=${effect.view} cards=${effect.cards.length}`);
  check("weapon effects lead with POW then CHR",
    effect.cards[0]?.preview?.rows?.[0]?.stat === "str" && effect.cards[0]?.preview?.rows?.[1]?.stat === "chr",
    effect.cards[0]?.preview?.rows?.map((row) => row.stat).join(","));
  await page.waitForTimeout(250);
  await shot("02a-armory-weapon-effects");
  await press("z"); // Return to the description before buying
  check("effects card returns to description", await page.evaluate(() => window.__shop.infoView === "desc"));
  await press("c");
  await press("z");
  check("Circle opens effects during quantity", await page.evaluate(() => window.__shop.screen === "qty" && window.__shop.infoView === "effects"));
  await shot("03a-effects-during-quantity");
  await press("z"); await press("ArrowUp"); await shot("03-armory-quantity-2");
  await press("c");
  await press("z");
  check("Circle opens effects during Buy/No", await page.evaluate(() => window.__shop.screen === "confirm" && window.__shop.infoView === "effects"));
  await shot("04a-effects-during-confirm");
  await press("z"); await shot("04-armory-buy-confirm");
  await press("c"); await shot("05-armory-equip-offer");
  let s = await state();
  check("buy two Short Swords", s.bits === 9600 && s.inventory.find((item) => item.id === 92)?.qty === 5,
    `bits=${s.bits} held=${s.inventory.find((item) => item.id === 92)?.qty}`);
  check("equipment offer opens", s.screen === "equip", `screen=${s.screen}`);
  await press("ArrowDown"); await press("c");
  await press("Escape"); // BUY list -> root
  await press("ArrowDown"); await press("c"); // SELL categories
  await shot("06-armory-sell-categories");
  await press("ArrowDown"); await press("c"); // Weapons list
  await press("c"); await press("c"); // quantity -> Sell/No
  await shot("07-armory-sell-confirm");
  await press("c");
  s = await state();
  check("sell one Short Sword", s.bits === 9700 && s.inventory.find((item) => item.id === 92)?.qty === 4,
    `bits=${s.bits} held=${s.inventory.find((item) => item.id === 92)?.qty}`);
  check("sale with held swords returns to the list", s.screen === "list", `screen=${s.screen}`);
  await shot("07a-armory-after-sell");
  await press("Escape"); // list -> category
  await press("Escape"); // category -> root
  await press("Escape"); // leave fold
  await page.waitForFunction(() => !window.__shop.isOpen(), { timeout: 10000 });
  check("shop exit closes", !(await state()).open);
  check("wallet persisted", await page.evaluate(() => localStorage.getItem("bits") === "9700"));
  check("bag persisted", await page.evaluate(() => JSON.parse(localStorage.getItem("inventory") || "[]").find((item) => item.id === 92)?.qty === 4));

  await page.reload({ waitUntil: "load" });
  await page.waitForFunction(() => window.__state?.started && window.__state.shops);
  s = await state();
  check("reload keeps the sale balance", s.bits === 9700, `bits=${s.bits}`);
  check("reload keeps four swords", s.inventory.find((item) => item.id === 92)?.qty === 4,
    JSON.stringify(s.inventory));

  await page.evaluate(() => { window.__state.inventory = [{ id: 92, qty: 1 }]; });
  await open(0);
  await press("ArrowDown"); await press("c"); // SELL categories
  await press("ArrowDown"); await press("c"); // Weapons list
  await press("c"); await press("c"); await press("c"); // qty, confirmation, sell
  s = await state();
  check("selling the last sword returns to categories", s.screen === "sellcat" && !s.inventory.some((item) => item.id === 92),
    `screen=${s.screen} inventory=${JSON.stringify(s.inventory)}`);
  await shot("07b-armory-last-sword-sold");
  await page.evaluate(() => window.__shop.close());

  await page.evaluate(() => { window.__state.inventory = [{ id: 92, qty: 1 }, { id: 157, qty: 1 }]; });
  await open(0);
  await press("ArrowDown"); await press("c"); // SELL categories
  await press("ArrowDown"); await press("c"); // Weapons list, Short Sword selected
  await press("c"); await press("c"); await press("c"); // sell the only Short Sword
  s = await state();
  check("selling selected stock keeps the next weapon selected",
    s.screen === "list" && !s.inventory.some((item) => item.id === 92)
      && s.inventory.some((item) => item.id === 157)
      && await page.evaluate(() => window.__shop._selected(window.__state)?.id === 157),
    `screen=${s.screen} inventory=${JSON.stringify(s.inventory)}`);
  await shot("07c-armory-next-weapon-after-sale");
  await page.evaluate(() => window.__shop.close());
 
  await page.evaluate(() => { window.__state.bits = 50; localStorage.setItem("bits", "50"); });
  await open(0); await press("c"); await press("c");
  s = await state();
  check("unaffordable purchase shows refusal", s.feedback === "Not enough BIT." && s.bits === 50, `${s.feedback}, bits=${s.bits}`);
  await shot("08-armory-not-enough-bit");
  await page.waitForTimeout(2000);
  check("refusal waits for confirmation", (await state()).feedback === "Not enough BIT.");
  await shot("08a-armory-refusal-waits");
  await page.evaluate(() => window.__shop.close());

  await page.evaluate(() => { window.__state.bits = 10000; window.__state.inventory = []; });
  await open(2); // consumable item shop
  await shot("09-item-shop-root");
  await press("c"); await shot("10-item-shop-buy-list");
  await press("c"); await press("c"); await press("c");
  s = await state();
  check("consumable purchase returns to list", s.screen === "list" && s.bits === 9988 && s.inventory.find((item) => item.id === 43)?.qty === 1,
    `screen=${s.screen} bits=${s.bits}`);
  await page.evaluate(() => window.__shop.close());
  await page.evaluate(() => { window.__state.bits = 10000; window.__state.inventory = []; });
  await open(1); // pawn shop
  await shot("11-pawn-shop-root");
  await press("c"); await shot("12-pawn-shop-buy-list");
  await press("c"); await press("c"); await press("c");
  s = await state();
  check("pawn accessory purchase", s.bits === 9000 && s.inventory.find((item) => item.id === 292)?.qty === 1,
    `screen=${s.screen} bits=${s.bits}`);
  await shot("13-pawn-after-buy");
  await page.evaluate(() => window.__shop.close());
  await page.evaluate(() => {
    window.__state.bits = 10000;
    window.__state.inventory = [];
    window.__state.equipment = [{}, {}, {}];
  });
  await open(0);
  await press("c"); await press("c"); await press("c"); await press("c"); // BUY, sword, quantity, Buy
  await press("c"); await press("c"); // Equip? Yes; first eligible partner
  s = await state();
  const worn = await page.evaluate(() => ({
    equipment: window.__state.equipment?.[0],
    bonus: window.__state.partnerStats?.equipBonuses,
  }));
  check("bought weapon equips and leaves the bag", Object.values(worn.equipment ?? {}).includes(92)
    && !s.inventory.some((item) => item.id === 92),
    `equipment=${JSON.stringify(worn.equipment)} bag=${JSON.stringify(s.inventory)}`);
  check("weapon bonus reaches the battle state", !!worn.bonus && Object.values(worn.bonus).some((value) => Number(value) > 0),
    JSON.stringify(worn.bonus));
  await page.evaluate(() => window.__shop.close());
  await page.evaluate(() => {
    window.__state.party = ["p003pken", "p009rena", "p010pata"];
    window.__state.equipment = [{}, {}, {}];
    window.__state.inventory = [];
    window.__state.bits = 10000;
  });
  await open(0);
  await press("c"); // BUY
  await press("ArrowDown"); await press("ArrowRight"); // Bamboo Spear
  check("Bamboo Spear selected", await page.evaluate(() => window.__shop._selected(window.__state)?.id === 167));
  for (let i = 0; i < 4; i++) await press("c"); // qty, Buy/No, commit, Equip? Yes
  check("Equip who starts on Renamon", await page.evaluate(() => window.__shop.screen === "equipwho" && window.__shop.equipWhoIdx === 1));
  await shot("14-first-wearable-partner");
  await press("c");
  check("first Cross equips Bamboo Spear", await page.evaluate(() => window.__shop.feedbackMsg === "Equipped."
    && window.__state.equipment?.[1]?.right === 167));
  await shot("15-first-cross-equipped");
  await page.evaluate(() => window.__shop.close());
  check("no page errors", errors.length === 0, errors.join(" | "));
  check("no executable screen requests", executableRequests.length === 0, executableRequests.join(" | "));
} finally {
  await browser.close();
}
console.log(failed === 0 ? "verify_browser_shop: OK" : `verify_browser_shop: ${failed} failure(s)`);
if (failed) process.exit(1);
