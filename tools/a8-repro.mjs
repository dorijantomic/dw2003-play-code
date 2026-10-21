#!/usr/bin/env node
// A8 repro: "Digivolve learned: Greymon" after EVERY battle (animation build, port 8109).
//
// Seeds the walker exactly as web/playtest.html + window.__extraRoster.learnAll() leave it
// (Agumon line, level 30, EXP 25350, current form Raijinmon id 144), then wins two real
// field battles in a row and logs partnerStats.formLedger + localStorage before/after each.
//
// Serve: python3 -m http.server 8109 --directory web
// Run:   tools/run-playwright.sh tools/a8-repro.mjs
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";
import { waitForCommandMenu } from "./verify-battle-wait.mjs";

const ROOT = process.env.A8_ROOT || `${baseUrl(8109)}/`;
const AGUMON = 4, RAIJINMON = 144;

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 800, height: 600 } });
await context.addInitScript(() => {
  localStorage.clear();
  localStorage.setItem("assetMode", "authentic");
  localStorage.setItem("engineSchema", "2");
  localStorage.setItem("progressOrdinal", "3");
  localStorage.setItem("playerName", "A8");
  localStorage.setItem("charId", "p006agum");
  localStorage.setItem("party", JSON.stringify(["p006agum"]));
  localStorage.setItem("packId", "B");
  localStorage.setItem("bits", "1000");
  localStorage.setItem("inventory", "[]");
  const member = {
    digimonId: 144, level: 30, xp: 25350, tp: 30, hp: 900, maxHp: 900, mp: 400, maxMp: 400,
    stats: { str: 200, def: 160, spt: 120, wis: 120, spd: 120, chr: 40 },
    bonuses: {}, elemBonuses: {},
    formLedger: [{ id: 4, formLevel: 5, dvexp: 0, techSlots: [0, 0, 0, 0, 0, 0] }],
    equippedForms: [4, 144, 0],
  };
  localStorage.setItem("partnerStats", JSON.stringify(member));
  localStorage.setItem("partyStats", JSON.stringify([member]));
  localStorage.setItem("equipment", JSON.stringify([{}]));
});
const page = await context.newPage();
page.on("pageerror", (e) => console.error("PAGEERROR", e.message));
page.on("console", (m) => { if (m.type() === "error") console.error("[console]", m.text().slice(0, 200)); });

const tap = async (k, ms = 110) => { await page.keyboard.down(k); await page.waitForTimeout(ms); await page.keyboard.up(k); await page.waitForTimeout(120); };
const results = [];

const snapshot = (label) => page.evaluate((label) => {
  const st = window.__state?.partnerStats;
  const saved = JSON.parse(localStorage.getItem("partnerStats") ?? "null");
  const ids = (o) => (o?.formLedger ?? []).map((r) => Number(r.id));
  return {
    label,
    live: { digimonId: st?.digimonId, level: st?.level, xp: st?.xp, ledger: ids(st), equipped: st?.equippedForms },
    saved: { digimonId: saved?.digimonId, level: saved?.level, xp: saved?.xp, ledger: ids(saved), equipped: saved?.equippedForms },
    party0Same: Array.isArray(window.__state?.partyStats) ? window.__state.partyStats[0] === st : null,
  };
}, label);

async function fight(n) {
  // make sure the field can hand off: no battle, no wipe, no text/choice, no fade
  for (let i = 0; i < 40; i++) {
    const g = await page.evaluate(() => ({
      active: !!window.__battle?.isActive?.(),
      wipe: !!window.__state?.wipe28,
      text: window.__textbox?.isOpen?.() ?? false,
      choice: window.__choice?.isOpen?.() ?? false,
      fade: window.__state?.fade?.dir ?? null,
    }));
    if (!g.active && !g.wipe && !g.text && !g.choice) break;
    if (g.text) await tap("Enter");
    else await page.waitForTimeout(250);
  }
  const before = await snapshot(`battle ${n} before`);
  await page.evaluate(() => window.__fieldToBattle?.());
  const ok = await page.waitForFunction(() => !!window.__battle?.isActive?.(), null, { timeout: 20_000 })
    .then(() => true, () => false);
  if (!ok) throw new Error(`battle ${n}: did not start`);
  await waitForCommandMenu(page, { timeout: 60_000 });
  await page.evaluate(() => {
    const b = window.__battleB();
    b.enemy.hp = 1; b.enemy.maxHp = 1;
    b.player.hp = b.player.maxHp = 9999;
    b.player.str = 900; b.player.spd = 500;
    b.player.mp = b.player.maxMp = 999;
  });
  await page.waitForFunction(() => window.__battleCmdNative?.diagnostics?.().ready === true, null, { timeout: 30_000 }).catch(() => {});
  for (let i = 0; i < 10; i++) {
    const sel = await page.evaluate(() => window.__battleCmdNative?.diagnostics?.().selection ?? 0);
    if (sel === 0) break;
    await tap("ArrowUp");
  }
  await tap("Enter");
  // announce line -> act
  await page.waitForTimeout(700);
  let pages = null;
  const t0 = Date.now();
  while (Date.now() - t0 < 90_000) {
    const s = await page.evaluate(() => {
      const p = window.__battle?.peek?.();
      const b = window.__battleB?.();
      const m = p?.messageLine;
      return {
        active: !!window.__battle?.isActive?.(),
        state: p?.state ?? null,
        holds: !!(m && m.active && !m.finished && (m.holdsTurn || p?.waitsForLine)),
        winPages: b?._winPages?.length ?? 0,
        winMessages: (b?._winPages ?? []).map((x) => x.message),
        unlocked: (b?._winPages ?? []).filter((x) => x.kind === "digivolve" || x.kind === "slot-full").map((x) => x.message),
      };
    });
    if (s.winPages || s.state === 8) { pages = s; break; }
    if (s.holds) await tap("Enter");
    else await page.waitForTimeout(150);
  }
  const during = await snapshot(`battle ${n} at win report`);
  const reportNative = await page.evaluate(() => !!window.__battleB()?._reportNative);
  // Leave the report: read every page with Enter, then the native hand-off if still up.
  for (let i = 0; i < 60; i++) {
    if (!(await page.evaluate(() => window.__battle?.isActive?.()))) break;
    const st = await page.evaluate(() => window.__battle?.peek?.()?.state ?? null);
    if (st === 8) {
      const rn = await page.evaluate(() => !!window.__battleB()?._reportNative);
      if (rn) { await page.evaluate(() => window.__battle.finishNativeReport()); break; }
    }
    await tap("Enter", 80);
  }
  for (let i = 0; i < 100; i++) {
    if (!(await page.evaluate(() => window.__battle?.isActive?.()))) break;
    await page.waitForTimeout(200);
  }
  await page.waitForTimeout(600);
  const after = await snapshot(`battle ${n} after`);
  after.active = await page.evaluate(() => !!window.__battle?.isActive?.());
  const row = { n, reportNative, winPages: pages?.winMessages, unlocked: pages?.unlocked, before, during, after };
  results.push(row);
  console.log(`battle ${n}: native=${reportNative} unlocked=${JSON.stringify((pages?.unlocked ?? []).map((m) => String(m).replace(/\n/g, "|")))}`);
  console.log(`  before ledger ids: ${before.saved.ledger.length} after: ${after.saved.ledger.length} gained ${JSON.stringify(after.saved.ledger.filter((id) => !before.saved.ledger.includes(id)))}`);
  return row;
}

try {
  await page.goto(`${ROOT}?skipTitle=1&map=s320&noEncounters=1`, { waitUntil: "load", timeout: 90_000 });
  await page.waitForFunction(() => window.__state?.started, null, { timeout: 60_000 });
  for (let i = 0; i < 20; i++) {
    if (!(await page.evaluate(() => window.__textbox?.isOpen?.() ?? false))) break;
    await tap("Enter");
  }
  const learned = await page.evaluate(() => window.__extraRoster?.learnAll?.() ?? -1);
  console.log("learnAll added", learned, "forms");
  const seeded = await snapshot("seed after learnAll");
  console.log("seed:", JSON.stringify(seeded));
  const hasGreymon = seeded.live.ledger.includes(12);
  console.log("Greymon(12) in ledger at seed:", hasGreymon);

  const r1 = await fight(1);
  const r2 = await fight(2);
  console.log("\n=== VERDICT ===");
  console.log("battle1 learned:", JSON.stringify((r1.unlocked ?? []).map((m) => String(m).replace(/\n/g, "|"))));
  console.log("battle2 learned:", JSON.stringify((r2.unlocked ?? []).map((m) => String(m).replace(/\n/g, "|"))));
  console.log("battle1 ledger after:", JSON.stringify(r1.after.saved.ledger));
  console.log("battle2 ledger after:", JSON.stringify(r2.after.saved.ledger));
} catch (e) {
  console.error("FATAL", e);
} finally {
  writeFileSync("/home/dorij/scratch-research/a8-repro.json", JSON.stringify(results, null, 1));
  await browser.close();
}
