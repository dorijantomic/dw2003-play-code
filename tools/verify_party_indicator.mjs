// Browser regression for the FIELDSTG type-0x16 party-indicator actor.
//
// Two behaviours, both from
// docs/research/scripting/bank70-opcode-handlers-decoded-2026-07-27.md
// § "Confirmed by observed play":
//   1. the orb (ids 0x23..0x26) draws PERMANENTLY above the player once a
//      partner is in the field party — it is not a talk-bubble component;
//   2. program 3's starburst flare plays over it and hands back to it, rather
//      than the actor disappearing when the one-shot ends.
//
// Assertion method: spy on ctx.drawImage and classify draws by their SOURCE rect
// in the FIELDCOM atlas, with the rects read from web/assets/ui/fieldcom.json so
// there is no parallel coordinate table here. Sampling screen pixels instead does
// not work — the field art is saturated enough to satisfy a colour heuristic on
// its own, and the player drifts, so a fixed screen rect measures scenery.
//
// Run with: tools/run-playwright.sh tools/verify_party_indicator.mjs
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";
import { baseUrl } from "./verify-base-url.mjs";

const origin = `${baseUrl(8742)}`;
const outDir = process.argv[2] ?? "/tmp/party-indicator";
const party = ["p003pken", "p005koet", "p004kogu"];

const ORB_IDS = [0x23, 0x24, 0x25, 0x26];
const FLARE_IDS = [0x27, 0x28, 0x2d, 0x2e, 0x2f, 0x30];

mkdirSync(outDir, { recursive: true });

const fieldcom = await (await fetch(`${origin}/assets/ui/fieldcom.json`)).json();
const rectKey = (id) => {
  const l = fieldcom.dir0[String(id)].layers[0];
  return `${l.x},${l.y},${l.w},${l.h}`;
};
const orbKeys = ORB_IDS.map(rectKey);
const flareKeys = FLARE_IDS.map(rectKey);
// The orb and flare bands must be distinguishable, or the test proves nothing.
assert.equal(new Set([...orbKeys, ...flareKeys]).size, orbKeys.length + flareKeys.length);

const browser = await chromium.launch();
const context = await browser.newContext({
  storageState: {
    cookies: [],
    origins: [{
      origin,
      localStorage: [
        { name: "engineSchema", value: "2" },
        { name: "party", value: JSON.stringify(party) },
        { name: "charId", value: party[0] },
      ],
    }],
  },
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

// Record the source rect of every sprite blit, so a draw can be attributed to a
// specific FIELDCOM id regardless of where on screen it landed.
const installSpy = () => page.evaluate(() => {
  const proto = CanvasRenderingContext2D.prototype;
  if (proto.__spied) return;
  const orig = proto.drawImage;
  window.__blits = [];
  proto.drawImage = function (...a) {
    if (a.length === 9) window.__blits.push(`${a[1]},${a[2]},${a[3]},${a[4]}`);
    return orig.apply(this, a);
  };
  proto.__spied = true;
});

// Blits seen over `ms` of real rendering, as a Set of source-rect keys.
const blitsOver = async (ms) => {
  await page.evaluate(() => { window.__blits.length = 0; });
  await page.waitForTimeout(ms);
  return new Set(await page.evaluate(() => window.__blits));
};
const sawAny = (set, keys) => keys.some((k) => set.has(k));

try {
  await page.goto(`${origin}/?skipTitle=1&map=s310&noEncounters=1`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__state?.started, null, { timeout: 30_000 });
  await installSpy();
  await page.evaluate(() => window.__teleport(320, 300));
  await page.waitForTimeout(400);

  // ── 1. the orb is permanent, with no flare and no bubble ─────────────────
  const idle = await blitsOver(400);
  await page.screenshot({ path: `${outDir}/01-idle-orb.png` });
  assert.ok(
    await page.evaluate(() => window.__state.sparkleActor == null),
    "no flare armed: what follows is the resting program, not program 3",
  );
  assert.ok(sawAny(idle, orbKeys), "orb must draw with a partner in party and nothing triggered");
  assert.ok(!sawAny(idle, flareKeys), "no flare frames while resting");

  // ── 2. the flare plays over it, then hands back ──────────────────────────
  await page.evaluate(() => window.__armSparkle(3));
  const flaring = await blitsOver(200);
  await page.screenshot({ path: `${outDir}/02-flare.png` });
  assert.ok(sawAny(flaring, flareKeys), "program 3's starburst band must draw while armed");

  // The flare is ~44 frames of the 60Hz FIELDCOM clock but only clears on the
  // next rAF, which headless runs below 60fps — wait on the state, not a guess.
  await page.waitForFunction(() => window.__state.sparkleActor == null, null, { timeout: 10_000 });
  const after = await blitsOver(400);
  await page.screenshot({ path: `${outDir}/03-back-to-orb.png` });
  assert.ok(sawAny(after, orbKeys), "the actor must rest on the orb once the flare ends");
  assert.ok(!sawAny(after, flareKeys), "flare frames must stop");

  // ── 3. the gate is the SCREEN id, not the party ──────────────────────────
  // The original's ctor F0x80089f24 (fieldstg.s:7332-7353) builds the actor iff
  // the current screen id < 0x2d7 (engine/systems/party-orb.ts). There is NO
  // roster test, so clearing the party must NOT remove the orb on a Digital
  // World screen — it only removes the player sprite. The prologue screens
  // s780..s895 are the >= 0x2d7 stages, so s780 must show no orb.
  const gotoMap = (stageId) => page.evaluate(async (sid) => {
    const st = window.__state;
    const idx = st.manifest.maps.findIndex((m) => m.id === sid);
    window.__setMap(idx);
    for (let i = 0; i < 30; i++) await new Promise((r) => requestAnimationFrame(r));
    return st.manifest.maps[st.mapIdx].id;
  }, stageId);

  const savedParty = await page.evaluate(() => {
    const p = window.__state.party;
    window.__state.party = null;
    return p;
  });
  const noParty = await blitsOver(400);
  await page.screenshot({ path: `${outDir}/04-no-party-s310.png` });
  assert.ok(sawAny(noParty, orbKeys), "the party is not the gate: orb still draws on s310 with no party");
  await page.evaluate((p) => { window.__state.party = p; }, savedParty);

  assert.equal(await gotoMap("s780"), "s780");
  const prologue = await blitsOver(600);
  await page.screenshot({ path: `${outDir}/05-prologue-s780.png` });
  assert.ok(!sawAny(prologue, orbKeys), "the prologue screen s780 (id 0x2d7) is at the cut: no orb");

  assert.equal(await gotoMap("s310"), "s310");
  const restored = await blitsOver(400);
  await page.screenshot({ path: `${outDir}/05b-restored-s310.png` });
  assert.ok(sawAny(restored, orbKeys), "orb returns on a screen below the cut");

  // ── 4. programs 1 and 2 now reach the draw pass ──────────────────────────
  // These are the two scripts the actor was missing. The arming notify is
  // `SETANIM 813 824` -> program 1 and `SETANIM 813 825` -> program 2 (fieldstg
  // F0x800837EC; engine/systems/cutscene-manager.ts SPARKLE_ARM_PROGRAMS). The
  // engine unit test pins the SETANIM route; here we prove the draw side: the
  // armed program renders its own frames and holds (never clears).
  const p1Unique = [0x31, 0x2b, 0x29, 0x2a].map(rectKey); // held pose, not the orb/flare bands
  await page.evaluate(() => window.__armSparkle(1));
  const p1 = await blitsOver(1500);
  await page.screenshot({ path: `${outDir}/06-program1.png` });
  assert.ok(sawAny(p1, p1Unique), "program 1's held starburst pose must draw");
  assert.ok(await page.evaluate(() => window.__state.sparkleActor?.program === 1),
    "program 1 holds forever (its ff-jump loop never ends)");

  await page.evaluate(() => window.__armSparkle(2));
  const p2 = await blitsOver(1500);
  await page.screenshot({ path: `${outDir}/07-program2.png` });
  assert.ok(sawAny(p2, orbKeys), "program 2 settles into the orb band");
  assert.ok(await page.evaluate(() => window.__state.sparkleActor?.program === 2),
    "program 2 holds forever too");

  writeFileSync(`${outDir}/report.json`, JSON.stringify({
    orbKeys, flareKeys,
    idle: orbKeys.filter((k) => idle.has(k)),
    flaring: flareKeys.filter((k) => flaring.has(k)),
    after: orbKeys.filter((k) => after.has(k)),
    noParty: orbKeys.filter((k) => noParty.has(k)),
    prologue: orbKeys.filter((k) => prologue.has(k)),
    restored: orbKeys.filter((k) => restored.has(k)),
    program1: p1Unique.filter((k) => p1.has(k)),
    program2: orbKeys.filter((k) => p2.has(k)),
  }, null, 2));
  assert.deepEqual(errors, [], "no page errors");
  console.log("party-indicator OK", JSON.stringify({
    idleOrbFrames: orbKeys.filter((k) => idle.has(k)).length,
    flareFrames: flareKeys.filter((k) => flaring.has(k)).length,
    afterOrbFrames: orbKeys.filter((k) => after.has(k)).length,
    noPartyOrbFrames: orbKeys.filter((k) => noParty.has(k)).length,
    restoredOrbFrames: orbKeys.filter((k) => restored.has(k)).length,
    program1PoseFrames: p1Unique.filter((k) => p1.has(k)).length,
    program2OrbFrames: orbKeys.filter((k) => p2.has(k)).length,
  }));
} finally {
  await browser.close();
}
