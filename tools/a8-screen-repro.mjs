#!/usr/bin/env node
// A8 screen repro: the REAL translated results screen (pro/stfgtrep) over two wins in a row.
// Seeds the report's scenario (partner at level 30, current form an extra form, every extra form
// learned), then after each win reads the screen's own text widgets and the walker's saved ledger.
// Prints, per battle: the walker's new ledger entries and every "Digivolve learned" the screen
// showed. Serves: python3 -m http.server 8109 --directory web
// Run:    tools/run-playwright.sh tools/a8-screen-repro.mjs
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

const ledger = () => page.evaluate(() => ({
  live: (window.__state?.partnerStats?.formLedger ?? []).map((r) => Number(r.id)),
  saved: (JSON.parse(localStorage.getItem("partnerStats") ?? "null")?.formLedger ?? []).map((r) => Number(r.id)),
}));

/** The translated screen's visible text, decoded from its own text widgets. */
const screenText = () => page.evaluate(async () => {
  const screen = window.__reportNative;
  if (!screen?.isOpen?.()) return null;
  const { decodeNativeText } = await import("/native-screen-text.js");
  const out = [];
  for (const w of screen.textWidgets?.() ?? []) {
    for (const line of w.lines ?? []) {
      if (!line?.bytes?.length) continue;
      try { const t = decodeNativeText(line.bytes).text; if (t) out.push(t); } catch { /* unknown glyph */ }
    }
  }
  return out;
});

async function waitField() {
  for (let i = 0; i < 80; i++) {
    const g = await page.evaluate(() => ({
      active: !!window.__battle?.isActive?.(), wipe: !!window.__state?.wipe28,
      text: window.__textbox?.isOpen?.() ?? false, choice: window.__choice?.isOpen?.() ?? false,
      report: !!window.__reportNative?.isOpen?.(),
    }));
    if (!g.active && !g.wipe && !g.text && !g.choice && !g.report) return true;
    if (g.text) await tap("Enter"); else await page.waitForTimeout(200);
  }
  return false;
}

/** Run the real results screen to its close, returning every distinct text it showed. */
async function playReport() {
  const seen = new Set();
  const t0 = Date.now();
  let pages = 0;
  let stuck = 0;
  let last = "";
  while (Date.now() - t0 < 120_000) {
    const open = await page.evaluate(() => !!window.__reportNative?.isOpen?.());
    if (!open) break;
    const texts = await screenText();
    if (texts) {
      const before = seen.size;
      for (const t of texts) seen.add(t);
      if (seen.size !== before) { pages++; stuck = 0; }
      const sig = texts.join("|");
      if (sig === last) stuck++; else { stuck = 0; last = sig; }
      if (stuck > 40) { console.log("  [report stuck on]", JSON.stringify(texts)); break; }
    }
    await tap("Enter", 120);
    await page.waitForTimeout(100);
  }
  const diag = await page.evaluate(() => {
    const d = window.__reportNative?.diagnostics?.();
    return d ? { open: d.open, state: d.state, rows: d.rows } : null;
  });
  return { texts: [...seen], sampledPages: pages, diag, open: await page.evaluate(() => !!window.__reportNative?.isOpen?.()) };
}

async function fight(n) {
  await waitField();
  const before = await ledger();
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
  const t0 = Date.now();
  const reportSeen = new Set();
  const learnedFrames = [];
  while (Date.now() - t0 < 150_000) {
    const s = await page.evaluate(() => {
      const p = window.__battle?.peek?.();
      const m = p?.messageLine;
      return { active: !!window.__battle?.isActive?.(), state: p?.state ?? null,
        holds: !!(m && m.active && !m.finished && (m.holdsTurn || p?.waitsForLine)),
        report: !!window.__reportNative?.isOpen?.() };
    });
    if (s.report) {
      const texts = await screenText();
      if (texts) {
        for (const t of texts) reportSeen.add(t);
        if (texts.some((t) => /Digivolve learned/i.test(t))) learnedFrames.push(texts);
      }
      await tap("Enter", 120);
      await page.waitForTimeout(80);
      continue;
    }
    if (!s.active) break;
    if (s.holds || s.state === 8 || s.state === 7) await tap("Enter");
    else await page.waitForTimeout(150);
  }
  const report = { texts: [...reportSeen], sampledPages: reportSeen.size,
    open: await page.evaluate(() => !!window.__reportNative?.isOpen?.()) };
  await waitField();
  const after = await ledger();
  const added = after.saved.filter((id) => !before.saved.includes(id));
  const learned = report.texts.filter((t) => /Digivolve|learned/i.test(t));
  const row = { n, beforeLen: before.saved.length, afterLen: after.saved.length, added, learned, learnedFrames, report };
  results.push(row);
  console.log(`battle ${n}: ledger ${before.saved.length}->${after.saved.length}, walker added ${JSON.stringify(added)}`);
  console.log(`  screen learned rows: ${JSON.stringify(learned)}`);
  for (const f of learnedFrames) console.log(`  learned frame: ${JSON.stringify(f.filter((t) => !/^(EXP|LV|BIT|HP|MP|[0-9]+)$/.test(t)))}`);
  return row;
}

try {
  await page.goto(`${ROOT}?skipTitle=1&map=s320&noEncounters=1`, { waitUntil: "load", timeout: 90_000 });
  await page.waitForFunction(() => window.__state?.started, null, { timeout: 60_000 });
  for (let i = 0; i < 20; i++) {
    if (!(await page.evaluate(() => window.__textbox?.isOpen?.() ?? false))) break;
    await tap("Enter");
  }
  console.log("learnAll:", await page.evaluate(() => window.__extraRoster?.learnAll?.() ?? -1));
  const seed = await ledger();
  console.log("seed ledger:", seed.saved.length, "forms; has 12:", seed.saved.includes(12));
  const r1 = await fight(1);
  const r2 = await fight(2);
  const repeat = r2.learned.some((t) => /\bGreymon\b/.test(t)) && r2.added[0] !== 12;
  console.log("\nVERDICT:");
  for (const r of [r1, r2]) console.log(` battle ${r.n}: walker added ${JSON.stringify(r.added)}; screen said ${JSON.stringify(r.learned)}`);
  console.log(` repeat of an already-owned form in battle 2: ${repeat ? "YES (BUG)" : "no"}`);
} catch (e) {
  console.error("FATAL", e);
} finally {
  writeFileSync("/home/dorij/scratch-research/a8-screen-repro.json", JSON.stringify(results, null, 1));
  await browser.close();
}
