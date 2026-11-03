// HD Remaster wide overworld (web/field-view.js, F2 -> Screen -> Wide overworld): the real game, headless,
// checked by numbers only (canvas sizes, the camera, the frame rule, pixel brightness of the side strips).
// No screenshots.
//
//   VERIFY_PORT=8090 tools/run-playwright.sh tools/verify_wide_field.mjs
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { baseUrl } from "./verify-base-url.mjs";

const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const results = {};

async function boot(mode, wide, viewport = { width: 1920, height: 1080 }) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(({ mode, wide }) => {
    localStorage.setItem("assetMode", mode);
    localStorage.setItem("engineSchema", "2");
    localStorage.setItem("charId", "p006agum");
    localStorage.setItem("party", JSON.stringify(["p006agum"]));
    localStorage.setItem("partnerStats", JSON.stringify({ digimonId: 4, level: 1, hp: 500, maxHp: 500, mp: 100, maxMp: 100 }));
    localStorage.setItem("dw.fx.v1", JSON.stringify({ widefield: wide }));
  }, { mode, wide });
  await page.goto(`${baseUrl(8742)}/index.html?skipTitle=1&noEncounters=1`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__state?.started);
  await page.keyboard.press("f");   // window fill
  await page.waitForFunction(() => document.documentElement.classList.contains("window-fill"));
  await page.waitForTimeout(600);
  return { context, page, errors };
}

// Mean brightness (0-255) of a vertical strip of the canvas, in canvas pixels.
async function stripBrightness(page, x0, x1) {
  return page.evaluate(([x0, x1]) => {
    const c = document.getElementById("game");
    const g = c.getContext("2d");
    const w = Math.max(1, Math.round(x1 - x0));
    const d = g.getImageData(Math.round(x0), 0, w, c.height).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += (d[i] + d[i + 1] + d[i + 2]) / 3;
    return sum / (d.length / 4);
  }, [x0, x1]);
}

async function frame(page) {
  return page.evaluate(() => {
    const c = document.getElementById("game");
    const st = window.__state;
    const m = st.manifest.maps[st.mapIdx];
    return {
      map: m.id, mapW: m.width, x: st.x, y: st.y,
      backing: [c.width, c.height], display: [c.clientWidth, c.clientHeight],
      stage: [c.parentElement.clientWidth, c.parentElement.clientHeight],
      snap: window.__fieldCanvasResolution.snapshot(),
      wide: { ...window.__wideField },
      cam: { ...window.__lastCam },
    };
  });
}

// 1. HD + wide: the canvas takes the 16:9 stage, the box is the middle, the camera is the wide one.
{
  const { context, page, errors } = await boot("hd", true);
  await page.waitForFunction(() => window.__wideField?.sides >= 1 && window.__wideField?.camK >= 1);
  const f = await frame(page);
  console.log("hd wide", JSON.stringify(f));
  assert.equal(f.snap.padX, 106, "53 native px each side at 16:9");
  assert.ok(Math.abs(f.backing[0] / f.backing[1] - 852 / 480) < 0.01, "backing has the wide shape");
  assert.ok(Math.abs(f.display[0] - f.stage[0]) <= 4 && Math.abs(f.display[1] - f.stage[1]) <= 2, "canvas fills the stage (the view is whole map pixels wide)");
  // The camera: the wide view centred on the player, clamped in the map, box in the middle.
  const pad = 53;
  const expect = Math.min(Math.max(f.x - 160 - pad, 0), f.mapW - 320 - 2 * pad) + pad;
  const dpm = f.snap.scaleX * 2;
  assert.ok(Math.abs(f.cam.x - Math.round(expect * dpm) / dpm) < 1e-6, `cam ${f.cam.x} vs ${expect}`);
  const sidePx = Math.floor(f.snap.padX * f.snap.scaleX);
  const left = await stripBrightness(page, 0, sidePx - 2);
  const right = await stripBrightness(page, f.backing[0] - sidePx + 2, f.backing[0]);
  console.log("side brightness", left.toFixed(1), right.toFixed(1));
  assert.ok(left > 8 && right > 8, "the map is drawn in both side strips");

  // Walk to the left map edge: the WIDE view stops at 0, so the box camera is pad in.
  await page.evaluate(() => { window.__state.x = 4; });
  await page.waitForTimeout(300);
  const fe = await frame(page);
  if (fe.mapW >= 320 + 2 * pad) assert.ok(Math.abs(fe.cam.x - pad) < 1, `left edge cam ${fe.cam.x}`);

  // A full-screen screen: the camera stays, the sides are covered.
  await page.evaluate(() => window.__labOpen("menu"));
  await page.waitForFunction(() => window.__wideField.sides <= 0);
  const fm = await frame(page);
  assert.equal(fm.wide.camK, 1, "menu keeps the camera");
  const leftMenu = await stripBrightness(page, 0, sidePx - 2);
  console.log("menu side brightness", leftMenu.toFixed(1));
  assert.ok(leftMenu < 1, "sides covered under a menu");
  results.hdWide = { f, fe: fe.cam, left, right, leftMenu, errors };

  // Switched off while playing: back to the 4:3 box, filling the stage height.
  await page.evaluate(() => window.__setFx("widefield", false));
  await page.waitForTimeout(500);
  const fo = await frame(page);
  console.log("switched off", JSON.stringify({ backing: fo.backing, display: fo.display, padX: fo.snap.padX }));
  assert.ok(!fo.snap.padX);
  assert.ok(Math.abs(fo.backing[0] / fo.backing[1] - 4 / 3) < 0.01, "4:3 backing");
  assert.ok(Math.abs(fo.display[0] / fo.display[1] - 4 / 3) < 0.01, "4:3 on screen");
  assert.deepEqual(errors, []);
  await context.close();
}

// 2. A staged scene (it walks an actor): back to the disc's own clamp, sides covered.
{
  const { context, page, errors } = await boot("hd", true);
  await page.waitForFunction(() => window.__wideField?.camK >= 1);
  const staged = await page.evaluate(() => {
    const st = window.__state;
    // stand near the left edge, where the wide and the original clamps differ
    st.x = 60;
    const ev = { disasm: ["WAIT 120", "WALKTO 2 60 " + Math.round(st.y), "WAIT 120", "END"] };
    window.__playStoryEvent(ev, () => {});
    return window.__cutscene.isActive();
  });
  assert.equal(staged, true);
  await page.waitForFunction(() => window.__wideField.camK <= 0 && window.__wideField.sides <= 0, null, { timeout: 5000 });
  const f = await frame(page);
  const follow = Math.min(Math.max(f.x - 160, 0), f.mapW - 320);
  console.log("staged", JSON.stringify(f.wide), "cam", f.cam.x, "original", follow);
  assert.ok(Math.abs(f.cam.x - follow) < 1, "the original clamp");
  results.staged = { wide: f.wide, cam: f.cam.x, follow, errors };
  assert.deepEqual(errors, []);
  await context.close();
}

// 3. Setting off, and Authentic with it on: the original 4:3 canvas.
for (const [mode, wide] of [["hd", false], ["authentic", true]]) {
  const { context, page, errors } = await boot(mode, wide);
  const f = await frame(page);
  console.log(mode, wide, JSON.stringify({ backing: f.backing, padX: f.snap.padX, wide: f.wide }));
  assert.ok(!f.snap.padX, "no pad");
  if (mode === "authentic") assert.deepEqual(f.backing, [640, 480]);
  else assert.ok(Math.abs(f.backing[0] / f.backing[1] - 4 / 3) < 0.01, "4:3");
  assert.deepEqual(errors, []);
  await context.close();
}

await browser.close();
console.log("verify_wide_field: OK");
