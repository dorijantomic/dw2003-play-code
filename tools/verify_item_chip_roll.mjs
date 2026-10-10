// Player action: a permanent-boost chip grants a random 1..value amount, the
// partner's record rises by exactly that, and the message line shows that number.
//
// Decode (authority 2): the field item-use applier at ststatus file 0xc8fc rolls
// the permanent boost as `rand() % value + 1` (1..value) at 0xcabc and then
// clamps the stat at its own table's cap (file 0x17c2c: maxHP/maxMP 9999, every
// other stat and element 999). Its port is engine/dw3/ui/native/pause-bag.ts
// `itemsApplyEffect` / F0x8008F584, which also writes the applied amount into the
// message window: the line's words at widget slot +0x114 and the NUMBER at +0x118
// (`F0x800195b0`, `widgetSetLineNumber`, which stores the digits minus GLYPH_OFFSET
// 0x2c in the line record at self+0x5C+0xC*line).
//
// The route is the translated pause ITEMS page: START -> the ported home -> ITEMS ->
// "Which one?" (page step 0x0A) -> the bag grid (0x10) -> the chip -> "Choose
// Digimon" (0x19) -> the lead -> the applied line. It used to wait on
// `__menu.screen === "items"` / `itemMode`, which the ported pause home never sets:
// the home hands each row to a ported page (web/game.js:537 `menu.onNativePage`), so
// the walker panel it used to poke is no longer the routed screen.
//
// Server: python3 -m http.server <VERIFY_PORT> --directory web
// Run:    VERIFY_PORT=<port> tools/run-playwright.sh tools/verify_item_chip_roll.mjs
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { pauseBase, pageWords, openPageFromHome, closePause, press, waitWords } from "./verify-pause-pages.mjs";

const BASE = process.env.CHIP_ROOT || pauseBase(8741, "skipTitle=1&map=s210&noEncounters=1");
const OUT = process.env.CHIP_SHOT || ".bunny-scratch/item-chip-roll";
const CHIP = 47;        // HP Chip, +30 max HP: the roll is 1..30
const GLYPH_OFFSET = 0x2c;
mkdirSync(OUT, { recursive: true });

const stats = (digimonId, hp, maxHp, mp, maxMp) => ({
  digimonId, level: 5, xp: 0, tp: 0, hp, maxHp, mp, maxMp,
  bonuses: {}, elemBonuses: {},
});

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
const errors = [];
page.on("pageerror", (e) => { errors.push(e.message); console.error("PAGEERROR", e.message); });

await page.addInitScript(() => {
  const stats = (digimonId, hp, maxHp, mp, maxMp) => ({
    digimonId, level: 5, xp: 0, tp: 0, hp, maxHp, mp, maxMp,
    bonuses: {}, elemBonuses: {},
  });
  localStorage.setItem("assetMode", "authentic");
  localStorage.setItem("engineSchema", "2");
  localStorage.setItem("playerName", "Junior");
  localStorage.setItem("charId", "p005koet");
  localStorage.setItem("party", JSON.stringify(["p005koet", "p006agum", "p009rena"]));
  localStorage.setItem("partnerStats", JSON.stringify(stats(3, 500, 1000, 50, 100)));
  localStorage.setItem("partyStats", JSON.stringify([
    stats(3, 500, 1000, 50, 100), stats(7, 300, 300, 90, 100), stats(8, 300, 300, 90, 100),
  ]));
  localStorage.setItem("equipment", JSON.stringify([{}, {}, {}]));
  localStorage.setItem("inventory", JSON.stringify([{ id: 47, qty: 1 }]));
});

// Every failure is kept, not just the last one, so a check that trips two rules
// reports both.
const failures = [];
const fail = (msg) => { failures.push(msg); console.error("FAIL:", msg); };
const shot = async (name) => writeFileSync(
  `${OUT}/${name}.png`,
  Buffer.from(
    (await page.locator("canvas#game").evaluate((el) => el.toDataURL("image/png"))).split(",")[1],
    "base64",
  ),
);

/** Read the page's own record of the item's effect: max HP before/after, the chip's
 *  held count, and the number the message window was given. */
const readPage = () => page.evaluate(({ chip, glyphOffset }) => {
  const s = window.__status._session, mem = s?.mem;
  const obj = s?.pageObject?.();
  if (!obj) return null;
  const ui = mem.read32(obj + 0x24) >>> 0;
  const widget = mem.read32(ui + 0x88) >>> 0;      // the message line's own text widget
  const line = (i) => {
    const rec = widget + 0x5c + 0xc * i;
    const buf = mem.read32(rec) >>> 0;
    const len = mem.read16(rec + 6) & 0xff;
    let out = "";
    for (let k = 0; k < len; k++) out += String.fromCharCode((mem.read8(buf + k) + glyphOffset) & 0xff);
    return out;
  };
  return {
    state: mem.read32(obj + 0x10) | 0,
    item: mem.read32(obj + 0x78) | 0,
    applied: mem.read32(obj + 0x3ac) | 0,
    held: mem.read8(0x80048d34 + 0x7c + chip),
    // Roster slot 0's max-HP halfword, the one F0x8008F584 raises (record +0x2A).
    maxHp: mem.read16(0x80049494 + 0x2a) & 0xffff,
    // The line's own words and number, as the page handed them to the text widget.
    words: line(0), number: line(1),
  };
}, { chip: CHIP, glyphOffset: GLYPH_OFFSET });

/** The items page's own state word, from the page object. */
const itemsPageState = () => page.evaluate(() => {
  const s = window.__status?._session;
  const obj = s?.pageObject?.();
  return obj ? (s.mem.read32(obj + 0x10) | 0) : null;
});
const waitItems = async (want, what) =>
  waitWords(page, itemsPageState, want, `items state 0x${want.toString(16)} (${what})`);

try {
  await page.goto(BASE);
  await page.waitForFunction(() => window.__state?.started && window.__menu, null, { timeout: 15_000 });
  await page.waitForTimeout(500);

  // Ordinary input: START opens the pause home, and the ITEMS row hands the pad to
  // the ported items page.
  await openPageFromHome(page, "items");
  await waitItems(0x0a, '"Which one?" is up');
  await press(page, " ");                              // Items -> the bag grid
  await waitItems(0x10, "the bag grid");
  const before = await readPage();
  await shot("chip-roll-before-list");
  if (before.held !== 1) await fail(`the page's bag holds ${before.held} of item ${CHIP}, expected 1`);
  await press(page, " ");                              // the chip -> "Choose Digimon"
  await waitItems(0x19, '"Choose Digimon" is up');
  // The bag hands the chosen item back on its own fields: parent +0x7C is the cell
  // index and +0x78 the item id when Circle is pressed on a usable row.
  const picked = await page.evaluate(() => {
    const s = window.__status._session, obj = s.pageObject();
    return { index: s.mem.read32(obj + 0x7c) | 0, item: s.mem.read32(obj + 0x78) | 0 };
  });
  if (picked.item !== CHIP) await fail(`the grid handed back item ${picked.item}, expected ${CHIP}`);
  await page.waitForTimeout(900);                       // the window's fold-open tween
  await shot("chip-roll-picked");
  await press(page, " ");                              // on the lead -> the chip applies
  const applied = await readPage();
  await shot("chip-roll-after");

  // The original's roll: `rand() % value + 1`, so 1..value, and never 0 and never
  // more than the chip's own amount.
  const delta = applied.maxHp - before.maxHp;
  if (!(delta >= 1 && delta <= 30))
    await fail(`HP Chip raised max HP by ${delta} (${before.maxHp} -> ${applied.maxHp}), expected the 1..30 roll`);
  if (applied.held !== 0) await fail(`the chip was not consumed: held ${applied.held}`);
  // The line shows the amount that was applied, and not the chip's printed value.
  if (applied.number !== String(delta))
    await fail(`the message line shows ${JSON.stringify(applied.number)}, expected the applied ${delta} `
      + `(words ${JSON.stringify(applied.words)})`);
  if (applied.number === "30")
    await fail(`the roll came out at the chip's full value; the check cannot tell a roll from a fixed grant`);
  // The line's WORDS are not asserted on: they come from the game's own text bank
  // through slot +0x114, and this repository carries no string bank for it (the
  // `words` field in the read-out is the widget's raw glyph codes, not ASCII). The
  // number above is the part the original's own arm writes, and it is checked.

  // The applied line is dismissed with Circle (state 0x65 reads 0x0D only, the
  // original's own arm), which puts "Which one?" back up; Back then leaves the page.
  await press(page, " ");
  await waitItems(0x0a, '"Which one?" is up again');
  // The persisted stats and bag must match what the screen did.
  await closePause(page);
  const after = await page.evaluate(() => ({
    menuOpen: window.__state.menuOpen,
    maxHp: window.__state.partnerStats?.maxHp ?? null,
    stored: JSON.parse(localStorage.getItem("partnerStats") ?? "{}"),
    bag: (window.__state.inventory ?? []).map((i) => [i.id, i.qty ?? 1]),
    storedBag: JSON.parse(localStorage.getItem("inventory") ?? "[]"),
  }));
  if (after.menuOpen) await fail("the pause menu did not close");
  if (after.maxHp !== before.maxHp + delta)
    await fail(`the walker's max HP is ${after.maxHp}, expected ${before.maxHp + delta}`);
  if (after.stored.maxHp !== after.maxHp)
    await fail(`persisted maxHp ${after.stored.maxHp} != screen ${after.maxHp}`);
  if (after.bag.some(([id]) => id === CHIP)) await fail(`the chip is still in the bag: ${JSON.stringify(after.bag)}`);
  if (after.storedBag.some((i) => i.id === CHIP)) await fail(`the chip is still in localStorage: ${JSON.stringify(after.storedBag)}`);
  if (errors.length) await fail(`${errors.length} page error(s)`);

  console.log("RESULT", JSON.stringify({ ok: true, before, applied, delta, after }));
} catch (e) {
  await fail(`${e.message}\n${e.stack}`);
} finally {
  await browser.close();
}
console.log(failures.length ? `FAILED ${failures.length}: ${failures.join(" | ")}` : "OK");
process.exit(failures.length ? 1 : 0);
