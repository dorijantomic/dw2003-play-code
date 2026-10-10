// tools/verify_dri_change_panel.mjs — the Change-digivolve-type message panel.
//
// Original: confirming a cell that is the form the partner already stands as
// opens a panel (F0x80085dd0 state 2) listing the three equipped forms and
// "Don't set." (esdglabo 0x2C) with the Battle Digivolve hint (0x2B); the panel
// cursor writes the standing form on confirm (row 4 writes 0/rookie) and the
// cancel arm writes 0 as well. Claims roster-record-764-is-current-form-id-2026-09-14
// and dv-message-panel-labels-2026-09-14.
//
// Run: .opencode/autonomy/check-browser tools/verify_dri_change_panel.mjs
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const ROOT = process.env.DRI_PANEL_ROOT || `${baseUrl(8742)}/`;
const OUT = process.env.DRI_PANEL_SHOT || ".dw3-research/autonomous-plan/shots/dri-change-panel";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
const errors = [];
page.on("pageerror", (e) => { errors.push(e.message); console.error("PAGEERROR", e.message); });
await page.addInitScript(() => {
  localStorage.setItem("assetMode", "authentic");
  localStorage.setItem("engineSchema", "2");
  localStorage.setItem("playerName", "Junior");
  localStorage.setItem("charId", "p003pken");
  localStorage.setItem("party", JSON.stringify(["p003pken"]));
  const lead = {
    digimonId: 9, level: 20, xp: 0, hp: 400, maxHp: 400, mp: 160, maxMp: 160,
    stats: { str: 90, def: 60, spt: 70, wis: 70, spd: 60, chr: 40 }, bonuses: {}, elemBonuses: {},
    equippedForms: [27, 39, 0],
    formLedger: [
      { id: 9, formLevel: 99, dvexp: 0, techSlots: [0, 0, 0, 0, 0, 0] },
      { id: 27, formLevel: 99, dvexp: 0, techSlots: [0, 0, 0, 0, 0, 0] },
      { id: 39, formLevel: 99, dvexp: 0, techSlots: [0, 0, 0, 0, 0, 0] },
      { id: 41, formLevel: 99, dvexp: 0, techSlots: [0, 0, 0, 0, 0, 0] },
    ],
  };
  localStorage.setItem("partnerStats", JSON.stringify(lead));
  localStorage.setItem("partyStats", JSON.stringify([lead]));
  localStorage.setItem("equipment", JSON.stringify([{}]));
  localStorage.setItem("rosterOwned", "1");   // slot 0 only
});

let failed = null;
const fail = (m) => { failed = m; console.error("FAIL:", m); };
const snap = () => page.evaluate(() => ({
  screen: window.__dri.screen,
  panel: window.__dri.panel ? { ...window.__dri.panel } : null,
  cursor: window.__dri.cursor,
  formId: window.__state.partnerStats?.digimonId ?? null,
}));
const shot = async (n) => writeFileSync(`${OUT}/${n}.png`,
  Buffer.from((await page.evaluate(() => document.querySelector("canvas#game").toDataURL("image/png"))).split(",")[1], "base64"));
// The logical button NAMES, not keys: web/dri.js asks the pad for word bit 0x2000
// ("circle") to confirm and 0x4000 ("cross") to cancel (web/dri.js:462-466 after
// 173ebcf0), so a check that hand-feeds handleKey must use those names.
const key = (k) => page.evaluate((kk) => window.__dri.handleKey(kk), k);
// The panel folds open before it takes input (F0x80085dd0 state 2 -> 4) and
// folds away before it clears; wait for the fold to land.
// The digivolve Select Action submenu folds its windows open before it takes
// input (F0x8008820c); wait for them to land between presses.
const waitMenuOpen = () => page.waitForFunction(
  () => window.__dri.screen === "digivolve_menu"
    && (!window.__dri.folds || Object.values(window.__dri.folds).every((f) => !f.active)),
  null, { timeout: 5_000 });

const waitGridOpen = () => page.waitForFunction(
  () => window.__dri.screen === "change_type" && (!window.__dri.gridFold || !window.__dri.gridFold.active),
  null, { timeout: 5_000 });
const waitPanelOpen = () => page.waitForFunction(
  () => window.__dri.panel && (!window.__dri.panelFold || !window.__dri.panelFold.active),
  null, { timeout: 5_000 });
const waitPanelGone = () => page.waitForFunction(() => window.__dri.panel === null, null, { timeout: 5_000 });

const results = { errors };
try {
  await page.goto(`${ROOT}?skipTitle=1&map=s245&noEncounters=1&legacyDri=1`);
  await page.waitForFunction(() => window.__state?.started && window.__dri, null, { timeout: 40_000 });
  await page.waitForTimeout(400);
  // Real flow: Digivolve picker -> Select Action -> Change digivolve type.
  await page.evaluate(() => window.__dri.openAction(1, window.__state, null));
  await page.waitForFunction(() => window.__dri.screen === "digivolve_picker", null, { timeout: 5_000 });
  await key("circle");
  await waitMenuOpen();
  await key("circle");
  await waitGridOpen();
  results.grid = await snap();
  if (results.grid.screen !== "change_type") fail(`did not reach the change-type grid: ${JSON.stringify(results.grid)}`);

  // Cell 0 is the form the partner already stands as -> the panel opens.
  await key("circle");
  await waitPanelOpen();
  results.opened = await snap();
  await shot("panel-open");
  if (!results.opened.panel) fail(`the message panel did not open: ${JSON.stringify(results.opened)}`);
  if (results.opened.formId !== 9) fail(`opening the panel changed the form: ${results.opened.formId}`);

  // Row 2 (the second equipped form, 39) becomes the standing form.
  await key("down");
  results.moved = await snap();
  await key("circle");
  await waitPanelGone();
  results.confirmed = await snap();
  await shot("panel-confirmed");
  if (results.confirmed.panel) fail(`the panel did not close: ${JSON.stringify(results.confirmed)}`);
  if (results.confirmed.formId !== 39) fail(`the chosen equipped form did not become the standing form: ${results.confirmed.formId}`);

  // The cancel leg needs the original state back: relaunch (addInitScript
  // re-seeds localStorage), reach the grid again and open the panel on cell 0.
  await page.goto(`${ROOT}?skipTitle=1&map=s245&noEncounters=1&legacyDri=1`);
  await page.waitForFunction(() => window.__state?.started && window.__dri, null, { timeout: 40_000 });
  await page.waitForTimeout(300);
  await page.evaluate(() => window.__dri.openAction(1, window.__state, null));
  await page.waitForFunction(() => window.__dri.screen === "digivolve_picker", null, { timeout: 5_000 });
  await key("circle");
  await waitMenuOpen();
  await key("circle");
  await waitGridOpen();
  await key("circle");              // cell 0 = the form the partner stands as
  await waitPanelOpen();
  results.reopened = await snap();
  if (results.reopened.panel) {
    await key("cross");
    await waitPanelGone();
    results.cancelled = await snap();
    await shot("panel-cancelled");
    if (results.cancelled.panel) fail(`cancel did not close the panel: ${JSON.stringify(results.cancelled)}`);
    if (results.cancelled.formId !== 1) fail(`cancel did not clear the form to the rookie: ${results.cancelled.formId}`);
  } else {
    fail(`the panel did not reopen on the current form: ${JSON.stringify(results.reopened)}`);
  }
} catch (e) {
  await fail(e.message);
} finally {
  await browser.close();
}

const assert = (c, m) => { if (!c) { console.error(JSON.stringify(results, null, 2)); throw new Error(m); } };
try {
  assert(!failed, failed ?? "unknown failure");
  assert(results.errors.length === 0, `page errors: ${results.errors.join("; ")}`);
  assert(results.opened.panel, "panel did not open");
  assert(results.confirmed.formId === 39, "confirm did not set the standing form");
  assert(results.cancelled && results.cancelled.formId === 1, "cancel did not clear the form");
  console.log("RESULT", JSON.stringify({ ok: true, results }, null, 2));
} catch (e) {
  console.error("ASSERT FAILED:", e.message);
  process.exit(1);
}
