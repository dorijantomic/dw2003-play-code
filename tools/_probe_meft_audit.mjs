// Live check for the 2026-10-14 map-effects audit (the two fixes it landed).
//
//   A) s421 Qing Long City — wstag421's mode writer on the ORDINARY route:
//      with flag 0x1a0a clear the windmill records do not advance, and once
//      the flag is set they spin.  The flag's producer (s435's flag-set
//      script) is modelled with the game's own debug hook; setting it
//      mid-visit is a probe convenience — in real play the producer runs in
//      another stage, so a visit sees a constant flag and the walker's
//      per-frame gate reads exactly what the disc's stage-entry actor wrote.
//   B) the camera cull (F0x80089038 file 0x64f4) — a spinning record that
//      leaves the camera window FREEZES, and resumes when it comes back.
//
// Both read the renderer's own runtime (`window.__pointRecordActors.records`),
// which is the same array the draw paints from.
//
// Run: VERIFY_URL=http://localhost:8788 tools/run-playwright.sh tools/_probe_meft_audit.mjs
import { chromium } from "playwright";

const VERIFY_URL = process.env.VERIFY_URL || "http://localhost:8788";
const STAGE = "s421";
// The SECOND tag-1 record is the windmill at (817,114) (point_sprites.json).
// Not the first: record 0 is the display-slot variant record (fieldstg
// F0x80084B40 writes ITS active byte from the sixteen story ordinals), so it is
// switched off outside those beats and cannot show the mode gate.
const REC = 1;
const WINDMILL = [817, 114];
// A far corner for the cull leg, picked from the map's own size at runtime.

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));

await page.goto(`${VERIFY_URL}/index.html?skipTitle=1&map=${STAGE}&noEncounters=1`);
const style = page.locator("#asset-mode-authentic");
if (await style.isVisible().catch(() => false)) await style.click();
await page.waitForFunction(() => window.__state?.started, null, { timeout: 30000 });
await page.evaluate((mid) => {
    const i = window.__state.manifest.maps.findIndex((m) => m.id === mid);
    if (i >= 0) window.__setMap(i, null);
}, STAGE);
await page.waitForFunction(
    (mid) => (window.__pointRecordActors?.records(mid)?.length ?? 0) > 0,
    STAGE, { timeout: 30000 });

const frames = (n) => page.evaluate(async (count) => {
    for (let i = 0; i < count; i++) await new Promise((r) => requestAnimationFrame(r));
}, n);
const read = () => page.evaluate(([mid, i]) => {
    const r = window.__pointRecordActors.records(mid)[i];
    return { sprite: r.sprite, ctr: r.ctr, active: r.active, x: r.x, y: r.y };
}, [STAGE, REC]);
const sample = async (n) => {
    const seen = [];
    for (let i = 0; i < n; i++) { await frames(1); seen.push((await read()).sprite); }
    return seen;
};
const distinct = (a) => new Set(a).size;
const results = [];

// ── A) the s421 gate ────────────────────────────────────────────────────────
await page.evaluate(([x, y]) => window.__teleport(x, y), WINDMILL);
await frames(30); // let the camera settle on the windmill
const before = await sample(40);
results.push(["flag clear: the windmill is frozen", distinct(before) === 1,
    `sprites seen: ${[...new Set(before)].join(",")}`]);
await page.evaluate(() => window.__applyStoryFlag(0x1a0a, 1));
await frames(5);
const after = await sample(40);
results.push(["flag set: the windmill spins", distinct(after) > 1,
    `sprites seen: ${[...new Set(after)].join(",")}`]);

// ── B) the camera cull ──────────────────────────────────────────────────────
const map = await page.evaluate((mid) =>
    window.__state.manifest.maps.find((m) => m.id === mid), STAGE);
const corner = [Math.max(40, map.width - 60), Math.max(40, map.height - 60)];
await page.evaluate(([x, y]) => window.__teleport(x, y), corner);
await frames(30);
const cam = await page.evaluate(() => ({ x: window.__cam.x, y: window.__cam.y }));
const viewW = 320; // VIEW_W / ZOOM — the logical view the cull window is built from
const viewH = 240; // VIEW_H / ZOOM
const offscreen = WINDMILL[0] < cam.x - 74 || WINDMILL[0] > cam.x + viewW
    || WINDMILL[1] < cam.y - 74 || WINDMILL[1] > cam.y + viewH;
const away = await sample(40);
results.push([`culled (cam ${Math.round(cam.x)},${Math.round(cam.y)}): frozen`,
    offscreen && distinct(away) === 1,
    `offscreen=${offscreen} sprites seen: ${[...new Set(away)].join(",")}`]);
await page.evaluate(([x, y]) => window.__teleport(x, y), WINDMILL);
await frames(30);
const back = await sample(40);
results.push(["back in view: spinning again", distinct(back) > 1,
    `sprites seen: ${[...new Set(back)].join(",")}`]);

let ok = true;
for (const [name, pass, detail] of results) {
    console.log(`${pass ? "PASS" : "FAIL"}  ${name}  [${detail}]`);
    if (!pass) ok = false;
}
if (errs.length) { console.log("page errors:", errs); ok = false; }
console.log(`VERDICT ${ok ? "OK" : "FAILED"}  (map ${STAGE} ${map.width}x${map.height})`);
await browser.close();
process.exit(ok ? 0 : 1);
