// Probe: drive the s200 scripted battle with the camera verifier's arming and trace its
// states + HP to the loss beat, pressing while an action, a result line or the command
// menu is waiting. This is the trace that pinned the 2026-10-14 loss-camera check's
// hang: a MISSED enemy blow returns the turn to the command menu (state 2) without
// touching the party, and verify_battle_loss_camera.mjs only pressed on states 5/6/7, so
// it waited at the menu until its guard ran out. The probe presses on 2 as well and
// reaches ST.LOSE (9) with "Annihilated..." up — the press policy the verifier now uses.
//
// Server: python3 -m http.server $PORT --directory web
// Run:    VERIFY_PORT=$PORT tools/run-playwright.sh tools/_probe_audit_s200_loss.mjs
import { chromium } from "playwright";
import { baseUrl } from "./verify-base-url.mjs";
import { waitForCommandMenu } from "./verify-battle-wait.mjs";

const ROOT = `${baseUrl(Number(process.env.VERIFY_PORT || 8842))}/`;
const member = (digimonId, level, xp) => ({
  digimonId, level, xp, tp: 10, hp: 200, maxHp: 200, mp: 80, maxMp: 80,
  stats: { str: 60, def: 40, spt: 30, wis: 30, spd: 40, chr: 20 },
  bonuses: {}, elemBonuses: {},
});
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
page.on("pageerror", (e) => console.error("PAGEERROR", e.message));
await page.addInitScript((seed) => {
  localStorage.setItem("assetMode", "authentic");
  localStorage.setItem("engineSchema", "2");
  localStorage.setItem("progressOrdinal", "3");
  localStorage.setItem("playerName", "Junior");
  localStorage.setItem("charId", "p005koet");
  localStorage.setItem("party", JSON.stringify(["p005koet", "p006agum", "p009rena"]));
  localStorage.setItem("packId", "B");
  localStorage.setItem("bits", "1000");
  localStorage.setItem("inventory", "[]");
  localStorage.setItem("partnerStats", JSON.stringify(seed.lead));
  localStorage.setItem("partyStats", JSON.stringify([seed.lead, seed.rena, seed.pata]));
  localStorage.setItem("equipment", JSON.stringify([{}, {}, {}]));
}, { lead: member(3, 5, 0), rena: member(7, 5, 0), pata: member(8, 5, 0) });

await page.goto(ROOT + "?skipTitle=1&map=s200&noEncounters=1");
await page.waitForFunction(() => window.__state?.started, null, { timeout: 10_000 });
await page.evaluate(() => { window.__gameSpeed = 8; });
let deadline = Date.now() + 15_000;
while (Date.now() < deadline) {
  if (await page.evaluate(() => !!window.__battle?.isActive?.())) break;
  if (await page.evaluate(() => window.__textbox?.isOpen?.() ?? false)) await page.keyboard.press("Enter");
  await page.waitForTimeout(40);
}
await page.evaluate(() => { window.__gameSpeed = 1; });
console.log("battle active:", await page.evaluate(() => !!window.__battle?.isActive?.()));
await waitForCommandMenu(page);
await page.waitForFunction(() => window.__battleWfightmn?.diagnostics?.().open === false, null, { timeout: 30_000 });
await page.waitForFunction(() => window.__battleCmdNative?.diagnostics?.().ready === true, null, { timeout: 30_000 });

const armed = await page.evaluate(() => {
  const b = window.__battleB();
  b.playerRecords.forEach((record, index) => { record.hp = index === b.activePlayerIndex ? 1 : 0; });
  b.player.hp = b.playerRecords[b.activePlayerIndex].hp;
  const top = Math.min(9999, Math.max(1, b.enemy.maxHp || 1) * 100);
  b.enemy.maxHp = top;
  b.enemy.hp = top;
  b._hpEase = null;
  return { active: b.activePlayerIndex, partyHp: b.playerRecords.map((r) => r.hp), enemyHp: b.enemy.hp };
});
console.log("armed", JSON.stringify(armed));

const snap = () => page.evaluate(() => {
  const b = window.__battleB?.();
  if (!b) return null;
  return {
    state: b.state, msg: String(b.message ?? "").slice(0, 40),
    playerHp: b.player?.hp, records: b.playerRecords?.map((r) => r.hp),
    enemyHp: b.enemy?.hp, enemyAct: b._enemyAction?.name ?? null,
    timeline: b._timelineMessage ?? null, result: b._resultPages?.length ?? null,
    waits: window.__battle?.peek?.()?.waitsForLine ?? null,
  };
});

// press Enter while a line waits, then trace.
for (let i = 0; i < 120; i++) {
  const s = await snap();
  if (i % 1 === 0) console.log(i, JSON.stringify(s));
  if (s?.state === 9) { console.log("LOSS REACHED"); break; }
  const lineHeld = await page.evaluate(() => {
    const p = window.__battle?.peek?.();
    const m = p?.messageLine;
    return !!m?.active && !m.finished && (!!m.holdsTurn || !!p?.waitsForLine);
  });
  if (s?.state === 2 || s?.state === 5 || s?.state === 6 || s?.state === 7 || lineHeld) await page.keyboard.press("Enter");
  await page.waitForTimeout(150);
}
await browser.close();
