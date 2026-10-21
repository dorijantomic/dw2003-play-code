#!/usr/bin/env node
// A8 diagnostic: what does the battle actually do after __fieldToBattle()? Prints peek() each second.
import { chromium } from "playwright";
import { baseUrl } from "./verify-base-url.mjs";

const ROOT = process.env.A8_ROOT || `${baseUrl(8109)}/`;
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

await page.goto(`${ROOT}?skipTitle=1&map=s320&noEncounters=1`, { waitUntil: "load", timeout: 90_000 });
await page.waitForFunction(() => window.__state?.started, null, { timeout: 60_000 });
for (let i = 0; i < 20; i++) {
  if (!(await page.evaluate(() => window.__textbox?.isOpen?.() ?? false))) break;
  await tap("Enter");
}
console.log("learnAll:", await page.evaluate(() => window.__extraRoster?.learnAll?.() ?? -1));
await page.evaluate(() => window.__fieldToBattle?.());
for (let i = 0; i < 30; i++) {
  const s = await page.evaluate(() => {
    const b = window.__battleB?.();
    const p = window.__battle?.peek?.();
    return {
      active: !!window.__battle?.isActive?.(),
      state: p?.state ?? null,
      loader: p?.loaderOpen ?? null,
      cmdActive: p?.commandList?.active ?? null,
      waitsForLine: p?.waitsForLine ?? null,
      msg: (p?.message ?? "").slice(0, 60),
      line: p?.messageLine ? { active: p.messageLine.active, fin: p.messageLine.finished, holds: p.messageLine.holdsTurn } : null,
      hp: b?.enemy?.hp ?? null, php: b?.player?.hp ?? null,
      profile: b?.player?.profile?.name ?? null,
    };
  });
  console.log(i, JSON.stringify(s));
  if (s.state === 2 && s.cmdActive && s.loader === false) { console.log("MENU READY"); break; }
  await page.waitForTimeout(1000);
}
await page.screenshot({ path: "/home/dorij/.hermes/profiles/ritems/cache/scratch/a8-diag.png" });
await browser.close();
