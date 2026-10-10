// The first s415 Deeper Crevice Bulbmon fight is a scripted, UNWINNABLE battle, and the
// original ends it with an ENEMY ESCAPE at low HP (not a forced player flee, not a loss).
//
// Mechanism (disc):
//   * WFIGHTMN 0xfdc-0x1020 picks battle MODE 1 for the pair field screen 0x22d + battle id
//     0x143 (pro/wfightmn.s .L0x00001018/.L0x00001020); the finalizer 0x800aabf0 floors the
//     player's landed damage at the enemy's maxHP/11 so Bulbmon cannot be killed.
//   * FIGHTSTG_F0x80088564 (pro/fightstg.s:5829), arm .L0x800885bc-.L0x80088664: when the
//     mode word 0x800A4536 is 1 AND the acting enemy's current HP has fallen below maxHP/10,
//     it writes esmfight[0x5f] "Fleeing!" and commits the battle result byte 0 (flee ->
//     back to the field), with no victory screen and 0 EXP / 0 BIT.  The max/11 floor sits
//     BELOW max/10, so the escape fires the moment the player would have dealt the kill.
//
//   AFTER  (as shipped): the Fight hit is floored, the enemy's HP is below maxHP/10, the
//                        mode-1 escape fires -> "Fleeing!" -> the fight ends as a flee with
//                        0 EXP / 0 BIT (back to the field).
//   BEFORE (emulated):   the same fight with the escape suppressed every tick (what
//                        web/battle.js did before this change) -- the hit is floored but the
//                        fight never ends, it just keeps going.
//
// Server: python3 -m http.server $VERIFY_PORT --directory web
// Run:    VERIFY_PORT=$VERIFY_PORT tools/run-playwright.sh tools/verify_bulbmon_scripted_escape.mjs
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";
import { tapCircle } from "./verify-battle-wait.mjs";

const PORT = Number(process.env.VERIFY_PORT || 8788);
const ROOT = process.env.BSE_ROOT || `${baseUrl(PORT)}/`;
const OUT = process.env.BSE_SHOT || ".dw3-research/bulbmon-scripted-fight-2026-10-09/shots";
mkdirSync(OUT, { recursive: true });

const SCREEN = 323;   // s415 Deeper Crevice / Bulbmon (field_encounters screen 323)

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

/** Open the real s415 Bulbmon screen and read the battle's own state once it is up. */
async function openFight() {
  await page.goto(`${ROOT}?skipTitle=1&map=s415&noEncounters=1`);
  await page.waitForFunction(() => window.__state?.started, null, { timeout: 40_000 });
  await page.waitForTimeout(400);
  await page.evaluate(() => { window.__gameSpeed = 8; });
  await page.evaluate((screenId) => {
    window.__dgWin = null; window.__dgFlee = false; window.__dgMessages = [];
    window.__battle.startScreen(screenId,
      (res) => { window.__dgWin = res; },
      () => { window.__dgFlee = true; },
      () => {},
      { mapId: "s415", lead: false });
  }, SCREEN);
  await page.waitForFunction(() => window.__battle?.isActive?.(), null, { timeout: 30_000 });
  return page.evaluate(() => {
    const b = window.__battleB?.();
    return {
      screenId: b?.screenId ?? null, specialMode: b?.specialMode ?? null,
      enemy: b?.enemy?.profile?.name ?? null, maxHp: b?.enemy?.maxHp ?? null,
    };
  });
}

/** Seed the enemy just above the maxHP/11 floor (87) and below maxHP/10 (96). */
const seedLowHp = () => page.evaluate(() => {
  const b = window.__battleB?.();
  b.enemy.hp = 92; b.enemy.maxHp = 960;
  return b.enemy.hp;
});

/** Read the fight each frame; press Circle; choose Fight whenever the menu is up. */
async function drive(extra, budgetMs = 30_000) {
  const deadline = Date.now() + budgetMs;
  const seen = { fleeing: false, minEnemyHp: Infinity, enemyFled: false, alive: false, message: "" };
  while (Date.now() < deadline) {
    const st = await page.evaluate(() => {
      const b = window.__battleB?.();
      const p = window.__battle?.peek?.();
      return { active: !!window.__battle?.isActive?.(), message: p?.message ?? "",
        menu: p?.menu ?? null, enemyHp: b?.enemy?.hp ?? null, escaped: !!b?._mode1EscapeShown };
    });
    if (st.active) seen.alive = true;
    if (st.message) seen.message = st.message;
    if (/Fleeing/.test(st.message)) seen.fleeing = true;
    if (typeof st.enemyHp === "number") seen.minEnemyHp = Math.min(seen.minEnemyHp, st.enemyHp);
    if (st.escaped) seen.escaped = true;
    if (!st.active && seen.alive) { seen.ended = true; return seen; }
    if (st.menu) await page.evaluate(() => { const b = window.__battleB?.(); if (b) b.menuSel = 0; });
    extra?.(st);
    await tapCircle(page, 70);
    await page.waitForTimeout(400);
  }
  return seen;
}

try {
  // ── AFTER: as shipped ──
  const opened = await openFight();
  check("the s415 Bulbmon fight opens (field_encounters screen 323)",
    opened.screenId === SCREEN, JSON.stringify(opened));
  check("the fight engine picks MODE 1 for s415 + battle 323",
    opened.specialMode === 1, JSON.stringify(opened));
  check("the enemy is Bulbmon with the real 960 HP", String(opened.enemy).includes("Bulbmon") && opened.maxHp === 960,
    JSON.stringify(opened));
  const seeded = await seedLowHp();
  check("seeded the enemy at 92 HP (below maxHP/10 = 96, above maxHP/11 = 87)", seeded === 92, String(seeded));

  const after = await drive();
  await shot("01-after-escape");
  check("AFTER: the landed Fight is floored to the maxHP/11 floor, not a kill",
    after.minEnemyHp === 87 || (after.minEnemyHp > 0 && after.minEnemyHp < 96), `minEnemyHp=${after.minEnemyHp}`);
  check("AFTER: the escape fires on the mode word (b._mode1EscapeShown)", after.escaped === true);
  check("AFTER: the box shows the disc's own 'Fleeing!' page", after.fleeing === true,
    JSON.stringify({ message: after.message }));
  check("AFTER: the fight ends (returns to the field, not the title)", after.ended === true && after.alive === true);
  const win = await page.evaluate(() => ({ win: window.__dgWin, flee: window.__dgFlee }));
  check("AFTER: the enemy-flee outcome pays 0 EXP / 0 BIT", win.win && win.win.xp === 0 && win.win.bits === 0 && win.win.enemyFled === true,
    JSON.stringify(win));

  // ── BEFORE: the pre-fix wiring, emulated by suppressing the escape every tick ──
  const opened2 = await openFight();
  await seedLowHp();
  await page.evaluate(() => {
    // Remove the mode-1 escape's effect every tick: exactly what web/battle.js did before
    // this change (the arm did not exist).
    window.__beforeKill = setInterval(() => { const b = window.__battleB?.(); if (b) b._mode1EscapeShown = true; }, 20);
  });
  const before = await drive();
  await page.evaluate(() => clearInterval(window.__beforeKill));
  await shot("02-before-suppressed");
  check("BEFORE: the fight is the same mode-1 Bulbmon fight", opened2.specialMode === 1 && String(opened2.enemy).includes("Bulbmon"),
    JSON.stringify(opened2));
  check("BEFORE: no 'Fleeing!' page ever appears", before.fleeing === false,
    JSON.stringify({ lastMessage: before.message }));
  check("BEFORE: the fight never ends — the escape is gone, so it just keeps going",
    before.ended !== true, JSON.stringify({ ended: before.ended, minEnemyHp: before.minEnemyHp }));

  // ── STORY: the fight reached by the game's OWN route, then the beat that follows ──
  // This is the "and then you can resume" the operator asked about: reach the s415
  // Deeper Crevice beat at story ordinal 6, fight Bulbmon, and watch the story hand over.
  await page.evaluate(() => localStorage.setItem("progressOrdinal", "6"));
  await page.goto(`${ROOT}?skipTitle=1&map=s200&noEncounters=1`);
  await page.waitForFunction(() => window.__state?.started, null, { timeout: 40_000 });
  await page.waitForTimeout(300);
  // Arm the s415 fight while on s200 (event 150 sets this flag; the ordinal-6 gate then
  // lets event 151 — the post-fight handoff — follow the escape).
  await page.evaluate(() => window.__applyStoryFlag?.(16408, 1));
  await page.goto(`${ROOT}?skipTitle=1&map=s415&noEncounters=1`);
  await page.waitForFunction(() => window.__state?.started, null, { timeout: 40_000 });
  await page.waitForTimeout(300);
  await page.evaluate(() => { window.__gameSpeed = 8; });
  await page.waitForFunction(() => window.__battle?.isActive?.(), null, { timeout: 30_000 });
  const storyOpen = await page.evaluate(() => {
    const b = window.__battleB?.();
    return { screenId: b?.screenId ?? null, specialMode: b?.specialMode ?? null,
      enemy: b?.enemy?.profile?.name ?? null };
  });
  await seedLowHp();
  const story = await drive(undefined, 40_000);
  let endMap = null;
  const endDeadline = Date.now() + 40_000;
  while (Date.now() < endDeadline) {
    endMap = await page.evaluate(() => window.__mapInfo?.().id ?? null);
    if (endMap === "s440") break;
    const busy = await page.evaluate(() => (window.__textbox?.isOpen?.() ?? false) || (window.__cutscene?.isActive?.() ?? false));
    if (busy) await tapCircle(page, 70); else await page.waitForTimeout(150);
  }
  await shot("03-story-resumed");
  check("STORY: the fight starts by the game's own route (screen 323, mode 1)",
    storyOpen.screenId === SCREEN && storyOpen.specialMode === 1, JSON.stringify(storyOpen));
  check("STORY: the escape fires, the box reads 'Fleeing!', the fight ends",
    story.escaped === true && story.fleeing === true && story.ended === true,
    JSON.stringify({ escaped: story.escaped, fleeing: story.fleeing, ended: story.ended }));
  check("STORY: the story resumes — the player is handed to s440 (South Station)",
    endMap === "s440", String(endMap));

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
