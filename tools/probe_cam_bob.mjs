// probe: does the 1v1 battle camera move up/down with the fighters' breathing? eye/look y + pitch, 60 samples
import { chromium } from "playwright";
import { baseUrl } from "./verify-base-url.mjs";
const ROOT = baseUrl(Number(process.env.VERIFY_PORT || 8090));
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1140, height: 720 } });
await page.addInitScript(() => localStorage.setItem("assetMode", "hd"));
await page.goto(`${ROOT}/index.html?skipTitle=1&map=s340`, { waitUntil: "load", timeout: 60000 });
await page.waitForFunction(() => window.__state?.started === true, null, { timeout: 40000 });
await page.waitForTimeout(1200);
await page.evaluate(() => { window.__fx.battlepano = true; const s = window.__state;
  if (!s.party?.length) { s.party = ["p003pken", "p009rena", "p010pata"]; s.packId = "A"; s.charId = "p003pken";
    const ci = s.manifest?.characters?.findIndex((c) => c.id === "p003pken") ?? -1; if (ci > 0) s.charIdx = ci;
    const block = (digimonId, hp, mp) => ({ digimonId, level: 5, xp: 0, tp: 0, hp, maxHp: hp, mp, maxMp: mp, bonuses: {}, elemBonuses: {} });
    s.partnerStats = block(1, 86, 38); s.partyStats = [s.partnerStats, block(7, 80, 40), block(8, 90, 55)]; } });
let active = false; const dirs = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"];
for (let i = 0; i < 80 && !active; i++) {
  await page.evaluate(() => { window.__state._encTick = 0; window.__state._encCounter = 0; });
  const k = dirs[i % 4]; await page.keyboard.down(k); await page.waitForTimeout(400); await page.keyboard.up(k);
  active = await page.evaluate(() => !!window.__battle?.isActive?.()); await page.waitForTimeout(120);
}
if (!active) { console.log("no encounter"); process.exit(0); }
await page.waitForTimeout(8000);   // let the opening camera finish
const rows = [];
for (let i = 0; i < 60; i++) {
  rows.push(await page.evaluate(() => { const c = window.__battle3d.getCameraInfo(), p = window.__battle3d.getPanorama();
    const d = c.look.map((v, k) => v - c.eye[k]); return { ey: c.eye[1], ly: c.look[1], pitch: Math.atan2(d[1], Math.hypot(d[0], d[2])) * 180 / Math.PI, ex: c.eye[0], ez: c.eye[2], feet: p.feet, h: p.heights }; }));
  await page.waitForTimeout(100);
}
const rng = (a) => [Math.min(...a), Math.max(...a)].map((v) => +v.toFixed(2));
console.log("eyeY", rng(rows.map((r) => r.ey)), "lookY", rng(rows.map((r) => r.ly)), "pitchDeg", rng(rows.map((r) => r.pitch)),
  "eyeX", rng(rows.map((r) => r.ex)), "eyeZ", rng(rows.map((r) => r.ez)));
console.log("fighter heights", rng(rows.map((r) => r.h?.[0] ?? 0)), rng(rows.map((r) => r.h?.[1] ?? 0)), "feet0", rng(rows.map((r) => r.feet?.[0] ?? 0)));
console.log(rows.map((r) => `${r.ly.toFixed(0)}/${r.ey.toFixed(0)}/${r.pitch.toFixed(2)}/${(r.feet?.[0] ?? 0).toFixed(1)}`).join(" "));
await browser.close();
