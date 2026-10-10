// Cardmon booster reward — end-to-end regression.
//
// Beat a Cardmon (the Card-Battle enemy you meet in water stages and by fishing)
// and the result screen hands you a Booster pack, chosen by the field screen and
// the enemy id's parity. This drives the REAL field battle path in the ui-lab,
// forces the win, and checks the report's dropped item.
//
// Decode: engine/dw3/cardmon-booster.ts; extraction:
// tools/extract_cardmon_boosters.py. Screen 327 is Cardmon (runtime id 457, odd);
// s485 (0x1E5) is below both table ranges, so it takes the default
// Booster1b (375) / RBooster01 (390).
//
// Run with a web server on port 8742:
//   python3 -m http.server 8742 --directory web
//   tools/run-playwright.sh tools/verify_cardmon_booster.mjs
import assert from "node:assert/strict";
import { baseUrl } from "./verify-base-url.mjs";
import { chromium } from "playwright";

// One origin, from the shared helper: VERIFY_PORT moves this check off 8742.
const ROOT = baseUrl(8742);
const PARTY = ["p003pken", "p005koet", "p004kogu"];
const CARDMON_SCREEN = 327; // field_encounters screen for Cardmon, runtime id 457
const FIELD_SCREEN = "s485"; // out of the booster table's ranges
const DEFAULTS = [0x177, 0x186]; // Booster1b / RBooster01

const browser = await chromium.launch();
const errors = [];
try {
  const context = await browser.newContext({
    viewport: { width: 900, height: 700 },
    storageState: {
      cookies: [],
      origins: [{
        origin: ROOT,
        localStorage: [
          { name: "engineSchema", value: "2" },
          { name: "party", value: JSON.stringify(PARTY) },
          { name: "charId", value: PARTY[0] },
        ],
      }],
    },
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${ROOT}/ui-lab.html`, { waitUntil: "load" });
  await page.waitForFunction(() => {
    const f = document.getElementById("game");
    return f?.contentWindow?.__labOpen && f.contentWindow.__state?.started;
  }, null, { timeout: 30_000 });
  await page.waitForTimeout(1200);
  const frame = page.frames().find((f) => f.url().includes("index.html"));
  const raf = (n) => frame.evaluate(async (k) => {
    for (let i = 0; i < k; i++) await new Promise((r) => requestAnimationFrame(r));
  }, n);

  await frame.evaluate(() => {
    if (window.__cutscene.isActive()) window.__cutscene.start([], null, () => {});
  });
  await frame.evaluate(async ([screen, mapId]) => {
    await window.__battle.startScreen(screen, () => {}, null, null, { mapId });
  }, [CARDMON_SCREEN, FIELD_SCREEN]);
  await raf(20);
  const enemy = await frame.evaluate(() => window.__battleB?.()?.enemy?.eStats?.enemy_id ?? null);
  assert.equal(enemy, "Cardmon", `expected a Cardmon battle, got ${enemy}`);

  // Force the kill, then advance the win presentation.
  await frame.evaluate(() => { window.__battleB().enemy.hp = 0; });
  let result = null;
  for (let i = 0; i < 80; i++) {
    await frame.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" })));
    await raf(5);
    await frame.evaluate(() => window.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter" })));
    await raf(5);
    result = await frame.evaluate(() => ({
      id: window.__battleB?.()?._cardmonBoosterId ?? null,
      reward: window.__battleB?.()?._winReward?.droppedItem?.name ?? null,
      loot: (window.__battleB?.()?._loot?.drops ?? []).slice(),
      state: window.__battleB?.()?.state,
    }));
    if (result.reward) break;
  }
  assert.ok(DEFAULTS.includes(result.id), `expected a default booster id, got ${JSON.stringify(result)}`);
  assert.match(result.reward, /Booster/, `expected a booster item name, got ${JSON.stringify(result)}`);
  // endBattle banks every name in _loot.drops into the bag, so the reward must be
  // queued there, not only shown on the report.
  assert.ok(result.loot.includes(result.reward),
    `the booster must be queued in _loot.drops, got ${JSON.stringify(result.loot)}`);
  assert.deepEqual(errors, [], "no page errors");

  // A non-Cardmon fight must NOT grant a booster.
  await frame.evaluate(async () => {
    await window.__battle.startScreen(1, () => {}, null, null, { mapId: "s200" });
  });
  await raf(20);
  const plain = await frame.evaluate(() => ({
    id: window.__battleB?.()?._cardmonBoosterId ?? null,
    enemy: window.__battleB?.()?.enemy?.eStats?.enemy_id ?? null,
  }));
  assert.notEqual(plain.enemy, "Cardmon");
  assert.equal(plain.id, null, `non-Cardmon must not select a booster, got ${JSON.stringify(plain)}`);

  console.log(`cardmon booster OK — Cardmon on ${FIELD_SCREEN} -> ${result.id} (${result.reward}); non-Cardmon -> none`);
} finally {
  await browser.close();
}
