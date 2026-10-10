import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

// Item 6.1 acceptance for the loaded-technique ledger: drive the real DRI desk
// with ordinary keyboard buttons, load a technique onto an acquired form,
// unload it, load it again, then reload the page (the browser's Continue) and
// confirm the loaded flag is still on the restored partner and still prices the
// loaned technique with the +1 minimum premium.
//
// Server: python3 -m http.server 8741 --directory web
// Run:    tools/run-playwright.sh tools/verify_dri_tech_load.mjs
//
// Starting fixture only (a seeded partner): after __labOpen("dri") every step
// is a normal button through the game's own key handler. The DRI confirm
// button is Cross ("c"); Circle is the Switch-screen Details toggle.
const BASE = process.env.DRI_URL || `${baseUrl(8741)}/?skipTitle=1&noEncounters=1&legacyDri=1`;
const OUT = process.env.DRI_SHOT || "/tmp/dri-tech-load";
const FORM = 9;          // Dinohumon, an acquired form (id > 8)
const TECH = 190;        // Antidote, Unknown3 base MP 8
const LOADABLE = 0x2000 | TECH;
const LOADED = 0x6000 | TECH;   // 0x2000 loadable stays set; 0x4000 is the load bit

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
page.on("pageerror", (e) => console.error("PAGEERROR", e));

const waitScreen = (screen) =>
  page.waitForFunction((s) => window.__dri?.screen === s, screen, { timeout: 15_000 });
// The digivolve Select Action submenu folds its windows open before it takes
// input (F0x8008820c), so wait for them to land before pressing on.
const waitMenuOpen = () =>
  page.waitForFunction(() => window.__dri.screen === "digivolve_menu"
    && (!window.__dri.folds || Object.values(window.__dri.folds).every((f) => !f.active)),
    null, { timeout: 5_000 });
const slot0 = () => page.evaluate(() => {
  const rec = window.__state.partnerStats.formLedger.find((r) => Number(r.id) === 9);
  return Number(rec.techSlots[0]) & 0xffff;
});
const shot = async (name) =>
  writeFileSync(`${OUT}/${name}.png`,
    Buffer.from((await page.locator("canvas#game").evaluate((el) => el.toDataURL("image/png"))).split(",")[1], "base64"));

const results = {};
let promptOn, promptOff;
try {
  await page.goto(BASE);
  await page.waitForFunction(() => window.__state?.started, null, { timeout: 30_000 });

  // Seeded starting fixture: one acquired equipped form whose slot 0 is a
  // loadable (0x2000) ordinary technique and nothing loaded yet.
  await page.evaluate(({ form, loadable }) => {
    const s = window.__state;
    s.party = ["p003pken", "p009rena", "p010pata"];
    s.partyStats = [null, null, null];
    s.partnerStats = {
      digimonId: form, level: 40, hp: 999, maxHp: 999, mp: 999, maxMp: 999,
      bonuses: {}, elemBonuses: {}, equippedForms: [form],
      formLedger: [{ id: form, formLevel: 22, dvexp: 0, techSlots: [loadable, 0, 0, 0, 0, 0] }],
    };
    s.partyStats[0] = s.partnerStats;
    s.digimonNames = {};
  }, { form: FORM, loadable: LOADABLE });

  // Production screen entry: the same driMenu.open(null, null, state) the
  // field's DRI event uses (game.js bank 0x7c).
  await page.evaluate(() => window.__labOpen("dri"));
  await page.locator("canvas#game").click({ position: { x: 160, y: 200 } });
  await waitScreen("root");
  results.seeded = await slot0();

  // Root -> Digivolve -> the selected partner's Select Action submenu.
  await page.keyboard.press("s");                 // cursor: Switch -> Digivolve
  await page.keyboard.press("c");
  await waitScreen("digivolve_picker");
  await page.keyboard.press("c");
  await waitScreen("digivolve_menu");
  await waitMenuOpen();                           // the submenu windows fold open
  // Submenu cursor 0 = "Change digivolve type." -> row 1 = "Load technique."
  await page.keyboard.press("s");
  await page.keyboard.press("c");
  await waitScreen("load_tech");
  await shot("load-tech-before");

  // Confirm the loadable row, then confirm the "Load?" prompt.
  await page.keyboard.press("c");
  promptOn = await page.evaluate(() => window.__dri.prompt);
  await page.keyboard.press("c");                 // prompt.yes defaults true
  await page.waitForFunction(() => window.__dri.prompt === null);
  results.loadedWord = await slot0();
  results.loadedStorage = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("partnerStats")).formLedger[0].techSlots[0] & 0xffff);
  await shot("load-tech-after-load");

  // Unload: the same row now offers "Turn load off?".
  await page.keyboard.press("c");
  promptOff = await page.evaluate(() => window.__dri.prompt);
  await page.keyboard.press("c");
  await page.waitForFunction(() => window.__dri.prompt === null);
  results.unloadedWord = await slot0();

  // Load it again so the saved state carries the loan, then reload = Continue.
  await page.keyboard.press("c");
  await page.keyboard.press("c");
  await page.waitForFunction(() => window.__dri.prompt === null);
  results.reloadedSource = await slot0();

  await page.reload();
  await page.waitForFunction(() => window.__state?.started, null, { timeout: 30_000 });
  const after = await page.evaluate(async ({ form }) => {
    const eng = await import("./vendor/engine.js");
    const rec = (window.__state.partnerStats.formLedger ?? []).find((r) => Number(r.id) === form);
    const word = Number(rec?.techSlots?.[0] ?? 0) & 0xffff;
    const stored = JSON.parse(localStorage.getItem("partnerStats"))
      .formLedger.find((r) => Number(r.id) === form).techSlots[0] & 0xffff;
    return {
      stateWord: word, storedWord: stored,
      nativeCost: eng.techniqueMpCost(8, word & 0x1fff, { mpCostDown: 5 }),
      loadedCost: eng.techniqueMpCost(8, word, { mpCostDown: 5 }),
    };
  }, { form: FORM });
  results.afterReload = after;
  await page.evaluate(() => window.__labOpen("dri"));
  await waitScreen("root");
  results.reopened = await page.evaluate(() => {
    const rec = window.__state.partnerStats.formLedger.find((r) => Number(r.id) === 9);
    return Number(rec.techSlots[0]) & 0xffff;
  });
  await shot("dri-after-continue");
} finally {
  await browser.close();
}

const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
assert(results.seeded === LOADABLE, `fixture: expected loadable word, got ${results.seeded.toString(16)}`);
assert(promptOn?.message === "Load?" && promptOn?.yes === true, `load prompt: ${JSON.stringify(promptOn)}`);
assert((results.loadedWord & 0x4000) !== 0, `load did not set 0x4000: ${results.loadedWord.toString(16)}`);
assert(results.loadedWord === LOADED, `load word ${results.loadedWord.toString(16)} != ${LOADED.toString(16)}`);
assert(results.loadedStorage === LOADED, `persisted word ${results.loadedStorage?.toString(16)} != loaded`);
assert(promptOff?.message === "Turn load off?", `unload prompt: ${JSON.stringify(promptOff)}`);
assert((results.unloadedWord & 0x4000) === 0, `unload did not clear 0x4000: ${results.unloadedWord.toString(16)}`);
assert(results.reloadedSource === LOADED, `second load word ${results.reloadedSource.toString(16)}`);
assert(results.afterReload.stateWord === LOADED && results.afterReload.storedWord === LOADED,
  `Continue did not restore the loan: ${JSON.stringify(results.afterReload)}`);
assert(results.afterReload.nativeCost === 3 && results.afterReload.loadedCost === 4,
  `restored price: ${JSON.stringify(results.afterReload)}`);
assert(results.reopened === LOADED, `reopened DRI word ${results.reopened.toString(16)}`);
console.log(JSON.stringify({ ok: true, loadable: LOADABLE.toString(16), loaded: LOADED.toString(16), results }, null, 2));
