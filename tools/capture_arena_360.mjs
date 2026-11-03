// The game's own disc arena, seen from the middle of the fight, all the way round: a 2:1 equirectangular PNG with the
// horizon exactly at mid-height and edges that join (same convention as the painted places: u 0.5 looks along -Z,
// toward the enemy side). No fighters. Made to hand to Gemini as the layout to repaint (skill battle-remaster).
//   VERIFY_PORT=8090 MAP=s375 [EYE=600] [OUT=arena360.png] tools/run-playwright.sh tools/capture_arena_360.mjs
// EYE = eye height in render units above the floor (400 units = 1 m in the painted place).
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const MAP = process.env.MAP || "s375", EYE = +(process.env.EYE || 600), OUT = process.env.OUT || `arena360_${MAP}.png`;
const FACE = 1024, W = 4096, H = 2048;
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
await page.addInitScript(() => {
    localStorage.setItem("assetMode", "authentic"); localStorage.setItem("engineSchema", "2"); localStorage.setItem("charId", "p003pken");
    const lead = { digimonId: 1, level: 20, xp: 0, tp: 10, hp: 900, maxHp: 900, mp: 300, maxMp: 300, stats: { str: 99, def: 99, spt: 99, wis: 99, spd: 99, chr: 99 }, bonuses: {}, elemBonuses: {} };
    localStorage.setItem("party", JSON.stringify(["p003pken"])); localStorage.setItem("partnerStats", JSON.stringify(lead));
    localStorage.setItem("partyStats", JSON.stringify([lead])); localStorage.setItem("rosterOwned", "1");
});
const errs = [];
page.on("pageerror", (e) => errs.push(String(e).slice(0, 200)));
await page.goto(`${baseUrl(8742)}/index.html?skipTitle=1&noEncounters=1&map=${MAP}`);
await page.waitForFunction(() => window.__state?.started && window.__mpb);
await page.keyboard.press("f");
await new Promise((r) => setTimeout(r, 1500));
await page.evaluate(() => window.__mpb.practice({ foes: [{ name: "Kunemon", level: 5, hp: 900, mp: 10, stat_scale: 16 }] }));
await page.waitForFunction(() => window.__mpb.fight?.r3d?.captureArenaFace?.([0, 600, 0], [0, 600, -1], [0, 1, 0], 16), null, { timeout: 60000 });
await new Promise((r) => setTimeout(r, 3000));   // let every arena texture finish loading

const out = await page.evaluate(async ({ EYE, FACE, W, H }) => {
    const r3d = window.__mpb.fight.r3d, e = [0, EYE, 0];
    // forward, up for the six faces (render space, Y up)
    const faces = [[[1, 0, 0], [0, 1, 0]], [[-1, 0, 0], [0, 1, 0]], [[0, 0, 1], [0, 1, 0]], [[0, 0, -1], [0, 1, 0]],
        [[0, 1, 0], [0, 0, 1]], [[0, -1, 0], [0, 0, -1]]].map(([f, up]) => {
        const c = r3d.captureArenaFace(e, [e[0] + f[0], e[1] + f[1], e[2] + f[2]], up, FACE);
        const bin = atob(c.rgba), px = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) px[i] = bin.charCodeAt(i);
        // the same basis as mat4LookAt: z = back, x = up x z (right), y = z x x
        const z = [-f[0], -f[1], -f[2]], x = [up[1] * z[2] - up[2] * z[1], up[2] * z[0] - up[0] * z[2], up[0] * z[1] - up[1] * z[0]];
        const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
        return { f, x, y, px, arena: c.arena };
    });
    const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
    const ctx = cv.getContext("2d"), img = ctx.createImageData(W, H), o = img.data;
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    for (let j = 0; j < H; j++) {
        const phi = (0.5 - (j + 0.5) / H) * Math.PI;
        for (let i = 0; i < W; i++) {
            const th = ((i + 0.5) / W - 0.5) * 2 * Math.PI;   // u = 0.5 + atan2(dx, -dz) / 2pi
            const d = [Math.sin(th) * Math.cos(phi), Math.sin(phi), -Math.cos(th) * Math.cos(phi)];
            let best = null, bf = -1;
            for (const F of faces) { const t = dot(d, F.f); if (t > bf) { bf = t; best = F; } }
            const sx = dot(d, best.x) / bf, sy = dot(d, best.y) / bf;
            const px = Math.min(FACE - 1, Math.max(0, Math.floor((sx + 1) / 2 * FACE)));
            const py = Math.min(FACE - 1, Math.max(0, Math.floor((sy + 1) / 2 * FACE)));   // readPixels rows run bottom-up
            const k = (py * FACE + px) * 4, q = (j * W + i) * 4;
            o[q] = best.px[k]; o[q + 1] = best.px[k + 1]; o[q + 2] = best.px[k + 2]; o[q + 3] = 255;
        }
    }
    ctx.putImageData(img, 0, 0);
    return { arena: faces[0].arena, png: cv.toDataURL("image/png").split(",")[1] };
}, { EYE, FACE, W, H });
writeFileSync(OUT, Buffer.from(out.png, "base64"));
console.log(JSON.stringify({ map: MAP, arena: out.arena, eye: EYE, out: OUT, size: [W, H], pageErrors: errs.length ? errs : "none" }));
await browser.close();
