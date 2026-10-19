// Screenshots of what the battle camera shows while one of OUR Digimon uses a technique, frame by frame.
// MC_NAME = the form (an extra species or a disc form), MC_TECH = the technique id, MC_MODE = attack | tech, OUT = folder.
//
// Server: python3 -m http.server 8770 --directory web
// Run:    VERIFY_PORT=8770 MC_NAME=Meramon MC_TECH=137 OUT=/tmp/cast tools/run-playwright.sh tools/capture_cast_camera.mjs
import { chromium } from "playwright";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { baseUrl } from "./verify-base-url.mjs";
import { waitForCommandMenu } from "./verify-battle-wait.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = `${baseUrl(8770)}/`;
const OUT = process.env.OUT || "/tmp/cast";
mkdirSync(OUT, { recursive: true });
const data = (n) => JSON.parse(readFileSync(resolve(HERE, `../web/assets/data/${n}`), "utf8"));
const NAME = process.env.MC_NAME || "Meramon";
const SPECIES = data("extra_species.json").digimon.find((d) => d.name === NAME) ?? data("digimon.json").digimon.find((d) => d.name === NAME);
const TECH = Number(process.env.MC_TECH || 137), MODE = process.env.MC_MODE || "attack";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
await page.addInitScript((k) => {
  localStorage.setItem("assetMode", "authentic"); localStorage.setItem("engineSchema", "2"); localStorage.setItem("progressOrdinal", "3");
  localStorage.setItem("playerName", "Junior"); localStorage.setItem("charId", "p005koet");
  localStorage.setItem("party", JSON.stringify(["p005koet", "p006agum", "p009rena"])); localStorage.setItem("packId", "B");
  localStorage.setItem("bits", "1000"); localStorage.setItem("inventory", "[]");
  const ledger = [3, k].map((id) => ({ id, formLevel: 3, dvexp: 0, techSlots: [0, 0, 0, 0, 0, 0] }));
  const member = (digimonId, level, formLedger, equippedForms) => ({ digimonId, level, xp: 0, tp: 10, hp: 900, maxHp: 900, mp: 400, maxMp: 400, stats: { str: 90, def: 60, spt: 50, wis: 50, spd: 60, chr: 20 }, bonuses: {}, elemBonuses: {}, formLedger, equippedForms });
  localStorage.setItem("partnerStats", JSON.stringify(member(3, 12, ledger, [k, 0, 0])));
  localStorage.setItem("partyStats", JSON.stringify([member(3, 12, ledger, [k, 0, 0]), member(7, 5, [], []), member(8, 5, [], [])]));
  localStorage.setItem("equipment", JSON.stringify([{}, {}, {}]));
}, SPECIES.id);

try {
  await page.goto(ROOT + "?skipTitle=1&map=s200&noEncounters=1");
  await page.waitForFunction(() => window.__state?.started, null, { timeout: 30_000 });
  await page.evaluate(() => { window.__gameSpeed = 8; });
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline && !(await page.evaluate(() => !!window.__battle?.isActive?.()))) {
    if (await page.evaluate(() => window.__textbox?.isOpen?.() ?? false)) await page.keyboard.press("Enter");
    await page.waitForTimeout(40);
  }
  await page.evaluate(() => { window.__gameSpeed = 1; });
  await waitForCommandMenu(page);
  await page.evaluate((id) => window.__battleDv(id), SPECIES.id);
  await page.waitForFunction((id) => window.__battleB?.()?.playerRecords?.[0]?.profile?.id === id, SPECIES.id, { timeout: 60_000 });
  await waitForCommandMenu(page).catch(() => {});
  await page.waitForTimeout(7000);
  await page.evaluate(({ tech, mode }) => { const r = window.__battle3d; mode === "tech" ? r.setPlayerAnimByTech(tech, { onHit: () => {} }) : r.playerAttack(tech, { onHit: () => {} }); }, { tech: TECH, mode: MODE });
  for (let i = 0; i < 16; i++) {
    await page.waitForTimeout(220);
    const c = await page.$("canvas"); if (c) await c.screenshot({ path: `${OUT}/f${String(i).padStart(2, "0")}.png` });
    const cam = await page.evaluate(() => { const d = window.__battle3d.__dnaDebug?.(); return d?.camRecord ? `${d.camRecord.issuer}/${d.camRecord.kind}/${d.camRecord.preset ?? "-"}` : "-"; });
    console.log(`f${String(i).padStart(2, "0")} ${cam}`);
  }
} catch (e) {
  console.error("ERROR", e.message);
} finally {
  await browser.close();
}
