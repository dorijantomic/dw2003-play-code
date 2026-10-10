import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";
import { backOutToTitle, loadFromCard, openContinueCard, saveToCard } from "./memcard-continue.mjs";

// Plan 6.2: the real merchant counter. A starting save is parked in Asuka City
// (the same place the original captures parked QuickSave1); from there every
// step is an ordinary button: walk to Gargomon, talk it open, BUY the Short
// Sword, take the Equip? offer, then reload the page as the browser's Continue
// and read money, bag and equipped slot back.
//
// The counter is the TRANSLATED merchant (web/shop-translated.js). Its screen
// keeps its own copy of the wallet, bag and gear while it is open and commits
// them to the walker once, on close, so the checks below read the screen's own
// record (ShopRootSession.result()) while it is open and the walker's state
// after it has closed. The screen's own state words are read from its task
// tree: the root's flow word, and the BUY actor's machine word (3 the stock
// list, 8 the quantity spinner, 17 the Buy/No plate, 27 the Equip? plate,
// 32 the Equip who? plate, 38 the "Equipped." message).
//
// Server: python3 -m http.server 8741 --directory web
// Run:    tools/run-playwright.sh tools/verify_merchant_buy_equip.mjs
const ROOT = process.env.MERCHANT_ROOT || `${baseUrl(8741)}/`;
const BASE = ROOT + "?skipTitle=1&map=s245&noEncounters=1";
// The title boot. The country/language screen (code 0x1600) comes before it and ends
// in the opening movie, so the leg that comes back through the title skips it.
const TITLE = ROOT + "?skipLanguage=1&noEncounters=1";
const OUT = process.env.MERCHANT_SHOT || "/tmp/merchant";
const SWORD = 92;        // ShortSword: 200 bits, slot "right", Kotemon-line only
const PRICE = 200;
mkdirSync(OUT, { recursive: true });

const SAVE = {
  engineSchema: "2",        // skip the one-time cutover wipe
  playerName: "Junior",    // makes the title Continue live
  fieldLocation: JSON.stringify({ version: 1, mapId: "s245", x: 332, y: 390, dir: "left" }),
  bits: "1000",
  inventory: "[]",
  equipment: "[]",
  charId: "p003pken",
  party: JSON.stringify(["p003pken", "p009rena", "p010pata"]),
  partyStats: JSON.stringify([null,
    { digimonId: 7, level: 12, xp: 0, hp: 180, maxHp: 180, mp: 90, maxMp: 90, bonuses: {}, elemBonuses: {} },
    { digimonId: 8, level: 12, xp: 0, hp: 190, maxHp: 190, mp: 95, maxMp: 95, bonuses: {}, elemBonuses: {} }]),
  partnerStats: JSON.stringify({
    digimonId: 1, level: 14, xp: 0, hp: 220, maxHp: 220, mp: 110, maxMp: 110,
    stats: { str: 60, def: 40, spt: 30, wis: 30, spd: 35, chr: 20 },
    bonuses: {}, elemBonuses: {},
  }),
};

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
page.on("pageerror", (e) => console.error("PAGEERROR", e));
await page.addInitScript((save) => {
  // assetMode/engineSchema must be set before the game's init runs on every
  // load. The save fixture itself is seeded ONCE into this tab, so the later
  // Continue navigation reads back what the shop actually persisted rather
  // than the fixture again.
  localStorage.setItem("assetMode", "authentic");
  localStorage.setItem("engineSchema", "2");
  if (sessionStorage.getItem("merchantFixture")) return;
  sessionStorage.setItem("merchantFixture", "1");
  for (const [k, v] of Object.entries(save)) localStorage.setItem(k, v);
  for (const k of ["flags", "progressOrdinal", "engineFlags", "pendingParty", "digimonNames"])
    localStorage.removeItem(k);
}, SAVE);

const snap = () => page.evaluate(() => {
  const s = window.__state;
  return {
    bits: s.bits,
    bag: Object.fromEntries((s.inventory ?? []).map((x) => [x.id, x.qty])),
    equip: JSON.parse(JSON.stringify(s.equipment ?? [])),
    shopOpen: window.__shop?.isOpen?.() ?? false,
    x: Math.round(s.x), y: Math.round(s.y), map: s.manifest.maps[s.mapIdx].id,
  };
});
/**
 * The translated merchant's own diagnostics and task tree: the root's flow word,
 * the BUY actor's machine word and its fields, and the screen's own saved record.
 */
const shopTree = () => page.evaluate(() => {
  const sh = window.__shop;
  const s = sh?._session;
  if (!s) return { diag: sh?.diagnostics?.() ?? null, root: null, buy: null, save: null, tasks: [] };
  const names = new Map([...s.tree.classes].map(([id, k]) => [id, k.name]));
  const rootCtx = s.mem.read32(s.root + 0x24) >>> 0;
  const actor = rootCtx ? s.mem.read32(rootCtx + 0x1c) >>> 0 : 0;
  return {
    diag: sh.diagnostics(),
    root: s.mem.read32(s.root + 0x10) | 0,
    buy: actor && s.tree.tasks.has(actor) ? {
      state: s.mem.read32(actor + 0x10) | 0,
      itemId: s.mem.read32(actor + 0x60) | 0,
      quantity: s.mem.read32(actor + 0x64) | 0,
      cursor: s.mem.read32(actor + 0x74) | 0,
      member: s.mem.read32(actor + 0x78) | 0,
    } : null,
    save: s.result(),
    tasks: [...s.tree.tasks.values()].map((t) => names.get(t.classId)),
  };
});
/** Hold a button long enough for one display frame, as a player does. */
const press = async (k, wait = 220) => {
  await page.keyboard.down(k);
  await page.waitForTimeout(110);
  await page.keyboard.up(k);
  await page.waitForTimeout(wait);
};
/** Wait until the merchant's BUY actor reaches `state`, then report the screen. */
const buyAt = async (state, what, frames = 120) => {
  await page.waitForFunction((n) => {
    const s = window.__shop?._session;
    if (!s) return false;
    const ctx = s.mem.read32(s.root + 0x24) >>> 0;
    const actor = ctx ? s.mem.read32(ctx + 0x1c) >>> 0 : 0;
    return !!actor && s.tree.tasks.has(actor) && (s.mem.read32(actor + 0x10) | 0) === n;
  }, state, { timeout: frames * 250, polling: 100 });
  const tree = await shopTree();
  if (tree.buy?.state !== state) throw new Error(`merchant never reached ${what}: ${JSON.stringify(tree)}`);
  return tree;
};
const key = (k) => page.keyboard.press(k);
const shot = async (n) => writeFileSync(`${OUT}/${n}.png`,
  Buffer.from((await page.locator("canvas#game").evaluate((el) => el.toDataURL("image/png"))).split(",")[1], "base64"));

const results = {};
try {
  await page.goto(BASE);
  await page.waitForFunction(() => window.__state?.started, null, { timeout: 30_000 });
  await page.waitForFunction(() => document.querySelectorAll("#mapSelect option").length > 1);

  // Starting fixture: the save is parked in Asuka City (the same place the
  // original captures parked QuickSave1), a short walk from the Armory counter.
  await page.waitForFunction(() => window.__state.manifest.maps[window.__state.mapIdx].id === "s245");
  await page.waitForTimeout(400);
  await page.locator("canvas#game").click({ position: { x: 160, y: 200 } });
  results.start = await snap();

  // Walk left toward Gargomon (npc 23 at 304,369) until he is in talk range.
  for (let i = 0; i < 20; i++) {
    const x = await page.evaluate(() => window.__state.x);
    if (x <= 332) break;
    await page.keyboard.down("ArrowLeft");
    await page.waitForTimeout(120);
    await page.keyboard.up("ArrowLeft");
    await page.waitForTimeout(60);
  }
  for (let i = 0; i < 20; i++) {
    const y = await page.evaluate(() => window.__state.y);
    if (y <= 382) break;
    await page.keyboard.down("ArrowUp");
    await page.waitForTimeout(120);
    await page.keyboard.up("ArrowUp");
    await page.waitForTimeout(60);
  }
  results.walked = await page.evaluate(() => ({ x: window.__state.x, y: window.__state.y, dir: window.__state.dir }));

  // Talk until the counter opens. Each textbox advance is an ordinary Circle.
  for (let i = 0; i < 30 && !(await page.evaluate(() => window.__shop?.isOpen?.())); i++) {
    await key("Enter");
    await page.waitForTimeout(220);
  }
  results.opened = await snap();
  if (!results.opened.shopOpen) throw new Error(`merchant did not open: ${JSON.stringify(results.opened)}`);
  // The shop's name plate and the BUY/SELL choice open (root flow word 3).
  await page.waitForFunction(() => {
    const s = window.__shop?._session;
    return !!s && (s.mem.read32(s.root + 0x10) | 0) === 3;
  }, null, { timeout: 30_000, polling: 100 });
  results.shop = await shopTree();
  await shot("shop-buy-list");

  // Cancel branch first: go to the confirm plate and Triangle out; state must
  // not move.
  results.beforeCancel = await shopTree();
  await press("c");                       // BUY row
  results.stockList = await buyAt(3, "the stock list");
  await press("c");                       // pick the first item -> quantity
  results.quantity = await buyAt(8, "the quantity spinner");
  await press("c");                       // quantity -> the Buy/No plate
  results.confirmPlate = await buyAt(17, "the Buy/No plate");
  await press("x");                       // Triangle = cancel
  results.afterCancel = await buyAt(3, "the stock list again");

  // Buy for real.
  await press("c");                       // list -> qty
  await buyAt(8, "the quantity spinner");
  await press("c");                       // qty -> confirm
  await buyAt(17, "the Buy/No plate");
  await press("c");                       // confirm -> commit
  results.afterBuy = await buyAt(27, "the Equip? plate");

  // Equip? Yes -> Equip who? Kotemon -> Equipped.
  await press("c");                       // Equip? Yes
  results.equipWho = await buyAt(32, "the Equip who? plate");
  // The Short Sword is a Kotemon-line weapon, so the picker offers only the
  // lead partner and the cursor cannot be walked onto the other two pedestals.
  await press("ArrowDown");
  await page.waitForTimeout(250);
  results.equipWhoAfterDown = await shopTree();
  results.equipDiag = {
    selected: results.equipWho.buy,
    party: await page.evaluate(() => [...(window.__state.party ?? [])]),
    tasks: results.equipWho.tasks,
  };
  await press("c");                       // equip on the highlighted partner
  results.afterEquip = await buyAt(39, "the \"Equipped.\" message");
  // Leave the counter; the screen commits the wallet, bag and gear once, on close.
  await press("c");                       // the message closes
  await buyAt(3, "the stock list after equipping");
  for (let i = 0; i < 6 && (await page.evaluate(() => window.__shop?.isOpen?.())); i++) {
    await press("x", 700);                // Triangle leaves the BUY list, then the counter
  }
  await page.waitForFunction(() => !window.__shop?.isOpen?.(), null, { timeout: 20_000, polling: 100 });
  results.closed = await snap();
  results.feedback = await page.evaluate(() => (window.__shop?._session?.widgets.textWidgets() ?? []).length);
  await shot("shop-equipped");

  // Effective stats from the same engine rule the sheet and battle use.
  results.bonuses = await page.evaluate(async () => {
    const eng = await import("./vendor/engine.js");
    const b = eng.equipmentBonuses(window.__state.equipment?.[0] ?? {});
    return { str: b.str, def: b.def, accPool: b.accPool };
  });

  // Continue: leave the counter, go back through the title screen's Continue
  // (the browser's own save reload) and read the committed state back.
  // The purchase survives a reload. It goes on the card first — the SAVE card
  // is `openMemoryCard("save")`, the call an inn or tower save point's HANDOFF
  // makes — because Continue only reaches the field by LOADING a file: the
  // card's own exit answers 0xE00, the title, when LOAD mode closes with nothing
  // loaded (pro/stgmcard.s 0x4dc4-0x4e2c).
  results.slot = await saveToCard(page, async () => { await page.evaluate(() => window.__labOpen("save")); });
  await page.goto(TITLE);
  await page.waitForFunction(() => {
    const t = document.querySelector("#title-screen");
    return t && !t.hidden;
  }, null, { timeout: 30_000 });
  await openContinueCard(page);
  results.backOut = await backOutToTitle(page);
  if (results.backOut.started || results.backOut.phase !== "prompt" || results.backOut.exitScreen !== 0xe00)
    throw new Error(`backing out of the card did not return to the title: ${JSON.stringify(results.backOut)}`);
  await openContinueCard(page);
  await loadFromCard(page);
  await page.waitForTimeout(500);
  results.afterReload = await snap();
  results.afterReload.bonuses = await page.evaluate(async () => {
    const eng = await import("./vendor/engine.js");
    const b = eng.equipmentBonuses(window.__state.equipment?.[0] ?? {});
    return { str: b.str, def: b.def, accPool: b.accPool };
  });
} finally {
  await browser.close();
}

const assert = (c, m) => { if (!c) { console.error(JSON.stringify(results, null, 2)); throw new Error(m); } };
const savedBag = (r) => Object.fromEntries(r.inventory.map((x) => [x.id, x.qty]));
assert(results.opened.shopOpen, "shop never opened");
assert(results.start.bits === 1000 && Object.keys(results.start.bag).length === 0,
  `fixture not clean: ${JSON.stringify(results.start)}`);
// The BUY tab opened as its own live task under the merchant root.
assert(results.shop.root === 3 && results.shop.tasks.includes("merchant root"),
  `merchant root never reached its BUY/SELL choice: ${JSON.stringify(results.shop.diag)}`);
// The item under the cursor is the Short Sword, and the stock list is live.
assert(results.stockList.buy?.state === 3, `no stock list: ${JSON.stringify(results.stockList)}`);
assert(results.quantity.buy?.quantity === 1,
  `the quantity spinner did not open at one: ${JSON.stringify(results.quantity.buy)}`);
// The Buy/No plate is up with its cursor on Buy.
assert(results.confirmPlate.buy?.state === 17 && results.confirmPlate.buy.cursor === 0,
  `confirm plate wrong: ${JSON.stringify(results.confirmPlate.buy)}`);
// Triangling out of the plate moved nothing in the screen's own record.
assert(results.afterCancel.save.bits === 1000 && results.afterCancel.save.inventory.length === 0 &&
  results.afterCancel.save.equipment.every((slots) => Object.keys(slots).length === 0),
  `cancel changed state: ${JSON.stringify(results.afterCancel.save)}`);
// The purchase paid the price and put the sword in the bag, in the screen's record.
assert(results.afterBuy.save.bits === 1000 - PRICE, `buy bits ${results.afterBuy.save.bits}`);
assert(savedBag(results.afterBuy.save)[SWORD] === 1, `buy bag ${JSON.stringify(results.afterBuy.save.inventory)}`);
// The Equip? plate is up; only the Kotemon-line partner may take the sword.
assert(results.equipWho.tasks.includes("shop list") && results.equipWho.tasks.includes("shop detail band"),
  `BUY tab lost a child task: ${JSON.stringify(results.equipWho.tasks)}`);
assert(results.equipWho.buy.member === 0 && results.equipWhoAfterDown.buy.member === 0,
  `the Equip who? picker offered a partner the sword does not fit: ` +
  `${results.equipWho.buy.member} -> ${results.equipWhoAfterDown.buy.member}`);
assert(results.equipDiag.selected.itemId === SWORD, `wrong item equipped: ${JSON.stringify(results.equipDiag.selected)}`);
// Equipping took the sword out of the bag and wrote the right-hand slot.
assert(results.afterEquip.save.inventory.every((x) => x.id !== SWORD),
  `equipped sword still in bag: ${JSON.stringify(results.afterEquip.save.inventory)}`);
assert(results.afterEquip.save.equipment[0]?.right === SWORD,
  `equip slot not written: ${JSON.stringify(results.afterEquip.save.equipment)}`);
// Leaving the counter committed the screen's record to the walker.
assert(results.closed.bits === 1000 - PRICE && results.closed.bag[SWORD] === undefined &&
  results.closed.equip[0]?.right === SWORD,
  `the counter did not commit on close: ${JSON.stringify(results.closed)}`);
assert(results.bonuses.str > 0 || results.bonuses.accPool > 0,
  `equipment bonuses empty: ${JSON.stringify(results.bonuses)}`);
assert(results.afterReload.bits === 1000 - PRICE, `reload bits ${results.afterReload.bits}`);
assert(results.afterReload.equip[0]?.right === SWORD,
  `Continue lost the equipped sword: ${JSON.stringify(results.afterReload)}`);
assert(JSON.stringify(results.afterReload.bonuses) === JSON.stringify(results.bonuses),
  `restored equipment does not produce the same effective stats: ${JSON.stringify(results)}`);
console.log(JSON.stringify({ ok: true, summary: `merchant: bought item ${SWORD} for ${PRICE}, equipped it on the lead partner, and Continue kept it`, results }, null, 2));
