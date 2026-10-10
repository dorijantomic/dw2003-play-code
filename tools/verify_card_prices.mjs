// Verify the decoded card-shop price list end to end in the real game module.
//
// The shop calls the routine at 0x8008CB9C (= F0x8008923C), a linear search
// over 44 (cardId, price) pairs at 0x8008CD20; a card absent from the list
// costs 1. This drives web/cardstate.js and web/cardshop.js through the UI lab
// rather than a mock: it checks the lookup's answers and then walks into
// "Buy One Card" so the prices are actually rendered.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const OUT = process.argv[2] || "/tmp/cardprices";
mkdirSync(OUT, { recursive: true });

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
p.on("pageerror", (e) => errors.push(String(e)));
p.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

await p.goto(`${baseUrl(8742)}/ui-lab.html`, { waitUntil: "networkidle" });
const f = p.frames().find((x) => x.url().includes("index.html")) || p.mainFrame();
await f.waitForFunction(() => !!window.__labOpen, null, { timeout: 20000 });
await f.evaluate(() => window.__labOpen("cardshop"));
await p.waitForTimeout(3000);

const fail = [];
const check = (ok, msg) => { if (!ok) fail.push(msg); console.log(`${ok ? "ok  " : "FAIL"} ${msg}`); };

const r = await f.evaluate(async () => {
  const m = await import("./cardstate.js");
  await m.loadCardPrices();
  const cat = m.catalog();
  const pick = (n) => cat.cards.find((c) => c.name === n);
  return {
    kotemon: m.cardPrice(pick("Kotemon")),
    diaboromon: m.cardPrice(pick("Diaboromon")),
    byId: m.cardPrice(27),                     // Chaos Virus, by bare id
    unlisted: m.cardPrice(pick("Agumon")),     // not in the list
    nullCard: m.cardPrice(null),
    dflt: m.cardDefaultPrice(),
  };
});
console.log("lookup:", JSON.stringify(r));
check(r.kotemon === 500, "Kotemon costs 500");
check(r.diaboromon === 13000, "Diaboromon costs 13000");
check(r.byId === 11000, "a bare card id resolves (27 -> 11000)");
check(r.unlisted === 1, "a card absent from the list costs 1, the decoded default");
check(r.dflt === 1, "the default price is the original's 1");
check(r.nullCard === 0, "no card selected costs nothing");

// Walk into the buy list so the prices are drawn, not just computed.
await p.locator("iframe").first().click({ position: { x: 200, y: 200 } }).catch(() => {});
await p.waitForTimeout(300);
await p.keyboard.press("Enter");
await p.waitForTimeout(1200);
await p.locator("iframe").first().screenshot({ path: `${OUT}/buy-list.png` })
  .catch(() => p.screenshot({ path: `${OUT}/buy-list.png` }));
console.log(`screenshot: ${OUT}/buy-list.png`);

// The buy list must now be the shop's SIX cards, not the whole catalog.
const stock = await f.evaluate(async () => {
  const m = await import("./cardstate.js");
  await m.loadCardShops();
  return {
    ids: m.cardShopIds(),
    seiryu: m.shopStock(0x37),
    unknown: m.shopStock(0x99),   // falls back to record 0
    beforeAny: m.shopStock(undefined),
  };
});
console.log("stock:", JSON.stringify(stock).slice(0, 220));
check(stock.ids.length === 24, "24 stock sets are loaded");
check(stock.seiryu.length === 6, "a shop stocks six cards, not the catalog");
check(JSON.stringify(stock.unknown) === JSON.stringify(stock.ids.length ? stock.beforeAny : []),
      "an unknown shop id falls back to record 0, as the disc does");

// The per-card price is drawn in the purchase-confirm popup (priceLabel), not
// in the browse list, so open it. The cursor starts on Sacred Spear, an Epic
// card that is NOT in the price list -- so this renders the decoded default.
await p.keyboard.press("Enter");
await p.waitForTimeout(800);
await p.locator("iframe").first().screenshot({ path: `${OUT}/buy-popup-unlisted.png` })
  .catch(() => p.screenshot({ path: `${OUT}/buy-popup-unlisted.png` }));
console.log(`screenshot: ${OUT}/buy-popup-unlisted.png`);

if (errors.length) { console.log("PAGE ERRORS:"); errors.forEach((e) => console.log("  " + e)); }
console.log(fail.length ? `\n${fail.length} FAILED` : "\nall checks passed");
await b.close();
process.exit(fail.length || errors.length ? 1 : 0);
