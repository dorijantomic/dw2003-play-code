// The defeat camera and the loss beat's slow motion: lose a battle and watch both.
//
// pro/fightstg F0x8008cb44 builds the loss-only effect whose tick is F0x8008c93c. Its
// first tick cuts the camera to `camMgr->[0x104](0, 0xb)` — our own Digimon's near canned
// shot 11 — turns the shot frame's Y angle by `delta * 2` every frame (0x800a46d8+0x26,
// 4096 to a turn), and arms `[0x800a4548](2)` = F0x8009e510(2). That level is the
// slow-motion stepper F0x8009e428, which publishes ONE delta unit out of every four
// accumulated to 0x800a4464 — the delta the battle's animation clocks read. The orbit
// reads the raw `[0x8004df9c]()` directly, so the camera stays at full speed while the
// models crawl. This check loses a real battle and reads both off the renderer.
//
// The loss is arranged BEFORE the first command (see driveToLoss), so the outcome is the
// same every run: our Digimon on the field has one hit of health left, the two reserves
// are out of the fight, and the enemy carries more health than one blow can take.
//
// Server: python3 -m http.server $PORT --directory web
// Run:    VERIFY_PORT=$PORT tools/run-playwright.sh tools/verify_battle_loss_camera.mjs
// Shots:  BLC_SHOT=<dir>  (default .bunny-scratch/shots/battle-loss-camera)
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";
import { waitForCommandMenu } from "./verify-battle-wait.mjs";

const PORT = process.env.VERIFY_PORT || "8741";
const ROOT = process.env.BLC_ROOT || `${baseUrl(Number(PORT))}/`;
const OUT = process.env.BLC_SHOT || ".bunny-scratch/shots/battle-loss-camera";
mkdirSync(OUT, { recursive: true });

const member = (digimonId, level, xp) => ({
  digimonId, level, xp, tp: 10, hp: 200, maxHp: 200, mp: 80, maxMp: 80,
  stats: { str: 60, def: 40, spt: 30, wis: 30, spd: 40, chr: 20 },
  bonuses: {}, elemBonuses: {},
});

const browser = await chromium.launch({ headless: true });
const errors = [];
let failed = null;
const fail = (msg) => { failed = msg; console.error("FAIL:", msg); };

const seedStorage = (page) => page.addInitScript((seed) => {
  localStorage.setItem("assetMode", "authentic");
  localStorage.setItem("engineSchema", "2");
  localStorage.setItem("progressOrdinal", "3");
  localStorage.setItem("playerName", "Junior");
  localStorage.setItem("charId", "p005koet");
  localStorage.setItem("party", JSON.stringify(["p005koet", "p006agum", "p009rena"]));
  localStorage.setItem("packId", "B");
  localStorage.setItem("bits", "1000");
  localStorage.setItem("inventory", "[]");
  localStorage.setItem("partnerStats", JSON.stringify(seed.lead));
  localStorage.setItem("partyStats", JSON.stringify([seed.lead, seed.rena, seed.pata]));
  localStorage.setItem("equipment", JSON.stringify([{}, {}, {}]));
}, { lead: member(3, 5, 0), rena: member(7, 5, 0), pata: member(8, 5, 0) });

const openPage = async () => {
  const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
  page.on("pageerror", (e) => { errors.push(e.message); console.error("PAGEERROR", e.message); });
  await seedStorage(page);
  return page;
};

/** A real key press held across exactly one drawn frame: the battle's pad edges are read
 *  once a frame, so down and up have to land on different frames or the press is lost. */
const pressFrame = async (page, k) => {
  await page.keyboard.down(k);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
  await page.keyboard.up(k);
};
const shot = async (page, name) => {
  writeFileSync(`${OUT}/${name}.png`, await page.screenshot());
  console.log("shot", name);
};
const state = (page) => page.evaluate(() => window.__battleB?.()?.state ?? null);

/** Walk a page from the s200 PRE battle into the loss state (ST.LOSE === 9) and leave it
 *  sitting on the defeat beat.
 *
 *  The fight is arranged BEFORE the first command, the way a player who has been worn
 *  down meets a story boss: the two reserves are out of the fight and the one Digimon
 *  on the field has a single hit of health left, while the enemy carries far more
 *  health than one blow can take. Nothing is touched once the command is chosen, so no
 *  turn order and no damage roll can decide the outcome. The previous drive chose FIGHT
 *  and only then zeroed the party, so when the party's own blow killed the enemy first
 *  the battle ended in the win state 8 — about one run in four. */
async function driveToLoss(page, query) {
  await page.goto(ROOT + "?skipTitle=1&map=s200&noEncounters=1" + query);
  await page.waitForFunction(() => window.__state?.started, null, { timeout: 10_000 });
  await page.evaluate(() => { window.__gameSpeed = 8; });
  const deadline = Date.now() + 15_000;
  let launched = false;
  while (Date.now() < deadline) {
    if (await page.evaluate(() => !!window.__battle?.isActive?.())) { launched = true; break; }
    if (await page.evaluate(() => window.__textbox?.isOpen?.() ?? false)) await page.keyboard.press("Enter");
    await page.waitForTimeout(40);
  }
  await page.evaluate(() => { window.__gameSpeed = 1; });
  if (!launched) fail("the s200 PRE never launched the scripted battle");
  await waitForCommandMenu(page);

  // The six-row command list is the translated pro/fightstg screen: it owns the
  // confirm and only reads the pad once its own session is built, so the FIGHT
  // press below has to wait for it (and for the boot loader to retire).
  await page.waitForFunction(() => window.__battleWfightmn?.diagnostics?.().open === false,
    null, { timeout: 30_000 });
  await page.waitForFunction(() => window.__battleCmdNative?.diagnostics?.().ready === true,
    null, { timeout: 30_000 });

  // The party down to the one Digimon still standing, on its last hit, and the enemy
  // topped up past anything a single blow can reach (resolveDamage's own hard ceiling
  // is 9999). `_hpEase = null` lets the battle rebuild both HP bars from the live values
  // on the next tick, so the gauges read the situation the player is looking at instead
  // of easing down from the seeded numbers. This is the harness arranging the fight,
  // not the loss decision: the battle still reaches ST.LOSE only through its own
  // advanceAfterResult KO test, which calls the loss when the fallen active Digimon
  // leaves no live resident record (engine/dw3/battle-party.ts activeKoResolution,
  // whose tagCandidateIndices already skips a record at 0 HP).
  const armed = await page.evaluate(() => {
    const b = window.__battleB();
    b.playerRecords.forEach((record, index) => { record.hp = index === b.activePlayerIndex ? 1 : 0; });
    b.player.hp = b.playerRecords[b.activePlayerIndex].hp;
    const top = Math.min(9999, Math.max(1, b.enemy.maxHp || 1) * 100);
    b.enemy.maxHp = top;
    b.enemy.hp = top;
    b._hpEase = null;
    return {
      active: b.activePlayerIndex,
      partyHp: b.playerRecords.map((r) => r.hp),
      enemyHp: b.enemy.hp,
      enemyMaxHp: b.enemy.maxHp,
    };
  });
  if (armed.partyHp[armed.active] !== 1) fail(`the active Digimon was not armed at one hit: ${JSON.stringify(armed.partyHp)}`);
  if (armed.partyHp.some((hp, i) => (i === armed.active ? hp !== 1 : hp !== 0)))
    fail(`the reserves were not armed out of the fight: ${JSON.stringify(armed.partyHp)}`);

  // Take the ordinary FIGHT command with a real key press held across one drawn frame.
  // The retry only covers a press the pad happened to miss; it cannot change the
  // outcome, because the party cannot survive the enemy's next blow and the enemy
  // cannot be knocked out by ours.
  for (let i = 0; i < 4; i++) {
    if (await state(page) !== 2) break;
    await pressFrame(page, "Enter");
    await page.waitForTimeout(120);
  }

  // Let the turn play out. The message line holds the turn until Circle, so the
  // attack's own line has to be dismissed for the blow to land; but once the loss
  // beat (state 9) is up, pressing again would skip the very camera this check
  // samples. So press only while an action or a result line is waiting; the states
  // of a replacement chain (11 the Tag list, 12 the species strip, 14 the arrival
  // prompt, 15 the DNA row list) are here for the case where one is ever reached.
  const trail = [];
  let guard = 0;
  while (guard++ < 200) {
    const s = await state(page);
    if (trail.at(-1) !== s) trail.push(s);
    if (s === 9) break;
    if (s === 5 || s === 6 || s === 7 || s === 11 || s === 14 || s === 15) await pressFrame(page, "Enter");
    await page.waitForTimeout(150);
  }
  console.log("state trail", JSON.stringify({ armed, trail, polls: guard }));
  if (await state(page) !== 9) fail(`battle state ${await state(page)}, expected the loss state 9 (trail ${JSON.stringify(trail)})`);
  await page.waitForTimeout(200);
}

/** The camera the loss beat is holding, plus the slow-motion read-out, in one sample. */
const sample = (page) => page.evaluate(() => {
  const r = window.__battle3d;
  const info = r?.getCameraInfo?.() ?? null;
  const anim = r?.getAnimationReadout?.() ?? null;
  return {
    mode: r?.getCameraMode?.() ?? null,
    defeatYaw: info?.defeatYaw ?? null,
    defeatDelta: info?.defeatDelta ?? null,
    eye: info?.eye?.map((v) => Math.round(v)) ?? null,
    look: info?.look?.map((v) => Math.round(v)) ?? null,
    H: info?.H == null ? null : Math.round(info.H),
    slowMoLevel: anim?.slowMoLevel ?? null,
    slowMoDelta: anim?.slowMoDelta ?? null,
    slowMoAcc: anim?.slowMoAcc ?? null,
    slowMoTickSpeed: anim?.slowMoTickSpeed ?? null,
    slowMoTicks: anim?.slowMoTicks ?? null,
    slowMoUnits: anim?.slowMoUnits ?? null,
    slowMoRate: anim?.slowMoRate ?? null,
    globalSpeed: anim?.globalSpeed ?? null,
    playerClip: anim?.player?.clip ?? null,
    enemyClip: anim?.enemy?.clip ?? null,
    playerAnimId: anim?.player?.animId ?? null,
  };
});

try {
  // ── 1. The original's picture: the defeat camera plus slow-motion level 2 ────────────
  const page = await openPage();
  await driveToLoss(page, "");

  const first = await sample(page);
  await shot(page, "loss-camera-first");
  if (first.mode !== "defeat") fail(`camera mode ${first.mode}, expected the defeat camera`);
  if (first.defeatYaw === null) fail("the camera reports no defeat yaw at all");

  // The camera's own yaw and the stepper's published delta are read in ONE pass: the loss
  // beat is short in wall-clock (it ends in the title reload), so nothing may be sampled
  // after the driveToLoss wait.
  const trace = [first];
  for (let i = 0; i < 11; i++) { await page.waitForTimeout(60); trace.push(await sample(page)); }
  await shot(page, "loss-camera-orbit");

  // The yaw only ever grows, and it grows by the raw frame delta times 2 out of 4096 to a
  // turn (F0x8008cafc: 0x800a46fe += delta * 2, delta = [0x8004df9c]() = 1). Slow motion
  // level 2 does not touch this path — the orbit reads the delta pointer directly.
  const last = trace[trace.length - 1];
  const yaws = trace.map((t) => t.defeatYaw);
  for (let i = 1; i < yaws.length; i++) {
    if (!(yaws[i] >= yaws[i - 1])) fail(`yaw went backwards: ${JSON.stringify(yaws)}`);
  }
  for (const t of trace) {
    if (t.defeatYaw !== ((2 * t.defeatDelta) % 4096))
      fail(`yaw ${t.defeatYaw} is not 2 x the delta ${t.defeatDelta}: ${JSON.stringify(trace)}`);
  }
  if (last.defeatDelta !== undefined && last.defeatDelta > 0 && last.defeatYaw / last.defeatDelta !== 2)
    fail(`yaw per delta ${last.defeatYaw / last.defeatDelta}, expected 2`);
  console.log("camera trace", JSON.stringify(trace.map(
    (t) => ({ yaw: t.defeatYaw, d: t.defeatDelta, lvl: t.slowMoLevel, units: t.slowMoUnits, ticks: t.slowMoTicks }))));
  // Where the swing put the camera, first sample to last: the eye and the look-at both
  // travel around the arena origin the cut left as the anchor.
  console.log("eye trace", JSON.stringify({ first: first.eye, last: last.eye, lookFirst: first.look, lookLast: last.look, H: last.H }));
  if (last.eye && last.look && last.H == null) fail("the camera lost its projection distance");
  if (last.eye && first.eye && last.eye.join() === first.eye.join())
    fail("the eye never moved: the orbit is not being applied");

  // ── 2. Slow motion: `[0x800a4548](2)` armed on the first tick of the loss beat ───────
  for (const t of trace) {
    if (t.slowMoLevel !== 2) fail(`slow-motion level ${t.slowMoLevel}, expected 2`);
  }
  const ticksRun = (last.slowMoTicks ?? 0) - (first.slowMoTicks ?? 0);
  const unitsRun = (last.slowMoUnits ?? 0) - (first.slowMoUnits ?? 0);
  const rate = ticksRun > 0 ? unitsRun / ticksRun : null;
  console.log("slow motion", JSON.stringify({ ticksRun, unitsRun, rate, globalSpeed: last.globalSpeed }));
  // F0x8009e428 level 2 publishes 1 on every fourth tick and 0 on the other three, so the
  // long run is a quarter of the raw delta.
  if (!(ticksRun >= 8)) fail(`only ${ticksRun} slowed logic ticks were sampled`);
  if (!(rate > 0.15 && rate < 0.36))
    fail(`published ${unitsRun} animation units over ${ticksRun} ticks (rate ${rate}), expected about a quarter`);
  // The stepper's remainder only ever holds 0..4 while the level is 2.
  for (const t of trace) {
    if (!(t.slowMoAcc >= 0 && t.slowMoAcc <= 4)) fail(`slow-motion remainder ${t.slowMoAcc}, expected 0..4`);
  }
  // The camera kept turning at its own full rate through all of that.
  if (last.defeatDelta - first.defeatDelta < 8)
    fail(`the camera only turned ${last.defeatDelta - first.defeatDelta} raw deltas across the window`);
  await page.close();

  // ── 3. ?legacyLossPose=1 keeps the old picture: the same beat at full speed ───────────
  const legacy = await openPage();
  await driveToLoss(legacy, "&legacyLossPose=1");
  const legacyFirst = await sample(legacy);
  await legacy.waitForTimeout(300);
  const legacyLast = await sample(legacy);
  await shot(legacy, "loss-camera-legacypose");
  console.log("legacyLossPose", JSON.stringify({
    mode: legacyLast.mode, yaw: legacyLast.defeatYaw,
    level: legacyLast.slowMoLevel, units: legacyLast.slowMoUnits, ticks: legacyLast.slowMoTicks,
  }));
  if (legacyLast.mode !== "defeat") fail(`legacyLossPose camera mode ${legacyLast.mode}, expected the defeat camera`);
  if (legacyLast.slowMoLevel !== 0)
    fail(`?legacyLossPose=1 armed slow-motion level ${legacyLast.slowMoLevel}, expected 0`);
  if ((legacyLast.slowMoTicks ?? 0) !== 0)
    fail(`?legacyLossPose=1 ran ${legacyLast.slowMoTicks} slowed logic ticks, expected none`);
  if (legacyLast.defeatDelta <= 0) fail("?legacyLossPose=1 loss beat never advanced the camera");
  await legacy.close();

  console.log("errors", JSON.stringify(errors));
  if (errors.length) fail(`page errors: ${errors.join(" | ")}`);
} catch (e) {
  fail(`threw: ${e && e.message}`);
}

await browser.close();
if (failed) { console.error("VERIFY FAILED:", failed); process.exit(1); }
console.log("VERIFY OK");