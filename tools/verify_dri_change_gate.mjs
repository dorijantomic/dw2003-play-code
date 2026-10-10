// tools/verify_dri_change_gate.mjs — the Lab's Change-digivolve-type gate.
//
// Original: F0x80087600 case 2 branches on enumerate_acquired's count
// (F0x80017898 walks the ledger records with form id >= 3). Cursor 0
// ("Change digivolve type.") opens the grid only when that count is >= 4
// (three equipped slots plus one to swap in); with fewer, state 0x1E writes
// string `cursor + 0x24` -- esdglabo 0x24 "Can't change digivolve." -- at
// (0xA4,0xB8) and the submenu stays up. Cursor 1 ("Load technique.") needs
// count >= 1 (esdglabo 0x25). This check drives the real game loop with real
// key events: the DRI entry is seeded (the pause-menu walk already has its own
// checks), then ordinary Cross presses exercise both counts.
//
// Run: .opencode/autonomy/check-browser tools/verify_dri_change_gate.mjs
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const ROOT = process.env.DRI_GATE_ROOT || `${baseUrl(8742)}/`;
const OUT = process.env.DRI_GATE_SHOT || ".dw3-research/autonomous-plan/shots/dri-change-gate";
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
    // Prerequisite: three acquired forms (Dinohumon + Taomon + Sakuyamon).
    formLedger: [
      { id: 9, formLevel: 99, dvexp: 0, techSlots: [0, 0, 0, 0, 0, 0] },
      { id: 27, formLevel: 99, dvexp: 0, techSlots: [0, 0, 0, 0, 0, 0] },
      { id: 39, formLevel: 99, dvexp: 0, techSlots: [0, 0, 0, 0, 0, 0] },
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
  cursor: window.__dri.cursor,
  feedback: window.__dri.feedback,
  gridFold: window.__dri.gridFold ? { active: window.__dri.gridFold.active } : null,
  forms: (window.__state.partnerStats.formLedger ?? []).map((r) => r.id),
}));
const shot = async (n) => writeFileSync(`${OUT}/${n}.png`,
  Buffer.from((await page.evaluate(() => document.querySelector("canvas#game").toDataURL("image/png"))).split(",")[1], "base64"));
// Real key events through the game's own keydown listener.
const key = async (k) => {
  await page.evaluate((kk) => window.dispatchEvent(new KeyboardEvent("keydown", { key: kk })), k);
  await page.evaluate((kk) => window.dispatchEvent(new KeyboardEvent("keyup", { key: kk })), k);
  await page.waitForTimeout(60);
};
// The digivolve Select Action submenu folds its windows open before it takes
// input (F0x8008820c); wait for them to land between presses.
const waitMenuOpen = () => page.waitForFunction(
  () => window.__dri.screen === "digivolve_menu"
    && (!window.__dri.folds || Object.values(window.__dri.folds).every((f) => !f.active)),
  null, { timeout: 5_000 });

const waitGridOpen = () => page.waitForFunction(
  () => window.__dri.screen === "change_type" && (!window.__dri.gridFold || !window.__dri.gridFold.active),
  null, { timeout: 5_000 });

const results = { errors };
try {
  await page.goto(`${ROOT}?skipTitle=1&map=s245&noEncounters=1&legacyDri=1`);
  await page.waitForFunction(() => window.__state?.started && window.__dri, null, { timeout: 40_000 });
  await page.waitForTimeout(400);

  // --- Three acquired forms: the Change-type row is refused in place.
  await page.evaluate(() => { window.__state.partnerStats.digimonId = 9; window.__dri.openAction(1, window.__state, null); });
  await page.waitForFunction(() => window.__dri.screen === "digivolve_picker", null, { timeout: 5_000 });
  results.picker = await snap();
  await key("c");                         // picker -> Select Action submenu
  await waitMenuOpen();
  results.menu = await snap();
  await key("c");                         // "Change digivolve type." with 3 forms
  results.refused = await snap();
  await shot("gate-refused");
  if (results.refused.screen !== "digivolve_menu") fail(`the grid opened on three forms: ${JSON.stringify(results.refused)}`);
  if (results.refused.feedback !== "Can't change digivolve.") fail(`wrong refusal line: ${JSON.stringify(results.refused)}`);
  // The message owns input until dismissed (the walker's feedback rule); once
  // Circle clears it the submenu still moves: Down reaches "Load technique.".
  await key("Enter");                     // circle dismisses the refusal line
  await key("ArrowDown");
  results.menuMoved = await snap();
  if (results.menuMoved.cursor !== 1) fail(`the menu stopped taking input after the refusal: ${JSON.stringify(results.menuMoved)}`);
  await key("ArrowUp");

  // --- A fourth acquired form is the prerequisite; the row now opens the grid.
  await page.evaluate(() => {
    window.__state.partnerStats.formLedger.push({ id: 41, formLevel: 99, dvexp: 0, techSlots: [0, 0, 0, 0, 0, 0] });
    window.__state.partnerStats.digimonId = 9;
    window.__dri.openAction(1, window.__state, null);
  });
  await page.waitForFunction(() => window.__dri.screen === "digivolve_picker", null, { timeout: 5_000 });
  await key("c");
  await waitMenuOpen();
  await key("c");
  await waitGridOpen();
  results.opened = await snap();
  await shot("gate-open");
  if (results.opened.screen !== "change_type") fail(`four forms did not open the grid: ${JSON.stringify(results.opened)}`);
  if (results.opened.gridFold?.active) fail(`the grid fold never landed: ${JSON.stringify(results.opened)}`);

  // Consumer: the grid writes an equipped slot through the real key path
  // (cell 0 is the form the partner stands as -> the message panel).
  await key("c");
  await page.waitForFunction(() => window.__dri.panel && (!window.__dri.panelFold || !window.__dri.panelFold.active),
    null, { timeout: 5_000 });
  results.panel = await page.evaluate(() => Boolean(window.__dri.panel));
} catch (e) {
  await fail(e.message);
} finally {
  await browser.close();
}

const assert = (c, m) => { if (!c) { console.error(JSON.stringify(results, null, 2)); throw new Error(m); } };
try {
  assert(!failed, failed ?? "unknown failure");
  assert(results.errors.length === 0, `page errors: ${results.errors.join("; ")}`);
  assert(results.refused.screen === "digivolve_menu", "three forms must be refused");
  assert(results.refused.feedback === "Can't change digivolve.", "the refusal line is the decoded string");
  assert(results.opened.screen === "change_type", "four forms must open the grid");
  assert(results.panel, "the opened grid must reach its panel consumer");
  console.log("RESULT", JSON.stringify({ ok: true, results }, null, 2));
} catch (e) {
  console.error("ASSERT FAILED:", e.message);
  process.exit(1);
}
