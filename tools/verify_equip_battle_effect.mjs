// Equipment row acceptance: the battle effect of gear worn from the real counter.
// The merchant's Equip? commit must leave the lead's effective stats
// (engine equipmentBonuses) visible to the battle record, so the sheet and the fight
// agree and a reload keeps them.
//
// The counter is the translated pro/stitshop merchant (web/shop-translated.js,
// engine/dw3/ui ShopRootSession), opened the way verify_shop_equip_last opens it and
// driven by the buy actor's OWN state word (root+0x24 -> +0x1C, then +0x10): 3 its
// live item list, 8 the quantity, 17 the Buy/No fold, 27 bought, 32 "Equip? Yes",
// 39 assigned, and back to 3 on "Equipped.". The check used to step on
// `window.__shop.screen` ("list"/"qty"/"confirm"/"equip"/"equipped"), a field the
// merchant port never had, and drive it with fixed press counts; it then asserted the
// walker's `equipment` while the port keeps the bag and the worn gear in its own save
// block until the counter closes (`web/shop-translated.js` `_finish`), so even the
// right key never produced a value to assert on.
//
// The assertions are unchanged: the sword is on the lead's right hand, the shared
// equipment rule gives it a STR bonus, the lead's cached battle bonus agrees with
// that rule, and a production battle builds the lead with the gear.
//
// Server: python3 -m http.server <VERIFY_PORT> --directory web
// Run:    VERIFY_PORT=<port> tools/run-playwright.sh tools/verify_equip_battle_effect.mjs
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const ROOT = process.env.EBE_ROOT || `${baseUrl(8741)}/`;
const BASE = ROOT + "index.html?skipTitle=1&noEncounters=1";
const OUT = process.env.EBE_SHOT || ".bunny-scratch/equip-battle-effect";
const SWORD = 92; // ShortSword, counter price 200
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
  partyStats: JSON.stringify([
    { digimonId: 1, level: 14, xp: 0, hp: 220, maxHp: 220, mp: 110, maxMp: 110,
      stats: { str: 60, def: 40, spt: 30, wis: 30, spd: 35, chr: 20 },
      bonuses: {}, elemBonuses: {} },
    { digimonId: 7, level: 12, xp: 0, hp: 180, maxHp: 180, mp: 90, maxMp: 90, bonuses: {}, elemBonuses: {} },
    { digimonId: 8, level: 12, xp: 0, hp: 190, maxHp: 190, mp: 95, maxMp: 95, bonuses: {}, elemBonuses: {} },
  ]),
  partnerStats: JSON.stringify({
    digimonId: 1, level: 14, xp: 0, hp: 220, maxHp: 220, mp: 110, maxMp: 110,
    stats: { str: 60, def: 40, spt: 30, wis: 30, spd: 35, chr: 20 },
    bonuses: {}, elemBonuses: {},
  }),
};

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 960, height: 720 } });
const errors = [];
page.on("pageerror", (e) => { errors.push(e.message); console.error("PAGEERROR", e.message); });
await page.addInitScript((save) => {
  localStorage.setItem("assetMode", "authentic");
  localStorage.setItem("engineSchema", "2");
  if (sessionStorage.getItem("ebeFixture")) return;
  sessionStorage.setItem("ebeFixture", "1");
  for (const [k, v] of Object.entries(save)) localStorage.setItem(k, v);
  for (const k of ["flags", "progressOrdinal", "engineFlags", "pendingParty", "digimonNames"])
    localStorage.removeItem(k);
}, SAVE);

const press = async (key, ms = 100, after = 250) => {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
  await page.waitForTimeout(after);
};
const shot = async (n) => writeFileSync(`${OUT}/${n}.png`, await page.locator("#game").screenshot());

/** The buy actor's own state word, read the way the merchant writes it. */
const actorState = () => page.evaluate(() => {
  const session = window.__shop?._session;
  if (!session) return null;
  const context = session.mem.read32(session.root + 0x24);
  const actor = session.mem.read32(context + 0x1c);
  return actor ? session.mem.read32(actor + 0x10) : null;
});
const waitActorState = (want, what) => page.waitForFunction((expected) => {
  const session = window.__shop?._session;
  if (!session) return false;
  const context = session.mem.read32(session.root + 0x24);
  const actor = session.mem.read32(context + 0x1c);
  return !!actor && session.mem.read32(actor + 0x10) === expected;
}, want, { timeout: 20_000 }).catch(() => { throw new Error(`the merchant never reached ${what} (state ${want})`); });

const failures = [];
const fail = (m) => { failures.push(m); console.error("FAIL:", m); };

try {
  await page.goto(BASE);
  await page.waitForFunction(() => window.__state?.started, null, { timeout: 30_000 });
  await page.waitForTimeout(600);
  await page.evaluate(() => {
    window.__state.bits = 10000;
    window.__state.inventory = [];
    window.__state.equipment = [{}, {}, {}];
    // The counter's own shop id, the same one tools/verify_shop_equip_last buys the
    // Short Sword from; the merchant is the routed screen either way the field or a
    // lab opens it.
    window.__labOpen("shop", 0);
  });

  // Buy the sword and take Equip? -> the lead, each step its own screen.
  await page.waitForFunction(() => window.__shop?._session
    && window.__shop._session.mem.read32(window.__shop._session.root + 0x10) === 3, null, { timeout: 20_000 });
  await press("c", 100, 250); await waitActorState(3, "the item list");   // BUY
  await press("c", 100, 250); await waitActorState(8, "the quantity");    // the sword
  await press("c", 100, 250); await waitActorState(17, "the Buy/No fold");
  await press("c", 100, 250); await waitActorState(27, "bought");
  await shot("counter-bought");
  await press("c", 100, 250); await waitActorState(32, "Equip? Yes");
  await press("c", 100, 250); await waitActorState(39, "Equip who? -> the lead");
  await shot("counter-equipped");
  await press("c", 120, 300); await waitActorState(3, "the list after 'Equipped.'");

  // What the counter committed into its own save block, read before it closes.
  const saved = await page.evaluate(() => window.__shop._session?.result?.() ?? null);
  if (!saved) throw new Error("the merchant kept no result to read");
  if (JSON.stringify(Object.values(saved.equipment?.[0] ?? {})) !== JSON.stringify([SWORD]))
    await fail(`the merchant's own record does not show the sword on the lead: ${JSON.stringify(saved.equipment)}`);
  if ((saved.inventory ?? []).some((slot) => slot.id === SWORD))
    await fail(`the sword is still in the counter's bag: ${JSON.stringify(saved.inventory)}`);

  // Close the counter: the port commits here, in one place (web/shop-translated.js
  // `_finish`, which runs the shared merchant close commit). Two Backs, each on the
  // screen the original takes them on: Back on the counter's item list (the buy
  // actor's state 3) tears that list down and hands the root its BUY/SELL choice
  // (root state 3), and Back on THAT list leaves the counter through
  // `host.transition(root, 0x14)` (pro/stitshop F0x8008B908).
  const rootState = () => page.evaluate(() => {
    const s = window.__shop?._session;
    return s ? s.mem.read32(s.root + 0x10) : null;
  });
  for (let i = 0; i < 10 && await page.evaluate(() => window.__shop?.isOpen?.()); i++) {
    await press("x", 100, 400);
    if (await page.evaluate(() => window.__shop?.isOpen?.())) continue;
    if ((await rootState()) === 3) break;
  }
  await page.waitForFunction(() => window.__shop?.isOpen?.() === false, null, { timeout: 10_000 })
    .catch(() => {});
  if (await page.evaluate(() => window.__shop?.isOpen?.()))
    await fail(`the counter did not close (root state ${await rootState()}, actor ${await actorState()})`);

  const equipped = await page.evaluate(() => ({
    eq0: window.__state.equipment?.[0],
    inv: (window.__state.inventory ?? []).map((i) => [i.id, i.qty ?? 1]),
    cache: window.__state.partnerStats?.equipBonuses ?? null,
    base: window.__state.partnerStats?.stats?.str ?? null,
    storedEq: localStorage.getItem("equipment"),
  }));
  if (equipped.eq0?.right !== SWORD) throw new Error(`sword not equipped: ${JSON.stringify(equipped)}`);

  // The engine rule the sheet and the battle both claim to use.
  const expected = await page.evaluate(async () => {
    const eng = await import("./vendor/engine.js");
    return eng.equipmentBonuses(window.__state.equipment?.[0] ?? {});
  });
  const b = expected ?? {};
  const expStr = b.str ?? 0;
  const expAcc = b.accPool ?? 0;
  if (!(expStr > 0 || expAcc > 0)) throw new Error(`sword has no bonuses: ${JSON.stringify(b)}`);

  // Producer: the counter commit must leave the lead's cached battle bonuses in
  // sync with the equipped slots (this is what battle.js buildPlayerRecord reads).
  if ((equipped.cache?.str ?? 0) !== expStr || (equipped.cache?.accPool ?? 0) !== expAcc)
    await fail(`counter equip left the battle cache stale: cache=${JSON.stringify(equipped.cache)} engine=${JSON.stringify({ str: expStr, accPool: expAcc })}`);
  if (!JSON.parse(equipped.storedEq ?? "[]")?.[0]?.right)
    await fail(`localStorage equipment not persisted: ${equipped.storedEq}`);

  // Consumer: a production battle must build the lead with the worn gear.
  await page.evaluate(() => {
    window.__battle.start({
      enemyId: 1, enemyLevel: 1,
      onWin: () => {}, onFlee: () => {}, onLose: () => {},
    });
  });
  await page.waitForFunction(() => (window.__battleB?.()?.state ?? 0) >= 1, null, { timeout: 15_000 });
  const bat = await page.evaluate(() => ({
    str: window.__battleB().player.str,
    base: window.__state.partnerStats.stats.str,
    slot: window.__state.equipment?.[0]?.right,
  }));
  await page.waitForTimeout(300);
  await shot("battle-with-gear");
  if (bat.slot !== SWORD) await fail(`battle started without the sword equipped: ${JSON.stringify(bat)}`);
  if (bat.str !== bat.base + expStr)
    await fail(`battle STR ${bat.str}, expected base ${bat.base} + gear ${expStr}`);

  if (errors.length) await fail(`${errors.length} page error(s)`);
  console.log("RESULT", JSON.stringify({
    ok: true, equipped, expected: { str: expStr, accPool: expAcc }, battle: bat,
  }));
} catch (e) {
  await fail(`${e.message}\n${e.stack}`);
} finally {
  await browser.close();
}
console.log(failures.length ? `FAILED ${failures.length}: ${failures.join(" | ")}` : "OK");
process.exit(failures.length ? 1 : 0);
