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
await page.goto(`${baseUrl(8742)}/index.html?skipTitle=1&noEncounters=1&map=${process.env.MAP || "s330"}`);
await page.waitForFunction(() => window.__state?.started && window.__mpb);
await page.keyboard.press("f");
await new Promise((r) => setTimeout(r, 1500));
await page.evaluate(() => window.__mpb.practice({ foes: [1, 2].map(() => ({ name: "Kunemon", level: 5, hp: 900, mp: 10, stat_scale: 16 })) }));
await page.waitForFunction(() => { const f = window.__mpb.fight; return f?.r3d && f.S && f.S.E.every((e) => f.r3d.getFighterScreen("e" + e.i)); }, null, { timeout: 60000 });
await new Promise((r) => setTimeout(r, 4000));
// F2 -> Atmosphere -> "Battle sky & weather": night sky and arena water, numbers only (no pictures).
//   1. the arena shader still links (no GL errors in the console) with the setting on;
//   2. at night with clear weather: stars/moon strength on; the moon direction is on screen; a ray from the eye along it
//      first hits an arena triangle ABOVE the horizon whose texel is sky-blue (the shader's own rule), else says what
//      it hits (then the moon is hidden by rock, which is correct, not a fault);
//   3. for every arena in the water table: the share of its floor texels the shader's water rule takes.
//
//   VERIFY_PORT=8090 [MAP=s330] tools/run-playwright.sh tools/verify_battle_sky.mjs
const glErrors = [];
page.on("console", (m) => { if (/shader|program|WebGL|GL_INVALID/i.test(m.text())) glErrors.push(m.text().slice(0, 200)); });
await page.evaluate(() => { window.__fx.battleatmos = true; window.__fx.weatherMode = "clear"; window.__todForce = 0.77; });
await page.evaluate(() => new Promise((res) => { let i = 0; const f = () => (++i >= 30 ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); }));
await page.waitForFunction(() => window.__mpb.fight.r3d.getAtmosphere()?.moonPick, null, { timeout: 30000 }).catch(() => {});
const out = await page.evaluate(async () => {
    const r = window.__mpb.fight.r3d, a = r.getAtmosphere(), cam = r.getCameraInfo(), lay = r.getMultiLayout();
    if (!a) return { none: true };
    const M = 140 / 400, s = lay.arenaScale, k = M * s;
    const g = await (await fetch(`assets/battle/arenas/${a.arena}/geometry.json`)).json();
    const texel = async (grp, u, v) => {
        const [col, row] = grp.clut || [0, 255];
        const img = new Image(); img.src = `assets/battle/arenas/${a.arena}/${grp.page || "wall"}_c${col}_r${row}.png`; await img.decode();
        const cv = document.createElement("canvas"); cv.width = img.width; cv.height = img.height; const cx = cv.getContext("2d"); cx.drawImage(img, 0, 0);
        return [...cx.getImageData(Math.min(img.width - 1, Math.floor(u * img.width)), Math.min(img.height - 1, Math.floor(v * img.height)), 1, 1).data];
    };
    // the moon ray
    const o = cam.eye, d = a.moonDir;
    if (!d) return { arena: a.arena, night: a.night, moon: "none picked", moonPick: a.moonPick, water: a.water };
    let best = null;
    for (const grp of g.groups) for (let t = 0; t < grp.pos.length / 9; t++) {
        const P = [0, 1, 2].map((q) => [grp.pos[t * 9 + q * 3] * k, -grp.pos[t * 9 + q * 3 + 1] * k, -grp.pos[t * 9 + q * 3 + 2] * k]);
        const e1 = P[1].map((v, i) => v - P[0][i]), e2 = P[2].map((v, i) => v - P[0][i]);
        const p = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]], det = e1[0] * p[0] + e1[1] * p[1] + e1[2] * p[2];
        if (Math.abs(det) < 1e-9) continue;
        const tv = o.map((v, i) => v - P[0][i]), u = (tv[0] * p[0] + tv[1] * p[1] + tv[2] * p[2]) / det; if (u < 0 || u > 1) continue;
        const q = [tv[1] * e1[2] - tv[2] * e1[1], tv[2] * e1[0] - tv[0] * e1[2], tv[0] * e1[1] - tv[1] * e1[0]], v = (d[0] * q[0] + d[1] * q[1] + d[2] * q[2]) / det; if (v < 0 || u + v > 1) continue;
        const dist = (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) / det; if (dist <= 0 || (best && dist >= best.dist)) continue;
        const UV = [0, 1, 2].map((q2) => [grp.uv[t * 6 + q2 * 2], grp.uv[t * 6 + q2 * 2 + 1]]), w0 = 1 - u - v;
        best = { dist, grp, uv: [w0 * UV[0][0] + u * UV[1][0] + v * UV[2][0], w0 * UV[0][1] + u * UV[1][1] + v * UV[2][1]], y: o[1] + d[1] * dist };
    }
    let moon = { hit: false };
    if (best) {
        const c = await texel(best.grp, best.uv[0], best.uv[1]), [R, G, B] = c.map((x) => x / 255), mx = Math.max(R, G, B), mn = Math.min(R, G, B);
        const sky = (mx - mn) / mx > 0.15 && mx > 0.3 && B > R + 0.06 && B >= G;
        moon = { hit: true, dist: Math.round(best.dist), aboveHorizon: best.y > 600 * k, texel: c.slice(0, 3), skyTexel: sky };
    }
    // on screen?
    const fw = cam.look.map((v, i) => v - cam.eye[i]), fl = Math.hypot(...fw), f = fw.map((v) => v / fl);
    const cosToMoon = f[0] * d[0] + f[1] * d[1] + f[2] * d[2];
    return { moonPick: a.moonPick && { screen: a.moonPick.screen, tried: a.moonPick.tried }, arena: a.arena, night: a.night, gradeSub: a.gradeSub, water: a.water, moon, moonDegFromCentre: +(Math.acos(cosToMoon) * 180 / Math.PI).toFixed(1), halfFovDeg: +(cam.fovDeg / 2).toFixed(1) };
});
console.log("GL errors:", glErrors.length ? glErrors : "none");
console.log(JSON.stringify(out));
await browser.close();
