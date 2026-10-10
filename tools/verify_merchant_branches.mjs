import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

// Plan 6.2 remaining branches at the real Asuka Armory counter: decline the
// Equip? offer, an item no party member can wear, the money boundary and the
// quantity clamp, plus a SELL leg. A starting save is parked in Asuka City (the
// original captures parked QuickSave1 at this counter); after that every step
// is an ordinary button.
//
// Server: python3 -m http.server 8741 --directory web
// Run:    tools/run-playwright.sh tools/verify_merchant_branches.mjs
const ROOT = process.env.MERCHANT_ROOT || `${baseUrl(8741)}/`;
const BASE = ROOT + "?skipTitle=1&map=s245&noEncounters=1";
const OUT = process.env.MERCHANT_SHOT || "/tmp/merchant-branches";
const SWORD = { id: 92, price: 200, sell: 100 };   // ShortSword: Kotemon only (mask 1)
const GLOVE = { id: 106, price: 200, sell: 100 };  // LeatherGlove: Kumamon only (mask 2) -- nobody here
mkdirSync(OUT, { recursive: true });

const SAVE = {
  engineSchema: "2",
  playerName: "Junior",
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
  localStorage.setItem("assetMode", "authentic");
  localStorage.setItem("engineSchema", "2");
  if (sessionStorage.getItem("merchantFixture")) return;
  sessionStorage.setItem("merchantFixture", "1");
  for (const [k, v] of Object.entries(save)) localStorage.setItem(k, v);
  for (const k of ["flags", "progressOrdinal", "engineFlags", "pendingParty", "digimonNames"])
    localStorage.removeItem(k);
}, SAVE);

const key = (k) => page.keyboard.press(k);
const snap = () => page.evaluate(() => {
  const s = window.__state, sh = window.__shop;
  return {
    bits: s.bits,
    bag: Object.fromEntries((s.inventory ?? []).map((x) => [x.id, x.qty])),
    equip: JSON.parse(JSON.stringify(s.equipment ?? [])),
    screen: sh?.screen, bsIdx: sh?.bsIdx, catIdx: sh?.catIdx, cursor: sh?.cursor, qty: sh?.qty,
    feedback: sh?.feedbackMsg ?? null,
    equipCards: (sh?._equipCards?.(s) ?? []).map((c) => ({ charId: c.member?.charId, slot: c.preview?.slot ?? null, accessible: c.accessible })),
  };
});
const shot = async (n) => writeFileSync(`${OUT}/${n}.png`,
  Buffer.from((await page.locator("canvas#game").evaluate((el) => el.toDataURL("image/png"))).split(",")[1], "base64"));

async function toRoot() {
  for (let i = 0; i < 5; i++) {
    const sc = await page.evaluate(() => window.__shop.screen);
    if (sc === "root") return;
    await key("x");           // Triangle backs out one screen
    await page.waitForTimeout(180);
  }
}
const clampUp = async (n = 6) => { for (let i = 0; i < n; i++) { await key("ArrowUp"); await page.waitForTimeout(50); } };
async function openBuyList() {
  await toRoot();
  await key("ArrowUp"); await page.waitForTimeout(80);      // root cursor -> BUY
  await key("c"); await page.waitForTimeout(150);           // root BUY -> list
  await clampUp();                                          // list cursor is remembered; clamp to row 0
}
async function buy(itemIndex, { decline = false, right = 0 } = {}) {
  await openBuyList();
  // BUY is a 2-column grid: Left/Right step one item, Up/Down step a row (2).
  for (let i = 0; i < itemIndex; i++) { await key("ArrowRight"); await page.waitForTimeout(80); }
  await key("c"); await page.waitForTimeout(150);           // -> qty
  for (let i = 0; i < right; i++) { await key("ArrowRight"); await page.waitForTimeout(80); }
  const qty = await page.evaluate(() => window.__shop.qty);
  await key("c"); await page.waitForTimeout(150);           // -> confirm
  await key("c"); await page.waitForTimeout(250);           // commit
  const afterCommit = await snap();
  if (decline) {
    // Equip? Yes/No: Down picks No, Cross returns to the list.
    await key("ArrowDown"); await page.waitForTimeout(100);
    await key("c"); await page.waitForTimeout(200);
  }
  return { qty, afterCommit, after: await snap() };
}
async function sellFromRoot(categoryIndex, { right = 0 } = {}) {
  await toRoot();
  await key("ArrowDown"); await page.waitForTimeout(100);   // BUY -> SELL
  await key("c"); await page.waitForTimeout(200);           // root -> sellcat
  for (let i = 0; i < categoryIndex; i++) { await key("ArrowDown"); await page.waitForTimeout(80); }
  await key("c"); await page.waitForTimeout(200);           // category -> list
  await clampUp();
  await key("c"); await page.waitForTimeout(150);           // -> qty
  for (let i = 0; i < right; i++) { await key("ArrowRight"); await page.waitForTimeout(80); }
  await key("c"); await page.waitForTimeout(150);           // -> confirm
  await key("c"); await page.waitForTimeout(250);           // commit
  return await snap();
}
async function setBits(n) {
  await page.evaluate((v) => { window.__state.bits = v; }, n);
}

const results = {};
try {
  await page.goto(BASE);
  await page.waitForFunction(() => window.__state?.started, null, { timeout: 30_000 });
  await page.waitForFunction(() => window.__state.manifest.maps[window.__state.mapIdx].id === "s245");
  await page.waitForTimeout(400);
  await page.locator("canvas#game").click({ position: { x: 160, y: 200 } });
  for (let i = 0; i < 20; i++) {
    const x = await page.evaluate(() => window.__state.x);
    if (x <= 332) break;
    await page.keyboard.down("ArrowLeft"); await page.waitForTimeout(120); await page.keyboard.up("ArrowLeft");
    await page.waitForTimeout(60);
  }
  for (let i = 0; i < 20; i++) {
    const y = await page.evaluate(() => window.__state.y);
    if (y <= 382) break;
    await page.keyboard.down("ArrowUp"); await page.waitForTimeout(120); await page.keyboard.up("ArrowUp");
    await page.waitForTimeout(60);
  }
  for (let i = 0; i < 30 && !(await page.evaluate(() => window.__shop?.isOpen?.())); i++) {
    await key("Enter"); await page.waitForTimeout(220);
  }
  results.opened = await snap();
  if (!results.opened.screen) throw new Error("merchant did not open");

  // 1. Decline the Equip? offer: sword stays bagged, slot unchanged.
  results.decline = await buy(0, { decline: true });
  results.declineAfterSell = await sellFromRoot(1);          // Weapons -> sell it back

  // 2. An item nobody in this party can wear: LeatherGlove is Kumamon-only.
  results.unwearable = await buy(1);   // LeatherGlove 106, Kumamon-only
  await shot("unwearable-after-buy");
  if (results.unwearable.afterCommit.screen === "equip") {
    await key("c"); await page.waitForTimeout(200);          // Yes -> Equip who?
    results.unwearableAfterYes = await snap();
    await key("c"); await page.waitForTimeout(200);          // try to assign
    results.unwearableAfterAssign = await snap();
  }
  results.unwearableAfterSell = await sellFromRoot(1);

  // 3. Money boundary: below the price the confirm is refused in place.
  await setBits(10);
  await openBuyList();
  await key("c"); await page.waitForTimeout(200);            // try to buy row 0 (ShortSword)
  results.poor = await snap();
  await setBits(1000);

  // 4. Quantity clamp: +10 is capped by what the purse can afford (1000/200 = 5).
  results.qty = await buy(0, { right: 1 });
  await shot("qty-clamped");
  results.qtyAfterSell = await sellFromRoot(1, { right: 1 });
} finally {
  await browser.close();
}
const assert = (c, m) => { if (!c) { console.error(JSON.stringify(results, null, 2)); throw new Error(m); } };
// 1. Declining Equip? keeps the sword bagged and the slots untouched; selling
//    it back returns the sale price.
assert(results.decline.afterCommit.screen === "equip", "Equip? offer missing for a wearable item");
assert(results.decline.after.screen === "list", `decline did not return to the list: ${results.decline.after.screen}`);
assert(results.decline.after.bag[SWORD.id] === 1 && results.decline.after.equip.length === 0,
  `declining Equip? changed state: ${JSON.stringify(results.decline.after)}`);
assert(results.declineAfterSell.bits === 900 && !results.declineAfterSell.bag[SWORD.id],
  `SELL leg wrong: ${JSON.stringify(results.declineAfterSell)}`);
// 2. No present member can wear the LeatherGlove -> no Equip? offer at all.
assert(results.unwearable.afterCommit.equipCards.every((c) => !c.accessible),
  "fixture: glove unexpectedly wearable");
assert(results.unwearable.afterCommit.screen === "list",
  `Equip? offered with no wearer: ${JSON.stringify(results.unwearable.afterCommit)}`);
assert(results.unwearable.afterCommit.bag[GLOVE.id] === 1,
  `glove not bagged: ${JSON.stringify(results.unwearable.afterCommit.bag)}`);
assert(results.unwearableAfterSell.bits === 800 && !results.unwearableAfterSell.bag[GLOVE.id],
  `glove SELL wrong: ${JSON.stringify(results.unwearableAfterSell)}`);
// 3. Below the price the list refuses in place and takes no money.
assert(results.poor.screen === "list" && results.poor.feedback === "Not enough BIT.",
  `money boundary: ${JSON.stringify(results.poor)}`);
assert(results.poor.bits === 10, `money boundary spent money: ${results.poor.bits}`);
// 4. The +10 stepper is capped by the purse: 1000/200 = 5, not 11.
assert(results.qty.qty === 5, `quantity clamp: ${results.qty.qty}`);
assert(results.qty.afterCommit.bits === 0 && results.qty.afterCommit.bag[SWORD.id] === 5,
  `quantity buy wrong: ${JSON.stringify(results.qty.afterCommit)}`);
assert(results.qtyAfterSell.bits === 500 && !results.qtyAfterSell.bag[SWORD.id],
  `quantity SELL wrong: ${JSON.stringify(results.qtyAfterSell)}`);
console.log(JSON.stringify({ ok: true, results }, null, 2));
