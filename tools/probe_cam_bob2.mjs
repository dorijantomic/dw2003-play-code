// probe: 2v2 idle camera steadiness (eye/look height + pitch over 10 s), after the opening settles
import { chromium } from "playwright";
import { baseUrl } from "./verify-base-url.mjs";
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await (await browser.newContext({ viewport: { width: 2000, height: 720 } })).newPage();
await page.addInitScript(() => { localStorage.setItem("assetMode", "hd"); localStorage.setItem("engineSchema", "2"); localStorage.setItem("charId", "p003pken");
  const lead = { digimonId: 1, level: 20, xp: 0, tp: 10, hp: 900, maxHp: 900, mp: 300, maxMp: 300, stats: { str: 99, def: 99, spt: 99, wis: 99, spd: 99, chr: 99 }, bonuses: {}, elemBonuses: {} };
  localStorage.setItem("party", JSON.stringify(["p003pken"])); localStorage.setItem("partnerStats", JSON.stringify(lead)); localStorage.setItem("partyStats", JSON.stringify([lead])); localStorage.setItem("rosterOwned", "1"); });
await page.goto(`${baseUrl(8090)}/index.html?skipTitle=1&noEncounters=1&map=s340`);
await page.waitForFunction(() => window.__state?.started && window.__mpb);
await page.keyboard.press("f"); await page.waitForTimeout(1500);
await page.evaluate(() => window.__mpb.practice({ foes: [1, 2].map(() => ({ name: "Kunemon", level: 5, hp: 900, mp: 10, stat_scale: 16 })) }));
await page.waitForFunction(() => { const f = window.__mpb.fight; return f?.r3d && f.S && f.S.E.every((e) => f.r3d.getFighterScreen("e" + e.i)); }, null, { timeout: 60000 });
await page.waitForTimeout(6000);
const rows = [];
for (let i = 0; i < 50; i++) { rows.push(await page.evaluate(() => { const c = window.__mpb.fight.r3d.getCameraInfo(); const d = c.look.map((v, k) => v - c.eye[k]); return [c.eye[1], c.look[1], Math.atan2(d[1], Math.hypot(d[0], d[2])) * 180 / Math.PI]; })); await page.waitForTimeout(200); }
const rng = (k) => { const a = rows.map((r) => r[k]); return [Math.min(...a), Math.max(...a)].map((v) => +v.toFixed(3)); };
console.log("eyeY", rng(0), "lookY", rng(1), "pitchDeg", rng(2));
await browser.close();
