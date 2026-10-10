// The ordinary field camera follows the leader at native (160,140), not (160,120).
//
// Decode: fieldstg F0x8008D998 copies the leader's world position into the
// camera target every frame (no lag, no dead band), and F0x8008D788 subtracts
// the fixed view centre — `addiu $s2,$v1,-0xa0` (x, 160) and
// `addiu $s3,$a0,-0x8c` (y, 140) — then clamps to the map
// (`exe-decomp/fieldstg_c/_asm/F0x8008d788.s` .L0x0000ab18 / .L0x0000ab28).
// The walker's free-roam branch used VIEW/2 = 120 vertically, so the whole view
// sat 20 map pixels high; this drives the running game to prove the fix.
//
// Server: python3 -m http.server 8742 --directory web
// Run:    VERIFY_PORT=8742 node tools/verify_field_camera_center.mjs
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";
import { baseUrl } from "./verify-base-url.mjs";

const OUT = process.env.CAM_SHOT || "/tmp/field-camera-center";
const STAGE = process.env.CAM_STAGE || "s205";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
await page.goto(`${baseUrl(8742)}/?skipTitle=1&map=${STAGE}&noEncounters=1`, { waitUntil: "load" });
await page.waitForFunction(() => window.__state?.started, null, { timeout: 40000 });
await page.waitForTimeout(1500);

const info = await page.evaluate(() => window.__mapInfo());
console.log(`stage ${info.id}: map ${info.width}x${info.height}, view ${info.viewW}x${info.viewH}`);

// Park the leader well inside the map so neither clamp fires, then read the
// camera the running render path produced.
async function camAt(x, y) {
  await page.evaluate(([px, py]) => window.__teleport(px, py), [x, y]);
  // A couple of rendered frames so the camera settles onto the new target.
  await page.evaluate(() => new Promise((r) =>
    requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.waitForTimeout(120);
  return page.evaluate(() => ({ x: window.__cam.x, y: window.__cam.y }));
}

const tx = Math.round(info.width / 2);
const ty = Math.round(info.height / 2);
const cam = await camAt(tx, ty);
await page.screenshot({ path: `${OUT}/${info.id}-camera.png` });

// Whole-device-pixel snap is tolerated (<= half a device pixel).
const tol = 0.5 / (info.zoom || 1) + 1e-6;
const expX = tx - 160;
const expY = ty - 140;
console.log(`leader (${tx},${ty}) -> camera (${cam.x.toFixed(2)},${cam.y.toFixed(2)}); `
  + `disc expects (${expX},${expY}); old VIEW/2 would give y=${ty - 120}`);
assert.ok(Math.abs(cam.x - expX) <= tol, `${info.id}: camera x ${cam.x} != ${expX}`);
assert.ok(Math.abs(cam.y - expY) <= tol,
  `${info.id}: camera y ${cam.y} != ${expY} (the disc's 140 centre, not 120)`);
// The old value must be distinguishable, so this check cannot pass on the old code.
assert.ok(Math.abs(cam.y - (ty - 120)) > 10,
  `${info.id}: camera y ${cam.y} is still near the old VIEW/2 = ${ty - 120}`);

// The clamp still holds near an edge.
const edge = await camAt(4, 4);
assert.ok(edge.x === 0 && edge.y === 0, `${info.id}: near the origin the view must pin to 0,0`);
console.log(`${info.id}: free-roam camera centres at (160,140) and clamps inside the map`);

assert.deepEqual(errs, []);
await browser.close();
