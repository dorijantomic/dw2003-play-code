// What the player sees after the bag became one shared store.
//
//   1. The pause ITEMS page lists held items in item-id order, not in the order the
//      bag was filled (F0x800135E8 walks the fixed id directory at 0x80042BC8).
//   2. A story line that TAKES an item away really takes it: set_flag(bank 0x80-0x8E,
//      0) is F0x800161D8's remove arm, which used to be ignored.
//   3. A removal that finds nothing carried takes the item off the Digimon wearing
//      it — the same routine's zero branch, which used to leave the wearer wearing
//      an item nobody had.
//   4. A grant that reaches 99 stays at 99, silently, as on the disc.
//
// The list is read on the page that draws it (the walker's own pause ITEMS list,
// `?legacyStatus=1`, whose row order this change fixed) and the counts out of the
// walker's bag and its saved copy, so nothing here depends on a pixel.
//
//   VERIFY_PORT=8916 tools/run-playwright.sh tools/verify_item_store.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";
import { baseUrl } from "./verify-base-url.mjs";

const BASE = process.env.ITEM_STORE_ROOT
  || `${baseUrl(8916)}/index.html?skipTitle=1&noEncounters=1&legacyStatus=1`;
const OUT = process.env.ITEM_STORE_SHOT || ".bunny-scratch/captures/item-store";
mkdirSync(OUT, { recursive: true });

// Held copies, seeded in the order a save that listed loot as it dropped would have:
// the highest id first. 43 PowerCharge, 66 AntidoteDisk, 70 LifeDisk are the
// "Items" tab; 1 Balanced Pack and 400 the "Important Items" tab.
const SEED_BAG = [[70, 1], [66, 2], [43, 1], [400, 1], [1, 1]];
// A sword nothing is carrying, worn by the lead — the state the auto-unequip exists for.
const WORN_SWORD = 176;

const problems = [];
let step = "start";
const ok = (cond, msg) => { if (!cond) problems.push(`${step}: ${msg}`); return cond; };
const shot = async (page, name) => writeFileSync(`${OUT}/${name}.png`, Buffer.from(
  (await page.locator("canvas#game").evaluate((el) => el.toDataURL("image/png"))).split(",")[1],
  "base64",
));

const bag = (page) => page.evaluate(() => window.__state.inventory.map((s) => [s.id, s.qty ?? 1]));
const savedBag = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("inventory") ?? "[]"));
const equipment = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__state.equipment ?? [])));
const qty = (rows, id) => rows.filter((r) => (Array.isArray(r) ? r[0] : r.id) === id)
  .reduce((n, r) => n + (Array.isArray(r) ? r[1] : r.qty ?? 1), 0);
/** Open the pause ITEMS page on `cat` and read the rows it is drawing. */
const openTab = (page, cat) => page.evaluate((c) => {
  const menu = window.__menu;
  window.__state.menuOpen = true;
  menu.openAt("items");
  menu.itemMode = "list";
  menu.itemCat = c;
  menu.itemCursor = 0;
  return menu.itemList(window.__state).map((row) => [row.id, row.qty]);
}, cat);

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
const errors = [];
page.on("pageerror", (e) => { errors.push(e.message); console.error("PAGEERROR", e.message); });

await page.addInitScript(([seed, sword]) => {
  localStorage.setItem("assetMode", "authentic");
  localStorage.setItem("engineSchema", "2");
  localStorage.setItem("playerName", "Junior");
  localStorage.setItem("inventory", JSON.stringify(seed.map(([id, qty]) => ({ id, qty }))));
  // The lead wears the sword and carries none of it.
  localStorage.setItem("equipment", JSON.stringify([{ right: sword }, {}, {}]));
}, [SEED_BAG, WORN_SWORD]);

try {
  step = "load";
  await page.goto(BASE);
  await page.waitForFunction(() => window.__state?.started && window.__engine, null, { timeout: 30_000 });
  await page.waitForTimeout(600);

  const seeded = await bag(page);
  ok(qty(seeded, 43) === 1 && qty(seeded, 66) === 2 && qty(seeded, 70) === 1,
    `the seeded bag is ${JSON.stringify(seeded)}`);
  ok(qty(seeded, WORN_SWORD) === 0, "the worn sword is not in the bag");
  ok(JSON.stringify((await equipment(page))[0]) === JSON.stringify({ right: WORN_SWORD }),
    "the lead starts wearing the sword");

  // 1. The pause ITEMS page's rows, in the order the original's directory gives.
  step = "pause ITEMS order";
  const itemsTab = await openTab(page, 0);
  ok(JSON.stringify(itemsTab) === JSON.stringify([[43, 1], [66, 2], [70, 1]]),
    `the Items tab reads in item-id order; got ${JSON.stringify(itemsTab)}`);
  ok(JSON.stringify(itemsTab.map((r) => r[0])) !== JSON.stringify([70, 66, 43]),
    "and not in the order the bag was filled");
  await page.waitForTimeout(700);
  await shot(page, "1-items-tab-order");
  const keyTab = await openTab(page, 4);
  ok(JSON.stringify(keyTab) === JSON.stringify([[1, 1], [400, 1]]),
    `the Important Items tab reads in item-id order; got ${JSON.stringify(keyTab)}`);
  await page.waitForTimeout(700);
  await shot(page, "2-important-items-tab-order");

  step = "close the page";
  await page.evaluate(() => { window.__state.menuOpen = false; });
  await page.waitForTimeout(200);

  // 2. A story line that takes an item away.
  step = "story take";
  await page.evaluate(() => window.__applyStoryFlag(0x8000 + 66, 0));
  const took = await bag(page);
  ok(qty(took, 66) === 1, `one AntidoteDisk came out of the bag; now ${JSON.stringify(took)}`);
  ok(qty(await savedBag(page), 66) === 1, "and the saved bag agrees");
  ok(qty(took, 43) === 1 && qty(took, 70) === 1, "the other items are untouched");
  await page.evaluate(() => window.__applyStoryFlag(0x8000 + 66, 0));
  const took2 = await bag(page);
  ok(qty(took2, 66) === 0, `the last AntidoteDisk is gone; now ${JSON.stringify(took2)}`);
  ok(!took2.some(([id]) => id === 66), "and its slot left the bag");
  await page.evaluate(() => window.__applyStoryFlag(0x8000 + 66, 0));
  ok(qty(await bag(page), 66) === 0, "taking it again stays at nothing");
  const afterTake = await openTab(page, 0);
  ok(JSON.stringify(afterTake) === JSON.stringify([[43, 1], [70, 1]]),
    `the Items tab lost the row too; got ${JSON.stringify(afterTake)}`);
  await page.waitForTimeout(700);
  await shot(page, "3-after-the-take");
  await page.evaluate(() => { window.__state.menuOpen = false; });

  // 3. The auto-unequip: a removal that finds nothing carried takes off the wearer.
  step = "auto-unequip";
  await page.evaluate(() => window.__applyStoryFlag(0x8000 + 176, 0));
  const afterUnequip = await equipment(page);
  ok(!afterUnequip[0] || afterUnequip[0].right !== WORN_SWORD,
    `the sword came off the lead's hand; equipment ${JSON.stringify(afterUnequip)}`);
  ok(qty(await bag(page), 176) === 0, "and it did not appear in the bag");
  const savedGear = await page.evaluate(() => JSON.parse(localStorage.getItem("equipment") ?? "[]"));
  ok(!savedGear[0] || savedGear[0].right !== WORN_SWORD,
    `the saved gear agrees; ${JSON.stringify(savedGear)}`);

  // 4. The 99 cap, on the grant path the story uses.
  step = "cap";
  await page.evaluate(() => {
    window.__state.inventory = [{ id: 43, qty: 98 }];
    window.__engine.state.inventory.add(43, 1);
  });
  ok(qty(await bag(page), 43) === 99, "a grant at 98 lands on 99");
  await page.evaluate(() => window.__engine.state.inventory.add(43, 1));
  ok(qty(await bag(page), 43) === 99, "and a second grant stays at 99");
  await openTab(page, 0);
  await page.waitForTimeout(700);
  await shot(page, "4-cap-99");
  await page.evaluate(() => { window.__state.menuOpen = false; });

  step = "no page errors";
  ok(errors.length === 0, `${errors.length} page error(s): ${errors.join(" | ")}`);
  console.log("RESULT", JSON.stringify({ ok: problems.length === 0, seeded, itemsTab, keyTab, took, took2, afterTake, problems }));
} catch (e) {
  problems.push(`${step}: ${e.message}`);
  console.log("RESULT", JSON.stringify({ ok: false, problems }));
} finally {
  await browser.close();
}
process.exit(problems.length ? 1 : 0);