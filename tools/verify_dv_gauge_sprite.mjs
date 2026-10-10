// tools/verify_dv_gauge_sprite.mjs — the Blast/DV gauge draws the original
// animated sprites at the decoded anchor, not a procedural colour fill.
//
// Authority: FIGHTSTG_F0x800934F0 (decompiled f0x800934f0.c L101-L110):
//   temp_s1_3 = (0x8004DF98() >> 2) & 3;
//   gauge < 0x3E8 ? sprite 0x33 + phase : sprite 0x37 + phase;
//   width from gauge/25, anchor (0x109, 0x3E).
// The eight 40x8 frames are the pgfgc00 pack's cels 51-58 (already extracted).
//
// Run: .opencode/autonomy/check-browser tools/verify_dv_gauge_sprite.mjs
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";
import { waitForCommandMenu } from "./verify-battle-wait.mjs";

const ROOT = process.env.GAUGE_ROOT || `${baseUrl(8742)}/`;
const OUT = process.env.GAUGE_SHOT || ".dw3-research/autonomous-plan/shots/dv-gauge-sprite";
mkdirSync(OUT, { recursive: true });

const member = (digimonId, level) => ({
  digimonId, level, xp: 0, tp: 10, hp: 400, maxHp: 400, mp: 120, maxMp: 120, dvGauge: 0,
  stats: { str: 200, def: 80, spt: 60, wis: 50, spd: 90, chr: 30 },
  bonuses: {}, elemBonuses: {},
});

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 960, height: 720 } });
const errors = [];
page.on("pageerror", (e) => { errors.push(e.message); console.error("PAGEERROR", e.message); });
await page.addInitScript((seed) => {
  localStorage.setItem("assetMode", "authentic");
  localStorage.setItem("engineSchema", "2");
  localStorage.setItem("playerName", "Junior");
  localStorage.setItem("charId", "p003pken");
  localStorage.setItem("party", JSON.stringify(["p003pken", "p009rena", "p010pata"]));
  localStorage.setItem("partnerStats", JSON.stringify(seed.lead));
  localStorage.setItem("partyStats", JSON.stringify([seed.lead, seed.rena, seed.pata]));
  localStorage.setItem("equipment", JSON.stringify([{}, {}, {}]));
  localStorage.setItem("bits", "1000");
  localStorage.setItem("inventory", "[]");
}, { lead: member(1, 10), rena: member(7, 10), pata: member(8, 10) });

let failed = null;
const fail = (m) => { failed = m; console.error("FAIL:", m); };
const shot = async (n) => writeFileSync(`${OUT}/${n}.png`,
  Buffer.from((await page.locator("canvas#game").evaluate((el) => el.toDataURL("image/png"))).split(",")[1],
    "base64"));
const gauge = () => page.evaluate(() => window.__battle.debugGauge());
const setGauge = (v) => page.evaluate((g) => {
  window.__battleB().player.gauge = g;
  window.__battleB()._hudClock = 0;   // deterministic phase 0 for the capture
}, v);

try {
  await page.goto(`${ROOT}?skipTitle=1&map=s245&noEncounters=1`);
  await page.waitForFunction(() => window.__state?.started, null, { timeout: 40_000 });
  await page.waitForTimeout(500);
  await page.evaluate(async () => {
    await window.__battle.start({
      enemyId: 1, enemyLevel: 1, onWin: () => {}, onFlee: () => {}, onLose: () => {},
    });
  });
  await waitForCommandMenu(page);

  const anchor = (await gauge()).anchor;
  if (JSON.stringify(anchor) !== JSON.stringify({ x: 265, y: 62, w: 40, h: 8 }))
    fail(`decoded anchor: ${JSON.stringify(anchor)}`);

  await setGauge(0);
  const empty = await gauge();
  await shot("gauge-empty");
  if (empty.width !== 0) fail(`empty gauge width ${empty.width}`);

  await setGauge(500);
  const half = await gauge();
  await shot("gauge-half");
  if (half.width !== 20) fail(`half gauge width ${half.width} (want 20)`);
  if (!(half.cel >= 0x33 && half.cel <= 0x36)) fail(`filling cel ${half.cel.toString(16)}`);

  await setGauge(1000);
  const full = await gauge();
  await shot("gauge-full");
  if (full.width !== 40) fail(`full gauge width ${full.width} (want 40)`);
  if (!(full.cel >= 0x37 && full.cel <= 0x3a)) fail(`full cel ${full.cel.toString(16)}`);

  // The four-tick animation: the phase advances with the HUD clock.
  await page.evaluate(() => { window.__battleB()._hudClock = 0; });
  const c0 = (await gauge()).cel;
  await page.waitForTimeout(260);
  const c1 = (await gauge()).cel;
  if (c0 === c1) fail(`the gauge sprite did not cycle (cel stayed ${c0.toString(16)})`);

  if (errors.length) await fail(`${errors.length} page error(s)`);
  console.log("RESULT", JSON.stringify({
    ok: !failed, anchor, empty: { w: empty.width }, half: { w: half.width, cel: half.cel },
    full: { w: full.width, cel: full.cel }, cycle: [c0, c1],
  }));
} catch (e) {
  await fail(e.message);
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
