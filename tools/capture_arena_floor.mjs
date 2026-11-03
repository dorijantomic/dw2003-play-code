// The game's own disc arena seen STRAIGHT DOWN (no perspective): the floor as a square top-down picture, for Gemini to
// repaint, so the floor near the camera gets its own sharp picture (the 360 from the middle has too few pixels there:
// meft1007 at 10 m from the middle, 12 px per 100 units before Gemini's 1440 px, 3 after). Top edge = -Z (enemy side),
// right = +X. Everything higher than CAP above the floor is left out (wall tops would cover the floor).
//   VERIFY_PORT=8090 MAP=s375 [HALF=6000] [CAP=300] [OUT=floor.png] tools/run-playwright.sh tools/capture_arena_floor.mjs
// HALF = half the square's side in render units (the picture covers -HALF..HALF in x and z). Writes OUT and OUT.json.
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const MAP = process.env.MAP || "s375", HALF = +(process.env.HALF || 6000), CAP = +(process.env.CAP || 300);
const OUT = process.env.OUT || `arena_floor_${MAP}.png`, SIZE = 2048;
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

const out = await page.evaluate(({ HALF, CAP, SIZE }) => {
    // eye at CAP looking down, up = -Z: picture top = -Z, right = +X
    const c = window.__mpb.fight.r3d.captureArenaFace([0, CAP, 0], [0, CAP - 1, 0], [0, 0, -1], SIZE, { ortho: HALF, far: 60000 });
    const bin = atob(c.rgba), cv = document.createElement("canvas"); cv.width = cv.height = SIZE;
    const ctx = cv.getContext("2d"), img = ctx.createImageData(SIZE, SIZE), o = img.data;
    for (let j = 0; j < SIZE; j++) for (let i = 0; i < SIZE; i++) {   // readPixels rows run bottom-up
        const k = ((SIZE - 1 - j) * SIZE + i) * 4, q = (j * SIZE + i) * 4;
        o[q] = bin.charCodeAt(k); o[q + 1] = bin.charCodeAt(k + 1); o[q + 2] = bin.charCodeAt(k + 2); o[q + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return { arena: c.arena, png: cv.toDataURL("image/png").split(",")[1] };
}, { HALF, CAP, SIZE });
writeFileSync(OUT, Buffer.from(out.png, "base64"));
const meta = { map: MAP, arena: out.arena, half: HALF, cap: CAP, size: SIZE, top: "-Z", right: "+X", unitsPerPx: 2 * HALF / SIZE };
writeFileSync(OUT.replace(/\.png$/, "") + ".json", JSON.stringify(meta, null, 1));
console.log(JSON.stringify({ ...meta, out: OUT, pageErrors: errs.length ? errs : "none" }));
await browser.close();
