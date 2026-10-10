// Player action: using an HP Charge at full HP in battle spends it anyway.
//
// Decode (authority 2): the generic heal handler F0x8008dc00 branches on
// current HP == max HP (fightstg.s 0x8008dc3c-0x8008dc54): the equal case sets
// the "No effect!" message id 0x2f and skips the heal, but it shares the same
// tail (`j 0x8008ede8`) as the heal case. The item action's state machine then
// reaches the bag-decrement at 0x8008ed88-0x8008edb0 (count byte at
// 0x80048d34 + 0x7c + itemId) with NO check of whether the effect applied. So a
// battle item is consumed when its action completes, no-effect included — which
// is the difference from the FIELD applier, where a refusal does not consume
// (claim field-item-applier-consume-and-refuse-2026-09-13).
//
// This drives the production battle: full-HP lead, one PowerCharge in the bag,
// the ordinary command menu -> Item -> use it. The bag must go 1 -> 0 and the
// message must report no healing.
//
// Server: python3 -m http.server 8741 --directory web
// Run:    .opencode/autonomy/check-browser tools/verify_battle_item_noeffect_consume.mjs
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";
import { waitForCommandMenu } from "./verify-battle-wait.mjs";

const BASE = process.env.BITEM_ROOT || `${baseUrl(8741)}/`;
const OUT = process.env.BITEM_SHOT || ".bunny-scratch/shots/battle-item-noeffect";
mkdirSync(OUT, { recursive: true });

const member = (digimonId, level) => ({
  digimonId, level, xp: 0, tp: 10, hp: 400, maxHp: 400, mp: 120, maxMp: 120,
  bonuses: {}, elemBonuses: {},
});

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
const errors = [];
page.on("pageerror", (e) => { errors.push(e.message); console.error("PAGEERROR", e.message); });

await page.addInitScript((seed) => {
  localStorage.setItem("assetMode", "authentic");
  localStorage.setItem("engineSchema", "2");
  localStorage.setItem("playerName", "Junior");
  localStorage.setItem("fieldLocation", JSON.stringify({ version: 1, mapId: "s245", x: 332, y: 390, dir: "left" }));
  localStorage.setItem("charId", "p003pken");
  localStorage.setItem("party", JSON.stringify(["p003pken", "p009rena", "p010pata"]));
  localStorage.setItem("partnerStats", JSON.stringify(seed.lead));
  localStorage.setItem("partyStats", JSON.stringify([seed.lead, seed.rena, seed.pata]));
  localStorage.setItem("equipment", JSON.stringify([{}, {}, {}]));
  localStorage.setItem("bits", "1000");
  localStorage.setItem("inventory", JSON.stringify([{ id: 43, qty: 1 }])); // PowerCharge
}, { lead: member(1, 10), rena: member(7, 10), pata: member(8, 10) });

let failed = null;
const fail = (msg) => { failed = msg; console.error("FAIL:", msg); };
const shot = async (n) => writeFileSync(
  `${OUT}/${n}.png`,
  Buffer.from(
    (await page.locator("canvas#game").evaluate((el) => el.toDataURL("image/png"))).split(",")[1],
    "base64",
  ),
);
const peek = () => page.evaluate(() => {
  const b = window.__battleB?.();
  return {
    active: !!window.__battle?.isActive?.(),
    state: b?.state ?? null,
    message: b?.message ?? null,
    menuSel: b?.menuSel ?? null,
    hp: b?.player?.hp ?? null,
    maxHp: b?.player?.maxHp ?? null,
    bag: window.__state.inventory.map((s) => [s.id, s.qty ?? 1]),
    lsBag: JSON.parse(localStorage.getItem("inventory") ?? "[]"),
  };
});

try {
  await page.goto(`${BASE}?skipTitle=1&map=s245&noEncounters=1`);
  await page.waitForFunction(() => window.__state?.started, null, { timeout: 15_000 });
  await page.waitForTimeout(400);

  // Production battle entry: the same object game.js uses for fixed battles
  // and random encounters.
  await page.evaluate(async () => {
    window.__battleResult = null;
    await window.__battle.start({
      enemyId: 1, enemyLevel: 1,
      onWin: (r) => { window.__battleResult = r; },
      onFlee: () => { window.__battleResult = { fled: true }; },
      onLose: () => { window.__battleResult = { lost: true }; },
    });
  });
  await waitForCommandMenu(page);
  const start = await peek();
  if (start.hp !== start.maxHp) await fail(`lead is hurt (${start.hp}/${start.maxHp}); the no-effect case needs full HP`);
  if (JSON.stringify(start.bag) !== JSON.stringify([[43, 1]]))
    await fail(`bag before: ${JSON.stringify(start.bag)}`);
  await shot("battle-item-before");

  // Ordinary command menu: Fight, Tech, DV, Tag, Item -> the 5th row. The six-row
  // list is the translated pro/fightstg screen, so the highlight lives in its own
  // session: it only reads the pad once it is ready, and the walker's menuSel
  // never moved again (battle.js writes it back only when the list hands a row
  // back on the confirm). Arm the row on the list's own selection, not menuSel.
  await page.waitForFunction(() => window.__battleWfightmn?.diagnostics?.().open === false,
    null, { timeout: 30_000 });
  await page.waitForFunction(() => window.__battleCmdNative?.diagnostics?.().ready === true,
    null, { timeout: 30_000 });
  const selection = () => page.evaluate(() => window.__battleCmdNative?.diagnostics?.().selection ?? null);
  for (let i = 0; i < 8 && (await selection()) !== 4; i++) {
    await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(140);
  }
  if ((await selection()) !== 4) await fail(`the Item row was not armed (row ${await selection()})`);
  await page.keyboard.press("Enter");   // Item
  for (let i = 0; i < 6; i++) {
    if (await page.evaluate(() => window.__battleB?.()?.state === 4)) break;
    await page.keyboard.press("Enter");
    await page.waitForTimeout(250);
  }
  await page.waitForFunction(() => window.__battleB?.()?.state === 4, null, { timeout: 10_000 }); // PLAYER_ITEM
  await page.waitForFunction(() => window.__battleItemNative?.diagnostics?.().ready === true,
    null, { timeout: 20_000 }).catch(() => {});
  await page.keyboard.press("Enter");   // use the PowerCharge
  // The message line is the original's own sequencer: it holds the turn until the
  // player presses Circle, so "Used Power Charge!" waits for a dismiss before the
  // action applies and the bag-decrement runs. (The walker used to auto-advance.)
  let healed = null;
  for (let i = 0; i < 20 && healed === null; i++) {
    await page.keyboard.press("Enter");
    await page.waitForTimeout(300);
    healed = await page.evaluate(() => window.__battleB?.()?.message?.match(/(\d+) HP restored/)?.[1] ?? null);
  }
  await page.waitForTimeout(600);
  const after = await peek();
  await shot("battle-item-after");

  healed = after.message?.match(/(\d+) HP restored/)?.[1] ?? null;
  if (healed !== "0")
    await fail(`message ${JSON.stringify(after.message)} does not report 0 HP restored`);
  if (JSON.stringify(after.bag) !== JSON.stringify([]))
    await fail(`battle item at full HP was not consumed: bag ${JSON.stringify(after.bag)}`);
  if (JSON.stringify(after.lsBag) !== JSON.stringify([]))
    await fail(`persisted bag not consumed: ${JSON.stringify(after.lsBag)}`);
  if (errors.length) await fail(`${errors.length} page error(s)`);

  console.log("RESULT", JSON.stringify({ ok: !failed, start, after, healed }));
} catch (e) {
  await fail(e.message);
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
