// Journey 5 field piece (WORLD-Q005 / field-gap A22): undersea talk/chest needs
// the sub below a depth of 0x2000.
//
// Native rule (authority 2): the Submarimon handler F0x8008e45c tests the
// character's own height before it runs the ordinary talk/examine probe
// (fieldstg.s 0xb834-0xb840: `lw $v0,0x64($s1)` / `slti $v0,0x2000` /
// `beqz -> 0xb89c`). Height is positive-up, so talk is refused while
// `heightFixed >= 0x2000` and allowed once the sub has sunk below it.
//
// The piece runs on real s860, whose item box (p126itmb, npc 33) sits at
// (192,280) and spawns for arrival key 6 / companion 1 (spawn flags 0x7E05 /
// 0x7E1E). The approach tiles there are typed terrain 0x01, which has no floor
// entry in SUBMARIMON_FLOOR_BY_TERRAIN, so only the generic [0x1800,0x7000]
// band applies and the sub can actually reach < 0x2000; case 2 drives it down
// with the ordinary thrust key and watches the height fall.
//
// Cases:
//   1. high depth (first entry, above 0x2000): Circle does nothing (no textbox);
//   2. holding X drives the height below 0x2000 (the approach is traversable);
//   3. standing in the box's facing cone at that depth, Circle opens the box;
//   4. a surface map: Junior has no height and the same examine is never gated.
//
// Server: python3 -m http.server 8741 --directory web
// Run:    .opencode/autonomy/check-browser tools/verify_submarimon_depth_gate.mjs
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const BASE = process.env.SUBGATE_ROOT || `${baseUrl(8741)}/`;
const OUT = process.env.SUBGATE_SHOT || "/tmp/submarimon-depth-gate";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
const errors = [];
page.on("pageerror", (e) => { errors.push(e.message); console.error("PAGEERROR", e.message); });

let failed = null;
const fail = (m) => { failed = m; console.error("FAIL:", m); };
const shot = async (n) => writeFileSync(
  `${OUT}/${n}.png`,
  Buffer.from(
    (await page.locator("canvas#game").evaluate((el) => el.toDataURL("image/png"))).split(",")[1],
    "base64",
  ),
);

/** Advance the real dialogue to its last page so the field is not frozen. */
async function ensureClosed() {
  for (let i = 0; i < 8; i++) {
    if (!(await field()).tb) return;
    await page.keyboard.press("Enter");
    await page.waitForTimeout(150);
  }
}

const field = () => page.evaluate(() => ({
  map: window.__state.manifest.maps[window.__state.mapIdx].id,
  x: Math.round(window.__state.x),
  y: Math.round(window.__state.y),
  dir: window.__state.dir,
  sub: window.__state.submarimon
    ? {
        height: window.__state.submarimon.heightFixed,
        speed: window.__state.submarimon.speedFixed,
        facing: window.__state.submarimon.facing,
      }
    : null,
  tb: window.__textbox?.isOpen?.() ?? false,
}));

try {
  // ── undersea: s860's item box ─────────────────────────────────────────────
  await page.goto(`${BASE}?skipTitle=1&map=s860&noEncounters=1`);
  await page.waitForFunction(() => window.__state?.started, null, { timeout: 15_000 });
  await page.waitForFunction(
    () => window.__state?.scenes?.s860 && window.__state.manifest.maps[window.__state.mapIdx].id === "s860",
    null, { timeout: 10_000 },
  );
  await page.waitForTimeout(600);

  const start = await field();
  if (!start.sub) throw new Error("s860 did not build a Submarimon (dive-form marker missing)");
  // The first-entry seed is 0x3000; left alone the sub floats up toward the
  // 0x7000 ceiling, so by now it is already well above the 0x2000 talk limit.
  if (start.sub.height < 0x2000)
    await fail(`sub started below the talk limit: ${start.sub.height}`);

  const box = await page.evaluate(() => {
    window.__state.entryKey = 6;
    window.__state.entryCompanion = 1;
    return (window.__npcsHere() || []).find((n) => n.sprite === "p126itmb") ?? null;
  });
  if (!box) throw new Error("no p126itmb item box with arrival key 6 / companion 1");

  // Fixture: stand one tile below the box, facing it (facing 4 = up).
  await page.evaluate((b) => {
    window.__tp(b.x, b.y + 16);
    window.__state.submarimon.facing = 4;
  }, box);
  await page.waitForTimeout(250);
  const seated = await field();
  await shot("depth-gate-seated-high");

  // 1. Invalid depth: the box must NOT open.
  await page.keyboard.press("Enter");
  await page.waitForTimeout(300);
  const highTry = await field();
  if (highTry.tb) {
    await fail(`box opened at height ${highTry.sub?.height} (>= 0x2000); the depth gate is missing`);
    await shot("depth-gate-opened-high-DIVERGENCE");
  } else {
    await shot("depth-gate-refused-high");
  }
  await ensureClosed();

  // 2. Reachability: hold the ordinary thrust key (Cross = `c`) and watch the
  //    height cross 0x2000. The sub also travels forward; only depth is asserted.
  await page.keyboard.down("x");
  let deep = null;
  for (let i = 0; i < 32; i++) {
    await page.waitForTimeout(100);
    const s = await field();
    if (s.sub && s.sub.height < 0x2000) { deep = s; break; }
  }
  await page.keyboard.up("x");
  if (!deep) await fail("holding Cross for 3.2 s never brought the sub below 0x2000");
  else if (deep.sub.height < 0x1800) await fail(`height ${deep.sub.height} escaped the band`);
  if (deep) await shot("depth-gate-sunk");

  // 3. Valid depth: re-seat in the box's cone at the depth just reached and
  //    press Circle. Position is a fixture; the depth is what the ordinary
  //    input above produced. Seat a little further out (32 px) because the sub
  //    is still coasting forward; the walker's talk cone is 48 px, so the
  //    approach frame lands inside it.
  await page.evaluate((b) => {
    window.__tp(b.x, b.y + 32);
    window.__state.submarimon.facing = 4;
  }, box);
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => window.__textbox?.isOpen?.() ?? false, null, { timeout: 2000 })
    .catch(() => {});
  const lowTry = await field();
  if (lowTry.sub.height >= 0x2000)
    await fail(`reached the box above the talk limit: ${lowTry.sub.height}`);
  else if (!lowTry.tb)
    await fail(`box did not open at height ${lowTry.sub.height} (< 0x2000)`);
  await shot("depth-gate-opened-low");
  await ensureClosed();

  // Consumer: the box's dialogue_states on_close writes its opened flag and the
  // spawn gate then hides it. This is the real handoff of the interaction.
  const consumed = await page.evaluate(() => ({
    openedFlag: window.__storyFlags.get(556),
    boxGone: !(window.__npcsHere() || [])
      .some((n) => n.sprite === "p126itmb" && n.npc_id === 33),
  }));
  if (consumed.openedFlag !== 1)
    await fail(`box on_close did not set its opened flag 556: ${consumed.openedFlag}`);
  if (!consumed.boxGone) await fail("box did not despawn after being opened");

  // 4. Surface control: Junior has no height state, so the same examine is never
  //    gated. s320 carries the identical p126itmb item-box sprite.
  await page.goto(`${BASE}?skipTitle=1&map=s320&noEncounters=1`);
  await page.waitForFunction(() => window.__state?.started, null, { timeout: 15_000 });
  await page.waitForTimeout(500);
  const surface = await page.evaluate(() => {
    const s = window.__state;
    const rows = window.__npcsHere() || [];
    const n = rows.find((r) => r.sprite === "p126itmb") || rows[0];
    if (!n) return { noNpc: true };
    window.__tp(n.x, n.y + 16);
    s.dir = "up";
    return { hasSub: !!s.submarimon, npc: n.sprite };
  });
  if (surface.noNpc) await fail("s320 has no NPC to prove the surface path");
  else {
    if (surface.hasSub) await fail("s320 unexpectedly has a Submarimon");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(400);
    const surfaceTry = await field();
    if (!surfaceTry.tb) await fail(`surface examine did not open (npc ${surface.npc})`);
    await shot("depth-gate-surface-talk");
  }

  if (errors.length) await fail(`${errors.length} page error(s)`);
  console.log("RESULT", JSON.stringify({
    ok: !failed, start, box, seated, highTry, deep, lowTry, consumed, surface,
  }));
} catch (e) {
  await fail(e.message);
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
