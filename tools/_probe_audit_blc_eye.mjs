// Probe: drive the s200 loss like verify_battle_loss_camera.mjs and dump the camera
// record, the record's owner and the coordinator's live VMs per sample. The trace that
// pinned the 2026-10-14 defeat-camera regression: with the record cut gated on
// `camScriptOwned`, the loss branch fired while the enemy's action VM was still running
// (`enemy.ended === false`), so the record stayed the retire cut and the eye never moved
// — the defeat shot was never seen. With the defeat exception in place the record is the
// defeat cut and the eye orbits with the yaw.
//
// Server: python3 -m http.server $PORT --directory web
// Run:    VERIFY_PORT=$PORT tools/run-playwright.sh tools/_probe_audit_blc_eye.mjs
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

const pressFrame = async (k) => {
  await page.keyboard.down(k);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
  await page.keyboard.up(k);
};
const state = () => page.evaluate(() => window.__battleB?.()?.state ?? null);

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
await waitForCommandMenu(page);
await page.waitForFunction(() => window.__battleWfightmn?.diagnostics?.().open === false, null, { timeout: 30_000 });
await page.waitForFunction(() => window.__battleCmdNative?.diagnostics?.().ready === true, null, { timeout: 30_000 });
await page.evaluate(() => {
  const b = window.__battleB();
  b.playerRecords.forEach((record, index) => { record.hp = index === b.activePlayerIndex ? 1 : 0; });
  b.player.hp = b.playerRecords[b.activePlayerIndex].hp;
  const top = Math.min(9999, Math.max(1, b.enemy.maxHp || 1) * 100);
  b.enemy.maxHp = top; b.enemy.hp = top; b._hpEase = null;
});
for (let i = 0; i < 4; i++) { if (await state() !== 2) break; await pressFrame("Enter"); await page.waitForTimeout(120); }
let guard = 0;
while (guard++ < 200) {
  const s = await state();
  if (s === 9) break;
  if (s === 2 || s === 5 || s === 6 || s === 7) await pressFrame("Enter");
  await page.waitForTimeout(150);
}
console.log("reached state", await state(), "after", guard, "polls");
const sample = () => page.evaluate(() => {
  const r = window.__battle3d;
  const info = r?.getCameraInfo?.() ?? null;
  const dbg = r?.__dnaDebug?.() ?? null;
  const c = r?.coordinator;
  const vmState = (a) => a ? { active: !!a.isActive, ended: a.vm ? !!a.vm.ended : null,
    clip: a.clip ?? a.animId ?? null } : null;
  return {
    eye: info?.eye?.map((v) => Math.round(v)) ?? null,
    look: info?.look?.map((v) => Math.round(v)) ?? null,
    yaw: info?.defeatYaw ?? null, delta: info?.defeatDelta ?? null,
    camMode: dbg?.camMode ?? null, camScriptOwned: dbg?.camScriptOwned ?? null,
    rec: dbg?.camRecord ? { kind: dbg.camRecord.kind, issuer: dbg.camRecord.issuer,
      gliding: dbg.camRecord.gliding } : null,
    director: { exists: dbg?.director?.exists ?? null, retired: dbg?.director?.retired ?? null },
    vms: { player: vmState(c?.player), enemy: vmState(c?.enemy), defender: vmState(c?._defender) },
  };
});
for (let i = 0; i < 6; i++) {
  console.log(i, JSON.stringify(await sample()));
  await page.waitForTimeout(220);
}
await browser.close();
