// tools/verify_battle_item_use_effect.mjs — the item-use EFFECT, as a player meets it.
//
// The battle-FX audit's named gap (2026-10-14): using an item showed no effect sprite. The item
// machine FIGHTSTG_F0x8008d3b4's default arm writes the used item's record from the 0x800a336c
// table into actor+0x6c (effect) / +0x70 (sound) (fightstg.s .L0x8008d8c0-.L0x8008d934), and
// clip 10's own op3 9999 spawn at (0,0,32767) reads +0x6c. The walker's item path passed no
// current effect, so the spawn was skipped.
//
// This script drives the real in-battle ITEM list to use Power Charge (item 43, -> effect 33)
// and samples, across the whole item use:
//   * the player action VM's currentEffect (actor+0x6c) — must become 33;
//   * the renderer's effect player instances — a type-33 screen-space spawn must appear.
// On the parent tip both stay empty. It prints a RESULT json and never fails, so the same
// script produces the before and the after capture.
//
// Run against this worktree's own server:
//   python3 -m http.server 8944 --directory web &
//   VERIFY_PORT=8944 tools/run-playwright.sh tools/verify_battle_item_use_effect.mjs
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";
import { waitForCommandMenu } from "./verify-battle-wait.mjs";

const ROOT = process.env.ITEMFX_ROOT || `${baseUrl(8945)}/`;
const OUT = process.env.ITEMFX_SHOT || "captures/playtest-2026-10-14-itemfx/item-use-effect";
mkdirSync(OUT, { recursive: true });

const ITEM_ID = 43;          // Power Charge — row 0 of the in-battle ITEM list; record: eff 33
const EFFECT = 33;
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

// The item-use evidence off the renderer: the VM's current effect (actor+0x6c) and every live
// effect instance (type + spawn position) the effect player holds this frame.
const probe = () => page.evaluate(() => {
  const r = window.__battle3d;
  const a = r && r.playerAnimator;
  const fx = r && r.effectPlayer;
  const instances = (fx && fx.instances) || [];
  return {
    hasRenderer: !!r,
    vmActive: !!(a && a.vm && !a.vm.ended),
    clip: a ? (a._clip ?? null) : null,
    currentEffect: a && a.vm ? (a.vm.currentEffect ?? null) : null,
    effectTypes: instances.map((i) => i.type),
    screenSpawns: instances.filter((i) => i.screen).map((i) => ({ type: i.type, z: i.pos?.z })),
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

  // ── BEFORE: idle; no item action has run.
  const before = await probe();
  await shot("item-use-effect-before-idle");
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
  const duringAnnounce = await probe();
  console.log("DURING_ANNOUNCE", JSON.stringify(duringAnnounce));

  // Reading the announcement lets the effect run: this is where applyPlayerAction() fires the
  // item entry. Sample across the whole clip-10 script (its op3 spawn lands ~2s in at 60 Hz).
  await tap("Enter");
  let effectSeen = false, screenSpawnSeen = false, effectShot = false, vmEffect = null;
  const samples = [];
  for (let i = 0; i < 100; i++) {
    const s = await probe();
    samples.push({ t: i, vm: s.vmActive, clip: s.clip, fx: s.currentEffect, types: s.effectTypes });
    if (s.currentEffect === EFFECT) vmEffect = s.currentEffect;
    if (s.effectTypes.includes(EFFECT)) {
      effectSeen = true;
      if (s.screenSpawns.some((x) => x.type === EFFECT)) screenSpawnSeen = true;
      if (!effectShot) { await shot("item-use-effect-on-screen"); effectShot = true; }
    }
    await page.waitForTimeout(100);
  }
  if (!effectShot) await shot("item-use-effect-observed");
  const effectSample = samples.find((s) => s.types.includes(EFFECT)) ?? null;

  console.log("RESULT", JSON.stringify({
    ok: !failed && effectSeen && screenSpawnSeen && vmEffect === EFFECT,
    item: ITEM_ID,
    expectedEffect: EFFECT,
    before: { currentEffect: before.currentEffect, effectTypes: before.effectTypes },
    vmEffect,
    effectSeen,
    screenSpawnSeen,
    effectSample,
    errors,
  }));
} catch (e) {
  await fail(e.message);
  console.log("RESULT", JSON.stringify({ ok: false, error: e.message, errors }));
} finally {
  await browser.close();
}
if (process.env.ITEMFX_STRICT && failed) process.exit(1);
