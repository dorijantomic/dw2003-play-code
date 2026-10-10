// Journey 6: a won card duel grants the opponent's booster pack, and the pack
// survives a reload.
//
// The real duel is opened through the game's own screen entry (challenge ->
// folder chooser -> duel). The win is then posed at the result window — the
// screen state the player dismisses after a set is decided — so the check
// exercises the screen's REAL reward branch (`grantPackForOpponent`) without
// playing a whole duel. The pack grant itself is never injected.
//
// Server: python3 -m http.server 8741 --directory web
// Run:    .opencode/autonomy/check-browser tools/verify_cardduel_reward.mjs
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const ROOT = process.env.CDR_ROOT || `${baseUrl(8741)}/`;
// The legacy duel: this check drives the old shell's own surface
// (__cardDuel.challenge / .chooser / .duel / .setEndState), which the native duel
// (the default since web/game.js:545) does not expose. Census:
// docs/research/card/CARD-DUEL-VERIFIED.md 34.
const BASE = ROOT + "?skipTitle=1&map=s210&noEncounters=1&legacyDuel=1";
const OUT = process.env.CDR_SHOT || "/tmp/cardduel-reward";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
const errors = [];
page.on("pageerror", (e) => { errors.push(e.message); console.error("PAGEERROR", e.message); });

const shot = async (n) => writeFileSync(`${OUT}/${n}.png`,
  Buffer.from((await page.locator("canvas#game").evaluate((el) => el.toDataURL("image/png"))).split(",")[1], "base64"));

const packs = (oppId) => page.evaluate(async (id) => {
  const cs = await import("./cardstate.js");
  await cs.loadOpponents();
  const opp = cs.opponentById(id);
  return {
    setId: opp?.packSetId ?? null,
    count: opp ? cs.cards().packs.get(opp.packSetId) ?? 0 : null,
    held: cs.cards().packs.size,
    stored: !!localStorage.getItem("cardCollection"),
  };
}, oppId);

let failed = null;
const fail = (m) => { failed = m; console.error("FAIL:", m); };

try {
  await page.goto(BASE);
  await page.waitForFunction(() => window.__state?.started, null, { timeout: 15_000 });
  await page.waitForTimeout(600);

  // Pick a real opponent that carries a booster-pack set, once the table loads.
  await page.waitForFunction(async () => {
    const cs = await import("./cardstate.js");
    return (cs.opponents()?.opponents ?? []).some((o) => typeof o.packSetId === "number");
  }, null, { timeout: 10_000 });
  const oppId = await page.evaluate(async () => {
    const cs = await import("./cardstate.js");
    await cs.loadOpponents();
    const opp = (cs.opponents()?.opponents ?? []).find((o) => typeof o.packSetId === "number");
    return opp.id;
  });
  const before = await packs(oppId);
  if (typeof before.setId !== "number") throw new Error(`opponent ${oppId} has no packSetId`);
  if (before.count !== 0) await fail(`fixture already holds the pack: ${JSON.stringify(before)}`);

  // Open the real duel: challenge -> chooser -> duel, ordinary keys.
  await page.evaluate((id) => {
    const c = window.__cardDuel;
    c.open(null, "Opponent", null, id);
  }, oppId);
  await page.waitForFunction(() => window.__cardDuel?.challenge === true, null, { timeout: 10_000 });
  await shot("duel-challenge");
  await page.keyboard.press("Enter"); // confirm the challenge -> folder chooser
  await page.waitForFunction(() => window.__cardDuel?.chooser != null, null, { timeout: 10_000 });
  await page.waitForTimeout(1200);      // the plates settle and input opens
  await page.keyboard.press("Enter");   // pick folder 0 -> begin the duel
  await page.waitForFunction(() => !!window.__cardDuel?.duel, null, { timeout: 15_000 });
  await page.waitForTimeout(400);
  await shot("duel-open");
  const opened = await page.evaluate(() => ({
    opponent: window.__cardDuel.duel?.opponent?.name ?? null,
    outcome: window.__cardDuel.duel?.outcome ?? null,
  }));
  if (opened.outcome) throw new Error(`fresh duel already ended: ${JSON.stringify(opened)}`);

  // Pose the set-result window with a won duel, then dismiss it with the real
  // button path. This is the screen's own reward branch.
  //
  // The pose has to be the WHOLE window, not just its name. The grant sits in
  // the DUEL-OVER TEST — the second window of the set award, web/cardduel.js:1908
  // — and that arm only runs when a set counter has reached SETS_TO_WIN and the
  // window's own `winner` says YOU took the set (`:1909`, `:1916`). A bare
  // `{ step: "result" }` carries neither, so the window walked straight past the
  // grant and the check reported a missing pack for a state the screen can
  // never be in. Two is SETS_TO_WIN (engine/systems/card-battle.ts:202); the
  // same ceremony builds this window in openSetEndIfScored (web/cardduel.js:1759),
  // which is where the `winner` and the `from` pair below come from.
  await page.evaluate(async () => {
    const c = window.__cardDuel;
    const setsToWin = 2;
    c.duel.player.score = setsToWin;
    c.duel.outcome = "win";
    c.setEnd = { step: "result", t: 0, winner: 0, draw: false, from: [setsToWin - 1, 0] };
  });
  // Announcements/waiting beats own the pad ahead of the result window, so keep
  // confirming until the real dismiss branch runs and the window is gone.
  let posed = null;
  for (let i = 0; i < 25; i++) {
    posed = await page.evaluate(() => {
      const c = window.__cardDuel;
      c.handleKey("circle");
      return { setEnd: c.setEndState(), outcome: c.duel?.outcome ?? null };
    });
    if (!posed.setEnd) break;
    await page.waitForTimeout(150);
  }
  await page.waitForTimeout(300);
  await shot("duel-after-win");
  if (posed?.setEnd) console.log("note: setEnd still up after dismiss", JSON.stringify(posed.setEnd));

  const after = await packs(oppId);
  if (after.count !== before.count + 1)
    await fail(`win did not grant the pack: ${JSON.stringify({ before, after })}`);
  if (!after.stored) await fail("the granted pack was not written to the card save key");

  // The pack is held stock the card shop's OPEN list reads; a reload keeps it.
  await page.reload();
  await page.waitForFunction(() => window.__state?.started, null, { timeout: 15_000 });
  await page.waitForTimeout(600);
  const reloaded = await packs(oppId);
  await shot("duel-after-reload");
  if (reloaded.count !== after.count)
    await fail(`pack did not survive reload: ${JSON.stringify({ after, reloaded })}`);

  if (errors.length) await fail(`${errors.length} page error(s)`);
  console.log("RESULT", JSON.stringify({ ok: !failed, opened, before, after, reloaded }));
} catch (e) {
  await fail(e.message);
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
