// The SELL list with a full weapons bag, in the opt-in original-code shop and in
// the shipped translated merchant. Run through tools/run-playwright.sh with web/
// served on VERIFY_PORT (default 8742):
//   VERIFY_PORT=8837 tools/run-playwright.sh tools/verify_shop_sell_paging.mjs .bunny-scratch/shop-sell-paging
//
// The browser route is the translated merchant (engine/dw3/ui ShopRootSession), so
// the page and the cursor are read off the list widget's own fields (page +0x6C4,
// the flat row index +0x6BC, and the row's item id) instead of the walker's
// `page`/`cursor`/`_currentList`, which the port replaced.
//
// The old "before" mode rewrote web/shop.js in flight to recreate the pre-port
// eight-rows-one-column list. That file is no longer the routed screen
// (web/game.js picks the translated merchant unless ?nativeShop=1), so the
// comparison it drew no longer described anything a player sees; the reference
// run below is the original-code shop and is kept.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const out = process.argv[2] ?? ".bunny-scratch/shop-sell-paging";
mkdirSync(out, { recursive: true });
const ids = [92, 93, 94, 95, 96, 97, 98, 99, 100, 101, 106, 107, 108, 109, 110, 111];
const browser = await chromium.launch();
const errors = [];

/** The merchant root's BUY/SELL choice is state 3; the sell actor's live list is state 6. */
const waitRootChoices = (page) => page.waitForFunction(() =>
  window.__shop?._session?.mem.read32(window.__shop._session.root + 0x10) === 3, null, { timeout: 20000 });
const waitActorState = (page, value) => page.waitForFunction((expected) => {
  const session = window.__shop?._session;
  if (!session) return false;
  const context = session.mem.read32(session.root + 0x24);
  const actor = session.mem.read32(context + 0x1c);
  return !!actor && session.mem.read32(actor + 0x10) === expected;
}, value, { timeout: 15000 });

/** The SELL list widget: how many rows, which page, the flat row and its item id. */
const listState = (page) => page.evaluate(() => {
  const session = window.__shop?._session;
  if (!session) return null;
  const mem = session.mem;
  const context = mem.read32(session.root + 0x24);
  const actor = mem.read32(context + 0x1c);
  if (!actor) return null;
  const actorContext = mem.read32(actor + 0x24);
  const list = actorContext ? mem.read32(actorContext) : 0;
  if (!list) return { actorState: mem.read32(actor + 0x10), list: null };
  const index = mem.read32(list + 0x6bc);
  const mode = mem.read32(list + 0x5c);
  const stock = mem.read32(list + 0x6b4);
  const table = Array.from({ length: Math.min(20, mem.read32(list + 0x6c0)) },
    (_, i) => (mem.read16(list + i * 2 + 0x64) << 16) >> 16);
  return {
    actorState: mem.read32(actor + 0x10),
    list: {
      index,
      count: mem.read32(list + 0x6c0),
      page: mem.read32(list + 0x6c4),
      pageCount: mem.read32(list + 0x6c8),
      pageSize: mem.read32(list + 0x6d4),
      item: mode !== 0 ? table[index] : ((mem.read16(stock + index * 2) << 16) >> 16),
      table,
    },
  };
});

async function visit(mode, bag = ids) {
  const reference = mode.startsWith("reference");
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", e => errors.push(`${mode}: ${e.message}`));
  const suffix = reference ? "&nativeShop=1" : "";
  await page.goto(`${baseUrl(8742)}/index.html?skipTitle=1&noEncounters=1${suffix}`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__state?.started && window.__state.shops);
  await page.evaluate((items) => {
    window.__state.inventory = items.map(id => ({ id, qty: 1 }));
    window.__state.bits = 10000;
    window.__labOpen("shop", 0);
  }, bag);
  const wait = reference ? 1000 : 450;
  const press = async key => {
    await page.keyboard.down(key);
    await page.waitForTimeout(70);
    await page.keyboard.up(key);
    await page.waitForTimeout(wait);
  };
  // The translated merchant's root exposes its state word; the original-code
  // reference has its own host state and is driven on wall-clock alone.
  if (!reference) await waitRootChoices(page);
  await press("ArrowDown"); await press("c"); // SELL category choices
  if (!reference) await waitActorState(page, 2);
  await press("ArrowDown"); await press("c"); // Weapons
  if (!reference) await waitActorState(page, 6);
  await page.locator("#game").screenshot({ path: `${out}/${mode}-weapons-page-1.png` });
  if (mode.startsWith("browser")) {
    const first = await listState(page);
    if (first?.list?.count !== 16 || first.list.index !== 0 || first.list.page !== 0
        || first.list.item !== 92)
      throw new Error(`${mode} page 1 ${JSON.stringify(first)}`);
    console.log(`${mode} page 1`, JSON.stringify(first.list));
  }
  await press("e"); // R1, next page
  await page.locator("#game").screenshot({ path: `${out}/${mode}-weapons-page-2.png` });
  if (mode.startsWith("browser")) {
    const second = await listState(page);
    if (second?.list?.page !== 1 || second.list.index !== 14 || second.list.item !== 110)
      throw new Error(`${mode} page 2 ${JSON.stringify(second)}`);
    console.log(`${mode} page 2`, JSON.stringify(second.list));
  }
  await page.close();
}

/**
 * A sword that is on a partner's hand and NOT in the bag. The merchant's SELL
 * shelf asks the resident provider for a POSITIVE directory kind (its category
 * cursor is clamped to 0..3 and the four kinds it asks for are stitshop
 * 0x8008CAA8's first four words, 1/2/3/4), and a positive kind admits an id only
 * when the CARRIED byte is non-zero (exe/f3.s). So the worn sword is not on the
 * shelf, and the shelf says so rather than opening.
 */
async function visitWorn() {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", e => errors.push(`worn: ${e.message}`));
  await page.goto(`${baseUrl(8742)}/index.html?skipTitle=1&noEncounters=1`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__state?.started && window.__state.shops);
  await page.evaluate((rest) => {
    window.__state.inventory = rest.map(id => ({ id, qty: 1 }));
    // Short Sword (92) is worn by the lead and absent from the bag.
    window.__state.equipment = [{ right: 92 }, {}, {}];
    window.__state.worn = { 92: 1 };
    window.__state.bits = 10000;
    window.__labOpen("shop", 0);
  }, ids.filter(id => id !== 92));
  const press = async key => {
    await page.keyboard.down(key);
    await page.waitForTimeout(70);
    await page.keyboard.up(key);
    await page.waitForTimeout(450);
  };
  await waitRootChoices(page);
  await press("ArrowDown"); await press("c");       // SELL
  await waitActorState(page, 2);
  await press("ArrowDown"); await press("c");       // Weapons -> the shelf's list
  await waitActorState(page, 6);
  const before = await listState(page);
  const table = before?.list?.table ?? [];
  if (table.length === 0) throw new Error(`no SELL shelf to read: ${JSON.stringify(before)}`);
  if (table.includes(92))
    throw new Error(`a worn-only sword is on the SELL shelf: ${JSON.stringify(before.list)}`);
  if (table.length !== ids.length - 1)
    throw new Error(`expected the ${ids.length - 1} carried swords: ${JSON.stringify(table)}`);
  console.log("worn shelf", JSON.stringify({ count: before.list.count, rows: table.length, has92: false }));
  await page.locator("#game").screenshot({ path: `${out}/worn-weapons-shelf.png` });
  await page.close();
}

try {
  await visit("reference");
  await visit("browser");
  await visit("reference-reversed", [...ids].reverse());
  await visit("browser-reversed", [...ids].reverse());
  await visitWorn();
  if (errors.length) throw new Error(errors.join(" | "));
  console.log("verify_shop_sell_paging: OK (reference and browser captures; browser page assertions; a worn-only sword is not offered)");
} finally {
  await browser.close();
}