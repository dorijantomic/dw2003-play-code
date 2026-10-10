// tools/verify_battle_item_use_motion.mjs — the item-use motion, as a player meets it.
//
// Operator bug 16: using an item in the 3-D battle performed NO animation. The item branch of
// web/battle.js `applyPlayerAction` ran the effect and its message page and consumed the item,
// but started no 3-D motion. The disc says the item action runs the SAME action-VM machinery an
// attack does: FIGHTSTG_F0x8008d3b4 allocates a fresh action actor (FIGHTSTG_F0x8008c910) and
// writes its clip slot +0x54 = 10 (pro/fightstg.s:11099-11105), so the acting Digimon plays
// action clip 10 — the item-use motion (tables 44/45).
//
// This script drives the real in-battle ITEM list to use Power Charge (item 43) and reads the
// player actor off the renderer (`window.__battle3d.playerAnimator`): its active clip and
// whether its action VM is running. On the fixed build the actor is mid-clip-10 for the whole
// item use; on the parent tip it never leaves idle. It prints a RESULT json and never fails, so
// the same script produces the before and the after capture.
//
// Run against this worktree's own server:
//   python3 -m http.server 8944 --directory web &
//   VERIFY_PORT=8944 tools/run-playwright.sh tools/verify_battle_item_use_motion.mjs
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";
import { waitForCommandMenu } from "./verify-battle-wait.mjs";

const ROOT = process.env.MOTION_ROOT || `${baseUrl(8944)}/`;
const OUT = process.env.MOTION_SHOT || "captures/playtest-2026-10-07-you/item-use-motion";
mkdirSync(OUT, { recursive: true });

const ITEM_ID = 43;          // Power Charge — row 0 of the in-battle ITEM list, in table order
const member = (digimonId, level, xp) => ({
  digimonId, level, xp, tp: 10, hp: 400, maxHp: 400, mp: 120, maxMp: 120,
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
  localStorage.setItem("inventory", JSON.stringify([{ id: 43, qty: 2 }, { id: 66, qty: 3 }]));
}, { lead: member(1, 10, 0), rena: member(7, 10, 0), pata: member(8, 10, 0) });

const tap = (k) => page.evaluate((kk) => {
  window.dispatchEvent(new KeyboardEvent("keydown", { key: kk }));
  window.dispatchEvent(new KeyboardEvent("keyup", { key: kk }));
}, k);
const shot = async (n) => writeFileSync(`${OUT}/${n}.png`,
  Buffer.from((await page.locator("canvas#game").evaluate((el) => el.toDataURL("image/png"))).split(",")[1],
    "base64"));

// The player actor off the renderer: its active clip and whether its action VM is running.
const actor = () => page.evaluate(() => {
  const r = window.__battle3d;
  const a = r && r.playerAnimator;
  return {
    hasRenderer: !!r,
    vmActive: !!(a && a.vm && !a.vm.ended),
    clip: a ? (a._clip ?? null) : null,
    frame: a ? (a.frame ?? null) : null,
    isActive: !!(a && a.isActive),
  };
});

let failed = null;
const fail = (m) => { failed = m; console.error("FAIL:", m); };

try {
  await page.goto(`${ROOT}?skipTitle=1&map=s245&noEncounters=1`);
  await page.waitForFunction(() => window.__state?.started, null, { timeout: 40_000 });
  await page.waitForTimeout(500);
  await page.evaluate(async () => {
    await window.__battle.start({ enemyId: 1, enemyLevel: 1,
      onWin: () => {}, onFlee: () => {}, onLose: () => {} });
    window.__battleB().player.hp = 100;   // hurt, so the charge has something to restore
  });
  await waitForCommandMenu(page);
  await page.evaluate(() => { const b = window.__battleB(); b.enemy.hp = 99999; b.enemy.maxHp = 99999; });

  // ── BEFORE: the actor rests in idle — no action VM, no clip-10 motion.
  const before = await actor();
  await shot("item-use-before-idle");
  console.log("BEFORE", JSON.stringify(before));

  // ── Choose Item (command row 4), then confirm row 0 (Power Charge).
  await page.waitForFunction(() => window.__battleCmdNative?.diagnostics?.().ready === true,
    null, { timeout: 30_000 });
  for (let i = 0; i < 8; i++) {
    const sel = await page.evaluate(() => window.__battleCmdNative.diagnostics().selection);
    if (sel === 4) break;
    await tap("ArrowDown");
    await page.waitForTimeout(140);
  }
  await tap("Enter");
  await page.waitForFunction(() => window.__battleB?.()?.state === 4, null, { timeout: 20_000 });
  await page.waitForFunction(() => window.__battleItemNative?.diagnostics?.().ready === true,
    null, { timeout: 20_000 }).catch(() => {});
  await tap("Enter");   // choose the item (the announcement page comes up)

  // The kind-14 announcement page holds the turn until Circle/Enter.
  await page.waitForFunction(() => {
    const p = window.__battle.peek();
    return (p.messageLine?.frame?.lines?.[1] ?? "").length > 0;
  }, null, { timeout: 20_000 });
  await shot("item-use-announcement");
  const duringAnnounce = await actor();
  console.log("DURING_ANNOUNCE", JSON.stringify(duringAnnounce));

  // Reading the announcement lets the effect run: this is where applyPlayerAction() — and its
  // new playPlayerActionClip(10) — fires.
  await tap("Enter");

  // Sample the actor across the whole item use; record the strongest evidence and shoot the
  // frame at which the item-use motion is on screen.
  let motionSeen = false, clip10Seen = false, shotTaken = false;
  const samples = [];
  for (let i = 0; i < 60; i++) {
    const s = await actor();
    samples.push({ t: i, vm: s.vmActive, clip: s.clip, frame: s.frame });
    if (s.vmActive && s.clip === 10) {
      clip10Seen = true;
      if (!shotTaken) { await shot("item-use-motion-clip10"); shotTaken = true; }
    }
    if (s.vmActive) motionSeen = true;
    await page.waitForTimeout(80);
  }
  if (!shotTaken) await shot("item-use-motion-observed");
  const motionSample = samples.find((s) => s.vm && s.clip === 10) ?? null;

  console.log("RESULT", JSON.stringify({
    ok: !failed && clip10Seen,
    before: { vmActive: before.vmActive, clip: before.clip },
    motionSeen,
    clip10Seen,
    motionSample,
    errors,
  }));
} catch (e) {
  await fail(e.message);
  console.log("RESULT", JSON.stringify({ ok: false, error: e.message, errors }));
} finally {
  await browser.close();
}
if (process.env.MOTION_STRICT && failed) process.exit(1);
