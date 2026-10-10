// Journey 6: buying a card at the card shop spends money and grants the card,
// and both survive a reload.
//
// The shop is opened through the game's own screen entry (`__labOpen("cardshop")`
// mounts the translated card shop on the live state) and driven with ordinary
// keys: root BUY -> list -> confirm plate -> BUY. The card grant is a direct
// engine call from the screen, so the shell's collection sweep is what has to
// persist it; the wallet persists through the engine var onChange.
//
// Server: python3 -m http.server 8741 --directory web
// Run:    .opencode/autonomy/check-browser tools/verify_cardshop_purchase.mjs
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const ROOT = process.env.CSP_ROOT || `${baseUrl(8741)}/`;
// Ordinary translated production route.
const BASE = ROOT + "?skipTitle=1&map=s210&noEncounters=1";
const OUT = process.env.CSP_SHOT || ".bunny-scratch/cardshop-purchase";
mkdirSync(OUT, { recursive: true });

const SAVE = {
  engineSchema: "2",
  playerName: "Junior",
  fieldLocation: JSON.stringify({ version: 1, mapId: "s210", x: 730, y: 382, dir: "down" }),
  bits: "20000",
  inventory: "[]",
  equipment: "[]",
  charId: "p003pken",
  party: JSON.stringify(["p003pken", "p009rena", "p010pata"]),
  partnerStats: JSON.stringify({ digimonId: 1, level: 5, xp: 0, hp: 200, maxHp: 200, mp: 80, maxMp: 80, bonuses: {}, elemBonuses: {} }),
};

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
const press = async (key) => {
  await page.keyboard.down(key);await page.waitForTimeout(70);await page.keyboard.up(key);
};
const errors = [];
page.on("pageerror", (e) => { errors.push(e.message); console.error("PAGEERROR", e.message); });
await page.addInitScript((save) => {
  localStorage.setItem("assetMode", "authentic");
  localStorage.setItem("engineSchema", "2");
  if (sessionStorage.getItem("cspFixture")) return;
  sessionStorage.setItem("cspFixture", "1");
  for (const [k, v] of Object.entries(save)) localStorage.setItem(k, v);
  for (const k of ["flags", "progressOrdinal", "engineFlags", "pendingParty", "cardCollection"])
    localStorage.removeItem(k);
}, SAVE);

const shot = async (n) => writeFileSync(`${OUT}/${n}.png`,
  Buffer.from((await page.locator("canvas#game").evaluate((el) => el.toDataURL("image/png"))).split(",")[1], "base64"));

let failed = null;
const fail = (m) => { failed = m; console.error("FAIL:", m); };

try {
  await page.goto(BASE);
  await page.waitForFunction(() => window.__state?.started, null, { timeout: 15_000 });
  await page.waitForTimeout(600);

  // The first card this shop sells (unknown shop id -> stock record 0).
  const target = await page.evaluate(async () => {
    const cs = await import("./cardstate.js");
    await Promise.all([cs.loadCardShops(), cs.loadCardPrices(), cs.loadCatalog()]);
    const id = cs.shopStock(null)[0];
    const card = cs.cardById(id);
    return { id, name: card?.name ?? null, price: cs.cardPrice(card) };
  });
  if (!target?.id) throw new Error("no stock card resolved");

  const wallet = () => page.evaluate(async (id) => {
    const cs = await import("./cardstate.js");
    return {
      bits: window.__state.bits,
      owned: cs.ownedCount(cs.cards(), id),
      total: [...cs.cards().owned.values()].reduce((a, b) => a + b, 0),
      stored: !!localStorage.getItem("cardCollection"),
    };
  }, target.id);

  const before = await wallet();
  if (before.bits !== 20000) throw new Error(`fixture bits ${before.bits}`);
  if (before.owned !== 0) throw new Error(`fixture already owns ${target.name}: ${JSON.stringify(before)}`);

  // Real screen entry, ordinary keys: root -> buy -> confirm -> BUY.
  await page.evaluate(() => window.__labOpen("cardshop"));
  await page.waitForFunction(()=>window.__cardShop?.diagnostics().state===3);
  await shot("shop-root");
  await press("c"); // cross: rootSel 0 = BUY
  await page.waitForFunction(()=>window.__cardShop?.diagnostics().child?.state===2);
  await shot("shop-buy-list");
  await press("c"); // cross: open the confirm plate
  await page.waitForFunction(()=>window.__cardShop?.diagnostics().child?.state===7);
  await shot("shop-confirm");
  await press("c"); // cross: confirmSel 0 = BUY
  await page.waitForFunction(()=>window.__cardShop?.diagnostics().child?.state===2);
  await shot("shop-after-buy");

  const after = await wallet();
  if (after.bits !== before.bits - target.price)
    await fail(`bits ${before.bits} -> ${after.bits}, expected -${target.price}`);
  if (after.owned !== before.owned + 1)
    await fail(`card not granted: ${JSON.stringify({ target, before, after })}`);

  // The grant is an engine call; wait for the shell's collection sweep, then reload.
  await page.waitForTimeout(2600);
  await page.reload();
  await page.waitForFunction(() => window.__state?.started, null, { timeout: 15_000 });
  await page.waitForTimeout(600);
  const reloaded = await wallet();
  await shot("shop-after-reload");
  if (reloaded.bits !== after.bits) await fail(`bits did not survive reload: ${reloaded.bits} vs ${after.bits}`);
  if (reloaded.owned !== after.owned)
    await fail(`card did not survive reload: ${JSON.stringify({ after, reloaded })}`);

  if (errors.length) await fail(`${errors.length} page error(s)`);
  console.log("RESULT", JSON.stringify({ ok: !failed, target, before, after, reloaded }));
} catch (e) {
  await fail(e.message);
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
