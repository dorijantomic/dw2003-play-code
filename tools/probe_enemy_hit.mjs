// Who loses HP when an enemy attacks? Fights Ogremon (an enemy that is also an extra species) with a rookie and logs every
// HP change of either side together with the battle message line. WEAR=counter puts a Counter Crest on the rookie.
//
// Run: VERIFY_PORT=8770 WEAR=counter tools/run-playwright.sh tools/probe_enemy_hit.mjs
import { chromium } from "playwright";
import { baseUrl } from "./verify-base-url.mjs";
import { waitForCommandMenu } from "./verify-battle-wait.mjs";

const ROOT = `${baseUrl(8770)}/`;
const WEAR = process.env.WEAR || "";
const FORM = Number(process.env.FORM_ID || 0);            // a form id to wear (70 = Meramon, an enemy-only species)
const SHOTS = process.env.SHOT_DIR || "";
const ENEMY = Number(process.env.ENEMY_ID || 155);       // digimon.json id: Ogremon
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1000, height: 1100 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

await page.addInitScript(({ wear, form }) => {
  localStorage.setItem("assetMode", "authentic"); localStorage.setItem("engineSchema", "2"); localStorage.setItem("progressOrdinal", "3");
  localStorage.setItem("playerName", "Junior"); localStorage.setItem("charId", "p003pken"); localStorage.setItem("party", JSON.stringify(["p003pken"]));
  localStorage.setItem("packId", "B"); localStorage.setItem("bits", "1000"); localStorage.setItem("inventory", "[]");
  const m = { digimonId: form || 1, level: 12, xp: 0, tp: 10, hp: 900, maxHp: 900, mp: 300, maxMp: 300, stats: { str: 40, def: 400, spt: 50, wis: 50, spd: 60, chr: 20 }, bonuses: {}, elemBonuses: {}, formLedger: form ? [{ id: form, formLevel: 3, dvexp: 0, techSlots: [0, 0, 0, 0, 0, 0] }] : [], equippedForms: form ? [form] : [] };
  localStorage.setItem("partnerStats", JSON.stringify(m)); localStorage.setItem("partyStats", JSON.stringify([m]));
  localStorage.setItem("equipment", JSON.stringify([wear === "counter" ? { acc0: 318 } : wear === "multi" ? { acc0: 316 } : {}]));
}, { wear: WEAR, form: FORM });

try {
  await page.goto(ROOT + "?skipTitle=1&map=s200&noEncounters=1");
  await page.waitForFunction(() => window.__state?.started, null, { timeout: 30_000 });
  await page.evaluate(async (id) => { await window.__battle.start({ enemyId: id, enemyLevel: 8, screenId: 204, onWin: () => {}, onFlee: () => {}, onLose: () => {} }); }, ENEMY);
  await waitForCommandMenu(page);
  console.log(`enemy ${await page.evaluate(() => window.__battleB().enemy.profile?.name)}; wearing ${WEAR || "nothing"}`);
  // count the contacts (type 99) our attack animation fires, and how long each swing runs
  await page.evaluate(() => {
    const r = window.__battle3d, orig = r.playerAttack.bind(r);
    window.__swings = [];
    r.playerAttack = (id, opts = {}) => {
      const sw = { id, contacts: 0, hits: [], t: performance.now(), miss: !!opts.miss };
      window.__swings.push(sw);
      return orig(id, { ...opts, onHit: (rec) => { if (rec.type === 99) sw.contacts++; sw.hits.push(rec.type); opts.onHit?.(rec); } });
    };
  });
  console.log("active", await page.evaluate(() => window.__battle.isActive()), "state", await page.evaluate(() => window.__battleB()?.state), "form", await page.evaluate(() => window.__battleB()?.player?.profile?.name));
  const log = [];
  let last = { p: null, e: null, m: "" }, shotN = 0;
  const t0 = Date.now();
  while (Date.now() - t0 < Number(process.env.RUN_MS || 60000) && (await page.evaluate(() => window.__battle.isActive()))) {
    const cur = await page.evaluate(() => { const b = window.__battleB(); return { p: b.player.hp, e: b.enemy.hp, m: String(b.message ?? ""), busy: !!window.__battle3d?.coordinator?.active, counter: b._counter ? b._counter.phase : "" }; });
    if (last.p !== null && (cur.p !== last.p || cur.e !== last.e || cur.m !== last.m || cur.busy !== last.busy || cur.counter !== last.counter)) {
      log.push({ t: Date.now() - t0, dp: cur.p - last.p, de: cur.e - last.e, p: cur.p, e: cur.e, m: cur.m, busy: cur.busy, counter: cur.counter });
      if (SHOTS && /Ogremon attacks/.test(cur.m) && shotN < 6) {
        const name = `${SHOTS}/enemy-attack-${shotN++}.png`;
        for (const [i, ms] of [150, 500, 500, 600].entries()) {
          await page.waitForTimeout(ms);
          const frame = `${SHOTS}/enemy-attack-${shotN - 1}-${i}.png`;
          const c = await page.$("canvas#game"); if (c) await c.screenshot({ path: frame }); else await page.screenshot({ path: frame });
          const st = await page.evaluate(() => { const b = window.__battleB(); return `you ${b.player.hp} enemy ${b.enemy.hp} | ${String(b.message ?? "").replace(/\s+/g, " ").slice(0, 60)}`; });
          console.log(`   frame ${shotN - 1}-${i}: ${st}`);
        }
      }
    }
    last = cur;
    await page.evaluate(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
      await new Promise((r) => setTimeout(r, 60));
      document.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", bubbles: true }));
    });
    await page.waitForTimeout(90);
  }
  for (const l of log.slice(0, 80)) console.log(`${String(l.t).padStart(6)}ms  you ${String(l.dp).padStart(5)}  enemy ${String(l.de).padStart(5)}  busy ${l.busy ? "Y" : "-"} ctr ${(l.counter || "-").padEnd(4)} | ${l.m.replace(/\s+/g, " ").slice(0, 90)}`);
  const swings = await page.evaluate(() => window.__swings.map((w) => ({ contacts: w.contacts, types: w.hits.join(","), miss: w.miss })));
  console.log("our swings:", JSON.stringify(swings));
  const enemyActs = log.filter((l) => /Ogremon.*Attack|Attack!/.test(l.m));
  console.log(`page errors: ${errors.length}`);
} catch (e) {
  console.error("ERROR", e.message);
} finally {
  await browser.close();
}
