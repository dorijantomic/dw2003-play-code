// tools/verify_battle_throw_item.mjs — a THROWN item's clip and effect, as a player meets it.
//
// The item machine FIGHTSTG_F0x8008d3b4's state-0 dispatch sends ids 77-90 through the
// 14-word jump table at 0x80082ee4 to eight typed arms (fightstg.s:131-144). Every other id
// takes the default arm (clip 10 + the 0x800a336c table — the sibling item-use fix). The
// walker used to play clip 10 for the whole band; this branch plays the arm's own clip,
// motion, effect and sound.
//
// This script drives the real in-battle ITEM list to use a throw-band item and samples,
// across the whole use:
//   * the player action VM's clip, currentEffect (actor+0x6c) and currentMotion (actor+0x68);
//   * the renderer's effect player instances — the arm's effect type must appear on screen.
// On the parent tip the band played clip 10 with no current effect (nothing spawns).
//
// Run against this worktree's own server:
//   python3 -m http.server 8945 --directory web &
//   VERIFY_PORT=8945 tools/run-playwright.sh tools/verify_battle_throw_item.mjs
//
// Env: VERIFY_ITEM (default 86 ChaosWave -> clip 17, effect 21), VERIFY_EFFECT, VERIFY_CLIP,
// THROWFX_SHOT (screenshot dir), THROWFX_STRICT=1 to exit non-zero on failure.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";
import { waitForCommandMenu } from "./verify-battle-wait.mjs";

const ROOT = process.env.THROWFX_ROOT || `${baseUrl(8945)}/`;
const OUT = process.env.THROWFX_SHOT || "captures/playtest-2026-10-14-throwfx/throw-item-effect";
mkdirSync(OUT, { recursive: true });

const ITEM_ID = Number(process.env.VERIFY_ITEM || 86);      // ChaosWave
const EFFECT  = Number(process.env.VERIFY_EFFECT || 21);
const CLIP    = Number(process.env.VERIFY_CLIP || 17);
const member = (digimonId, level, xp) => ({
  digimonId, level, xp, tp: 10, hp: 5000, maxHp: 5000, mp: 120, maxMp: 120,
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
  localStorage.setItem("inventory", JSON.stringify([{ id: seed.item, qty: 2 }]));
}, { lead: member(1, 20, 0), rena: member(7, 20, 0), pata: member(8, 20, 0), item: ITEM_ID });

const tap = (k) => page.evaluate((kk) => {
  window.dispatchEvent(new KeyboardEvent("keydown", { key: kk }));
  window.dispatchEvent(new KeyboardEvent("keyup", { key: kk }));
}, k);
const shot = async (n) => writeFileSync(`${OUT}/${n}.png`,
  Buffer.from((await page.locator("canvas#game").evaluate((el) => el.toDataURL("image/png"))).split(",")[1],
    "base64"));

// The throw-item evidence off the renderer: the VM's clip, current effect (actor+0x6c) and
// current motion (actor+0x68), and every live effect instance the effect player holds.
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
    currentMotion: a && a.vm ? (a.vm.currentMotion ?? null) : null,
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
  });
  await waitForCommandMenu(page);
  await page.evaluate(() => { const b = window.__battleB(); b.enemy.hp = 99999; b.enemy.maxHp = 99999; });

  // ── BEFORE: idle; no item action has run.
  const before = await probe();
  await shot(`throw-item-${ITEM_ID}-before-idle`);
  console.log("BEFORE", JSON.stringify(before));

  // ── Choose Item (command row 4), then confirm row 0 (the only item in the bag).
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
  // item entry. Sample across the whole typed clip (the op3 spawn lands a couple of seconds in).
  await tap("Enter");
  let clipSeen = false, effectSeen = false, screenSpawnSeen = false, vmEffect = null,
      vmMotion = null, effectShot = false;
  const samples = [];
  for (let i = 0; i < 100; i++) {
    const s = await probe();
    samples.push({ t: i, vm: s.vmActive, clip: s.clip, fx: s.currentEffect, mo: s.currentMotion, types: s.effectTypes });
    if (s.clip === CLIP) clipSeen = true;
    if (s.currentEffect === EFFECT) vmEffect = s.currentEffect;
    if (s.currentMotion != null) vmMotion = s.currentMotion;
    if (s.effectTypes.includes(EFFECT)) {
      effectSeen = true;
      if (s.screenSpawns.some((x) => x.type === EFFECT)) screenSpawnSeen = true;
      if (!effectShot) { await shot(`throw-item-${ITEM_ID}-on-screen`); effectShot = true; }
    }
    await page.waitForTimeout(100);
  }
  if (!effectShot) await shot(`throw-item-${ITEM_ID}-observed`);
  const effectSample = samples.find((s) => s.types.includes(EFFECT)) ?? null;
  const clipSample = samples.find((s) => s.clip === CLIP) ?? null;

  console.log("RESULT", JSON.stringify({
    ok: !failed && clipSeen && effectSeen && screenSpawnSeen && vmEffect === EFFECT,
    item: ITEM_ID,
    expectedClip: CLIP,
    expectedEffect: EFFECT,
    before: { clip: before.clip, currentEffect: before.currentEffect, effectTypes: before.effectTypes },
    duringAnnounce: { clip: duringAnnounce.clip, currentEffect: duringAnnounce.currentEffect },
    vmEffect,
    vmMotion,
    clipSeen,
    effectSeen,
    screenSpawnSeen,
    clipSample,
    effectSample,
    errors,
  }));
} catch (e) {
  await fail(e.message);
  console.log("RESULT", JSON.stringify({ ok: false, error: e.message, errors }));
} finally {
  await browser.close();
}
if (process.env.THROWFX_STRICT && failed) process.exit(1);
