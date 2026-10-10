// tools/verify_battle_item_cure.mjs — a status-cure disk used from the battle
// Item menu cures the ailment and the HUD pip returns to normal.
//
// Authority: engine/dw3/battle-items.ts (the decoded FIGHTSTG 48-case jump table
// at 0x80082f1c: case 66 AntidoteDisk clears poison, "Cured!") plus FIGHTSTG_
// F0x800934f0 for the pip (state 3 while +0x1c is set). The battle Item menu
// must offer the band 66-90 by ID, not by the field-use `effect` label.
//
// The poison is a seeded prerequisite; the assertions are the battle's own
// "Cured!" message, the record losing the ailment, the pip, and the bag consume.
//
// Run: .opencode/autonomy/check-browser tools/verify_battle_item_cure.mjs
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";
import { waitForCommandMenu } from "./verify-battle-wait.mjs";

const ROOT = process.env.CURE_ROOT || `${baseUrl(8742)}/`;
const OUT = process.env.CURE_SHOT || ".bunny-scratch/shots/battle-item-cure";
mkdirSync(OUT, { recursive: true });

const member = (digimonId, level, xp) => ({
  digimonId, level, xp, tp: 10, hp: 400, maxHp: 400, mp: 120, maxMp: 120,
  stats: { str: 200, def: 80, spt: 60, wis: 50, spd: 90, chr: 30 },
  bonuses: {}, elemBonuses: {},
});

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 960, height: 720 } });
const errors = [];
page.on("pageerror", (e) => { errors.push(e.message); console.error("PAGEERROR", e.message); });
await page.addInitScript((seed) => {
  localStorage.setItem("assetMode", "authentic");
  localStorage.setItem("engineSchema", "2");
  localStorage.setItem("playerName", "Junior");
  localStorage.setItem("charId", "p003pken");
  localStorage.setItem("party", JSON.stringify(["p003pken", "p009rena", "p010pata"]));
  localStorage.setItem("partnerStats", JSON.stringify(seed.lead));
  localStorage.setItem("partyStats", JSON.stringify([seed.lead, seed.rena, seed.pata]));
  localStorage.setItem("equipment", JSON.stringify([{}, {}, {}]));
  localStorage.setItem("bits", "1000");
  localStorage.setItem("inventory", JSON.stringify([{ id: 66, qty: 1 }])); // AntidoteDisk
}, { lead: member(1, 10, 0), rena: member(7, 10, 0), pata: member(8, 10, 0) });

let failed = null;
const fail = (m) => { failed = m; console.error("FAIL:", m); };
const tap = (k) => page.evaluate((kk) => {
  window.dispatchEvent(new KeyboardEvent("keydown", { key: kk }));
  window.dispatchEvent(new KeyboardEvent("keyup", { key: kk }));
}, k);
const shot = async (n) => writeFileSync(`${OUT}/${n}.png`,
  Buffer.from((await page.locator("canvas#game").evaluate((el) => el.toDataURL("image/png"))).split(",")[1],
    "base64"));
const read = () => page.evaluate(() => {
  const b = window.__battleB();
  const r = b.playerRecords[0];
  return {
    pips: window.__battle.debugPips(),
    ailments: Object.keys(r.ailments || {}),
    menu: b.state,
    message: b.message,
    // The words the player actually reads. Since the 2026-10-04 message-page work the
    // box draws the disc's own line from `_msgSpec`, so `b.message` carries only the
    // walker's own prefix ("Used <item>!") and never the page's words. Reading
    // `peek().messageLine.frame.lines` is what is on screen.
    box: window.__battle.peek()?.messageLine?.frame?.lines ?? null,
    bag: (window.__state.inventory || []).map((s) => [s.id, s.qty]),
    storedBag: JSON.parse(localStorage.getItem("inventory") ?? "[]").map((s) => [s.id, s.qty]),
  };
});
// The six-row command list is the translated pro/fightstg screen: it owns the
// highlight and the confirm from the frame the command state opens, and it only
// starts reading the pad once its own session is built. Every press before that
// is discarded, so the walker's `menuSel` never moved and the Item row was
// never armed. Read the live row off the list's own diagnostics instead.
const commandReady = () => page.waitForFunction(() =>
  window.__battleCmdNative?.diagnostics?.().ready === true, null, { timeout: 30_000 });
// `selection` is the list's live highlight; `row` is only the row it opened on.
const commandRow = () => page.evaluate(() =>
  window.__battleCmdNative?.diagnostics?.().selection ?? null);
/** Press Down until the command list's own highlight sits on `row`. */
const armRow = async (row) => {
  for (let i = 0; i < 8 && (await commandRow()) !== row; i++) {
    await tap("ArrowDown");
    await page.waitForTimeout(140);
  }
  return (await commandRow()) === row;
};

try {
  await page.goto(`${ROOT}?skipTitle=1&map=s245&noEncounters=1`);
  await page.waitForFunction(() => window.__state?.started, null, { timeout: 40_000 });
  await page.waitForTimeout(500);
  await page.evaluate(async () => {
    await window.__battle.start({
      enemyId: 1, enemyLevel: 1, onWin: () => {}, onFlee: () => {}, onLose: () => {},
    });
  });
  // The shared press (tools/verify-battle-wait.mjs): read the line the battle is holding, then
  // wait for the list to be built and reading the pad. This replaces the hand-rolled
  // `state === 2` wait, which never resolves while the opening line still waits, and the
  // loader wait, which `waitForCommandMenu` already carries.
  await waitForCommandMenu(page);
  await commandReady();
  await page.evaluate(() => { const b = window.__battleB(); b.enemy.hp = 99999; b.enemy.maxHp = 99999; });

  // Seeded prerequisite: the active member is poisoned at full HP.
  await page.evaluate(() => {
    window.__battleB().playerRecords[0].ailments.poison = { power: 4, tickTime: 5000 };
  });
  const before = await read();
  if (JSON.stringify(before.pips.player) !== JSON.stringify([15, 60, 60]))
    fail(`poisoned active pip before: ${JSON.stringify(before.pips.player)}`);
  if (JSON.stringify(before.bag) !== JSON.stringify([[66, 1]]))
    fail(`seeded bag: ${JSON.stringify(before.bag)}`);

  // Ordinary keys: the command list's own row 4 = Item -> confirm it, then the
  // translated ITEM screen picks AntidoteDisk.
  if (!await armRow(4)) fail(`the Item row was not armed (row ${await commandRow()})`);
  await shot("item-menu-armed");
  await tap("Enter");                       // open the Item list
  for (let i = 0; i < 6; i++) {
    if (await page.evaluate(() => window.__battleB?.()?.state === 4)) break;
    await tap("Enter");
    await page.waitForTimeout(250);
  }
  await page.waitForFunction(() => window.__battleB?.()?.state === 4, null, { timeout: 10_000 })
    .catch(() => {});
  await page.waitForFunction(() => window.__battleItemNative?.diagnostics?.().ready === true,
    null, { timeout: 20_000 }).catch(() => {});
  const inList = await page.evaluate(() => ({
    state: window.__battleB().state,
    sel: window.__battleB().itemSel,
    has: window.__battleB().state === 4,
  }));
  await shot("item-list");
  await tap("Enter");                       // use AntidoteDisk

  // Read the box BEFORE each press: pressing Enter dismisses the line that is up, so
  // reading after the wait only ever sees the line that came later (the enemy's own
  // attack, once the cure has been read past). Reading first is what makes the pips and
  // the bag the state at the moment the cure is announced.
  let after = null, sawCure = false;
  for (let i = 0; i < 16; i++) {
    after = await read();
    sawCure = `${JSON.stringify(after.box)}${after.message}${after.timeline ?? ""}`.includes("Cured!");
    if (sawCure) break;
    await tap("Enter");
    await page.waitForTimeout(400);
  }
  if (!inList.has) fail(`the Item list did not open (state ${inList.state})`);
  if (!sawCure) fail(`no "Cured!" line: box ${JSON.stringify(after.box)} message ${JSON.stringify(after.message)}`);
  if (after.ailments.includes("poison")) fail(`the record still carries poison: ${JSON.stringify(after.ailments)}`);
  if (after.pips.player[0] !== 12)
    fail(`after the cure the full-HP active pip must be 12, got ${after.pips.player[0]}`);
  if (JSON.stringify(after.bag) !== JSON.stringify([]))
    fail(`the disk must be consumed: ${JSON.stringify(after.bag)}`);
  if (JSON.stringify(after.storedBag) !== JSON.stringify([]))
    fail(`localStorage bag not flushed: ${JSON.stringify(after.storedBag)}`);
  await shot("item-cured");

  if (errors.length) await fail(`${errors.length} page error(s)`);
  console.log("RESULT", JSON.stringify({
    ok: !failed, before: before.pips.player, after: after.pips.player,
    ailments: after.ailments, bag: after.bag, storedBag: after.storedBag,
    box: after.box, message: after.message,
  }));
} catch (e) {
  await fail(e.message);
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
