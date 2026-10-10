// tools/verify_dri_load_prompt.mjs — the Load-technique Yes/No prompt.
//
// Original (technique-loading-decoded.md §"The DRI chooser", TL-005..TL-007):
// confirming a row raises "Load?" (unloaded) or "Turn load off?" (loaded); Yes
// clears/sets the 0x4000 bit and writes the 0x14-byte ledger entry, No leaves
// the bits alone. The walker already ships the prompt (tests/dri-lab.test.js),
// but its live check only covered "Load?" + Yes. This drives the real chooser
// through all four arms: Load?-No, Load?-Yes, Turn load off?-No, and
// Turn load off?-Yes.
//
// Run: .opencode/autonomy/check-browser tools/verify_dri_load_prompt.mjs
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const ROOT = process.env.DRI_PROMPT_ROOT || `${baseUrl(8742)}/`;
const OUT = process.env.DRI_PROMPT_SHOT || ".dw3-research/autonomous-plan/shots/dri-load-prompt";
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
    equippedForms: [9, 27, 39],
    formLedger: [
      // 0x2069 = loadable (0x2000), not loaded; 0x6069 = the same word plus the loaded bit 0x4000.
      { id: 9, formLevel: 99, dvexp: 0, techSlots: [0x2069, 0, 0, 0, 0, 0x6069] },
      { id: 27, formLevel: 99, dvexp: 0, techSlots: [0, 0, 0, 0, 0, 0] },
      { id: 39, formLevel: 99, dvexp: 0, techSlots: [0, 0, 0, 0, 0, 0] },
    ],
  };
  localStorage.setItem("partnerStats", JSON.stringify(lead));
  localStorage.setItem("partyStats", JSON.stringify([lead]));
  localStorage.setItem("equipment", JSON.stringify([{}]));
  localStorage.setItem("rosterOwned", "1");
});

let failed = null;
const fail = (m) => { failed = m; console.error("FAIL:", m); };
const words = () => page.evaluate(() =>
  (window.__state.partnerStats.formLedger.find((r) => r.id === 9)?.techSlots ?? []).map(Number));
const snap = () => page.evaluate(() => ({
  screen: window.__dri.screen,
  cursor: window.__dri.cursor,
  prompt: window.__dri.prompt ? { message: window.__dri.prompt.message, yes: window.__dri.prompt.yes } : null,
}));
const shot = async (n) => writeFileSync(`${OUT}/${n}.png`,
  Buffer.from((await page.evaluate(() => document.querySelector("canvas#game").toDataURL("image/png"))).split(",")[1], "base64"));
// Logical button NAMES, not keys: web/dri.js confirms on word bit 0x2000 ("circle")
// and cancels on 0x4000 ("cross") since 173ebcf0; the Details toggle is 0x1000
// ("triangle").
const key = (k) => page.evaluate((kk) => window.__dri.handleKey(kk), k);
// The digivolve Select Action submenu folds its windows open before it takes
// input (F0x8008820c); wait for them to land between presses.
const waitMenuOpen = () => page.waitForFunction(
  () => window.__dri.screen === "digivolve_menu"
    && (!window.__dri.folds || Object.values(window.__dri.folds).every((f) => !f.active)),
  null, { timeout: 5_000 });

const openChooser = async () => {
  await page.evaluate(() => window.__dri.openAction(1, window.__state, null));
  await page.waitForFunction(() => window.__dri.screen === "digivolve_picker", null, { timeout: 5_000 });
  await key("circle");            // picker -> Select Action
  await waitMenuOpen();          // the submenu windows fold open
  await key("arrowdown");        // "Load technique."
  await key("circle");            // -> the chooser
  await page.waitForFunction(() => window.__dri.screen === "load_tech", null, { timeout: 5_000 });
};
// Set the prompt's answer explicitly, then confirm.
const answer = async (yes) => {
  if ((await snap()).prompt?.yes !== yes) await key("arrowleft");   // toggles yes/no
  await key("circle");
};

const results = { errors };
try {
  await page.goto(`${ROOT}?skipTitle=1&map=s245&noEncounters=1&legacyDri=1`);
  await page.waitForFunction(() => window.__state?.started && window.__dri, null, { timeout: 40_000 });
  await page.waitForTimeout(400);
  results.start = await words();
  if ((results.start[0] & 0x4000) !== 0) fail(`fixture slot 0 is already loaded: ${results.start}`);

  await openChooser();
  results.chooser = await snap();

  // Row 0 (0x2069, unloaded) -> "Load?" and No leaves the bit alone.
  await key("circle");
  results.loadPrompt = await snap();
  if (results.loadPrompt.prompt?.message !== "Load?") fail(`row 0 prompt: ${JSON.stringify(results.loadPrompt)}`);
  await shot("load-prompt");
  await answer(false);
  results.afterNo = await words();
  if ((results.afterNo[0] & 0x4000) !== 0) fail(`No set the bit: ${results.afterNo}`);

  // Yes loads it.
  await key("circle");
  await answer(true);
  results.afterYes = await words();
  if ((results.afterYes[0] & 0x4000) === 0) fail(`Yes did not load: ${results.afterYes}`);

  // The same row now offers "Turn load off?"; No keeps it loaded.
  await key("circle");
  results.offPrompt = await snap();
  if (results.offPrompt.prompt?.message !== "Turn load off?") fail(`loaded-row prompt: ${JSON.stringify(results.offPrompt)}`);
  await shot("turn-load-off-prompt");
  await answer(false);
  results.afterOffNo = await words();
  if ((results.afterOffNo[0] & 0x4000) === 0) fail(`Turn-load-off No cleared the bit: ${results.afterOffNo}`);

  // Yes unloads it.
  await key("circle");
  await answer(true);
  results.afterOffYes = await words();
  if ((results.afterOffYes[0] & 0x4000) !== 0) fail(`Turn-load-off Yes kept the bit: ${results.afterOffYes}`);

  // The loaded row 5 is the other order: "Turn load off?" must be offered there too.
  await key("arrowdown");
  await key("arrowdown");
  await key("arrowdown");
  await key("arrowdown");
  await key("arrowdown");
  results.row5 = await snap();
  await key("circle");
  results.row5Prompt = await snap();
  if (results.row5Prompt.prompt?.message !== "Turn load off?") fail(`row 5 prompt: ${JSON.stringify(results.row5Prompt)}`);
  await answer(true);
  results.row5After = await words();
  if ((results.row5After[5] & 0x4000) !== 0) fail(`row 5 unload failed: ${results.row5After}`);
} catch (e) {
  await fail(e.message);
} finally {
  await browser.close();
}

const assert = (c, m) => { if (!c) { console.error(JSON.stringify(results, null, 2)); throw new Error(m); } };
try {
  assert(!failed, failed ?? "unknown failure");
  assert(results.errors.length === 0, `page errors: ${results.errors.join("; ")}`);
  assert(results.loadPrompt.prompt?.message === "Load?", "no Load? prompt");
  assert(results.offPrompt.prompt?.message === "Turn load off?", "no Turn load off? prompt");
  console.log("RESULT", JSON.stringify({ ok: true, results }, null, 2));
} catch (e) {
  console.error("ASSERT FAILED:", e.message);
  process.exit(1);
}
