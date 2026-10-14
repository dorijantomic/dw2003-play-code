// Probe: the finale head's resting-stance flag in the real game (audit/battle-3d-vs-decode).
//
// Drives the SAME finale state tools/verify_battle_cues.mjs arms for boss04 — specialMode 4,
// _finaleKind 6, the enemy at 999999 HP so the quarter-HP rule cannot fire — lands three
// player commits, and then reads the enemy's base idle table (the anim object's +0x18 flag,
// which WFIGHTMN_F0x800aa9f0 latches): 1 = the hurt stance, 0 = the normal idle.
//
// Run (serve web/ first): VERIFY_PORT=8742 tools/run-playwright.sh <this file>
import { chromium } from "playwright";
import { baseUrl } from "./verify-base-url.mjs";
import { waitForCommandMenu, runBattleTurn, tapCircle } from "./verify-battle-wait.mjs";

const ROOT = `${baseUrl(8742)}/`;
const WIN = 8, MENU = 2;
const member = (digimonId, level, xp) => ({
  digimonId, level, xp, tp: 10, hp: 9999, maxHp: 9999, mp: 999, maxMp: 999,
  stats: { str: 400, def: 200, spt: 120, wis: 120, spd: 400, chr: 30 },
  bonuses: {}, elemBonuses: {},
});

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 960, height: 720 } });
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
}, { lead: member(1, 20, 0), rena: member(7, 20, 0), pata: member(8, 20, 0) });

await page.goto(`${ROOT}?skipTitle=1&map=s245&noEncounters=1`, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => window.__state?.started, null, { timeout: 40_000 });
await page.evaluate(async () => {
  await window.__battle.start({ enemyId: 1, enemyLevel: 5, onWin: () => {}, onFlee: () => {}, onLose: () => {} });
});
await page.waitForFunction(() => !!window.__battle3d, null, { timeout: 30_000 });
await waitForCommandMenu(page);
await page.evaluate(() => {
  const b = window.__battleB();
  b.specialMode = 4; b._finaleKind = 6; b._bossPhaseCount = 2; b._bossPhaseDone = false;
  b.enemy.hp = 999999; b.enemy.maxHp = 999999;
  b.player.hp = 9999; b.player.maxHp = 9999;
});

// Land player commits until the weaken event has latched (the third landed commit).
let done = false;
for (let attempt = 0; attempt < 10 && !done; attempt++) {
  await tapCircle(page);
  await runBattleTurn(page, { ticks: 80, until: (s) => s.state === MENU || s.state === WIN });
  done = await page.evaluate(() => !!window.__battleB()?._bossPhaseDone);
}

const out = await page.evaluate(() => {
  const b = window.__battleB();
  const r = window.__battle3d;
  return {
    kind: b?._finaleKind, bossDone: !!b?._bossPhaseDone,
    enemyHp: b?.enemy?.hp, enemyMax: b?.enemy?.maxHp,
    enemyBase: r?.coordinator?.enemy?.baseTable,
    playerBase: r?.coordinator?.player?.baseTable,
    enemyAnimId: r?.debugPatchState?.("enemy")?.animationId,
  };
});
console.log("finale stance probe:", JSON.stringify(out));
await browser.close();
if (!out.bossDone) { console.error("PROBE FAIL: the weaken event never latched"); process.exit(1); }
console.log(out.enemyBase === 1
  ? "PROBE OK: the weakened head rests in the hurt stance (base table 1)"
  : `PROBE: the head's base table is ${out.enemyBase} (expected 1 with the weakened-byte branch)`);
