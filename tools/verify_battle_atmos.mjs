// Many-vs-many fight: how much of the screen is covered by ARENA geometry that is nearer to the camera than the
// nearest fighter (rock or wall between the camera and the Digimon), for every arena pack, at the original size
// (scale 1) and at the line-up's arenaScale (battle3d.js _layoutExtras). Numbers only: the live practice fight's own
// multi-shot camera and fighter boxes, each pack's geometry.json, a 200 x 72 sample grid over the screen.
//
//   VERIFY_PORT=8090 tools/run-playwright.sh tools/measure_mp_arena_cover.mjs
import { chromium } from "playwright";
import { baseUrl } from "./verify-base-url.mjs";

const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await (await browser.newContext({ viewport: { width: 2000, height: 720 } })).newPage();
await page.addInitScript(() => {
    localStorage.setItem("assetMode", "hd"); localStorage.setItem("engineSchema", "2"); localStorage.setItem("charId", "p003pken");
    const lead = { digimonId: 1, level: 20, xp: 0, tp: 10, hp: 900, maxHp: 900, mp: 300, maxMp: 300, stats: { str: 99, def: 99, spt: 99, wis: 99, spd: 99, chr: 99 }, bonuses: {}, elemBonuses: {} };
    localStorage.setItem("party", JSON.stringify(["p003pken"])); localStorage.setItem("partnerStats", JSON.stringify(lead));
    localStorage.setItem("partyStats", JSON.stringify([lead])); localStorage.setItem("rosterOwned", "1");
});
await page.goto(`${baseUrl(8742)}/index.html?skipTitle=1&noEncounters=1&map=${process.env.MAP || "s696"}`);
await page.waitForFunction(() => window.__state?.started && window.__mpb);
await page.keyboard.press("f");
await new Promise((r) => setTimeout(r, 1500));
await page.evaluate(() => window.__mpb.practice({ foes: [1, 2].map(() => ({ name: "Kunemon", level: 5, hp: 900, mp: 10, stat_scale: 16 })) }));
await page.waitForFunction(() => { const f = window.__mpb.fight; return f?.r3d && f.S && f.S.E.every((e) => f.r3d.getFighterScreen("e" + e.i)); }, null, { timeout: 60000 });
await new Promise((r) => setTimeout(r, 4000));
// F2 -> Atmosphere -> "Battle sky & weather" (battle3d.js _atmosFrame, ambience.js window.__battleAtmos): numbers only.
// On North Sector — Snow Mountain (s696), a practice fight; then the atmosphere the renderer uses each frame:
//   1. setting off: no atmosphere (the game's own colours);
//   2. on, day: no grade, light haze; 3. on, night (time of day 0.77): grade = 1 - todColor(0.77) = the overworld's night;
//   4. snow forced: snow particles and heavier fog; 5. frame time off vs on.
//
//   VERIFY_PORT=8090 tools/run-playwright.sh tools/verify_battle_atmos.mjs
const frames = (n) => page.evaluate((n) => new Promise((res) => { let i = 0; const f = () => (++i >= n ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
const atm = () => page.evaluate(() => { const a = window.__mpb.fight.r3d.getAtmosphere(); return a && { gradeSub: a.gradeSub.map((v) => +v.toFixed(3)), fogCol: a.fogCol.map((v) => +v.toFixed(2)), fogMax: +a.fogP[2].toFixed(2), snow: a.snow, rain: a.rain, night: +a.night.toFixed(2), particles: a.particles }; });
const frameMs = () => page.evaluate(() => new Promise((res) => { const t = []; let last = performance.now(); const f = (now) => { t.push(now - last); last = now; if (t.length < 120) requestAnimationFrame(f); else res(t.slice(10).reduce((a, b) => a + b, 0) / (t.length - 10)); }; requestAnimationFrame(f); }));
console.log("map atmosphere seen by the fight:", JSON.stringify(await page.evaluate(() => { const a = window.__battleAtmos?.(); return a && { mapId: a.mapId, tod: a.tod, nightMap: a.nightMap, L: a.L }; })));
await page.evaluate(() => { window.__fx.battleatmos = false; }); await frames(10);
console.log("1 off:", JSON.stringify(await atm()));
const offMs = await frameMs();
await page.evaluate(() => { window.__fx.battleatmos = true; window.__todForce = 0.1; }); await frames(10);
console.log("2 on, day:", JSON.stringify(await atm()));
await page.evaluate(() => { window.__todForce = 0.77; }); await frames(10);
console.log("3 on, night:", JSON.stringify(await atm()), " expected grade", JSON.stringify([150, 132, 196].map((v) => +(1 - v / 255).toFixed(3))));
const onMs = await frameMs();
console.log("5 frame time ms: off", offMs.toFixed(1), "on (night, map weather)", onMs.toFixed(1));
await browser.close();
