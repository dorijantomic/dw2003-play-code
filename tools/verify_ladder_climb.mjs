// Journey 5 field piece: a ladder mounts, climbs, dismounts at the far end,
// and works in both directions — but only while you are LOOKING at its tile.
//
// No ladder had a test or verifier. s381 carries a short ladder (id 3,
// bottom 432,374 -> top 417,320, 54 px); the check seeds the player at the
// bottom endpoint, faces the way that tile asks, mounts with the ordinary
// interact key, holds Up, and then walks back down from the top.
//
// The facing is not decoration. One shared system arms every ladder in the
// disc: the position step's step-load (pro/fieldstg.s:5501 `.L0x000055d8`)
// keeps the tile's group in `entity+0x60` (:5521) and returns live only when
// that tile's own facing cone admits the player's facing —
// `lw $v0,0x60($s1)` (:5546), the cone table at 0x80097624 (:5544), and
// `sltu $zr,$v0` (:5552). Opcodes 2 and 3 are the ladder (fieldstg.s:5799
// `.L0x00005a80`, :5815 `.L0x00005ac0`), so an op-2/op-3 tile answers the button
// ONLY inside its three-facing cone. That is what this check drives: it reads
// the port's own answer for the tile, proves the button does nothing from a
// facing outside the cone, and mounts from inside it.
//
// The mount then turns you to the side it hands you: `a1` of the mount call
// goes straight into `entity+0x60` (fieldstg.s:12601 `sw $s3,0x60($s4)` bottom,
// :12644 top). op 2 hands over the tile's own group (:5808); op 3 hands over 5
// when the group is exactly 1 and 3 otherwise, because `li $a1,0x3` (:5819) is
// the `bne`'s DELAY SLOT and only the fall-through :5820 changes it. Both ends of
// a shipped rail hand over the SAME side (the data pairs a group-3 foot with a
// group-7 head and a group-5 foot with a group-1 head), and this check reads that
// word back out of `window.__state.dir` instead of assuming a sprite.
//
// Letting go differs between the two ends, in that same word: climbing down ends in
// mode 0x46, which stores zero into it (fieldstg.s:13983 `sw $zr,0x60($s0)`), so the
// foot leaves you facing DOWN; climbing up ends in mode 0x45 (:13986), which never
// stores it, so the head leaves you as its mount handed you.
//
// Server: python3 -m http.server <port> --directory web
// Run:    LAD_ROOT=http://127.0.0.1:<port>/ VERIFY_PORT=<port> \
//           tools/run-playwright.sh tools/verify_ladder_climb.mjs
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const ROOT = process.env.LAD_ROOT || `${baseUrl(8741)}/`;
const MAP = "s381"; // one 54 px ladder at (432,374)->(417,320), no NPC at either end
const BASE = ROOT + `?skipTitle=1&map=${MAP}&noEncounters=1`;
const OUT = process.env.LAD_SHOT || ".bunny-scratch/ladder-climb";
// The disc's facing order, entity+0x60 index -> what the player looks like.
const FACINGS = ["down", "down-left", "left", "up-left", "up", "up-right", "right", "down-right"];
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
const errors = [];
page.on("pageerror", (e) => { errors.push(e.message); console.error("PAGEERROR", e.message); });

const shot = async (n) => writeFileSync(`${OUT}/${n}.png`,
  Buffer.from((await page.locator("canvas#game").evaluate((el) => el.toDataURL("image/png"))).split(",")[1], "base64"));
async function waitFor(fn, label, timeout = 6_000, arg = null) {
  try { await page.waitForFunction(fn, arg, { timeout }); return true; }
  catch { await fail(`wait failed: ${label}`); return false; }
}
const field = () => page.evaluate(() => ({
  x: Math.round(window.__state.x), y: Math.round(window.__state.y),
  dir: window.__state.dir,
  icon: window.__state._indicatorKey ?? null,
  climb: window.__state.climb ? {
    phase: window.__state.climb.phase,
    progress: Math.round(window.__state.climb.progress),
    height: window.__state.climb.height,
    clip: window.__state.climb.clip,
    x: Math.round(window.__state.climb.x),
    side: window.__state.climb.dirStr,
  } : null,
}));

/**
 * The port's own answer for a tile: which facings arm it, which opcode it
 * carries, and the facing its mount call would hand the player. This is the
 * shared read (window.__engineTriggerSystem, the same object the game's own
 * press handler uses), so the check cannot pass by agreeing with a private copy.
 */
const askTile = (pt) => page.evaluate((q) => {
  const ts = window.__engineTriggerSystem;
  const map = window.__state.manifest.maps[window.__state.mapIdx].id;
  const live = [], ops = new Set();
  let group = null, mountFacing = null;
  for (let f = 0; f < 8; f++) {
    const pb = ts.playback(map, q.x, q.y, f, true);
    if (!pb?.live) continue;
    live.push(f);
    ops.add(pb.op);
    if (group == null) group = pb.group;
    if (mountFacing == null) mountFacing = pb.effect?.actorCall?.args?.[0] ?? null;
  }
  return { live, ops: [...ops], group, mountFacing };
}, pt);

/** Stand on a point, look a way, and let the frame settle. */
const stand = (pt, dir) => page.evaluate(([q, d]) => {
  window.__state.x = q.x;
  window.__state.y = q.y;
  window.__state.dir = d;
  window.__state.moving = false;
}, [pt, dir]);

let failed = null;
const fail = (m) => { failed = m; console.error("FAIL:", m); };

try {
  await page.goto(BASE);
  await page.waitForFunction(() => window.__state?.started, null, { timeout: 15_000 });
  await waitFor((m) => (window.__state.scenes?.[m]?.ladders ?? []).length > 0, "ladder list", 10_000, MAP);
  await page.waitForTimeout(500);

  const ladder = await page.evaluate((m) => window.__state.scenes[m].ladders[0], MAP);
  const bottom = await askTile(ladder.bottom);
  const top = await askTile(ladder.top);
  console.log("TILES", JSON.stringify({ bottom, top }));

  // The tile has to BE a ladder tile, and it has to be armed for exactly three
  // facings — the disc's cone row. Everything below hangs off those numbers.
  if (bottom.ops.length !== 1 || bottom.ops[0] !== 2)
    await fail(`the bottom endpoint's cell is not an op-2 ladder tile: ${JSON.stringify(bottom.ops)}`);
  if (top.ops.length !== 1 || top.ops[0] !== 3)
    await fail(`the top endpoint's cell is not an op-3 ladder tile: ${JSON.stringify(top.ops)}`);
  if (bottom.live.length !== 3 || top.live.length !== 3)
    await fail(`a cone row is three facings wide: bottom ${bottom.live}, top ${top.live}`);
  if (!bottom.live.includes(bottom.group))
    await fail(`the tile's own group ${bottom.group} is not in its cone ${bottom.live}`);
  // The mount must hand you a facing that looks UP. The op-3 fold (5 for group 1,
  // 3 otherwise) is what makes the two ends of a rail AGREE: the shipped data
  // pairs every foot-group-3 rail with a top-group-7 rail and every foot-group-5
  // rail with a top-group-1 one, and both ends of each pair hand you the same
  // side. Assert that here, so a wrong side on either end is a failure.
  for (const [name, t] of [["bottom", bottom], ["top", top]]) {
    if (t.mountFacing !== 3 && t.mountFacing !== 5)
      await fail(`${name} mount hands facing ${t.mountFacing}, not up-left/up-right`);
  }
  if (bottom.mountFacing !== top.mountFacing)
    await fail(`the foot hands ${bottom.mountFacing} and the top hands ${top.mountFacing}; ` +
      `the shipped data pairs the ends so a rail hands you one side`);
  // ...and the consequence that matters: the top's cone does NOT admit the facing
  // it just handed you (you must turn to climb back down), while the foot's cone
  // DOES (you can go straight back up).
  if (top.live.includes(top.mountFacing))
    await fail(`the top tile admits the facing it hands you; the arming changed`);
  if (!bottom.live.includes(bottom.mountFacing))
    await fail(`the foot tile does not admit the facing it hands you; the arming changed`);

  // ── THE DISC'S GATE. Look AWAY from the tile and the button does nothing. ──
  await stand(ladder.bottom, FACINGS[(bottom.group + 4) % 8]); // the tile's opposite side
  await page.waitForTimeout(200);
  const gated = await field();
  if (gated.icon) await fail(`a ladder icon is drawn while looking away from the tile: ${gated.icon}`);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(400);
  if ((await field()).climb)
    await fail(`the ladder mounted from facing ${FACINGS[(bottom.group + 4) % 8]}, outside the cone ${bottom.live}`);
  await shot("ladder-looking-away");

  // ── MOUNT AT THE FOOT. Look the tile's way, and press. ──
  await stand(ladder.bottom, FACINGS[bottom.group]);
  await page.waitForTimeout(200);
  if (!(await field()).icon) await fail("no ladder icon while looking at the tile");
  await page.keyboard.press("Enter");
  await waitFor(() => !!window.__state.climb, "mount at bottom");
  await page.waitForTimeout(200);
  const mounted = await field();
  await shot("ladder-mounted");
  if (mounted.climb?.phase !== "climb") await fail(`mount phase ${mounted.climb?.phase}`);
  if (mounted.x !== ladder.bottom.x || mounted.y !== ladder.bottom.y)
    await fail(`mount did not pin the bottom endpoint: ${JSON.stringify(mounted)}`);
  // The mount turned you to the facing it handed you — entity+0x60, read back.
  if (mounted.dir !== FACINGS[bottom.mountFacing])
    await fail(`the foot mounted you facing ${mounted.dir}, not ${FACINGS[bottom.mountFacing]}`);
  if (mounted.climb?.side !== FACINGS[bottom.mountFacing])
    await fail(`the foot drew the ${mounted.climb?.side} side, not ${FACINGS[bottom.mountFacing]}`);

  // Hold Up: progress climbs, x stays pinned on the rail.
  await page.keyboard.down("ArrowUp");
  await page.waitForTimeout(400);
  const mid = await field();
  await shot("ladder-climbing");
  if (!(mid.climb && mid.climb.progress > 0 && mid.climb.progress < mid.climb.height))
    await fail(`not mid-climb after 400 ms: ${JSON.stringify(mid)}`);
  if (mid.x !== ladder.bottom.x) await fail(`x left the rail mid-climb: ${JSON.stringify(mid)}`);
  // Release the moment the landing spot is taken (phase dismount), or the still
  // held key walks the player off the endpoint before the check reads it.
  await waitFor(() => { const c = window.__state.climb; return !c || c.phase === "dismount"; }, "top dismount begins");
  await page.keyboard.up("ArrowUp");
  await waitFor(() => !window.__state.climb, "climb cleared at top");
  await page.waitForTimeout(150);
  const atTop = await field();
  await shot("ladder-at-top");
  if (atTop.x !== ladder.top.x || atTop.y !== ladder.top.y)
    await fail(`top dismount landed at ${JSON.stringify(atTop)}, expected ${JSON.stringify(ladder.top)}`);
  // You came off the top looking the way the mount handed you, and the top tile's
  // cone does NOT admit that — so it is not armed until you turn.
  if (atTop.dir !== FACINGS[top.mountFacing])
    await fail(`the top handed you facing ${atTop.dir}, not ${FACINGS[top.mountFacing]}`);

  // ── AND BACK DOWN. Turn to the tile's way first, then mount and hold Down. ──
  await stand(ladder.top, FACINGS[top.group]);
  await page.waitForTimeout(200);
  await page.keyboard.press("Enter");
  await waitFor(() => !!window.__state.climb, "mount at top");
  const atTopMount = await field();
  if (atTopMount.climb?.progress !== ladder.bottom.y - ladder.top.y)
    await fail(`top mount did not start at the top offset: ${JSON.stringify(atTopMount)}`);
  if (atTopMount.dir !== FACINGS[top.mountFacing])
    await fail(`the top mounted you facing ${atTopMount.dir}, not ${FACINGS[top.mountFacing]}`);
  // The head mount steps 16 px sideways ONTO the rail before the climb (fieldstg
  // mode 0x44, file 0xd950: `addiu $v0,$v1,0x1000` / `sw $v0,0x50($s0)`,
  // fieldstg.s:13927-13932), and the climb blocks never touch +0x50 — so the sprite
  // rides the FOOT endpoint's x the whole way down, not the head cell until the exit.
  if (atTopMount.x !== ladder.bottom.x)
    await fail(`the head mount left x at ${atTopMount.x}, off the rail ${ladder.bottom.x}`);
  await page.keyboard.down("ArrowDown");
  await page.waitForTimeout(400);
  const downMid = await field();
  await shot("ladder-climbing-down");
  if (downMid.climb && downMid.climb.progress > 0 && downMid.climb.progress < downMid.climb.height
      && downMid.x !== ladder.bottom.x)
    await fail(`x left the rail on the way down: ${JSON.stringify(downMid)}`);
  await waitFor(() => { const c = window.__state.climb; return !c || c.phase === "dismount"; }, "bottom dismount begins");
  await page.keyboard.up("ArrowDown");
  await waitFor(() => !window.__state.climb, "climb cleared at bottom");
  await page.waitForTimeout(150);
  const backDown = await field();
  await shot("ladder-back-down");
  if (backDown.x !== ladder.bottom.x || backDown.y !== ladder.bottom.y)
    await fail(`down dismount landed at ${JSON.stringify(backDown)}, expected the bottom ${JSON.stringify(ladder.bottom)}`);
  // Climbing down ends in the disc's mode 0x46, which stores ZERO into that same
  // entity+0x60 (fieldstg.s:13983) — so you come off the bottom looking DOWN, not
  // still looking up the rail. Climbing UP ends in mode 0x45 (:13986), which never
  // stores +0x60, so the top leaves you as its mount handed you (asserted above).
  if (backDown.dir !== "down")
    await fail(`the bottom dismount left you facing ${backDown.dir}, not down`);

  if (errors.length) await fail(`${errors.length} page error(s)`);
  console.log("RESULT", JSON.stringify({ ok: !failed, ladder, bottom, top, mounted, mid, atTop, backDown }));
} catch (e) {
  await fail(e.message);
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
