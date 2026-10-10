// The pause See Equipment panel as a player reaches it: START -> STATUS -> the
// partner's sheet -> See Equipment -> the six-slot list -> the item list, with a
// screenshot at each fold, and the panel's OWN words read out of the page rather
// than its picture.
//
// Server: python3 -m http.server <VERIFY_PORT> --directory web
// Run:    VERIFY_PORT=<port> tools/run-playwright.sh tools/verify_menu_equip.mjs [outdir]
//
// This check used to poke `window.__menu.handleKey` with the string "enter" and
// count four Downs, and its only pass rule was "no page errors". Two things had
// changed under it: the pause home hands every row to a ported page
// (web/game.js:537 `menu.onNativePage`), so `handleKey` no longer reaches the
// screen a player sees and the panel's confirm is Circle (0x0D), not "enter"; and
// the walker panels it drove are not the routed screens, so its shots never left
// the home list. It now drives the pad the way the disc does and asserts what the
// panel shows, which is what it was named for.
//
// What it asserts, all read out of the page's own memory:
//   * the slot list opens on Head and every EMPTY slot shows the overlay's own title
//     word for it (the six-word title table pro/ststatus keeps at 0x8009A7AC), the
//     four of them being four different words;
//   * the six slots CLAMP rather than wrap (F0x8008744c: `if (v >= 6) +0x60 = 5`),
//     and Up on Head stays on Head;
//   * the item list's row 0 is the take-off sentinel 0xFFFF (pro/ststatus
//     F0x8009A344 admits id -1 first and unconditionally);
//   * equipping from the list writes the wearer record and takes the copy out of
//     the bag, and taking it off puts it back.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import {
  pauseBase, pageWords, openPageFromHome, openEquipWindow, equipSlotTo, equipItemTo,
  openEquipItemList, closePause, press,
} from "./verify-pause-pages.mjs";

const out = process.argv[2] ?? ".bunny-scratch/menu-equip";
mkdirSync(out, { recursive: true });

/** The six words the overlay keeps for the slot titles, read out of the session. */
const SLOT_TITLES = 0x8009a7ac;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 960, height: 720 } });
const errors = [];
page.on("pageerror", (e) => { errors.push(e.message); console.error("PAGEERROR:", e.message); });
await page.addInitScript(() => {
  localStorage.setItem("assetMode", "authentic");
  localStorage.setItem("engineSchema", "2");
  localStorage.setItem("playerName", "Junior");
});

// The lead is Kotemon wearing NOTHING, with a bag of gear: every one of the six slot
// names is then the overlay's own title row (F0x800867B8's else arm), which is the
// panel's one piece of text this check can read exactly. The bag carries a Bandanna
// (215) for the head slot, which the game's own wear mask admits, and weapons for the
// hands.
const BANDANNA = 215;
const seed = () => page.evaluate(() => {
  const s = window.__state;
  s.bits = 130821;
  s.party = ["p003pken", "p007veem", "p009rena"];
  s.digimonNames = { p003pken: "Kotemon" };
  s.partnerStats = {
    digimonId: 1, level: 38, xp: 0, tp: 30, hp: 900, maxHp: 900, mp: 400, maxMp: 400,
    stats: { str: 573, def: 300, spt: 188, wis: 200, spd: 143, chr: 275 },
    bonuses: {}, elemBonuses: {},
  };
  s.partyStats = [s.partnerStats,
    { digimonId: 5, level: 30, xp: 0, tp: 30, hp: 400, maxHp: 400, mp: 200, maxMp: 200,
      stats: { str: 672, def: 250, spt: 157, wis: 180, spd: 107, chr: 231 },
      bonuses: {}, elemBonuses: {} },
    { digimonId: 7, level: 31, xp: 0, tp: 30, hp: 420, maxHp: 420, mp: 210, maxMp: 210,
      stats: { str: 705, def: 260, spt: 150, wis: 190, spd: 124, chr: 271 },
      bonuses: {}, elemBonuses: {} }];
  s.equipment = [{}, {}, {}];
  s.inventory = [
    { id: 215, qty: 1 }, { id: 92, qty: 2 }, { id: 205, qty: 2 }, { id: 206, qty: 1 },
    { id: 300, qty: 1 }, { id: 301, qty: 4 }, { id: 43, qty: 56 },
  ];
  // Nothing is opened here: the route below presses START itself, and the pause home
  // is a ported page rather than the walker's own panel, which `menuOpen`/`menu.reset`
  // would only put a second screen on top of.
});

const shot = async (name, wait = 0) => {
  if (wait) await page.waitForTimeout(wait);
  writeFileSync(`${out}/${name}.png`,
    Buffer.from((await page.locator("canvas#game").evaluate((el) => el.toDataURL("image/png"))).split(",")[1], "base64"));
  console.log("shot", name);
};

const failures = [];
const fail = (m) => { failures.push(m); console.error("FAIL:", m); };
const expect = (cond, m) => { if (!cond) fail(m); return cond; };
/** The window folds back to its six-slot list (state 3) after a confirm. */
const waitSlotList = async (p) => {
  for (let i = 0; i < 60; i++) {
    const w = await pageWords(p);
    if (w?.equip?.state === 3) return w;
    await p.waitForTimeout(100);
  }
  throw new Error("the equipment window never folded back to its slot list");
};

try {
  await page.goto(pauseBase(8741, "skipTitle=1&noEncounters=1"));
  await page.waitForFunction(() => window.__state && window.__menu, null, { timeout: 30_000 });
  await page.waitForFunction(() => window.__state?.started === true, null, { timeout: 30_000 });
  await page.waitForTimeout(2500);   // fonts/packs
  await seed();
  await shot("m0_home");

  // ── the real route to the panel.
  await openPageFromHome(page, "status", { sheetRow: 1 });
  await shot("m1_status_sheet");
  const slots = await openEquipWindow(page);
  await shot("m2_equip_slots");
  expect(slots.equip.slot === 0,
    `the slot list must open on Head, not slot ${slots.equip.slot}`);

  // The panel's own six slot names, read out of the page and resolved through the
  // page's OWN text banks, so this asserts the words it shows and not a picture of
  // them. pro/ststatus keeps one title row per slot at 0x8009A7AC and F0x800867B8
  // (the port's `equipSlotNames`) installs bank 0x6A's item name on a worn slot and
  // that title row on an empty one.
  const names = await page.evaluate((base) => {
    const s = window.__status._session, mem = s.mem;
    const task = [...s.tree.tasks.values()].find((t) => (t.classId >>> 0) === 0x80088214);
    const a = task.address >>> 0;
    const ui = mem.read32(a + 0x24) >>> 0;
    const lang = mem.read32(0x8005cca8) | 0;
    const glyphs = (widget) => {
      const rec = widget + 0x5c;                    // line record 0 (LINE_RECORD_BASE)
      const buf = mem.read32(rec) >>> 0;
      const len = mem.read16(rec + 6) & 0xff;
      let out = "";
      for (let k = 0; k < len; k++) out += String.fromCharCode(mem.read8(buf + k) & 0xff);
      return out;
    };
    // The overlay's own row, as the page's text banks resolve it, read back for as
    // many glyphs as the widget installed (widgetSetLineString copies strlen bytes).
    const expect = (offset, id, len) => {
      const source = s.banks.source(lang + offset);
      const ptr = s.banks.stringById(mem, source, id);
      if (!ptr) return null;
      let out = "";
      for (let k = 0; k < len; k++) out += String.fromCharCode(mem.read8(ptr + k) & 0xff);
      return out;
    };
    return {
      slot: mem.read32(a + 0x60) | 0,
      titles: Array.from({ length: 6 }, (_, i) => mem.read32(base + i * 4) | 0),
      drawn: Array.from({ length: 6 }, (_, i) => glyphs(mem.read32(ui + 4 + i * 4) >>> 0)),
      drawnFirst: (() => {
        const ui2 = mem.read32(a + 0x24) >>> 0;
        return Array.from({ length: 6 }, (_, i) => {
          const w = mem.read32(ui2 + 4 + i * 4) >>> 0;
          const rec = w + 0x5c;
          const len = mem.read16(rec + 6) & 0xff;
          return expect(0xb0, mem.read32(base + i * 4) | 0, len);
        });
      })(),
      itemBankReady: (() => { try { s.banks.source(lang + 0x6a); return true; } catch { return false; } })(),
    };
  }, SLOT_TITLES);
  expect(names.slot === 0, `the highlighted slot is ${names.slot}, expected Head`);
  expect(names.drawn.every((t) => t.length > 0),
    `the slot list left a slot unnamed: ${JSON.stringify(names.drawn)}`);
  // Every slot is empty in this fixture, so all six show the overlay's own title row
  // for that slot (F0x800867B8's else arm). The six rows are five distinct words --
  // the two accessory slots share one -- so that is what is pinned, not six.
  for (const i of [0, 1, 2, 3, 4, 5]) {
    expect(names.drawn[i] === names.drawnFirst[i],
      `slot ${i} shows ${JSON.stringify(names.drawn[i])}, the overlay's own row says `
      + `${JSON.stringify(names.drawnFirst[i])} (title id ${names.titles[i]})`);
  }
  expect(new Set(names.drawn).size === 5,
    `the six slot names are not the overlay's five distinct words: ${JSON.stringify(names.drawn)}`);
  expect(names.itemBankReady, "the item-name bank (0x6A) is not loaded, so no slot can show a worn item");
  console.log("slot titles as the panel draws them:", JSON.stringify(names.drawn));

  // ── the six slots clamp rather than wrap (F0x8008744c case 3).
  for (let i = 0; i < 8; i++) await press(page, "ArrowDown", 70, 160);
  let w = await pageWords(page);
  expect(w.equip.slot === 5, `Down past the last slot landed on ${w.equip.slot}, expected the clamp at 5`);
  await shot("m3_equip_clamped_at_acc1");
  for (let i = 0; i < 8; i++) await press(page, "ArrowUp", 70, 160);
  w = await pageWords(page);
  expect(w.equip.slot === 0, `Up past Head landed on ${w.equip.slot}, expected the clamp at 0`);

  // ── the head slot: its list, the take-off sentinel, an equip and a take-off.
  await equipSlotTo(page, 0);
  await shot("m4_equip_head_slot");
  const before = await page.evaluate(({ bandanna }) => {
    const s = window.__status._session;
    return { worn: s.mem.read16(0x80049494 + 0x3c8) & 0xffff,
             held: s.mem.read8(0x80048d34 + 0x7c + bandanna) };
  }, { bandanna: BANDANNA });
  expect(before.worn === 0, `the fixture already wears ${before.worn} on the head`);
  expect(before.held === 1, `the fixture's bag holds ${before.held} Bandannas`);
  const items = await openEquipItemList(page);
  expect(items[0] === 0xffff,
    `row 0 of an empty slot must be the take-off sentinel, got ${JSON.stringify(items)}`);
  expect(items.includes(BANDANNA),
    `the head slot's list did not offer the Bandanna: ${JSON.stringify(items)}`);
  await shot("m5_equip_head_list");
  const wearRow = items.indexOf(BANDANNA);
  await equipItemTo(page, wearRow);
  const picked = (await pageWords(page)).equip;
  expect(picked.items[picked.cursor] === BANDANNA,
    `the cursor is on ${picked.items[picked.cursor]}, expected the Bandanna: ${JSON.stringify(picked)}`);
  await shot("m6_equip_list_bandanna");
  await press(page, " ");      // equip it
  await waitSlotList(page);
  const after = await page.evaluate(({ bandanna }) => {
    const s = window.__status._session;
    return { worn: s.mem.read16(0x80049494 + 0x3c8) & 0xffff,
             held: s.mem.read8(0x80048d34 + 0x7c + bandanna) };
  }, { bandanna: BANDANNA });
  expect(after.worn === BANDANNA,
    `the head halfword is ${after.worn}, expected the equipped ${BANDANNA}: ${JSON.stringify(after)}`);
  expect(after.held === 0,
    `the band left the bag but the bag still holds ${after.held}: ${JSON.stringify(after)}`);
  await shot("m7_equipped");

  // ── and the take-off row puts it back, which is the other direction of the same list.
  const list = await openEquipItemList(page);
  expect(list[0] === 0xffff, `row 0 lost the take-off sentinel after equipping: ${JSON.stringify(list)}`);
  await equipItemTo(page, 0);
  await press(page, " ");
  await waitSlotList(page);
  const undone = await page.evaluate(({ bandanna }) => {
    const s = window.__status._session;
    return { worn: s.mem.read16(0x80049494 + 0x3c8) & 0xffff,
             held: s.mem.read8(0x80048d34 + 0x7c + bandanna) };
  }, { bandanna: BANDANNA });
  expect(undone.worn === 0, `taking it off left the head at ${undone.worn}`);
  expect(undone.held === 1, `the band came back as ${undone.held} copies, expected 1`);
  await shot("m8_removed");

  // ── the right hand's own list: the same sentinel, and the bag's weapons offered.
  await equipSlotTo(page, 2);
  const hands = await openEquipItemList(page);
  expect(hands[0] === 0xffff,
    `row 0 of the right hand is not the take-off sentinel: ${JSON.stringify(hands)}`);
  expect(hands.slice(1).some((id) => id > 0),
    `the right hand's list offered no weapon: ${JSON.stringify(hands)}`);
  await shot("m9_equip_right_list");

  await closePause(page);
  expect(errors.length === 0, `${errors.length} page error(s): ${errors.join(" | ")}`);
  console.log("RESULT", JSON.stringify({
    ok: failures.length === 0, names, before, after, undone, failures,
  }));
} catch (e) {
  fail(`${e.message}\n${e.stack}`);
} finally {
  await browser.close();
}
console.log(failures.length ? `FAILED ${failures.length}: ${failures.join(" | ")}` : "OK");
process.exit(failures.length ? 1 : 0);
