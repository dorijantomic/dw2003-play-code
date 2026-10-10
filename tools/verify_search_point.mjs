// tools/verify_search_point.mjs — the inns' hidden money, found the way a player finds it.
//
// Both inns hide money behind an INVISIBLE search point at the shelf (actor 63 at
// 145,289): s235 Asuka Inn 1F holds 300 BIT, s928 Amaterasu Inn 1F — the same room
// reflected — holds 8,500. There is no sprite and no prompt: you stand at the shelf,
// press confirm, and get "Wonder if there's anything here... Guess not..." five times
// before the sixth press turns up "Hey! Someone hid money here!" (rig capture:
// docs/research/field/repeat-examine-search-points-2026-07-26.md, BIT 60 -> 360).
//
// This asserts the whole chain end to end from the field:
//   1. standing at the shelf and facing it ADDRESSES actor 63, nothing else in the room,
//   2. six presses walk the six dialogue states in order, one state per press,
//   3. the wallet the menu / shop / inn / battle rewards read gains exactly the find,
//   4. a seventh press only says "there's nothing left" — the find is once-only,
//   5. the wallet survives a reload, and a plain browser-side write moves the same number.
//
// Step 3 is the part that was broken: the engine's AddMoney command wrote a `$party.bit`
// var nothing read back, so the box announced the money and the player's wallet never
// moved — for all 17 decoded bank-0x70 money grants, 47,500 BIT in total.
//
// Run with a web server on port 8742:
//   python3 -m http.server 8742 --directory web
//   tools/run-playwright.sh tools/verify_search_point.mjs [output-directory]
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { baseUrl } from "./verify-base-url.mjs";

const origin = `${baseUrl(8742)}`;
const outDir = resolve(process.argv[2] ?? "/tmp/search-point");
await mkdir(outDir, { recursive: true });

// Each shelf runs in its OWN browser context: the chain bits are low-bank flags shared
// between the two rooms, so one inn's progress must not pre-open the other's.
const SHELVES = [
  { map: "s235", npc: 63, x: 145, y: 289, amount: 300, text: true },
  // s928's shelf pays out correctly but PRINTS THE WRONG LINES: its actor binds
  // estalk01 indices 47/49, which hold named townspeople's chatter (Sarah, Guilmon),
  // not the search-point lines the identical s235 actor gets from estalk05. Which
  // language file a stage's dialogue actually comes from is not decoded (a same-named
  // file is not evidence — check the bank-request function), so the text is reported
  // here and not asserted. The money is asserted: that is what this script is for.
  { map: "s928", npc: 63, x: 145, y: 289, amount: 8500, text: false },
];

const browser = await chromium.launch();
let failed = 0;
const errors = [];
const check = (ok, msg) => { console.log(`${ok ? "OK  " : "FAIL"}  ${msg}`); if (!ok) failed += 1; };

for (const shelf of SHELVES) {
  const context = await browser.newContext({
    viewport: { width: 900, height: 700 },
    storageState: {
      cookies: [],
      origins: [{
        origin,
        localStorage: [
          { name: "engineSchema", value: "2" },
          { name: "assetMode", value: "authentic" },
          { name: "progressOrdinal", value: "45" },
          { name: "charId", value: "p003pken" },
          { name: "party", value: JSON.stringify(["p003pken", "p005koet", "p004kogu"]) },
        ],
      }],
    },
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(`${shelf.map}: ${e.message}`));

  const tap = (k) => page.evaluate((kk) => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: kk }));
    window.dispatchEvent(new KeyboardEvent("keyup", { key: kk }));
  }, k);
  const hold = async (k, ms) => {
    await page.evaluate((kk) =>
      window.dispatchEvent(new KeyboardEvent("keydown", { key: kk })), k);
    await page.waitForTimeout(ms);
    await page.evaluate((kk) =>
      window.dispatchEvent(new KeyboardEvent("keyup", { key: kk })), k);
  };
  const boxText = () => page.evaluate(() =>
    (window.__textbox?.dialogue?.pages ?? []).map((p) => p.join(" ")).join(" "));
  const bits = () => page.evaluate(() => window.__state.bits);

  await page.goto(`${origin}/?skipTitle=1&map=${shelf.map}&noEncounters=1`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__state?.started && window.__talkTarget, null,
    { timeout: 40000 });
  await page.waitForTimeout(1000);
  // Clear anything the map-enter path put on screen.
  for (let i = 0; i < 40; i++) {
    const busy = await page.evaluate(() =>
      (window.__textbox?.isOpen?.() ?? false) || (window.__cutscene?.isActive?.() ?? false));
    if (!busy) break;
    await tap(" ");
    await page.waitForTimeout(150);
  }

  const before = await bits();

  // Stand below the shelf and walk up into it, so the player ends up facing the point.
  await page.evaluate(([x, y]) => window.__teleport(x, y), [shelf.x, shelf.y + 26]);
  await page.waitForTimeout(400);
  await hold("ArrowUp", 150);
  await page.waitForTimeout(300);

  const target = await page.evaluate(() => window.__talkTarget());
  assert.equal(target?.npc, shelf.npc,
    `${shelf.map}: expected to be facing the shelf search point, got ${JSON.stringify(target)}`);
  await page.screenshot({ path: resolve(outDir, `${shelf.map}-1-at-the-shelf.png`) });

  // Seven presses: six walk the chain to the find, the seventh shows it is spent.
  const lines = [];
  let foundAt = -1, gained = 0;
  for (let press = 0; press < 7; press++) {
    await tap(" ");
    await page.waitForTimeout(400);
    lines.push(await boxText());
    const now = await bits();
    if (now - before === shelf.amount && foundAt < 0) {
      foundAt = press;
      gained = now - before;
      await page.screenshot({ path: resolve(outDir, `${shelf.map}-2-found.png`) });
    }
    for (let i = 0; i < 8 && await page.evaluate(() => window.__textbox?.isOpen?.() ?? false); i++) {
      await tap(" ");
      await page.waitForTimeout(200);
    }
    await hold("ArrowUp", 100);
    await page.waitForTimeout(150);
  }
  const after = await bits();
  await page.screenshot({ path: resolve(outDir, `${shelf.map}-3-after.png`) });

  console.log(`${shelf.map} (${shelf.amount} BIT):`);
  lines.forEach((l, i) => console.log(`  press ${i + 1}: ${JSON.stringify(l)}`));
  check(foundAt === 5, `${shelf.map}: the find is the SIXTH examine (found on press ${foundAt + 1})`);
  if (shelf.text)
    check(new RegExp(`${shelf.amount} BIT`).test(lines[foundAt] ?? ""),
      `${shelf.map}: the sixth examine announces ${shelf.amount} BIT`);
  check(gained === shelf.amount,
    `${shelf.map}: the wallet gained ${shelf.amount} BIT (${before} -> ${after})`);
  check(after - before === shelf.amount, `${shelf.map}: no double-grant across the seven presses`);
  if (shelf.text)
    check(/nothing left/i.test(lines[6] ?? ""),
      `${shelf.map}: the seventh examine says nothing is left`);

  // The wallet is the engine's $party.bit now: prove it survives a reload, and that a
  // plain browser-side write (what the shop, inn and battle rewards do) moves it too.
  await page.reload({ waitUntil: "load" });
  await page.waitForFunction(() => window.__state?.started, null, { timeout: 40000 });
  await page.waitForTimeout(600);
  const reloaded = await bits();
  check(reloaded === after, `${shelf.map}: the wallet survives a reload (${after} -> ${reloaded})`);
  const roundTrip = await page.evaluate(() => {
    window.__state.bits = 1234;
    return {
      read: window.__state.bits,
      engine: Number(window.__engine?.state.vars.get("$party.bit")),
      stored: Number(localStorage.getItem("bits")),
    };
  });
  check(roundTrip.read === 1234 && roundTrip.engine === 1234 && roundTrip.stored === 1234,
    `${shelf.map}: a browser-side wallet write reaches the engine and storage ` +
    `(${JSON.stringify(roundTrip)})`);

  await context.close();
}

if (errors.length) console.log("PAGEERRORS:", errors);
await browser.close();
console.log(failed ? `${failed} check(s) FAILED` : "search points OK");
process.exit(failed || errors.length ? 1 : 0);
