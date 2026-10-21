#!/usr/bin/env node
// K19e — the same technique through the IN-GAME battle path (web/index.html, port 8130):
// window.__fieldToBattle() with a partner whose BODY CLASS matches the exemplar's, casting the exemplar's
// technique from the real Fight -> Tech menu. The solver scope is set inside the page for that one pair
// (an out-of-slice experiment: the shipped default is off; a control run with the scope off is included).
//
//   tools/run-playwright.sh tools/k19e_real_battle.mjs
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { waitForCommandMenu } from "./verify-battle-wait.mjs";

const PORT = 8130;
const ROOT = `http://127.0.0.1:${PORT}`;
const OUT = "/home/dorij/scratch-research/anim-k19e-real-battle.json";
const CASES = [
  { name: "Agumon", species: 4, folder: "m003agum", techId: 153, tech: "Air Blast", cls: "mouth", solver: true },
  { name: "Monmon", species: 3, folder: "m384koet", techId: 151, tech: "Snowstorm", cls: "hand", solver: true },
  { name: "Monmon", species: 3, folder: "m384koet", techId: 151, tech: "Snowstorm", cls: "hand", solver: false, control: true },
  { name: "Armormon", species: 21, folder: "m390aslt", techId: 167, tech: "Darkness Chaos", cls: "prop", solver: true, authored: true },
];
// the game's own encounter map needs a reachable map id; s320 is what the A4 verifier uses (a field map)
const member = (digimonId, techId) => ({
  digimonId, level: 40, xp: 0, tp: 30, hp: 1200, maxHp: 1200, mp: 999, maxMp: 999,
  stats: { str: 200, def: 120, spt: 90, wis: 90, spd: 90, chr: 30 },
  bonuses: {}, elemBonuses: {},
  equippedForms: [digimonId, 0, 0],
  formLedger: [{ id: digimonId, formLevel: 5, dvexp: 0, techSlots: [techId, 0, 0, 0, 0, 0] }],
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tap = async (page, key, ms = 90) => { await page.keyboard.down(key); await page.waitForTimeout(ms); await page.keyboard.up(key); await page.waitForTimeout(80); };

const browser = await chromium.launch({ headless: true });
const rows = [];
for (const c of CASES) {
  const context = await browser.newContext({ viewport: { width: 800, height: 600 } });
  await context.addInitScript((seed) => {
    localStorage.clear();
    localStorage.setItem("assetMode", "authentic");
    localStorage.setItem("engineSchema", "2");
    localStorage.setItem("progressOrdinal", "3");
    localStorage.setItem("playerName", "Review");
    localStorage.setItem("charId", "p005koet");
    localStorage.setItem("party", JSON.stringify(["p005koet"]));
    localStorage.setItem("packId", "B");
    localStorage.setItem("bits", "1000");
    localStorage.setItem("inventory", JSON.stringify([{ id: 43, qty: 5 }]));
    localStorage.setItem("partnerStats", JSON.stringify(seed));
    localStorage.setItem("partyStats", JSON.stringify([seed]));
    localStorage.setItem("equipment", JSON.stringify([{}]));
  }, member(c.species, c.techId));
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message)));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push("console: " + m.text().slice(0, 160)); });
  const row = { ...c, link: `${ROOT}/?skipTitle=1&map=s320&noEncounters=1` };
  try {
    await page.goto(row.link, { waitUntil: "load", timeout: 90000 });
    await page.waitForFunction(() => window.__state?.started, null, { timeout: 60000 });
    for (let i = 0; i < 20; i++) {
      const open = await page.evaluate(() => window.__textbox?.isOpen?.() ?? false);
      if (!open) break;
      await tap(page, "Enter");
    }
    // the solver scope for THIS pair (or explicitly off for the control)
    row.scope = await page.evaluate(async ({ folder, tech, on }) => {
      const m = await import("/fight/anim-solver.js");
      return JSON.stringify(m.setSolverScope(on ? [{ folder, tech }] : null));
    }, { folder: c.folder, tech: c.tech, on: c.solver });
    // the game's own field -> battle handoff
    await page.evaluate(() => window.__fieldToBattle?.());
    const startedVia = await page.waitForFunction(() => !!window.__battle?.isActive?.(), null, { timeout: 20000 })
      .then(() => "field", () => "none");
    await waitForCommandMenu(page, { timeout: 60000 });
    // keep both fighters alive so the turn can finish; no damage shortcuts on the player's side
    const who = await page.evaluate(() => {
      const b = window.__battleB();
      b.enemy.hp = 99999; b.enemy.maxHp = 99999;
      b.player.maxHp = 9999; b.player.hp = 9499; b.player.mp = 999; b.player.maxMp = 999;
      b.player.str = 800; b.player.def = 800; b.player.spd = 400; b.player.spt = 400;
      return { player: b.player.profile?.name, id: b.player.profile?.id, enemy: b.enemy.profile?.name ?? b.enemy.eStats?.digimon_id ?? null };
    });
    row.startedVia = startedVia;
    row.who = who;
    const techList = await page.evaluate(() => window.__battleTechNative?.diagnostics?.() ?? null);
    // Fight -> Tech
    const before = await page.evaluate(() => ({ enemyHp: window.__battleB().enemy.hp }));
    await tap(page, "ArrowDown");           // Fight -> Tech
    await tap(page, "Enter");
    await page.waitForFunction(() => window.__battleTechNative?.diagnostics?.().ready === true, null, { timeout: 20000 });
    const techs = await page.evaluate(() => window.__battleTechNative?.diagnostics?.() ?? null);
    await tap(page, "Enter");
    await page.waitForFunction(() => {
      const p = window.__battle?.peek?.();
      const m = p?.messageLine;
      return !!(m && m.active && !m.finished && (m.holdsTurn || p?.waitsForLine));
    }, null, { timeout: 15000 }).catch(() => {});
    await tap(page, "Enter");
    const started = await page.waitForFunction(() => {
      const a = window.__battle3d?.playerAnimator;
      return !!(a && a.vm && !a.vm.ended);
    }, null, { timeout: 15000 }).then(() => true, () => false);
    // read the ops the VM is actually running + the solver's own record, while the action runs
    const during = await page.evaluate(() => {
      const a = window.__battle3d?.playerAnimator;
      const casts = a?.model?.solverCasts ?? {};
      const first = Object.values(casts)[0] ?? null;
      return {
        ops: (a?.vm?.ops ?? []).map((o) => `${o.op}[${(o.words ?? []).join(",")}]`),
        solverTable: first?.table ?? null,
        report: first?.report ? { cls: first.report.cls, mode: first.report.mode, worstAim: +first.report.worstAim.toFixed(2), gate: first.report.gate } : null,
        bakes: a?.model?.__solverBakes ?? 0,
        table: a?.timelineTable ?? null,
        clip: a?._clip ?? null,
      };
    });
    // run the action out
    let active = true, guard = 0, tables = new Set();
    while (active && guard++ < 900) {
      const s = await page.evaluate(() => ({ active: !!window.__battle3d?.coordinator?.active, table: window.__battle3d?.playerAnimator?.timelineTable }));
      if (s.table != null) tables.add(s.table);
      active = s.active;
      if (active) await page.waitForTimeout(60);
    }
    await sleep(700);
    const after = await page.evaluate(() => {
      const a = window.__battle3d?.playerAnimator, b = window.__battleB();
      return { enemyHp: b.enemy.hp, msg: (b.message ?? "").slice(0, 120), state: b.state,
        vmActive: !!(a?.vm && !a.vm.ended), table: a?.timelineTable ?? null,
        solverCasts: Object.keys(a?.model?.solverCasts ?? {}) };
    });
    // get back to the command menu (the turn must complete)
    let back = false;
    for (let i = 0; i < 200 && !back; i++) {
      const s = await page.evaluate(() => {
        const p = window.__battle?.peek?.();
        const m = p?.messageLine;
        return { menu: p?.state === 2 && !!p?.commandList?.active && p?.loaderOpen === false, holds: !!(m && m.active && !m.finished), state: p?.state,
          active: !!window.__battle?.isActive?.() };
      });
      if (s.menu) { back = true; break; }
      if (!s.active) { back = true; break; }
      if (s.holds) await tap(page, "Enter"); else await page.waitForTimeout(250);
    }
    row.before = before;
    row.techList = techs ?? techList;
    row.started = started;
    row.during = during;
    row.tablesBound = [...tables];
    row.after = after;
    row.backToMenu = back;
    row.damage = before.enemyHp - after.enemyHp;
  } catch (e) {
    row.error = String(e.message || e).slice(0, 300);
  }
  row.pageErrors = errors.slice(0, 5);
  rows.push(row);
  await context.close();
  const d = row.during || {}, a = row.after || {};
  console.log(`${c.name} ${c.cls} "${c.tech}" solver=${c.solver}: scope=${row.scope} start=${row.started} bakes=${d.bakes} solverTable=${d.solverTable} ops=${d.ops?.length} ` +
    `tables=${JSON.stringify(row.tablesBound)} damage=${row.damage} back=${row.backToMenu} vmEnded=${!a.vmActive} errors=${row.pageErrors.length}${row.error ? " ERR " + row.error : ""}`);
  if (row.pageErrors.length) console.log("   errors:", row.pageErrors.join(" | "));
}
await browser.close();
mkdirSync("/home/dorij/scratch-research", { recursive: true });
writeFileSync(OUT, JSON.stringify({ run: new Date().toISOString(), port: PORT, rows }, null, 1));
console.log("wrote", OUT);
