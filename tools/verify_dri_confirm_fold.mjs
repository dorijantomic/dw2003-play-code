// tools/verify_dri_confirm_fold.mjs — the Switch confirm panel's fold.
//
// Original: the five fold panes of F0x8008c060 open before the reserve list
// reads the pad (cases 1-3), and on confirm/cancel the panel folds shut BEFORE
// the party write in case 8 (F0x8008b798). This check drives the real desk:
// confirm must leave the party untouched while the panel is still up, and land
// the swap only when the shut folds finish; cancel folds it away with no write.
//
// Run: .opencode/autonomy/check-browser tools/verify_dri_confirm_fold.mjs
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const ROOT = process.env.DRI_FOLD_ROOT || `${baseUrl(8742)}/`;
const OUT = process.env.DRI_FOLD_SHOT || ".dw3-research/autonomous-plan/shots/dri-confirm-fold";
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
  localStorage.setItem("party", JSON.stringify(["p003pken", "p010pata"]));
  const m = (id, lvl) => ({ digimonId: id, level: lvl, xp: 0, hp: 300, maxHp: 300, mp: 100, maxMp: 100, stats: { str: 50, def: 40, spt: 40, wis: 40, spd: 40, chr: 30 }, bonuses: {}, elemBonuses: {} });
  localStorage.setItem("partnerStats", JSON.stringify(m(1, 10)));
  localStorage.setItem("partyStats", JSON.stringify([m(1, 10), m(8, 10)]));
  localStorage.setItem("equipment", JSON.stringify([{}, {}]));
  localStorage.setItem("reserveStats", JSON.stringify({ p009rena: m(7, 17) }));
  localStorage.setItem("rosterOwned", "193");   // slots 0, 6, 7
});

let failed = null;
const fail = (m) => { failed = m; console.error("FAIL:", m); };
const snap = () => page.evaluate(() => ({
  party: [...(window.__state.party ?? [])],
  screen: window.__dri.screen,
  cursor: window.__dri.cursor,
  leave: window.__dri._switchLeave ? window.__dri._switchLeave.kind : null,
  foldsActive: Object.values(window.__dri.folds ?? {}).filter((f) => f.active).length,
  feedback: window.__dri.feedback,
}));
const shot = async (n) => writeFileSync(`${OUT}/${n}.png`,
  Buffer.from((await page.evaluate(() => document.querySelector("canvas#game").toDataURL("image/png"))).split(",")[1], "base64"));
// Logical button NAMES, not keys: web/dri.js confirms on word bit 0x2000 ("circle")
// and cancels on 0x4000 ("cross") since 173ebcf0; the Details toggle is 0x1000
// ("triangle").
const key = (k) => page.evaluate((kk) => window.__dri.handleKey(kk), k);
const waitFoldsOpen = () => page.waitForFunction(
  () => window.__dri.folds && Object.values(window.__dri.folds).every((f) => !f.active),
  null, { timeout: 5_000 });
const waitSwitchFrom = () => page.waitForFunction(
  () => window.__dri.screen === "switch_from", null, { timeout: 5_000 });

const results = { errors };
try {
  await page.goto(`${ROOT}?skipTitle=1&map=s245&noEncounters=1&legacyDri=1`);
  await page.waitForFunction(() => window.__state?.started && window.__dri, null, { timeout: 40_000 });
  await page.waitForTimeout(400);
  await page.evaluate(() => window.__dri.openAction(0, window.__state, null));
  await page.waitForFunction(() => window.__dri.screen === "switch_from", null, { timeout: 5_000 });

  // A. Open the reserve panel: the folds run before the list takes input.
  await key("circle");
  await page.waitForTimeout(60);
  results.opening = await snap();
  await shot("fold-open");
  await waitFoldsOpen();
  results.opened = await snap();
  if (results.opening.foldsActive < 1) fail("no fold was running when the panel opened");

  // B. Confirm: the swap must wait for the shut folds.
  const before = results.opened.party;
  await key("circle");
  results.confirmInstant = await snap();
  if (JSON.stringify(results.confirmInstant.party) !== JSON.stringify(before)) {
    fail(`the swap landed while the panel was still up: ${JSON.stringify(results.confirmInstant)}`);
  }
  await waitSwitchFrom();
  results.confirmed = await snap();
  await shot("fold-confirmed");
  if (results.confirmed.party[0] === before[0]) {
    fail(`the swap never landed: ${JSON.stringify(results.confirmed)}`);
  }

  // C. Cancel: folds away with no write.
  await key("triangle");              // dismiss the "joined" feedback line
  await key("circle");                // reopen the reserve panel
  await waitFoldsOpen();
  const beforeCancel = (await snap()).party;
  await key("cross");                 // cancel: word bit 0x4000
  results.cancelInstant = await snap();
  if (JSON.stringify(results.cancelInstant.party) !== JSON.stringify(beforeCancel)) {
    fail(`cancel wrote the party: ${JSON.stringify(results.cancelInstant)}`);
  }
  await waitSwitchFrom();
  results.cancelled = await snap();
  if (JSON.stringify(results.cancelled.party) !== JSON.stringify(beforeCancel)) {
    fail(`cancel changed the party: ${JSON.stringify(results.cancelled)}`);
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
  assert(results.confirmed.party.length === results.opened.party.length, "party length changed");
  assert(results.confirmed.party[0] !== results.opened.party[0], "party did not switch");
  console.log("RESULT", JSON.stringify({ ok: true, results }, null, 2));
} catch (e) {
  console.error("ASSERT FAILED:", e.message);
  process.exit(1);
}
