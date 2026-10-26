#!/usr/bin/env node
// K19e — why does the solver refuse Armormon's Darkness Chaos in the REAL game when the offline harness solves it?
import { chromium } from "playwright";
import { waitForCommandMenu } from "./verify-battle-wait.mjs";
const PORT = 8130, ROOT = `http://127.0.0.1:${PORT}`;
const member = (digimonId, techId) => ({
  digimonId, level: 40, xp: 0, tp: 30, hp: 1200, maxHp: 1200, mp: 999, maxMp: 999,
  stats: { str: 200, def: 120, spt: 90, wis: 90, spd: 90, chr: 30 }, bonuses: {}, elemBonuses: {},
  equippedForms: [digimonId, 0, 0],
  formLedger: [{ id: digimonId, formLevel: 5, dvexp: 0, techSlots: [techId, 0, 0, 0, 0, 0] }],
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tap = async (page, key, ms = 90) => { await page.keyboard.down(key); await page.waitForTimeout(ms); await page.keyboard.up(key); await page.waitForTimeout(80); };
const browser = await chromium.launch({ headless: true });
for (const c of [{ name: "Armormon", species: 21, techId: 167, tech: "Darkness Chaos" }, { name: "Agumon", species: 4, techId: 153, tech: "Air Blast" }]) {
  const context = await browser.newContext({ viewport: { width: 800, height: 600 } });
  await context.addInitScript((seed) => {
    localStorage.clear();
    localStorage.setItem("assetMode", "authentic"); localStorage.setItem("engineSchema", "2");
    localStorage.setItem("progressOrdinal", "3"); localStorage.setItem("playerName", "Review");
    localStorage.setItem("charId", "p005koet"); localStorage.setItem("party", JSON.stringify(["p005koet"]));
    localStorage.setItem("packId", "B"); localStorage.setItem("bits", "1000");
    localStorage.setItem("inventory", JSON.stringify([{ id: 43, qty: 5 }]));
    localStorage.setItem("partnerStats", JSON.stringify(seed)); localStorage.setItem("partyStats", JSON.stringify([seed]));
    localStorage.setItem("equipment", JSON.stringify([{}]));
  }, member(c.species, c.techId));
  const page = await context.newPage();
  page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  await page.goto(`${ROOT}/?skipTitle=1&map=s320&noEncounters=1`, { waitUntil: "load", timeout: 90000 });
  await page.waitForFunction(() => window.__state?.started, null, { timeout: 60000 });
  for (let i = 0; i < 20; i++) { if (!(await page.evaluate(() => window.__textbox?.isOpen?.() ?? false))) break; await tap(page, "Enter"); }
  await page.evaluate(() => window.__fieldToBattle?.());
  await page.waitForFunction(() => !!window.__battle?.isActive?.(), null, { timeout: 20000 });
  await waitForCommandMenu(page, { timeout: 60000 });
  await sleep(500);
  const diag = await page.evaluate(async ({ tech }) => {
    const S = await import("/fight/anim-solver.js");
    const C = await import("/fight/anim-collision.js");
    const F = await import("/fight/fight-tables.js");
    const model = window.__battle3d?.playerAnimator?.model ?? null;
    if (!model) return { error: "no player model" };
    const group = S.solverGroup(model, { tech });
    const H = C.bodyHeight(model);
    const res = S.solveCast(model, { tech, apply: false });
    return {
      folder: model.folder, bones: model.bones?.length, H: Math.round(H), hasRig: !!model.rig,
      techName: F.techName ? F.techName(167) : null,
      group: { ok: group.ok, cls: group.cls, mode: group.mode, reason: group.reason ?? null, ids: group.ids },
      ok: !!res?.ok, reason: res?.group?.reason ?? null, gate: res?.report?.gate ?? null,
      worstAim: res?.report ? +res.report.worstAim.toFixed(2) : null,
      aim: res?.report?.aim?.map((a) => ({ id: a.id, err: a.error == null ? null : +a.error.toFixed(2) })),
      reach: res?.report?.reach, pen: res?.report ? { ok: res.report.penetration.ok, over: Math.round(res.report.penetration.over) } : null,
      plan: res?.plan ? { cls: res.plan.cls, mode: res.plan.mode, H: Math.round(res.plan.H), ticks: res.plan.ticks } : null,
    };
  }, c);
  console.log(`\n${c.name} ${c.tech}:`, JSON.stringify(diag, null, 1));
  await context.close();
}
await browser.close();
