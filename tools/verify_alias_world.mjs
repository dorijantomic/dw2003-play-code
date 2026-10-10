import assert from "node:assert/strict";
import { chromium } from "playwright";
import { baseUrl } from "./verify-base-url.mjs";

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const failed = [];
  page.on("requestfailed", (req) => failed.push(req.url()));
  page.on("response", (res) => {
    if (res.status() >= 400) failed.push(`${res.status()} ${res.url()}`);
  });

  // The title is the native STDWTITL screen now, so its DOM "New Game" option is
  // hidden and cannot be clicked. Boot straight into the field with skipTitle and
  // clear storage before the second load, which is what the click used to give.
  await page.goto(`${baseUrl(8741)}/?noEncounters=1`);
  await page.evaluate(() => localStorage.clear());
  // Boot straight onto s920: skipTitle alone starts the default opening map and
  // its OnEnterMap chain (the s200 story battle), which leaves the engine bridge
  // busy and suppresses every later player exit. A concrete map avoids that.
  await page.goto(`${baseUrl(8741)}/?skipTitle=1&map=s920&noEncounters=1`);
  await page.waitForFunction(() => window.__state?.started, null, { timeout: 15_000 });

  await page.selectOption("#mapSelect", "s920");
  await page.waitForFunction(() => {
    const s = window.__state;
    return s.manifest.maps[s.mapIdx].id === "s920" && s.mapImgs.s920 instanceof Image;
  }, null, { timeout: 15_000 });

  const result = await page.evaluate(() => {
    const s = window.__state;
    const map = s.manifest.maps[s.mapIdx];
    const scene = s.scenes.s920;
    return {
      mapId: map.id,
      assetSource: map.assetSource,
      image: map.image,
      collisionLoaded: !!s.collision.s920,
      exits: scene.exits.map((e) => e.to),
      npcCount: scene.npcs.length,
    };
  });

  assert.equal(result.mapId, "s920");
  assert.equal(result.assetSource, "s201");
  assert.equal(result.image, "assets/maps/s201.png");
  assert.equal(result.collisionLoaded, true);
  assert.ok(result.exits.length > 0);
  assert.ok(result.exits.every((to) => /^s9[2-5]\d$/.test(to)));
  assert.ok(result.npcCount > 0);
  assert.deepEqual(failed.filter((url) => /s920|s201/.test(url)), []);

  // Exercise an actual decoded op-10 controller zone. Entering s960 must also
  // synthesize the proven context-sensitive return at the arrival pad.
  await page.selectOption("#mapSelect", "s943");
  // s943 plays an authored OnEnterMap cutscene that also auto-walks the player;
  // it freezes the field tick, so activeExitAt never updates. Advance it with
  // the ordinary confirm key until the field is quiet before seeding.
  await page.waitForFunction(
    () => window.__state.manifest.maps[window.__state.mapIdx].id === "s943",
    null, { timeout: 10_000 },
  );
  for (let i = 0; i < 80; i++) {
    const busy = await page.evaluate(() => (window.__cutscene?.isActive?.() ?? false)
      || (window.__textbox?.isOpen?.() ?? false));
    if (!busy) break;
    await page.keyboard.press("Enter");
    await page.waitForTimeout(200);
  }
  const dive = await page.evaluate(() => {
    const exit = window.__state.scenes.s943.exits.find(
      (candidate) => candidate.transition === "dive" && candidate.to === "s960",
    );
    window.__state.x = exit.x + exit.w / 2;
    window.__state.y = exit.y + exit.h / 2;
    document.querySelector("#mapSelect").blur();
    document.body.focus();
    return exit;
  });
  assert.equal(dive.grid, true);
  assert.equal(dive.stepOp, 10);
  await page.waitForFunction(() => window.__state.onExit === true);
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => {
    const s = window.__state;
    return s.manifest.maps[s.mapIdx].id === "s960" &&
      s.scenes.s960.exits.some((exit) => exit._entranceReturn && exit.to === "s943");
  }, null, { timeout: 10_000 });

  const diveResult = await page.evaluate(() => ({
    mapId: window.__state.manifest.maps[window.__state.mapIdx].id,
    returnTo: window.__state.scenes.s960.exits.find((exit) => exit._entranceReturn)?.to,
  }));
  assert.deepEqual(diveResult, { mapId: "s960", returnTo: "s943" });

  console.log(JSON.stringify({ alias: result, dive: diveResult }));
} finally {
  await browser.close();
}
