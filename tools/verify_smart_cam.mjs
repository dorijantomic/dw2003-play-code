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
await page.goto(`${baseUrl(8742)}/index.html?skipTitle=1&noEncounters=1&map=s330`);
await page.waitForFunction(() => window.__state?.started && window.__mpb);
await page.keyboard.press("f");
await new Promise((r) => setTimeout(r, 1500));
await page.evaluate((names) => window.__mpb.practice({ foes: names.map((name) => ({ name, level: 5, hp: 900, mp: 10, stat_scale: 16 })) }), (process.env.FOES || "Kunemon,Kunemon").split(","));
await page.waitForFunction(() => { const f = window.__mpb.fight; return f?.r3d && f.S && f.S.E.every((e) => f.r3d.getFighterScreen("e" + e.i)); }, null, { timeout: 60000 });
await new Promise((r) => setTimeout(r, 4000));
// F2 -> Screen -> "Smart 2 vs 2 camera" (battle3d.js _smartCameraShot): for every arena pack, the original multi shot's
// numbers next to the smart pick's, from the arena's own triangles with the arena draw's own face cull (no pictures):
// share of the screen near rock covers, share of the fighters' screen boxes it covers, fighter box corners off screen.
// Each pack at the scale the game gives it (after _arenaScaleClear) and at the full line-up scale (no clear).
//
//   VERIFY_PORT=8090 [FOES=Deltamon,MetalTyrannomon] tools/run-playwright.sh tools/verify_smart_cam.mjs
const out = await page.evaluate(async () => {
    const r = window.__mpb.fight.r3d, lay = r.getMultiLayout();
    const rows = [];
    const wait = async (fn) => { let v = null; for (let n = 0; n < 100 && v == null; n++) { v = fn(); if (v == null) await new Promise((res) => setTimeout(res, 50)); } return v; };
    for (let id = 1; id <= 40; id++) {
        const name = `meft10${String(id).padStart(2, "0")}`;
        try { const res = await fetch(`assets/battle/arenas/${name}/geometry.json`, { method: "HEAD" }); if (!res.ok) continue; } catch { continue; }
        rows.push({ name, game: await wait(() => r.probeSmartCam(name, lay.arenaScale)), full: await wait(() => r.probeSmartCam(name, lay.arenaScale, lay.arenaScale)) });
    }
    // the live fight: off -> on -> off (the setting is read every frame)
    const frames = async (n) => { for (let i = 0; i < n; i++) await new Promise((res) => requestAnimationFrame(res)); };
    window.__fx.smartcam = false; await frames(10); const offScale = r.getMultiLayout().arenaScale, offInfo = r.probeSmartCam();
    window.__fx.smartcam = true; await frames(90); const onScale = r.getMultiLayout().arenaScale, onInfo = r.probeSmartCam();
    window.__fx.smartcam = false; await frames(10); const backScale = r.getMultiLayout().arenaScale;
    return { arena: lay.arena, want: lay.arenaScale, fighters: lay.fighters.map((f) => f.id), rows, live: { offScale, offInfo, onScale, onInfo, backScale } };
});
const pc = (x) => (x * 100).toFixed(0).padStart(3) + "%";
const line = (m) => `rockCover ${pc(m.cover)} onFighters ${pc(m.onFighters)} offscreen ${pc(m.offscreen)}`;
const pick = (r) => (r.pick.p.yaw || r.pick.p.h !== 1 || r.pick.p.d !== 1) ? `<- turn ${r.pick.p.yaw} deg, height x${r.pick.p.h}, distance x${r.pick.p.d}` : "(kept)";
console.log("live arena", out.arena, "line-up scale", out.want.toFixed(2), "fighters", out.fighters.join(" "));
for (const r of out.rows) for (const [tag, x] of [["game scale", r.game], ["full scale", r.full]]) {
    if (!x) continue;
    console.log(r.name, tag, x.arenaScale.toFixed(2), `${x.ms.toFixed(0)}ms`, "| original", line(x.original.m), "| smart", line(x.pick.m), pick(x));
}
const L = out.live;
console.log("live: setting off -> no smart pick:", L.offInfo == null, "| on -> pick made:", !!L.onInfo, L.onInfo ? `(${L.onInfo.ms.toFixed(0)} ms spread over frames) ${line(L.onInfo.pick.m)} ${pick(L.onInfo)}` : "",
    "| arena scale off/on/off:", [L.offScale, L.onScale, L.backScale].map((x) => x.toFixed(2)).join(" / "));
await browser.close();
