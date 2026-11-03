// F2 -> Screen -> "Painted 360 battle backdrops" (HD Remaster): numbers only, no pictures.
//   1. off by default: nothing drawn, no arena triangle hidden;
//   2. on (HD): the map's panorama and its 3D mesh (s<map>_depth.*) load, are drawn every frame, NO disc arena group is
//      drawn; the mesh's ground straight under every fighter and under the camera is at y 0 (feet are at 0 +-4);
//   3. Authentic mode: ignored (nothing drawn, nothing hidden);
//   4. with "Battle sky & weather" at night: where the moon is picked (arena sky or the painted sky);
//   5. no shader / GL errors in the console.
//
//   VERIFY_PORT=8090 [MAP=s340] tools/run-playwright.sh tools/verify_battle_pano.mjs
import { chromium } from "playwright";
import { baseUrl } from "./verify-base-url.mjs";

const MAP = process.env.MAP || "s340";
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await (await browser.newContext({ viewport: { width: 2000, height: 720 } })).newPage();
await page.addInitScript(() => {
    localStorage.setItem("assetMode", "hd"); localStorage.setItem("engineSchema", "2"); localStorage.setItem("charId", "p003pken");
    const lead = { digimonId: 1, level: 20, xp: 0, tp: 10, hp: 900, maxHp: 900, mp: 300, maxMp: 300, stats: { str: 99, def: 99, spt: 99, wis: 99, spd: 99, chr: 99 }, bonuses: {}, elemBonuses: {} };
    localStorage.setItem("party", JSON.stringify(["p003pken"])); localStorage.setItem("partnerStats", JSON.stringify(lead));
    localStorage.setItem("partyStats", JSON.stringify([lead])); localStorage.setItem("rosterOwned", "1");
});
const glErrors = [];
page.on("console", (m) => { if (/shader|program|WebGL|GL_INVALID/i.test(m.text())) glErrors.push(m.text().slice(0, 200)); });
page.on("pageerror", (e) => glErrors.push("pageerror: " + String(e).slice(0, 200)));
await page.goto(`${baseUrl(8742)}/index.html?skipTitle=1&noEncounters=1&map=${MAP}`);
await page.waitForFunction(() => window.__state?.started && window.__mpb);
await page.keyboard.press("f");
await new Promise((r) => setTimeout(r, 1500));
await page.evaluate(() => window.__mpb.practice({ foes: [1, 2].map(() => ({ name: "Kunemon", level: 5, hp: 900, mp: 10, stat_scale: 16 })) }));
await page.waitForFunction(() => { const f = window.__mpb.fight; return f?.r3d && f.S && f.S.E.every((e) => f.r3d.getFighterScreen("e" + e.i)); }, null, { timeout: 60000 });
await new Promise((r) => setTimeout(r, 3000));
const frames = (n) => page.evaluate((n) => new Promise((res) => { let i = 0; const f = () => (++i >= n ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
const P = () => page.evaluate(() => window.__mpb.fight.r3d.getPanorama());

const res = {};
const p0 = await P(); await frames(20); const p1 = await P();
const groups = () => page.evaluate(() => window.__mpb.fight.r3d.arenaStage.cull.groups.length);
res.off = { settingDefault: await page.evaluate(() => !!window.__fx?.battlepano), drawnDelta: p1.drawn - p0.drawn, arenaGroupsDrawn: await groups() };

await page.evaluate(() => { window.__fx.battlepano = true; });
await page.waitForFunction(() => (window.__mpb.fight.r3d.getPanorama().loaded && (window.__mpb.fight.r3d.getPanorama().mesh || window.__mpb.fight.r3d.getPanorama().paint)) || window.__mpb.fight.r3d.getPanorama().missing, null, { timeout: 30000 }).catch(() => {});
const q0 = await P(); await frames(20); const q1 = await P();
res.on = { id: q1.id, loaded: q1.loaded, mesh: q1.mesh, paint: q1.paint, groundTile: q1.ground, missing: q1.missing, drawnDelta: q1.drawn - q0.drawn, arenaGroupsDrawn: await groups() };
res.place = { feetY: q1.feet, solidUntil: q1.dome.fade[0], fighterRadius: (q1.xz || []).map(([x, z]) => Math.round(Math.hypot(x, z))),
    cameraRadius: Math.round(Math.hypot(q1.eye?.[0] ?? 0, q1.eye?.[2] ?? 0)), cameraY: Math.round(q1.eye?.[1] ?? 0) };
// the 3D place: its ground height straight under every fighter and under the camera (must be 0: they stand on it)
res.place.meshGroundUnderFighters = await page.evaluate((xz) => xz.map(([x, z]) => { const y = window.__mpb.fight.r3d.probePanoGround(x, z); return y == null ? null : +y.toFixed(1); }), q1.xz || []);
res.place.meshGroundUnderCamera = await page.evaluate(([x, z]) => { const y = window.__mpb.fight.r3d.probePanoGround(x, z); return y == null ? null : +y.toFixed(1); }, [q1.eye?.[0] ?? 0, q1.eye?.[2] ?? 0]);
await page.evaluate(() => localStorage.setItem("assetMode", "authentic"));
const a0 = await P(); await frames(20); const a1 = await P();
res.authentic = { drawnDelta: a1.drawn - a0.drawn, loaded: a1.loaded, arenaGroupsDrawn: await groups() };
await page.evaluate(() => localStorage.setItem("assetMode", "hd"));

await page.evaluate(() => { window.__fx.battleatmos = true; window.__fx.weatherMode = "clear"; window.__todForce = 0.77; });
await frames(30);
await page.waitForFunction(() => window.__mpb.fight.r3d.getAtmosphere()?.moonPick, null, { timeout: 30000 }).catch(() => {});
res.night = await page.evaluate(() => { const a = window.__mpb.fight.r3d.getAtmosphere(); return a && { arena: a.arena, night: +a.night.toFixed(2), moonPick: a.moonPick && { screen: a.moonPick.screen, tried: a.moonPick.tried }, moonDir: a.moonDir }; });
const n0 = await P(); await frames(10); const n1 = await P();
res.night.drawnDelta = n1.drawn - n0.drawn;

console.log("GL errors:", glErrors.length ? glErrors : "none");
console.log(JSON.stringify(res, null, 1));
await browser.close();
