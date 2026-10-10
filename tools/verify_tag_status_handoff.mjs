// tools/verify_tag_status_handoff.mjs — Tagging keeps each member's own status:
// the ailment stays on the outgoing record and the incoming partner starts clean.
//
// Authority: web/battle.js applyTagAction (the native Tag swaps the live player
// pointer to the incoming resident record and rewrites only its form id — the
// stat body and its status belong to that member; web/battle.js builds ailments
// per record at setup). FIGHTSTG_F0x800934f0 for the pip, which shows each
// member's own state.
//
// The poison is a seeded prerequisite on the outgoing member; the assertions are
// where it ends up and which pip pictures the HUD draws.
//
// Run: .opencode/autonomy/check-browser tools/verify_tag_status_handoff.mjs
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";
import { waitForCommandMenu } from "./verify-battle-wait.mjs";

const ROOT = process.env.TAG_ROOT || `${baseUrl(8742)}/`;
const OUT = process.env.TAG_SHOT || ".dw3-research/autonomous-plan/shots/tag-status-handoff";
mkdirSync(OUT, { recursive: true });

const member = (digimonId, level, hp, mp) => ({
  digimonId, level, xp: 0, tp: 10, hp, mp, maxHp: 400, maxMp: 120,
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
  localStorage.setItem("playerName", "Junior");
  localStorage.setItem("charId", "p003pken");
  localStorage.setItem("party", JSON.stringify(["p003pken", "p009rena", "p010pata"]));
  localStorage.setItem("partnerStats", JSON.stringify(seed.lead));
  localStorage.setItem("partyStats", JSON.stringify([seed.lead, seed.rena, seed.pata]));
  localStorage.setItem("equipment", JSON.stringify([{}, {}, {}]));
  localStorage.setItem("bits", "1000");
  localStorage.setItem("inventory", "[]");
}, { lead: member(1, 10, 400, 120), rena: member(7, 10, 400, 50), pata: member(8, 10, 400, 50) });

let failed = null;
const fail = (m) => { failed = m; console.error("FAIL:", m); };
const eq = (what, got, want) => {
  if (JSON.stringify(got) !== JSON.stringify(want))
    fail(`${what}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
};
// A real key press, held for a few frames: the shape the other battle checks use
// (tools/verify_battle_taglist.mjs). The old two KeyboardEvents inside one
// evaluate are one tick, which no player can produce, so the presses are timed
// like a player's now.
const tap = async (k, ms = 90) => {
  await page.keyboard.down(k);
  await page.waitForTimeout(ms);
  await page.keyboard.up(k);
  await page.waitForTimeout(60);
};
const shot = async (n) => writeFileSync(`${OUT}/${n}.png`,
  Buffer.from((await page.locator("canvas#game").evaluate((el) => el.toDataURL("image/png"))).split(",")[1],
    "base64"));
const read = () => page.evaluate(() => {
  const b = window.__battleB();
  return {
    pips: window.__battle.debugPips(),
    active: b.activePlayerIndex,
    records: b.playerRecords.map((r) => ({ hp: r.hp, ail: Object.keys(r.ailments || {}) })),
    message: b.message,
  };
});
// The command list is the translated pro/fightstg screen. It starts reading the
// pad only once its own session is built, so a press sent earlier is discarded;
// `selection` is its live highlight. Copied from tools/verify_tag_cancels_blast.mjs,
// which drives the same Tag chain.
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

try {
  await page.goto(`${ROOT}?skipTitle=1&map=s245&noEncounters=1`);
  await page.waitForFunction(() => window.__state?.started, null, { timeout: 40_000 });
  await page.waitForTimeout(500);
  await page.evaluate(async () => {
    await window.__battle.start({
      enemyId: 1, enemyLevel: 1, onWin: () => {}, onFlee: () => {}, onLose: () => {},
    });
  });
  await waitForCommandMenu(page);
  await page.evaluate(() => { const b = window.__battleB(); b.enemy.hp = 99999; b.enemy.maxHp = 99999; });

  // Seeded prerequisite: the ACTIVE member is poisoned and hurt.
  await page.evaluate(() => {
    const b = window.__battleB();
    b.playerRecords[0].hp = 300;
    b.playerRecords[0].ailments.poison = { power: 4, tickTime: 9000 };
  });
  const before = await read();
  eq("before: outgoing poisoned active pip", before.pips.player, [15, 60, 60]);
  eq("before: outgoing is active", before.active, 0);
  await shot("tag-before");

  // Ordinary keys: the command list's row 3 = Tag, then the partner list, the
  // species strip, the "Switch" / DNA DV row list, and the message line that
  // holds the turn until it is answered. Every one of those screens reads the pad
  // only once its own session is up, so each press waits for that screen
  // instead of guessing a delay. This is the same chain
  // tools/verify_tag_cancels_blast.mjs walks to the same commit.
  await page.waitForFunction(() => window.__battleWfightmn?.diagnostics?.().open === false,
    null, { timeout: 30_000 });
  await commandReady();
  if (!await armRow(3)) fail(`the Tag row was not armed (row ${await commandRow()})`);
  await tap("Enter");                  // open the Tag partner list
  await page.waitForFunction(() => window.__battleB?.()?.state === 11, null, { timeout: 8000 });
  await page.waitForFunction(() => window.__battleTagNative?.diagnostics?.().ready === true,
    null, { timeout: 20_000 });
  await tap("Enter");                  // choose the first candidate (party position 1)
  // No form screen: the confirm opens the pane directly (playtest bug 12b), whose
  // first sub-state is the species strip.
  await page.waitForFunction(() => window.__battleB?.()?.state === 15, null, { timeout: 8000 });
  await page.waitForFunction(() => window.__battleDnaNative?.diagnostics?.().pane?.ready === true,
    null, { timeout: 20_000 });
  await shot("tag-pane-species");
  // The original always follows the species strip with the row list, and with no
  // DNA pairing it is the one row "Switch" (fightstg.s:22170 reads self+0x7C and
  // :22168 puts one row into list+0x20). The Tag is queued by the confirm on THAT
  // row, not on the strip's, so the player presses Circle twice more.
  await tap("Enter");                  // the species strip -> the row list
  await page.waitForFunction(() => window.__battleDnaNative?.diagnostics?.().pane?.subState === 1,
    null, { timeout: 8000 });
  await shot("tag-switch-row");
  await tap("Enter");                  // the "Switch" row -> the Tag is queued
  // "Switch!" goes up on the message line, which holds the turn until Circle the
  // way the original's own sequencer does (msgHoldsTurn, web/battle.js:2815), so
  // without this press the fight sits in its own action state for ever.
  await page.waitForFunction(() => window.__battle?.peek?.()?.messageLine?.holdsTurn === true,
    null, { timeout: 20_000 });
  await tap("Enter");                  // answer the line -> the Tag commits

  await page.waitForFunction(() => window.__battleB?.()?.activePlayerIndex === 1, null, { timeout: 15_000 });
  await page.waitForTimeout(400);
  const after = await read();
  await shot("tag-after");

  eq("after: the incoming partner is active", after.active, 1);
  eq("after: the incoming partner starts clean", after.records[1].ail, []);
  eq("after: the incoming partner keeps its own HP", after.records[1].hp, 400);
  eq("after: the outgoing member keeps its poison", after.records[0].ail, ["poison"]);
  eq("after: the outgoing member keeps its HP", after.records[0].hp, 300);
  // Pips: slot 0 inactive+poison (0x3F=63), slot 1 active+full (0xC=12), slot 2 inactive+full (0x3C=60).
  eq("after: pips show each member's own state", after.pips.player, [63, 12, 60]);

  if (errors.length) await fail(`${errors.length} page error(s)`);
  console.log("RESULT", JSON.stringify({
    ok: !failed, before: { active: before.active, pips: before.pips.player, records: before.records },
    after: { active: after.active, pips: after.pips.player, records: after.records },
  }));
} catch (e) {
  await fail(e.message);
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
