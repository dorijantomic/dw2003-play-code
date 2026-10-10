// Section 7 opening coverage, case 3: the first field control.
//
// Runs the tail of the real opening from s790 (Chamber Room) through the two
// screen handoffs to s210 (Asuka City Main Lobby) and checks that control is
// actually released there: a short ordinary input must move the player, and a
// released key must stop them. This also settles the old "s210 stall": s210 has
// no OnEnterMap event, so a verifier that only presses Enter sees no map change
// on a walkable map. That is an incomplete test, not a stuck game.
//
// Server: python3 -m http.server 8741 --directory web
// Run:    .opencode/autonomy/check-browser tools/verify_first_field_control.mjs
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const ROOT = process.env.FFC_ROOT || `${baseUrl(8741)}/`;
const OUT = process.env.FFC_SHOT || "/tmp/first-field-control";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
const errors = [];
page.on("pageerror", (e) => { errors.push(e.message); console.error("PAGEERROR", e.message); });

await page.addInitScript(() => {
  localStorage.setItem("assetMode", "authentic");
  localStorage.setItem("engineSchema", "2");
  for (const k of [
    "playerName", "charId", "party", "pendingParty", "packId", "partnerStats",
    "partyStats", "equipment", "flags", "engineFlags", "progressOrdinal",
    "bits", "inventory", "rosterOwned", "reserveStats", "reserveEquipment",
  ]) localStorage.removeItem(k);
});

const shot = async (name) => {
  writeFileSync(`${OUT}/${name}.png`, await page.screenshot());
  console.log("shot", name);
};
const field = () => page.evaluate(() => ({
  map: window.__state.manifest.maps[window.__state.mapIdx].id,
  x: Math.round(window.__state.x),
  y: Math.round(window.__state.y),
  cut: window.__cutscene?.isActive?.() ?? false,
  tb: window.__textbox?.isOpen?.() ?? false,
  fade: window.__fade?.dir ?? 0,
}));

let failed = null;
const fail = async (msg) => {
  failed = msg;
  console.error("FAIL:", msg);
  try {
    writeFileSync(`${OUT}/failure-state.json`, JSON.stringify(await field(), null, 2));
    await shot("failure");
  } catch { /* page may be gone */ }
};

try {
  // Seed the tail of the opening: s790 fires on ordinal 1 (bank-0x60 flag
  // 0x6001); the two handoffs then carry the player to the first walkable map.
  await page.goto(ROOT + "?skipTitle=1&map=s790&noEncounters=1");
  await page.waitForFunction(() => window.__state?.started, null, { timeout: 10_000 });
  await page.evaluate(() => {
    window.__engine.state.vars.set("$story.ordinal", 1);
    window.__engineBridge.onStageEnter("s790");
    window.__gameSpeed = 8;
  });

  const deadline = Date.now() + 20_000;
  let arrived = null;
  while (Date.now() < deadline) {
    const st = await field();
    if (st.map === "s210" && !st.cut && !st.tb && st.fade === 0) { arrived = st; break; }
    if (st.tb) await page.keyboard.press("Enter");
    await page.waitForTimeout(60);
  }
  await page.evaluate(() => { window.__gameSpeed = 1; });
  if (!arrived) await fail(`the opening tail never settled on s210: ${JSON.stringify(await field())}`);
  await shot("first-control-arrival");

  // A short ordinary input must move the player.
  const before = await field();
  await page.keyboard.down("ArrowRight");
  await page.waitForTimeout(450);
  await page.keyboard.up("ArrowRight");
  const moved = await field();
  if (moved.x - before.x < 2) await fail(`holding Right moved x ${before.x} -> ${moved.x}, expected a real step`);

  // A second axis, then release: no key means no motion.
  const beforeDown = await field();
  await page.keyboard.down("ArrowDown");
  await page.waitForTimeout(300);
  await page.keyboard.up("ArrowDown");
  const afterDown = await field();
  if (afterDown.y === beforeDown.y && afterDown.x === beforeDown.x)
    await fail("holding Down did not move the player");
  await shot("first-control-moved");

  const releasedAt = await field();
  await page.waitForTimeout(300);
  const still = await field();
  if (Math.abs(still.x - releasedAt.x) > 1 || Math.abs(still.y - releasedAt.y) > 1)
    await fail(`player kept moving after release: ${JSON.stringify(releasedAt)} -> ${JSON.stringify(still)}`);
  if (still.cut || still.tb) await fail(`control not released after movement: ${JSON.stringify(still)}`);

  if (errors.length) await fail(`${errors.length} page error(s)`);
  console.log("RESULT", JSON.stringify({ ok: !failed, arrived, before, moved, afterDown, still }));
} catch (e) {
  await fail(e.message);
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
