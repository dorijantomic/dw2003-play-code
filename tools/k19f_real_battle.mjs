#!/usr/bin/env node
// K19f item 9: the PROP class through the REAL battle path (port 8131).
//   near  — the player's partner is a PROP body (BKMegaGargomon, extra species 184) casting a clip-9
//           technique its model has NO authored clip for (Flame Ball 137): the gap path calls O3.
//   far   — the same battle with the ENEMY swapped to the prop model (battle3d.setEnemyDigimon) and the
//           enemy's own attack animation fired, so the far-side actor (turn = enemy, mirrored ops) casts it.
// A solver-OFF control of the near case gives the damage parity check.
//   python3 -m http.server 8131 --directory web &   then
//   tools/run-playwright.sh tools/k19f_real_battle.mjs
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { waitForCommandMenu } from "./verify-battle-wait.mjs";

const PORT = Number(process.env.VERIFY_PORT || 8131);
const ROOT = `http://127.0.0.1:${PORT}`;
const OUT = "/home/dorij/scratch-research/k19f/real-battle.json";
const FOLDER = "m443sgr2";             // the PROP body that solves (Flame Ball, clip 9 gap)
const TECH = "Flame Ball";
const TECH_ID = 137;
const CASES = [
  { name: "BKMegaGargomon", species: 184, side: "near", solver: true },
  { name: "BKMegaGargomon", species: 184, side: "near", solver: false, control: true },
  { name: "BKMegaGargomon", species: 184, side: "far", solver: true },
];
const member = (digimonId, techId) => ({
  digimonId, level: 40, xp: 0, tp: 30, hp: 1200, maxHp: 1200, mp: 999, maxMp: 999,
  stats: { str: 200, def: 120, spt: 90, wis: 90, spd: 90, chr: 30 },
  bonuses: {}, elemBonuses: {},
  equippedForms: [digimonId, 0, 0],
  formLedger: [{ id: digimonId, formLevel: 5, dvexp: 0, techSlots: [techId, 0, 0, 0, 0, 0] }],
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tap = async (page, key, ms = 90) => { await page.keyboard.down(key); await page.waitForTimeout(ms); await page.keyboard.up(key); await page.waitForTimeout(80); };
const brief = (r) => ({
  ok: r?.report ? { cls: r.report.cls, mode: r.report.mode, aim: +r.report.worstAim.toFixed(2), gate: r.report.gate,
    pen: r.report.penetration?.badTicks, ground: r.report.ground?.rise ?? r.report.ground } : null,
  table: r?.table ?? null, launch: r?.launch ?? null,
});

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
  }, member(c.species, TECH_ID));
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
    row.scope = await page.evaluate(async ({ folder, tech, on }) => {
      const m = await import("/fight/anim-solver.js");
      return JSON.stringify(m.setSolverScope(on ? [{ folder, tech }] : null));
    }, { folder: FOLDER, tech: TECH, on: c.solver });
    await page.evaluate(() => window.__fieldToBattle?.());
    await page.waitForFunction(() => !!window.__battle?.isActive?.(), null, { timeout: 20000 });
    await waitForCommandMenu(page, { timeout: 60000 });
    row.who = await page.evaluate(() => {
      const b = window.__battleB();
      b.enemy.hp = 99999; b.enemy.maxHp = 99999;
      b.player.maxHp = 9999; b.player.hp = 9499; b.player.mp = 999; b.player.maxMp = 999;
      b.player.str = 800; b.player.def = 800; b.player.spd = 400; b.player.spt = 400;
      return { player: b.player.profile?.name, id: b.player.profile?.id, enemy: b.enemy.profile?.name ?? b.enemy.eStats?.digimon_id ?? null };
    });
    row.playerFolder = await page.evaluate(() => window.__battle3d?.playerAnimator?.model?.folder ?? null);
    if (c.side === "near") {
      const before = await page.evaluate(() => ({ enemyHp: window.__battleB().enemy.hp }));
      await tap(page, "ArrowDown");
      await tap(page, "Enter");
      await page.waitForFunction(() => window.__battleTechNative?.diagnostics?.().ready === true, null, { timeout: 20000 });
      row.techList = await page.evaluate(() => window.__battleTechNative?.diagnostics?.() ?? null);
      await tap(page, "Enter");
      await page.waitForFunction(() => {
        const p = window.__battle?.peek?.();
        const m = p?.messageLine;
        return !!(m && m.active && !m.finished && (m.holdsTurn || p?.waitsForLine));
      }, null, { timeout: 15000 }).catch(() => {});
      await tap(page, "Enter");
      await page.waitForFunction(() => {
        const a = window.__battle3d?.playerAnimator;
        return !!(a && a.vm && !a.vm.ended);
      }, null, { timeout: 15000 }).then(() => (row.started = true), () => (row.started = false));
      row.during = await page.evaluate(() => {
        const a = window.__battle3d?.playerAnimator;
        const casts = a?.model?.solverCasts ?? {};
        const first = Object.values(casts)[0] ?? null;
        return { ops: (a?.vm?.ops ?? []).length, solver: first ? { table: first.table, report: first.report } : null,
          bakes: a?.model?.__solverBakes ?? 0, table: a?.timelineTable ?? null };
      });
      row.solved = brief(row.during.solver);
      let active = true, guard = 0;
      while (active && guard++ < 900) {
        active = !!(await page.evaluate(() => !!window.__battle3d?.coordinator?.active));
        if (active) await page.waitForTimeout(60);
      }
      await sleep(500);
      row.after = await page.evaluate(() => ({ enemyHp: window.__battleB().enemy.hp, msg: (window.__battleB().message ?? "").slice(0, 100),
        vmActive: !!(window.__battle3d?.playerAnimator?.vm && !window.__battle3d.playerAnimator.vm.ended) }));
      row.damage = before.enemyHp - row.after.enemyHp;
    } else {
      // FAR: swap the enemy model to the prop body, then fire its own attack with the same technique
      row.swap = await page.evaluate(async ({ folder }) => {
        window.__battle3d.setEnemyDigimon(folder);
        for (let i = 0; i < 120; i++) {
          const a = window.__battle3d?.enemyAnimator;
          if (a?.model?.folder === folder) return a.model.folder;
          await new Promise((r) => setTimeout(r, 100));
        }
        return window.__battle3d?.enemyAnimator?.model?.folder ?? null;
      }, { folder: FOLDER });
      row.enemyFolder = await page.evaluate(() => window.__battle3d?.enemyAnimator?.model?.folder ?? null);
      const before = await page.evaluate(() => ({ playerHp: window.__battleB().player.hp }));
      row.farStarted = await page.evaluate((tech) => window.__battle3d.enemyAttack(tech), TECH_ID);
      await page.waitForTimeout(600);
      row.during = await page.evaluate(() => {
        const a = window.__battle3d?.enemyAnimator;
        const casts = a?.model?.solverCasts ?? {};
        const first = Object.values(casts)[0] ?? null;
        return { ops: (a?.vm?.ops ?? []).length, solver: first ? { table: first.table, report: first.report } : null,
          bakes: a?.model?.__solverBakes ?? 0, table: a?.timelineTable ?? null,
          vm: a?.vm ? { ended: !!a.vm.ended, n: a.vm.ops?.length ?? 0 } : null };
      });
      row.solved = brief(row.during.solver);
      let active = true, guard = 0;
      while (active && guard++ < 900) {
        active = !!(await page.evaluate(() => !!window.__battle3d?.coordinator?.active));
        if (active) await page.waitForTimeout(60);
      }
      await sleep(400);
      row.after = await page.evaluate(() => ({ playerHp: window.__battleB().player.hp,
        vmEnded: !!window.__battle3d?.enemyAnimator?.vm?.ended, table: window.__battle3d?.enemyAnimator?.timelineTable ?? null }));
      row.damage = before.playerHp - row.after.playerHp;
    }
  } catch (e) {
    row.error = String(e.message || e).slice(0, 300);
  }
  row.pageErrors = errors.slice(0, 5);
  rows.push(row);
  await context.close();
  console.log(JSON.stringify({ name: c.name, side: c.side, solver: c.solver, folder: row.playerFolder, enemyFolder: row.enemyFolder ?? null,
    started: row.started ?? row.farStarted, solverTable: row.during?.solver?.table ?? null, bakes: row.during?.bakes ?? null,
    solved: row.solved, damage: row.damage ?? null, error: row.error ?? null, pageErrors: row.pageErrors.length }));
}
await browser.close();
mkdirSync("/home/dorij/scratch-research/k19f", { recursive: true });
writeFileSync(OUT, JSON.stringify({ run: new Date().toISOString(), port: PORT, folder: FOLDER, tech: TECH, techId: TECH_ID, rows }, null, 1));
console.log("wrote", OUT);
