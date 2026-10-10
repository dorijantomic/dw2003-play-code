// Journey 5 field piece: an ordinary door works in both directions.
//
// s946 (East Sector — Forest Inn) and s947 (Forest Inn BF) are connected by a
// real grid-placed door in each scene — s946 (320,416,64x64) -> s947 spawn
// (140,194), and s947 (96,160,64x64) -> s946 spawn (342,432). Each scene already
// carries the static return exit, so addEntranceReturn deliberately adds no
// synthesized one (web/game.js:2463).
//
// The ARRIVAL FACING is read out of the disc's own step record, not out of the
// shipped scene row: params[3] is char+0x60's 0-7 index, copied into the arriving
// actor unmapped (fieldstg.s:0x8aa0 stores it at scene_obj+0x6c, :0xe758/:0xe760
// copy 0x6c into char+0x60). The generator used to read that word through a
// four-entry table that named it a step clockwise, so both of these doors dropped
// you facing one step off; the outbound leg below is the one this file asserts.
//
// The check seeds on the s946 door with __tp (a fixture; the scene record is
// the authority), crosses with the ordinary interact key, walks off the
// destination's door and back onto it to prove the trigger re-arms, then
// crosses back and asserts both landings against the scene records.
//
// Server: python3 -m http.server 8741 --directory web
// Run:    .opencode/autonomy/check-browser tools/verify_door_roundtrip.mjs
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { readFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const BASE = process.env.DOOR_ROOT || `${baseUrl(8741)}/`;
const OUT = process.env.DOOR_SHOT || "/tmp/door-roundtrip";
const A = "s946", B = "s947";
const FACINGS = ["down", "down-left", "left", "up-left", "up", "up-right", "right", "down-right"];
const GRIDS = JSON.parse(
  readFileSync(new URL("../web/assets/data/story_trigger_grids.json", import.meta.url)),
).stages;
const STEPS = JSON.parse(
  readFileSync(new URL("../web/assets/data/story_steps.json", import.meta.url)),
).stages;
const SCREENS = JSON.parse(
  readFileSync(new URL("../web/assets/data/screen_table.json", import.meta.url)),
);

/**
 * The arrival facing the DISC asks for at (spawnX, spawnY) on `stage`, read from
 * that stage's own step program: the record's params[3] is char+0x60's 0-7 index
 * and FACINGS is that field's order. Deliberately NOT read from the shipped scene
 * row, so this can fail when the row is wrong.
 */
function recordFacing(stage, destStage, spawnX, spawnY) {
  const prog = STEPS[stage.slice(1)]?.steps ?? [];
  // From ordinal 0x2d on, the loader resolves a screen id through the s9xx shadow
  // records (gen_scenes.stage_for_screen's alias_world), and both of these stages
  // are past it: screen 659 is s366 with s947 as its alt.
  const dest = (id) => {
    const e = SCREENS[String(id)];
    if (!e) return null;
    return Number(stage.slice(1)) >= 920 && e.alt?.stage != null ? e.alt.stage : e.stage;
  };
  const rec = prog.find((s) => (s.op === 1 || s.op === 14)
    && s.params[1] === spawnX && s.params[2] === spawnY
    && `s${dest(s.params[0])}` === destStage);
  if (!rec) throw new Error(`no ${destStage} record at ${spawnX},${spawnY} in ${stage}'s program`);
  return { word: rec.params[3] & 7, dir: FACINGS[rec.params[3] & 7] };
}
mkdirSync(OUT, { recursive: true });

/**
 * Which way the player must FACE for the door tile under (x,y) to arm.
 *
 * A door is a POSITION STEP (opcode 1), and a step tile is armed only while the
 * player faces within ±1 of the group its grid byte carries — the ±1 cone read out
 * of FIELDSTG.PRO at RAM 0x80097624 (pro/fieldstg.s:5572-5590). The disc drops you on
 * the landing tile facing whatever the far record's param 3 says, which can point you
 * AWAY from the door you came out of; you turn, and the door arms. That is the
 * behaviour this check now asserts, in place of the old "always armed on arrival".
 */
function armingFacing(stage, x, y) {
  const grid = GRIDS[stage.slice(1)];
  const b = grid.grid[Math.floor(y / grid.cell) * grid.w + Math.floor(x / grid.cell)] & 0xff;
  const group = (b >> 5) & 7;
  return FACINGS[(group + 7) % 8 === group ? group : group];
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
const errors = [];
page.on("pageerror", (e) => { errors.push(e.message); console.error("PAGEERROR", e.message); });

const results = {};
let failed = null;
const fail = (m) => { failed = m; console.error("FAIL:", m); };
const shot = async (n) => writeFileSync(
  `${OUT}/${n}.png`,
  Buffer.from(
    (await page.locator("canvas#game").evaluate((el) => el.toDataURL("image/png"))).split(",")[1],
    "base64",
  ),
);

const field = () => page.evaluate(() => ({
  map: window.__state.manifest.maps[window.__state.mapIdx].id,
  x: Math.round(window.__state.x),
  y: Math.round(window.__state.y),
  dir: window.__state.dir,
  onExit: window.__state.onExit,
  fade: window.__fade.dir,
  cut: window.__cutscene?.isActive?.() ?? false,
  tb: window.__textbox?.isOpen?.() ?? false,
}));

/** Stable field: transition finished, no cutscene, no textbox. */
const settle = (map, timeout = 10_000) => page.waitForFunction(
  (m) => {
    const s = window.__state;
    return s && s.manifest.maps[s.mapIdx].id === m && window.__fade.dir === 0
      && !(window.__cutscene?.isActive?.() ?? false) && !(window.__textbox?.isOpen?.() ?? false);
  },
  map, { timeout },
);

/** Face a way and let a few frames go by — the field loop reads state.dir each frame. */
const face = (dir) => page.evaluate((d) => {
  window.__state.dir = d;
  window.__state.moving = false;
}, dir);

try {
  // s946/s947 are the post-game ALIAS overlays, and the disc only ever loads an alias
  // overlay once the master story ordinal is 0x2d — that one test is the whole of
  // fieldstg's screen-table base swap (pro/fieldstg.s:0xf468/:0xf46c/:0xf478). So the
  // ordinal is seeded, exactly as tools/verify_alias_world.mjs and the arena checks do;
  // standing in an s9xx map at story point 0 is not a state the game can produce, and
  // asking for it left this check red (it timed out waiting to arrive on s947).
  await page.goto(`${BASE}?noEncounters=1`);
  await page.evaluate(() => {
    localStorage.setItem("engineSchema", "2");
    localStorage.setItem("progressOrdinal", "45");
  });
  await page.goto(`${BASE}?skipTitle=1&map=${A}&noEncounters=1`);
  await page.waitForFunction(() => window.__state?.started, null, { timeout: 15_000 });
  await settle(A);
  await page.waitForTimeout(300);

  // The two scene records are the authority for both doors and both landings.
  const doors = await page.evaluate(([a, b]) => {
    const ea = window.__state.scenes[a].exits.find((e) => e.to === b);
    const eb = window.__state.scenes[b].exits.find((e) => e.to === a);
    return { a: ea, b: eb };
  }, [A, B]);
  if (!doors.a) throw new Error(`${A} has no exit to ${B}`);
  if (!doors.b) throw new Error(`${B} has no exit back to ${A}`);
  if (!doors.a.grid || !doors.b.grid) await fail("a door is not grid-placed");
  if (doors.b._entranceReturn) await fail("the return door is the synthesized one, not the scene's own");

  // Fixture: stand in the s946 door.
  await page.evaluate((d) => window.__tp(d.x + d.w / 2, d.y + d.h / 2), doors.a);
  await page.waitForTimeout(250);
  const onA = await field();
  await shot("door-a-on-exit");
  if (!onA.onExit) await fail(`not on the ${A} door after __tp: ${JSON.stringify(onA)}`);
  if (onA.map !== A) await fail(`wrong map before the first crossing: ${onA.map}`);

  // ── THE DOOR ARROW IS THE TILE'S GROUP ARROW, IN THE BALLOON (field-gap G10) ──
  // The row said the walker "wires the door arrow as floating 0x45/0x46" — the
  // red up-arrow, whatever the door. The decode says otherwise: an op-1 door's
  // indicator is the arrow PAIR the tile's own grid group names (kinds 6-9 =
  // pairs 0x10/0x11, 0x0e/0x0f, 0x0c/0x0d, 0x12/0x13 for groups 1/3/5/7;
  // group 4 is the lift arrow 0x45/0x46), drawn as balloon 0x35 plus the pair
  // through the shipped clip offsets (fieldcom doc's id map + glyph-program
  // table; the walker's kind comes from the engine port, scene-step-ops.ts).
  // Assert the live indicator key carries that kind and the program table
  // carries that pair — a regression to a floating up-arrow fails here.
  let arrowProof = null;
  {
    const grid = GRIDS[A.slice(1)];
    const cellX = Math.floor((doors.a.x + doors.a.w / 2) / grid.cell);
    const cellY = Math.floor((doors.a.y + doors.a.h / 2) / grid.cell);
    const byte = grid.grid[cellY * grid.w + cellX] & 0xff;
    const group = (byte >> 5) & 7;
    const wantKind = group === 4 ? 10 : (group >> 1) + 6;
    const key = await page.evaluate(() => window.__state._indicatorKey);
    const liveKind = key == null ? null : Number(String(key).split(":").pop());
    const fc = JSON.parse(readFileSync(new URL("../web/assets/ui/fieldcom.json", import.meta.url)));
    const ids = (fc.programs?.[wantKind] ?? []).map((s) => s.id);
    const want = { 6: [16, 17], 7: [14, 15], 8: [12, 13], 9: [18, 19], 10: [69, 70] }[wantKind];
    arrowProof = { byte, group, wantKind, indicatorKey: key, liveKind, programIds: ids };
    if (liveKind !== wantKind)
      await fail(`the ${A} door (grid group ${group}) shows kind ${liveKind}, expected the group's arrow ${wantKind}: ${key}`);
    if (want && JSON.stringify(ids) !== JSON.stringify(want))
      await fail(`kind ${wantKind}'s glyph program is [${ids}], expected [${want}]`);
  }

  // ── B5: A DOOR IS LIVE ONLY WITHIN ITS GROUP'S FACING CONE ────────────────
  // The field-gap row said the door "fires from any facing" — a shared
  // approximation from before the convention was settled. The cone is settled
  // now: cone[group][facing] with the group in the grid byte's top three bits
  // (the shipped table asserted against the original image in
  // tests/lane-b/scene-step.test.js:323, replayed for the icon by
  // tools/verify_step_facing_cone.mjs, and folded into the press by the shared
  // trigger-system playback()). Face AWAY from the door's cone — the arrow must
  // hide and the press must be refused; face back in and it crosses.
  const coneRow = JSON.parse(
    readFileSync(new URL("../web/assets/data/scene/step_enable_table.json", import.meta.url)),
  ).rows[arrowProof.group];
  if (coneRow[4] !== 0)
    await fail(`test premise: group ${arrowProof.group}'s cone admits "up" (${coneRow})`);
  await face("up");
  await page.waitForTimeout(250);
  const away = await page.evaluate(() => ({
    onExit: window.__state.onExit,
    indicatorKey: window.__state._indicatorKey,
  }));
  await shot("door-a-facing-away");
  if (away.onExit)
    await fail(`the ${A} door is live while facing up, outside its group's cone`);
  if (away.indicatorKey != null)
    await fail(`the door's arrow is still drawn facing away: ${away.indicatorKey}`);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(700);
  const stayed = await field();
  if (stayed.map !== A)
    await fail(`pressing Enter outside the cone crossed anyway: ${stayed.map}`);
  results.coneAway = { facing: "up", onExit: away.onExit, indicatorKey: away.indicatorKey, mapAfterPress: stayed.map };
  // Back inside the cone — the existing outbound press below must now work.
  await face("down");
  await page.waitForTimeout(250);
  if (!(await field()).onExit) await fail(`the ${A} door did not re-arm facing down, inside its cone`);

  // Outbound crossing.
  await page.keyboard.press("Enter");
  await settle(B);
  await page.waitForTimeout(200);
  const atB = await field();
  await shot("door-b-arrival");
  if (atB.map !== B) await fail(`outbound crossing did not reach ${B}: ${atB.map}`);
  if (atB.x !== doors.a.spawnX || atB.y !== doors.a.spawnY)
    await fail(`landing ${atB.x},${atB.y}, expected ${doors.a.spawnX},${doors.a.spawnY}`);
  if (atB.dir !== doors.a.dir) await fail(`arrival facing ${atB.dir}, expected ${doors.a.dir}`);
  // …and against the disc's own record, which is what makes this a check rather
  // than a restatement of the shipped row. This leg used to land facing "right"
  // for a record whose word is 7 = "down-right".
  const wantB = recordFacing(A, B, doors.a.spawnX, doors.a.spawnY);
  results.outboundRecord = wantB;
  if (atB.dir !== wantB.dir)
    await fail(`arrival facing ${atB.dir}, but ${A}'s record word ${wantB.word} says ${wantB.dir}`);

  // Walk off the door, then back on: the trigger must re-arm.
  await page.keyboard.down("ArrowDown");
  await page.waitForTimeout(320);
  await page.keyboard.up("ArrowDown");
  await page.waitForTimeout(150);
  const offB = await field();
  await shot("door-b-off-exit");
  if (offB.onExit) await fail(`still on the ${B} door after walking away: ${JSON.stringify(offB)}`);

  await page.keyboard.down("ArrowUp");
  await page.waitForFunction(() => window.__state.onExit === true, null, { timeout: 2500 })
    .catch(() => {});
  await page.keyboard.up("ArrowUp");
  await page.waitForTimeout(120);
  const backOnB = await field();
  await shot("door-b-back-on-exit");
  if (!backOnB.onExit) await fail(`the ${B} door did not re-arm on return: ${JSON.stringify(backOnB)}`);

  // Return crossing.
  await page.keyboard.press("Enter");
  await settle(A);
  await page.waitForTimeout(200);
  const backA = await field();
  await shot("door-a-return");
  if (backA.map !== A) await fail(`return crossing did not reach ${A}: ${backA.map}`);
  if (backA.x !== doors.b.spawnX || backA.y !== doors.b.spawnY)
    await fail(`return landing ${backA.x},${backA.y}, expected ${doors.b.spawnX},${doors.b.spawnY}`);
  if (backA.dir !== doors.b.dir) await fail(`return facing ${backA.dir}, expected ${doors.b.dir}`);
  const wantA = recordFacing(B, A, doors.b.spawnX, doors.b.spawnY);
  results.returnRecord = wantA;
  if (backA.dir !== wantA.dir)
    await fail(`return facing ${backA.dir}, but ${B}'s record word ${wantA.word} says ${wantA.dir}`);
  // The landing tile is armed only when the player faces within ±1 of the group its
  // grid byte carries. The record that sent us here drops us facing one step out of
  // that cone, so the door is not offered until the player turns — turn, and the
  // round trip closes.
  const armDir = armingFacing(A, backA.x, backA.y);
  await face(armDir);
  await page.waitForTimeout(150);
  const turned = await field();
  await shot("door-a-turned");
  results.turned = { armDir, onExit: turned.onExit };
  if (!turned.onExit) await fail(`the ${A} door did not re-arm when facing ${armDir}: ${JSON.stringify(turned)}`);

  if (errors.length) await fail(`${errors.length} page error(s)`);
  console.log("RESULT", JSON.stringify({
    ok: !failed, doors, onA, arrowProof, atB, offB, backOnB, backA, results,
  }));
} catch (e) {
  await fail(e.message);
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
