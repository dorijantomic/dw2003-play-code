// The first s480 Jungle Grave Zanbamon fight is a scripted, UNWINNABLE battle, and the
// original ends it as a FORCED flee: after Zanbamon's Cross Slash lands, the game puts up
// esmfight[0x48] "Running away!" and commits the battle result to a flee (result byte 0),
// which returns the player to the FIELD. The flee is not the player's Run command.
//
// Mechanism (disc): the battle header's result-event queue slot 35 (battle result-header
// +0x5B, 0x800A444F) is set ONLY by a technique record whose +0x0A byte is 35 -- and only
// Cross Slash (technique 393, Zanbamon's own attack) carries it. The drain F0x80091534
// dispatches slot 35 to F0x80091a8c, which writes message 0x48 and calls the result writer
// F0x8009c534 with 0. Returning to the field runs the stage arrival chain, which is where
// event 171 (the gloat + HANDOFF to s450) and master ordinal 8 live.
//
//   AFTER  (as shipped): Zanbamon's landed Cross Slash forces the flee -> "Running away!"
//                        -> the field arrival chain -> event 171 -> master ordinal 8, s450.
//   BEFORE (emulated):   the same fight with the forced-flee wiring removed -- the hit
//                        lands but the turn loop just continues (no flee from the hit).
//
// Server: python3 -m http.server $VERIFY_PORT --directory web
// Run:    VERIFY_PORT=$VERIFY_PORT tools/run-playwright.sh tools/verify_zanbamon_forced_flee.mjs
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";
import { tapCircle } from "./verify-battle-wait.mjs";

const PORT = Number(process.env.VERIFY_PORT || 8788);
const ROOT = process.env.ZFF_ROOT || `${baseUrl(PORT)}/`;
const OUT = process.env.ZFF_SHOT || ".dw3-research/zanbamon-forced-flee-2026-10-09/shots";
mkdirSync(OUT, { recursive: true });

const SCREEN = 11;   // s480 scripted block record 0 = Jungle Grave / Zanbamon

const member = (over = {}) => ({
  digimonId: 3, level: 20, xp: 0, tp: 20, hp: 600, maxHp: 600, mp: 100, maxMp: 100,
  stats: { str: 120, def: 90, spt: 60, wis: 60, spd: 90, chr: 40 }, bonuses: {}, elemBonuses: {},
  ...over,
});

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
const errors = [];
page.on("pageerror", (e) => { errors.push(e.message); console.error("PAGEERROR", e.message); });

await page.addInitScript((seed) => {
  localStorage.setItem("assetMode", "authentic");
  localStorage.setItem("engineSchema", "2");
  localStorage.setItem("playerName", "Junior");
  localStorage.setItem("progressOrdinal", "7");   // the s480 beat: event 170's gate (0x6007 == 1)
  localStorage.setItem("charId", "p005koet");
  localStorage.setItem("party", JSON.stringify(["p005koet", "p006agum", "p009rena"]));
  localStorage.setItem("packId", "B");
  localStorage.setItem("bits", "1000");
  localStorage.setItem("inventory", "[]");
  localStorage.setItem("partnerStats", JSON.stringify(seed.lead));
  localStorage.setItem("partyStats", JSON.stringify([seed.lead, seed.lead, seed.lead]));
  localStorage.setItem("equipment", JSON.stringify([{}, {}, {}]));
}, { lead: member() });

const shot = async (n) => writeFileSync(`${OUT}/${n}.png`, await page.screenshot());

let failed = null;
const check = (name, ok, detail) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (!ok && !failed) failed = name + (detail ? ` (${detail})` : "");
};
const snap = () => page.evaluate(() => ({
  map: window.__mapInfo?.().id ?? null,
  ordinal: window.__state?.progressOrdinal ?? null,
  battle: !!window.__battle?.isActive?.(),
}));

/** Read every cutscene line the game puts up until `stop` says the beat is over. */
async function advanceUntil(stop, budgetMs = 25_000) {
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    if (await page.evaluate(stop)) return true;
    const busy = await page.evaluate(() =>
      (window.__textbox?.isOpen?.() ?? false) || (window.__cutscene?.isActive?.() ?? false));
    if (busy) await tapCircle(page, 70);
    else await page.waitForTimeout(80);
  }
  return false;
}

try {
  await page.goto(`${ROOT}?skipTitle=1&map=s480&noEncounters=1`);
  await page.waitForFunction(() => window.__state?.started, null, { timeout: 40_000 });
  await page.waitForTimeout(400);
  await page.evaluate(() => { window.__gameSpeed = 8; });

  const talked = await page.evaluate(() => window.__engineBridge.onTalk(133));
  check("talking to Zanbamon starts the challenge and the fight", talked === true, String(talked));

  const launched = await advanceUntil(() => window.__battle?.isActive?.(), 30_000);
  check("the s480 scripted encounter starts", launched, JSON.stringify(await snap()));

  // Drive the fight the way a player does: read every line, choose Fight when the menu is
  // up, and let Zanbamon act. (Zanbamon's ai_moves are cleared so his action-1 basic attack
  // -- technique 393, Cross Slash -- is always what he swings.)
  let opened = null;
  let sawForcedRun = false;
  let forcedNow = false;
  let fled = false;
  for (let i = 0; i < 90 && !fled; i++) {
    const st = await page.evaluate(() => {
      const b = window.__battleB?.();
      const p = window.__battle?.peek?.();
      return { active: !!window.__battle?.isActive?.(), message: p?.message ?? "",
        menu: p?.menu ?? null, enemy: b?.enemy?.profile?.name ?? null,
        screenId: b?.screenId ?? null, specialMode: b?.specialMode ?? null,
        forced: !!b?._forcedFlee };
    });
    if (st.active && !opened) {
      opened = st;
      await page.evaluate(() => { const b = window.__battleB?.(); if (b?.enemy?.eStats) b.enemy.eStats.ai_moves = []; });
    }
    if (/Running away/.test(st.message)) sawForcedRun = true;
    if (st.forced) forcedNow = true;
    if (!st.active && opened) { fled = true; break; }
    if (st.menu) await page.evaluate(() => { const b = window.__battleB?.(); if (b) b.menuSel = 0; });
    await tapCircle(page, 70);
    await page.waitForTimeout(400);
  }
  await shot("01-fight-open");
  check("the battle is screen 11 (Jungle Grave / Zanbamon), mode 2",
    opened?.screenId === SCREEN && opened?.specialMode === 2, JSON.stringify(opened));
  check("the enemy is Zanbamon", String(opened?.enemy).includes("Zanbamon"), String(opened?.enemy));
  check("Zanbamon's Cross Slash sets the forced-flee state on the landed hit", forcedNow);
  check("the forced run shows the disc's own 'Running away!' page", sawForcedRun);
  check("the fight ends as a flee (returns to the field, not the title)", fled);
  await shot("02-after-forced-run");

  // The flee returns to the field and the arrival chain runs: event 171 -> HANDOFF s450, ordinal 8.
  await page.evaluate(() => { window.__gameSpeed = 8; });
  const deadline = Date.now() + 30_000;
  let after = null;
  while (Date.now() < deadline) {
    const s = await snap();
    if (s.map === "s450") { after = s; break; }
    after = s;
    const busy = await page.evaluate(() =>
      (window.__textbox?.isOpen?.() ?? false) || (window.__cutscene?.isActive?.() ?? false));
    if (busy) await tapCircle(page, 70); else await page.waitForTimeout(80);
  }
  await shot("03-after-beat");
  check("AFTER: fleeing runs the arrival chain and the story carries on",
    after != null && (after.map === "s450" || after.ordinal === 8), JSON.stringify(after));
  check("AFTER: the player is handed to Bulk Bridge (s450)", after?.map === "s450", JSON.stringify(after));
  check("AFTER: the master ordinal reached 8 (event 171's own write)", after?.ordinal === 8,
    JSON.stringify(after));

  // ── BEFORE: the pre-fix wiring, emulated by suppressing the forced-flee state ──
  // The landed Cross Slash still happens; without the forced-flee arm the fight cannot end
  // as a flee, so the player (whose HP the hit zeroes) reaches the ordinary defeat route and
  // the story never advances past s480.
  await page.goto(`${ROOT}?skipTitle=1&map=s480&noEncounters=1`);
  await page.waitForFunction(() => window.__state?.started, null, { timeout: 40_000 });
  await page.waitForTimeout(400);
  await page.evaluate(() => { window.__gameSpeed = 8; });
  await page.evaluate(() => window.__engineBridge.onTalk(133));
  await page.waitForFunction(() => window.__battle?.isActive?.(), null, { timeout: 30_000 });
  await page.evaluate(() => {
    // Remove the forced-flee arm's effect every tick: what web/battle.js did before this change.
    window.__beforeKill = setInterval(() => { const b = window.__battleB?.(); if (b) b._forcedFlee = false; }, 20);
  });
  let beforeRun = false;
  let beforeFled = false;
  let beforeOpened = false;
  for (let i = 0; i < 90 && !beforeFled; i++) {
    const st = await page.evaluate(() => {
      const b = window.__battleB?.();
      const p = window.__battle?.peek?.();
      return { active: !!window.__battle?.isActive?.(), message: p?.message ?? "", menu: p?.menu ?? null };
    });
    if (st.active) beforeOpened = true;
    if (/Running away/.test(st.message)) beforeRun = true;
    if (!st.active && beforeOpened) { beforeFled = true; break; }
    if (st.menu) await page.evaluate(() => { const b = window.__battleB?.(); if (b) { b.menuSel = 0; b.enemy.eStats.ai_moves = []; } });
    await tapCircle(page, 70);
    await page.waitForTimeout(400);
  }
  await page.evaluate(() => clearInterval(window.__beforeKill));
  check("BEFORE: the pre-fix wiring forces NO run (no 'Running away!' page)", beforeRun === false);
  const held = await snap();
  check("BEFORE: the story never reaches s450 / ordinal 8", held.map !== "s450" && held.ordinal !== 8,
    JSON.stringify(held));

  check("no page errors", errors.length === 0, errors.join(" | "));
} catch (e) {
  failed = failed || String(e?.stack || e);
  console.error("FAIL:", e?.stack || e);
  await shot("failure").catch(() => {});
} finally {
  console.log(failed ? `RESULT: FAIL — ${failed}` : "RESULT: PASS");
  await browser.close();
  process.exit(failed ? 1 : 0);
}
