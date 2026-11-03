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
await page.evaluate(() => window.__mpb.practice({ foes: [1, 2].map(() => ({ name: "Kunemon", level: 5, hp: 900, mp: 10, stat_scale: 16 })) }));
await page.waitForFunction(() => { const f = window.__mpb.fight; return f?.r3d && f.S && f.S.E.every((e) => f.r3d.getFighterScreen("e" + e.i)); }, null, { timeout: 60000 });
await new Promise((r) => setTimeout(r, 4000));
const out = await page.evaluate(async () => {
    const r = window.__mpb.fight.r3d, lay = r.getMultiLayout(), cam = r.getCameraInfo();
    const cv = document.querySelector("#mpb canvas.view"), aspect = cv.width / cv.height;
    const M = 140 / 400;                                        // MODEL_SCALE
    const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const norm = (a) => { const l = Math.hypot(...a); return [a[0] / l, a[1] / l, a[2] / l]; };
    const fwd = norm(sub(cam.look, cam.eye)), right = norm(cross(fwd, [0, 1, 0])), up = cross(right, fwd);
    const t = Math.tan(cam.fovDeg * Math.PI / 360);
    const proj = (p) => { const d = sub(p, cam.eye), z = dot(d, fwd); return z > 1 ? [dot(d, right) / (z * t * aspect), dot(d, up) / (z * t), z] : null; };
    let near = Infinity, feet = Infinity;
    for (const f of lay.fighters) if (f.aabb) feet = Math.min(feet, f.aabb.min[1]);
    for (const f of lay.fighters) if (f.aabb) { const c = [(f.aabb.min[0] + f.aabb.max[0]) / 2, (f.aabb.min[1] + f.aabb.max[1]) / 2, (f.aabb.min[2] + f.aabb.max[2]) / 2]; near = Math.min(near, dot(sub(c, cam.eye), fwd)); }
    const GW = 200, GH = 72;
    const cover = (pos, s) => {
        const hit = new Uint8Array(GW * GH);
        for (let i = 0; i + 8 < pos.length; i += 9) {
            const v = [0, 1, 2].map((k) => proj([pos[i + k * 3] * M * s, -pos[i + k * 3 + 1] * M * s, -pos[i + k * 3 + 2] * M * s]));
            const ys3 = [0, 1, 2].map((k) => -pos[i + k * 3 + 1] * M * s);
            if (Math.max(...ys3) < feet + 40) continue;                                   // ground: not rock or wall
            if (v.some((q) => !q) || v.every((q) => q[2] >= near * 0.9)) continue;        // behind the camera, or not in front of the fighters
            if (!v.some((q) => q[2] < near * 0.9)) continue;
            const xs = v.map((q) => (q[0] * 0.5 + 0.5) * GW), ys = v.map((q) => (0.5 - q[1] * 0.5) * GH);
            const x0 = Math.max(0, Math.floor(Math.min(...xs))), x1 = Math.min(GW - 1, Math.ceil(Math.max(...xs)));
            const y0 = Math.max(0, Math.floor(Math.min(...ys))), y1 = Math.min(GH - 1, Math.ceil(Math.max(...ys)));
            const area = (xs[1] - xs[0]) * (ys[2] - ys[0]) - (xs[2] - xs[0]) * (ys[1] - ys[0]);
            if (!area) continue;
            for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
                const px = x + 0.5, py = y + 0.5;
                const a = ((xs[1] - px) * (ys[2] - py) - (xs[2] - px) * (ys[1] - py)) / area;
                const b = ((xs[2] - px) * (ys[0] - py) - (xs[0] - px) * (ys[2] - py)) / area;
                if (a >= 0 && b >= 0 && a + b <= 1) hit[y * GW + x] = 1;
            }
        }
        return hit.reduce((s, h) => s + h, 0) / (GW * GH);
    };
    const rows = [];
    for (let id = 1; id <= 40; id++) {
        const name = `meft10${String(id).padStart(2, "0")}`;
        let g; try { const res = await fetch(`assets/battle/arenas/${name}/geometry.json`); if (!res.ok) continue; g = await res.json(); } catch { continue; }
        const pos = g.groups.flatMap((q) => q.pos);
        let used = null; for (let n = 0; n < 100 && used == null; n++) { used = r.probeArenaScale(name, lay.arenaScale); if (used == null) await new Promise((res) => setTimeout(res, 50)); }
        rows.push({ name, at1: cover(pos, 1), atScale: cover(pos, lay.arenaScale), used, atUsed: cover(pos, used ?? 1) });
    }
    return { arenaScale: lay.arenaScale, active: lay.arena, near, eye: cam.eye, look: cam.look, rows };
});
console.log("arenaScale", out.arenaScale.toFixed(3), "active", out.active, "nearest fighter depth", out.near.toFixed(0));
for (const r of out.rows) console.log(r.name, "near-rock cover: scale 1", (r.at1 * 100).toFixed(1) + "%", " full scale", (r.atScale * 100).toFixed(1) + "%", " game uses", r.used?.toFixed(2), (r.atUsed * 100).toFixed(1) + "%");
await browser.close();
