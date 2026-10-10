// tools/verify_tag_cancels_blast.mjs — Tagging while Blast is active forfeits
// the charge: the Blast drops AND the DV/Blast gauge is zeroed.
//
// Authority: the shared Tag cleanup F0x800a7328 (wfightmn) tests the
// combatant's Blast flag +0x1a and, when set, zeroes the DV gauge at +0x58 and
// clears the flag (evidence EV-tag-commit-cancels-blast-static-2026-08-04,
// claim tag-commit-cancels-blast-no-suppression-branch). BLAST-C002 records the
// same cleanup. The check drives the real battle: trigger the production Blast,
// then Tag with ordinary keys and read the gauge/flag. The Tag chain the player
// walks is the original's four screens — command list, partner list, species
// strip, then the Switch / DNA DV row list — so the check answers all four and
// reads each screen's live row off that screen's own diagnostics.
//
// Run: .opencode/autonomy/check-browser tools/verify_tag_cancels_blast.mjs
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";
import { waitForCommandMenu } from "./verify-battle-wait.mjs";

const ROOT = process.env.TAGBLAST_ROOT || `${baseUrl(8742)}/`;
const OUT = process.env.TAGBLAST_SHOT || ".dw3-research/autonomous-plan/shots/tag-cancels-blast";
mkdirSync(OUT, { recursive: true });

const member = (digimonId, level) => ({
  digimonId, level, xp: 0, tp: 10, hp: 400, maxHp: 400, mp: 120, maxMp: 120, dvGauge: 0,
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
  localStorage.setItem("digivolveDemo", "0");
  localStorage.setItem("playerName", "Junior");
  localStorage.setItem("charId", "p003pken");
  localStorage.setItem("party", JSON.stringify(["p003pken", "p009rena", "p010pata"]));
  localStorage.setItem("partnerStats", JSON.stringify(seed.lead));
  localStorage.setItem("partyStats", JSON.stringify([seed.lead, seed.rena, seed.pata]));
  localStorage.setItem("equipment", JSON.stringify([{}, {}, {}]));
  localStorage.setItem("bits", "1000");
  localStorage.setItem("inventory", "[]");
}, { lead: member(1, 10), rena: member(7, 10), pata: member(8, 10) });

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
  return {
    gauge: Math.round(b.player.gauge ?? 0),
    blast: b.blast ? { active: !!b.blast.active } : null,
    active: b.activePlayerIndex,
    stored: JSON.parse(localStorage.getItem("partnerStats") ?? "{}").dvGauge,
    pips: window.__battle.debugPips(),
  };
});
// The command list is the translated pro/fightstg screen. It starts reading the
// pad only once its own session is built, so a press sent earlier is discarded;
// `selection` is its live highlight and `row` only the row it opened on.
const commandRow = () => page.evaluate(() =>
  window.__battleCmdNative?.diagnostics?.().selection ?? null);
const commandReady = () => page.waitForFunction(() =>
  window.__battleCmdNative?.diagnostics?.().ready === true, null, { timeout: 30_000 });
/** Press Down until the command list's own highlight sits on `row`. */
const armRow = async (row) => {
  for (let i = 0; i < 8 && (await commandRow()) !== row; i++) {
    await tap("ArrowDown");
    await page.waitForTimeout(140);
  }
  return (await commandRow()) === row;
};
/** Press Circle until `test()` reads true, so no press is lost to a slow screen. */

try {
  await page.goto(`${ROOT}?skipTitle=1&map=s245&noEncounters=1`);
  await page.waitForFunction(() => window.__state?.started, null, { timeout: 40_000 });
  await page.waitForTimeout(500);
  await page.evaluate(async () => {
    await window.__battle.start({
      enemyId: 1, enemyLevel: 1, onWin: () => {}, onFlee: () => {}, onLose: () => {},
    });
  });
  // The opening line ("Ambush!") holds the battle controller until it is read: the original
  // arms the command menu only from the script instruction that first reads the line's own
  // slot and returns while it is occupied (`wfightmn.s:1494-1496`), so no command list exists
  // until the player has read the line. `waitForCommandMenu` is that one press, shared with
  // every other battle check (tools/verify-battle-wait.mjs); it also carries the boot-loader
  // wait and the list's own readiness that were spelled out here by hand.
  await waitForCommandMenu(page);
  await commandReady();
  await page.evaluate(() => { const b = window.__battleB(); b.enemy.hp = 99999; b.enemy.maxHp = 99999; });

  // Full gauge, then the production Blast.
  await page.evaluate(() => { window.__battleB().player.gauge = 999; });
  const armed = await page.evaluate(() => window.__battleBlast());
  if (!armed) fail("window.__battleBlast() found no Blast target");
  await page.waitForFunction(() => !!window.__battleB?.()?.blast?.active, null, { timeout: 5000 });
  // The transformation is a cinematic with no input: it runs to its end.
  await page.waitForFunction(() => window.__battleB?.()?.blast?.active && !window.__battleB?.()?.blastShow,
    null, { timeout: 15_000 });
  await page.waitForFunction(() => window.__battleB?.()?.state === 2, null, { timeout: 8000 });
  await commandReady();
  await page.waitForTimeout(300);
  const before = await read();
  await shot("blast-active");
  if (!before.blast?.active) fail(`Blast not active before Tag: ${JSON.stringify(before)}`);
  if (before.gauge !== 999) fail(`gauge before Tag: ${before.gauge}`);

  // Ordinary keys: command row 3 = Tag -> partner list -> the pane, whose first
  // sub-state is the species strip and whose second is the Switch / DNA DV row
  // list, which the original puts up even with no DNA pairing, where it carries
  // the single "Switch" row (fightstg.s:22170 reads self+0x7C and :22168 puts one
  // row into list+0x20). There is no form screen between the list and the pane
  // (playtest bug 12b). Circle confirms the species first and the row second, so
  // the chain needs three presses.
  if (!await armRow(3)) fail(`the Tag row was not armed (row ${await commandRow()})`);
  await tap("Enter");
  await page.waitForFunction(() => window.__battleB?.()?.state === 11, null, { timeout: 8000 })
    .catch(() => {});
  await page.waitForFunction(() => window.__battleTagNative?.diagnostics?.().ready === true,
    null, { timeout: 20_000 }).catch(() => {});
  await tap("Enter");
  await page.waitForFunction(() => window.__battleB?.()?.state === 15, null, { timeout: 8000 })
    .catch(() => {});
  await page.waitForFunction(() => window.__battleDnaNative?.diagnostics?.().pane?.ready === true,
    null, { timeout: 20_000 }).catch(() => {});
  await tap("Enter");   // the species strip -> the row list
  await page.waitForFunction(() => window.__battleDnaNative?.diagnostics?.().pane?.subState === 1,
    null, { timeout: 8000 }).catch(() => {});
  await tap("Enter");   // the "Switch" row -> the tag is queued for this turn
  await page.waitForFunction(() => window.__battleB?.()?.state === 5, null, { timeout: 8000 })
    .catch(() => {});
  // "Switch!" goes up on the message line, which holds the turn until Circle the
  // way the original's own sequencer does (msgHoldsTurn, web/battle.js:2615).
  // Wait for the line to be up: the latch a press sets is dropped on the next
  // frame while no line is waiting, so a press sent early is lost.
  await page.waitForFunction(() => window.__battle?.peek?.()?.messageLine?.holdsTurn === true,
    null, { timeout: 8000 }).catch(() => {});
  await tap("Enter");
  await page.waitForFunction(() => window.__battleB?.()?.activePlayerIndex === 1, null, { timeout: 12_000 })
    .catch(() => {});
  await page.waitForTimeout(400);
  const after = await read();
  await shot("tagged-gauge-zeroed");

  if (after.blast !== null) fail(`the Blast flag survived the Tag: ${JSON.stringify(after.blast)}`);
  if (after.gauge !== 0) fail(`the gauge was not zeroed by the Tag cleanup: ${after.gauge}`);
  if (after.active !== 1) fail(`the Tag did not commit: active ${after.active}`);
  if (after.stored !== 0) fail(`localStorage dvGauge: ${after.stored}`);

  if (errors.length) await fail(`${errors.length} page error(s)`);
  console.log("RESULT", JSON.stringify({
    ok: !failed, before: { gauge: before.gauge, blast: before.blast }, after,
  }));
} catch (e) {
  await fail(e.message);
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
