// Stage default spawn — end-to-end regression.
//
// A stage entered with no warp spawn must place the leader at the scene
// descriptor's own default (descriptor +0x2C/+0x30, 24.8 fixed -> map pixels by
// >>8; fieldstg F0x8009116c). Before this the walker centred the player.
//
// Run with a web server on port 8742:
//   python3 -m http.server 8742 --directory web
//   tools/run-playwright.sh tools/verify_stage_default_spawn.mjs
import assert from "node:assert/strict";
import { baseUrl } from "./verify-base-url.mjs";
import { readFileSync } from "node:fs";
import { chromium } from "playwright";

// One origin, from the shared helper: VERIFY_PORT moves this check off 8742.
const ROOT = baseUrl(8742);
const PARTY = ["p003pken", "p005koet", "p004kogu"];
const SPAWN = JSON.parse(readFileSync("web/assets/data/stage_default_spawn.json", "utf8"));
const STAGES = ["s200", "s485", "s895", "s271"];
const MANIFEST = JSON.parse(readFileSync("web/assets/manifest.json", "utf8"));
const MAPS = Object.fromEntries((MANIFEST.maps ?? MANIFEST).map((m) => [m.id, m]));

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

  const enter = (screen) => frame.evaluate(async (sid) => {
    const st = window.__state;
    const idx = st.manifest.maps.findIndex((m) => m.id === sid);
    window.__setMap(idx);
    // setMap runs after the async stage-asset prepare; wait two frames past it.
    for (let i = 0; i < 20; i++) await new Promise((r) => requestAnimationFrame(r));
    return { screen: st.manifest.maps[st.mapIdx].id, x: Math.round(st.x), y: Math.round(st.y) };
  }, screen);

  for (const sid of STAGES) {
    const got = await enter(sid);
    assert.equal(got.screen, sid);
    const def = SPAWN[sid];
    const map = MAPS[sid];
    // The asset is loaded and is the authority for this screen.
    const loaded = await frame.evaluate((s) => window.__state.stageDefaultSpawn?.[s] ?? null, sid);
    assert.deepEqual(loaded, def, `${sid} default spawn must be loaded from the asset`);
    // The player lands on it, allowing the walker's collision foot-box to nudge a
    // cell or two; and it is nothing like the old centre fallback.
    const toDef = Math.hypot(got.x - def.x, got.y - def.y);
    const toCentre = Math.hypot(got.x - map.width / 2, got.y - map.height / 2);
    assert.ok(toDef <= 24, `${sid} must spawn at its descriptor default, got (${got.x},${got.y}) vs (${def.x},${def.y})`);
    assert.ok(toCentre > 60, `${sid} must not use the centre fallback, got (${got.x},${got.y})`);
  }
  assert.deepEqual(errors, [], "no page errors");

  console.log(`stage default spawn OK — ${STAGES.map((s) => `${s}@${SPAWN[s].x},${SPAWN[s].y}`).join(", ")}`);
} finally {
  await browser.close();
}
