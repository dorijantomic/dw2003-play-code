// tools/verify_dri_submenu_fold.mjs — the digivolve Select Action submenu's fold.
//
// Original: F0x800885ec installs the submenu's fold step counts (+0x54=8,
// +0x64/+0x74/+0x84/+0x94=0xA, +0xA4=8) and F0x8008820c draws each pane through
// the sp9C/spA4 tween pair on the pivots (left stat panel (0,0x7F), loaded-tech
// window (0x140,0x2A), banner (0x140,0x5C), option window (0x140,0x87), back
// plate (0x140,0xBE)). F0x80087600 case 2 gates input until they are open, and
// cases 3-4 shut them BEFORE the child screen runs. This drives the real game
// with real key events: the DRI entry is seeded (the pause-menu walk has its own
// checks), everything after is ordinary input.
//
// Run: .opencode/autonomy/check-browser tools/verify_dri_submenu_fold.mjs
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const ROOT = process.env.DRI_SUBMENU_ROOT || `${baseUrl(8742)}/`;
const OUT = process.env.DRI_SUBMENU_SHOT || ".dw3-research/autonomous-plan/shots/dri-submenu-fold";
mkdirSync(OUT, { recursive: true });

const lead = {
  digimonId: 9, level: 30, xp: 0, hp: 400, maxHp: 400, mp: 160, maxMp: 160,
  stats: { str: 90, def: 60, spt: 70, wis: 70, spd: 60, chr: 40 }, bonuses: {}, elemBonuses: {},
  equippedForms: [27, 39, 0],
  formLedger: [
    { id: 9, formLevel: 99, dvexp: 0, techSlots: [0x2069, 0, 0, 0, 0, 0] },
    { id: 27, formLevel: 99, dvexp: 0, techSlots: [0, 0, 0, 0, 0, 0] },
    { id: 39, formLevel: 99, dvexp: 0, techSlots: [0, 0, 0, 0, 0, 0] },
  ],
};

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
const errors = [];
page.on("pageerror", (e) => { errors.push(e.message); console.error("PAGEERROR", e.message); });
await page.addInitScript((seed) => {
  localStorage.setItem("assetMode", "authentic");
  localStorage.setItem("engineSchema", "2");
  localStorage.setItem("playerName", "Junior");
  localStorage.setItem("charId", "p003pken");
  localStorage.setItem("party", JSON.stringify(["p003pken"]));
  localStorage.setItem("partnerStats", JSON.stringify(seed.lead));
  localStorage.setItem("partyStats", JSON.stringify([seed.lead]));
  localStorage.setItem("equipment", JSON.stringify([{}]));
  localStorage.setItem("rosterOwned", "1");
}, { lead });

const snap = () => page.evaluate(() => ({
  screen: window.__dri.screen,
  cursor: window.__dri.cursor,
  folds: window.__dri.folds
    ? Object.fromEntries(Object.entries(window.__dri.folds).map(([k, f]) => [k, !!f.active]))
    : null,
  activeFolds: window.__dri.folds
    ? Object.values(window.__dri.folds).filter((f) => f.active).length : 0,
  menuLeave: window.__dri._menuLeave ?? null,
}));
const key = async (k) => {
  await page.evaluate((kk) => window.dispatchEvent(new KeyboardEvent("keydown", { key: kk })), k);
  await page.evaluate((kk) => window.dispatchEvent(new KeyboardEvent("keyup", { key: kk })), k);
  await page.waitForTimeout(60);
};
const shot = async (n) => writeFileSync(`${OUT}/${n}.png`,
  Buffer.from((await page.evaluate(() => document.querySelector("canvas#game").toDataURL("image/png"))).split(",")[1], "base64"));
const waitMenuOpen = () => page.waitForFunction(
  () => window.__dri.screen === "digivolve_menu"
    && (!window.__dri.folds || Object.values(window.__dri.folds).every((f) => !f.active)),
  null, { timeout: 5_000 });

let failed = null;
const fail = (m) => { failed = m; console.error("FAIL:", m); };
const result = { errors };
try {
  await page.goto(`${ROOT}?skipTitle=1&map=s245&noEncounters=1&legacyDri=1`);
  await page.waitForFunction(() => window.__state?.started && window.__dri, null, { timeout: 40_000 });
  await page.waitForTimeout(400);

  await page.evaluate(() => window.__dri.openAction(1, window.__state, null));
  await page.waitForFunction(() => window.__dri.screen === "digivolve_picker", null, { timeout: 5_000 });
  await key("c");                       // picker -> Select Action submenu
  await page.waitForFunction(() => window.__dri.screen === "digivolve_menu", null, { timeout: 5_000 });
  result.entering = await snap();
  await shot("submenu-folding");
  if (result.entering.activeFolds < 1) fail(`the submenu opened with no folds: ${JSON.stringify(result.entering)}`);

  // Input must be gated while the windows fold open.
  await key("s");                       // down, while folding
  result.gated = await snap();
  if (result.gated.cursor !== 0) fail(`input was not gated while the folds open: ${JSON.stringify(result.gated)}`);

  await waitMenuOpen();
  result.open = await snap();
  await shot("submenu-open");
  if (result.open.activeFolds !== 0) fail(`the folds never landed: ${JSON.stringify(result.open)}`);

  // Down -> "Load technique."; confirm queues the child and SHUTS the folds.
  await key("s");
  result.cursor1 = await snap();
  if (result.cursor1.cursor !== 1) fail(`the menu cursor did not move: ${JSON.stringify(result.cursor1)}`);
  await key("c");
  result.leaving = await snap();
  await shot("submenu-shutting");
  if (result.leaving.screen !== "digivolve_menu" || !result.leaving.menuLeave)
    fail(`the child ran before the shut folds: ${JSON.stringify(result.leaving)}`);
  if (!(result.leaving.activeFolds > 0))
    fail(`the shut folds never started: ${JSON.stringify(result.leaving)}`);

  await page.waitForFunction(() => window.__dri.screen === "load_tech", null, { timeout: 5_000 });
  result.child = await snap();
  await shot("submenu-child");
  if (result.child.screen !== "load_tech") fail(`the child never opened: ${JSON.stringify(result.child)}`);

  // Back to the menu re-opens the folds, then cancel shuts them and returns.
  await key("x");                       // 0x4000 BACK: child -> menu (folds open)
  await page.waitForFunction(() => window.__dri.screen === "digivolve_menu", null, { timeout: 5_000 });
  result.reentered = await snap();
  if (!(result.reentered.activeFolds > 0))
    fail(`returning to the menu did not re-open the folds: ${JSON.stringify(result.reentered)}`);
  await waitMenuOpen();
  await key("x");                       // 0x4000 BACK: menu -> picker (folds shut first)
  await page.waitForFunction(() => window.__dri.screen === "digivolve_picker", null, { timeout: 5_000 });
  result.picker = await snap();

  if (errors.length) fail(`${errors.length} page error(s)`);
  console.log("RESULT", JSON.stringify({ ok: !failed, ...result }));
} catch (e) {
  await fail(e.message);
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
