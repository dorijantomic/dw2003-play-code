// tools/_probe_audit_press_blip.mjs — live-browser proof that the battle message line's
// Circle press reaches the walker's sound layer as system07 (SYSTEM07 0x4001C, the reveal
// machine's own phase-3 blip at pro/fightstg .L0x80098BC4-.L0x80098BD4, wired through
// BATTLE_MESSAGE_PRESS_SOUND in web/battle.js on 2026-10-14).
//
// Drives the REAL game page and the REAL web/audio.js player: it confirms FIGHT, waits for
// the attack's message line to be up and waiting, clears the cue log, presses Circle, and
// reads the sound NAME that arrived — not a source string.
//
// Run (serve web/ first):
//   python3 -m http.server 8842 --directory web
//   VERIFY_PORT=8842 tools/run-playwright.sh tools/_probe_audit_press_blip.mjs
import { chromium } from "playwright";
import { baseUrl } from "./verify-base-url.mjs";
import { waitForCommandMenu, tapCircle } from "./verify-battle-wait.mjs";

const ROOT = `${baseUrl(Number(process.env.VERIFY_PORT || 8842))}/`;
const member = (digimonId, level, xp) => ({
  digimonId, level, xp, tp: 10, hp: 9999, maxHp: 9999, mp: 999, maxMp: 999,
  stats: { str: 400, def: 200, spt: 120, wis: 120, spd: 400, chr: 30 },
  bonuses: {}, elemBonuses: {},
});

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 960, height: 720 } });
page.on("pageerror", (e) => console.error("PAGE", e.message));
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

// Instrument the real player: every cue that reaches the sound layer is recorded with the
// name it arrived as (the same technique tools/verify_battle_cues.mjs uses).
await page.goto(`${ROOT}?skipTitle=1&map=s245&noEncounters=1`, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => window.__state?.started, null, { timeout: 40_000 });
await page.waitForFunction(() => !!window.__sfx && !!window.__battle, null, { timeout: 30_000 });
await page.evaluate(() => {
  window.__cues = [];
  const rec = (fnName, args) => window.__cues.push(`${fnName}:${args.map((x) => String(x))[0]}`);
  const sfx = window.__sfx;
  for (const fn of ["play", "playBattle", "playBank", "playPacked", "playArea", "playSustained"]) {
    const orig = sfx[fn].bind(sfx);
    sfx[fn] = (...a) => { rec(fn, a); return orig(...a); };
  }
});
await page.evaluate(async () => {
  await window.__battle.start({ enemyId: 1, enemyLevel: 5, onWin: () => {}, onFlee: () => {}, onLose: () => {} });
});
await page.waitForFunction(() => !!window.__battle3d, null, { timeout: 30_000 });
await waitForCommandMenu(page);

// Confirm FIGHT; its own menu blip is system07 too, so the log is cleared only AFTER the
// line is up and waiting — the next system07 can only be the line's press blip.
await tapCircle(page);
await page.waitForFunction(() => {
  const m = window.__battle?.peek?.()?.messageLine;
  return !!m?.active && !m.finished && m.promptVisible;
}, null, { timeout: 20_000 });
const lineUp = await page.evaluate(() => {
  const m = window.__battle?.peek?.()?.messageLine;
  return { active: m?.active, finished: m?.finished, promptVisible: m?.promptVisible, tick: m?.tick };
});
await page.evaluate(() => { window.__cues.length = 0; });
await tapCircle(page);
await page.waitForFunction(() => window.__battle?.peek?.()?.messageLine?.finished === true,
  null, { timeout: 10_000 });
const cues = await page.evaluate(() => window.__cues.slice());
const blip = cues.includes("play:system07");
console.log("line before the press:", JSON.stringify(lineUp));
console.log("cues after the press:", JSON.stringify(cues));
console.log(blip ? "BLIP OK: system07 arrived on the press" : "BLIP MISSING");
await browser.close();
process.exit(blip ? 0 : 1);
