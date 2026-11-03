// F2 -> Screen -> "Battle camera a little further out" (HD Remaster only, web/battle3d.js BATTLE_WIDE_DOLLY):
// the real game, headless, by numbers only. In one battle the setting is flipped off / on / off on
// consecutive frames; with it on the idle camera's eye-to-target distance must be 1.25x the frames either
// side, the target and the field of view unchanged. In Authentic the setting must change nothing.
// No screenshots.
//
//   VERIFY_PORT=8090 tools/run-playwright.sh tools/verify_battle_wide.mjs
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { baseUrl } from "./verify-base-url.mjs";

const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });

async function measure(mode) {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript((mode) => {
    localStorage.setItem("assetMode", mode);
    localStorage.setItem("engineSchema", "2");
    localStorage.setItem("charId", "p006agum");
    localStorage.setItem("party", JSON.stringify(["p006agum"]));
    localStorage.setItem("partnerStats", JSON.stringify({ digimonId: 4, level: 1, hp: 500, maxHp: 500, mp: 100, maxMp: 100 }));
  }, mode);
  await page.goto(`${baseUrl(8742)}/index.html?skipTitle=1&noEncounters=1`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__state?.started);
  await page.evaluate(async () => {
    await window.__battle.loadData();
    const st = window.__state;
    return window.__battle.startScreen(200, () => {}, () => {}, () => {}, { mapId: st.manifest.maps[st.mapIdx].id });
  });
  await page.waitForFunction(() => window.__battle3d?.getCameraInfo?.(), null, { timeout: 30000 });
  await page.waitForTimeout(2000);
  const rows = await page.evaluate(async () => {
    const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const read = () => {
      const c = window.__battle3d.getCameraInfo();
      const d = Math.hypot(c.eye[0] - c.look[0], c.eye[1] - c.look[1], c.eye[2] - c.look[2]);
      return { d, look: c.look, fov: c.fovDeg, mode: window.__battle3d.getCameraMode() };
    };
    const out = [];
    for (let i = 0; i < 4; i++) {
      window.__fx.battlewide = false; await frame(); const a = read();
      window.__fx.battlewide = true; await frame(); const b = read();
      window.__fx.battlewide = false; await frame(); const c = read();
      out.push({ a, b, c });
      await new Promise((r) => setTimeout(r, 700));
    }
    return out;
  });
  await context.close();
  assert.deepEqual(errors, []);
  return rows;
}

for (const mode of ["hd", "authentic"]) {
  const rows = await measure(mode);
  for (const { a, b, c } of rows) {
    const base = (a.d + c.d) / 2;
    const ratio = b.d / base;
    const drift = Math.abs(a.d - c.d) / base;          // how far the director's own walk moved in between
    console.log(mode, b.mode, "ratio", ratio.toFixed(4), "drift", drift.toFixed(4), "fov", b.fov.toFixed(3));
    if (drift > 0.01) continue;                        // the shot cut between the frames: not comparable
    if (mode === "hd") assert.ok(Math.abs(ratio - 1.25) < 0.01, `hd ratio ${ratio}`);
    else assert.ok(Math.abs(ratio - 1) < 0.01, `authentic ratio ${ratio}`);
    for (let i = 0; i < 3; i++) assert.ok(Math.abs(b.look[i] - (a.look[i] + c.look[i]) / 2) < 5, "same target");
    assert.ok(Math.abs(b.fov - a.fov) < 1e-6, "same field of view");
  }
}
await browser.close();
console.log("verify_battle_wide: OK");
