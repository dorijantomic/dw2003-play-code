import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";
import { baseUrl } from "./verify-base-url.mjs";

const out = process.argv[2] ?? "/tmp/hd-canvas";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});

async function verifyMode(mode) {
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript((selected) => {
    localStorage.setItem("assetMode", selected);
    localStorage.setItem("engineSchema", "2");
    localStorage.setItem("charId", "p006agum");
    localStorage.setItem("party", JSON.stringify(["p006agum"]));
    localStorage.setItem("partnerStats", JSON.stringify({
      digimonId: 4,
      level: 1,
      hp: 500,
      maxHp: 500,
      mp: 100,
      maxMp: 100,
    }));
  }, mode);
  await page.goto(
    `${baseUrl(8742)}/index.html?skipTitle=1&noEncounters=1`,
    { waitUntil: "load" },
  );
  await page.waitForFunction(() => window.__state?.started);
  await page.keyboard.press("f");
  await page.waitForFunction(() => document.fullscreenElement?.id === "stage");
  await page.waitForFunction((selected) => {
    const snapshot = window.__fieldCanvasResolution?.snapshot();
    return snapshot?.hd === (selected === "hd");
  }, mode);
  await page.waitForTimeout(250);

  const result = await page.evaluate(() => {
    const canvas = document.getElementById("game");
    const snapshot = window.__fieldCanvasResolution.snapshot();
    return {
      backing: [canvas.width, canvas.height],
      display: [canvas.clientWidth, canvas.clientHeight],
      snapshot,
    };
  });
  if (mode === "hd") {
    // A 1920x1080 window letterboxes the game's 4:3 screen to 1440x1080. The
    // old thresholds wanted >= 1500 wide, which only held while the canvas was
    // 640x448 (10:7) -- a shape the disc never draws. See UI-DISPLAY-EXTENT-001.
    assert.ok(result.backing[0] >= 1400, JSON.stringify(result));
    assert.ok(result.backing[1] >= 1070, JSON.stringify(result));
    assert.ok(result.snapshot.scaleX > 2, JSON.stringify(result));
    assert.ok(result.snapshot.scaleY > 2, JSON.stringify(result));
  } else {
    assert.deepEqual(result.backing, [640, 480]);
    assert.equal(result.snapshot.scaleX, 1);
    assert.equal(result.snapshot.scaleY, 1);
  }
  assert.deepEqual(errors, []);

  await page.screenshot({ path: `${out}/${mode}-field-1920x1080.png` });
  await page.evaluate(() => window.__labOpen("menu"));
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${out}/${mode}-1920x1080.png` });

  if (mode === "hd") {
    const playerSeed = await page.evaluate(async () => {
      await window.__battle.loadData();
      return {
        charIdx: window.__state.charIdx,
        charId: window.__state.manifest.characters[window.__state.charIdx]?.id,
        party: window.__state.party,
        profile: window.__battle.getPlayerProfile(window.__state)?.name ?? null,
      };
    });
    console.log("battle player seed", playerSeed);
    const started = await page.evaluate(async () => {
      const state = window.__state;
      const mapId = state.manifest.maps[state.mapIdx].id;
      return window.__battle.startScreen(
        200,
        () => {},
        () => {},
        () => {},
        { mapId },
      );
    });
    assert.equal(started, true);
    const battleState = await page.evaluate(() => {
      const canvas = document.getElementById("game");
      return {
        active: window.__battle.isActive(),
        fullscreenClass: canvas.classList.contains("battle-fs"),
        backing: [canvas.width, canvas.height],
      };
    });
    console.log("battle handoff", battleState);
    assert.equal(battleState.active, true);
    assert.equal(battleState.fullscreenClass, true);
    const battleBacking = battleState.backing;
    assert.ok(battleBacking[0] >= 1500, JSON.stringify(battleBacking));
    assert.ok(battleBacking[1] >= 800, JSON.stringify(battleBacking));
    result.battleBacking = battleBacking;
  }
  await context.close();
  return result;
}

const authentic = await verifyMode("authentic");
const hd = await verifyMode("hd");
await browser.close();
console.log(JSON.stringify({ authentic, hd }, null, 2));
console.log(`OK — authentic and HD fullscreen canvases verified; screenshots in ${out}`);
