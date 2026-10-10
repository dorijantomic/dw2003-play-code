// The s480 Jungle Grave Zanbamon fight is a scripted, UNWINNABLE battle, and the original ends
// it as a FLEE, not a loss (worker-ch: WFIGHTMN mode 2 floors the player's damage at maxHP/11;
// the fight's own next scene has Zanbamon say "What, you're running away in the middle of the
// battle?" — web/assets/events/esdmg400.json entry 9). A flee is result byte 0, which returns the
// player to the FIELD (WFIGHTMN exit presenter 0x800a7f54); a loss is result 2 and goes to the
// title. Returning to the field runs the stage's arrival chain, which is where the beat that
// carries the player to Bulk Bridge lives: s480's event 171 (the gloat + HANDOFF to s450, master
// ordinal -> 8).
//
//   AFTER  (as shipped): the real launch path (talk to Zanbamon -> the PRE -> the battle) with the
//                        host's FLEE arm running the arrival chain. Fleeing the fight starts
//                        event 171 and hands the player to s450.
//   BEFORE (emulated):   the same fight started with the PRE-FIX wiring (a null flee hook — what
//                        flushStoryBattle passed before this change). Fleeing returns to the field
//                        but runs nothing, so the story stalls on s480.
//
// Server: python3 -m http.server $VERIFY_PORT --directory web
// Run:    VERIFY_PORT=$VERIFY_PORT tools/run-playwright.sh tools/verify_zanbamon_close.mjs
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";
import { waitForCommandMenu, tapCircle } from "./verify-battle-wait.mjs";

const PORT = Number(process.env.VERIFY_PORT || 8788);
const ROOT = process.env.ZBC_ROOT || `${baseUrl(PORT)}/`;
const OUT = process.env.ZBC_SHOT || ".dw3-research/zanbamon-close-2026-10-08/shots";
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
async function advanceUntil(stop, budgetMs = 20_000) {
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

/** Reach the command menu, choose Run (row 5) with the escape pinned to land, and read the line. */
async function flee(page) {
  await waitForCommandMenu(page, { timeout: 40_000 });
  await page.evaluate(() => {
    Math.random = () => 0;                       // the escape roll takes its first branch
    const b = window.__battleB();
    b.player.spd = 9000;                         // a big speed makes the roll land regardless
    window.__battleCmdNative?.close?.();
    b.menuSel = 5;                               // Run
  });
  await page.waitForFunction(
    () => window.__battle.peek?.()?.state === 2 && !!window.__battle.peek()?.commandList?.active,
    null, { timeout: 20_000 });
  await page.waitForTimeout(120);
  await tapCircle(page);
}

try {
  // ── AFTER: the real launch path, with the host's FLEE arm running the arrival chain ──
  await page.goto(`${ROOT}?skipTitle=1&map=s480&noEncounters=1`);
  await page.waitForFunction(() => window.__state?.started, null, { timeout: 40_000 });
  await page.waitForTimeout(400);
  await page.evaluate(() => { window.__gameSpeed = 8; });

  const talked = await page.evaluate(() => window.__engineBridge.onTalk(133));
  check("talking to Zanbamon starts the challenge and the fight", talked === true, String(talked));

  const launched = await advanceUntil(() => window.__battle?.isActive?.(), 25_000);
  check("the s480 scripted encounter starts", launched, JSON.stringify(await snap()));
  const open = await page.evaluate(() => {
    const b = window.__battleB?.();
    return { screenId: b?.screenId ?? null, specialMode: b?.specialMode ?? null,
      enemy: b?.enemy?.profile?.name ?? null };
  });
  check("the battle is screen 11 (Jungle Grave / Zanbamon), mode 2", open.screenId === SCREEN && open.specialMode === 2,
    JSON.stringify(open));
  check("the enemy is Zanbamon", String(open.enemy).includes("Zanbamon"), String(open.enemy));
  await page.evaluate(() => { window.__gameSpeed = 1; });
  await shot("01-after-fight-open");

  await flee(page);
  await page.waitForFunction(() => !window.__battle?.isActive?.(), null, { timeout: 20_000 });
  await page.evaluate(() => { window.__gameSpeed = 8; });
  // Watch for the handoff the gloat carries (event 171 -> s450); the ordinal it writes (8) is
  // its completion. One is enough to prove the beat ran; both together prove it finished.
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
  await shot("02-after-flee-beat");
  check("AFTER: fleeing the fight runs the arrival chain and the story carries on",
    after != null && (after.map === "s450" || after.ordinal === 8), JSON.stringify(after));
  check("AFTER: the player is handed to Bulk Bridge (s450)",
    after?.map === "s450", JSON.stringify(after));
  check("AFTER: the master ordinal reached 8 (event 171's own write)",
    after?.ordinal === 8, JSON.stringify(after));

  // ── BEFORE: the pre-fix wiring (a null flee hook) ──
  await page.goto(`${ROOT}?skipTitle=1&map=s480&noEncounters=1`);
  await page.waitForFunction(() => window.__state?.started, null, { timeout: 40_000 });
  await page.waitForTimeout(400);
  await page.evaluate(() => { window.__gameSpeed = 1; });
  // Arm the stage the way event 170's completion does, then launch the SAME screen with the
  // PRE-FIX flee hook: flushStoryBattle used to pass `null` there.
  await page.evaluate(async (screen) => {
    window.__engine.state.flags.set(16384, true);   // 0x4000, set by event 170
    await window.__battle.startScreen(screen, () => {}, null, () => {}, { mapId: "s480", lead: false });
  }, SCREEN);
  await page.waitForFunction(() => window.__battle?.isActive?.(), null, { timeout: 40_000 });
  await shot("03-before-fight-open");
  await flee(page);
  await page.waitForFunction(() => !window.__battle?.isActive?.(), null, { timeout: 20_000 });
  await page.evaluate(() => { window.__gameSpeed = 8; });
  // Give the pre-fix build the same time a fixed build would need for the beat.
  const bdeadline = Date.now() + 12_000;
  let before = null;
  while (Date.now() < bdeadline) {
    const s = await snap();
    if (s.map === "s450" || s.ordinal === 8) { before = s; break; }
    const busy = await page.evaluate(() =>
      (window.__textbox?.isOpen?.() ?? false) || (window.__cutscene?.isActive?.() ?? false));
    if (busy) await tapCircle(page, 70); else await page.waitForTimeout(100);
  }
  await shot("04-before-flee-no-beat");
  check("BEFORE: the pre-fix flee returns to the field but runs NO beat (the story stalls)",
    before == null, JSON.stringify(before ?? await snap()));
  const held = await snap();
  check("BEFORE: the player is still on s480 at ordinal 7",
    held.map === "s480" && held.ordinal === 7, JSON.stringify(held));

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
