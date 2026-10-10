// Equipment row acceptance: removing a worn item through the real pause menu
// restores the baseline. The lead starts with a ShortSword (id 92) in the right
// hand; the check opens the real pause menu with ordinary keys (START), walks the
// ported home to STATUS, opens the partner's sheet, walks to See Equipment, moves
// to the right-hand slot and takes the take-off entry off, then starts a
// production battle and asserts the combat record is back to the unequipped base.
//
// The route is the translated pro/ststatus pages, read through their own state
// words (tools/verify-pause-pages.mjs). It used to wait on `__menu.screen ===
// "status-list"` / "equip" / `"items"`, which the ported pause home never sets: the
// home hands each row to a ported page (web/game.js:537 `menu.onNativePage`), so
// the walker panels it used to poke are no longer the routed screen. The assertions
// are unchanged in strength -- the item leaves the worn slot, comes back to the bag,
// the cached battle bonus is cleared, and the battle record is the base.
//
// The "with gear" half is proven separately by tools/verify_equip_battle_effect.mjs.
//
// Server: python3 -m http.server <VERIFY_PORT> --directory web
// Run:    VERIFY_PORT=<port> tools/run-playwright.sh tools/verify_equip_remove_baseline.mjs
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import {
  pauseBase, pageWords, openPageFromHome, openEquipWindow, equipSlotTo,
  openEquipItemList, closePause, press,
} from "./verify-pause-pages.mjs";

const BASE = process.env.ERB_ROOT || pauseBase(8741, "skipTitle=1&map=s210&noEncounters=1");
const OUT = process.env.ERB_SHOT || ".bunny-scratch/equip-remove-baseline";
const SWORD = 92;
mkdirSync(OUT, { recursive: true });

const SAVE = {
  engineSchema: "2",
  playerName: "Junior",
  fieldLocation: JSON.stringify({ version: 1, mapId: "s210", x: 730, y: 382, dir: "down" }),
  bits: "1000",
  inventory: "[]",
  equipment: JSON.stringify([{ right: SWORD }, {}, {}]),
  charId: "p003pken",
  party: JSON.stringify(["p003pken", "p009rena", "p010pata"]),
  partyStats: JSON.stringify([
    // The lead's record must be partyStats[0]: the ported pages hand the roster back
    // per deployed position (web/status-translated.js readBack walks `state.partyStats`
    // and writes each position's worn slots), and a null lead record is skipped, so a
    // fixture that keeps the lead only in `partnerStats` commits nothing at all.
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
const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
const errors = [];
page.on("pageerror", (e) => { errors.push(e.message); console.error("PAGEERROR", e.message); });
await page.addInitScript((save) => {
  localStorage.setItem("assetMode", "authentic");
  localStorage.setItem("engineSchema", "2");
  if (sessionStorage.getItem("erbFixture")) return;
  sessionStorage.setItem("erbFixture", "1");
  for (const [k, v] of Object.entries(save)) localStorage.setItem(k, v);
}, SAVE);

const shot = async (n) => writeFileSync(`${OUT}/${n}.png`,
  Buffer.from((await page.locator("canvas#game").evaluate((el) => el.toDataURL("image/png"))).split(",")[1], "base64"));

let failed = null;
const fail = (m) => { failed = m; console.error("FAIL:", m); };

try {
  await page.goto(BASE);
  await page.waitForFunction(() => window.__state?.started, null, { timeout: 15_000 });
  await page.waitForFunction(() => window.__state.manifest.maps[window.__state.mapIdx].id === "s210");
  await page.waitForTimeout(600); // packs/fonts + a settled field

  const before = await page.evaluate(async () => {
    const eng = await import("./vendor/engine.js");
    return {
      eq0: window.__state.equipment?.[0],
      bonus: eng.equipmentBonuses(window.__state.equipment?.[0] ?? {}),
      bag: (window.__state.inventory ?? []).map((i) => [i.id, i.qty ?? 1]),
      baseStr: window.__state.partnerStats?.stats?.str,
    };
  });
  if (before.eq0?.right !== SWORD) throw new Error(`fixture not worn: ${JSON.stringify(before)}`);
  if (!(before.bonus.str > 0)) throw new Error(`fixture sword has no bonus: ${JSON.stringify(before.bonus)}`);
  await shot("menu-field-worn");

  // ── START -> the ported pause home -> STATUS -> the lead's sheet -> See Equipment.
  await openPageFromHome(page, "status", { sheetRow: 1 });
  await shot("menu-status-sheet");
  const slots = await openEquipWindow(page);
  // The slot list opens on the head slot (F0x8008744c fills +0x60 with 0 and Up/Down
  // clamp rather than wrap: `if (v >= 6) +0x60 = 5`).
  if (slots.equip.slot !== 0) await fail(`the slot list opened on slot ${slots.equip.slot}, expected 0`);
  await shot("menu-equip-slots");

  // Slot 2 is the right hand (0 head, 1 body, 2 right, 3 left, 4/5 accessory) and
  // the worn sword must be the window's own record of it.
  await equipSlotTo(page, 2);
  await shot("menu-unequip-slot");
  const items = await openEquipItemList(page);
  // The original lists the take-off row first and unconditionally
  // (pro/ststatus F0x8009A344, id -1), so row 0 removes what is worn.
  if (items[0] !== 0xffff) await fail(`row 0 is not the take-off sentinel: ${JSON.stringify(items)}`);
  await shot("menu-unequip-list");
  await press(page, " ");   // row 0: take it off

  // The window folds back to the slot list, and the record and the bag have moved.
  for (let i = 0; i < 60; i++) {
    const w = await pageWords(page);
    if (w?.equip?.state === 3) break;
    await page.waitForTimeout(100);
  }
  // Read the page's own record and bag: roster slot 0's right-hand halfword
  // (PAUSE_EQUIP_OFFSETS) and the held count of item 92 (PAUSE_HELD_COUNTS).
  const mid = await page.evaluate(() => {
    const mem = window.__status._session.mem;
    return { worn: mem.read16(0x80049494 + 0x3cc), bag: mem.read8(0x80048d34 + 0x7c + 92) };
  });
  if (mid.worn !== 0) await fail(`the right-hand slot still holds ${mid.worn}: ${JSON.stringify(mid)}`);
  if (mid.bag !== 1) await fail(`the sword is not back in the page's bag (${mid.bag}): ${JSON.stringify(mid)}`);
  await shot("menu-after-unequip");

  // The Back path the ported pages took out, for the record: the See Equipment window,
  // the sheet, the STATUS page's own picker, then the pause home, then the field.
  console.log("close path:", JSON.stringify(await closePause(page)));
  if (await page.evaluate(() => window.__state.menuOpen)) await fail("menu did not close");

  const after = await page.evaluate(() => ({
    eq0: window.__state.equipment?.[0],
    cache: window.__state.partnerStats?.equipBonuses ?? null,
    bag: (window.__state.inventory ?? []).map((i) => [i.id, i.qty ?? 1]),
    storedEq: localStorage.getItem("equipment"),
    storedBag: localStorage.getItem("inventory"),
    base: window.__state.partnerStats?.stats?.str,
  }));
  if (after.eq0?.right != null) await fail(`right slot not cleared: ${JSON.stringify(after.eq0)}`);
  if (!after.bag.some(([id, q]) => id === SWORD && q === 1))
    await fail(`sword not returned to the bag: ${JSON.stringify(after.bag)}`);
  const cacheStr = after.cache?.str ?? 0;
  if (cacheStr !== 0) await fail(`cached bonus not cleared: ${JSON.stringify(after.cache)}`);
  if (!JSON.parse(after.storedEq ?? "[]")?.[0]?.right == null)
    await fail(`localStorage equipment not committed: ${after.storedEq}`);
  if (!JSON.parse(after.storedBag ?? "[]").some((i) => i.id === SWORD))
    await fail(`localStorage bag not committed: ${after.storedBag}`);

  // Production battle: with the slot empty the record is back to base.
  await page.evaluate(() => {
    window.__battle.start({
      enemyId: 1, enemyLevel: 1,
      onWin: () => {}, onFlee: () => {}, onLose: () => {},
    });
  });
  await page.waitForFunction(() => (window.__battleB?.()?.state ?? 0) >= 1, null, { timeout: 15_000 });
  const battle = await page.evaluate(() => ({
    str: window.__battleB().player.str,
    base: window.__state.partnerStats.stats.str,
    slot: window.__state.equipment?.[0]?.right ?? null,
  }));
  await page.waitForTimeout(300);
  await shot("battle-after-unequip");
  if (battle.slot != null) await fail(`battle started with a worn item: ${JSON.stringify(battle)}`);
  if (battle.str !== before.baseStr) await fail(`battle STR ${battle.str}, expected the unequipped base ${before.baseStr}`);

  if (errors.length) await fail(`${errors.length} page error(s)`);
  console.log("RESULT", JSON.stringify({ ok: !failed, before: { bonus: before.bonus.str, baseStr: before.baseStr }, mid, after, battle }));
} catch (e) {
  await fail(`${e.message}\n${e.stack}`);
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
