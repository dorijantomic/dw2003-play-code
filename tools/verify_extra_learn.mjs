// Winning a fight teaches a Digimon one of the enemy-only species as a new form: a Kotemon that already knows
// all 44 forms of its line is next offered Kunemon (a root form of the extra species), the game's own victory
// screen runs, and the form lands in the ledger and in the saved state.
//
// Server: python3 -m http.server 8791 --directory web
// Run:    VERIFY_PORT=8791 tools/run-playwright.sh tools/verify_extra_learn.mjs
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { baseUrl } from "./verify-base-url.mjs";
import { waitForCommandMenu } from "./verify-battle-wait.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.XL_ROOT || `${baseUrl(8791)}/`;
const OUT = process.env.XL_SHOT || "/tmp/xlshots";
mkdirSync(OUT, { recursive: true });
const extra = JSON.parse(readFileSync(resolve(HERE, "../web/assets/data/extra_species.json"), "utf8"));
const KUNEMON = extra.digimon.find((d) => d.name === "Kunemon").id;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1000, height: 1100 } });
const errors = [];
page.on("pageerror", (e) => { errors.push(e.message); console.error("PAGEERROR", e.message); });

await page.addInitScript(() => {
  localStorage.setItem("assetMode", "authentic");
  localStorage.setItem("engineSchema", "2");
  if (sessionStorage.getItem("xlFixture")) return;
  sessionStorage.setItem("xlFixture", "1");
  localStorage.setItem("playerName", "Junior");
  localStorage.setItem("fieldLocation", JSON.stringify({ version: 1, mapId: "s245", x: 332, y: 390, dir: "left" }));
  localStorage.setItem("charId", "p003pken");
  localStorage.setItem("party", JSON.stringify(["p003pken", "p009rena", "p010pata"]));
  const base = Array.from({ length: 44 }, (_, i) => ({ id: 9 + i, formLevel: 99, dvexp: 0, techSlots: [0, 0, 0, 0, 0, 0] }));
  const member = (digimonId, level, formLedger, equippedForms) => ({
    digimonId, level, xp: 0, tp: 10, hp: 900, maxHp: 900, mp: 300, maxMp: 300,
    stats: { str: 400, def: 300, spt: 300, wis: 300, spd: 300, chr: 100 }, bonuses: {}, elemBonuses: {}, formLedger, equippedForms,
  });
  const lead = member(1, 40, base, [9, 10, 11]);
  localStorage.setItem("partnerStats", JSON.stringify(lead));
  localStorage.setItem("partyStats", JSON.stringify([lead, member(7, 10, [], []), member(8, 10, [], [])]));
  localStorage.setItem("equipment", JSON.stringify([{}, {}, {}]));
  localStorage.setItem("bits", "1000");
  localStorage.setItem("inventory", "[]");
});

const press = async (k, ms = 600) => { await page.keyboard.down(k); await page.waitForTimeout(ms); await page.keyboard.up(k); await page.waitForTimeout(80); };
const shot = async (name) => {
  const png = await page.locator("canvas#game").evaluate((el) => el.toDataURL("image/png"));
  writeFileSync(`${OUT}/${name}.png`, Buffer.from(png.split(",")[1], "base64"));
  console.log("shot", name);
};
const problems = [];
const expect = (ok, msg) => { console.log(ok ? "ok  " : "FAIL", msg); if (!ok) problems.push(msg); };
const ledgerIds = () => page.evaluate(() => (window.__state.partnerStats?.formLedger ?? []).map((e) => e.id));

try {
  await page.goto(ROOT + "?skipTitle=1&map=s245&noEncounters=1");
  await page.waitForFunction(() => window.__state?.started, null, { timeout: 40_000 });
  await page.waitForTimeout(500);
  const before = await ledgerIds();
  expect(before.length === 44 && !before.includes(KUNEMON), "the lead starts with the 44 base forms and no Kunemon");

  await page.evaluate(async () => {
    window.__learnResult = null;
    await window.__battle.start({ enemyId: 1, enemyLevel: 1, screenId: 200,
      onWin: (r) => { window.__learnResult = r; }, onFlee: () => {}, onLose: () => {} });
  });
  await waitForCommandMenu(page);
  await page.evaluate(() => { window.__battleB().enemy.hp = 1; });
  await press("Enter", 90);
  let guard = 0;
  while (await page.evaluate(() => window.__battleB?.()?.state) !== 8 && guard++ < 40) { await press("Enter", 90); await page.waitForTimeout(400); }
  await page.waitForFunction(() => window.__battleB?.()?._victoryPhase === "report", null, { timeout: 40_000 });
  const learned = await page.evaluate(() => {
    const b = window.__battleB();
    return { progress: JSON.parse(JSON.stringify(b._winProgress ?? null)), rows: (b._winReportRows ?? []).length };
  });
  console.log("  progress", JSON.stringify(learned).slice(0, 400));
  await page.waitForTimeout(2500);
  await shot("report");
  for (let i = 0; i < 25 && (await page.evaluate(() => !!window.__battle?.isActive?.())); i++) await press("Enter", 600);
  await page.waitForFunction(() => !window.__battle?.isActive?.(), null, { timeout: 30_000 });
  const after = await ledgerIds();
  expect(after.length === 45 && after.includes(KUNEMON), `the fight taught Kunemon (ledger now ${after.length}: ${after.filter((id) => id > 52)})`);
  const stored = await page.evaluate(() => (JSON.parse(localStorage.getItem("partnerStats")).formLedger ?? []).map((e) => e.id));
  expect(stored.includes(KUNEMON), "and it is written to the saved state");

  expect(errors.length === 0, `no page errors (${errors.join("; ")})`);
} catch (error) {
  console.error("ERROR", error.message);
  problems.push(error.message);
  try { await shot("failure"); } catch { /* page may be gone */ }
} finally {
  await browser.close();
}
console.log(problems.length ? `FAILED ${problems.length}` : "PASS");
process.exitCode = problems.length ? 1 : 0;
