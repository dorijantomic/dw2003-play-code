#!/usr/bin/env node
// A8 repro v2: two real wins in a row with the results hand-off captured.
//
// The battle's own report hand-off is replaced from the page with one that records the
// win pages (the list web/battle.js:446 turns into "Digivolve learned: <name>") and then
// returns false, so the inline report draws them and Enter closes it exactly as the
// fallback route does. That isolates the walker's own data from the translated screen.
//
// Serve: python3 -m http.server 8109 --directory web
// Run:   tools/run-playwright.sh tools/a8-repro2.mjs
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";
import { waitForCommandMenu } from "./verify-battle-wait.mjs";

const ROOT = process.env.A8_ROOT || `${baseUrl(8109)}/`;
const PARTY = (process.env.A8_PARTY || "p006agum").split(",");

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 800, height: 600 } });
await context.addInitScript((party) => {
  localStorage.clear();
  localStorage.setItem("assetMode", "authentic");
  localStorage.setItem("engineSchema", "2");
  localStorage.setItem("progressOrdinal", "3");
  localStorage.setItem("playerName", "A8");
  localStorage.setItem("charId", party[0]);
  localStorage.setItem("party", JSON.stringify(party));
  localStorage.setItem("packId", "B");
  localStorage.setItem("bits", "1000");
  localStorage.setItem("inventory", "[]");
  const member = (digimonId) => ({
    digimonId, level: 30, xp: 25350, tp: 30, hp: 900, maxHp: 900, mp: 400, maxMp: 400,
    stats: { str: 200, def: 160, spt: 120, wis: 120, spd: 120, chr: 40 },
    bonuses: {}, elemBonuses: {},
    formLedger: [{ id: digimonId === 144 ? 4 : digimonId, formLevel: 5, dvexp: 0, techSlots: [0, 0, 0, 0, 0, 0] }],
    equippedForms: [digimonId === 144 ? 4 : digimonId, 144, 0],
  });
  localStorage.setItem("partnerStats", JSON.stringify(member(144)));
  localStorage.setItem("partyStats", JSON.stringify(party.map((_, i) => member(i === 0 ? 144 : 9 + i))));
  localStorage.setItem("equipment", JSON.stringify(party.map(() => ({}))));
}, PARTY);
const page = await context.newPage();
page.on("pageerror", (e) => console.error("PAGEERROR", e.message));
page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) console.error("[console]", m.text().slice(0, 200)); });

const tap = async (k, ms = 90) => { await page.keyboard.down(k); await page.waitForTimeout(ms); await page.keyboard.up(k); await page.waitForTimeout(90); };
const results = [];

const snap = (label) => page.evaluate((label) => {
  const st = window.__state?.partnerStats;
  const saved = JSON.parse(localStorage.getItem("partnerStats") ?? "null");
  const ids = (o) => (o?.formLedger ?? []).map((r) => Number(r.id));
  return { label, live: { xp: st?.xp, level: st?.level, ledger: ids(st) }, saved: { xp: saved?.xp, level: saved?.level, ledger: ids(saved) },
    active: !!window.__battle?.isActive?.() };
}, label);

async function waitField() {
  for (let i = 0; i < 80; i++) {
    const g = await page.evaluate(() => ({
      active: !!window.__battle?.isActive?.(), wipe: !!window.__state?.wipe28,
      text: window.__textbox?.isOpen?.() ?? false, choice: window.__choice?.isOpen?.() ?? false,
    }));
    if (!g.active && !g.wipe && !g.text && !g.choice) return true;
    if (g.text) await tap("Enter"); else await page.waitForTimeout(200);
  }
  return false;
}

async function fight(n) {
  await waitField();
  const before = await snap(`battle ${n} before`);
  await page.evaluate(() => window.__fieldToBattle?.());
  await page.waitForFunction(() => !!window.__battle?.isActive?.(), null, { timeout: 25_000 });
  await waitForCommandMenu(page, { timeout: 60_000 });
  await page.evaluate(() => {
    const b = window.__battleB();
    b.enemy.hp = 1; b.enemy.maxHp = 1;
    b.player.hp = b.player.maxHp = 9999; b.player.str = 900; b.player.spd = 500; b.player.mp = b.player.maxMp = 999;
  });
  await page.waitForFunction(() => window.__battleCmdNative?.diagnostics?.().ready === true, null, { timeout: 30_000 }).catch(() => {});
  for (let i = 0; i < 10; i++) {
    if ((await page.evaluate(() => window.__battleCmdNative?.diagnostics?.().selection ?? 0)) === 0) break;
    await tap("ArrowUp");
  }
  await tap("Enter");
  // Read lines / pages until the battle is gone.
  const t0 = Date.now();
  while (Date.now() - t0 < 150_000) {
    const s = await page.evaluate(() => {
      const p = window.__battle?.peek?.();
      const m = p?.messageLine;
      return { active: !!window.__battle?.isActive?.(), state: p?.state ?? null,
        holds: !!(m && m.active && !m.finished && (m.holdsTurn || p?.waitsForLine)) };
    });
    if (!s.active) break;
    if (s.holds || s.state === 8 || s.state === 7) await tap("Enter");
    else await page.waitForTimeout(150);
  }
  await page.waitForTimeout(500);
  const after = await snap(`battle ${n} after`);
  const captured = await page.evaluate(() => window.__a8 ?? []);
  const row = { n, before, after, captured };
  results.push(row);
  const last = captured[captured.length - 1] ?? {};
  console.log(`battle ${n}: after.active=${after.active} xp ${before.saved.xp}->${after.saved.xp} ledger ${before.saved.ledger.length}->${after.saved.ledger.length}`);
  console.log(`  pages: ${JSON.stringify((last.pages ?? []).map((m) => String(m).replace(/\n/g, "|")))}`);
  console.log(`  pre-battle ledger in that report: ${JSON.stringify(last.progress ?? [])}`);
  return row;
}

try {
  await page.goto(`${ROOT}?skipTitle=1&map=s320&noEncounters=1`, { waitUntil: "load", timeout: 90_000 });
  await page.waitForFunction(() => window.__state?.started, null, { timeout: 60_000 });
  await page.evaluate(() => {
    // Replace the results hand-off with a recorder that always takes the inline route.
    window.__a8 = [];
    window.__battle.setReportHandoff({ open: (b) => {
      window.__a8.push({
        pages: (b._winPages ?? []).map((p) => p.message),
        progress: (b._winProgress ?? []).map((p) => ({ index: p.index, formId: p.formId,
          beforeLedger: (p.before?.formLedger ?? []).map((r) => Number(r.id)) })),
        native: !!b._reportNative,
      });
      return false;
    } });
  });
  for (let i = 0; i < 20; i++) {
    if (!(await page.evaluate(() => window.__textbox?.isOpen?.() ?? false))) break;
    await tap("Enter");
  }
  console.log("learnAll:", await page.evaluate(() => window.__extraRoster?.learnAll?.() ?? -1));
  console.log("seed:", JSON.stringify((await snap("seed")).saved.ledger.length), "forms; has 12:", (await snap("seed")).saved.ledger.includes(12));
  const r1 = await fight(1);
  const r2 = await fight(2);
  console.log("\nVERDICT: battle1 pages vs battle2 pages (digivolve rows)");
  for (const r of [r1, r2]) {
    const pages = (r.captured[r.captured.length - 1]?.pages ?? []).filter((m) => /Digivolve/.test(m));
    console.log(` battle ${r.n}: ${JSON.stringify(pages.map((m) => String(m).replace(/\n/g, "|")))} ledger ${r.after.saved.ledger.length}`);
  }
} catch (e) {
  console.error("FATAL", e);
} finally {
  writeFileSync("/home/dorij/scratch-research/a8-repro2.json", JSON.stringify(results, null, 1));
  await browser.close();
}
