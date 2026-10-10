// Repro: home-menu cursor visibility, shop UI, see-digivolve.
// The title's Continue no longer starts a game — the memory card in LOAD mode
// answers 0xE00, the title, when the player leaves it without loading
// (pro/stgmcard.s 0x4dc4-0x4e2c) — so this repro boots the field directly.
import { chromium } from "playwright";
import { baseUrl } from "./verify-base-url.mjs";

const out = process.argv[2] ?? ".";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 960, height: 720 } });
page.on("console", (m) => { if (m.type() === "error") console.log("PAGE-ERR:", m.text()); });
page.on("pageerror", (e) => console.log("PAGE-EXC:", e.message));

await page.addInitScript(() => {
  localStorage.setItem("party", JSON.stringify(["p003pken", "p009rena", "p010pata"]));
  localStorage.setItem("partnerStats", JSON.stringify({
    digimonId: 1, level: 20, xp: 400, hp: 90, maxHp: 150, mp: 80, maxMp: 100,
    tp: 0, bonuses: {}, techs: [1],
  }));
  localStorage.setItem("inventory", JSON.stringify([
    { id: 1, qty: 2 }, { id: 16, qty: 1 }, { id: 210, qty: 1 },
  ]));
  localStorage.setItem("bits", "600");
  localStorage.setItem("introSeen", "1");
  localStorage.setItem("playerName", "Junior");
  localStorage.setItem("charId", "p002plyl");
});
await page.goto(`${baseUrl(8741)}/?skipTitle=1&noEncounters=1`, { waitUntil: "networkidle" });
await page.waitForFunction(() => window.__state?.started === true, null, { timeout: 30_000 });
await page.waitForTimeout(3000);

const shot = (n) => page.screenshot({ path: `${out}/${n}.png` });
const key = async (k, ms = 400) => {
  await page.keyboard.down(k);
  await page.waitForTimeout(110);
  await page.keyboard.up(k);
  await page.waitForTimeout(ms);
};

// 1. home menu cursor
await key("i", 900);
await shot("r1_home_cursor0");
await key("s");
await shot("r1_home_cursor1");

// 2. see-digivolve: go to STATUS -> detail
await key("s"); await key("s"); await key("s"); // now on STATUS (started at idx1)
await shot("r2_home_on_status");
await key("Enter", 600);
await key("Enter", 600);
await shot("r3_detail");
// evolutions available?
const evos = await page.evaluate(() => window.__battle?.availableEvolutions?.(window.__state ?? {}) ?? "no-state-handle");
console.log("availableEvolutions via handle:", JSON.stringify(evos));
// try selecting digivolve entry
await key("Enter", 600);
await shot("r4_detail_after_enter");
const ps = await page.evaluate(() => localStorage.getItem("partnerStats"));
console.log("partnerStats after enter:", ps);
await key("Escape"); await key("Escape"); await key("Escape", 600);

// 3. shop via handle. The translated merchant (web/shop-translated.js) keys its
// stock on a decoded shop id, not on a list of item ids: shop id 0 is the Asuka
// City weapon counter (npc 23 on s245 in web/assets/data/merchant_shops.json),
// the one this repro stands in front of.
await page.evaluate(() => window.__shop.open([], null, { state: window.__state, shopId: 0 }));
await page.waitForFunction(() => {
  const s = window.__shop?._session;
  return !!s && (s.mem.read32(s.root + 0x10) | 0) === 3;
}, null, { timeout: 30_000, polling: 100 }).catch(async () => {
  console.log("SHOP-ERR:", JSON.stringify(await page.evaluate(() => window.__shop.diagnostics())));
});
await shot("r5_shop_menu");
// The merchant's own pad swaps the three face buttons, so its confirm is the
// walker's Cross key (`c`); Enter is the shop's toggle.
await key("c", 900);
await page.waitForFunction(() => {
  const s = window.__shop?._session;
  if (!s) return false;
  const ctx = s.mem.read32(s.root + 0x24) >>> 0;
  const actor = ctx ? s.mem.read32(ctx + 0x1c) >>> 0 : 0;
  return !!actor && s.tree.tasks.has(actor) && (s.mem.read32(actor + 0x10) | 0) === 3;
}, null, { timeout: 30_000, polling: 100 }).catch(async () => {
  console.log("SHOP-ERR:", JSON.stringify(await page.evaluate(() => window.__shop.diagnostics())));
});
await shot("r6_shop_list");
await browser.close();
console.log("done");
